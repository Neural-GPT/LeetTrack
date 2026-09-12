"use client";

import { useState } from "react";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
import ProgressPanel from "@/components/achievements/ProgressPanel";
import AchievementsPanel from "@/components/achievements/AchievementsPanel";
import WeeklyPanel from "@/components/achievements/WeeklyPanel";

type Tab = "progress" | "achievements" | "weekly";

const TABS: { key: Tab; label: string }[] = [
  { key: "progress", label: "Progress" },
  { key: "achievements", label: "Achievements" },
  { key: "weekly", label: "Weekly Goals & Digest" },
];

function AchievementsContent() {
  const [tab, setTab] = useState<Tab>("progress");

  return (
    <div className="max-w-5xl mx-auto pb-10">
      <h1 className="font-display font-semibold text-2xl text-text-primary mb-1">
        Achievements
      </h1>
      <p className="text-sm text-text-muted mb-6">
        Level up by solving LeetCode problems.
      </p>

      <div className="glass rounded-2xl p-1.5 flex items-center gap-1 mb-6 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-brand-live text-[#0A0A0C]"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "progress" && <ProgressPanel />}
      {tab === "achievements" && <AchievementsPanel />}
      {tab === "weekly" && <WeeklyPanel />}
    </div>
  );
}

export default function AchievementsPage() {
  return (
    <RequireRole roles={["student"]}>
      <StudentShell>
        <AchievementsContent />
      </StudentShell>
    </RequireRole>
  );
}
