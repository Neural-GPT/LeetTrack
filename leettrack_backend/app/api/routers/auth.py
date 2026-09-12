from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.config import settings
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.db.session import get_db
from app.models.enums import OtpPurpose, Role
from app.models.user import Section, StudentProfile, TeacherProfile, User
from app.schemas.auth import (
    AdminStudentCreate,
    ForgotPasswordRequest,
    LoginRequest,
    OtpRequestResponse,
    RefreshRequest,
    ResetPasswordRequest,
    StudentOtpRequest,
    StudentOtpVerify,
    TeacherRegister,
    TokenPair,
)
from app.services.assignment_targeting import backfill_submissions_for_new_student
from app.services.activity_log import log_event
from app.services.otp import create_and_send_otp, verify_otp

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _issue_tokens(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(str(user.id), user.role.value, "access"),
        refresh_token=create_token(str(user.id), user.role.value, "refresh"),
        role=user.role,
    )


def _is_college_email(email: str) -> bool:
    return email.lower().endswith(f"@{settings.STUDENT_EMAIL_DOMAIN.lower()}")


# --- Student self-registration (OTP-gated to the college domain) ----------


@router.post("/register/student/request-otp", response_model=OtpRequestResponse)
def request_student_otp(payload: StudentOtpRequest, db: Session = Depends(get_db)):
    if not _is_college_email(payload.email):
        raise HTTPException(
            400, f"Registration needs a @{settings.STUDENT_EMAIL_DOMAIN} email address."
        )
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(400, "That email's already registered.")

    if payload.section_id is not None and not db.get(Section, payload.section_id):
        raise HTTPException(400, "That section doesn't exist.")

    dev_otp = create_and_send_otp(
        db,
        payload.email,
        OtpPurpose.registration,
        payload={
            "full_name": payload.full_name,
            "password_hash": hash_password(payload.password),
            "section_id": payload.section_id,
        },
        subject="Your LeetTrack registration code",
    )
    return OtpRequestResponse(
        message=f"Code sent to {payload.email}.", dev_otp=dev_otp
    )


@router.post("/register/student/verify-otp", response_model=TokenPair, status_code=201)
def verify_student_otp(payload: StudentOtpVerify, db: Session = Depends(get_db)):
    result = verify_otp(db, payload.email, payload.otp, OtpPurpose.registration)
    if result is None:
        raise HTTPException(400, "That code's incorrect or expired.")

    # Re-check — someone could've registered with this email between the
    # OTP request and now (two tabs, a slow verify, etc).
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(400, "That email's already registered.")

    user = User(
        email=payload.email,
        username=payload.email,  # email doubles as username — one account per college mail
        password_hash=result["password_hash"],
        role=Role.student,
    )
    db.add(user)
    db.flush()

    db.add(StudentProfile(
        user_id=user.id, full_name=result["full_name"], section_id=result.get("section_id"),
    ))
    db.flush()

    backfill_submissions_for_new_student(db, user.id, section_id=result.get("section_id"))

    db.commit()
    db.refresh(user)
    log_event(db, user.id, "registration", meta={"section_id": result.get("section_id")})
    return _issue_tokens(user)


# --- Forgot password (works for any role, not just students) --------------


@router.post("/forgot-password", response_model=OtpRequestResponse)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email))
    # Same response whether or not the email exists — don't leak which
    # emails are registered.
    if not user:
        return OtpRequestResponse(message="If that email exists, a code was sent.")

    dev_otp = create_and_send_otp(
        db,
        payload.email,
        OtpPurpose.password_reset,
        subject="Reset your LeetTrack password",
    )
    return OtpRequestResponse(
        message="If that email exists, a code was sent.", dev_otp=dev_otp
    )


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    result = verify_otp(db, payload.email, payload.otp, OtpPurpose.password_reset)
    if result is None:
        raise HTTPException(400, "That code's incorrect or expired.")

    user = db.scalar(select(User).where(User.email == payload.email))
    if not user:
        raise HTTPException(404, "No account with that email.")

    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"message": "Password updated: log in with your new password."}


# --- Super Admin: create a student directly (any email, no OTP) -----------


@router.post("/admin/create-student", response_model=TokenPair, status_code=201)
def admin_create_student(
    payload: AdminStudentCreate,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(400, "That email's already registered.")

    user = User(
        email=payload.email,
        username=payload.email,
        password_hash=hash_password(payload.password),
        role=Role.student,
    )
    db.add(user)
    db.flush()

    db.add(
        StudentProfile(
            user_id=user.id, full_name=payload.full_name, section_id=payload.section_id
        )
    )
    db.flush()

    backfill_submissions_for_new_student(db, user.id, payload.section_id)

    db.commit()
    db.refresh(user)
    return _issue_tokens(user)


# --- Teacher accounts (Super Admin provisioned only) -----------------------


class TeacherCreated(BaseModel):
    username: str
    email: str
    message: str = "Teacher account created. Share the credentials with them directly."


@router.post("/create-teacher", response_model=TeacherCreated, status_code=201)
def create_teacher(
    payload: TeacherRegister,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(400, "That email's already registered.")
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(400, "That username's taken. Try another.")

    user = User(
        email=payload.email,
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=Role.teacher,
    )
    db.add(user)
    db.flush()
    db.add(TeacherProfile(user_id=user.id, full_name=payload.full_name))
    db.commit()

    return TeacherCreated(username=user.username, email=user.email)


# --- Login / refresh --------------------------------------------------------


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(
        select(User).where(
            (User.username == payload.username_or_email)
            | (User.email == payload.username_or_email)
        )
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated.")

    log_event(db, user.id, "login")
    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    data = decode_token(payload.refresh_token)
    if not data or data.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token.")

    user = db.get(User, int(data["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token.")

    return _issue_tokens(user)
