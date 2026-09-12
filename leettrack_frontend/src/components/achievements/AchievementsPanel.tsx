"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { achievementIcon } from "@/lib/achievementIcons";

type Achievement = {
  key: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlocked_at: string | null;
  status: "unlocked" | "next" | "locked";
  hint: string;
};

export default function AchievementsPanel() {
  const [items, setItems] = useState<Achievement[] | null>(null);

  useEffect(() => {
    api.get<Achievement[]>("/api/gamification/achievements").then(setItems).catch(() => setItems([]));
  }, []);

  if (!items) {
    return <p className="text-sm text-text-muted py-10 text-center">Loading achievements…</p>;
  }

  const unlocked = items.filter((a) => a.status === "unlocked");
  const next = items.filter((a) => a.status === "next");
  const locked = items.filter((a) => a.status === "locked");

  return (
    <div className="space-y-6">
      {unlocked.length > 0 && (
        <Section title={`Unlocked (${unlocked.length}/${items.length})`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {unlocked.map((a) => (
              <AchievementCard key={a.key} a={a} />
            ))}
          </div>
        </Section>
      )}

      {next.length > 0 && (
        <Section title="Up next">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {next.map((a) => (
              <AchievementCard key={a.key} a={a} />
            ))}
          </div>
        </Section>
      )}

      {locked.length > 0 && (
        <Section title="Locked">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {locked.map((a) => (
              <AchievementCard key={a.key} a={a} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-text-muted uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  );
}

function AchievementCard({ a }: { a: Achievement }) {
  const locked = a.status === "locked";
  const next = a.status === "next";

  return (
    <div
      className={`glass rounded-2xl p-4 flex items-start gap-3 ${
        a.unlocked ? "border border-brand-live-30" : ""
      }`}
    >
      <div
        className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${
          locked ? "bg-white/5 grayscale opacity-50" : "bg-brand-live-15"
        }`}
      >
        {locked ? "🔒" : achievementIcon(a.icon)}
      </div>
      <div className="min-w-0">
        <p className={`font-display font-medium text-sm ${locked ? "text-text-muted" : "text-text-primary"}`}>
          {locked ? "???" : a.title}
        </p>
        <p className="text-xs text-text-muted mt-0.5">{locked ? a.hint : a.description}</p>
        {a.unlocked && a.unlocked_at && (
          <p className="text-[10px] text-accepted mt-1.5">
            Unlocked {new Date(a.unlocked_at).toLocaleDateString()}
          </p>
        )}
        {next && <p className="text-[10px] text-brand-live mt-1.5">Next up — {a.hint}</p>}
      </div>
    </div>
  );
}
