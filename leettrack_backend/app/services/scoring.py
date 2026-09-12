"""
Dynamic scoring engine — this is what the leaderboard calls "Assignment
Score".

Deliberately kept as pure functions over plain numbers (not ORM objects)
so the formula can be swapped, A/B tested, or exposed as a
teacher-editable config later without touching the rest of the app —
matches the spec's "modular and configurable" requirement.

Maps onto the requested factors as:
  - max marks (teacher-assigned)        -> P
  - attempts, inversely proportional    -> attempt_factor (see below)
  - time decay from when it was assigned -> time_factor + is_late
  - "time taken to write the last successful attempt" is NOT included —
    LeetCode's public API exposes submission *timestamps*, not session
    start times, so there's no way to derive how long someone spent
    writing the solution. Evaluated and deliberately left out rather
    than faked with a proxy metric.

Variables (matching the spec's notation):
  P  - teacher-assigned problem score (base weight)
  T  - minutes elapsed between assignment release and accepted submission
  A  - total submission attempts before acceptance
  X  - this student's 1-based position among everyone who solved it
  M  - total students who solved it (out of the assigned audience)
  deadline_minutes   - minutes from release to deadline (for lateness)
  is_late            - accepted after the deadline
  streak_days        - student's current daily streak at time of solve
"""

from dataclasses import dataclass
from math import exp


@dataclass
class ScoreInputs:
    P: float
    T: float
    A: int
    X: int
    M: int
    deadline_minutes: float
    is_late: bool
    streak_days: int = 0


# --- tunable coefficients -------------------------------------------------
# Pull these into DB-backed teacher config later; kept here for now so the
# whole formula is readable in one place.
SPEED_DECAY_HALFLIFE_MIN = 180       # score half-life for time-to-solve
ATTEMPT_PENALTY_PER_TRY = 0.04        # -4% per attempt beyond the first
FIRST_SOLVER_BONUS = 0.15             # +15% for X == 1
POSITION_BONUS_MAX = 0.10             # up to +10% scaled by 1 - X/M
LATE_PENALTY = 0.5                    # multiply score by this if late
STREAK_BONUS_PER_DAY = 0.01           # +1% per streak day
STREAK_BONUS_CAP = 0.20               # capped at +20%


def compute_submission_score(inp: ScoreInputs) -> float:
    """Returns the points awarded for a single accepted submission."""

    # 1. Time decay: faster solves score closer to full P, decaying
    #    exponentially towards a floor as T grows.
    time_factor = 0.5 + 0.5 * exp(-inp.T / SPEED_DECAY_HALFLIFE_MIN)

    # 2. Attempt penalty: each retry beyond the first shaves a bit off.
    attempt_factor = max(0.4, 1 - ATTEMPT_PENALTY_PER_TRY * max(0, inp.A - 1))

    # 3. Position bonus: first solver gets a flat bonus; everyone else
    #    gets a smaller bonus scaled by how early they were.
    if inp.M > 0 and inp.X == 1:
        position_bonus = FIRST_SOLVER_BONUS
    elif inp.M > 1:
        position_bonus = POSITION_BONUS_MAX * max(0, 1 - (inp.X - 1) / (inp.M - 1))
    else:
        position_bonus = 0.0

    # 4. Streak bonus, capped.
    streak_bonus = min(STREAK_BONUS_CAP, STREAK_BONUS_PER_DAY * inp.streak_days)

    score = inp.P * time_factor * attempt_factor * (1 + position_bonus + streak_bonus)

    # 5. Late penalty applied last, on top of everything else.
    if inp.is_late:
        score *= LATE_PENALTY

    # NOTE: deliberately NOT capped at P. P is the *base* marks a
    # teacher assigns to the question, not a hard ceiling — the bonus
    # terms above (first-solver, position, streak) are meant to let a
    # student score above P for strong performance (fast + few attempts
    # + early + on a streak). The frontend surfaces this explicitly next
    # to "max marks" so it doesn't read as a bug — see
    # dashboard/page.tsx and teacher/page.tsx's assignment-creation form.
    return round(score, 2)


def missed_assignment_penalty(problem_score: float) -> float:
    """Points deducted for a missed (unattempted, past-deadline) assignment."""
    return round(-0.25 * problem_score, 2)


@dataclass
class LeaderboardScore:
    student_id: int
    total_score: float
    problems_completed: int
    assignments_completed: int


def aggregate_leaderboard(entries: list[LeaderboardScore]) -> list[LeaderboardScore]:
    """Sorts by total_score desc; stable tie-break on problems_completed."""
    return sorted(
        entries, key=lambda e: (-e.total_score, -e.problems_completed)
    )
