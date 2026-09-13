import Link from "next/link";
import BackgroundVideo from "@/components/BackgroundVideo";
import StudentSidebar from "@/components/StudentSidebar";
import NotificationBell from "@/components/NotificationBell";
import OnlineIndicator from "@/components/OnlineIndicator";
import FeedbackWidget from "@/components/FeedbackWidget";
import ChatBubble from "@/components/LazyChatBubble";
import LevelProgressBar from "@/components/LevelProgressBar";
import AchievementToast from "@/components/AchievementToast";

export default function StudentShell({
  children,
  showTopWidgets = false,
}: {
  children: React.ReactNode;
  // Notification bell + Feedback pill — grouped under one flag since
  // they're only meant to appear together, on the main dashboard.
  // Every other student page (AI Chat, Leaderboard, Settings) omits
  // this prop and gets neither.
  showTopWidgets?: boolean;
}) {
  return (
    <main className="min-h-screen">
      <BackgroundVideo />
      <StudentSidebar />

      {/* Wordmark, top-center — separate from the icon rail so it's
          always visible regardless of sidebar width. The brand dot
          itself stays on the sidebar. */}
      <Link
        href="/dashboard"
        className="fixed top-4 left-1/2 -translate-x-1/2 z-20 glass rounded-2xl px-5 py-3 font-display font-semibold text-[15px] tracking-tight"
      >
        LeetTrack
      </Link>

      <div className="fixed top-4 right-4 z-20 flex items-center gap-2">
        {showTopWidgets && <LevelProgressBar />}
        {showTopWidgets && <FeedbackWidget />}
        <div className="glass rounded-2xl p-1.5 flex items-center gap-1">
          <OnlineIndicator />
          {showTopWidgets && <NotificationBell />}
        </div>
      </div>

      <div className="ml-4 md:ml-[6rem] pt-4 pr-4">{children}</div>

      <ChatBubble />
      <AchievementToast />
    </main>
  );
}
