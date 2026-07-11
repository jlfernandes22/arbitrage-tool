import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requestCancel, getTask } from "@/lib/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/[id]/cancel
 * Requests a graceful cancellation of a running pipeline. The orchestrator
 * polls the cancel flag at key checkpoints (post-scrape, post-calc) and
 * finalizes the task as "cancelled" when it sees the flag. The HTTP response
 * returns immediately so the UI can stop polling and show the cancelled state.
 *
 * This does NOT hard-kill the Node process or abort in-flight Playwright
 * requests — those will run to completion and their results discarded. It
 * prevents the pipeline from proceeding to the next phase (calc / result
 * assembly) and from being marked "done".
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Task id is required" }, { status: 400 });
  }
  const cur = getTask(id);
  if (!cur) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  // Terminal states can't be cancelled.
  const terminal = ["done", "error", "cancelled", "paused"];
  if (terminal.includes(cur.status)) {
    return NextResponse.json({
      ok: true,
      already_terminal: true,
      status: cur.status,
      message: `Task is already in terminal state "${cur.status}" — nothing to cancel.`,
    });
  }
  const ok = requestCancel(id);
  if (!ok) {
    return NextResponse.json({ error: "Task not found in active store" }, { status: 404 });
  }
  // Persist the cancellation request to the DB step field so the history
  // view reflects the user's intent even if the orchestrator hasn't finalized
  // yet.
  try {
    await db.task.update({
      where: { id },
      data: { step: "Cancellation requested…" },
    });
  } catch {
    /* ignore DB errors */
  }
  return NextResponse.json({
    ok: true,
    cancelled: id,
    message: "Cancellation requested. The pipeline will abort at the next checkpoint.",
  });
}
