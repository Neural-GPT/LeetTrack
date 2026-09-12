"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, downloadFile } from "@/lib/api";

// ---------------------------------------------------------------------
// Site analytics — Super Admin only. Daily site-usage snapshots
// captured nightly by the `capture-daily-analytics` beat job (see
// services/analytics.py); this panel charts the trend, and lets the
// Super Admin export the history to CSV or purge old rows to keep the
// table small. Separate from the existing teacher-facing
// /api/analytics endpoints (section performance, weak topics, etc.) —
// this is about site usage, not student performance.
//
// Chart is hand-rolled SVG (no charting library in the project) —
// smoothed area/line, gridlines, and a hover tooltip/crosshair, plus a
// dashed "still counting" tail for today's not-yet-final point.
// ---------------------------------------------------------------------

type DailyPoint = {
  date: string;
  unique_visitors: number;
  active_students: number;
  active_teachers: number;
  new_signups: number;
  returning_users: number;
  retention_7d: number | null;
  total_logins: number;
  problems_solved: number;
  is_today: boolean;
};

const RANGE_OPTIONS = [
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

const METRICS: { key: keyof DailyPoint; label: string; color: string }[] = [
  { key: "unique_visitors", label: "Unique visitors", color: "#3B82F6" },
  { key: "new_signups", label: "New signups", color: "#2CBB5D" },
  { key: "total_logins", label: "Logins", color: "#E9A23B" },
  { key: "problems_solved", label: "Submissions", color: "#A78BFA" },
];

function formatShortDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCompact(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

/** Rounds a max value up to a "nice" number so gridlines read cleanly. */
function niceCeil(n: number) {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const fraction = n / base;
  let niceFraction: number;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * base;
}

/** Smoothed path through points via quadratic curves to each midpoint. */
function smoothLinePath(pts: { x: number; y: number }[]) {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    d += ` Q ${p0.x} ${p0.y} ${midX} ${midY}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

const VB_W = 700;
const VB_H = 220;
const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 26;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

function TrendChart({
  points,
  metricKey,
  color,
}: {
  points: DailyPoint[];
  metricKey: keyof DailyPoint;
  color: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const gradientId = `site-analytics-grad-${metricKey}`;

  const values = points.map((p) => Number(p[metricKey]) || 0);
  const rawMax = Math.max(1, ...values);
  const niceMax = niceCeil(rawMax * 1.15);
  const n = points.length;

  const xAt = (i: number) => PAD_L + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const yAt = (v: number) => PAD_T + (1 - (niceMax <= 0 ? 0 : v / niceMax)) * PLOT_H;

  const coords = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
  const baseline = PAD_T + PLOT_H;

  // Split into "settled" history vs. today's still-accumulating tail so
  // the last segment can render dashed/dimmer, matching the old bar
  // chart's "so far today" affordance.
  const todayStartIdx = points.findIndex((p) => p.is_today);
  const splitIdx = todayStartIdx > 0 ? todayStartIdx : n - 1;

  const pastCoords = coords.slice(0, splitIdx + 1);
  const tailCoords = coords.slice(Math.max(splitIdx, 0));

  const pastLinePath = smoothLinePath(pastCoords);
  const tailLinePath = tailCoords.length > 1 ? smoothLinePath(tailCoords) : "";

  const areaPath =
    coords.length > 0
      ? `${smoothLinePath(coords)} L ${coords[coords.length - 1].x} ${baseline} L ${coords[0].x} ${baseline} Z`
      : "";

  const gridFracs = [0, 0.25, 0.5, 0.75, 1];

  // ~6 evenly-spaced x-axis labels, always including the last (today).
  const labelStep = Math.max(1, Math.round((n - 1) / 5) || 1);
  const labelIndices = new Set<number>();
  for (let i = 0; i < n; i += labelStep) labelIndices.add(i);
  labelIndices.add(n - 1);

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!containerRef.current || n === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(relX * (n - 1));
    setHoverIdx(Math.min(n - 1, Math.max(0, idx)));
  }

  const hovered = hoverIdx != null ? points[hoverIdx] : null;
  const hoveredCoord = hoverIdx != null ? coords[hoverIdx] : null;
  const tooltipLeftPct = hoveredCoord ? (hoveredCoord.x / VB_W) * 100 : 0;
  // Flip the tooltip to the other side near the chart edges so it never clips.
  const tooltipAlign = tooltipLeftPct > 70 ? "right" : tooltipLeftPct < 15 ? "left" : "center";

  if (n === 0) {
    return <p className="text-sm text-text-muted mt-4">Not enough data yet.</p>;
  }

  return (
    <div
      ref={containerRef}
      className="relative mt-2 select-none"
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-52 overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines + y-axis labels */}
        {gridFracs.map((frac) => {
          const y = PAD_T + (1 - frac) * PLOT_H;
          return (
            <g key={frac}>
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-text-muted"
                fontSize={10}
              >
                {formatCompact(frac * niceMax)}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {points.map((p, i) =>
          labelIndices.has(i) ? (
            <text
              key={p.date}
              x={xAt(i)}
              y={VB_H - 6}
              textAnchor="middle"
              className="fill-text-muted"
              fontSize={10}
            >
              {formatShortDate(p.date)}
            </text>
          ) : null
        )}

        {/* Area fill under the full curve */}
        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}

        {/* Settled history */}
        {pastLinePath && (
          <path d={pastLinePath} fill="none" stroke={color} strokeWidth={2.25} strokeLinecap="round" />
        )}

        {/* Today's still-accumulating tail — dashed, dimmer */}
        {tailLinePath && (
          <path
            d={tailLinePath}
            fill="none"
            stroke={color}
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeDasharray="5 4"
            opacity={0.6}
          />
        )}

        {/* Hover crosshair */}
        {hoveredCoord && (
          <line
            x1={hoveredCoord.x}
            x2={hoveredCoord.x}
            y1={PAD_T}
            y2={baseline}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
          />
        )}

        {/* Today marker (pulsing) */}
        {coords.length > 0 && (
          <>
            <circle
              cx={coords[coords.length - 1].x}
              cy={coords[coords.length - 1].y}
              r={7}
              fill={color}
              opacity={0.25}
            >
              <animate attributeName="r" values="5;9;5" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0.05;0.35" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={3} fill={color} />
          </>
        )}

        {/* Hovered point */}
        {hoveredCoord && (
          <circle
            cx={hoveredCoord.x}
            cy={hoveredCoord.y}
            r={4}
            fill="#0A0A0C"
            stroke={color}
            strokeWidth={2}
          />
        )}
      </svg>

      {/* Tooltip */}
      {hovered && hoveredCoord && (
        <div
          className="absolute top-0 pointer-events-none glass-strong rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap z-10"
          style={{
            left: `${tooltipLeftPct}%`,
            transform:
              tooltipAlign === "center"
                ? "translateX(-50%)"
                : tooltipAlign === "left"
                ? "translateX(0)"
                : "translateX(-100%)",
          }}
        >
          <p className="text-text-muted">
            {formatShortDate(hovered.date)}
            {hovered.is_today ? " · so far" : ""}
          </p>
          <p className="text-text-primary font-medium">
            {(Number(hovered[metricKey]) || 0).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

export function SiteAnalyticsPanel() {
  const [days, setDays] = useState(30);
  const [points, setPoints] = useState<DailyPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricKey, setMetricKey] = useState<keyof DailyPoint>("unique_visitors");
  const [busy, setBusy] = useState(false);
  const [purgeDays, setPurgeDays] = useState(90);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .get<DailyPoint[]>(`/api/admin/site-analytics/daily?days=${days}`)
      .then(setPoints)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load site analytics.")
      );
  }

  useEffect(load, [days]);

  const latest = points && points.length > 0 ? points[points.length - 1] : null;
  const activeMetric = METRICS.find((m) => m.key === metricKey)!;

  // Total problem submissions — "today" is today's running count, and
  // "this week" sums the trailing 7 stored/live days (fewer if the
  // history doesn't go back that far yet, e.g. right after a purge).
  const submissionsToday = latest?.problems_solved ?? 0;
  const submissionsThisWeek = useMemo(() => {
    if (!points) return 0;
    return points.slice(-7).reduce((sum, p) => sum + p.problems_solved, 0);
  }, [points]);
  const weekSpanDays = points ? Math.min(7, points.length) : 0;

  async function handleExport() {
    setBusy(true);
    setActionMessage(null);
    try {
      await downloadFile(
        `/api/admin/site-analytics/export?days=${days}`,
        `leettrack-analytics-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePurge() {
    setBusy(true);
    setActionMessage(null);
    try {
      const result = await api.post<{ deleted: number }>("/api/admin/site-analytics/purge", {
        older_than_days: purgeDays,
      });
      setActionMessage(
        result.deleted === 0
          ? "Nothing to purge — no rows older than that."
          : `Purged ${result.deleted} day${result.deleted === 1 ? "" : "s"} of old analytics.`
      );
      load();
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : "Purge failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-text-muted uppercase tracking-wide">Site analytics</p>
        <div className="flex items-center gap-1.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                days === opt.days
                  ? "bg-brand-live text-[#0A0A0C] font-medium"
                  : "text-text-secondary hover:bg-white/5"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-danger mt-4">{error}</p>
      ) : !points ? (
        <p className="text-sm text-text-muted mt-4">Loading…</p>
      ) : (
        <>
          {/* Today's snapshot cards */}
          {latest && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
              <StatCard label="Visitors today" value={latest.unique_visitors} live={latest.is_today} />
              <StatCard label="New signups" value={latest.new_signups} live={latest.is_today} />
              <StatCard
                label="7-day retention"
                value={latest.retention_7d == null ? "—" : `${Math.round(latest.retention_7d * 100)}%`}
                live={latest.is_today}
              />
              <StatCard label="Logins" value={latest.total_logins} live={latest.is_today} />
              <StatCard
                label="Submissions today"
                value={submissionsToday}
                live={latest.is_today}
                accent="#A78BFA"
              />
              <StatCard
                label={weekSpanDays >= 7 ? "Submissions this week" : `Submissions (${weekSpanDays}d)`}
                value={submissionsThisWeek}
                accent="#A78BFA"
              />
            </div>
          )}
          <p className="text-[11px] text-text-muted mt-2">
            Submissions = problems accepted (synced from LeetCode); today&apos;s and this week&apos;s totals are still counting until midnight IST.
          </p>

          {/* Metric picker for the chart below */}
          <div className="flex items-center gap-1.5 mt-6 mb-1 flex-wrap">
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetricKey(m.key)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
                  metricKey === m.key
                    ? "bg-white/10 text-text-primary"
                    : "text-text-muted hover:bg-white/5"
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: m.color, opacity: metricKey === m.key ? 1 : 0.5 }}
                />
                {m.label}
              </button>
            ))}
          </div>

          {/* Trend chart */}
          <TrendChart points={points} metricKey={metricKey} color={activeMetric.color} />

          {/* Export / purge controls */}
          <div className="mt-4 pt-4 border-t border-white/10 flex items-center flex-wrap gap-3">
            <button
              onClick={handleExport}
              disabled={busy}
              className="text-sm bg-white/10 hover:bg-white/15 text-text-primary px-3.5 py-2 rounded-lg disabled:opacity-60"
            >
              Download CSV
            </button>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-text-muted">Purge rows older than</span>
              <input
                type="number"
                min={1}
                value={purgeDays}
                onChange={(e) => setPurgeDays(Math.max(1, Number(e.target.value) || 1))}
                className="w-16 glass rounded-lg px-2 py-1.5 text-sm outline-none focus:border-[var(--color-brand)]"
              />
              <span className="text-xs text-text-muted">days</span>
              <button
                onClick={handlePurge}
                disabled={busy}
                className="text-sm text-danger hover:underline disabled:opacity-60"
              >
                Purge
              </button>
            </div>
          </div>
          {actionMessage && <p className="text-xs text-text-muted mt-2">{actionMessage}</p>}
        </>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  live,
  accent,
}: {
  label: string;
  value: number | string;
  live?: boolean;
  accent?: string;
}) {
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-text-muted flex items-center gap-1">
        {label}
        {live && <span className="w-1 h-1 rounded-full bg-accepted shrink-0" />}
      </p>
      <p
        className="text-lg font-display font-semibold mt-0.5"
        style={{ color: accent ?? "var(--color-text-primary)" }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
