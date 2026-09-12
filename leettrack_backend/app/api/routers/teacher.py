from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.assignment import Assignment, Problem
from app.models.enums import Role
from app.models.user import StudentProfile, User
from app.services.assignment_targeting import slug_from_leetcode_url
from app.services.leetcode_problem import fetch_problem_metadata

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

# A handful of easy, well-known LeetCode problems offered as a quick-pick
# dropdown on the assignment form, so a brand-new teacher can create their
# first assignment in one click instead of having to already know a
# LeetCode URL. Deliberately just 5 and all Easy — enough to get someone
# comfortable with the flow without asking them to make curriculum
# decisions on day one.
STARTER_PROBLEMS: list[dict] = [
    {
        "title": "Two Sum",
        "leetcode_url": "https://leetcode.com/problems/two-sum/",
        "difficulty": "Easy",
        "tags": ["Array", "Hash Table"],
    },
    {
        "title": "Valid Parentheses",
        "leetcode_url": "https://leetcode.com/problems/valid-parentheses/",
        "difficulty": "Easy",
        "tags": ["String", "Stack"],
    },
    {
        "title": "Merge Two Sorted Lists",
        "leetcode_url": "https://leetcode.com/problems/merge-two-sorted-lists/",
        "difficulty": "Easy",
        "tags": ["Linked List", "Recursion"],
    },
    {
        "title": "Best Time to Buy and Sell Stock",
        "leetcode_url": "https://leetcode.com/problems/best-time-to-buy-and-sell-stock/",
        "difficulty": "Easy",
        "tags": ["Array", "Dynamic Programming"],
    },
    {
        "title": "Valid Anagram",
        "leetcode_url": "https://leetcode.com/problems/valid-anagram/",
        "difficulty": "Easy",
        "tags": ["Hash Table", "String", "Sorting"],
    },
]


class StudentOut(BaseModel):
    user_id: int
    full_name: str
    section_id: int | None
    section_name: str | None
    leetcode_username: str | None

    model_config = {"from_attributes": True}


@router.get("/students", response_model=list[StudentOut])
def list_students(
    section_id: int | None = Query(None),
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Powers the assignment-creation student-picker (scope: 'students')."""
    query = select(StudentProfile)
    if section_id is not None:
        query = query.where(StudentProfile.section_id == section_id)

    profiles = db.scalars(query.order_by(StudentProfile.full_name)).all()
    return [
        StudentOut(
            user_id=p.user_id,
            full_name=p.full_name,
            section_id=p.section_id,
            section_name=p.section.name if p.section else None,
            leetcode_username=p.leetcode_username,
        )
        for p in profiles
    ]


class StarterProblemOut(BaseModel):
    title: str
    leetcode_url: str
    difficulty: str
    tags: list[str]


@router.get("/starter-problems", response_model=list[StarterProblemOut])
def list_starter_problems(
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    The assignment form's quick-pick dropdown. No separate "used" table —
    a starter problem simply stops appearing here once *this* teacher has
    ever created an assignment for it, checked by matching LeetCode slugs
    against their own assignment history. So each teacher sees all 5 the
    first time, watches the list shrink by one every time they use one,
    and once they've assigned all 5 the dropdown disappears from the form
    entirely — same manual link-paste flow every other teacher already
    uses, no onboarding scaffolding left behind.
    """
    used_slugs = {
        slug
        for (slug,) in db.execute(
            select(Problem.slug)
            .join(Assignment, Assignment.problem_id == Problem.id)
            .where(Assignment.teacher_id == teacher.id)
        ).all()
    }
    return [
        StarterProblemOut(**p)
        for p in STARTER_PROBLEMS
        if slug_from_leetcode_url(p["leetcode_url"]) not in used_slugs
    ]


class LeetCodeProblemInfoOut(BaseModel):
    title: str
    difficulty: str
    tags: list[str]


@router.get("/leetcode-problem-info", response_model=LeetCodeProblemInfoOut)
def leetcode_problem_info(
    url: str = Query(..., min_length=1),
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
):
    """
    Auto-fills the assignment-creation form: given a LeetCode problem
    URL, extracts the slug and fetches title/difficulty/tags straight
    from LeetCode, so the teacher doesn't set difficulty by hand
    (and can't accidentally mismatch it against the actual problem).
    """
    slug = slug_from_leetcode_url(url)
    if not slug:
        raise HTTPException(400, "That doesn't look like a LeetCode problem URL.")

    metadata = fetch_problem_metadata(slug)
    if not metadata:
        raise HTTPException(
            502, "Couldn't fetch that problem from LeetCode — check the link, or set difficulty manually."
        )

    return LeetCodeProblemInfoOut(
        title=metadata.title, difficulty=metadata.difficulty, tags=metadata.tags
    )
