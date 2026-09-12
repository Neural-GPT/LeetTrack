"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { achievementIcon } from "@/lib/achievementIcons";

type NewlyUnlocked = {
  key: string;
  title: string;
  description: string;
  icon: string;
};

const POLL_INTERVAL_MS = 30_000;
const DISPLAY_MS = 6_000;
const EXIT_MS = 250;
const CONFETTI_COLORS = ["#4F9DDE", "#2CBB5D", "#E9A23B", "#A78BFA", "#FF6B66", "#00D4B8"];
const CONFETTI_COUNT = 14;

// Mounted once, app-wide, in StudentShell — so a student gets
// celebrated for a new achievement no matter which page unlocked it
// (level clears happen on stat refresh, streaks on the nightly poll,
// GitHub link from Settings, etc.), not just while on the Achievements
// page. Polls the lightweight /achievements/check endpoint, which only
// ever returns achievements unlocked by THAT call.
//
// The pending queue and "currently showing" flag live in refs rather
// than state — they're only ever read/written from event callbacks
// (the poll's `.then`, and the show/hide timers), never derived
// synchronously inside an effect body, so there's no cascading-render
// risk. `toast`/`leaving` are the only two bits that actually need to
// re-render the UI.
export default function AchievementToast() {
  const [toast, setToast] = useState<NewlyUnlocked | null>(null);
  const [leaving, setLeaving] = useState(false);
  const pendingRef = useRef<NewlyUnlocked[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const showingRef = useRef(false);

  function advance() {
    const next = pendingRef.current.shift();
    if (!next) {
      showingRef.current = false;
      setToast(null);
      return;
    }
    showingRef.current = true;
    setLeaving(false);
    setToast(next);
    setTimeout(() => {
      setLeaving(true);
      setTimeout(advance, EXIT_MS);
    }, DISPLAY_MS);
  }

  useEffect(() => {
    function poll() {
      api
        .get<NewlyUnlocked[]>("/api/gamification/achievements/check")
        .then((items) => {
          const fresh = items.filter((a) => !seenRef.current.has(a.key));
          if (fresh.length === 0) return;
          fresh.forEach((a) => seenRef.current.add(a.key));
          pendingRef.current.push(...fresh);
          if (!showingRef.current) advance();
        })
        .catch(() => null);
    }
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    setLeaving(true);
    setTimeout(advance, EXIT_MS);
  }

  if (!toast) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none w-[calc(100%-2rem)] max-w-sm flex justify-center">
      <div
        className={`achievement-toast pointer-events-auto glass-strong rounded-2xl px-5 py-4 flex items-center gap-3 shadow-2xl border border-brand-live-30 relative w-full transition-opacity duration-200 ${
          leaving ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="absolute inset-0 overflow-visible pointer-events-none">
          {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
            <span
              key={i}
              className="confetti-piece"
              style={{
                left: `${8 + ((i * 37) % 84)}%`,
                backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                animationDelay: `${(i % 5) * 0.08}s`,
                animationDuration: `${1.1 + (i % 4) * 0.15}s`,
              }}
            />
          ))}
        </div>

        <div className="w-12 h-12 rounded-xl bg-brand-live-15 flex items-center justify-center text-2xl shrink-0 achievement-toast-icon">
          {achievementIcon(toast.icon)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-brand-live font-medium">
            Achievement unlocked!
          </p>
          <p className="font-display font-semibold text-sm text-text-primary truncate">
            {toast.title}
          </p>
          <p className="text-xs text-text-muted mt-0.5">{toast.description}</p>
        </div>
        <button
          onClick={dismiss}
          className="text-text-muted hover:text-text-primary text-xs shrink-0 self-start px-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
