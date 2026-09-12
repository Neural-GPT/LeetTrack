"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BackgroundVideo from "@/components/BackgroundVideo";
import { api, ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "reset">("email");

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ message: string; dev_otp: string | null }>(
        "/api/auth/forgot-password",
        { email }
      );
      setInfo(res.message);
      setDevOtp(res.dev_otp);
      setStep("reset");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/reset-password", { email, otp, new_password: newPassword });
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <BackgroundVideo />
      <div className="glass-strong rounded-3xl px-10 py-10 w-full max-w-[420px]">
        <div className="flex items-center gap-2.5 font-display font-semibold text-[18px] mb-6">
          <span className="w-2 h-2 rounded-full bg-brand-live shadow-[0_0_8px_var(--color-brand)]" />
          LeetTrack
        </div>

        {step === "email" ? (
          <form onSubmit={handleRequestOtp}>
            <h1 className="font-display font-semibold text-2xl mb-1">Reset your password</h1>
            <p className="text-sm text-text-secondary mb-7">
              We&apos;ll send a code to the email on your account.
            </p>

            {error && (
              <div className="mb-5 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
                {error}
              </div>
            )}

            <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input mb-6"
              placeholder="you@kit.ac.in"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-live text-[#0A0A0C] font-medium text-sm py-3 rounded-xl disabled:opacity-60"
            >
              {loading ? "Sending…" : "Send reset code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset}>
            <h1 className="font-display font-semibold text-2xl mb-1">Enter your code</h1>
            <p className="text-sm text-text-secondary mb-7">
              Check <span className="text-text-primary">{email}</span> for a 6-digit code.
            </p>

            {error && (
              <div className="mb-5 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
                {error}
              </div>
            )}
            {info && !error && (
              <div className="mb-5 text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
                {info}
              </div>
            )}
            {devOtp && (
              <div className="mb-5 text-xs text-text-muted glass rounded-lg px-3.5 py-2.5">
                Dev mode (no SMTP configured) — your code is{" "}
                <span className="font-display text-text-primary">{devOtp}</span>
              </div>
            )}

            <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
              6-digit code
            </label>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              minLength={6}
              maxLength={6}
              inputMode="numeric"
              className="input mb-4 text-center text-lg tracking-[0.5em] font-display"
              placeholder="······"
            />

            <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
              New password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="input mb-6"
              placeholder="At least 8 characters"
            />

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-brand-live text-[#0A0A0C] font-medium text-sm py-3 rounded-xl disabled:opacity-60"
            >
              {loading ? "Resetting…" : "Reset password"}
            </button>
          </form>
        )}

        <p className="text-sm text-text-secondary text-center mt-6">
          <Link href="/login" className="text-brand-live">
            ← Back to login
          </Link>
        </p>
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 0.5rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
          outline: none;
        }
        .input:focus {
          border-color: var(--color-brand);
        }
      `}</style>
    </main>
  );
}
