from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.enums import Role
from app.models.system import BackgroundMedia, NvidiaApiKey, SiteSettings
from app.models.user import User
from app.services.theme import (
    ACCENT_COLOR_OPTIONS,
    MEDIA_CACHE_DIR,
    THEME_PRESETS,
    RemoteMediaFetchError,
    cache_remote_media,
    delete_cached_media,
    derive_label,
    is_valid_hex_color,
    is_valid_media_filename,
    is_valid_media_url,
    is_valid_theme_preset,
    media_type_for,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_create_settings(db: Session) -> SiteSettings:
    settings_row = db.get(SiteSettings, 1)
    if not settings_row:
        settings_row = SiteSettings(id=1)
        db.add(settings_row)
        db.commit()
        db.refresh(settings_row)
    return settings_row


class ThemeOut(BaseModel):
    accent_color: str
    background_media: str
    background_media_type: str
    background_media_url: str
    # Where the frontend actually points <video>/<img> at when a
    # background_media_url is set: our own cached copy, not the
    # external link directly. Empty if no URL is set, or if the most
    # recent fetch of it failed (see background_media_cache_error on
    # the PATCH response) — the frontend falls back to
    # `background_media` in that case.
    background_media_proxy_path: str
    theme_preset: str
    dark_surfaces_enabled: bool
    dark_surfaces_color: str


class MediaOptionOut(BaseModel):
    id: int
    filename: str
    label: str
    media_type: str


class ThemeOptionsOut(BaseModel):
    accent_colors: list[dict]
    media: list[MediaOptionOut]
    theme_presets: list[str]


class ThemeUpdate(BaseModel):
    accent_color: str | None = None
    background_media: str | None = None
    # A direct link to an already-hosted image/video. When set, the
    # backend downloads it once into a local cache and the frontend is
    # served that cached copy from then on (see services/theme.py) —
    # takes precedence over `background_media` while set. Send "" to
    # clear it and fall back to `background_media` again.
    background_media_url: str | None = None
    theme_preset: str | None = None
    dark_surfaces_enabled: bool | None = None
    dark_surfaces_color: str | None = None


def _theme_out(s: SiteSettings) -> ThemeOut:
    proxy_path = (
        f"/api/settings/background-media?f={s.background_media_cache_path}"
        if s.background_media_cache_path
        else ""
    )
    effective_type = (
        s.background_media_cache_type
        if s.background_media_cache_type
        else (media_type_for(s.background_media) if s.background_media else "image")
    )
    return ThemeOut(
        accent_color=s.accent_color,
        background_media=s.background_media,
        background_media_type=effective_type,
        background_media_url=s.background_media_url,
        background_media_proxy_path=proxy_path,
        theme_preset=s.theme_preset,
        dark_surfaces_enabled=s.dark_surfaces_enabled,
        dark_surfaces_color=s.dark_surfaces_color,
    )


@router.get("/theme", response_model=ThemeOut)
def get_theme(db: Session = Depends(get_db)):
    """Public — the landing page and every page's background need this before login."""
    s = _get_or_create_settings(db)
    return _theme_out(s)


@router.get("/background-media")
def get_background_media(f: str, db: Session = Depends(get_db)):
    """
    Public — serves whatever the Super Admin's background_media_url was
    most recently cached as (see services/theme.py's cache_remote_media).
    `f` is the cache filename from the theme payload, not admin input;
    it always matches the currently-active cache slot 1:1 — this is a
    read of our own local file, nothing dynamic to inject.
    Short max-age + revalidation rather than a long one: the cache
    filename only changes when the *link* changes, so if the admin
    re-points the same link at different content there'd otherwise be
    no way to bust stale copies already sitting in visitors' browsers.
    """
    s = _get_or_create_settings(db)
    if not s.background_media_cache_path or s.background_media_cache_path != f:
        raise HTTPException(404, "That's not the currently cached background.")
    path = MEDIA_CACHE_DIR / s.background_media_cache_path
    if not path.exists():
        # Disk got wiped out from under us (deploy/restart/sleep on an
        # ephemeral filesystem) after boot already ran its own
        # re-fetch, or this is a different instance than the one that
        # booted. The link itself is still in the DB, so re-fetch it
        # live right here instead of making the admin do it manually.
        if not s.background_media_url:
            raise HTTPException(404, "Cached file is missing and no source link is set.")
        try:
            filename, media_type = cache_remote_media(s.background_media_url)
        except RemoteMediaFetchError as exc:
            raise HTTPException(502, f"Couldn't re-fetch the background link — {exc}") from exc
        s.background_media_cache_path = filename
        s.background_media_cache_type = media_type
        db.commit()
        path = MEDIA_CACHE_DIR / filename
    return FileResponse(path, headers={"Cache-Control": "public, max-age=300, must-revalidate"})


@router.get("/theme/options", response_model=ThemeOptionsOut)
def get_theme_options(db: Session = Depends(get_db)):
    """Public — powers the Super Admin's picker UI, but harmless to expose generally."""
    registered = db.scalars(select(BackgroundMedia).order_by(BackgroundMedia.filename)).all()
    return ThemeOptionsOut(
        accent_colors=[{"name": o.name, "hex": o.hex} for o in ACCENT_COLOR_OPTIONS],
        media=[
            MediaOptionOut(
                id=m.id,
                filename=m.filename,
                label=derive_label(m.filename),
                media_type=media_type_for(m.filename),
            )
            for m in registered
        ],
        theme_presets=THEME_PRESETS,
    )


@router.patch("/theme", response_model=ThemeOut)
def update_theme(
    payload: ThemeUpdate,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    if payload.accent_color and not is_valid_hex_color(payload.accent_color):
        raise HTTPException(400, "That's not a valid 6-digit hex color (e.g. #4F9DDE).")

    if payload.dark_surfaces_color and not is_valid_hex_color(payload.dark_surfaces_color):
        raise HTTPException(400, "That's not a valid 6-digit hex color (e.g. #000000).")

    if payload.theme_preset is not None and not is_valid_theme_preset(payload.theme_preset):
        raise HTTPException(400, f"theme_preset must be one of: {', '.join(THEME_PRESETS)}.")

    if payload.background_media:
        registered = db.scalar(
            select(BackgroundMedia).where(BackgroundMedia.filename == payload.background_media)
        )
        if not registered:
            raise HTTPException(
                400, "That file isn't registered yet: add it below first."
            )

    if payload.background_media_url and not is_valid_media_url(payload.background_media_url):
        raise HTTPException(
            400, "That needs to be a full http:// or https:// link to an image or video."
        )

    s = _get_or_create_settings(db)
    if payload.accent_color:
        s.accent_color = payload.accent_color
    if payload.background_media:
        s.background_media = payload.background_media
    if payload.background_media_url is not None:
        new_url = payload.background_media_url.strip()
        if new_url != s.background_media_url:
            # The link actually changed (or is being cleared/set fresh) —
            # drop whatever was cached before and, if a new link was
            # given, fetch+cache it right now so the very first visitor
            # already gets the fast local copy instead of triggering the
            # fetch themselves.
            delete_cached_media(s.background_media_cache_path)
            s.background_media_cache_path = ""
            s.background_media_cache_type = ""
            if new_url:
                try:
                    filename, media_type = cache_remote_media(new_url)
                except RemoteMediaFetchError as exc:
                    raise HTTPException(502, f"Couldn't cache that link — {exc}") from exc
                s.background_media_cache_path = filename
                s.background_media_cache_type = media_type
            s.background_media_url = new_url
    if payload.theme_preset is not None:
        s.theme_preset = payload.theme_preset
    if payload.dark_surfaces_enabled is not None:
        s.dark_surfaces_enabled = payload.dark_surfaces_enabled
    if payload.dark_surfaces_color:
        s.dark_surfaces_color = payload.dark_surfaces_color
    db.commit()
    db.refresh(s)
    return _theme_out(s)


# --- Background media registry ----------------------------------------------


class BackgroundMediaCreate(BaseModel):
    filename: str


@router.post("/background-media", response_model=MediaOptionOut, status_code=201)
def add_background_media(
    payload: BackgroundMediaCreate,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Registers a file the admin has already uploaded to the frontend's
    public/ folder (video: .mp4/.webm, image: .jpg/.jpeg/.png/.webp).
    This doesn't touch any actual file — it just tells the frontend
    "this filename is selectable" and lets the label auto-derive.
    """
    filename = payload.filename.strip()
    if not is_valid_media_filename(filename):
        raise HTTPException(
            400,
            "Filename needs to be letters/numbers/underscores/hyphens plus "
            ".mp4, .webm, .jpg, .jpeg, .png, or .webp.",
        )
    if db.scalar(select(BackgroundMedia).where(BackgroundMedia.filename == filename)):
        raise HTTPException(400, "That's already registered.")

    media = BackgroundMedia(filename=filename)
    db.add(media)
    db.commit()
    db.refresh(media)
    return MediaOptionOut(
        id=media.id,
        filename=filename,
        label=derive_label(filename),
        media_type=media_type_for(filename),
    )


@router.delete("/background-media/{media_id}", status_code=204)
def delete_background_media(
    media_id: int,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    media = db.get(BackgroundMedia, media_id)
    if not media:
        return
    # Don't delete whatever's currently selected out from under the live site.
    s = _get_or_create_settings(db)
    if s.background_media == media.filename:
        raise HTTPException(
            400, "This is the active background: pick a different one first."
        )
    db.delete(media)
    db.commit()


# --- NVIDIA API keys --------------------------------------------------


class NvidiaKeyOut(BaseModel):
    id: int
    masked_key: str
    label: str
    is_active: bool
    failure_count: int

    model_config = {"from_attributes": True}


class NvidiaKeyCreate(BaseModel):
    key: str
    label: str = ""


def _mask(key: str) -> str:
    if len(key) <= 8:
        return "•" * len(key)
    return f"{key[:4]}{'•' * (len(key) - 8)}{key[-4:]}"


@router.get("/nvidia-keys", response_model=list[NvidiaKeyOut])
def list_nvidia_keys(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    keys = db.scalars(select(NvidiaApiKey).order_by(NvidiaApiKey.created_at)).all()
    return [
        NvidiaKeyOut(
            id=k.id,
            masked_key=_mask(k.key),
            label=k.label,
            is_active=k.is_active,
            failure_count=k.failure_count,
        )
        for k in keys
    ]


@router.post("/nvidia-keys", response_model=NvidiaKeyOut, status_code=201)
def add_nvidia_key(
    payload: NvidiaKeyCreate,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    if not payload.key.strip():
        raise HTTPException(400, "Key can't be empty.")
    key = NvidiaApiKey(key=payload.key.strip(), label=payload.label.strip())
    db.add(key)
    db.commit()
    db.refresh(key)
    return NvidiaKeyOut(
        id=key.id,
        masked_key=_mask(key.key),
        label=key.label,
        is_active=key.is_active,
        failure_count=key.failure_count,
    )


@router.delete("/nvidia-keys/{key_id}", status_code=204)
def delete_nvidia_key(
    key_id: int,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    key = db.get(NvidiaApiKey, key_id)
    if key:
        db.delete(key)
        db.commit()


@router.patch("/nvidia-keys/{key_id}/toggle", response_model=NvidiaKeyOut)
def toggle_nvidia_key(
    key_id: int,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Manually re-enable a key that got auto-disabled after repeated failures."""
    key = db.get(NvidiaApiKey, key_id)
    if not key:
        raise HTTPException(404, "Key not found.")
    key.is_active = not key.is_active
    key.failure_count = 0
    db.commit()
    db.refresh(key)
    return NvidiaKeyOut(
        id=key.id,
        masked_key=_mask(key.key),
        label=key.label,
        is_active=key.is_active,
        failure_count=key.failure_count,
    )