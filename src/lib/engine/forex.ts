// engine/forex.ts
// Forex rate service with SQLite cache (TTL 1 hour) and graceful fallback.
import { db } from "@/lib/db";
import { config } from "@/lib/config";
const FOREX_TTL_MS = config.forex.ttl_seconds * 1000;
export async function getCnyToEurRate(): Promise<{
  rate: number;
  source: "cache" | "api" | "fallback";
}> {
  // Try cache first
  try {
    const cached = await db.forexRate.findUnique({
      where: { fromCcy_toCcy: { fromCcy: "CNY", toCcy: "EUR" } },
    });
    if (cached && cached.expiresAt.getTime() > Date.now()) {
      return { rate: cached.rate, source: "cache" };
    }
  } catch {
    // DB not ready; fall through
  }
  // Try live API
  try {
    const res = await fetch(config.forex.api_url, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.EUR;
      if (rate && rate > 0) {
        try {
          await db.forexRate.upsert({
            where: { fromCcy_toCcy: { fromCcy: "CNY", toCcy: "EUR" } },
            update: {
              rate,
              source: "api",
              fetchedAt: new Date(),
              expiresAt: new Date(Date.now() + FOREX_TTL_MS),
            },
            create: {
              fromCcy: "CNY",
              toCcy: "EUR",
              rate,
              source: "api",
              expiresAt: new Date(Date.now() + FOREX_TTL_MS),
            },
          });
        } catch {
          // ignore DB errors
        }
        return { rate, source: "api" };
      }
    }
  } catch {
    // network blocked / timeout — fall back
  }
  // Fallback to hardcoded rate
  return { rate: config.forex.fallback_rate, source: "fallback" };
}