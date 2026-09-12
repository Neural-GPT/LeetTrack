"use client";

/**
 * Catches errors thrown by the ROOT layout itself (error.tsx can't
 * catch those, since it renders inside the layout it's meant to
 * protect). Must render its own <html>/<body> since the real layout is
 * what failed. This should be rare — it's a last-resort net, not the
 * everyday error UI (that's error.tsx).
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <div className="text-center px-6">
          <h2 className="text-lg font-semibold mb-2">
            LeetTrack hit a problem
          </h2>
          <p className="text-gray-500 mb-4">
            Please refresh the page. If this keeps happening, let us know.
          </p>
          <button
            onClick={reset}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
