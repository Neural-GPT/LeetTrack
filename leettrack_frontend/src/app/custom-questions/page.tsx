"use client";

import { useEffect, useMemo, useState } from "react";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
import CodeEditor from "@/components/CodeEditor";
import { api, ApiError } from "@/lib/api";

type MyQuestion = {
  id: number;
  title: string;
  description: string;
  constraints: string;
  max_score: number;
  deadline: string;
  submission_status: "not_started" | "submitted" | "graded";
  my_code: string;
  my_language: string;
  manual_score: number | null;
  manual_feedback: string;
};

type Filter = "all" | "not_started" | "submitted" | "graded";

const STATUS_STYLE: Record<MyQuestion["submission_status"], { label: string; color: string; dot: string }> = {
  not_started: { label: "To do", color: "text-text-secondary", dot: "bg-white/30" },
  submitted: { label: "Submitted, awaiting review", color: "text-brand-live", dot: "bg-[var(--color-brand)]" },
  graded: { label: "Graded", color: "text-accepted", dot: "bg-accepted" },
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_started", label: "To do" },
  { key: "submitted", label: "Submitted" },
  { key: "graded", label: "Graded" },
];

const LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "javascript", label: "JavaScript" },
];

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";
const BTN_PRIMARY = `inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-brand-live text-[#0A0A0C] text-sm font-semibold transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`;

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function dueLabel(iso: string): { text: string; overdue: boolean } {
  const diff = new Date(iso).getTime() - Date.now();
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const chunk = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  return { text: overdue ? `${chunk} overdue` : `Due in ${chunk}`, overdue };
}

function draftKey(id: number): string {
  return `leettrack_cq_draft_${id}`;
}

function readDraft(id: number): string {
  try {
    return localStorage.getItem(draftKey(id)) ?? "";
  } catch {
    return "";
  }
}

function QuestionDetail({ q, onSubmitted }: { q: MyQuestion; onSubmitted: () => void }) {
  const [code, setCode] = useState(() => q.my_code || readDraft(q.id));
  const [language, setLanguage] = useState(q.my_language || "python");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const locked = q.submission_status === "graded";
  const due = dueLabel(q.deadline);
  const hasUnsubmittedDraft = code.trim() !== "" && code !== q.my_code;

  function updateCode(next: string) {
    setCode(next);
    setSuccess(null);
    try {
      if (next === q.my_code || next === "") localStorage.removeItem(draftKey(q.id));
      else localStorage.setItem(draftKey(q.id), next);
    } catch {
      // Storage can be blocked (private windows); the draft just won't persist.
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/api/custom-questions/my/${q.id}/submit`, { code, language });
      try {
        localStorage.removeItem(draftKey(q.id));
      } catch {
        // ignore
      }
      setSuccess("Submitted. Your teacher will review it, and you can edit and resubmit until it's graded.");
      onSubmitted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit right now. Your code is still here, try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl p-6 md:p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h2 className="font-display font-semibold text-2xl text-text-primary break-words min-w-0">{q.title}</h2>
          <span className={`text-sm font-medium ${STATUS_STYLE[q.submission_status].color}`}>
            {STATUS_STYLE[q.submission_status].label}
          </span>
        </div>
        <p className={`text-sm mt-2 ${due.overdue ? "text-danger" : "text-text-secondary"}`}>
          {due.overdue ? "Deadline was " + formatDue(q.deadline) : due.text + ", on " + formatDue(q.deadline)}.
          Worth {q.max_score} points.
        </p>

        <p className="text-base text-text-secondary whitespace-pre-wrap leading-relaxed mt-6 max-w-3xl">
          {q.description}
        </p>

        {q.constraints && (
          <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-5 max-w-3xl">
            <p className="text-sm font-medium text-text-primary mb-2">Constraints and examples</p>
            <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{q.constraints}</p>
          </div>
        )}
      </section>

      {q.submission_status === "graded" && (
        <section className="glass rounded-2xl p-6 md:p-8">
          <p className="text-sm font-medium text-text-secondary">Your grade</p>
          <p className="font-display font-semibold text-4xl text-accepted mt-2">
            {q.manual_score}
            <span className="text-xl text-text-muted font-normal">/{q.max_score}</span>
          </p>
          {q.manual_feedback ? (
            <p className="text-base text-text-secondary whitespace-pre-wrap leading-relaxed mt-4 max-w-3xl">
              {q.manual_feedback}
            </p>
          ) : (
            <p className="text-sm text-text-muted mt-3">Your teacher didn&apos;t leave written feedback.</p>
          )}
        </section>
      )}

      <section className="glass rounded-2xl p-6 md:p-8">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
          <h3 className="text-lg font-display font-semibold text-text-primary">
            {locked ? "Your submission" : "Your solution"}
          </h3>
          {!locked && (
            <div className="flex items-center gap-3">
              <label htmlFor="cq-language" className="text-sm text-text-secondary">
                Language
              </label>
              <select
                id="cq-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="field-control !w-auto !py-2.5"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {locked ? (
          <pre className="code-area rounded-xl border border-white/10 p-5 max-h-[32rem]">{q.my_code}</pre>
        ) : (
          <>
            <CodeEditor
              value={code}
              onChange={updateCode}
              rows={18}
              ariaLabel="Your solution code"
              placeholder="Write your solution here."
            />

            {q.submission_status === "submitted" && !hasUnsubmittedDraft && (
              <p className="text-sm text-text-secondary mt-4">
                This is what you submitted. Edit it and resubmit any time before it&apos;s graded.
              </p>
            )}
            {hasUnsubmittedDraft && (
              <p className="text-sm text-text-muted mt-4">
                Draft saved on this device. It isn&apos;t submitted until you press the button below.
              </p>
            )}
            {due.overdue && (
              <p className="text-sm text-danger mt-4">
                The deadline has passed. The server may reject late submissions, so check with your teacher.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4 mt-6">
              <button onClick={submit} disabled={submitting || !code.trim()} className={BTN_PRIMARY}>
                {submitting ? "Submitting" : q.submission_status === "submitted" ? "Resubmit solution" : "Submit solution"}
              </button>
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              {success && (
                <p role="status" className="text-sm text-accepted">
                  {success}
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function CustomQuestionsListContent() {
  const [questions, setQuestions] = useState<MyQuestion[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  function load() {
    api
      .get<MyQuestion[]>("/api/custom-questions/my/list")
      .then((qs) => {
        setQuestions(qs);
        setActiveId((current) => current ?? qs.find((q) => q.submission_status === "not_started")?.id ?? qs[0]?.id ?? null);
      })
      .catch(() => setQuestions([]));
  }
  useEffect(load, []);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: 0, not_started: 0, submitted: 0, graded: 0 };
    for (const q of questions ?? []) {
      base.all++;
      base[q.submission_status]++;
    }
    return base;
  }, [questions]);

  const visible = useMemo(
    () => (questions ?? []).filter((q) => filter === "all" || q.submission_status === filter),
    [questions, filter]
  );

  const active = questions?.find((q) => q.id === activeId) ?? null;

  return (
    <div className="max-w-6xl mx-auto pb-16 pt-20">
      <h1 className="font-display font-semibold text-3xl text-text-primary">Custom Questions</h1>
      <p className="text-base text-text-secondary mt-2 mb-8 max-w-2xl">
        Problems your teacher wrote themselves. Write your own code, submit it, and your teacher reads and grades it.
      </p>

      {questions === null ? (
        <p className="text-sm text-text-muted">Loading your questions</p>
      ) : questions.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <p className="text-lg text-text-primary font-medium">No custom questions yet</p>
          <p className="text-sm text-text-secondary mt-2">When your teacher posts one, it shows up here and you get a notification.</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[19rem_minmax(0,1fr)] gap-6 items-start">
          <div className="space-y-4 lg:sticky lg:top-6">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${FOCUS_RING} ${
                    filter === f.key
                      ? "bg-brand-live text-[#0A0A0C]"
                      : "glass text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {f.label} ({counts[f.key]})
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {visible.length === 0 ? (
                <p className="text-sm text-text-muted">Nothing in this list.</p>
              ) : (
                visible.map((q) => {
                  const s = STATUS_STYLE[q.submission_status];
                  const due = dueLabel(q.deadline);
                  const isActive = q.id === activeId;
                  return (
                    <button
                      key={q.id}
                      onClick={() => setActiveId(q.id)}
                      aria-current={isActive}
                      className={`w-full text-left glass rounded-2xl p-5 transition ${FOCUS_RING} ${
                        isActive ? "border-brand-live bg-brand-live-10" : "hover:bg-white/5"
                      }`}
                    >
                      <p className="text-base text-text-primary font-medium line-clamp-2">{q.title}</p>
                      <div className="flex items-center justify-between gap-3 mt-3">
                        <span className={`inline-flex items-center gap-2 text-xs ${s.color}`}>
                          <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                          {s.label}
                        </span>
                        {q.submission_status === "graded" ? (
                          <span className="text-sm font-display font-semibold text-accepted">
                            {q.manual_score}/{q.max_score}
                          </span>
                        ) : (
                          <span className={`text-xs ${due.overdue ? "text-danger" : "text-text-muted"}`}>{due.text}</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>{active && <QuestionDetail key={active.id} q={active} onSubmitted={load} />}</div>
        </div>
      )}
    </div>
  );
}

export default function StudentCustomQuestionsPage() {
  return (
    <RequireRole roles={["student"]}>
      <StudentShell>
        <CustomQuestionsListContent />
      </StudentShell>
    </RequireRole>
  );
}
