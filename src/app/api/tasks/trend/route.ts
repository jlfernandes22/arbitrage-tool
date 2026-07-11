// API: GET /api/tasks/trend?query=iPhone%2015%20Pro
// Returns profit trend data for a specific product query across all past
// completed scans. Each data point includes the scan date, median Goofish
// price (CNY + EUR), median EU resale price, and median net profit.
// Used by the "Product Profit Trend" section below the results table.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();

  if (!query) {
    return NextResponse.json(
      { error: "Missing 'query' parameter" },
      { status: 400 },
    );
  }

  // Strip storage suffix (e.g. "256GB", "128GB", "1TB") from the query so
  // that searching "iPhone 15 Pro 256GB" matches ALL storage variants
  // ("iPhone 15 Pro", "iPhone 15 Pro 128GB", "iPhone 15 Pro 512GB", etc.)
  const baseQuery = query.replace(/\s*\d+\s*(?:GB|TB)\s*$/i, "").trim() || query;

  try {
    // Find all completed tasks whose query contains the base product name
    // (without storage). SQLite's `contains` is case-insensitive for ASCII.
    // This matches "iPhone 15 Pro" → "iPhone 15 Pro", "iPhone 15 Pro 256GB", etc.
    const tasks = await db.task.findMany({
      where: {
        status: "done",
        query: {
          contains: baseQuery,
        },
        resultsJson: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        query: true,
        createdAt: true,
        resultsJson: true,
        summaryJson: true,
      },
      take: 100,
    });

    // Parse each task's results to extract profit data
    const trendData = tasks
      .map((task) => {
        try {
          if (!task.resultsJson) return null;
          const result = JSON.parse(task.resultsJson);
          const listings = result.listings || [];
          if (listings.length === 0) return null;

          // Extract prices from viable (non-hidden) listings
          const viable = listings.filter((l: { hidden: boolean }) => !l.hidden);
          if (viable.length === 0) return null;

          const goofishPricesCny = viable
            .map((l: { listing: { priceCny: number } }) => l.listing?.priceCny)
            .filter((p: number | undefined): p is number => typeof p === "number" && p > 0);
          const profitEurs = viable
            .map((l: { profit: { netProfitEur: number } }) => l.profit?.netProfitEur)
            .filter((p: number | undefined): p is number => typeof p === "number");
          const resaleEurs = viable
            .map((l: { profit: { expectedResaleEur: number } }) => l.profit?.expectedResaleEur)
            .filter((p: number | undefined): p is number => typeof p === "number" && p > 0);
          const margins = viable
            .map((l: { profit: { marginPct: number } }) => l.profit?.marginPct)
            .filter((p: number | undefined): p is number => typeof p === "number");

          const median = (arr: number[]) => {
            if (arr.length === 0) return 0;
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 === 0
              ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
              : Math.round(sorted[mid]);
          };

          // Round all values to integers to avoid floating point leaks
          return {
            taskId: task.id,
            query: task.query,
            date: task.createdAt.toISOString(),
            listingCount: viable.length,
            medianGoofishCny: median(goofishPricesCny),
            medianProfitEur: median(profitEurs),
            medianResaleEur: median(resaleEurs),
            medianMarginPct: median(margins),
            bestProfitEur: profitEurs.length > 0 ? Math.round(Math.max(...profitEurs)) : 0,
            bestMarginPct: margins.length > 0 ? Math.round(Math.max(...margins)) : 0,
          };
        } catch {
          return null;
        }
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    return NextResponse.json({
      query,
      baseQuery,
      dataPoints: trendData.length,
      trend: trendData,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to fetch trend: ${msg}` },
      { status: 500 },
    );
  }
}
