"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type ProgressOut = {
  connected: boolean;
  username?: string;
  real_name?: string;
  avatar_url?: string;
  ranking?: number | null;
  country?: string | null;
  github_url?: string | null;
  github_connected: boolean;
  website?: string | null;
  solved?: { easy: number; medium: number; hard: number; total: number };
  total_questions?: { easy: number; medium: number; hard: number; total: number };
  attempting: number;
  submission_calendar: Record<string, number>;
  total_active_days: number;
  max_streak: number;
  total_submissions_past_year: number;
};

type GithubStatsOut = {
  connected: boolean;
  username?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  public_repos: number;
  followers: number;
  following: number;
  profile_url?: string | null;
  total_stars: number;
  total_forks: number;
  top_repos: { name: string; commits: number; stars: number; forks: number; language: string | null }[];
  language_breakdown: Record<string, number>;
};

const EASY_COLOR = "#2CBB5D";
const MEDIUM_COLOR = "#E9A23B";
const HARD_COLOR = "#E5484D";

const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: "#E9A23B",
  TypeScript: "#3B82E9",
  Python: "#2CBB5D",
  Java: "#E5484D",
  "C++": "#B25CE0",
  C: "#8A8F98",
  Go: "#3BC7E9",
  Rust: "#DD8866",
  HTML: "#E9663B",
  CSS: "#5C6FE0",
  Shell: "#6BE05C",
};
const FALLBACK_LANGUAGE_COLORS = ["#2CBB5D", "#E9A23B", "#E5484D", "#3B82E9", "#B25CE0", "#3BC7E9"];

export default function ProgressPanel() {
  const [data, setData] = useState<ProgressOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [github, setGithub] = useState<GithubStatsOut | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);

  function load() {
    api
      .get<ProgressOut>("/api/gamification/progress")
      .then(setData)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!data?.github_connected) {
      setGithub(null);
      return;
    }
    setGithubLoading(true);
    api
      .get<GithubStatsOut>("/api/gamification/github")
      .then(setGithub)
      .finally(() => setGithubLoading(false));
  }, [data?.github_connected]);

  if (loading) {
    return <p className="text-sm text-text-muted py-10 text-center">Loading progress…</p>;
  }

  if (!data) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-sm text-text-secondary mb-1">Couldn't load your progress right now.</p>
      </div>
    );
  }

  const { solved, total_questions } = data;

  return (
    <div className="space-y-5">
      {!data.github_connected && <GithubConnectCard onConnected={load} />}
      {data.github_connected && (githubLoading || github) && (
        <GithubStatsSection stats={github} loading={githubLoading} />
      )}

      {!data.connected ? (
        <div className="glass rounded-2xl p-8 text-center">
          <p className="text-sm text-text-secondary mb-1">
            {data.username
              ? "Couldn't reach LeetCode for that profile right now."
              : "Connect your LeetCode username in Settings to see your progress here."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-5">
            <SolvedRing
              solved={solved ?? { easy: 0, medium: 0, hard: 0, total: 0 }}
              totalQuestions={total_questions ?? { easy: 0, medium: 0, hard: 0, total: 0 }}
              attempting={data.attempting}
            />
            <ProfileCard data={data} />
          </div>

          <SubmissionHeatmap
            calendar={data.submission_calendar}
            totalSubmissions={data.total_submissions_past_year}
            activeDays={data.total_active_days}
            maxStreak={data.max_streak}
          />
        </>
      )}
    </div>
  );
}

function GithubConnectCard({ onConnected }: { onConnected: () => void }) {
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    const value = username.trim().replace(/^@/, "");
    if (!value) return;
    setError(null);
    setSaving(true);
    try {
      await api.patch("/api/students/me/settings", { github_username: value });
      setUsername("");
      onConnected();
    } catch {
      setError("Couldn't save that GitHub username.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleConnect}
      className="glass rounded-2xl p-5 flex items-center gap-3 flex-wrap"
    >
      <GithubIcon className="w-6 h-6 text-text-secondary shrink-0" />
      <div className="min-w-0 mr-auto">
        <p className="text-sm text-text-primary">Connect GitHub to unlock more statistics</p>
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        disabled={saving}
        placeholder="your-github-username"
        className="glass rounded-lg px-3 py-2 text-sm outline-none w-48 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={saving || !username.trim()}
        className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-3.5 py-2 rounded-lg disabled:opacity-60"
      >
        Connect
      </button>
    </form>
  );
}

function GithubStatsSection({
  stats,
  loading,
}: {
  stats: GithubStatsOut | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-sm text-text-muted">Loading GitHub statistics…</p>
      </div>
    );
  }

  if (!stats || !stats.connected) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-sm text-text-secondary">
          Couldn't reach GitHub for that profile right now.
        </p>
      </div>
    );
  }

  const maxCommits = Math.max(1, ...stats.top_repos.map((r) => r.commits));
  const totalLangRepos = Object.values(stats.language_breakdown).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(stats.language_breakdown).sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-5">
      <div className="glass rounded-2xl p-5 flex items-start gap-4 min-w-[260px]">
        {stats.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stats.avatar_url}
            alt={stats.name || stats.username || "GitHub avatar"}
            className="w-16 h-16 rounded-xl object-cover shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-brand-live-15 flex items-center justify-center text-brand-live font-display font-semibold text-xl shrink-0">
            {(stats.name || stats.username || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-display font-semibold text-text-primary truncate">
            {stats.name || stats.username}
          </p>
          {stats.profile_url && (
            <a
              href={stats.profile_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-text-muted hover:text-brand-live truncate flex items-center gap-1 mb-2"
            >
              <GithubIcon className="w-3 h-3 shrink-0" />@{stats.username}
            </a>
          )}
          {stats.bio && (
            <p className="text-xs text-text-secondary mb-3 line-clamp-2">{stats.bio}</p>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <GithubMiniStat label="Repos" value={stats.public_repos} />
            <GithubMiniStat label="Stars" value={stats.total_stars} />
            <GithubMiniStat label="Followers" value={stats.followers} />
            <GithubMiniStat label="Following" value={stats.following} />
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-5">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">
          GitHub: top repos by stars
        </p>
        {stats.top_repos.length === 0 ? (
          <p className="text-sm text-text-muted">No public repositories yet.</p>
        ) : (
          <div className="space-y-2.5 mb-5">
            {stats.top_repos.map((r) => (
              <div key={r.name} className="flex items-center gap-3">
                <span className="text-xs text-text-secondary w-32 truncate shrink-0" title={r.name}>
                  {r.name}
                </span>
                <div className="flex-1 h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-live"
                    style={{ width: `${(r.commits / maxCommits) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-text-muted w-20 text-right shrink-0">
                  {r.commits} commits
                </span>
              </div>
            ))}
          </div>
        )}

        {languages.length > 0 && (
          <>
            <p className="text-xs text-text-muted uppercase tracking-wide mb-3">
              Language breakdown
            </p>
            <div className="w-full h-2.5 rounded-full overflow-hidden flex mb-3">
              {languages.map(([lang, count], i) => (
                <div
                  key={lang}
                  style={{
                    width: `${(count / totalLangRepos) * 100}%`,
                    background:
                      LANGUAGE_COLORS[lang] ??
                      FALLBACK_LANGUAGE_COLORS[i % FALLBACK_LANGUAGE_COLORS.length],
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {languages.map(([lang, count], i) => (
                <span key={lang} className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background:
                        LANGUAGE_COLORS[lang] ??
                        FALLBACK_LANGUAGE_COLORS[i % FALLBACK_LANGUAGE_COLORS.length],
                    }}
                  />
                  {lang} <span className="text-text-muted">({count})</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GithubMiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-lg px-2.5 py-1.5">
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-sm font-display font-semibold text-text-primary">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function SolvedRing({
  solved,
  totalQuestions,
  attempting,
}: {
  solved: { easy: number; medium: number; hard: number; total: number };
  totalQuestions: { easy: number; medium: number; hard: number; total: number };
  attempting: number;
}) {
  const size = 200;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const total = totalQuestions.total || 1;

  // Three arcs sized by each difficulty's share of the total LeetCode
  // question bank — same "ring split by category weight" look as the
  // reference screenshot, not by solved ratio (a near-empty solved
  // count would otherwise render as three invisible slivers).
  const easyFrac = totalQuestions.easy / total;
  const medFrac = totalQuestions.medium / total;
  const hardFrac = totalQuestions.hard / total;

  const easyLen = circumference * easyFrac;
  const medLen = circumference * medFrac;
  const hardLen = circumference * hardFrac;

  const gap = 3; // small visual gap between arcs
  let offset = 0;

  const arcs = [
    { len: easyLen - gap, color: EASY_COLOR, off: offset },
  ];
  offset += easyLen;
  arcs.push({ len: medLen - gap, color: MEDIUM_COLOR, off: offset });
  offset += medLen;
  arcs.push({ len: hardLen - gap, color: HARD_COLOR, off: offset });

  return (
    <div className="glass rounded-2xl p-6 flex items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={stroke}
          />
          {arcs.map((a, i) => (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(a.len, 0)} ${circumference}`}
              strokeDashoffset={-a.off}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display font-semibold text-3xl text-text-primary">
            {solved.total}
            <span className="text-base text-text-muted">/{totalQuestions.total || "—"}</span>
          </span>
          <span className="text-xs text-accepted flex items-center gap-1 mt-1">✓ Solved</span>
          {attempting > 0 && (
            <span className="text-xs text-text-muted mt-2">{attempting} Attempting</span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 ml-6">
        <DifficultyStat label="Easy" color={EASY_COLOR} solved={solved.easy} total={totalQuestions.easy} />
        <DifficultyStat label="Med." color={MEDIUM_COLOR} solved={solved.medium} total={totalQuestions.medium} />
        <DifficultyStat label="Hard" color={HARD_COLOR} solved={solved.hard} total={totalQuestions.hard} />
      </div>
    </div>
  );
}

function DifficultyStat({
  label,
  color,
  solved,
  total,
}: {
  label: string;
  color: string;
  solved: number;
  total: number;
}) {
  return (
    <div className="glass rounded-xl px-4 py-2 min-w-[92px]">
      <p className="text-xs font-medium" style={{ color }}>
        {label}
      </p>
      <p className="text-sm text-text-primary font-display">
        {solved}/{total || "—"}
      </p>
    </div>
  );
}

function ProfileCard({ data }: { data: ProgressOut }) {
  return (
    <div className="glass rounded-2xl p-5 flex items-start gap-4">
      {data.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.avatar_url}
          alt={data.real_name || data.username || "avatar"}
          className="w-16 h-16 rounded-xl object-cover shrink-0"
        />
      ) : (
        <div className="w-16 h-16 rounded-xl bg-brand-live-15 flex items-center justify-center text-brand-live font-display font-semibold text-xl shrink-0">
          {(data.real_name || data.username || "?").charAt(0).toUpperCase()}
        </div>
      )}

      <div className="min-w-0">
        <p className="font-display font-semibold text-text-primary truncate">
          {data.real_name || data.username}
        </p>
        <p className="text-xs text-text-muted truncate mb-2">{data.username}</p>

        <p className="text-xs text-text-secondary mb-2">
          Rank{" "}
          <span className="text-text-primary font-medium">
            {data.ranking ? `~${data.ranking.toLocaleString()}` : "—"}
          </span>
        </p>

        <div className="flex flex-col gap-1 text-xs">
          {data.website && (
            <a
              href={data.website.startsWith("http") ? data.website : `https://${data.website}`}
              target="_blank"
              rel="noreferrer"
              className="text-text-secondary hover:text-brand-live truncate"
            >
              🌐 {data.website}
            </a>
          )}
          {data.github_url && (
            <a
              href={data.github_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-text-secondary hover:text-brand-live truncate"
            >
              <GithubIcon className="w-3.5 h-3.5 shrink-0" />
              {data.github_url.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.16.69-3.83-1.34-3.83-1.34-.52-1.31-1.26-1.66-1.26-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.74 2.66 1.23 3.31.94.1-.74.4-1.23.72-1.52-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.16.91-.25 1.89-.38 2.86-.39.97.01 1.95.14 2.86.39 2.18-1.47 3.14-1.16 3.14-1.16.62 1.58.23 2.75.11 3.04.73.79 1.17 1.8 1.17 3.04 0 4.35-2.65 5.31-5.18 5.59.41.35.77 1.04.77 2.11 0 1.52-.01 2.75-.01 3.12 0 .3.2.66.79.55A11.26 11.26 0 0 0 23.25 11.75C23.25 5.48 18.27.5 12 .5Z" />
    </svg>
  );
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function SubmissionHeatmap({
  calendar,
  totalSubmissions,
  activeDays,
  maxStreak,
}: {
  calendar: Record<string, number>;
  totalSubmissions: number;
  activeDays: number;
  maxStreak: number;
}) {
  // Build a 371-day grid (53 weeks x 7), ending today, Sunday-first
  // columns — same shape as LeetCode's own calendar.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = 371;
  const start = new Date(today);
  start.setDate(start.getDate() - (totalDays - 1));
  // Roll back to the most recent Sunday on/before `start`.
  start.setDate(start.getDate() - start.getDay());

  const days: { date: Date; key: string; count: number }[] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const key = cursor.toISOString().slice(0, 10);
    days.push({ date: new Date(cursor), key, count: calendar[key] ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks: { date: Date; key: string; count: number }[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  function levelFor(count: number) {
    if (count <= 0) return "rgba(255,255,255,0.06)";
    if (count === 1) return "rgba(44,187,93,0.35)";
    if (count <= 3) return "rgba(44,187,93,0.6)";
    if (count <= 6) return "rgba(44,187,93,0.85)";
    return "#2CBB5D";
  }

  // Month label sits above the first week-column whose Sunday falls in
  // that month.
  const monthLabelForWeek: (string | null)[] = weeks.map((week, i) => {
    const first = week[0]?.date;
    if (!first) return null;
    const prevWeekFirst = weeks[i - 1]?.[0]?.date;
    if (!prevWeekFirst || prevWeekFirst.getMonth() !== first.getMonth()) {
      return MONTH_LABELS[first.getMonth()];
    }
    return null;
  });

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-text-primary">
          <span className="font-display font-semibold">{totalSubmissions}</span> submissions in
          the past one year
        </p>
        <p className="text-xs text-text-muted">
          Total active days: <span className="text-text-secondary">{activeDays}</span>{" "}
          &nbsp;Max streak: <span className="text-text-secondary">{maxStreak}</span>
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-1 min-w-max">
          <div className="flex gap-[3px] pl-1 text-[10px] text-text-muted h-3">
            {weeks.map((_, i) => (
              <div key={i} style={{ width: 11 }}>
                {monthLabelForWeek[i]}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((d) => (
                  <div
                    key={d.key}
                    title={`${d.key}: ${d.count} submission${d.count === 1 ? "" : "s"}`}
                    className="w-[11px] h-[11px] rounded-[2px]"
                    style={{ background: levelFor(d.count) }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
