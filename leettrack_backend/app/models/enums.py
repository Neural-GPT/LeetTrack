import enum


class Role(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    super_admin = "super_admin"


class Difficulty(str, enum.Enum):
    easy = "Easy"
    medium = "Medium"
    hard = "Hard"


class AssignmentScope(str, enum.Enum):
    batch = "batch"
    section = "section"
    students = "students"


class SubmissionStatus(str, enum.Enum):
    not_started = "not_started"
    attempted = "attempted"
    accepted = "accepted"
    missed = "missed"


class ContestAttemptStatus(str, enum.Enum):
    in_progress = "in_progress"
    submitted = "submitted"  # code in, AI grading not finished yet
    graded = "graded"
    expired = "expired"  # timer ran out with no submission


class CustomSubmissionStatus(str, enum.Enum):
    not_started = "not_started"
    submitted = "submitted"
    graded = "graded"


class Theme(str, enum.Enum):
    light = "light"
    dark = "dark"
    amoled = "amoled"


class ArchiveStatus(str, enum.Enum):
    pending = "pending"
    downloaded = "downloaded"
    purged = "purged"


class OtpPurpose(str, enum.Enum):
    registration = "registration"
    password_reset = "password_reset"
