// scrapers/utils.ts
// Shared helpers for the scraper modules.

/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Random delay between `minMs` and `maxMs` (inclusive of min, exclusive of max). */
export function jitter(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}

const ACCESSORY_TITLE_REGEX =
  /\b(case|cover|capa|film|protector|protetor|charger|carregador|cable|cabo|adapter|adaptador|screen|ecra|écrã|battery|bateria|holder|suporte|stand|dock|mount|bracket|clip|sticker|skin|decal|tempered|vidro|película|pelicula)\b/i;

/**
 * Returns true if the listing title describes an accessory (case, screen
 * protector, charger, cable, battery, stand, sticker, …) rather than the
 * product itself. Used to filter accessory listings out of EU comps.
 */
export function isAccessoryTitle(title: string): boolean {
  return ACCESSORY_TITLE_REGEX.test(title);
}
