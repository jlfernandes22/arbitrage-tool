import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/task-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const task = getTask(id);
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
  const result = {
    ...task.result,
    listings: includeHidden
      ? task.result.listings
      : task.result.listings.filter((l) => !l.hidden),
  };
  return NextResponse.json(result);
}