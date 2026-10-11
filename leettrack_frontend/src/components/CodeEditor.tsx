"use client";

import { useRef } from "react";

/**
 * Plain textarea tuned for typing code: monospace, no wrapping, and the
 * Tab key inserts four spaces instead of jumping to the next field.
 * Pressing Esc releases Tab so keyboard-only users can still leave the
 * editor; it re-arms as soon as the editor loses focus.
 */
export default function CodeEditor({
  id,
  value,
  onChange,
  placeholder,
  rows = 14,
  disabled = false,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const trapTab = useRef(true);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      trapTab.current = false;
      return;
    }
    if (e.key !== "Tab" || e.shiftKey || !trapTab.current) return;

    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    onChange(value.slice(0, start) + "    " + value.slice(end));
    // The controlled value re-renders with the caret at the end, so put
    // it back right after the inserted spaces.
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 4;
    });
  }

  const lineCount = value.length === 0 ? 0 : value.split("\n").length;

  return (
    <div>
      <textarea
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          trapTab.current = true;
        }}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="field-control code-area"
      />
      <div className="flex items-center justify-between gap-3 mt-2 text-xs text-text-muted">
        <span>Tab indents. Press Esc, then Tab, to move to the next field.</span>
        <span className="shrink-0">
          {lineCount} {lineCount === 1 ? "line" : "lines"}, {value.length} characters
        </span>
      </div>
    </div>
  );
}
