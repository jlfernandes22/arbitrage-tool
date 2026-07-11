import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteTask } from "@/lib/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/tasks/[id]
 * Deletes a task from both the in-memory store (for active tasks) and the
 * SQLite database (for persisted history). Used by the Scan History sidebar
 * to let users remove old/irrelevant scans.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Task id is required" }, { status: 400 });
  }
  let memDeleted = false;
  let dbDeleted = false;
  try {
    // 1. Delete from in-memory store (active/recent tasks)
    memDeleted = deleteTask(id);
    // 2. Delete from SQLite database (persisted history)
    try {
      await db.task.delete({ where: { id } });
      dbDeleted = true;
    } catch {
      // Task may not be in the DB (e.g. only in-memory, or already deleted)
    }
    if (!memDeleted && !dbDeleted) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      deleted: id,
      memDeleted,
      dbDeleted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
