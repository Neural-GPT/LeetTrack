"use client";

import { useEffect } from "react";
import { ApiError } from "@/lib/api";

/**
 * Next.js App Router convention: automatically wraps every page/layout
 * below it and renders this instead whenever a render or effect throws
 * — without it, a bug in any one page's data-handling would show
 * Next's bare default error screen (or a blank page in production).
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged client-side for now; wire this into a real error-tracking
    // service (Sentry, etc.) if/when one is added.
    console.error("Unhandled page error:", error);
  }, [error]);

  const isApiError = error instanceof ApiError;
  const message = isApiError
    ? error.message
    : "Something went wrong loading this page.";

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="glass rounded-2xl p-8 max-w-md">
        <h2 className="text-lg font-semibold mb-2">That didn&apos;t work</h2>
        <p className="text-[var(--color-text-secondary)] mb-1">{message}</p>
        {isApiError && error.errorId && (
          <p className="text-xs text-[var(--color-text-muted)] mb-4">
            Error code: {error.errorId}
          </p>
        )}
        <button
          onClick={reset}
          className="mt-3 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
