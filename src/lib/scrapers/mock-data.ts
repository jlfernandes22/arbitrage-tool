// scrapers/mock-data.ts
// Deterministic high-fidelity mock data generator.
//
// In a production deployment the real scrapers (goofish/olx/vinted) reach the
// live endpoints. In this sandbox network egress to those anti-bot-protected
// hosts is unavailable, so we generate realistic, deterministic listings that
// exercise the FULL pipeline (normalizer -> scam detector -> profit calc ->
// matcher). The same query string always yields the same listings, so results
// are reproducible and cacheable.
//
// The generator intentionally produces a spread of risk profiles:
//  - some listings with critical blacklist tokens (auto-dropped)
//  - some with yellow modifiers (replaced screen/battery, no box)
//  - some priced far below reference median (price-deviation risk)
//  - varied seller reliability and asset quality
import type {
  Category,
  EuMarketComp,
  GoofishListing,
  NormalizedProduct,
} from "@/lib/engine/types";
import { normalizeListing } from "@/lib/engine/normalizer";
import { buildEuQuery } from "@/lib/engine/matcher";
// --- Deterministic PRNG (mulberry32 seeded from string hash) ---
function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const GOOFISH_LOCATIONS = [
  "浙江杭州", "广东深圳", "江苏南京", "上海浦东", "北京朝阳",
  "四川成都", "湖北武汉", "福建厦门", "山东青岛", "广东广州",
];
const COLORS = ["午夜色", "星光色", "蓝色", "粉色", "银色", "深空灰", "石墨色", "金色"];
const DESCRIPTION_TEMPLATES = [
  "{cond}出售{family} {storage}，{color}，{battery}电池健康，无拆无修，配件齐全，{box}。诚信出，{price}不议。",
  "{family} {storage} {color}，{cond}，{battery}，{box}，自用闲置，成色好，{price}可小刀。",
  "出{family} {storage}，{cond}，{color}，{battery}电池效率，{box}，{notes}。需要的私聊。",
  "{family} {storage}GB {color}，{cond}成色，原装正品，{battery}，{box}，{price}包邮。",
  "闲置{family} {storage}，{color}，{cond}，{battery}电池，{box}，{notes}。支持验机。",
];
const CONDITION_TOKENS = [
  "全新未拆封", "仅拆封", "99新", "95新", "9成新", "8成新",
];
const YELLOW_NOTES = ["", "", "", "换过屏幕", "换过电池", "无盒", "无原盒"];
const BOX_TOKENS = ["原盒齐全", "有原盒", "带充电器", "裸机无盒"];
const BLACKLIST_SAMPLES = [
  { token: "组装", note: "组装机，价格便宜" },
  { token: "翻新", note: "翻新机，外观新" },
  { token: "有锁", note: "有锁机，需卡贴" },
  { token: "进水", note: "进水修好，正常使用" },
  { token: "高仿", note: "高仿1:1，外形一样" },
];
const SELLER_NAMES = ["数码小店", "闲鱼达人", "果粉转让", "闲置清仓", "苹果专卖", "数码回收", "个人转让"];
function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
// Reference CNY prices for realistic Goofish second-hand pricing (CNY)
// Roughly: EUR_ref * (1/0.127) * 0.5..0.85 (second-hand discount)
function cnyPriceFor(product: NormalizedProduct | null, rng: () => number): number {
  if (!product) return randInt(rng, 500, 4000);
  // base on category
  const base: Record<Category, number> = {
    iphone: randInt(rng, 1800, 6500),
    macbook: randInt(rng, 4000, 14000),
    ipad: randInt(rng, 1800, 5500),
    ps5: randInt(rng, 1800, 3200),
  };
  let p = base[product.category];
  // storage bump
  if (product.storageGB && product.storageGB >= 256) p += 500;
  if (product.storageGB && product.storageGB >= 512) p += 1200;
  // condition discount
  switch (product.condition) {
    case "new":
    case "open_box":
      break;
    case "excellent":
      p = Math.round(p * 0.85);
      break;
    case "very_good":
      p = Math.round(p * 0.75);
      break;
    case "good":
      p = Math.round(p * 0.6);
      break;
    case "fair":
      p = Math.round(p * 0.4);
      break;
    default:
      p = Math.round(p * 0.7);
  }
  // occasionally a "too good to be true" price to trigger price-deviation risk
  if (rng() < 0.18) p = Math.round(p * (0.45 + rng() * 0.2));
  return Math.max(200, p);
}
function makeDescription(
  product: NormalizedProduct,
  rng: () => number,
  priceCny: number,
  opts: { blacklist?: string; yellow?: string },
): string {
  const tmpl = pick(rng, DESCRIPTION_TEMPLATES);
  let desc = tmpl
    .replace("{family}", product.family ?? "设备")
    .replace("{storage}", product.storageGB ? `${product.storageGB}GB` : "")
    .replace("{color}", product.color ?? pick(rng, COLORS))
    .replace("{battery}", product.batteryHealth ? `${product.batteryHealth}%` : "92%")
    .replace("{box}", pick(rng, BOX_TOKENS))
    .replace("{cond}", product.conditionRaw || pick(rng, CONDITION_TOKENS))
    .replace("{price}", `${priceCny}`)
    .replace("{notes}", opts.yellow || pick(rng, YELLOW_NOTES));
  if (opts.blacklist) {
    desc += ` ${opts.blacklist}`;
  }
  return desc;
}
export interface GoofishMockOptions {
  maxListings: number;
}
export function generateGoofishListings(
  query: string,
  category: Category,
  opts: GoofishMockOptions,
): { listings: GoofishListing[]; degraded: boolean; warning?: string } {
  const seed = hashString(`goofish:${query}:${category}`);
  const rng = mulberry32(seed);
  const count = randInt(rng, 8, Math.min(opts.maxListings, 18));
  const listings: GoofishListing[] = [];
  for (let i = 0; i < count; i++) {
    // Build a realistic title from query + variant
    const colorPick = pick(rng, COLORS);
    const condToken = pick(rng, CONDITION_TOKENS);
    let title = `${query} ${condToken} ${colorPick}`;
    // sometimes append storage if not in query
    if (!/\d+\s*(GB|TB)/i.test(query)) {
      const storage = category === "macbook" ? pick(rng, [256, 512, 1024]) : pick(rng, [64, 128, 256, 512]);
      title += ` ${storage}GB`;
    }
    if (category === "macbook" && /M[123]/.test(query)) {
      // already there
    } else if (category === "macbook") {
      title += ` ${pick(rng, ["M1", "M2", "M3"])}`;
    }
    title = title.replace(/\s+/g, " ").trim();
    // Decide risk profile for this listing
    const roll = rng();
    let blacklistNote: string | undefined;
    let yellow: string | undefined;
    if (roll < 0.12) {
      // critical blacklist
      blacklistNote = pick(rng, BLACKLIST_SAMPLES).note;
    } else if (roll < 0.35) {
      yellow = pick(rng, ["换过屏幕", "换过电池", "无盒", "换屏", "换电池"]);
    }
    const normalized = normalizeListing(title, blacklistNote ? `${title} ${blacklistNote}` : title);
    const priceCny = cnyPriceFor(normalized, rng);
    const desc = makeDescription(normalized ?? dummyProduct(category), rng, priceCny, {
      blacklist: blacklistNote,
      yellow,
    });
    const imageCount = randInt(rng, 1, 6);
    const imageUrls = Array.from(
      { length: imageCount },
      (_, k) => `https://img.goofish.example/mock-${(seed + i * 7 + k) % 200}.jpg`,
    );
    const sellerVerified = rng() > 0.3;
    const sellerVerifiedTransactions = sellerVerified
      ? randInt(rng, 3, 400)
      : randInt(rng, 0, 8);
    listings.push({
      id: `gf-${seed.toString(36)}-${i}`,
      title,
      priceCny,
      description: desc,
      imageUrls,
      sellerLocation: pick(rng, GOOFISH_LOCATIONS),
      wantsCount: randInt(rng, 0, 220),
      sellerVerified,
      sellerVerifiedTransactions,
      rawText: `${title}\n${desc}`,
      source: "goofish",
      normalized,
    });
  }
  return {
    listings,
    degraded: true,
    warning:
      "Live Goofish endpoint unreachable from sandbox (anti-bot WAF). Showing deterministic mock listings that exercise the full pipeline.",
  };
}
function dummyProduct(category: Category): NormalizedProduct {
  return {
    standardKey: "unknown",
    category,
    family: "unknown",
    condition: "good",
  } as NormalizedProduct;
}
// --- EU market comps mock generator ---
const EU_LOCATIONS = [
  "Lisboa", "Porto", "Braga", "Coimbra", "Faro", "Setúbal", "Aveiro", "Leiria",
];
export function generateEuComps(
  product: NormalizedProduct | null,
  query: string,
  platform: "olx" | "vinted",
): { comps: EuMarketComp[]; degraded: boolean; warning?: string } {
  if (!product) {
    return {
      comps: [],
      degraded: true,
      warning: "No normalized product to match against EU market.",
    };
  }
  const euQuery = buildEuQuery(product);
  const seed = hashString(`${platform}:${euQuery}`);
  const rng = mulberry32(seed);
  const count = randInt(rng, 3, 8);
  const comps: EuMarketComp[] = [];
  // Base EUR price from category
  const baseEur: Record<Category, number> = {
    iphone: randInt(rng, 250, 950),
    macbook: randInt(rng, 700, 2200),
    ipad: randInt(rng, 250, 850),
    ps5: randInt(rng, 280, 520),
  };
  let base = baseEur[product.category];
  if (product.storageGB && product.storageGB >= 256) base += 80;
  if (product.storageGB && product.storageGB >= 512) base += 200;
  for (let i = 0; i < count; i++) {
    const variance = 0.8 + rng() * 0.4;
    const priceEur = Math.round(base * variance);
    const cond = pick(rng, ["new", "excellent", "very_good", "good", "fair"] as const);
    comps.push({
      id: `${platform}-${seed.toString(36)}-${i}`,
      platform,
      title: `${euQuery} ${cond.replace("_", " ")}${platform === "vinted" ? ` ${pick(rng, COLORS)}` : ""}`,
      priceEur,
      condition: cond,
      location: pick(rng, EU_LOCATIONS),
      vendorType: platform === "olx" ? pick(rng, ["Particular", "Profissional"]) : "Particular",
      negotiable: platform === "olx" ? rng() > 0.5 : false,
      viewCount: platform === "olx" ? randInt(rng, 12, 900) : undefined,
      brand: platform === "vinted" ? "Apple" : undefined,
      sellerStars: platform === "vinted" ? Math.round((3 + rng() * 2) * 10) / 10 : undefined,
      bundleDiscount: platform === "vinted" && rng() > 0.6 ? randInt(rng, 5, 20) : undefined,
    });
  }
  return {
    comps,
    degraded: true,
    warning:
      platform === "olx"
        ? "Live OLX.pt endpoint unreachable from sandbox. Showing deterministic mock comps."
        : "Vinted authentication unavailable in sandbox. Showing deterministic mock comps.",
  };
}