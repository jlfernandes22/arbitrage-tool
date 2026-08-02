# Agent Context — Arbitrage Intelligence Tool

> **Purpose**: This document gives an AI coding agent full context about the
> project, its current state, known issues, and a prioritized improvement
> roadmap. Read this entirely before making any changes.

---

## 1. Project Background

### What this app does
A **cross-border electronics arbitrage engine**. It scrapes used-electronics
listings from **Goofish (闲鱼, China, CNY)** and compares their landed cost
(including all Portugal import fees) against resale prices on **EU
marketplaces** (OLX.pt, Vinted.pt — second-hand; KuantoKusta.pt, Amazon.es —
new retail) to calculate net profit.

The user's goal: decide whether buying a used iPhone / MacBook / PS5 / camera
from China and reselling it in Portugal is profitable after every hidden fee.

### Who uses it
A single user (the project owner) running it locally or on a small VPS.
Not a multi-tenant SaaS. No authentication.

### Tech stack (non-negotiable)
- **Next.js 16** with App Router + Turbopack + standalone output
- **TypeScript 5** (strict mode, but `ignoreBuildErrors: true` in next.config —
  see "Known Technical Debt" below)
- **Prisma ORM + SQLite** (`db/custom.db`, committed to git)
- **Playwright** for real-browser scraping (Chromium)
- **Tailwind CSS 4 + shadcn/ui** (New York style)
- **Recharts** for charts
- **next-themes** for light/dark mode (class-based)
- **Bun** as the package manager + runtime

---

## 2. Current State (as of latest improvements)

### What works
- ✅ Full pipeline: Goofish scrape → EU comp scrape → match → profit calc → persist
- ✅ Concurrent scraping of all 5 marketplaces in parallel
- ✅ Scan History sidebar with DB persistence (survives server restarts)
- ✅ Dark mode (dashboard + charts)
- ✅ CSV/JSON export with all decision-critical fields
- ✅ Reference price admin editor (bulk CSV import/export)
- ✅ Manual Paste mode (for when Goofish anti-bot blocks the scraper)
- ✅ Cancel scan (graceful, at checkpoint)
- ✅ Re-evaluate (re-run profit calc without re-scraping)
- ✅ Keyboard shortcuts
- ✅ Saved queries (localStorage)
- ✅ Debug endpoints per scraper
- ✅ Live terminal console (log stream)

### What's been fixed recently
See `README.md` → "Recent Improvements" and `worklog.md` for the full list.
Key fixes:
- Orchestrator `progressInterval` scope error (was a TS compile error)
- Mock data NaN prices (missing categories)
- Scan History DB fallback (worked only in-memory before)
- `pollStatus` soft-lock on 404
- Goofish browser leak on "no results" page
- Multi-page fetch for KuantoKusta + Amazon (was always page 1)
- `buildEuQuery` stray "GB" when storage undefined
- Forex rate UI override (was dead code)
- Cancelled tasks infinite polling
- Deep Scan preset (was only 3 of 5 sites)
- CSV/JSON export missing fields
- Charts unreadable in dark mode
- Toast text inverted on pin/unpin
- Type drift (frontend missing regionVersion/lockStatus)
- 73 → 1 TypeScript errors

### Code quality metrics
- **TypeScript errors**: 1 (pre-existing TSX IIFE inference quirk in
  `src/app/page.tsx` around line 876 — the `platforms.map` call. Doesn't
  break the build because `ignoreBuildErrors: true`. Would need a refactor
  of the IIFE into a named component to fix cleanly.)
- **ESLint**: 0 errors, 0 warnings
- **Test coverage**: 0% (no test suite exists — see roadmap)

---

## 3. Known Limitations & Risks

### Scrapers
- **Vinted**: Cloudflare blocks headless browsers in most environments.
  Degrades gracefully (returns 0 comps + warning). Not fixable without a
  residential proxy or unofficial API wrapper.
- **Goofish**: Baxia CAPTCHA rate-limits by IP. After ~3-5 rapid scans,
  Goofish returns a 6.8KB empty page instead of the 305KB results page.
  Mitigation: 3-7s jitter between requests, 2 retry attempts, Manual Paste
  fallback.
- **KuantoKusta / Amazon**: HTTP-fetch-first strategy works from most IPs
  but can be blocked by Akamai WAF. Playwright fallback exists but is slower.
- **CSS module class names**: Goofish uses hashed class names like
  `search-price-input--p1NQEAuz` that change when they rebuild their frontend.
  These will silently break extraction. Should use more stable attribute
  selectors or make configurable.

### Security
- **No authentication**: Anyone who can reach the app can submit scans
  (which launch Playwright browsers — DoS vector) and delete tasks.
- **Caddyfile SSRF**: The `XTransformPort` gateway handler is an open proxy.
  `http://host:81/?XTransformPort=6379` proxies to `localhost:6379` (Redis).
  Restrict to an allow-list or remove.
- **Debug endpoints**: `/api/debug/*` launches Playwright with no rate limit
  or max-duration cap. Trivial DDoS vector if exposed.
- **Screenshots**: Debug endpoints write screenshots to `db/debug-screenshots/`
  and never clean them up. Disk fill risk.

### Performance
- **`page.tsx` is 1500+ lines** with 13 hooks in a single component.
  Re-renders on every `setStatus` (every 800ms during scan). Heavy children
  (`ResultsTable`, `ProfitChart`, `ProfitHeatmap`, `SummaryCards`) are not
  memoized. With 50+ listings this causes noticeable lag.
- **"Market Price Preview" IIFE** (page.tsx ~1021-1267) runs `flatMap` +
  `filter` + `reduce` + `sort` + `median` on every render. Should be
  `useMemo`-ized.
- **`resultsJson` can be multi-MB** per task. No compression, no chunking.
  After 100 deep scans the DB balloons and `db.task.findMany` slows.
- **O(N×M) comp filtering**: `filterRelevantComps` is called per-listing in
  a sequential loop. With 50 listings × 200 comps = 10,000 `scoreEuComp`
  calls. Could be parallelized or indexed by family/tier.

### Technical Debt
- **`next.config.ts: ignoreBuildErrors: true`** — Type errors silently ship
  to production. Should be `false` after fixing the remaining 1 error.
- **`reactStrictMode: false`** — Disables dev-time detection of stale-closure
  / effect bugs. Should be `true`.
- **ESLint rules disabled** (`eslint.config.mjs` turns off
  `@typescript-eslint/no-explicit-any`, `react-hooks/exhaustive-deps`,
  `no-unused-vars`, `no-unreachable`, `no-fallthrough`). Re-enabling would
  surface many issues but require cleanup first.
- **`tailwind.config.ts` is v3-style** but the project uses Tailwind v4
  (CSS-based config via `globals.css`). The TS config is largely ignored.
  Should be removed or migrated to the v4 CSS-first approach.
- **Dead code**: ~200 lines of unused functions in `goofish.ts`
  (`translateQueryToChinese`, `getMinPriceCny`, `attemptRealFetch`),
  `olx.ts`/`vinted.ts` (`parseOlxHtml`/`parseVintedHtml`), `orchestrator.ts`
  (`mapWithConcurrency`, `cacheMarketComps`, `getCachedComps` — the comp
  cache is implemented but never wired up).
- **Code duplication**: `sleep`, `jitter`, accessory-filter regex, EU price
  parsing, Chrome UA string all duplicated across scrapers. Should extract
  to `shared/scraper-utils.ts`.
- **`FORWARDER_PRESETS`** in `profit-calc.ts` is exported but the control
  panel defines its own local copy. Two copies will drift.
- **`appConfigOverrides`** in `components/arbitrage/types.ts` re-declares
  the entire AppConfig shape as optional fields. Should be
  `Partial<AppConfig>` or `DeepPartial<AppConfig>`.

---

## 4. Improvement Roadmap (Prioritized)

### Priority 1 — Security (do before any public deployment)
- [ ] Add authentication (NextAuth.js v4 is already installed). Even a
      single shared password is better than nothing.
- [ ] Remove or restrict the Caddyfile `XTransformPort` handler. Allow-list
      specific ports or require auth.
- [ ] Gate `/api/debug/*` behind auth + add rate limiting + screenshot
      cleanup cron.
- [ ] Add input size validation to `/api/translate` and
      `/api/tasks/manual_paste` (cap at 1 MB).

### Priority 2 — Performance
- [ ] Refactor `page.tsx` into smaller components + custom hooks:
      `useScanOrchestrator`, `useScanFilters`, `useTaskHistory`.
- [ ] Wrap `ResultsTable`, `ProfitChart`, `ProfitHeatmap`, `SummaryCards`
      in `React.memo` with stable callbacks.
- [ ] `useMemo`-ize the "Market Price Preview" computations (page.tsx ~1021).
- [ ] Wire up the comp cache (`cacheMarketComps` + `getCachedComps` in
      `orchestrator.ts`). 6-hour TTL is already implemented, just not called.
      Significant performance win for repeated queries.
- [ ] Compress `resultsJson` before storing (gzip + base64) or split into
      per-listing rows.
- [ ] Parallelize `filterRelevantComps` across listings with `Promise.all`
      or index comps by family/tier.

### Priority 3 — Code Quality
- [ ] Set `typescript.ignoreBuildErrors: false` + fix the remaining 1 error
      (refactor the `platforms.map` IIFE in page.tsx into a named component).
- [ ] Set `reactStrictMode: true` + fix any double-fire effect issues.
- [ ] Re-enable ESLint rules one at a time + fix the resulting warnings.
- [ ] Remove dead code (see "Technical Debt" above).
- [ ] Extract shared scraper utilities (`sleep`, `jitter`, `parseEurPrice`,
      `isAccessoryTitle`, `CHROME_UA`) to `src/lib/scrapers/shared.ts`.
- [ ] Replace `FORWARDER_PRESETS` duplication — import from `profit-calc.ts`.
- [ ] Replace `appConfigOverrides` with `DeepPartial<AppConfig>`.
- [ ] Remove the v3-style `tailwind.config.ts` (Tailwind v4 uses CSS config).
- [ ] Add runtime config validation with `zod` (currently `configJson as AppConfig`
      is an unsafe cast).

### Priority 4 — Features
- [ ] **Price-deviation scam detection**: `scam-detector.ts` accepts a
      `_refPricesOverride` parameter but never uses it. Implement a
      "too good to be true" check: if `listing.priceCny` converted to EUR
      is < 50% of the reference price for that product+condition, add +30
      risk. Mock data already generates these (mock-data.ts:110).
- [ ] **Missing categories in normalizer**: `detectCategory` in
      `normalizer.ts` has no branches for `xiaomi` or `gaming` (Steam Deck,
      Legion Go, ROG Ally). These listings return `null` from
      `normalizeListing` → never matched → silently dropped. Add branches.
- [ ] **Task store eviction**: `task-store.ts` Map grows unbounded. Add a
      max-entry cap (e.g. 1000 tasks) with LRU eviction, or a TTL (remove
      completed tasks after 24h).
- [ ] **Reference price category inference**: `inferCategory` in
      `reference-prices.ts` defaults to `"iphone"` for unknown brands
      (Canon, Nikon, JBL, Bose, Dyson, Razer, etc. in the JSON). Should
      return `"other"` or infer from brand.
- [ ] **`SKIP_LIVE_FETCH` env var**: Wire it into the orchestrator so the
      app can force mock data for testing without hitting live sites.
- [ ] **Alerts/notifications**: Email or webhook when a scan finds a
      listing with margin > 30% and risk < 20.
- [ ] **Saved scan schedules**: Cron-like recurring scans (e.g. "scan
      iPhone 15 Pro every morning at 9am").
- [ ] **Multi-query batch**: Submit multiple queries in one scan, get a
      combined profitability report.
- [ ] **Historical price charts per product**: Track how a specific
      product's Goofish price + EU resale price move over time.
- [ ] **Mobile UX**: The results table has 8 columns and uses
      `overflow-x-auto` with no visual scroll indicator. Add a shadow or
      scroll hint on mobile.

### Priority 5 — Testing
- [ ] Add a test suite (Vitest or Bun's built-in test runner).
- [ ] Unit tests for `normalizer.ts` (title parsing is complex and
      regression-prone).
- [ ] Unit tests for `profit-calc.ts` (landed cost math).
- [ ] Unit tests for `matcher.ts` (`buildEuQuery`, `filterRelevantComps`).
- [ ] Integration test for the full pipeline using mock data
      (`SKIP_LIVE_FETCH=1` once wired up).
- [ ] E2E test with Playwright for the dashboard (submit scan → see results).

### Priority 6 — Scraper Robustness
- [ ] Replace regex-based Goofish HTML parsing with proper JSON parsing
      (find `<script>` tag with `__NEXT_DATA__` or similar, `JSON.parse`,
      traverse). Current regex assumes field order and can't cross nested `}`.
- [ ] Make Goofish CSS module class names configurable or use stable
      attribute selectors (data-* attributes).
- [ ] Add a `User-Agent` rotation pool for HTTP-fetch scrapers.
- [ ] Add a residential proxy option for Vinted (configurable via env).
- [ ] Add a `force_mock` scraper option per-site (for testing individual
      scrapers in isolation).

---

## 5. Code Conventions

### File organization
- **Components** in `src/components/arbitrage/` (feature-specific) or
  `src/components/ui/` (shadcn primitives).
- **Business logic** in `src/lib/engine/` (pure functions, no side effects).
- **Scrapers** in `src/lib/scrapers/` (I/O, Playwright, HTTP).
- **API routes** in `src/app/api/` (thin handlers, delegate to lib).
- **Types** in `src/lib/engine/types.ts` (backend) and
  `src/components/arbitrage/types.ts` (frontend). Keep these in sync —
  type drift is a recurring issue.

### Naming
- **Files**: kebab-case (`profit-calc.ts`, `control-panel.tsx`).
- **Types/Interfaces**: PascalCase (`NormalizedProduct`, `EvaluatedListing`).
- **Functions**: camelCase (`computeProfit`, `buildEuQuery`).
- **Constants**: UPPER_SNAKE (`MAX_RETRIES`, `FOREX_TTL_MS`).
- **Components**: PascalCase (`ProfitChart`, `ResultsTable`).

### Patterns
- **Error handling**: Always `try/catch` around Playwright + DB + fetch.
  Swallowed errors should have a `/* ignore */` comment explaining why.
- **Async**: Use `async/await`, not `.then()`. Use `Promise.all` for
  concurrent work, not sequential awaits.
- **Resource cleanup**: Browser contexts must be closed in `try/finally` or
  before every `return` in a function that creates them. A leaked context
  = a leaked Chromium process.
- **Logging**: Use `appendLog(taskId, level, msg)` for pipeline logs (they
  stream to the UI terminal). Use `console.log` only for server-side debug
  that the user shouldn't see.
- **Config**: Read from `config` (the imported singleton) or
  `resolveConfig(overrides)` (merged with UI overrides). Never hardcode
  fees, URLs, or thresholds.
- **Types**: Prefer `interface` for object shapes, `type` for unions/aliases.
  Avoid `any` — use `unknown` + cast if needed.

### Comments
- **Why, not what**: Explain the business reason, not the code mechanics.
- **Link issues**: If a fix addresses a specific bug, reference it
  (e.g. `// Fix: progressInterval was out of scope in catch block`).
- **Mark hacks**: If code is fragile or temporary, mark it with
  `// TODO:`, `// HACK:`, or `// FIXME:`.

---

## 6. Testing Approach

There is currently no test suite. When adding tests:

1. **Use Bun's test runner** (`bun test`) — it's already installed and fast.
2. **Co-locate tests** with source: `profit-calc.test.ts` next to
   `profit-calc.ts`.
3. **Mock Playwright** in scraper tests — don't launch real browsers in CI.
4. **Use the mock data module** (`src/lib/scrapers/mock-data.ts`) for
   pipeline integration tests.
5. **Snapshot test** the normalizer output for a fixed set of titles to
   catch regressions when parsing logic changes.
6. **Test the profit calc** with known inputs + expected outputs (table-driven).

Example test structure:
```typescript
// src/lib/engine/profit-calc.test.ts
import { test, expect } from "bun:test";
import { computeLandedCost } from "./profit-calc";
import { config } from "@/lib/config";

test("landed cost includes all fees", () => {
  const result = computeLandedCost(1000, 0.127, config);
  // 1000 CNY * 0.127 = 127 EUR acquisition
  // + 5% agent = 6.35
  // + 3 inspection
  // + 5 CN shipping
  // + 1.5% insurance = 1.905
  // + 30 intl shipping
  // + 15 customs
  // + 0% duty
  // + 23% VAT on (127 + 6.35 + 3 + 5 + 1.905 + 30 + 15) = 23% * 188.255 = 43.3
  // + 7 PT shipping
  // Total = 127 + 6.35 + 3 + 5 + 1.905 + 30 + 15 + 43.3 + 7 = 238.555
  expect(result.acquisitionCostEur).toBeCloseTo(127, 2);
  expect(result.totalLandedCostEur).toBeCloseTo(238.56, 1);
});
```

---

## 7. How to Verify Changes

### Before committing
```bash
# 1. Type-check
bunx tsc --noEmit

# 2. Lint
bun run lint

# 3. Run a test scan via the API
bun run dev  # in one terminal
curl -X POST http://localhost:3000/api/tasks/submit \
  -H "Content-Type: application/json" \
  -d '{"query":"iPhone 15 Pro","category":"iphone","configOverrides":{"scraping":{"max_pages":1}}}'

# 4. Poll for completion
curl http://localhost:3000/api/tasks/status/<task_id>

# 5. Check the result
curl "http://localhost:3000/api/tasks/result/<task_id>?include_hidden=1" | python3 -m json.tool
```

### VLM verification (for UI changes)
Use the `z-ai vision` CLI to screenshot + verify:
```bash
# Start the dev server
bun run dev &

# Take a screenshot
agent-browser open http://localhost:3000/
agent-browser screenshot --full dashboard.png

# Verify with VLM
z-ai vision -p "Describe what you see. Any rendering issues?" -i dashboard.png
```

### DB fallback test (for API changes)
```bash
# 1. Submit a scan
TASK_ID=$(curl -s -X POST http://localhost:3000/api/tasks/submit \
  -H "Content-Type: application/json" \
  -d '{"query":"iPhone 15 Pro","category":"iphone"}' | grep -o '"task_id":"[^"]*"' | cut -d'"' -f4)

# 2. Wait for completion
# ... poll until status=done ...

# 3. Kill the server (simulates restart)
pkill -f "next dev"

# 4. Restart
bun run dev &

# 5. Verify the task still loads from DB
curl http://localhost:3000/api/tasks/status/$TASK_ID  # should return the task
curl http://localhost:3000/api/tasks/result/$TASK_ID  # should return the result
```

---

## 8. Quick Reference

### Key file locations
- **Config**: `src/config.json` + `src/lib/config.ts`
- **Pipeline**: `src/lib/orchestrator.ts`
- **Scrapers**: `src/lib/scrapers/*.ts`
- **Engine**: `src/lib/engine/*.ts`
- **Types**: `src/lib/engine/types.ts` (backend) + `src/components/arbitrage/types.ts` (frontend)
- **Dashboard**: `src/app/page.tsx`
- **API routes**: `src/app/api/*/route.ts`
- **Database schema**: `prisma/schema.prisma`
- **Seed data**: `src/data/reference_prices.json`

### Common commands
```bash
bun run dev          # Start dev server (port 3000, hot reload)
bun run build        # Production build → .next/standalone/
bun run start        # Start production server
bun run lint         # ESLint
bunx tsc --noEmit    # Type-check without emitting
bun run db:generate  # Generate Prisma client
bun run db:push      # Push schema to SQLite
bun run db:reset     # Drop all data + recreate schema
```

### Critical invariants
1. **Never break the pipeline** — the orchestrator must always reach a
   terminal state (`done`, `error`, or `cancelled`). A hung pipeline =
   infinite spinner in the UI.
2. **Always close Playwright contexts** — a leaked context = a leaked
   Chromium process. Use `try/finally` or close before every `return`.
3. **Always clear intervals/timeouts** — the `progressInterval` ticker
   must be cleared on success, error, AND cancel.
4. **Keep frontend + backend types in sync** — `components/arbitrage/types.ts`
   must mirror `lib/engine/types.ts`. Type drift causes TS errors that are
   currently masked by `ignoreBuildErrors: true`.
5. **DB fallback for task APIs** — any endpoint that takes a task ID must
   fall back to SQLite when the task isn't in the in-memory store. Otherwise
   Scan History breaks after a restart.
6. **Theme-aware chart colors** — never hardcode `#e5e5e5` or `#888` in
  Recharts components. Use `useChartTheme()` from `use-chart-theme.ts`.

---

## 9. Glossary

- **Landed cost**: Total cost to get the item to your door in Portugal
  (acquisition + agent fees + shipping + customs + VAT).
- **Comp**: A comparable EU marketplace listing used to estimate resale
  value.
- **Normalized product**: Parsed representation of a listing title
  (brand, model, storage, color, condition, region, lock status).
- **Reference price**: Admin-editable baseline price for a product+condition
  tier, used when no EU comps exist.
- **Forwarder**: China→EU buying agent (CSS Buy, Superbuy, Wegobuy, Bhiner).
- **Baxia**: Goofish's anti-bot CAPTCHA system.
- **Degraded**: A scan where one or more scrapers failed but the pipeline
  completed with partial data.
- **Viable**: A listing that passes both scam filter AND profitability
  filter (margin ≥ 15% AND net profit ≥ €30).
