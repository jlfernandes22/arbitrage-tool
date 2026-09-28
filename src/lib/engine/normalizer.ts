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
  { re: /(?:iphone|苹果)\s*12\s*mini/i, family: "iPhone 12 Mini", model: "iPhone 12 Mini" },
  { re: /(?:iphone|苹果)\s*12/i, family: "iPhone 12", model: "iPhone 12" },
  // iPhone 11 series
  { re: /(?:iphone|苹果)\s*11\s*pro\s*max/i, family: "iPhone 11 Pro Max", model: "iPhone 11 Pro Max" },
  { re: /(?:iphone|苹果)\s*11\s*pro/i, family: "iPhone 11 Pro", model: "iPhone 11 Pro" },
  { re: /(?:iphone|苹果)\s*11/i, family: "iPhone 11", model: "iPhone 11" },
  // iPhone XS / XS Max / XR (2018) — XS before XR before X (longest first)
  { re: /(?:iphone|苹果)\s*xs\s*max/i, family: "iPhone XS Max", model: "iPhone XS Max" },
  { re: /(?:iphone|苹果)\s*xs/i, family: "iPhone XS", model: "iPhone XS" },
  { re: /(?:iphone|苹果)\s*xr/i, family: "iPhone XR", model: "iPhone XR" },
  // iPhone SE — generation disambiguation. Order matters: the year-bearing
  // patterns run BEFORE the bare digit ones and every bare digit carries a
  // (?![0-9]) guard, otherwise "SE 2016" hits the `2` of the 2020 pattern
  // and "SE 32GB" hits the `3` of the 2022 pattern.
  { re: /(?:iphone|苹果)\s*se\s*(?:2016|第一代|一代|1)(?![0-9])/i, family: "iPhone SE 2016", model: "iPhone SE 2016" },
  { re: /(?:iphone|苹果)\s*se\s*(?:2020|第二代|二代|2)(?![0-9])/i, family: "iPhone SE 2020", model: "iPhone SE 2020" },
  { re: /(?:iphone|苹果)\s*se\s*(?:2022|第三代|三代|3)(?![0-9])/i, family: "iPhone SE 2022", model: "iPhone SE 2022" },
  { re: /(?:iphone|苹果)\s*se/i, family: "iPhone SE 2022", model: "iPhone SE 2022" },
  // iPhone X (2017) — LAST so "XS"/"XR" patterns above win
  { re: /(?:iphone|苹果)\s*x(?![a-z0-9])/i, family: "iPhone X", model: "iPhone X" },
  // Chinese nickname "苹果X" is covered above; also handle "iPhone 10"
  // (rare but seen on Goofish) as iPhone X.
  { re: /(?:iphone|苹果)\s*10(?![a-z0-9])/i, family: "iPhone X", model: "iPhone X" },
  // ── Older iPhone catalog (8 → 5). Longest variant first within each
  // generation: "plus/sp/p" abbreviations before the bare number, and
  // "6s"/"5s"/"5c" before "6"/"5" — otherwise "6sp" would normalize to
  // "iPhone 6s" and "5s" to "iPhone 5". These are common cheap listings
  // on Goofish and were silently dropped before.
  { re: /(?:iphone|苹果)\s*8\s*(?:plus|\+|p)(?![a-z0-9])/i, family: "iPhone 8 Plus", model: "iPhone 8 Plus" },
  { re: /(?:iphone|苹果)\s*8(?![a-z0-9])/i, family: "iPhone 8", model: "iPhone 8" },
  { re: /(?:iphone|苹果)\s*7\s*(?:plus|\+|p)(?![a-z0-9])/i, family: "iPhone 7 Plus", model: "iPhone 7 Plus" },
  { re: /(?:iphone|苹果)\s*7(?![a-z0-9])/i, family: "iPhone 7", model: "iPhone 7" },
  { re: /(?:iphone|苹果)\s*6\s*s\s*(?:plus|\+|p)(?![a-z0-9])/i, family: "iPhone 6s Plus", model: "iPhone 6s Plus" },
  { re: /(?:iphone|苹果)\s*6\s*s(?![a-z0-9])/i, family: "iPhone 6s", model: "iPhone 6s" },
  { re: /(?:iphone|苹果)\s*6\s*(?:plus|\+|p)(?![a-z0-9])/i, family: "iPhone 6 Plus", model: "iPhone 6 Plus" },
  { re: /(?:iphone|苹果)\s*6(?![a-z0-9])/i, family: "iPhone 6", model: "iPhone 6" },
  { re: /(?:iphone|苹果)\s*5\s*s(?![a-z0-9])/i, family: "iPhone 5s", model: "iPhone 5s" },
  { re: /(?:iphone|苹果)\s*5\s*c(?![a-z0-9])/i, family: "iPhone 5c", model: "iPhone 5c" },
  { re: /(?:iphone|苹果)\s*5(?![a-z0-9])/i, family: "iPhone 5", model: "iPhone 5" },
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
  { re: /galaxy\s*z\s*fold\s*8\s*ultra|z\s*fold8\s*ultra/i, family: "Galaxy Z Fold8 Ultra", model: "Galaxy Z Fold8 Ultra" },
  { re: /galaxy\s*z\s*fold\s*8(?!\d)|z\s*fold8(?!\d)/i, family: "Galaxy Z Fold8", model: "Galaxy Z Fold8" },
  { re: /galaxy\s*z\s*flip\s*8(?!\d)|z\s*flip8(?!\d)/i, family: "Galaxy Z Flip8", model: "Galaxy Z Flip8" },
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
  // ── Honor / Vivo / Motorola / Realme (cataloged under samsung) ──
  // Honor Magic series (Magic 8 launched Oct 2025)
  { re: /(?:honor|荣耀)\s*magic\s*8\s*pro/i, family: "Honor Magic 8 Pro", model: "Honor Magic 8 Pro" },
  { re: /(?:honor|荣耀)\s*magic\s*8(?!\d)/i, family: "Honor Magic 8", model: "Honor Magic 8" },
  { re: /(?:honor|荣耀)\s*magic\s*7\s*ultimate|magic\s*7\s*至臻/i, family: "Honor Magic 7 Ultimate", model: "Honor Magic 7 Ultimate" },
  { re: /(?:honor|荣耀)\s*magic\s*7\s*pro/i, family: "Honor Magic 7 Pro", model: "Honor Magic 7 Pro" },
  { re: /(?:honor|荣耀)\s*magic\s*7(?!\d)/i, family: "Honor Magic 7", model: "Honor Magic 7" },
  { re: /(?:honor|荣耀)\s*magic\s*6\s*pro/i, family: "Honor Magic 6 Pro", model: "Honor Magic 6 Pro" },
  { re: /(?:honor|荣耀)\s*magic\s*6(?!\d)/i, family: "Honor Magic 6", model: "Honor Magic 6" },
  { re: /(?:honor|荣耀)\s*300\s*ultra/i, family: "Honor 300 Ultra", model: "Honor 300 Ultra" },
  { re: /(?:honor|荣耀)\s*300\s*pro/i, family: "Honor 300 Pro", model: "Honor 300 Pro" },
  { re: /(?:honor|荣耀)\s*300(?!\d)/i, family: "Honor 300", model: "Honor 300" },
  { re: /(?:honor|荣耀)\s*200\s*pro/i, family: "Honor 200 Pro", model: "Honor 200 Pro" },
  { re: /(?:honor|荣耀)\s*200(?!\d)/i, family: "Honor 200", model: "Honor 200" },
  { re: /(?:honor|荣耀)\s*x60/i, family: "Honor X60", model: "Honor X60" },
  { re: /(?:honor|荣耀)\s*x50/i, family: "Honor X50", model: "Honor X50" },
  // Vivo X / V / iQOO series (X300 launched Oct 2025)
  { re: /(?:vivo|维沃)?\s*x300\s*pro/i, family: "Vivo X300 Pro", model: "Vivo X300 Pro" },
  { re: /(?:vivo|维沃)?\s*x300(?!\d)/i, family: "Vivo X300", model: "Vivo X300" },
  { re: /(?:vivo|维沃)?\s*x200\s*ultra/i, family: "Vivo X200 Ultra", model: "Vivo X200 Ultra" },
  { re: /(?:vivo|维沃)?\s*x200\s*pro/i, family: "Vivo X200 Pro", model: "Vivo X200 Pro" },
  { re: /(?:vivo|维沃)?\s*x200(?!\d)/i, family: "Vivo X200", model: "Vivo X200" },
  { re: /(?:vivo|维沃)?\s*x100\s*pro/i, family: "Vivo X100 Pro", model: "Vivo X100 Pro" },
  { re: /(?:vivo|维沃)?\s*x100(?!\d)/i, family: "Vivo X100", model: "Vivo X100" },
  { re: /(?:vivo|维沃)?\s*v40\s*pro/i, family: "Vivo V40 Pro", model: "Vivo V40 Pro" },
  { re: /(?:vivo|维沃)?\s*v40(?!\d)/i, family: "Vivo V40", model: "Vivo V40" },
  { re: /i[qq]oo\s*15(?!\d)/i, family: "Vivo iQOO 15", model: "Vivo iQOO 15" },
  { re: /i[qq]oo\s*13\s*pro/i, family: "Vivo iQOO 13 Pro", model: "Vivo iQOO 13 Pro" },
  { re: /i[qq]oo\s*13(?!\d)/i, family: "Vivo iQOO 13", model: "Vivo iQOO 13" },
  { re: /i[qq]oo\s*neo\s*10\s*pro/i, family: "Vivo iQOO Neo 10 Pro", model: "Vivo iQOO Neo 10 Pro" },
  { re: /i[qq]oo\s*neo\s*10(?!\d)/i, family: "Vivo iQOO Neo 10", model: "Vivo iQOO Neo 10" },
  // Motorola Edge / Razr / Moto G (Razr 70 Ultra released Apr 2026)
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*edge\s*70\s*pro/i, family: "Motorola Edge 70 Pro", model: "Motorola Edge 70 Pro" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*edge\s*60\s*ultra/i, family: "Motorola Edge 60 Ultra", model: "Motorola Edge 60 Ultra" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*edge\s*60\s*pro/i, family: "Motorola Edge 60 Pro", model: "Motorola Edge 60 Pro" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*edge\s*60(?!\d)/i, family: "Motorola Edge 60", model: "Motorola Edge 60" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*edge\s*50\s*ultra/i, family: "Motorola Edge 50 Ultra", model: "Motorola Edge 50 Ultra" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*edge\s*50\s*pro/i, family: "Motorola Edge 50 Pro", model: "Motorola Edge 50 Pro" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*edge\s*50(?!\d)/i, family: "Motorola Edge 50", model: "Motorola Edge 50" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*razr\s*70\s*ultra/i, family: "Motorola Razr 70 Ultra", model: "Motorola Razr 70 Ultra" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*razr\s*60\s*ultra/i, family: "Motorola Razr 60 Ultra", model: "Motorola Razr 60 Ultra" },
  { re: /(?:moto(?:rola)?|摩托罗拉)?\s*razr\s*60(?!\d)/i, family: "Motorola Razr 60", model: "Motorola Razr 60" },
  { re: /moto\s*g\s*power\s*5g/i, family: "Motorola Moto G Power 5G", model: "Motorola Moto G Power 5G" },
  { re: /moto\s*g\s*stylus\s*5g/i, family: "Motorola Moto G Stylus 5G", model: "Motorola Moto G Stylus 5G" },
  // Realme GT / numbered / Narzo series (GT 8 Pro launched Nov 2025)
  { re: /(?:realme|真我)?\s*gt\s*8\s*pro/i, family: "Realme GT 8 Pro", model: "Realme GT 8 Pro" },
  { re: /(?:realme|真我)?\s*gt\s*8(?!\d)/i, family: "Realme GT 8", model: "Realme GT 8" },
  { re: /(?:realme|真我)?\s*gt\s*7\s*pro/i, family: "Realme GT 7 Pro", model: "Realme GT 7 Pro" },
  { re: /(?:realme|真我)?\s*gt\s*7(?!\d)/i, family: "Realme GT 7", model: "Realme GT 7" },
  { re: /(?:realme|真我)?\s*gt\s*6(?!\d)/i, family: "Realme GT 6", model: "Realme GT 6" },
  { re: /(?:realme|真我)?\s*14\s*pro\s*\+/i, family: "Realme 14 Pro Plus", model: "Realme 14 Pro Plus" },
  { re: /(?:realme|真我)?\s*14\s*pro(?!\+)/i, family: "Realme 14 Pro", model: "Realme 14 Pro" },
  { re: /(?:realme|真我)?\s*13\s*pro\s*\+/i, family: "Realme 13 Pro Plus", model: "Realme 13 Pro Plus" },
  { re: /(?:realme|真我)?\s*13\s*pro(?!\+)/i, family: "Realme 13 Pro", model: "Realme 13 Pro" },
  { re: /(?:realme|真我)?\s*13\s*\+/i, family: "Realme 13 Plus", model: "Realme 13 Plus" },
  { re: /narzo\s*70\s*pro/i, family: "Realme Narzo 70 Pro", model: "Realme Narzo 70 Pro" },
  { re: /narzo\s*70(?!\d)/i, family: "Realme Narzo 70", model: "Realme Narzo 70" },
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
// Xiaomi group detection — Xiaomi/Redmi/POCO phones plus OnePlus and OPPO
// (all four brands are cataloged under category "xiaomi"). Patterns cover
// the marketplace spellings sellers actually use: "小米18Pro", "红米K90",
// "一加15T", "FindX10" — no space, no "B" in storage, mixed CN/EN.
// NOTE: `(?!\d)` guards (e.g. Xiaomi\s*18(?!\d)) stop "小米180W充电器"
// from matching the "Xiaomi 18" phone family. Most-specific pattern first
// (.find() returns the first hit): Pro Max > Pro > T-variants > base.
const XIAOMI_MODELS: Array<{
  re: RegExp;
  family: string;
  model?: string;
}> = [
  // Xiaomi 18 series (2026 — Pro/Pro Max Sep 23, base 18 late 2026)
  { re: /(?:xiaomi|小米)\s*18\s*pro\s*max/i, family: "Xiaomi 18 Pro Max", model: "Xiaomi 18 Pro Max" },
  { re: /(?:xiaomi|小米)\s*18\s*pro/i, family: "Xiaomi 18 Pro", model: "Xiaomi 18 Pro" },
  { re: /(?:xiaomi|小米)\s*18(?!\d)/i, family: "Xiaomi 18", model: "Xiaomi 18" },
  // Xiaomi 17 series (2025)
  { re: /(?:xiaomi|小米)\s*17\s*ultra/i, family: "Xiaomi 17 Ultra", model: "Xiaomi 17 Ultra" },
  { re: /(?:xiaomi|小米)\s*17\s*pro\s*max/i, family: "Xiaomi 17 Pro Max", model: "Xiaomi 17 Pro Max" },
  { re: /(?:xiaomi|小米)\s*17\s*pro/i, family: "Xiaomi 17 Pro", model: "Xiaomi 17 Pro" },
  { re: /(?:xiaomi|小米)\s*17t\s*pro/i, family: "Xiaomi 17T Pro", model: "Xiaomi 17T Pro" },
  { re: /(?:xiaomi|小米)\s*17t(?!\d)/i, family: "Xiaomi 17T", model: "Xiaomi 17T" },
  { re: /(?:xiaomi|小米)\s*17(?!\d)/i, family: "Xiaomi 17", model: "Xiaomi 17" },
  // Xiaomi 15 / 14 / 13 series
  { re: /(?:xiaomi|小米)\s*15\s*ultra/i, family: "Xiaomi 15 Ultra", model: "Xiaomi 15 Ultra" },
  { re: /(?:xiaomi|小米)\s*15\s*pro/i, family: "Xiaomi 15 Pro", model: "Xiaomi 15 Pro" },
  { re: /(?:xiaomi|小米)\s*15t\s*pro/i, family: "Xiaomi 15T Pro", model: "Xiaomi 15T Pro" },
  { re: /(?:xiaomi|小米)\s*15t(?!\d)/i, family: "Xiaomi 15T", model: "Xiaomi 15T" },
  { re: /(?:xiaomi|小米)\s*15(?!\d)/i, family: "Xiaomi 15", model: "Xiaomi 15" },
  { re: /(?:xiaomi|小米)\s*14\s*ultra/i, family: "Xiaomi 14 Ultra", model: "Xiaomi 14 Ultra" },
  { re: /(?:xiaomi|小米)\s*14\s*pro/i, family: "Xiaomi 14 Pro", model: "Xiaomi 14 Pro" },
  { re: /(?:xiaomi|小米)\s*14(?!\d)/i, family: "Xiaomi 14", model: "Xiaomi 14" },
  { re: /(?:xiaomi|小米)\s*13\s*ultra/i, family: "Xiaomi 13 Ultra", model: "Xiaomi 13 Ultra" },
  { re: /(?:xiaomi|小米)\s*13\s*pro/i, family: "Xiaomi 13 Pro", model: "Xiaomi 13 Pro" },
  { re: /(?:xiaomi|小米)\s*13(?!\d)/i, family: "Xiaomi 13", model: "Xiaomi 13" },
  // Redmi K series (flagship killer)
  { re: /(?:redmi|红米)\s*k90\s*pro\s*max/i, family: "Redmi K90 Pro Max", model: "Redmi K90 Pro Max" },
  { re: /(?:redmi|红米)\s*k90(?!\d)/i, family: "Redmi K90", model: "Redmi K90" },
  { re: /(?:redmi|红米)\s*k80\s*pro/i, family: "Redmi K80 Pro", model: "Redmi K80 Pro" },
  { re: /(?:redmi|红米)\s*k80(?!\d)/i, family: "Redmi K80", model: "Redmi K80" },
  { re: /(?:redmi|红米)\s*k70e/i, family: "Redmi K70E", model: "Redmi K70E" },
  { re: /(?:redmi|红米)\s*k70\s*pro/i, family: "Redmi K70 Pro", model: "Redmi K70 Pro" },
  { re: /(?:redmi|红米)\s*k70(?!\d)/i, family: "Redmi K70", model: "Redmi K70" },
  // Redmi Turbo series
  { re: /(?:redmi|红米)\s*turbo\s*4\s*pro/i, family: "Redmi Turbo 4 Pro", model: "Redmi Turbo 4 Pro" },
  { re: /(?:redmi|红米)\s*turbo\s*4(?!\d)/i, family: "Redmi Turbo 4", model: "Redmi Turbo 4" },
  { re: /(?:redmi|红米)\s*turbo\s*3\s*pro/i, family: "Redmi Turbo 3 Pro", model: "Redmi Turbo 3 Pro" },
  { re: /(?:redmi|红米)\s*turbo\s*3(?!\d)/i, family: "Redmi Turbo 3", model: "Redmi Turbo 3" },
  // POCO series (global Redmi twins)
  { re: /poco\s*f8\s*ultra/i, family: "POCO F8 Ultra", model: "POCO F8 Ultra" },
  { re: /poco\s*f8\s*pro/i, family: "POCO F8 Pro", model: "POCO F8 Pro" },
  { re: /poco\s*f7\s*ultra/i, family: "POCO F7 Ultra", model: "POCO F7 Ultra" },
  { re: /poco\s*f7\s*pro/i, family: "POCO F7 Pro", model: "POCO F7 Pro" },
  { re: /poco\s*f6\s*pro/i, family: "POCO F6 Pro", model: "POCO F6 Pro" },
  { re: /poco\s*f6(?!\d)/i, family: "POCO F6", model: "POCO F6" },
  { re: /poco\s*x7\s*pro/i, family: "POCO X7 Pro", model: "POCO X7 Pro" },
  { re: /poco\s*x7(?!\d)/i, family: "POCO X7", model: "POCO X7" },
  { re: /poco\s*x6\s*pro/i, family: "POCO X6 Pro", model: "POCO X6 Pro" },
  { re: /poco\s*x6(?!\d)/i, family: "POCO X6", model: "POCO X6" },
  // Redmi Note series (mid-range)
  { re: /(?:redmi|红米)\s*note\s*15\s*pro\s*(?:\+|plus)/i, family: "Redmi Note 15 Pro Plus", model: "Redmi Note 15 Pro Plus" },
  { re: /(?:redmi|红米)\s*note\s*15\s*pro/i, family: "Redmi Note 15 Pro", model: "Redmi Note 15 Pro" },
  { re: /(?:redmi|红米)\s*note\s*15(?!\d)/i, family: "Redmi Note 15", model: "Redmi Note 15" },
  { re: /(?:redmi|红米)\s*note\s*14\s*pro\s*(?:\+|plus)/i, family: "Redmi Note 14 Pro Plus", model: "Redmi Note 14 Pro Plus" },
  { re: /(?:redmi|红米)\s*note\s*14\s*pro/i, family: "Redmi Note 14 Pro", model: "Redmi Note 14 Pro" },
  { re: /(?:redmi|红米)\s*note\s*14(?!\d)/i, family: "Redmi Note 14", model: "Redmi Note 14" },
  { re: /(?:redmi|红米)\s*note\s*13\s*pro\s*(?:\+|plus)/i, family: "Redmi Note 13 Pro Plus", model: "Redmi Note 13 Pro Plus" },
  { re: /(?:redmi|红米)\s*note\s*13\s*pro/i, family: "Redmi Note 13 Pro", model: "Redmi Note 13 Pro" },
  { re: /(?:redmi|红米)\s*note\s*13(?!\d)/i, family: "Redmi Note 13", model: "Redmi Note 13" },
  { re: /(?:redmi|红米)\s*13c/i, family: "Redmi 13C", model: "Redmi 13C" },
  // OnePlus (compact flagship 15T launched Mar 2026)
  { re: /(?:oneplus|一加)\s*15t(?!\d)/i, family: "OnePlus 15T", model: "OnePlus 15T" },
  { re: /(?:oneplus|一加)\s*15r/i, family: "OnePlus 15R", model: "OnePlus 15R" },
  { re: /(?:oneplus|一加)\s*15(?!\d)/i, family: "OnePlus 15", model: "OnePlus 15" },
  { re: /(?:oneplus|一加)\s*13t/i, family: "OnePlus 13T", model: "OnePlus 13T" },
  { re: /(?:oneplus|一加)\s*13r/i, family: "OnePlus 13R", model: "OnePlus 13R" },
  { re: /(?:oneplus|一加)\s*13(?!\d)/i, family: "OnePlus 13", model: "OnePlus 13" },
  { re: /(?:oneplus|一加)\s*12r/i, family: "OnePlus 12R", model: "OnePlus 12R" },
  { re: /(?:oneplus|一加)\s*12(?!\d)/i, family: "OnePlus 12", model: "OnePlus 12" },
  { re: /(?:oneplus|一加)\s*nord\s*ce\s*4/i, family: "OnePlus Nord CE 4", model: "OnePlus Nord CE 4" },
  { re: /(?:oneplus|一加)\s*nord\s*4/i, family: "OnePlus Nord 4", model: "OnePlus Nord 4" },
  // OPPO Find / Reno (Find X10 launched Sep 22, 2026)
  { re: /find\s*x10\s*pro\s*max/i, family: "OPPO Find X10 Pro Max", model: "OPPO Find X10 Pro Max" },
  { re: /find\s*x10\s*pro/i, family: "OPPO Find X10 Pro", model: "OPPO Find X10 Pro" },
  { re: /find\s*x10(?!\d)/i, family: "OPPO Find X10", model: "OPPO Find X10" },
  { re: /find\s*x9\s*ultra/i, family: "OPPO Find X9 Ultra", model: "OPPO Find X9 Ultra" },
  { re: /find\s*x9s\s*pro/i, family: "OPPO Find X9s Pro", model: "OPPO Find X9s Pro" },
  { re: /find\s*x9s(?!\d)/i, family: "OPPO Find X9s", model: "OPPO Find X9s" },
  { re: /find\s*x9\s*pro/i, family: "OPPO Find X9 Pro", model: "OPPO Find X9 Pro" },
  { re: /find\s*x9(?!\d)/i, family: "OPPO Find X9", model: "OPPO Find X9" },
  { re: /find\s*x8\s*ultra/i, family: "OPPO Find X8 Ultra", model: "OPPO Find X8 Ultra" },
  { re: /find\s*x8\s*pro/i, family: "OPPO Find X8 Pro", model: "OPPO Find X8 Pro" },
  { re: /find\s*x8(?!\d)/i, family: "OPPO Find X8", model: "OPPO Find X8" },
  { re: /find\s*x7\s*ultra/i, family: "OPPO Find X7 Ultra", model: "OPPO Find X7 Ultra" },
  { re: /find\s*x7\s*pro/i, family: "OPPO Find X7 Pro", model: "OPPO Find X7 Pro" },
  { re: /reno\s*16\s*pro/i, family: "OPPO Reno 16 Pro", model: "OPPO Reno 16 Pro" },
  { re: /reno\s*16(?!\d)/i, family: "OPPO Reno 16", model: "OPPO Reno 16" },
  { re: /reno\s*13\s*pro/i, family: "OPPO Reno 13 Pro", model: "OPPO Reno 13 Pro" },
  { re: /reno\s*13(?!\d)/i, family: "OPPO Reno 13", model: "OPPO Reno 13" },
  { re: /reno\s*12\s*pro/i, family: "OPPO Reno 12 Pro", model: "OPPO Reno 12 Pro" },
  { re: /reno\s*12(?!\d)/i, family: "OPPO Reno 12", model: "OPPO Reno 12" },
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
export function formatStorageGB(storageGB: number): string {
  if (storageGB >= 1024 && storageGB % 1024 === 0) {
    return `${storageGB / 1024}TB`;
  }
  return `${storageGB}GB`;
}

export function extractStorage(text: string): { storageGB: number; raw: string } | null {
  // 1. Explicit TB patterns (e.g. "1TB", "2TB", "1T", "2T", "容量: 1T", "1 TB")
  const tbSpec = text.match(/(?:容量|机身内存|机身存储|存储容量|存储|版本)\s*[:：]?\s*(\d{1,2})\s*(?:TB|T)\b/i);
  if (tbSpec) {
    const tbVal = parseInt(tbSpec[1], 10);
    if (tbVal >= 1 && tbVal <= 16) {
      return { storageGB: tbVal * 1024, raw: `${tbVal}TB` };
    }
  }
  // Bare-T shorthand ("1T"/"2T") is common on Goofish, BUT a bare "T" glued
  // to a number is ALSO how sellers write T-model names ("一加15T 16+512G",
  // "小米17T Pro", "OnePlus 8T"). No phone has 15TB of storage — so a bare-T
  // value > 2 is a model number, NOT capacity, and must NOT short-circuit
  // extraction (it previously turned every 15T/17T listing into a fake
  // "15360GB" storage variant, corrupting comp matching + ref-price lookup).
  // Bare-T up to 8 stays valid for laptop contexts ("MacBook 8T" shorthand).
  const laptopCtx = /macbook|笔记本|laptop|imac|mac\s*mini/i.test(text);
  const tbCandidates = [
    text.match(/\b([1-9]|1[0-6])\s*(TB|T)\b/i),
    text.match(/(?:^|\s|[^\da-zA-Z])([1-9]|1[0-6])\s*(TB|T)(?:[^\da-zA-Z]|$)/i),
  ];
  for (const tb of tbCandidates) {
    if (!tb) continue;
    const tbVal = parseInt(tb[1], 10);
    const isBareT = tb[2].toUpperCase() === "T";
    const plausible = !isBareT || tbVal <= 2 || (laptopCtx && tbVal <= 8);
    if (tbVal >= 1 && tbVal <= 16 && plausible) {
      return { storageGB: tbVal * 1024, raw: `${tbVal}TB` };
    }
  }

  // 2. RAM + Storage combos like "12+256G", "16+512G", "8G+128G", "12GB+256GB"
  const combo = text.match(/\b\d{1,2}\s*(?:G|GB)?\s*\+\s*(\d{2,4})\s*(?:GB|G)?\b/i);
  if (combo) {
    const val = parseInt(combo[1], 10);
    if (val >= 16 && val <= 2048) {
      return { storageGB: val, raw: formatStorageGB(val) };
    }
  }

  // 3. Explicit spec attribute prefix: 容量: 256G, 存储容量: 512GB, 机身内存: 128G
  const specMatch = text.match(/(?:容量|机身内存|机身存储|存储容量|存储|版本)\s*[:：]?\s*(\d{2,4})\s*(?:GB|G)?\b/i);
  if (specMatch) {
    const val = parseInt(specMatch[1], 10);
    if (val >= 16 && val <= 2048) {
      return { storageGB: val, raw: formatStorageGB(val) };
    }
  }

  // 4. Standard GB regex: "256GB", "256G", "128 GB", "512gb"
  const m = text.match(STORAGE_REGEX);
  if (m) {
    const val = parseInt(m[1], 10);
    if (val >= 16 && val <= 2048) {
      return { storageGB: val, raw: formatStorageGB(val) };
    }
  }

  // 5. Bare-number fallback: "iPhone 15 Pro 256", "iPad Air 5 64"
  const COMMON_SIZES = new Set([16, 32, 64, 128, 256, 512, 1024, 2048]);
  const bare = text.match(BARE_STORAGE_REGEX);
  if (bare) {
    const val = parseInt(bare[1], 10);
    if (COMMON_SIZES.has(val)) {
      return { storageGB: val, raw: formatStorageGB(val) };
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
  // "苹果X" / "苹果SE" / "苹果XR" carry a LETTER model, not a digit —
  // the old digit-only check dropped every 苹果X-family listing to NULL.
  if (/iphone|苹果手机|苹果\s*(?:\d|x|se)/i.test(text)) return "iphone";
  if (/macbook|mbp|mba|苹果笔记本|苹果电脑/i.test(text)) return "macbook";
  if (/ipad|苹果平板/i.test(text)) return "ipad";
  if (/ps5|playstation\s*5|索尼\s*5|索尼ps5/i.test(text)) return "ps5";
  if (/samsung|galaxy\s*(s|z|a|note|tab)|三星/i.test(text)) return "samsung";
  if (/apple\s*watch|iwatch|苹果手表|苹果手表/i.test(text)) return "applewatch";
  if (/dji|大疆|mavic|mini\s*[34]|air\s*[23]|avata|inspire|matrice|phantom/i.test(text)) return "dji";
  // Android brands not covered above. Xiaomi/Redmi/POCO/OnePlus/OPPO are
  // cataloged under category "xiaomi"; Honor/Vivo/iQOO/Motorola/Realme share
  // the "samsung" bucket (same landed-cost/lock-status treatment as Galaxy).
  // These branches run LAST so they can never steal a title from the
  // established iphone/macbook/ipad/ps5/samsung/applewatch/dji detectors.
  if (/xiaomi|redmi|poco|小米|红米|oneplus|一加|oppo|欧珀|find\s*x\d|reno\s*\d{1,2}|nord/i.test(text)) return "xiaomi";
  if (/honor|荣耀|magic\s*\d|vivo|维沃|i[qq]oo|爱酷|motorola|摩托罗拉|razr\s*\d{2}|realme|真我/i.test(text)) return "samsung";
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
  } else if (category === "xiaomi") {
    // Xiaomi/Redmi/POCO + OnePlus + OPPO. Titles that hit the category but
    // no specific phone model (e.g. "Xiaomi Pad 8", "Mi Band 9") return
    // null — same as the pre-2026 behaviour, never a wrong family.
    const found = XIAOMI_MODELS.find((m) => m.re.test(text));
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
