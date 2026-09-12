"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
import { api, ApiError } from "@/lib/api";

type Dashboard = {
  full_name: string;
  section: string | null;
  leetcode_username: string | null;
  current_streak: number;
  problems_solved: number;
  assignment_completion_rate: number;
  today_assignment_id: number | null;
};

type AssignmentStatus = {
  assignment_id: number;
  problem_title: string;
  leetcode_url: string;
  difficulty: string;
  tags: string[];
  problem_score: number;
  notes: string;
  hint: string;
  release_time: string;
  deadline: string;
  status: "not_started" | "attempted" | "accepted" | "missed";
  total_attempts: number;
  accepted_at: string | null;
  score: number;
  allow_ai_help: boolean;
};

const difficultyColor: Record<string, string> = {
  Easy: "text-accepted",
  Medium: "text-brand-live",
  Hard: "text-danger",
};

function DashboardContent() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [assignments, setAssignments] = useState<AssignmentStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [connectInput, setConnectInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Dashboard>("/api/students/me/dashboard"),
      api.get<AssignmentStatus[]>("/api/students/me/assignments"),
    ])
      .then(([d, a]) => {
        setDashboard(d);
        setAssignments(a);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load your dashboard.")
      )
      .finally(() => setLoading(false));
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnectError(null);
    setConnecting(true);
    try {
      await api.patch("/api/students/me/settings", { leetcode_username: connectInput.trim() });
      setDashboard((prev) => (prev ? { ...prev, leetcode_username: connectInput.trim() } : prev));
    } catch (err) {
      setConnectError(err instanceof ApiError ? err.message : "Couldn't connect that account.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const result = await api.post<{ checked: number; newly_accepted: number }>(
        "/api/students/me/refresh-submissions"
      );
      setRefreshMessage(
        result.newly_accepted > 0
          ? `Nice: ${result.newly_accepted} new solve${result.newly_accepted > 1 ? "s" : ""} synced.`
          : "No new solves found yet."
      );
      const [d, a] = await Promise.all([
        api.get<Dashboard>("/api/students/me/dashboard"),
        api.get<AssignmentStatus[]>("/api/students/me/assignments"),
      ]);
      setDashboard(d);
      setAssignments(a);
    } catch (err) {
      setRefreshMessage(err instanceof ApiError ? err.message : "Couldn't check right now.");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-24 text-center text-text-secondary text-sm">
        Loading your dashboard…
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="px-4 py-24 text-center text-danger text-sm">
        {error || "Something went wrong."}
      </div>
    );
  }

  const now = Date.now();
  const upcoming = assignments
    .filter((a) => a.status !== "accepted" && new Date(a.deadline).getTime() > now)
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  const todayAssignment = upcoming[0] ?? null;

  const recentActivity = [...assignments]
    .filter((a) => a.accepted_at)
    .sort((a, b) => new Date(b.accepted_at!).getTime() - new Date(a.accepted_at!).getTime())
    .slice(0, 5);

  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const solved = assignments.some(
      (a) => a.accepted_at && new Date(a.accepted_at).toDateString() === d.toDateString()
    );
    return { day: d.toLocaleDateString(undefined, { weekday: "short" }), solved };
  });

  return (
    <div className="px-2 pb-16 max-w-[1200px] mx-auto">
      <div className="mb-8">
        <h1 className="font-display font-semibold text-2xl">
          Welcome back {dashboard.full_name.split(" ")[0]}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {dashboard.section ?? "No section yet"}
        </p>
      </div>

      {!dashboard.leetcode_username && (
        <form
          onSubmit={handleConnect}
          className="flex flex-wrap items-center gap-2.5 mb-6 text-sm glass rounded-xl px-4 py-3 border border-brand-live-25"
        >
          <span className="text-brand-live font-medium shrink-0">Connect LeetCode:</span>
          <input
            value={connectInput}
            onChange={(e) => setConnectInput(e.target.value)}
            placeholder="your-leetcode-username"
            required
            className="flex-1 min-w-[160px] bg-transparent border-b border-white/15 outline-none text-text-primary placeholder:text-text-muted py-0.5"
          />
          <button
            type="submit"
            disabled={connecting}
            className="bg-brand-live text-[#0A0A0C] font-medium text-xs px-3.5 py-1.5 rounded-lg disabled:opacity-60 shrink-0"
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
          {connectError && <p className="w-full text-danger text-xs">{connectError}</p>}
          {!connectError && (
            <p className="w-full text-text-secondary text-xs">
              Nothing gets scored until this is set.
            </p>
          )}
        </form>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Problems solved" value={String(dashboard.problems_solved)} />
        <StatCard label="Completion rate" value={`${dashboard.assignment_completion_rate}%`} />
        <StatCard label="Assignments" value={String(assignments.length)} />
        <StatCard label="Current streak" value={`${dashboard.current_streak}d`} />
      </div>

      <div className="grid md:grid-cols-3 gap-6" id="assignment">
        <section className="md:col-span-2 glass rounded-2xl p-7">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-3">
            {todayAssignment ? "Next up" : "All caught up"}
          </p>

          {todayAssignment ? (
            <>
              <h2 className="font-display font-medium text-lg mb-2">
                {todayAssignment.problem_title}
              </h2>
              <div className="flex items-center gap-3 text-sm mb-4 flex-wrap">
                <span className={difficultyColor[todayAssignment.difficulty]}>
                  {todayAssignment.difficulty}
                </span>
                <span className="text-text-muted">·</span>
                <span className="text-text-secondary">
                  {todayAssignment.tags.join(", ") || "None"}
                </span>
                <span className="text-text-muted">·</span>
                <span className="text-text-secondary">{todayAssignment.problem_score} pts</span>
              </div>
              <p className="text-xs text-text-muted mb-4 -mt-2">
                Base marks: solve fast, early, and on a streak to earn more than the pts shown above.
              </p>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm text-text-muted">
                  Due{" "}
                  {new Date(todayAssignment.deadline).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    title="Solved it? Check for the update here — this can take a few seconds since it looks it up on LeetCode."
                    className="glass text-text-secondary text-sm px-3.5 py-2.5 rounded-lg disabled:opacity-60"
                  >
                    {refreshing ? "Checking…" : "Check for updates"}
                  </button>
                  <a
                    href={todayAssignment.leetcode_url}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-5 py-2.5 rounded-lg"
                  >
                    Solve on LeetCode
                  </a>
                </div>
              </div>

              {refreshMessage && (
                <p className="text-xs text-text-muted mt-2">{refreshMessage}</p>
              )}

              {(todayAssignment.notes || todayAssignment.hint) && (
                <div className="mt-4 pt-4 border-t border-white/10 space-y-2.5">
                  {todayAssignment.notes && (
                    <div>
                      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">
                        Teacher&apos;s notes
                      </p>
                      <p className="text-sm text-text-secondary whitespace-pre-wrap">
                        {todayAssignment.notes}
                      </p>
                    </div>
                  )}
                  {todayAssignment.hint && (
                    <div>
                      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">
                        Hint
                      </p>
                      <p className="text-sm text-text-secondary whitespace-pre-wrap">
                        {todayAssignment.hint}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {todayAssignment.allow_ai_help && (
                <a
                  href="/ai-chat"
                  className="inline-block mt-3 text-xs text-brand-live hover:underline"
                >
                  Ask the AI assistant about this problem →
                </a>
              )}
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              Nothing pending right now: check back when your teacher assigns something new.
            </p>
          )}

          <div className="mt-6 pt-6 border-t border-white/10">
            <p className="text-xs text-text-muted uppercase tracking-wide mb-3">This week</p>
            <div className="flex gap-2">
              {weekDays.map((d, i) => (
                <div key={i} className="flex-1 text-center">
                  <div
                    className={`h-10 rounded-md mb-1.5 ${d.solved ? "bg-brand-live" : "bg-white/10"}`}
                  />
                  <span className="text-xs text-text-muted">{d.day}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass rounded-2xl p-7">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-3">
            Recent activity
          </p>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing solved yet: go get your first one.</p>
          ) : (
            <ul className="space-y-3">
              {recentActivity.map((a) => (
                <li key={a.assignment_id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="text-text-primary">{a.problem_title}</p>
                    <p className="text-xs text-text-muted">
                      {new Date(a.accepted_at!).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-accepted text-xs">+{a.score.toFixed(0)} pts</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-6 glass rounded-2xl p-7">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">
          Upcoming deadlines
        </p>
        {upcoming.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing on the horizon.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {upcoming.slice(0, 5).map((a) => (
              <li key={a.assignment_id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm text-text-primary">{a.problem_title}</p>
                  <p className="text-xs text-text-muted">{a.difficulty}</p>
                </div>
                <span className="text-sm text-text-secondary">
                  {new Date(a.deadline).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function Dashboard() {
  return (
    <RequireRole roles={["student"]}>
      <StudentShell showTopWidgets>
        <DashboardContent />
      </StudentShell>
    </RequireRole>
  );
}
