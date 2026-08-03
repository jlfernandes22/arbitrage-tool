import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listTasks } from "@/lib/task-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
interface DbTaskRow {
  id: string;
  query: string;
  category: string;
  status: string;
  progress: number;
  step: string | null;
  error: string | null;
  resultsJson: string | null;
  summaryJson: string | null;
  degraded: boolean;
  createdAt: Date;
  updatedAt: Date;
}
interface SummaryShape {
  total: number;
  shown: number;
  hiddenScam: number;
  hiddenProfit: number;
  avgMarginPct: number;
  bestProfitEur: number;
  bestMarginPct: number;
}
/**
 * Task history list — SQLite `Task` table is the source of truth so history
 * survives dev server restarts. The in-memory store is only consulted for
 * active/running tasks that haven't been persisted yet (or to surface the
 * most up-to-date status of in-flight tasks).
 */
export async function GET() {
  // 1. Pull all tasks from SQLite, newest first.
  let dbTasks: DbTaskRow[] = [];
  try {
    dbTasks = await db.task.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  } catch {
    // DB unavailable — fall back to in-memory only
  }
  // 2. Build a map of in-memory active tasks for live status overlay.
  const memTasks = listTasks();
  const memById = new Map(memTasks.map((t) => [t.id, t]));
  // 3. Merge: prefer in-memory status for active tasks (more up-to-date),
  //    but use DB rows as the canonical list (survives restarts).
  const seenIds = new Set<string>();
  const tasks: Array<{
    task_id: string;
    query: string;
    category: string;
    status: string;
    progress: number;
    step: string | null;
    degraded: boolean;
    started_at: string;
    finished_at: string | null;
    summary: SummaryShape | null;
  }> = [];
  // 3a. First, emit in-memory tasks that are active (not done/error/cancelled) — these
  //     may not be in the DB yet or may have stale DB rows.
  for (const t of memTasks) {
    if (t.status === "done" || t.status === "error" || t.status === "cancelled") continue;
    tasks.push({
      task_id: t.id,
      query: t.query,
      category: t.category,
      status: t.status,
      progress: t.progress,
      step: t.step,
      degraded: t.degraded,
      started_at: new Date(t.startedAt).toISOString(),
      finished_at: t.finishedAt ? new Date(t.finishedAt).toISOString() : null,
      summary: t.result?.summary ?? null,
    });
    seenIds.add(t.id);
  }
  // 3b. Then emit DB tasks (skip ones already emitted from memory).
  for (const row of dbTasks) {
    if (seenIds.has(row.id)) continue;
    let summary: SummaryShape | null = null;
    if (row.summaryJson) {
      try {
        summary = JSON.parse(row.summaryJson) as SummaryShape;
      } catch {
        // ignore parse errors
      }
    } else if (row.resultsJson) {
      // Older rows may only have resultsJson — derive summary from it.
      try {
        const parsed = JSON.parse(row.resultsJson) as { summary?: SummaryShape };
        summary = parsed.summary ?? null;
      } catch {
        // ignore
      }
    }
    tasks.push({
      task_id: row.id,
      query: row.query,
      category: row.category,
      status: row.status,
      progress: row.progress,
      step: row.step,
      degraded: row.degraded,
      started_at: row.createdAt.toISOString(),
      finished_at: row.updatedAt.toISOString(),
      summary,
    });
  }
  // 4. Global sort — in-memory active tasks were emitted first, but the
  //    sidebar must show the newest scan on top regardless of storage layer.
  tasks.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  return NextResponse.json({ tasks });
}