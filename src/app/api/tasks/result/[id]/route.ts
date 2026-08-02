import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTask, setTask, type TaskState } from "@/lib/task-store";
import { ensureArray } from "@/lib/utils";
import type { TaskResult } from "@/lib/engine";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * GET /api/tasks/result/[id]
 *
 * Returns the full evaluated result of a completed task. Falls back to the
 * SQLite DB when the task is not in the in-memory store — this is essential
 * for the "Scan History" sidebar to work after a dev-server restart, because
 * the in-memory `Map` is lost on every restart but the DB rows persist.
 *
 * Without this DB fallback, every historical scan shown in the sidebar would
 * 404 and the "Refresh" button would soft-lock the UI spinner forever.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let task = getTask(id);
  // ── DB fallback: reconstruct a TaskState from the persisted row ──
  // The in-memory store only contains tasks from the current process; any
  // task from a previous server session lives only in SQLite.
  //
  // IMPORTANT: also fall back to DB when the in-memory task exists but has
  // no `result`. This happens when a sibling endpoint (e.g. /api/tasks/status)
  // already hydrated a MINIMAL TaskState via `setTask` (just enough fields to
  // answer the status poll) — that minimal task has `status: "done"` but
  // `result: undefined`. Without this extra condition, the result endpoint
  // would see the non-null in-memory task, skip the DB fallback, and then
  // return "task not finished" because `!task.result` is true — even though
  // the full result IS in the DB.
  if (!task || (task.status === "done" && !task.result)) {
    try {
      const row = await db.task.findUnique({ where: { id } });
      if (row?.resultsJson) {
        let parsed = JSON.parse(row.resultsJson) as TaskResult;
        // ── Validate parsed shape: guard against malformed DB JSON ──
        // If listings is not an array (e.g., partial write, corruption),
        // replace it with an empty array to prevent downstream .map() crashes.
        if (!parsed || typeof parsed !== "object") {
          parsed = {} as TaskResult;
        }
        if (!Array.isArray(parsed.listings)) {
          parsed.listings = [];
        }
        if (!parsed.summary || typeof parsed.summary !== "object") {
          parsed.summary = {
            total: 0, shown: 0, hiddenScam: 0, hiddenProfit: 0,
            avgMarginPct: 0, avgRiskScore: 0, bestProfitEur: 0, bestMarginPct: 0,
          };
        }
        if (!Array.isArray(parsed.warnings)) {
          parsed.warnings = [];
        }
        task = {
          id: row.id,
          query: row.query,
          category: row.category as TaskState["category"],
          status: row.status as TaskState["status"],
          progress: 100,
          step: row.step ?? "Done",
          warnings: [],
          degraded: row.degraded,
          startedAt: row.createdAt.getTime(),
          finishedAt: row.updatedAt.getTime(),
          result: parsed,
          logs: [],
        } as TaskState;
        setTask(id, task);
      }
    } catch {
      /* ignore DB errors — fall through to 404 */
    }
  }
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  if (task.status !== "done" || !task.result) {
    return NextResponse.json(
      {
        error: "task not finished",
        status: task.status,
        progress: task.progress,
        step: task.step,
      },
      { status: 409 },
    );
  }
  const includeHidden = req.nextUrl.searchParams.get("include_hidden") === "1";
  // Guard: ensureArray handles corrupted DB data where listings may be a plain
  // object with numeric keys instead of a real array (causes .map() TypeError).
  const safeListings = ensureArray(task.result.listings);
  const result = {
    ...task.result,
    listings: includeHidden
      ? safeListings
      : safeListings.filter((l) => !l.hidden),
  };
  return NextResponse.json(result);
}
