from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.system import Notification
from app.models.user import User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: int
    type: str
    message: str
    read: bool
    created_at: str
    meta: str | None = None

    model_config = {"from_attributes": True}


@router.get("/me", response_model=list[NotificationOut])
def my_notifications(
    unread_only: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Same shape as GET /api/students/me/notifications but open to any
    role — this is what the NotificationBell actually calls now, so
    teachers and the Super Admin get a working bell too (broadcasts and
    display-name-change alerts land here for them).
    """
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.read.is_(False))
    query = query.order_by(Notification.created_at.desc())

    return [
        NotificationOut(
            id=n.id, type=n.type, message=n.message, read=n.read,
            created_at=n.created_at.isoformat(), meta=n.meta,
        )
        for n in db.scalars(query).all()
    ]


@router.post("/me/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        return {"updated": False}
    notification.read = True
    db.commit()
    return {"updated": True}


@router.post("/me/read-all")
def mark_all_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    unread = db.scalars(
        select(Notification).where(
            Notification.user_id == user.id, Notification.read.is_(False)
        )
    ).all()
    for n in unread:
        n.read = True
    db.commit()
    return {"updated": len(unread)}
