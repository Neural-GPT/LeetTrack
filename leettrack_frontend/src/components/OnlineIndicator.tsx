"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const POLL_INTERVAL_MS = 30_000;

type OnlineTeacher = { user_id: number; full_name: string };
type OnlineStudent = { user_id: number; full_name: string; section_name: string | null };
type OnlineUsers = {
  student_count: number;
  online_students: OnlineStudent[];
  online_teachers: OnlineTeacher[];
};

export default function OnlineIndicator() {
  const { role } = useAuth();
  const isAdmin = role === "super_admin";

  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<OnlineUsers | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function load() {
      api
        .get<{ count: number }>("/api/students/online-count")
        .then((r) => setCount(r.count))
        .catch(() => null);
    }
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAdmin]);

  function handleToggle() {
    if (!isAdmin) return;
    setOpen((v) => {
      const next = !v;
      if (next) {
        setLoadingDetails(true);
        api
          .get<OnlineUsers>("/api/admin/online-users")
          .then(setDetails)
          .catch(() => setDetails(null))
          .finally(() => setLoadingDetails(false));
      }
      return next;
    });
  }

  const pill = (
    <div
      title={isAdmin ? "Click to see who's online" : `${count ?? "…"} students online`}
      className={`flex items-center gap-1.5 px-2.5 h-9 rounded-xl text-text-secondary ${
        isAdmin ? "hover:bg-white/5 transition-colors" : ""
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accepted shrink-0" />
      <span className="text-sm font-display">{count ?? "…"}</span>
    </div>
  );

  if (!isAdmin) return pill;

  return (
    <div ref={containerRef} className="relative">
      <button onClick={handleToggle} aria-label="Who's online">
        {pill}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-72 glass-strong dark-surface-target rounded-2xl p-4 z-40">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Who&apos;s online</p>

          {loadingDetails ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : !details ? (
            <p className="text-sm text-danger">Couldn&apos;t load this.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-text-secondary">Students online</span>
                <span className="text-sm font-display font-semibold text-text-primary">
                  {details.student_count}
                </span>
              </div>
              {details.online_students.length === 0 ? (
                <p className="text-sm text-text-muted mb-3">No students online right now.</p>
              ) : (
                <ul className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
                  {details.online_students.map((s) => (
                    <li key={s.user_id} className="flex items-center gap-2 text-sm text-text-primary">
                      <span className="w-1.5 h-1.5 rounded-full bg-accepted shrink-0" />
                      <span className="truncate">{s.full_name}</span>
                      {s.section_name && (
                        <span className="text-xs text-text-muted shrink-0">· {s.section_name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-text-muted uppercase tracking-wide mb-2">
                Teachers online
              </p>
              {details.online_teachers.length === 0 ? (
                <p className="text-sm text-text-muted">No teachers online right now.</p>
              ) : (
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {details.online_teachers.map((t) => (
                    <li key={t.user_id} className="flex items-center gap-2 text-sm text-text-primary">
                      <span className="w-1.5 h-1.5 rounded-full bg-accepted shrink-0" />
                      {t.full_name}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
