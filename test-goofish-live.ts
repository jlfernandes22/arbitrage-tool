// Live end-to-end test of the REAL goofish scraper with 3-page pagination.
// Run: bun test-goofish-live.ts "iPhone 15 Pro" 3 [enrichAll: 0|1]
import { scrapeGoofish } from "./src/lib/scrapers/goofish";

const query = process.argv[2] || "iPhone 15 Pro";
const pages = parseInt(process.argv[3] || "3", 10);
const enrichAll = process.argv[4] === "1";

console.log(`[test] scraping "${query}" with maxPages=${pages} enrichAll=${enrichAll} …`);
const t0 = Date.now();
const r = await scrapeGoofish(query, "iphone", {
  maxPages: pages,
  enrichAll,
});
const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n[test] done in ${dt}s`);
console.log(`[test] listings: ${r.listings.length}`);
console.log(`[test] status: ${r.liveFetchStatus}`);
console.log(`[test] degraded: ${r.degraded} | blocked: ${r.blocked} | warning: ${r.warning ?? "none"}`);
// Show a sample of listing ids to verify cross-page items present
const ids = r.listings.slice(0, 40).map((l) => l.id);
console.log(`[test] first ids: ${ids.slice(0, 12).join(", ")}`);
const gfLiveIds = ids.filter((i) => i.startsWith("gf-live-")).length;
console.log(`[test] ids without real item id (positional fallback): ${gfLiveIds}`);
// Thumbnail coverage: every listing must carry the goofish small image
const withImg = r.listings.filter((l) => l.imageUrls.length > 0);
console.log(`[test] thumbnails: ${withImg.length}/${r.listings.length} listings have an image`);
const noImg = r.listings.filter((l) => l.imageUrls.length === 0);
if (noImg.length > 0) {
  console.log(`[test] MISSING thumbnails (${noImg.length}):`);
  for (const l of noImg.slice(0, 10)) console.log(`   - "${l.title.slice(0, 60)}"`);
}
// Sample a few extracted thumbnail URLs to eyeball correctness (product CDN, not avatar/icon)
for (const l of withImg.slice(0, 3)) {
  console.log(`[test] sample img: ${l.imageUrls[0].slice(0, 110)}  ← "${l.title.slice(0, 40)}"`);
}
process.exit(0);
