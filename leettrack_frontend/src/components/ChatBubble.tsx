"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";

type ChatMessageOut = {
  id: number;
  sender_id: number;
  sender_name: string;
  sender_role: "student" | "teacher" | "super_admin";
  message: string;
  created_at: string;
};

const POLL_INTERVAL_MS = 5000;

// The chat's "last seen message" has to survive this component
// unmounting/remounting on every page navigation (StudentShell renders
// a fresh ChatBubble per page) — otherwise a student who already opened
// the bubble and read everything sees the red dot come back the moment
// they click to a different page. Persisting it in localStorage is what
// makes "opened it = read it" stick across the whole site, not just the
// current page.
const LAST_SEEN_KEY = "leettrack_chat_last_seen_id";

function readLastSeenId(): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem(LAST_SEEN_KEY)) || 0;
}

function writeLastSeenId(id: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LAST_SEEN_KEY, String(id));
}

const ROLE_LABEL: Record<string, string> = {
  student: "Student",
  teacher: "Teacher",
  super_admin: "Admin",
};

const ROLE_COLOR: Record<string, string> = {
  student: "text-brand-live",
  teacher: "text-accepted",
  super_admin: "text-danger",
};

// Site-wide public chat, open to every logged-in role — see
// app/api/routers/chat.py. Messages live in their own database and are
// wiped every day at 12 AM IST, so this only ever shows however much
// of today's conversation is left. Teachers get a second tab here to
// push a message straight into everyone's notification bell (no
// per-person targeting — that stays a Super Admin-only power).
export default function ChatBubble() {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "notify">("chat");

  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  // null while unknown (first load) so the bubble doesn't briefly
  // flash then disappear for non-admins before the fetch resolves.
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null);

  const [announcement, setAnnouncement] = useState("");
  const [announcing, setAnnouncing] = useState(false);
  const [announceStatus, setAnnounceStatus] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  const lastSeenIdRef = useRef(readLastSeenId());

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  function load() {
    api
      .get<ChatMessageOut[]>("/api/chat/messages")
      .then((rows) => {
        setMessages(rows);
        const latestId = rows.reduce((max, r) => Math.max(max, r.id), 0);
        if (openRef.current) {
          lastSeenIdRef.current = latestId;
          writeLastSeenId(latestId);
        } else if (latestId > lastSeenIdRef.current) {
          setHasUnread(true);
        }
      })
      .catch(() => null);
  }

  useEffect(() => {
    if (!role) return;
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Whether the Super Admin has switched the whole room off (see
  // GET/PATCH /api/chat/settings) — re-checked whenever the bubble is
  // opened so a stale "off" state from earlier in the session doesn't
  // linger if it's been turned back on elsewhere.
  useEffect(() => {
    if (!role) return;
    api
      .get<{ enabled: boolean }>("/api/chat/settings")
      .then((r) => setChatEnabled(r.enabled))
      .catch(() => null);
  }, [role, open]);

  useEffect(() => {
    if (open) {
      setHasUnread(false);
      const latestId = messages.reduce((max, r) => Math.max(max, r.id), 0);
      lastSeenIdRef.current = latestId;
      writeLastSeenId(latestId);
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [open, messages]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setError(null);
    setSending(true);
    try {
      const row = await api.post<ChatMessageOut>("/api/chat/messages", { message: text });
      setMessages((prev) => [...prev, row]);
      lastSeenIdRef.current = row.id;
      writeLastSeenId(row.id);
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that.");
    } finally {
      setSending(false);
    }
  }

  async function handleAnnounce(e: React.FormEvent) {
    e.preventDefault();
    const text = announcement.trim();
    if (!text) return;
    setAnnounceStatus(null);
    setAnnouncing(true);
    try {
      const res = await api.post<{ recipient_count: number }>("/api/teacher/notify-all", {
        message: text,
      });
      setAnnounceStatus(`Sent to everyone's notification bell (${res.recipient_count} accounts).`);
      setAnnouncement("");
    } catch (err) {
      setAnnounceStatus(err instanceof ApiError ? err.message : "Couldn't send that.");
    } finally {
      setAnnouncing(false);
    }
  }

  if (!role) return null;
  // Off for everyone except the Super Admin, who still needs the
  // bubble reachable to turn it back on (from the Admin panel's Public
  // Chat toggle) — the "chat" tab below shows a locked notice instead
  // of the composer for them while it's off.
  if (chatEnabled === false && role !== "super_admin") return null;

  return (
    <div ref={containerRef} className="fixed bottom-5 right-5 z-40">
      {open && (
        <div
          className="absolute bottom-16 right-0 w-80 sm:w-96 h-[440px] glass-strong dark-surface-target rounded-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center gap-1 px-3 pt-3 shrink-0">
            <button
              onClick={() => setTab("chat")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === "chat"
                  ? "bg-brand-live text-[#0A0A0C]"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Public Chat
            </button>
            {role === "teacher" && (
              <button
                onClick={() => setTab("notify")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === "notify"
                    ? "bg-brand-live text-[#0A0A0C]"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                Notify Everyone
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary"
            >
              ✕
            </button>
          </div>

          {tab === "chat" ? (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3">
                {messages.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-8">
                    No messages yet — say hello.
                  </p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id}>
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className={`text-xs font-medium ${
                            ROLE_COLOR[m.sender_role] ?? "text-text-secondary"
                          }`}
                        >
                          {m.sender_name}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {ROLE_LABEL[m.sender_role] ?? m.sender_role}
                        </span>
                        <span className="text-[10px] text-text-muted ml-auto shrink-0">
                          {new Date(m.created_at).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-text-primary leading-snug break-words">
                        {m.message}
                      </p>
                    </div>
                  ))
                )}
              </div>
              {error && (
                <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg mx-3 mb-2 px-2.5 py-1.5 shrink-0">
                  {error}
                </p>
              )}
              {chatEnabled === false ? (
                <p className="text-xs text-text-muted mx-3 mb-3 px-2.5 py-2 rounded-lg bg-white/5 shrink-0">
                  Public chat is currently turned off — only you can see this. Students and
                  teachers can't post or see the room until you switch it back on from the Admin
                  panel.
                </p>
              ) : (
                <form
                  onSubmit={handleSend}
                  className="flex items-center gap-2 p-3 border-t border-panel-border shrink-0"
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={2000}
                    placeholder="Message everyone…"
                    className="flex-1 glass rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-3.5 py-2 rounded-lg disabled:opacity-60"
                  >
                    Send
                  </button>
                </form>
              )}
            </>
          ) : (
            <form onSubmit={handleAnnounce} className="flex-1 flex flex-col p-3 min-h-0">
              <p className="text-xs text-text-muted mb-2 leading-relaxed shrink-0">
                This goes straight into every student&apos;s, teacher&apos;s, and
                admin&apos;s notification bell at once — there&apos;s no picking one
                person, that stays a Super Admin power.
              </p>
              {announceStatus && (
                <p className="text-xs text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-2.5 py-2 mb-2 shrink-0">
                  {announceStatus}
                </p>
              )}
              <textarea
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                required
                minLength={1}
                maxLength={1000}
                placeholder="Announcement for everyone's notification bell…"
                className="w-full flex-1 glass rounded-lg px-3 py-2.5 text-sm outline-none resize-none mb-2.5"
              />
              <button
                type="submit"
                disabled={announcing || !announcement.trim()}
                className="w-full bg-brand-live text-[#0A0A0C] font-medium text-sm py-2 rounded-lg disabled:opacity-60 shrink-0"
              >
                {announcing ? "Sending…" : "Send to everyone"}
              </button>
            </form>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open public chat"
        className="relative w-12 h-12 rounded-full glass text-text-secondary hover:text-text-primary shadow-lg flex items-center justify-center transition-colors"
      >
        <ChatIcon />
        {hasUnread && !open && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-danger border-2 border-[#08080B]" />
        )}
      </button>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
