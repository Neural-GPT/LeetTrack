"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Assignments", icon: AssignmentIcon },
  { href: "/custom-questions", label: "Custom Questions", icon: CustomQuestionIcon },
  { href: "/leaderboard", label: "Leaderboard", icon: LeaderboardIcon },
  { href: "/skills", label: "Skills", icon: SkillsIcon },
  { href: "/ai-chat", label: "AI Chat", icon: ChatIcon },
];

type Platform = "leetcode" | "gfg" | "hackerrank";

const PLATFORMS: { key: Platform; label: string; short: string; usernameField: keyof DashboardShape }[] = [
  { key: "leetcode", label: "LeetCode", short: "LC", usernameField: "leetcode_username" },
  { key: "gfg", label: "GeeksforGeeks", short: "GFG", usernameField: "gfg_username" },
  { key: "hackerrank", label: "HackerRank", short: "HR", usernameField: "hackerrank_username" },
];

// Remembers which platform's score the student last chose to look at,
// so the sidebar doesn't reset to LeetCode every page load.
const PLATFORM_STORAGE_KEY = "leettrack_score_platform";

type DashboardShape = {
  full_name: string;
  email: string;
  leetcode_username: string | null;
  github_username: string | null;
  gfg_username: string | null;
  hackerrank_username: string | null;
};

type PlatformScore = {
  platform: string;
  connected: boolean;
  username: string | null;
  score: number;
  detail: string;
};

/**
 * Icon-only rail, permanently folded — no expand/collapse toggle.
 * Hovering an icon shows its label via the native title tooltip. The
 * "LeetTrack" wordmark lives separately at the top-center of the page
 * (see StudentShell) so it stays visible regardless of this rail's
 * width; only the small brand dot stays here, at top.
 */
export default function StudentSidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardShape | null>(null);
  const [activePlatform, setActivePlatform] = useState<Platform>("leetcode");
  const [score, setScore] = useState<PlatformScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(PLATFORM_STORAGE_KEY) : null;
    if (stored === "leetcode" || stored === "gfg" || stored === "hackerrank") {
      setActivePlatform(stored);
    }

    api
      .get<DashboardShape>("/api/students/me/dashboard")
      .then(setDashboard)
      .catch(() => setDashboard(null));
  }, []);

  useEffect(() => {
    setScoreLoading(true);
    api
      .get<PlatformScore>(`/api/students/me/score?platform=${activePlatform}`)
      .then(setScore)
      .catch(() => setScore(null))
      .finally(() => setScoreLoading(false));
  }, [activePlatform]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  function selectPlatform(p: Platform) {
    setActivePlatform(p);
    localStorage.setItem(PLATFORM_STORAGE_KEY, p);
    setMenuOpen(false);
  }

  const name = dashboard?.full_name ?? null;
  const initial = name ? name.trim().charAt(0).toUpperCase() : "?";
  const profileTooltip = [
    name,
    dashboard?.email,
    dashboard?.leetcode_username ? `LeetCode: ${dashboard.leetcode_username}` : "LeetCode: not connected",
    dashboard?.github_username ? `github.com/${dashboard.github_username}` : "GitHub: not connected",
    dashboard?.gfg_username ? `GfG: ${dashboard.gfg_username}` : "GeeksforGeeks: not connected",
    dashboard?.hackerrank_username
      ? `HackerRank: ${dashboard.hackerrank_username}`
      : "HackerRank: not connected",
  ]
    .filter(Boolean)
    .join("\n");

  const activeMeta = PLATFORMS.find((p) => p.key === activePlatform)!;
  const hasConnected = score?.connected ?? false;

  return (
    <aside className="fixed left-4 top-4 bottom-4 z-20 w-[4.25rem] glass rounded-2xl flex flex-col items-center p-3">
      <Link
        href="/dashboard"
        title="LeetTrack"
        className="w-2 h-2 rounded-full bg-brand-live shadow-[0_0_8px_var(--color-brand)] mb-5 mt-1 shrink-0"
      />

      <nav className="space-y-1 w-full flex flex-col items-center">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "#");
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={`flex items-center justify-center w-11 h-11 rounded-xl transition-colors ${
                active
                  ? "bg-brand-live-15 text-brand-live"
                  : "text-text-secondary hover:text-text-primary hover:bg-white/5"
              }`}
            >
              <Icon active={active} />
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 flex items-center justify-center w-full relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          title={
            hasConnected
              ? `${activeMeta.label} score: ${score?.score ?? "…"}${score?.detail ? ` (${score.detail})` : ""} — click to switch platform`
              : `${activeMeta.label}: not connected — click to switch platform or connect in Settings`
          }
          className="relative w-11 h-11 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: "color-mix(in srgb, var(--color-brand) 12%, transparent)",
            boxShadow: hasConnected
              ? "0 0 12px color-mix(in srgb, var(--color-brand) 55%, transparent), inset 0 0 0 1.5px color-mix(in srgb, var(--color-brand) 60%, transparent)"
              : "inset 0 0 0 1.5px color-mix(in srgb, var(--color-brand) 25%, transparent)",
          }}
        >
          <span className="font-display font-semibold text-[10px] text-brand-live leading-tight text-center">
            {scoreLoading ? "…" : hasConnected ? score?.score : activeMeta.short}
          </span>
        </button>

        {menuOpen && (
          <div className="absolute left-[3.25rem] bottom-0 z-30 w-48 glass rounded-xl p-1.5 shadow-lg">
            {PLATFORMS.map((p) => {
              const connected = !!dashboard?.[p.usernameField];
              return (
                <button
                  key={p.key}
                  onClick={() => selectPlatform(p.key)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                    p.key === activePlatform
                      ? "bg-brand-live-15 text-brand-live"
                      : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                  }`}
                >
                  <span>{p.label}</span>
                  <span className="text-text-muted">{connected ? "✓" : "+"}</span>
                </button>
              );
            })}
            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="block w-full px-2.5 py-2 rounded-lg text-left text-xs text-text-muted hover:text-text-primary hover:bg-white/5 mt-0.5 border-t border-white/10 pt-2"
            >
              Manage accounts →
            </Link>
          </div>
        )}
      </div>

      <Link
        href="/achievements"
        title="Achievements"
        className={`flex items-center justify-center w-11 h-11 rounded-xl transition-colors mb-1 ${
          pathname === "/achievements"
            ? "bg-brand-live-15 text-brand-live"
            : "text-text-secondary hover:text-text-primary hover:bg-white/5"
        }`}
      >
        <TrophyIcon active={pathname === "/achievements"} />
      </Link>

      <Link
        href="/settings"
        title="Settings"
        className={`flex items-center justify-center w-11 h-11 rounded-xl transition-colors mb-2 ${
          pathname === "/settings"
            ? "bg-brand-live-15 text-brand-live"
            : "text-text-secondary hover:text-text-primary hover:bg-white/5"
        }`}
      >
        <GearIcon active={pathname === "/settings"} />
      </Link>

      <div
        title={profileTooltip || undefined}
        className="w-9 h-9 rounded-full bg-brand-live-20 text-brand-live flex items-center justify-center text-sm font-display font-medium shrink-0 mb-2"
      >
        {initial}
      </div>

      <button
        onClick={logout}
        title="Log out"
        className="flex items-center justify-center w-11 h-11 rounded-xl text-text-muted hover:text-danger hover:bg-white/5 transition-colors"
      >
        <LogoutIcon />
      </button>
    </aside>
  );
}

function AssignmentIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M9 11l3 3 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LeaderboardIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M8 20V10M14 20V4M20 20v-7M2 20h20" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CustomQuestionIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M4 4h16v12H8l-4 4V4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 9h6M9 12.5h4" strokeLinecap="round" />
    </svg>
  );
}

function SkillsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M12 2l2.6 6.2L21 9l-5 4.4L17.4 20 12 16.6 6.6 20 8 13.4 3 9l6.4-.8L12 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrophyIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 5H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4M17 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
