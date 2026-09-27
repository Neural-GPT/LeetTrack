"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import BackgroundVideo from "@/components/BackgroundVideo";
import RequireRole from "@/components/RequireRole";
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const DEFAULT_DEADLINE = () => {
  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function CreateQuestionForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [constraints, setConstraints] = useState("");
  const [maxScore, setMaxScore] = useState(20);
  const [scope, setScope] = useState<"batch" | "section" | "students">("section");
  const [sectionId, setSectionId] = useState<number | "">("");
  const [studentIds, setStudentIds] = useState<number[]>([]);
  const [deadline, setDeadline] = useState(DEFAULT_DEADLINE());
  const [referenceSolution, setReferenceSolution] = useState("");
  const [referenceLanguage, setReferenceLanguage] = useState("python");

  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<Section[]>("/api/sections").then(setSections).catch(() => setSections([]));
  }, []);

  useEffect(() => {
    if (scope !== "students") return;
    const query = sectionId ? `?section_id=${sectionId}` : "";
    api.get<Student[]>(`/api/teacher/students${query}`).then(setStudents).catch(() => setStudents([]));
  }, [scope, sectionId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (scope === "section" && !sectionId) {
      setError("Pick a section.");
      return;
    }
    if (scope === "students" && studentIds.length === 0) {
      setError("Select at least one student.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/custom-questions", {
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
      setSuccess(`"${title}" posted — students have been notified.`);
      setTitle("");
      setDescription("");
      setConstraints("");
      setReferenceSolution("");
      setStudentIds([]);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the question.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-4">New custom question</p>

      {error && (
        <div className="mb-4 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
          {success}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="input" placeholder="Implement a min-heap" />
        </Field>
        <Field label="Max score">
          <input
            type="number"
            min={1}
            value={maxScore}
            onChange={(e) => setMaxScore(Number(e.target.value))}
            required
            className="input"
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Problem statement">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            className="input min-h-[120px]"
            placeholder="Describe exactly what the student needs to implement…"
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Constraints / examples (optional)">
          <textarea
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            className="input min-h-[70px]"
            placeholder="Input/output format, edge cases, sample cases…"
          />
        </Field>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <Field label="Scope">
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="input">
            <option value="batch">Everyone</option>
            <option value="section">A section</option>
            <option value="students">Specific students</option>
          </select>
        </Field>

        {(scope === "section" || scope === "students") && (
          <Field label="Section">
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : "")}
              required={scope === "section"}
              className="input"
            >
              <option value="">{scope === "students" ? "All sections" : "Choose a section"}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Deadline">
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            required
            className="input"
          />
        </Field>
      </div>

      {scope === "students" && (
        <div className="mt-4">
          <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">Students</label>
          {students.length === 0 ? (
            <p className="text-sm text-text-muted">No students found for that section.</p>
          ) : (
            <div className="glass rounded-lg p-3 max-h-48 overflow-y-auto space-y-1.5">
              {students.map((s) => (
                <label key={s.user_id} className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={studentIds.includes(s.user_id)}
                    onChange={(e) =>
                      setStudentIds((prev) =>
                        e.target.checked ? [...prev, s.user_id] : prev.filter((id) => id !== s.user_id)
                      )
                    }
                  />
                  <span>
                    {s.full_name} <span className="text-text-muted">({s.section_name ?? "no section"})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mt-5 pt-5 border-t border-white/10">
        <div className="md:col-span-2">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-1.5">
            Your correct reference implementation (optional now, needed for AI-assist later)
          </p>
          <p className="text-xs text-text-muted mb-2">
            AI-assisted grading for this question stays locked until you provide your own working solution — you
            can post the question now and add this any time before you start grading.
          </p>
        </div>
        <Field label="Reference language">
          <select value={referenceLanguage} onChange={(e) => setReferenceLanguage(e.target.value)} className="input">
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="javascript">JavaScript</option>
          </select>
        </Field>
        <div className="md:col-span-2">
          <textarea
            value={referenceSolution}
            onChange={(e) => setReferenceSolution(e.target.value)}
            className="input min-h-[120px] font-mono text-xs"
            placeholder="Your own correct solution code…"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-5 px-5 py-2.5 rounded-xl bg-brand-live text-[#0A0A0C] text-sm font-medium disabled:opacity-50"
      >
        {submitting ? "Posting…" : "Post question"}
      </button>
    </form>
  );
}

function GradingPanel({ question, onClose }: { question: Question; onClose: () => void }) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [refSolution, setRefSolution] = useState(question.has_reference_solution ? "" : "");
  const [refLang, setRefLang] = useState(question.reference_language);
  const [savingRef, setSavingRef] = useState(false);
  const [hasReference, setHasReference] = useState(question.has_reference_solution);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [score, setScore] = useState<number | "">("");
  const [feedback, setFeedback] = useState("");
  const [grading, setGrading] = useState(false);

  function load() {
    api
      .get<Submission[]>(`/api/custom-questions/${question.id}/submissions`)
      .then(setSubmissions)
      .catch(() => setSubmissions([]));
  }
  useEffect(load, [question.id]);

  function openSubmission(s: Submission) {
    setSelected(s);
    setScore(s.manual_score ?? s.ai_score ?? "");
    setFeedback(s.manual_feedback || s.ai_feedback || "");
    setAiError(null);
  }

  async function saveReferenceSolution() {
    setSavingRef(true);
    try {
      const res = await api.patch<Question>(`/api/custom-questions/${question.id}/reference-solution`, {
        reference_solution: refSolution,
        reference_language: refLang,
      });
      setHasReference(res.has_reference_solution);
    } catch {
      // surfaced implicitly by hasReference staying false
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
      setSelected(res);
      setScore(res.ai_score ?? "");
      setFeedback(res.ai_feedback);
    } catch (e) {
      setAiError(e instanceof ApiError ? e.message : "AI assist failed.");
    } finally {
      setAiLoading(false);
    }
  }

  async function submitGrade() {
    if (!selected || score === "") return;
    setGrading(true);
    try {
      const res = await api.patch<Submission>(
        `/api/custom-questions/${question.id}/submissions/${selected.id}/grade`,
        { score: Number(score), feedback }
      );
      setSelected(res);
      load();
    } catch (e) {
      setAiError(e instanceof ApiError ? e.message : "Couldn't save the grade.");
    } finally {
      setGrading(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between mb-4">
        <p className="font-display font-semibold text-text-primary">{question.title}</p>
        <button onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">
          ← Back to all questions
        </button>
      </div>

      {!hasReference && (
        <div className="mb-5 glass rounded-xl p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-2">
            Add your reference solution to unlock AI-assist
          </p>
          <div className="flex gap-2 mb-2">
            <select value={refLang} onChange={(e) => setRefLang(e.target.value)} className="input w-32">
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="cpp">C++</option>
              <option value="javascript">JavaScript</option>
            </select>
            <button
              onClick={saveReferenceSolution}
              disabled={savingRef || !refSolution.trim()}
              className="px-3 py-1.5 rounded-lg bg-brand-live text-[#0A0A0C] text-xs font-medium disabled:opacity-50"
            >
              {savingRef ? "Saving…" : "Save reference"}
            </button>
          </div>
          <textarea
            value={refSolution}
            onChange={(e) => setRefSolution(e.target.value)}
            className="input min-h-[100px] font-mono text-xs"
            placeholder="Your own correct solution code…"
          />
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_1.4fr] gap-5">
        <div className="space-y-2">
          {submissions === null ? (
            <p className="text-sm text-text-muted">Loading submissions…</p>
          ) : submissions.length === 0 ? (
            <p className="text-sm text-text-muted">No students targeted yet.</p>
          ) : (
            submissions.map((s) => (
              <button
                key={s.id}
                onClick={() => openSubmission(s)}
                className={`w-full text-left glass rounded-lg px-3.5 py-2.5 text-sm transition-colors ${
                  selected?.id === s.id ? "bg-brand-live-15" : "hover:bg-white/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-text-primary">{s.student_name}</span>
                  <span
                    className={
                      s.status === "graded"
                        ? "text-accepted text-xs"
                        : s.status === "submitted"
                        ? "text-brand-live text-xs"
                        : "text-text-muted text-xs"
                    }
                  >
                    {s.status === "graded" ? `${s.manual_score}/${question.max_score}` : s.status}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        <div>
          {!selected ? (
            <p className="text-sm text-text-muted">Select a student to view their submission.</p>
          ) : selected.status === "not_started" ? (
            <p className="text-sm text-text-muted">This student hasn't submitted anything yet.</p>
          ) : (
            <div className="space-y-3">
              <pre className="glass rounded-lg p-3.5 text-xs font-mono overflow-x-auto max-h-72 whitespace-pre-wrap">
                {selected.code}
              </pre>

              <div className="flex items-center gap-2">
                <button
                  onClick={runAiAssist}
                  disabled={aiLoading || !hasReference}
                  title={!hasReference ? "Add a reference solution above first" : undefined}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-live text-[#0A0A0C] disabled:opacity-50"
                >
                  {aiLoading ? "Asking AI…" : "AI assist"}
                </button>
                {selected.ai_reviewed_at && (
                  <span className="text-xs text-text-muted">
                    AI suggested {selected.ai_score}/100
                    {selected.ai_feedback ? ` — ${selected.ai_feedback}` : ""}
                  </span>
                )}
              </div>
              {aiError && <p className="text-xs text-danger">{aiError}</p>}

              <div className="grid grid-cols-[auto_1fr] gap-3 items-start">
                <Field label={`Score (/${question.max_score})`}>
                  <input
                    type="number"
                    min={0}
                    max={question.max_score}
                    value={score}
                    onChange={(e) => setScore(e.target.value === "" ? "" : Number(e.target.value))}
                    className="input w-24"
                  />
                </Field>
                <Field label="Feedback">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    className="input min-h-[70px]"
                  />
                </Field>
              </div>

              <button
                onClick={submitGrade}
                disabled={grading || score === ""}
                className="px-4 py-2 rounded-lg bg-brand-live text-[#0A0A0C] text-sm font-medium disabled:opacity-50"
              >
                {grading ? "Saving…" : selected.status === "graded" ? "Update grade" : "Save grade"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomQuestionsContent() {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [active, setActive] = useState<Question | null>(null);

  function load() {
    api
      .get<Question[]>("/api/custom-questions")
      .then(setQuestions)
      .catch(() => setQuestions([]));
  }
  useEffect(load, []);

  async function remove(id: number) {
    if (!confirm("Delete this question and all student submissions? This can't be undone.")) return;
    await api.delete(`/api/custom-questions/${id}`);
    setActive(null);
    load();
  }

  return (
    <main className="max-w-5xl mx-auto px-4 md:px-10 pb-16">
      <h1 className="font-display font-semibold text-2xl text-text-primary mt-6 mb-1">Custom Questions</h1>
      <p className="text-sm text-text-muted mb-6">
        Write your own coding problems, review student submissions by hand, and optionally get an AI-suggested
        score once you've supplied your own correct implementation.
      </p>

      {active ? (
        <GradingPanel question={active} onClose={() => { setActive(null); load(); }} />
      ) : (
        <div className="space-y-6">
          <CreateQuestionForm onCreated={load} />

          <section className="glass rounded-2xl p-7">
            <p className="text-xs text-text-muted uppercase tracking-wide mb-4">Your questions</p>
            {questions === null ? (
              <p className="text-sm text-text-muted">Loading…</p>
            ) : questions.length === 0 ? (
              <p className="text-sm text-text-muted">You haven't posted any custom questions yet.</p>
            ) : (
              <div className="space-y-2">
                {questions.map((q) => (
                  <div key={q.id} className="glass rounded-lg px-4 py-3 flex items-center justify-between">
                    <button onClick={() => setActive(q)} className="text-left flex-1">
                      <p className="text-sm text-text-primary">{q.title}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {q.submitted_count}/{q.target_count} submitted · {q.graded_count} graded ·{" "}
                        {q.has_reference_solution ? "reference set" : "no reference yet"}
                      </p>
                    </button>
                    <button onClick={() => remove(q.id)} className="text-xs text-danger ml-3">
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
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
