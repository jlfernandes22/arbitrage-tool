"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  MapPin,
  User,
  Heart,
  Images,
  ExternalLink,
  Languages,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  type EvaluatedListing,
  CONDITION_LABELS,
  CONDITION_COLORS,
  eur,
  eurPrecise,
  cny,
} from "./types";
import { displayTitle as cleanDisplayTitle, translateConditionRaw } from "@/lib/engine/normalizer";

// Normalize image URLs — ensures protocol-relative URLs (//img.alicdn.com/...)
// get the https: prefix so they load correctly in all browsers.
// Also handles relative URLs by prefixing with goofish.com.
function normalizeImageUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `https://www.goofish.com${url}`;
  return url;
}

interface ListingDetailDialogProps {
  listing: EvaluatedListing | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface Translation {
  title: string;
  description: string | null;
  location: string | null;
  conditionRaw: string | null;
}

// Module-level cache: listingId → translation. Survives dialog open/close
// so re-opening the same listing doesn't re-hit the LLM API.
const translationCache = new Map<string, Translation>();

export function ListingDetailDialog({
  listing,
  open,
  onOpenChange,
}: ListingDetailDialogProps) {
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  // Track which listing id the current translation belongs to so we don't
  // show a stale translation when the user opens a different listing.
  const translatedIdRef = useRef<string | null>(null);
  // Currently selected image in the gallery (resets when listing changes)
  const [selectedImage, setSelectedImage] = useState(0);

  const l = listing?.listing;
  const scam = listing?.scam;
  const profit = listing?.profit;
  const euComps = listing?.euComps ?? [];
  const n = l?.normalized ?? null;
  const landed = profit?.landed;

  const doTranslate = useCallback(
    async (force = false) => {
      if (!l) return;
      const cacheKey = l.id;
      // Return cached translation immediately unless forced refresh.
      if (!force && translationCache.has(cacheKey)) {
        const cached = translationCache.get(cacheKey)!;
        setTranslation(cached);
        translatedIdRef.current = cacheKey;
        return;
      }
      setTranslating(true);
      setTranslateError(null);
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: l.title,
            description: l.description,
            location: l.sellerLocation,
            conditionRaw: n?.conditionRaw,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "translate failed" }));
          throw new Error(err.error ?? "translate failed");
        }
        const data: Translation = await res.json();
        translationCache.set(cacheKey, data);
        setTranslation(data);
        translatedIdRef.current = cacheKey;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setTranslateError(msg);
      } finally {
        setTranslating(false);
      }
    },
    [l, n],
  );

  // Auto-translate when the dialog opens with a new listing. We key off
  // listing.id so opening the same listing twice in a row doesn't re-fetch.
  useEffect(() => {
    if (!open || !l) {
      setTranslation(null);
      setTranslateError(null);
      translatedIdRef.current = null;
      return;
    }
    // Only auto-translate if we don't already have a translation for this
    // listing (avoid re-fetching on every open).
    if (translatedIdRef.current !== l.id) {
      // Reset displayed translation until the fetch completes, unless we
      // have a cached one (which doTranslate will set synchronously).
      setTranslation(translationCache.get(l.id) ?? null);
      void doTranslate(false);
    }
  }, [open, l, doTranslate]);

  // Reset image gallery selection when the listing changes
  useEffect(() => {
    setSelectedImage(0);
  }, [l?.id]);

  if (!listing || !l || !scam || !profit || !landed) return null;

  const riskTone =
    scam.dropped || scam.riskScore >= 60
      ? "text-rose-600 dark:text-rose-400"
      : scam.riskScore >= 40
        ? "text-amber-600 dark:text-amber-400"
        : "text-emerald-600 dark:text-emerald-400";

  // Show translated title in the dialog header when available; fall back to
  // the cleaned original Chinese title (fixes "256G" → "256GB" shorthand).
  // cleanDisplayTitle is applied to BOTH the translated and raw titles so the
  // "256G" → "256GB" fix works regardless of which is displayed.
  const displayTitle = translation && translatedIdRef.current === l.id
    ? cleanDisplayTitle(translation.title)
    : cleanDisplayTitle(l.title);
  const hasTranslation = !!translation && translatedIdRef.current === l.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="flex-shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle className="pr-8 text-base leading-tight">
            {displayTitle}
            {hasTranslation && translation && cleanDisplayTitle(translation.title) !== cleanDisplayTitle(l.title) && (
              <span className="ml-2 align-middle text-[11px] font-normal text-muted-foreground">
                (translated)
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>Goofish listing · {l.id}</span>
            {l.href ? (
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20"
                onClick={(e) => e.stopPropagation()}
              >
                View on Goofish
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <a
                href={`https://www.goofish.com/search?q=${encodeURIComponent(n?.standardKey ?? l.title)}&spm=a21ybx.search.searchInput.0`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20"
                onClick={(e) => e.stopPropagation()}
              >
                Search on Goofish
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {/* Translate button — fires/refreshes the Chinese→Portuguese translation */}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-6 gap-1 px-2 text-[11px] border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950"
              disabled={translating}
              onClick={() => doTranslate(true)}
              title="Translate all Chinese text (title, description, location, condition) to European Portuguese"
            >
              {translating ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Translating…
                </>
              ) : hasTranslation ? (
                <>
                  <RefreshCw className="h-3 w-3" />
                  Re-translate
                </>
              ) : (
                <>
                  <Languages className="h-3 w-3" />
                  Translate to PT
                </>
              )}
            </Button>
          </DialogDescription>
        </DialogHeader>
        {/* ScrollArea: flex-1 + min-h-0 so it fills remaining dialog height and
            scrolls internally. overflow-x-auto allows horizontal scroll for wide
            tables instead of clipping content. min-w-0 prevents flex overflow. */}
        <ScrollArea className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
          <div className="min-w-0 space-y-4">
            {/* Price Summary — asking price + key metrics at a glance */}
            <section className="min-w-0 rounded-lg border bg-gradient-to-br from-muted/50 to-muted/20 p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {/* Asking Price (CNY) — the seller's original asking price */}
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Asking Price
                  </span>
                  <div className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
                    {cny(landed.priceCny)}
                  </div>
                  <div className="text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
                    ≈ {eurPrecise(landed.acquisitionCostEur)} (acq)
                  </div>
                </div>
                {/* Total Landed Cost (EUR) */}
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Landed Cost
                  </span>
                  <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
                    {eurPrecise(landed.totalLandedCostEur)}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    + {eurPrecise(landed.totalLandedCostEur - landed.acquisitionCostEur)} fees
                  </div>
                </div>
                {/* Expected Resale (EUR) */}
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Exp. Resale
                  </span>
                  <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
                    {eur(profit.expectedResaleEur)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {profit.resaleSource ?? "median EU"}
                  </div>
                </div>
                {/* Net Profit (EUR) */}
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Net Profit
                  </span>
                  <div
                    className={`mt-0.5 text-xl font-bold tabular-nums ${
                      profit.netProfitEur > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {eurPrecise(profit.netProfitEur)}
                  </div>
                  <div
                    className={`text-[11px] font-medium tabular-nums ${
                      profit.marginPct >= 30
                        ? "text-emerald-600 dark:text-emerald-400"
                        : profit.marginPct >= 15
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {profit.marginPct.toFixed(1)}% margin
                  </div>
                </div>
              </div>
            </section>
            {/* Image Gallery — displays all listing images from Goofish */}
            {l.imageUrls.length > 0 && (
              <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Images className="h-3.5 w-3.5" />
                  Listing Images ({l.imageUrls.length}
                  {l.imageCount && l.imageCount > l.imageUrls.length
                    ? ` of ${l.imageCount}`
                    : ""})
                </h4>
                <div className="space-y-2">
                  {/* Main image view */}
                  <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted/40 sm:aspect-[4/3]">
                    <img
                      src={normalizeImageUrl(l.imageUrls[selectedImage])}
                      alt={`${l.title} — image ${selectedImage + 1}`}
                      className="h-full w-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  {/* Thumbnail strip — only show if more than 1 image */}
                  {l.imageUrls.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {l.imageUrls.map((url, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedImage(idx)}
                          className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition ${
                            idx === selectedImage
                              ? "border-primary ring-1 ring-primary"
                              : "border-transparent opacity-60 hover:opacity-100"
                          }`}
                        >
                          <img
                            src={normalizeImageUrl(url)}
                            alt={`Thumbnail ${idx + 1}`}
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
            {/* Translation panel — shown when translating, translated, or errored */}
            {(translating || hasTranslation || translateError) && (
              <section className="min-w-0 rounded-lg border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900 dark:bg-sky-950/20">
                <div className="mb-2 flex items-center gap-2">
                  <Languages className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    Portuguese Translation
                  </h4>
                  {translating && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Translating from Chinese…
                    </span>
                  )}
                </div>
                {translateError ? (
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    Translation failed: {translateError}
                  </p>
                ) : hasTranslation && translation ? (
                  <div className="space-y-2 text-xs">
                    {translation.title && cleanDisplayTitle(translation.title) !== cleanDisplayTitle(l.title) && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Title (PT)
                        </span>
                        <p className="mt-0.5 font-medium">{cleanDisplayTitle(translation.title)}</p>
                      </div>
                    )}
                    {translation.description && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Description (PT)
                        </span>
                        <p className="mt-0.5 whitespace-pre-wrap rounded bg-white/60 p-2 leading-relaxed dark:bg-slate-950/40">
                          {cleanDisplayTitle(translation.description)}
                        </p>
                      </div>
                    )}
                    {(translation.location || translation.conditionRaw) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {translation.location && (
                          <div>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Location (PT)
                            </span>
                            <p className="mt-0.5 font-medium">{translation.location}</p>
                          </div>
                        )}
                        {translation.conditionRaw && (
                          <div>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Condition (PT)
                            </span>
                            <p className="mt-0.5 font-medium">{translation.conditionRaw}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : translating ? (
                  <div className="space-y-2">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-sky-200/60 dark:bg-sky-900/40" />
                    <div className="h-3 w-full animate-pulse rounded bg-sky-200/40 dark:bg-sky-900/30" />
                    <div className="h-3 w-5/6 animate-pulse rounded bg-sky-200/40 dark:bg-sky-900/30" />
                  </div>
                ) : null}
              </section>
            )}
            {/* Normalized product */}
            {n && (
              <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Normalized Product
                </h4>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {n.standardKey}
                  </Badge>
                  {n.condition !== "unknown" && (
                    <Badge
                      variant="outline"
                      className={`text-xs ${CONDITION_COLORS[n.condition]}`}
                    >
                      {CONDITION_LABELS[n.condition]}
                      {translateConditionRaw(n.conditionRaw) ? ` · ${translateConditionRaw(n.conditionRaw)}` : ""}
                    </Badge>
                  )}
                  {/* Region version badge — color-coded by usability in Portugal */}
                  {n.regionVersion && n.regionVersion !== "unknown" && (
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        n.regionVersion === "china"
                          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      }`}
                      title="Which market this device was originally sold for"
                    >
                      {n.regionVersion === "china" ? "CN" :
                       n.regionVersion === "international" ? "INT" :
                       n.regionVersion === "us" ? "US" :
                       n.regionVersion === "japan" ? "JP" :
                       n.regionVersion === "korea" ? "KR" : n.regionVersion}
                    </Badge>
                  )}
                  {/* Lock status badge — red for locked, green for unlocked */}
                  {n.lockStatus && n.lockStatus !== "unknown" && (
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        n.lockStatus === "unlocked"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                      }`}
                      title={
                        n.lockStatus === "unlocked" ? "Can use any SIM — safe for Portugal" :
                        n.lockStatus === "carrier_locked" ? "Carrier-locked — CANNOT use a Portuguese SIM. Worthless for PT resale." :
                        n.lockStatus === "icloud_locked" ? "iCloud/Activation locked — bricked. Cannot activate." :
                        n.lockStatus === "mdm_locked" ? "MDM supervised lock — enterprise-managed. Cannot activate freely." : ""
                      }
                    >
                      {n.lockStatus === "unlocked" ? "Unlocked" :
                       n.lockStatus === "carrier_locked" ? "Carrier Locked" :
                       n.lockStatus === "icloud_locked" ? "iCloud Locked" :
                       n.lockStatus === "mdm_locked" ? "MDM Locked" : n.lockStatus}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                  {n.family && <Field k="Family" v={n.family} />}
                  {n.storageGB && <Field k="Storage" v={`${n.storageGB}GB`} />}
                  {n.color && <Field k="Color" v={n.color} />}
                  {n.batteryHealth && <Field k="Battery" v={`${n.batteryHealth}%`} />}
                  {n.chip && <Field k="Chip" v={n.chip} />}
                  {n.ramGB && <Field k="RAM" v={`${n.ramGB}GB`} />}
                  {n.displayInch && <Field k="Display" v={`${n.displayInch}"`} />}
                  {n.releaseYear && <Field k="Year" v={String(n.releaseYear)} />}
                  {n.connectivity && <Field k="Network" v={n.connectivity} />}
                  {n.formFactor && <Field k="Form" v={n.formFactor} />}
                  {n.driveConfig && <Field k="Drive" v={n.driveConfig} />}
                </div>
                {/* Lock-status warning banner — prominent alert when locked */}
                {n.lockStatus && n.lockStatus !== "unlocked" && n.lockStatus !== "unknown" && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <span className="font-semibold">
                        {n.lockStatus === "carrier_locked" ? "Carrier-locked device" :
                         n.lockStatus === "icloud_locked" ? "iCloud/Activation locked" :
                         n.lockStatus === "mdm_locked" ? "MDM supervised lock" : "Locked device"}
                      </span>
                      <p className="mt-0.5">
                        {n.lockStatus === "carrier_locked"
                          ? "This phone is locked to a foreign carrier and CANNOT be used with a Portuguese SIM. It is effectively worthless for resale in Portugal — avoid unless you can confirm it can be unlocked."
                          : n.lockStatus === "icloud_locked"
                            ? "This device has an iCloud/Activation lock and cannot be activated without the original owner's Apple ID. It is bricked — do not buy."
                            : n.lockStatus === "mdm_locked"
                              ? "This device is managed by MDM (Mobile Device Management) and cannot be freely activated. It is supervised by an organization — avoid."
                              : "This device has a lock that prevents normal use."}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )}
            {/* Condition flags — prominent display of detected issues like
                "Battery Replaced", "Screen Replaced", "No Box", etc.
                Sourced from BOTH the enriched conditionFlags (from listing
                detail page) AND the scam detector's yellow tokens (from
                title/description text). Deduplicated. */}
            {(l.conditionFlags?.length || scam.matchedYellowTokens.length) ? (
              <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Condition Flags
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {/* Enriched condition flags from the listing detail page */}
                  {l.conditionFlags?.map((flag) => {
                    const isPositive = flag === "All Original" || flag === "Original" || flag === "Never Opened" || flag === "No Water Damage";
                    const isNegative = flag === "Battery Replaced" || flag === "Screen Replaced" ||
                      flag === "No Box" || flag === "Water Damage" || flag === "Screen Leak" ||
                      flag === "Cracked Screen" || flag === "Locked" || flag === "Repaired" || flag === "Opened/Repaired";
                    return (
                      <Badge
                        key={flag}
                        variant="outline"
                        className={`text-xs ${
                          isPositive
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : isNegative
                              ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                              : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}
                      >
                        {flag}
                      </Badge>
                    );
                  })}
                  {/* Yellow modifier tokens from the scam detector (from text) */}
                  {scam.matchedYellowTokens
                    .filter((t) => !l.conditionFlags?.some((f) => t.includes(f)))
                    .map((token) => (
                      <Badge
                        key={token}
                        variant="outline"
                        className="text-xs border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                      >
                        {token}
                      </Badge>
                    ))}
                </div>
              </section>
            ) : null}
            {/* Seller telemetry */}
            <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Seller Telemetry
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <Telemetry icon={MapPin} label="Location" value={l.sellerLocation} />
                <Telemetry
                  icon={User}
                  label="Real-name"
                  value={l.sellerVerified ? "Verified" : "Unverified"}
                  tone={l.sellerVerified ? "text-emerald-600" : "text-amber-600"}
                />
                <Telemetry
                  icon={ShieldCheck}
                  label="Transactions"
                  value={String(l.sellerVerifiedTransactions)}
                />
                <Telemetry icon={Heart} label="Wants" value={String(l.wantsCount)} />
                <Telemetry
                  icon={Images}
                  label="Images"
                  value={String(l.imageCount ?? l.imageUrls.length)}
                />
              </div>
            </section>
            <Separator />
            {/* Landed cost breakdown */}
            <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Landed Cost Breakdown (CNY → Portugal)
              </h4>
              <Table>
                <TableBody>
                  <Row k="Acquisition price (CNY)" v={cny(landed.priceCny)} />
                  <Row
                    k={`FX conversion @ ${landed.cnyToEurRate} (+${(landed.exchangeFeeRate * 100).toFixed(1)}% fee)`}
                    v={eurPrecise(landed.acquisitionCostEur)}
                  />
                  <Row k="Agent service fee (CSS Buy / forwarder)" v={eurPrecise(landed.agentServiceFeeEur)} />
                  <Row k="Inspection / photo fee" v={eur(landed.inspectionFeeEur)} />
                  <Row k="CN domestic shipping (seller → warehouse)" v={eur(landed.domesticShippingCnEur)} />
                  <Row k="Insurance" v={eurPrecise(landed.insuranceFeeEur)} />
                  <Row k="International air freight" v={eur(landed.internationalShippingEur)} />
                  <Row k="Customs clearance (broker)" v={eur(landed.customsClearanceEur)} />
                  <Row k="EU import duty (0% phones/laptops)" v={eurPrecise(landed.importDutyEur)} />
                  <Row k="PT import VAT (23%)" v={eurPrecise(landed.importVatEur)} />
                  <Row k="PT domestic courier (CTT)" v={eur(landed.domesticShippingEur)} />
                  <TableRow className="border-t-2">
                    <TableCell className="font-semibold">Total Landed Cost</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eurPrecise(landed.totalLandedCostEur)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </section>
            {/* Profit analysis */}
            <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Profit Analysis
              </h4>
              <Table>
                <TableBody>
                  <Row
                    k={`Expected resale (${profit.resaleSource ?? "median EU comps"})`}
                    v={eur(profit.expectedResaleEur)}
                  />
                  <Row k="Resale platform fee" v={eurPrecise(profit.resaleFeeEur)} />
                  <Row k="Net resale" v={eur(profit.netResaleEur)} />
                  <Row k="Total landed cost" v={eurPrecise(landed.totalLandedCostEur)} />
                  <TableRow className="border-t-2">
                    <TableCell className="font-semibold">Net Profit</TableCell>
                    <TableCell
                      className={`text-right font-bold tabular-nums ${
                        profit.netProfitEur > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {eurPrecise(profit.netProfitEur)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">Margin</TableCell>
                    <TableCell
                      className={`text-right font-bold tabular-nums ${
                        profit.marginPct >= 30
                          ? "text-emerald-600 dark:text-emerald-400"
                          : profit.marginPct >= 15
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {profit.marginPct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </section>
            {/* Scam report */}
            <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Risk &amp; Scam Report
              </h4>
              <div className="mb-3 flex items-center gap-2">
                {scam.dropped ? (
                  <ShieldAlert className={`h-5 w-5 ${riskTone}`} />
                ) : scam.riskScore >= 40 ? (
                  <AlertTriangle className={`h-5 w-5 ${riskTone}`} />
                ) : (
                  <ShieldCheck className={`h-5 w-5 ${riskTone}`} />
                )}
                <span className={`text-lg font-bold tabular-nums ${riskTone}`}>
                  {scam.riskScore}/100
                </span>
                {scam.dropped && (
                  <Badge variant="destructive" className="text-xs">
                    Auto-dropped
                  </Badge>
                )}
              </div>
              {scam.reasons.length > 0 ? (
                <ul className="space-y-1 text-xs">
                  {scam.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No risk signals detected.
                </p>
              )}
            </section>
            {/* EU comps */}
            <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                European Market Comps ({euComps.length})
              </h4>
              {euComps.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No comparable EU listings found.
                </p>
              ) : (
                <div className="max-h-64 w-full overflow-auto rounded-md border">
                  <Table className="w-full">
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="h-8 w-16 text-xs">Platform</TableHead>
                        <TableHead className="h-8 text-xs">Title</TableHead>
                        <TableHead className="h-8 w-20 text-xs">Condition</TableHead>
                        <TableHead className="h-8 w-12 text-xs">Loc</TableHead>
                        <TableHead className="h-8 w-16 text-right text-xs">Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {euComps.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="py-1.5 text-xs">
                            <Badge
                              variant="outline"
                              className={
                                c.platform === "olx"
                                  ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"
                                  : "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300"
                              }
                            >
                              {c.platform}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate py-1.5 text-xs" title={c.title}>
                            {c.title}
                          </TableCell>
                          <TableCell className="py-1.5 text-xs">
                            {CONDITION_LABELS[c.condition]}
                          </TableCell>
                          <TableCell className="py-1.5 text-xs">{c.location ?? "—"}</TableCell>
                          <TableCell className="py-1.5 text-right text-xs font-medium tabular-nums">
                            {eur(c.priceEur)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
            {/* Description (original Chinese) */}
            <section className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Listing Description (original Chinese)
              </h4>
              <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
                {cleanDisplayTitle(l.description)}
              </p>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {k}
      </span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
function Telemetry({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className={`text-xs font-medium ${tone ?? ""}`}>{value}</span>
      </div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">{k}</TableCell>
      <TableCell className="text-right text-xs font-medium tabular-nums">
        {v}
      </TableCell>
    </TableRow>
  );
}
