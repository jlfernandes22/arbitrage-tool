// API: GET /api/tasks/suggestions?q=iPhone
// Returns a list of unique product queries from past completed scans that
// match the search text. Used for autocomplete in the Product Trend search bar.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";

  try {
    // Get all unique queries from completed tasks
    const tasks = await db.task.findMany({
      where: {
        status: "done",
        resultsJson: { not: null },
        ...(q ? { query: { contains: q } } : {}),
      },
      select: { query: true, createdAt: true },
      distinct: ["query"],
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Return unique query strings with their most recent scan date
    const suggestions = tasks.map((t) => ({
      query: t.query,
      lastScanned: t.createdAt.toISOString(),
    }));

    return NextResponse.json({ suggestions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to fetch suggestions: ${msg}` },
      { status: 500 },
    );
  }
}
