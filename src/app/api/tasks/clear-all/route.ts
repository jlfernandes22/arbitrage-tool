import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteTask, listTasks } from "@/lib/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/tasks/clear-all
 * Deletes ALL tasks from both the in-memory store and the SQLite database.
 * Used by the "Clear All History" button in the Scan History sidebar.
 */
export async function DELETE(_req: NextRequest) {
  try {
    // 1. Delete all from in-memory store
    const memTasks = listTasks();
    let memCount = 0;
    for (const t of memTasks) {
      deleteTask(t.id);
      memCount++;
    }

    // 2. Delete all from SQLite database
    let dbCount = 0;
    try {
      const result = await db.task.deleteMany({});
      dbCount = result.count;
    } catch {
      // DB may be empty or unavailable
    }

    return NextResponse.json({
      ok: true,
      memDeleted: memCount,
      dbDeleted: dbCount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
