from pydantic import BaseModel, EmailStr, Field

from app.models.enums import Role


class StudentOtpRequest(BaseModel):
    """Step 1 of self-registration — sends an OTP to a college email."""

    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8)
    # Classroom/section selector on the registration form. Optional —
    # a student who doesn't know their section yet (or whose section
    # isn't listed) can still register and pick it up later once a
    # teacher/Super Admin assigns them one.
    section_id: int | None = None


class StudentOtpVerify(BaseModel):
    """Step 2 — confirms the code, actually creates the account."""

    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)


class OtpRequestResponse(BaseModel):
    message: str
    # Only populated when SMTP isn't configured — see services/email.py.
    # Never present in a real deployment with SMTP set up.
    dev_otp: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=8)


class AdminStudentCreate(BaseModel):
    """Super Admin creating a student directly — no domain restriction, no OTP."""

    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8)
    section_id: int | None = None


class TeacherRegister(BaseModel):
    full_name: str
    email: EmailStr
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    username_or_email: str
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: Role


class RefreshRequest(BaseModel):
    refresh_token: str
