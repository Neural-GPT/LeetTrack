"""
Theming: accent color (free-form via a color wheel, presets below are
just quick-select shortcuts) and background media (video OR image now —
see BackgroundMedia model). Registered media filenames are managed by
the Super Admin through the UI (like Groq keys), not a hardcoded list —
the frontend and backend are separately deployed (Vercel + Railway/
Render), so the backend has no way to scan the frontend's public/
folder. The admin just registers whatever filename they uploaded, and
the display label is derived automatically.
"""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx

VIDEO_EXTENSIONS = {".mp4", ".webm"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS

_FILENAME_RE = re.compile(r"^[A-Za-z0-9_\-]+\.[A-Za-z0-9]+$")


@dataclass(frozen=True)
class AccentColorOption:
    name: str
    hex: str


# Quick-select shortcuts shown alongside the color wheel — cool tones
# only, per the request to move off the amber/orange LeetCode-esque
# accent. The wheel itself allows any hex; these are just presets.
ACCENT_COLOR_OPTIONS: list[AccentColorOption] = [
    AccentColorOption("Arctic Blue", "#4F9DDE"),
    AccentColorOption("Cyan Ice", "#38BDF8"),
    AccentColorOption("Indigo Frost", "#818CF8"),
    AccentColorOption("Steel Grey", "#94A3B8"),
    AccentColorOption("Slate", "#7C8798"),
    AccentColorOption("Graphite", "#9CA3AF"),
    AccentColorOption("Violet", "#A78BFA"),
    AccentColorOption("Teal", "#2DD4BF"),
    AccentColorOption("Sky", "#7DD3FC"),
    AccentColorOption("Periwinkle", "#93A5F7"),
    AccentColorOption("Mint", "#6EE7B7"),
    AccentColorOption("Rose Quartz", "#F4A8C0"),
]

# The two built-in look-and-feel presets, applied everywhere via a
# `data-theme` attribute on <html> (see globals.css). Purely a frontend
# styling switch — doesn't touch accent color or background media,
# which stay independently configurable.
THEME_PRESETS: list[str] = ["classic", "future"]

_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_URL_RE = re.compile(r"^https?://\S+$", re.IGNORECASE)


def is_valid_hex_color(value: str) -> bool:
    """Any 6-digit hex is fine — this is what backs the color wheel."""
    return bool(_HEX_RE.match(value))


def is_valid_theme_preset(value: str) -> bool:
    return value in THEME_PRESETS


def is_valid_media_url(url: str) -> bool:
    """Deliberately loose — just needs to be a plausible http(s) link.
    Unlike registered filenames, this doesn't have to live in the
    frontend's public/ folder, so there's no extension whitelist to
    enforce; the browser will simply fail to render an unsupported
    file, same as a broken link would."""
    return bool(_URL_RE.match(url.strip()))


def media_type_for_url(url: str) -> str:
    """Best-effort guess from the URL's extension (ignoring any query
    string) — defaults to 'image' if it can't tell, since that's the
    safer fallback (an <img> tag simply won't render a video, whereas
    a <video> tag with an image source shows nothing at all)."""
    path = url.split("?", 1)[0].split("#", 1)[0].lower()
    ext = "." + path.rsplit(".", 1)[-1] if "." in path.rsplit("/", 1)[-1] else ""
    return "video" if ext in VIDEO_EXTENSIONS else "image"


def is_valid_media_filename(filename: str) -> bool:
    """Letters/numbers/underscore/hyphen + one of the allowed extensions —
    deliberately strict, since this becomes a URL path segment on the
    frontend (`/${filename}`)."""
    if not _FILENAME_RE.match(filename):
        return False
    ext = "." + filename.rsplit(".", 1)[1].lower()
    return ext in ALLOWED_MEDIA_EXTENSIONS


def media_type_for(filename: str) -> str:
    """Returns 'video' or 'image' based on extension."""
    ext = "." + filename.rsplit(".", 1)[1].lower()
    return "video" if ext in VIDEO_EXTENSIONS else "image"


def derive_label(filename: str) -> str:
    """Call_of_Duty.mp4 -> 'Call Of Duty'"""
    stem = filename.rsplit(".", 1)[0]
    return stem.replace("_", " ").replace("-", " ").title()


# ---------------------------------------------------------------------
# Remote background caching
#
# When the Super Admin points the background at an external link, we
# don't want the site re-fetching that link on every single visitor's
# page load forever (slow, flaky if the host throttles/blocks
# hotlinking, and burns the *external* host's bandwidth continuously)
# — but we also don't want our own server storage to grow every time
# the admin swaps the link. The compromise: fetch the file from the
# external link exactly once, right when the admin sets/changes it,
# save it into a single-slot local cache, and serve every visitor
# from that local copy from then on. Changing the link (or clearing
# it) deletes the previous cached file, so there's only ever at most
# one cached background sitting on disk, capped at MAX_CACHE_BYTES.
# ---------------------------------------------------------------------

MEDIA_CACHE_DIR = Path(__file__).resolve().parent.parent / "media_cache"
MEDIA_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Generous for a background video/image, but bounded — protects disk
# space and keeps the one-time fetch from hanging forever on a huge file.
MAX_CACHE_BYTES = 60 * 1024 * 1024  # 60MB


class RemoteMediaFetchError(Exception):
    """Raised when the admin's link can't be downloaded/cached."""


def _content_type_extension(content_type: str) -> str | None:
    ct = content_type.split(";", 1)[0].strip().lower()
    return {
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }.get(ct)


def cache_remote_media(url: str) -> tuple[str, str]:
    """
    Downloads `url` into MEDIA_CACHE_DIR (streamed, capped at
    MAX_CACHE_BYTES) and returns (cache_filename, media_type).
    Raises RemoteMediaFetchError with a human-readable reason on
    failure — bad status, timeout, unsupported content, too large,
    connection refused, etc. — so the router can surface it directly
    to the admin instead of a raw stack trace.
    """
    digest = hashlib.sha256(url.encode()).hexdigest()[:24]
    tmp_path = MEDIA_CACHE_DIR / f".tmp-{digest}"

    parsed = urlparse(url)
    fetch_headers = {
        # Many wallpaper/motion-background hosts (e.g. motionbgs.com)
        # hotlink-protect their media with bot/UA + Referer checks —
        # an honest "LeetTrack/1.0" UA with no Referer gets a flat 403
        # from them even though the same URL loads fine in a real
        # browser (which sends both). Mimic a real browser request so
        # we don't get treated as a scraper.
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "*/*",
        "Referer": f"{parsed.scheme}://{parsed.netloc}/",
    }

    try:
        with httpx.stream(
            "GET", url, follow_redirects=True, timeout=15.0,
            headers=fetch_headers,
        ) as resp:
            if resp.status_code >= 400:
                raise RemoteMediaFetchError(
                    f"that link responded with HTTP {resp.status_code}."
                )
            content_type = resp.headers.get("content-type", "")
            ext = _content_type_extension(content_type) or _extension_from_url(url)
            if ext not in ALLOWED_MEDIA_EXTENSIONS:
                raise RemoteMediaFetchError(
                    "that link doesn't look like a video or image "
                    f"(got content-type '{content_type or 'unknown'}')."
                )

            total = 0
            with open(tmp_path, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=256 * 1024):
                    total += len(chunk)
                    if total > MAX_CACHE_BYTES:
                        raise RemoteMediaFetchError(
                            f"that file is bigger than the {MAX_CACHE_BYTES // (1024*1024)}MB "
                            "cache limit."
                        )
                    f.write(chunk)
            if total == 0:
                raise RemoteMediaFetchError("that link returned an empty response.")
    except httpx.RequestError as exc:
        tmp_path.unlink(missing_ok=True)
        raise RemoteMediaFetchError(f"couldn't reach that link ({exc.__class__.__name__}).") from exc
    except RemoteMediaFetchError:
        tmp_path.unlink(missing_ok=True)
        raise

    filename = f"{digest}{ext}"
    final_path = MEDIA_CACHE_DIR / filename
    tmp_path.replace(final_path)
    media_type = "video" if ext in VIDEO_EXTENSIONS else "image"
    return filename, media_type


def _extension_from_url(url: str) -> str:
    path = url.split("?", 1)[0].split("#", 1)[0].lower()
    tail = path.rsplit("/", 1)[-1]
    return "." + tail.rsplit(".", 1)[-1] if "." in tail else ""


def delete_cached_media(filename: str) -> None:
    """No-op if there's nothing cached or the file's already gone."""
    if not filename:
        return
    (MEDIA_CACHE_DIR / filename).unlink(missing_ok=True)