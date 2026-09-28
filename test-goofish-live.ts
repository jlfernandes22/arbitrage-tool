// Live end-to-end test of the REAL goofish scraper with 3-page pagination.
// Run: bun test-goofish-live.ts "iPhone 15 Pro" 3
import { scrapeGoofish } from "./src/lib/scrapers/goofish";

const query = process.argv[2] || "iPhone 15 Pro";
const pages = parseInt(process.argv[3] || "3", 10);

console.log(`[test] scraping "${query}" with maxPages=${pages} …`);
const t0 = Date.now();
const r = await scrapeGoofish(query, "iphone", {
  maxPages: pages,
  enrichAll: false,
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
process.exit(0);
