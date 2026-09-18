# LeetTrack

A platform where teachers assign LeetCode problems to sections, students build streaks by solving them, and live leaderboards keep track of ranking. 

Built with a Next.js frontend and a FastAPI backend.

<!-- Placeholder: Hero / App Preview Screenshot -->
![App Preview](https://via.placeholder.com/1200x450?text=LeetTrack+Dashboard+Preview)

---

## Repository Structure

```text
leettrack/
  ├── leettrack_frontend/   # Next.js 16 (App Router) + TypeScript + Tailwind v4
  └── leettrack_backend/    # FastAPI + SQLAlchemy + Celery
```

Both subdirectories contain their own detailed `README.md` files:
- `leettrack_backend/README.md`: Covers auth flows, database models, the scoring engine, NVIDIA AI integration, and Celery setup.
- `leettrack_frontend/README.md`: Covers components, custom theming, and page routes.

---

## Quickstart (Local Dev)

1. **Start the backend** (Terminal 1):
   ```bash
   cd leettrack_backend
   python3 -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   cp .env.example .env
   uvicorn app.main:app --reload
   ```

2. **Start the frontend** (Terminal 2):
   ```bash
   cd leettrack_frontend
   cp .env.local.example .env.local
   npm install
   npm run dev
   ```

3. Open `http://localhost:3000` for the web app, or `http://localhost:8000/docs` for API documentation.

> **Note:** The backend uses SQLite out-of-the-box. OTP codes for registration/resets will print directly in the backend terminal logs under `dev_otp` if no email service is configured.

---

## Media & Backgrounds

Custom landing or dashboard backgrounds are managed via the admin UI:
1. Place your media files inside `leettrack_frontend/public/`.
2. Go to `/admin` → **Appearance** to register and activate them.

---

## Deployment Highlights

<!-- Placeholder: Architecture or Deployment Diagram -->
![Deployment Diagram](https://via.placeholder.com/800x200?text=Deployment+Flow)

- **Frontend**: Deploy to Vercel (or any Next.js host). Set `NEXT_PUBLIC_API_URL` to your live API.
- **Backend**: Deploy to Railway/Render/Docker host. Point `DATABASE_URL` to a PostgreSQL instance and add your frontend domain to `ALLOWED_ORIGINS`.
- **Database Schema**: Handled via `Base.metadata.create_all()` at startup. No manual migration scripts are required for standard table creation.