"use client";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  History,
  RotateCcw,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Star,
  Play,
  StarOff,
} from "lucide-react";
import { toast } from "sonner";
import type { SavedQuery } from "@/hooks/use-saved-queries";

interface HistoryTask {
  task_id: string;
  query: string;
  category: string;
  status: string;
  progress: number;
  step: string | null;
  degraded: boolean;
  started_at: string;
  finished_at: string | null;
  summary: {
    total: number;
    shown: number;
    hiddenScam: number;
    hiddenProfit: number;
    avgMarginPct: number;
    bestProfitEur: number;
    bestMarginPct: number;
  } | null;
}

interface TaskHistoryProps {
  activeTaskId: string | null;
  onSelect: (task: HistoryTask) => void;
  onRerun: (task: HistoryTask) => void;
  refreshKey: number;
  // Saved/pinned queries (localStorage-backed). Optional so the component
  // can be used without the favorites feature.
  savedQueries?: SavedQuery[];
  onRunSaved?: (q: SavedQuery) => void;
  onRemoveSaved?: (id: string) => void;
  activeQuery?: string;
  activeCategory?: string;
  isSavedActive?: boolean;
  onToggleSaveActive?: () => void;
  // Delete a task from history. Optional — when provided, a delete button
  // appears on each history entry (hover to reveal).
  onDeleteTask?: (taskId: string) => void;
}

export function TaskHistory({
  activeTaskId,
  onSelect,
  onRerun,
  refreshKey,
  savedQueries = [],
  onRunSaved,
  onRemoveSaved,
  activeQuery,
  activeCategory,
  isSavedActive,
  onToggleSaveActive,
  onDeleteTask,
}: TaskHistoryProps) {
  const [tasks, setTasks] = useState<HistoryTask[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const res = await fetch("/api/tasks/list", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setTasks(data.tasks ?? []);
        setLoading(false);
        // Stop polling when no tasks are active (done/error/paused only) —
        // saves bandwidth when the dashboard is idle.
        const hasActive = (data.tasks ?? []).some(
          (t: HistoryTask) =>
            t.status !== "done" && t.status !== "error" && t.status !== "paused",
        );
        if (hasActive && !interval) {
          interval = setInterval(load, 2000); // poll every 2s when active
        } else if (!hasActive && interval) {
          clearInterval(interval);
          interval = null;
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [refreshKey]);
  const statusIcon = (status: string) => {
    switch (status) {
      case "done":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-rose-600" />;
      case "paused":
        return <Clock className="h-3.5 w-3.5 text-amber-600" />;
      default:
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    }
  };
  const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };
  const hasSaved = savedQueries.length > 0;
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4" />
          Scan History
          <Badge variant="secondary" className="ml-auto text-xs">
            {tasks.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {/* ─── Saved Queries (pinned) ─────────────────────────────── */}
        {hasSaved && (
          <div className="border-b px-3 pb-2.5 pt-1">
            <div className="mb-1.5 flex items-center gap-1.5 px-1">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pinned ({savedQueries.length})
              </span>
            </div>
            <div className="space-y-1">
              {savedQueries.map((sq) => (
                <div
                  key={sq.id}
                  className="group flex items-center gap-1.5 rounded-md border border-amber-200/60 bg-amber-50/50 p-1.5 transition-colors hover:bg-amber-100/60 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
                >
              <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
              <button
                onClick={() => onRunSaved?.(sq)}
                className="flex-1 truncate text-left text-xs font-medium hover:underline"
                title={`Run "${sq.query}"`}
              >
                {sq.query}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onRunSaved?.(sq);
                  toast.info(`Running pinned: "${sq.query}"`);
                }}
                title="Run this pinned query"
              >
                <Play className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-rose-600"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveSaved?.(sq.id);
                }}
                title="Remove pin"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
      )}
        {/* ─── Pin current query button ──────────────────────────── */}
        {activeQuery && onToggleSaveActive && (
          <div className="border-b px-3 py-2">
            <Button
              variant={isSavedActive ? "secondary" : "outline"}
              size="sm"
              className="h-7 w-full justify-center gap-1.5 text-xs"
              onClick={onToggleSaveActive}
            >
              {isSavedActive ? (
                <>
                  <StarOff className="h-3 w-3" />
                  Unpin current query
                </>
              ) : (
                <>
                  <Star className="h-3 w-3" />
                  Pin current query
                </>
              )}
            </Button>
          </div>
        )}
        <ScrollArea className="h-[360px] px-3 pb-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No scans yet
            </p>
          ) : (
            <div className="space-y-1.5">
              {tasks.map((t) => {
                const isActive = t.task_id === activeTaskId;
                const isDone = t.status === "done";
                const isRunning = t.status !== "done" && t.status !== "error" && t.status !== "paused" && t.status !== "cancelled";
                return (
                  <div
                    key={t.task_id}
                    className={`group rounded-lg border p-2.5 transition-colors ${
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {statusIcon(t.status)}
                      <button
                        onClick={() => isDone && onSelect(t)}
                        disabled={!isDone}
                        className="flex-1 truncate text-left text-xs font-medium hover:underline disabled:cursor-default disabled:no-underline"
                        title={t.query}
                      >
                        {t.query}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 opacity-70 hover:opacity-100 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRerun(t);
                        }}
                        title="Re-run this scan"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                      {onDeleteTask && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0 opacity-70 hover:opacity-100 group-hover:opacity-100 text-muted-foreground hover:text-rose-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Delete scan "${t.query}" from history? This cannot be undone.`)) {
                              onDeleteTask(t.task_id);
                            }
                          }}
                          title="Delete this scan from history"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(t.started_at)}
                      </span>
                    </div>
                    {t.summary && (
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {t.summary.shown}/{t.summary.total}
                        </span>
                        <span>leads</span>
                        {t.summary.bestProfitEur > 0 && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span>best €{Math.round(t.summary.bestProfitEur)}</span>
                          </>
                        )}
                        {t.degraded && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] leading-none text-amber-600">
                            partial
                          </Badge>
                        )}
                      </div>
                    )}
                    {!t.summary && t.step && (
                      <p className="mt-1 truncate text-[10px] text-muted-foreground">
                        {t.step}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
export { RotateCcw, Trash2 };
