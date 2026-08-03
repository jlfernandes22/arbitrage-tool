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
 * 256→512 = +€64). This ensures a 512GB listing without an exact reference
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
  // 2. Find the closest storage tier for the same family
  if (!family || !storageGB) return null;
  // Build a list of all reference entries that share the same family prefix.
  // e.g., family "iPhone 16 Pro" matches "iPhone 16 Pro 128GB", "256GB", "512GB".
  const familyEntries = Object.entries(source).filter(([key]) =>
    key.startsWith(family + " "),
  );
  if (familyEntries.length === 0) return null;
  // Parse the storage from each matching key and find the closest one.
  let closest: { entry: RefPrice; storageDiff: number; refStorage: number } | null = null;
  for (const [key, entry] of familyEntries) {
    const storageMatch = key.match(/(\d+)\s*GB/);
    if (!storageMatch) continue;
    const refStorage = parseInt(storageMatch[1], 10);
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
  const adjust = (base: number) => Math.max(base * 0.5, base + priceAdjustment);
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
  //    Agent service fee: % of acquisition (covers their buying service)
  const agentServiceFeeEur = acquisitionCostEur * config.logistics.agent_service_fee_rate;
  //    Inspection/photo fee: flat per item (optional but recommended for used goods)
  const inspectionFeeEur = config.logistics.inspection_fee_eur;
  //    Domestic shipping in China: seller → agent warehouse
  const domesticShippingCnEur = config.logistics.domestic_shipping_cn_eur;
  //    Insurance: % of acquisition (covers loss/damage in transit)
  const insuranceFeeEur = acquisitionCostEur * config.logistics.insurance_fee_rate;
  // 3. International shipping (air freight to EU)
  const internationalShippingEur = config.logistics.international_shipping_eur;
  // 4. Customs & taxes
  const customsClearanceEur = config.logistics.customs_clearance_fee_eur;
  //    Import duty: 0% for phones/laptops, varies for other electronics
  const importDutyBase = acquisitionCostEur + agentServiceFeeEur + inspectionFeeEur + domesticShippingCnEur + insuranceFeeEur + internationalShippingEur;
  const importDutyEur = importDutyBase * config.logistics.import_duty_rate;
  //    PT Import VAT (23%): assessed on (acquisition + agent fees + shipping + customs + duty)
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

function pickResaleFeeRate(platform: string, config: AppConfig): number {
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
  // Determine expected resale: median of EU comps (by condition-agnostic set), else reference price
  let expectedResaleEur = 0;
  let resaleSource = "none";
  if (euComps.length > 0) {
    // Filter out comps below €100 — these are accessories/cases/parts, not
    // actual phones. They drag the median down to absurd levels.
    const realComps = euComps.filter((c) => c.priceEur >= 100);
    if (realComps.length > 0) {
      const prices = realComps.map((c) => c.priceEur).sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      expectedResaleEur =
        prices.length % 2 === 0
          ? (prices[mid - 1] + prices[mid]) / 2
          : prices[mid];
      resaleSource = `median of ${realComps.length} EU comps (filtered ${euComps.length - realComps.length} junk)`;
    } else {
      // All comps were junk — fall through to reference price
      euComps = [];
    }
  }
  if (expectedResaleEur === 0 && product) {
    const source = refPricesOverride ?? defaultRefPrices;
    // Use the storage-aware lookup: finds the closest storage tier and
    // adjusts the price proportionally when the exact key isn't in the table.
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
          expectedResaleEur = entry.fair ?? entry.good * 0.75;
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