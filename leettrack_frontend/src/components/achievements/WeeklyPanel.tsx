"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Digest = {
  week_start: string;
  goal_target_type: "problems" | "xp" | null;
  goal_target_value: number | null;
  goal_progress: number;
  goal_met: boolean;
  problems_solved_this_week: number;
  xp_earned_this_week: number;
  leaderboard_topper_name: string | null;
  leaderboard_topper_score: number | null;
  my_rank: number | null;
  my_score: number | null;
  class_size: number;
};

export default function WeeklyPanel() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [targetType, setTargetType] = useState<"problems" | "xp">("problems");
  const [targetValue, setTargetValue] = useState("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Digest>("/api/gamification/weekly").then((d) => {
      setDigest(d);
      if (d.goal_target_type) setTargetType(d.goal_target_type);
      if (d.goal_target_value) setTargetValue(String(d.goal_target_value));
    });
  }

  useEffect(load, []);

  async function handleSetGoal(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(targetValue);
    if (!value || value <= 0) return;
    setError(null);
    setSaving(true);
    try {
      const d = await api.post<Digest>("/api/gamification/weekly/goal", {
        target_type: targetType,
        target_value: value,
      });
      setDigest(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that goal.");
    } finally {
      setSaving(false);
    }
  }

  if (!digest) {
    return <p className="text-sm text-text-muted py-10 text-center">Loading this week…</p>;
  }

  const progressPct = digest.goal_target_value
    ? Math.min(100, Math.round((digest.goal_progress / digest.goal_target_value) * 100))
    : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Weekly goal */}
      <div className="glass rounded-2xl p-5">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">
          Weekly goal — week of {digest.week_start}
        </p>

        {digest.goal_target_type ? (
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-text-primary">
                {digest.goal_progress}/{digest.goal_target_value}{" "}
                {digest.goal_target_type === "problems" ? "problems" : "XP"}
              </span>
              <span className={digest.goal_met ? "text-accepted" : "text-text-muted"}>
                {digest.goal_met ? "Goal met! 🎉" : `${progressPct}%`}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${digest.goal_met ? "bg-accepted" : "bg-brand-live"}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted mb-4">No goal set for this week yet.</p>
        )}

        <form onSubmit={handleSetGoal} className="flex items-center gap-2 flex-wrap">
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as "problems" | "xp")}
            className="glass rounded-lg px-2.5 py-2 text-sm outline-none"
          >
            <option value="problems">Problems solved</option>
            <option value="xp">XP earned</option>
          </select>
          <input
            type="number"
            min={1}
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            className="glass rounded-lg px-3 py-2 text-sm outline-none w-24"
          />
          <button
            type="submit"
            disabled={saving}
            className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-3.5 py-2 rounded-lg disabled:opacity-60"
          >
            {digest.goal_target_type ? "Update goal" : "Set goal"}
          </button>
        </form>
        {error && <p className="text-xs text-danger mt-2">{error}</p>}
      </div>

      {/* Weekly digest */}
      <div className="glass rounded-2xl p-5">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Weekly digest</p>
        <div className="space-y-2.5 text-sm">
          <DigestRow label="Problems solved this week" value={String(digest.problems_solved_this_week)} />
          <DigestRow label="XP earned this week" value={String(digest.xp_earned_this_week)} />
          <DigestRow
            label="Your rank this week"
            value={digest.my_rank ? `#${digest.my_rank} of ${digest.class_size}` : "Unranked"}
          />
          <DigestRow
            label="Your score this week"
            value={digest.my_score != null ? digest.my_score.toFixed(1) : "—"}
          />
          <div className="h-px bg-white/10 my-1" />
          <DigestRow
            label="Leaderboard topper"
            value={digest.leaderboard_topper_name ?? "—"}
          />
          <DigestRow
            label="Topper's score"
            value={digest.leaderboard_topper_score != null ? digest.leaderboard_topper_score.toFixed(1) : "—"}
          />
        </div>
      </div>
    </div>
  );
}

function DigestRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}
