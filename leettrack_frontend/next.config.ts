import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gzip/Brotli-compresses HTML/JSON/JS responses Next serves itself
  // (already the default in production, set explicitly so it can't
  // silently regress). Complements the backend's own GZipMiddleware —
  // together they cover everything the browser receives from either
  // server.
  compress: true,
  // Drops the "X-Powered-By: Next.js" response header — no perf
  // effect, just doesn't advertise framework/version to anyone
  // fingerprinting the stack.
  poweredByHeader: false,
  // Catches accidental double-effects/unsafe lifecycle patterns in
  // dev only; no effect on the production build or runtime behavior.
  reactStrictMode: true,
};

export default nextConfig;