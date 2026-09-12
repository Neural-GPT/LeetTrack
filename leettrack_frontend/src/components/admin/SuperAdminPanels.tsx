"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

// ---------------------------------------------------------------------
// Feedback inbox — Super Admin only. This is the fix for "super admin
// doesn't get to see what feedback is given": the backend endpoint
// (/api/feedback/all) already existed, it just wasn't wired into any
// page. The unread count here is also the only place that number shows
// up anywhere in the app (see FeedbackWidget.tsx — students/teachers
// see just the "Feedback" pill, no number).
// ---------------------------------------------------------------------

type FeedbackItem = {
  id: number;
  role: string;
  sender_name: string;
  message: string;
  created_at: string;
};

type StudentSubmission = {
  submission_id: number;
  assignment_id: number;
  problem_title: string;
  difficulty: string;
  status: string;
  score: number;
  total_attempts: number;
};

export function FeedbackPanel() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  function load() {
    api
      .get<FeedbackItem[]>("/api/feedback/all")
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load feedback."));
  }

  useEffect(() => {
    if (expanded) load();
  }, [expanded]);

  return (
    <section className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs text-text-muted uppercase tracking-wide">Feedback</p>
          {items.length > 0 && (
            <span className="bg-brand-live-15 text-brand-live rounded-full px-1.5 py-0.5 text-[10px] font-display">
              {items.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-sm text-brand-live hover:underline shrink-0"
        >
          {expanded ? "Close" : "View all"}
        </button>
      </div>

      {expanded && (
        <div className="mt-4">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing sent in yet.</p>
          ) : (
            <ul className="divide-y divide-white/10 max-h-96 overflow-y-auto">
              {items.map((f) => (
                <li key={f.id} className="py-3">
                  <p className="text-sm text-text-primary leading-snug">{f.message}</p>
                  <p className="text-xs text-text-muted mt-1">
                    {f.sender_name} · {f.role} ·{" "}
                    {new Date(f.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Broadcast messages — deliver to any recipient's notification bell.
// ---------------------------------------------------------------------

type BroadcastRecord = {
  id: number;
  target_type: string;
  target_user_id: number | null;
  message: string;
  recipient_count: number;
  created_at: string;
};

type Person = { user_id: number; full_name: string; email: string };

export function BroadcastPanel() {
  const [message, setMessage] = useState("");
  const [targetType, setTargetType] = useState<"all" | "students" | "teachers" | "user">("all");
  const [people, setPeople] = useState<Person[]>([]);
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<BroadcastRecord[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (targetType !== "user" || people.length > 0) return;
    Promise.all([
      api.get<Person[]>("/api/admin/students").catch(() => []),
      api.get<{ user_id: number; full_name: string; email: string }[]>("/api/admin/teachers").catch(() => []),
    ]).then(([students, teachers]) => setPeople([...students, ...teachers]));
  }, [targetType, people.length]);

  function loadHistory() {
    api.get<BroadcastRecord[]>("/api/admin/broadcast").then(setHistory).catch(() => null);
  }

  useEffect(() => {
    if (expanded) loadHistory();
  }, [expanded]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSending(true);
    try {
      const res = await api.post<BroadcastRecord>("/api/admin/broadcast", {
        message: message.trim(),
        target_type: targetType,
        target_user_id: targetType === "user" && targetUserId ? Number(targetUserId) : null,
      });
      setSuccess(`Sent to ${res.recipient_count} recipient${res.recipient_count === 1 ? "" : "s"}.`);
      setMessage("");
      if (expanded) loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Broadcast messages</p>
      <p className="text-sm text-text-secondary mb-4">
        Sends straight to the recipient's notification bell.
      </p>

      <form onSubmit={handleSend} className="space-y-3">
        {error && (
          <p className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
            {success}
          </p>
        )}

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={1}
          placeholder="Message to send…"
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none min-h-[70px]"
        />

        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as typeof targetType)}
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="all">Everyone</option>
            <option value="students">All students</option>
            <option value="teachers">All teachers</option>
            <option value="user">Specific user</option>
          </select>

          {targetType === "user" && (
            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              required
              className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none flex-1 min-w-[180px]"
            >
              <option value="">Choose a person…</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name} ({p.email})
                </option>
              ))}
            </select>
          )}

          <button
            type="submit"
            disabled={sending}
            className="ml-auto bg-brand-live text-[#0A0A0C] font-medium text-sm px-5 py-2.5 rounded-lg disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-sm text-brand-live hover:underline mt-4"
      >
        {expanded ? "Hide history" : "View send history"}
      </button>

      {expanded && (
        <ul className="divide-y divide-white/10 mt-3 max-h-72 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-sm text-text-muted py-2">Nothing sent yet.</p>
          ) : (
            history.map((h) => (
              <li key={h.id} className="py-2.5">
                <p className="text-sm text-text-primary leading-snug">{h.message}</p>
                <p className="text-xs text-text-muted mt-1">
                  {h.target_type} · {h.recipient_count} recipient{h.recipient_count === 1 ? "" : "s"} ·{" "}
                  {new Date(h.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// "Super powers" — direct overrides only the Super Admin can reach:
// edit any student's profile (any day, not weekend-gated), reset a
// streak, or correct a submission's score/status.
// ---------------------------------------------------------------------

export function SuperPowersPanel() {
  const [students, setStudents] = useState<{ user_id: number; full_name: string; email: string }[]>([]);

  const [studentId, setStudentId] = useState("");
  const [fullName, setFullName] = useState("");
  const [leetcodeUsername, setLeetcodeUsername] = useState("");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [streakStudentId, setStreakStudentId] = useState("");
  const [streakMsg, setStreakMsg] = useState<string | null>(null);

  const [subStudentId, setSubStudentId] = useState("");
  const [studentSubmissions, setStudentSubmissions] = useState<StudentSubmission[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [submissionId, setSubmissionId] = useState("");
  const [score, setScore] = useState("");
  const [status, setStatus] = useState("");
  const [subMsg, setSubMsg] = useState<string | null>(null);
  const [subErr, setSubErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ user_id: number; full_name: string; email: string }[]>("/api/admin/students")
      .then(setStudents)
      .catch(() => setStudents([]));
  }, []);

  // Selecting a student pre-fills their current name, so "editing" it
  // means changing the text that's already there rather than typing a
  // brand new one into an empty box.
  function handleStudentPick(id: string) {
    setStudentId(id);
    setProfileMsg(null);
    setProfileErr(null);
    const match = students.find((s) => String(s.user_id) === id);
    setFullName(match?.full_name ?? "");
  }

  async function handleProfileOverride(e: React.FormEvent) {
    e.preventDefault();
    setProfileErr(null);
    setProfileMsg(null);
    if (!studentId) {
      setProfileErr("Pick a student first.");
      return;
    }
    try {
      const payload: Record<string, unknown> = {};
      if (fullName.trim()) payload.full_name = fullName.trim();
      if (leetcodeUsername.trim()) payload.leetcode_username = leetcodeUsername.trim();
      if (Object.keys(payload).length === 0) {
        setProfileErr("Change the name or LeetCode username first.");
        return;
      }
      await api.patch(`/api/admin/students/${studentId}/profile`, payload);
      setProfileMsg("Updated.");
      setLeetcodeUsername("");
    } catch (err) {
      setProfileErr(err instanceof ApiError ? err.message : "Couldn't update that student.");
    }
  }

  async function handleResetStreak(e: React.FormEvent) {
    e.preventDefault();
    setStreakMsg(null);
    if (!streakStudentId) {
      setStreakMsg("Pick a student first.");
      return;
    }
    try {
      await api.post(`/api/admin/students/${streakStudentId}/reset-streak`);
      setStreakMsg("Streak reset to 0.");
    } catch (err) {
      setStreakMsg(err instanceof ApiError ? err.message : "Couldn't reset that streak.");
    }
  }

  // Picking a student loads their submissions, so the picker below can
  // show "Two Sum · Easy · accepted · 8.5" instead of the admin having
  // to already know a raw submission ID.
  function handleSubStudentPick(id: string) {
    setSubStudentId(id);
    setSubmissionId("");
    setScore("");
    setStatus("");
    setSubMsg(null);
    setSubErr(null);
    setStudentSubmissions([]);
    if (!id) return;
    setLoadingSubs(true);
    api
      .get<StudentSubmission[]>(`/api/admin/students/${id}/submissions`)
      .then(setStudentSubmissions)
      .catch(() => setStudentSubmissions([]))
      .finally(() => setLoadingSubs(false));
  }

  // Picking a submission pre-fills its current score/status, same
  // pattern as the profile override above — you're editing what's
  // already there, not starting from a blank slate.
  function handleSubmissionPick(id: string) {
    setSubmissionId(id);
    setSubMsg(null);
    setSubErr(null);
    const match = studentSubmissions.find((s) => String(s.submission_id) === id);
    setScore(match ? String(match.score) : "");
    setStatus(match ? match.status : "");
  }

  async function handleSubmissionOverride(e: React.FormEvent) {
    e.preventDefault();
    setSubErr(null);
    setSubMsg(null);
    if (!submissionId) {
      setSubErr("Pick a submission first.");
      return;
    }
    try {
      const payload: Record<string, unknown> = {};
      if (score.trim()) payload.score = Number(score);
      if (status.trim()) payload.status = status.trim();
      await api.patch(`/api/admin/submissions/${submissionId}/override`, payload);
      setSubMsg("Updated — this also feeds straight into the leaderboard's Assignment Score ranking.");
      // Reflect the save in the picker's own list without a re-fetch.
      setStudentSubmissions((prev) =>
        prev.map((s) =>
          String(s.submission_id) === submissionId
            ? { ...s, score: score.trim() ? Number(score) : s.score, status: status.trim() || s.status }
            : s
        )
      );
    } catch (err) {
      setSubErr(err instanceof ApiError ? err.message : "Couldn't update that submission.");
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Super Admin overrides</p>
      <p className="text-sm text-text-secondary mb-5">
        Direct edits that bypass normal rules (e.g. the weekend gate on profile changes) — every
        override here is logged.
      </p>

      <div className="space-y-3 mb-6">
        <p className="text-sm text-text-primary">Edit a student's profile</p>
        <form onSubmit={handleProfileOverride} className="grid md:grid-cols-3 gap-2.5">
          {profileErr && (
            <p className="md:col-span-3 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
              {profileErr}
            </p>
          )}
          {profileMsg && (
            <p className="md:col-span-3 text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
              {profileMsg}
            </p>
          )}
          <select
            value={studentId}
            onChange={(e) => handleStudentPick(e.target.value)}
            required
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="">Choose a student…</option>
            {students.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name} ({s.email})
              </option>
            ))}
          </select>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Display name"
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
          />
          <input
            value={leetcodeUsername}
            onChange={(e) => setLeetcodeUsername(e.target.value)}
            placeholder="New LeetCode username (optional)"
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
          />
          <button
            type="submit"
            className="md:col-span-3 bg-brand-live text-[#0A0A0C] font-medium text-sm py-2.5 rounded-lg"
          >
            Save
          </button>
        </form>
      </div>

      <div className="space-y-3 mb-6">
        <p className="text-sm text-text-primary">Reset a student's streak</p>
        <form onSubmit={handleResetStreak} className="flex gap-2.5">
          <select
            value={streakStudentId}
            onChange={(e) => setStreakStudentId(e.target.value)}
            required
            className="flex-1 glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="">Choose a student…</option>
            {students.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name} ({s.email})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-5 rounded-lg shrink-0"
          >
            Reset
          </button>
        </form>
        {streakMsg && <p className="text-xs text-text-muted">{streakMsg}</p>}
      </div>

      <div className="space-y-3">
        <p className="text-sm text-text-primary">Correct a submission (score / status)</p>
        <p className="text-xs text-text-muted -mt-2">
          Pick the student, then the exact problem — no need to know a submission ID. This score
          feeds directly into the leaderboard's Assignment Score ranking.
        </p>
        <form onSubmit={handleSubmissionOverride} className="grid md:grid-cols-3 gap-2.5">
          {subErr && (
            <p className="md:col-span-3 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
              {subErr}
            </p>
          )}
          {subMsg && (
            <p className="md:col-span-3 text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
              {subMsg}
            </p>
          )}

          <select
            value={subStudentId}
            onChange={(e) => handleSubStudentPick(e.target.value)}
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="">Choose a student…</option>
            {students.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name} ({s.email})
              </option>
            ))}
          </select>

          <select
            value={submissionId}
            onChange={(e) => handleSubmissionPick(e.target.value)}
            disabled={!subStudentId || loadingSubs}
            required
            className="md:col-span-2 glass rounded-lg px-3.5 py-2.5 text-sm outline-none disabled:opacity-50"
          >
            <option value="">
              {!subStudentId
                ? "Pick a student first…"
                : loadingSubs
                ? "Loading their submissions…"
                : studentSubmissions.length === 0
                ? "No submissions for this student"
                : "Choose a problem…"}
            </option>
            {studentSubmissions.map((s) => (
              <option key={s.submission_id} value={s.submission_id}>
                {s.problem_title} ({s.difficulty}) · {s.status} · score {s.score}
              </option>
            ))}
          </select>

          <input
            value={score}
            onChange={(e) => setScore(e.target.value)}
            type="number"
            step="0.01"
            placeholder="New score"
            disabled={!submissionId}
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none disabled:opacity-50"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={!submissionId}
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none disabled:opacity-50"
          >
            <option value="">Keep current status</option>
            <option value="not_started">not_started</option>
            <option value="attempted">attempted</option>
            <option value="accepted">accepted</option>
            <option value="missed">missed</option>
          </select>
          <button
            type="submit"
            disabled={!submissionId}
            className="bg-brand-live text-[#0A0A0C] font-medium text-sm py-2.5 rounded-lg disabled:opacity-50"
          >
            Save
          </button>
        </form>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Public chat on/off switch.
// ---------------------------------------------------------------------

export function ChatTogglePanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/api/chat/settings")
      .then((r) => setEnabled(r.enabled))
      .catch(() => setError("Couldn't load the chat setting."));
  }, []);

  async function toggle() {
    if (enabled === null) return;
    setSaving(true);
    setError(null);
    const next = !enabled;
    try {
      const r = await api.patch<{ enabled: boolean }>("/api/chat/settings", { enabled: next });
      setEnabled(r.enabled);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Public chat</p>
          <p className="text-sm text-text-secondary">
            The site-wide chat room every student, teacher, and admin shares. Turning this off
            refuses new messages for everyone — existing messages in the room stay visible.
          </p>
          {error && <p className="text-sm text-danger mt-2">{error}</p>}
        </div>
        <button
          onClick={toggle}
          disabled={enabled === null || saving}
          aria-label="Toggle public chat"
          className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${
            enabled ? "bg-brand-live" : "bg-white/15"
          }`}
        >
          <span
            className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      <p className="text-xs text-text-muted mt-3">
        Currently {enabled === null ? "…" : enabled ? "on — anyone can post." : "off — new messages are blocked."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------
// Polls — sent to everyone's notification bell. The Super Admin sets a
// question, 2-6 options, and how long voting stays open; results are
// broadcast back to everyone's bell automatically once the poll ends
// (see the `finalize-polls` Celery beat job). Individual "who voted for
// what" rows are only visible here for 48 hours after a poll ends —
// after that only the aggregate counts remain (services/polls.py).
// ---------------------------------------------------------------------

type Poll = {
  id: number;
  question: string;
  options: string[];
  status: "active" | "ended";
  created_at: string;
  ends_at: string;
  my_vote: number | null;
  counts: number[] | null;
  total_votes: number | null;
};

type PollVoteRow = {
  user_id: number;
  voter_name: string;
  voter_role: string;
  option_index: number;
  voted_at: string;
};

const DURATION_PRESETS: { label: string; minutes: number }[] = [
  { label: "5 minutes", minutes: 5 },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 60 * 6 },
  { label: "24 hours", minutes: 60 * 24 },
  { label: "3 days", minutes: 60 * 24 * 3 },
  { label: "7 days", minutes: 60 * 24 * 7 },
];

function PollVotesViewer({ poll, onClose }: { poll: Poll; onClose: () => void }) {
  const [votes, setVotes] = useState<PollVoteRow[] | null>(null);

  useEffect(() => {
    api
      .get<PollVoteRow[]>(`/api/polls/${poll.id}/votes`)
      .then(setVotes)
      .catch(() => setVotes([]));
  }, [poll.id]);

  return (
    <div className="mt-3 glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-text-primary">Who voted for what</p>
        <button onClick={onClose} className="text-xs text-brand-live hover:underline">
          Close
        </button>
      </div>
      {votes === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : votes.length === 0 ? (
        <p className="text-sm text-text-muted">
          {poll.status === "ended"
            ? "No individual votes left to show — this poll ended more than 48 hours ago, so per-voter data has been purged. The aggregate counts above are all that's kept."
            : "No votes yet."}
        </p>
      ) : (
        <ul className="divide-y divide-white/10 max-h-72 overflow-y-auto">
          {votes.map((v) => (
            <li key={v.user_id} className="py-2 flex items-center justify-between text-sm">
              <span className="text-text-primary">
                {v.voter_name} <span className="text-text-muted">({v.voter_role})</span>
              </span>
              <span className="text-text-secondary">{poll.options[v.option_index]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PollRow({ poll }: { poll: Poll }) {
  const [showVotes, setShowVotes] = useState(false);
  const maxCount = Math.max(1, ...(poll.counts ?? [0]));

  return (
    <li className="py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-text-primary leading-snug">{poll.question}</p>
          <p className="text-xs text-text-muted mt-0.5">
            {poll.status === "active" ? "Active — " : "Ended — "}
            {poll.status === "active"
              ? `closes ${new Date(poll.ends_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : `closed ${new Date(poll.ends_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
          </p>
        </div>
        <button
          onClick={() => setShowVotes((v) => !v)}
          className="text-xs text-brand-live hover:underline shrink-0"
        >
          {showVotes ? "Hide votes" : "View votes"}
        </button>
      </div>

      {poll.counts && (
        <div className="mt-2.5 space-y-1.5">
          {poll.options.map((opt, i) => (
            <div key={opt} className="flex items-center gap-2.5">
              <span className="text-xs text-text-secondary w-28 truncate shrink-0" title={opt}>
                {opt}
              </span>
              <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-live"
                  style={{ width: `${((poll.counts?.[i] ?? 0) / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-xs text-text-muted w-8 text-right shrink-0">
                {poll.counts?.[i] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {showVotes && <PollVotesViewer poll={poll} onClose={() => setShowVotes(false)} />}
    </li>
  );
}

export function PollPanel() {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [expanded, setExpanded] = useState(false);

  function loadPolls() {
    api.get<Poll[]>("/api/polls").then(setPolls).catch(() => null);
  }

  useEffect(() => {
    if (expanded) loadPolls();
  }, [expanded]);

  function updateOption(i: number, value: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  }

  function addOption() {
    if (options.length >= 6) return;
    setOptions((prev) => [...prev, ""]);
  }

  function removeOption(i: number) {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSending(true);
    try {
      await api.post<Poll>("/api/polls", {
        question: question.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        duration_minutes: durationMinutes,
      });
      setSuccess("Poll sent — it just landed in everyone's notification bell.");
      setQuestion("");
      setOptions(["", ""]);
      if (expanded) loadPolls();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create that poll.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Polls</p>
      <p className="text-sm text-text-secondary mb-4">
        Sent to everyone's notification bell. Results are broadcast back to everyone once voting
        closes — only the final counts are kept permanently; who voted for what is visible here
        for 48 hours after a poll ends, then deleted.
      </p>

      <form onSubmit={handleCreate} className="space-y-2.5">
        {error && (
          <p className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
            {success}
          </p>
        )}

        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
          placeholder="Poll question…"
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
        />

        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                required
                placeholder={`Option ${i + 1}`}
                className="flex-1 glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="text-text-muted hover:text-danger px-2 shrink-0"
                  aria-label="Remove option"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button
              type="button"
              onClick={addOption}
              className="text-xs text-brand-live hover:underline"
            >
              + Add option
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
          >
            {DURATION_PRESETS.map((p) => (
              <option key={p.minutes} value={p.minutes}>
                Open for {p.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={sending}
            className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-4.5 py-2.5 rounded-lg disabled:opacity-60"
          >
            Send poll
          </button>
        </div>
      </form>

      <div className="mt-5 pt-4 border-t border-white/10">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-sm text-brand-live hover:underline"
        >
          {expanded ? "Hide poll history" : "View poll history"}
        </button>
        {expanded && (
          <ul className="divide-y divide-white/10 mt-2">
            {polls.length === 0 ? (
              <p className="text-sm text-text-muted py-3">No polls sent yet.</p>
            ) : (
              polls.map((p) => <PollRow key={p.id} poll={p} />)
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
