// lib/reference-prices.ts
// Reference price matrix service.
//
// ARCHITECTURE DECISION (Phase 3): Reference prices are migrated from
// `src/data/reference_prices.json` to the Prisma `ReferencePrice` table.
// Rationale: Next.js dev/serverless environments make filesystem writes
// unreliable (the dev server restarts, edge runtimes have no FS, and
// concurrent writes can corrupt the JSON). A Prisma table gives us ACID
// writes, durability across restarts, and a clean API for the admin UI.
//
// The JSON file is retained as the *seed source*: on first access, if the
// DB table is empty, we seed it from the JSON. After that, the DB is the
// source of truth and admin edits persist there.
import { db } from "@/lib/db";
import type { Category } from "@/lib/engine/types";
import seedPrices from "@/data/reference_prices.json";
interface RefPrice {
  new: number;
  excellent: number;
  very_good: number;
  good: number;
  fair?: number;
}
const seedRecord = seedPrices as Record<string, RefPrice>;
let seeded = false;
/** Infer category from the standardKey prefix. */
function inferCategory(standardKey: string): string {
  if (/^iPhone/i.test(standardKey)) return "iphone";
  if (/^MacBook/i.test(standardKey)) return "macbook";
  if (/^iPad/i.test(standardKey)) return "ipad";
  if (/^PlayStation/i.test(standardKey)) return "ps5";
  if (/^Galaxy/i.test(standardKey)) return "samsung";
  if (/^Apple Watch/i.test(standardKey)) return "applewatch";
  if (/^DJI/i.test(standardKey)) return "dji";
  if (/^Xiaomi|^Redmi|^POCO/i.test(standardKey)) return "xiaomi";
  if (/^Steam Deck|^Legion Go|^ROG Ally/i.test(standardKey)) return "gaming";
  return "iphone";
}
/** Seed the DB from the JSON file if the table is empty. Idempotent. */
export async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  try {
    const count = await db.referencePrice.count();
    if (count > 0) {
      seeded = true;
      return;
    }
    const rows = Object.entries(seedRecord).map(([key, p]) => ({
      standardKey: key,
      category: inferCategory(key),
      newPrice: p.new,
      excellentPrice: p.excellent,
      veryGoodPrice: p.very_good,
      goodPrice: p.good,
      fairPrice: p.fair ?? Math.round(p.good * 0.75),
    }));
    await db.referencePrice.createMany({ data: rows });
    seeded = true;
  } catch {
    // DB unavailable — callers fall back to JSON
  }
}
/**
 * Get all reference prices as a record (standardKey -> RefPrice).
 * Reads from the DB (source of truth); falls back to JSON on DB error.
 */
export async function getReferencePrices(): Promise<Record<string, RefPrice>> {
  await ensureSeeded();
  try {
    const rows = await db.referencePrice.findMany();
    const out: Record<string, RefPrice> = {};
    for (const r of rows) {
      out[r.standardKey] = {
        new: r.newPrice,
        excellent: r.excellentPrice,
        very_good: r.veryGoodPrice,
        good: r.goodPrice,
        fair: r.fairPrice,
      };
    }
    return out;
  } catch {
    return { ...seedRecord };
  }
}
export interface ReferencePriceRow {
  id: string;
  standardKey: string;
  category: string;
  new: number;
  excellent: number;
  veryGood: number;
  good: number;
  fair: number;
  updatedAt: string;
}
/** Get all reference prices as DB rows (for the admin UI). */
export async function getReferencePriceRows(): Promise<ReferencePriceRow[]> {
  await ensureSeeded();
  try {
    const rows = await db.referencePrice.findMany({
      orderBy: [{ category: "asc" }, { standardKey: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      standardKey: r.standardKey,
      category: r.category,
      new: r.newPrice,
      excellent: r.excellentPrice,
      veryGood: r.veryGoodPrice,
      good: r.goodPrice,
      fair: r.fairPrice,
      updatedAt: r.updatedAt.toISOString(),
    }));
  } catch {
    return [];
  }
}
/** Update a single reference price row by standardKey. */
export async function updateReferencePrice(
  standardKey: string,
  prices: {
    new: number;
    excellent: number;
    veryGood: number;
    good: number;
    fair: number;
  },
): Promise<void> {
  await db.referencePrice.update({
    where: { standardKey },
    data: {
      newPrice: prices.new,
      excellentPrice: prices.excellent,
      veryGoodPrice: prices.veryGood,
      goodPrice: prices.good,
      fairPrice: prices.fair,
    },
  });
}
/** Create a new reference price row. */
export async function createReferencePrice(
  standardKey: string,
  category: string,
  prices: {
    new: number;
    excellent: number;
    veryGood: number;
    good: number;
    fair: number;
  },
): Promise<void> {
  await db.referencePrice.create({
    data: {
      standardKey,
      category,
      newPrice: prices.new,
      excellentPrice: prices.excellent,
      veryGoodPrice: prices.veryGood,
      goodPrice: prices.good,
      fairPrice: prices.fair,
    },
  });
}
/** Delete a reference price row. */
export async function deleteReferencePrice(standardKey: string): Promise<void> {
  await db.referencePrice.delete({ where: { standardKey } });
}
/**
 * Bulk delete reference prices by standardKey. Runs in a transaction so
 * a partial failure rolls back. Returns the count of deleted rows.
 */
export async function bulkDeleteReferencePrices(standardKeys: string[]): Promise<number> {
  if (standardKeys.length === 0) return 0;
  const result = await db.referencePrice.deleteMany({
    where: { standardKey: { in: standardKeys } },
  });
  return result.count;
}
/**
 * Bulk upsert reference prices. Used by the CSV import feature.
 * For each row: if the standardKey exists, update prices + category; else create.
 * Runs in a transaction so a partial failure rolls back the whole batch.
 * Returns counts of created vs updated rows.
 */
export async function bulkUpsertReferencePrices(
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
  }>,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  // Process sequentially within a transaction so a single bad row doesn't
  // corrupt the whole import. Prisma SQLite doesn't support createMany with
  // upsert, so we do it row-by-row.
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const existing = await tx.referencePrice.findUnique({
        where: { standardKey: row.standardKey },
        select: { id: true },
      });
      if (existing) {
        await tx.referencePrice.update({
          where: { standardKey: row.standardKey },
          data: {
            category: row.category,
            newPrice: row.prices.new,
            excellentPrice: row.prices.excellent,
            veryGoodPrice: row.prices.veryGood,
            goodPrice: row.prices.good,
            fairPrice: row.prices.fair,
          },
        });
        updated++;
      } else {
        await tx.referencePrice.create({
          data: {
            standardKey: row.standardKey,
            category: row.category,
            newPrice: row.prices.new,
            excellentPrice: row.prices.excellent,
            veryGoodPrice: row.prices.veryGood,
            goodPrice: row.prices.good,
            fairPrice: row.prices.fair,
          },
        });
        created++;
      }
    }
  });
  return { created, updated };
}
export type { RefPrice, Category };