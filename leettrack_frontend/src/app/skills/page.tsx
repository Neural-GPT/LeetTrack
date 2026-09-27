"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
import { api, ApiError } from "@/lib/api";

type TagStat = {
  tag: string;
  attempted: number;
  accepted: number;
  completion_rate: number;
  avg_attempts: number;
  avg_score: number;
  mastery: number;
  sample_size_ok: boolean;
};

type WeeklyPoint = { week_start: string; solved: number; avg_score: number };

type PerformanceSummary = {
  total_assigned: number;
  total_accepted: number;
  total_missed: number;
  overall_completion_rate: number;
  avg_score: number;
  current_streak: number;
  max_streak: number;
  weekly_trend: WeeklyPoint[];
  trend_direction: "improving" | "flat" | "slipping";
};

const TREND_LABEL: Record<string, { text: string; color: string }> = {
  improving: { text: "Improving", color: "text-accepted" },
  flat: { text: "Steady", color: "text-text-secondary" },
  slipping: { text: "Slipping", color: "text-danger" },
};

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-1.5">{label}</p>
      <p className="font-display font-semibold text-2xl text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  );
}

function masteryColor(mastery: number): string {
  if (mastery >= 70) return "#2CBB5D";
  if (mastery >= 40) return "#E9A23B";
  return "#E5484D";
}

/** Simple SVG radar/polygon chart — one axis per tag, mastery 0-100 as radius. */
function SkillsRadar({ tags }: { tags: TagStat[] }) {
  const size = 340;
  const center = size / 2;
  const maxRadius = size / 2 - 44;
  const n = tags.length;

  const points = tags.map((t, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = (Math.max(t.mastery, 4) / 100) * maxRadius;
    return { x: center + r * Math.cos(angle), y: center + r * Math.sin(angle), angle, tag: t };
  });
  const polygon = points.map((p) => `${p.x},${p.y}`).join(" ");
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      {rings.map((f) => (
        <polygon
          key={f}
          points={Array.from({ length: n }, (_, i) => {
            const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
            return `${center + f * maxRadius * Math.cos(angle)},${center + f * maxRadius * Math.sin(angle)}`;
          }).join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={1}
        />
      ))}
      {points.map((p, i) => (
        <line
          key={i}
          x1={center}
          y1={center}
          x2={center + maxRadius * Math.cos(p.angle)}
          y2={center + maxRadius * Math.sin(p.angle)}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={1}
        />
      ))}
      <polygon points={polygon} fill="color-mix(in srgb, var(--color-brand) 22%, transparent)" stroke="var(--color-brand)" strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={masteryColor(p.tag.mastery)} />
      ))}
      {points.map((p, i) => {
        const labelR = maxRadius + 22;
        const lx = center + labelR * Math.cos(p.angle);
        const ly = center + labelR * Math.sin(p.angle);
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            fontSize={10.5}
            fill="var(--color-text-secondary, #9BA1AC)"
            textAnchor={Math.abs(Math.cos(p.angle)) < 0.2 ? "middle" : Math.cos(p.angle) > 0 ? "start" : "end"}
            dominantBaseline="middle"
          >
            {p.tag.tag.length > 16 ? p.tag.tag.slice(0, 15) + "…" : p.tag.tag}
          </text>
        );
      })}
    </svg>
  );
}

function WeeklyTrendChart({ points }: { points: WeeklyPoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-text-muted">Not enough recent activity to chart a trend yet.</p>;
  }
  const max = Math.max(1, ...points.map((p) => p.solved));
  const width = Math.max(280, points.length * 46);
  const height = 120;
  const barWidth = 26;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height + 24} viewBox={`0 0 ${width} ${height + 24}`}>
        {points.map((p, i) => {
          const h = (p.solved / max) * height;
          const x = i * 46 + 10;
          return (
            <g key={p.week_start}>
              <rect
                x={x}
                y={height - h}
                width={barWidth}
                height={Math.max(h, 2)}
                rx={4}
                fill="var(--color-brand)"
                opacity={0.85}
              />
              <text x={x + barWidth / 2} y={height + 14} fontSize={9.5} textAnchor="middle" fill="var(--color-text-muted, #6B7280)">
                {new Date(p.week_start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </text>
              <text x={x + barWidth / 2} y={height - h - 5} fontSize={10} textAnchor="middle" fill="var(--color-text-primary, #E7E9EA)">
                {p.solved}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SkillsContent() {
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [graph, setGraph] = useState<TagStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [suggestions, setSuggestions] = useState<string | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<PerformanceSummary>("/api/student-analytics/performance-summary"),
      api.get<TagStat[]>("/api/student-analytics/skills-graph"),
    ])
      .then(([s, g]) => {
        setSummary(s);
        setGraph(g);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your analytics."))
      .finally(() => setLoading(false));
  }, []);

  const weakSkills = useMemo(() => {
    if (!graph) return [];
    const confident = graph.filter((t) => t.sample_size_ok);
    return (confident.length ? confident : graph).slice(0, 5);
  }, [graph]);

  async function generateSuggestions() {
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      const res = await api.post<{ suggestions: string }>("/api/student-analytics/ai-suggestions");
      setSuggestions(res.suggestions);
    } catch (e) {
      setSuggestionsError(e instanceof ApiError ? e.message : "Couldn't generate suggestions right now.");
    } finally {
      setSuggestionsLoading(false);
    }
  }

  if (loading) {
    return <div className="px-2 py-24 text-center text-text-secondary text-sm">Loading your skills…</div>;
  }
  if (error || !summary || !graph) {
    return <div className="px-2 py-24 text-center text-danger text-sm">{error ?? "Something went wrong."}</div>;
  }

  const trend = TREND_LABEL[summary.trend_direction] ?? TREND_LABEL.flat;

  return (
    <div className="max-w-5xl mx-auto pb-14">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-2xl text-text-primary mb-1">
            Skills &amp; Performance
          </h1>
          <p className="text-sm text-text-muted">
            Where you stand across topics, and what to work on next — based on your assigned submissions.
          </p>
        </div>
        <Link
          href="/contest"
          className="glass rounded-xl px-4 py-2.5 text-sm font-medium text-brand-live hover:bg-white/5 transition-colors shrink-0"
        >
          Start a Contest Simulator →
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Completion rate" value={`${summary.overall_completion_rate}%`} sub={`${summary.total_accepted}/${summary.total_assigned} solved`} />
        <StatCard label="Avg score / solve" value={summary.avg_score} />
        <StatCard label="Streak" value={`${summary.current_streak}d`} sub={`Best: ${summary.max_streak}d`} />
        <StatCard label="Trend (last 8 wks)" value={trend.text} />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <section className="glass rounded-2xl p-6">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-4">DSA skills graph</p>
          {graph.length === 0 ? (
            <p className="text-sm text-text-muted">
              No assigned submissions yet — once you've attempted a few assignments, your topic breakdown shows up here.
            </p>
          ) : (
            <SkillsRadar tags={graph.slice(0, 8)} />
          )}
        </section>

        <section className="glass rounded-2xl p-6">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-4">Weekly solved</p>
          <WeeklyTrendChart points={summary.weekly_trend} />
        </section>
      </div>

      <section className="glass rounded-2xl p-6 mb-6">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-4">Weakest topics</p>
        {weakSkills.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing to show yet.</p>
        ) : (
          <div className="space-y-3">
            {weakSkills.map((t) => (
              <div key={t.tag} className="flex items-center gap-3">
                <span className="text-sm text-text-primary w-36 shrink-0 truncate" title={t.tag}>
                  {t.tag}
                </span>
                <div className="flex-1 h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(t.mastery, 3)}%`, background: masteryColor(t.mastery) }}
                  />
                </div>
                <span className="text-xs text-text-muted w-32 text-right shrink-0">
                  {t.sample_size_ok ? `${t.completion_rate}% · ${t.attempted} tries` : "not enough data yet"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-text-muted uppercase tracking-wide">AI improvement suggestions</p>
          <button
            onClick={generateSuggestions}
            disabled={suggestionsLoading}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-live text-[#0A0A0C] disabled:opacity-50"
          >
            {suggestionsLoading ? "Thinking…" : suggestions ? "Regenerate" : "Generate suggestions"}
          </button>
        </div>
        {suggestionsError && <p className="text-sm text-danger">{suggestionsError}</p>}
        {suggestions ? (
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{suggestions}</p>
        ) : (
          !suggestionsError && (
            <p className="text-sm text-text-muted">
              Generate a short, personalized read on your recent performance and what to focus on next.
            </p>
          )
        )}
      </section>
    </div>
  );
}

export default function SkillsPage() {
  return (
    <RequireRole roles={["student"]}>
      <StudentShell>
        <SkillsContent />
      </StudentShell>
    </RequireRole>
  );
}
