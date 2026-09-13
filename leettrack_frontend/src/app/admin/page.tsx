"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import BackgroundVideo from "@/components/BackgroundVideo";
import RequireRole from "@/components/RequireRole";
import { useTheme } from "@/lib/theme-context";
import { api, ApiError, downloadFile } from "@/lib/api";
import { FeedbackPanel, BroadcastPanel, SuperPowersPanel, ChatTogglePanel, PollPanel } from "@/components/admin/SuperAdminPanels";
import { SiteAnalyticsPanel } from "@/components/admin/SiteAnalyticsPanel";

type Batch = {
  id: number;
  period_start: string;
  period_end: string;
  status: "pending" | "downloaded" | "purged";
  record_count: number;
};

const statusColor: Record<Batch["status"], string> = {
  pending: "text-brand-live",
  downloaded: "text-accepted",
  purged: "text-text-muted",
};

// ---------------------------------------------------------------------
// Teacher creation
// ---------------------------------------------------------------------

function CreateTeacherPanel({ onCreated }: { onCreated: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.post("/api/auth/create-teacher", {
        full_name: fullName,
        email,
        username,
        password,
      });
      setSuccess(`Created — share these credentials with ${fullName} directly.`);
      setFullName("");
      setEmail("");
      setUsername("");
      setPassword("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create that account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide">Teacher accounts</p>
          <p className="text-sm text-text-secondary mt-1">
            There&apos;s no self-signup for teachers: you create the account here and hand off
            the credentials.
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-sm text-brand-live hover:underline shrink-0"
        >
          {expanded ? "Close" : "+ New teacher"}
        </button>
      </div>

      {expanded && (
        <form onSubmit={handleCreate} className="grid md:grid-cols-2 gap-3 mt-4">
          {error && (
            <p className="md:col-span-2 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
              {error}
            </p>
          )}
          {success && (
            <p className="md:col-span-2 text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
              {success}
            </p>
          )}
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
            placeholder="Full name"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
            placeholder="Email"
          />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
            placeholder="Username"
          />
          <div className="flex gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none flex-1"
              placeholder="Password (8+ chars)"
            />
            <button
              type="submit"
              disabled={submitting}
              className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-4 rounded-lg shrink-0 disabled:opacity-60"
            >
              {submitting ? "…" : "Create"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Teacher list + credential editing (requires re-entering admin password)
// ---------------------------------------------------------------------

type Teacher = { user_id: number; full_name: string; username: string; email: string; is_active: boolean };

// ---------------------------------------------------------------------
// Student creation (any email — bypasses the college-domain/OTP flow)
// ---------------------------------------------------------------------

type Section = { id: number; name: string };

function CreateStudentPanel() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sectionId, setSectionId] = useState<number | "">("");
  const [sections, setSections] = useState<Section[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (expanded) {
      api.get<Section[]>("/api/sections").then(setSections).catch(() => setSections([]));
    }
  }, [expanded]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.post("/api/auth/admin/create-student", {
        full_name: fullName,
        email,
        password,
        section_id: sectionId || null,
      });
      setSuccess(`Created — share these credentials with ${fullName} directly.`);
      setFullName("");
      setEmail("");
      setPassword("");
      setSectionId("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create that account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide">Student accounts</p>
          <p className="text-sm text-text-secondary mt-1">
            Normal signup needs a college email + OTP — use this to add a student with any
            email instead (transfers, edge cases, testing).
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-sm text-brand-live hover:underline shrink-0"
        >
          {expanded ? "Close" : "+ New student"}
        </button>
      </div>

      {expanded && (
        <form onSubmit={handleCreate} className="grid md:grid-cols-2 gap-3 mt-4">
          {error && (
            <p className="md:col-span-2 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
              {error}
            </p>
          )}
          {success && (
            <p className="md:col-span-2 text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
              {success}
            </p>
          )}
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
            placeholder="Full name"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
            placeholder="Any email"
          />
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : "")}
            className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="">No section (assign later)</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="glass rounded-lg px-3.5 py-2.5 text-sm outline-none flex-1"
              placeholder="Password (8+ chars)"
            />
            <button
              type="submit"
              disabled={submitting}
              className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-4 rounded-lg shrink-0 disabled:opacity-60"
            >
              {submitting ? "…" : "Create"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function EditTeacherModal({
  teacher,
  onClose,
  onSaved,
}: {
  teacher: Teacher;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [adminPassword, setAdminPassword] = useState("");
  const [newUsername, setNewUsername] = useState(teacher.username);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.patch(`/api/admin/teachers/${teacher.user_id}/credentials`, {
        admin_password: adminPassword,
        new_username: newUsername !== teacher.username ? newUsername : undefined,
        new_password: newPassword || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save changes.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6">
      <form onSubmit={handleSave} className="glass-strong rounded-2xl p-7 w-full max-w-sm">
        <p className="font-display font-medium text-lg mb-1">Edit {teacher.full_name}</p>
        <p className="text-xs text-text-muted mb-5">
          Confirm your own password to change this account&apos;s login.
        </p>

        {error && (
          <p className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5 mb-4">
            {error}
          </p>
        )}

        <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
          New username
        </label>
        <input
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none mb-4"
        />

        <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
          New password (leave blank to keep current)
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none mb-4"
          placeholder="At least 8 characters"
        />

        <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
          Your Super Admin password
        </label>
        <input
          type="password"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          required
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none mb-5"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 glass text-sm py-2.5 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-brand-live text-[#0A0A0C] font-medium text-sm py-2.5 rounded-lg disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteUserModal({
  userId,
  name,
  onClose,
  onDeleted,
}: {
  userId: number;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.delete(`/api/admin/users/${userId}`, { admin_password: adminPassword });
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6">
      <form onSubmit={handleDelete} className="glass-strong rounded-2xl p-7 w-full max-w-sm">
        <p className="font-display font-medium text-lg mb-1">Delete {name}?</p>
        <p className="text-xs text-text-muted mb-5">
          This can&apos;t be undone. Confirm your own password to proceed.
        </p>

        {error && (
          <p className="text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5 mb-4">
            {error}
          </p>
        )}

        <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
          Your Super Admin password
        </label>
        <input
          type="password"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          required
          className="w-full glass rounded-lg px-3.5 py-2.5 text-sm outline-none mb-5"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 glass text-sm py-2.5 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-danger text-white font-medium text-sm py-2.5 rounded-lg disabled:opacity-60"
          >
            {submitting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TeachersListPanel({ refreshKey }: { refreshKey: number }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [deleting, setDeleting] = useState<Teacher | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<Teacher[]>("/api/admin/teachers")
      .then(setTeachers)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load teachers."));
  }

  useEffect(load, [refreshKey]);

  async function toggleActive(t: Teacher) {
    try {
      await api.patch(`/api/admin/users/${t.user_id}/status`, { is_active: !t.is_active });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that account.");
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-4">All teachers</p>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : teachers.length === 0 ? (
        <p className="text-sm text-text-muted">None created yet.</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {teachers.map((t) => (
            <li key={t.user_id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm text-text-primary">
                  {t.full_name}
                  {!t.is_active && <span className="ml-2 text-xs text-danger">suspended</span>}
                </p>
                <p className="text-xs text-text-muted">
                  {t.username} · {t.email}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => toggleActive(t)}
                  className="text-sm text-text-secondary hover:underline"
                >
                  {t.is_active ? "Suspend" : "Reactivate"}
                </button>
                <button
                  onClick={() => setEditing(t)}
                  className="text-sm text-brand-live hover:underline"
                >
                  Edit login
                </button>
                <button
                  onClick={() => setDeleting(t)}
                  className="text-sm text-danger hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <DeleteUserModal
          userId={deleting.user_id}
          name={deleting.full_name}
          onClose={() => setDeleting(null)}
          onDeleted={load}
        />
      )}

      {editing && (
        <EditTeacherModal
          teacher={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}

type StudentAdmin = {
  user_id: number;
  full_name: string;
  email: string;
  section_id: number | null;
  section_name: string | null;
  is_active: boolean;
  github_username: string | null;
};

function StudentsListPanel() {
  const [students, setStudents] = useState<StudentAdmin[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [deleting, setDeleting] = useState<StudentAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [savingSectionFor, setSavingSectionFor] = useState<number | null>(null);

  function load() {
    api
      .get<StudentAdmin[]>("/api/admin/students")
      .then(setStudents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load students."));
    api
      .get<Section[]>("/api/sections")
      .then(setSections)
      .catch(() => setSections([]));
  }

  useEffect(() => {
    if (expanded) load();
  }, [expanded]);

  async function toggleActive(s: StudentAdmin) {
    try {
      await api.patch(`/api/admin/users/${s.user_id}/status`, { is_active: !s.is_active });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update that account.");
    }
  }

  async function assignSection(s: StudentAdmin, sectionId: string) {
    setSavingSectionFor(s.user_id);
    try {
      await api.patch(`/api/admin/students/${s.user_id}/profile`, {
        section_id: sectionId ? Number(sectionId) : null,
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't assign that section.");
    } finally {
      setSavingSectionFor(null);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted uppercase tracking-wide">All students</p>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-sm text-brand-live hover:underline shrink-0"
        >
          {expanded ? "Close" : "View / manage"}
        </button>
      </div>
      {expanded && sections.length === 0 && (
        <p className="text-xs text-text-muted mt-2">
          No sections exist yet — a teacher (or you, from Create Student) needs to make one before
          it can be assigned here.
        </p>
      )}

      {expanded && (
        <div className="mt-4">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : students.length === 0 ? (
            <p className="text-sm text-text-muted">None registered yet.</p>
          ) : (
            <ul className="divide-y divide-white/10 max-h-96 overflow-y-auto">
              {students.map((s) => (
                <li key={s.user_id} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">
                      {s.full_name}
                      {!s.is_active && (
                        <span className="ml-2 text-xs text-danger">suspended</span>
                      )}
                    </p>
                    <p className="text-xs text-text-muted truncate">{s.email}</p>
                    {s.github_username && (
                      <a
                        href={`https://github.com/${s.github_username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand-live hover:underline"
                      >
                        github.com/{s.github_username}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <select
                      value={s.section_id ?? ""}
                      onChange={(e) => assignSection(s, e.target.value)}
                      disabled={savingSectionFor === s.user_id}
                      className="glass rounded-lg px-2.5 py-1.5 text-xs outline-none disabled:opacity-50"
                    >
                      <option value="">No section</option>
                      {sections.map((sec) => (
                        <option key={sec.id} value={sec.id}>
                          {sec.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => toggleActive(s)}
                      className="text-sm text-text-secondary hover:underline"
                    >
                      {s.is_active ? "Suspend" : "Reactivate"}
                    </button>
                    <button
                      onClick={() => setDeleting(s)}
                      className="text-sm text-danger hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {deleting && (
        <DeleteUserModal
          userId={deleting.user_id}
          name={deleting.full_name}
          onClose={() => setDeleting(null)}
          onDeleted={load}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Appearance: accent color + background video, both Super Admin-controlled
// ---------------------------------------------------------------------

type ThemeOptions = {
  accent_colors: { name: string; hex: string }[];
  media: { id: number; filename: string; label: string; media_type: "video" | "image" }[];
  theme_presets: string[];
};

type CurrentTheme = {
  accent_color: string;
  background_media: string;
  background_media_url: string;
  background_media_proxy_path: string;
  theme_preset: string;
  dark_surfaces_enabled: boolean;
  dark_surfaces_color: string;
};

const THEME_PRESET_LABELS: Record<string, { name: string; blurb: string }> = {
  classic: { name: "Classic Dark", blurb: "The original light-frost glass panels." },
  future: { name: "Future", blurb: "Darker, more solid panels." },
};

function AppearancePanel() {
  const theme = useTheme();
  const [options, setOptions] = useState<ThemeOptions | null>(null);
  const [current, setCurrent] = useState<CurrentTheme>({
    accent_color: theme.accent_color,
    background_media: theme.background_media,
    background_media_url: theme.background_media_url,
    background_media_proxy_path: theme.background_media_proxy_path,
    theme_preset: theme.theme_preset,
    dark_surfaces_enabled: theme.dark_surfaces_enabled,
    dark_surfaces_color: theme.dark_surfaces_color,
  });
  const [wheelColor, setWheelColor] = useState(theme.accent_color);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [newFilename, setNewFilename] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [mediaUrlSaving, setMediaUrlSaving] = useState(false);
  const [urlPreviewStatus, setUrlPreviewStatus] = useState<"idle" | "ok" | "error">("idle");

  function guessMediaType(url: string): "image" | "video" {
    const path = url.split("?")[0].split("#")[0].toLowerCase();
    return /\.(mp4|webm)$/.test(path) ? "video" : "image";
  }

  function loadOptions() {
    // no-store: this is always called either on initial mount or right
    // after the admin's own add/delete write — it must reflect that
    // write immediately, not whatever the browser has cached.
    api
      .get<ThemeOptions>("/api/settings/theme/options", { cache: "no-store" })
      .then(setOptions)
      .catch(() => null);
  }

  useEffect(() => {
    loadOptions();
    api
      .get<CurrentTheme>("/api/settings/theme")
      .then((t) => {
        setCurrent(t);
        setWheelColor(t.accent_color);
        setMediaUrlInput(t.background_media_url);
      })
      .catch(() => null);
  }, []);

  function livePreview(update: Partial<CurrentTheme>) {
    if (update.accent_color) {
      document.documentElement.style.setProperty("--color-brand", update.accent_color);
    }
    if (update.theme_preset) {
      document.documentElement.setAttribute("data-theme", update.theme_preset);
    }
    if (update.dark_surfaces_enabled !== undefined) {
      document.documentElement.setAttribute(
        "data-dark-surfaces",
        update.dark_surfaces_enabled ? "on" : "off"
      );
    }
    if (update.dark_surfaces_color) {
      document.documentElement.style.setProperty(
        "--color-surface-dark",
        update.dark_surfaces_color
      );
    }
  }

  async function apply(update: Partial<CurrentTheme>) {
    setSaving(true);
    setMessage(null);
    const next = { ...current, ...update };
    // Live preview immediately, even before the save round-trip finishes.
    livePreview(update);
    try {
      await api.patch("/api/settings/theme", update);
      setCurrent(next);
      setMessage("Saved — applies for everyone on next page load.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't save that.");
      // Roll the preview back since the save failed.
      livePreview(current);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetMediaUrl(e: React.FormEvent) {
    e.preventDefault();
    setMediaUrlSaving(true);
    setMessage(null);
    try {
      // The backend fetches and caches this link server-side as part of
      // the same request, so this can take a few seconds for a larger
      // video — that's expected, it only happens on save, never on a
      // visitor's page load.
      const updated = await api.patch<CurrentTheme>("/api/settings/theme", {
        background_media_url: mediaUrlInput.trim(),
      });
      setCurrent(updated);
      setMessage(
        mediaUrlInput.trim()
          ? "Cached and saved — every visitor now loads it from this server, not the original link."
          : "Cleared — falling back to the registered media below."
      );
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't save that link.");
    } finally {
      setMediaUrlSaving(false);
    }
  }

  // Debounce the wheel — dragging it fires dozens of events a second,
  // no reason to hit the API for every one. Preview updates instantly
  // either way since it's just a CSS variable set.
  function handleWheelChange(hex: string) {
    setWheelColor(hex);
    document.documentElement.style.setProperty("--color-brand", hex);
  }

  function handleWheelCommit(hex: string) {
    apply({ accent_color: hex });
  }

  async function handleAddMedia(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      await api.post("/api/settings/background-media", { filename: newFilename.trim() });
      setNewFilename("");
      loadOptions();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Couldn't register that file.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteMedia(id: number) {
    try {
      await api.delete(`/api/settings/background-media/${id}`);
      loadOptions();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Couldn't remove that.");
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Appearance</p>
      <p className="text-sm text-text-secondary mb-5">
        Controls the accent color and background media for the whole site.
      </p>

      <p className="text-xs text-text-muted uppercase tracking-wide mb-2.5">Accent color</p>

      <div className="flex items-center gap-4 mb-4">
        <label className="relative shrink-0 cursor-pointer">
          <input
            type="color"
            value={wheelColor}
            onChange={(e) => handleWheelChange(e.target.value)}
            onBlur={(e) => handleWheelCommit(e.target.value)}
            className="absolute inset-0 w-12 h-12 opacity-0 cursor-pointer"
          />
          <div
            className="w-12 h-12 rounded-full border-2 border-white/30"
            style={{ backgroundColor: wheelColor }}
          />
        </label>
        <div>
          <p className="text-sm text-text-primary font-display">{wheelColor.toUpperCase()}</p>
          <p className="text-xs text-text-muted">Pick any color from the wheel</p>
        </div>
      </div>

      <p className="text-xs text-text-muted mb-2">or a quick preset</p>
      <div className="flex flex-wrap gap-2.5 mb-6">
        {options?.accent_colors.map((c) => (
          <button
            key={c.hex}
            onClick={() => {
              setWheelColor(c.hex);
              apply({ accent_color: c.hex });
            }}
            disabled={saving}
            title={c.name}
            className={`w-9 h-9 rounded-full border-2 transition-transform hover:scale-110 ${
              current.accent_color.toLowerCase() === c.hex.toLowerCase()
                ? "border-white"
                : "border-transparent"
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>

      <p className="text-xs text-text-muted uppercase tracking-wide mb-2.5">
        Background media — direct link
      </p>
      <p className="text-sm text-text-secondary mb-3">
        Paste a link to an already-hosted image or video — no need to upload anything to the
        frontend&apos;s public/ folder. On save, the server fetches it <em>once</em> and caches
        its own copy, so every visitor loads it from here (fast, works even if the original site
        blocks hotlinking) instead of everyone&apos;s browser re-fetching the external link on
        every page load. Only one link is cached at a time — pasting a new one replaces it and
        the old cached copy is deleted, so this never piles up storage. Takes priority over the
        registered media picker below; clear the field and save to fall back to that instead.
        <span className="block mt-1.5 text-text-muted">
          Important: this needs to be a link straight to the actual file (usually ending in
          .mp4/.webm or .jpg/.png/.webp) — not a webpage that displays one. E.g. from a wallpaper
          site, that&apos;s the video/image&apos;s own address, not the gallery page you view it
          on. Use the preview below to confirm before saving.
        </span>
      </p>
      <form onSubmit={handleSetMediaUrl} className="flex gap-2 mb-3">
        <input
          value={mediaUrlInput}
          onChange={(e) => {
            setMediaUrlInput(e.target.value);
            setUrlPreviewStatus("idle");
          }}
          placeholder="https://example.com/background.mp4"
          className="flex-1 glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={mediaUrlSaving}
          className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-4 rounded-lg disabled:opacity-60 shrink-0"
        >
          {mediaUrlSaving
            ? "Fetching & caching…"
            : current.background_media_url
            ? "Update"
            : "Use this link"}
        </button>
      </form>

      {mediaUrlInput.trim() && (
        <div className="mb-6">
          <p className="text-xs text-text-muted mb-1.5">
            Preview — check this loads before saving
          </p>
          <div className="w-full max-w-xs aspect-video rounded-lg overflow-hidden glass">
            {guessMediaType(mediaUrlInput) === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin-pasted URL, not a static import
              <img
                key={mediaUrlInput}
                src={mediaUrlInput}
                alt=""
                className="w-full h-full object-cover"
                onLoad={() => setUrlPreviewStatus("ok")}
                onError={() => setUrlPreviewStatus("error")}
              />
            ) : (
              <video
                key={mediaUrlInput}
                muted
                autoPlay
                loop
                playsInline
                className="w-full h-full object-cover"
                onLoadedData={() => setUrlPreviewStatus("ok")}
                onError={() => setUrlPreviewStatus("error")}
              >
                <source src={mediaUrlInput} />
              </video>
            )}
          </div>
          {urlPreviewStatus === "error" && (
            <p className="text-xs text-danger mt-1.5 max-w-sm">
              Couldn&apos;t load that as {guessMediaType(mediaUrlInput)}. Common causes: this is a
              webpage that <em>shows</em> a video rather than a direct link to the file itself
              (right-click the video/image on that page and copy its own address, or check the
              page for a direct download link), the extension doesn&apos;t match the actual file
              type, or the host blocks hotlinking/CORS from other sites.
            </p>
          )}
          {urlPreviewStatus === "ok" && (
            <p className="text-xs text-accepted mt-1.5">Loads fine — ready to save.</p>
          )}
        </div>
      )}

      {current.background_media_url && (
        <p className="text-xs text-brand-live mb-6">
          Currently active — serving from this server&apos;s cache, not the original link
          directly. The registered media picker below is being ignored while this is set.
        </p>
      )}

      <p className="text-xs text-text-muted uppercase tracking-wide mb-2.5">
        Background media — registered files
      </p>

      {(!options || options.media.length === 0) && (
        <p className="text-sm text-text-muted mb-3">
          Nothing registered yet — add a file below. It needs to already be uploaded to the
          frontend&apos;s public/ folder with this exact name.
        </p>
      )}

      {options && options.media.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-4">
          {options.media.map((m) => (
            <div
              key={m.filename}
              className={`flex items-center justify-between gap-2 text-sm px-3.5 py-2.5 rounded-lg transition-colors ${
                current.background_media === m.filename && !current.background_media_url
                  ? "bg-brand-live-15 text-brand-live border border-brand-live-30"
                  : "glass text-text-secondary"
              }`}
            >
              <button
                onClick={() => apply({ background_media: m.filename })}
                disabled={saving}
                className="flex-1 text-left truncate"
                title={m.filename}
              >
                {m.label}
                <span className="block text-[10px] opacity-70 uppercase tracking-wide">
                  {m.media_type}
                </span>
              </button>
              <button
                onClick={() => handleDeleteMedia(m.id)}
                title="Remove from the picker"
                className="text-xs text-danger hover:underline shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAddMedia} className="flex gap-2">
        {addError && (
          <p className="w-full text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
            {addError}
          </p>
        )}
        <input
          value={newFilename}
          onChange={(e) => setNewFilename(e.target.value)}
          required
          placeholder="Filename in public/, e.g. Call_of_Duty.mp4"
          className="flex-1 glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={adding}
          className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-4 rounded-lg disabled:opacity-60 shrink-0"
        >
          {adding ? "…" : "Add"}
        </button>
      </form>
      <p className="text-xs text-text-muted mt-2 mb-6">
        Video: .mp4 or .webm. Image: .jpg, .jpeg, .png, or .webp. Label is derived from the
        filename automatically — underscores become spaces.
      </p>

      <p className="text-xs text-text-muted uppercase tracking-wide mb-2.5">Site theme</p>
      <p className="text-sm text-text-secondary mb-3">
        Switches panel styling across every page — dashboards, admin, leaderboard, all of it.
        Doesn&apos;t touch accent color or background media, which stay set separately above.
      </p>
      <div className="flex flex-wrap gap-2.5 mb-6">
        {(options?.theme_presets ?? ["classic", "future"]).map((preset) => {
          const label = THEME_PRESET_LABELS[preset] ?? { name: preset, blurb: "" };
          const active = current.theme_preset === preset;
          return (
            <button
              key={preset}
              onClick={() => apply({ theme_preset: preset })}
              disabled={saving}
              className={`text-left px-4 py-3 rounded-xl transition-colors ${
                active
                  ? "bg-brand-live-15 text-brand-live border border-brand-live-30"
                  : "glass text-text-secondary"
              }`}
            >
              <p className="text-sm font-display">{label.name}</p>
              {label.blurb && <p className="text-xs opacity-70 mt-0.5">{label.blurb}</p>}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-text-muted uppercase tracking-wide mb-2.5">
        Solid backgrounds for chat &amp; notifications
      </p>
      <p className="text-sm text-text-secondary mb-3">
        Forces a solid color (instead of the usual glass tint) behind the AI chat input, the AI
        assistant&apos;s reply bubbles, and the notification dropdown.
      </p>
      <div className="flex items-center gap-4 mb-6">
        <button
          role="switch"
          aria-checked={current.dark_surfaces_enabled}
          onClick={() => apply({ dark_surfaces_enabled: !current.dark_surfaces_enabled })}
          disabled={saving}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
            current.dark_surfaces_enabled ? "bg-brand-live" : "bg-white/15"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              current.dark_surfaces_enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
        <p className="text-sm text-text-primary">
          {current.dark_surfaces_enabled ? "On" : "Off"}
        </p>

        <label className="relative shrink-0 cursor-pointer ml-auto">
          <input
            type="color"
            value={current.dark_surfaces_color}
            onChange={(e) => apply({ dark_surfaces_color: e.target.value })}
            className="absolute inset-0 w-9 h-9 opacity-0 cursor-pointer"
          />
          <div
            className="w-9 h-9 rounded-full border-2 border-white/30"
            style={{ backgroundColor: current.dark_surfaces_color }}
          />
        </label>
        <p className="text-xs text-text-muted font-display">
          {current.dark_surfaces_color.toUpperCase()}
        </p>
      </div>

      {message && <p className="text-xs text-text-muted">{message}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------
// NVIDIA API keys
// ---------------------------------------------------------------------

type NvidiaKey = {
  id: number;
  masked_key: string;
  label: string;
  is_active: boolean;
  failure_count: number;
};

function NvidiaKeysPanel() {
  const [keys, setKeys] = useState<NvidiaKey[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    api.get<NvidiaKey[]>("/api/settings/nvidia-keys").then(setKeys).catch(() => setKeys([]));
  }

  useEffect(load, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/settings/nvidia-keys", { key: newKey, label: newLabel });
      setNewKey("");
      setNewLabel("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    await api.delete(`/api/settings/nvidia-keys/${id}`).catch(() => null);
    load();
  }

  async function handleToggle(id: number) {
    await api.patch(`/api/settings/nvidia-keys/${id}/toggle`).catch(() => null);
    load();
  }

  return (
    <section className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">AI Assistant (NVIDIA)</p>
      <p className="text-sm text-text-secondary mb-5">
        Add one or more keys — if one runs out or gets rate-limited, the assistant automatically
        tries the next.
      </p>

      {keys.length > 0 && (
        <ul className="divide-y divide-white/10 mb-4">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm text-text-primary font-display">{k.masked_key}</p>
                <p className="text-xs text-text-muted">
                  {k.label || "Unlabeled"} ·{" "}
                  <span className={k.is_active ? "text-accepted" : "text-danger"}>
                    {k.is_active ? "active" : "disabled"}
                  </span>
                  {k.failure_count > 0 && ` · ${k.failure_count} recent failures`}
                </p>
              </div>
              <div className="flex gap-3 text-sm">
                <button onClick={() => handleToggle(k.id)} className="text-brand-live hover:underline">
                  {k.is_active ? "Disable" : "Re-enable"}
                </button>
                <button onClick={() => handleDelete(k.id)} className="text-danger hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
        {error && (
          <p className="w-full text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
            {error}
          </p>
        )}
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          required
          placeholder="nvapi-..."
          className="flex-1 min-w-[200px] glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
        />
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-40 glass rounded-lg px-3.5 py-2.5 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={submitting}
          className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-4 rounded-lg disabled:opacity-60"
        >
          {submitting ? "…" : "Add key"}
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------
// Data Center
// ---------------------------------------------------------------------

function DataCenterPanel() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function loadBatches() {
    setLoading(true);
    api
      .get<Batch[]>("/api/data-center/batches")
      .then(setBatches)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load batches."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadBatches();
    api
      .get<{ data_retention_days: number }>("/api/data-center/settings")
      .then((s) => setRetentionDays(s.data_retention_days))
      .catch(() => setRetentionDays(null));
  }, []);

  async function handleCreateBatch() {
    setBusy(true);
    setActionMessage(null);
    try {
      const batch = await api.post<Batch>("/api/data-center/batches/create?days=7");
      setActionMessage(`Created a batch with ${batch.record_count} records.`);
      loadBatches();
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : "Couldn't create a batch.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(batch: Batch) {
    try {
      await downloadFile(
        `/api/data-center/batches/${batch.id}/download`,
        `leettrack-export-${batch.period_start.slice(0, 10)}.json`
      );
      loadBatches();
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : "Download failed.");
    }
  }

  async function handlePurge() {
    setBusy(true);
    setActionMessage(null);
    try {
      const result = await api.post<{ purged_batches: number }>("/api/data-center/purge-expired");
      setActionMessage(
        result.purged_batches === 0
          ? "Nothing was old enough to purge yet."
          : `Purged raw data for ${result.purged_batches} batch(es).`
      );
      loadBatches();
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : "Couldn't run the purge.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-4">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide">Data Center</p>
          <p className="text-sm text-text-secondary mt-1">
            Raw submission data, batched for export
            {retentionDays !== null && ` — purged ${retentionDays} days after download`}.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreateBatch}
            disabled={busy}
            className="glass text-sm px-4 py-2.5 rounded-lg disabled:opacity-60"
          >
            Create batch (last 7 days)
          </button>
          <button
            onClick={handlePurge}
            disabled={busy}
            className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-4 py-2.5 rounded-lg disabled:opacity-60"
          >
            Run purge sweep
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="mt-4 text-sm text-text-primary glass rounded-lg px-3.5 py-2.5">
          {actionMessage}
        </div>
      )}

      <div className="rounded-xl overflow-hidden mt-4 border border-white/10">
        {loading ? (
          <p className="text-sm text-text-secondary text-center py-12">Loading…</p>
        ) : error ? (
          <p className="text-sm text-danger text-center py-12">{error}</p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-12">
            No batches yet — create one above, or wait for the weekly scheduled job.
          </p>
        ) : (
          <ul className="divide-y divide-white/10">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-text-primary">
                    {new Date(b.period_start).toLocaleDateString()} –{" "}
                    {new Date(b.period_end).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-text-muted">
                    {b.record_count} records ·{" "}
                    <span className={statusColor[b.status]}>{b.status}</span>
                  </p>
                </div>
                {b.status !== "purged" && (
                  <button
                    onClick={() => handleDownload(b)}
                    className="text-sm text-brand-live hover:underline"
                  >
                    Download
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------

function AdminContent() {
  const [teachersRefreshKey, setTeachersRefreshKey] = useState(0);

  return (
    <div className="px-14 pb-16 max-w-[940px] mx-auto">
      <h1 className="font-display font-semibold text-2xl mb-1">Super Admin</h1>
      <p className="text-sm text-text-secondary mb-6">
        Account provisioning, appearance, and data lifecycle.
      </p>

      <div className="space-y-6">
        <CreateTeacherPanel onCreated={() => setTeachersRefreshKey((k) => k + 1)} />
        <CreateStudentPanel />
        <TeachersListPanel refreshKey={teachersRefreshKey} />
        <StudentsListPanel />
        <FeedbackPanel />
        <BroadcastPanel />
        <PollPanel />
        <ChatTogglePanel />
        <SiteAnalyticsPanel />
        <SuperPowersPanel />
        <AppearancePanel />
        <NvidiaKeysPanel />
        <DataCenterPanel />
      </div>
    </div>
  );
}

export default function AdminHome() {
  return (
    <RequireRole roles={["super_admin"]}>
      <main className="min-h-screen">
        <BackgroundVideo />
        <Nav />
        <AdminContent />
      </main>
    </RequireRole>
  );
}
