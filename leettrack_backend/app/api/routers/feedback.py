from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.enums import Role
from app.models.system import Feedback
from app.models.user import StudentProfile, TeacherProfile, User
from app.services.notifications import notify_feedback_submitted

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


def _display_name(db: Session, user: User) -> str:
    if user.role == Role.student:
        profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    else:
        profile = db.scalar(select(TeacherProfile).where(TeacherProfile.user_id == user.id))
    return profile.full_name if profile else user.username


class FeedbackCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class FeedbackCountOut(BaseModel):
    count: int


@router.post("", status_code=201)
def submit_feedback(
    payload: FeedbackCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Any logged-in role (student or teacher) can leave feedback."""
    if user.role not in (Role.student, Role.teacher):
        raise HTTPException(403, "Not available for this account type.")

    db.add(Feedback(user_id=user.id, role=user.role.value, message=payload.message.strip()))
    db.commit()
    # This was the actual bug being reported: feedback was saved but
    # never surfaced to the Super Admin's notification bell — only
    # visible if they happened to open the Feedback panel on /admin.
    notify_feedback_submitted(db, _display_name(db, user), user.role.value, payload.message.strip())
    return {"submitted": True}


@router.get("/count", response_model=FeedbackCountOut)
def feedback_count(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Super Admin only. Students/teachers see the "Feedback" pill (so they
    know where to send feedback) but never the number in it — only the
    Super Admin, who's the one actually reading the messages, does.
    """
    count = db.scalar(select(func.count(Feedback.id)))
    return FeedbackCountOut(count=count or 0)


class FeedbackOut(BaseModel):
    id: int
    role: str
    sender_name: str
    message: str
    created_at: str


@router.get("/all", response_model=list[FeedbackOut])
def list_feedback(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Super Admin only — this is where feedback actually gets read."""
    rows = db.scalars(select(Feedback).order_by(Feedback.created_at.desc())).all()
    out = []
    for f in rows:
        sender = db.get(User, f.user_id) if f.user_id else None
        name = _display_name(db, sender) if sender else "Deleted user"
        out.append(
            FeedbackOut(
                id=f.id, role=f.role, sender_name=name, message=f.message,
                created_at=f.created_at.isoformat(),
            )
        )
    return out
