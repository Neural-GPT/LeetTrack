"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import BackgroundVideo from "@/components/BackgroundVideo";
import RequireRole from "@/components/RequireRole";
import { api, ApiError } from "@/lib/api";

type SectionOverview = {
  section_id: number | null;
  student_count: number;
  avg_completion_rate: number;
  avg_score: number;
};
type HardestAssignment = {
  assignment_id: number;
  problem_title: string;
  target_count: number;
  accepted_count: number;
  completion_rate: number;
  avg_attempts: number;
};
type TopicWeakness = { tag: string; assignments_count: number; avg_completion_rate: number };
type AtRiskStudent = {
  student_id: number;
  full_name: string;
  current_streak: number;
  problems_solved: number;
  last_active: string | null;
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-4">{title}</p>
      {children}
    </section>
  );
}

function AnalyticsContent() {
  const [sections, setSections] = useState<SectionOverview[]>([]);
  const [hardest, setHardest] = useState<HardestAssignment[]>([]);
  const [topics, setTopics] = useState<TopicWeakness[]>([]);
  const [atRisk, setAtRisk] = useState<AtRiskStudent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<SectionOverview[]>("/api/analytics/section-overview"),
      api.get<HardestAssignment[]>("/api/analytics/hardest-assignments"),
      api.get<TopicWeakness[]>("/api/analytics/topic-weaknesses"),
      api.get<AtRiskStudent[]>("/api/analytics/at-risk-students"),
    ])
      .then(([s, h, t, r]) => {
        setSections(s);
        setHardest(h);
        setTopics(t);
        setAtRisk(r);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load analytics.")
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="px-14 py-24 text-center text-text-secondary text-sm">Loading…</div>;
  }
  if (error) {
    return <div className="px-14 py-24 text-center text-danger text-sm">{error}</div>;
  }

  return (
    <div className="px-14 pb-16 max-w-[1200px] mx-auto">
      <h1 className="font-display font-semibold text-2xl mb-1">Class analytics</h1>
      <p className="text-sm text-text-secondary mb-8">How your sections are actually doing.</p>

      <div className="grid md:grid-cols-2 gap-6">
        <Panel title="Section overview">
          {sections.length === 0 ? (
            <p className="text-sm text-text-muted">No student data yet.</p>
          ) : (
            <ul className="space-y-3">
              {sections.map((s) => (
                <li
                  key={s.section_id ?? "none"}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-text-primary">
                    Section {s.section_id ?? "—"} · {s.student_count} students
                  </span>
                  <span className="text-text-secondary">
                    {s.avg_completion_rate}% complete · {s.avg_score} avg pts
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Hardest assignments">
          {hardest.length === 0 ? (
            <p className="text-sm text-text-muted">No assignments with submissions yet.</p>
          ) : (
            <ul className="space-y-3">
              {hardest.map((h) => (
                <li key={h.assignment_id} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{h.problem_title}</span>
                  <span className="text-danger">{h.completion_rate}%</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Topic weaknesses">
          {topics.length === 0 ? (
            <p className="text-sm text-text-muted">Not enough data yet.</p>
          ) : (
            <ul className="space-y-3">
              {topics.map((t) => (
                <li key={t.tag} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{t.tag}</span>
                  <span className="text-text-secondary">{t.avg_completion_rate}%</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="At-risk students">
          {atRisk.length === 0 ? (
            <p className="text-sm text-text-muted">Nobody's below the threshold right now.</p>
          ) : (
            <ul className="space-y-3">
              {atRisk.map((s) => (
                <li key={s.student_id} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{s.full_name}</span>
                  <span className="text-text-secondary">{s.problems_solved} solved</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <RequireRole roles={["teacher", "super_admin"]}>
      <main className="min-h-screen">
        <BackgroundVideo />
        <Nav />
        <AnalyticsContent />
      </main>
    </RequireRole>
  );
}
