// Client-side types & preset catalog for the arbitrage dashboard.
export type Category = "iphone" | "macbook" | "ipad" | "ps5" | "samsung" | "applewatch" | "dji" | "xiaomi" | "gaming";
export type Condition =
  | "new"
  | "open_box"
  | "excellent"
  | "very_good"
  | "good"
  | "fair"
  | "unknown";
export interface NormalizedProduct {
  standardKey: string;
  category: Category;
  family?: string;
  model?: string;
  storageGB?: number;
  color?: string;
  batteryHealth?: number;
  chip?: string;
  ramGB?: number;
  displayInch?: number;
  releaseYear?: number;
  connectivity?: "wifi" | "cellular";
  formFactor?: string;
  driveConfig?: string;
  // Region version: which market the device was sold for.
  // CRITICAL for arbitrage — a China-market iPhone may have different band
  // support / dual-SIM config than an EU model, and certain region-locked
  // units cannot be activated outside China.
  regionVersion?: "china" | "international" | "us" | "japan" | "korea" | "unknown";
  // Lock status: whether the device is free to use on any carrier / has no
  // activation locks. A locked Chinese-market iPhone cannot be used in
  // Portugal and is effectively worthless there — this field MUST be present
  // on the frontend type so the listing-detail dialog compiles cleanly.
  lockStatus?: "unlocked" | "carrier_locked" | "icloud_locked" | "mdm_locked" | "unknown";
  condition: Condition;
  conditionRaw?: string;
}
export interface GoofishListing {
  id: string;
  title: string;
  priceCny: number;
  description: string;
  imageUrls: string[];
  sellerLocation: string;
  wantsCount: number;
  sellerVerified: boolean;
  sellerVerifiedTransactions: number;
  rawText: string;
  source: "goofish";
  normalized: NormalizedProduct | null;
  href?: string;
  sellerRating?: number;
  imageCount?: number;
  conditionFlags?: string[];
}
export interface EuMarketComp {
  id: string;
  // platform: "olx"|"vinted" → second-hand; "kuantokusta"|"amazon" → NEW retail
  platform: "olx" | "vinted" | "kuantokusta" | "amazon";
  title: string;
  priceEur: number;
  condition: Condition;
  // Direct link to the marketplace listing (not a search URL).
  url?: string;
  location?: string;
  vendorType?: string;
  negotiable?: boolean;
  viewCount?: number;
  brand?: string;
  sellerStars?: number;
  bundleDiscount?: number;
  // isRetail: true for NEW retail sources (KuantoKusta, Amazon).
  isRetail?: boolean;
}
export interface ScamReport {
  riskScore: number;
  dropped: boolean;
  reasons: string[];
  matchedBlacklistTokens: string[];
  matchedYellowTokens: string[];
}
export interface LandedCostBreakdown {
  priceCny: number;
  cnyToEurRate: number;
  exchangeFeeRate: number;
  acquisitionCostEur: number; // price_cny * rate * (1 + exchange_fee)
  // ── Buying agent fees (CSS Buy / Superbuy / Wegobuy) ──
  agentServiceFeeEur: number; // agent service fee (% of acquisition)
  inspectionFeeEur: number; // photo/inspection fee (flat per item)
  domesticShippingCnEur: number; // seller → agent warehouse shipping
  insuranceFeeEur: number; // shipping insurance (% of acquisition)
  // ── International shipping ──
  internationalShippingEur: number; // air freight to EU (by weight)
  // ── Customs & taxes ──
  customsClearanceEur: number; // broker fee
  importDutyEur: number; // import duty (% depends on category)
  importVatEur: number; // PT VAT 23% on (acq + agent fees + shipping + duty)
  // ── Portugal domestic ──
  domesticShippingEur: number; // CTT / local courier
  totalLandedCostEur: number; // grand total
}
export interface ProfitAnalysis {
  expectedResaleEur: number;
  resaleFeeEur: number;
  netResaleEur: number;
  landed: LandedCostBreakdown;
  netProfitEur: number;
  marginPct: number;
  meetsMinMargin: boolean;
  meetsMinProfit: boolean;
  hidden: boolean;
  resaleSource?: string;
}
export interface EvaluatedListing {
  listing: GoofishListing;
  scam: ScamReport;
  profit: ProfitAnalysis;
  euComps: EuMarketComp[];
  hidden: boolean;
  hiddenReason?: string;
}
export interface TaskSummary {
  total: number;
  shown: number;
  hiddenScam: number;
  hiddenProfit: number;
  avgMarginPct: number;
  avgRiskScore: number;
  bestProfitEur: number;
  bestMarginPct: number;
}
export interface TaskResult {
  taskId: string;
  query: string;
  category: Category;
  status: string;
  listings: EvaluatedListing[];
  summary: TaskSummary;
  warnings: string[];
  degraded: boolean;
  createdAt: string;
  finishedAt?: string;
}
export interface TaskStatusResponse {
  task_id: string;
  query: string;
  category: Category;
  status: string;
  progress: number;
  step: string;
  error?: string;
  warnings: string[];
  degraded: boolean;
  started_at: string;
  finished_at: string | null;
  logs: LogEntry[];
  estimated_sec?: number;
}
export type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS";
export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}
export interface AppConfigOverrides {
  forex?: {
    cny_to_eur_rate?: number;
    exchange_fee?: number;
  };
  logistics?: {
    forwarder_type?: string;
    agent_service_fee_rate?: number;
    inspection_fee_eur?: number;
    domestic_shipping_cn_eur?: number;
    insurance_fee_rate?: number;
    international_shipping_eur?: number;
    customs_clearance_fee_eur?: number;
    import_duty_rate?: number;
    domestic_shipping_eur?: number;
  };
  tax?: {
    pt_vat_rate?: number;
  };
  profitability?: {
    min_margin_pct?: number;
    min_net_profit_eur?: number;
  };
  scam_filter?: {
    hide_threshold?: number;
  };
  scraping?: {
    max_pages?: number;
    goofish_pages?: number;
    olx_pages?: number;
    vinted_pages?: number;
    kuantokusta_pages?: number;
    amazon_pages?: number;
    skip_vinted?: boolean;
    skip_olx?: boolean;
    skip_kuantokusta?: boolean;
    skip_amazon?: boolean;
    // Master: skip ALL new/retail sources (KuantoKusta + Amazon)
    skip_new?: boolean;
    // Master: skip ALL second-hand sources (OLX + Vinted)
    skip_used?: boolean;
    min_price_cny?: number;
    max_price_cny?: number;
    enrich_all?: boolean; // if true, enrich ALL listings (not just top 10)
  };
}
export interface PresetItem {
  label: string;
  query: string;
  category: Category;
}
export const CATEGORY_LABELS: Record<Category, string> = {
  iphone: "iPhone",
  macbook: "MacBook",
  ipad: "iPad",
  ps5: "PlayStation 5",
  samsung: "Samsung",
  applewatch: "Apple Watch",
  dji: "DJI",
  xiaomi: "Xiaomi",
  gaming: "Gaming",
};

// ── Brand-first hierarchical catalog ─────────────────────────────────
// Brand → Product Type → Generation (with year) → Specific model
// Drives the 5-step wizard: Brand → Product Type → Generation → Model → Storage
export interface ModelVariant {
  label: string;
  query: string;
  releaseDate?: string; // Per-model release date (inherited from generation in post-processing)
}
export interface Generation {
  id: string;
  label: string;
  year: string;
  releaseDate?: string; // More specific release date, e.g. "Sept 2025", "May 2024", "2026"
  range?: string; // "Flagship" | "Flagship Killer" | "Mid-Range" — used to group phone generations
  models: ModelVariant[];
}
export interface ProductType {
  id: string;       // unique within brand
  category: Category; // maps to backend Category
  label: string;
  emoji: string;
  hasStorage: boolean;
  hasRangeFilter: boolean; // if true, show a "Which range?" step before generation
  generations: Generation[];
}
export interface Brand {
  id: string;
  label: string;
  emoji: string;
  productTypes: ProductType[];
}

// Helper to create generations more concisely
function gen(id: string, label: string, year: string, models: [string, string][], range?: string): Generation {
  return { id, label, year, range, models: models.map(([l, q]) => ({ label: l, query: q })) };
}

export const BRAND_CATALOG: Brand[] = [
  // ── ANKER NEBULA ──
  {
    id: "nebula", label: "Anker Nebula", emoji: "📽️",
    productTypes: [
      {
        id: "nebula-projectors", category: "gaming", label: "Nebula Projectors", emoji: "📽️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("nebula-capsule", "Capsule Series", "2018", [
            ["Capsule 3 Laser", "Anker Nebula Capsule 3 Laser"], ["Capsule Max", "Anker Nebula Capsule Max"], ["Capsule II", "Anker Nebula Capsule II"],
          ]),
          gen("nebula-mars", "Mars Series", "2018", [
            ["Mars 3", "Anker Nebula Mars 3"], ["Mars II Pro", "Anker Nebula Mars II Pro"],
          ]),
          gen("nebula-cosmos", "Cosmos Series", "2020", [
            ["Cosmos 4K", "Anker Nebula Cosmos 4K"], ["Cosmos Laser 1080p", "Anker Nebula Cosmos Laser 1080p"],
          ]),
        ],
      },
    ],
  },
  // ── APPLE ──
  {
    id: "apple", label: "Apple", emoji: "🍎",
    productTypes: [
      {
        id: "iphone", category: "iphone", label: "iPhone", emoji: "📱", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("iphone-17", "iPhone 17 Series", "2025", [
            ["iPhone 17", "iPhone 17"], ["iPhone 17 Pro", "iPhone 17 Pro"],
            ["iPhone 17 Pro Max", "iPhone 17 Pro Max"], ["iPhone 17 Plus", "iPhone 17 Plus"],
            ["iPhone 17 Air", "iPhone 17 Air"],
          ]),
          gen("iphone-16", "iPhone 16 Series", "2024", [
            ["iPhone 16", "iPhone 16"], ["iPhone 16 Pro", "iPhone 16 Pro"],
            ["iPhone 16 Pro Max", "iPhone 16 Pro Max"], ["iPhone 16 Plus", "iPhone 16 Plus"],
          ]),
          gen("iphone-15", "iPhone 15 Series", "2023", [
            ["iPhone 15", "iPhone 15"], ["iPhone 15 Plus", "iPhone 15 Plus"],
            ["iPhone 15 Pro", "iPhone 15 Pro"], ["iPhone 15 Pro Max", "iPhone 15 Pro Max"],
          ]),
          gen("iphone-14", "iPhone 14 Series", "2022", [
            ["iPhone 14", "iPhone 14"], ["iPhone 14 Plus", "iPhone 14 Plus"],
            ["iPhone 14 Pro", "iPhone 14 Pro"], ["iPhone 14 Pro Max", "iPhone 14 Pro Max"],
          ]),
          gen("iphone-13", "iPhone 13 Series", "2021", [
            ["iPhone 13 Mini", "iPhone 13 Mini"], ["iPhone 13", "iPhone 13"],
            ["iPhone 13 Pro", "iPhone 13 Pro"], ["iPhone 13 Pro Max", "iPhone 13 Pro Max"],
          ]),
        ],
      },
      {
        id: "macbook", category: "macbook", label: "MacBook", emoji: "💻", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("macbook-m5", "M5 Series", "2025", [
            ["MacBook Pro M5", "MacBook Pro M5"], ["MacBook Pro M5 Pro", "MacBook Pro M5 Pro"],
            ["MacBook Pro M5 Max", "MacBook Pro M5 Max"], ["MacBook Air M5", "MacBook Air M5"],
          ]),
          gen("macbook-m4", "M4 Series", "2024", [
            ["MacBook Pro M4", "MacBook Pro M4"], ["MacBook Pro M4 Pro", "MacBook Pro M4 Pro"],
            ["MacBook Pro M4 Max", "MacBook Pro M4 Max"],
          ]),
          gen("macbook-m3", "M3 Series", "2023", [
            ["MacBook Pro M3", "MacBook Pro M3"], ["MacBook Pro M3 Pro", "MacBook Pro M3 Pro"],
            ["MacBook Air M3", "MacBook Air M3"],
          ]),
          gen("macbook-m2", "M2 Series", "2022", [
            ["MacBook Pro M2", "MacBook Pro M2"], ["MacBook Air M2", "MacBook Air M2"],
          ]),
          gen("macbook-m1", "M1 Series", "2020", [
            ["MacBook Air M1", "MacBook Air M1"],
          ]),
        ],
      },
      {
        id: "ipad", category: "ipad", label: "iPad", emoji: "📋", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("ipad-m5", "iPad Pro M5", "2025", [
            ["iPad Pro M5 11\"", "iPad Pro M5 11"], ["iPad Pro M5 13\"", "iPad Pro M5 13"],
          ]),
          gen("ipad-m4", "iPad Pro M4", "2024", [
            ["iPad Pro M4 11\"", "iPad Pro M4 11"], ["iPad Pro M4 13\"", "iPad Pro M4 13"],
          ]),
          gen("ipad-air-m2", "iPad Air M2", "2024", [
            ["iPad Air M2 11\"", "iPad Air M2 11"], ["iPad Air M2 13\"", "iPad Air M2 13"],
          ]),
          gen("ipad-older", "Older iPads", "2021", [
            ["iPad Pro 11\"", "iPad Pro 11"], ["iPad Pro 12.9\"", "iPad Pro 12.9"],
            ["iPad Air 5", "iPad Air 5"], ["iPad Mini 7", "iPad Mini 7"],
            ["iPad Mini 6", "iPad Mini 6"], ["iPad 10", "iPad 10"],
          ]),
        ],
      },
      {
        id: "applewatch", category: "applewatch", label: "Apple Watch", emoji: "⌚", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("watch-series-11", "Series 11", "2025", [
            ["Series 11 41mm", "Apple Watch Series 11 41mm"], ["Series 11 45mm", "Apple Watch Series 11 45mm"],
          ]),
          gen("watch-ultra-3", "Ultra 3", "2025", [
            ["Ultra 3", "Apple Watch Ultra 3"],
          ]),
          gen("watch-se-3", "SE 3", "2025", [
            ["SE 3 40mm", "Apple Watch SE 3 40mm"], ["SE 3 44mm", "Apple Watch SE 3 44mm"],
          ]),
          gen("watch-series-10", "Series 10", "2024", [
            ["Series 10 42mm", "Apple Watch Series 10 42mm"], ["Series 10 46mm", "Apple Watch Series 10 46mm"],
          ]),
          gen("watch-ultra-2", "Ultra 2", "2023", [
            ["Ultra 2", "Apple Watch Ultra 2"],
          ]),
          gen("watch-series-9", "Series 9", "2023", [
            ["Series 9 41mm", "Apple Watch Series 9 41mm"], ["Series 9 45mm", "Apple Watch Series 9 45mm"],
          ]),
        ],
      },
    ],
  },
  // ── ASUS ──
  {
    id: "asus", label: "ASUS", emoji: "🛡️",
    productTypes: [
      {
        id: "asus-rog-laptops", category: "gaming", label: "ROG Laptops", emoji: "💻", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("asus-rog-laptops", "ROG Laptops", "2024", [
            ["ROG Strix Scar 18 (2025)", "ASUS ROG Strix Scar 18 2025"],
            ["ROG Strix Scar 16 (2025)", "ASUS ROG Strix Scar 16 2025"],
            ["ROG Zephyrus G16 (2025)", "ASUS ROG Zephyrus G16 2025"],
            ["ROG Zephyrus G14 (2025)", "ASUS ROG Zephyrus G14 2025"],
            ["ROG Flow X16 (2024)", "ASUS ROG Flow X16 2024"],
          ], "Flagship"),
        ],
      },
      {
        id: "asus-rog-handhelds", category: "gaming", label: "ROG Handhelds", emoji: "🕹️", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("asus-rog-ally", "ROG Ally", "2023", [
            ["ROG Ally X", "ASUS ROG Ally X"],
            ["ROG Ally", "ASUS ROG Ally"],
          ]),
        ],
      },
      {
        id: "asus-rog-monitors", category: "gaming", label: "ROG Monitors", emoji: "🖥️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("asus-rog-monitors", "ROG Monitors", "2023", [
            ["ROG Swift PG32UCDM", "ASUS ROG Swift PG32UCDM"],
            ["ROG Swift PG27AQDM", "ASUS ROG Swift PG27AQDM"],
            ["ROG Swift OLED PG34WCDM", "ASUS ROG Swift OLED PG34WCDM"],
            ["ROG Strix XG27AQ", "ASUS ROG Strix XG27AQ"],
          ]),
        ],
      },
      {
        id: "asus-rog-mice", category: "gaming", label: "ROG Mice", emoji: "🖱️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("asus-rog-mice", "ROG Mice", "2023", [
            ["ROG Harpe Ace Aim Lab", "ASUS ROG Harpe Ace Aim Lab"],
            ["ROG Gladius III", "ASUS ROG Gladius III"],
            ["ROG Spatha X", "ASUS ROG Spatha X"],
            ["ROG Chakram X", "ASUS ROG Chakram X"],
          ]),
        ],
      },
      {
        id: "asus-rog-keyboards", category: "gaming", label: "ROG Keyboards", emoji: "⌨️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("asus-rog-keyboards", "ROG Keyboards", "2023", [
            ["ROG Azoth Extreme", "ASUS ROG Azoth Extreme"],
            ["ROG Azoth", "ASUS ROG Azoth"],
            ["ROG Strix Scope II 96", "ASUS ROG Strix Scope II 96"],
            ["ROG Falchion RX Low Profile", "ASUS ROG Falchion RX Low Profile"],
          ]),
        ],
      },
      {
        id: "asus-rog-headsets", category: "gaming", label: "ROG Headsets", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("asus-rog-headsets", "ROG Headsets", "2023", [
            ["ROG Delta II", "ASUS ROG Delta II"],
            ["ROG Delta S Animate", "ASUS ROG Delta S Animate"],
            ["ROG Delta S", "ASUS ROG Delta S"],
            ["ROG Strix Fusion II 300", "ASUS ROG Strix Fusion II 300"],
          ]),
        ],
      },
      {
        id: "asus-tuf-laptops", category: "gaming", label: "TUF Laptops", emoji: "💻", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("asus-tuf-laptops", "TUF Laptops", "2024", [
            ["TUF Gaming A16 (2025)", "ASUS TUF Gaming A16 2025"],
            ["TUF Gaming F16 (2025)", "ASUS TUF Gaming F16 2025"],
            ["TUF Gaming A15 (2024)", "ASUS TUF Gaming A15 2024"],
          ], "Mid-Range"),
        ],
      },
    ],
  },
  // ── BOSE ──
  {
    id: "bose", label: "Bose", emoji: "🔊",
    productTypes: [
      {
        id: "bose-speakers", category: "gaming", label: "Bose Speakers", emoji: "🔊", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("bose-portable", "Portable Series", "2020", [
            ["SoundLink Flex", "Bose SoundLink Flex"], ["SoundLink Revolve+ II", "Bose SoundLink Revolve Plus II"], ["SoundLink Revolve II", "Bose SoundLink Revolve II"],
          ]),
          gen("bose-home", "Home Speaker Series", "2018", [
            ["Home Speaker 500", "Bose Home Speaker 500"], ["Smart Speaker 300", "Bose Smart Speaker 300"],
          ]),
        ],
      },
      {
        id: "bose-headphones", category: "gaming", label: "Bose Headphones", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("bose-qc", "QuietComfort Series", "2019", [
            ["QuietComfort Ultra", "Bose QuietComfort Ultra"], ["QuietComfort 45", "Bose QuietComfort 45"], ["QuietComfort", "Bose QuietComfort"],
          ]),
          gen("bose-700", "Noise Cancelling 700", "2019", [["Bose NC 700", "Bose Noise Cancelling 700"]]),
        ],
      },
    ],
  },
  // ── CANON ──
  {
    id: "canon", label: "Canon", emoji: "📷",
    productTypes: [
      {
        id: "canon-cameras", category: "dji", label: "Canon Cameras", emoji: "📷", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("canon-r5", "EOS R5 Series", "2020", [
            ["EOS R5", "Canon EOS R5"], ["EOS R5 Mark II", "Canon EOS R5 Mark II"],
          ]),
          gen("canon-r6", "EOS R6 Series", "2020", [
            ["EOS R6", "Canon EOS R6"], ["EOS R6 Mark II", "Canon EOS R6 Mark II"],
          ]),
          gen("canon-r3", "EOS R3", "2021", [["EOS R3", "Canon EOS R3"]]),
          gen("canon-r8", "EOS R8", "2023", [["EOS R8", "Canon EOS R8"]]),
          gen("canon-rp", "EOS RP", "2019", [["EOS RP", "Canon EOS RP"]]),
          gen("canon-90d", "EOS 90D", "2019", [["EOS 90D", "Canon EOS 90D"]]),
        ],
      },
    ],
  },
  // ── CORSAIR ──
  {
    id: "corsair", label: "Corsair", emoji: "⚔️",
    productTypes: [
      {
        id: "corsair-mice", category: "gaming", label: "Corsair Mice", emoji: "🖱️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("corsair-mice", "Corsair Mice", "2022", [
            ["M65 RGB Ultra", "Corsair M65 RGB Ultra"],
            ["Sabre RGB Pro", "Corsair Sabre RGB Pro"],
            ["Katar Pro XT", "Corsair Katar Pro XT"],
            ["Harpoon RGB Pro", "Corsair Harpoon RGB Pro"],
          ]),
        ],
      },
      {
        id: "corsair-keyboards", category: "gaming", label: "Corsair Keyboards", emoji: "⌨️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("corsair-keyboards", "Corsair Keyboards", "2022", [
            ["K100 RGB", "Corsair K100 RGB"],
            ["K70 MAX", "Corsair K70 MAX"],
            ["K70 RGB PRO", "Corsair K70 RGB PRO"],
            ["K65 PRO Mini", "Corsair K65 PRO Mini"],
            ["K70 RGB TKL", "Corsair K70 RGB TKL"],
          ]),
        ],
      },
      {
        id: "corsair-headsets", category: "gaming", label: "Corsair Headsets", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("corsair-headsets", "Corsair Headsets", "2022", [
            ["Virtuoso Max", "Corsair Virtuoso Max"],
            ["Virtuoso RGB Wireless XT", "Corsair Virtuoso RGB Wireless XT"],
            ["HS80 RGB", "Corsair HS80 RGB"],
            ["Void RGB Elite", "Corsair Void RGB Elite"],
          ]),
        ],
      },
      {
        id: "corsair-cases", category: "gaming", label: "Corsair Cases", emoji: "🖥️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("corsair-cases", "Corsair Cases", "2022", [
            ["5000D Airflow", "Corsair 5000D Airflow"],
            ["4000D Airflow", "Corsair 4000D Airflow"],
            ["iCUE 5000X RGB", "Corsair iCUE 5000X RGB"],
            ["7000D Airflow", "Corsair 7000D Airflow"],
          ]),
        ],
      },
      {
        id: "corsair-coolers", category: "gaming", label: "Corsair Coolers", emoji: "❄️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("corsair-coolers", "Corsair Coolers", "2022", [
            ["iCUE H150i Elite LCD", "Corsair iCUE H150i Elite LCD"],
            ["H100i Elite LCD", "Corsair H100i Elite LCD"],
            ["iCUE H150i Elite Capellix", "Corsair iCUE H150i Elite Capellix"],
          ]),
        ],
      },
    ],
  },
  // ── DJI ──
  {
    id: "dji", label: "DJI", emoji: "🚁",
    productTypes: [
      {
        id: "dji-drone", category: "dji", label: "Drones", emoji: "🚁", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("dji-mavic-4", "Mavic 4 Series", "2025", [
            ["Mavic 4 Pro", "DJI Mavic 4 Pro"], ["Mavic 4", "DJI Mavic 4"],
          ]),
          gen("dji-air-3s", "Air 3S", "2024", [["Air 3S", "DJI Air 3S"]]),
          gen("dji-avata-2", "Avata 2", "2024", [["Avata 2", "DJI Avata 2"]]),
          gen("dji-mini-4", "Mini 4 Series", "2023", [["Mini 4 Pro", "DJI Mini 4 Pro"]]),
          gen("dji-mavic-3", "Mavic 3 Series", "2021", [
            ["Mavic 3 Pro", "DJI Mavic 3 Pro"], ["Mavic 3 Cine", "DJI Mavic 3 Cine"], ["Mavic 3", "DJI Mavic 3"],
          ]),
          gen("dji-air-3", "Air 3", "2023", [["Air 3", "DJI Air 3"]]),
          gen("dji-mini-3", "Mini 3 Series", "2022", [
            ["Mini 3 Pro", "DJI Mini 3 Pro"], ["Mini 3", "DJI Mini 3"],
          ]),
          gen("dji-avata", "Avata (original)", "2022", [["Avata", "DJI Avata"]]),
          gen("dji-fpv", "FPV", "2021", [["FPV", "DJI FPV"]]),
          gen("dji-inspire-3", "Inspire 3", "2023", [["Inspire 3", "DJI Inspire 3"]]),
        ],
      },
      {
        id: "dji-gimbal", category: "dji", label: "Gimbals", emoji: "🎥", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("dji-rs-4", "RS 4 Series", "2024", [["RS 4 Pro", "DJI RS 4 Pro"], ["RS 4", "DJI RS 4"]]),
          gen("dji-rs-3", "RS 3 Series", "2022", [["RS 3 Pro", "DJI RS 3 Pro"], ["RS 3", "DJI RS 3"]]),
          gen("dji-osmo-mobile", "Osmo Mobile", "2024", [["Osmo Mobile 7", "DJI Osmo Mobile 7"], ["Osmo Mobile 6", "DJI Osmo Mobile 6"]]),
        ],
      },
      {
        id: "dji-camera", category: "dji", label: "Cameras", emoji: "📷", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("dji-pocket-4", "Osmo Pocket 4", "2025", [
            ["Osmo Pocket 4", "DJI Osmo Pocket 4"], ["Osmo Pocket 4 Pro", "DJI Osmo Pocket 4 Pro"],
          ]),
          gen("dji-pocket-3", "Osmo Pocket 3", "2023", [
            ["Osmo Pocket 3", "DJI Osmo Pocket 3"], ["Osmo Pocket 3 Creator Combo", "DJI Osmo Pocket 3 Creator Combo"],
          ]),
          gen("dji-pocket-2", "Osmo Pocket 2", "2020", [["Osmo Pocket 2", "DJI Osmo Pocket 2"]]),
          gen("dji-action", "Osmo Action", "2024", [
            ["Osmo Action 6", "DJI Osmo Action 6"], ["Osmo Action 5 Pro", "DJI Osmo Action 5 Pro"], ["Osmo Action 4", "DJI Osmo Action 4"], ["Osmo Action 3", "DJI Osmo Action 3"],
          ]),
        ],
      },
      {
        id: "dji-mic", category: "dji", label: "Audio", emoji: "🎙️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("dji-mic-2", "DJI Mic 2", "2024", [["DJI Mic 2", "DJI Mic 2"]]),
          gen("dji-mic-1", "DJI Mic", "2022", [["DJI Mic", "DJI Mic"]]),
        ],
      },
    ],
  },
  // ── DYSON ──
  {
    id: "dyson", label: "Dyson", emoji: "🌀",
    productTypes: [
      {
        id: "dyson-vacuums", category: "gaming", label: "Dyson Vacuums", emoji: "🌀", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("dyson-v15", "V15 Series", "2021", [
            ["V15 Detect", "Dyson V15 Detect"], ["V15 Detect Gen 2", "Dyson V15 Detect Gen 2"], ["V15s Detect Submarine", "Dyson V15s Detect Submarine"],
          ]),
          gen("dyson-v12", "V12 Series", "2021", [
            ["V12 Detect Slim", "Dyson V12 Detect Slim"],
          ]),
          gen("dyson-v11", "V11 Series", "2019", [
            ["V11 Absolute", "Dyson V11 Absolute"], ["V11 Torque Drive", "Dyson V11 Torque Drive"],
          ]),
          gen("dyson-gen5", "Gen 5 Series", "2022", [
            ["Gen 5 Detect", "Dyson Gen 5 Detect"], ["Gen 5 Outsize", "Dyson Gen 5 Outsize"],
          ]),
        ],
      },
      {
        id: "dyson-hair", category: "gaming", label: "Dyson Hair Care", emoji: "💨", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("dyson-airwrap", "Airwrap Series", "2018", [
            ["Airwrap Complete", "Dyson Airwrap Complete"], ["Airwrap Multi-styler", "Dyson Airwrap Multi-styler"],
          ]),
          gen("dyson-supersonic", "Supersonic Series", "2016", [
            ["Supersonic Hair Dryer", "Dyson Supersonic Hair Dryer"], ["Supersonic Nural", "Dyson Supersonic Nural"],
          ]),
          gen("dyson-corrale", "Corrale", "2020", [["Corrale Hair Straightener", "Dyson Corrale Hair Straightener"]]),
          gen("dyson-airstrait", "Airstrait", "2023", [["Airstrait", "Dyson Airstrait"]]),
        ],
      },
    ],
  },
  // ── ECOVACS ──
  {
    id: "ecovacs", label: "Ecovacs", emoji: "🤖",
    productTypes: [
      {
        id: "ecovacs-robots", category: "gaming", label: "Ecovacs Robots", emoji: "🤖", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("ecovacs-x", "X Series", "2023", [
            ["Deebot X2 Omni", "Ecovacs Deebot X2 Omni"], ["Deebot X1 Omni", "Ecovacs Deebot X1 Omni"],
          ]),
          gen("ecovacs-t", "T Series", "2023", [
            ["Deebot T30 Pro", "Ecovacs Deebot T30 Pro"], ["Deebot T20 Omni", "Ecovacs Deebot T20 Omni"],
          ]),
        ],
      },
    ],
  },
  // ── FUJIFILM ──
  {
    id: "fujifilm", label: "Fujifilm", emoji: "📷",
    productTypes: [
      {
        id: "fujifilm-cameras", category: "dji", label: "Fujifilm Cameras", emoji: "📷", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("fuji-x-t5", "X-T5", "2022", [["X-T5", "Fujifilm X-T5"]]),
          gen("fuji-x-h2", "X-H2 Series", "2022", [
            ["X-H2", "Fujifilm X-H2"], ["X-H2S", "Fujifilm X-H2S"],
          ]),
          gen("fuji-x100", "X100 Series", "2020", [
            ["X100VI", "Fujifilm X100VI"], ["X100V", "Fujifilm X100V"],
          ]),
          gen("fuji-x-t4", "X-T4", "2020", [["X-T4", "Fujifilm X-T4"]]),
          gen("fuji-x-pro3", "X-Pro3", "2019", [["X-Pro3", "Fujifilm X-Pro3"]]),
          gen("fuji-gfx", "GFX Series", "2021", [
            ["GFX 100S", "Fujifilm GFX 100S"], ["GFX 50S II", "Fujifilm GFX 50S II"],
          ]),
        ],
      },
    ],
  },
  // ── GOPRO ──
  {
    id: "gopro", label: "GoPro", emoji: "📹",
    productTypes: [
      {
        id: "gopro-hero", category: "dji", label: "HERO Series", emoji: "📹", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("hero-13", "HERO 13 Black", "2024", [["HERO 13 Black", "GoPro HERO 13 Black"]]),
          gen("hero-12", "HERO 12 Black", "2023", [["HERO 12 Black", "GoPro HERO 12 Black"]]),
          gen("hero-11", "HERO 11", "2022", [["HERO 11 Black", "GoPro HERO 11 Black"], ["HERO 11 Mini", "GoPro HERO 11 Mini"]]),
        ],
      },
      {
        id: "gopro-360", category: "dji", label: "360 Cameras", emoji: "🥽", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("gopro-max2", "MAX 2", "2025", [["MAX 2", "GoPro MAX 2"]]),
          gen("gopro-max", "MAX (Original)", "2019", [["MAX", "GoPro MAX"]]),
        ],
      },
      {
        id: "gopro-lit", category: "dji", label: "LIT HERO", emoji: "💡", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("lit-hero", "LIT HERO", "2025", [["LIT HERO", "GoPro LIT HERO"]]),
        ],
      },
    ],
  },
  // ── GAMING ──
  {
    id: "gaming", label: "Handhelds", emoji: "🕹️",
    productTypes: [
      {
        id: "handhelds", category: "gaming", label: "Handhelds", emoji: "🕹️", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("steam-deck", "Steam Deck", "2022", [
            ["Steam Deck OLED", "Steam Deck OLED"], ["Steam Deck LCD", "Steam Deck LCD"],
          ]),
          gen("legion-go", "Legion Go", "2023", [["Legion Go", "Lenovo Legion Go"]]),
          gen("rog-ally", "ROG Ally", "2023", [
            ["ROG Ally X", "ASUS ROG Ally X"], ["ROG Ally", "ASUS ROG Ally"],
          ]),
          gen("switch-2", "Nintendo Switch 2", "2025", [["Switch 2", "Nintendo Switch 2"]]),
          gen("switch-1", "Nintendo Switch (Original)", "2017", [
            ["Switch OLED", "Nintendo Switch OLED"], ["Switch V2", "Nintendo Switch V2"], ["Switch Lite", "Nintendo Switch Lite"],
          ]),
        ],
      },
    ],
  },
  // ── HONOR ──
  {
    id: "honor", label: "Honor", emoji: "📱",
    productTypes: [
      {
        id: "honor-phone", category: "samsung", label: "Honor Phones", emoji: "📱", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("honor-magic-7", "Magic 7 Series", "2025", [
            ["Magic 7 Pro", "Honor Magic 7 Pro"], ["Magic 7", "Honor Magic 7"], ["Magic 7 Ultimate", "Honor Magic 7 Ultimate"],
          ], "Flagship"),
          gen("honor-magic-6", "Magic 6 Series", "2024", [
            ["Magic 6 Pro", "Honor Magic 6 Pro"], ["Magic 6", "Honor Magic 6"],
          ], "Flagship"),
          gen("honor-300", "Honor 300 Series", "2024", [
            ["Honor 300 Pro", "Honor 300 Pro"], ["Honor 300", "Honor 300"], ["Honor 300 Ultra", "Honor 300 Ultra"],
          ], "Mid-Range"),
          gen("honor-200", "Honor 200 Series", "2024", [
            ["Honor 200 Pro", "Honor 200 Pro"], ["Honor 200", "Honor 200"],
          ], "Mid-Range"),
          gen("honor-x", "Honor X Series", "2024", [
            ["Honor X60", "Honor X60"], ["Honor X50", "Honor X50"],
          ], "Mid-Range"),
        ],
      },
    ],
  },
  // ── INSTA360 ──
  {
    id: "insta360", label: "Insta360", emoji: "🌀",
    productTypes: [
      {
        id: "insta360-cam", category: "dji", label: "360 Cameras", emoji: "🥽", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("insta360-x5", "X5 Series", "2025", [["X5", "Insta360 X5"]]),
          gen("insta360-x4", "X4 Series", "2024", [["X4", "Insta360 X4"], ["X4 Air", "Insta360 X4 Air"]]),
          gen("insta360-x3", "X3", "2022", [["X3", "Insta360 X3"]]),
        ],
      },
      {
        id: "insta360-action", category: "dji", label: "Action Cams", emoji: "📹", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("insta360-ace-pro2", "Ace Pro 2", "2024", [["Ace Pro 2", "Insta360 Ace Pro 2"]]),
          gen("insta360-ace", "Ace Series", "2023", [["Ace Pro", "Insta360 Ace Pro"], ["Ace", "Insta360 Ace"]]),
        ],
      },
      {
        id: "insta360-go", category: "dji", label: "GO Series", emoji: "🎯", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("insta360-go-ultra", "GO Ultra & GO 4", "2025", [["GO 4", "Insta360 GO 4"], ["GO Ultra", "Insta360 GO Ultra"]]),
          gen("insta360-go3", "GO 3", "2023", [["GO 3", "Insta360 GO 3"]]),
        ],
      },
      {
        id: "insta360-luna", category: "dji", label: "Luna Series", emoji: "🌙", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("insta360-luna", "Luna", "2025", [["Luna", "Insta360 Luna"], ["Luna Ultra", "Insta360 Luna Ultra"]]),
        ],
      },
    ],
  },
  // ── JBL ──
  {
    id: "jbl", label: "JBL", emoji: "🔊",
    productTypes: [
      {
        id: "jbl-speakers", category: "gaming", label: "JBL Speakers", emoji: "🔊", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("jbl-flip", "Flip Series", "2025", [
            ["Flip 7", "JBL Flip 7"], ["Flip 6", "JBL Flip 6"], ["Flip 5", "JBL Flip 5"],
          ]),
          gen("jbl-charge", "Charge Series", "2025", [
            ["Charge 6", "JBL Charge 6"], ["Charge 5", "JBL Charge 5"], ["Charge 4", "JBL Charge 4"],
          ]),
          gen("jbl-extreme", "Extreme Series", "2024", [
            ["Extreme 5", "JBL Extreme 5"], ["Extreme 4", "JBL Extreme 4"], ["Extreme 3", "JBL Extreme 3"],
          ]),
          gen("jbl-go", "Go Series", "2025", [
            ["Go 5", "JBL Go 5"], ["Go 4", "JBL Go 4"], ["Go 3", "JBL Go 3"],
          ]),
          gen("jbl-clip", "Clip Series", "2024", [
            ["Clip 5", "JBL Clip 5"], ["Clip 4", "JBL Clip 4"],
          ]),
          gen("jbl-tune", "Tune Series", "2023", [
            ["Tune 520BT", "JBL Tune 520BT"], ["Tune 510BT", "JBL Tune 510BT"],
          ]),
          gen("jbl-partybox", "PartyBox Series", "2024", [
            ["PartyBox Stage 320", "JBL PartyBox Stage 320"], ["PartyBox Club 120", "JBL PartyBox Club 120"],
            ["PartyBox Encore Essential", "JBL PartyBox Encore Essential"], ["PartyBox 310", "JBL PartyBox 310"],
          ]),
        ],
      },
      {
        id: "jbl-lights", category: "gaming", label: "JBL Lights & Sing", emoji: "💡", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("jbl-partylight", "PartyLight Series", "2024", [
            ["PartyLight Speaker", "JBL PartyLight Speaker"], ["PartyLight Lantern", "JBL PartyLight Lantern"],
            ["PartyLight Stick", "JBL PartyLight Stick"],
          ]),
          gen("jbl-sing", "Sing Series", "2024", [
            ["Sing Classic", "JBL Sing Classic"], ["Sing Mini", "JBL Sing Mini"],
          ]),
        ],
      },
    ],
  },
  // ── LOGITECH ──
  {
    id: "logitech", label: "Logitech", emoji: "🖱️",
    productTypes: [
      {
        id: "logi-mice", category: "gaming", label: "Logitech Mice", emoji: "🖱️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("logi-pro-mice", "Pro Series", "2023", [
            ["G Pro X Superlight 2", "Logitech G Pro X Superlight 2"],
            ["G Pro X Superlight 2 Lightspeed", "Logitech G Pro X Superlight 2 Lightspeed"],
            ["G Pro X Superlight 2 Dota 2 Edition", "Logitech G Pro X Superlight 2 Dota 2 Edition"],
            ["G Pro X Superlight", "Logitech G Pro X Superlight"],
            ["G Pro Wireless", "Logitech G Pro Wireless"],
          ]),
          gen("logi-g-mice", "G Series", "2018", [
            ["G502 X Plus", "Logitech G502 X Plus"],
            ["G502 X", "Logitech G502 X"],
            ["G502 X Lightspeed", "Logitech G502 X Lightspeed"],
            ["G502 Hero", "Logitech G502 Hero"],
            ["G305 Lightspeed", "Logitech G305 Lightspeed"],
            ["G305", "Logitech G305"],
            ["G203 Lightsync", "Logitech G203 Lightsync"],
            ["G203", "Logitech G203"],
            ["G703", "Logitech G703"],
            ["G903", "Logitech G903"],
          ]),
          gen("logi-g-lightspeed", "G Series Lightspeed", "2018", [
            ["G703 Lightspeed", "Logitech G703 Lightspeed"],
            ["G903 Lightspeed", "Logitech G903 Lightspeed"],
            ["G403 Lightspeed", "Logitech G403 Lightspeed"],
          ]),
          gen("logi-mx-mice", "MX Series", "2018", [
            ["MX Master 3S", "Logitech MX Master 3S"],
            ["MX Master 3", "Logitech MX Master 3"],
            ["MX Master 2S", "Logitech MX Master 2S"],
            ["MX Anywhere 3S", "Logitech MX Anywhere 3S"],
            ["MX Vertical", "Logitech MX Vertical"],
            ["MX Ergo", "Logitech MX Ergo"],
          ]),
        ],
      },
      {
        id: "logi-keyboards", category: "gaming", label: "Logitech Keyboards", emoji: "⌨️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("logi-keyboards", "Logitech Keyboards", "2023", [
            ["G Pro X TKL", "Logitech G Pro X TKL"],
            ["G915 TKL", "Logitech G915 TKL"],
            ["G Pro X 60", "Logitech G Pro X 60"],
            ["MX Keys S", "Logitech MX Keys S"],
            ["MX Mechanical", "Logitech MX Mechanical"],
            ["G512", "Logitech G512"],
          ]),
        ],
      },
      {
        id: "logi-headsets", category: "gaming", label: "Logitech Headsets", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("logi-headsets", "Logitech Headsets", "2022", [
            ["G Pro X 2", "Logitech G Pro X 2"],
            ["G Pro X", "Logitech G Pro X"],
            ["G733", "Logitech G733"],
            ["G935", "Logitech G935"],
            ["Astro A50 X", "Logitech Astro A50 X"],
            ["Astro A30", "Logitech Astro A30"],
          ]),
        ],
      },
      {
        id: "logi-racing", category: "gaming", label: "Logitech Racing", emoji: "🏎️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("logi-racing", "Logitech Racing", "2023", [
            ["G Pro Racing Wheel", "Logitech G Pro Racing Wheel"],
            ["G923", "Logitech G923"],
            ["G29", "Logitech G29"],
          ]),
        ],
      },
      {
        id: "logi-webcams", category: "gaming", label: "Logitech Webcams", emoji: "📷", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("logi-webcams", "Logitech Webcams", "2023", [
            ["MX Brio", "Logitech MX Brio"],
            ["Brio 500", "Logitech Brio 500"],
            ["C920s Pro", "Logitech C920s Pro"],
            ["C922 Pro", "Logitech C922 Pro"],
          ]),
        ],
      },
    ],
  },
  // ── MOTOROLA ──
  {
    id: "motorola", label: "Motorola", emoji: "📱",
    productTypes: [
      {
        id: "motorola-phone", category: "samsung", label: "Motorola Phones", emoji: "📱", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("moto-edge-60", "Edge 60 Series", "2025", [
            ["Edge 60 Pro", "Motorola Edge 60 Pro"], ["Edge 60 Ultra", "Motorola Edge 60 Ultra"], ["Edge 60", "Motorola Edge 60"],
          ], "Flagship"),
          gen("moto-edge-50", "Edge 50 Series", "2024", [
            ["Edge 50 Pro", "Motorola Edge 50 Pro"], ["Edge 50 Ultra", "Motorola Edge 50 Ultra"], ["Edge 50", "Motorola Edge 50"],
          ], "Flagship Killer"),
          gen("moto-razr-60", "Razr 60 Series", "2025", [
            ["Razr 60 Ultra", "Motorola Razr 60 Ultra"], ["Razr 60", "Motorola Razr 60"],
          ], "Flagship"),
          gen("moto-g-power", "Moto G Series", "2024", [
            ["Moto G Power 5G", "Motorola Moto G Power 5G"], ["Moto G Stylus 5G", "Motorola Moto G Stylus 5G"],
          ], "Mid-Range"),
        ],
      },
    ],
  },
  // ── NIKON ──
  {
    id: "nikon", label: "Nikon", emoji: "📷",
    productTypes: [
      {
        id: "nikon-cameras", category: "dji", label: "Nikon Cameras", emoji: "📷", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("nikon-z8", "Z 8", "2023", [["Nikon Z 8", "Nikon Z 8"]]),
          gen("nikon-z9", "Z 9", "2021", [["Nikon Z 9", "Nikon Z 9"]]),
          gen("nikon-z6", "Z 6 Series", "2018", [
            ["Z 6 II", "Nikon Z 6 II"], ["Z 6 III", "Nikon Z 6 III"],
          ]),
          gen("nikon-z7", "Z 7 Series", "2018", [["Z 7 II", "Nikon Z 7 II"]]),
          gen("nikon-zf", "Z f", "2023", [["Nikon Z f", "Nikon Z f"]]),
          gen("nikon-zfc", "Z fc", "2021", [["Nikon Z fc", "Nikon Z fc"]]),
        ],
      },
    ],
  },
  // ── ONEPLUS ──
  {
    id: "oneplus", label: "OnePlus", emoji: "1️⃣",
    productTypes: [
      {
        id: "oneplus-phone", category: "xiaomi", label: "OnePlus Phones", emoji: "📱", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("oneplus-15", "OnePlus 15 Series", "2025", [
            ["OnePlus 15", "OnePlus 15"], ["OnePlus 15R", "OnePlus 15R"],
          ], "Flagship"),
          gen("oneplus-13", "OnePlus 13 Series", "2025", [
            ["OnePlus 13", "OnePlus 13"], ["OnePlus 13T", "OnePlus 13T"],
          ], "Flagship"),
          gen("oneplus-13r", "OnePlus 13R", "2025", [
            ["OnePlus 13R", "OnePlus 13R"],
          ], "Flagship Killer"),
          gen("oneplus-12", "OnePlus 12 Series", "2024", [
            ["OnePlus 12", "OnePlus 12"],
          ], "Flagship"),
          gen("oneplus-12r", "OnePlus 12R", "2024", [
            ["OnePlus 12R", "OnePlus 12R"],
          ], "Flagship Killer"),
          gen("oneplus-nord-4", "OnePlus Nord 4", "2024", [
            ["OnePlus Nord 4", "OnePlus Nord 4"],
          ], "Mid-Range"),
          gen("oneplus-nord-ce4", "OnePlus Nord CE 4", "2024", [
            ["OnePlus Nord CE 4", "OnePlus Nord CE 4"],
          ], "Mid-Range"),
        ],
      },
      {
        id: "oneplus-earbuds", category: "xiaomi", label: "OnePlus Buds", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("oneplus-buds-4", "OnePlus Buds 4", "2025", [
            ["OnePlus Buds 4", "OnePlus Buds 4"], ["OnePlus Buds 3 Pro", "OnePlus Buds 3 Pro"], ["OnePlus Buds 3", "OnePlus Buds 3"],
          ]),
          gen("oneplus-nord-buds", "OnePlus Nord Buds", "2025", [
            ["OnePlus Nord Buds 4 Pro", "OnePlus Nord Buds 4 Pro"], ["OnePlus Nord Buds 4", "OnePlus Nord Buds 4"],
          ]),
        ],
      },
    ],
  },
  // ── OPPO ──
  {
    id: "oppo", label: "OPPO", emoji: "🟢",
    productTypes: [
      {
        id: "oppo-phone", category: "xiaomi", label: "OPPO Phones", emoji: "📱", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("oppo-find-x9", "Find X9 Series", "2025", [
            ["Find X9 Ultra", "OPPO Find X9 Ultra"], ["Find X9 Pro", "OPPO Find X9 Pro"], ["Find X9s Pro", "OPPO Find X9s Pro"], ["Find X9s", "OPPO Find X9s"],
          ], "Flagship"),
          gen("oppo-find-x8", "Find X8 Series", "2024", [
            ["Find X8 Ultra", "OPPO Find X8 Ultra"], ["Find X8 Pro", "OPPO Find X8 Pro"],
            ["Find X8", "OPPO Find X8"],
          ], "Flagship"),
          gen("oppo-find-x7", "Find X7 Series", "2024", [
            ["Find X7 Ultra", "OPPO Find X7 Ultra"], ["Find X7 Pro", "OPPO Find X7 Pro"],
          ], "Flagship"),
          gen("oppo-reno16", "Reno 16 Series", "2025", [
            ["Reno 16 Pro", "OPPO Reno 16 Pro"], ["Reno 16", "OPPO Reno 16"],
          ], "Flagship Killer"),
          gen("oppo-reno13", "Reno 13 Series", "2025", [
            ["Reno 13 Pro", "OPPO Reno 13 Pro"], ["Reno 13", "OPPO Reno 13"],
          ], "Flagship Killer"),
          gen("oppo-reno12", "Reno 12 Series", "2024", [
            ["Reno 12 Pro", "OPPO Reno 12 Pro"], ["Reno 12", "OPPO Reno 12"],
          ], "Flagship Killer"),
          gen("oppo-a", "A Series", "2024", [
            ["OPPO A3 Pro", "OPPO A3 Pro"], ["OPPO A60", "OPPO A60"],
          ], "Mid-Range"),
        ],
      },
      {
        id: "oppo-tablet", category: "xiaomi", label: "OPPO Tablets", emoji: "📋", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("oppo-pad-5", "OPPO Pad 5", "2025", [
            ["OPPO Pad 5", "OPPO Pad 5"], ["OPPO Pad SE", "OPPO Pad SE"],
          ]),
          gen("oppo-pad-3", "OPPO Pad 3", "2025", [
            ["OPPO Pad 3", "OPPO Pad 3"],
          ]),
          gen("oppo-pad-2", "OPPO Pad 2", "2023", [
            ["OPPO Pad 2", "OPPO Pad 2"],
          ]),
        ],
      },
      {
        id: "oppo-earbuds", category: "xiaomi", label: "OPPO Buds", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("oppo-enco-x3", "OPPO Enco X3", "2024", [
            ["OPPO Enco X3", "OPPO Enco X3"],
          ]),
          gen("oppo-enco-air4", "OPPO Enco Air 4", "2024", [
            ["OPPO Enco Air 4", "OPPO Enco Air 4"],
          ]),
        ],
      },
    ],
  },
  // ── RAZER ──
  {
    id: "razer", label: "Razer", emoji: "🐍",
    productTypes: [
      {
        id: "razer-mice", category: "gaming", label: "Razer Mice", emoji: "🖱️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("razer-deathadder", "DeathAdder Series", "2020", [
            ["DeathAdder V3 Pro", "Razer DeathAdder V3 Pro"],
            ["DeathAdder V3", "Razer DeathAdder V3"],
            ["DeathAdder V2 Pro", "Razer DeathAdder V2 Pro"],
          ]),
          gen("razer-viper", "Viper Series", "2022", [
            ["Viper V3 Pro", "Razer Viper V3 Pro"],
            ["Viper V3", "Razer Viper V3"],
            ["Viper V2 Pro", "Razer Viper V2 Pro"],
          ]),
          gen("razer-basilisk", "Basilisk Series", "2023", [
            ["Basilisk V3 Pro", "Razer Basilisk V3 Pro"],
            ["Basilisk V3", "Razer Basilisk V3"],
          ]),
          gen("razer-naga", "Naga Series", "2021", [
            ["Naga V2 Pro", "Razer Naga V2 Pro"],
            ["Naga X", "Razer Naga X"],
          ]),
          gen("razer-orochi", "Orochi Series", "2022", [
            ["Orochi V2 Pro", "Razer Orochi V2 Pro"],
            ["Orochi V2", "Razer Orochi V2"],
          ]),
        ],
      },
      {
        id: "razer-keyboards", category: "gaming", label: "Razer Keyboards", emoji: "⌨️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("razer-keyboards", "Razer Keyboards", "2022", [
            ["DeathStalker V2 Pro", "Razer DeathStalker V2 Pro"],
            ["Huntsman V3 Pro", "Razer Huntsman V3 Pro"],
            ["Huntsman V3 Pro Mini", "Razer Huntsman V3 Pro Mini"],
            ["Huntsman V2", "Razer Huntsman V2"],
            ["BlackWidow V4 Pro", "Razer BlackWidow V4 Pro"],
            ["BlackWidow V3", "Razer BlackWidow V3"],
            ["Ornata V3 Pro", "Razer Ornata V3 Pro"],
            ["Ornata V3", "Razer Ornata V3"],
            ["Cynosa V3", "Razer Cynosa V3"],
          ]),
        ],
      },
      {
        id: "razer-headsets", category: "gaming", label: "Razer Headsets", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("razer-headsets", "Razer Headsets", "2022", [
            ["BlackShark V2 Pro", "Razer BlackShark V2 Pro"],
            ["BlackShark V2", "Razer BlackShark V2"],
            ["Kraken V4", "Razer Kraken V4"],
            ["Kraken V3 Pro", "Razer Kraken V3 Pro"],
            ["Kraken V3", "Razer Kraken V3"],
            ["Kraken Kitty V2", "Razer Kraken Kitty V2"],
            ["Barracuda Pro", "Razer Barracuda Pro"],
            ["Barracuda X", "Razer Barracuda X"],
            ["Nari Ultimate", "Razer Nari Ultimate"],
            ["Nari Essential", "Razer Nari Essential"],
          ]),
        ],
      },
      {
        id: "razer-mousepads", category: "gaming", label: "Razer Mouse Pads", emoji: "🟦", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("razer-mousepads", "Razer Mouse Pads", "2023", [
            ["Firefly V2 Pro", "Razer Firefly V2 Pro"],
            ["Goliathus Extended Chroma", "Razer Goliathus Extended Chroma"],
            ["Goliathus Speed Medium", "Razer Goliathus Speed Medium"],
          ]),
        ],
      },
      {
        id: "razer-streaming", category: "gaming", label: "Razer Streaming", emoji: "🎥", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("razer-streaming", "Razer Streaming", "2023", [
            ["Kiyo Pro Ultra", "Razer Kiyo Pro Ultra"],
            ["Seiren V3 Pro", "Razer Seiren V3 Pro"],
            ["Ripsaw HD", "Razer Ripsaw HD"],
          ]),
        ],
      },
      {
        id: "razer-laptops", category: "gaming", label: "Razer Laptops", emoji: "💻", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("razer-blade", "Razer Blade Series", "2024", [
            ["Razer Blade 16 (2025)", "Razer Blade 16 2025"],
            ["Razer Blade 18 (2025)", "Razer Blade 18 2025"],
            ["Razer Blade 14 (2025)", "Razer Blade 14 2025"],
            ["Razer Blade 15 (2024)", "Razer Blade 15 2024"],
          ], "Flagship"),
        ],
      },
      {
        id: "razer-controllers", category: "gaming", label: "Razer Controllers", emoji: "🎮", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("razer-controllers", "Razer Controllers", "2023", [
            ["Wolverine V3 Pro", "Razer Wolverine V3 Pro"],
            ["Wolverine V2 Chroma", "Razer Wolverine V2 Chroma"],
            ["Raiju Ultimate", "Razer Raiju Ultimate"],
          ]),
        ],
      },
    ],
  },
  // ── REALME ──
  {
    id: "realme", label: "Realme", emoji: "📱",
    productTypes: [
      {
        id: "realme-phone", category: "samsung", label: "Realme Phones", emoji: "📱", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("realme-gt7", "GT 7 Series", "2025", [
            ["GT 7 Pro", "Realme GT 7 Pro"], ["GT 7", "Realme GT 7"],
          ], "Flagship"),
          gen("realme-gt6", "GT 6 Series", "2024", [
            ["GT 6", "Realme GT 6"],
          ], "Flagship Killer"),
          gen("realme-13", "Realme 13 Series", "2024", [
            ["Realme 13 Pro+", "Realme 13 Pro Plus"], ["Realme 13 Pro", "Realme 13 Pro"], ["Realme 13+", "Realme 13 Plus"],
          ], "Mid-Range"),
          gen("realme-14", "Realme 14 Series", "2025", [
            ["Realme 14 Pro+", "Realme 14 Pro Plus"], ["Realme 14 Pro", "Realme 14 Pro"],
          ], "Mid-Range"),
          gen("realme-narzo", "Narzo Series", "2024", [
            ["Narzo 70 Pro", "Realme Narzo 70 Pro"], ["Narzo 70", "Realme Narzo 70"],
          ], "Mid-Range"),
        ],
      },
    ],
  },
  // ── ROBOROCK ──
  {
    id: "roborock", label: "Roborock", emoji: "🤖",
    productTypes: [
      {
        id: "roborock-robots", category: "gaming", label: "Roborock Robots", emoji: "🤖", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("roborock-s8", "S8 Series", "2023", [
            ["S8 MaxV", "Roborock S8 MaxV"], ["S8 Pro", "Roborock S8 Pro"], ["S8", "Roborock S8"],
          ]),
          gen("roborock-qrevo", "Qrevo Series", "2023", [
            ["Qrevo MaxV", "Roborock Qrevo MaxV"], ["Qrevo Pro", "Roborock Qrevo Pro"], ["Qrevo", "Roborock Qrevo"],
          ]),
          gen("roborock-s7", "S7 Series", "2021", [
            ["S7 MaxV", "Roborock S7 MaxV"], ["S7", "Roborock S7"],
          ]),
        ],
      },
    ],
  },
  // ── RODE ──
  {
    id: "rode", label: "Rode", emoji: "🎤",
    productTypes: [
      {
        id: "rode-mics", category: "gaming", label: "Rode Microphones", emoji: "🎤", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("rode-nt1", "NT1 Series", "2023", [
            ["NT1 5th Gen", "Rode NT1 5th Gen"],
          ]),
          gen("rode-podmic", "PodMic", "2018", [
            ["PodMic", "Rode PodMic"], ["PodMic USB", "Rode PodMic USB"],
          ]),
          gen("rode-ntusb", "NT-USB Series", "2015", [
            ["NT-USB", "Rode NT-USB"], ["NT-USB Mini", "Rode NT-USB Mini"],
          ]),
          gen("rode-videomic", "VideoMic Series", "2016", [
            ["VideoMic NTG", "Rode VideoMic NTG"], ["VideoMic Pro+", "Rode VideoMic Pro Plus"],
          ]),
          gen("rode-wireless", "Wireless GO", "2019", [
            ["Wireless GO II", "Rode Wireless GO II"], ["Wireless ME", "Rode Wireless ME"],
          ]),
        ],
      },
    ],
  },
  // ── SAMSUNG ──
  {
    id: "samsung", label: "Samsung", emoji: "📲",
    productTypes: [
      {
        id: "samsung-phone", category: "samsung", label: "Galaxy Phones", emoji: "📱", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("galaxy-s26", "Galaxy S26 Series", "2026", [
            ["Galaxy S26 Ultra", "Samsung Galaxy S26 Ultra"], ["Galaxy S26+", "Samsung Galaxy S26 Plus"],
            ["Galaxy S26", "Samsung Galaxy S26"],
          ], "Flagship"),
          gen("galaxy-s25", "Galaxy S25 Series", "2025", [
            ["Galaxy S25 Ultra", "Samsung Galaxy S25 Ultra"], ["Galaxy S25+", "Samsung Galaxy S25 Plus"],
            ["Galaxy S25 Edge", "Samsung Galaxy S25 Edge"], ["Galaxy S25", "Samsung Galaxy S25"],
          ], "Flagship"),
          gen("galaxy-s24", "Galaxy S24 Series", "2024", [
            ["Galaxy S24 Ultra", "Samsung Galaxy S24 Ultra"], ["Galaxy S24+", "Samsung Galaxy S24 Plus"],
            ["Galaxy S24", "Samsung Galaxy S24"],
          ], "Flagship"),
          gen("galaxy-z", "Galaxy Z Fold/Flip", "2024", [
            ["Galaxy Z Fold 6", "Samsung Galaxy Z Fold 6"], ["Galaxy Z Flip 6", "Samsung Galaxy Z Flip 6"],
          ], "Flagship"),
          gen("galaxy-a", "Galaxy A Series", "2024", [
            ["Galaxy A56", "Samsung Galaxy A56"], ["Galaxy A55", "Samsung Galaxy A55"], ["Galaxy A36", "Samsung Galaxy A36"],
          ], "Mid-Range"),
        ],
      },
      {
        id: "samsung-tablet", category: "samsung", label: "Galaxy Tablets", emoji: "📋", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("galaxy-tab-s10", "Galaxy Tab S10", "2024", [
            ["Tab S10 Ultra", "Samsung Galaxy Tab S10 Ultra"], ["Tab S10+", "Samsung Galaxy Tab S10 Plus"],
          ]),
          gen("galaxy-tab-s9", "Galaxy Tab S9", "2023", [
            ["Tab S9 Ultra", "Samsung Galaxy Tab S9 Ultra"], ["Tab S9 FE+", "Samsung Galaxy Tab S9 FE Plus"],
            ["Tab S9 FE", "Samsung Galaxy Tab S9 FE"],
          ]),
        ],
      },
      {
        id: "samsung-laptop", category: "samsung", label: "Galaxy Books", emoji: "💻", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("galaxy-book-5", "Galaxy Book 5", "2025", [
            ["Galaxy Book 5 Pro", "Samsung Galaxy Book 5 Pro"],
            ["Galaxy Book 5 Pro 360", "Samsung Galaxy Book 5 Pro 360"],
          ]),
          gen("galaxy-book-4", "Galaxy Book 4", "2024", [
            ["Galaxy Book 4 Pro", "Samsung Galaxy Book 4 Pro"],
            ["Galaxy Book 4 Pro 360", "Samsung Galaxy Book 4 Pro 360"],
            ["Galaxy Book 4 Ultra", "Samsung Galaxy Book 4 Ultra"],
          ]),
        ],
      },
      {
        id: "samsung-earbuds", category: "samsung", label: "Galaxy Buds", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("buds-3", "Galaxy Buds 3", "2024", [
            ["Buds 3 Pro", "Samsung Galaxy Buds 3 Pro"], ["Buds 3", "Samsung Galaxy Buds 3"],
          ]),
          gen("buds-2", "Galaxy Buds 2", "2022", [
            ["Buds 2 Pro", "Samsung Galaxy Buds 2 Pro"], ["Buds 2", "Samsung Galaxy Buds 2"],
          ]),
        ],
      },
    ],
  },
  // ── SHURE ──
  {
    id: "shure", label: "Shure", emoji: "🎤",
    productTypes: [
      {
        id: "shure-mics", category: "gaming", label: "Shure Microphones", emoji: "🎤", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("shure-sm7db", "SM7dB", "2023", [["SM7dB", "Shure SM7dB"]]),
          gen("shure-mv7", "MV7 Series", "2020", [
            ["MV7", "Shure MV7"], ["MV7+", "Shure MV7 Plus"],
          ]),
        ],
      },
    ],
  },
  // ── SONOS ──
  {
    id: "sonos", label: "Sonos", emoji: "🔊",
    productTypes: [
      {
        id: "sonos-speakers", category: "gaming", label: "Sonos Speakers", emoji: "🔊", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("sonos-era", "Era Series", "2023", [
            ["Era 100", "Sonos Era 100"], ["Era 300", "Sonos Era 300"],
          ]),
          gen("sonos-one", "One Series", "2017", [
            ["One Gen 2", "Sonos One Gen 2"], ["One SL", "Sonos One SL"],
          ]),
          gen("sonos-move", "Move Series", "2019", [
            ["Move 2", "Sonos Move 2"], ["Move Gen 1", "Sonos Move"],
          ]),
          gen("sonos-ray", "Ray", "2022", [["Sonos Ray", "Sonos Ray"]]),
          gen("sonos-beam", "Beam", "2021", [["Sonos Beam Gen 2", "Sonos Beam Gen 2"]]),
        ],
      },
    ],
  },
  // ── SONY ──
  {
    id: "sony", label: "Sony", emoji: "🎮",
    productTypes: [
      {
        id: "ps5", category: "ps5", label: "PlayStation 5", emoji: "🎮", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("ps5-slim", "PS5 Slim", "2023", [
            ["PS5 Slim Disc", "PlayStation 5 Slim Disc"], ["PS5 Slim Digital", "PlayStation 5 Slim Digital"],
          ]),
          gen("ps5-standard", "PS5 Standard", "2020", [
            ["PS5 Standard Disc", "PlayStation 5 Standard Disc"], ["PS5 Standard Digital", "PlayStation 5 Standard Digital"],
          ]),
        ],
      },
      {
        id: "ps-controllers", category: "ps5", label: "Controllers", emoji: "🎮", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("dualsense", "DualSense", "2020", [
            ["DualSense Edge", "Sony DualSense Edge"], ["DualSense", "Sony DualSense"],
          ]),
        ],
      },
      {
        id: "ps-vr2", category: "ps5", label: "PS VR2", emoji: "🥽", hasStorage: false, hasRangeFilter: false,
        generations: [gen("ps-vr2", "PS VR2", "2023", [["PS VR2", "Sony PlayStation VR2"]])],
      },
      {
        id: "sony-earbuds", category: "ps5", label: "Earbuds & Headphones", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("sony-wf", "WF Series (Earbuds)", "2023", [
            ["WF-1000XM5", "Sony WF-1000XM5"], ["WF-1000XM4", "Sony WF-1000XM4"], ["WF-C700N", "Sony WF-C700N"],
          ]),
          gen("sony-wh", "WH Series (Headphones)", "2024", [
            ["WH-1000XM6", "Sony WH-1000XM6"], ["WH-1000XM5", "Sony WH-1000XM5"], ["WH-1000XM4", "Sony WH-1000XM4"],
          ]),
        ],
      },
      {
        id: "sony-camera", category: "ps5", label: "Cameras", emoji: "📷", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("sony-a7", "Alpha A7 Series", "2021", [
            ["A7 IV", "Sony Alpha A7 IV"], ["A7 III", "Sony Alpha A7 III"], ["A7C II", "Sony Alpha A7C II"],
          ]),
          gen("sony-a1", "Alpha A1", "2021", [["Alpha A1", "Sony Alpha A1"]]),
          gen("sony-zv", "ZV Series (Vlog)", "2022", [
            ["ZV-1 II", "Sony ZV-1 II"], ["ZV-E10", "Sony ZV-E10"],
          ]),
        ],
      },
    ],
  },
  // ── VITAMIX (High-end blenders — high resale value) ──
  {
    id: "vitamix", label: "Vitamix", emoji: "🌀",
    productTypes: [
      {
        id: "vitamix-blender", category: "gaming", label: "Vitamix Blenders", emoji: "🌀", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("vitamix-ascent", "Ascent Series", "2019", [
            ["A3500", "Vitamix A3500"], ["A2500", "Vitamix A2500"], ["A2300", "Vitamix A2300"],
          ]),
          gen("vitamix-explorian", "Explorian Series", "2018", [
            ["E310", "Vitamix E310"], ["E320", "Vitamix E320"],
          ]),
        ],
      },
    ],
  },
  // ── VIVO ──
  {
    id: "vivo", label: "Vivo", emoji: "📱",
    productTypes: [
      {
        id: "vivo-phone", category: "samsung", label: "Vivo Phones", emoji: "📱", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("vivo-x200", "X200 Series", "2025", [
            ["X200 Pro", "Vivo X200 Pro"], ["X200", "Vivo X200"], ["X200 Ultra", "Vivo X200 Ultra"],
          ], "Flagship"),
          gen("vivo-x100", "X100 Series", "2024", [
            ["X100 Pro", "Vivo X100 Pro"], ["X100", "Vivo X100"],
          ], "Flagship"),
          gen("vivo-v40", "V Series", "2024", [
            ["Vivo V40", "Vivo V40"], ["Vivo V40 Pro", "Vivo V40 Pro"],
          ], "Mid-Range"),
          gen("vivo-iqoo-13", "iQOO 13 Series", "2025", [
            ["iQOO 13", "Vivo iQOO 13"], ["iQOO 13 Pro", "Vivo iQOO 13 Pro"],
          ], "Flagship Killer"),
          gen("vivo-iqoo-neo10", "iQOO Neo Series", "2025", [
            ["iQOO Neo 10 Pro", "Vivo iQOO Neo 10 Pro"], ["iQOO Neo 10", "Vivo iQOO Neo 10"],
          ], "Flagship Killer"),
        ],
      },
    ],
  },
  // ── XGIMI ──
  {
    id: "xgimi", label: "XGIMI", emoji: "📽️",
    productTypes: [
      {
        id: "xgimi-projectors", category: "gaming", label: "XGIMI Projectors", emoji: "📽️", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("xgimi-horizon", "Horizon Series", "2021", [
            ["Horizon Pro", "XGIMI Horizon Pro"], ["Horizon", "XGIMI Horizon"],
          ]),
          gen("xgimi-halo", "Halo Series", "2020", [
            ["Halo+", "XGIMI HaloPlus"], ["Halo", "XGIMI Halo"],
          ]),
          gen("xgimi-moGo", "MoGo Series", "2020", [
            ["MoGo 2 Pro", "XGIMI MoGo 2 Pro"], ["MoGo 2", "XGIMI MoGo 2"],
          ]),
          gen("xgimi-aura", "Aura", "2021", [["XGIMI Aura", "XGIMI Aura"]]),
        ],
      },
    ],
  },
  // ── XIAOMI ──
  {
    id: "xiaomi", label: "Xiaomi", emoji: "📳",
    productTypes: [
      {
        id: "xiaomi-phone", category: "xiaomi", label: "Xiaomi Phones", emoji: "📱", hasStorage: true, hasRangeFilter: true,
        generations: [
          gen("xiaomi-17", "Xiaomi 17 Series", "2025", [
            ["Xiaomi 17 Ultra", "Xiaomi 17 Ultra"], ["Xiaomi 17 Pro", "Xiaomi 17 Pro"],
            ["Xiaomi 17", "Xiaomi 17"],
          ], "Flagship"),
          gen("xiaomi-17t", "Xiaomi 17T Series", "2026", [
            ["Xiaomi 17T Pro", "Xiaomi 17T Pro"], ["Xiaomi 17T", "Xiaomi 17T"],
          ], "Flagship"),
          gen("xiaomi-15", "Xiaomi 15 Series", "2024", [
            ["Xiaomi 15 Ultra", "Xiaomi 15 Ultra"], ["Xiaomi 15 Pro", "Xiaomi 15 Pro"],
            ["Xiaomi 15", "Xiaomi 15"],
          ], "Flagship"),
          gen("xiaomi-15t", "Xiaomi 15T Series", "2024", [
            ["Xiaomi 15T Pro", "Xiaomi 15T Pro"], ["Xiaomi 15T", "Xiaomi 15T"],
          ], "Flagship"),
          gen("xiaomi-14", "Xiaomi 14 Series", "2023", [
            ["Xiaomi 14 Ultra", "Xiaomi 14 Ultra"], ["Xiaomi 14 Pro", "Xiaomi 14 Pro"],
            ["Xiaomi 14", "Xiaomi 14"],
          ], "Flagship"),
          gen("xiaomi-13", "Xiaomi 13 Series", "2022", [
            ["Xiaomi 13 Ultra", "Xiaomi 13 Ultra"], ["Xiaomi 13 Pro", "Xiaomi 13 Pro"],
            ["Xiaomi 13", "Xiaomi 13"],
          ], "Flagship"),
          gen("redmi-k80", "Redmi K80 Series", "2024", [
            ["Redmi K80 Pro", "Redmi K80 Pro"], ["Redmi K80", "Redmi K80"],
          ], "Flagship Killer"),
          gen("redmi-k70", "Redmi K70 Series", "2023", [
            ["Redmi K70 Pro", "Redmi K70 Pro"], ["Redmi K70", "Redmi K70"], ["Redmi K70E", "Redmi K70E"],
          ], "Flagship Killer"),
          gen("redmi-turbo-4", "Redmi Turbo 4 Series", "2025", [
            ["Redmi Turbo 4 Pro", "Redmi Turbo 4 Pro"], ["Redmi Turbo 4", "Redmi Turbo 4"],
          ], "Flagship Killer"),
          gen("redmi-turbo-3", "Redmi Turbo 3 Series", "2024", [
            ["Redmi Turbo 3 Pro", "Redmi Turbo 3 Pro"], ["Redmi Turbo 3", "Redmi Turbo 3"],
          ], "Flagship Killer"),
          gen("poco-f7", "POCO F7 Series", "2025", [
            ["POCO F7 Pro", "POCO F7 Pro"], ["POCO F7 Ultra", "POCO F7 Ultra"],
          ], "Flagship Killer"),
          gen("poco-f6", "POCO F6 Series", "2024", [
            ["POCO F6 Pro", "POCO F6 Pro"], ["POCO F6", "POCO F6"],
          ], "Flagship Killer"),
          gen("redmi-note-15", "Redmi Note 15 Series", "2025", [
            ["Redmi Note 15 Pro+", "Redmi Note 15 Pro Plus"], ["Redmi Note 15 Pro", "Redmi Note 15 Pro"],
            ["Redmi Note 15", "Redmi Note 15"],
          ], "Mid-Range"),
          gen("redmi-note-14", "Redmi Note 14 Series", "2024", [
            ["Redmi Note 14 Pro+", "Redmi Note 14 Pro Plus"], ["Redmi Note 14 Pro", "Redmi Note 14 Pro"],
            ["Redmi Note 14", "Redmi Note 14"],
          ], "Mid-Range"),
          gen("redmi-note-13", "Redmi Note 13 Series", "2023", [
            ["Redmi Note 13 Pro+", "Redmi Note 13 Pro Plus"], ["Redmi Note 13 Pro", "Redmi Note 13 Pro"],
            ["Redmi Note 13", "Redmi Note 13"],
          ], "Mid-Range"),
          gen("poco-x7", "POCO X7 Series", "2025", [
            ["POCO X7 Pro", "POCO X7 Pro"], ["POCO X7", "POCO X7"],
          ], "Mid-Range"),
          gen("poco-x6", "POCO X6 Series", "2024", [
            ["POCO X6 Pro", "POCO X6 Pro"], ["POCO X6", "POCO X6"],
          ], "Mid-Range"),
          gen("redmi-13c", "Redmi 13C Series", "2023", [
            ["Redmi 13C", "Redmi 13C"], ["Redmi 13C Pro", "Redmi 13C Pro"],
          ], "Mid-Range"),
        ],
      },
      {
        id: "xiaomi-tablet", category: "xiaomi", label: "Xiaomi Tablets", emoji: "📋", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("xiaomi-pad-8", "Xiaomi Pad 8", "2025", [
            ["Xiaomi Pad 8 Pro", "Xiaomi Pad 8 Pro"], ["Xiaomi Pad 8", "Xiaomi Pad 8"],
          ]),
          gen("xiaomi-pad-7", "Xiaomi Pad 7", "2024", [
            ["Xiaomi Pad 7 Pro", "Xiaomi Pad 7 Pro"], ["Xiaomi Pad 7", "Xiaomi Pad 7"],
          ]),
          gen("redmi-tab", "Redmi Tab", "2024", [
            ["Redmi Pad 8", "Redmi Pad 8"], ["Redmi Pad SE 8", "Redmi Pad SE 8"],
          ]),
        ],
      },
      {
        id: "xiaomi-pc", category: "xiaomi", label: "Xiaomi PCs", emoji: "💻", hasStorage: true, hasRangeFilter: false,
        generations: [
          gen("redmibook-16", "Redmi Book 16", "2024", [
            ["Redmi Book 16 2025", "Redmi Book 16 2025"], ["Redmi Book 16 2024", "Redmi Book 16 2024"],
          ]),
          gen("redmibook-14", "Redmi Book 14", "2024", [
            ["Redmi Book 14 2024", "Redmi Book 14 2024"],
          ]),
        ],
      },
      {
        id: "xiaomi-earbuds", category: "xiaomi", label: "Earbuds", emoji: "🎧", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("xiaomi-buds-5", "Xiaomi Buds 5", "2024", [
            ["Buds 5 Pro", "Xiaomi Buds 5 Pro"], ["Buds 5", "Xiaomi Buds 5"],
          ]),
          gen("redmi-buds", "Redmi Buds", "2024", [
            ["Redmi Buds 8 Pro", "Redmi Buds 8 Pro"], ["Redmi Buds 8", "Redmi Buds 8"], ["Redmi Buds 8 Lite", "Redmi Buds 8 Lite"],
            ["Redmi Buds 6 Pro", "Redmi Buds 6 Pro"], ["Redmi Buds 6", "Redmi Buds 6"],
          ]),
        ],
      },
      {
        id: "xiaomi-watch", category: "xiaomi", label: "Mi Band", emoji: "⌚", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("xiaomi-band", "Mi Band", "2024", [
            ["Mi Band 9", "Xiaomi Mi Band 9"], ["Mi Band 8", "Xiaomi Mi Band 8"],
          ]),
        ],
      },
      {
        id: "xiaomi-smarthome", category: "xiaomi", label: "Smart Lights & Home", emoji: "💡", hasStorage: false, hasRangeFilter: false,
        generations: [
          gen("xiaomi-lamps", "Smart Lamps", "2023", [
            ["Mi Smart Desk Lamp Pro", "Xiaomi Mi Smart Desk Lamp Pro"], ["Mi Desk Lamp 1S", "Xiaomi Mi Desk Lamp 1S"],
            ["Mi Bedside Lamp 2", "Xiaomi Mi Bedside Lamp 2"], ["Mijia Table Lamp Pro", "Xiaomi Mijia Table Lamp Pro"],
          ]),
          gen("xiaomi-bulbs", "Smart Bulbs", "2023", [
            ["Mi Smart LED Bulb Essential", "Xiaomi Mi Smart LED Bulb Essential"], ["Yeelight LED Bulb", "Xiaomi Yeelight LED Bulb"],
            ["Mijia Smart Bulb", "Xiaomi Mijia Smart Bulb"],
          ]),
          gen("xiaomi-home", "Smart Home", "2023", [
            ["Mi Air Purifier 4 Pro", "Xiaomi Mi Air Purifier 4 Pro"], ["Mi Air Purifier 4", "Xiaomi Mi Air Purifier 4"],
            ["Mi Smart Humidifier 2", "Xiaomi Mi Smart Humidifier 2"], ["Mi Smart Kettle Pro", "Xiaomi Mi Smart Kettle Pro"],
          ]),
        ],
      },
    ],
  },
];

// ── Post-processing: enrich every generation with a `releaseDate` ──
// Default releaseDate falls back to the existing `year` string (so every
// generation is guaranteed to have a date). For the most popular products
// (iPhones, Samsung Galaxy S, MacBooks, iPads, Apple Watches, flagship
// Android phones, DJI drones, gaming handhelds, action cameras, etc.)
// override with a more specific launch window based on public announcements.
const RELEASE_DATE_OVERRIDES: Record<string, string> = {
  // Apple — iPhone
  "iphone-18": "2026",
  "iphone-17": "2025",
  "iphone-16": "2024",
  "iphone-15": "2023",
  "iphone-14": "2022",
  "iphone-13": "2021",
  // Apple — MacBook
  "macbook-m5": "2025",
  "macbook-m4": "2024",
  "macbook-m3": "2023",
  "macbook-m2": "2022",
  "macbook-m1": "2020",
  // Apple — iPad
  "ipad-m5": "2025",
  "ipad-m4": "2024",
  "ipad-air-m2": "2024",
  // Apple — Watch
  "watch-series-11": "2025",
  "watch-ultra-3": "2025",
  "watch-se-3": "2025",
  "watch-series-10": "2024",
  "watch-ultra-2": "2023",
  "watch-series-9": "2023",
  // Samsung — Galaxy S / Z / Tab / Book / Buds
  "galaxy-s26": "2026",
  "galaxy-s25": "2025",
  "galaxy-s24": "2024",
  "galaxy-z": "2024",
  "galaxy-tab-s10": "2024",
  "galaxy-tab-s9": "2023",
  "galaxy-book-5": "2024",
  "galaxy-book-4": "2024",
  "buds-3": "2024",
  // Xiaomi
  "xiaomi-17": "2025",
  "xiaomi-17t": "2026",
  "xiaomi-15": "2024",
  "xiaomi-15t": "2024",
  "redmi-k80": "2024",
  "redmi-turbo-4": "2025",
  "poco-f7": "2025",
  "redmi-note-15": "2025",
  "redmi-note-14": "2024",
  "poco-x7": "2025",
  "xiaomi-pad-8": "2025",
  "xiaomi-pad-7": "2024",
  "xiaomi-band": "2024",
  // OnePlus
  "oneplus-15": "2025",
  "oneplus-13": "2025",
  "oneplus-13r": "2025",
  "oneplus-12": "2024",
  "oneplus-12r": "2024",
  "oneplus-nord-4": "2024",
  "oneplus-nord-ce4": "2024",
  // Sony / PlayStation
  "ps5-slim": "2023",
  "ps5-standard": "2020",
  "dualsense": "2020",
  "ps-vr2": "2023",
  // Gaming handhelds
  "steam-deck": "2023",
  "legion-go": "2023",
  "rog-ally": "2023",
  "switch-2": "2025",
  "switch-1": "2017",
  // DJI
  "dji-mavic-4": "2025",
  "dji-air-3s": "2024",
  "dji-avata-2": "2024",
  "dji-mini-4": "2023",
  "dji-air-3": "2023",
  "dji-inspire-3": "2023",
  "dji-rs-4": "2024",
  "dji-rs-3": "2022",
  "dji-pocket-3": "2023",
  "dji-pocket-2": "2020",
  "dji-fpv": "2021",
  "dji-mic-2": "2024",
  "dji-mic-1": "2022",
  // GoPro
  "hero-13": "2024",
  "hero-12": "2023",
  "hero-11": "2022",
  "gopro-max2": "2025",
  "gopro-max": "2019",
  // Insta360
  "insta360-x5": "2025",
  "insta360-x4": "2024",
  "insta360-x3": "2022",
  "insta360-ace-pro2": "2024",
  "insta360-ace": "2023",
  "insta360-go3": "2023",
  // OPPO / Honor / Realme / Vivo / Motorola flagships
  "oppo-find-x9": "2025",
  "oppo-find-x8": "2024",
  "oppo-find-x7": "2024",
  "oppo-reno13": "2024",
  "oppo-reno12": "2024",
  "oppo-pad-3": "2024",
  "oppo-enco-x3": "2024",
  "honor-magic-7": "2024",
  "honor-magic-6": "2024",
  "honor-300": "2024",
  "honor-200": "2024",
  "realme-gt7": "2025",
  "realme-gt6": "2024",
  "realme-14": "2025",
  "realme-13": "2024",
  "vivo-x200": "2024",
  "vivo-x100": "2023",
  "vivo-v40": "2024",
  "vivo-iqoo-13": "2024",
  "vivo-iqoo-neo10": "2024",
  "moto-edge-60": "2025",
  "moto-edge-50": "2024",
  "moto-razr-60": "2025",
  "sony-wh": "2025",
  "sony-wf": "2023",
};

// Per-model release date overrides (keyed by the model's query string).
// This lets us set accurate dates for individual models within a generation
// that spans multiple years (e.g. WH-1000XM6 = May 2025, XM5 = May 2023, XM4 = Aug 2020).
const MODEL_RELEASE_DATES: Record<string, string> = {
  // Sony headphones
  "Sony WH-1000XM6": "2025",
  "Sony WH-1000XM5": "2023",
  "Sony WH-1000XM4": "2020",
  "Sony WF-1000XM5": "2023",
  "Sony WF-1000XM4": "2021",
  "Sony WF-C700N": "2023",
  // Apple iPhones (within-series individual dates)
  "iPhone 18": "2026",
  "iPhone 18 Pro": "2026",
  "iPhone 18 Pro Max": "2026",
  "iPhone 18 Plus": "2026",
  "iPhone 18 Air": "2026",
  "iPhone 17": "2025",
  "iPhone 17 Pro": "2025",
  "iPhone 17 Pro Max": "2025",
  "iPhone 17 Plus": "2025",
  "iPhone 17 Air": "2025",
  "iPhone 16": "2024",
  "iPhone 16 Pro": "2024",
  "iPhone 16 Pro Max": "2024",
  "iPhone 16 Plus": "2024",
  "iPhone 15": "2023",
  "iPhone 15 Pro": "2023",
  "iPhone 15 Pro Max": "2023",
  "iPhone 14": "2022",
  "iPhone 14 Pro": "2022",
  "iPhone 13": "2021",
  // Samsung Galaxy A series (different years)
  "Samsung Galaxy A56": "2025",
  "Samsung Galaxy A55": "2024",
  "Samsung Galaxy A36": "2025",
  // Samsung Galaxy Z (different years)
  "Samsung Galaxy Z Fold 6": "2024",
  "Samsung Galaxy Z Flip 6": "2024",
  // iPad older models
  "iPad Pro 11": "2021",
  "iPad Pro 12.9": "2021",
  "iPad Air 5": "2022",
  "iPad Mini 7": "2024",
  "iPad Mini 6": "2021",
  "iPad 10": "2022",
  // Galaxy Buds
  "Samsung Galaxy Buds 2 Pro": "2022",
  "Samsung Galaxy Buds 2": "2021",
  // Xiaomi 17 series (17 Pro Max/Ultra are 2025, base might be 2026)
  "Xiaomi 17 Pro Max": "2025",
  "Xiaomi 17 Ultra": "2025",
  "Xiaomi 17 Pro": "2025",
  "Xiaomi 17": "2025",
  // Xiaomi 17T series (released later in the year)
  "Xiaomi 17T Pro Max": "2026",
  "Xiaomi 17T Pro": "2026",
  "Xiaomi 17T": "2026",
  // Redmi K80 series
  "Redmi K80 Pro": "2024",
  "Redmi K80": "2024",
  // Redmi Note 15 series (2025)
  "Redmi Note 15 Pro Plus": "2025",
  "Redmi Note 15 Pro": "2025",
  "Redmi Note 15": "2025",
  // Redmi Note 14 series (2024)
  "Redmi Note 14 Pro Plus": "2024",
  "Redmi Note 14 Pro": "2024",
  "Redmi Note 14": "2024",
  // OnePlus 15 series
  "OnePlus 15": "2025",
  "OnePlus 15 Pro": "2025",
  "OnePlus 15R": "2025",
  // OPPO Find X9 series
  "OPPO Find X9 Ultra": "2025",
  "OPPO Find X9 Pro": "2025",
  "OPPO Find X9s Pro": "2025",
  "OPPO Find X9s": "2025",
  // OPPO Reno series
  "OPPO Reno 16 Pro": "2025",
  "OPPO Reno 16": "2025",
  "OPPO Reno 13 Pro": "2025",
  "OPPO Reno 13": "2025",
  "OPPO Reno 12 Pro": "2024",
  "OPPO Reno 12": "2024",
  // Logitech G Series mice (different years)
  "Logitech G502 X Plus": "2022",
  "Logitech G502 X": "2022",
  "Logitech G502 Hero": "2019",
  "Logitech G305": "2018",
  "Logitech G203": "2017",
  "Logitech G703": "2017",
  "Logitech G903": "2017",
  // Logitech MX Series
  "Logitech MX Master 3S": "2022",
  "Logitech MX Master 2S": "2017",
  "Logitech MX Anywhere 3S": "2022",
  "Logitech MX Vertical": "2018",
  "Logitech MX Ergo": "2017",
  // Razer mice
  "Razer DeathAdder V3 Pro": "2022",
  "Razer DeathAdder V2 Pro": "2020",
  "Razer Viper V2 Pro": "2022",
  "Razer Viper V3 Pro": "2024",
  "Razer Basilisk V3 Pro": "2022",
  "Razer Basilisk V3": "2022",
  // Razer keyboards
  "Razer Huntsman V3 Pro": "2024",
  "Razer BlackWidow V4 Pro": "2023",
  "Razer Ornata V3": "2022",
  "Razer Cynosa V3": "2022",
  // Razer headsets
  "Razer BlackShark V2 Pro": "2020",
  "Razer Kraken V3 Pro": "2021",
  "Razer Barracuda Pro": "2022",
  // DJI Osmo Action (different years)
  "DJI Osmo Action 6": "2025",
  "DJI Osmo Action 5 Pro": "2024",
  "DJI Osmo Action 4": "2023",
  "DJI Osmo Action 3": "2022",
  // DJI Mavic 3 series
  "DJI Mavic 3 Pro": "2023",
  "DJI Mavic 3 Cine": "2021",
  "DJI Mavic 3": "2021",
  // Dyson V series
  "Dyson V15 Detect": "2021",
  "Dyson V15 Detect Gen 2": "2023",
  "Dyson V12 Detect Slim": "2021",
  "Dyson V11 Absolute": "2019",
  "Dyson Gen 5 Detect": "2022",
  // Gaming handhelds
  "Steam Deck OLED": "2023",
  "Steam Deck LCD": "2022",
  // Nintendo Switch
  "Nintendo Switch OLED": "2021",
  "Nintendo Switch V2": "2019",
  "Nintendo Switch Lite": "2019",
  // Bose
  "Bose QuietComfort Ultra": "2023",
  "Bose QuietComfort 45": "2021",
  "Bose QuietComfort": "2023",
  // GoPro
  "GoPro HERO 13 Black": "2024",
  "GoPro HERO 12 Black": "2023",
  "GoPro HERO 11 Black": "2022",
  // Insta360
  "Insta360 X5": "2025",
  "Insta360 X4": "2024",
  "Insta360 X3": "2022",
  "ASUS ROG Ally": "2023",
  "ASUS ROG Ally X": "2023",
  "ASUS ROG Azoth": "2023",
  "ASUS ROG Azoth Extreme": "2023",
  "ASUS ROG Chakram X": "2023",
  "ASUS ROG Delta II": "2023",
  "ASUS ROG Delta S": "2023",
  "ASUS ROG Delta S Animate": "2023",
  "ASUS ROG Falchion RX Low Profile": "2023",
  "ASUS ROG Flow X16 2024": "2024",
  "ASUS ROG Gladius III": "2023",
  "ASUS ROG Harpe Ace Aim Lab": "2023",
  "ASUS ROG Spatha X": "2023",
  "ASUS ROG Strix Fusion II 300": "2023",
  "ASUS ROG Strix Scar 16 2025": "2024",
  "ASUS ROG Strix Scar 18 2025": "2024",
  "ASUS ROG Strix Scope II 96": "2023",
  "ASUS ROG Strix XG27AQ": "2023",
  "ASUS ROG Swift OLED PG34WCDM": "2023",
  "ASUS ROG Swift PG27AQDM": "2023",
  "ASUS ROG Swift PG32UCDM": "2023",
  "ASUS ROG Zephyrus G14 2025": "2024",
  "ASUS ROG Zephyrus G16 2025": "2024",
  "ASUS TUF Gaming A15 2024": "2024",
  "ASUS TUF Gaming A16 2025": "2024",
  "ASUS TUF Gaming F16 2025": "2024",
  "Anker Nebula Capsule 3 Laser": "2018",
  "Anker Nebula Capsule II": "2018",
  "Anker Nebula Capsule Max": "2018",
  "Anker Nebula Cosmos 4K": "2020",
  "Anker Nebula Cosmos Laser 1080p": "2020",
  "Anker Nebula Mars 3": "2018",
  "Anker Nebula Mars II Pro": "2018",
  "Apple Watch SE 3 40mm": "2025",
  "Apple Watch SE 3 44mm": "2025",
  "Apple Watch Series 10 42mm": "2024",
  "Apple Watch Series 10 46mm": "2024",
  "Apple Watch Series 11 41mm": "2025",
  "Apple Watch Series 11 45mm": "2025",
  "Apple Watch Series 9 41mm": "2023",
  "Apple Watch Series 9 45mm": "2023",
  "Apple Watch Ultra 2": "2023",
  "Apple Watch Ultra 3": "2025",
  "Bose Home Speaker 500": "2018",
  "Bose Noise Cancelling 700": "2019",
  "Bose Smart Speaker 300": "2018",
  "Bose SoundLink Flex": "2020",
  "Bose SoundLink Revolve II": "2020",
  "Bose SoundLink Revolve Plus II": "2020",
  "Canon EOS 90D": "2019",
  "Canon EOS R3": "2021",
  "Canon EOS R5": "2020",
  "Canon EOS R5 Mark II": "2024",
  "Canon EOS R6": "2020",
  "Canon EOS R6 Mark II": "2022",
  "Canon EOS R8": "2023",
  "Canon EOS RP": "2019",
  "Corsair 4000D Airflow": "2022",
  "Corsair 5000D Airflow": "2022",
  "Corsair 7000D Airflow": "2022",
  "Corsair H100i Elite LCD": "2022",
  "Corsair HS80 RGB": "2022",
  "Corsair Harpoon RGB Pro": "2022",
  "Corsair K100 RGB": "2022",
  "Corsair K65 PRO Mini": "2022",
  "Corsair K70 MAX": "2022",
  "Corsair K70 RGB PRO": "2022",
  "Corsair K70 RGB TKL": "2022",
  "Corsair Katar Pro XT": "2022",
  "Corsair M65 RGB Ultra": "2022",
  "Corsair Sabre RGB Pro": "2022",
  "Corsair Virtuoso Max": "2022",
  "Corsair Virtuoso RGB Wireless XT": "2022",
  "Corsair Void RGB Elite": "2022",
  "Corsair iCUE 5000X RGB": "2022",
  "Corsair iCUE H150i Elite Capellix": "2022",
  "Corsair iCUE H150i Elite LCD": "2022",
  "DJI Air 3": "2023",
  "DJI Air 3S": "2024",
  "DJI Avata": "2022",
  "DJI Avata 2": "2024",
  "DJI FPV": "2021",
  "DJI Inspire 3": "2023",
  "DJI Mavic 4": "2025",
  "DJI Mavic 4 Pro": "2025",
  "DJI Mic": "2022",
  "DJI Mic 2": "2024",
  "DJI Mini 3": "2022",
  "DJI Mini 3 Pro": "2022",
  "DJI Mini 4 Pro": "2023",
  "DJI Osmo Mobile 6": "2022",
  "DJI Osmo Mobile 7": "2022",
  "DJI Osmo Pocket 2": "2020",
  "DJI Osmo Pocket 3": "2023",
  "DJI Osmo Pocket 3 Creator Combo": "2023",
  "DJI Osmo Pocket 4": "2025",
  "DJI Osmo Pocket 4 Pro": "2025",
  "DJI RS 3": "2022",
  "DJI RS 3 Pro": "2022",
  "DJI RS 4": "2024",
  "DJI RS 4 Pro": "2024",
  "Dyson Airstrait": "2023",
  "Dyson Airwrap Complete": "2018",
  "Dyson Airwrap Multi-styler": "2018",
  "Dyson Corrale Hair Straightener": "2020",
  "Dyson Gen 5 Outsize": "2022",
  "Dyson Supersonic Hair Dryer": "2016",
  "Dyson Supersonic Nural": "2016",
  "Dyson V11 Torque Drive": "2019",
  "Dyson V15s Detect Submarine": "2021",
  "Ecovacs Deebot T20 Omni": "2023",
  "Ecovacs Deebot T30 Pro": "2023",
  "Ecovacs Deebot X1 Omni": "2023",
  "Ecovacs Deebot X2 Omni": "2023",
  "Fujifilm GFX 100S": "2021",
  "Fujifilm GFX 50S II": "2021",
  "Fujifilm X-H2": "2022",
  "Fujifilm X-H2S": "2022",
  "Fujifilm X-Pro3": "2019",
  "Fujifilm X-T4": "2020",
  "Fujifilm X-T5": "2022",
  "Fujifilm X100V": "2020",
  "Fujifilm X100VI": "2020",
  "GoPro HERO 11 Mini": "2022",
  "GoPro LIT HERO": "2025",
  "GoPro MAX": "2019",
  "GoPro MAX 2": "2025",
  "Honor 200": "2024",
  "Honor 200 Pro": "2024",
  "Honor 300": "2024",
  "Honor 300 Pro": "2024",
  "Honor 300 Ultra": "2024",
  "Honor Magic 6": "2024",
  "Honor Magic 6 Pro": "2024",
  "Honor Magic 7": "2025",
  "Honor Magic 7 Pro": "2025",
  "Honor Magic 7 Ultimate": "2025",
  "Honor X50": "2024",
  "Honor X60": "2024",
  "Insta360 Ace": "2023",
  "Insta360 Ace Pro": "2023",
  "Insta360 Ace Pro 2": "2024",
  "Insta360 GO 3": "2023",
  "Insta360 GO 4": "2025",
  "Insta360 GO Ultra": "2025",
  "Insta360 Luna": "2025",
  "Insta360 Luna Ultra": "2025",
  "Insta360 X4 Air": "2024",
  "JBL Charge 4": "2018",
  "JBL Charge 5": "2022",
  "JBL Clip 4": "2022",
  "JBL Clip 5": "2024",
  "JBL Extreme 3": "2020",
  "JBL Extreme 4": "2023",
  "JBL Flip 5": "2019",
  "JBL Flip 6": "2022",
  "JBL Go 3": "2021",
  "JBL Go 4": "2023",
  "JBL Tune 510BT": "2022",
  "JBL Tune 520BT": "2022",
  "Lenovo Legion Go": "2023",
  "Logitech Astro A30": "2022",
  "Logitech Astro A50 X": "2022",
  "Logitech Brio 500": "2022",
  "Logitech C920s Pro": "2019",
  "Logitech C922 Pro": "2016",
  "Logitech G Pro Racing Wheel": "2023",
  "Logitech G Pro Wireless": "2018",
  "Logitech G Pro X": "2022",
  "Logitech G Pro X 2": "2022",
  "Logitech G Pro X 60": "2024",
  "Logitech G Pro X Superlight": "2020",
  "Logitech G Pro X Superlight 2": "2023",
  "Logitech G Pro X Superlight 2 Dota 2 Edition": "2024",
  "Logitech G Pro X Superlight 2 Lightspeed": "2023",
  "Logitech G Pro X TKL": "2023",
  "Logitech G203 Lightsync": "2017",
  "Logitech G29": "2015",
  "Logitech G305 Lightspeed": "2018",
  "Logitech G403 Lightspeed": "2017",
  "Logitech G502 X Lightspeed": "2022",
  "Logitech G512": "2018",
  "Logitech G703 Lightspeed": "2017",
  "Logitech G733": "2022",
  "Logitech G903 Lightspeed": "2017",
  "Logitech G915 TKL": "2021",
  "Logitech G923": "2020",
  "Logitech G935": "2022",
  "Logitech MX Brio": "2024",
  "Logitech MX Keys S": "2023",
  "Logitech MX Master 3": "2019",
  "Logitech MX Mechanical": "2022",
  "MacBook Air M1": "2020",
  "MacBook Air M2": "2022",
  "MacBook Air M3": "2023",
  "MacBook Air M5": "2025",
  "MacBook Pro M2": "2022",
  "MacBook Pro M3": "2023",
  "MacBook Pro M3 Pro": "2023",
  "MacBook Pro M4": "2024",
  "MacBook Pro M4 Max": "2024",
  "MacBook Pro M4 Pro": "2024",
  "MacBook Pro M5": "2025",
  "MacBook Pro M5 Max": "2025",
  "MacBook Pro M5 Pro": "2025",
  "Motorola Edge 50": "2024",
  "Motorola Edge 50 Pro": "2024",
  "Motorola Edge 50 Ultra": "2024",
  "Motorola Edge 60": "2025",
  "Motorola Edge 60 Pro": "2025",
  "Motorola Edge 60 Ultra": "2025",
  "Motorola Moto G Power 5G": "2024",
  "Motorola Moto G Stylus 5G": "2024",
  "Motorola Razr 60": "2025",
  "Motorola Razr 60 Ultra": "2025",
  "Nikon Z 6 II": "2018",
  "Nikon Z 6 III": "2018",
  "Nikon Z 7 II": "2018",
  "Nikon Z 8": "2023",
  "Nikon Z 9": "2021",
  "Nikon Z f": "2023",
  "Nikon Z fc": "2021",
  "Nintendo Switch 2": "2025",
  "OPPO A3 Pro": "2024",
  "OPPO A60": "2024",
  "OPPO Enco Air 4": "2024",
  "OPPO Enco X3": "2024",
  "OPPO Find X7 Pro": "2024",
  "OPPO Find X7 Ultra": "2024",
  "OPPO Find X8": "2024",
  "OPPO Find X8 Pro": "2024",
  "OPPO Find X8 Ultra": "2024",
  "OPPO Pad 2": "2023",
  "OPPO Pad 3": "2025",
  "OPPO Pad 5": "2025",
  "OPPO Pad SE": "2025",
  "OnePlus 12": "2024",
  "OnePlus 12R": "2024",
  "OnePlus 13": "2025",
  "OnePlus 13R": "2025",
  "OnePlus 13T": "2025",
  "OnePlus Buds 3": "2025",
  "OnePlus Buds 3 Pro": "2025",
  "OnePlus Buds 4": "2025",
  "OnePlus Nord 4": "2024",
  "OnePlus Nord Buds 4": "2025",
  "OnePlus Nord Buds 4 Pro": "2025",
  "OnePlus Nord CE 4": "2024",
  "POCO F7 Pro": "2025",
  "POCO F7 Ultra": "2025",
  "POCO X7": "2025",
  "POCO X7 Pro": "2025",
  "PlayStation 5 Slim Digital": "2023",
  "PlayStation 5 Slim Disc": "2023",
  "PlayStation 5 Standard Digital": "2020",
  "PlayStation 5 Standard Disc": "2020",
  "Razer Barracuda X": "2022",
  "Razer BlackShark V2": "2022",
  "Razer BlackWidow V3": "2022",
  "Razer Blade 14 2025": "2024",
  "Razer Blade 15 2024": "2024",
  "Razer Blade 16 2025": "2024",
  "Razer Blade 18 2025": "2024",
  "Razer DeathAdder V3": "2020",
  "Razer DeathStalker V2 Pro": "2022",
  "Razer Firefly V2 Pro": "2023",
  "Razer Goliathus Extended Chroma": "2023",
  "Razer Goliathus Speed Medium": "2023",
  "Razer Huntsman V2": "2022",
  "Razer Huntsman V3 Pro Mini": "2022",
  "Razer Kiyo Pro Ultra": "2023",
  "Razer Kraken Kitty V2": "2022",
  "Razer Kraken V3": "2022",
  "Razer Kraken V4": "2022",
  "Razer Naga V2 Pro": "2021",
  "Razer Naga X": "2021",
  "Razer Nari Essential": "2022",
  "Razer Nari Ultimate": "2022",
  "Razer Ornata V3 Pro": "2022",
  "Razer Orochi V2": "2022",
  "Razer Orochi V2 Pro": "2022",
  "Razer Raiju Ultimate": "2023",
  "Razer Ripsaw HD": "2023",
  "Razer Seiren V3 Pro": "2023",
  "Razer Viper V3": "2022",
  "Razer Wolverine V2 Chroma": "2023",
  "Razer Wolverine V3 Pro": "2023",
  "Realme 13 Plus": "2024",
  "Realme 13 Pro": "2024",
  "Realme 13 Pro Plus": "2024",
  "Realme 14 Pro": "2025",
  "Realme 14 Pro Plus": "2025",
  "Realme GT 6": "2024",
  "Realme GT 7": "2025",
  "Realme GT 7 Pro": "2025",
  "Realme Narzo 70": "2024",
  "Realme Narzo 70 Pro": "2024",
  "Redmi Book 14 2024": "2024",
  "Redmi Book 16 2024": "2024",
  "Redmi Book 16 2025": "2025",
  "Redmi Buds 6": "2024",
  "Redmi Buds 6 Pro": "2024",
  "Redmi Buds 8": "2025",
  "Redmi Buds 8 Lite": "2025",
  "Redmi Buds 8 Pro": "2025",
  "Redmi Pad 8": "2024",
  "Redmi Pad SE 8": "2024",
  "Redmi Turbo 4": "2025",
  "Redmi Turbo 4 Pro": "2025",
  "Roborock Qrevo": "2023",
  "Roborock Qrevo MaxV": "2024",
  "Roborock Qrevo Pro": "2024",
  "Roborock S7": "2021",
  "Roborock S7 MaxV": "2022",
  "Roborock S8": "2023",
  "Roborock S8 MaxV": "2024",
  "Roborock S8 Pro": "2023",
  "Rode NT-USB": "2015",
  "Rode NT-USB Mini": "2015",
  "Rode NT1 5th Gen": "2014",
  "Rode PodMic": "2018",
  "Rode PodMic USB": "2018",
  "Rode VideoMic NTG": "2016",
  "Rode VideoMic Pro Plus": "2016",
  "Rode Wireless GO II": "2019",
  "Rode Wireless ME": "2019",
  "Samsung Galaxy Book 4 Pro": "2024",
  "Samsung Galaxy Book 4 Pro 360": "2024",
  "Samsung Galaxy Book 4 Ultra": "2024",
  "Samsung Galaxy Book 5 Pro": "2025",
  "Samsung Galaxy Book 5 Pro 360": "2025",
  "Samsung Galaxy Buds 3": "2024",
  "Samsung Galaxy Buds 3 Pro": "2024",
  "Samsung Galaxy S24": "2024",
  "Samsung Galaxy S24 Plus": "2024",
  "Samsung Galaxy S24 Ultra": "2024",
  "Samsung Galaxy S25": "2025",
  "Samsung Galaxy S25 Edge": "2025",
  "Samsung Galaxy S25 Plus": "2025",
  "Samsung Galaxy S25 Ultra": "2025",
  "Samsung Galaxy S26": "2026",
  "Samsung Galaxy S26 Edge": "2026",
  "Samsung Galaxy S26 Plus": "2026",
  "Samsung Galaxy S26 Ultra": "2026",
  "Samsung Galaxy Tab S10 Plus": "2024",
  "Samsung Galaxy Tab S10 Ultra": "2024",
  "Samsung Galaxy Tab S9 FE": "2023",
  "Samsung Galaxy Tab S9 FE Plus": "2023",
  "Samsung Galaxy Tab S9 Ultra": "2023",
  "Shure MV7": "2020",
  "Shure MV7 Plus": "2020",
  "Shure SM7dB": "2023",
  "Sonos Beam Gen 2": "2021",
  "Sonos Era 100": "2023",
  "Sonos Era 300": "2023",
  "Sonos Move": "2019",
  "Sonos Move 2": "2019",
  "Sonos One Gen 2": "2017",
  "Sonos One SL": "2017",
  "Sonos Ray": "2022",
  "Sony Alpha A1": "2021",
  "Sony Alpha A7 III": "2021",
  "Sony Alpha A7 IV": "2021",
  "Sony Alpha A7C II": "2021",
  "Sony DualSense": "2020",
  "Sony DualSense Edge": "2020",
  "Sony PlayStation VR2": "2023",
  "Sony ZV-1 II": "2022",
  "Sony ZV-E10": "2022",
  "Vivo V40": "2024",
  "Vivo V40 Pro": "2024",
  "Vivo X100": "2024",
  "Vivo X100 Pro": "2024",
  "Vivo X200": "2025",
  "Vivo X200 Pro": "2025",
  "Vivo X200 Ultra": "2025",
  "Vivo iQOO 13": "2025",
  "Vivo iQOO 13 Pro": "2025",
  "Vivo iQOO Neo 10": "2025",
  "Vivo iQOO Neo 10 Pro": "2025",
  "XGIMI Aura": "2021",
  "XGIMI Halo": "2020",
  "XGIMI HaloPlus": "2020",
  "XGIMI Horizon": "2021",
  "XGIMI Horizon Pro": "2021",
  "XGIMI MoGo 2": "2020",
  "XGIMI MoGo 2 Pro": "2020",
  "Xiaomi 15": "2024",
  "Xiaomi 15 Pro": "2024",
  "Xiaomi 15 Ultra": "2024",
  "Xiaomi 15T": "2024",
  "Xiaomi 15T Pro": "2024",
  "Xiaomi Buds 5": "2024",
  "Xiaomi Buds 5 Pro": "2024",
  "Xiaomi Mi Band 8": "2024",
  "Xiaomi Mi Band 9": "2024",
  "Xiaomi Pad 7": "2024",
  "Xiaomi Pad 7 Pro": "2024",
  "Xiaomi Pad 8": "2025",
  "Xiaomi Pad 8 Pro": "2025",
  "POCO F6": "2024",
  "POCO F6 Pro": "2024",
  "POCO X6": "2024",
  "POCO X6 Pro": "2024",
  "Redmi 13C": "2023",
  "Redmi 13C Pro": "2023",
  "Redmi K70": "2023",
  "Redmi K70 Pro": "2023",
  "Redmi K70E": "2023",
  "Redmi Note 13": "2023",
  "Redmi Note 13 Pro": "2023",
  "Redmi Note 13 Pro Plus": "2023",
  "Redmi Turbo 3": "2024",
  "Redmi Turbo 3 Pro": "2024",
  "Xiaomi 13": "2022",
  "Xiaomi 13 Pro": "2022",
  "Xiaomi 13 Ultra": "2023",
  "Xiaomi 14": "2023",
  "Xiaomi 14 Pro": "2023",
  "Xiaomi 14 Ultra": "2024",
  "JBL Flip 7": "2025",
  "JBL Charge 6": "2025",
  "JBL Extreme 5": "2025",
  "JBL Go 5": "2025",
  "Vitamix A3500": "2017",
  "Vitamix A2500": "2017",
  "Vitamix A2300": "2017",
  "Vitamix E310": "2018",
  "Vitamix E320": "2018",
  "JBL PartyBox Stage 320": "2024",
  "JBL PartyBox Club 120": "2024",
  "JBL PartyBox Encore Essential": "2023",
  "JBL PartyBox 310": "2022",
  "JBL PartyLight Speaker": "2024",
  "JBL PartyLight Lantern": "2024",
  "JBL PartyLight Stick": "2024",
  "JBL Sing Classic": "2024",
  "JBL Sing Mini": "2024",
  "Xiaomi Mi Smart Desk Lamp Pro": "2022",
  "Xiaomi Mi Desk Lamp 1S": "2021",
  "Xiaomi Mi Bedside Lamp 2": "2020",
  "Xiaomi Mijia Table Lamp Pro": "2023",
  "Xiaomi Mi Smart LED Bulb Essential": "2021",
  "Xiaomi Yeelight LED Bulb": "2020",
  "Xiaomi Mijia Smart Bulb": "2023",
  "Xiaomi Mi Air Purifier 4 Pro": "2022",
  "Xiaomi Mi Air Purifier 4": "2022",
  "Xiaomi Mi Smart Humidifier 2": "2022",
  "Xiaomi Mi Smart Kettle Pro": "2021",
};

BRAND_CATALOG.forEach((brand) => {
  brand.productTypes.forEach((pt) => {
    pt.generations.forEach((g) => {
      g.releaseDate = RELEASE_DATE_OVERRIDES[g.id] ?? g.year;
      // Set each model's releaseDate: use the per-model override if available,
      // otherwise inherit the generation's releaseDate.
      g.models.forEach((m) => {
        m.releaseDate = MODEL_RELEASE_DATES[m.query] ?? g.releaseDate;
      });
    });
  });
});

export const PRESETS: PresetItem[] = BRAND_CATALOG.flatMap((brand) =>
  brand.productTypes.flatMap((pt) =>
    pt.generations.flatMap((g) =>
      g.models.map((m) => ({ label: m.label, query: m.query, category: pt.category })),
    ),
  ),
);
export const CONDITION_LABELS: Record<Condition, string> = {
  new: "New",
  open_box: "Open Box",
  excellent: "Excellent",
  very_good: "Very Good",
  good: "Good",
  fair: "Fair",
  unknown: "Used",
};
export const CONDITION_COLORS: Record<Condition, string> = {
  new: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  open_box: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800",
  excellent: "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800",
  very_good: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  good: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
  fair: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800",
  unknown: "bg-muted text-muted-foreground border-border",
};
export function eur(n: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}
export function eurPrecise(n: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
export function cny(n: number): string {
  return `¥${n.toLocaleString("zh-CN")}`;
}