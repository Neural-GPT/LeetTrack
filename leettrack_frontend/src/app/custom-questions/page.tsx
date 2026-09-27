"use client";

import { useEffect, useState } from "react";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
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

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not started", color: "text-text-muted" },
  submitted: { label: "Submitted — awaiting review", color: "text-brand-live" },
  graded: { label: "Graded", color: "text-accepted" },
};

function QuestionDetail({ q, onSubmitted }: { q: MyQuestion; onSubmitted: () => void }) {
  const [code, setCode] = useState(q.my_code);
  const [language, setLanguage] = useState(q.my_language || "python");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const locked = q.submission_status === "graded";
  const overdue = new Date(q.deadline).getTime() < Date.now();

  async function submit() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/api/custom-questions/my/${q.id}/submit`, { code, language });
      setSuccess("Submitted — your teacher will review it.");
      onSubmitted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit right now.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-6 space-y-4">
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-display font-semibold text-lg text-text-primary">{q.title}</h2>
          <span className={`text-xs font-medium ${STATUS_STYLE[q.submission_status].color}`}>
            {STATUS_STYLE[q.submission_status].label}
          </span>
        </div>
        <p className="text-xs text-text-muted mt-1">
          Due {new Date(q.deadline).toLocaleString()} · out of {q.max_score} points
        </p>
      </div>

      <p className="text-sm text-text-secondary whitespace-pre-wrap">{q.description}</p>
      {q.constraints && (
        <div className="glass rounded-lg p-3.5">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-1.5">Constraints / examples</p>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{q.constraints}</p>
        </div>
      )}

      {q.submission_status === "graded" && (
        <div className="glass rounded-lg p-3.5">
          <p className="text-sm text-text-primary font-medium mb-1">
            Score: {q.manual_score}/{q.max_score}
          </p>
          {q.manual_feedback && <p className="text-sm text-text-secondary">{q.manual_feedback}</p>}
        </div>
      )}

      {!locked && (
        <>
          <div className="flex items-center gap-2">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="glass rounded-lg px-2.5 py-1.5 text-xs outline-none">
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="cpp">C++</option>
              <option value="javascript">JavaScript</option>
            </select>
            {overdue && <span className="text-xs text-danger">Deadline has passed — your teacher may still accept this.</span>}
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Write your solution here…"
            spellCheck={false}
            className="w-full h-64 glass rounded-xl px-3.5 py-3 text-sm font-mono outline-none resize-y focus:border-[var(--color-brand)]"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={submit}
              disabled={submitting || !code.trim()}
              className="px-4 py-2 rounded-lg bg-brand-live text-[#0A0A0C] text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Submitting…" : q.submission_status === "submitted" ? "Resubmit" : "Submit"}
            </button>
            {error && <p className="text-sm text-danger">{error}</p>}
            {success && <p className="text-sm text-accepted">{success}</p>}
          </div>
        </>
      )}
    </div>
  );
}

function CustomQuestionsListContent() {
  const [questions, setQuestions] = useState<MyQuestion[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  function load() {
    api
      .get<MyQuestion[]>("/api/custom-questions/my/list")
      .then((qs) => {
        setQuestions(qs);
        if (activeId === null && qs.length > 0) setActiveId(qs[0].id);
      })
      .catch(() => setQuestions([]));
  }
  useEffect(load, []);

  const active = questions?.find((q) => q.id === activeId) ?? null;

  return (
    <div className="max-w-5xl mx-auto pb-14">
      <h1 className="font-display font-semibold text-2xl text-text-primary mb-1">Custom Questions</h1>
      <p className="text-sm text-text-muted mb-6">Problems your teacher wrote themselves — write your own code and submit for review.</p>

      {questions === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : questions.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <p className="text-sm text-text-secondary">No custom questions assigned yet.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-[220px_1fr] gap-5">
          <div className="space-y-2">
            {questions.map((q) => (
              <button
                key={q.id}
                onClick={() => setActiveId(q.id)}
                className={`w-full text-left glass rounded-lg px-3.5 py-2.5 text-sm transition-colors ${
                  activeId === q.id ? "bg-brand-live-15" : "hover:bg-white/5"
                }`}
              >
                <p className="text-text-primary truncate">{q.title}</p>
                <p className={`text-xs mt-0.5 ${STATUS_STYLE[q.submission_status].color}`}>
                  {STATUS_STYLE[q.submission_status].label}
                </p>
              </button>
            ))}
          </div>
          <div>{active && <QuestionDetail q={active} onSubmitted={load} />}</div>
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
