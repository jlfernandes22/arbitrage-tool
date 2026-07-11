import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/translate
 * Translates Chinese (Simplified) marketplace listing text to European
 * Portuguese (pt-PT). Used by the listing detail dialog so the user can
 * read Goofish titles, descriptions, and condition flags in Portuguese.
 *
 * Body: { "title": string, "description"?: string, "location"?: string, "conditionRaw"?: string }
 * Returns: { "title": string, "description"?: string, "location"?: string, "conditionRaw"?: string }
 *
 * Uses the z-ai-web-dev-sdk LLM (server-side only). A single LLM call
 * translates all provided fields at once and returns strict JSON, which
 * keeps latency low vs. one call per field.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { title, description, location, conditionRaw } = body as {
    title?: string;
    description?: string;
    location?: string;
    conditionRaw?: string;
  };
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Build the fields payload so the LLM only sees non-empty fields.
  const fields: Record<string, string> = {};
  if (title) fields.title = title;
  if (description && description.trim()) fields.description = description;
  if (location && location.trim()) fields.location = location;
  if (conditionRaw && conditionRaw.trim()) fields.conditionRaw = conditionRaw;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "assistant",
          content:
            "You are a professional translator specializing in Chinese (Simplified) to European Portuguese (pt-PT, Portugal) translation for second-hand electronics marketplace listings (Goofish / 闲鱼). " +
            "Translate the given JSON object's values from Chinese to European Portuguese. Keep brand names, model numbers, storage sizes, and proper nouns as-is (e.g. iPhone, MacBook, 256GB, M2). " +
            "Preserve the original tone and any marketplace shorthand naturally used in Portugal. " +
            "Respond with ONLY a valid JSON object with the exact same keys as the input, where each value is the Portuguese translation. " +
            "Do NOT wrap the JSON in markdown fences. Do NOT add any commentary.",
        },
        {
          role: "user",
          content: JSON.stringify(fields, null, 2),
        },
      ],
      thinking: { type: "disabled" },
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    // The model may occasionally wrap output in ```json fences — strip them.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, string>;
    } catch {
      // If JSON parse fails, return the raw text as the title translation
      // so the UI degrades gracefully instead of erroring out.
      return NextResponse.json({
        title: cleaned.slice(0, 500) || title,
        description: description ?? null,
        location: location ?? null,
        conditionRaw: conditionRaw ?? null,
        _fallback: true,
      });
    }
    return NextResponse.json({
      title: typeof parsed.title === "string" ? parsed.title : title,
      description:
        typeof parsed.description === "string" ? parsed.description : (description ?? null),
      location:
        typeof parsed.location === "string" ? parsed.location : (location ?? null),
      conditionRaw:
        typeof parsed.conditionRaw === "string" ? parsed.conditionRaw : (conditionRaw ?? null),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Translation failed: ${msg}` },
      { status: 500 },
    );
  }
}
