import { NextRequest, NextResponse } from "next/server";
import { resumeWithManualPaste } from "@/lib/orchestrator";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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