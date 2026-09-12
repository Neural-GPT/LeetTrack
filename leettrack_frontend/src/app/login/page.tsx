"use client";

import { useState } from "react";
import Link from "next/link";
import BackgroundVideo from "@/components/BackgroundVideo";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(usernameOrEmail, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <BackgroundVideo />
      <form
        onSubmit={handleSubmit}
        className="glass-strong rounded-3xl px-10 py-10 w-full max-w-[420px]"
      >
        <div className="flex items-center gap-2.5 font-display font-semibold text-[18px] mb-8">
          <span className="w-2 h-2 rounded-full bg-brand-live shadow-[0_0_8px_var(--color-brand)]" />
          LeetTrack
        </div>

        <h1 className="font-display font-semibold text-2xl mb-1">Welcome back</h1>
        <p className="text-sm text-text-secondary mb-7">Log in to keep your streak alive.</p>

        {error && (
          <div className="mb-5 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
            {error}
          </div>
        )}

        <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
          Username or email
        </label>
        <input
          value={usernameOrEmail}
          onChange={(e) => setUsernameOrEmail(e.target.value)}
          required
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm mb-4 outline-none focus:border-[var(--color-brand)]"
          placeholder="name"
        />

        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs text-text-muted uppercase tracking-wide">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-brand-live">
            Forgot password?
          </Link>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm mb-6 outline-none focus:border-[var(--color-brand)]"
          placeholder="••••••••"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-live text-[#0A0A0C] font-medium text-sm py-3 rounded-xl disabled:opacity-60"
        >
          {loading ? "Logging in…" : "Log in"}
        </button>

        <p className="text-sm text-text-secondary text-center mt-6">
          New here?{" "}
          <Link href="/register" className="text-brand-live">
            Create an account
          </Link>
        </p>
      </form>
    </main>
  );
}
