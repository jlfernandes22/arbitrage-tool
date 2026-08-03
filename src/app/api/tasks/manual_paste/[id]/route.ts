import { NextRequest, NextResponse } from "next/server";
import { resumeWithManualPaste } from "@/lib/orchestrator";
import { getTask } from "@/lib/task-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sanity cap for pasted DOM (~5 MB) — the blob is stored in memory, in the
// DB column and re-parsed; huge payloads are an abuse vector.
const MAX_HTML_BYTES = 5 * 1024 * 1024;
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { html } = body as { html?: string };
  if (!html || typeof html !== "string" || html.trim().length === 0) {
    return NextResponse.json(
      { error: "html (raw Goofish DOM) is required" },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return NextResponse.json(
      { error: "html exceeds the 5 MB size limit" },
      { status: 400 },
    );
  }
  // Refuse to resume a task that already finished — pasting onto a
  // completed task would restart the pipeline and overwrite its result.
  const existing = getTask(id);
  if (existing && ["done", "error", "cancelled"].includes(existing.status)) {
    return NextResponse.json(
      { error: `Task is already ${existing.status} and cannot be resumed` },
      { status: 409 },
    );
  }
  const task = await resumeWithManualPaste(id, html);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  return NextResponse.json({
    task_id: task.id,
    status: task.status,
    step: task.step,
  });
}