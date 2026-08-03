// engine/scam-detector.ts
// Seller-trust-based scam & risk engine.
//
// RISK MODEL (seller-rating-centric, per user request):
//   LAYER 1: Critical blacklist → auto-drop (risk=100) — non-negotiable safety
//   LAYER 2: Seller trust score → 0-60 (DOMINANT factor)
//            Based on: positive feedback rate (好评率), verified transaction
//            count, and real-name verification. This is the PRIMARY signal.
//   LAYER 3: Yellow modifiers → +10 each (capped at 20) — reduced weight
//   LAYER 4: Asset quality → +5-10 (minor signal)
//
// The seller's track record is the most reliable indicator of whether a
// listing is legitimate. A seller with 500+ verified transactions and 98%
// positive feedback is extremely unlikely to be a scammer, even if the price
// is low. Conversely, an unverified seller with <10 transactions is high-risk
// regardless of how good the listing looks.
import type { GoofishListing, NormalizedProduct, ScamReport } from "./types";
import type { AppConfig } from "@/lib/config";
import referencePrices from "@/data/reference_prices.json";
interface RefPrice {
  new: number;
  excellent: number;
  very_good: number;
  good: number;
  fair?: number;
}
const defaultRefPrices = referencePrices as Record<string, RefPrice>;
// LAYER 1 — Critical Blacklist (Auto Drop)
const CRITICAL_BLACKLIST = [
  { token: "组装", label: "assembled" },
  { token: "山寨", label: "knock-off" },
  { token: "高仿", label: "replica" },
  { token: "翻新", label: "refurbished" },
  { token: "ID锁", label: "iCloud locked" },
  { token: "坏无拆", label: "broken uninspected" },
  { token: "进水", label: "water damaged" },
  { token: "扩容", label: "storage expanded (fake)" },
  { token: "黑解", label: "blacklisted unlock" },
  { token: "监管锁", label: "MDM supervised lock" },
];
// Tokens that need regex context: "有锁" (carrier locked) must NOT match
// "有锁屏密码" (has a lockscreen password — completely normal). Only match
// when 锁 is not followed by 屏.
const CRITICAL_BLACKLIST_REGEX = [
  { pattern: /有锁(?!屏)/, label: "carrier locked" },
  { pattern: /有网络锁|有运营商锁|有激活锁/, label: "carrier locked" },
];
// LAYER 3 — Yellow Modifiers (+10 each, capped at 20 — reduced from 20/40)
const YELLOW_MODIFIERS = [
  { token: "换过屏幕", label: "replaced screen" },
  { token: "换过电池", label: "replaced battery" },
  { token: "换屏", label: "replaced screen" },
  { token: "换电池", label: "replaced battery" },
  { token: "无盒", label: "no original retail box" },
  { token: "无原盒", label: "no original retail box" },
  { token: "维修过", label: "repaired" },
  { token: "拆修", label: "opened/repaired" },
];
function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ── Chinese Negation-Aware Matching ──────────────────────────────────
// Chinese sellers frequently write "无进水" (no water damage), "无拆修"
// (no disassembly), etc. These phrases CONTAIN the blacklist token as a
// substring, so a naive text.includes("进水") would false-positive on
// "无进水". The negation-aware matcher checks the characters immediately
// before the token for a negation prefix.
//
// Negation prefixes that negate the following token:
//   无 (wú)     — no / without / none
//   没有 (méi)  — not have
//   不 (bù)     — not
//   非 (fēi)    — non- / not
//   未 (wèi)    — not yet
//   没 (méi)    — not have (short form)
//
// NOTE: Tokens like "无盒" (no box) in YELLOW_MODIFIERS are NOT affected —
// the "无" is part of the token itself, and the matcher only checks what
// comes BEFORE the full token. So "无盒" still correctly matches as a
// yellow modifier (seller states there's no original box).
const NEGATION_PREFIXES = ["没有", "无", "不", "非", "未", "没"];

/**
 * Check if a token appears in the text WITHOUT being negated by a preceding
 * negation prefix. Returns true only if at least one occurrence is NOT negated.
 *
 * Example: includesNonNegated("整机无进水", "进水") → false
 *          includesNonNegated("进水修好", "进水")   → true
 *          includesNonNegated("无进水，但曾进水", "进水") → true (2nd occurrence)
 */
export function includesNonNegated(text: string, token: string): boolean {
  let searchStart = 0;
  while (true) {
    const idx = text.indexOf(token, searchStart);
    if (idx === -1) return false; // token not found at all
    // Check up to 2 characters before the token for a negation prefix
    const before = text.slice(Math.max(0, idx - 2), idx);
    const isNegated = NEGATION_PREFIXES.some((neg) => before.endsWith(neg));
    if (!isNegated) return true; // found a non-negated occurrence
    // This occurrence is negated — keep searching for another
    searchStart = idx + token.length;
  }
}

/**
 * Find all negated occurrences of a token (preceded by a negation prefix).
 * Used to track positive declarations like "无进水" (no water damage) which
 * are positive trust signals — the seller explicitly denies the problem.
 *
 * Returns the full negated phrases (prefix + token), deduplicated.
 */
function findNegatedOccurrences(text: string, token: string): string[] {
  const result: string[] = [];
  let searchStart = 0;
  while (true) {
    const idx = text.indexOf(token, searchStart);
    if (idx === -1) break;
    const before = text.slice(Math.max(0, idx - 2), idx);
    const negPrefix = NEGATION_PREFIXES.find((neg) => before.endsWith(neg));
    if (negPrefix) {
      const fullPhrase = negPrefix + token;
      if (!result.includes(fullPhrase)) {
        result.push(fullPhrase);
      }
    }
    searchStart = idx + token.length;
  }
  return result;
}
/**
 * Compute a seller trust score (0-60) from three signals:
 *   1. Positive feedback rate (好评率) — 0-40 points
 *   2. Verified transaction count — 0-12 points (more history = more trust)
 *   3. Real-name verification — 0-8 points (identity-verified sellers are safer)
 *
 * This is the DOMINANT risk factor. A high-trust seller can drive the risk
 * score to near-zero; an unverified seller with no history can add up to 60.
 */
function computeSellerTrustRisk(listing: GoofishListing): {
  risk: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let risk = 0;
  const hasRating = listing.sellerRating !== undefined && listing.sellerRating > 0;
  const txns = listing.sellerVerifiedTransactions;
  const verified = listing.sellerVerified;
  // ── Signal 1: Positive feedback rate (好评率) — 0-40 pts ──
  if (hasRating) {
    const rating = listing.sellerRating!;
    if (rating >= 98) {
      // Top-tier seller — zero risk from rating
      reasons.push(`Seller feedback ${rating}% — excellent (+0)`);
    } else if (rating >= 95) {
      risk += 5;
      reasons.push(`Seller feedback ${rating}% — good (+5)`);
    } else if (rating >= 90) {
      risk += 12;
      reasons.push(`Seller feedback ${rating}% — decent (+12)`);
    } else if (rating >= 85) {
      risk += 20;
      reasons.push(`Seller feedback ${rating}% — moderate (+20)`);
    } else if (rating >= 70) {
      risk += 30;
      reasons.push(`Seller feedback ${rating}% — low (+30)`);
    } else {
      risk += 40;
      reasons.push(`Seller feedback ${rating}% — very low (+40)`);
    }
  } else {
    // No rating available — unknown seller, significant risk
    risk += 25;
    reasons.push("Seller feedback not available — unknown seller (+25)");
  }
  // ── Signal 2: Verified transaction count — 0-12 pts ──
  // More past transactions = more established = more trustworthy.
  if (txns !== undefined && txns > 0) {
    if (txns >= 200) {
      reasons.push(`${txns} verified transactions — high volume (+0)`);
    } else if (txns >= 50) {
      reasons.push(`${txns} verified transactions — established (+0)`);
    } else if (txns >= 10) {
      risk += 4;
      reasons.push(`${txns} verified transactions — moderate (+4)`);
    } else {
      risk += 10;
      reasons.push(`${txns} verified transactions — few (+10)`);
    }
  } else {
    risk += 8;
    reasons.push("0 verified transactions — new/unproven seller (+8)");
  }
  // ── Signal 3: Real-name verification — 0-8 pts ──
  if (verified) {
    reasons.push("Real-name verified (+0)");
  } else {
    risk += 8;
    reasons.push("Not real-name verified (+8)");
  }
  return { risk: Math.min(60, risk), reasons };
}
export function detectScam(
  listing: GoofishListing,
  config: AppConfig,
  refPricesOverride?: Record<string, RefPrice>,
): ScamReport {
  // Use DB-backed reference prices when provided, else fall back to static JSON.
  // This ensures admin edits to the reference price matrix also affect scam
  // detection (previously the override was accepted but never used).
  const refPrices = refPricesOverride ?? defaultRefPrices;
  const reasons: string[] = [];
  const matchedBlacklist: string[] = [];
  const matchedYellow: string[] = [];
  let risk = 0;
  let dropped = false;
  const text = `${listing.title} ${listing.description}`;
  // LAYER 1 — Critical Blacklist (Auto Drop) — always non-negotiable
  // Uses negation-aware matching: "无进水" (no water damage) does NOT trigger
  // the "进水" (water damaged) blacklist token. Only non-negated occurrences
  // count as a real blacklist hit.
  const positiveDeclarations: string[] = [];
  for (const item of CRITICAL_BLACKLIST) {
    if (includesNonNegated(text, item.token)) {
      matchedBlacklist.push(`${item.token} (${item.label})`);
      dropped = true;
      risk = 100;
    } else {
      // Token not found non-negated — check if it appears negated (positive signal)
      const negated = findNegatedOccurrences(text, item.token);
      for (const phrase of negated) {
        positiveDeclarations.push(`${phrase} (no ${item.label})`);
      }
    }
  }
  // Regex blacklist (context-sensitive tokens like 有锁 vs 有锁屏密码).
  for (const item of CRITICAL_BLACKLIST_REGEX) {
    if (item.pattern.test(text)) {
      matchedBlacklist.push(`有锁 (${item.label})`);
      dropped = true;
      risk = 100;
    }
  }
  if (dropped) {
    reasons.push(
      `Critical blacklist tokens detected: ${matchedBlacklist.join(", ")}. Listing auto-dropped.`,
    );
    return {
      riskScore: 100,
      dropped: true,
      reasons,
      matchedBlacklistTokens: matchedBlacklist,
      matchedYellowTokens: [],
    };
  }
  // Track positive declarations (seller explicitly denies issues)
  // e.g. "无进水" (no water damage), "无拆修" (never opened) — these are
  // trust signals. We log them as reasons but don't reduce risk (the seller
  // trust score is the dominant factor; declarations are informational).
  if (positiveDeclarations.length > 0) {
    reasons.push(
      `Positive declarations: ${positiveDeclarations.join(", ")} (+0)`,
    );
  }
  // LAYER 1.5 — Lock Status (from normalized product)
  // A carrier/iCloud/MDM-locked phone is worthless for Portugal resale.
  // iCloud + MDM locks are auto-dropped (bricked devices). Carrier-locked
  // adds heavy risk but isn't auto-dropped (some can be unlocked).
  const lockStatus = listing.normalized?.lockStatus;
  if (lockStatus === "icloud_locked") {
    risk = 100;
    reasons.push("iCloud/Activation locked — device is bricked, cannot be activated without original owner's Apple ID. Auto-dropped.");
    return {
      riskScore: 100,
      dropped: true,
      reasons,
      matchedBlacklistTokens: ["iCloud/Activation lock"],
      matchedYellowTokens: [],
    };
  }
  if (lockStatus === "mdm_locked") {
    risk = 100;
    reasons.push("MDM supervised lock — device is enterprise-managed, cannot be freely activated. Auto-dropped.");
    return {
      riskScore: 100,
      dropped: true,
      reasons,
      matchedBlacklistTokens: ["MDM supervised lock"],
      matchedYellowTokens: [],
    };
  }
  if (lockStatus === "carrier_locked") {
    risk += 50;
    reasons.push("Carrier-locked — cannot use a Portuguese SIM. Worthless for PT resale unless unlockable (+50 risk)");
  } else if (lockStatus === "unlocked") {
    reasons.push("Device is unlocked — safe for Portuguese SIM (+0 risk)");
  }
  // LAYER 2 — Seller Trust (DOMINANT: 0-60 pts)
  // This is the primary risk signal per the user's request.
  const sellerTrust = computeSellerTrustRisk(listing);
  risk += sellerTrust.risk;
  reasons.push(...sellerTrust.reasons);
  // LAYER 3 — Yellow Modifiers (reduced to +10 each, cap 20 — minor signal)
  // Uses negation-aware matching: "无拆修" (no disassembly) does NOT trigger
  // the "拆修" yellow modifier — the seller is explicitly stating no repairs.
  for (const item of YELLOW_MODIFIERS) {
    if (includesNonNegated(text, item.token)) {
      matchedYellow.push(`${item.token} (${item.label})`);
    } else {
      // Token not found non-negated — check if it appears negated (positive signal)
      const negated = findNegatedOccurrences(text, item.token);
      for (const phrase of negated) {
        positiveDeclarations.push(`${phrase} (no ${item.label})`);
      }
    }
  }
  if (matchedYellow.length > 0) {
    const yellowRisk = Math.min(20, matchedYellow.length * 10);
    risk += yellowRisk;
    reasons.push(
      `Yellow modifier tokens: ${matchedYellow.join(", ")} (+${yellowRisk})`,
    );
  }
  // LAYER 4 — Asset Quality (minor signal: +5-10)
  const effectiveImageCount = listing.imageCount ?? listing.imageUrls.length;
  if (effectiveImageCount < 2) {
    risk += 8;
    reasons.push(`Image count ${effectiveImageCount} < 2 (+8)`);
  }
  if (listing.description.length < 20) {
    risk += 5;
    reasons.push(
      `Description ${listing.description.length} chars < 20 (+5)`,
    );
  }
  return {
    riskScore: clampScore(risk),
    dropped: false,
    reasons,
    matchedBlacklistTokens: matchedBlacklist,
    matchedYellowTokens: matchedYellow,
  };
}
export function shouldHideByScam(
  report: ScamReport,
  config: AppConfig,
): { hidden: boolean; reason?: string } {
  if (report.dropped) {
    return { hidden: true, reason: "Critical blacklist — auto dropped" };
  }
  if (report.riskScore > config.scam_filter.hide_threshold) {
    return {
      hidden: true,
      reason: `Risk score ${report.riskScore} > threshold ${config.scam_filter.hide_threshold}`,
    };
  }
  return { hidden: false };
}
