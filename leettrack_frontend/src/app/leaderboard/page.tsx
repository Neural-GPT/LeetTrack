"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import BackgroundVideo from "@/components/BackgroundVideo";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";

type Entry = {
  rank: number;
  student_id: number;
  full_name: string;
  score: number;
  total_problems_solved: number;
  assignments_completed: number;
};

const rankColor: Record<number, string> = {
  1: "text-brand-live",
  2: "text-text-primary",
  3: "text-[#CD7F32]",
};

function LeaderboardContent() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [timeRange, setTimeRange] = useState<"overall" | "last_two_weeks">("overall");
  const [rankingBasis, setRankingBasis] = useState<"assignment_score" | "leetcode_score">(
    "assignment_score"
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<Entry[]>(
        `/api/leaderboard?scope=overall&time_range=${timeRange}&ranking_basis=${rankingBasis}`
      )
      .then(setEntries)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load the leaderboard.")
      )
      .finally(() => setLoading(false));
  }, [timeRange, rankingBasis]);

  return (
    <div className="px-6 pb-16 max-w-[920px] mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-display font-semibold text-2xl">Leaderboard</h1>
          <p className="text-sm text-text-secondary mt-1">Where everyone stands right now.</p>
        </div>

        <div className="flex gap-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as typeof timeRange)}
            className="glass rounded-lg px-3 py-2 text-sm outline-none"
          >
            <option value="overall">All time</option>
            <option value="last_two_weeks">Last 2 weeks</option>
          </select>
          <select
            value={rankingBasis}
            onChange={(e) => setRankingBasis(e.target.value as typeof rankingBasis)}
            className="glass rounded-lg px-3 py-2 text-sm outline-none"
          >
            <option value="assignment_score">Assignment Score</option>
            <option value="leetcode_score">LeetCode Score</option>
          </select>
        </div>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-text-secondary text-center py-12">Loading…</p>
        ) : error ? (
          <p className="text-sm text-danger text-center py-12">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-12">
            No one&apos;s on the board yet: be the first to solve something.
          </p>
        ) : (
          <ul className="divide-y divide-white/10">
            {entries.map((e) => (
              <li key={e.student_id} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                  <span
                    className={`font-display font-semibold w-8 text-center ${
                      rankColor[e.rank] ?? "text-text-secondary"
                    }`}
                  >
                    #{e.rank}
                  </span>
                  <div>
                    <p className="text-sm text-text-primary">{e.full_name}</p>
                    <p className="text-xs text-text-muted">
                      {e.assignments_completed} assignments completed
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-text-muted" title="Total LeetCode problems solved">
                    {e.total_problems_solved} solved
                  </span>
                  <span className="font-display text-sm text-brand-live">
                    {e.score.toFixed(0)} pts
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <RequireRole roles={["student", "teacher", "super_admin"]}>
      <LeaderboardChrome />
    </RequireRole>
  );
}

function LeaderboardChrome() {
  const { role } = useAuth();

  if (role === "student") {
    return (
      <StudentShell>
        <LeaderboardContent />
      </StudentShell>
    );
  }

  return (
    <main className="min-h-screen">
      <BackgroundVideo />
      <Nav />
      <LeaderboardContent />
    </main>
  );
}
