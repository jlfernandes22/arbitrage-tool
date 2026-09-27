// API: GET /api/tasks/scraper-health?limit=20
// Aggregates the per-scraper outcomes (scraperStatuses) of the most recent
// completed tasks into a per-site reliability snapshot:
//   - success rate (share of scans where the site returned >0 results)
//   - blocked / error / empty / skipped counts
//   - average result count across successful scans
//   - how many scans ago the site last produced data
//
// Purpose: makes flaky sites visible over time (e.g. "Vinted 10% success —
// Datadome blocks most scans from this network") instead of only showing the
// outcome of the latest scan. Data source is the persisted resultsJson, so
// history survives server restarts.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITES = ["goofish", "olx", "vinted", "kuantokusta", "amazon"] as const;
type Site = (typeof SITES)[number];

interface StoredStatus {
  site: string;
  status: "ok" | "empty" | "blocked" | "error" | "skipped";
  count: number;
  detail?: string;
  durationMs?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 50);

  try {
    const tasks = await db.task.findMany({
      where: {
        status: "done",
        resultsJson: { not: null },
      },
      select: {
        id: true,
        query: true,
        resultsJson: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Per-site aggregation. Scans are ordered newest → oldest, so the first
    // scan with count > 0 gives "lastOkScansAgo" (0 = the latest scan).
    const agg = new Map<
      Site,
      {
        scans: number;
        ok: number;
        blocked: number;
        error: number;
        empty: number;
        skipped: number;
        totalResults: number;
        okResults: number;
        lastOkScansAgo: number | null;
        lastDetail: string | null;
        lastStatus: StoredStatus["status"] | null;
      }
    >();
    for (const s of SITES) {
      agg.set(s, {
        scans: 0, ok: 0, blocked: 0, error: 0, empty: 0, skipped: 0,
        totalResults: 0, okResults: 0,
        lastOkScansAgo: null, lastDetail: null, lastStatus: null,
      });
    }

    let scansWithStatuses = 0;
    for (let scanIdx = 0; scanIdx < tasks.length; scanIdx++) {
      const t = tasks[scanIdx];
      let statuses: StoredStatus[] | null = null;
      try {
        const parsed = JSON.parse(t.resultsJson as string) as { scraperStatuses?: StoredStatus[] };
        if (Array.isArray(parsed?.scraperStatuses) && parsed.scraperStatuses.length > 0) {
          statuses = parsed.scraperStatuses;
        }
      } catch {
        // Corrupted row — skip this scan for health purposes
        continue;
      }
      if (!statuses) continue; // pre-feature scan (no scraperStatuses)
      scansWithStatuses++;
      for (const st of statuses) {
        if (!SITES.includes(st.site as Site)) continue;
        const a = agg.get(st.site as Site)!;
        a.scans++;
        a.lastStatus = st.status;
        if (st.detail) a.lastDetail = st.detail;
        if (st.status === "ok") {
          a.ok++;
          a.okResults += st.count || 0;
          if (a.lastOkScansAgo === null) a.lastOkScansAgo = scanIdx;
        } else if (st.status === "blocked") a.blocked++;
        else if (st.status === "error") a.error++;
        else if (st.status === "empty") a.empty++;
        else if (st.status === "skipped") a.skipped++;
      }
    }

    const sites = SITES.map((site) => {
      const a = agg.get(site)!;
      const counted = a.scans - a.skipped; // skipped scans say nothing about reachability
      const successRate = counted > 0 ? Math.round((a.ok / counted) * 100) : null;
      const avgResults = a.ok > 0 ? Math.round(a.okResults / a.ok) : 0;
      return {
        site,
        scans: a.scans,
        ok: a.ok,
        blocked: a.blocked,
        error: a.error,
        empty: a.empty,
        skipped: a.skipped,
        successRate,
        avgResults,
        lastOkScansAgo: a.lastOkScansAgo,
        lastStatus: a.lastStatus,
        lastDetail: a.lastDetail,
      };
    });

    return NextResponse.json({
      scansAnalyzed: scansWithStatuses,
      windowSize: tasks.length,
      sites,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to compute scraper health: ${msg}` },
      { status: 500 },
    );
  }
}
