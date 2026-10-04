# LeetTrack

A platform where teachers assign LeetCode problems to sections, students build streaks by solving them, and live leaderboards keep track of ranking. 

```text
Frontend: Next.js, Tailwind, TypeScript
Backend: FastAPI, Celery, Redis
Database: PostgreSQL
```


<img width="1865" height="951" alt="dashboard image" src="https://github.com/user-attachments/assets/9d8fe576-20da-48d6-bf80-bf41e65889b1" />
Student's dashboard<br><br>


You can visit the website at <a href="https://leettrack-cyan.vercel.app">https://leettrack-cyan.vercel.app/</a><br>
Login as a test student using these credentials:
```text
email: test@gmail.com
password: wB6Wpx6yNtz4XXh
```
---

## Features

1. Email OTP based authorization
2. Optimized and responsive website
3. Github and LeetCode user id integration [adding support for GFG, HackerRank as well as well custom DSA questions]
4. Student performance and wekaness analysis
5. Achievements and Leaderboard for class wise competition
6. Public Chat support
7. AI helper chatbot [for hints only] <br>

   <img width="1871" height="927" alt="image" src="https://github.com/user-attachments/assets/2f0b862c-b32e-4e3e-a829-f86a54050f1a" />

---

## Repository Structure

```text
leettrack/
  ├── leettrack_frontend/   # Next.js 16 + TypeScript + Tailwind v4
  └── leettrack_backend/    # FastAPI + SQLAlchemy + Celery
```

Both directories contain their own `README.md` files:
- `leettrack_backend/README.md`: Covers auth flows, database models, the scoring engine, NVIDIA AI integration, and Celery setup.
- `leettrack_frontend/README.md`: Covers components, custom theming, and page routes.

