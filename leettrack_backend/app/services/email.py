"""
Email sending — tries the Gmail API first (if GMAIL_CLIENT_ID/
GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN are set), falls back to raw
SMTP (if SMTP_HOST is set), and if neither is configured, logs the
message instead of sending it. That dev-mode fallback is clearly
labeled wherever it's used (OTP flows surface the code directly in the
API response under `dev_otp` when nothing's configured) so
registration/reset stay testable without a real mail account.

Gmail API auth: sending as a specific address needs OAuth2, not just an
API key — see the GMAIL_* settings in core/config.py for how to get a
refresh token. This module exchanges that refresh token for a short-
lived access token on every send (no caching) since OTP emails are
infrequent enough that the extra round-trip doesn't matter.

NEVER hardcode a real client secret or refresh token in this file or in
.env.example — both belong in a gitignored .env locally and your
deployment platform's secret manager in production. A credential pasted
into a chat, screenshot, or committed file should be treated as
compromised and regenerated/revoked.
"""

import base64
import logging
import smtplib
from email.mime.text import MIMEText

import httpx

from app.core.config import settings

logger = logging.getLogger("leettrack.email")

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


def is_gmail_configured() -> bool:
    return bool(
        settings.GMAIL_CLIENT_ID
        and settings.GMAIL_CLIENT_SECRET
        and settings.GMAIL_REFRESH_TOKEN
        and settings.GMAIL_SENDER_EMAIL
    )


def is_smtp_configured() -> bool:
    return bool(settings.SMTP_HOST)


def is_email_configured() -> bool:
    return is_gmail_configured() or is_smtp_configured()


def _get_gmail_access_token() -> str:
    resp = httpx.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GMAIL_CLIENT_ID,
            "client_secret": settings.GMAIL_CLIENT_SECRET,
            "refresh_token": settings.GMAIL_REFRESH_TOKEN,
            "grant_type": "refresh_token",
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _send_via_gmail(to: str, subject: str, body: str) -> None:
    access_token = _get_gmail_access_token()

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = settings.GMAIL_SENDER_EMAIL
    msg["To"] = to

    # Gmail API wants the raw RFC 2822 message, base64url-encoded, no padding.
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode().rstrip("=")

    resp = httpx.post(
        GMAIL_SEND_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        json={"raw": raw},
        timeout=10.0,
    )
    resp.raise_for_status()


def _send_via_smtp(to: str, subject: str, body: str) -> None:
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
        if settings.SMTP_USE_TLS:
            server.starttls()
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.send_message(msg)


def send_email(to: str, subject: str, body: str) -> None:
    if is_gmail_configured():
        _send_via_gmail(to, subject, body)
        return

    if is_smtp_configured():
        _send_via_smtp(to, subject, body)
        return

    logger.warning(
        "No email backend configured (Gmail API/SMTP) — email not sent. "
        "To=%s Subject=%s Body=%s",
        to,
        subject,
        body,
    )
