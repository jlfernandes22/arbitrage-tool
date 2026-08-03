// lib/engine/relevance.ts
// Generation-aware title relevance matching for EU marketplace listings.
//
// PROBLEM: searching "iPhone 17" on Amazon.es / OLX / Vinted / KuantoKusta
// also returns iPhone 13/14/15/16 listings. Simple token overlap can't tell
// generations apart ("iphone" appears in every title). 
//
// SOLUTION: extract a GENERATION MARKER from the search query (e.g. "17" for
// "iPhone 17", "m4" for "MacBook Pro M4", "s25" for "Galaxy S25") and reject
// titles that carry a DIFFERENT marker of the same product family — while
// staying conservative so legitimate listings are never lost:
//   - a title with the exact query generation is ALWAYS accepted,
//   - a title with a different generation of the same family is REJECTED,
//   - a title that explicitly names a different product family (same or
//     different brand, e.g. "MacBook" or "Galaxy" for an iPhone query) is
//     REJECTED,
//   - a title with no generation info at all must still share a meaningful
//     token with the query (otherwise a "256GB memory card" would pass).

export interface RelevanceMarker {
  family: string;
  brand: string;
  value: string;
}

interface FamilyPattern {
  family: string;
  brand: string;
  // One capture group = the generation marker. When the pattern has no
  // capture group, `staticValue` is used instead.
  pattern: RegExp;
  staticValue?: string;
  // When true the pattern is only consulted on TITLES (conflict detection),
  // never on the QUERY. Used for families where the base model has no
  // number (e.g. "Nintendo Switch" → gen 1, "Switch 2" → gen 2).
  titleOnly?: boolean;
}

const FAMILY_PATTERNS: FamilyPattern[] = [
  // ── Apple ──
  // The e/s suffixes are MODEL markers ("iPhone 16e" ≠ "iPhone 16",
  // "iPhone 5s" ≠ "iPhone 5"), so they're kept in the marker value;
  // tier words (plus/mini/pro/max/air) are NOT (a "15 Pro" is still a 15).
  { family: "iphone", brand: "apple", pattern: /\biphone\s*(\d{1,2}[es]?)(?:plus|mini|pro|max|air)?\b/i },
  // Chip patterns allow an optional screen-size spec between the model word
  // and the chip ("MacBook Pro 14-inch M4", "iPad Pro 11-inch M2").
  { family: "ipad", brand: "apple", pattern: /\bipad\s*(?:pro|air|mini)?\s*(?:\d{1,2}(?:\.\d)?-?\s*(?:in|inch|")\s*)?m([1-9])\b/i },
  { family: "ipad", brand: "apple", pattern: /\bipad\s*(?:pro|air|mini)?\s*(\d{1,2})\b(?!\s*-?\s*(?:in|inch))/i },
  { family: "macbook", brand: "apple", pattern: /\bmacbook\s*(?:pro|air)?\s*(?:\d{1,2}(?:\.\d)?-?\s*(?:in|inch|")\s*)?m([1-9])\b/i },
  { family: "watch", brand: "apple", pattern: /\bapple\s+watch\s*(?:series\s*)?(\d{1,2})\b/i },
  { family: "watch", brand: "apple", pattern: /\bapple\s+watch\s*ultra\s*(\d)\b/i },
  { family: "watch", brand: "apple", pattern: /\bapple\s+watch\s*se\s*(\d)\b/i },
  { family: "airpods", brand: "apple", pattern: /\bairpods\s*(?:pro|max)?\s*(\d{1,2})\b/i },

  // ── Samsung ──
  // The S/A series letter is part of the marker ("S25" ≠ "A25").
  { family: "galaxy", brand: "samsung", pattern: /\bgalaxy\s*([sa]\d{1,2})\b/i },
  { family: "galaxy", brand: "samsung", pattern: /\bgalaxy\s*z(?:\s*(?:fold|flip))?\s*(\d{1,2})\b/i },
  { family: "galaxy", brand: "samsung", pattern: /\bgalaxy\s*(?:tab|book|buds)\s*[sa]?\s*(\d{1,2})\b/i },

  // ── Google ──
  { family: "pixel", brand: "google", pattern: /\bpixel\s*(\d{1,2})(?:a|pro|xl)?\b/i },

  // ── Sony ──
  { family: "playstation", brand: "sony", pattern: /\b(?:playstation|ps)\s*(\d)\b/i },
  { family: "sony-headphones", brand: "sony", pattern: /\b(?:wh|wf)-?1000xm(\d)\b/i },

  // ── Nintendo ──
  { family: "switch", brand: "nintendo", pattern: /\bswitch\s*2\b/i },
  // "Switch" without a number = the original (gen 1) console.
  { family: "switch", brand: "nintendo", pattern: /\bswitch(?!\s*2\b)/i, staticValue: "1", titleOnly: true },

  // ── Chinese phone brands ──
  { family: "xiaomi", brand: "xiaomi", pattern: /\b(?:xiaomi|redmi|poco)\s*(?:note|k|f|m|x|pad)?\s*(\d{1,2})\b/i },
  { family: "oneplus", brand: "oneplus", pattern: /\boneplus\s*(\d{1,2})\b/i },
  { family: "oppo", brand: "oppo", pattern: /\boppo\s*(?:find\s*x|reno)?\s*(\d{1,2})\b/i },
  { family: "honor", brand: "honor", pattern: /\bhonor\s*(?:magic|m|x)?\s*(\d{1,3})\b/i },
  { family: "realme", brand: "realme", pattern: /\brealme\s*(?:gt\s*)?(\d{1,2})\b/i },
  { family: "vivo", brand: "vivo", pattern: /\bvivo\s*(?:x|y|v|s)?\s*(\d{1,3})\b/i },
  { family: "motorola", brand: "motorola", pattern: /\b(?:edge|razr)\s*(\d{1,2})\b/i },

  // ── DJI ──
  { family: "dji-mavic", brand: "dji", pattern: /\bmavic\s*(\d{1,2})\b/i },
  { family: "dji-mini", brand: "dji", pattern: /\bmini\s*(\d{1,2})\b/i },
  { family: "dji-air", brand: "dji", pattern: /\bair\s*(\d{1,2})\s*s\b/i },
  { family: "dji-osmo", brand: "dji", pattern: /\bosmo\s*(?:pocket|action|mobile)?\s*(\d{1,2})\b/i },
  { family: "dji-rs", brand: "dji", pattern: /\brs\s*(\d)\b/i },
  { family: "dji-avata", brand: "dji", pattern: /\bavata\s*2\b/i },

  // ── Cameras ──
  { family: "canon-r", brand: "canon", pattern: /\beos\s*r(\d{1,2})\b/i },
  { family: "nikon-z", brand: "nikon", pattern: /\bz\s*(\d{1,2})\b/i },
  { family: "fuji-xt", brand: "fujifilm", pattern: /\bx-t(\d{1,2})\b/i },
  { family: "fuji-xh", brand: "fujifilm", pattern: /\bx-h2\b/i, staticValue: "2" },
  { family: "fuji-x100", brand: "fujifilm", pattern: /\bx100\b/i, staticValue: "100" },
  { family: "gopro", brand: "gopro", pattern: /\bhero\s*(\d{1,2})\b/i },

  // ── Home / audio ──
  { family: "dyson", brand: "dyson", pattern: /\bdyson\s*v(\d{1,2})\b/i },
  { family: "jbl", brand: "jbl", pattern: /\bjbl\s*(?:flip|charge|extreme|go|clip|tune)\s*(\d{1,2})\b/i },
  { family: "bose-qc", brand: "bose", pattern: /\bquietcomfort\s*ultra\b/i, staticValue: "ultra" },
  { family: "bose-qc", brand: "bose", pattern: /\bquietcomfort\s*(\d{2,3})\b/i },
  { family: "roborock", brand: "roborock", pattern: /\broborock\s*[sq]?\s*(\d{1,2})\b/i },
  { family: "ecovacs", brand: "ecovacs", pattern: /\bdeebot\s*[xtn]?\s*(\d{1,2})\b/i },
];

function extractMarkers(text: string, forTitle: boolean): RelevanceMarker[] {
  const markers: RelevanceMarker[] = [];
  const lower = text.toLowerCase();
  for (const fp of FAMILY_PATTERNS) {
    if (!forTitle && fp.titleOnly) continue;
    // Build a fresh global regex per extraction — the shared literals lack
    // the `g` flag (a non-global exec never advances lastIndex, which would
    // loop forever), and a shared global regex would leak lastIndex state.
    const re = new RegExp(fp.pattern.source, fp.pattern.flags.includes("g") ? fp.pattern.flags : `${fp.pattern.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      markers.push({
        family: fp.family,
        brand: fp.brand,
        value: (m[1] ?? fp.staticValue ?? "").toLowerCase(),
      });
      // Guard against zero-length matches looping forever
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return markers;
}

const STOP_WORDS = new Set(["the", "all", "and", "for", "with", "new", "pro", "max", "plus", "ultra"]);

function sharesMeaningfulToken(title: string, query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/[\s\-—,./()]+/)
    .filter((t) => t.length >= 2 && /[a-z0-9]/i.test(t))
    .filter((t) => !STOP_WORDS.has(t) || t.length >= 4);
  if (tokens.length === 0) return true;
  const t = title.toLowerCase();
  // Require the most distinctive token (the longest one — usually the brand
  // or model word). A bare generation number like "17" is far too weak and
  // would let unrelated products ("Xiaomi 17T Pro", "iPhone 17 case") through.
  const distinctive = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  return t.includes(distinctive);
}

/**
 * Returns true when the listing title plausibly corresponds to the search
 * query (same product family AND same generation), false when the title
 * clearly refers to a DIFFERENT product or generation.
 */
export function isTitleRelevantToQuery(title: string, query: string): boolean {
  const queryMarkers = extractMarkers(query, false);
  if (queryMarkers.length === 0) {
    // No known generation family in the query — fall back to token overlap
    return sharesMeaningfulToken(title, query);
  }
  const titleMarkers = extractMarkers(title, true);

  // 1) Strong match — the title carries the EXACT generation of the query.
  //    Accept immediately, even if the title also mentions other products.
  for (const qm of queryMarkers) {
    for (const tm of titleMarkers) {
      if (tm.family === qm.family && tm.value === qm.value) return true;
    }
  }

  // 2) Conflicts — the title carries a DIFFERENT generation of the same
  //    family, or explicitly names a different product family.
  for (const qm of queryMarkers) {
    for (const tm of titleMarkers) {
      if (tm.family === qm.family) {
        if (tm.value !== qm.value) return false;
      } else {
        return false;
      }
    }
  }

  // 3) No contradicting markers — the title gives no generation info. Still
  //    require a shared token so unrelated products don't slip through.
  return sharesMeaningfulToken(title, query);
}
