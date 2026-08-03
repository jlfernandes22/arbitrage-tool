"use client";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  Settings2,
  ChevronDown,
  ChevronRight,
  Loader2,
  ClipboardPaste,
  RotateCcw,
  Zap,
  Bug,
  Layers,
  Square,
  Check,
  CheckCircle2,
  X,
  Clock,
} from "lucide-react";
import {
  type AppConfigOverrides,
  type Category,
  BRAND_CATALOG,
  type Brand,
  type ProductType,
  type ModelVariant,
} from "./types";
interface ControlPanelProps {
  onScan: (query: string, category: Category, overrides: AppConfigOverrides) => void;
  onManualPaste: (html: string) => boolean | Promise<boolean>;
  onStop?: () => void;
  onConfigChange?: (overrides: AppConfigOverrides) => void;
  scanning: boolean;
  paused: boolean;
  query: string;
  setQuery: (q: string) => void;
  category: Category;
  setCategory: (c: Category) => void;
  stopping?: boolean;
}
export function ControlPanel({
  onScan,
  onManualPaste,
  onStop,
  onConfigChange,
  scanning,
  paused,
  query,
  setQuery,
  category,
  setCategory,
  stopping = false,
}: ControlPanelProps) {
  const [configOpen, setConfigOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteHtml, setPasteHtml] = useState("");
  // Goofish debug diagnostics. `debugRunning` tracks WHICH scraper is
  // currently executing so only that button shows the loading spinner
  // (a single boolean made every button look busy at once).
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugRunning, setDebugRunning] = useState<string | null>(null);
  const [debugResult, setDebugResult] = useState<string | null>(null);
  // config overrides
  const [cnyToEur, setCnyToEur] = useState(0.127);
  const [exchangeFee, setExchangeFee] = useState(2.5);
  const [vatRate, setVatRate] = useState(23);
  // ── Logistics / forwarder costs ──
  // The import system now models the full China→EU buying-agent cost stack:
  // agent service fee, inspection fee, CN domestic shipping, insurance,
  // international shipping, customs clearance, import duty, PT domestic.
  // A forwarder preset (CSS Buy / Superbuy / Wegobuy / Bhiner / Custom) sets
  // all these at once; the user can still fine-tune individual values.
  const [forwarderType, setForwarderType] = useState("cssbuy");
  const [agentServiceFee, setAgentServiceFee] = useState(5); // % of acquisition
  const [inspectionFee, setInspectionFee] = useState(3); // € flat per item
  const [domesticShippingCn, setDomesticShippingCn] = useState(5); // € seller→warehouse
  const [insuranceFee, setInsuranceFee] = useState(1.5); // % of acquisition
  const [internationalShip, setInternationalShip] = useState(30); // € air freight
  const [clearance, setClearance] = useState(15); // € customs broker
  const [importDutyRate, setImportDutyRate] = useState(0); // % (0 for phones/laptops)
  const [domesticShip, setDomesticShip] = useState(7); // € PT domestic
  const [minMargin, setMinMargin] = useState(15);
  const [minProfit, setMinProfit] = useState(30);
  const [scamThreshold, setScamThreshold] = useState(60);
  const [maxPages, setMaxPages] = useState(3);
  // Per-site page overrides. 0 → fall back to maxPages.
  const [goofishPages, setGoofishPages] = useState(0);
  const [olxPages, setOlxPages] = useState(0);
  const [vintedPages, setVintedPages] = useState(0);
  const [skipVinted, setSkipVinted] = useState(false);
  const [skipOlx, setSkipOlx] = useState(false);
  const [skipKk, setSkipKk] = useState(false);
  const [skipAmazon, setSkipAmazon] = useState(false);
  // Master switches — derived from the individual skips.
  // skipNew = skip BOTH new-retail sources (KuantoKusta + Amazon).
  // skipUsed = skip BOTH second-hand sources (OLX + Vinted).
  // Toggling a master ON sets both individuals true; OFF sets both false.
  const skipNew = skipKk && skipAmazon;
  const skipUsed = skipOlx && skipVinted;
  const handleSkipNewChange = (on: boolean) => {
    setSkipKk(on);
    setSkipAmazon(on);
  };
  const handleSkipUsedChange = (on: boolean) => {
    setSkipOlx(on);
    setSkipVinted(on);
  };
  // Per-site page overrides for the new retail sources.
  const [kkPages, setKkPages] = useState(0);
  const [amazonPages, setAmazonPages] = useState(0);
  // Cost mode — radio-style: only one can be active at a time.
  // "custom" = no preset active (user is manually tuning values).
  type CostMode = "conversion" | "realistic" | "conservative" | "custom";
  const [costMode, setCostMode] = useState<CostMode>("custom");
  const isConversion = costMode === "conversion";
  const isRealistic = costMode === "realistic";
  const isConservative = costMode === "conservative";
  const [minPriceCny, setMinPriceCny] = useState(0);
  const [maxPriceCny, setMaxPriceCny] = useState(0);
  const [enrichAll, setEnrichAll] = useState(false);
  // Storage filter — "all" = search without storage in query (default).
  // Specific sizes (128, 256, etc.) append "{size}GB" to the search query
  // so Goofish returns only listings for that storage variant.
  const [storageFilter, setStorageFilter] = useState<string>("all");
  // When storage changes, update the query text input to reflect the change.
  // This keeps the manual query field in sync with the storage dropdown.
  const handleStorageChange = (value: string) => {
    setStorageFilter(value);
    // Update the query field to add/remove the storage suffix
    const baseQuery = query.trim().replace(/\s*\d+\s*(?:GB|TB)$/i, "");
    if (value === "all" || !baseQuery) {
      setQuery(baseQuery);
    } else {
      setQuery(`${baseQuery} ${value}GB`);
    }
  };
  // Build the effective search query from the current query text.
  const buildQuery = (): string => {
    return query.trim();
  };
  // When a preset mode is active, override the config values with the preset's
  // values. When "custom", use the user's manually-tuned values.
  const effExchangeFee = isConversion ? 0 : isRealistic ? 2.5 : isConservative ? 3 : exchangeFee;
  const effVatRate = isConversion ? 0 : isRealistic ? 23 : isConservative ? 23 : vatRate;
  // Logistics effective values — Conversion Only zeroes ALL import costs;
  // Realistic uses CSS Buy defaults; Conservative uses higher shipping/fees.
  const effAgentServiceFee = isConversion ? 0 : isRealistic ? 5 : isConservative ? 7 : agentServiceFee;
  const effInspectionFee = isConversion ? 0 : isRealistic ? 3 : isConservative ? 5 : inspectionFee;
  const effDomesticShippingCn = isConversion ? 0 : isRealistic ? 5 : isConservative ? 8 : domesticShippingCn;
  const effInsuranceFee = isConversion ? 0 : isRealistic ? 1.5 : isConservative ? 2.5 : insuranceFee;
  const effInternationalShip = isConversion ? 0 : isRealistic ? 30 : isConservative ? 50 : internationalShip;
  const effClearance = isConversion ? 0 : isRealistic ? 15 : isConservative ? 25 : clearance;
  const effImportDutyRate = isConversion ? 0 : isRealistic ? 0 : isConservative ? 5 : importDutyRate;
  const effDomesticShip = isConversion ? 0 : isRealistic ? 7 : isConservative ? 12 : domesticShip;
  const effMinMargin = isConversion ? 0 : isRealistic ? 15 : isConservative ? 25 : minMargin;
  const effMinProfit = isConversion ? 0 : isRealistic ? 30 : isConservative ? 50 : minProfit;
  const effScamThreshold = isConversion ? 100 : isRealistic ? 60 : isConservative ? 40 : scamThreshold;
  // Notify parent whenever config values change so re-run can use current values.
  // Reuses buildOverrides() so the parent always sees EXACTLY the config that
  // the Start Scan button submits — no duplicated logic to drift apart.
  useEffect(() => {
    onConfigChange?.(buildOverrides());
  }, [cnyToEur, effExchangeFee, effVatRate, effAgentServiceFee, effInspectionFee, effDomesticShippingCn, effInsuranceFee, effInternationalShip, effClearance, effImportDutyRate, effDomesticShip, effMinMargin, effMinProfit, effScamThreshold, maxPages, goofishPages, olxPages, vintedPages, kkPages, amazonPages, skipVinted, skipOlx, skipKk, skipAmazon, skipNew, skipUsed, minPriceCny, maxPriceCny, enrichAll, costMode, forwarderType, onConfigChange]);
  // ── Wizard state: Brand → Product Type → Range → Generation → Model ──
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedProductTypeId, setSelectedProductTypeId] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<string | null>(null);
  const [selectedGen, setSelectedGen] = useState<string | null>(null);
  const [selectedPresetLabel, setSelectedPresetLabel] = useState<string | null>(null);

  const brand = BRAND_CATALOG.find((b) => b.id === selectedBrand);
  const productType = brand?.productTypes.find((pt) => pt.id === selectedProductTypeId);
  const allGenerations = productType?.generations ?? [];
  // ── Auto-detect brand/model from query on re-run ─────────────────
  // When a user clicks a history entry (or re-runs a scan), the parent
  // sets `query` + `category` but wizard state (selectedBrand etc.) stays
  // stale. This effect detects the matching brand → product type → range
  // → generation → model from the query so the wizard UI shows the same
  // path as the original scan. It also handles storage-suffixed queries
  // (e.g. "iPhone 15 Pro 256GB") by stripping the suffix before matching
  // and restoring the storage filter.
  //
  // If the query matches NO catalog model, the wizard is cleared so the
  // selection chips never contradict the search box — unless the user has
  // manually picked wizard steps AFTER this query arrived (typing in the
  // manual-query box must not clobber an in-progress wizard selection).
  const wizardTouchedRef = useRef(false);
  useEffect(() => {
    if (!query.trim() || !category) return;
    // A new query means a fresh slate — any manual wizard interaction is
    // relative to the OLD query and no longer authoritative.
    wizardTouchedRef.current = false;
    const q = query.trim().toLowerCase();
    // Strip a trailing storage suffix ("256GB" / "1TB") so it doesn't
    // break the exact model-query match.
    const baseQuery = q.replace(/\s*\d+\s*(gb|tb)$/i, "");
    const storageMatch = q.match(/(\d+)\s*(gb|tb)$/);
    // Find matching preset by query string
    for (const b of BRAND_CATALOG) {
      for (const pt of b.productTypes) {
        if (pt.category !== category) continue;
        for (const g of pt.generations) {
          for (const m of g.models) {
            if (m.query.toLowerCase() === baseQuery) {
              setSelectedBrand(b.id);
              setSelectedProductTypeId(pt.id);
              setSelectedRange(g.range ?? null);
              setSelectedGen(g.id);
              setSelectedPresetLabel(m.label);
              // Storage chip must mirror the query: suffix → size, none → All.
              setStorageFilter(
                storageMatch
                  ? (storageMatch[2] === "tb" ? "1024" : storageMatch[1])
                  : "all",
              );
              return;
            }
          }
        }
      }
    }
    // No catalog model matches this query — clear stale wizard state so the
    // UI doesn't claim a selection it doesn't have. Skip when the user is
    // actively building a wizard selection (manual-query typing).
    if (!wizardTouchedRef.current) {
      setSelectedBrand(null);
      setSelectedProductTypeId(null);
      setSelectedRange(null);
      setSelectedGen(null);
      setSelectedPresetLabel(null);
      setStorageFilter("all");
    }
  }, [query, category]);
  // Filter generations by range if the product type has range filtering
  const availableRanges = productType?.hasRangeFilter
    ? [...new Set(allGenerations.map((g) => g.range).filter(Boolean))] as string[]
    : [];
  const generations = productType?.hasRangeFilter && selectedRange
    ? allGenerations.filter((g) => g.range === selectedRange)
    : allGenerations;
  const selectedGeneration = generations.find((g) => g.id === selectedGen);

  const handleBrandSelect = (brandId: string) => {
    wizardTouchedRef.current = true;
    setSelectedBrand(brandId);
    setSelectedProductTypeId(null);
    setSelectedGen(null);
    setSelectedPresetLabel(null);
    setQuery("");
    setStorageFilter("all");
  };
  const handleProductTypeSelect = (pt: ProductType) => {
    wizardTouchedRef.current = true;
    setSelectedProductTypeId(pt.id);
    setCategory(pt.category);
    setSelectedRange(null);
    setSelectedGen(null);
    setSelectedPresetLabel(null);
    setQuery("");
    setStorageFilter("all");
  };
  const handleRangeSelect = (range: string) => {
    wizardTouchedRef.current = true;
    setSelectedRange(range);
    setSelectedGen(null);
    setSelectedPresetLabel(null);
    setQuery("");
    setStorageFilter("all");
  };
  const handleGenSelect = (genId: string) => {
    wizardTouchedRef.current = true;
    setSelectedGen(genId);
    setSelectedPresetLabel(null);
    setQuery("");
    setStorageFilter("all");
  };
  const handleModelSelect = (model: ModelVariant) => {
    setQuery(model.query);
    setSelectedPresetLabel(model.label);
  };
  // ── Auto-select: if a step has only ONE option, select it automatically ──
  // This skips steps that would be pointless (e.g., "Which model?" when there's
  // only one model in the generation).
  useEffect(() => {
    // Auto-select product type if brand has only one
    if (brand && brand.productTypes.length === 1 && !selectedProductTypeId) {
      handleProductTypeSelect(brand.productTypes[0]);
    }
  }, [brand, selectedProductTypeId]);
  useEffect(() => {
    // Auto-select generation if product type has only one
    if (productType && productType.generations.length === 1 && !selectedGen) {
      handleGenSelect(productType.generations[0].id);
    }
  }, [productType, selectedGen]);
  useEffect(() => {
    // Auto-select model if generation has only one
    if (selectedGeneration && selectedGeneration.models.length === 1 && !selectedPresetLabel) {
      handleModelSelect(selectedGeneration.models[0]);
    }
  }, [selectedGeneration, selectedPresetLabel]);
  const resetWizard = () => {
    setSelectedBrand(null);
    setSelectedProductTypeId(null);
    setSelectedRange(null);
    setSelectedGen(null);
    setSelectedPresetLabel(null);
    setQuery("");
    setStorageFilter("all");
  };
  // ── Auto-scroll: after each wizard step changes, scroll smoothly so the
  //    newly-revealed step is centered in the viewport. Centering (block:
  //    "center") is more aesthetically pleasing than "nearest" — it puts the
  //    focus point in the middle of the screen, giving equal visual breathing
  //    room above and below. Each wizard step is tagged with data-wizard-step.
  const wizardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Only scroll when the USER advanced the wizard — the auto-detect
    // effect (history load / re-run) must not yank the viewport around.
    if (!wizardTouchedRef.current) return;
    // Small delay so the new step has time to render + layout settles
    const timer = setTimeout(() => {
      if (wizardRef.current) {
        // Find the last visible wizard step element
        const steps = wizardRef.current.querySelectorAll("[data-wizard-step]");
        const lastStep = steps[steps.length - 1] as HTMLElement | undefined;
        if (lastStep) {
          // block: "center" vertically centers the element in the viewport.
          // This is the aesthetically pleasing behavior the user requested —
          // the new step sits in the middle of the screen, not at the edge.
          lastStep.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [selectedBrand, selectedProductTypeId, selectedRange, selectedGen, selectedPresetLabel]);
  const buildOverrides = (): AppConfigOverrides => ({
    forex: { cny_to_eur_rate: cnyToEur, exchange_fee: effExchangeFee / 100 },
    logistics: {
      forwarder_type: forwarderType,
      agent_service_fee_rate: effAgentServiceFee / 100,
      inspection_fee_eur: effInspectionFee,
      domestic_shipping_cn_eur: effDomesticShippingCn,
      insurance_fee_rate: effInsuranceFee / 100,
      international_shipping_eur: effInternationalShip,
      customs_clearance_fee_eur: effClearance,
      import_duty_rate: effImportDutyRate / 100,
      domestic_shipping_eur: effDomesticShip,
    },
    tax: { pt_vat_rate: effVatRate / 100 },
    profitability: {
      min_margin_pct: effMinMargin / 100,
      min_net_profit_eur: effMinProfit,
    },
    scam_filter: { hide_threshold: effScamThreshold },
    scraping: {
      max_pages: maxPages,
      goofish_pages: goofishPages,
      olx_pages: olxPages,
      vinted_pages: vintedPages,
      kuantokusta_pages: kkPages,
      amazon_pages: amazonPages,
      skip_vinted: skipVinted,
      skip_olx: skipOlx,
      skip_kuantokusta: skipKk,
      skip_amazon: skipAmazon,
      skip_new: skipNew,
      skip_used: skipUsed,
      min_price_cny: minPriceCny,
      max_price_cny: maxPriceCny,
      enrich_all: enrichAll,
    },
  });
  const resetConfig = () => {
    setCostMode("custom");
    setCnyToEur(0.127);
    setExchangeFee(2.5);
    setVatRate(23);
    setForwarderType("cssbuy");
    setAgentServiceFee(5);
    setInspectionFee(3);
    setDomesticShippingCn(5);
    setInsuranceFee(1.5);
    setInternationalShip(30);
    setClearance(15);
    setImportDutyRate(0);
    setDomesticShip(7);
    setMinMargin(15);
    setMinProfit(30);
    setScamThreshold(60);
  };
  // Forwarder preset handler: when the user picks a forwarder (CSS Buy,
  // Superbuy, Wegobuy, Bhiner, or Custom), load that preset's cost values
  // into the individual state variables. This lets the user switch the entire
  // import cost structure with one click, then fine-tune individual values.
  const FORWARDER_PRESETS = [
    { id: "cssbuy", label: "CSS Buy", agent: 5, inspect: 3, cnShip: 5, insur: 1.5, intl: 30, customs: 15 },
    { id: "superbuy", label: "Superbuy", agent: 5, inspect: 4, cnShip: 4, insur: 1, intl: 28, customs: 15 },
    { id: "wegobuy", label: "Wegobuy", agent: 4, inspect: 4, cnShip: 5, insur: 1.5, intl: 32, customs: 15 },
    { id: "bhiner", label: "Bhiner / 86Daigou", agent: 3, inspect: 5, cnShip: 6, insur: 1, intl: 35, customs: 18 },
    { id: "custom", label: "Custom", agent: 5, inspect: 3, cnShip: 5, insur: 1.5, intl: 30, customs: 15 },
  ];
  const applyForwarderPreset = (presetId: string) => {
    const p = FORWARDER_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setForwarderType(p.id);
    setAgentServiceFee(p.agent);
    setInspectionFee(p.inspect);
    setDomesticShippingCn(p.cnShip);
    setInsuranceFee(p.insur);
    setInternationalShip(p.intl);
    setClearance(p.customs);
  };
  // ── Pages-per-site master switch ──
  // Sets ALL 5 site page counts to the same value at once. Useful for quickly
  // cranking everything to 6 pages (deep scan) or back to 0 (default).
  const [masterPages, setMasterPages] = useState(0);
  const applyMasterPages = (val: number) => {
    const v = Math.max(0, Math.min(20, val));
    setMasterPages(v);
    if (v > 0) {
      setGoofishPages(v);
      setOlxPages(v);
      setVintedPages(v);
      setKkPages(v);
      setAmazonPages(v);
    }
  };
  // ── Brand search filter ──
  const [brandSearch, setBrandSearch] = useState("");
  const filteredBrands = brandSearch.trim()
    ? BRAND_CATALOG.filter((b) => b.label.toLowerCase().includes(brandSearch.toLowerCase()))
    : BRAND_CATALOG;
  // ── Scroll-to-step helper ──
  // Scrolls a wizard step into the center of the viewport. Used when the user
  // clicks a selection chip to jump back to that step.
  const scrollToStep = (step: string) => {
    const el = wizardRef.current?.querySelector(`[data-wizard-step="${step}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  // Pre-made config presets — now just set costMode (radio-style).
  // The effective values are computed from costMode in the eff* variables above.
  // Clicking a preset that's already active turns it OFF (back to "custom").
  const applyPresetConversionOnly = () => {
    setCostMode(costMode === "conversion" ? "custom" : "conversion");
  };
  const applyPresetRealistic = () => {
    setCostMode(costMode === "realistic" ? "custom" : "realistic");
  };
  const applyPresetConservative = () => {
    setCostMode(costMode === "conservative" ? "custom" : "conservative");
  };
  // Deep Scan: sets realistic costs + cranks ALL sites to 6 pages.
  // Previously KuantoKusta + Amazon were left at whatever the user had set,
  // making the "Deep Scan (6 pages)" label misleading for those two sites.
  const applyPresetDeepScan = () => {
    setCostMode("realistic");
    setMaxPages(6);
    setGoofishPages(6);
    setOlxPages(6);
    setVintedPages(6);
    setKkPages(6);
    setAmazonPages(6);
  };
  return (
    <div className="space-y-5">
      {/* ── Section: Search Configuration (guided wizard) ──────────── */}
      <div className="space-y-4" ref={wizardRef}>
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Search Configuration
          </span>
          <div className="ml-2 h-px flex-1 bg-border" />
        </div>

        {/* ── STEP 1: Brand ────────────────────────────────────────── */}
        <div className="space-y-2" data-wizard-step="brand">
          <div className="flex items-center gap-2">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${selectedBrand ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground"}`}>1</span>
            <Label className="text-xs font-semibold">Which brand?</Label>
            {selectedPresetLabel && (
              <button type="button" onClick={resetWizard} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">
                ↺ Start over
              </button>
            )}
          </div>
          {/* Brand search bar — filters the brand grid for easy access */}
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={brandSearch}
              onChange={(e) => setBrandSearch(e.target.value)}
              placeholder="Search brands…"
              className="h-8 pl-8 text-xs focus-visible:ring-emerald-500/40 focus-visible:ring-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {filteredBrands.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => handleBrandSelect(b.id)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all ${
                  selectedBrand === b.id
                    ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-700 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20"
                }`}
              >
                <span className="text-base">{b.emoji}</span>
                {b.label}
              </button>
            ))}
            {filteredBrands.length === 0 && (
              <p className="col-span-4 py-3 text-center text-xs text-muted-foreground">
                No brands match "{brandSearch}"
              </p>
            )}
          </div>
        </div>

        {/* ── STEP 2: Product Type ────────────────────────────────── */}
        {brand && (
          <div className="space-y-2" data-wizard-step="product-type">
            <div className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${selectedProductTypeId ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>2</span>
              <Label className="text-xs font-semibold">What type of product?</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              {brand.productTypes.map((pt) => (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => handleProductTypeSelect(pt)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                    selectedProductTypeId === pt.id
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50/50"
                  }`}
                >
                  <span className="text-sm">{pt.emoji}</span>
                  {pt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2b: Range (Flagship/Mid-Range) ─────────────────── */}
        {productType?.hasRangeFilter && availableRanges.length > 1 && (
          <div className="space-y-2" data-wizard-step="range">
            <div className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${selectedRange ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>3</span>
              <Label className="text-xs font-semibold">Which range?</Label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableRanges.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleRangeSelect(r)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-all ${
                    selectedRange === r
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50/50"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 3/4: Generation (with year) ───────────────────── */}
        {productType && (!productType.hasRangeFilter || selectedRange || availableRanges.length <= 1) && (
          <div className="space-y-2" data-wizard-step="generation">
            <div className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${selectedGen ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>{productType.hasRangeFilter && availableRanges.length > 1 ? "4" : "3"}</span>
              <Label className="text-xs font-semibold">Which generation?</Label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {generations.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => handleGenSelect(g.id)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-all ${
                    selectedGen === g.id
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50/50"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 4/5: Specific Model ───────────────────────────── */}
        {selectedGeneration && (
          <div className="space-y-2" data-wizard-step="model">
            <div className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${selectedPresetLabel ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>4</span>
              <Label className="text-xs font-semibold">Which model?</Label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedGeneration.models.map((model) => (
                <button
                  key={model.label}
                  type="button"
                  onClick={() => handleModelSelect(model)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-all ${
                    selectedPresetLabel === model.label
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50/50"
                  }`}
                >
                  {model.label}
                  {model.releaseDate && (
                    <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-normal text-muted-foreground" title={`Released: ${model.releaseDate}`}>
                      {model.releaseDate}
                    </span>
                  )}
                  {selectedPresetLabel === model.label && <Check className="ml-0.5 inline h-3 w-3" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 5: Storage (only for products with storage) ────── */}
        {productType?.hasStorage && selectedPresetLabel && (
          <div className="space-y-2" data-wizard-step="storage">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold bg-muted text-muted-foreground">5</span>
              <Label className="text-xs font-semibold">Storage size?</Label>
              <span className="text-[10px] text-muted-foreground">(optional)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: "all", l: "All" }, { v: "64", l: "64GB" }, { v: "128", l: "128GB" },
                { v: "256", l: "256GB" }, { v: "512", l: "512GB" }, { v: "1024", l: "1TB" },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => handleStorageChange(opt.v)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                    storageFilter === opt.v
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50/50"
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Price filter row — always visible ────────────────────── */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed bg-muted/20 px-3 py-2.5">
          <div className="flex items-end gap-2">
            <div className="w-28 space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Min Price ¥
              </Label>
              <Input
                type="number"
                value={minPriceCny || ""}
                onChange={(e) => setMinPriceCny(parseInt(e.target.value) || 0)}
                className="h-9 focus-visible:ring-emerald-500/40 focus-visible:ring-2"
                placeholder="0"
                min={0}
              />
            </div>
            <span className="pb-2 text-xs text-muted-foreground">—</span>
            <div className="w-28 space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Max Price ¥
              </Label>
              <Input
                type="number"
                value={maxPriceCny || ""}
                onChange={(e) => setMaxPriceCny(parseInt(e.target.value) || 0)}
                className="h-9 focus-visible:ring-emerald-500/40 focus-visible:ring-2"
                placeholder="0"
                min={0}
              />
            </div>
          </div>
          <p className="pb-2 text-[10px] text-muted-foreground">
            Filters Goofish listings by CNY price range. 0 = no filter.
          </p>
        </div>

        {/* ── Scraping Options: enrichment + skip toggles ──────────────
            Organized into New (retail) vs Used (second-hand) groups, each
            with a master "Skip All" switch plus individual site toggles.
            Appears BEFORE the Start Scan button so the user configures
            which sources to scrape before launching the scan. */}
        <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/20 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Scraping Options
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              configure sources before scanning
            </span>
          </div>

          {/* Enrich all listings — standalone toggle */}
          <div className="flex items-start gap-3 rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
            <Switch checked={enrichAll} onCheckedChange={setEnrichAll} id="enrich-all" className="mt-0.5" />
            <div className="flex flex-col">
              <Label htmlFor="enrich-all" className="text-xs font-medium cursor-pointer">
                Enrich all listings
              </Label>
              <span className="text-[10px] text-muted-foreground">
                Seller rating + images for every Goofish listing. Slower. Default: top 10 only.
              </span>
            </div>
          </div>

          {/* Two-column grid: New (retail) | Used (second-hand) */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* ── New (retail) sources: KuantoKusta + Amazon ── */}
            <div className="flex flex-col gap-2 rounded-md border border-sky-200/60 bg-sky-50/30 px-2.5 py-2 dark:border-sky-900/50 dark:bg-sky-950/10">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    New
                  </span>
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    Retail prices
                  </span>
                </div>
                {/* Master switch: Skip All New */}
                <label className="flex cursor-pointer items-center gap-1.5" htmlFor="skip-new-master">
                  <span className="text-[10px] font-medium text-muted-foreground">Skip all new</span>
                  <Switch
                    checked={skipNew}
                    onCheckedChange={handleSkipNewChange}
                    id="skip-new-master"
                    className="data-[state=checked]:bg-rose-500 data-[state=unchecked]:bg-input"
                  />
                </label>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="flex cursor-pointer items-start gap-2.5" htmlFor="skip-kk">
                  <Switch
                    checked={skipKk}
                    onCheckedChange={setSkipKk}
                    id="skip-kk"
                    className="mt-0.5 data-[state=checked]:bg-rose-500 data-[state=unchecked]:bg-input"
                  />
                  <span className="flex flex-col">
                    <span className="text-[11px] font-medium">KuantoKusta</span>
                    <span className="text-[9px] text-muted-foreground">kuantokusta.pt — PT price comparison</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5" htmlFor="skip-amazon">
                  <Switch
                    checked={skipAmazon}
                    onCheckedChange={setSkipAmazon}
                    id="skip-amazon"
                    className="mt-0.5 data-[state=checked]:bg-rose-500 data-[state=unchecked]:bg-input"
                  />
                  <span className="flex flex-col">
                    <span className="text-[11px] font-medium">Amazon</span>
                    <span className="text-[9px] text-muted-foreground">amazon.es — retail store</span>
                  </span>
                </label>
              </div>
            </div>

            {/* ── Used (second-hand) sources: OLX + Vinted ── */}
            <div className="flex flex-col gap-2 rounded-md border border-teal-200/60 bg-teal-50/30 px-2.5 py-2 dark:border-teal-900/50 dark:bg-teal-950/10">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                    Used
                  </span>
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    Second-hand resale
                  </span>
                </div>
                {/* Master switch: Skip All Used */}
                <label className="flex cursor-pointer items-center gap-1.5" htmlFor="skip-used-master">
                  <span className="text-[10px] font-medium text-muted-foreground">Skip all used</span>
                  <Switch
                    checked={skipUsed}
                    onCheckedChange={handleSkipUsedChange}
                    id="skip-used-master"
                    className="data-[state=checked]:bg-rose-500 data-[state=unchecked]:bg-input"
                  />
                </label>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="flex cursor-pointer items-start gap-2.5" htmlFor="skip-olx-2">
                  <Switch
                    checked={skipOlx}
                    onCheckedChange={setSkipOlx}
                    id="skip-olx-2"
                    className="mt-0.5 data-[state=checked]:bg-rose-500 data-[state=unchecked]:bg-input"
                  />
                  <span className="flex flex-col">
                    <span className="text-[11px] font-medium">OLX</span>
                    <span className="text-[9px] text-muted-foreground">olx.pt — PT classifieds</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5" htmlFor="skip-vinted-2">
                  <Switch
                    checked={skipVinted}
                    onCheckedChange={setSkipVinted}
                    id="skip-vinted-2"
                    className="mt-0.5 data-[state=checked]:bg-rose-500 data-[state=unchecked]:bg-input"
                  />
                  <span className="flex flex-col">
                    <span className="text-[11px] font-medium">Vinted</span>
                    <span className="text-[9px] text-muted-foreground">vinted.pt — PT resale marketplace</span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* ── Per-site page count — grouped New vs Used ───────────────
            Clean card layout with site icons. Sites are grouped into
            "New (retail)" and "Used (second-hand)" columns so the user
            can see at a glance which tier each page-count controls.
            A "Set all" master input at the top sets all 5 sites at once. */}
        <div className="rounded-xl border bg-gradient-to-br from-muted/30 to-muted/10 p-3.5 dark:from-muted/20 dark:to-transparent">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pages per site
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              0 = default ({maxPages})
            </span>
            {/* Master "Set all" input — sets all 5 sites to the same value */}
            <div className="ml-auto flex items-center gap-1.5 rounded-md border border-emerald-300/60 bg-emerald-50/40 px-2 py-1 dark:border-emerald-800/60 dark:bg-emerald-950/20">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                Set all:
              </span>
              <Input
                type="number"
                value={masterPages || ""}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  applyMasterPages(Number.isNaN(v) ? 0 : v);
                }}
                className="h-6 w-12 border-emerald-300/50 bg-transparent text-center text-[11px] tabular-nums focus-visible:ring-emerald-500/40 focus-visible:ring-1 dark:border-emerald-800/50"
                placeholder="0"
                min={0}
                max={20}
              />
              <button
                type="button"
                onClick={() => applyMasterPages(0)}
                className="text-[9px] text-muted-foreground hover:text-foreground"
                title="Reset all to 0 (default)"
              >
                reset
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* ── Source (Goofish) — standalone, spans full width on top ── */}
            <div className="sm:col-span-2 flex items-center gap-3 rounded-lg border border-rose-200/60 bg-rose-50/30 px-3 py-2 dark:border-rose-900/50 dark:bg-rose-950/10">
              <span className="text-base">🛒</span>
              <div className="flex-1">
                <span className="text-[11px] font-semibold text-foreground">Goofish</span>
                <span className="ml-2 text-[9px] text-muted-foreground">source listings (CN)</span>
              </div>
              <PageInput
                label=""
                value={goofishPages}
                fallback={maxPages}
                onChange={setGoofishPages}
                compact
              />
            </div>
            {/* ── New (retail) page inputs ── */}
            <div className="space-y-2 rounded-lg border border-sky-200/50 bg-sky-50/20 p-2.5 dark:border-sky-900/40 dark:bg-sky-950/5">
              <div className="flex items-center gap-1.5 px-1">
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  New
                </span>
                <span className="text-[9px] text-muted-foreground">retail prices</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SitePageRow
                  emoji="🏷️"
                  name="KuantoKusta"
                  value={kkPages}
                  fallback={maxPages}
                  onChange={setKkPages}
                  disabled={skipKk}
                />
                <SitePageRow
                  emoji="📦"
                  name="Amazon"
                  value={amazonPages}
                  fallback={maxPages}
                  onChange={setAmazonPages}
                  disabled={skipAmazon}
                />
              </div>
            </div>
            {/* ── Used (second-hand) page inputs ── */}
            <div className="space-y-2 rounded-lg border border-teal-200/50 bg-teal-50/20 p-2.5 dark:border-teal-900/40 dark:bg-teal-950/5">
              <div className="flex items-center gap-1.5 px-1">
                <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                  Used
                </span>
                <span className="text-[9px] text-muted-foreground">second-hand resale</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SitePageRow
                  emoji="🇵🇹"
                  name="OLX"
                  value={olxPages}
                  fallback={maxPages}
                  onChange={setOlxPages}
                  disabled={skipOlx}
                />
                <SitePageRow
                  emoji="👕"
                  name="Vinted"
                  value={vintedPages}
                  fallback={maxPages}
                  onChange={setVintedPages}
                  disabled={skipVinted}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Advanced: manual query override (collapsible) */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 text-[10px] text-muted-foreground">
              <Settings2 className="h-3 w-3" />
              Manual query override
              <ChevronDown className="h-3 w-3" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !scanning && query.trim()) {
                    onScan(buildQuery(), category, buildOverrides());
                  }
                }}
                placeholder="Type a custom search query…"
                className="h-9 pl-9 text-xs focus-visible:ring-emerald-500/40 focus-visible:ring-2"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      {/* ── Cost Mode — radio-style switch group (only one active) ──── */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cost Mode
          </span>
          <div className="ml-2 h-px flex-1 bg-border" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Conversion Only — pure CNY→EUR, no fees */}
          <button
            type="button"
            onClick={applyPresetConversionOnly}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
              isConversion
                ? "border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                : "border-border bg-background text-muted-foreground hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:hover:border-sky-800 dark:hover:bg-sky-950/40 dark:hover:text-sky-300"
            }`}
            title="Just CNY→EUR conversion, no import fees"
          >
            {isConversion && <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />}
            Conversion Only
          </button>
          {/* Realistic Import — full Portugal import costs */}
          <button
            type="button"
            onClick={applyPresetRealistic}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
              isRealistic
                ? "border-teal-400 bg-teal-100 text-teal-800 dark:border-teal-700 dark:bg-teal-950/60 dark:text-teal-300"
                : "border-border bg-background text-muted-foreground hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:hover:border-teal-800 dark:hover:bg-teal-950/40 dark:hover:text-teal-300"
            }`}
            title="Full Portugal import costs (VAT, freight, customs, CTT)"
          >
            {isRealistic && <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />}
            Realistic Import
          </button>
          {/* Conservative — high fees, strict filtering */}
          <button
            type="button"
            onClick={applyPresetConservative}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
              isConservative
                ? "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                : "border-border bg-background text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:hover:border-amber-800 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
            }`}
            title="High fees + strict filtering"
          >
            {isConservative && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            Conservative
          </button>
          {/* Deep Scan — realistic + 6 pages */}
          <button
            type="button"
            onClick={applyPresetDeepScan}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
              isRealistic && maxPages === 6
                ? "border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
            }`}
            title="Realistic costs + 6 pages per site (broadest lead coverage). Estimated scan time: 60-120s."
          >
            <Zap className="h-3 w-3" />
            Deep Scan (6 pages)
          </button>
        </div>
      </div>

      {/* ── Selection Summary + Start Scan ──────────────────────────
          Appears AFTER the Cost Mode section. Shows everything the user
          has selected (brand → product type → range → generation → model
          → storage → cost mode) as compact chips, plus the final search
          query and the Start Scan button. This gives the user a clear
          recap of their configuration right before they commit to a scan. */}
      <div className="rounded-xl border bg-gradient-to-br from-emerald-50/50 via-card to-teal-50/30 p-4 shadow-sm dark:from-emerald-950/20 dark:via-card dark:to-teal-950/10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Left: selection chips + query */}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Your selection
              </span>
            </div>
            {/* Selection chips — show each wizard choice as a compact pill.
                Clicking a chip (or empty placeholder) scrolls to that step. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedBrand ? (
                <SelectionChip emoji={brand?.emoji} label={brand?.label} onClear={() => handleBrandSelect(selectedBrand)} onClick={() => scrollToStep("brand")} />
              ) : (
                <EmptyChip label="Brand" onClick={() => scrollToStep("brand")} />
              )}
              <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
              {productType ? (
                <SelectionChip emoji={productType.emoji} label={productType.label} onClear={() => selectedBrand && handleBrandSelect(selectedBrand)} onClick={() => scrollToStep("product-type")} />
              ) : selectedBrand ? (
                <EmptyChip label="Type" onClick={() => scrollToStep("product-type")} />
              ) : null}
              {productType?.hasRangeFilter && availableRanges.length > 1 && (
                <>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                  {selectedRange ? (
                    <SelectionChip label={selectedRange} onClear={() => selectedProductTypeId && handleProductTypeSelect(productType)} onClick={() => scrollToStep("range")} />
                  ) : (
                    <EmptyChip label="Range" onClick={() => scrollToStep("range")} />
                  )}
                </>
              )}
              {productType && (!productType.hasRangeFilter || selectedRange || availableRanges.length <= 1) && (
                <>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                  {selectedGen ? (
                    <SelectionChip label={selectedGeneration?.label} onClear={() => productType && handleProductTypeSelect(productType)} onClick={() => scrollToStep("generation")} />
                  ) : productType ? (
                    <EmptyChip label="Gen" onClick={() => scrollToStep("generation")} />
                  ) : null}
                </>
              )}
              {selectedGeneration && (
                <>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                  {selectedPresetLabel ? (
                    <SelectionChip
                      label={selectedPresetLabel}
                      sub={selectedGeneration?.models.find((m) => m.label === selectedPresetLabel)?.releaseDate}
                      onClear={() => selectedGen && handleGenSelect(selectedGen)}
                      onClick={() => scrollToStep("model")}
                    />
                  ) : (
                    <EmptyChip label="Model" onClick={() => scrollToStep("model")} />
                  )}
                </>
              )}
              {productType?.hasStorage && selectedPresetLabel && (
                <>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                  <SelectionChip
                    label={storageFilter === "all" ? "All storage" : `${storageFilter}GB`}
                    onClear={() => handleStorageChange("all")}
                    onClick={() => scrollToStep("storage")}
                  />
                </>
              )}
            </div>
            {/* Cost mode chip */}
            {costMode !== "custom" && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">Cost:</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  isConversion ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300"
                  : isRealistic ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"
                  : isConservative ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  : "border-border bg-muted text-muted-foreground"
                }`}>
                  {isRealistic && maxPages === 6 && <Zap className="h-2.5 w-2.5" />}
                  {isConversion ? "Conversion Only" : isRealistic && maxPages === 6 ? "Deep Scan" : isRealistic ? "Realistic" : isConservative ? "Conservative" : "Custom"}
                </span>
                {/* Skipped sources summary */}
                {(() => {
                  const skippedNew = skipKk && skipAmazon;
                  const skippedUsed = skipOlx && skipVinted;
                  const parts: { label: string; tone: string }[] = [];
                  if (skippedNew) parts.push({ label: "No new sources", tone: "border-sky-200 bg-sky-50/50 text-sky-600 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-400" });
                  if (skippedUsed) parts.push({ label: "No used sources", tone: "border-teal-200 bg-teal-50/50 text-teal-600 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-400" });
                  return parts.map((p) => (
                    <span key={p.label} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${p.tone}`}>
                      {p.label}
                    </span>
                  ));
                })()}
              </div>
            )}
            {/* Final search query + GSMArena link (phones only) */}
            <div className="rounded-lg border border-dashed bg-background/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Search query</span>
                {/* GSM Arena compare link — only for phone categories */}
                {buildQuery() && ["iphone", "samsung", "xiaomi"].includes(category) && (
                  <a
                    href={`https://www.gsmarena.com/results.php3?sQuickSearch=yes&sName=${encodeURIComponent(buildQuery())}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                    title="Search this phone on GSMArena for specs comparison"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    GSMArena
                  </a>
                )}
              </div>
              <p className="text-sm font-semibold text-foreground">
                {buildQuery() || <span className="text-muted-foreground italic">Select a model above…</span>}
              </p>
            </div>
            {/* ── Estimated scan time ──
                Calculates based on the number of pages selected across all
                active (non-skipped) sites. Goofish takes ~12s/page (scroll +
                wait + extract), EU sites take ~8s/page. All sites run
                concurrently, so the total is the MAX of individual site times. */}
            {(() => {
              const effGoofish = goofishPages > 0 ? goofishPages : maxPages;
              const effOlx = skipOlx ? 0 : (olxPages > 0 ? olxPages : maxPages);
              const effVinted = skipVinted ? 0 : (vintedPages > 0 ? vintedPages : maxPages);
              const effKk = skipKk ? 0 : (kkPages > 0 ? kkPages : maxPages);
              const effAmazon = skipAmazon ? 0 : (amazonPages > 0 ? amazonPages : maxPages);
              // Goofish: ~12s per page (scroll-heavy, 2 retries possible)
              const goofishTime = effGoofish * 12;
              // EU sites: ~8s per page each, run concurrently
              const euTime = Math.max(effOlx * 8, effVinted * 8, effKk * 8, effAmazon * 8);
              // Total = max(Goofish, EU) since they run concurrently + 10s overhead
              const totalSec = Math.max(goofishTime, euTime) + 10;
              const fmt = (s: number) => s < 60 ? `~${s}s` : `~${Math.floor(s / 60)}m ${s % 60}s`;
              const activeSites = [
                !skipOlx && "OLX", !skipVinted && "Vinted", !skipKk && "KK", !skipAmazon && "Amazon"
              ].filter(Boolean).length;
              return (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>
                    Est. scan time: <span className="font-semibold text-foreground">{fmt(totalSec)}</span>
                    {" "}· Goofish {effGoofish}pg ({fmt(goofishTime)})
                    {activeSites > 0 && ` · EU ${activeSites} site${activeSites > 1 ? "s" : ""} concurrent`}
                  </span>
                </div>
              );
            })()}
          </div>
          {/* Right: Start Scan + Stop buttons */}
          <div className="flex shrink-0 items-center gap-2 lg:flex-col lg:items-stretch">
            <Button
              size="lg"
              className="h-12 gap-2 bg-gradient-to-br from-emerald-500 to-teal-600 px-7 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all hover:from-emerald-600 hover:to-teal-700 hover:shadow-xl hover:shadow-emerald-500/40 disabled:opacity-40 disabled:shadow-none"
              disabled={scanning || !query.trim()}
              onClick={() => onScan(buildQuery(), category, buildOverrides())}
            >
              {scanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Start Scan
                </>
              )}
            </Button>
            {scanning && onStop && (
              <Button
                size="lg"
                variant="outline"
                className="h-12 gap-2 border-rose-300 bg-rose-50 px-5 text-sm font-medium text-rose-700 transition-all hover:bg-rose-100 hover:text-rose-800 disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950"
                onClick={onStop}
                disabled={stopping}
                title={stopping ? "Cancelling…" : "Cancel the running scan"}
              >
                {stopping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4 fill-current" />
                )}
                {stopping ? "Cancelling…" : "Stop"}
              </Button>
            )}
          </div>
        </div>
      </div>
      {/* ── Advanced tools row: Configuration / Manual Paste / Debug ──
          All three collapsible triggers sit on a single horizontal row so
          they don't stack vertically and waste vertical space. Each
          Collapsible still owns its own open/close state and content. */}
      <div className="flex flex-wrap items-center gap-2">
        <Collapsible open={configOpen} onOpenChange={setConfigOpen} className="w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full sm:w-auto">
                <Settings2 className="mr-2 h-3.5 w-3.5" />
                Configuration Overrides
                <ChevronDown
                  className={`ml-2 h-3.5 w-3.5 transition-transform ${
                    configOpen ? "rotate-180" : ""
                  }`}
                />
              </Button>
            </CollapsibleTrigger>
            {configOpen && (
              <Button variant="ghost" size="sm" onClick={resetConfig}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                Reset defaults
              </Button>
            )}
          </div>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <ConfigNumber
              label="CNY → EUR Rate"
              value={cnyToEur}
              step={0.001}
              onChange={setCnyToEur}
              suffix="€/¥"
            />
            <ConfigNumber
              label="Exchange Fee"
              value={exchangeFee}
              step={0.1}
              onChange={setExchangeFee}
              suffix="%"
            />
            <ConfigNumber
              label="PT Import VAT"
              value={vatRate}
              step={0.5}
              onChange={setVatRate}
              suffix="%"
            />
            {/* ── Forwarder preset selector ──
                Switches the entire import cost structure between CSS Buy,
                Superbuy, Wegobuy, Bhiner, or Custom. Each preset loads its
                own agent fee, inspection fee, CN shipping, insurance, intl
                shipping, and customs values into the fields below. */}
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <Label className="text-xs font-medium text-muted-foreground">
                Forwarder (buying agent)
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {FORWARDER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyForwarderPreset(p.id)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all ${
                      forwarderType === p.id
                        ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-border bg-background text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50/50"
                    }`}
                    title={p.label}
                  >
                    {forwarderType === p.id && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground">
                Cheapest agent fee: Bhiner (3%). Cheapest shipping: Superbuy. CSS Buy = balanced default.
              </p>
            </div>
            <ConfigNumber
              label="Agent Service Fee"
              value={agentServiceFee}
              step={0.5}
              onChange={setAgentServiceFee}
              suffix="%"
            />
            <ConfigNumber
              label="Inspection Fee"
              value={inspectionFee}
              step={0.5}
              onChange={setInspectionFee}
              suffix="€"
            />
            <ConfigNumber
              label="CN Domestic Shipping"
              value={domesticShippingCn}
              step={0.5}
              onChange={setDomesticShippingCn}
              suffix="€"
            />
            <ConfigNumber
              label="Insurance Rate"
              value={insuranceFee}
              step={0.1}
              onChange={setInsuranceFee}
              suffix="%"
            />
            <ConfigNumber
              label="International Shipping"
              value={internationalShip}
              step={1}
              onChange={setInternationalShip}
              suffix="€"
            />
            <ConfigNumber
              label="Customs Clearance"
              value={clearance}
              step={0.5}
              onChange={setClearance}
              suffix="€"
            />
            <ConfigNumber
              label="Import Duty Rate"
              value={importDutyRate}
              step={0.5}
              onChange={setImportDutyRate}
              suffix="%"
            />
            <ConfigNumber
              label="PT Domestic Shipping (CTT)"
              value={domesticShip}
              step={0.5}
              onChange={setDomesticShip}
              suffix="€"
            />
            <ConfigSlider
              label="Min Margin"
              value={minMargin}
              min={0}
              max={50}
              step={1}
              onChange={setMinMargin}
              suffix="%"
            />
            <ConfigNumber
              label="Min Net Profit"
              value={minProfit}
              step={5}
              onChange={setMinProfit}
              suffix="€"
            />
            <ConfigSlider
              label="Scam Hide Threshold"
              value={scamThreshold}
              min={0}
              max={100}
              step={5}
              onChange={setScamThreshold}
              suffix="/100"
            />
            <ConfigSlider
              label="Default Max Pages (fallback)"
              value={maxPages}
              min={1}
              max={10}
              step={1}
              onChange={setMaxPages}
              suffix=" pages"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      {/* Manual paste (graceful degradation) */}
      <Collapsible open={pasteOpen} onOpenChange={setPasteOpen} className="w-full sm:w-auto">
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button
              variant={paused ? "default" : "outline"}
              size="sm"
              className={`w-full sm:w-auto ${paused ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300" : ""}`}
            >
              <ClipboardPaste className="mr-2 h-3.5 w-3.5" />
              Manual Goofish HTML Paste
              <ChevronDown
                className={`ml-2 h-3.5 w-3.5 transition-transform ${
                  pasteOpen ? "rotate-180" : ""
                }`}
              />
            </Button>
          </CollapsibleTrigger>
          {paused && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Scraper blocked — paste raw DOM HTML to resume
            </span>
          )}
        </div>
        <CollapsibleContent className="mt-3">
          <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground">
              If the Goofish scraper hits a hard CAPTCHA or WAF block, open
              goofish.com in your own browser, search for the same query, then
              copy the page&apos;s raw HTML (right-click → View Page Source →
              Select All → Copy) and paste it below.
            </p>
            <Textarea
              value={pasteHtml}
              onChange={(e) => setPasteHtml(e.target.value)}
              placeholder="Paste raw Goofish DOM HTML here…"
              className="min-h-[120px] font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPasteHtml("")}
              >
                Clear
              </Button>
              <Button
                size="sm"
                disabled={!pasteHtml.trim() || scanning}
                onClick={async () => {
                  // Only clear the textarea on SUCCESS — a failed resume must
                  // keep the pasted DOM so the user can retry without having
                  // to re-copy a huge blob.
                  const ok = await onManualPaste(pasteHtml);
                  if (ok) setPasteHtml("");
                }}
              >
                Resume Pipeline
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {/* ── Debug Scrapers (unified) ─────────────────────────────────── */}
      <Collapsible open={debugOpen} onOpenChange={setDebugOpen} className="w-full sm:w-auto">
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950 sm:w-auto"
            >
              <Bug className="h-3.5 w-3.5" />
              Debug Scrapers
              <ChevronDown
                className={`ml-1 h-3.5 w-3.5 transition-transform ${
                  debugOpen ? "rotate-180" : ""
                }`}
              />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="mt-3">
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/30 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <p className="text-xs text-muted-foreground">
              Run debug on any scraper to capture screenshots, selector counts,
              and sample listings. Results appear in the console below.
              Screenshots are saved to <code className="rounded bg-muted px-1 font-mono text-[10px]">db/debug-screenshots/</code>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { name: "goofish", label: "Goofish", color: "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" },
                { name: "olx", label: "OLX", color: "border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300" },
                { name: "vinted", label: "Vinted", color: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300" },
                { name: "kuantokusta", label: "KuantoKusta", color: "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
                { name: "amazon", label: "Amazon", color: "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300" },
              ].map((scraper) => (
                <Button
                  key={scraper.name}
                  variant="outline"
                  size="sm"
                  className={`h-7 gap-1 text-xs ${scraper.color}`}
                  disabled={debugRunning !== null || !query.trim()}
                  onClick={async () => {
                    setDebugRunning(scraper.name);
                    setDebugResult(null);
                    try {
                      const res = await fetch(`/api/debug/${scraper.name}?query=${encodeURIComponent(query.trim())}`);
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      const data = await res.json();
                      const summary = [
                        `Scraper: ${scraper.name}`,
                        `Query: ${data.query}`,
                        ``,
                        `=== STEPS ===`,
                        ...(data.steps || []).map((s: { step: string; [k: string]: unknown }) =>
                          `${s.step}: ${JSON.stringify(s).slice(0, 300)}`),
                        ``,
                        data.errors?.length > 0 ? `=== ERRORS ===\n${data.errors.join("\n")}` : "No errors",
                      ].join("\n");
                      setDebugResult(summary);
                    } catch (e) {
                      setDebugResult(`Debug failed: ${e instanceof Error ? e.message : String(e)}`);
                    } finally {
                      setDebugRunning(null);
                    }
                  }}
                >
                  {debugRunning === scraper.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bug className="h-3 w-3" />}
                  {scraper.label}
                </Button>
              ))}
              {/* Run All button */}
              <Button
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={debugRunning !== null || !query.trim()}
                onClick={async () => {
                  setDebugRunning("all");
                  setDebugResult(null);
                  const scrapers = ["goofish", "olx", "vinted", "kuantokusta", "amazon"];
                  const allResults: string[] = [];
                  for (const name of scrapers) {
                    allResults.push(`\n${"=".repeat(60)}\n  ${name.toUpperCase()}\n${"=".repeat(60)}`);
                    try {
                      const res = await fetch(`/api/debug/${name}?query=${encodeURIComponent(query.trim())}`);
                      if (!res.ok) { allResults.push(`HTTP ${res.status} — endpoint failed`); continue; }
                      const data = await res.json();
                      for (const s of data.steps || []) { allResults.push(`  ${s.step}: ${JSON.stringify(s).slice(0, 250)}`); }
                      if (data.errors?.length > 0) { allResults.push(`  ERRORS:`); for (const e of data.errors) allResults.push(`    ${e}`); }
                    } catch (e) { allResults.push(`  FAILED: ${e instanceof Error ? e.message : String(e)}`); }
                  }
                  setDebugResult(allResults.join("\n"));
                  setDebugRunning(null);
                }}
              >
                {debugRunning === "all" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bug className="h-3 w-3" />}
                Run All
              </Button>
              {debugResult && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigator.clipboard.writeText(debugResult)}>
                  Copy
                </Button>
              )}
            </div>
            {debugResult && (
              <pre className="max-h-80 overflow-auto rounded-md border bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                {debugResult}
              </pre>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      </div>
      {/* ── END advanced tools row ── */}
    </div>
  );
}
function ConfigNumber({
  label,
  value,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-9"
        />
        {suffix && (
          <span className="text-xs text-muted-foreground w-10">{suffix}</span>
        )}
      </div>
    </div>
  );
}
function ConfigSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        <span className="text-xs font-semibold tabular-nums">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="py-2"
      />
    </div>
  );
}
// SelectionChip: a compact pill showing a wizard selection (brand/type/gen/etc).
// Used in the "Your selection" summary next to the Start Scan button.
// Clicking the chip (not the X) scrolls to that wizard step.
function SelectionChip({
  emoji,
  label,
  sub,
  onClear,
  onClick,
}: {
  emoji?: string;
  label?: string;
  sub?: string;
  onClear?: () => void;
  onClick?: () => void;
}) {
  if (!label) return null;
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 ${onClick ? "cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-950" : ""}`}
    >
      {emoji && <span className="text-[11px] leading-none">{emoji}</span>}
      <span>{label}</span>
      {sub && <span className="text-[9px] font-normal text-emerald-600/70 dark:text-emerald-400/70">({sub})</span>}
      {onClear && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-emerald-600/70 hover:bg-emerald-200 hover:text-emerald-800 dark:text-emerald-400/70 dark:hover:bg-emerald-900"
          title={`Clear ${label}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
// EmptyChip: a dashed placeholder pill for a not-yet-selected wizard step.
// Clicking it scrolls to that wizard step so the user can make a selection.
function EmptyChip({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-full border border-dashed border-muted-foreground/30 bg-muted/20 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground/60 transition-colors hover:border-emerald-400 hover:text-emerald-600 dark:hover:border-emerald-700 dark:hover:text-emerald-400"
    >
      {label}?
    </button>
  );
}
function PageInput({
  label,
  value,
  fallback,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  value: number;
  fallback: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const effective = value > 0 ? value : fallback;
  if (compact) {
    // Compact variant: just the input + a tiny "→ N pg" hint, for inline
    // use in rows like the Goofish source card.
    return (
      <div className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
        <Input
          type="number"
          value={value || ""}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            onChange(Number.isNaN(v) ? 0 : Math.max(0, Math.min(20, v)));
          }}
          className="h-8 w-16 text-center text-xs focus-visible:ring-emerald-500/40 focus-visible:ring-2"
          placeholder="0"
          min={0}
          max={20}
          disabled={disabled}
        />
        <span className="whitespace-nowrap text-[9px] tabular-nums text-muted-foreground">
          → {effective} pg
        </span>
      </div>
    );
  }
  return (
    <div className={`space-y-1.5 ${disabled ? "opacity-50" : ""}`}>
      {label && (
        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
          <span className="ml-1 font-normal normal-case text-[9px] text-muted-foreground/70">
            → {effective} pg
          </span>
        </Label>
      )}
      <Input
        type="number"
        value={value || ""}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(Number.isNaN(v) ? 0 : Math.max(0, Math.min(20, v)));
        }}
        className="h-9 w-20 focus-visible:ring-emerald-500/40 focus-visible:ring-2"
        placeholder="0"
        min={0}
        max={20}
        disabled={disabled}
      />
    </div>
  );
}
// SitePageRow: a single site row with emoji + name + page input. Used in the
// grouped "New" and "Used" columns of the redesigned per-site pages card.
function SitePageRow({
  emoji,
  name,
  value,
  fallback,
  onChange,
  disabled,
}: {
  emoji: string;
  name: string;
  value: number;
  fallback: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const effective = value > 0 ? value : fallback;
  return (
    <div className={`flex items-center gap-2 rounded-md border border-border/40 bg-background/60 px-2 py-1.5 transition-opacity ${disabled ? "opacity-40" : ""}`}>
      <span className="text-sm leading-none">{emoji}</span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[10px] font-semibold text-foreground">{name}</span>
        <span className="text-[8px] tabular-nums text-muted-foreground">→ {effective} pg</span>
      </div>
      <Input
        type="number"
        value={value || ""}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(Number.isNaN(v) ? 0 : Math.max(0, Math.min(20, v)));
        }}
        className="h-7 w-12 border-border/50 bg-transparent text-center text-[11px] tabular-nums focus-visible:ring-emerald-500/40 focus-visible:ring-1"
        placeholder="0"
        min={0}
        max={20}
        disabled={disabled}
      />
    </div>
  );
}