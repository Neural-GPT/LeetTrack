# LeetTrack — frontend

Next.js 16 (App Router) + TypeScript + Tailwind v4. Talks to the
`leettrack-backend` FastAPI project — run that first.

## Run it

```bash
cp .env.local.example .env.local   # points at http://localhost:8000 by default
npm install
npm run dev
```

Open `http://localhost:3000`.

The backend's CORS is configured for `http://localhost:3000` by default
(`ALLOWED_ORIGINS` in the backend's `.env`) — if you run the frontend on
a different port, update that too.

## Pages

| Route | Access | Wired to |
|---|---|---|
| `/` | public | landing page (video hero, unscrollable); has a small, unlabeled admin-login icon bottom-right |
| `/login` | public | `POST /api/auth/login`; links to `/forgot-password` |
| `/register` | public | student-only, 2-step OTP flow — `POST /api/auth/register/student/request-otp` then `.../verify-otp`. College email domain only (see Auth below) |
| `/forgot-password` | public | `POST /api/auth/forgot-password` then `/api/auth/reset-password` |
| `/dashboard` | student | sidebar layout — `GET /api/students/me/dashboard`, `/me/assignments`; shows a nudge banner linking to Settings if no LeetCode username is set yet |
| `/ai-chat` | student | sidebar layout — `GET /api/assistant/eligible-assignments`, `POST /api/assistant/chat` |
| `/settings` | student | sidebar layout — LeetCode username field (this is where it's set now, not at signup) + theme/notification prefs, `PATCH /api/students/me/settings` |
| `/leaderboard` | any logged-in role | sidebar for students, top nav for teacher/super_admin — `GET /api/leaderboard` |
| `/analytics` | teacher/super_admin | top nav — `GET /api/analytics/*` |
| `/teacher` | teacher/super_admin | top nav — sections panel, assignment creation (incl. "Allow AI help" toggle) + list, `POST/GET/DELETE /api/assignments`, `GET /api/teacher/students`, `GET/POST /api/sections` |
| `/admin` | super_admin | top nav — teacher creation + management, student creation (any email, bypasses the OTP/domain flow), Appearance (color wheel + background video), Groq API key management, Data Center |

Student pages (`/dashboard`, `/ai-chat`, `/settings`, and `/leaderboard`
when viewed as a student) use `StudentSidebar`/`StudentShell` instead of
the top nav — Assignments, Leaderboard, AI Chat, a gear icon for
Settings, an avatar circle, and a logout icon below it. It's permanently
icon-only now (no expand/collapse — hover an icon to see its label via
the native tooltip). The "LeetTrack" wordmark lives in its own floating
pill at the top-center of the page, separate from the rail, so it's
always visible; the small brand dot stays on the sidebar itself.

## Auth

`src/lib/auth-context.tsx` handles login/logout and keeps the current
role in state — registration is handled directly by the register/
forgot-password pages themselves now, since it's a multi-step flow
(`completeStudentRegistration` in the context only covers the final
OTP-verify step). Tokens live in `localStorage`
(`leettrack_access_token` / `leettrack_refresh_token` / `leettrack_role`)
— fine for local dev, worth reconsidering (httpOnly cookies) before a
real deployment, since anything in localStorage is readable by any script
on the page.

**Students self-register with a college email + OTP** — name, email,
password, nothing else. The domain is validated client-side for a quick
error message and server-side for real (client-side checks are UX only,
never trust them for anything that matters). No section and no LeetCode
username are collected at signup anymore; a student adds their LeetCode
username later from `/settings` — the dashboard nudges them to if it's
still missing. **Teacher and additional student accounts are Super
Admin-provisioned** from `/admin` (teachers always; students only when
someone needs an account outside the college domain — normal students
use `/register`). Super Admin itself isn't created through the UI at
all — the backend bootstraps one automatically on first startup; see the
backend README for the credentials and how to change them before any
real deployment. The tiny dot in the landing page's bottom-right corner
links to the same `/login` page — no separate admin login flow, the
account's role decides where you land after auth.

`src/lib/api.ts` is the fetch wrapper every page uses — attaches the
bearer token, retries once via `/api/auth/refresh` on a 401, and throws
`ApiError` with the backend's actual error message so components can
show it directly. `downloadFile()` handles the Data Center's file
downloads, since a plain `<a href>` can't attach an auth header.

`src/components/RequireRole.tsx` wraps any protected page — redirects to
`/login` if the current role isn't in the allowed list.

## AI Chat

Stateless — closing the tab or refreshing loses the conversation, by
design (nothing's persisted server-side beyond a message count for the
Data Center export). The problem dropdown only lists assignments the
teacher explicitly flagged "Allow AI help" for on `/teacher`; picking one
injects that problem's context into the assistant's system prompt
server-side. Without a problem selected, it'll answer general
LeetTrack/DSA questions but won't discuss assignment specifics.

## Appearance / theming

The Super Admin controls this site-wide, from `/admin` -> Appearance:

- **Accent color** — a real color wheel (native `<input type="color">`,
  live-previews while dragging, saves on release) plus 12 cool-toned
  presets as shortcuts. Backend validates any 6-digit hex, not
  restricted to a fixed set.
- **Background video** — 7 fixed options, matching what you'll drop into
  `public/`: `hero-bg1.mp4` through `hero-bg7.mp4` (Call of Duty, Dark
  Samurai, Kneeling Samurai, Glass Mushroom, Snow Cabin, Winter Cabin,
  Cozy Camp — in that order). `src/components/BackgroundVideo.tsx` reads
  the current selection from `src/lib/theme-context.tsx`, which fetches
  `GET /api/settings/theme` once on load. Without a file present for the
  selected slot, the `<video>` tag just fails silently and you get the
  dark gradient fallback — nothing breaks.

**A real bug worth knowing about if you touch this code:** Tailwind v4
bakes `bg-brand`/`text-brand`/opacity variants like `bg-brand/15` into a
*literal hex value* at build time — confirmed by inspecting the compiled
CSS output, not an assumption. Runtime changes to `--color-brand`
silently had zero effect on anything using those utility classes. Fixed
by defining explicit `color-mix()`-based classes in `globals.css`
(`bg-brand-live`, `text-brand-live`, `border-brand-live-25`, etc.) and
migrating every component to them. If you add a new component that
needs to react to the accent color, use one of the `-live` classes (or
`var(--color-brand)` directly via an arbitrary Tailwind value like
`bg-[var(--color-brand)]`, which is always safe) — plain `bg-brand`
will look right at build time and then silently stop updating the
moment someone changes the color from `/admin`.

`ThemeProvider` wraps the whole app in `layout.tsx`, so the accent color
applies before any page-specific code runs.

## What's real vs. stubbed

Every route in the table above is wired to a live backend endpoint and
was tested end-to-end against a running server — including a new
student registering *after* an assignment already went out and still
seeing it (that was a real bug, now fixed both in the backend's
registration flow and confirmed via a full register → login → fetch
chain), the full OTP registration cycle (wrong domain rejected, wrong
code rejected, correct code creates the account, a consumed code can't
be replayed), the complete forgot-password/reset cycle, the Super
Admin's any-email student creation bypassing the OTP flow, the
teacher's student-scoped assignment picker, notes/hint written by a
teacher showing up correctly on the student's dashboard card, the AI
chat's per-problem eligibility (including the 403 when a student tries
an `assignment_id` their teacher didn't approve), the Data Center's
create/download/purge cycle, and the Super Admin's teacher-credential
editing (confirmed wrong-password rejection and a successful edit both
work), the LeetCode score badge and leaderboard column (tested with no
LeetCode username set, correctly shows zero rather than erroring), the
online-count endpoint, section deletion (both the empty-section-succeeds
and occupied-section-rejected cases), and the notification bell
end-to-end (a teacher creating an assignment correctly generates a
notification, it shows up unread with a badge count, and marking it
read persists).

`src/components/NotificationBell.tsx` polls
`GET /api/students/me/notifications` every 30 seconds — not a
websocket/push system, just polling, which is a reasonable tradeoff
for this scale rather than standing up a whole real-time subsystem.
Unread count badge, dropdown list, mark-one-read and mark-all-read,
click-outside-to-close.
