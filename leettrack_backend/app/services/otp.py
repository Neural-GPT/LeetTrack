"""
OTP generation/verification, shared by student registration (college
email confirmation) and forgot-password. Codes are 6 digits, bcrypt-
hashed at rest, single-use, and expire after settings.OTP_EXPIRE_MINUTES.
"""

import json
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.models.enums import OtpPurpose
from app.models.system import OtpCode
from app.services.email import is_email_configured, send_email


def _generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def create_and_send_otp(
    db: Session,
    email: str,
    purpose: OtpPurpose,
    payload: dict | None = None,
    subject: str = "Your LeetTrack verification code",
) -> str | None:
    """
    Creates an OTP row and emails it. Returns the raw code ONLY when SMTP
    isn't configured (dev-mode convenience — see services/email.py) so
    the caller can surface it in the API response; returns None
    otherwise, since the code should only ever exist in the sent email.
    """
    code = _generate_code()

    db.add(
        OtpCode(
            email=email.lower(),
            otp_hash=hash_password(code),
            purpose=purpose,
            payload=json.dumps(payload) if payload else None,
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
        )
    )
    db.commit()

    body = (
    "VERIFY YOUR LEETTRACK ACCOUNT\n\n"
    "Hi there,\n\n"
    "Use the verification code below to complete your LeetTrack registration:\n\n"
    f"        {code}\n\n"
    f"This code will expire in {settings.OTP_EXPIRE_MINUTES} minutes.\n\n"
    "If you didn't request this code, you can safely ignore this email. "
    "Your account will remain secure.\n\n"
    "— The LeetTrack Team"
)
    send_email(email, subject, body)

    return None if is_email_configured() else code


def verify_otp(
    db: Session, email: str, code: str, purpose: OtpPurpose
) -> dict | None:
    """
    Returns the decoded payload dict (possibly empty {}) on success,
    None on failure. Marks the code consumed on success so it can't be
    replayed. Checks newest-first so a resend supersedes an older code
    rather than requiring the latest one specifically.
    """
    candidates = db.scalars(
        select(OtpCode)
        .where(
            OtpCode.email == email.lower(),
            OtpCode.purpose == purpose,
            OtpCode.consumed.is_(False),
            OtpCode.expires_at > datetime.now(timezone.utc),
        )
        .order_by(OtpCode.created_at.desc())
    ).all()

    for otp_row in candidates:
        if verify_password(code, otp_row.otp_hash):
            otp_row.consumed = True
            db.commit()
            return json.loads(otp_row.payload) if otp_row.payload else {}

    return None
