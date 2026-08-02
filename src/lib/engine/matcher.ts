// engine/matcher.ts
// Cross-Border Matching Engine.
// Takes a normalized product and runs a clean string lookup routine against
// European target endpoints (OLX.pt, Vinted.pt). Also normalizes condition
// from Chinese market tokens to European labels.
import type { Condition, EuMarketComp, NormalizedProduct } from "./types";
import { conditionLabel } from "./normalizer";
// Condition normalization dictionary (CN -> EU)
export const CONDITION_NORMALIZATION: Record<string, Condition> = {
  全新: "new",
  "全新未拆封": "new",
  仅拆封: "open_box",
  "仅拆": "open_box",
  "拆封未用": "open_box",
  "99新": "excellent",
  "99成新": "excellent",
  "95新": "very_good",
  "95成新": "very_good",
  "9成新": "good",
  "90新": "good",
  "8成新": "good",
  "80新": "good",
  战损版: "fair",
  伊拉克: "fair",
  垃圾: "fair",
};
export function normalizeConditionFromToken(token: string): Condition {
  return CONDITION_NORMALIZATION[token] ?? "unknown";
}
/**
 * Build a clean European search query from a normalized product.
 * Produces the string used to query OLX / Vinted / KuantoKusta / Amazon.
 *
 * IMPORTANT: When `storageGB` is undefined, do NOT append a stray "GB" —
 * the previous implementation produced strings like "iPhone 15 GB" which
 * then became the literal search query on every EU marketplace, returning
 * fewer or irrelevant results.
 */
export function buildEuQuery(product: NormalizedProduct): string {
  if (product.category === "ps5") {
    return `PlayStation 5 ${product.formFactor ?? ""} ${product.driveConfig ?? ""}`.replace(/\s+/g, " ").trim();
  }
  if (product.category === "macbook") {
    const parts = [product.family];
    if (product.displayInch) parts.push(`${product.displayInch}"`);
    if (product.storageGB) parts.push(`${product.storageGB}GB`);
    return parts.join(" ");
  }
  // ipad, iphone, samsung, xiaomi, gaming, etc. — only append storage if known
  const parts = [product.family];
  if (product.storageGB) parts.push(`${product.storageGB}GB`);
  return parts.join(" ").trim();
}
/**
 * Detect the model tier of a family/title string using word-boundary
 * matching (avoids substring false hits like "Maxi" or "Surplus").
 * Tiers: base | plus | pro | pro_max | max | ultra
 */
export function detectModelTier(
  text: string,
): "base" | "plus" | "pro" | "pro_max" | "max" | "ultra" {
  const t = text.toLowerCase();
  const hasPro = /\bpro\b/.test(t);
  const hasMax = /\bmax\b/.test(t);
  const hasPlus = /\bplus\b/.test(t);
  const hasUltra = /\bultra\b/.test(t);
  if (hasUltra) return "ultra";
  if (hasPro && hasMax) return "pro_max";
  if (hasMax) return "max";
  if (hasPlus) return "plus";
  if (hasPro) return "pro";
  return "base";
}
/**
 * Score how well an EU comp matches a normalized product (0-100).
 * Used to filter out irrelevant comps and rank relevance.
 */
export function scoreEuComp(comp: EuMarketComp, product: NormalizedProduct): number {
  const q = buildEuQuery(product).toLowerCase();
  const title = comp.title.toLowerCase();
  let score = 0;
  // Token overlap
  const queryTokens = q.split(/\s+/).filter((t) => t.length > 1);
  let matched = 0;
  for (const t of queryTokens) {
    if (title.includes(t)) matched++;
  }
  if (queryTokens.length > 0) {
    score += (matched / queryTokens.length) * 60;
  }
  // STRICT FAMILY TIER BOUNDARY (Phase 10).
  // Cross-tier matches (Pro vs Pro Max, base vs Plus, Pro vs base, etc.)
  // are hard-rejected (score 0) in BOTH directions so they can never
  // pollute the resale median. The previous soft -50 penalty still let
  // high-token-overlap titles (e.g. "iPhone 15 Pro Max 256GB" vs an
  // "iPhone 15 Pro" product) slip past permissive score thresholds.
  if (product.family) {
    const productTier = detectModelTier(product.family);
    const titleTier = detectModelTier(comp.title);
    if (productTier !== titleTier) {
      return 0; // mismatched model tier — reject outright
    }
    if (title.includes(product.family.toLowerCase())) {
      score += 25;
    }
  }
  // Storage match (with and without space before "gb")
  if (product.storageGB && (title.includes(`${product.storageGB}gb`) || title.includes(`${product.storageGB} gb`))) {
    score += 15;
  }
  // Penalty for clearly different storage
  if (product.storageGB) {
    const otherStorage = title.match(/(\d{2,4})\s*gb/i);
    if (otherStorage && parseInt(otherStorage[1], 10) !== product.storageGB) {
      score -= 20;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
export function filterRelevantComps(
  comps: EuMarketComp[],
  product: NormalizedProduct,
  minScore = 40,
): EuMarketComp[] {
  return comps
    .map((c) => ({ comp: c, score: scoreEuComp(c, product) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.comp);
}
export function euConditionLabel(condition: Condition): string {
  return conditionLabel(condition);
}