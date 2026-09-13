"use client";

import { useTheme } from "@/lib/theme-context";
import { API_URL } from "@/lib/api";

/**
 * Full-bleed background — video OR image, whichever the Super Admin has
 * selected (Appearance panel on /admin). Two ways to set it:
 *
 * 1. Register a file (any name, letters/numbers/underscores/hyphens +
 *    .mp4/.webm for video or .jpg/.jpeg/.png/.webp for image), with the
 *    actual file already dropped into public/ under that exact name.
 * 2. Paste a direct link to an already-hosted image/video —
 *    background_media_url. The backend fetches that link once and
 *    caches it server-side (see services/theme.py); this component
 *    renders that cached copy from our own backend
 *    (background_media_proxy_path), not the external link directly —
 *    so visitors' browsers aren't re-fetching an external host on
 *    every single page load. When set, this takes precedence over the
 *    registered filename.
 *
 * If nothing's registered/set yet, this just renders the dark gradient
 * — nothing breaks.
 *
 * Component name kept as BackgroundVideo for import-compatibility with
 * existing pages; it now handles both media types and both sourcing
 * methods.
 */
export default function BackgroundVideo() {
  const { background_media, background_media_type, background_media_proxy_path } = useTheme();

  const src = background_media_proxy_path
    ? `${API_URL}${background_media_proxy_path}`
    : background_media
    ? `/${background_media}`
    : "";

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {src &&
        (background_media_type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- source is admin-chosen at runtime (filename or cached backend proxy), not a static import Next can optimize
          <img
            key={src}
            src={src}
            alt=""
            className="w-full h-full object-cover"
            // Decorative full-bleed background, not the page's actual
            // content — decoding off the main thread and deprioritized
            // relative to real content avoids it competing for
            // bandwidth/CPU with things the user actually came here for.
            decoding="async"
            fetchPriority="low"
          />
        ) : (
          <video
            key={src}
            autoPlay
            muted
            loop
            playsInline
            // "metadata" fetches just enough (duration/dimensions/first
            // frame) to start playback and grow the buffer
            // progressively, instead of eagerly downloading the whole
            // file before anything else on the page — same visual
            // result (autoplay still starts immediately), meaningfully
            // less data pulled upfront for a background element that's
            // largely obscured by the gradient overlay anyway.
            preload="metadata"
            className="w-full h-full object-cover"
          >
            <source src={src} />
          </video>
        ))}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-[#08080B]" />
    </div>
  );
}
