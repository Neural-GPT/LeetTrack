"""
A deliberately tiny in-process TTL cache — not Redis, not a library,
just a dict with expiry timestamps. Scope is narrow on purpose: only
for responses that (a) are expensive to compute (N+1 query loops,
aggregation across many rows) and (b) are identical for every caller
given the same input parameters, so caching them can't leak one user's
data to another or serve stale-and-wrong data beyond the TTL window.

If this ever needs to work across multiple backend instances (e.g.
several Render/Railway workers behind a load balancer), swap this for
Redis — a single process's in-memory cache won't be shared with its
siblings, so a request could still land on an uncached process. For a
single-instance deployment (the common case here), this is a real win
with no infrastructure to add.
"""

import time
from threading import Lock
from typing import Any, Callable, TypeVar

T = TypeVar("T")

_store: dict[str, tuple[float, Any]] = {}
_lock = Lock()


def cached(key: str, ttl_seconds: float, compute: Callable[[], T]) -> T:
    """
    Returns the cached value for `key` if it's still within `ttl_seconds`
    of when it was computed; otherwise calls `compute()`, stores the
    result, and returns it. `compute` is only ever invoked on a cache
    miss/expiry, so it's safe to pass something that runs real queries.
    """
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit is not None and now - hit[0] < ttl_seconds:
            return hit[1]
    value = compute()
    with _lock:
        _store[key] = (now, value)
    return value


def invalidate(prefix: str = "") -> None:
    """Drops all cached entries whose key starts with `prefix` (or
    everything, if no prefix given) — call this after a write that
    would make a cached read stale sooner than its TTL, e.g. an admin
    action that should show up immediately rather than after a delay."""
    with _lock:
        for k in [k for k in _store if k.startswith(prefix)]:
            del _store[k]