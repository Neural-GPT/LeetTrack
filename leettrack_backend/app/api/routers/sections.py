from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.enums import Role
from app.models.user import Section, StudentProfile, User

router = APIRouter(prefix="/api/sections", tags=["sections"])


class SectionOut(BaseModel):
    id: int
    name: str
    year: str
    department: str

    model_config = {"from_attributes": True}


class SectionCreate(BaseModel):
    name: str
    year: str = ""
    department: str = "BCA"


@router.get("", response_model=list[SectionOut])
def list_sections(db: Session = Depends(get_db)):
    """Public — needed for the student registration form's section dropdown."""
    return db.scalars(select(Section).order_by(Section.name)).all()


@router.post("", response_model=SectionOut, status_code=201)
def create_section(
    payload: SectionCreate,
    admin: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    section = Section(name=payload.name, year=payload.year, department=payload.department)
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


@router.delete("/{section_id}", status_code=204)
def delete_section(
    section_id: int,
    admin: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Refuses to delete a section that still has students in it, or
    assignments scoped to it — better to make the teacher explicitly
    reassign/clean those up than silently orphan the data (or worse,
    cascade-delete a bunch of student submissions nobody asked to lose).
    """
    section = db.get(Section, section_id)
    if not section:
        raise HTTPException(404, "Section not found.")

    student_count = db.scalar(
        select(StudentProfile).where(StudentProfile.section_id == section_id)
    )
    if student_count:
        raise HTTPException(
            400,
            "This section still has students in it: reassign or remove them first.",
        )

    assignment_count = db.scalar(
        select(Assignment).where(Assignment.section_id == section_id)
    )
    if assignment_count:
        raise HTTPException(
            400,
            "This section still has assignments scoped to it: delete those first.",
        )

    db.delete(section)
    db.commit()
