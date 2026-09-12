"use client";

import { useEffect, useRef, useState } from "react";
import StudentShell from "@/components/StudentShell";
import RequireRole from "@/components/RequireRole";
import { api, ApiError, streamFetch } from "@/lib/api";

type EligibleAssignment = {
  assignment_id: number;
  problem_title: string;
  difficulty: string;
};

type Message = { role: "user" | "assistant"; content: string };

function AiChatContent() {
  const [eligible, setEligible] = useState<EligibleAssignment[]>([]);
  const [assignmentId, setAssignmentId] = useState<number | "">("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<EligibleAssignment[]>("/api/assistant/eligible-assignments")
      .then(setEligible)
      .catch(() => setEligible([]));
  }, []);

  useEffect(() => {
    // Skip on the very first render (empty messages) — scrolling into
    // view with nothing to scroll to nudges the whole page down by a
    // few pixels, which is what made the "AI Chat" heading clip under
    // the fixed LeetTrack pill right after opening this page.
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const next = [...messages, { role: "user" as const, content: input.trim() }];
    // Placeholder assistant bubble that gets filled in as tokens stream —
    // its index in `next` is fixed for the rest of this function.
    const assistantIndex = next.length;
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setSending(true);

    function updateAssistantMessage(content: string) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[assistantIndex] = { role: "assistant", content };
        return copy;
      });
    }

    try {
      const res = await streamFetch("/api/assistant/chat/stream", {
        method: "POST",
        body: JSON.stringify({ messages: next, assignment_id: assignmentId || null }),
      });
      if (!res.body) throw new Error("No response body.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        updateAssistantMessage(accumulated);
      }

      if (!accumulated.trim()) {
        throw new Error("The assistant didn't respond. Try again in a moment.");
      }
    } catch (err) {
      // Drop the empty/partial assistant bubble on failure rather than
      // leaving a blank message in the thread.
      setMessages((prev) => prev.filter((_, i) => i !== assistantIndex));
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Couldn't reach the assistant. Try again in a moment."
      );
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
  }

  return (
    <div className="px-2 pb-6 max-w-[760px] mx-auto h-[calc(100vh-2rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-semibold text-2xl">AI Chat</h1>
          <p className="text-sm text-text-secondary mt-1">
            Chats are not saved.
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} className="text-sm text-text-secondary hover:underline">
            Clear chat
          </button>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
          Discuss a specific problem (optional)
        </label>
        <select
          value={assignmentId}
          onChange={(e) => setAssignmentId(e.target.value ? Number(e.target.value) : "")}
          className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none w-full max-w-sm"
        >
          <option value="">General help</option>
          {eligible.map((a) => (
            <option key={a.assignment_id} value={a.assignment_id}>
              {a.problem_title} ({a.difficulty})
            </option>
          ))}
        </select>
        {eligible.length === 0 && (
          <p className="text-xs text-text-muted mt-1.5">
            No assignments have AI help enabled yet: that&apos;s set per-problem by your teacher.
          </p>
        )}
      </div>

      <div className="flex-1 glass rounded-2xl p-5 overflow-y-auto flex flex-col gap-4 mb-4">
        {messages.length === 0 ? (
          <p className="text-sm text-text-muted m-auto text-center max-w-xs">
            Ask about how LeetTrack works, or pick a problem above if your teacher&apos;s enabled
            AI help for it.
          </p>
        ) : (
          messages.map((m, i) => {
            const isStreamingPlaceholder =
              sending && m.role === "assistant" && i === messages.length - 1 && !m.content;
            return (
              <div
                key={i}
                className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "self-end bg-brand-live text-[#0A0A0C]"
                    : "self-start bg-white/8 text-text-primary dark-surface-target"
                }`}
              >
                {isStreamingPlaceholder ? "Thinking…" : m.content}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5 mb-3">
          {error}
        </p>
      )}

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something…"
          className="flex-1 glass dark-surface-target rounded-xl px-4 py-3 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-5 rounded-xl disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default function AiChatPage() {
  return (
    <RequireRole roles={["student"]}>
      <StudentShell>
        <AiChatContent />
      </StudentShell>
    </RequireRole>
  );
}
