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
