import logging
import uuid

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("leettrack")

from app.api.routers import (
    admin,
    analytics,
    assignments,
    assistant,
    auth,
    chat,
    data_center,
    feedback,
    gamification,
    leaderboard,
    notifications,
    polls,
    sections,
    settings as settings_router,
    site_analytics,
    students,
    teacher,
)
from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.db.base_class import Base
from app.db.session import SessionLocal, engine

# In production, manage schema changes with Alembic migrations instead
# (`alembic upgrade head`) — this is only for fast local iteration.
import app.models  # noqa: F401  (ensures models are registered before create_all)
from app.models.enums import Role
from app.models.user import User

Base.metadata.create_all(bind=engine)


def _ensure_site_settings_columns() -> None:
    """
    create_all() only creates missing *tables*, not columns added to an
    existing table by a later change — this backfills the handful of
    appearance columns added to `site_settings` (background media URL,
    theme preset, dark-surfaces toggle) for any database that already
    had the table from before those existed. Idempotent, safe to run
    on every startup. In production, prefer a real Alembic migration.
    """
    insp = inspect(engine)
    if "site_settings" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("site_settings")}
    is_postgres = engine.dialect.name.startswith("postgres")
    bool_default = "FALSE" if is_postgres else "0"
    additions = {
        "background_media_url": "VARCHAR(500) DEFAULT ''",
        "background_media_cache_path": "VARCHAR(100) DEFAULT ''",
        "background_media_cache_type": "VARCHAR(10) DEFAULT ''",
        "theme_preset": "VARCHAR(30) DEFAULT 'classic'",
        "dark_surfaces_enabled": f"BOOLEAN DEFAULT {bool_default}",
        "dark_surfaces_color": "VARCHAR(20) DEFAULT '#000000'",
        "public_chat_enabled": f"BOOLEAN DEFAULT {'TRUE' if is_postgres else '1'}",
    }
    with engine.begin() as conn:
        for column, ddl in additions.items():
            if column not in existing:
                conn.execute(text(f"ALTER TABLE site_settings ADD COLUMN {column} {ddl}"))


_ensure_site_settings_columns()


def _ensure_notifications_columns() -> None:
    """Same idea as _ensure_site_settings_columns() above, for the
    `meta` column added to `notifications` for the polls feature —
    backfills it on any DB that already had the table before that
    column existed."""
    insp = inspect(engine)
    if "notifications" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("notifications")}
    if "meta" in existing:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE notifications ADD COLUMN meta TEXT"))


_ensure_notifications_columns()


def _ensure_student_profile_columns() -> None:
    """Same idea as _ensure_site_settings_columns() above, for the
    github_username column added to student_profiles — backfills it on
    any DB that already had the table before that column existed."""
    insp = inspect(engine)
    if "student_profiles" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("student_profiles")}
    if "github_username" in existing:
        return
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE student_profiles ADD COLUMN github_username VARCHAR(100) DEFAULT ''")
        )


_ensure_student_profile_columns()


def _ensure_background_media_cache() -> None:
    """
    The media cache lives on local disk (app/media_cache), which on
    Render (and most PaaS free/starter tiers) is ephemeral — wiped on
    every deploy, restart, and spin-down/spin-up after the service
    sleeps. The DB still remembers `background_media_url` after a
    wipe, so on every boot: if a URL is set but its cached file is
    missing from disk, re-fetch and re-cache it right away, before
    the first visitor hits a 404. Safe/idempotent — no-ops if nothing
    is set or the cache is already present.
    """
    from app.models.system import SiteSettings
    from app.services.theme import MEDIA_CACHE_DIR, RemoteMediaFetchError, cache_remote_media

    db = SessionLocal()
    try:
        s = db.get(SiteSettings, 1)
        if not s or not s.background_media_url:
            return
        cache_path = (
            MEDIA_CACHE_DIR / s.background_media_cache_path
            if s.background_media_cache_path
            else None
        )
        if cache_path and cache_path.exists():
            return  # already cached, nothing to do
        try:
            filename, media_type = cache_remote_media(s.background_media_url)
        except RemoteMediaFetchError:
            # Leave cache_path empty — get_background_media/_theme_out
            # already fall back gracefully (proxy_path becomes "").
            # We'll just retry on the next boot.
            return
        s.background_media_cache_path = filename
        s.background_media_cache_type = media_type
        db.commit()
    finally:
        db.close()


_ensure_background_media_cache()


def _ensure_submissions_columns() -> None:
    """
    Same idea as _ensure_site_settings_columns() above, for the
    graded_at column added to `submissions` — backfills it on any DB
    that already had the table before that column existed. Best-effort
    backfill for pre-existing accepted rows: graded_at = accepted_at,
    since before this column existed those two were effectively
    treated as the same moment. Going forward they can diverge (see
    models/submission.py's comment on graded_at) — this backfill only
    ever runs once, the moment the column is first added.
    """
    insp = inspect(engine)
    if "submissions" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("submissions")}
    if "graded_at" in existing:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE submissions ADD COLUMN graded_at TIMESTAMP"))
        conn.execute(
            text(
                "UPDATE submissions SET graded_at = accepted_at "
                "WHERE status = 'accepted' AND accepted_at IS NOT NULL"
            )
        )


_ensure_submissions_columns()


def _bootstrap_super_admin() -> None:
    """
    Creates the initial Super Admin account if it doesn't exist yet,
    and on every subsequent boot re-syncs its password (and email)
    from the env vars — SUPER_ADMIN_PASSWORD always wins over
    whatever is currently in the DB. That way, changing the password
    in Render's env and redeploying actually takes effect, instead of
    silently no-op'ing because the user row already existed. Skips
    the write entirely if the password already matches, so this
    doesn't re-hash (bcrypt) on every single boot for no reason.
    """
    db = SessionLocal()
    try:
        user = db.scalar(
            select(User).where(User.username == settings.SUPER_ADMIN_USERNAME)
        )
        if not user:
            # Guard against SUPER_ADMIN_EMAIL colliding with some other
            # account's email (e.g. left blank in .env and an earlier
            # boot already created a user with that same blank email) —
            # users.email is unique, so inserting would raise
            # IntegrityError and crash the whole app on startup. Skip
            # and warn instead; fix SUPER_ADMIN_EMAIL in .env to a real,
            # unused address to actually create the account.
            email_taken = db.scalar(
                select(User).where(User.email == settings.SUPER_ADMIN_EMAIL)
            )
            if email_taken:
                print(
                    f"[bootstrap] Skipping Super Admin creation: email "
                    f"{settings.SUPER_ADMIN_EMAIL!r} is already used by another "
                    f"account. Set a unique SUPER_ADMIN_EMAIL in your .env."
                )
                return
            db.add(
                User(
                    email=settings.SUPER_ADMIN_EMAIL,
                    username=settings.SUPER_ADMIN_USERNAME,
                    password_hash=hash_password(settings.SUPER_ADMIN_PASSWORD),
                    role=Role.super_admin,
                )
            )
            db.commit()
            return

        changed = False
        if not verify_password(settings.SUPER_ADMIN_PASSWORD, user.password_hash):
            user.password_hash = hash_password(settings.SUPER_ADMIN_PASSWORD)
            changed = True
        if user.email != settings.SUPER_ADMIN_EMAIL:
            # Same collision guard as above, for the "email changed in
            # .env" sync path.
            email_taken = db.scalar(
                select(User).where(
                    User.email == settings.SUPER_ADMIN_EMAIL, User.id != user.id
                )
            )
            if email_taken:
                print(
                    f"[bootstrap] Skipping Super Admin email sync: "
                    f"{settings.SUPER_ADMIN_EMAIL!r} is already used by another "
                    f"account."
                )
            else:
                user.email = settings.SUPER_ADMIN_EMAIL
                changed = True
        if changed:
            db.commit()
    finally:
        db.close()


_bootstrap_super_admin()

app = FastAPI(title=settings.PROJECT_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Centralized error handling.
#
# Goal: every error the frontend ever sees is JSON shaped like
#   {"detail": "<readable message>", "error_id": "<uuid, only for 5xxs>"}
# so app/lib/api.ts's error parsing (which already reads `detail`) never
# has to guess at a shape, and nothing ever leaks a raw Python traceback,
# a SQL error string, or an HTML error page to the client.
# ---------------------------------------------------------------------------


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Turns Pydantic's default 422 body (a `detail` list of {loc, msg,
    type} dicts) into one readable string — the frontend already knows
    how to render a plain string, and a raw list of dicts is not
    something an end user should ever see.
    """
    field_errors = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", []) if p != "body"]
        field = loc[-1] if loc else "input"
        field_errors.append(f"{field}: {err.get('msg', 'invalid value')}")
    message = "; ".join(field_errors) or "Invalid request."
    return JSONResponse(status_code=422, content={"detail": message})


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """
    FastAPI's own HTTPException already carries a sensible `.detail`
    (every route in this app raises these deliberately with a
    human-readable message) — this just guarantees the *shape* of the
    response body stays {"detail": ...} even for exceptions FastAPI
    raises itself (404 on an unmatched route, 405, etc.) where `detail`
    might otherwise be missing or a non-string.
    """
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(SQLAlchemyError)
async def db_exception_handler(request: Request, exc: SQLAlchemyError):
    """
    Any unhandled database error (constraint violation that slipped
    past an app-level check, a dropped connection, etc.) — logged in
    full server-side with a correlation id, but the client only ever
    sees a generic message. Raw SQL errors can reveal table/column
    names and query structure, which is free reconnaissance for an
    attacker.
    """
    error_id = uuid.uuid4().hex[:12]
    logger.exception("Unhandled database error [%s]", error_id)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": "We're having trouble reaching the database. Please try again in a moment.",
            "error_id": error_id,
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Last-resort catch-all — without this, an unexpected bug anywhere in
    the app (a None where a value was assumed, a third-party API
    returning an unexpected shape, etc.) would either crash the worker
    or return a bare-bones default error page. Instead: log the full
    traceback server-side under a short error_id the user can quote
    when reporting a problem, and return a calm, generic message
    instead of a stack trace.
    """
    error_id = uuid.uuid4().hex[:12]
    logger.exception("Unhandled server error [%s]", error_id)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "Something went wrong on our end. Please try again — if it keeps happening, mention error code "
            + error_id,
            "error_id": error_id,
        },
    )


app.include_router(auth.router)
app.include_router(students.router)
app.include_router(assignments.router)
app.include_router(leaderboard.router)
app.include_router(data_center.router)
app.include_router(assistant.router)
app.include_router(analytics.router)
app.include_router(sections.router)
app.include_router(teacher.router)
app.include_router(admin.router)
app.include_router(settings_router.router)
app.include_router(feedback.router)
app.include_router(notifications.router)
app.include_router(chat.router)
app.include_router(chat.teacher_broadcast_router)
app.include_router(gamification.router)
app.include_router(polls.router)
app.include_router(site_analytics.router)

@app.get("/")
def root():
    """
    Root route — exists mainly so cron-based keep-alive pings (and anyone
    who opens the bare backend URL in a browser) get a real 200 instead of
    FastAPI's default 404 "Not Found". Any HTTP request here, even this
    one, is enough to wake/keep-alive a sleeping Render free-tier instance
    — the specific route doesn't matter, only that a request arrives.
    """
    return {"status": "ok", "service": settings.PROJECT_NAME}


@app.get("/api/health")
def health():
    """Dedicated health/keep-alive endpoint. Point your cron job (e.g.
    cron-job.org, UptimeRobot, GitHub Actions schedule) at:
        GET https://leettrack-v1.onrender.com/api/health
    every 10-14 minutes to stop the free-tier instance from spinning down
    (Render free web services sleep after ~15 min of no inbound traffic).
    """
    return {"status": "ok"}