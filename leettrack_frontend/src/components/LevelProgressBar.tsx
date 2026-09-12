"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type LevelOut = {
  xp: number;
  level: number;
  is_max_level: boolean;
  xp_into_level: number;
  xp_needed_for_level: number;
  progress_fraction: number;
};

const POLL_INTERVAL_MS = 30_000;

// Small pill + progress bar, mounted just left of the feedback pill on
// the student dashboard (see StudentShell.tsx). Links through to the
// Achievements page. See app/api/routers/gamification.py for how
// level/XP are derived from the student's LeetCode-wide solve counts.
export default function LevelProgressBar() {
  const [level, setLevel] = useState<LevelOut | null>(null);

  useEffect(() => {
    function load() {
      api.get<LevelOut>("/api/gamification/level").then(setLevel).catch(() => null);
    }
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (!level) return null;

  const pct = Math.round(level.progress_fraction * 100);

  return (
    <Link
      href="/achievements"
      title={
        level.is_max_level
          ? `Level ${level.level} — all levels cleared (${level.xp} XP)`
          : `Level ${level.level} — ${level.xp_into_level}/${level.xp_needed_for_level} XP to next level`
      }
      className="glass rounded-2xl p-1.5 flex items-center gap-2 h-9 px-3 hover:brightness-110 transition"
    >
      <span className="text-xs font-display font-medium text-text-secondary shrink-0">
        Lv {level.level}
      </span>
      <div className="relative w-16 h-1.5 rounded-full bg-white/10 overflow-hidden flex">
        <div
          className="h-full rounded-full bg-white/60"
          style={{ width: `${level.is_max_level ? 100 : pct}%` }}
        />
        {/* Segment ticks — purely visual, evenly spaced regardless of
            the actual XP-per-segment (that varies level to level). */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex-1 border-r border-[#08080B]/70 last:border-r-0" />
          ))}
        </div>
      </div>
      {!level.is_max_level && (
        <span className="text-[10px] text-text-muted shrink-0">
          {level.xp_into_level}/{level.xp_needed_for_level}
        </span>
      )}
    </Link>
  );
}
