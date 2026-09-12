"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BackgroundVideo from "@/components/BackgroundVideo";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";

const COLLEGE_DOMAIN = "kit.ac.in";

type Section = { id: number; name: string; year: string; department: string };

export default function RegisterPage() {
  const { completeStudentRegistration } = useAuth();
  const [step, setStep] = useState<"details" | "otp">("details");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState<string>("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<Section[]>("/api/sections")
      .then(setSections)
      .catch(() => setSections([]));
  }, []);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.toLowerCase().endsWith(`@${COLLEGE_DOMAIN}`)) {
      setError(`Registration needs a @${COLLEGE_DOMAIN} email address.`);
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ message: string; dev_otp: string | null }>(
        "/api/auth/register/student/request-otp",
        {
          full_name: fullName,
          email,
          password,
          section_id: sectionId ? Number(sectionId) : null,
        }
      );
      setInfo(res.message);
      setDevOtp(res.dev_otp);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await completeStudentRegistration(email, otp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <BackgroundVideo />
      <div className="glass-strong rounded-3xl px-10 py-10 w-full max-w-[420px]">
        <div className="flex items-center gap-2.5 font-display font-semibold text-[18px] mb-6">
          <span className="w-2 h-2 rounded-full bg-brand-live shadow-[0_0_8px_var(--color-brand)]" />
          LeetTrack
        </div>

        {step === "details" ? (
          <form onSubmit={handleRequestOtp}>
            <h1 className="font-display font-semibold text-2xl mb-1">Create your account</h1>
            <p className="text-sm text-text-secondary mb-7">
              Use your college email ( @{COLLEGE_DOMAIN} ): we&apos;ll send a code to confirm
              it&apos;s yours.
            </p>

            {error && (
              <div className="mb-5 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <Field label="Full name">
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="input"
                  placeholder="Your Name"
                />
              </Field>

              <Field label={`College email (@${COLLEGE_DOMAIN})`}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input"
                  placeholder={`yourname@${COLLEGE_DOMAIN}`}
                />
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="input"
                  placeholder="At least 8 characters"
                />
              </Field>

              <Field label="Classroom / section (optional)">
                <select
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  className="input"
                >
                  <option value="">Not sure yet / not listed</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.year ? ` · ${s.year}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-live text-[#0A0A0C] font-medium text-sm py-3 rounded-xl mt-7 disabled:opacity-60"
            >
              {loading ? "Sending code…" : "Send verification code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <h1 className="font-display font-semibold text-2xl mb-1">Check your email</h1>
            <p className="text-sm text-text-secondary mb-7">
              Enter the 6-digit code sent to <span className="text-text-primary">{email}</span>.
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

            <Field label="6-digit code">
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                minLength={6}
                maxLength={6}
                inputMode="numeric"
                className="input text-center text-lg tracking-[0.5em] font-display"
                placeholder="······"
              />
            </Field>

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-brand-live text-[#0A0A0C] font-medium text-sm py-3 rounded-xl mt-6 disabled:opacity-60"
            >
              {loading ? "Verifying…" : "Verify and create account"}
            </button>

            <button
              type="button"
              onClick={() => setStep("details")}
              className="w-full text-sm text-text-secondary text-center mt-4 hover:text-text-primary"
            >
              ← Use a different email
            </button>
          </form>
        )}

        <p className="text-sm text-text-secondary text-center mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-brand-live">
            Log in
          </Link>
        </p>
        <p className="text-xs text-text-muted text-center mt-3">
          Teacher or Super Admin? Those accounts are created for you: ask your Super Admin.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
