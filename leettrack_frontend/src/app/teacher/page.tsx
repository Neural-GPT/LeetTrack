"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import BackgroundVideo from "@/components/BackgroundVideo";
import RequireRole from "@/components/RequireRole";
import FeedbackWidget from "@/components/FeedbackWidget";
import { api, ApiError } from "@/lib/api";

type Section = { id: number; name: string; year: string; department: string };
type Student = {
  user_id: number;
  full_name: string;
  section_id: number | null;
  section_name: string | null;
  leetcode_username: string;
};
type AssignmentOut = {
  id: number;
  problem_title: string;
  difficulty: string;
  deadline: string;
  problem_score: number;
  allow_ai_help: boolean;
};
type StarterProblem = {
  title: string;
  leetcode_url: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
};

const DEFAULT_TIMES = () => {
  const now = new Date();
  const release = new Date(now.getTime() + 5 * 60 * 1000); // 5 min from now
  const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24h
  const toLocalInput = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  };
  return { release: toLocalInput(release), deadline: toLocalInput(deadline) };
};

function CreateAssignmentForm({
  onCreated,
  sectionsRefreshKey,
}: {
  onCreated: () => void;
  sectionsRefreshKey: number;
}) {
  const defaults = DEFAULT_TIMES();

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [difficulty, setDifficulty] = useState<"Easy" | "Medium" | "Hard">("Medium");
  const [tags, setTags] = useState("");
  const [scope, setScope] = useState<"batch" | "section" | "students">("section");
  const [sectionId, setSectionId] = useState<number | "">("");
  const [studentIds, setStudentIds] = useState<number[]>([]);
  const [releaseTime, setReleaseTime] = useState(defaults.release);
  const [deadline, setDeadline] = useState(defaults.deadline);
  const [notes, setNotes] = useState("");
  const [hint, setHint] = useState("");
  const [allowAiHelp, setAllowAiHelp] = useState(false);
  const [problemScore, setProblemScore] = useState(20);

  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fetchingProblemInfo, setFetchingProblemInfo] = useState(false);
  const [problemInfoNote, setProblemInfoNote] = useState<string | null>(null);

  const [starterProblems, setStarterProblems] = useState<StarterProblem[]>([]);
  const [starterPick, setStarterPick] = useState("");

  function loadStarterProblems() {
    api
      .get<StarterProblem[]>("/api/teacher/starter-problems")
      .then(setStarterProblems)
      .catch(() => setStarterProblems([]));
  }

  useEffect(loadStarterProblems, []);

  // Quick-pick fills the same fields the manual flow does — nothing about
  // the rest of the form treats this differently, so a teacher can still
  // tweak the title/tags/points after picking, or ignore this dropdown
  // completely and paste their own link below like normal.
  function handleStarterPick(pickedUrl: string) {
    setStarterPick(pickedUrl);
    if (!pickedUrl) return;
    const match = starterProblems.find((p) => p.leetcode_url === pickedUrl);
    if (!match) return;
    setTitle(match.title);
    setUrl(match.leetcode_url);
    setDifficulty(match.difficulty);
    setTags(match.tags.join(", "));
    setProblemInfoNote(null);
  }

  useEffect(() => {
    api.get<Section[]>("/api/sections").then(setSections).catch(() => setSections([]));
  }, [sectionsRefreshKey]);

  useEffect(() => {
    if (scope !== "students") return;
    const query = sectionId ? `?section_id=${sectionId}` : "";
    api
      .get<Student[]>(`/api/teacher/students${query}`)
      .then(setStudents)
      .catch(() => setStudents([]));
  }, [scope, sectionId]);

  // Auto-fetches title/difficulty/tags straight from LeetCode once the
  // teacher finishes typing/pasting the URL — difficulty always gets
  // set from what LeetCode actually reports (so it can't drift out of
  // sync with the real problem); title/tags only fill in if the
  // teacher left them blank, so a custom title isn't clobbered.
  async function handleUrlBlur() {
    if (!url.trim()) return;
    setFetchingProblemInfo(true);
    setProblemInfoNote(null);
    try {
      const info = await api.get<{ title: string; difficulty: string; tags: string[] }>(
        `/api/teacher/leetcode-problem-info?url=${encodeURIComponent(url.trim())}`
      );
      setDifficulty(info.difficulty as typeof difficulty);
      if (!title.trim()) setTitle(info.title);
      if (!tags.trim() && info.tags.length > 0) setTags(info.tags.join(", "));
      setProblemInfoNote(`Fetched from LeetCode: ${info.difficulty}.`);
    } catch (err) {
      setProblemInfoNote(
        err instanceof ApiError
          ? `Couldn't auto-fetch: ${err.message} — set difficulty manually.`
          : "Couldn't auto-fetch that problem — set difficulty manually."
      );
    } finally {
      setFetchingProblemInfo(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (scope === "section" && !sectionId) {
      setError("Pick a section.");
      return;
    }
    if (scope === "students" && studentIds.length === 0) {
      setError("Select at least one student.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/assignments", {
        problem: {
          title,
          leetcode_url: url,
          difficulty,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        },
        scope,
        section_id: scope === "section" ? Number(sectionId) : null,
        student_ids: scope === "students" ? studentIds : [],
        assigned_date: new Date().toISOString(),
        release_time: new Date(releaseTime).toISOString(),
        deadline: new Date(deadline).toISOString(),
        notes,
        hint,
        problem_score: problemScore,
        allow_ai_help: allowAiHelp,
      });
      setSuccess(`Assigned "${title}": students have been notified.`);
      setTitle("");
      setUrl("");
      setTags("");
      setNotes("");
      setHint("");
      setAllowAiHelp(false);
      setStudentIds([]);
      setProblemInfoNote(null);
      setStarterPick("");
      loadStarterProblems();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the assignment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-4">New assignment</p>

      {error && (
        <div className="mb-4 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 text-sm text-accepted bg-accepted/10 border border-accepted/25 rounded-lg px-3.5 py-2.5">
          {success}
        </div>
      )}

      {starterProblems.length > 0 && (
        <div className="mb-5 glass rounded-xl p-4">
          <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
            New here? Quick-pick a starter problem
          </label>
          <select
            value={starterPick}
            onChange={(e) => handleStarterPick(e.target.value)}
            className="input"
          >
            <option value="">— or just paste a LeetCode link below —</option>
            {starterProblems.map((p) => (
              <option key={p.leetcode_url} value={p.leetcode_url}>
                {p.title} ({p.difficulty})
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted mt-1.5">
            A few easy, well-known problems to get your first assignment out fast. Each one
            drops off this list once you&apos;ve assigned it: pick one here, or ignore this and
            paste any LeetCode link into the fields below like usual.
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Problem title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="input"
            placeholder="Two Sum"
          />
        </Field>

        <Field label="LeetCode URL">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={handleUrlBlur}
            required
            className="input"
            placeholder="https://leetcode.com/problems/two-sum/"
          />
          {fetchingProblemInfo && (
            <p className="text-xs text-text-muted mt-1.5">Fetching difficulty from LeetCode…</p>
          )}
          {!fetchingProblemInfo && problemInfoNote && (
            <p className="text-xs text-text-muted mt-1.5">{problemInfoNote}</p>
          )}
        </Field>

        <Field label="Difficulty">
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
            className="input"
          >
            <option>Easy</option>
            <option>Medium</option>
            <option>Hard</option>
          </select>
          <p className="text-xs text-text-muted mt-1.5">
            Auto-filled from the LeetCode URL above — override here if it fetched wrong.
          </p>
        </Field>

        <Field label="Tags (comma-separated)">
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="input"
            placeholder="Array, Hash Map"
          />
        </Field>

        <Field label="Scope">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            className="input"
          >
            <option value="batch">Everyone</option>
            <option value="section">A section</option>
            <option value="students">Specific students</option>
          </select>
        </Field>

        {(scope === "section" || scope === "students") && (
          <Field label="Section">
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : "")}
              required={scope === "section"}
              className="input"
            >
              <option value="">{scope === "students" ? "All sections" : "Choose a section"}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Release time">
          <input
            type="datetime-local"
            value={releaseTime}
            onChange={(e) => setReleaseTime(e.target.value)}
            required
            className="input"
          />
        </Field>

        <Field label="Deadline">
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            required
            className="input"
          />
        </Field>

        <Field label="Points">
          <input
            type="number"
            min={1}
            value={problemScore}
            onChange={(e) => setProblemScore(Number(e.target.value))}
            required
            className="input"
          />
          <p className="text-xs text-text-muted mt-1.5">
            Base marks. Students can earn more than this with a fast, early, streak-backed solve.
          </p>
        </Field>
      </div>

      {scope === "students" && (
        <div className="mt-4">
          <label className="block text-xs text-text-muted uppercase tracking-wide mb-1.5">
            Students
          </label>
          {students.length === 0 ? (
            <p className="text-sm text-text-muted">No students found for that section.</p>
          ) : (
            <div className="glass rounded-lg p-3 max-h-48 overflow-y-auto space-y-1.5">
              {students.map((s) => (
                <label key={s.user_id} className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={studentIds.includes(s.user_id)}
                    onChange={(e) =>
                      setStudentIds((prev) =>
                        e.target.checked
                          ? [...prev, s.user_id]
                          : prev.filter((id) => id !== s.user_id)
                      )
                    }
                  />
                  <span>
                    {s.full_name}{" "}
                    <span className="text-text-muted">({s.section_name ?? "no section"})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input min-h-[70px]"
          />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Hint (optional)">
          <textarea
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            className="input min-h-[70px]"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2.5 text-sm mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={allowAiHelp}
          onChange={(e) => setAllowAiHelp(e.target.checked)}
        />
        <span>
          Allow AI help for this problem{" "}
          <span className="text-text-muted">
            (students can pick it in AI Chat tab, it discusses hints only, never a full
            solution)
          </span>
        </span>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 bg-brand-live text-[#0A0A0C] font-medium text-sm px-6 py-3 rounded-xl disabled:opacity-60"
      >
        {submitting ? "Assigning…" : "Create assignment"}
      </button>
    </form>
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

function AssignmentsList({ refreshKey }: { refreshKey: number }) {
  const [assignments, setAssignments] = useState<AssignmentOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<AssignmentOut[]>("/api/assignments")
      .then(setAssignments)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load assignments.")
      )
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function handleDelete(id: number) {
    try {
      await api.delete(`/api/assignments/${id}`);
      setAssignments((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // silently ignore — list will self-correct on next refresh
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-4">Your assignments</p>
      {loading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing created yet: the form above is a start.</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm text-text-primary flex items-center gap-2">
                  {a.problem_title}
                  {a.allow_ai_help && (
                    <span className="text-xs text-brand-live bg-brand-live-10 border border-brand-live-25 rounded-full px-2 py-0.5">
                      AI help on
                    </span>
                  )}
                </p>
                <p className="text-xs text-text-muted">
                  {a.difficulty} · {a.problem_score} pts · due{" "}
                  {new Date(a.deadline).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <button
                onClick={() => handleDelete(a.id)}
                className="text-xs text-danger hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionsPanel({ onChanged }: { onChanged: () => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [department, setDepartment] = useState("BCA");
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  function load() {
    api.get<Section[]>("/api/sections").then(setSections).catch(() => setSections([]));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/sections", { name, year, department });
      setName("");
      setYear("");
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create that section.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(section: Section) {
    if (!confirm(`Delete "${section.name}"? This can't be undone.`)) return;
    setDeleteError(null);
    setDeletingId(section.id);
    try {
      await api.delete(`/api/sections/${section.id}`);
      load();
      onChanged();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Couldn't delete that section.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="glass rounded-2xl p-7">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide">Sections</p>
          {sections.length === 0 && (
            <p className="text-sm text-text-secondary mt-1">
              None yet: students can&apos;t register until at least one exists.
            </p>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-sm text-brand-live hover:underline shrink-0"
        >
          {expanded ? "Close" : "+ New section"}
        </button>
      </div>

      {sections.length > 0 && (
        <ul className="mt-3 divide-y divide-white/10">
          {sections.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-text-primary">{s.name}</span>
              <button
                onClick={() => handleDelete(s)}
                disabled={deletingId === s.id}
                className="text-xs text-danger hover:underline disabled:opacity-60"
              >
                {deletingId === s.id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {deleteError && (
        <p className="mt-3 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
          {deleteError}
        </p>
      )}

      {expanded && (
        <form onSubmit={handleCreate} className="grid md:grid-cols-3 gap-3 mt-4">
          {error && (
            <p className="md:col-span-3 text-sm text-danger bg-danger/10 border border-danger/25 rounded-lg px-3.5 py-2.5">
              {error}
            </p>
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="input"
            placeholder="Section name, e.g. BCA-2B"
          />
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="input"
            placeholder="Year, e.g. 2nd"
          />
          <div className="flex gap-2">
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="input"
              placeholder="Department"
            />
            <button
              type="submit"
              disabled={submitting}
              className="bg-brand-live text-[#0A0A0C] font-medium text-sm px-4 rounded-lg shrink-0 disabled:opacity-60"
            >
              {submitting ? "…" : "Add"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function TeacherContent() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [sectionsRefreshKey, setSectionsRefreshKey] = useState(0);

  return (
    <div className="px-14 pb-16 max-w-[1020px] mx-auto">
      <div className="flex items-start justify-between mb-1">
        <h1 className="font-display font-semibold text-2xl">Assignments</h1>
        <FeedbackWidget />
      </div>
      <p className="text-sm text-text-secondary mb-8">
        Create a problem set, pick who it&apos;s for, done.
      </p>

      <div className="space-y-6">
        <SectionsPanel onChanged={() => setSectionsRefreshKey((k) => k + 1)} />
        <CreateAssignmentForm
          onCreated={() => setRefreshKey((k) => k + 1)}
          sectionsRefreshKey={sectionsRefreshKey}
        />
        <AssignmentsList refreshKey={refreshKey} />
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
          color: inherit;
        }
        .input:focus {
          border-color: rgba(255, 161, 22, 0.5);
        }
      `}</style>
    </div>
  );
}

export default function TeacherHome() {
  return (
    <RequireRole roles={["teacher", "super_admin"]}>
      <main className="min-h-screen">
        <BackgroundVideo />
        <Nav />
        <TeacherContent />
      </main>
    </RequireRole>
  );
}
