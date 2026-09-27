"""
Turns a student's Submission history into topic-tag statistics — the
DSA skills graph, weak-skill list, and weekly performance trend shown
on the student /skills page, plus the problem-picking logic for the
Contest Simulator.

Tag data comes from Problem.tags (comma-separated, set by whichever
teacher created the problem when assigning it) — there's no separate
canonical taxonomy in this app, so a tag is only as clean as the
teacher who typed it. Stats are scoped to *assigned* submissions only
(this app has no general problem browser), which means a brand-new
student or a class that only assigns a couple of topics will have thin
data; every function here is written to degrade gracefully (small
sample sizes are flagged, not hidden) rather than pretend otherwise.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.assignment import Assignment, Problem
from app.models.enums import SubmissionStatus
from app.models.submission import Submission

# Below this many attempted submissions for a tag, we don't have enough
# signal to call it a real weakness — just "not enough data yet".
MIN_SAMPLES_FOR_CONFIDENCE = 3
WEEKLY_TREND_WEEKS = 8


@dataclass
class TagStat:
    tag: str
    attempted: int = 0
    accepted: int = 0
    total_attempts_sum: int = 0
    total_score: float = 0.0

    @property
    def completion_rate(self) -> float:
        return round(100 * self.accepted / self.attempted, 1) if self.attempted else 0.0

    @property
    def avg_attempts(self) -> float:
        return round(self.total_attempts_sum / self.attempted, 1) if self.attempted else 0.0

    @property
    def avg_score(self) -> float:
        return round(self.total_score / self.accepted, 1) if self.accepted else 0.0

    @property
    def sample_size_ok(self) -> bool:
        return self.attempted >= MIN_SAMPLES_FOR_CONFIDENCE

    @property
    def mastery(self) -> float:
        """
        0-100 "how solid is this student on this tag" score for the
        skills graph. Completion rate carries most of the weight;
        avg_attempts (more attempts before AC = shakier) pulls it down
        a little. Deliberately simple and explainable over a "smarter"
        opaque formula — a teacher or student should be able to look
        at the two numbers and see roughly where 'mastery' came from.
        """
        if not self.attempted:
            return 0.0
        attempts_penalty = min(20.0, max(0.0, (self.avg_attempts - 1) * 8))
        return round(max(0.0, min(100.0, self.completion_rate - attempts_penalty)), 1)


def _student_submissions_with_problems(db: Session, student_id: int) -> list[Submission]:
    return list(
        db.scalars(
            select(Submission)
            .join(Assignment, Submission.assignment_id == Assignment.id)
            .where(
                Submission.student_id == student_id,
                Submission.status != SubmissionStatus.not_started,
            )
        ).all()
    )


def compute_skill_graph(db: Session, student_id: int) -> list[TagStat]:
    """One TagStat per topic tag this student has ever been assigned,
    sorted by mastery ascending (weakest first) — callers that want a
    radar chart's natural order can re-sort by tag name themselves."""
    subs = _student_submissions_with_problems(db, student_id)

    stats: dict[str, TagStat] = {}
    for s in subs:
        problem: Problem = s.assignment.problem
        for raw_tag in problem.tags.split(","):
            tag = raw_tag.strip()
            if not tag:
                continue
            row = stats.setdefault(tag, TagStat(tag=tag))
            row.attempted += 1
            row.total_attempts_sum += s.total_attempts or 1
            if s.status == SubmissionStatus.accepted:
                row.accepted += 1
                row.total_score += s.score

    return sorted(stats.values(), key=lambda r: r.mastery)


def compute_weak_skills(db: Session, student_id: int, limit: int = 5) -> list[TagStat]:
    """Weakest tags with enough samples to be meaningful. If nothing
    clears the sample-size bar yet, falls back to whatever exists
    (still sorted weakest-first) so the page isn't just empty for a
    new student — the frontend is expected to show a "still building a
    picture of your skills" note when sample_size_ok is False."""
    graph = compute_skill_graph(db, student_id)
    confident = [t for t in graph if t.sample_size_ok]
    return (confident or graph)[:limit]


@dataclass
class WeeklyPoint:
    week_start: str  # ISO date
    solved: int
    avg_score: float


@dataclass
class PerformanceSummary:
    total_assigned: int
    total_accepted: int
    total_missed: int
    overall_completion_rate: float
    avg_score: float
    current_streak: int
    max_streak: int
    weekly_trend: list[WeeklyPoint] = field(default_factory=list)
    trend_direction: str = "flat"  # "improving" | "flat" | "slipping"


def compute_performance_summary(
    db: Session, student_id: int, current_streak: int, max_streak: int
) -> PerformanceSummary:
    subs = _student_submissions_with_problems(db, student_id)
    accepted = [s for s in subs if s.status == SubmissionStatus.accepted]
    missed = [s for s in subs if s.status == SubmissionStatus.missed]

    now = datetime.now(timezone.utc)
    week_buckets: dict[str, list[Submission]] = defaultdict(list)
    for s in accepted:
        graded = s.graded_at or s.accepted_at
        if not graded:
            continue
        if graded.tzinfo is None:
            graded = graded.replace(tzinfo=timezone.utc)
        weeks_ago = (now - graded).days // 7
        if weeks_ago >= WEEKLY_TREND_WEEKS:
            continue
        bucket_start = (now - timedelta(weeks=weeks_ago)).date().isoformat()
        week_buckets[bucket_start].append(s)

    weekly_trend = [
        WeeklyPoint(
            week_start=week,
            solved=len(rows),
            avg_score=round(sum(r.score for r in rows) / len(rows), 1) if rows else 0.0,
        )
        for week, rows in sorted(week_buckets.items())
    ]

    # Simple, explainable trend signal: compare the second half of the
    # tracked window to the first half, rather than a regression the
    # student would have no intuition for.
    trend_direction = "flat"
    if len(weekly_trend) >= 4:
        midpoint = len(weekly_trend) // 2
        first_half = sum(p.solved for p in weekly_trend[:midpoint])
        second_half = sum(p.solved for p in weekly_trend[midpoint:])
        if second_half > first_half * 1.2:
            trend_direction = "improving"
        elif second_half < first_half * 0.8:
            trend_direction = "slipping"

    return PerformanceSummary(
        total_assigned=len(subs),
        total_accepted=len(accepted),
        total_missed=len(missed),
        overall_completion_rate=round(100 * len(accepted) / len(subs), 1) if subs else 0.0,
        avg_score=round(sum(s.score for s in accepted) / len(accepted), 1) if accepted else 0.0,
        current_streak=current_streak,
        max_streak=max_streak,
        weekly_trend=weekly_trend,
        trend_direction=trend_direction,
    )


def pick_contest_problem(db: Session, student_id: int) -> tuple[Problem, str] | None:
    """
    Picks one problem for the Contest Simulator: from the student's
    weakest confident tag, prefer a problem they haven't already solved.
    Falls through progressively looser criteria — next-weakest tags,
    then any unsolved problem regardless of tag, then (last resort) any
    problem at all — rather than failing outright, since the problem
    pool here is only whatever teachers have used in assignments
    platform-wide (this app has no separate browsable problem bank).

    Returns (problem, skill_tag) or None if there are no problems in
    the system at all yet.
    """
    solved_problem_ids = {
        s.assignment.problem_id
        for s in _student_submissions_with_problems(db, student_id)
        if s.status == SubmissionStatus.accepted
    }

    all_problems = list(db.scalars(select(Problem)).all())
    if not all_problems:
        return None

    def problems_for_tag(tag: str) -> list[Problem]:
        return [p for p in all_problems if tag in [t.strip() for t in p.tags.split(",")]]

    weak_tags = [t.tag for t in compute_weak_skills(db, student_id, limit=len(all_problems) or 1)]

    for tag in weak_tags:
        candidates = [p for p in problems_for_tag(tag) if p.id not in solved_problem_ids]
        if candidates:
            return min(candidates, key=lambda p: p.id), tag

    # No weak-tag match unsolved — any unsolved problem, tagged with
    # whatever its own first tag is (still "targeted", just not from
    # the weak-skill list specifically).
    unsolved = [p for p in all_problems if p.id not in solved_problem_ids]
    if unsolved:
        p = min(unsolved, key=lambda p: p.id)
        tag = (p.tags.split(",")[0].strip() if p.tags else "general")
        return p, tag or "general"

    # Everything's been solved — let them redo the weakest tag's
    # problem anyway; still useful practice.
    if weak_tags:
        candidates = problems_for_tag(weak_tags[0])
        if candidates:
            p = min(candidates, key=lambda p: p.id)
            return p, weak_tags[0]

    p = all_problems[0]
    tag = p.tags.split(",")[0].strip() if p.tags else "general"
    return p, tag or "general"


def time_limit_for_difficulty(difficulty_value: str) -> int:
    """Seconds. Easy/Medium/Hard tiers, roughly matching real contest pacing."""
    return {"Easy": 20 * 60, "Medium": 35 * 60, "Hard": 50 * 60}.get(difficulty_value, 30 * 60)
