// engine/forex.ts
// Forex rate service with SQLite cache (TTL 1 hour) and graceful fallback.
//
// Resolution order: cache (DB) → live API → user-configured `cny_to_eur_rate`
// → static `fallback_rate`. The user-configured rate is set via the UI control
// panel and merged into `config.forex.cny_to_eur_rate` by `resolveConfig`.
// Previously this field was dead — the UI wrote to it but forex.ts only read
// `fallback_rate`, so the user's manual rate override had no effect.
import { db } from "@/lib/db";
import { config } from "@/lib/config";
const FOREX_TTL_MS = config.forex.ttl_seconds * 1000;
/**
 * Resolve the CNY→EUR rate: DB cache → live API → user-configured override
 * → static fallback.
 *
 * `userRateOverride` is the task's RESOLVED `cny_to_eur_rate` (from config
 * overrides set in the UI). It only kicks in when the live API is
 * unreachable, matching the documented resolution order — but WITHOUT it the
 * user's manual rate was dead code (the module-level `config` is the static
 * default, not the per-task resolved config).
 */
export async function getCnyToEurRate(userRateOverride?: number): Promise<{
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
  // Fallback: prefer the user-configured `cny_to_eur_rate` (set via UI /
  // config overrides) so the user's manual rate actually takes effect when
  // the live API is unreachable. Fall back to the static `fallback_rate`
  // only if the user-configured value is missing or invalid (≤ 0).
  const userRate = userRateOverride && userRateOverride > 0
    ? userRateOverride
    : config.forex.cny_to_eur_rate;
  const rate = userRate && userRate > 0 ? userRate : config.forex.fallback_rate;
  return { rate, source: "fallback" };
}