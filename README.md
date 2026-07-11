# Arbitrage Intelligence Tool

Cross-border electronics arbitrage engine that scrapes Goofish (闲鱼, China, CNY),
OLX.pt, Vinted.pt, KuantoKusta.pt, and Amazon.es (Portugal/Spain, EUR) concurrently,
then calculates net profit after Portugal import costs (FX conversion, shipping, VAT, customs).

## Tech Stack
- Next.js 16 (App Router, webpack mode)
- TypeScript 5 (strict)
- Prisma ORM + SQLite
- Playwright (real Chromium browser for scraping)
- Tailwind CSS 4 + shadcn/ui (New York style)
- Recharts, next-themes, Sonner

## Production Deployment

### Prerequisites
- Node.js 18+ or Bun
- Playwright Chromium browser

### Steps

```bash
# 1. Extract the tarball
tar xzf arbitrage-intelligence-prod.tar.gz
cd arbitrage-intelligence

# 2. Install dependencies
bun install

# 3. Install Playwright Chromium (for live scraping)
npx playwright install chromium

# 4. Generate Prisma client
bun run db:generate

# 5. Build for production
bun run build

# 6. Start the production server
bun .next/standalone/server.js
```

The app will be available at `http://localhost:3000`.

### Quick Fix for Existing Builds

If you see `Unable to open the database file` errors, run from the project root:

```bash
cp -r db .next/standalone/
cp .env .next/standalone/
cp node_modules/playwright-core/browsers.json .next/standalone/node_modules/playwright-core/
cp -r node_modules/playwright-core/lib .next/standalone/node_modules/playwright-core/
```

Then restart: `bun .next/standalone/server.js`

### Development Mode

```bash
bun install
npx playwright install chromium
bun run db:generate
bun run dev
```

## Environment Variables (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./db/custom.db` | SQLite database path (relative) |
| `SKIP_LIVE_FETCH` | `0` | `0` = real Playwright scraping, `1` = mock data |
| `NODE_OPTIONS` | `--max-old-space-size=2048` | Node memory limit for Playwright + Next.js |

## Database

The `db/custom.db` SQLite file is included with:
- 4 tables: Task, ReferencePrice, MarketComp, ForexRate
- 41 seeded reference prices (iPhone/MacBook/iPad/PS5 SKUs across condition tiers)

Reference prices can be edited via the "Reference Prices" admin dialog in the UI.

## Scrapers

### Goofish (闲鱼) — China, CNY prices
- Uses a **fresh Playwright browser instance** (not shared with other scrapers) to avoid cross-site cookie contamination that triggers Goofish's anti-bot system
- Surgical login modal removal (only `loginCon` + `login-modal` classes, never broad selectors)
- Retry mechanism (2 attempts) with Baxia CAPTCHA detection
- Pagination via page-number box click or right-arrow button
- Price extraction from `row3-wrap-price` elements with child-element-first parsing
- "No results" page detection (blocks recommended products from being extracted)
- Price sanity filter (rejects items < ¥500 to filter accessories)

### OLX.pt — Portugal, EUR prices (second-hand)
- Playwright with `data-cy='l-card'` selector
- Portuguese price format parsing (`1 250 €` → 1250)
- Accessory keyword filtering (case, cover, charger, screen protector, etc.)
- Price range filter: €100–€3000

### Vinted.pt — Portugal, EUR prices (second-hand)
- Playwright with Cloudflare bypass (20s timeout + 2-attempt retry with page reload)
- Multiple card selectors (`feed-grid__item`, `ItemBox`, `item-box`)
- Accessory keyword filtering
- Price range filter: €100–€3000

### KuantoKusta.pt — Portugal, EUR prices (NEW retail)
- HTTP fetch first (different TLS fingerprint), Playwright fallback
- URL: `https://www.kuantokusta.pt/search?q=...` (not `/pesquisa`)
- Akamai WAF stealth headers
- Accessory keyword filtering
- Price range filter: €100–€3000

### Amazon.es — Spain, EUR prices (NEW retail)
- HTTP fetch first (returns full HTML from most IPs), Playwright fallback
- Playwright visits home page first to establish session cookie + WAF token
- `data-component-type='s-search-result'` card extraction
- Accessory keyword filtering
- Price range filter: €100–€3000

### Listing Enrichment (Goofish)
- Opens each Goofish listing page to extract:
  - Seller rating (好评率97%) from `item-user-info-label`
  - Image count from `item-main-window-list-item` elements
  - Full image URLs from listing page (not search thumbnails)
  - Condition flags (Repaired, Screen Replaced, Battery Replaced, No Box, Water Damage, All Original, Never Opened, etc.)
- Toggle: "Enrich all listings" switch in the control panel
  - OFF: No enrichment (fast scan, condition flags only)
  - ON: Enrich ALL listings (slower, complete seller ratings + images)

## Risk Scoring

Risk is based on **seller rating** (not price deviation):
- ≥95% positive feedback → 0 risk (high trust)
- 85–94% → +15 risk (moderate)
- 70–84% → +30 risk (low)
- <70% → +50 risk (very low)
- No rating → +20 risk (unknown)

Additional risk layers:
- Critical blacklist tokens (组装, 山寨, 翻新, 进水, etc.) → auto-drop (risk=100)
- Yellow modifiers (换屏, 换电池, 维修过, etc.) → +20 each (capped at 40)
- Image count < 2 → +15 risk
- Description < 20 chars → +10 risk

## Features

- **Concurrent scraping**: Goofish + OLX + Vinted + KuantoKusta + Amazon in parallel
- **Scam detection**: Seller-rating-based risk + blacklist + condition flags
- **Profit calculation**: Landed cost (CNY→EUR + freight + customs + VAT + CTT) vs median EU resale
- **Config presets**: Conversion Only, Realistic Import, Conservative, Deep Scan (6 pages)
- **Enrichment toggle**: Enable/disable seller rating + image enrichment per scan
- **Results table**: Sortable, image thumbnails, row hover preview, column toggle, keyboard navigation
- **Charts**: Profit distribution (bar), profit trend across scans (area), profitability heatmap (model × condition)
- **Exports**: CSV, JSON (respects active filters)
- **Keyboard shortcuts**: `/` focus search, `Enter` scan, `j/k` navigate rows, `o` open detail, `b` blueprint, `m` markdown, `x` CSV, `s` pin query, `?` help
- **Saved queries**: Pin frequent searches (localStorage)
- **Scan history**: Delete old scans, re-run past scans
- **EU market links**: Collapsible list of all EU comps with links to original listings (in sidebar below Scan History)
- **Reference price admin**: Bulk CSV import/export, bulk delete, duplicate detection
- **Debug scrapers**: Unified debug panel with individual buttons for each scraper + "Run All" button
- **Debug endpoints**: `/api/debug/goofish`, `/api/debug/olx`, `/api/debug/vinted`, `/api/debug/kuantokusta`, `/api/debug/amazon`
- **Dark mode**: Full dark theme support
- **Mobile responsive**: Sheet drawer sidebar, responsive layouts

## Architecture

```
src/
├── app/
│   ├── page.tsx              # Single-page dashboard
│   ├── layout.tsx            # Root layout + ThemeProvider
│   └── api/                  # REST API routes
│       ├── tasks/            # submit, status, result, list, delete, reevaluate, manual_paste
│       ├── config/           # reference prices CRUD + bulk import/export
│       └── debug/            # debug endpoints for each scraper
├── components/arbitrage/     # Dashboard components
│   ├── control-panel.tsx     # Search + presets + config + debug + enrichment toggle
│   ├── results-table.tsx     # Sortable table with images, condition flags, seller ratings
│   ├── listing-detail.tsx    # Full breakdown dialog
│   ├── summary-cards.tsx     # Clickable metric cards
│   ├── profit-chart.tsx      # Bar chart (current scan)
│   ├── profit-trend-chart.tsx # Area chart (across scans)
│   ├── profit-heatmap.tsx    # Model × condition heatmap
│   ├── task-history.tsx      # Sidebar history + saved queries
│   ├── terminal-console.tsx  # Live backend log stream
│   ├── reference-editor.tsx  # Admin price matrix editor
│   └── csv-export.ts         # CSV + JSON export
├── lib/
│   ├── orchestrator.ts       # Pipeline: concurrent scrape → calc
│   ├── engine/               # Normalizer, scam detector, profit calc, matcher
│   ├── scrapers/             # Goofish, OLX, Vinted, KuantoKusta, Amazon, mock-data
│   └── reference-prices.ts   # Reference price service
├── hooks/                    # use-saved-queries, use-keyboard-shortcuts
└── config.json               # Base config
```

## Git Setup

```bash
# Initialize
git init
git add .
git commit -m "Initial commit: Arbitrage Intelligence Tool"

# Add remote
git remote add origin https://github.com/YOUR_USERNAME/arbitrage-tool.git
git branch -M main
git push -u origin main

# Ongoing development
git add .
git commit -m "Description of changes"
git push
```

**Note:** `.env` is in `.gitignore` (contains config, not committed). `node_modules/` and `.next/` are also excluded. The `db/custom.db` file IS included (seeded reference prices).

## License

Private project.
