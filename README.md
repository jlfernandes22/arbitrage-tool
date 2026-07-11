# Arbitrage Intelligence Tool

Cross-border electronics arbitrage engine that scrapes Goofish (闲鱼, China, CNY),
OLX.pt and Vinted.pt (Portugal, EUR) concurrently, then calculates net profit
after Portugal import costs (FX conversion, shipping, VAT, customs).

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
# or: npm install

# 3. Install Playwright Chromium (for live scraping)
npx playwright install chromium

# 4. Generate Prisma client (if not already generated)
bun run db:generate

# 5. (Optional) Push schema to DB — the included db/custom.db already has
#    the schema + 41 seeded reference prices, so this is only needed if
#    you want a fresh database.
# bun run db:push

# 6. Build for production (this also copies db/, .env, and Playwright files
#    into .next/standalone/ — required because the standalone server.js
#    changes its working directory to .next/standalone/ at runtime)
bun run build

# 7. Start the production server
bun .next/standalone/server.js
# or: node .next/standalone/server.js
```

The app will be available at `http://localhost:3000`.

### Quick Fix for Existing Builds

If you already ran `bun run build` and are seeing `Unable to open the database file`
errors, the standalone server can't find `db/custom.db` because it changes its
working directory to `.next/standalone/`. Run these commands from the project root:

```bash
cp -r db .next/standalone/
cp .env .next/standalone/
cp node_modules/playwright-core/browsers.json .next/standalone/node_modules/playwright-core/
cp -r node_modules/playwright-core/lib .next/standalone/node_modules/playwright-core/
```

Then restart the server: `bun .next/standalone/server.js`

### Development Mode

```bash
bun install
npx playwright install chromium
bun run db:generate
bun run dev
```

## Environment Variables (.env)

The `.env` file is pre-configured for production:

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

## Features

- **Concurrent scraping**: Goofish + OLX.pt + Vinted.pt in parallel
- **Scam detection**: 4-layer pipeline (price floor, blacklist, seller telemetry, asset quality)
- **Profit calculation**: Landed cost (CNY→EUR + freight + customs + VAT + CTT) vs median EU resale
- **Config presets**: Conversion Only, Realistic Import, Conservative, Deep Scan (6 pages)
- **Results table**: Sortable, with image thumbnails, row hover preview, column toggle, keyboard navigation
- **Charts**: Profit distribution (bar), profit trend across scans (area), profitability heatmap (model × condition)
- **Exports**: CSV, JSON (respects active filters)
- **Keyboard shortcuts**: `/` focus search, `Enter` scan, `j/k` navigate rows, `o` open detail, `b` blueprint, `m` markdown, `x` CSV, `s` pin query, `?` help
- **Saved queries**: Pin frequent searches (localStorage)
- **Scan history**: Delete old scans, re-run past scans
- **Reference price admin**: Bulk CSV import/export, bulk delete, duplicate detection
- **Dark mode**: Full dark theme support
- **Mobile responsive**: Sheet drawer sidebar, responsive layouts

## Architecture

```
src/
├── app/
│   ├── page.tsx              # Single-page dashboard
│   ├── layout.tsx            # Root layout + ThemeProvider
│   └── api/                  # REST API routes (tasks, config)
├── components/arbitrage/     # Dashboard components
├── lib/
│   ├── orchestrator.ts       # Pipeline: concurrent scrape → calc
│   ├── engine/               # Normalizer, scam detector, profit calc, matcher
│   ├── scrapers/             # Goofish, OLX, Vinted, mock-data
│   └── reference-prices.ts   # Reference price service
├── hooks/                    # use-saved-queries, use-keyboard-shortcuts
└── config.json               # Base config
```

## License

Private project.
