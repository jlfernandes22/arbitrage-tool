// lib/overrides.ts
// Shared validation for client-sent config overrides.
//
// A client must not be able to send arbitrary overrides (fake forex rates,
// bypassed profitability filters, 10000 max pages, …). Only known keys are
// accepted; values are clamped to sane ranges; unknown keys are rejected.
// Used by the task-submit AND task-reevaluate APIs so both write paths
// enforce the same rules.

import type { AppConfig } from "@/lib/engine/types";

const FORWARDER_TYPES = new Set(["cssbuy", "superbuy", "wegobuy", "bhiner", "custom"]);
const MAX_PAGES_DEFAULT = 10; // matches the UI slider max for the fallback
const MAX_PAGES_PER_SITE = 20; // matches the UI page-input clamp

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}
function pickKnownNumber(
  section: unknown,
  key: string,
  min: number,
  max: number,
): number | undefined {
  if (!section || typeof section !== "object" || Array.isArray(section)) return undefined;
  const v = (section as Record<string, unknown>)[key];
  if (!isFiniteNumber(v)) return undefined;
  return clamp(v, min, max);
}
function pickKnownBoolean(section: unknown, key: string): boolean | undefined {
  if (!section || typeof section !== "object" || Array.isArray(section)) return undefined;
  const v = (section as Record<string, unknown>)[key];
  return isBoolean(v) ? v : undefined;
}
function assertKnownKeys(obj: unknown, allowed: string[], where: string): string | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (!allowed.includes(key)) {
      return `Unknown config override key "${where}.${key}"`;
    }
  }
  return null;
}

// Overrides are shipped as partial sections (only the keys the client set),
// which `resolveConfig` merges over the base config at runtime.
export type SanitizedOverrides = {
  forex?: Partial<AppConfig["forex"]>;
  logistics?: Partial<AppConfig["logistics"]>;
  tax?: Partial<AppConfig["tax"]>;
  profitability?: Partial<AppConfig["profitability"]>;
  scam_filter?: Partial<AppConfig["scam_filter"]>;
  scraping?: Partial<AppConfig["scraping"]>;
};

export function sanitizeConfigOverrides(input: unknown): { ok: true; overrides?: SanitizedOverrides } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "configOverrides must be an object" };
  }
  const allowed = ["forex", "logistics", "tax", "profitability", "scam_filter", "scraping"];
  const unknownKey = assertKnownKeys(input, allowed, "configOverrides");
  if (unknownKey) return { ok: false, error: unknownKey };

  const o = input as Record<string, unknown>;
  const overrides: SanitizedOverrides = {};

  // forex
  if (o.forex !== undefined) {
    const unknown = assertKnownKeys(o.forex, ["cny_to_eur_rate", "exchange_fee"], "forex");
    if (unknown) return { ok: false, error: unknown };
    const cny_to_eur_rate = pickKnownNumber(o.forex, "cny_to_eur_rate", 0.01, 1);
    const exchange_fee = pickKnownNumber(o.forex, "exchange_fee", 0, 0.5);
    if (cny_to_eur_rate !== undefined || exchange_fee !== undefined) {
      overrides.forex = {
        ...(cny_to_eur_rate !== undefined ? { cny_to_eur_rate } : {}),
        ...(exchange_fee !== undefined ? { exchange_fee } : {}),
      };
    }
  }

  // logistics
  if (o.logistics !== undefined) {
    const unknown = assertKnownKeys(o.logistics, [
      "forwarder_type", "agent_service_fee_rate", "inspection_fee_eur",
      "domestic_shipping_cn_eur", "insurance_fee_rate", "international_shipping_eur",
      "customs_clearance_fee_eur", "import_duty_rate", "domestic_shipping_eur",
    ], "logistics");
    if (unknown) return { ok: false, error: unknown };
    const log = o.logistics as Record<string, unknown>;
    const logistics: Partial<AppConfig["logistics"]> = {};
    if (typeof log.forwarder_type === "string") {
      if (!FORWARDER_TYPES.has(log.forwarder_type)) {
        return { ok: false, error: `Unknown forwarder_type "${log.forwarder_type}"` };
      }
      logistics.forwarder_type = log.forwarder_type;
    }
    const agent_service_fee_rate = pickKnownNumber(o.logistics, "agent_service_fee_rate", 0, 0.5);
    const inspection_fee_eur = pickKnownNumber(o.logistics, "inspection_fee_eur", 0, 100);
    const domestic_shipping_cn_eur = pickKnownNumber(o.logistics, "domestic_shipping_cn_eur", 0, 200);
    const insurance_fee_rate = pickKnownNumber(o.logistics, "insurance_fee_rate", 0, 0.5);
    const international_shipping_eur = pickKnownNumber(o.logistics, "international_shipping_eur", 0, 1000);
    const customs_clearance_fee_eur = pickKnownNumber(o.logistics, "customs_clearance_fee_eur", 0, 500);
    const import_duty_rate = pickKnownNumber(o.logistics, "import_duty_rate", 0, 1);
    const domestic_shipping_eur = pickKnownNumber(o.logistics, "domestic_shipping_eur", 0, 500);
    if (agent_service_fee_rate !== undefined) logistics.agent_service_fee_rate = agent_service_fee_rate;
    if (inspection_fee_eur !== undefined) logistics.inspection_fee_eur = inspection_fee_eur;
    if (domestic_shipping_cn_eur !== undefined) logistics.domestic_shipping_cn_eur = domestic_shipping_cn_eur;
    if (insurance_fee_rate !== undefined) logistics.insurance_fee_rate = insurance_fee_rate;
    if (international_shipping_eur !== undefined) logistics.international_shipping_eur = international_shipping_eur;
    if (customs_clearance_fee_eur !== undefined) logistics.customs_clearance_fee_eur = customs_clearance_fee_eur;
    if (import_duty_rate !== undefined) logistics.import_duty_rate = import_duty_rate;
    if (domestic_shipping_eur !== undefined) logistics.domestic_shipping_eur = domestic_shipping_eur;
    if (Object.keys(logistics).length > 0) overrides.logistics = logistics;
  }

  // tax
  if (o.tax !== undefined) {
    const unknown = assertKnownKeys(o.tax, ["pt_vat_rate"], "tax");
    if (unknown) return { ok: false, error: unknown };
    const pt_vat_rate = pickKnownNumber(o.tax, "pt_vat_rate", 0, 1);
    if (pt_vat_rate !== undefined) overrides.tax = { pt_vat_rate };
  }

  // profitability
  if (o.profitability !== undefined) {
    const unknown = assertKnownKeys(o.profitability, ["min_margin_pct", "min_net_profit_eur"], "profitability");
    if (unknown) return { ok: false, error: unknown };
    const min_margin_pct = pickKnownNumber(o.profitability, "min_margin_pct", 0, 1);
    const min_net_profit_eur = pickKnownNumber(o.profitability, "min_net_profit_eur", 0, 10000);
    if (min_margin_pct !== undefined || min_net_profit_eur !== undefined) {
      overrides.profitability = {
        ...(min_margin_pct !== undefined ? { min_margin_pct } : {}),
        ...(min_net_profit_eur !== undefined ? { min_net_profit_eur } : {}),
      };
    }
  }

  // scam_filter
  if (o.scam_filter !== undefined) {
    const unknown = assertKnownKeys(o.scam_filter, ["hide_threshold"], "scam_filter");
    if (unknown) return { ok: false, error: unknown };
    const hide_threshold = pickKnownNumber(o.scam_filter, "hide_threshold", 0, 100);
    if (hide_threshold !== undefined) overrides.scam_filter = { hide_threshold };
  }

  // scraping
  if (o.scraping !== undefined) {
    const unknown = assertKnownKeys(o.scraping, [
      "max_pages", "goofish_pages", "olx_pages", "vinted_pages",
      "kuantokusta_pages", "amazon_pages", "skip_vinted", "skip_olx",
      "skip_kuantokusta", "skip_amazon", "skip_new", "skip_used",
      "min_price_cny", "max_price_cny", "enrich_all",
    ], "scraping");
    if (unknown) return { ok: false, error: unknown };
    const scraping: Partial<AppConfig["scraping"]> = {};
    const max_pages = pickKnownNumber(o.scraping, "max_pages", 1, MAX_PAGES_DEFAULT);
    const goofish_pages = pickKnownNumber(o.scraping, "goofish_pages", 0, MAX_PAGES_PER_SITE);
    const olx_pages = pickKnownNumber(o.scraping, "olx_pages", 0, MAX_PAGES_PER_SITE);
    const vinted_pages = pickKnownNumber(o.scraping, "vinted_pages", 0, MAX_PAGES_PER_SITE);
    const kuantokusta_pages = pickKnownNumber(o.scraping, "kuantokusta_pages", 0, MAX_PAGES_PER_SITE);
    const amazon_pages = pickKnownNumber(o.scraping, "amazon_pages", 0, MAX_PAGES_PER_SITE);
    const min_price_cny = pickKnownNumber(o.scraping, "min_price_cny", 0, 100000);
    const max_price_cny = pickKnownNumber(o.scraping, "max_price_cny", 0, 100000);
    if (max_pages !== undefined) scraping.max_pages = max_pages;
    if (goofish_pages !== undefined) scraping.goofish_pages = goofish_pages;
    if (olx_pages !== undefined) scraping.olx_pages = olx_pages;
    if (vinted_pages !== undefined) scraping.vinted_pages = vinted_pages;
    if (kuantokusta_pages !== undefined) scraping.kuantokusta_pages = kuantokusta_pages;
    if (amazon_pages !== undefined) scraping.amazon_pages = amazon_pages;
    if (min_price_cny !== undefined) scraping.min_price_cny = min_price_cny;
    if (max_price_cny !== undefined) scraping.max_price_cny = max_price_cny;
    const skip_vinted = pickKnownBoolean(o.scraping, "skip_vinted");
    const skip_olx = pickKnownBoolean(o.scraping, "skip_olx");
    const skip_kuantokusta = pickKnownBoolean(o.scraping, "skip_kuantokusta");
    const skip_amazon = pickKnownBoolean(o.scraping, "skip_amazon");
    const skip_new = pickKnownBoolean(o.scraping, "skip_new");
    const skip_used = pickKnownBoolean(o.scraping, "skip_used");
    const enrich_all = pickKnownBoolean(o.scraping, "enrich_all");
    if (skip_vinted !== undefined) scraping.skip_vinted = skip_vinted;
    if (skip_olx !== undefined) scraping.skip_olx = skip_olx;
    if (skip_kuantokusta !== undefined) scraping.skip_kuantokusta = skip_kuantokusta;
    if (skip_amazon !== undefined) scraping.skip_amazon = skip_amazon;
    if (skip_new !== undefined) scraping.skip_new = skip_new;
    if (skip_used !== undefined) scraping.skip_used = skip_used;
    if (enrich_all !== undefined) scraping.enrich_all = enrich_all;
    if (Object.keys(scraping).length > 0) overrides.scraping = scraping;
  }

  return { ok: true, overrides };
}
