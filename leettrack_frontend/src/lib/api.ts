export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  role: "student" | "teacher" | "super_admin";
};

const ACCESS_KEY = "leettrack_access_token";
const REFRESH_KEY = "leettrack_refresh_token";
const ROLE_KEY = "leettrack_role";

export function storeTokens(tokens: TokenPair) {
  localStorage.setItem(ACCESS_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
  localStorage.setItem(ROLE_KEY, tokens.role);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(ROLE_KEY);
  // Site-wide chat's "last read message" tracker (see ChatBubble.tsx) —
  // wipe it on logout so the next person to log in on this browser
  // doesn't inherit someone else's read state.
  localStorage.removeItem("leettrack_chat_last_seen_id");
}

export function getAccessToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRole() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ROLE_KEY) as TokenPair["role"] | null;
}

export class ApiError extends Error {
  status: number;
  // Populated only for 5xx responses that included one (see backend's
  // global exception handlers in app/main.py) — surfaceable in the UI
  // so a user can quote it when reporting a bug, without exposing any
  // actual stack trace or internals.
  errorId?: string;
  constructor(status: number, message: string, errorId?: string) {
    super(message);
    this.status = status;
    this.errorId = errorId;
  }
}

/**
 * True for "the request never reached the server" failures — offline,
 * DNS failure, CORS misconfiguration, backend down entirely. `fetch`
 * rejects (rather than resolving with a bad status) in exactly these
 * cases, so we can give a distinctly different, more actionable
 * message than a normal 4xx/5xx ApiError.
 */
export class NetworkError extends Error {
  constructor() {
    super(
      "Couldn't reach the server. Check your internet connection and try again."
    );
  }
}

async function doFetch(url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch {
    throw new NetworkError();
  }
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  try {
    const res = await doFetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;

    const tokens: TokenPair = await res.json();
    storeTokens(tokens);
    return true;
  } catch {
    // Network error while refreshing — treat as "couldn't refresh"
    // rather than throwing, so the caller's own error handling (which
    // knows about the *original* request) takes over instead.
    return false;
  }
}

async function errorDetailFromResponse(
  res: Response
): Promise<{ detail: string; errorId?: string }> {
  // A handful of statuses are common enough, and generic enough, that
  // a friendlier default beats whatever raw text the server sent —
  // still overridden below if the body has a real `detail`.
  let detail =
    res.status === 429
      ? "Too many attempts. Please wait a moment and try again."
      : res.status >= 500
      ? "The server ran into a problem. Please try again shortly."
      : res.statusText || "Something went wrong.";
  let errorId: string | undefined;
  try {
    const body = await res.json();
    // FastAPI's `detail` is usually a plain string (from
    // HTTPException(status, "message")), but on a 422 validation
    // error it's an ARRAY of {loc, msg, type} objects instead — that
    // array is truthy, so it used to get assigned straight into
    // `detail` and then implicitly stringified by `new Error()` into
    // "[object Object]" (Array.toString() on an array of objects).
    // Normalize every shape down to an actual readable string.
    if (typeof body.detail === "string") {
      detail = body.detail;
    } else if (Array.isArray(body.detail)) {
      detail = body.detail
        .map((e: { msg?: string; loc?: unknown[] }) => {
          const field = Array.isArray(e.loc) ? e.loc.at(-1) : null;
          return field ? `${field}: ${e.msg ?? "invalid"}` : e.msg ?? JSON.stringify(e);
        })
        .join("; ");
    } else if (body.detail) {
      detail = JSON.stringify(body.detail);
    }
    if (typeof body.error_id === "string") errorId = body.error_id;
  } catch {
    // response wasn't JSON — fall back to the default above
  }
  return { detail, errorId };
}

/**
 * Core request helper. Attaches the bearer token automatically, retries
 * once via refresh on a 401, and throws ApiError with the backend's
 * detail message so callers can show it directly.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  _retried = false
): Promise<T> {
  const token = getAccessToken();

  const res = await doFetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !_retried && getAccessToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiFetch<T>(path, options, true);
    clearTokens();
  }

  if (!res.ok) {
    const { detail, errorId } = await errorDetailFromResponse(res);
    throw new ApiError(res.status, detail, errorId);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Like apiFetch, but returns the raw Response instead of parsing JSON —
 * for endpoints that stream a body (e.g. the AI assistant's streamed
 * chat reply) rather than returning a single JSON payload. Same auth
 * attach + 401-refresh-retry + ApiError-on-failure behavior as apiFetch.
 */
export async function streamFetch(
  path: string,
  options: RequestInit = {},
  _retried = false
): Promise<Response> {
  const token = getAccessToken();

  const res = await doFetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !_retried && getAccessToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return streamFetch(path, options, true);
    clearTokens();
  }

  if (!res.ok) {
    const { detail, errorId } = await errorDetailFromResponse(res);
    throw new ApiError(res.status, detail, errorId);
  }

  return res;
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getAccessToken();
  const res = await doFetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const { detail, errorId } = await errorDetailFromResponse(res);
    throw new ApiError(res.status, detail || "Couldn't download that file.", errorId);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T = unknown>(path: string, options?: RequestInit) => apiFetch<T>(path, options),
  post: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};

export type { TokenPair };