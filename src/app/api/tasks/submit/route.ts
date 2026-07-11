import { NextRequest, NextResponse } from "next/server";
import { createTask, runPipeline } from "@/lib/orchestrator";
import type { AppConfig, Category } from "@/lib/engine/types";
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
    configOverrides?: Partial<AppConfig>;
  };
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  const cat = (category as Category) ?? "iphone";
  if (!VALID_CATEGORIES.includes(cat)) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }
  const task = createTask({
    query: query.trim(),
    category: cat,
    configOverrides,
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