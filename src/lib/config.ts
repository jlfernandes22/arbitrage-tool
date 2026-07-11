import configJson from "@/config.json";
export interface AppConfig {
  forex: {
    cny_to_eur_rate: number;
    exchange_fee: number;
    fallback_rate: number;
    api_url: string;
    ttl_seconds: number;
  };
  logistics: {
    // ── Buying agent (forwarder) costs ──
    // Forwarder type: "cssbuy" | "superbuy" | "wegobuy" | "custom"
    // Different agents have different fee structures. "custom" = user-defined.
    forwarder_type: string;
    agent_service_fee_rate: number; // % of acquisition cost (CSS Buy ~5%, Superbuy ~5%, Wegobuy ~4%)
    inspection_fee_eur: number; // photo/inspection fee per item (~€2-5)
    domestic_shipping_cn_eur: number; // seller → agent warehouse (~€3-8)
    insurance_fee_rate: number; // % of acquisition (~1-2%)
    // ── International shipping ──
    international_shipping_eur: number; // air freight to EU (~€20-40 for phones, ~€40-80 for laptops)
    // ── Customs & taxes ──
    customs_clearance_fee_eur: number; // broker fee (~€12-20)
    import_duty_rate: number; // 0% for phones/laptops, 2-14% for other electronics
    // ── Portugal domestic ──
    domestic_shipping_eur: number; // CTT / local courier (~€7)
  };
  tax: {
    pt_vat_rate: number;
  };
  marketplace_fees: {
    olx_fee_rate: number;
    vinted_fee_rate: number;
    kuantokusta_fee_rate: number;
    amazon_fee_rate: number;
    default_resale_fee_rate: number;
  };
  profitability: {
    min_margin_pct: number;
    min_net_profit_eur: number;
  };
  scam_filter: {
    hide_threshold: number;
  };
  scraping: {
    max_listings_per_search: number;
    max_pages: number;
    // Per-site page overrides. When undefined / 0, fall back to max_pages.
    goofish_pages?: number;
    olx_pages?: number;
    vinted_pages?: number;
    kuantokusta_pages?: number;
    amazon_pages?: number;
    // Skip Vinted scraper entirely (OLX-only comparison).
    skip_vinted?: boolean;
    // Skip OLX scraper entirely (Vinted-only comparison).
    skip_olx?: boolean;
    // Skip KuantoKusta (Portuguese price-comparison; NEW retail prices).
    skip_kuantokusta?: boolean;
    // Skip Amazon (amazon.es; NEW retail prices).
    skip_amazon?: boolean;
    // Master switch: skip ALL new/retail sources (KuantoKusta + Amazon).
    // When true, overrides skip_kuantokusta + skip_amazon to true.
    skip_new?: boolean;
    // Master switch: skip ALL second-hand sources (OLX + Vinted).
    // When true, overrides skip_olx + skip_vinted to true.
    skip_used?: boolean;
    min_price_cny?: number;
    max_price_cny?: number;
    enrich_all?: boolean;
    jitter_min_ms: number;
    jitter_max_ms: number;
    goofish_search_url: string;
    olx_search_url: string;
    vinted_search_url: string;
    kuantokusta_search_url: string;
    amazon_search_url: string;
  };
}
export const config: AppConfig = configJson as AppConfig;
/**
 * Merge persisted overrides (from DB / UI) on top of the base config.
 * Used by the live configuration panel to allow real-time overrides.
 */
export function resolveConfig(overrides?: Partial<AppConfig>): AppConfig {
  if (!overrides) return config;
  return {
    ...config,
    ...overrides,
    forex: { ...config.forex, ...overrides.forex },
    logistics: { ...config.logistics, ...overrides.logistics },
    tax: { ...config.tax, ...overrides.tax },
    marketplace_fees: { ...config.marketplace_fees, ...overrides.marketplace_fees },
    profitability: { ...config.profitability, ...overrides.profitability },
    scam_filter: { ...config.scam_filter, ...overrides.scam_filter },
    scraping: { ...config.scraping, ...overrides.scraping },
  };
}