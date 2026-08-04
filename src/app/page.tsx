"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Radar,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Github,
  Globe,
  ShieldCheck,
  Download,
  Settings2,
  Calculator,
  FileJson,
  Sparkles,
  TrendingUp,
  ArrowRight,
  Zap,
  PanelLeft,
  Keyboard,
  X,
  Grid3x3,
  FilterX,
  Clock,
  Search,
  Package,
  ArrowDownRight,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table as UITable,
  TableBody as UITableBody,
  TableCell as UITableCell,
  TableHead as UITableHead,
  TableHeader as UITableHeader,
  TableRow as UITableRow,
} from "@/components/ui/table";
import {
  type AppConfigOverrides,
  type Category,
  type LogEntry,
  type TaskResult,
  type TaskStatusResponse,
  type EvaluatedListing,
} from "@/components/arbitrage/types";
import { ControlPanel } from "@/components/arbitrage/control-panel";
import { SummaryCards } from "@/components/arbitrage/summary-cards";
import { ResultsTable } from "@/components/arbitrage/results-table";
import { TaskHistory } from "@/components/arbitrage/task-history";
import { TerminalConsole } from "@/components/arbitrage/terminal-console";
import { ProfitChart } from "@/components/arbitrage/profit-chart";
import { ProfitTrendChart } from "@/components/arbitrage/profit-trend-chart";
import { ProfitHeatmap, extractFamily } from "@/components/arbitrage/profit-heatmap";
import { ProductTrend } from "@/components/arbitrage/product-trend";
import { ReferenceEditor } from "@/components/arbitrage/reference-editor";
import { exportListingsCsv, exportListingsJson } from "@/components/arbitrage/csv-export";
import { useSavedQueries } from "@/hooks/use-saved-queries";
import { useKeyboardShortcuts, SHORTCUTS_HELP } from "@/hooks/use-keyboard-shortcuts";
import type { ResultsTableHandle } from "@/components/arbitrage/results-table";
import { toast } from "sonner";
export default function Home() {
  const [query, setQuery] = useState("iPhone 15 Pro 256GB");
  const [category, setCategory] = useState<Category>("iphone");
  const [scanning, setScanning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatusResponse | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [cardFilter, setCardFilter] = useState<"all" | "viable" | "scam" | "profit" | null>(null);
  const [heatmapCell, setHeatmapCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [refEditorOpen, setRefEditorOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const savedQueries = useSavedQueries();
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsTableRef = useRef<ResultsTableHandle>(null);
  const pollProgressRef = useRef<number>(-1);
  // Scan timing: records when the current scan started so we can show
  // elapsed time and estimate remaining time based on progress.
  const scanStartedAtRef = useRef<number | null>(null);
  const [scanElapsed, setScanElapsed] = useState<number>(0);
  const estimateRemaining = useCallback((progress: number, targetSec?: number): number | null => {
    if (progress >= 100) return 0;
    if (!targetSec || targetSec <= 0) return null;
    const remaining = Math.max(1, targetSec - scanElapsed);
    return remaining;
  }, [scanElapsed]);
  // Tracks whether the component is mounted to prevent setState after unmount
  // (e.g. if a fetch resolves after navigation away).
  const mountedRef = useRef(true);
  // Holds the latest config overrides from the ControlPanel so re-run can
  // use the user's current values instead of server defaults.
  const currentOverridesRef = useRef<AppConfigOverrides>({});
  // Safe access to listings: always an array
  const safeListings = useMemo(() => {
    if (!result) return [];
    return Array.isArray(result.listings) ? result.listings : [];
  }, [result]);
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  // Guards against double-submitting a scan before the disabled state of
  // the Start button renders (double-click / Enter+click in the same tick).
  const submittingRef = useRef(false);
  // Tracks WHICH task id the current poll loop belongs to. An in-flight
  // tick from a PREVIOUS task (superseded by a newer scan) must not mutate
  // state or reschedule timers — otherwise the new scan's polling dies and
  // the old task's results get displayed.
  const pollTaskIdRef = useRef<string | null>(null);
  const pollStatus = useCallback(
    (id: string) => {
      stopPolling();
      pollTaskIdRef.current = id;
      let interval = 800;
      const tick = async () => {
        if (!mountedRef.current) return;
        // This tick belongs to a superseded poll — drop it entirely.
        if (pollTaskIdRef.current !== id) return;
        try {
          const res = await fetch(`/api/tasks/status/${id}`, {
            cache: "no-store",
          });
          if (pollTaskIdRef.current !== id) return;
          // ── Handle non-OK responses explicitly ──
          // Previously `if (!res.ok) return;` silently bailed, leaving
          // `scanning=true` forever and the spinner spinning (especially
          // after a server restart when the task was DB-only).
          if (!res.ok) {
            if (res.status === 404) {
              // Task truly doesn't exist (not in memory, not in DB).
              // Stop polling + clear scanning + surface the error.
              stopPolling();
              pollTaskIdRef.current = null;
              setScanning(false);
              setError("Task not found. It may have been from a previous session.");
              toast.error("Task not found");
              return;
            }
            // 5xx / 429 — transient server error, retry with backoff.
            interval = Math.min(interval + 500, 3000);
            pollRef.current = setTimeout(tick, interval) as unknown as ReturnType<typeof setInterval>;
            return;
          }
          const data: TaskStatusResponse = await res.json();
          if (pollTaskIdRef.current !== id) return;
          if (!mountedRef.current) return;
          setStatus(data);
          setLogs(Array.isArray(data.logs) ? data.logs : []);
          if (data.status === "done") {
            stopPolling();
            pollTaskIdRef.current = null;
            setScanning(false);
            // fetch result
            try {
              const rres = await fetch(
                `/api/tasks/result/${id}?include_hidden=1`,
                { cache: "no-store" },
              );
              if (pollTaskIdRef.current !== null && pollTaskIdRef.current !== id) return;
              if (rres.ok) {
                const rdata: TaskResult = await rres.json();
                setResult(rdata);
                setHistoryRefreshKey((k) => k + 1);
                toast.success(
                  `Scan complete — ${rdata.summary.shown} viable leads of ${rdata.summary.total} listings`,
                );
              } else {
                // Result reload failed (e.g. task evicted after a restart) —
                // surface it instead of silently leaving a blank screen.
                setError("Scan finished, but the result could not be reloaded. Select the task from history.");
                toast.error("Failed to reload result");
              }
            } catch {
              setError("Scan finished, but the result could not be reloaded. Select the task from history.");
              toast.error("Failed to reload result");
            }
            return;
          } else if (data.status === "error") {
            stopPolling();
            pollTaskIdRef.current = null;
            setScanning(false);
            setError(data.error ?? "Pipeline error");
            toast.error("Scan failed");
            return;
          } else if (data.status === "paused") {
            stopPolling();
            pollTaskIdRef.current = null;
            setScanning(false);
            return;
          } else if (data.status === "cancelled") {
            stopPolling();
            pollTaskIdRef.current = null;
            setScanning(false);
            setHistoryRefreshKey((k) => k + 1);
            toast.info("Scan cancelled");
            return;
          }
          // Adaptive interval: poll faster while progress is changing
          // (active pipeline), slower when idle/paused to reduce load.
          if (pollTaskIdRef.current !== id) return;
          const prev = pollProgressRef.current;
          pollProgressRef.current = data.progress;
          if (data.progress !== prev) {
            interval = 800; // active — keep fast
          } else {
            interval = Math.min(interval + 200, 2500); // idle — back off
          }
          pollRef.current = setTimeout(tick, interval) as unknown as ReturnType<typeof setInterval>;
        } catch {
          if (pollTaskIdRef.current !== id) return;
          /* network blip — retry with backoff */
          interval = Math.min(interval + 500, 3000);
          pollRef.current = setTimeout(tick, interval) as unknown as ReturnType<typeof setInterval>;
        }
      };
      pollProgressRef.current = -1;
      pollRef.current = setTimeout(tick, interval) as unknown as ReturnType<typeof setInterval>;
    },
    [stopPolling],
  );
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);
  const handleScan = useCallback(
    async (q: string, c: Category, overrides: AppConfigOverrides) => {
      // Double-submit guard: two clicks in the same tick would otherwise
      // launch two server-side pipelines racing for the UI.
      if (submittingRef.current) return;
      submittingRef.current = true;
      // If a scan is already running, cancel the old task first so they don't conflict
      if (taskId && scanning) {
        fetch(`/api/tasks/cancel/${taskId}`, { method: "POST" }).catch(() => {});
        stopPolling();
      }
      setScanning(true);
      setError(null);
      setResult(null);
      setStatus(null);
      setLogs([]);
      // Filters are scoped to the loaded result — a new scan must not inherit
      // the previous result's card/heatmap filters (they'd show "0 of N").
      setCardFilter(null);
      setHeatmapCell(null);
      scanStartedAtRef.current = Date.now();
      setScanElapsed(0);
      setHistoryRefreshKey((k) => k + 1); // refresh history so the new in-progress task appears
      try {
        const res = await fetch("/api/tasks/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, category: c, configOverrides: overrides }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "submit failed" }));
          throw new Error(err.error ?? "submit failed");
        }
        const data = await res.json();
        setTaskId(data.task_id);
        toast.info(`Scanning for "${q}"…`);
        pollStatus(data.task_id);
      } catch (e) {
        setScanning(false);
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        toast.error(`Failed to start scan: ${msg}`);
      } finally {
        submittingRef.current = false;
      }
    },
    [taskId, scanning, stopPolling, pollStatus],
  );
  const handleManualPaste = useCallback(
    async (html: string): Promise<boolean> => {
      if (!taskId) {
        toast.error("No active task to resume");
        return false;
      }
      try {
        const res = await fetch(`/api/tasks/manual_paste/${taskId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "resume failed" }));
          throw new Error(err.error ?? "resume failed");
        }
        toast.success("Resuming pipeline from manual paste…");
        setScanning(true);
        pollStatus(taskId);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Resume failed: ${msg}`);
        return false;
      }
    },
    [taskId, pollStatus],
  );
  // Cancel a running scan: POST to /api/tasks/[id]/cancel, which sets a flag
  // the orchestrator polls at key checkpoints. The pipeline aborts gracefully
  // at the next checkpoint (post-scrape or post-calc) and finalizes the task
  // as "cancelled". We keep polling so the UI picks up the cancelled status.
  const handleStop = useCallback(async () => {
    if (!taskId) {
      toast.error("No active scan to stop");
      return;
    }
    setCancelling(true);
    try {
      const res = await fetch(`/api/tasks/cancel/${taskId}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "cancel failed" }));
        throw new Error(err.error ?? "cancel failed");
      }
      const data = await res.json();
      if (data.already_terminal) {
        // Task already finished — just stop polling locally.
        stopPolling();
        setScanning(false);
        toast.info("Scan already finished");
      } else {
        toast.info("Cancelling scan…");
        // Keep polling — the orchestrator will flip status to "cancelled"
        // at the next checkpoint, which the poll loop handles.
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Cancel failed: ${msg}`);
    } finally {
      setCancelling(false);
    }
  }, [taskId, stopPolling]);
  // Load a past task's result from history
  const handleSelectHistory = useCallback(
    async (t: { task_id: string; query: string; category: string }) => {
      stopPolling();
      setScanning(false);
      setError(null);
      // Logs and filters belong to the loaded task — don't carry the
      // previous scan's terminal output or card/heatmap filters over.
      setLogs([]);
      setCardFilter(null);
      setHeatmapCell(null);
      try {
        const rres = await fetch(
          `/api/tasks/result/${t.task_id}?include_hidden=1`,
          { cache: "no-store" },
        );
        if (!rres.ok) {
          const err = await rres.json().catch(() => ({}));
          throw new Error(err.error ?? "failed to load task");
        }
        const rdata: TaskResult = await rres.json();
        setTaskId(t.task_id);
        setQuery(t.query);
        setCategory(t.category as Category);
        setStatus(null);
        setResult(rdata);
        toast.info(`Loaded past scan: "${t.query}"`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Failed to load task: ${msg}`);
      }
    },
    [stopPolling],
  );
  // Re-run a past scan: populate the control panel with the same query/category
  // and immediately trigger a new scan using the current config overrides.
  const handleRerun = useCallback(
    (t: { query: string; category: string }) => {
      setQuery(t.query);
      setCategory(t.category as Category);
      setResult(null);
      setStatus(null);
      setLogs([]);
      setError(null);
      setCardFilter(null);
      setHeatmapCell(null);
      // Use the current config panel values (captured in the ref) so the
      // re-run respects the user's tuned VAT/shipping/threshold settings.
      handleScan(t.query, t.category as Category, currentOverridesRef.current);
    },
    [handleScan],
  );
  // Delete a task from history (both in-memory store + SQLite DB).
  // Refreshes the sidebar after deletion and clears the active result if
  // the deleted task was the one currently displayed.
  const handleDeleteTask = useCallback(
    async (deleteTaskId: string) => {
      try {
        if (taskId === deleteTaskId) {
          stopPolling();
          fetch(`/api/tasks/cancel/${deleteTaskId}`, { method: "POST" }).catch(() => {});
          setScanning(false);
          setResult(null);
          setStatus(null);
          setTaskId(null);
          setLogs([]);
          setCardFilter(null);
          setHeatmapCell(null);
        }
        const res = await fetch(`/api/tasks/${deleteTaskId}`, { method: "DELETE" });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error ?? "delete failed");
        }
        toast.success("Scan deleted from history");
        setHistoryRefreshKey((k) => k + 1);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to delete scan");
      }
    },
    [taskId, stopPolling],
  );
  // Clear ALL scan history (in-memory store + SQLite DB). Resets the active
  // result/state since every task is gone.
  const handleClearAllHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/clear-all", { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "clear failed");
      }
      stopPolling();
      setScanning(false);
      setResult(null);
      setStatus(null);
      setTaskId(null);
      setLogs([]);
      setError(null);
      setCardFilter(null);
      setHeatmapCell(null);
      setHistoryRefreshKey((k) => k + 1);
      toast.success("Scan history cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear history");
    }
  }, [stopPolling]);
  // Re-evaluate: re-run profit calc on the current task's stored listings
  // using current reference prices + config, WITHOUT re-scraping. Useful
  // after editing the reference price matrix or adjusting config overrides.
  const [reevaluating, setReevaluating] = useState(false);
  const handleReevaluate = useCallback(async () => {
    if (!taskId || !result) return;
    setReevaluating(true);
    try {
      const res = await fetch(`/api/tasks/reevaluate/${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configOverrides: currentOverridesRef.current }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "re-evaluate failed" }));
        throw new Error(err.error ?? "re-evaluate failed");
      }
      // Fetch the updated result
      const rres = await fetch(
        `/api/tasks/result/${taskId}?include_hidden=1`,
        { cache: "no-store" },
      );
      if (rres.ok) {
        const rdata: TaskResult = await rres.json();
        setResult(rdata);
        toast.success(
          `Re-evaluated — ${rdata.summary.shown} viable of ${rdata.summary.total} listings`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Re-evaluate failed: ${msg}`);
    } finally {
      setReevaluating(false);
    }
  }, [taskId, result]);
  // "Paused" means the scraper hit a hard block and is waiting for manual
  // paste resume. Degraded mode (mock data) is NOT paused — the pipeline
  // still completes successfully.
  const paused = status?.status === "paused";
  // ── Scan timing: update elapsed every second while scanning ─────────
  useEffect(() => {
    if (!scanning || !scanStartedAtRef.current) return;
    const interval = setInterval(() => {
      if (scanStartedAtRef.current) {
        setScanElapsed(Math.floor((Date.now() - scanStartedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [scanning]);

  // ── Filtered listings for export ────────────────────────────────────
  // When a card filter or heatmap cell filter is active, CSV/JSON export
  // should respect it so the exported file matches what the user sees.
  const getFilteredListings = useCallback((): EvaluatedListing[] | null => {
    if (!result) return null;
    let base: EvaluatedListing[] = safeListings;
    if (cardFilter === "viable") base = base.filter((l) => !l.hidden);
    else if (cardFilter === "scam") base = base.filter((l) => l.hidden && (l.scam.dropped || l.scam.riskScore >= 60));
    else if (cardFilter === "profit") base = base.filter((l) => l.hidden && !(l.scam.dropped || l.scam.riskScore >= 60));
    // Apply heatmap cell filter on top
    if (heatmapCell) {
      const [family, condition] = heatmapCell.split("__");
      base = base.filter((l) => {
        const fam = extractFamily(l.listing.normalized?.standardKey);
        const cond = l.listing.normalized?.condition ?? "unknown";
        return fam === family && cond === condition;
      });
    }
    return base;
  }, [result, cardFilter, heatmapCell]);
  // ── Keyboard shortcuts ───────────────────────────────────────────────
  // Wires global keys (/, s, e, j, k, o, x, ?) to dashboard actions.
  useKeyboardShortcuts({
    onFocusSearch: () => {
      const el = document.getElementById("query") as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
      } else {
        searchInputRef.current?.focus();
      }
    },
    onScan: () => {
      if (!scanning && query.trim()) {
        handleScan(query.trim(), category, currentOverridesRef.current);
      }
    },
    onTogglePin: () => {
      if (!query.trim()) return;
      // Capture the state BEFORE toggling. `toggleSaved` updates state
      // asynchronously (via setQueries), so reading `isSaved` after the
      // call returns the STALE pre-toggle value, which inverts the toast
      // message (pinning says "unpinned" and vice versa).
      const wasSaved = savedQueries.isSaved(query, category);
      savedQueries.toggleSaved(query, category);
      toast.success(wasSaved ? "Query unpinned" : "Query pinned to sidebar");
    },
    onReevaluate: () => {
      if (taskId && result && !reevaluating) handleReevaluate();
    },
    onNextRow: () => resultsTableRef.current?.nextRow(),
    onPrevRow: () => resultsTableRef.current?.prevRow(),
    onOpenActiveRow: () => resultsTableRef.current?.openActive(),
    onCopyBlueprint: () => resultsTableRef.current?.copyActiveBlueprint(),
    onCopyMarkdown: () => resultsTableRef.current?.copyActiveMarkdown(),
    onExportCsv: () => {
      const filtered = getFilteredListings();
      // Capture `result` locally so TS can prove it's non-null inside the
      // block (getFilteredListings already checked, but TS can't verify
      // the correlation across the function boundary).
      const r = result;
      if (filtered && r) {
        exportListingsCsv(filtered, r.query);
        toast.success(`CSV exported${cardFilter ? ` (${filtered.length} filtered)` : ""}`);
      }
    },
    onToggleHelp: () => setShortcutsOpen((o) => !o),
  });
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 shrink-0 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            {/* Mobile sidebar trigger (Sheet drawer) — hidden on lg+ where the
                persistent sidebar is always visible. */}
            <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 lg:hidden"
                  title="Open scan history"
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <SheetHeader className="px-4 pt-4">
                  <SheetTitle className="text-sm">Scan History</SheetTitle>
                </SheetHeader>
                <div className="mt-2 h-[calc(100vh-5rem)] overflow-y-auto">
                  <TaskHistory
                    activeTaskId={taskId}
                    onSelect={(t) => {
                      handleSelectHistory(t);
                      setMobileSidebarOpen(false);
                    }}
                    onRerun={(t) => {
                      handleRerun(t);
                      setMobileSidebarOpen(false);
                    }}
                    refreshKey={historyRefreshKey}
                    savedQueries={savedQueries.queries}
                    onRunSaved={(sq) => {
                      setQuery(sq.query);
                      setCategory(sq.category as Category);
                      handleScan(sq.query, sq.category as Category, currentOverridesRef.current);
                      setMobileSidebarOpen(false);
                    }}
                    onRemoveSaved={savedQueries.removeSaved}
                    activeQuery={query}
                    activeCategory={category}
                    isSavedActive={savedQueries.isSaved(query, category)}
                    onToggleSaveActive={() => {
                      const wasSaved = savedQueries.isSaved(query, category);
                      savedQueries.toggleSaved(query, category);
                      toast.success(wasSaved ? "Query unpinned" : "Query pinned to sidebar");
                    }}
                    onDeleteTask={handleDeleteTask}
                    onClearAll={handleClearAllHistory}
                  />
                </div>
              </SheetContent>
            </Sheet>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Radar className="h-5 w-5" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold tracking-tight">
                Arbitrage Intelligence
              </span>
              <span className="text-[10px] text-muted-foreground">
                Goofish → OLX + Vinted + KuantoKusta + Amazon
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden gap-1 sm:flex">
              <Globe className="h-3 w-3" />
              CNY → EUR
            </Badge>
            <Badge variant="outline" className="hidden gap-1 sm:flex">
              <ShieldCheck className="h-3 w-3" />
              Scam-filtered
            </Badge>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShortcutsOpen(true)}
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setRefEditorOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Reference Prices</span>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 px-3 py-4 sm:px-4 sm:py-5">
        <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:gap-5">
          {/* Sidebar: task history (desktop only) */}
          <aside className="hidden w-72 shrink-0 lg:block">
            {/* sticky container: pinned below the header (top-[4.5rem]) and
                capped so it never overlaps the footer at the bottom.
                max-h keeps the sidebar scrollable within the viewport minus
                the header height and a footer-safe margin.
                overflow-y-auto (not overflow-hidden) so pinned queries and
                long histories can't get clipped with no way to scroll. */}
            <div className="sticky top-[4.5rem] max-h-[calc(100vh-6rem)] overflow-y-auto">
              <TaskHistory
                activeTaskId={taskId}
                onSelect={handleSelectHistory}
                onRerun={handleRerun}
                refreshKey={historyRefreshKey}
                savedQueries={savedQueries.queries}
                onRunSaved={(sq) => {
                  setQuery(sq.query);
                  setCategory(sq.category as Category);
                  handleScan(sq.query, sq.category as Category, currentOverridesRef.current);
                }}
                onRemoveSaved={savedQueries.removeSaved}
                activeQuery={query}
                activeCategory={category}
                isSavedActive={savedQueries.isSaved(query, category)}
                onToggleSaveActive={() => {
                  const wasSaved = savedQueries.isSaved(query, category);
                  savedQueries.toggleSaved(query, category);
                  toast.success(wasSaved ? "Query unpinned" : "Query pinned to sidebar");
                }}
                onDeleteTask={handleDeleteTask}
                onClearAll={handleClearAllHistory}
              />
              {/* ── EU Market Comp Links ──────────────────────────────
                  Kept INSIDE the sticky scroll container (not a sibling)
                  so it scrolls together with the Scan History instead of
                  sliding underneath the pinned card and overlapping it. */}
              {safeListings.length > 0 && (() => {
                const allComps = safeListings.flatMap((l) =>
                  Array.isArray(l.euComps) ? l.euComps : []
                );
                const seen = new Set<string>();
                const deduped = allComps.filter((c) => {
                  const key = `${c.platform}:${c.title}:${c.priceEur}`;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                }).sort((a, b) => a.priceEur - b.priceEur);
                if (deduped.length === 0) return null;
                const platformColors: Record<string, string> = {
                  olx: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
                  vinted: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
                  kuantokusta: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
                  amazon: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
                };
                // Fallback search links, only used when the scraper
                // couldn't capture a direct listing URL.
                const platformSearchUrls: Record<string, (title: string) => string> = {
                  olx: (t) => `https://www.olx.pt/q-${t.toLowerCase().replace(/\s+/g, "-")}`,
                  vinted: (t) => `https://www.vinted.pt/catalog?search_text=${encodeURIComponent(t)}`,
                  kuantokusta: (t) => `https://www.kuantokusta.pt/search?q=${encodeURIComponent(t)}`,
                  amazon: (t) => `https://www.amazon.es/s?k=${encodeURIComponent(t)}`,
                };
                return (
                  <div className="mt-3">
                    <Collapsible>
                      <div className="flex items-center gap-2">
                        <CollapsibleTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full gap-1">
                            <Globe className="h-3.5 w-3.5" />
                            EU Market Links ({deduped.length})
                            <ChevronDown className="ml-auto h-3.5 w-3.5" />
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent className="mt-2">
                        <div className="max-h-64 overflow-y-auto rounded-lg border">
                          <UITable>
                            <UITableHeader className="sticky top-0 bg-background">
                              <UITableRow>
                                <UITableHead className="w-16 p-2 text-[10px]">Source</UITableHead>
                                <UITableHead className="p-2 text-[10px]">Title</UITableHead>
                                <UITableHead className="text-right p-2 text-[10px]">€</UITableHead>
                                <UITableHead className="w-10 p-2"></UITableHead>
                              </UITableRow>
                            </UITableHeader>
                            <UITableBody>
                              {deduped.slice(0, 50).map((c, i) => (
                                <UITableRow key={`${c.platform}-${i}`}>
                                  <UITableCell className="p-2">
                                    <Badge variant="outline" className={`text-[9px] ${platformColors[c.platform] || ""}`}>
                                      {c.platform === "kuantokusta" ? "KK" : c.platform === "amazon" ? "AMZ" : c.platform}
                                    </Badge>
                                  </UITableCell>
                                  <UITableCell className="max-w-[120px] truncate p-2 text-[10px]" title={c.title}>
                                    {c.title}
                                  </UITableCell>
                                  <UITableCell className="text-right p-2 text-[10px] font-medium tabular-nums">
                                    €{c.priceEur}
                                  </UITableCell>
                                  <UITableCell className="p-2">
                                    <a
                                      href={c.url || platformSearchUrls[c.platform]?.(c.title) || "#"}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={c.url ? "Open listing" : "Search for listing"}
                                      className="text-primary hover:underline"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </UITableCell>
                                </UITableRow>
                              ))}
                            </UITableBody>
                          </UITable>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                );
              })()}
            </div>
          </aside>
          {/* Main content */}
          <div className="min-w-0 flex-1 space-y-5">
        {/* Hero / title — compact gradient card with icon + stats strip */}
        <section className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-emerald-50 via-card to-amber-50/40 p-4 shadow-sm dark:from-emerald-950/30 dark:via-card dark:to-amber-950/20 sm:p-5">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" aria-hidden />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            {/* Icon badge */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 sm:h-11 sm:w-11">
              <Sparkles className="h-5 w-5 sm:h-5.5 sm:w-5.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  Cross-Border Electronics Arbitrage Engine
                </h1>
                <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                  <Zap className="h-3 w-3" />
                  Live
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Sourcing from <span className="font-medium text-foreground">Goofish / 闲鱼</span> (CN)
                → resale on <span className="font-medium text-foreground">OLX</span>,{" "}
                <span className="font-medium text-foreground">Vinted</span> (used) &{" "}
                <span className="font-medium text-foreground">KuantoKusta</span>,{" "}
                <span className="font-medium text-foreground">Amazon</span> (new).
              </p>
              {/* Stats strip */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-950">
                    <Globe className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  </span>
                  5 marketplaces
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-950">
                    <ShieldCheck className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  </span>
                  4-layer scam filter
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-950">
                    <TrendingUp className="h-3 w-3 text-teal-600 dark:text-teal-400" />
                  </span>
                  CNY → EUR landed cost
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <ArrowRight className="h-3 w-3" />
                  Portugal resale
                </span>
              </div>
            </div>
          </div>
        </section>
        {/* Control panel */}
        <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <ControlPanel
            onScan={handleScan}
            onManualPaste={handleManualPaste}
            onStop={handleStop}
            onConfigChange={(o) => {
              currentOverridesRef.current = o;
            }}
            scanning={scanning}
            paused={paused}
            stopping={cancelling}
            query={query}
            setQuery={setQuery}
            category={category}
            setCategory={setCategory}
          />
        </section>
        {/* Progress */}
        {(scanning || status) && (
          <section className="rounded-xl border bg-gradient-to-b from-card to-muted/20 p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                {scanning ? (
                  <div className="relative flex h-3.5 w-3.5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary relative z-10" />
                  </div>
                ) : status?.status === "done" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : status?.status === "error" ? (
                  <XCircle className="h-4 w-4 text-rose-500" />
                ) : null}
                <span className="font-semibold text-sm tracking-tight">{status?.step ?? "Initializing live scan..."}</span>
              </div>
              <div className="flex items-center gap-3 tabular-nums text-muted-foreground">
                {scanning && scanElapsed > 0 && (() => {
                  const progress = status?.progress ?? 0;
                  const targetSec = status?.estimated_sec;
                  const fmt = (s: number) => {
                    if (s < 60) return `${s}s`;
                    return `${Math.floor(s / 60)}m ${s % 60}s`;
                  };
                  const estRemaining: number | null = estimateRemaining(progress, targetSec);
                  return (
                    <span className="flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium">
                      <Clock className="h-3 w-3 text-primary" />
                      <span>{fmt(scanElapsed)}</span>
                      {estRemaining !== null && estRemaining > 0 && (
                        <span className="text-muted-foreground/70">· ~{fmt(estRemaining)} left</span>
                      )}
                      {targetSec && (
                        <span className="text-muted-foreground/50 text-[10px]">(est. total ~{targetSec}s)</span>
                      )}
                    </span>
                  );
                })()}
                {!scanning && status?.status === "done" && scanElapsed > 0 && (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-400 px-2.5 py-1 text-[11px] font-medium">
                    <Clock className="h-3 w-3" />
                    <span>Completed in {scanElapsed}s</span>
                  </span>
                )}
                <span className="text-xs font-bold text-foreground bg-primary/10 px-2 py-0.5 rounded-full">{status?.progress ?? 0}%</span>
              </div>
            </div>

            {/* Glowing animated progress bar */}
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-500 ${
                  scanning ? "shadow-[0_0_12px_rgba(99,102,241,0.6)]" : ""
                }`}
                style={{ width: `${Math.max(3, status?.progress ?? 0)}%` }}
              />
            </div>

            {/* Live Per-Platform Scraping Cards */}
            {scanning && status?.step && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 pt-1">
                {(() => {
                  // Guard: although we're inside `scanning && status?.step && (...)`,
                  // TS does not preserve narrowing into the IIFE function body
                  // (closure-captured variables are treated as potentially mutated).
                  // This guard makes the non-nullability explicit so the rest of
                  // the IIFE type-checks cleanly.
                  if (!status?.step) return null;
                  const stepText = status.step;
                  const parts = stepText.includes("|") ? stepText.split("|").map((s) => s.trim()) : [];
                  const getPart = (name: string) => parts.find((p) => p.toLowerCase().includes(name.toLowerCase()));
                  const platforms: Array<{ name: string; flag: string; tag: string }> = [
                    { name: "Goofish", flag: "🇨🇳", tag: "China (CNY)" },
                    { name: "OLX", flag: "🇵🇹", tag: "OLX.pt" },
                    { name: "Vinted", flag: "🇵🇹", tag: "Vinted.pt" },
                    { name: "KuantoKusta", flag: "🇵🇹", tag: "New Retail" },
                    { name: "Amazon", flag: "🇪🇸", tag: "Amazon.es" },
                  ];

                  return platforms.map((p) => {
                    const match = getPart(p.name);
                    const isRunning = match ? match.includes("⏳") : true;
                    const isDone = match ? match.includes("✅") : false;
                    const isError = match ? match.includes("❌") : false;
                    const isSkipped = match ? match.includes("⏭️") : false;

                    let statusText = "Preparing…";
                    if (match) {
                      const countMatch = match.match(/(\d+)\s+listings|(\d+)\s+comps/i);
                      if (countMatch) {
                        statusText = `${countMatch[1] || countMatch[2]} items`;
                      } else if (isDone) statusText = "Done";
                      else if (isSkipped) statusText = "Skipped";
                      else if (isError) statusText = "Failed";
                      else if (isRunning) statusText = "Scraping…";
                    }

                    return (
                      <div
                        key={p.name}
                        className={`flex flex-col gap-1 rounded-lg border p-2.5 transition-all ${
                          isDone
                            ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20"
                            : isError
                              ? "border-rose-500/30 bg-rose-500/5 dark:bg-rose-950/20"
                              : isSkipped
                                ? "border-muted bg-muted/20 opacity-60"
                                : "border-sky-500/30 bg-sky-500/5 animate-pulse"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold flex items-center gap-1">
                            <span>{p.flag}</span>
                            <span>{p.name}</span>
                          </span>
                          {isRunning && <Loader2 className="h-3 w-3 animate-spin text-sky-500" />}
                          {isDone && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                          {isError && <XCircle className="h-3 w-3 text-rose-500" />}
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
                          <span className="truncate">{p.tag}</span>
                          <span className="font-medium text-foreground">{statusText}</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {/* Scan progress step indicators */}
            {scanning && (() => {
              const progress = status?.progress ?? 0;
              const currentStatus = status?.status ?? "";
              const steps = [
                { key: "scraping_goofish", label: "Scrape Platforms", threshold: 0, icon: Search },
                { key: "matching_eu", label: "Match EU Comps", threshold: 40, icon: Globe },
                { key: "calculating", label: "Profit Calc", threshold: 60, icon: Calculator },
                { key: "done", label: "Complete", threshold: 100, icon: CheckCircle2 },
              ];
              const activeStepIdx = steps.findIndex((s, i) => {
                if (i === steps.length - 1) return currentStatus === "done";
                return progress < steps[i + 1].threshold;
              });
              return (
                <div className="flex items-center justify-between px-1 pt-2 border-t">
                  {steps.map((step, i) => {
                    const isDone = i < activeStepIdx || currentStatus === "done";
                    const isActive = i === activeStepIdx && currentStatus !== "done";
                    const Icon = step.icon;
                    return (
                      <div key={step.key} className="flex flex-1 items-center">
                        <div className="flex flex-col items-center gap-1">
                          <div
                            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all ${
                              isDone
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : isActive
                                  ? "border-primary bg-primary text-primary-foreground scale-110 shadow-md"
                                  : "border-muted bg-background text-muted-foreground"
                            }`}
                          >
                            {isDone ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : isActive ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Icon className="h-3 w-3" />
                            )}
                          </div>
                          <span
                            className={`text-[10px] font-medium ${
                              isActive ? "text-foreground font-bold" : isDone ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                            }`}
                          >
                            {step.label}
                          </span>
                        </div>
                        {i < steps.length - 1 && (
                          <div
                            className={`mx-1 h-0.5 flex-1 rounded-full transition-colors ${
                              i < activeStepIdx || currentStatus === "done"
                                ? "bg-emerald-500"
                                : "bg-muted"
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {status?.degraded && (
              <Alert className="border-amber-300 bg-amber-50 py-2 dark:border-amber-800 dark:bg-amber-950/40">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-xs text-amber-700 dark:text-amber-300">
                  Some scrapers returned partial results. Check the terminal
                  console below for details on which platforms succeeded or failed.
                </AlertDescription>
              </Alert>
            )}
          </section>
        )}
        {/* Terminal Console — shows backend execution logs in real time */}
        {(scanning || (logs.length > 0)) && (
          <TerminalConsole
            logs={logs}
            active={scanning}
            onClear={() => setLogs([])}
          />
        )}
        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Scan failed</AlertTitle>
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}
        {/* Result */}
        {result && (
          <>
            {/* Warnings */}
{Array.isArray(result.warnings) && result.warnings.length > 0 && (
  <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
    <AlertTriangle className="h-4 w-4 text-amber-600" />
    <AlertTitle className="text-sm">
      {result.warnings.length} {result.warnings.length === 1 ? "Pipeline Warning" : "Pipeline Warnings"}
    </AlertTitle>
    <AlertDescription>
      <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
        {result.warnings.map((w, i) => (
          <li key={i}>• {w}</li>
        ))}
      </ul>
    </AlertDescription>
  </Alert>
)}
            {/* ── EU Market Price Preview ──────────────────────────────
                Shows resale prices on Portuguese marketplaces BEFORE the
                Goofish listings, organized into:
                  1. New (retail) prices — KuantoKusta + Amazon
                  2. Used (second-hand) prices — OLX + Vinted
                  3. New vs Used comparison — how much cheaper is used?
                  4. Goofish source prices — CNY cost converted to EUR
                This lets the user see the full price landscape before
                looking at individual arbitrage opportunities. */}
            {(() => {
              // Aggregate all EU comps from all evaluated listings.
              // Dedupe by title+price so the same comp attached to multiple
              // Goofish listings isn't double-counted in the market preview.
              const allComps = safeListings.flatMap((l) =>
                Array.isArray(l.euComps) ? l.euComps : []
              );
              const seen = new Set<string>();
              const deduped = allComps.filter((c) => {
                const key = `${c.platform}:${c.title}:${c.priceEur}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              const kkComps = deduped.filter((c) => c.platform === "kuantokusta" && c.priceEur > 0);
              const amazonComps = deduped.filter((c) => c.platform === "amazon" && c.priceEur > 0);
              const olxComps = deduped.filter((c) => c.platform === "olx" && c.priceEur > 0);
              const vintedComps = deduped.filter((c) => c.platform === "vinted" && c.priceEur > 0);
              const newComps = [...kkComps, ...amazonComps];
              const usedComps = [...olxComps, ...vintedComps];
              // Goofish source prices (CNY → EUR conversion) — computed early
              // so we can decide whether to show the section at all.
              const goofishPrices = safeListings
                .map((l) => ({
                  priceCny: l.listing.priceCny,
                  priceEur: l.profit?.landed?.acquisitionCostEur ?? 0,
                  title: l.listing.title,
                }))
                .filter((p) => p.priceCny > 0);
              // Show the section if there are ANY comps (new or used) OR
              // Goofish source prices. This way, even when the user skips all
              // EU sources, they still see the Goofish source prices.
              if (newComps.length === 0 && usedComps.length === 0 && goofishPrices.length === 0) return null;
              const avg = (arr: typeof olxComps) =>
                arr.length > 0 ? Math.round(arr.reduce((s, c) => s + c.priceEur, 0) / arr.length) : 0;
              const median = (arr: typeof olxComps) => {
                if (arr.length === 0) return 0;
                const sorted = arr.map((c) => c.priceEur).sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 === 0
                  ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
                  : sorted[mid];
              };
              const minMax = (arr: typeof olxComps) =>
                arr.length > 0
                  ? `€${Math.min(...arr.map((c) => c.priceEur))}–€${Math.max(...arr.map((c) => c.priceEur))}`
                  : "—";
              const newMedian = median(newComps);
              const usedMedian = median(usedComps);
              const newVsUsedDelta = newMedian > 0 && usedMedian > 0 ? newMedian - usedMedian : 0;
              const usedDiscountPct = newMedian > 0 && usedMedian > 0
                ? Math.round(((newMedian - usedMedian) / newMedian) * 100)
                : 0;
              // Goofish source prices (CNY → EUR conversion) — already computed above
              const goofishMedianCny = (() => {
                if (goofishPrices.length === 0) return 0;
                const sorted = goofishPrices.map((p) => p.priceCny).sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 === 0
                  ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
                  : sorted[mid];
              })();
              const goofishMedianEur = (() => {
                if (goofishPrices.length === 0) return 0;
                const sorted = goofishPrices.map((p) => p.priceEur).sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 === 0
                  ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
                  : sorted[mid];
              })();
              return (
                <section className="space-y-3">
                  {/* Section header */}
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                    <h3 className="text-sm font-semibold">Market Price Preview</h3>
                    <span className="text-[10px] text-muted-foreground">
                      {newComps.length > 0 && usedComps.length > 0
                        ? "New retail vs used resale vs Goofish source"
                        : newComps.length > 0
                          ? "New retail prices vs Goofish source"
                          : usedComps.length > 0
                            ? "Used resale prices vs Goofish source"
                            : "Goofish source prices (CN)"}
                    </span>
                  </div>

                  {/* ── New (retail) vs Used (second-hand) source cards ──
                      Each card is hidden when its comps are empty (e.g. when
                      the user skipped new or used sources). The grid expands
                      to full-width when only one category is present. */}
                  <div className={`grid grid-cols-1 gap-3 ${newComps.length > 0 && usedComps.length > 0 ? "sm:grid-cols-2" : ""}`}>
                    {/* New (retail) — KuantoKusta + Amazon — hidden when no retail comps */}
                    {newComps.length > 0 && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 dark:border-sky-900 dark:bg-sky-950/20">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                            New
                          </span>
                          <span className="text-xs font-semibold text-foreground">Retail prices</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{newComps.length} listings</span>
                      </div>
                      <div className="flex items-baseline gap-4">
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Median</span>
                          <p className="text-xl font-bold tabular-nums text-sky-600 dark:text-sky-400">€{newMedian}</p>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg</span>
                          <p className="text-sm font-semibold tabular-nums text-foreground">€{avg(newComps)}</p>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Min–Max</span>
                          <p className="text-xs font-medium tabular-nums text-muted-foreground">{minMax(newComps)}</p>
                        </div>
                      </div>
                      {/* Per-source breakdown */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {kkComps.length > 0 && (
                          <Badge variant="outline" className="border-sky-300 bg-sky-50 text-[10px] text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
                            KuantoKusta: {kkComps.length} · med €{median(kkComps)}
                          </Badge>
                        )}
                        {amazonComps.length > 0 && (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            Amazon: {amazonComps.length} · med €{median(amazonComps)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    )}

                    {/* Used (second-hand) — OLX + Vinted — hidden when no used comps */}
                    {usedComps.length > 0 && (
                    <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-900 dark:bg-teal-950/20">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                            Used
                          </span>
                          <span className="text-xs font-semibold text-foreground">Second-hand resale</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{usedComps.length} listings</span>
                      </div>
                      <div className="flex items-baseline gap-4">
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Median</span>
                          <p className="text-xl font-bold tabular-nums text-teal-600 dark:text-teal-400">€{usedMedian}</p>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg</span>
                          <p className="text-sm font-semibold tabular-nums text-foreground">€{avg(usedComps)}</p>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Min–Max</span>
                          <p className="text-xs font-medium tabular-nums text-muted-foreground">{minMax(usedComps)}</p>
                        </div>
                      </div>
                      {/* Per-source breakdown */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {olxComps.length > 0 && (
                          <Badge variant="outline" className="border-teal-300 bg-teal-50 text-[10px] text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300">
                            OLX: {olxComps.length} · med €{median(olxComps)}
                          </Badge>
                        )}
                        {vintedComps.length > 0 && (
                          <Badge variant="outline" className="border-fuchsia-300 bg-fuchsia-50 text-[10px] text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300">
                            Vinted: {vintedComps.length} · med €{median(vintedComps)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    )}
                  </div>

                  {/* ── New vs Used comparison ─────────────────────────── */}
                  {newMedian > 0 && usedMedian > 0 && (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/20">
                      <div className="flex items-center gap-1.5">
                        <ArrowDownRight className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          Used is {usedDiscountPct}% cheaper than new
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5 text-xs tabular-nums">
                        <span className="text-muted-foreground">New €{newMedian}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-semibold text-teal-600 dark:text-teal-400">Used €{usedMedian}</span>
                        <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          −€{newVsUsedDelta}
                        </span>
                      </div>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        Buying second-hand saves ~€{newVsUsedDelta} vs retail on this product
                      </span>
                    </div>
                  )}

                  {/* ── Goofish source prices ─────────────────────────── */}
                  {goofishPrices.length > 0 && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50/30 p-3 dark:border-rose-900 dark:bg-rose-950/20">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                          <span className="text-xs font-semibold text-foreground">Goofish source prices</span>
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                            CN
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{goofishPrices.length} listings scraped</span>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-4">
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Median CNY</span>
                          <p className="text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400">¥{goofishMedianCny}</p>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">≈ EUR (acq. cost)</span>
                          <p className="text-xl font-bold tabular-nums text-foreground">€{goofishMedianEur}</p>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Min–Max CNY</span>
                          <p className="text-xs font-medium tabular-nums text-muted-foreground">
                            ¥{Math.min(...goofishPrices.map((p) => p.priceCny))}–¥{Math.max(...goofishPrices.map((p) => p.priceCny))}
                          </p>
                        </div>
                      </div>
                      {/* Show potential margin if used median is known */}
                      {usedMedian > 0 && goofishMedianEur > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                          <TrendingUp className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-muted-foreground">
                            Potential margin: buy @ €{goofishMedianEur} (Goofish) → sell @ €{usedMedian} (used PT median) =
                          </span>
                          <span className={`font-bold ${usedMedian - goofishMedianEur > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {usedMedian - goofishMedianEur > 0 ? "+" : ""}€{usedMedian - goofishMedianEur}
                          </span>
                          <span className="text-muted-foreground">
                            (before import fees)
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })()}
            {/* Summary cards */}
            <SummaryCards
              summary={result.summary}
              activeFilter={cardFilter}
              onFilterChange={setCardFilter}
            />
            {/* Active filter banner */}
            {cardFilter && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs dark:border-emerald-800 dark:bg-emerald-950/40">
                <span className="font-medium text-emerald-700 dark:text-emerald-300">
                  Filter active: {cardFilter === "all" ? "All listings" : cardFilter === "viable" ? "Viable leads only" : cardFilter === "scam" ? "Scam-hidden only" : "Profit-hidden only"}
                </span>
                <button
                  onClick={() => setCardFilter(null)}
                  className="ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
                  title="Clear filter (Esc also works)"
                >
                  clear ✕
                </button>
              </div>
            )}
            {/* Profit distribution chart (current scan) + trend across scans */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ProfitChart listings={safeListings} />
              <ProfitTrendChart refreshKey={historyRefreshKey} />
            </div>
            {/* Profitability heatmap — model × condition colored by median net profit.
                Click a cell to filter the results table to that model+condition. */}
            <ProfitHeatmap
              listings={safeListings}
              activeCell={heatmapCell}
              onCellClick={setHeatmapCell}
            />
            {/* Heatmap cell filter banner */}
            {heatmapCell && (
              <div className="flex items-center gap-2 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs dark:border-teal-800 dark:bg-teal-950/40">
                <Grid3x3 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span className="font-medium text-teal-700 dark:text-teal-300">
                  Heatmap filter: {heatmapCell.replace("__", " · ")}
                </span>
                <button
                  onClick={() => setHeatmapCell(null)}
                  className="ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-900"
                  title="Clear heatmap filter"
                >
                  clear ✕
                </button>
              </div>
            )}
            {/* Results table */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">
                    Evaluated Listings
                  </h2>
                  {(cardFilter || heatmapCell) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setCardFilter(null);
                        setHeatmapCell(null);
                      }}
                      title="Clear all filters"
                    >
                      <FilterX className="h-3.5 w-3.5" />
                      Clear all filters
                      <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[9px] leading-none">
                        {(cardFilter ? 1 : 0) + (heatmapCell ? 1 : 0)}
                      </Badge>
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReevaluate}
                    disabled={reevaluating || scanning || !taskId}
                    title="Re-run profit calc with current reference prices (no re-scrape)"
                  >
                    {reevaluating ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Calculator className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Re-evaluate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const filtered = getFilteredListings();
                      if (filtered) {
                        exportListingsCsv(filtered, result.query);
                        toast.success(`CSV exported${cardFilter ? ` (${filtered.length} filtered)` : ""}`);
                      }
                    }}
                    title={cardFilter ? `Export ${cardFilter} listings only` : "Export all listings as CSV"}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    CSV{cardFilter ? " (filtered)" : ""}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const filtered = getFilteredListings();
                      if (filtered) {
                        exportListingsJson(filtered, result.query);
                        toast.success(`JSON exported${cardFilter ? ` (${filtered.length} filtered)` : ""}`);
                      }
                    }}
                    title={cardFilter ? `Export ${cardFilter} listings only as JSON` : "Export full structured data as JSON"}
                  >
                    <FileJson className="mr-1.5 h-3.5 w-3.5" />
                    JSON{cardFilter ? " (filtered)" : ""}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (taskId) {
                        // Keep the current result visible while refreshing —
                        // clearing it here would leave a blank screen if the
                        // reload fails (e.g. server restart).
                        setScanning(true);
                        pollStatus(taskId);
                      }
                    }}
                    disabled={scanning || !taskId}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Refresh
                  </Button>
                </div>
              </div>
              <ResultsTable
                ref={resultsTableRef}
                listings={safeListings}
                showHidden={showHidden}
                onToggleHidden={() => setShowHidden((s) => !s)}
                cardFilter={cardFilter}
                heatmapFilter={heatmapCell ? (() => { const [family, condition] = heatmapCell.split("__"); return { family, condition }; })() : null}
              />
            </section>
          </>
        )}
        {/* Empty state */}
        {!result && !scanning && !error && (
          <section className="relative overflow-hidden rounded-xl border border-dashed py-14 text-center">
            {/* Subtle gradient backdrop */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-emerald-50/50 to-transparent dark:from-emerald-950/10" aria-hidden />
            <div className="relative">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
                <Radar className="h-7 w-7" />
              </div>
              <p className="mt-4 text-base font-semibold">
                Ready to scan
              </p>
              <p className="mx-auto mt-1.5 max-w-md text-xs text-muted-foreground">
                Enter a product query above and hit{" "}
                <span className="font-medium text-foreground">
                  Start Arbitrage Scan
                </span>{" "}
                to identify profitable cross-border leads from Goofish to Portugal.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
                <span className="flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-muted-foreground">
                  <Zap className="h-3 w-3 text-emerald-500" />
                  Try a Deep Scan preset
                </span>
                <span className="flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-amber-500" />
                  Pin frequent queries
                </span>
              </div>
            </div>
          </section>
        )}
        {/* ── Product Profit Trend ──────────────────────────────────
            Shows profit trend across past scans for a specific product.
            The user can search for any product and see how its median
            Goofish price, EU resale price, and net profit have changed
            over time. Pre-fills with the current scan's query. */}
        <ProductTrend defaultQuery={result?.query} />
          </div>
        </div>
      </main>
      {/* Reference Price Matrix Admin Editor (renders via portal — no layout impact) */}
      <ReferenceEditor open={refEditorOpen} onOpenChange={setRefEditorOpen} />
      {/* Keyboard shortcuts help dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Keyboard className="h-4 w-4" />
              Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription className="text-xs">
              Press <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">?</kbd> anywhere to toggle this dialog.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {SHORTCUTS_HELP.map((s) => (
              <div
                key={s.keys}
                className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5"
              >
                <span className="text-xs text-muted-foreground">{s.desc}</span>
                <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold shadow-sm">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span>Tip: pin frequent queries with</span>
            <kbd className="rounded border border-emerald-300 bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold dark:border-emerald-700">
              s
            </kbd>
          </div>
        </DialogContent>
      </Dialog>
      {/* Footer — shrink-0 so it never compresses; mt-auto pushes it to the
          bottom of the flex-col when content is shorter than the viewport.
          When content exceeds the viewport, the footer is pushed down
          naturally by the flow (no overlap, no fixed positioning). */}
      <footer className="mt-auto shrink-0 border-t bg-muted/30">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-3.5 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-1.5">
            <Github className="h-3.5 w-3.5" />
            <span className="font-medium">Arbitrage Intelligence Engine</span>
          </div>
          {/* Pipeline steps as styled badges with arrows */}
          <div className="flex flex-wrap items-center justify-center gap-1">
            {[
              { label: "Goofish", tone: "text-rose-600 dark:text-rose-400" },
              { label: "Normalizer", tone: "text-sky-600 dark:text-sky-400" },
              { label: "Scam Detector", tone: "text-amber-600 dark:text-amber-400" },
              { label: "EU Matcher", tone: "text-fuchsia-600 dark:text-fuchsia-400" },
              { label: "Landed Cost", tone: "text-teal-600 dark:text-teal-400" },
              { label: "Profit", tone: "text-emerald-600 dark:text-emerald-400" },
            ].map((step, i, arr) => (
              <span key={step.label} className="flex items-center gap-1">
                <span className={`font-medium ${step.tone}`}>{step.label}</span>
                {i < arr.length - 1 && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                )}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}