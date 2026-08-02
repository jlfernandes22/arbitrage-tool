# Arbitrage Intelligence Tool

A cross-border electronics arbitrage engine that scrapes **Goofish (闲鱼, China, CNY)**
listings and compares them against **EU resale market prices** (OLX.pt, Vinted.pt,
KuantoKusta.pt, Amazon.es — all EUR) to calculate **net profit after Portugal
import costs** (FX conversion, agent fees, air freight, customs, VAT, domestic
shipping).

The goal: tell you whether buying a used iPhone / MacBook / PS5 / camera from
China and reselling it in Portugal is actually profitable — after every hidden
fee is accounted for.

---

## Table of Contents

- [Quick Start](#quick-start)
- [How to Build](#how-to-build)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [How It Works](#how-it-works)
- [Scrapers](#scrapers)
- [Configuration Reference](#configuration-reference)
- [API Reference](#api-reference)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Recent Improvements](#recent-improvements)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Quick Start

### Prerequisites

- **Node.js 18+** or **Bun** (Bun is recommended — faster install + runtime)
- **Playwright Chromium** (for live scraping — Goofish requires a real browser)
- **4 GB RAM** minimum (Playwright + Next.js together need headroom)

### Development Mode (recommended for first run)

```bash
# 1. Install dependencies
bun install

# 2. Install Playwright Chromium browser (one-time, ~150 MB download)
npx playwright install chromium

# 3. Generate the Prisma client (reads prisma/schema.prisma)
bun run db:generate

# 4. Start the dev server (hot reload on http://localhost:3000)
bun run dev
```

Open `http://localhost:3000` in your browser. The first page compile takes
~5 seconds (Turbopack); subsequent navigations are instant.

### Production Mode

See [How to Build](#how-to-build) below for the full production build + deploy
guide.

---

## How to Build

The project uses Next.js 16's **standalone output** mode, which produces a
self-contained server bundle in `.next/standalone/`. The build script
(`package.json` → `"build"`) runs `next build` and then copies the supporting
files (Playwright runtime, Prisma DB, public assets, `.env`) into the
standalone directory so you can ship it as a single folder.

### Step-by-step Production Build

```bash
# 1. Clean any previous build artifacts
rm -rf .next

# 2. Install dependencies (if not already installed)
bun install

# 3. Install Playwright Chromium (required for live scraping)
npx playwright install chromium

# 4. Generate the Prisma client
bun run db:generate

# 5. Run the production build
bun run build
# This runs:
#   next build
#   cp -r .next/static .next/standalone/.next/
#   cp -r public .next/standalone/
#   cp -r db .next/standalone/
#   cp .env .next/standalone/
#   cp node_modules/playwright-core/browsers.json .next/standalone/node_modules/playwright-core/
#   cp -r node_modules/playwright-core/lib .next/standalone/node_modules/playwright-core/

# 6. Start the production server
bun run start
# Equivalent to: NODE_ENV=production bun .next/standalone/server.js
```

The production server listens on **port 3000** by default. Override with
`PORT=4000 bun run start` if needed.

### Verifying the Build

After `bun run build`, the `.next/standalone/` directory should contain:

```
.next/standalone/
├── server.js              ← entry point (run with: bun server.js)
├── .next/                 ← compiled Next.js assets
│   └── static/            ← JS/CSS chunks
├── public/                ← static images/icons
├── db/                    ← SQLite database + schema
│   └── custom.db
├── .env                   ← environment variables
└── node_modules/
    └── playwright-core/   ← browser automation runtime
```

If you see `Unable to open the database file` errors at startup, the `cp`
commands in step 5 failed silently. Re-run them manually:

```bash
cp -r db .next/standalone/
cp .env .next/standalone/
cp node_modules/playwright-core/browsers.json .next/standalone/node_modules/playwright-core/
cp -r node_modules/playwright-core/lib .next/standalone/node_modules/playwright-core/
```

### Building with Docker (optional)

The project doesn't ship a Dockerfile, but a minimal one looks like:

```dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run db:generate
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2
RUN npx playwright install chromium
RUN bun run build

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/db ./db
COPY --from=builder /app/.env ./
EXPOSE 3000
CMD ["bun", "server.js"]
```

### Common Build Issues

| Error | Cause | Fix |
|-------|-------|-----|
| `Unable to open the database file` | `db/` not copied to standalone | Run the manual `cp` commands above |
| `Cannot find module 'playwright-core'` | Playwright not copied to standalone | Re-run the `cp` commands for playwright-core |
| `EADDRINUSE :3000` | Port already in use | `lsof -i :3000` then kill the process, or use `PORT=4000` |
| `bun: command not found` | Bun not installed | `curl -fsSL https://bun.sh/install \| bash` |
| Prisma `Client not generated` | Missing `db:generate` step | Run `bun run db:generate` |
| Goofish returns 0 listings | Playwright Chromium not installed | Run `npx playwright install chromium` |

---

## Environment Variables

Create a `.env` file in the project root (it's gitignored):

```bash
# .env
DATABASE_URL="file:./db/custom.db"
SKIP_LIVE_FETCH=0
NODE_OPTIONS=--max-old-space-size=2048
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./db/custom.db` | SQLite database path (relative to project root). Must start with `file:`. |
| `SKIP_LIVE_FETCH` | `0` | `0` = real Playwright scraping (production). `1` = use mock data (testing only — produces fake listings). **Note:** this flag is currently not wired into the scrapers; the app always attempts live scraping and falls back gracefully on failure. |
| `NODE_OPTIONS` | `--max-old-space-size=2048` | Node.js heap limit. Increase to `4096` if you hit OOM errors during deep scans (6 pages × 5 sites). |

---

## Database

The app uses **SQLite** via Prisma ORM. The database file lives at `db/custom.db`
and is **committed to git** (it contains seeded reference prices — see below).

### Schema (4 models)

```prisma
model Task {
  id          String   @id @default(cuid())
  query       String
  category    String
  status      String   // pending | scraping_goofish | calculating | done | error | paused | cancelled
  progress    Int      @default(0)
  step        String?
  error       String?
  manualHtml  String?
  resultsJson String?  // full evaluated result (can be multi-MB for deep scans)
  summaryJson String?  // summary metrics for the history sidebar
  degraded    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model ReferencePrice {  // admin-editable price matrix (41 seeded entries)
  standardKey  String   @id  // e.g. "iPhone 15 Pro 256GB"
  category     String
  new          Float
  excellent    Float
  veryGood     Float    @map("very_good")
  good         Float
  fair         Float?
}

model MarketComp {  // cached EU marketplace comps (6-hour TTL)
  id        String   @id @default(cuid())
  platform  String   // olx | vinted | kuantokusta | amazon
  queryKey  String
  title     String
  priceEur  Float
  condition String?
  location  String?
  dataJson  String   // full EuMarketComp JSON
  expiresAt DateTime
}

model ForexRate {  // cached CNY→EUR rate (1-hour TTL)
  fromCcy   String
  toCcy     String
  rate      Float
  source    String   // cache | api | fallback
  fetchedAt DateTime @default(now())
  expiresAt DateTime
  @@id([fromCcy, toCcy])
}
```

### Prisma Commands

```bash
bun run db:generate   # Generate TypeScript client from schema (run after schema changes)
bun run db:push       # Push schema to database (no migration history — dev only)
bun run db:migrate    # Create + apply a migration (production-safe)
bun run db:reset      # Drop all data + re-apply migrations (destructive!)
```

### Resetting the Database

If the database gets into a bad state:

```bash
rm db/custom.db
bun run db:push       # Recreates the schema
# Reference prices auto-seed from src/data/reference_prices.json on first access
```

---

## How It Works

The arbitrage pipeline runs in 3 phases:

### Phase 1: Concurrent Scraping
All 5 marketplaces are scraped **in parallel** (Goofish + OLX + Vinted +
KuantoKusta + Amazon). Each scraper logs its own per-page progress to the
terminal console. A 3-second ticker updates the dashboard's "Live Per-Platform
Scraping Cards" so you can see which sites are still running vs done.

### Phase 2: Matching
Each Goofish listing is normalized (brand, model, storage, color, condition,
region, lock status) and matched against the EU comps using strict family +
tier filtering. Cross-tier false positives (e.g. "Pro Max" comps for a "Pro"
listing) are rejected so the resale median isn't contaminated.

### Phase 3: Profit Calculation
For each listing, the engine computes:

```
Landed Cost = Acquisition (CNY→EUR + exchange fee)
            + Agent service fee (5% of acquisition)
            + Inspection fee (€3 flat)
            + CN domestic shipping (€5)
            + Insurance (1.5% of acquisition)
            + International air freight (€30)
            + Customs clearance (€15)
            + Import duty (0% for phones/laptops)
            + PT VAT 23% on (acquisition + fees + shipping + duty)
            + PT domestic shipping (€7)

Expected Resale = median of filtered EU comps
                (falls back to reference price if no comps)

Net Profit = (Expected Resale × (1 - marketplace fee)) - Landed Cost
Margin %   = Net Profit / Landed Cost × 100
```

Listings are **hidden** if margin < 15% OR net profit < €30 (configurable).
Listings are **dropped** (scam) if they match blacklist tokens (组装/山寨/翻新/进水)
or if the seller rating is too low.

### Cancel Checkpoints
The pipeline checks for cancellation requests at two checkpoints:
1. After scraping completes (before profit calc)
2. After profit calc completes (before result assembly)

This lets you cancel a long-running scan without wasting compute on the next
phase. The interval ticker is cleaned up on cancel, success, and error.

---

## Scrapers

### Goofish (闲鱼) — China, CNY

- **URL**: `https://www.goofish.com/search?q=<query>&spm=a21ybx.search.searchInput.0`
- **Method**: Fresh Playwright Chromium instance (not shared with other
  scrapers — avoids cross-site cookie contamination that triggers Goofish's
  anti-bot)
- **Login modal**: Dismissed with Escape / click at (0,0) — never logs in
- **Retry**: 2 attempts with 3-5s backoff on Baxia CAPTCHA detection
- **Pagination**: Infinite scroll (6 scroll steps per "page")
- **Price filter**: Rejects items < ¥500 (accessories)
- **No-results detection**: Blocks Goofish's "recommended for you" fallback
  from being extracted as search results
- **Enrichment** (optional, toggle in UI): Opens each listing page to extract
  seller rating, image count, full image URLs, and condition flags
  (维修/换屏/换电池/无盒/进水 etc.)

### OLX.pt — Portugal, EUR (second-hand)

- **Selector**: `[data-cy='l-card']`
- **Price parsing**: Portuguese format `1 250 €` → 1250
- **Filters**: Accessory keywords (case/cover/capa/film/charger/...),
  price range €100–€3000

### Vinted.pt — Portugal, EUR (second-hand)

- **Method**: Playwright with 20s timeout + 2-attempt retry (Cloudflare)
- **Selectors**: `feed-grid__item`, `ItemBox`, `item-box` (multiple fallbacks)
- **Filters**: Same as OLX
- **⚠️ Known limitation**: Cloudflare protection often blocks automated
  browsers. The scraper degrades gracefully (returns 0 comps + warning) and
  the pipeline continues with OLX-only comparison.

### KuantoKusta.pt — Portugal, EUR (NEW retail)

- **Method**: HTTP fetch first (different TLS fingerprint than Playwright),
  Playwright fallback if blocked by Akamai WAF
- **URL**: `https://www.kuantokusta.pt/search?q=<query>&page=<n>`
- **All results**: NEW retail products (VAT-inclusive) — tagged `isRetail: true`
- **Multi-page**: Advances page parameter correctly (was previously broken —
  always fetched page 1)

### Amazon.es — Spain, EUR (NEW retail)

- **Method**: HTTP fetch first (returns full HTML from most IPs),
  Playwright fallback
- **Session**: Playwright visits home page first to establish session cookie
  + WAF token
- **Selector**: `[data-component-type='s-search-result']`
- **All results**: NEW retail products — tagged `isRetail: true`
- **Multi-page**: Advances page parameter correctly (same fix as KuantoKusta)

### Listing Enrichment (Goofish only)

Toggle "Enrich all listings" in the control panel:
- **OFF** (default): Fast scan — condition flags detected from title/description
  only, no seller ratings or full image URLs
- **ON**: Slow scan — opens each listing page to extract seller rating
  (好评率97%), image count, full image URLs, and detailed condition flags

---

## Configuration Reference

All config lives in `src/config.json` and can be overridden at runtime via
the UI's Control Panel (sliders + inputs). Overrides are stored per-scan in
the task's `configOverrides` field.

### Forex
| Key | Default | Description |
|-----|---------|-------------|
| `cny_to_eur_rate` | 0.127 | Manual rate override (used as fallback when API is unreachable) |
| `exchange_fee` | 0.025 | Bank/card FX fee (2.5%) |
| `fallback_rate` | 0.127 | Static fallback if user rate is missing |
| `api_url` | `https://api.exchangerate-api.com/v4/latest/CNY` | Live rate API |
| `ttl_seconds` | 3600 | Cache TTL for forex rate (1 hour) |

### Logistics (forwarder costs)
| Key | Default | Description |
|-----|---------|-------------|
| `forwarder_type` | `cssbuy` | `cssbuy` \| `superbuy` \| `wegobuy` \| `bhiner` \| `custom` |
| `agent_service_fee_rate` | 0.05 | Agent service fee (5% of acquisition) |
| `inspection_fee_eur` | 3.0 | Photo/inspection fee per item |
| `domestic_shipping_cn_eur` | 5.0 | Seller → agent warehouse shipping |
| `insurance_fee_rate` | 0.015 | Shipping insurance (1.5% of acquisition) |
| `international_shipping_eur` | 30.0 | Air freight to EU |
| `customs_clearance_fee_eur` | 15.0 | Broker clearance fee |
| `import_duty_rate` | 0.0 | Import duty (0% for phones/laptops; 2-14% for other electronics) |
| `domestic_shipping_eur` | 7.0 | PT domestic courier (CTT) |

### Tax
| Key | Default | Description |
|-----|---------|-------------|
| `pt_vat_rate` | 0.23 | Portuguese import VAT (23%) |

### Marketplace Fees
| Key | Default | Description |
|-----|---------|-------------|
| `olx_fee_rate` | 0.0 | OLX resale fee (0% — free for peer-to-peer) |
| `vinted_fee_rate` | 0.05 | Vinted buyer protection fee (5%) |
| `kuantokusta_fee_rate` | 0.0 | KuantoKusta (0% — price comparison, no transaction) |
| `amazon_fee_rate` | 0.08 | Amazon seller fee (8% referral) |
| `default_resale_fee_rate` | 0.05 | Fallback for unknown platforms |

### Profitability
| Key | Default | Description |
|-----|---------|-------------|
| `min_margin_pct` | 0.15 | Hide listings below 15% margin |
| `min_net_profit_eur` | 30.0 | Hide listings below €30 net profit |

### Scam Filter
| Key | Default | Description |
|-----|---------|-------------|
| `hide_threshold` | 60 | Hide listings with risk score ≥ 60 |

### Scraping
| Key | Default | Description |
|-----|---------|-------------|
| `max_listings_per_search` | 50 | Hard cap per Goofish search |
| `max_pages` | 3 | Default page count (per-site overrides below) |
| `goofish_pages` | (unset) | Per-site override (falls back to `max_pages`) |
| `olx_pages` | (unset) | Per-site override |
| `vinted_pages` | (unset) | Per-site override |
| `kuantokusta_pages` | (unset) | Per-site override |
| `amazon_pages` | (unset) | Per-site override |
| `skip_vinted` | false | Skip Vinted entirely |
| `skip_olx` | false | Skip OLX entirely |
| `skip_kuantokusta` | false | Skip KuantoKusta |
| `skip_amazon` | false | Skip Amazon |
| `skip_new` | false | Master switch: skip KuantoKusta + Amazon |
| `skip_used` | false | Master switch: skip OLX + Vinted |
| `min_price_cny` | (unset) | Goofish price floor (default 500) |
| `max_price_cny` | (unset) | Goofish price ceiling |
| `enrich_all` | false | Open each Goofish listing page for seller rating + images |
| `jitter_min_ms` | 3000 | Anti-detection delay min (3s) |
| `jitter_max_ms` | 7000 | Anti-detection delay max (7s) |
| `goofish_search_url` | `https://www.goofish.com/search?q=` | Goofish search URL template |
| `olx_search_url` | `https://www.olx.pt/q-` | OLX search URL template |
| `vinted_search_url` | `https://www.vinted.pt/` | Vinted search URL template |
| `kuantokusta_search_url` | `https://www.kuantokusta.pt/search?q=` | KuantoKusta search URL template |
| `amazon_search_url` | `https://www.amazon.es/s?k=` | Amazon.es search URL template |

---

## API Reference

All routes are under `/api/`. All responses are JSON. All mutating endpoints
require `Content-Type: application/json`.

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks/submit` | Submit a new scan. Body: `{ query, category, configOverrides? }`. Returns `{ task_id, status: "pending" }`. |
| `GET` | `/api/tasks/status/[id]` | Poll task status. Returns `{ task_id, status, progress, step, error?, warnings, degraded, logs }`. Falls back to DB if task not in memory. |
| `GET` | `/api/tasks/result/[id]?include_hidden=1` | Get full evaluated result. `include_hidden=1` returns filtered listings too. Falls back to DB. |
| `GET` | `/api/tasks/list` | List all tasks for the history sidebar. Returns `{ tasks: [...] }`. |
| `DELETE` | `/api/tasks/[id]` | Delete a task from DB + memory. |
| `POST` | `/api/tasks/cancel/[id]` | Request graceful cancellation (checked at next pipeline checkpoint). |
| `POST` | `/api/tasks/reevaluate/[id]` | Re-run scam detection + profit calc on stored listings WITHOUT re-scraping. Body: `{ configOverrides? }`. |
| `POST` | `/api/tasks/manual_paste/[id]` | Resume a paused task with manually-pasted Goofish DOM HTML. Body: `{ html }`. |

### Config

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Get current config. |
| `GET` | `/api/config/prices` | List all reference prices. |
| `POST` | `/api/config/prices` | Bulk upsert reference prices. Body: `{ prices: [...] }`. |
| `DELETE` | `/api/config/prices` | Bulk delete. Body: `{ ids: [...] }`. |

### Debug (per-scraper)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/debug/goofish?query=iPhone+15+Pro` | Run only the Goofish scraper. |
| `GET` | `/api/debug/olx?query=iPhone+15+Pro` | Run only OLX. |
| `GET` | `/api/debug/vinted?query=iPhone+15+Pro` | Run only Vinted. |
| `GET` | `/api/debug/kuantokusta?query=iPhone+15+Pro` | Run only KuantoKusta. |
| `GET` | `/api/debug/amazon?query=iPhone+15+Pro` | Run only Amazon. |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/translate` | Translate Chinese listing text to English via LLM. Body: `{ title, description?, location?, conditionRaw? }`. |
| `GET` | `/api/tasks/suggestions?q=iPhone` | Autocomplete suggestions for the search box. |
| `GET` | `/api/tasks/trend?query=iPhone+15+Pro` | Historical trend data for a query. |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus the search input |
| `Enter` | Start a scan |
| `j` / `k` | Navigate down/up in the results table |
| `o` | Open the active row's detail dialog |
| `b` | Copy the active row as a blueprint (JSON) |
| `m` | Copy the active row as Markdown |
| `x` | Export filtered listings as CSV |
| `s` | Pin/unpin the current query |
| `?` | Open the keyboard shortcuts help dialog |
| `Esc` | Close any open dialog |

---

## Architecture

```
src/
├── app/
│   ├── page.tsx                    # Single-page dashboard (1500+ lines)
│   ├── layout.tsx                  # Root layout + ThemeProvider + Sonner
│   ├── globals.css                 # Tailwind v4 + theme tokens (light/dark)
│   └── api/                        # REST API routes (see API Reference)
│       ├── tasks/                  # submit, status, result, list, delete, cancel, reevaluate, manual_paste
│       ├── config/                 # reference prices CRUD + bulk import/export
│       ├── debug/                  # per-scraper debug endpoints
│       └── translate/              # LLM-powered CN→EN translation
├── components/
│   ├── arbitrage/                  # Dashboard feature components
│   │   ├── control-panel.tsx       # Search + presets + config + debug + enrichment toggle
│   │   ├── results-table.tsx       # Sortable table with images, condition flags, seller ratings
│   │   ├── listing-detail.tsx      # Full breakdown dialog (landed cost, comps, scam report)
│   │   ├── summary-cards.tsx       # Clickable metric cards (viable/scam/profit/total)
│   │   ├── profit-chart.tsx        # Bar chart — profit distribution (current scan)
│   │   ├── profit-trend-chart.tsx  # Area chart — profit trend across scans
│   │   ├── profit-heatmap.tsx      # Model × condition profitability heatmap
│   │   ├── product-trend.tsx       # Historical price trend for a single product
│   │   ├── task-history.tsx        # Sidebar: scan history + saved queries + EU market links
│   │   ├── terminal-console.tsx    # Live backend log stream (terminal aesthetic)
│   │   ├── reference-editor.tsx    # Admin: reference price matrix editor (CSV import/export)
│   │   ├── csv-export.ts           # CSV + JSON export (client-side)
│   │   ├── use-chart-theme.ts      # Shared hook: theme-aware Recharts colors
│   │   └── types.ts                # Client-side types + preset catalog (brands, models, release dates)
│   ├── ui/                         # shadcn/ui components (New York style)
│   └── theme-provider.tsx          # next-themes wrapper
├── lib/
│   ├── orchestrator.ts             # Pipeline: concurrent scrape → match → calc → persist
│   ├── config.ts                   # AppConfig type + resolveConfig() merge helper
│   ├── db.ts                       # Prisma client singleton
│   ├── task-store.ts               # In-memory task map (with DB persistence)
│   ├── reference-prices.ts         # Reference price service (DB-backed, auto-seeds from JSON)
│   ├── engine/                     # Business logic
│   │   ├── normalizer.ts           # Parse listing title → NormalizedProduct (brand/model/storage/condition/region/lock)
│   │   ├── matcher.ts              # buildEuQuery + filterRelevantComps (strict family/tier matching)
│   │   ├── scam-detector.ts        # Risk scoring: seller rating + blacklist + yellow modifiers + image count
│   │   ├── profit-calc.ts          # Landed cost + resale median + net profit + margin + forwarder presets
│   │   ├── forex.ts                # CNY→EUR rate (cache → API → user override → fallback)
│   │   ├── types.ts                # Core domain types (Category, NormalizedProduct, GoofishListing, etc.)
│   │   └── index.ts                # Re-exports
│   ├── scrapers/                   # Marketplace scrapers
│   │   ├── goofish.ts              # Playwright — fresh browser, modal dismissal, infinite scroll, enrichment
│   │   ├── olx.ts                  # Playwright — data-cy=l-card extraction
│   │   ├── vinted.ts               # Playwright — Cloudflare bypass, multi-selector fallback
│   │   ├── kuantokusta.ts          # HTTP-first → Playwright fallback (Akamai WAF)
│   │   ├── amazon.ts               # HTTP-first → Playwright fallback (session cookie)
│   │   ├── browser.ts              # Shared Playwright context factory + stealth init script
│   │   ├── mock-data.ts            # Deterministic mock listings/comps for testing
│   │   └── index.ts                # Re-exports
│   └── utils.ts                    # cn() classname merge helper
├── hooks/                          # use-saved-queries, use-keyboard-shortcuts, use-mobile, use-toast
├── data/
│   └── reference_prices.json       # Seed data: 41 reference prices (iPhone/MacBook/iPad/PS5 SKUs × condition tiers)
└── config.json                     # Base config (overridable via UI)
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Turbopack, standalone output) |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 + shadcn/ui (New York style) + tw-animate-css |
| Database | Prisma ORM + SQLite (`db/custom.db`) |
| Scraping | Playwright (real Chromium browser) |
| Charts | Recharts (bar, area, heatmap) |
| Theme | next-themes (class-based light/dark) |
| Toasts | Sonner |
| State | React hooks (useState/useRef) + TanStack Query for server state |
| Tables | TanStack Table (sortable, resizable) |
| Icons | Lucide React |

---

## Troubleshooting

### Goofish returns 0 listings

**Cause**: Baxia CAPTCHA blocked the search, or Playwright Chromium isn't installed.

**Fix**:
1. Run `npx playwright install chromium` (one-time setup)
2. Wait 5-10 minutes and retry (Baxia rate-limits by IP)
3. If persistent, use the **Manual Paste** mode:
   - Open `https://www.goofish.com/search?q=<your-query>` in your normal browser
   - View page source, copy the full HTML
   - Paste into the "Manual Goofish HTML Paste" collapsible in the Control Panel
   - The pipeline parses the pasted DOM instead of hitting the live site

### Vinted returns 0 comps

**Cause**: Cloudflare protection blocks Playwright headless browsers.

**Fix**: This is expected in most environments. The pipeline degrades
gracefully — OLX-only comparison continues. If you need Vinted comps, consider:
- Running the scraper from a residential IP (not a datacenter)
- Using a Vinted API wrapper (unofficial) instead of scraping
- Manually adding Vinted comps via the Reference Price editor

### "Task not found" after server restart

**Cause**: This was a bug in previous versions — the in-memory task store was
lost on restart and the API had no DB fallback.

**Fix**: Already fixed. The `/api/tasks/status/[id]` and `/api/tasks/result/[id]`
endpoints now fall back to the SQLite database when a task isn't in memory.
Historical scans should load correctly after a restart.

### Charts are unreadable in dark mode

**Cause**: This was a bug — Recharts colors were hardcoded to light-mode values.

**Fix**: Already fixed. Charts now use the `useChartTheme()` hook which
returns theme-aware colors (dark grid lines, light axis labels, dark tooltip
backgrounds). Toggle the theme with the sun/moon button in the header.

### CSV export is missing fields

**Cause**: Previous CSV export dropped `regionVersion`, `lockStatus`,
`sellerRating`, `conditionFlags`, `href`, `description`, and other
decision-critical fields.

**Fix**: Already fixed. CSV now includes 45 columns (was 30). JSON export
also includes the full normalized product + complete EU comp details.

### Database is huge / slow

**Cause**: `resultsJson` stores the full evaluated result per task. Deep scans
(6 pages × 5 sites) can produce multi-MB JSON per task.

**Fix** (not yet implemented):
- Delete old scans via the sidebar trash button
- Run `VACUUM;` on the SQLite database to compact it:
  ```bash
  sqlite3 db/custom.db "VACUUM;"
  ```

### Playwright browser won't launch

**Cause**: Missing system dependencies (Linux only).

**Fix**:
```bash
npx playwright install-deps chromium
# or manually:
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2
```

---

## Recent Improvements

See `worklog.md` for the full change history. Highlights:

### Critical Bug Fixes
- **Orchestrator scope error** — `progressInterval` was declared inside `try`
  but referenced in `catch`, causing a TypeScript compile error + runtime
  `ReferenceError`. Hoisted above `try` with a `stopProgress()` helper.
- **Missing AppConfig import** in `engine/types.ts` — broke the `TaskState` type.
- **Mock data NaN prices** — `Record<Category, number>` only had 4 of 9
  categories. Samsung/Xiaomi/gaming queries produced `NaN` prices in degraded
  mode. Added all 9 categories.

### High-Impact Fixes
- **Scan History works after restart** — `/api/tasks/result` and `/status`
  now fall back to SQLite when the task isn't in memory.
- **No more infinite spinner** — `pollStatus` handles 404s and 5xxs properly
  instead of silently bailing.
- **Goofish browser leak fixed** — early return on "no results" page now
  closes the Chromium context + browser.
- **Multi-page fetch fixed** — KuantoKusta + Amazon now actually advance past
  page 1 (previously the `page` parameter was never passed).
- **`buildEuQuery` stray "GB"** — no longer appends "GB" when storage is
  undefined (was producing queries like `"iPhone 15 GB"`).
- **Forex rate override works** — the UI's `cny_to_eur_rate` field is now
  respected (was dead code; only `fallback_rate` was read).
- **Cancelled tasks stop polling** — `hasActive` now includes `"cancelled"`
  in the terminal-status set.
- **Deep Scan preset complete** — now sets all 5 sites to 6 pages (was only 3).
- **CSV/JSON export complete** — now includes `regionVersion`, `lockStatus`,
  `sellerRating`, `conditionFlags`, `href`, `description`, and 10+ more fields.

### Polish
- **Charts work in dark mode** — new `useChartTheme()` hook provides
  theme-aware colors for Recharts (grid, axes, tooltips, reference lines).
- **Toast text no longer inverted** — `toggleSaved` stale-closure fixed
  (pinning said "unpinned" and vice versa).
- **Type drift fixed** — frontend `NormalizedProduct` now includes
  `regionVersion` + `lockStatus` (matches backend).
- **Duplicate object keys removed** — `MODEL_RELEASE_DATES` had 13 duplicate
  Xiaomi entries.
- **TypeScript errors**: 73 → 1 (pre-existing, non-breaking).
- **ESLint**: 0 errors, 0 warnings.

---

## Known Limitations

- **Vinted scraper**: Often blocked by Cloudflare in datacenter environments.
  Degrades gracefully (OLX-only comparison).
- **Goofish anti-bot**: Baxia CAPTCHA can rate-limit by IP. Use Manual Paste
  mode if blocked.
- **`SKIP_LIVE_FETCH` env var**: Currently not wired into scrapers. The app
  always attempts live scraping and falls back gracefully on failure. To
  force mock data, you'd need to modify the orchestrator.
- **No authentication**: The app has no login. Don't expose it publicly —
  the debug endpoints can launch Playwright browsers (DoS vector).
- **Single-user**: No multi-tenant support. All tasks share one DB.
- **Caddyfile SSRF**: The `XTransformPort` gateway handler is an open proxy
  (anyone can proxy to `localhost:any-port`). Restrict to an allow-list or
  remove in production.

---

## License

Private project. All rights reserved.
