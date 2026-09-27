// Browser janitor — reaps leaked Playwright chromium child processes.
//
// WHY: every scraper (vinted / kuantokusta / amazon / goofish / the shared
// OLX singleton) launches chromium as a DIRECT child of next-server and
// normally closes it in a `finally`. When a renderer hangs (observed under
// cgroup memory pressure: 0.18s CPU over 10 minutes) the scraper promise
// never settles, its finally never runs, and the watchdog path merely
// *reports* the timeout — leaving a live ~100-300MB browser behind. Multiple
// leaks compound into memory pressure, which then causes MORE hangs (the
// exact all-5-scrapers-stall observed in dev.log). This janitor breaks the
// feedback loop.
//
// SAFETY: only processes that are (a) direct children of THIS next-server
// pid, (b) launched from the ms-playwright cache path, and (c) present while
// NO scan is active are eligible. The user's own Chrome/Edge and the QA
// agent-browser daemon have different parents and are never touched. A
// browser is only killed after NO scan has been active for a full grace
// period, so a legitimately winding-down scrape is never interrupted while
// its task is still running — and if a task IS terminal, its scraper results
// were already discarded by the watchdog, so closing the browser discards
// nothing of value.

import { readFileSync, readdirSync } from "fs";
import { hasActiveScan } from "@/lib/task-store";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const GRACE_AFTER_LAST_SCAN_MS = 90 * 1000; // idle for ≥90s before reaping
const PLAYWRIGHT_PATH_RE = /ms-playwright[/\\](chromium|chromium_headless_shell)/;
const CHROME_BIN_RE = /chrome(-headless-shell)?(\.exe)?( |$)|chrome-linux[/\\]chrome/;

interface ProcInfo {
  pid: number;
  ppid: number;
  cmdline: string;
}

function readProc(pid: number): ProcInfo | null {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .split("\0")
      .filter(Boolean)
      .join(" ");
    // /proc/<pid>/stat field 4 is ppid (fields: pid (comm) state ppid ...)
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commEnd = stat.lastIndexOf(")");
    const fields = stat.slice(commEnd + 2).split(" ");
    const ppid = Number(fields[1]);
    if (!Number.isFinite(ppid)) return null;
    return { pid, ppid, cmdline };
  } catch {
    return null; // process vanished or not readable
  }
}

function listPlaywrightChildren(): ProcInfo[] {
  const out: ProcInfo[] = [];
  try {
    for (const entry of readdirSync("/proc")) {
      const pid = Number(entry);
      if (!Number.isFinite(pid) || pid === process.pid) continue;
      const info = readProc(pid);
      if (!info) continue;
      if (info.ppid !== process.pid) continue; // direct children only
      if (!PLAYWRIGHT_PATH_RE.test(info.cmdline)) continue;
      if (!CHROME_BIN_RE.test(info.cmdline)) continue;
      out.push(info);
    }
  } catch {
    // /proc unavailable (non-Linux) — janitor is a no-op there
  }
  return out;
}

/** Kill the given processes; returns how many were signaled. */
function reap(procs: ProcInfo[]): number {
  let killed = 0;
  for (const p of procs) {
    try {
      process.kill(p.pid, "SIGKILL");
      killed++;
      console.warn(
        `[BrowserJanitor] Reaped leaked playwright browser pid=${p.pid}: ${p.cmdline.slice(0, 120)}`,
      );
    } catch {
      // already gone
    }
  }
  return killed;
}

let lastScanActivityAt = Date.now();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

// ── Janitor metrics (surfaced via /api/system/health) ──────────────────
// Cheap counters so the debug panel can show the janitor is alive and how
// much it has cleaned since boot — no more grepping dev.log to answer
// "is the reaper working?".
interface JanitorStats {
  startedAt: number;
  sweeps: number;
  lastSweepAt: number | null;
  reapedTotal: number;
  lastReapedAt: number | null;
  lastReapedCount: number;
}
const janitorStats: JanitorStats = {
  startedAt: Date.now(),
  sweeps: 0,
  lastSweepAt: null,
  reapedTotal: 0,
  lastReapedAt: null,
  lastReapedCount: 0,
};

/** Snapshot of janitor activity since boot (read-only copy). */
export function getJanitorStats(): JanitorStats {
  return { ...janitorStats };
}

/** Called by the orchestrator whenever a scan starts or finishes. */
export function noteScanActivity(): void {
  lastScanActivityAt = Date.now();
}

/**
 * One sweep: if no scan is active and the last one ended >GRACE ago, any
 * playwright chromium child of this process is a leak — kill it.
 * Returns the number of browsers reaped (0 normally).
 */
export function sweepLingeringBrowsers(): number {
  janitorStats.sweeps++;
  janitorStats.lastSweepAt = Date.now();
  if (hasActiveScan()) return 0;
  if (Date.now() - lastScanActivityAt < GRACE_AFTER_LAST_SCAN_MS) return 0;
  const leaks = listPlaywrightChildren();
  if (leaks.length === 0) return 0;
  const killed = reap(leaks);
  janitorStats.reapedTotal += killed;
  janitorStats.lastReapedAt = Date.now();
  janitorStats.lastReapedCount = killed;
  return killed;
}

/** Count live playwright chromium children (for scan-end audit logs). */
export function countLiveBrowserChildren(): number {
  return listPlaywrightChildren().length;
}

/**
 * Start the periodic sweep. Idempotent — safe to call on every module init
 * (dev HMR re-imports included).
 */
export function startBrowserJanitor(): void {
  if (sweepTimer) return;
  janitorStats.startedAt = Date.now();
  sweepTimer = setInterval(() => {
    try {
      sweepLingeringBrowsers();
    } catch {
      // never let the janitor crash the interval
    }
  }, SWEEP_INTERVAL_MS);
  // Do not keep the process alive just for the janitor.
  if (typeof sweepTimer === "object" && sweepTimer && "unref" in sweepTimer) {
    (sweepTimer as unknown as { unref: () => void }).unref();
  }
}
