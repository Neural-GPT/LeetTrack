"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Notification = {
  id: number;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
  meta?: string | null;
};

const POLL_INTERVAL_MS = 30_000;

type PollDetail = {
  id: number;
  question: string;
  options: string[];
  status: "active" | "ended";
  ends_at: string;
  my_vote: number | null;
  counts: number[] | null;
  total_votes: number | null;
};

function pollIdFromMeta(raw: string | null | undefined): number | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.poll_id === "number" ? parsed.poll_id : null;
  } catch {
    return null;
  }
}

// Inline voting UI for a type="poll" notification. Nested inside the
// row's <button> markRead target, so every click here stops
// propagation — otherwise tapping an option would both vote AND
// immediately mark-read/close in whatever order the browser feels
// like (and you can't nest a real <button> inside another <button>'s
// click target cleanly otherwise).
function PollVoteWidget({ pollId }: { pollId: number }) {
  const [poll, setPoll] = useState<PollDetail | null>(null);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PollDetail>(`/api/polls/${pollId}`)
      .then(setPoll)
      .catch(() => setError("Couldn't load this poll."));
  }, [pollId]);

  async function castVote(optionIndex: number) {
    setVoting(true);
    setError(null);
    try {
      const updated = await api.post<PollDetail>(`/api/polls/${pollId}/vote`, {
        option_index: optionIndex,
      });
      setPoll(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't cast that vote.");
    } finally {
      setVoting(false);
    }
  }

  if (error && !poll) {
    return <p className="text-xs text-danger mt-1.5">{error}</p>;
  }
  if (!poll) {
    return <p className="text-xs text-text-muted mt-1.5">Loading poll…</p>;
  }

  const closed = poll.status === "ended";
  const alreadyVoted = poll.my_vote !== null;

  return (
    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {error && <p className="text-xs text-danger">{error}</p>}
      {poll.options.map((opt, i) => {
        const picked = poll.my_vote === i;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => !closed && !alreadyVoted && castVote(i)}
            disabled={voting || closed || alreadyVoted}
            className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:cursor-default ${
              picked
                ? "border-brand-live bg-brand-live-15 text-brand-live"
                : "border-white/10 text-text-secondary hover:border-white/25"
            }`}
          >
            {opt}
            {picked && " ✓"}
          </button>
        );
      })}
      <p className="text-[11px] text-text-muted">
        {closed
          ? "Poll closed."
          : alreadyVoted
          ? "Your vote is in — results post here once the poll closes."
          : "Tap an option to vote."}
      </p>
    </div>
  );
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function load() {
    api
      .get<Notification[]>("/api/notifications/me")
      .then(setNotifications)
      .catch(() => null);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function markRead(id: number) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await api.post(`/api/notifications/me/${id}/read`).catch(() => null);
  }

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.read);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await Promise.all(
      unread.map((n) => api.post(`/api/notifications/me/${n.id}/read`).catch(() => null))
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex items-center justify-center w-9 h-9 rounded-xl text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-[10px] font-medium text-white flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 glass-strong dark-surface-target rounded-2xl p-2 z-40 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between px-2.5 py-2">
            <p className="text-xs text-text-muted uppercase tracking-wide">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-brand-live hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">Nothing yet.</p>
          ) : (
            <ul className="space-y-1">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => !n.read && markRead(n.id)}
                    className={`w-full text-left px-2.5 py-2.5 rounded-xl text-sm transition-colors ${
                      n.read ? "text-text-secondary" : "text-text-primary bg-white/5"
                    } hover:bg-white/10`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read && (
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-live mt-1.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="leading-snug">{n.message}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {new Date(n.created_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                        {n.type === "poll" &&
                          (() => {
                            const pollId = pollIdFromMeta(n.meta);
                            return pollId !== null ? <PollVoteWidget pollId={pollId} /> : null;
                          })()}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
