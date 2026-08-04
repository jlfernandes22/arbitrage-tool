// engine/profit_calc.ts
// Landed Cost & Financial Arbitrage Math.
//
// Landed Cost = [Base Price * FX Fee] + Forwarder Shipping + Customs Fee + Import VAT + Domestic Shipping
//
// Pipeline:
// 1. Acquisition Cost Base (EUR): Price_CNY * Rate_CNY->EUR * (1 + Fee_Exchange)
// 2. Landed Logistics Base: + forwarder shipping tariff
// 3. Customs Duty: EU import duty 0% for laptops/phones; + flat carrier clearance fee
// 4. Portuguese Import VAT (23%): 0.23 * (Cost_Base + Tariff_AirFreight + Fee_Clearance)
// 5. Final Domestic Distribution: + Portuguese domestic courier (CTT)
import type {
  EuMarketComp,
  LandedCostBreakdown,
  NormalizedProduct,
  ProfitAnalysis,
} from "./types";
import type { AppConfig } from "@/lib/config";
import { extractStorage, formatStorageGB } from "./normalizer";
import referencePrices from "@/data/reference_prices.json";

interface RefPrice {
  new: number;
  excellent: number;
  very_good: number;
  good: number;
  fair?: number;
}
// Static fallback reference prices from JSON file. Used when the DB-backed
// override is not provided (e.g., direct function calls without pipeline context).
const defaultRefPrices = referencePrices as Record<string, RefPrice>;

/**
 * Per-GB price delta used when interpolating reference prices across storage
 * tiers. Apple's pricing model roughly adds €50-100 per storage doubling, so
 * we use €0.25/GB as a conservative per-GB delta (e.g., 128→256 = +€32, 
 * 256→512 = +€64, 512→1TB = +€128). This ensures a 512GB listing without an exact reference
 * price gets a higher resale estimate than a 256GB one.
 */
const STORAGE_PRICE_PER_GB = 0.25;

/**
 * Look up a reference price for a normalized product. If the exact standardKey
 * (e.g., "iPhone 15 Pro 512GB") isn't in the reference table, find the closest
 * available storage tier for the same family and adjust the price proportionally
 * to the storage difference. This ensures storage variants without explicit
 * reference entries still get a sensible resale estimate.
 */
function lookupRefPrice(
  source: Record<string, RefPrice>,
  standardKey: string,
  storageGB?: number,
  family?: string,
): RefPrice | null {
  // 1. Exact match
  const exact = source[standardKey];
  if (exact) return exact;

  // 1b. Alternative standardKey formats (1024GB <-> 1TB)
  if (storageGB) {
    const altKey = standardKey.includes("1024GB")
      ? standardKey.replace("1024GB", "1TB")
      : standardKey.includes("1TB")
        ? standardKey.replace("1TB", "1024GB")
        : standardKey.includes("2048GB")
          ? standardKey.replace("2048GB", "2TB")
          : standardKey.includes("2TB")
            ? standardKey.replace("2TB", "2048GB")
            : null;
    if (altKey && source[altKey]) return source[altKey];
  }

  // 2. Find the closest storage tier for the same family
  if (!family || !storageGB) return null;

  // Build a list of all reference entries that share the same family prefix.
  // e.g., family "iPhone 16 Pro" matches "iPhone 16 Pro 128GB", "256GB", "512GB".
  const familyEntries = Object.entries(source).filter(([key]) =>
    key.startsWith(family + " ") || key === family,
  );
  if (familyEntries.length === 0) return null;

  // Parse the storage from each matching key and find the closest one.
  let closest: { entry: RefPrice; storageDiff: number; refStorage: number } | null = null;
  for (const [key, entry] of familyEntries) {
    const parsed = extractStorage(key);
    if (!parsed) continue;
    const refStorage = parsed.storageGB;
    const diff = Math.abs(refStorage - storageGB);
    if (!closest || diff < closest.storageDiff) {
      closest = { entry, storageDiff: diff, refStorage };
    }
  }
  if (!closest) return null;

  // Adjust each condition price by the storage difference.
  // If the listing has MORE storage than the reference → add value.
  // If LESS → subtract value (floor at 50% of ref to avoid negative).
  const storageDeltaGB = storageGB - closest.refStorage;
  const priceAdjustment = storageDeltaGB * STORAGE_PRICE_PER_GB;
  const adjust = (base: number) => Math.round(Math.max(base * 0.5, base + priceAdjustment));
  return {
    new: adjust(closest.entry.new),
    excellent: adjust(closest.entry.excellent),
    very_good: adjust(closest.entry.very_good),
    good: adjust(closest.entry.good),
    fair: closest.entry.fair ? adjust(closest.entry.fair) : undefined,
  };
}

export function computeLandedCost(
  priceCny: number,
  cnyToEurRate: number,
  config: AppConfig,
): LandedCostBreakdown {
  const exchangeFeeRate = config.forex.exchange_fee;
  // 1. Acquisition: CNY price → EUR, with exchange fee
  const acquisitionCostEur = priceCny * cnyToEurRate * (1 + exchangeFeeRate);
  // 2. Buying agent fees (CSS Buy / Superbuy / Wegobuy)
  const agentServiceFeeEur = acquisitionCostEur * config.logistics.agent_service_fee_rate;
  const inspectionFeeEur = config.logistics.inspection_fee_eur;
  const domesticShippingCnEur = config.logistics.domestic_shipping_cn_eur;
  const insuranceFeeEur = acquisitionCostEur * config.logistics.insurance_fee_rate;
  // 3. International shipping (air freight to EU)
  const internationalShippingEur = config.logistics.international_shipping_eur;
  // 4. Customs & taxes
  const customsClearanceEur = config.logistics.customs_clearance_fee_eur;
  const importDutyBase =
    acquisitionCostEur +
    agentServiceFeeEur +
    inspectionFeeEur +
    domesticShippingCnEur +
    insuranceFeeEur +
    internationalShippingEur;
  const importDutyEur = importDutyBase * config.logistics.import_duty_rate;
  // PT Import VAT (23%): assessed on (acquisition + agent fees + shipping + customs + duty)
  const vatBase = importDutyBase + customsClearanceEur + importDutyEur;
  const importVatEur = vatBase * config.tax.pt_vat_rate;
  // 5. Portugal domestic shipping (CTT)
  const domesticShippingEur = config.logistics.domestic_shipping_eur;
  // Grand total
  const totalLandedCostEur =
    acquisitionCostEur +
    agentServiceFeeEur +
    inspectionFeeEur +
    domesticShippingCnEur +
    insuranceFeeEur +
    internationalShippingEur +
    customsClearanceEur +
    importDutyEur +
    importVatEur +
    domesticShippingEur;

  return {
    priceCny,
    cnyToEurRate,
    exchangeFeeRate,
    acquisitionCostEur,
    agentServiceFeeEur,
    inspectionFeeEur,
    domesticShippingCnEur,
    insuranceFeeEur,
    internationalShippingEur,
    customsClearanceEur,
    importDutyEur,
    importVatEur,
    domesticShippingEur,
    totalLandedCostEur,
  };
}

function getPlatformFeeRate(
  platform: EuMarketComp["platform"],
  config: AppConfig,
): number {
  if (platform === "olx") return config.marketplace_fees.olx_fee_rate;
  if (platform === "vinted") return config.marketplace_fees.vinted_fee_rate;
  if (platform === "kuantokusta") return config.marketplace_fees.kuantokusta_fee_rate;
  if (platform === "amazon") return config.marketplace_fees.amazon_fee_rate;
  return config.marketplace_fees.default_resale_fee_rate;
}

/**
 * Median of EU comps determines expected local resale price.
 * Falls back to reference price for the normalized condition if no comps exist.
 */
export function computeProfit(
  priceCny: number,
  product: NormalizedProduct | null,
  euComps: EuMarketComp[],
  cnyToEurRate: number,
  config: AppConfig,
  refPricesOverride?: Record<string, RefPrice>,
): ProfitAnalysis {
  const landed = computeLandedCost(priceCny, cnyToEurRate, config);
  // Determine expected resale: median of EU comps (storage-aware), else reference price
  let expectedResaleEur = 0;
  let resaleSource = "none";

  if (euComps.length > 0) {
    // Filter out comps below €100 — these are accessories/cases/parts, not actual devices
    const realComps = euComps.filter((c) => c.priceEur >= 100);
    if (realComps.length > 0) {
      const listingStorage = product?.storageGB;
      let candidatePrices: number[] = [];

      if (listingStorage) {
        const compsWithStorage = realComps.map((c) => ({
          comp: c,
          storageGB: extractStorage(c.title)?.storageGB,
        }));
        const exactMatches = compsWithStorage.filter(
          (x) => x.storageGB === listingStorage,
        );

        if (exactMatches.length >= 2) {
          // 2 or more exact storage comps -> use exact matches directly
          candidatePrices = exactMatches.map((x) => x.comp.priceEur);
          resaleSource = `median of ${exactMatches.length} EU comps (${formatStorageGB(listingStorage)} exact match)`;
        } else {
          // Normalize all comps with storage adjustment relative to listing storage
          candidatePrices = compsWithStorage.map((x) => {
            if (x.storageGB && x.storageGB !== listingStorage) {
              const deltaGB = listingStorage - x.storageGB;
              const adj = deltaGB * STORAGE_PRICE_PER_GB;
              return Math.max(x.comp.priceEur * 0.5, x.comp.priceEur + adj);
            }
            return x.comp.priceEur;
          });
          resaleSource = `median of ${compsWithStorage.length} EU comps (storage-adjusted to ${formatStorageGB(listingStorage)})`;
        }
      } else {
        candidatePrices = realComps.map((c) => c.priceEur);
        resaleSource = `median of ${realComps.length} EU comps (filtered ${euComps.length - realComps.length} junk)`;
      }

      candidatePrices.sort((a, b) => a - b);
      const mid = Math.floor(candidatePrices.length / 2);
      expectedResaleEur =
        candidatePrices.length % 2 === 0
          ? (candidatePrices[mid - 1] + candidatePrices[mid]) / 2
          : candidatePrices[mid];
    } else {
      // All comps were junk — fall through to reference price
      euComps = [];
    }
  }

  if (expectedResaleEur === 0 && product) {
    const source = refPricesOverride ?? defaultRefPrices;
    // Use storage-aware lookup: finds the closest storage tier and adjusts proportionally
    const entry = lookupRefPrice(source, product.standardKey, product.storageGB, product.family);
    if (entry) {
      switch (product.condition) {
        case "new":
        case "open_box":
          expectedResaleEur = entry.new;
          break;
        case "excellent":
          expectedResaleEur = entry.excellent;
          break;
        case "very_good":
          expectedResaleEur = entry.very_good;
          break;
        case "good":
          expectedResaleEur = entry.good;
          break;
        case "fair":
          expectedResaleEur = entry.fair ?? Math.round(entry.good * 0.75);
          break;
        default:
          expectedResaleEur = entry.very_good;
      }
      resaleSource = `reference price (${product.standardKey})`;
    }
  }

  // Apply blended resale fee (weighted by platform of comps across all sources)
  let resaleFeeRate = config.marketplace_fees.default_resale_fee_rate;
  if (euComps.length > 0) {
    // Weight each comp by its platform's fee rate so the blended fee reflects
    // the mix of OLX (0%), Vinted (5%), KuantoKusta (0%), Amazon (8%) comps.
    const olxCount = euComps.filter((c) => c.platform === "olx").length;
    const vintedCount = euComps.filter((c) => c.platform === "vinted").length;
    const kkCount = euComps.filter((c) => c.platform === "kuantokusta").length;
    const amazonCount = euComps.filter((c) => c.platform === "amazon").length;
    const olxFee = config.marketplace_fees.olx_fee_rate;
    const vintedFee = config.marketplace_fees.vinted_fee_rate;
    const kkFee = config.marketplace_fees.kuantokusta_fee_rate;
    const amazonFee = config.marketplace_fees.amazon_fee_rate;
    resaleFeeRate =
      (olxFee * olxCount + vintedFee * vintedCount + kkFee * kkCount + amazonFee * amazonCount) / euComps.length;
  }
  const resaleFeeEur = expectedResaleEur * resaleFeeRate;
  const netResaleEur = expectedResaleEur - resaleFeeEur;
  const netProfitEur = netResaleEur - landed.totalLandedCostEur;
  const marginPct =
    landed.totalLandedCostEur > 0
      ? (netProfitEur / landed.totalLandedCostEur) * 100
      : 0;
  const meetsMinMargin = marginPct >= config.profitability.min_margin_pct * 100;
  const meetsMinProfit = netProfitEur >= config.profitability.min_net_profit_eur;
  const hidden = !meetsMinMargin || !meetsMinProfit;
  return {
    expectedResaleEur,
    resaleFeeEur,
    netResaleEur,
    landed,
    netProfitEur,
    marginPct,
    meetsMinMargin,
    meetsMinProfit,
    hidden,
    resaleSource,
  };
}