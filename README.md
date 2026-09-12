# LeetTrack

A platform where teachers assign LeetCode problems to student sections,
students solve them and build a streak, and everyone's ranked on a live
leaderboard. Next.js frontend + FastAPI backend, deployed separately.

```
leettrack/
  leettrack_frontend/   Next.js 16 (App Router) + TypeScript + Tailwind v4
  leettrack_backend/    FastAPI + SQLAlchemy + Celery
```

Each has its own README with full details — this one's the quickstart,
how the two fit together, and a running log of what's changed.

## Run it locally

```bash
# backend — terminal 1
cd leettrack_backend
python3 -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload

# frontend — terminal 2
cd leettrack_frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. Backend docs (Swagger UI) at
`http://localhost:8000/docs`.

Everything works out of the box with SQLite and no external services
configured — OTP codes get logged to the backend's console and returned
in the API response as `dev_otp` when no email backend is set up, so you
can register/reset without needing real email. See
`leettrack_backend/README.md` for wiring up Gmail API, Postgres, Redis/
Celery, and the Super Admin bootstrap credentials (**change those before
deploying** — the defaults are public since they're in this repo's
`.env.example`).

## Background media

The video/image behind the landing and dashboard pages is admin-managed,
not bundled — drop files into `leettrack_frontend/public/` and register
them from `/admin` → Appearance once the app's running. Nothing shows
until you do this; that's expected, not a bug.

## Deployment

- **Frontend** → Vercel (or any Next.js host). Set `NEXT_PUBLIC_API_URL`
  to your deployed backend's URL.
- **Backend** → Railway, Render, or similar. Set `DATABASE_URL` to a real
  Postgres instance (SQLite is fine for dev, not for production), and
  set `ALLOWED_ORIGINS` to your deployed frontend's URL so CORS doesn't
  block it.
- Every secret (`JWT_SECRET`, `SUPER_ADMIN_PASSWORD`, `GMAIL_*`,
  `SMTP_*`) goes in your platform's environment variable settings —
  never in a committed file. `.gitignore` already excludes `.env`,
  `leettrack_backend/scripts/credentials.json`, and
  `leettrack_backend/scripts/token.json`, but it's worth double-checking
  `git status` before your first push regardless.
- There's no Alembic in this project — `Base.metadata.create_all()` runs
  on every backend startup (see `app/main.py`) and creates any table
  that doesn't exist yet. It does **not** alter existing tables. This
  changelog only added new tables (`activity_events`,
  `broadcast_messages`) — nothing touched an existing table's columns —
  so a normal redeploy against your existing Postgres DB is enough,
  no manual migration needed.

## What's where

- Student/teacher/Super Admin flows, OTP registration, the scoring
  engine, AI assistant, and everything else backend-side:
  `leettrack_backend/README.md`
- Pages, components, the sidebar/theming system, and what's tested vs.
  not: `leettrack_frontend/README.md`

---

## Changelog — this round

Everything below shipped together. Grouped by area; each note says
where to look if you need to change it further.

### Student profile changes — weekend-gated

Students can change their **display name** and **LeetCode username**
from Settings, but only on **Saturday/Sunday, IST** (`Asia/Kolkata`,
UTC+5:30 — checked server-side regardless of the deployment's own
timezone). Notification preferences are unaffected and can be changed
any day.

- Backend gate: `app/services/time_windows.py` (`is_ist_weekend`) and
  `app/api/routers/students.py` (`update_settings` — see
  `WEEKEND_GATED_FIELDS`).
- Frontend: `app/settings/page.tsx` disables those two fields on
  weekdays and shows why; it's a UX nicety only, the backend enforces
  the real rule independent of what the client's clock says.
- LeetCode account **disconnect** was intentionally **not** added —
  only username changes, still weekend-gated.
- Username itself (used for login) is the student's registration email
  and was never editable — that's unchanged.
- Teachers and the Super Admin get a notification (see below) whenever
  a student changes their display name, since teachers match students
  against a roster by name.

### Notifications — now work for every role

Previously the notification bell only worked for students
(`/api/students/me/notifications`, student-role-only). There's now a
generic set of endpoints any authenticated role can use:

- `GET /api/notifications/me`, `POST /api/notifications/me/{id}/read`,
  `POST /api/notifications/me/read-all` —
  `app/api/routers/notifications.py`.
- `NotificationBell.tsx` now calls these instead of the old
  student-only ones.
- The bell itself is now also rendered for teachers and the Super Admin
  (`components/Nav.tsx`), not just students (`StudentShell.tsx`, which
  already had it).
- Teacher/Super Admin display-name-change alerts and broadcast messages
  (below) both deliver through this same system.

### Super Admin broadcast messages

Super Admin can send a plain-text message to **everyone**, **all
students**, **all teachers**, or **one specific person** — it lands in
the recipient's notification bell.

- `POST /api/admin/broadcast`, `GET /api/admin/broadcast` (send
  history) — `app/api/routers/admin.py`.
- Delivery fans out into individual `Notification` rows
  (`app/services/notifications.py:send_broadcast`); a `BroadcastMessage`
  row is also kept per send as an audit record (who sent it, to what
  target, to how many people).
- UI: **Broadcast messages** panel on `/admin`
  (`components/admin/SuperAdminPanels.tsx`).

### Feedback visibility

- `GET /api/feedback/all` already existed but wasn't wired into any
  page — it's now the **Feedback** panel on `/admin`, showing what's
  been sent and by which role.
- `GET /api/feedback/count` is now **Super Admin only** (was public).
  Students/teachers still see the "Feedback" pill (that's where they
  send feedback from), but the number in it is gone —
  `components/FeedbackWidget.tsx` no longer fetches or displays a
  count at all. The only place a feedback count shows up anywhere in
  the app now is the Super Admin's Feedback panel.

### Scoring formula — unchanged on purpose

The "max marks" a teacher sets on an assignment (`problem_score`) is
the **base** score, not a hard ceiling — the existing bonus terms
(first-solver, position, streak) can still push a score above it for a
strong solve. That's intentional and was **not** changed; what changed
is that this is now surfaced explicitly in the UI so it doesn't read as
a bug:

- `app/dashboard/page.tsx` (student view) and `app/teacher/page.tsx`
  (assignment creation form) both now show a short note next to the
  points value explaining a student can score above it.
- `app/services/scoring.py` has a comment recording this decision, in
  case a future pass wants to reconsider it.

### Classroom/section selector at registration

- `GET /api/sections` was already public (built for exactly this).
  `app/register/page.tsx` now fetches it and shows a dropdown; it's
  optional (a student who doesn't know their section yet can register
  without one).
- Backend: `StudentOtpRequest.section_id` (optional) threads through
  the OTP payload (`app/api/routers/auth.py`,
  `request_student_otp`/`verify_student_otp`) into the created
  `StudentProfile`.

### Data Center — richer exports for future model training

- Every submission export row now also carries: score, lateness, exact
  minutes from release to solve, the assignment's difficulty/tags/
  scope/release/deadline, and the student's section + streak context
  at export time — `app/services/archival.py:_submission_record`.
- A new lightweight **event log** (`ActivityEvent` —
  `app/models/system.py`) captures logins, profile changes, manual
  LeetCode refreshes, registrations, and admin overrides
  (`app/services/activity_log.py:log_event`, called from the relevant
  routers). These are included in every export batch alongside the
  submission data (`app/services/archival.py:create_pending_batch`).
- Export batch JSON shape changed from a bare array to
  `{period_start, period_end, generated_at, submissions, activity_events}`
  — update anything downstream that parsed the old array shape.

### Super Admin "super powers"

A focused set of overrides, all logged to `ActivityEvent`, all in
`app/api/routers/admin.py`:

- `PATCH /api/admin/students/{id}/profile` — edit any student's display
  name / LeetCode username / **section** any day (not weekend-gated —
  that restriction is specifically on students editing their own
  profile).
- `PATCH /api/admin/users/{id}/status` — suspend/reactivate a login
  without deleting the account or its data. Surfaced as a
  Suspend/Reactivate button next to every student and teacher on
  `/admin`.
- `POST /api/admin/students/{id}/reset-streak` — zero out a student's
  current streak.
- `PATCH /api/admin/submissions/{id}/override` — manually correct a
  submission's score/status (e.g. LeetCode's unofficial API returned
  something wrong).
- UI for all four: **Super Admin overrides** panel on `/admin`.

The rest of the site still runs entirely on its own automatic logic —
these are explicit, logged exceptions to that, not a general bypass.

### Account deletion — admin-created students couldn't actually be deleted

Root cause: `delete_user` (`app/api/routers/admin.py`) cleaned up
`Submission`, `Notification`, `AIInteractionLog`, and
`AssignmentTarget` rows before deleting a student, but never touched
`Feedback` rows. On SQLite that silently leaves orphaned rows; on
**Postgres** (this project's production DB) it raises a
`ForeignKeyViolation` and the whole delete fails — which is why this
kept showing up specifically on accounts that had been exercised in
testing (e.g. after submitting feedback).

Fixed by a shared `_clear_user_references()` cleanup (now also handles
the new `ActivityEvent` table and nullifies `BroadcastMessage`'s
optional target reference) applied to **both** the student and teacher
delete paths — teachers can now also receive notifications and submit
feedback, so the same bug would otherwise have hit teacher deletion
eventually too.

### UI — bigger glassmorphic panels

Widened the main content container (`max-w-[...]`) on every major page
— admin, settings, teacher, dashboard, leaderboard, analytics, and the
landing page hero — by roughly 10–15%, and bumped section panels from
`p-6` to `p-7`. Deliberately did **not** add padding to the shared
`.glass`/`.glass-strong` CSS classes themselves
(`app/globals.css`) — see the comment left there: because Tailwind's
utility classes and a same-specificity custom class rule land at the
same specificity, a padding rule on `.glass` would have silently
overridden every element's own `p-*`/`px-*`/`py-*` utility (nav pills,
buttons, badges) instead of only filling gaps where nothing was set.
The "fuller, not bulkier" sizing this changelog asked for is handled
entirely per-page via the widened containers instead.

---

## Changelog — round 2

### Feedback wasn't reaching the Super Admin's notification bell

`POST /api/feedback` saved the row but never created a `Notification`
for it — the Super Admin only saw new feedback by manually opening the
Feedback panel on `/admin`. Fixed: every submission now also notifies
every Super Admin via `notify_feedback_submitted()`
(`app/services/notifications.py`), so it shows up in the bell like
everything else.

### LeetCode username — first connection isn't weekend-gated anymore

Previously *any* change to `leetcode_username` (including linking it
for the very first time) required a weekend. Now: connecting LeetCode
for the first time (nothing linked yet) works any day; only changing
an *already-linked* username is still weekend-gated. See
`app/api/routers/students.py:update_settings` (`is_first_leetcode_connect`)
and `app/settings/page.tsx` (`leetcodeEditable`).

### "Edit a student's profile" — dropdown instead of hand-typed ID, and the "[object Object]" bug

Two separate things, both in the Super Admin's overrides panel:

- The student-profile-override and reset-streak forms took a raw
  numeric user ID typed by hand — easy to mistype, no way to know IDs
  without opening another panel. Both are now `<select>` dropdowns
  populated from `/api/admin/students`, and picking a student now
  pre-fills their current display name instead of leaving it blank —
  `components/admin/SuperAdminPanels.tsx`.
- The `"[object Object]"` error: FastAPI's 422 validation-error
  responses put an *array* of `{loc, msg, type}` objects in `detail`
  (not a string, unlike a normal `HTTPException(status, "message")`).
  `apiFetch`'s error handling assigned that array straight into the
  error message, which then implicitly stringified to
  `"[object Object]"`. Fixed in `lib/api.ts` — every shape of `detail`
  (string, validation-error array, other object) now gets normalized
  into an actual readable message. This was a global bug, not specific
  to this one form — it would've shown the same garbled message on
  *any* 422 anywhere in the app.

### AI Chat — switched from Groq to NVIDIA, with a much more detailed system prompt

- Provider swapped from Groq (`openai/gpt-oss-120b`) to NVIDIA's NIM
  API (`nvidia/nemotron-3-ultra-550b-a55b`, OpenAI-compatible endpoint
  at `integrate.api.nvidia.com`) — `app/services/ai_assistant.py`,
  `app/core/config.py` (`NVIDIA_MODEL`, `NVIDIA_API_URL`).
- The key-management table was renamed `GroqApiKey` → `NvidiaApiKey`
  (new table `nvidia_api_keys`, auto-created on next deploy same as
  before — no migration needed). **Existing Groq keys in the old
  `groq_api_keys` table won't carry over**: add a real NVIDIA key
  (from build.nvidia.com) through Settings → AI Assistant on `/admin`
  after deploying, or the assistant will 503 with "No NVIDIA API key
  is configured."
- `BASE_SYSTEM_PROMPT` was rewritten to be substantially more
  detailed — it now explains roles, the full scoring model (including
  that scores can exceed the base point value), streaks, sections,
  the LeetCode weekend rule, notifications, and feedback/broadcasts,
  not just "you're a coding tutor." See
  `app/services/ai_assistant.py:BASE_SYSTEM_PROMPT`.
- Nemotron's visible chain-of-thought reasoning mode is turned off
  (`chat_template_kwargs: {enable_thinking: false}`) so responses read
  as a normal tutor reply, not exposed reasoning traces.
- The "GPT OSS 120b" model-name pill was removed from the AI Chat page
  header (`app/ai-chat/page.tsx`) — nothing model-specific is shown to
  students anymore.

---

## Changelog — round 3

### Feedback notifications now name the sender

`notify_feedback_submitted` previously only said "a student" or "a
teacher" — now includes the actual sender's display name, e.g. `New
feedback from Priya Sharma (student): "..."`. The Feedback panel list
on `/admin` shows the sender's name too. See `_display_name()` in
`app/api/routers/feedback.py`.

### Super Admin can assign a section to any student

The student-profile-override endpoint (`PATCH
/api/admin/students/{id}/profile`) already accepted `section_id` — it
just wasn't exposed anywhere. The Super Admin's "All students" list on
`/admin` now has a section dropdown per student
(`app/app/admin/page.tsx:StudentsListPanel`), so admin-created students
(who couldn't be assigned a section before any teacher had created one)
can be assigned one directly, any time.

### Teacher's assignment form auto-fetches difficulty from the LeetCode link

Pasting/leaving a LeetCode URL in the assignment-creation form now
fetches that problem's real title/difficulty/tags from LeetCode
(`GET /api/teacher/leetcode-problem-info`,
`app/services/leetcode_problem.py`) on blur. Difficulty always gets set
from what LeetCode actually reports; title/tags only fill in if the
teacher left them blank (so a custom title isn't clobbered). Difficulty
stays manually overridable in case the fetch is wrong or unavailable
(LeetCode's endpoint is unofficial/unauthenticated, same caveats as the
rest of the LeetCode integration).

### Fixed: "Edit a student's profile" — dropdown instead of a hand-typed ID, and the `"[object Object]"` bug

- The Super Admin's profile-override and reset-streak forms took a raw
  numeric user ID typed by hand. Both are now dropdowns populated from
  `/api/admin/students`, and picking a student pre-fills their current
  display name.
- The `"[object Object]"` error was `lib/api.ts` mishandling FastAPI's
  422 validation-error shape (`detail` as an array of `{loc, msg,
  type}` objects, not a string) — it now normalizes every shape of
  `detail` into a readable message. This was a global bug affecting any
  422 anywhere in the app, not just this form.

### AI Chat — cleaner formatting and real token streaming

- `BASE_SYSTEM_PROMPT` (`app/services/ai_assistant.py`) now explicitly
  tells the model to write in plain prose with no markdown symbols
  (asterisks, headers, tables, bullet/numbered lists) — code still goes
  in fenced code blocks since that's needed for readability, everything
  else is ordinary sentences.
- The assistant now streams its reply token-by-token instead of
  returning the whole thing at once. New `chat_stream()` generator
  (`app/services/ai_assistant.py`) parses NVIDIA's SSE stream and
  yields text chunks; new `POST /api/assistant/chat/stream` endpoint
  (`app/api/routers/assistant.py`) forwards them as a plain-text
  streaming HTTP response. The AI Chat page
  (`app/ai-chat/page.tsx`) reads that stream with the Fetch API's
  `ReadableStream` and updates the assistant's message bubble as
  chunks arrive. `lib/api.ts` gained a `streamFetch()` helper (same
  auth-attach + 401-refresh-retry behavior as `apiFetch`, but returns
  the raw `Response` instead of parsing JSON) to support this.

### Notification bell + Feedback pill — dashboard only

`StudentShell`'s `showFeedback` prop was replaced with a single
`showTopWidgets` flag that now gates *both* the Feedback pill and the
notification bell together (previously only the Feedback pill was
gated per-page — the bell always showed everywhere). Only
`app/dashboard/page.tsx` passes `showTopWidgets`; AI Chat, Leaderboard,
and Settings all render `<StudentShell>` with no widgets in the corner
now.
