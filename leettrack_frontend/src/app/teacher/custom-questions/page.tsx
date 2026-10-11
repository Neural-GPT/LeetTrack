"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import BackgroundVideo from "@/components/BackgroundVideo";
import RequireRole from "@/components/RequireRole";
import CodeEditor from "@/components/CodeEditor";
import { api, ApiError } from "@/lib/api";

type Section = { id: number; name: string; year: string; department: string };
type Student = { user_id: number; full_name: string; section_id: number | null; section_name: string | null };

type Question = {
  id: number;
  title: string;
  description: string;
  constraints: string;
  max_score: number;
  has_reference_solution: boolean;
  reference_language: string;
  deadline: string;
  created_at: string;
  target_count: number;
  submitted_count: number;
  graded_count: number;
};

type Submission = {
  id: number;
  student_id: number;
  student_name: string;
  code: string;
  language: string;
  submitted_at: string | null;
  status: string;
  ai_score: number | null;
  ai_feedback: string;
  ai_reviewed_at: string | null;
  manual_score: number | null;
  manual_feedback: string;
  graded_at: string | null;
};

type Notice = { kind: "ok" | "error"; text: string };

const LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "javascript", label: "JavaScript" },
];

const SCOPE_OPTIONS = [
  { value: "section", title: "A section", desc: "One class section" },
  { value: "students", title: "Specific students", desc: "Pick people by name" },
  { value: "batch", title: "Everyone", desc: "Every student on LeetTrack" },
] as const;

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";
const BTN_PRIMARY = `inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-brand-live text-[#0A0A0C] text-sm font-semibold transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`;
const BTN_GHOST = `inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl glass text-sm text-text-secondary transition hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function relativeDeadline(iso: string): { text: string; overdue: boolean } {
  const diffMs = new Date(iso).getTime() - Date.now();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const chunk = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  return { text: overdue ? `${chunk} overdue` : `due in ${chunk}`, overdue };
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function deadlineIn(days: number): string {
  return toLocalInput(new Date(Date.now() + days * 86_400_000));
}

function formatLocalDeadline(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "no deadline set";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const tone =
    notice.kind === "ok"
      ? "text-accepted bg-accepted/10 border-accepted/25"
      : "text-danger bg-danger/10 border-danger/25";
  return (
    <div role={notice.kind === "error" ? "alert" : "status"} className={`mb-6 flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <span>{notice.text}</span>
      <button onClick={onDismiss} className={`shrink-0 text-xs underline underline-offset-2 ${FOCUS_RING} rounded`}>
        Dismiss
      </button>
    </div>
  );
}

function FormSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-6 md:p-8">
      <h2 className="font-display font-semibold text-lg text-text-primary">{title}</h2>
      {hint && <p className="text-sm text-text-secondary mt-1.5 max-w-prose">{hint}</p>}
      <div className="mt-6 space-y-6">{children}</div>
    </section>
  );
}

function FormField({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text-primary mb-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-text-muted mt-2">{hint}</p>}
    </div>
  );
}

function CreateQuestionForm({ onCreated }: { onCreated: (q: Question) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [constraints, setConstraints] = useState("");
  const [maxScore, setMaxScore] = useState(20);
  const [scope, setScope] = useState<"batch" | "section" | "students">("section");
  const [sectionId, setSectionId] = useState<number | "">("");
  const [studentIds, setStudentIds] = useState<number[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [deadline, setDeadline] = useState(() => deadlineIn(3));
  const [referenceSolution, setReferenceSolution] = useState("");
  const [referenceLanguage, setReferenceLanguage] = useState("python");

  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<Section[]>("/api/sections").then(setSections).catch(() => setSections([]));
  }, []);

  useEffect(() => {
    if (scope !== "students") return;
    const query = sectionId ? `?section_id=${sectionId}` : "";
    api.get<Student[]>(`/api/teacher/students${query}`).then(setStudents).catch(() => setStudents([]));
  }, [scope, sectionId]);

  const visibleStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return q ? students.filter((s) => s.full_name.toLowerCase().includes(q)) : students;
  }, [students, studentSearch]);

  const sectionName = sections.find((s) => s.id === Number(sectionId))?.name;
  const scopeSummary =
    scope === "batch"
      ? "Everyone"
      : scope === "section"
      ? sectionName ?? "No section chosen yet"
      : studentIds.length === 0
      ? "No students picked yet"
      : `${studentIds.length} ${studentIds.length === 1 ? "student" : "students"} picked`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (scope === "section" && !sectionId) {
      setError("Choose a section for this question.");
      return;
    }
    if (scope === "students" && studentIds.length === 0) {
      setError("Pick at least one student.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.post<Question>("/api/custom-questions", {
        title,
        description,
        constraints,
        max_score: maxScore,
        reference_solution: referenceSolution,
        reference_language: referenceLanguage,
        scope,
        section_id: scope === "section" ? Number(sectionId) : null,
        student_ids: scope === "students" ? studentIds : [],
        assigned_date: new Date().toISOString(),
        deadline: new Date(deadline).toISOString(),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post the question. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-6 items-start">
      <div className="space-y-6">
        <FormSection
          title="The question"
          hint="This is what students read before they start writing code."
        >
          <div className="grid sm:grid-cols-[minmax(0,1fr)_9rem] gap-5">
            <FormField label="Title" htmlFor="cq-title">
              <input
                id="cq-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="field-control"
                placeholder="Implement a min-heap"
              />
            </FormField>
            <FormField label="Points" htmlFor="cq-points">
              <input
                id="cq-points"
                type="number"
                min={1}
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                required
                className="field-control"
              />
            </FormField>
          </div>

          <FormField label="Problem statement" htmlFor="cq-statement">
            <textarea
              id="cq-statement"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={8}
              className="field-control"
              placeholder="Describe exactly what the student needs to implement and what the function should return."
            />
          </FormField>

          <FormField
            label="Constraints and examples (optional)"
            htmlFor="cq-constraints"
            hint="Input and output format, limits, edge cases, and a sample or two."
          >
            <textarea
              id="cq-constraints"
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              rows={5}
              className="field-control"
              placeholder={"1 <= n <= 5000\nExample: heap = [3, 1, 2], pop() returns 1"}
            />
          </FormField>
        </FormSection>

        <FormSection title="Who gets it, and by when">
          <div>
            <p className="block text-sm font-medium text-text-primary mb-2">Send to</p>
            <div role="radiogroup" aria-label="Who gets this question" className="grid sm:grid-cols-3 gap-3">
              {SCOPE_OPTIONS.map((o) => {
                const active = scope === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setScope(o.value)}
                    className={`text-left rounded-xl border p-4 transition ${FOCUS_RING} ${
                      active
                        ? "border-brand-live bg-brand-live-10"
                        : "border-white/15 bg-white/[0.03] hover:border-white/30"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-text-primary">{o.title}</span>
                    <span className="block text-xs text-text-muted mt-1">{o.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {(scope === "section" || scope === "students") && (
            <FormField
              label={scope === "section" ? "Section" : "Narrow the list to a section (optional)"}
              htmlFor="cq-section"
            >
              <select
                id="cq-section"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : "")}
                required={scope === "section"}
                className="field-control"
              >
                <option value="">{scope === "students" ? "All sections" : "Choose a section"}</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {scope === "students" && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-medium text-text-primary">
                  Students <span className="text-text-muted font-normal">({studentIds.length} picked)</span>
                </p>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setStudentIds((prev) => Array.from(new Set([...prev, ...visibleStudents.map((s) => s.user_id)])))
                    }
                    className={`text-text-secondary hover:text-text-primary underline underline-offset-2 rounded ${FOCUS_RING}`}
                  >
                    Pick all shown
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentIds([])}
                    className={`text-text-secondary hover:text-text-primary underline underline-offset-2 rounded ${FOCUS_RING}`}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <input
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Search students by name"
                aria-label="Search students by name"
                className="field-control mb-3"
              />
              {visibleStudents.length === 0 ? (
                <p className="text-sm text-text-muted">No students match. Try another section or search.</p>
              ) : (
                <div className="rounded-xl border border-white/12 bg-black/20 max-h-72 overflow-y-auto divide-y divide-white/5">
                  {visibleStudents.map((s) => (
                    <label
                      key={s.user_id}
                      className="flex items-center gap-3 px-4 py-3 text-sm cursor-pointer hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={studentIds.includes(s.user_id)}
                        onChange={(e) =>
                          setStudentIds((prev) =>
                            e.target.checked ? [...prev, s.user_id] : prev.filter((id) => id !== s.user_id)
                          )
                        }
                        className="w-4 h-4 accent-[var(--color-brand)]"
                      />
                      <span className="text-text-primary">{s.full_name}</span>
                      <span className="text-text-muted text-xs ml-auto">{s.section_name ?? "No section"}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <FormField label="Deadline" htmlFor="cq-deadline">
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="cq-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
                className="field-control sm:max-w-xs"
              />
              {[
                { label: "Tomorrow", days: 1 },
                { label: "In 3 days", days: 3 },
                { label: "In a week", days: 7 },
              ].map((c) => (
                <button key={c.label} type="button" onClick={() => setDeadline(deadlineIn(c.days))} className={BTN_GHOST}>
                  {c.label}
                </button>
              ))}
            </div>
          </FormField>
        </FormSection>

        <FormSection
          title="Your answer key (optional)"
          hint="Students never see this. AI assist stays locked until you add a working solution, and you can add it later from the review screen."
        >
          <FormField label="Language" htmlFor="cq-ref-lang">
            <select
              id="cq-ref-lang"
              value={referenceLanguage}
              onChange={(e) => setReferenceLanguage(e.target.value)}
              className="field-control sm:max-w-xs"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Your solution" htmlFor="cq-ref-code">
            <CodeEditor
              id="cq-ref-code"
              value={referenceSolution}
              onChange={setReferenceSolution}
              rows={14}
              placeholder="Paste or type a correct solution."
            />
          </FormField>
        </FormSection>

        <div className="glass rounded-2xl p-6 md:p-8">
          {error && (
            <p role="alert" className="mb-4 text-sm text-danger bg-danger/10 border border-danger/25 rounded-xl px-4 py-3">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-text-secondary">Students are notified as soon as you post.</p>
            <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
              {submitting ? "Posting" : "Post question"}
            </button>
          </div>
        </div>
      </div>

      <aside className="lg:sticky lg:top-6 space-y-4">
        <div className="glass rounded-2xl p-6">
          <p className="text-sm font-medium text-text-secondary mb-4">What students will see</p>
          <h3 className="font-display font-semibold text-lg text-text-primary break-words">
            {title.trim() || "Your question title"}
          </h3>
          <p className="text-xs text-text-muted mt-1.5">
            Due {formatLocalDeadline(deadline)}, worth {maxScore || 0} points
          </p>
          <p className="text-sm text-text-secondary whitespace-pre-wrap break-words mt-5 leading-relaxed">
            {description.trim() || "The problem statement shows up here as you type it."}
          </p>
          {constraints.trim() && (
            <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-medium text-text-secondary mb-1.5">Constraints and examples</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">{constraints}</p>
            </div>
          )}
          <div className="mt-5 pt-4 border-t border-white/10 text-xs text-text-muted">
            Sent to: <span className="text-text-secondary">{scopeSummary}</span>
          </div>
        </div>
      </aside>
    </form>
  );
}

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  not_started: { label: "Not started", color: "text-text-muted", dot: "bg-white/25" },
  submitted: { label: "Waiting for review", color: "text-brand-live", dot: "bg-[var(--color-brand)]" },
  graded: { label: "Graded", color: "text-accepted", dot: "bg-accepted" },
};

type StatusFilter = "all" | "submitted" | "graded" | "not_started";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "submitted", label: "To review" },
  { key: "graded", label: "Graded" },
  { key: "not_started", label: "Not started" },
];

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 min-w-[6.5rem]">
      <p className="font-display font-semibold text-2xl text-text-primary leading-none">{value}</p>
      <p className="text-xs text-text-muted mt-1.5">{label}</p>
    </div>
  );
}

function pickNext(list: Submission[], afterId: number | null): Submission | null {
  const pending = list.filter((s) => s.status === "submitted");
  if (pending.length === 0) return null;
  const idx = list.findIndex((s) => s.id === afterId);
  const after = list.slice(idx + 1).find((s) => s.status === "submitted");
  return after ?? pending[0];
}

function GradingPanel({
  question,
  onBack,
  onQuestionUpdated,
}: {
  question: Question;
  onBack: () => void;
  onQuestionUpdated: (q: Question) => void;
}) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [showStatement, setShowStatement] = useState(false);

  const [refSolution, setRefSolution] = useState("");
  const [refLang, setRefLang] = useState(question.reference_language);
  const [savingRef, setSavingRef] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [hasReference, setHasReference] = useState(question.has_reference_solution);
  const [showRefEditor, setShowRefEditor] = useState(!question.has_reference_solution);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [score, setScore] = useState<number | "">("");
  const [feedback, setFeedback] = useState("");
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    api
      .get<Submission[]>(`/api/custom-questions/${question.id}/submissions`)
      .then(setSubmissions)
      .catch(() => setSubmissions([]));
  }
  useEffect(load, [question.id]);

  const selected = useMemo(
    () => submissions?.find((s) => s.id === selectedId) ?? null,
    [submissions, selectedId]
  );

  const filtered = useMemo(() => {
    if (!submissions) return [];
    const q = search.trim().toLowerCase();
    return submissions
      .filter((s) => statusFilter === "all" || s.status === statusFilter)
      .filter((s) => s.student_name.toLowerCase().includes(q));
  }, [submissions, statusFilter, search]);

  const counts = useMemo(() => {
    const base = { not_started: 0, submitted: 0, graded: 0 };
    for (const s of submissions ?? []) base[s.status as keyof typeof base]++;
    return base;
  }, [submissions]);

  const otherPending = (submissions ?? []).filter((s) => s.status === "submitted" && s.id !== selectedId).length;

  function openSubmission(s: Submission, keepNotice = false) {
    setSelectedId(s.id);
    setScore(s.manual_score ?? "");
    setFeedback(s.manual_feedback || "");
    setAiError(null);
    setGradeError(null);
    setCopied(false);
    if (!keepNotice) setNotice(null);
  }

  function syncCounts(list: Submission[]) {
    onQuestionUpdated({
      ...question,
      graded_count: list.filter((s) => s.status === "graded").length,
      submitted_count: list.filter((s) => s.status !== "not_started").length,
    });
  }

  async function saveReferenceSolution() {
    setSavingRef(true);
    setRefError(null);
    try {
      const res = await api.patch<Question>(`/api/custom-questions/${question.id}/reference-solution`, {
        reference_solution: refSolution,
        reference_language: refLang,
      });
      setHasReference(res.has_reference_solution);
      setShowRefEditor(false);
      setRefSolution("");
      setNotice({ kind: "ok", text: "Answer key saved. AI assist is now available on every submission." });
      onQuestionUpdated(res);
    } catch (e) {
      setRefError(e instanceof ApiError ? e.message : "Couldn't save the answer key. Try again.");
    } finally {
      setSavingRef(false);
    }
  }

  async function runAiAssist() {
    if (!selected) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api.post<Submission>(
        `/api/custom-questions/${question.id}/submissions/${selected.id}/ai-assist`
      );
      setSubmissions((prev) => prev?.map((s) => (s.id === res.id ? res : s)) ?? prev);
    } catch (e) {
      setAiError(e instanceof ApiError ? e.message : "AI assist didn't respond. Try again in a moment.");
    } finally {
      setAiLoading(false);
    }
  }

  async function submitGrade(advance: boolean) {
    if (!selected || !submissions || score === "") return;
    if (score < 0 || score > question.max_score) {
      setGradeError(`Score must be between 0 and ${question.max_score}.`);
      return;
    }
    setGrading(true);
    setGradeError(null);
    try {
      const res = await api.patch<Submission>(
        `/api/custom-questions/${question.id}/submissions/${selected.id}/grade`,
        { score: Number(score), feedback }
      );
      const nextList = submissions.map((s) => (s.id === res.id ? res : s));
      setSubmissions(nextList);
      syncCounts(nextList);

      if (advance) {
        const next = pickNext(nextList, res.id);
        if (next) {
          openSubmission(next, true);
          setNotice({ kind: "ok", text: `Saved ${res.student_name}'s grade. Here is the next submission.` });
        } else {
          setNotice({ kind: "ok", text: `Saved ${res.student_name}'s grade. Nothing else is waiting for review.` });
        }
      } else {
        setNotice({ kind: "ok", text: `Saved ${res.student_name}'s grade.` });
      }
    } catch (e) {
      setGradeError(e instanceof ApiError ? e.message : "Couldn't save the grade. Try again.");
    } finally {
      setGrading(false);
    }
  }

  async function copyCode() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const deadlineInfo = relativeDeadline(question.deadline);
  const quickScores = Array.from(
    new Set([0, 0.5, 0.75, 1].map((f) => Math.round(question.max_score * f)))
  );
  const aiScaled = selected?.ai_score != null ? Math.round((selected.ai_score * question.max_score) / 100) : null;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className={`inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary rounded ${FOCUS_RING}`}>
        <ChevronLeft />
        Back to all questions
      </button>

      {notice && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}

      <div className="glass rounded-2xl p-6 md:p-8">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-xl text-text-primary break-words">{question.title}</h2>
            <p className={`text-sm mt-1.5 ${deadlineInfo.overdue ? "text-danger" : "text-text-secondary"}`}>
              {deadlineInfo.text[0].toUpperCase() + deadlineInfo.text.slice(1)}, worth {question.max_score} points
            </p>
          </div>
          <div className="flex gap-3">
            <StatBox label="Targeted" value={question.target_count} />
            <StatBox label="Submitted" value={counts.submitted + counts.graded} />
            <StatBox label="Graded" value={counts.graded} />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <button
            onClick={() => setShowStatement((v) => !v)}
            aria-expanded={showStatement}
            className={`text-text-secondary hover:text-text-primary underline underline-offset-2 rounded ${FOCUS_RING}`}
          >
            {showStatement ? "Hide problem statement" : "Show problem statement"}
          </button>
          {hasReference && !showRefEditor && (
            <button
              onClick={() => setShowRefEditor(true)}
              className={`text-text-secondary hover:text-text-primary underline underline-offset-2 rounded ${FOCUS_RING}`}
            >
              Answer key is set. Replace it
            </button>
          )}
        </div>

        {showStatement && (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-5 space-y-4">
            <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{question.description}</p>
            {question.constraints && (
              <div className="pt-4 border-t border-white/10">
                <p className="text-xs font-medium text-text-secondary mb-1.5">Constraints and examples</p>
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{question.constraints}</p>
              </div>
            )}
          </div>
        )}

        {showRefEditor && (
          <div className="mt-5 rounded-xl border border-white/12 bg-white/[0.03] p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {hasReference ? "Replace your answer key" : "Add your answer key to unlock AI assist"}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {hasReference
                    ? "For safety the saved solution isn't shown here. Paste a new one to replace it."
                    : "AI assist compares each submission to your own working solution."}
                </p>
              </div>
              {hasReference && (
                <button onClick={() => setShowRefEditor(false)} className={`text-xs text-text-secondary hover:text-text-primary underline underline-offset-2 rounded ${FOCUS_RING}`}>
                  Cancel
                </button>
              )}
            </div>
            {refError && <p role="alert" className="text-sm text-danger mb-3">{refError}</p>}
            <div className="space-y-4">
              <select
                aria-label="Answer key language"
                value={refLang}
                onChange={(e) => setRefLang(e.target.value)}
                className="field-control sm:max-w-xs"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <CodeEditor
                value={refSolution}
                onChange={setRefSolution}
                rows={12}
                ariaLabel="Answer key code"
                placeholder="Paste or type a correct solution."
              />
              <button onClick={saveReferenceSolution} disabled={savingRef || !refSolution.trim()} className={BTN_PRIMARY}>
                {savingRef ? "Saving" : "Save answer key"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[20rem_minmax(0,1fr)] gap-6 items-start">
        <div className="glass rounded-2xl p-5 space-y-4 lg:sticky lg:top-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students"
            aria-label="Search students"
            className="field-control"
          />
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const n = f.key === "all" ? submissions?.length ?? 0 : counts[f.key];
              const active = statusFilter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${FOCUS_RING} ${
                    active ? "bg-brand-live text-[#0A0A0C]" : "border border-white/15 text-text-secondary hover:text-text-primary hover:border-white/30"
                  }`}
                >
                  {f.label} ({n})
                </button>
              );
            })}
          </div>

          <button
            onClick={() => {
              const next = pickNext(submissions ?? [], selectedId);
              if (next) openSubmission(next);
            }}
            disabled={!submissions || (selected?.status === "submitted" ? otherPending === 0 : counts.submitted === 0)}
            className={`${BTN_GHOST} w-full`}
          >
            Jump to next submission to review
          </button>

          <div className="space-y-1.5 max-h-[32rem] overflow-y-auto -mx-1 px-1">
            {submissions === null ? (
              <p className="text-sm text-text-muted px-1 py-3">Loading students</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-text-muted px-1 py-3">No students match this filter.</p>
            ) : (
              filtered.map((s) => {
                const meta = STATUS_META[s.status];
                const active = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    onClick={() => openSubmission(s)}
                    aria-current={active}
                    className={`w-full text-left rounded-xl px-3 py-3 flex items-center gap-3 transition ${FOCUS_RING} ${
                      active ? "bg-brand-live-15" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="w-9 h-9 rounded-full bg-brand-live-20 text-brand-live flex items-center justify-center text-xs font-semibold shrink-0">
                      {initials(s.student_name)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-text-primary truncate">{s.student_name}</span>
                      <span className={`block text-xs mt-0.5 ${meta.color}`}>{meta.label}</span>
                    </span>
                    {s.status === "graded" ? (
                      <span className="text-sm font-display font-semibold text-accepted shrink-0">
                        {s.manual_score}/{question.max_score}
                      </span>
                    ) : (
                      <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="glass rounded-2xl p-6 md:p-8 min-h-[24rem]">
          {!selected ? (
            <div className="h-full min-h-[18rem] flex flex-col items-center justify-center text-center gap-4">
              <p className="text-base text-text-primary font-medium">Pick a student to review their code</p>
              <p className="text-sm text-text-secondary max-w-sm">
                {counts.submitted > 0
                  ? `${counts.submitted} ${counts.submitted === 1 ? "submission is" : "submissions are"} waiting for your review.`
                  : "Nothing is waiting for review right now."}
              </p>
              {counts.submitted > 0 && (
                <button
                  onClick={() => {
                    const first = pickNext(submissions ?? [], null);
                    if (first) openSubmission(first);
                  }}
                  className={BTN_PRIMARY}
                >
                  Start with the first one
                </button>
              )}
            </div>
          ) : selected.status === "not_started" ? (
            <div className="flex items-center gap-4">
              <span className="w-12 h-12 rounded-full bg-brand-live-20 text-brand-live flex items-center justify-center text-sm font-semibold shrink-0">
                {initials(selected.student_name)}
              </span>
              <div>
                <p className="text-base text-text-primary font-medium">{selected.student_name}</p>
                <p className="text-sm text-text-secondary mt-0.5">Hasn&apos;t submitted anything yet.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="w-12 h-12 rounded-full bg-brand-live-20 text-brand-live flex items-center justify-center text-sm font-semibold shrink-0">
                    {initials(selected.student_name)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-base text-text-primary font-medium truncate">{selected.student_name}</p>
                    <p className="text-sm text-text-secondary mt-0.5">
                      {LANGUAGES.find((l) => l.value === selected.language)?.label ?? selected.language}
                      {selected.submitted_at && `, submitted ${new Date(selected.submitted_at).toLocaleString()}`}
                    </p>
                  </div>
                </div>
                <span className={`text-sm font-medium ${STATUS_META[selected.status].color}`}>
                  {STATUS_META[selected.status].label}
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-text-primary">Submitted code</h3>
                  <button onClick={copyCode} className={`text-xs text-text-secondary hover:text-text-primary underline underline-offset-2 rounded ${FOCUS_RING}`}>
                    {copied ? "Copied" : "Copy code"}
                  </button>
                </div>
                <pre className="code-area rounded-xl border border-white/10 p-5 max-h-[32rem]">{selected.code}</pre>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-sm font-medium text-text-primary">AI assist</h3>
                    <p className="text-xs text-text-muted mt-1 max-w-md">
                      Compares this code to your answer key and suggests a score. It never sets the grade for you.
                    </p>
                  </div>
                  <button onClick={runAiAssist} disabled={aiLoading || !hasReference} className={BTN_GHOST}>
                    {aiLoading ? "Asking AI" : selected.ai_reviewed_at ? "Run again" : "Get AI suggestion"}
                  </button>
                </div>
                {!hasReference && (
                  <p className="text-xs text-text-muted mt-3">
                    Add your answer key above to turn this on.
                  </p>
                )}
                {aiError && <p role="alert" className="text-sm text-danger mt-3">{aiError}</p>}

                {selected.ai_reviewed_at && (
                  <div className="mt-4 rounded-xl border border-brand-live-30 bg-brand-live-10 p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                      <p className="text-sm font-semibold text-text-primary">
                        AI suggests {selected.ai_score}/100
                        <span className="text-text-secondary font-normal">
                          {" "}
                          which is about {aiScaled} out of {question.max_score}
                        </span>
                      </p>
                      <button
                        onClick={() => {
                          setScore(aiScaled ?? "");
                          setFeedback(selected.ai_feedback);
                        }}
                        className={`text-sm font-medium text-brand-live underline underline-offset-2 rounded ${FOCUS_RING}`}
                      >
                        Use this suggestion
                      </button>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{selected.ai_feedback}</p>
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <h3 className="text-sm font-medium text-text-primary">Your grade</h3>
                <div>
                  <label htmlFor="cq-score" className="block text-sm text-text-secondary mb-2">
                    Score out of {question.max_score}
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      id="cq-score"
                      type="number"
                      min={0}
                      max={question.max_score}
                      value={score}
                      onChange={(e) => setScore(e.target.value === "" ? "" : Number(e.target.value))}
                      className="field-control !w-28 text-xl font-display font-semibold text-center"
                    />
                    <div className="flex flex-wrap gap-2">
                      {quickScores.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setScore(v)}
                          aria-pressed={score === v}
                          className={`min-w-[3rem] px-3 py-2 rounded-lg text-sm transition ${FOCUS_RING} ${
                            score === v
                              ? "bg-brand-live text-[#0A0A0C] font-semibold"
                              : "border border-white/15 text-text-secondary hover:text-text-primary hover:border-white/30"
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="cq-feedback" className="block text-sm text-text-secondary mb-2">
                    Feedback for the student
                  </label>
                  <textarea
                    id="cq-feedback"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    rows={5}
                    className="field-control"
                    placeholder="What worked, what to fix, and what to try next."
                  />
                </div>

                {gradeError && <p role="alert" className="text-sm text-danger">{gradeError}</p>}

                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => submitGrade(true)} disabled={grading || score === ""} className={BTN_PRIMARY}>
                    {grading ? "Saving" : "Save and go to next"}
                  </button>
                  <button onClick={() => submitGrade(false)} disabled={grading || score === ""} className={BTN_GHOST}>
                    {selected.status === "graded" ? "Update grade" : "Save grade"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  q,
  onOpen,
  onDelete,
}: {
  q: Question;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const toReview = Math.max(0, q.submitted_count - q.graded_count);
  const target = Math.max(q.target_count, 1);
  const gradedPct = (q.graded_count / target) * 100;
  const reviewPct = (toReview / target) * 100;
  const deadlineInfo = relativeDeadline(q.deadline);

  return (
    <article className="glass rounded-2xl p-6 flex flex-col gap-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display font-semibold text-lg text-text-primary break-words">{q.title}</h3>
          {toReview > 0 && (
            <span className="shrink-0 rounded-full bg-brand-live-15 text-brand-live text-xs font-medium px-3 py-1">
              {toReview} to review
            </span>
          )}
        </div>
        <p className="text-sm text-text-secondary mt-2 line-clamp-2">{q.description}</p>
      </div>

      <div>
        <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden flex" role="img" aria-label={`${q.graded_count} graded, ${toReview} waiting for review, ${q.target_count} targeted`}>
          <div className="bg-accepted" style={{ width: `${gradedPct}%` }} />
          <div className="bg-brand-live" style={{ width: `${reviewPct}%` }} />
        </div>
        <p className="text-sm text-text-secondary mt-3">
          {q.submitted_count} of {q.target_count} students have submitted, {q.graded_count} graded.
        </p>
        <p className="text-xs text-text-muted mt-1">
          <span className={deadlineInfo.overdue ? "text-danger" : ""}>
            {deadlineInfo.text[0].toUpperCase() + deadlineInfo.text.slice(1)}
          </span>
          , {q.max_score} points, {q.has_reference_solution ? "answer key set" : "no answer key yet"}
        </p>
      </div>

      <div className="flex items-center gap-3 mt-auto">
        <button onClick={onOpen} className={toReview > 0 ? BTN_PRIMARY : BTN_GHOST}>
          {toReview > 0 ? "Review submissions" : "Open"}
        </button>
        <button onClick={onDelete} className={`ml-auto text-sm text-danger hover:underline underline-offset-2 rounded ${FOCUS_RING}`}>
          Delete
        </button>
      </div>
    </article>
  );
}

type PageTab = "post" | "manage";

function CustomQuestionsContent() {
  const [tab, setTab] = useState<PageTab>("manage");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [active, setActive] = useState<Question | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  function load() {
    api
      .get<Question[]>("/api/custom-questions")
      .then(setQuestions)
      .catch(() => setQuestions([]));
  }
  useEffect(load, []);

  async function remove(q: Question) {
    if (!confirm(`Delete "${q.title}" and every student submission for it? This can't be undone.`)) return;
    try {
      await api.delete(`/api/custom-questions/${q.id}`);
      setNotice({ kind: "ok", text: `"${q.title}" was deleted.` });
      setActive(null);
      load();
    } catch {
      setNotice({ kind: "error", text: "Couldn't delete that question. Try again." });
    }
  }

  const totalToReview = (questions ?? []).reduce(
    (sum, q) => sum + Math.max(0, q.submitted_count - q.graded_count),
    0
  );

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-10 pb-20">
      <h1 className="font-display font-semibold text-3xl text-text-primary mt-8">Custom Questions</h1>
      <p className="text-base text-text-secondary mt-2 mb-8 max-w-2xl">
        Write your own coding problems, read what students submit, and grade it yourself. AI assist can
        suggest a score once you&apos;ve added your own correct solution.
      </p>

      {notice && !active && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}

      {!active && (
        <div role="tablist" aria-label="Custom Questions sections" className="glass rounded-2xl p-1.5 inline-flex items-center gap-1 mb-8">
          {([
            { key: "manage", label: "Manage & grade" },
            { key: "post", label: "Post a question" },
          ] as { key: PageTab; label: string }[]).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition ${FOCUS_RING} ${
                tab === t.key ? "bg-brand-live text-[#0A0A0C]" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {t.label}
              {t.key === "manage" && totalToReview > 0 && (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${tab === "manage" ? "bg-black/15" : "bg-brand-live-20 text-brand-live"}`}>
                  {totalToReview}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {active ? (
        <GradingPanel
          question={active}
          onBack={() => {
            setActive(null);
            load();
          }}
          onQuestionUpdated={(q) => {
            setActive(q);
            setQuestions((prev) => prev?.map((existing) => (existing.id === q.id ? q : existing)) ?? prev);
          }}
        />
      ) : tab === "post" ? (
        <CreateQuestionForm
          onCreated={(q) => {
            setNotice({ kind: "ok", text: `"${q.title}" is posted and students have been notified.` });
            setTab("manage");
            load();
          }}
        />
      ) : questions === null ? (
        <p className="text-sm text-text-muted">Loading your questions</p>
      ) : questions.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <p className="text-lg text-text-primary font-medium">No custom questions yet</p>
          <p className="text-sm text-text-secondary mt-2 mb-6">Post your first one and students will see it right away.</p>
          <button onClick={() => setTab("post")} className={BTN_PRIMARY}>
            Post a question
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {totalToReview > 0 && (
            <p className="text-sm text-text-secondary">
              {totalToReview} {totalToReview === 1 ? "submission is" : "submissions are"} waiting for your review.
            </p>
          )}
          <div className="grid md:grid-cols-2 gap-6">
            {questions.map((q) => (
              <QuestionCard key={q.id} q={q} onOpen={() => setActive(q)} onDelete={() => remove(q)} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

export default function TeacherCustomQuestionsPage() {
  return (
    <RequireRole roles={["teacher", "super_admin"]}>
      <BackgroundVideo />
      <Nav />
      <CustomQuestionsContent />
    </RequireRole>
  );
}
