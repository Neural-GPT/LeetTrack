from app.models.analytics import DailyAnalytics  # noqa: F401
from app.models.assignment import Assignment, AssignmentTarget, Problem  # noqa: F401
from app.models.gamification import AchievementUnlock, WeeklyGoal  # noqa: F401
from app.models.poll import Poll, PollResult, PollVote  # noqa: F401
from app.models.submission import Submission  # noqa: F401
from app.models.system import (  # noqa: F401
    ActivityEvent,
    AIInteractionLog,
    BackgroundMedia,
    BroadcastMessage,
    DataArchiveBatch,
    Feedback,
    NvidiaApiKey,
    Notification,
    OtpCode,
    SiteSettings,
)
from app.models.user import Section, StudentProfile, TeacherProfile, User  # noqa: F401
