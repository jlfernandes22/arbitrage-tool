import { NextRequest, NextResponse } from "next/server";
import {
  getReferencePriceRows,
  updateReferencePrice,
  createReferencePrice,
  deleteReferencePrice,
  bulkUpsertReferencePrices,
  bulkDeleteReferencePrices,
  type ReferencePriceRow,
} from "@/lib/reference-prices";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const rows = await getReferencePriceRows();
    return NextResponse.json({ prices: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { action } = body as { action?: string };
  try {
    if (action === "update") {
      const { standardKey, prices } = body as {
        standardKey: string;
        prices: {
          new: number;
          excellent: number;
          veryGood: number;
          good: number;
          fair: number;
        };
      };
      if (!standardKey || !prices) {
        return NextResponse.json(
          { error: "standardKey and prices are required" },
          { status: 400 },
        );
      }
      await updateReferencePrice(standardKey, prices);
      return NextResponse.json({ ok: true, action: "updated", standardKey });
    }
    if (action === "create") {
      const { standardKey, category, prices } = body as {
        standardKey: string;
        category: string;
        prices: {
          new: number;
          excellent: number;
          veryGood: number;
          good: number;
          fair: number;
        };
      };
      if (!standardKey || !category || !prices) {
        return NextResponse.json(
          { error: "standardKey, category and prices are required" },
          { status: 400 },
        );
      }
      await createReferencePrice(standardKey, category, prices);
      return NextResponse.json({ ok: true, action: "created", standardKey });
    }
    if (action === "delete") {
      const { standardKey } = body as { standardKey: string };
      if (!standardKey) {
        return NextResponse.json(
          { error: "standardKey is required" },
          { status: 400 },
        );
      }
      await deleteReferencePrice(standardKey);
      return NextResponse.json({ ok: true, action: "deleted", standardKey });
    }
    if (action === "bulk_upsert") {
      const { rows } = body as {
        rows: Array<{
          standardKey: string;
          category: string;
          prices: {
            new: number;
            excellent: number;
            veryGood: number;
            good: number;
            fair: number;
          };
        }>;
      };
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json(
          { error: "rows must be a non-empty array" },
          { status: 400 },
        );
      }
      // Validate each row minimally.
      for (const r of rows) {
        if (!r.standardKey || !r.category || !r.prices) {
          return NextResponse.json(
            { error: `Invalid row: ${JSON.stringify(r).slice(0, 100)}` },
            { status: 400 },
          );
        }
      }
      const result = await bulkUpsertReferencePrices(rows);
      return NextResponse.json({ ok: true, action: "bulk_upserted", ...result });
    }
    if (action === "bulk_delete") {
      const { standardKeys } = body as { standardKeys: string[] };
      if (!Array.isArray(standardKeys) || standardKeys.length === 0) {
        return NextResponse.json(
          { error: "standardKeys must be a non-empty array" },
          { status: 400 },
        );
      }
      const deletedCount = await bulkDeleteReferencePrices(standardKeys);
      return NextResponse.json({ ok: true, action: "bulk_deleted", deletedCount });
    }
    return NextResponse.json(
      { error: "action must be 'update', 'create', 'delete', 'bulk_upsert', or 'bulk_delete'" },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
export type { ReferencePriceRow };