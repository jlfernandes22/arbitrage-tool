import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTask, setTask, type TaskState } from "@/lib/task-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * GET /api/tasks/status/[id]
 *
 * Returns the current status of a task for the client polling loop. Falls
 * back to the SQLite DB when the task is not in the in-memory store — without
 * this fallback, polling for a task that survived a server restart would 404
 * forever, soft-locking the UI spinner (the client's `pollStatus` silently
 * returns on !ok without ever clearing `scanning(true)`).
 *
 * For DB-backed tasks we know the task is terminal (the in-memory pipeline
 * died with the process), so we return the persisted status/step/progress
 * directly. This lets the client stop polling and render the final state.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let task = getTask(id);
  // ── DB fallback ──
  if (!task) {
    try {
      const row = await db.task.findUnique({ where: { id } });
      if (row) {
        const TERMINAL = new Set(["done", "error", "paused", "cancelled"]);
        // Only report finished_at for terminal rows — a row that was
        // mid-run when the process died must not claim a finish time.
        const terminal = TERMINAL.has(row.status);
        task = {
          id: row.id,
          query: row.query,
          category: row.category as TaskState["category"],
          status: row.status as TaskState["status"],
          progress: row.progress,
          step: row.step ?? "",
          error: row.error ?? undefined,
          warnings: [],
          degraded: row.degraded,
          startedAt: row.createdAt.getTime(),
          finishedAt: terminal ? row.updatedAt.getTime() : undefined,
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
  return NextResponse.json({
    task_id: task.id,
    query: task.query,
    category: task.category,
    status: task.status,
    progress: task.progress,
    step: task.step,
    error: task.error,
    warnings: task.warnings,
    degraded: task.degraded,
    started_at: new Date(task.startedAt).toISOString(),
    finished_at: task.finishedAt
      ? new Date(task.finishedAt).toISOString()
      : null,
    logs: task.logs ?? [],
  });
}
