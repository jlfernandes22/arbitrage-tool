// Core domain types shared across engines, scrapers, and API layer.
import type { AppConfig } from "@/lib/config";
export type Category = "iphone" | "macbook" | "ipad" | "ps5" | "samsung" | "applewatch" | "dji" | "xiaomi" | "gaming";
export type Condition =
  | "new"
  | "open_box"
  | "excellent"
  | "very_good"
  | "good"
  | "fair"
  | "unknown";
export interface NormalizedProduct {
  standardKey: string; // e.g. "iPhone 13 128GB"
  category: Category;
  family?: string; // e.g. "iPhone 13", "MacBook Air M2", "iPad Pro 11"
  model?: string;
  storageGB?: number;
  color?: string;
  batteryHealth?: number;
  chip?: string; // Apple Silicon / Intel
  ramGB?: number;
  displayInch?: number;
  releaseYear?: number;
  connectivity?: "wifi" | "cellular";
  formFactor?: string; // PS5: Slim | Standard
  driveConfig?: string; // PS5: Digital | Disc
  // Region version: which market the device was sold for.
  regionVersion?: "china" | "international" | "us" | "japan" | "korea" | "unknown";
  // Lock status: whether the device is free to use on any carrier / has no
  // activation locks. This is CRITICAL for arbitrage — a locked Chinese-market
  // iPhone cannot be used in Portugal and is effectively worthless there.
  lockStatus?: "unlocked" | "carrier_locked" | "icloud_locked" | "mdm_locked" | "unknown";
  condition: Condition;
  conditionRaw?: string; // original Chinese condition token
}
export interface GoofishListing {
  id: string;
  title: string;
  priceCny: number;
  description: string;
  imageUrls: string[];
  sellerLocation: string;
  wantsCount: number;
  sellerVerified: boolean;
  sellerVerifiedTransactions: number;
  rawText: string;
  source: "goofish";
  normalized: NormalizedProduct | null;
  href?: string; // direct link to the Goofish item page
  sellerRating?: number; // seller positive feedback rate (0-100), from listing page
  imageCount?: number; // actual image count from listing page (not search page thumbnail)
  conditionFlags?: string[]; // detected condition keywords (维修/换屏/无盒 etc.)
}
export interface EuMarketComp {
  id: string;
  // platform: which marketplace the comp came from.
  // "olx" | "vinted" → second-hand / used listings (peer-to-peer resale).
  // "kuantokusta" | "amazon" → NEW retail listings (price comparison / store).
  platform: "olx" | "vinted" | "kuantokusta" | "amazon";
  title: string;
  priceEur: number;
  condition: Condition;
  // url: direct link to the marketplace listing (not a search URL).
  // Populated by the scrapers when the listing link is available.
  url?: string;
  location?: string;
  vendorType?: string;
  negotiable?: boolean;
  viewCount?: number;
  brand?: string;
  sellerStars?: number;
  bundleDiscount?: number;
  // isRetail: true for new-condition retail sources (KuantoKusta, Amazon).
  // Used by the UI to group comps into "New (retail)" vs "Used (second-hand)"
  // buckets and to compare new vs used pricing. OLX/Vinted comps leave this
  // undefined (treated as used).
  isRetail?: boolean;
}
export interface ScamReport {
  riskScore: number; // 0-100
  dropped: boolean; // hard blacklist drop
  reasons: string[];
  matchedBlacklistTokens: string[];
  matchedYellowTokens: string[];
}
export interface LandedCostBreakdown {
  priceCny: number;
  cnyToEurRate: number;
  exchangeFeeRate: number;
  acquisitionCostEur: number; // price_cny * rate * (1 + exchange_fee)
  // ── Buying agent fees (CSS Buy / Superbuy / Wegobuy) ──
  agentServiceFeeEur: number; // agent service fee (% of acquisition)
  inspectionFeeEur: number; // photo/inspection fee (flat per item)
  domesticShippingCnEur: number; // seller → agent warehouse shipping
  insuranceFeeEur: number; // shipping insurance (% of acquisition)
  // ── International shipping ──
  internationalShippingEur: number; // air freight to EU (by weight)
  // ── Customs & taxes ──
  customsClearanceEur: number; // broker fee
  importDutyEur: number; // import duty (% depends on category)
  importVatEur: number; // PT VAT 23% on (acq + agent fees + shipping + duty)
  // ── Portugal domestic ──
  domesticShippingEur: number; // CTT / local courier
  totalLandedCostEur: number; // grand total
}
export interface ProfitAnalysis {
  expectedResaleEur: number; // median of EU comps
  resaleFeeEur: number;
  netResaleEur: number; // after fees
  landed: LandedCostBreakdown;
  netProfitEur: number;
  marginPct: number;
  meetsMinMargin: boolean;
  meetsMinProfit: boolean;
  hidden: boolean; // hidden if margin < min or profit < min
  resaleSource?: string;
}
export interface EvaluatedListing {
  listing: GoofishListing;
  scam: ScamReport;
  profit: ProfitAnalysis;
  euComps: EuMarketComp[];
  hidden: boolean; // hidden if scam > threshold OR profit filters fail
  hiddenReason?: string;
}
export interface TaskSummary {
  total: number;
  shown: number;
  hiddenScam: number;
  hiddenProfit: number;
  avgMarginPct: number;
  avgRiskScore: number;
  bestProfitEur: number;
  bestMarginPct: number;
}
export interface TaskResult {
  taskId: string;
  query: string;
  category: Category;
  status: string;
  listings: EvaluatedListing[];
  summary: TaskSummary;
  warnings: string[];
  degraded: boolean; // true if scrapers fell back to mock/manual mode
  createdAt: string;
  finishedAt?: string;
}
export type TaskStatus =
  | "pending"
  | "scraping_goofish"
  | "matching_eu"
  | "calculating"
  | "done"
  | "error"
  | "paused"
  | "cancelled";
export type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS";
export interface LogEntry {
  ts: number; // epoch ms
  level: LogLevel;
  msg: string;
}
export interface TaskState {
  id: string;
  query: string;
  category: Category;
  status: TaskStatus;
  progress: number; // 0-100
  step: string;
  error?: string;
  manualHtml?: string;
  warnings: string[];
  degraded: boolean;
  startedAt: number;
  finishedAt?: number;
  result?: TaskResult;
  configOverrides?: Partial<AppConfig>;
  logs: LogEntry[]; // recent execution logs for the terminal console
  cancelRequested?: boolean; // set by POST /api/tasks/[id]/cancel — orchestrator polls this
}
// Re-export config type for convenience
export type { AppConfig } from "@/lib/config";