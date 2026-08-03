import { NextRequest, NextResponse } from "next/server";
import { createTask, runPipeline } from "@/lib/orchestrator";
import type { Category } from "@/lib/engine/types";
import { sanitizeConfigOverrides } from "@/lib/overrides";
import type { AppConfig } from "@/lib/engine/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const VALID_CATEGORIES: Category[] = ["iphone", "macbook", "ipad", "ps5", "samsung", "applewatch", "dji", "xiaomi", "gaming"];

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { query, category, configOverrides } = body as {
    query?: string;
    category?: string;
    configOverrides?: unknown;
  };
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (query.trim().length > 200) {
    return NextResponse.json({ error: "query is too long (max 200 chars)" }, { status: 400 });
  }
  const cat = (category as Category) ?? "iphone";
  if (!VALID_CATEGORIES.includes(cat)) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }
  const sanitized = sanitizeConfigOverrides(configOverrides);
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }
  const task = await createTask({
    query: query.trim(),
    category: cat,
    // SanitizedOverrides carries partial sections — the same shape
    // resolveConfig() merges at runtime, so the cast is safe.
    configOverrides: sanitized.overrides as Partial<AppConfig> | undefined,
  });
  // Fire-and-forget pipeline execution
  void runPipeline(task.id).catch((err) => {
    console.error("[orchestrator] pipeline error", err);
  });
  return NextResponse.json({
    task_id: task.id,
    status: task.status,
    query: task.query,
    category: task.category,
  });
}
