// engine/normalizer.ts
// Regex-based title string cleaner & product normalization pipeline.
// Cleans dirty Goofish listings, discards emojis, maps Chinese market variants,
// outputs a strict standardized layout for cross-platform matching.
import type { Category, Condition, NormalizedProduct } from "./types";
// Storage regex: matches "256GB", "256G", "256 GB", "512G", "1TB", "1T".
// Also matches bare storage numbers that appear right after a model name
// (e.g., "iPhone 15 Pro 256" → 256GB) — common in Chinese marketplace titles
// where sellers omit the unit entirely.
const STORAGE_REGEX = /(\d{2,4})\s*(?:GB|TB|G|T)\b/i;
const TB_REGEX = /(\d{1,2})\s*TB\b/i;
// Bare-number fallback: "iPhone 15 Pro 256" or "15Pro 512" → captures the
// trailing 3-digit number that follows a model/chip keyword. Only used when
// the main STORAGE_REGEX didn't match. Common sizes only (64/128/256/512/1024).
const BARE_STORAGE_REGEX = /(?:pro|pro\s*max|plus|mini|air|standard|slim|普通版|Pro)\s*(\d{3,4})\b/i;
const BATTERY_REGEX = /电池\s*(?:健康|效率)?\s*[:：]?\s*(\d{1,3})\s*%|电量\s*(\d{1,3})\s*%|(\d{1,3})\s*%?\s*电池/i;
const RAM_REGEX = /(\d{1,3})\s*GB\s*(?:内存|RAM|运存)/i;
const YEAR_REGEX = /\b(20\d{2})\b/;
const EMOJI_REGEX =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;
const CONDITION_MAP: Array<{ re: RegExp; condition: Condition; raw: string }> = [
  { re: /全新未拆封|全新未拆|未拆封|全新sealed|brand new sealed/i, condition: "new", raw: "全新" },
  { re: /仅拆封|仅拆|拆封未用|未使用|仅开封/i, condition: "open_box", raw: "仅拆封" },
  { re: /全新|99新|99成新|almost new/i, condition: "excellent", raw: "99新" },
  { re: /95新|95成新|9\.5新/i, condition: "very_good", raw: "95新" },
  { re: /9成新|90新|9成|8成新|80新|8成/i, condition: "good", raw: "9成新" },
  { re: /战损|伊拉克|成色差|垃圾|7成新|7成|6成新|6成/i, condition: "fair", raw: "战损版" },
];
// iPhone model detection — recognizes BOTH "iPhone" and "苹果" (Chinese for Apple)
// followed by the model number. E.g., "苹果17 Pro Max" → iPhone 17 Pro Max.
const IPHONE_MODELS: Array<{
  re: RegExp;
  family: string;
  model: string;
}> = [
  // iPhone 18 series (newest)
  { re: /(?:iphone|苹果)\s*18\s*pro\s*max/i, family: "iPhone 18 Pro Max", model: "iPhone 18 Pro Max" },
  { re: /(?:iphone|苹果)\s*18\s*pro/i, family: "iPhone 18 Pro", model: "iPhone 18 Pro" },
  { re: /(?:iphone|苹果)\s*18\s*plus/i, family: "iPhone 18 Plus", model: "iPhone 18 Plus" },
  { re: /(?:iphone|苹果)\s*18\s*air/i, family: "iPhone 18 Air", model: "iPhone 18 Air" },
  { re: /(?:iphone|苹果)\s*18/i, family: "iPhone 18", model: "iPhone 18" },
  // iPhone 17 series
  { re: /(?:iphone|苹果)\s*17\s*pro\s*max/i, family: "iPhone 17 Pro Max", model: "iPhone 17 Pro Max" },
  { re: /(?:iphone|苹果)\s*17\s*pro/i, family: "iPhone 17 Pro", model: "iPhone 17 Pro" },
  { re: /(?:iphone|苹果)\s*17\s*plus/i, family: "iPhone 17 Plus", model: "iPhone 17 Plus" },
  { re: /(?:iphone|苹果)\s*17\s*air/i, family: "iPhone 17 Air", model: "iPhone 17 Air" },
  { re: /(?:iphone|苹果)\s*17/i, family: "iPhone 17", model: "iPhone 17" },
  // iPhone 16 series
  { re: /(?:iphone|苹果)\s*16\s*pro\s*max/i, family: "iPhone 16 Pro Max", model: "iPhone 16 Pro Max" },
  { re: /(?:iphone|苹果)\s*16\s*pro/i, family: "iPhone 16 Pro", model: "iPhone 16 Pro" },
  { re: /(?:iphone|苹果)\s*16\s*plus/i, family: "iPhone 16 Plus", model: "iPhone 16 Plus" },
  { re: /(?:iphone|苹果)\s*16e/i, family: "iPhone 16e", model: "iPhone 16e" },
  { re: /(?:iphone|苹果)\s*16/i, family: "iPhone 16", model: "iPhone 16" },
  // iPhone 15 series
  { re: /(?:iphone|苹果)\s*15\s*pro\s*max/i, family: "iPhone 15 Pro Max", model: "iPhone 15 Pro Max" },
  { re: /(?:iphone|苹果)\s*15\s*pro/i, family: "iPhone 15 Pro", model: "iPhone 15 Pro" },
  { re: /(?:iphone|苹果)\s*15\s*plus/i, family: "iPhone 15 Plus", model: "iPhone 15 Plus" },
  { re: /(?:iphone|苹果)\s*15/i, family: "iPhone 15", model: "iPhone 15" },
  // iPhone 14 series
  { re: /(?:iphone|苹果)\s*14\s*pro\s*max/i, family: "iPhone 14 Pro Max", model: "iPhone 14 Pro Max" },
  { re: /(?:iphone|苹果)\s*14\s*pro/i, family: "iPhone 14 Pro", model: "iPhone 14 Pro" },
  { re: /(?:iphone|苹果)\s*14\s*plus/i, family: "iPhone 14 Plus", model: "iPhone 14 Plus" },
  { re: /(?:iphone|苹果)\s*14/i, family: "iPhone 14", model: "iPhone 14" },
  // iPhone 13 series
  { re: /(?:iphone|苹果)\s*13\s*pro\s*max/i, family: "iPhone 13 Pro Max", model: "iPhone 13 Pro Max" },
  { re: /(?:iphone|苹果)\s*13\s*pro/i, family: "iPhone 13 Pro", model: "iPhone 13 Pro" },
  { re: /(?:iphone|苹果)\s*13\s*mini/i, family: "iPhone 13 mini", model: "iPhone 13 mini" },
  { re: /(?:iphone|苹果)\s*13/i, family: "iPhone 13", model: "iPhone 13" },
  // iPhone 12 series
  { re: /(?:iphone|苹果)\s*12\s*pro\s*max/i, family: "iPhone 12 Pro Max", model: "iPhone 12 Pro Max" },
  { re: /(?:iphone|苹果)\s*12\s*pro/i, family: "iPhone 12 Pro", model: "iPhone 12 Pro" },
  { re: /(?:iphone|苹果)\s*12/i, family: "iPhone 12", model: "iPhone 12" },
];
// MacBook detection
const MACBOOK_MODELS: Array<{
  re: RegExp;
  family: string;
  chip?: string;
  displayInch?: number;
}> = [
  // M5 series (newest)
  { re: /macbook\s*pro\s*m5\s*max/i, family: "MacBook Pro M5", chip: "M5 Max", displayInch: 16 },
  { re: /macbook\s*pro\s*m5\s*pro/i, family: "MacBook Pro M5", chip: "M5 Pro", displayInch: 14 },
  { re: /macbook\s*pro\s*m5/i, family: "MacBook Pro M5", chip: "M5", displayInch: 14 },
  { re: /macbook\s*air\s*m5/i, family: "MacBook Air M5", chip: "M5", displayInch: 13 },
  // M4 series
  { re: /macbook\s*pro\s*m4\s*max/i, family: "MacBook Pro M4", chip: "M4 Max", displayInch: 16 },
  { re: /macbook\s*pro\s*m4\s*pro/i, family: "MacBook Pro M4", chip: "M4 Pro", displayInch: 14 },
  { re: /macbook\s*pro\s*m4/i, family: "MacBook Pro M4", chip: "M4", displayInch: 14 },
  // M3 series
  { re: /macbook\s*pro\s*m3\s*max/i, family: "MacBook Pro M3", chip: "M3 Max", displayInch: 16 },
  { re: /macbook\s*pro\s*m3\s*pro/i, family: "MacBook Pro M3", chip: "M3 Pro", displayInch: 14 },
  { re: /macbook\s*pro\s*m3/i, family: "MacBook Pro M3", chip: "M3", displayInch: 14 },
  { re: /macbook\s*air\s*m3/i, family: "MacBook Air M3", chip: "M3", displayInch: 13 },
  // M2 series
  { re: /macbook\s*pro\s*m2\s*max/i, family: "MacBook Pro M2", chip: "M2 Max", displayInch: 14 },
  { re: /macbook\s*pro\s*m2\s*pro/i, family: "MacBook Pro M2", chip: "M2 Pro", displayInch: 14 },
  { re: /macbook\s*pro\s*m2/i, family: "MacBook Pro M2", chip: "M2", displayInch: 13 },
  { re: /macbook\s*air\s*m2/i, family: "MacBook Air M2", chip: "M2", displayInch: 13 },
  // M1 series
  { re: /macbook\s*air\s*m1/i, family: "MacBook Air M1", chip: "M1", displayInch: 13 },
  { re: /macbook\s*pro\s*m1/i, family: "MacBook Pro M1", chip: "M1", displayInch: 13 },
];
// iPad detection
const IPAD_MODELS: Array<{
  re: RegExp;
  family: string;
}> = [
  // Newest iPads (M5 Pro, M4 Pro, M2 Air) — check specific chip names first
  { re: /ipad\s*pro\s*m5\s*13/i, family: "iPad Pro M5 13" },
  { re: /ipad\s*pro\s*m5\s*11/i, family: "iPad Pro M5 11" },
  { re: /ipad\s*pro\s*m5/i, family: "iPad Pro M5 11" },
  { re: /ipad\s*pro\s*m4\s*13/i, family: "iPad Pro M4 13" },
  { re: /ipad\s*pro\s*m4\s*11/i, family: "iPad Pro M4 11" },
  { re: /ipad\s*pro\s*m4/i, family: "iPad Pro M4 11" },
  { re: /ipad\s*air\s*m2\s*13/i, family: "iPad Air M2 13" },
  { re: /ipad\s*air\s*m2\s*11/i, family: "iPad Air M2 11" },
  { re: /ipad\s*air\s*m2/i, family: "iPad Air M2 11" },
  // iPad Pro by display size
  { re: /ipad\s*pro\s*13/i, family: "iPad Pro 13" },
  { re: /ipad\s*pro\s*12\.?9/i, family: "iPad Pro 12.9" },
  { re: /ipad\s*pro\s*11/i, family: "iPad Pro 11" },
  // iPad Air by generation
  { re: /ipad\s*air\s*5/i, family: "iPad Air 5" },
  { re: /ipad\s*air\s*4/i, family: "iPad Air 4" },
  { re: /ipad\s*air/i, family: "iPad Air" },
  // iPad Mini
  { re: /ipad\s*mini\s*7/i, family: "iPad Mini 7" },
  { re: /ipad\s*mini\s*6/i, family: "iPad Mini 6" },
  { re: /ipad\s*mini/i, family: "iPad Mini" },
  // iPad by generation
  { re: /ipad\s*10/i, family: "iPad 10" },
  { re: /ipad\s*9/i, family: "iPad 9" },
  { re: /ipad/i, family: "iPad" },
];
// PS5 detection
const PS5_VARIANTS: Array<{
  re: RegExp;
  formFactor: string;
  driveConfig: string;
}> = [
  { re: /ps5\s*slim\s*(?:光驱|disc|有光驱)/i, formFactor: "Slim", driveConfig: "Disc" },
  { re: /ps5\s*slim\s*(?:数字|digital|无光驱)/i, formFactor: "Slim", driveConfig: "Digital" },
  { re: /ps5\s*slim/i, formFactor: "Slim", driveConfig: "Disc" },
  { re: /ps5\s*(?:光驱|disc|有光驱|标准)/i, formFactor: "Standard", driveConfig: "Disc" },
  { re: /ps5\s*(?:数字|digital|无光驱)/i, formFactor: "Standard", driveConfig: "Digital" },
  { re: /ps5|playstation\s*5/i, formFactor: "Standard", driveConfig: "Disc" },
];
// Samsung Galaxy detection — phones (S series, Z Fold/Flip) + tablets (Tab series)
const SAMSUNG_MODELS: Array<{
  re: RegExp;
  family: string;
  model?: string;
}> = [
  // Galaxy S26 series (newest)
  { re: /galaxy\s*s26\s*ultra/i, family: "Galaxy S26 Ultra", model: "Galaxy S26 Ultra" },
  { re: /galaxy\s*s26\s*plus/i, family: "Galaxy S26+", model: "Galaxy S26+" },
  { re: /galaxy\s*s26\+/, family: "Galaxy S26+", model: "Galaxy S26+" },
  { re: /galaxy\s*s26\s*fe/i, family: "Galaxy S26 FE", model: "Galaxy S26 FE" },
  { re: /galaxy\s*s26/i, family: "Galaxy S26", model: "Galaxy S26" },
  // Galaxy S25 series
  { re: /galaxy\s*s25\s*ultra/i, family: "Galaxy S25 Ultra", model: "Galaxy S25 Ultra" },
  { re: /galaxy\s*s25\s*plus/i, family: "Galaxy S25+", model: "Galaxy S25+" },
  { re: /galaxy\s*s25\+/, family: "Galaxy S25+", model: "Galaxy S25+" },
  { re: /galaxy\s*s25\s*edge/i, family: "Galaxy S25 Edge", model: "Galaxy S25 Edge" },
  { re: /galaxy\s*s25/i, family: "Galaxy S25", model: "Galaxy S25" },
  // Galaxy S24 series
  { re: /galaxy\s*s24\s*ultra/i, family: "Galaxy S24 Ultra", model: "Galaxy S24 Ultra" },
  { re: /galaxy\s*s24\s*plus/i, family: "Galaxy S24+", model: "Galaxy S24+" },
  { re: /galaxy\s*s24\+/, family: "Galaxy S24+", model: "Galaxy S24+" },
  { re: /galaxy\s*s24\s*fe/i, family: "Galaxy S24 FE", model: "Galaxy S24 FE" },
  { re: /galaxy\s*s24/i, family: "Galaxy S24", model: "Galaxy S24" },
  // Galaxy S23 series
  { re: /galaxy\s*s23\s*ultra/i, family: "Galaxy S23 Ultra", model: "Galaxy S23 Ultra" },
  { re: /galaxy\s*s23\s*plus/i, family: "Galaxy S23+", model: "Galaxy S23+" },
  { re: /galaxy\s*s23\+/, family: "Galaxy S23+", model: "Galaxy S23+" },
  { re: /galaxy\s*s23\s*fe/i, family: "Galaxy S23 FE", model: "Galaxy S23 FE" },
  { re: /galaxy\s*s23/i, family: "Galaxy S23", model: "Galaxy S23" },
  // Galaxy Z Fold/Flip series
  { re: /galaxy\s*z\s*fold\s*6/i, family: "Galaxy Z Fold 6", model: "Galaxy Z Fold 6" },
  { re: /galaxy\s*z\s*fold\s*5/i, family: "Galaxy Z Fold 5", model: "Galaxy Z Fold 5" },
  { re: /galaxy\s*z\s*flip\s*6/i, family: "Galaxy Z Flip 6", model: "Galaxy Z Flip 6" },
  { re: /galaxy\s*z\s*flip\s*5/i, family: "Galaxy Z Flip 5", model: "Galaxy Z Flip 5" },
  // Galaxy Tab series (tablets)
  { re: /galaxy\s*tab\s*s10\s*ultra/i, family: "Galaxy Tab S10 Ultra", model: "Galaxy Tab S10 Ultra" },
  { re: /galaxy\s*tab\s*s10\s*plus/i, family: "Galaxy Tab S10+", model: "Galaxy Tab S10+" },
  { re: /galaxy\s*tab\s*s10/i, family: "Galaxy Tab S10", model: "Galaxy Tab S10" },
  { re: /galaxy\s*tab\s*s9\s*ultra/i, family: "Galaxy Tab S9 Ultra", model: "Galaxy Tab S9 Ultra" },
  { re: /galaxy\s*tab\s*s9\s*plus/i, family: "Galaxy Tab S9+", model: "Galaxy Tab S9+" },
  { re: /galaxy\s*tab\s*s9\s*fe\s*plus/i, family: "Galaxy Tab S9 FE+", model: "Galaxy Tab S9 FE+" },
  { re: /galaxy\s*tab\s*s9\s*fe/i, family: "Galaxy Tab S9 FE", model: "Galaxy Tab S9 FE" },
  { re: /galaxy\s*tab\s*s9/i, family: "Galaxy Tab S9", model: "Galaxy Tab S9" },
  // Galaxy A series (mid-range)
  { re: /galaxy\s*a55/i, family: "Galaxy A55", model: "Galaxy A55" },
  { re: /galaxy\s*a35/i, family: "Galaxy A35", model: "Galaxy A35" },
];
// Apple Watch detection — by series + size
const APPLE_WATCH_MODELS: Array<{
  re: RegExp;
  family: string;
  model?: string;
}> = [
  // Series 11 (newest)
  { re: /apple\s*watch\s*(?:series\s*)?11\s*41/i, family: "Apple Watch Series 11 41mm", model: "Apple Watch Series 11 41mm" },
  { re: /apple\s*watch\s*(?:series\s*)?11\s*45/i, family: "Apple Watch Series 11 45mm", model: "Apple Watch Series 11 45mm" },
  { re: /apple\s*watch\s*(?:series\s*)?11/i, family: "Apple Watch Series 11", model: "Apple Watch Series 11" },
  // Ultra 3
  { re: /apple\s*watch\s*ultra\s*3/i, family: "Apple Watch Ultra 3", model: "Apple Watch Ultra 3" },
  // SE 3
  { re: /apple\s*watch\s*se\s*3\s*40/i, family: "Apple Watch SE 3 40mm", model: "Apple Watch SE 3 40mm" },
  { re: /apple\s*watch\s*se\s*3\s*44/i, family: "Apple Watch SE 3 44mm", model: "Apple Watch SE 3 44mm" },
  { re: /apple\s*watch\s*se\s*3/i, family: "Apple Watch SE 3", model: "Apple Watch SE 3" },
  // Series 10
  { re: /apple\s*watch\s*(?:series\s*)?10\s*42/i, family: "Apple Watch Series 10 42mm", model: "Apple Watch Series 10 42mm" },
  { re: /apple\s*watch\s*(?:series\s*)?10\s*46/i, family: "Apple Watch Series 10 46mm", model: "Apple Watch Series 10 46mm" },
  { re: /apple\s*watch\s*(?:series\s*)?10/i, family: "Apple Watch Series 10", model: "Apple Watch Series 10" },
  // Ultra 2
  { re: /apple\s*watch\s*ultra\s*2/i, family: "Apple Watch Ultra 2", model: "Apple Watch Ultra 2" },
  // Series 9
  { re: /apple\s*watch\s*(?:series\s*)?9\s*41/i, family: "Apple Watch Series 9 41mm", model: "Apple Watch Series 9 41mm" },
  { re: /apple\s*watch\s*(?:series\s*)?9\s*45/i, family: "Apple Watch Series 9 45mm", model: "Apple Watch Series 9 45mm" },
  { re: /apple\s*watch\s*(?:series\s*)?9/i, family: "Apple Watch Series 9", model: "Apple Watch Series 9" },
  // Ultra 1
  { re: /apple\s*watch\s*ultra\s*1/i, family: "Apple Watch Ultra", model: "Apple Watch Ultra" },
  { re: /apple\s*watch\s*ultra/i, family: "Apple Watch Ultra", model: "Apple Watch Ultra" },
];
// DJI drone detection — by product line + model
const DJI_MODELS: Array<{
  re: RegExp;
  family: string;
  model?: string;
}> = [
  // Mavic 4 Pro (newest)
  { re: /dji\s*mavic\s*4\s*pro/i, family: "DJI Mavic 4 Pro", model: "DJI Mavic 4 Pro" },
  { re: /mavic\s*4\s*pro/i, family: "DJI Mavic 4 Pro", model: "DJI Mavic 4 Pro" },
  // Mavic 3 series
  { re: /dji\s*mavic\s*3\s*pro/i, family: "DJI Mavic 3 Pro", model: "DJI Mavic 3 Pro" },
  { re: /mavic\s*3\s*pro/i, family: "DJI Mavic 3 Pro", model: "DJI Mavic 3 Pro" },
  { re: /dji\s*mavic\s*3\s*cine/i, family: "DJI Mavic 3 Cine", model: "DJI Mavic 3 Cine" },
  { re: /mavic\s*3\s*cine/i, family: "DJI Mavic 3 Cine", model: "DJI Mavic 3 Cine" },
  { re: /dji\s*mavic\s*3/i, family: "DJI Mavic 3", model: "DJI Mavic 3" },
  { re: /mavic\s*3/i, family: "DJI Mavic 3", model: "DJI Mavic 3" },
  // Air 3 series
  { re: /dji\s*air\s*3\s*s/i, family: "DJI Air 3S", model: "DJI Air 3S" },
  { re: /air\s*3\s*s/i, family: "DJI Air 3S", model: "DJI Air 3S" },
  { re: /dji\s*air\s*3/i, family: "DJI Air 3", model: "DJI Air 3" },
  { re: /air\s*3\b/i, family: "DJI Air 3", model: "DJI Air 3" },
  // Mini 4 Pro
  { re: /dji\s*mini\s*4\s*pro/i, family: "DJI Mini 4 Pro", model: "DJI Mini 4 Pro" },
  { re: /mini\s*4\s*pro/i, family: "DJI Mini 4 Pro", model: "DJI Mini 4 Pro" },
  // Mini 3 series
  { re: /dji\s*mini\s*3\s*pro/i, family: "DJI Mini 3 Pro", model: "DJI Mini 3 Pro" },
  { re: /mini\s*3\s*pro/i, family: "DJI Mini 3 Pro", model: "DJI Mini 3 Pro" },
  { re: /dji\s*mini\s*3/i, family: "DJI Mini 3", model: "DJI Mini 3" },
  { re: /mini\s*3\b/i, family: "DJI Mini 3", model: "DJI Mini 3" },
  // Avata series
  { re: /dji\s*avata\s*2/i, family: "DJI Avata 2", model: "DJI Avata 2" },
  { re: /avata\s*2/i, family: "DJI Avata 2", model: "DJI Avata 2" },
  { re: /dji\s*avata/i, family: "DJI Avata", model: "DJI Avata" },
  { re: /avata/i, family: "DJI Avata", model: "DJI Avata" },
  // FPV
  { re: /dji\s*fpv/i, family: "DJI FPV", model: "DJI FPV" },
  // Inspire 3
  { re: /dji\s*inspire\s*3/i, family: "DJI Inspire 3", model: "DJI Inspire 3" },
  { re: /inspire\s*3/i, family: "DJI Inspire 3", model: "DJI Inspire 3" },
];
const COLORS = [
  "午夜色",
  "星光色",
  "蓝色",
  "粉色",
  "红色",
  "绿色",
  "黄色",
  "橙色",
  "紫色",
  "银色",
  "深空灰",
  "太空灰",
  "石墨色",
  "金色",
  "白色",
  "黑色",
  "Midnight",
  "Starlight",
  "Blue",
  "Pink",
  "Silver",
  "Space Gray",
  "Graphite",
  "Gold",
];
export function cleanTitle(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(EMOJI_REGEX, " ");
  // collapse special spacing chars
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, " ");
  // normalize fullwidth spaces and slashes
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
/**
 * Clean a raw Goofish listing title for DISPLAY. Fixes the common Chinese
 * marketplace shorthand "256G" → "256GB" (sellers omit the "B"). Also
 * normalizes "1T" → "1TB". Returns the title with corrected storage units
 * so the UI shows "iPhone 15 Pro 256GB" instead of "iPhone 15 Pro 256G".
 */
export function displayTitle(raw: string): string {
  if (!raw) return "";
  let s = cleanTitle(raw);
  // "256G" → "256GB" (but NOT "256GB" which already has the B)
  // Negative lookbehind: only match if NOT preceded by another digit and NOT
  // followed by "B" (so we don't double-fix "256GB").
  s = s.replace(/(\d{2,4})G(?!B)(?!\d)/g, "$1GB");
  // "1T" → "1TB" (but NOT "1TB")
  s = s.replace(/(\d{1,2})T(?!B)(?!\d)/g, "$1TB");
  return s;
}
function extractStorage(text: string): { storageGB: number; raw: string } | null {
  const tb = text.match(TB_REGEX);
  if (tb) {
    const tbVal = parseInt(tb[1], 10);
    const gbVal = tbVal * 1024;
    return { storageGB: gbVal, raw: `${tbVal}TB` };
  }
  const m = text.match(STORAGE_REGEX);
  if (m) {
    const val = parseInt(m[1], 10);
    if (val >= 8 && val <= 1024) {
      return { storageGB: val, raw: `${val}GB` };
    }
  }
  // Bare-number fallback: sellers often write "iPhone 15 Pro 256" without a
  // unit. Only accept common phone/tablet storage sizes to avoid false positives
  // (e.g., "15 Pro 2024" → 2024 is a year, not storage).
  const COMMON_SIZES = new Set([32, 64, 128, 256, 512, 1024]);
  const bare = text.match(BARE_STORAGE_REGEX);
  if (bare) {
    const val = parseInt(bare[1], 10);
    if (COMMON_SIZES.has(val)) {
      return { storageGB: val, raw: `${val}GB` };
    }
  }
  return null;
}
function extractBattery(text: string): number | null {
  const m = text.match(BATTERY_REGEX);
  if (!m) return null;
  const val = parseInt(m[1] || m[2] || m[3], 10);
  if (val >= 1 && val <= 100) return val;
  return null;
}
function extractColor(text: string): string | null {
  for (const c of COLORS) {
    if (text.includes(c)) return c;
  }
  return null;
}
function extractYear(text: string): number | null {
  const m = text.match(YEAR_REGEX);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  if (y >= 2015 && y <= new Date().getFullYear() + 1) return y;
  return null;
}
function extractRam(text: string): number | null {
  const m = text.match(RAM_REGEX);
  if (!m) return null;
  return parseInt(m[1], 10);
}
function detectCondition(text: string): { condition: Condition; raw: string } {
  for (const entry of CONDITION_MAP) {
    if (entry.re.test(text)) {
      return { condition: entry.condition, raw: entry.raw };
    }
  }
  return { condition: "unknown", raw: "" };
}
/**
 * Translate a Chinese condition raw token (e.g. "99新", "95新", "仅拆封") to
 * an English label for display. Used by the UI so the user doesn't see
 * untranslated Chinese characters next to the condition badge.
 */
export function translateConditionRaw(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    "全新": "Brand New",
    "仅拆封": "Open Box",
    "99新": "Like New (99%)",
    "95新": "Excellent (95%)",
    "9成新": "Good (90%)",
    "战损版": "Heavily Used",
  };
  return map[raw] ?? raw;
}
function detectCategory(text: string): Category | null {
  if (/iphone|苹果手机|苹果\s*\d/i.test(text)) return "iphone";
  if (/macbook|mbp|mba|苹果笔记本|苹果电脑/i.test(text)) return "macbook";
  if (/ipad|苹果平板/i.test(text)) return "ipad";
  if (/ps5|playstation\s*5|索尼\s*5|索尼ps5/i.test(text)) return "ps5";
  if (/samsung|galaxy\s*(s|z|a|note|tab)|三星/i.test(text)) return "samsung";
  if (/apple\s*watch|iwatch|苹果手表|苹果手表/i.test(text)) return "applewatch";
  if (/dji|大疆|mavic|mini\s*[34]|air\s*[23]|avata|inspire|matrice|phantom/i.test(text)) return "dji";
  return null;
}
/**
 * Detect the region version of a device from its listing text.
 *
 * STRATEGY: Check the 【版本】 field FIRST — this is the seller's explicit
 * declaration of which market the device is for. It's the most reliable signal.
 * If no 【版本】 field, fall back to scanning the full text, but check
 * "国际版"/"全球版" (international) BEFORE "国行" (China) — a listing that
 * mentions both (e.g., "国际版，比国行便宜") should be classified as international.
 *
 * Common tokens:
 *   - 【版本】国行 / 【版本】国行双卡 → China mainland version
 *   - 【版本】美版 / 【版本】美版无锁 → US version
 *   - 【版本】国际版 / 【版本】全球版 → International/global version
 *   - 【版本】港版 → Hong Kong version (counts as international for PT)
 *   - 【版本】日版 → Japan version
 *   - 【版本】韩版 → Korea version
 */
function detectRegionVersion(text: string): "china" | "international" | "us" | "japan" | "korea" | "unknown" {
  // 1. Try to extract the 【版本】 field — this is the authoritative source.
  const versionFieldMatch = text.match(/【版本】([^【】]+)/);
  if (versionFieldMatch) {
    const vf = versionFieldMatch[1].trim();
    // Check international FIRST — a 版本 field that says "国际版" is international
    // even if the rest of the text mentions 国行 for comparison.
    if (/国际版|全球版|国际|global|international/i.test(vf)) return "international";
    if (/美版|美国版/.test(vf)) return "us";
    if (/日版|日本版/.test(vf)) return "japan";
    if (/韩版|韩国版/.test(vf)) return "korea";
    if (/港版|香港版|港行/.test(vf)) return "international";
    if (/国行|大陆行货|行货/.test(vf)) return "china";
    // If the 版本 field has content but didn't match any known region (e.g.,
    // "双卡双待全网通" which is a feature description, not a region), fall
    // through to full-text scan below.
  }
  // 2. Full-text scan — check international BEFORE china so a listing that
  // says "国际版" but also mentions "国行" (e.g., for comparison) is correctly
  // classified as international.
  if (/国际版|全球版/.test(text)) return "international";
  if (/美版|美国版/.test(text)) return "us";
  if (/日版|日本版/.test(text)) return "japan";
  if (/韩版|韩国版/.test(text)) return "korea";
  if (/港版|香港版|港行/.test(text)) return "international"; // HK = international for PT
  // Only classify as China if international/US/JP/KR/HK were NOT found.
  if (/国行|大陆行货|国行版|国行双卡|国行单卡/.test(text)) return "china";
  return "unknown";
}
/**
 * Detect the lock status of a device from its listing text.
 *
 * This is THE most important field for cross-border arbitrage. A
 * carrier-locked or iCloud-locked phone is worthless in Portugal — it
 * cannot be activated or used with a local SIM.
 *
 * Common Goofish tokens:
 *   - 无锁 / 解锁 / 无锁版 / 全网通 → Unlocked (can use any SIM)
 *   - 有锁 / 锁卡 / 锁机 / 运营商锁 → Carrier locked
 *   - ID锁 / iCloud锁 / 激活锁 / 账号锁 → iCloud/Activation locked
 *   - 监管锁 / MDM锁 / 企业锁 → MDM (Mobile Device Management) supervised lock
 *
 * Note: "有锁" in the context of "美版有锁" means US carrier-locked (AT&T/
 * T-Mobile/etc.), which is common and cheap but unusable in Portugal.
 */
function detectLockStatus(text: string): "unlocked" | "carrier_locked" | "icloud_locked" | "mdm_locked" | "unknown" {
  // Check the most severe locks first — if iCloud/MDM locked, it's bricked.
  if (/ID锁|iCloud锁|激活锁|账号锁|iCloud\s*locked|activation\s*lock/i.test(text)) {
    return "icloud_locked";
  }
  if (/监管锁|MDM锁|企业锁|supervised/i.test(text)) {
    return "mdm_locked";
  }
  // "无锁" / "解锁" / "全网通" → explicitly unlocked
  if (/无锁|解锁|无锁版|全网通|双卡无锁|单卡无锁|无锁双卡|无锁单卡|unlocked/i.test(text)) {
    return "unlocked";
  }
  // "有锁" / "锁卡" / "锁机" / "运营商锁" → carrier locked
  // BUT: "无锁" is checked above, so "有锁" here means locked.
  if (/有锁|锁卡|锁机|运营商锁|carrier\s*locked/i.test(text)) {
    return "carrier_locked";
  }
  return "unknown";
}
function buildStandardKey(
  category: Category,
  family: string,
  storageGB?: number,
  formFactor?: string,
  driveConfig?: string,
  displayInch?: number,
): string {
  if (category === "ps5") {
    return `PlayStation 5 ${formFactor ?? "Standard"} ${driveConfig ?? "Disc"}`;
  }
  if (category === "macbook") {
    // Use the detected display size when available (14, 16, 13, 15),
    // otherwise fall back to sensible defaults per tier.
    // Previously this ALWAYS hardcoded 14 for Pro and 13 for Air,
    // which was wrong for 16" MacBook Pro listings.
    const disp = displayInch ? String(displayInch) : (family.includes("Pro") ? "14" : "13");
    // Only include storage if explicitly detected — don't guess
    return storageGB ? `${family} ${disp} ${storageGB}GB` : `${family} ${disp}`;
  }
  if (category === "ipad") {
    return storageGB ? `${family} ${storageGB}GB` : family;
  }
  if (category === "samsung") {
    return storageGB ? `${family} ${storageGB}GB` : family;
  }
  if (category === "applewatch") {
    return family; // Apple Watches don't have GB storage variants
  }
  if (category === "dji") {
    return family; // Drones don't have GB storage variants
  }
  // iphone — only include storage if detected, otherwise just the family name
  return storageGB ? `${family} ${storageGB}GB` : family;
}
export function normalizeListing(
  title: string,
  description: string,
): NormalizedProduct | null {
  const text = cleanTitle(`${title} ${description}`);
  if (!text) return null;
  const category = detectCategory(text);
  if (!category) return null;
  const condition = detectCondition(text);
  const storage = extractStorage(text);
  const color = extractColor(text);
  const year = extractYear(text);
  const battery = category === "iphone" || category === "samsung" ? extractBattery(text) : null;
  const ram = category === "macbook" ? extractRam(text) : null;
  let family = "";
  let model: string | undefined;
  let chip: string | undefined;
  let displayInch: number | undefined;
  let formFactor: string | undefined;
  let driveConfig: string | undefined;
  let connectivity: "wifi" | "cellular" | undefined;
  if (category === "iphone") {
    const found = IPHONE_MODELS.find((m) => m.re.test(text));
    if (!found) return null;
    family = found.family;
    model = found.model;
  } else if (category === "macbook") {
    const found = MACBOOK_MODELS.find((m) => m.re.test(text));
    if (!found) return null;
    family = found.family;
    chip = found.chip;
    displayInch = found.displayInch;
  } else if (category === "ipad") {
    const found = IPAD_MODELS.find((m) => m.re.test(text));
    if (!found) return null;
    family = found.family;
    if (/蜂窝|cellular|插卡/.test(text)) connectivity = "cellular";
    else connectivity = "wifi";
  } else if (category === "ps5") {
    const found = PS5_VARIANTS.find((v) => v.re.test(text));
    if (!found) return null;
    formFactor = found.formFactor;
    driveConfig = found.driveConfig;
    family = `PlayStation 5 ${formFactor}`;
  } else if (category === "samsung") {
    const found = SAMSUNG_MODELS.find((m) => m.re.test(text));
    if (!found) return null;
    family = found.family;
    model = found.model;
  } else if (category === "applewatch") {
    const found = APPLE_WATCH_MODELS.find((m) => m.re.test(text));
    if (!found) return null;
    family = found.family;
    model = found.model;
  } else if (category === "dji") {
    const found = DJI_MODELS.find((m) => m.re.test(text));
    if (!found) return null;
    family = found.family;
    model = found.model;
  }
  const standardKey = buildStandardKey(
    category,
    family,
    storage?.storageGB,
    formFactor,
    driveConfig,
    displayInch,
  );
  // Detect region version + lock status (primarily for iPhones/iPads, but
  // also applies to MacBooks — a US MacBook has a different keyboard layout).
  const regionVersion = category === "ps5" ? undefined : detectRegionVersion(text);
  const lockStatus = category === "iphone" || category === "ipad" || category === "samsung" ? detectLockStatus(text) : undefined;
  const product: NormalizedProduct = {
    standardKey,
    category,
    family,
    model,
    storageGB: storage?.storageGB,
    color: color ?? undefined,
    batteryHealth: battery ?? undefined,
    chip,
    ramGB: ram ?? undefined,
    displayInch,
    releaseYear: year ?? undefined,
    connectivity,
    formFactor,
    driveConfig,
    regionVersion,
    lockStatus,
    condition: condition.condition,
    conditionRaw: condition.raw,
  };
  return product;
}
