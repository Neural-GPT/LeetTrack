export default function Hero() {
  return (
    <section className="relative h-full flex flex-col items-center justify-center px-6">
      <div className="glass-strong rounded-3xl px-12 py-9 md:px-20 md:py-11 max-w-[940px] flex flex-col items-center text-center">
        <span className="font-display text-xs text-brand-live glass-brand px-3.5 py-1.5 rounded-full mb-6 tracking-wide">
          ◆ Weekly problem sets now live for BCA 2nd year
        </span>

        <h1 className="font-display font-semibold text-[36px] md:text-[48px] leading-[1.14] tracking-tight text-[#F5F5F7]">
          Every submission<br />
          has <span className="text-brand-live">gravity</span>.
        </h1>

        <p className="mt-4 max-w-[480px] text-[16px] leading-relaxed text-text-secondary">
          LeetTrack pulls your daily LeetCode grind into one live score:
          <br />
          ranked and competitive leaderboard
        </p>

        <div className="mt-7 flex gap-3.5">
          <a
            href="/register"
            className="bg-brand-live text-[#0A0A0C] font-medium text-[15px] px-6 py-3 rounded-xl"
          >
            Connect LeetCode
          </a>
          <a
            href="/leaderboard"
            className="glass text-text-primary font-medium text-[15px] px-6 py-3 rounded-xl"
          >
            View leaderboard
          </a>
        </div>
      </div>
    </section>
  );
}
