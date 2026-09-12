"use client";

import { useEffect, useState } from "react";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
import { api, ApiError } from "@/lib/api";

type Dashboard = {
  full_name: string;
  section: string | null;
  leetcode_username: string | null;
  github_username: string | null;
};

const NOTIFICATION_TOGGLES: { key: string; label: string }[] = [
  { key: "notify_new_assignment", label: "New assignment posted" },
  { key: "notify_deadline", label: "Deadline reminders" },
  { key: "notify_missed", label: "Missed an assignment" },
  { key: "notify_streak_broken", label: "Streak broken" },
  { key: "notify_weekly_results", label: "Weekly results digest" },
  { key: "notify_leaderboard", label: "Leaderboard rank changes" },
];

// Weekend = Saturday/Sunday, IST (UTC+5:30) — matches the backend gate
// in services/time_windows.py. This is purely a UX nicety (disabling
// the fields + showing why) — the backend enforces the real rule
// regardless of what the client thinks the day is.
function isIstWeekend(): boolean {
  const ist = new Date(Date.now() + (5.5 * 60 + new Date().getTimezoneOffset()) * 60_000);
  const day = ist.getDay();
  return day === 0 || day === 6;
}

function SettingsContent() {
  const [profile, setProfile] = useState<Dashboard | null>(null);
  const [leetcodeUsername, setLeetcodeUsername] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [original, setOriginal] = useState({
    leetcode_username: "",
    github_username: "",
    full_name: "",
  });
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    notify_new_assignment: true,
    notify_deadline: true,
    notify_missed: true,
    notify_streak_broken: true,
    notify_weekly_results: true,
    notify_leaderboard: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weekend = isIstWeekend();
  // First time connecting LeetCode or GitHub (nothing linked yet) is
  // allowed any day — only *changing* an already-linked username is
  // weekend-gated.
  const leetcodeAlreadyLinked = original.leetcode_username !== "";
  const leetcodeEditable = weekend || !leetcodeAlreadyLinked;
  const githubAlreadyLinked = original.github_username !== "";
  const githubEditable = weekend || !githubAlreadyLinked;

  useEffect(() => {
    api
      .get<Dashboard>("/api/students/me/dashboard")
      .then((d) => {
        setProfile(d);
        setLeetcodeUsername(d.leetcode_username ?? "");
        setGithubUsername(d.github_username ?? "");
        setFullName(d.full_name ?? "");
        setOriginal({
          leetcode_username: d.leetcode_username ?? "",
          github_username: d.github_username ?? "",
          full_name: d.full_name ?? "",
        });
      })
      .catch(() => setProfile(null));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...toggles };
      // Only include these when actually changed — sending them
      // unchanged would trip the backend's weekend gate for no reason
      // (it gates on the field being present in the request at all).
      // LeetCode username: allowed through whenever leetcodeEditable
      // says so (weekend, OR first-time connect); the backend applies
      // the same "first connect is free" exemption independently, so
      // this is just keeping the client in sync with that, not a
      // security boundary.
      if (leetcodeEditable && leetcodeUsername !== original.leetcode_username) {
        payload.leetcode_username = leetcodeUsername || null;
      }
      // GitHub username: allowed through whenever githubEditable says
      // so (weekend, OR first-time connect) — same "first connect is
      // free" exemption LeetCode gets above. The backend applies the
      // same rule independently, so this is just keeping the client in
      // sync with that, not a security boundary.
      if (githubEditable && githubUsername !== original.github_username) {
        payload.github_username = githubUsername || null;
      }
      if (weekend && fullName.trim() && fullName !== original.full_name) {
        payload.full_name = fullName.trim();
      }
      await api.patch("/api/students/me/settings", payload);
      setOriginal({
        leetcode_username: leetcodeUsername,
        github_username: githubUsername,
        full_name: fullName,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-2 pb-16 max-w-[720px] mx-auto">
      <h1 className="font-display font-semibold text-2xl mb-1">Settings</h1>
      <p className="text-sm text-text-secondary mb-8">
        {profile ? `Signed in as ${profile.full_name}` : "…"}
      </p>

      {!weekend && (
        <div className="glass rounded-2xl px-4 py-3 mb-6 text-sm text-text-secondary border border-white/10">
          Your display name can only be changed on weekends (Saturday–Sunday, IST).
          {leetcodeAlreadyLinked
            ? " Your LeetCode username is already connected, so changing it is also weekend-only."
            : " You can still connect your LeetCode account below any day — that only gets weekend-gated once it's set."}
          {githubAlreadyLinked
            ? " Same for your GitHub username — it's already connected, so changing it is weekend-only too."
            : " You can still connect your GitHub account below any day — that only gets weekend-gated once it's set."}
          {" "}Notification preferences below can still be changed any day.
        </div>
      )}

      <section className="glass rounded-2xl p-7 mb-6">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Display name</p>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={!weekend}
          placeholder="Your name"
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-brand)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </section>

      <section className="glass rounded-2xl p-7 mb-6">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-2">GitHub account</p>
        <p className="text-sm text-text-secondary mb-4">
          Powers the GitHub statistics and graphs on the Achievements page.
          {!githubAlreadyLinked && " Connecting it for the first time works any day."}
        </p>
        <input
          value={githubUsername}
          onChange={(e) => setGithubUsername(e.target.value)}
          disabled={!githubEditable}
          placeholder="your-github-username"
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-brand)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </section>

      <section className="glass rounded-2xl p-7 mb-6">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-2">LeetCode account</p>
        <p className="text-sm text-text-secondary mb-4">
          Needed for LeetTrack to verify your submissions: nothing gets scored without it.
          {!leetcodeAlreadyLinked && " Connecting it for the first time works any day."}
        </p>
        <input
          value={leetcodeUsername}
          onChange={(e) => setLeetcodeUsername(e.target.value)}
          disabled={!leetcodeEditable}
          placeholder="your-leetcode-username"
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-brand)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </section>

      <section className="glass rounded-2xl p-7 mb-6">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-4">Notifications</p>
        <div className="space-y-3">
          {NOTIFICATION_TOGGLES.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between text-sm cursor-pointer">
              <span className="text-text-primary">{label}</span>
              <input
                type="checkbox"
                checked={toggles[key]}
                onChange={(e) => setToggles((prev) => ({ ...prev, [key]: e.target.checked }))}
                className="w-4 h-4 accent-[var(--color-brand)]"
              />
            </label>
          ))}
        </div>
      </section>

      {error && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5 mb-4">
          {error}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-6 py-3 rounded-xl disabled:opacity-60"
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequireRole roles={["student"]}>
      <StudentShell>
        <SettingsContent />
      </StudentShell>
    </RequireRole>
  );
}
