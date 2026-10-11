# LeetTrack API

FastAPI backend. Runs on SQLite out of the box for local dev; point
`DATABASE_URL` at Postgres/Supabase/Neon for anything real.

## Run it

```bash
python3 -m venv venv && source venv/bin/activate   # or your usual env tool
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Docs at `http://localhost:8000/docs` (FastAPI's auto-generated Swagger UI —
useful for poking at every endpoint without writing a frontend call first).

Tables are created automatically on startup for dev convenience. Once this
is running against a real database, switch to Alembic migrations instead
(`alembic revision --autogenerate`, `alembic upgrade head`) and remove the
`Base.metadata.create_all` line in `app/main.py`.

## Super Admin login

There's no public registration endpoint for this role, by design — Super
Admins are created by the site owner, not self-registered. The app
bootstraps one automatically on first startup (see `_bootstrap_super_admin`
in `app/main.py`) using the credentials in `.env`:

```
SUPER_ADMIN_USERNAME=monster_rhinestone
SUPER_ADMIN_PASSWORD=cryonic_induction_6_7/#6JM$yy%z
```

Log in with those at `/login` on the frontend — same login form as
everyone else, the account's role decides where it lands. There's also a
small, unlabeled entry point in the bottom-right corner of the landing
page that links to the same `/login` page, if you want a discreet way in
rather than typing the URL directly.

**Change these before deploying anywhere real** — they're committed to
`.env.example` as local-dev defaults, which means they're not a secret
once this code is shared. Set different values in your actual `.env`
(gitignored) and the bootstrap will create an admin with those instead.

Teachers work the same way, minus the auto-bootstrap: only a Super Admin
can create a teacher account (`POST /api/auth/create-teacher`, or the
"+ New teacher" panel on the frontend's `/admin` page). There's no
self-service teacher registration — that was an open endpoint before,
now it requires a super_admin token.

## What's implemented

- **LeetCode profile score** (`app/services/leetcode_stats.py`,
  `GET /api/students/me/leetcode-score`) — pulls a student's total
  solved-problem counts by difficulty from LeetCode's GraphQL endpoint
  and computes `1×easy + 2×medium + 3×hard`. Cached on `StudentProfile`
  with a 15-minute TTL; falls back to the stale cache rather than
  showing zero if LeetCode is unreachable when a refresh is due. Powers
  the glowing badge in the sidebar and the "LeetCode Score" leaderboard
  ranking basis.
- **Online presence** (`last_seen_at` on `User`, touched in
  `api/deps.py` on authenticated requests, throttled to once/60s per
  user) — `GET /api/students/online-count` counts students active in
  the last 5 minutes. Not real presence (no websocket/disconnect
  detection), just a practical approximation.
- **Leaderboard, rewired** — `ranking_basis` is now exactly two values:
  `assignment_score` (the existing P/T/A/X/M formula) and
  `leetcode_score`. Every entry also always includes
  `total_problems_solved` regardless of which basis is selected.
- **Section deletion** — `DELETE /api/sections/{id}`, refuses if
  students or assignments still reference it rather than silently
  orphaning data.
- **Auth** — student self-registration is now a 2-step OTP flow gated to
  a college email domain (`STUDENT_EMAIL_DOMAIN`, default `kit.ac.in`):
  `POST /api/auth/register/student/request-otp` validates the domain and
  emails a 6-digit code (bcrypt-hashed at rest, single-use, expires in
  `OTP_EXPIRE_MINUTES`); `POST /api/auth/register/student/verify-otp`
  confirms it and creates the account. No account exists until the OTP
  is verified — abandoning the flow partway through leaves nothing
  behind. Email doubles as username, so one college mailbox = one
  account. Forgot-password uses the same OTP mechanism
  (`/api/auth/forgot-password` → `/api/auth/reset-password`), and
  deliberately returns the same response whether or not the email
  exists, to avoid leaking which addresses are registered. Super Admin
  can bypass all of this and create a student with *any* email via
  `POST /api/auth/admin/create-student` — no OTP, no domain check.
  Teacher accounts remain Super Admin-provisioned only (see above).
  Tested live: wrong domain rejected, wrong OTP rejected, correct OTP
  creates the account, replaying a consumed OTP fails, full
  forgot/reset cycle, and the admin bypass.
- **Email delivery** (`app/services/email.py`) — real SMTP if
  `SMTP_HOST` is set; if it's blank (the default), nothing actually
  gets emailed — the OTP is logged server-side and also returned in the
  API response under `dev_otp`, clearly marked, so registration stays
  testable without a mail server. Don't leave `SMTP_HOST` unset in a
  real deployment or every "email" silently becomes a no-op.
- **Students** — dashboard summary (now includes `leetcode_username`,
  which can be `null` — no longer collected at signup, students add it
  later from Settings; submission verification skips anyone who hasn't
  set it yet), notification/theme settings, notifications inbox
  (`GET /api/students/me/notifications`).
- **Site theme** (`app/services/theme.py`, `routers/settings.py`) — the
  Super Admin picks any accent color (a proper color wheel on the
  frontend — backend validates it's a well-formed 6-digit hex, not
  restricted to a fixed set) plus a background video from 7 named
  presets. `GET /api/settings/theme` is public (the landing page needs
  it before login); `PATCH` is super_admin-only.
- **NVIDIA API keys** (`routers/settings.py`) — managed entirely
  through the UI now, not `.env`. Super Admin can add multiple keys;
  the assistant rotates through active ones, skipping (not disabling)
  a rate-limited key and permanently disabling one that gets rejected
  outright (401/403 for bad keys).
- **Teacher management** (`routers/admin.py`) — Super Admin can list
  teachers and edit a teacher's username/password, but only after
  re-entering their own current password as confirmation. Tested: wrong
  admin password → 403, correct → succeeds and the new login works
  immediately.
- **Assignments** — teacher CRUD, scoped to batch / section / specific
  students. Creating an assignment seeds a `Submission` row for every
  targeted student and fires a `new_assignment` notification. Students
  who register *after* an assignment already went out get backfilled —
  `backfill_submissions_for_new_student()` runs at registration time and
  picks up anything matching their section (or batch-wide), so nothing
  silently gets missed. (Deliberately doesn't backfill "specific
  students" assignments — that scope means the teacher picked exact
  people, not "everyone in this section, including future signups.")
- **Leaderboard** — filterable by scope (overall/section), time range
  (overall/last two weeks), and ranking basis (score/problems/assignments).
  Sums each student's real, computed submission scores.
- **Scoring engine** (`app/services/scoring.py`) — pure functions
  implementing the spec's P/T/A/X/M variables: time-decay, attempt
  penalty, first-solver/position bonus, streak bonus, late penalty.
  Wired end-to-end into the verification pipeline below.
- **LeetCode submission verification** (`app/services/verification/`) —
  behind an abstract `SubmissionVerifier` interface, per the spec's
  requirement that this stay swappable. `LeetCodeGraphQLVerifier` polls
  LeetCode's unofficial `recentAcSubmissionList` GraphQL endpoint and
  matches against the assigned problem's slug. This endpoint is
  unauthenticated, rate-limited, and undocumented — if LeetCode changes
  or blocks it, write another `SubmissionVerifier` subclass and swap it
  in `get_verifier()`; nothing else changes.
- **Submission pipeline** (`app/services/submission_pipeline.py`) — ties
  verification → scoring → streak updates together. Tested with a mocked
  verifier: correctly scored a submission, set solve position, and
  incremented the student's streak.
- **AI assistant** (`app/services/ai_assistant.py`,
  `routers/assistant.py`) — NVIDIA NIM-backed chat
  (`nvidia/nemotron-3-ultra-550b-a55b`, OpenAI-compatible endpoint at
  `integrate.api.nvidia.com`), stateless (no message content persisted
  server-side — only a per-interaction message count for the Data
  Center export). System prompt has two layers: general
  LeetTrack/website knowledge always included (roles, scoring,
  streaks, sections, the weekend rule, notifications — see
  `BASE_SYSTEM_PROMPT`), plus optional problem-specific context. That
  context is only injected when the student picks an assignment the
  teacher explicitly flagged `allow_ai_help=True` —
  `GET /api/assistant/eligible-assignments` lists which ones qualify
  for a given student, and the chat endpoint independently re-verifies
  eligibility server-side (a student can't just pass an arbitrary
  `assignment_id` and get help on something their teacher didn't
  approve — tested this returns a 403). Needs at least one active key
  added via the Super Admin's AI Assistant panel (see above); fails
  with a clear 503 (not a crash) if none are configured.
- **Teacher/class analytics** (`routers/analytics.py`) — section
  overview, hardest assignments (lowest completion rate), topic
  weaknesses (by tag), at-risk students (completion rate below a
  threshold).
- **Data Center** (`app/services/archival.py`, `routers/data_center.py`)
  — the export/purge feature: batches of raw submission data get
  snapshotted to JSON on a schedule, Super Admin downloads them from a
  dedicated page, and anything downloaded more than `DATA_RETENTION_DAYS`
  (30, from your answer) ago gets its raw rows purged. Aggregated stats
  are never touched. `POST /api/data-center/batches/create` lets the
  Super Admin snapshot a batch on demand (useful before Celery/Redis is
  running locally); `GET /api/data-center/settings` exposes the
  retention window for the UI to display.
- **Teacher student-picker** (`routers/teacher.py`) —
  `GET /api/teacher/students?section_id=` powers the assignment-creation
  form's "specific students" scope.
- **Notifications** (`app/services/notifications.py`) — row-generating
  logic for deadline reminders, broken-streak alerts, and new-assignment
  pings. No delivery channel wired up yet (push/email/websocket) — these
  just populate the inbox endpoint above.
- **Celery** (`app/celery_app.py`, `app/worker.py`) — beat schedule for:
  polling submissions (5 min), weekly archive-batch creation, daily purge
  sweep, hourly deadline reminders, nightly streak-break checks. Every
  task is a thin wrapper around a plain function, so the logic is
  testable without Celery/Redis running at all — see how the smoke tests
  called `create_deadline_reminders(db)` etc. directly.

## Not yet built

- Delivery channel for notifications (push/email/websocket) — rows exist,
  nothing pushes them to the user yet
- Alembic migration setup (directory structure only — `create_all` is
  fine for dev, not for prod schema changes)
- Rate-limit/backoff tuning for the LeetCode verifier once you're running
  it against real traffic (current settings are conservative guesses)
- OTP resend cooldown / rate limiting — right now a student can request
  a new code as often as they want, which is fine for local dev but
  worth throttling before this is public (someone could spam an inbox)
- A UI for teachers/admins to assign a section to a student after
  signup — registration no longer collects a section, so that has to
  happen from somewhere; only the data model supports it right now
  (`StudentProfile.section_id` is nullable and PATCH-able server-side
  in principle, but there's no endpoint or frontend for it yet)

## Running the background jobs

Needs Redis running locally (`redis-server`, or `docker run -p 6379:6379 redis`).

```bash
celery -A app.celery_app worker --loglevel=info
celery -A app.celery_app beat --loglevel=info   # separate process
```

Both are optional for local API development — every task also runs as a
plain function you can call directly (see `app/worker.py`), which is how
this was tested without Redis in the sandbox that built it.

## Structure

```
app/
  core/       config, JWT + password hashing
  db/         SQLAlchemy session + declarative base
  models/     User/StudentProfile/TeacherProfile, Section, Problem,
              Assignment, Submission, Notification, DataArchiveBatch,
              AIInteractionLog, OtpCode, SiteSettings, NvidiaApiKey
  schemas/    Pydantic request/response models
  api/
    deps.py       get_current_user, require_role
    routers/      auth, students, assignments, leaderboard, data_center,
                  assistant, analytics, admin, settings, teacher, sections
  services/
    scoring.py             dynamic scoring engine
    archival.py             data lifecycle (export/purge)
    assignment_targeting.py resolve which students an assignment applies to,
                             backfill new registrants against existing ones
    notifications.py        deadline/streak/new-assignment notification rows
    ai_assistant.py          NVIDIA NIM chat wrapper with key rotation
    theme.py                 accent-color validation / background-video presets
    otp.py                   OTP generation + verification (registration, reset)
    email.py                 SMTP wrapper with dev-mode console fallback
    submission_pipeline.py   verify -> score -> update streak
    verification/            pluggable LeetCode verification strategy
  celery_app.py   Celery app + beat schedule
  worker.py       task definitions (thin wrappers over services/)
  main.py
```

Remember to fill in `.env` (copy from `.env.example`) with a real
`JWT_SECRET`, and `SMTP_HOST`/`SMTP_USERNAME`/`SMTP_PASSWORD` once you
want OTP emails actually delivered (see "Email delivery" above). NVIDIA
API keys are added later through the Super Admin UI — nothing to set
for those in `.env`.
