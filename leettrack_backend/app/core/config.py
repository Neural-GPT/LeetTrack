from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    PROJECT_NAME: str = "LeetTrack API"
    ENV: str = "development"

    # Database — swap for your Postgres/Supabase/Neon URL in prod, e.g.
    # postgresql+psycopg://user:pass@host:5432/leettrack
    DATABASE_URL: str = "sqlite:///./leettrack.db"

    # Auth — no default on purpose: this repo is public, so a hardcoded
    # default here would be a real leaked secret. Generate one with:
    #   python -c "import secrets; print(secrets.token_urlsafe(64))"
    # and set it as JWT_SECRET in Render's env vars (and locally in .env).
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    # Data lifecycle (see docs/data-lifecycle.md)
    DATA_RETENTION_DAYS: int = 30

    # AI assistant — backed by NVIDIA's OpenAI-compatible NIM API
    # (build.nvidia.com). The model is fixed here, but API keys are
    # managed through the Super Admin UI (NvidiaApiKey table) instead
    # of .env, so multiple keys can be added/rotated without a redeploy.
    NVIDIA_MODEL: str = ""
    NVIDIA_API_URL: str = ""

    # External API endpoints — pulled out to env vars rather than
    # hardcoded so they're swappable without a code change (LeetCode
    # changing their GraphQL path, a proxy, etc.).
    LEETCODE_GRAPHQL_URL: str = "https://leetcode.com/graphql"

    # CORS — kept as a plain str (NOT list[str]) on purpose: pydantic-settings
    # auto-JSON-decodes list-typed fields at the env-source level, before any
    # validator runs, so a bare URL like 'https://a.com' crashes on import.
    # Accepts a bare URL, a comma-separated list, or a JSON array.
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    @property
    def cors_origins(self) -> list[str]:
        raw = self.ALLOWED_ORIGINS.strip()
        if raw.startswith("["):
            import json
            return json.loads(raw)
        return [origin.strip() for origin in raw.split(",") if origin.strip()]

    # Celery / background jobs
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"

    # Bootstrap Super Admin — created automatically on first startup if no
    # user with this username exists yet. Override these in .env for
    # anything beyond local dev; don't ship the defaults to production.
    # No password default on purpose — the old default here was a real
    # password committed to a public repo. Set SUPER_ADMIN_USERNAME/
    # SUPER_ADMIN_PASSWORD explicitly in Render's env vars (and locally
    # in .env, which stays gitignored). If an admin with this username
    # was already created using the old leaked password, changing this
    # env var alone won't rotate it — see chat for how to fix that.
    SUPER_ADMIN_USERNAME: str = ""
    SUPER_ADMIN_PASSWORD: str = ""
    SUPER_ADMIN_EMAIL: str = "owner@leettrack.local"

    # Student self-registration is gated to this email domain (OTP
    # verification confirms ownership) — Super Admin can still create
    # student accounts with any email, bypassing this.
    STUDENT_EMAIL_DOMAIN: str = "kit.ac.in"
    OTP_EXPIRE_MINUTES: int = 10

    # SMTP — if SMTP_HOST is blank, OTP emails aren't actually sent;
    # the code gets logged server-side instead (and returned in the API
    # response under `dev_otp`, clearly marked) so registration is still
    # testable without a real mail server. Fill these in for anything
    # beyond local dev.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "LeetTrack <no-reply@leettrack.local>"
    SMTP_USE_TLS: bool = True

    # Gmail API — preferred over raw SMTP when configured (checked first
    # in services/email.py). Sending as a specific Gmail address needs
    # OAuth2 (an API key alone can't send mail on your behalf). Run
    # scripts/gmail_oauth_setup.py once, locally (not on the server) —
    # it walks you through the Google Cloud Console setup, opens a
    # browser to log into the sending account, and prints these four
    # values for you to paste in.
    # NEVER commit real values here — this stays blank in .env.example.
    GMAIL_CLIENT_ID: str = ""
    GMAIL_CLIENT_SECRET: str = ""
    GMAIL_REFRESH_TOKEN: str = ""
    GMAIL_SENDER_EMAIL: str = ""


settings = Settings()
