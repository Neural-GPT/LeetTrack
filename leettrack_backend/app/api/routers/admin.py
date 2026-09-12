from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models.assignment import Assignment, AssignmentTarget
from app.models.enums import Role, SubmissionStatus
from app.models.submission import Submission
from app.models.system import AIInteractionLog, BroadcastMessage, Feedback, Notification, ActivityEvent
from app.models.user import Section, StudentProfile, TeacherProfile, User
from app.services.activity_log import log_event
from app.services.notifications import send_broadcast

router = APIRouter(prefix="/api/admin", tags=["admin"])


class TeacherOut(BaseModel):
    user_id: int
    full_name: str
    username: str
    email: str
    is_active: bool

    model_config = {"from_attributes": True}


@router.get("/teachers", response_model=list[TeacherOut])
def list_teachers(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    profiles = db.scalars(select(TeacherProfile).order_by(TeacherProfile.full_name)).all()
    return [
        TeacherOut(
            user_id=p.user_id,
            full_name=p.full_name,
            username=p.user.username,
            email=p.user.email,
            is_active=p.user.is_active,
        )
        for p in profiles
    ]


class StudentOut(BaseModel):
    user_id: int
    full_name: str
    email: str
    section_id: int | None
    section_name: str | None
    is_active: bool
    github_username: str | None

    model_config = {"from_attributes": True}


@router.get("/students", response_model=list[StudentOut])
def list_students(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    profiles = db.scalars(select(StudentProfile).order_by(StudentProfile.full_name)).all()
    return [
        StudentOut(
            user_id=p.user_id,
            full_name=p.full_name,
            email=p.user.email,
            section_id=p.section_id,
            section_name=p.section.name if p.section else None,
            is_active=p.user.is_active,
            github_username=p.github_username or None,
        )
        for p in profiles
    ]


# Online-presence window shared with GET /api/students/online-count —
# "online" = touched an authenticated endpoint in the last 5 minutes
# (see api/deps.py's last_seen_at throttle). Not real presence, same
# caveat as that endpoint.
ONLINE_WINDOW = timedelta(minutes=5)


class OnlineTeacherOut(BaseModel):
    user_id: int
    full_name: str


class OnlineStudentOut(BaseModel):
    user_id: int
    full_name: str
    section_name: str | None


class OnlineUsersOut(BaseModel):
    # student_count matches GET /api/students/online-count exactly, kept
    # for backwards compatibility with anything still reading the plain
    # number. online_students carries the same window but with names (and
    # section) attached, same as online_teachers below, so a Super Admin
    # can see exactly who's online rather than just how many. Neither
    # list is folded into the public "online" pill everyone else sees —
    # that stays a plain student-activity count.
    student_count: int
    online_students: list[OnlineStudentOut]
    online_teachers: list[OnlineTeacherOut]


@router.get("/online-users", response_model=OnlineUsersOut)
def get_online_users(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Powers the expanded view behind the "online" pill when a Super
    Admin clicks it — everyone else just sees the plain student count
    (GET /api/students/online-count). This is the only place individual
    student/teacher online status is ever exposed.
    """
    window_start = (datetime.now(timezone.utc) - ONLINE_WINDOW).replace(tzinfo=None)

    online_student_profiles = db.scalars(
        select(StudentProfile)
        .join(User, User.id == StudentProfile.user_id)
        .where(
            User.last_seen_at.isnot(None),
            User.last_seen_at >= window_start,
        )
        .order_by(StudentProfile.full_name)
    ).all()

    online_teacher_profiles = db.scalars(
        select(TeacherProfile)
        .join(User, User.id == TeacherProfile.user_id)
        .where(
            User.last_seen_at.isnot(None),
            User.last_seen_at >= window_start,
        )
        .order_by(TeacherProfile.full_name)
    ).all()

    return OnlineUsersOut(
        student_count=len(online_student_profiles),
        online_students=[
            OnlineStudentOut(
                user_id=p.user_id,
                full_name=p.full_name,
                section_name=p.section.name if p.section else None,
            )
            for p in online_student_profiles
        ],
        online_teachers=[
            OnlineTeacherOut(user_id=p.user_id, full_name=p.full_name)
            for p in online_teacher_profiles
        ],
    )


class TeacherCredentialsUpdate(BaseModel):
    admin_password: str
    new_username: str | None = None
    new_password: str | None = None


@router.patch("/teachers/{user_id}/credentials", response_model=TeacherOut)
def update_teacher_credentials(
    user_id: int,
    payload: TeacherCredentialsUpdate,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Requires the Super Admin's own current password as confirmation
    before touching a teacher's login — this is a sensitive action
    (it changes who can log into that account), so it isn't gated by
    session auth alone.
    """
    if not verify_password(payload.admin_password, admin.password_hash):
        raise HTTPException(403, "That's not your current password.")

    teacher_user = db.get(User, user_id)
    if not teacher_user or teacher_user.role != Role.teacher:
        raise HTTPException(404, "Teacher not found.")

    if payload.new_username:
        existing = db.scalar(
            select(User).where(
                User.username == payload.new_username, User.id != user_id
            )
        )
        if existing:
            raise HTTPException(400, "That username's taken.")
        teacher_user.username = payload.new_username

    if payload.new_password:
        if len(payload.new_password) < 8:
            raise HTTPException(400, "New password needs to be at least 8 characters.")
        teacher_user.password_hash = hash_password(payload.new_password)

    db.commit()

    profile = db.scalar(select(TeacherProfile).where(TeacherProfile.user_id == user_id))
    return TeacherOut(
        user_id=teacher_user.id,
        full_name=profile.full_name if profile else "",
        username=teacher_user.username,
        email=teacher_user.email,
    )


class DeleteUserRequest(BaseModel):
    admin_password: str


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    payload: DeleteUserRequest,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Permanently deletes a student or teacher account. Requires the
    Super Admin's own current password, same pattern as editing
    credentials — this is destructive and irreversible.

    Students: cascades to their submissions, notifications, AI usage
    logs, and any explicit assignment-target rows, then the profile and
    account. This does NOT touch other students' scores or the
    assignments themselves.

    Teachers: refused if they still have assignments — those carry
    other students' submissions and scores, so cascading a teacher
    delete through them would be far more destructive than deleting a
    student. Delete or reassign their assignments first (existing
    DELETE /api/assignments/{id} endpoint).

    Super Admin accounts can't be deleted through this endpoint at all,
    including your own.
    """
    if not verify_password(payload.admin_password, admin.password_hash):
        raise HTTPException(403, "That's not your current password.")

    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found.")

    if target.role == Role.super_admin:
        raise HTTPException(400, "Super Admin accounts can't be deleted here.")

    if target.role == Role.teacher:
        has_assignments = db.scalar(
            select(Assignment).where(Assignment.teacher_id == target.id)
        )
        if has_assignments:
            raise HTTPException(
                400,
                "This teacher still has assignments: delete or reassign those first.",
            )
        _clear_user_references(db, target.id)
        db.delete(target)  # TeacherProfile cascades via the relationship
        db.commit()
        return

    # Student: clear out everything that references them directly —
    # these don't cascade automatically since they're not modeled as
    # owned child relationships on User.
    db.query(Submission).filter(Submission.student_id == target.id).delete(
        synchronize_session=False
    )
    db.query(AssignmentTarget).filter(AssignmentTarget.student_id == target.id).delete(
        synchronize_session=False
    )
    db.query(AIInteractionLog).filter(AIInteractionLog.student_id == target.id).delete(
        synchronize_session=False
    )
    _clear_user_references(db, target.id)
    db.delete(target)  # StudentProfile cascades via the relationship
    db.commit()


def _clear_user_references(db: Session, user_id: int) -> None:
    """
    Shared cleanup for anything hanging off `users.id` that isn't
    modeled as a cascading relationship. This is what was previously
    missing for Feedback and ActivityEvent rows — on SQLite (dev) that
    silently left orphaned rows, but on Postgres (prod) it throws a
    ForeignKeyViolation and the whole delete fails, which is why
    admin-created student accounts (the ones actually exercised in
    testing — e.g. after submitting feedback) couldn't be deleted.
    """
    db.query(Feedback).filter(Feedback.user_id == user_id).delete(synchronize_session=False)
    db.query(Notification).filter(Notification.user_id == user_id).delete(
        synchronize_session=False
    )
    db.query(ActivityEvent).filter(ActivityEvent.user_id == user_id).delete(
        synchronize_session=False
    )
    # Broadcast audit rows: keep the historical record, just drop the
    # dangling reference to a now-deleted specific-user target.
    db.query(BroadcastMessage).filter(BroadcastMessage.target_user_id == user_id).update(
        {"target_user_id": None}, synchronize_session=False
    )


# --- Super Admin broadcast messages ----------------------------------------


class BroadcastCreate(BaseModel):
    message: str
    target_type: str  # "all" | "students" | "teachers" | "user"
    target_user_id: int | None = None


class BroadcastOut(BaseModel):
    id: int
    target_type: str
    target_user_id: int | None
    message: str
    recipient_count: int
    created_at: str


@router.post("/broadcast", response_model=BroadcastOut, status_code=201)
def send_broadcast_message(
    payload: BroadcastCreate,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    if payload.target_type not in ("all", "students", "teachers", "user"):
        raise HTTPException(400, "target_type must be one of: all, students, teachers, user.")
    if not payload.message.strip():
        raise HTTPException(400, "Message can't be empty.")
    if payload.target_type == "user" and not payload.target_user_id:
        raise HTTPException(400, "target_user_id is required when target_type is 'user'.")
    if payload.target_user_id and not db.get(User, payload.target_user_id):
        raise HTTPException(404, "That user doesn't exist.")

    record = send_broadcast(
        db, admin.id, payload.target_type, payload.message.strip(), payload.target_user_id
    )
    return BroadcastOut(
        id=record.id,
        target_type=record.target_type,
        target_user_id=record.target_user_id,
        message=record.message,
        recipient_count=record.recipient_count,
        created_at=record.created_at.isoformat(),
    )


@router.get("/broadcast", response_model=list[BroadcastOut])
def list_broadcast_messages(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Send history/audit log — most recent first."""
    rows = db.scalars(
        select(BroadcastMessage).order_by(BroadcastMessage.created_at.desc()).limit(100)
    ).all()
    return [
        BroadcastOut(
            id=r.id, target_type=r.target_type, target_user_id=r.target_user_id,
            message=r.message, recipient_count=r.recipient_count,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


# --- Super Admin "super powers" --------------------------------------------
#
# A focused set of overrides that only the Super Admin can reach — the
# rest of the site (student/teacher dashboards, scoring, LeetCode
# verification) still runs entirely on its own automatic logic; these
# are explicit, logged exceptions to that, not a general bypass.


class StudentProfileOverride(BaseModel):
    full_name: str | None = None
    leetcode_username: str | None = None
    section_id: int | None = None


@router.patch("/students/{user_id}/profile")
def override_student_profile(
    user_id: int,
    payload: StudentProfileOverride,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Same fields a student can edit from Settings, but the Super Admin
    can touch them any day of the week (not just weekends) and can
    also reassign a student's section — something students can't do
    themselves.
    """
    profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user_id))
    if not profile:
        raise HTTPException(404, "Student not found.")

    updates = payload.model_dump(exclude_unset=True)
    if "leetcode_username" in updates and updates["leetcode_username"]:
        taken = db.scalar(
            select(StudentProfile).where(
                StudentProfile.leetcode_username == updates["leetcode_username"],
                StudentProfile.user_id != user_id,
            )
        )
        if taken:
            raise HTTPException(400, "That LeetCode username is already linked to another account.")
    if "section_id" in updates and updates["section_id"] is not None:
        if not db.get(Section, updates["section_id"]):
            raise HTTPException(400, "That section doesn't exist.")

    for field, value in updates.items():
        setattr(profile, field, value)
    db.commit()
    log_event(db, admin.id, "admin_profile_override", meta={"student_id": user_id, **updates})
    return {"updated": True}


class UserStatusUpdate(BaseModel):
    is_active: bool


@router.patch("/users/{user_id}/status")
def set_user_active_status(
    user_id: int,
    payload: UserStatusUpdate,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Suspend/reactivate a login without deleting the account or its data."""
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found.")
    if target.role == Role.super_admin:
        raise HTTPException(400, "Super Admin accounts can't be suspended here.")

    target.is_active = payload.is_active
    db.commit()
    log_event(
        db, admin.id, "admin_status_override",
        meta={"target_user_id": user_id, "is_active": payload.is_active},
    )
    return {"user_id": user_id, "is_active": target.is_active}


@router.post("/students/{user_id}/reset-streak")
def reset_student_streak(
    user_id: int,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user_id))
    if not profile:
        raise HTTPException(404, "Student not found.")
    profile.current_streak = 0
    db.commit()
    log_event(db, admin.id, "admin_streak_reset", meta={"student_id": user_id})
    return {"updated": True}


class SubmissionOverride(BaseModel):
    score: float | None = None
    status: str | None = None


class StudentSubmissionOut(BaseModel):
    """
    Powers the Super Admin's submission picker — lets them find the
    right submission by problem name/status instead of having to know
    the raw submission ID ahead of time.
    """

    submission_id: int
    assignment_id: int
    problem_title: str
    difficulty: str
    status: str
    score: float
    total_attempts: int


@router.get("/students/{user_id}/submissions", response_model=list[StudentSubmissionOut])
def list_student_submissions(
    user_id: int,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    submissions = db.scalars(
        select(Submission)
        .where(Submission.student_id == user_id)
        .order_by(Submission.id.desc())
    ).all()
    return [
        StudentSubmissionOut(
            submission_id=s.id,
            assignment_id=s.assignment_id,
            problem_title=s.assignment.problem.title,
            difficulty=s.assignment.problem.difficulty.value,
            status=s.status.value,
            score=s.score,
            total_attempts=s.total_attempts,
        )
        for s in submissions
    ]


@router.patch("/submissions/{submission_id}/override")
def override_submission(
    submission_id: int,
    payload: SubmissionOverride,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Manually correct a submission's score/status — e.g. LeetCode's
    unofficial API returned something wrong, or a special case the
    automatic scoring formula doesn't handle fairly. Every override is
    logged (see ActivityEvent) with the before/after values.
    """
    submission = db.get(Submission, submission_id)
    if not submission:
        raise HTTPException(404, "Submission not found.")

    before = {"score": submission.score, "status": submission.status.value}
    if payload.score is not None:
        submission.score = payload.score
    if payload.status is not None:
        try:
            submission.status = SubmissionStatus(payload.status)
        except ValueError:
            raise HTTPException(400, f"Invalid status: {payload.status}")

    db.commit()
    log_event(
        db, admin.id, "admin_submission_override",
        meta={"submission_id": submission_id, "before": before,
              "after": {"score": submission.score, "status": submission.status.value}},
    )
    return {"updated": True}
