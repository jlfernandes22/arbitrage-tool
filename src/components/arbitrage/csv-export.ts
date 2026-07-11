// Client-side CSV export utility for arbitrage results.
import type { EvaluatedListing } from "./types";
import { CONDITION_LABELS, eurPrecise, cny } from "./types";
function csvEscape(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
export function listingsToCsv(listings: EvaluatedListing[]): string {
  const headers = [
    "Product",
    "Condition",
    "Price_CNY",
    "Acquisition_EUR",
    "Agent_Fee_EUR",
    "Inspection_EUR",
    "CN_Domestic_EUR",
    "Insurance_EUR",
    "Intl_Shipping_EUR",
    "Customs_Clearance_EUR",
    "Import_Duty_EUR",
    "Import_VAT_EUR",
    "PT_Domestic_EUR",
    "Total_Landed_EUR",
    "EU_Baseline_EUR",
    "Resale_Fee_EUR",
    "Net_Resale_EUR",
    "Net_Profit_EUR",
    "Margin_Pct",
    "Risk_Score",
    "Dropped",
    "Hidden",
    "Hidden_Reason",
    "Seller_Location",
    "Seller_Verified",
    "Seller_Transactions",
    "Wants_Count",
    "Image_Count",
    "EU_Comps_Count",
    "Goofish_Title",
  ];
  const rows = listings.map((l) => {
    const n = l.listing.normalized;
    const p = l.profit;
    const lc = p.landed;
    return [
      n?.standardKey ?? l.listing.title,
      n ? CONDITION_LABELS[n.condition] : "Used",
      l.listing.priceCny,
      lc.acquisitionCostEur.toFixed(2),
      lc.agentServiceFeeEur.toFixed(2),
      lc.inspectionFeeEur.toFixed(2),
      lc.domesticShippingCnEur.toFixed(2),
      lc.insuranceFeeEur.toFixed(2),
      lc.internationalShippingEur.toFixed(2),
      lc.customsClearanceEur.toFixed(2),
      lc.importDutyEur.toFixed(2),
      lc.importVatEur.toFixed(2),
      lc.domesticShippingEur.toFixed(2),
      lc.totalLandedCostEur.toFixed(2),
      p.expectedResaleEur.toFixed(2),
      p.resaleFeeEur.toFixed(2),
      p.netResaleEur.toFixed(2),
      p.netProfitEur.toFixed(2),
      p.marginPct.toFixed(1),
      l.scam.riskScore,
      l.scam.dropped ? "YES" : "NO",
      l.hidden ? "YES" : "NO",
      l.hiddenReason ?? "",
      l.listing.sellerLocation,
      l.listing.sellerVerified ? "YES" : "NO",
      l.listing.sellerVerifiedTransactions,
      l.listing.wantsCount,
      l.listing.imageUrls.length,
      l.euComps.length,
      l.listing.title,
    ].map(csvEscape).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
export function exportListingsCsv(listings: EvaluatedListing[], query: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const safe = query.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 40);
  downloadCsv(`arbitrage-${safe}-${date}.csv`, listingsToCsv(listings));
}

// ─── JSON EXPORT ────────────────────────────────────────────────────
// Structured JSON export for integration with other tools (spreadsheets,
// BI dashboards, downstream APIs). Includes the full evaluated listing
// shape: listing metadata, normalized product, scam report, profit
// analysis with landed cost breakdown, and EU comps.
export function listingsToJson(listings: EvaluatedListing[], query: string): string {
  const payload = {
    meta: {
      query,
      exportedAt: new Date().toISOString(),
      totalListings: listings.length,
      viableListings: listings.filter((l) => !l.hidden).length,
      tool: "Arbitrage Intelligence Engine",
      version: "1.0",
    },
    listings: listings.map((l) => {
      const n = l.listing.normalized;
      return {
        id: l.listing.id,
        source: l.listing.source,
        href: l.listing.href ?? null,
        title: l.listing.title,
        description: l.listing.description,
        imageUrls: l.listing.imageUrls,
        seller: {
          location: l.listing.sellerLocation,
          verified: l.listing.sellerVerified,
          verifiedTransactions: l.listing.sellerVerifiedTransactions,
        },
        wantsCount: l.listing.wantsCount,
        normalized: n
          ? {
              standardKey: n.standardKey,
              category: n.category,
              family: n.family ?? null,
              model: n.model ?? null,
              storageGB: n.storageGB ?? null,
              color: n.color ?? null,
              condition: n.condition,
              conditionRaw: n.conditionRaw ?? null,
            }
          : null,
        scam: {
          riskScore: l.scam.riskScore,
          dropped: l.scam.dropped,
          reasons: l.scam.reasons,
          matchedBlacklistTokens: l.scam.matchedBlacklistTokens,
          matchedYellowTokens: l.scam.matchedYellowTokens,
        },
        profit: {
          expectedResaleEur: l.profit.expectedResaleEur,
          resaleFeeEur: l.profit.resaleFeeEur,
          netResaleEur: l.profit.netResaleEur,
          netProfitEur: l.profit.netProfitEur,
          marginPct: l.profit.marginPct,
          meetsMinMargin: l.profit.meetsMinMargin,
          meetsMinProfit: l.profit.meetsMinProfit,
          resaleSource: l.profit.resaleSource ?? null,
          landed: {
            priceCny: l.profit.landed.priceCny,
            cnyToEurRate: l.profit.landed.cnyToEurRate,
            exchangeFeeRate: l.profit.landed.exchangeFeeRate,
            acquisitionCostEur: l.profit.landed.acquisitionCostEur,
            agentServiceFeeEur: l.profit.landed.agentServiceFeeEur,
            inspectionFeeEur: l.profit.landed.inspectionFeeEur,
            domesticShippingCnEur: l.profit.landed.domesticShippingCnEur,
            insuranceFeeEur: l.profit.landed.insuranceFeeEur,
            internationalShippingEur: l.profit.landed.internationalShippingEur,
            customsClearanceEur: l.profit.landed.customsClearanceEur,
            importDutyEur: l.profit.landed.importDutyEur,
            importVatEur: l.profit.landed.importVatEur,
            domesticShippingEur: l.profit.landed.domesticShippingEur,
            totalLandedCostEur: l.profit.landed.totalLandedCostEur,
          },
        },
        euComps: l.euComps.map((c) => ({
          platform: c.platform,
          title: c.title,
          priceEur: c.priceEur,
          condition: c.condition,
          location: c.location ?? null,
        })),
        hidden: l.hidden,
        hiddenReason: l.hiddenReason ?? null,
      };
    }),
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportListingsJson(listings: EvaluatedListing[], query: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const safe = query.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 40);
  downloadJson(`arbitrage-${safe}-${date}.json`, listingsToJson(listings, query));
}
// re-export for convenience
export { eurPrecise, cny };