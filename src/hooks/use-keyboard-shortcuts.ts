"use client";
// use-keyboard-shortcuts.ts
// Global keyboard shortcuts for the arbitrage dashboard.
// Shortcuts:
//   /         → focus the search query input
//   Enter     → start a scan (when search input is focused and non-empty)
//   s         → pin/unpin the current query (saved queries)
//   e         → re-evaluate current results with latest config
//   j / k     → navigate result rows down / up (and open detail on Enter)
//   o         → open detail dialog for the active row
//   x         → export CSV
//   ?         → toggle the shortcuts help dialog
//   Escape    → close any open dialog / blur search
//
// The hook is intentionally side-effect-only: it accepts a handlers object
// and attaches a single keydown listener. Elements that should ignore the
// shortcuts (input, textarea, select, contenteditable) opt out unless the
// shortcut is explicitly allowed for them (e.g. Enter in the search input).
import { useEffect } from "react";

export interface ShortcutHandlers {
  onFocusSearch?: () => void;
  onScan?: () => void;
  onTogglePin?: () => void;
  onReevaluate?: () => void;
  onNextRow?: () => void;
  onPrevRow?: () => void;
  onOpenActiveRow?: () => void;
  onCopyBlueprint?: () => void;
  onCopyMarkdown?: () => void;
  onExportCsv?: () => void;
  onToggleHelp?: () => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape works everywhere — close dialogs / blur.
      if (e.key === "Escape") {
        if (isTypingTarget(e.target)) {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      const typing = isTypingTarget(e.target);

      // Enter in the search input → start scan.
      if (e.key === "Enter" && typing) {
        const el = e.target as HTMLInputElement;
        if (el.id === "query" || el.getAttribute("aria-label") === "Search Query") {
          e.preventDefault();
          handlers.onScan?.();
        }
        return;
      }

      // Ignore single-key shortcuts while typing.
      if (typing) return;

      // Ignore if any modifier is held (so browser shortcuts like Cmd+S work).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "/":
          e.preventDefault();
          handlers.onFocusSearch?.();
          break;
        case "s":
        case "S":
          e.preventDefault();
          handlers.onTogglePin?.();
          break;
        case "e":
        case "E":
          e.preventDefault();
          handlers.onReevaluate?.();
          break;
        case "j":
          e.preventDefault();
          handlers.onNextRow?.();
          break;
        case "k":
          e.preventDefault();
          handlers.onPrevRow?.();
          break;
        case "o":
          e.preventDefault();
          handlers.onOpenActiveRow?.();
          break;
        case "b":
          e.preventDefault();
          handlers.onCopyBlueprint?.();
          break;
        case "m":
          e.preventDefault();
          handlers.onCopyMarkdown?.();
          break;
        case "x":
        case "X":
          e.preventDefault();
          handlers.onExportCsv?.();
          break;
        case "?":
          e.preventDefault();
          handlers.onToggleHelp?.();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers, enabled]);
}

// Shortcuts help data — used by the help dialog to render the cheat sheet.
export const SHORTCUTS_HELP: Array<{ keys: string; desc: string }> = [
  { keys: "/", desc: "Focus search query" },
  { keys: "Enter", desc: "Start arbitrage scan (when search focused)" },
  { keys: "s", desc: "Pin / unpin current query" },
  { keys: "e", desc: "Re-evaluate results with current config" },
  { keys: "j", desc: "Next result row" },
  { keys: "k", desc: "Previous result row" },
  { keys: "o", desc: "Open detail dialog for active row" },
  { keys: "b", desc: "Copy blueprint for active row" },
  { keys: "m", desc: "Copy Markdown for active row" },
  { keys: "x", desc: "Export CSV" },
  { keys: "?", desc: "Toggle this shortcuts dialog" },
  { keys: "Esc", desc: "Close dialog / blur search" },
];
