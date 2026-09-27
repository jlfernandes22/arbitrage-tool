import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasActiveScan } from "@/lib/task-store";
import {
  countLiveBrowserChildren,
  getJanitorStats,
} from "@/lib/browser-janitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system/health
 *
 * Lightweight operational snapshot for the debug panel — answers "is the
 * process healthy and are there leaking browsers?" without grepping logs:
 * - browsers: live playwright chromium children of THIS process (the OLX
 *   shared singleton is always alive by design; >1 while idle = leak).
 * - janitor: sweep/reap counters since boot.
 * - memory: process RSS + heap (the sandbox OOM history makes this the
 *   #1 thing to watch).
 * - scan: whether a scan is currently active (janitor defers to it).
 * - uptime: process uptime in seconds.
 */
export async function GET(_req: NextRequest) {
  const mem = process.memoryUsage();
  const janitor = getJanitorStats();
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    scanActive: hasActiveScan(),
    browsers: {
      liveChildren: countLiveBrowserChildren(),
    },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    janitor: {
      sweeps: janitor.sweeps,
      lastSweepAgoSec: janitor.lastSweepAt
        ? Math.round((Date.now() - janitor.lastSweepAt) / 1000)
        : null,
      reapedTotal: janitor.reapedTotal,
      lastReapedAgoSec: janitor.lastReapedAt
        ? Math.round((Date.now() - janitor.lastReapedAt) / 1000)
        : null,
      lastReapedCount: janitor.lastReapedCount,
    },
  });
}
