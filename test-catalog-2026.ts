/**
 * Live catalog/normalizer verification for the Sep 2026 brand refresh.
 * Run: bun test-catalog-2026.ts
 * Temporary harness — safe to delete after the change is verified.
 */
import { normalizeListing } from "./src/lib/engine/normalizer";
import { BRAND_CATALOG } from "./src/components/arbitrage/types";

const CASES: Array<[string, string | null, (string | null | undefined)?]> = [
  // ── NEW models (the whole point of this change) ──
  ["小米18Pro Max 16+1T 全新未拆封 国行", "Xiaomi 18 Pro Max"],
  ["小米18Pro 512G 全网通", "Xiaomi 18 Pro"],
  ["小米18 256G 全新", "Xiaomi 18"],
  ["三星Z Fold8 Ultra 512G 99新", "Galaxy Z Fold8 Ultra", "Galaxy Z Fold8 Ultra 512GB"],
  ["Samsung Galaxy Z Flip8 256GB", "Galaxy Z Flip8", "Galaxy Z Flip8 256GB"],
  ["荣耀Magic8 Pro 16+512 全新", "Honor Magic 8 Pro"],
  ["Honor Magic 8 99新", "Honor Magic 8"],
  ["vivo X300 Pro 16+512G", "Vivo X300 Pro"],
  ["vivoX300 512G 全新", "Vivo X300"],
  ["iQOO 15 16+512 全网通", "Vivo iQOO 15"],
  ["一加15T 16+512G 全新", "OnePlus 15T", "OnePlus 15T 512GB"],
  ["OPPO Find X10 Pro Max 16+1T", "OPPO Find X10 Pro Max"],
  ["FindX10Pro 512G", "OPPO Find X10 Pro", "OPPO Find X10 Pro 512GB"],
  ["OPPO Find X10 256G", "OPPO Find X10"],
  ["真我GT8 Pro 12+256", "Realme GT 8 Pro"],
  ["realme GT 8 99新", "Realme GT 8"],
  ["摩托罗拉Razr 70 Ultra 512G", "Motorola Razr 70 Ultra"],
  ["Motorola Edge 70 Pro 256GB", "Motorola Edge 70 Pro"],
  ["红米K90 Pro Max 16+512", "Redmi K90 Pro Max"],
  ["红米K90 99新", "Redmi K90"],
  ["POCO F8 Ultra 12+256", "POCO F8 Ultra"],
  ["POCO F8 Pro 99新", "POCO F8 Pro"],
  // ── older models still resolve ──
  ["小米17 Pro Max 16+512", "Xiaomi 17 Pro Max"],
  ["小米15 Ultra 16+512G 国行", "Xiaomi 15 Ultra"],
  ["一加15 16+512G", "OnePlus 15"],
  ["OPPO Find X9 Ultra", "OPPO Find X9 Ultra"],
  ["vivo X200 Pro 16+512", "Vivo X200 Pro"],
  ["荣耀Magic7 Pro 12+256", "Honor Magic 7 Pro"],
  ["真我GT7 Pro", "Realme GT 7 Pro"],
  ["摩托罗拉Edge 60 Pro", "Motorola Edge 60 Pro"],
  ["Motorola Razr 60 Ultra", "Motorola Razr 60 Ultra"],
  ["红米Note 15 Pro+ 12+512", "Redmi Note 15 Pro Plus"],
  // ── regressions: established brands must behave EXACTLY as before ──
  ["iPhone 15 Pro 256G 国行 无锁", "iPhone 15 Pro"],
  ["iPhone 18 Pro Max 512G 全新", "iPhone 18 Pro Max"],
  ["三星Galaxy S26 Ultra 12+256", "Galaxy S26 Ultra"],
  ["Samsung Galaxy S25 Ultra", "Galaxy S25 Ultra"],
  ["Apple Watch Ultra 3 49mm", "Apple Watch Ultra 3"],
  ["DJI Mavic 4 Pro 全新", "DJI Mavic 4 Pro"],
  // ── adversarial: must NOT misroute ──
  ["小米17T Pro 16+512 全新", "Xiaomi 17T Pro", "Xiaomi 17T Pro 512GB"],
  ["MacBook Pro M4 Max 8T 48G", "MacBook Pro M4", "MacBook Pro M4 16 8192GB"], // M4 Max = 16" per MACBOOK_MODELS; 8T → 8192GB via laptopCtx
  ["小米180W充电器 全新", null], // 180W charger ≠ Xiaomi 18
  ["小米手环9 全新", null], // band, not a phone
  ["Xiaomi Pad 8 Pro 12+256", null], // tablet: no phone family → null (unchanged)
  ["iPad Pro M4 11 256G", "iPad Pro M4 11"],
  ["MacBook Pro M4 14 512G", "MacBook Pro M4"],
];

let pass = 0;
let fail = 0;
for (const [title, expectedFamily, expectedKey] of CASES) {
  const n = normalizeListing(title, "");
  const got = n ? n.family : null;
  const cat = n ? n.category : null;
  const key = n ? n.standardKey : null;
  const ok = got === expectedFamily && (!expectedKey || key === expectedKey);
  if (ok) {
    pass++;
    console.log(`✅ "${title}" → ${got} (${cat}) key=${key}`);
  } else {
    fail++;
    console.log(`❌ "${title}" → expected "${expectedFamily}" key="${expectedKey ?? "-"}", got "${got}" key="${key}" (${cat})`);
  }
}

// ── catalog integrity: every new gen id has an override + every new model query has a release date ──
const NEW_GENS = ["xiaomi-18", "redmi-k90", "poco-f8", "galaxy-z-8", "oneplus-15t", "oppo-find-x10", "honor-magic-8", "realme-gt8", "vivo-x300", "vivo-iqoo-15", "moto-edge-70", "moto-razr-70"];
const NEW_MODELS = ["Xiaomi 18 Pro Max", "Xiaomi 18 Pro", "Xiaomi 18", "Samsung Galaxy Z Fold8 Ultra", "Samsung Galaxy Z Fold8", "Samsung Galaxy Z Flip8", "OnePlus 15T", "OPPO Find X10 Pro Max", "OPPO Find X10 Pro", "OPPO Find X10", "Honor Magic 8 Pro", "Honor Magic 8", "Realme GT 8 Pro", "Realme GT 8", "Vivo X300 Pro", "Vivo X300", "Vivo iQOO 15", "Motorola Razr 70 Ultra", "Motorola Edge 70 Pro", "Redmi K90 Pro Max", "Redmi K90", "POCO F8 Ultra", "POCO F8 Pro", "Xiaomi 17 Pro Max"];
let mapOk = true;
for (const gid of NEW_GENS) {
  if (!BRAND_CATALOG.some((b) => b.productTypes.some((pt) => pt.generations.some((g) => g.id === gid && g.releaseDate)))) {
    console.log(`❌ gen ${gid} missing from catalog or has no releaseDate`);
    mapOk = false;
  }
}
for (const q of NEW_MODELS) {
  const found = BRAND_CATALOG.flatMap((b) => b.productTypes.flatMap((pt) => pt.generations.flatMap((g) => g.models))).find((m) => m.query === q);
  if (!found || !found.releaseDate) {
    console.log(`❌ model query "${q}" missing from catalog or has no releaseDate`);
    mapOk = false;
  }
}
console.log(mapOk ? "✅ all new gens/models present in catalog with release dates" : "❌ catalog map gaps");
console.log(`\n${pass}/${CASES.length} normalization cases passed, ${fail} failed; catalog ${mapOk ? "OK" : "BROKEN"}`);
if (fail > 0 || !mapOk) process.exit(1);
