"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

export default function FeedbackWidget() {
  // No count fetch here on purpose: the number is Super-Admin-only
  // (see /api/feedback/count and the Feedback panel on /admin) — the
  // student/teacher pill just says "Feedback", it's where they send it
  // from, not where they see how many have piled up.
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/feedback", { message: message.trim() });
      setSubmitted(true);
      setMessage("");
      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
      }, 1400);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative">
      <div className="glass rounded-2xl p-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          Feedback
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-11 w-72 glass-strong rounded-2xl p-4 z-40">
          {submitted ? (
            <p className="text-sm text-accepted text-center py-4">Thanks for the feedback.</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <p className="text-xs text-text-muted uppercase tracking-wide mb-2">
                Send feedback
              </p>
              {error && (
                <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-2.5 py-2 mb-2">
                  {error}
                </p>
              )}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                minLength={1}
                placeholder="What's working, what's not..."
                className="w-full glass rounded-lg px-3 py-2.5 text-sm outline-none min-h-[80px] mb-2.5"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-brand-live text-[#0A0A0C] font-medium text-sm py-2 rounded-lg disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
