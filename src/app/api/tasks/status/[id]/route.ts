import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/task-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const task = getTask(id);
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