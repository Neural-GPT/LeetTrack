"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import NotificationBell from "@/components/NotificationBell";
import ChatBubble from "@/components/LazyChatBubble";
import OnlineIndicator from "@/components/OnlineIndicator";



const ROLE_HOME: Record<string, string> = {
  student: "/dashboard",
  teacher: "/teacher",
  super_admin: "/admin",
};

export default function Nav() {
  const { role, logout } = useAuth();

  return (
    <>
      <nav className="sticky top-4 z-20 mx-4 md:mx-10 mt-4 flex items-center justify-between px-6 py-4 rounded-2xl glass">
      <Link
        href={role ? ROLE_HOME[role] : "/"}
        className="flex items-center gap-2.5 font-display font-semibold text-[18px] tracking-tight"
      >
        <span className="w-2 h-2 rounded-full bg-brand-live shadow-[0_0_8px_var(--color-brand)]" />
        LeetTrack
      </Link>

      <div className="hidden md:flex gap-9 text-sm text-text-secondary">
        {(role === "teacher" || role === "super_admin") && (
          <Link href="/teacher" className="hover:text-text-primary transition-colors">
            Assignments
          </Link>
        )}
        {role && (
          <Link href="/leaderboard" className="hover:text-text-primary transition-colors">
            Leaderboard
          </Link>
        )}
        {(role === "teacher" || role === "super_admin") && (
          <Link href="/analytics" className="hover:text-text-primary transition-colors">
            Analytics
          </Link>
        )}
        {role === "super_admin" && (
          <Link href="/admin" className="hover:text-text-primary transition-colors">
            Data Center
          </Link>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Only the Super Admin gets the online pill here — students
            already have their own in StudentShell.tsx, and teachers
            have no need for it. Clicking it (admin only — see
            OnlineIndicator.tsx) expands to show who's online. */}
        {role === "super_admin" && <OnlineIndicator />}
        {role && <NotificationBell />}
        {role ? (
          <button
            onClick={logout}
            className="text-sm font-medium bg-brand-live text-[#0A0A0C] px-4.5 py-2.5 rounded-xl"
          >
            Log out
          </button>
        ) : (
          <Link href="/login" className="text-sm text-text-secondary">
            Log in
          </Link>
        )}
      </div>
      </nav>
      {role && <ChatBubble />}
    </>
  );
}
