"use client";

import { useEffect, useRef, useState } from "react";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
import { api, ApiError } from "@/lib/api";

type ContestProblem = {
  attempt_id: number;
  problem_title: string;
  leetcode_url: string;
  difficulty: string;
  tags: string;
  skill_tag: string;
  started_at: string;
  deadline_at: string;
  time_limit_seconds: number;
};

type ContestResult = {
  attempt_id: number;
  status: string;
  score: number | null;
  verdict: string;
  complexity_estimate: string;
  feedback: string;
  time_taken_seconds: number | null;
};

type HistoryItem = {
  attempt_id: number;
  problem_title: string;
  skill_tag: string;
  difficulty: string;
  status: string;
  score: number | null;
  verdict: string;
  started_at: string;
};

const DIFFICULTY_COLOR: Record<string, string> = {
  Easy: "text-accepted",
  Medium: "text-brand-live",
  Hard: "text-danger",
};

const VERDICT_STYLE: Record<string, { label: string; color: string }> = {
  pass: { label: "Pass", color: "text-accepted" },
  needs_work: { label: "Needs work", color: "text-brand-live" },
  fail: { label: "Fail", color: "text-danger" },
};

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function ContestContent() {
  const [problem, setProblem] = useState<ContestProblem | null>(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [remaining, setRemaining] = useState(0);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ContestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function loadHistory() {
    api
      .get<HistoryItem[]>("/api/student-analytics/contest/history/list")
      .then(setHistory)
      .catch(() => setHistory([]));
  }

  useEffect(() => {
    loadHistory();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function beginTimer(deadlineIso: string) {
    if (timerRef.current) clearInterval(timerRef.current);
    const tick = () => {
      const secs = Math.round((new Date(deadlineIso).getTime() - Date.now()) / 1000);
      setRemaining(secs);
      if (secs <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
  }

  async function startContest() {
    setStarting(true);
    setError(null);
    setResult(null);
    try {
      const p = await api.post<ContestProblem>("/api/student-analytics/contest/start");
      setProblem(p);
      setCode("");
      beginTimer(p.deadline_at);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start a contest right now.");
    } finally {
      setStarting(false);
    }
  }

  async function submitContest() {
    if (!problem) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<ContestResult>(
        `/api/student-analytics/contest/${problem.attempt_id}/submit`,
        { code, language }
      );
      setResult(res);
      if (timerRef.current) clearInterval(timerRef.current);
      loadHistory();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit right now — your code wasn't lost, try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const timeUp = problem !== null && remaining <= 0 && !result;

  return (
    <div className="max-w-4xl mx-auto pb-14">
      <h1 className="font-display font-semibold text-2xl text-text-primary mb-1">Contest Simulator</h1>
      <p className="text-sm text-text-muted mb-6">
        One timed problem, picked from a topic you're weak in. Submitted code is graded by AI against a
        reference solution — not run against real test cases.
      </p>

      {!problem && (
        <section className="glass rounded-2xl p-8 text-center mb-8">
          <p className="text-sm text-text-secondary mb-4">
            Ready when you are — we'll pick one problem from your weakest topic and start the clock.
          </p>
          <button
            onClick={startContest}
            disabled={starting}
            className="px-5 py-2.5 rounded-xl bg-brand-live text-[#0A0A0C] text-sm font-medium disabled:opacity-50"
          >
            {starting ? "Picking a problem…" : "Start Contest"}
          </button>
          {error && <p className="text-sm text-danger mt-3">{error}</p>}
        </section>
      )}

      {problem && (
        <section className="glass rounded-2xl p-6 mb-8">
          <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
            <div>
              <a
                href={problem.leetcode_url}
                target="_blank"
                rel="noreferrer"
                className="font-display font-semibold text-lg text-text-primary hover:text-brand-live"
              >
                {problem.problem_title}
              </a>
              <p className="text-xs text-text-muted mt-1">
                <span className={DIFFICULTY_COLOR[problem.difficulty] ?? ""}>{problem.difficulty}</span>
                {" · targeting "}
                <span className="text-text-secondary">{problem.skill_tag}</span>
              </p>
            </div>
            <div
              className={`font-display font-semibold text-2xl tabular-nums ${
                remaining <= 60 && remaining > 0 ? "text-danger" : "text-text-primary"
              }`}
            >
              {result ? "—" : formatClock(remaining)}
            </div>
          </div>

          {!result && (
            <>
              <div className="flex items-center gap-3 mb-2">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="glass rounded-lg px-2.5 py-1.5 text-xs outline-none"
                >
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="cpp">C++</option>
                  <option value="javascript">JavaScript</option>
                </select>
                {timeUp && <span className="text-xs text-danger">Time's up — submit now or it'll expire.</span>}
              </div>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Write your solution here…"
                spellCheck={false}
                className="w-full h-72 glass rounded-xl px-3.5 py-3 text-sm font-mono outline-none resize-y focus:border-[var(--color-brand)]"
              />
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={submitContest}
                  disabled={submitting || !code.trim()}
                  className="px-4 py-2 rounded-lg bg-brand-live text-[#0A0A0C] text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? "Grading with AI…" : "Submit"}
                </button>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <span className="font-display font-semibold text-3xl text-text-primary">
                  {result.score ?? "—"}
                  <span className="text-sm text-text-muted font-normal">/100</span>
                </span>
                <span className={`text-sm font-medium ${VERDICT_STYLE[result.verdict]?.color ?? "text-text-secondary"}`}>
                  {VERDICT_STYLE[result.verdict]?.label ?? result.verdict}
                </span>
                {result.time_taken_seconds != null && (
                  <span className="text-xs text-text-muted">
                    Solved in {formatClock(result.time_taken_seconds)}
                  </span>
                )}
              </div>
              {result.complexity_estimate && (
                <p className="text-xs text-text-muted">Estimated complexity: {result.complexity_estimate}</p>
              )}
              <p className="text-sm text-text-secondary leading-relaxed">{result.feedback}</p>
              <button
                onClick={() => {
                  setProblem(null);
                  setResult(null);
                }}
                className="text-xs font-medium text-brand-live mt-2"
              >
                Start another contest →
              </button>
            </div>
          )}
        </section>
      )}

      <section className="glass rounded-2xl p-6">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-4">Past attempts</p>
        {!history ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-text-muted">No contest attempts yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {history.map((h) => (
              <li key={h.attempt_id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-text-primary">{h.problem_title}</span>
                  <span className="text-text-muted"> · {h.skill_tag}</span>
                </div>
                <span
                  className={
                    h.status === "graded"
                      ? VERDICT_STYLE[h.verdict]?.color ?? "text-text-secondary"
                      : "text-text-muted"
                  }
                >
                  {h.status === "graded" ? `${h.score}/100 · ${VERDICT_STYLE[h.verdict]?.label ?? h.verdict}` : h.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ContestPage() {
  return (
    <RequireRole roles={["student"]}>
      <StudentShell>
        <ContestContent />
      </StudentShell>
    </RequireRole>
  );
}
