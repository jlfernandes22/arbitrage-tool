// lib/engine/condition-flags.ts
// Goofish listing condition-flag detection.
//
// Detects condition flags (Screen Replaced, Battery Replaced, Water Damage,
// Never Opened, …) from listing title + description text with verb-aware,
// negation-aware matching — both Chinese and English.
//
// Why a window engine instead of substring matching:
//   - Chinese word order varies: 换屏 / 换过屏 / 屏幕换过 / 屏幕更换过 /
//     更换过屏幕 / 换过内屏 / 屏幕总成换过 …
//   - Negation can appear BEFORE the phrase (没有换过屏幕), BETWEEN the
//     object and verb (屏幕没有换过), or immediately before the verb
//     (没换屏) — and must be scoped to the NEAREST verb so
//     "屏幕没换过电池换过" (screen NOT replaced, battery WAS replaced)
//     resolves correctly for both conditions.
//   - Accessory traps must NOT trigger repair flags:
//     "换过钢化膜" (replaced the tempered-glass protector) ≠ screen replaced.
//   - English listings ("no screen replacement or battery") must be handled.
//
// Consistency rules (critical for accuracy):
//   - "Never Opened" never coexists with any positive repair flag.
//   - "All Original"/"Original" only when no positive repair flags exist.
//   - A negated condition gets a positive flag (Screen Not Replaced,
//     Battery Not Replaced, No Water Damage, Unlocked, Never Opened).

import type { GoofishListing } from "@/lib/engine/types";
import { extractStorage, formatStorageGB } from "@/lib/engine/normalizer";

export type ConditionVerdict = "positive" | "negated" | "none";

export interface ConditionSpec {
  id: string;
  flag: string;            // displayed when positive
  negatedFlag?: string;    // displayed when explicitly negated
  // Chinese noun-verb window engine
  zhNouns: string[];
  zhVerbs: string[];       // longest-first ordering matters
  zhNegations: string[];
  zhAccessories: string[]; // accessory objects a verb must NOT be acting on
  otherParts?: string[];   // device parts whose verbs are NOT this noun's
  // Chinese phrase patterns (for phrases the window engine can't express)
  zhPhrasePositive: RegExp[];
  zhPhraseNegative: RegExp[];
  // English
  enPositive: RegExp[];
  enNegative: RegExp[];
}

const CLAUSE_SPLIT = /[，。；、；,!?！？\n|/．]+/;

const ZH_NEGATIONS = ["没有", "没", "无", "未", "不", "不曾", "从未", "未曾", "没有任何", "无任何"];

// Accessory objects: a "换/修/压" verb acting on these is NOT a repair of
// the device (screen protector / case / film …).
const ZH_ACCESSORIES = [
  "钢化膜", "贴膜", "贴了膜", "水凝膜", "镜头膜", "背膜", "保护膜",
  "膜", "手机壳", "壳", "保护套", "套", "屏保", "后盖", "边框", "边条",
];

// Generic device parts a replacement verb could be acting on. If the verb's
// object is one of these ("屏幕换电池"), the action is NOT about the noun
// being scanned for the current condition.
const GENERIC_PARTS = [
  "主板", "摄像头", "听筒", "喇叭", "尾插", "充电口", "扬声器", "后盖",
  "边框", "指纹", "面容", "麦克风", "振动器",
];
const SCREEN_PARTS = ["屏幕", "内屏", "外屏", "总成", "显示", "排线", "屏"];
const BATTERY_PARTS = ["电池", "电芯"];

// Verbs that indicate a part was changed/repaired (longest first — the
// scan tries longer verbs at each position before shorter ones).
const REPLACE_VERBS = [
  "更换过", "维修过", "组装过", "翻新过", "修复过", "更换", "换过", "换了",
  "换的", "换新", "新换", "修过", "修好", "已修", "修复", "维修", "动过",
  "压过", "换",
];

// ── Screen replaced ────────────────────────────────────────────────────
const SCREEN_REPLACED: ConditionSpec = {
  id: "screen-replaced",
  flag: "Screen Replaced",
  negatedFlag: "Screen Not Replaced",
  zhNouns: ["屏幕", "内屏", "外屏", "总成", "显示", "排线", "屏"],
  zhVerbs: REPLACE_VERBS,
  zhNegations: ZH_NEGATIONS,
  zhAccessories: ZH_ACCESSORIES,
  otherParts: [...GENERIC_PARTS, ...BATTERY_PARTS],
  zhPhrasePositive: [
    /后压屏/,
    /压盖板/,
    /压排线/,
    /组装屏/,
    /国产屏/,
    /翻新屏/,
  ],
  zhPhraseNegative: [
    /(?:原装屏|原屏幕|原屏|屏幕原装|屏幕是原装的|屏是原装)/,
    /(?:非|不是)(?:国产屏|组装屏)/,
    /(?:没|没有|未|无|不曾|从未)(?:有|任何)?(?:换过屏|换屏|换过屏幕|换屏幕)/,
  ],
  enPositive: [
    /\b(screen|display)\s+(was\s+|has\s+been\s+)?(actually|just|already|recently)?\s*(replaced|changed|swapped)\b/i,
    /\b(replaced|changed|swapped)\s+(the\s+)?(screen|display)\b/i,
    /\bnew\s+(screen|display)\b/i,
    /\b(screen|display)\s+replacement\b/i,
  ],
  enNegative: [
    /\bno\s+(screen|display)\s+(replacement|repair|change|swap|work)\b/i,
    /\b(screen|display)\s+(was\s+)?not\s+(replaced|changed|swapped)\b/i,
    /\bnever\s+(replaced|changed|swapped)\s+(the\s+)?(screen|display)\b/i,
    /\bwithout\s+(any\s+)?(screen|display)\s+(replacement|repair)\b/i,
    /\boriginal\s+(screen|display)\b/i,
  ],
};

// ── Battery replaced ───────────────────────────────────────────────────
const BATTERY_REPLACED: ConditionSpec = {
  id: "battery-replaced",
  flag: "Battery Replaced",
  negatedFlag: "Battery Not Replaced",
  zhNouns: ["电池", "电芯"],
  zhVerbs: REPLACE_VERBS,
  zhNegations: ZH_NEGATIONS,
  zhAccessories: ZH_ACCESSORIES,
  otherParts: [...GENERIC_PARTS, ...SCREEN_PARTS],
  zhPhrasePositive: [
    /(?:新电池|新电芯|刚换的电池|新换的电池)/,
    /(?:换电芯|换过电芯|电芯换过)/,
    /(?:电池|电芯)(?:是)?(?:新|全新|新的|全新的)/,
  ],
  zhPhraseNegative: [
    /(?:原装电池|原电池|电池原装|电池是原装的|电池是原厂)/,
    /(?:没|没有|未|无|不曾|从未)(?:有|任何)?(?:换过电池|换电池|换过电芯)/,
    /(?:电池|电芯)(?:是)?(?:不|没|没有|不是)(?:新|全新|新的)/,
  ],
  enPositive: [
    /\bbattery\s+(was\s+|has\s+been\s+)?(actually|just|already|recently)?\s*(replaced|changed|swapped)\b/i,
    /\b(replaced|changed|swapped)\s+(the\s+)?battery\b/i,
    /\bnew\s+battery\b/i,
    /\bbattery\s+replacement\b/i,
  ],
  enNegative: [
    /\bno\s+battery\s+(replacement|repair|change|swap)\b/i,
    /\bbattery\s+(was\s+)?not\s+(replaced|changed|swapped)\b/i,
    /\bnever\s+(replaced|changed|swapped)\s+(the\s+)?battery\b/i,
    /\boriginal\s+battery\b/i,
  ],
};

// ── Opened / repaired (general) ────────────────────────────────────────
const REPAIRED: ConditionSpec = {
  id: "repaired",
  flag: "Opened/Repaired",
  negatedFlag: "Never Opened",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:拆修|拆机|拆过|拆开过|开过机|拆过机)/,
    /(?:修过|维修过|维修|修好|修复过|已修|修好了|修过机)/,
    /(?:动过|翻新|组装过)/,
    /(?:换过|换了|换)(?:手机|机子)?(?:壳|后盖|边框)/,
  ],
  zhPhraseNegative: [
    /(?:没|没有|无|未|不曾|从未|不)(?:有|任何|经过|有过)?(?:拆修|拆机|拆过|修过|维修|维修过|动过|翻新|组装|拆开过|开过机|修过机|换过壳)/,
    /(?:未拆|没拆过|没拆|原封|未动|无修|没修过|无拆无修|无维修|没有维修|没有修过|没修)/,
    /(?:未激活|全新未拆|原封未动)/,
  ],
  enPositive: [
    /\brepaired\b/i,
    /\brefurbished\b/i,
    /\bserviced\b/i,
    /\bfixed\b/i,
    /\bopened\b/i,
  ],
  enNegative: [
    /\b(no|never|not|without)\s+(repairs?|repaired|refurbished|serviced|fixed|opened)\b/i,
    /\bnever\s+(been\s+)?(repaired|opened|touched|serviced)\b/i,
    /\b(unopened|sealed)\b/i,
  ],
};

// ── Water damage ───────────────────────────────────────────────────────
const WATER_DAMAGE: ConditionSpec = {
  id: "water-damage",
  flag: "Water Damage",
  negatedFlag: "No Water Damage",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:进水|进过水|泡水|泡过水|浸水|浸过水|下水|水损|受潮|液体损坏|进液)/,
  ],
  zhPhraseNegative: [
    /(?:没|没有|无|未|不曾|从未)(?:有|任何)?(?:进过|进)?(?:水|水机|液)/,
  ],
  enPositive: [
    /\bwater\s+damage\b/i,
    /\bliquid\s+damage\b/i,
    /\bdamaged\s+by\s+water\b/i,
    /\bwater\s+damaged\b/i,
  ],
  enNegative: [
    /\bno\s+water\s+damage\b/i,
    /\bliquid\s+damage\s+free\b/i,
    /\bnever\s+(been\s+)?(in|near|exposed\s+to)\s+water\b/i,
    /\bnot\s+(water|liquid)\s+damaged\b/i,
    /\bwater\s+damage\s+free\b/i,
  ],
};

// ── Cracked screen ─────────────────────────────────────────────────────
const CRACKED_SCREEN: ConditionSpec = {
  id: "cracked-screen",
  flag: "Cracked Screen",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:碎屏|屏幕碎|屏碎了|外屏碎|内屏碎|屏裂|屏幕裂|裂纹|裂痕|摔碎|屏幕破|屏破|碎角|屏有裂|屏幕有裂|裂屏)/,
  ],
  zhPhraseNegative: [
    /(?:没|没有|无|未)(?:有|任何)?(?:碎屏|屏幕碎|屏碎|屏裂|裂纹|裂痕|摔碎|屏破)/,
  ],
  enPositive: [
    /\b(cracked|broken|shattered)\s+(screen|display)\b/i,
    /\b(screen|display)\s+(is|was)?\s*(cracked|broken|shattered)\b/i,
  ],
  enNegative: [
    /\bno\s+cracks?\b/i,
    /\b(crack|chip)\s+free\b/i,
  ],
};

// ── Screen leak (漏液) ─────────────────────────────────────────────────
const SCREEN_LEAK: ConditionSpec = {
  id: "screen-leak",
  flag: "Screen Leak",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:漏液|屏漏|液晶漏|漏夜)/,
  ],
  zhPhraseNegative: [
    /(?:没|没有|无|未)(?:有)?(?:漏液|屏漏|液晶漏)/,
  ],
  enPositive: [
    /\b(screen|display)\s+leak(?:ing|age)?\b/i,
    /\bleaking\s+(screen|display)\b/i,
  ],
  enNegative: [
    /\bno\s+(screen|display)\s+leak\b/i,
  ],
};

// ── Locked (carrier/activation/iCloud) ─────────────────────────────────
const LOCKED: ConditionSpec = {
  id: "locked",
  flag: "Locked",
  negatedFlag: "Unlocked",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:有锁(?!屏)|卡贴|卡贴机|网络锁|激活锁|id锁|ID锁|iCloud锁|icloud锁|已锁|锁机|有运营商锁|有网络锁|有激活锁|有id锁|海外有锁|美版有锁|有锁版|监管机|监管锁|美版卡贴|卡贴版)/,
  ],
  zhPhraseNegative: [
    /(?:无锁|没锁|未锁|已解锁|官解|无网络锁|无激活锁|无id锁|无ID锁|已官解|解锁版|无锁版|无卡贴|无运营商锁)/,
  ],
  enPositive: [
    /\b(carrier|network|icloud|activation)\s*(-\s*)?locked\b/i,
    /\blocked\b/i,
  ],
  enNegative: [
    /\bunlocked\b/i,
    /\bfactory\s+unlocked\b/i,
    /\block\s+free\b/i,
    /\bsim[- ]free\b/i,
    /\bno\s+(carrier|network|activation|icloud)\s+lock\b/i,
  ],
};

// ── Screen burn-in / aging ─────────────────────────────────────────────
const SCREEN_BURN_IN: ConditionSpec = {
  id: "screen-burn-in",
  flag: "Screen Burn-in",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:烧屏|屏幕老化|屏老化|有老化|老化明显|老化现象)/,
  ],
  zhPhraseNegative: [
    /(?:没|没有|无|未)(?:有|任何)?(?:烧屏|屏幕老化|老化)/,
  ],
  enPositive: [
    /\bburn\s*-?\s*in\b/i,
    /\boled\s+(burn|aging|degradation)\b/i,
  ],
  enNegative: [
    /\bno\s+burn\s*-?\s*in\b/i,
  ],
};

// ── Battery swollen ────────────────────────────────────────────────────
const BATTERY_SWOLLEN: ConditionSpec = {
  id: "battery-swollen",
  flag: "Battery Swollen",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:电池鼓包|电池胀包|电池鼓|鼓包|胀包)/,
  ],
  zhPhraseNegative: [
    /(?:没|没有|无|未)(?:有|任何)?(?:鼓包|胀包)/,
  ],
  enPositive: [
    /\bbattery\s+swollen\b/i,
    /\bswollen\s+battery\b/i,
  ],
  enNegative: [
    /\bno\s+(battery\s+)?swelling\b/i,
  ],
};

// ── Screen spots / dead pixels ─────────────────────────────────────────
const SCREEN_SPOTS: ConditionSpec = {
  id: "screen-spots",
  flag: "Screen Spots",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:亮点|暗点|坏点|黄斑|白斑|彩点|烧屏点|屏幕有斑)/,
  ],
  zhPhraseNegative: [
    /(?:没|没有|无|未)(?:有|任何)?(?:亮点|暗点|坏点|黄斑|白斑|彩点)/,
  ],
  enPositive: [
    /\b(dead|bright|dark|stuck)\s+pixels?\b/i,
    /\b(pixels?|spots?)\s+(dead|bright|dark)\b/i,
  ],
  enNegative: [
    /\bno\s+(dead|bright|dark)\s+pixels?\b/i,
  ],
};

// ── Touch issues ───────────────────────────────────────────────────────
const TOUCH_ISSUES: ConditionSpec = {
  id: "touch-issues",
  flag: "Touch Issues",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:触摸不灵|触屏不灵|触摸失灵|触屏失灵|触摸有问题|触屏有问题|触摸断触|触屏断触|屏幕失灵|触摸不好使|触摸跳屏|触屏跳屏|断触)/,
  ],
  zhPhraseNegative: [
    /(?:触摸|触屏)(?:正常|没问题|无问题|完好)/,
  ],
  enPositive: [
    /\btouch\s+(?:is\s+)?(not\s+working|broken|unresponsive|faulty|issues?|problems?)\b/i,
    /\b(?:screen|display)\s+touch\s+(?:not\s+working|issues?|problems?)\b/i,
  ],
  enNegative: [
    /\btouch\s+(?:works|working|fine|perfectly|good)\b/i,
  ],
};

// ── Won't power on ─────────────────────────────────────────────────────
const NO_POWER: ConditionSpec = {
  id: "no-power",
  flag: "Won't Power On",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:不开机|无法开机|开不了机|不能开机|无法开机|开不机|开不了)|(?:无法开机)/,
  ],
  zhPhraseNegative: [
    /(?:能开机|可以开机|开机正常|开机没问题|正常开机)/,
  ],
  enPositive: [
    /\b(won'?t|will\s+not|doesn'?t|does\s+not|can'?t|cannot)\s+(power\s+on|boot|turn\s+on|start)\b/i,
    /\bno\s+power\b/i,
  ],
  enNegative: [
    /\b(powers|boots|turns)\s+on\s+fine\b/i,
  ],
};

// ── Face ID broken ─────────────────────────────────────────────────────
const FACE_ID_BROKEN: ConditionSpec = {
  id: "face-id-broken",
  flag: "Face ID Broken",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:面容坏|面容损坏|面容不可用|面容失灵|面容废了|face\s*id坏|face\s*id不可用|面容有问题)/i,
  ],
  zhPhraseNegative: [
    /(?:面容正常|面容完好|面容可用|face\s*id正常|face\s*id完好|face\s*id可用)/i,
  ],
  enPositive: [
    /\bface\s*id\s+(is\s+)?(broken|not\s+working|damaged|faulty|unavailable)\b/i,
    /\bfacial\s+recognition\s+(not\s+working|broken)\b/i,
  ],
  enNegative: [
    /\bface\s*id\s+(works|working|fine|perfectly)\b/i,
  ],
};

// ── No box / accessories ───────────────────────────────────────────────
const NO_BOX: ConditionSpec = {
  id: "no-box",
  flag: "No Box",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:无盒|无原盒|不带盒|没有盒|没盒|裸机|单机|无包装|无配件|没有配件|只有手机|无原装盒|无盒说|没有盒子|不带盒子)/,
  ],
  zhPhraseNegative: [],
  enPositive: [
    /\bno\s+(original\s+)?box\b/i,
    /\bwithout\s+(the\s+)?(original\s+)?box\b/i,
    /\bbox\s+not\s+included\b/i,
  ],
  enNegative: [],
};

// ── All original / original ────────────────────────────────────────────
const ALL_ORIGINAL: ConditionSpec = {
  id: "all-original",
  flag: "All Original",
  zhNouns: [],
  zhVerbs: [],
  zhNegations: ZH_NEGATIONS,
  zhAccessories: [],
  zhPhrasePositive: [
    /(?:全原|全原装|原装|原封|原机|原屏|无修无换|无换无修|原装无修|原装无换|全原无修|原装未修|无拆修无换|原封未动)/,
  ],
  zhPhraseNegative: [],
  enPositive: [
    /\ball\s+original\b/i,
    /\bfully\s+original\b/i,
    /\boriginal\s+condition\b/i,
  ],
  enNegative: [],
};

// ── Detection engine ───────────────────────────────────────────────────

function findVerbInWindow(window: string, verbs: string[]): { verb: string; pos: number } | null {
  for (let pos = 0; pos < window.length; pos++) {
    for (const verb of verbs) {
      if (window.startsWith(verb, pos)) return { verb, pos };
    }
  }
  return null;
}

function containsAccessory(window: string, accessories: string[]): boolean {
  return accessories.some((a) => a.length > 0 && window.includes(a));
}

/**
 * Scan a clause for a noun-verb condition (e.g. 屏幕 + 换过 / 换过 + 屏幕).
 * Negation is scoped to the NEAREST verb so "屏幕没换过电池换过" resolves
 * screen=negated, battery=positive.
 */
function scanNounVerbClause(clause: string, spec: ConditionSpec): ConditionVerdict {
  let anyNegated = false;
  for (const noun of spec.zhNouns) {
    let idx = clause.indexOf(noun);
    while (idx !== -1) {
      // The bare "屏" noun must not match inside compounds like 屏保 / 屏风 /
      // 屏障 / 屏幕 / 屏盘 — those aren't the display.
      if (noun === "屏") {
        const next = clause[idx + 1] ?? "";
        if (next && "保风障幕果蔽盘".includes(next)) {
          idx = clause.indexOf(noun, idx + noun.length);
          continue;
        }
      }
      const before = clause.slice(Math.max(0, idx - 12), idx);
      const after = clause.slice(idx + noun.length, idx + noun.length + 12);
      const verdict = scanNounWindow(noun, before, after, spec);
      if (verdict === "positive") return "positive";
      if (verdict === "negated") anyNegated = true;
      idx = clause.indexOf(noun, idx + noun.length);
    }
  }
  return anyNegated ? "negated" : "none";
}

function scanNounWindow(
  noun: string,
  before: string,
  after: string,
  spec: ConditionSpec,
): ConditionVerdict {
  // 0) Verb DIRECTLY attached BEFORE the object (换过屏幕 / 换了电池): this
  //    is the noun's OWN verb and takes precedence over any verb further
  //    away in the after-window ("换过电池 屏幕没换过" — the 换过 after
  //    屏幕 belongs to the battery's own earlier verb).
  const adjBeforeVerb = findVerbInWindow(before, spec.zhVerbs);
  if (adjBeforeVerb) {
    const otherParts = spec.otherParts ?? [];
    const adjGapToNoun = before.slice(adjBeforeVerb.pos + adjBeforeVerb.verb.length);
    // The verb is only THIS noun's if it isn't claimed by another part
    // mentioned right before it ("屏幕没换过电池换过" — 换过 belongs to 屏幕).
    const adjVerbContext = before.slice(Math.max(0, adjBeforeVerb.pos - 4), adjBeforeVerb.pos);
    const claimedByOtherPart = otherParts.some((part) => adjVerbContext.includes(part));
    if (adjGapToNoun.length <= 2 && !claimedByOtherPart && !containsAccessory(adjGapToNoun, spec.zhAccessories)) {
      const preVerb = before.slice(Math.max(0, adjBeforeVerb.pos - 6), adjBeforeVerb.pos);
      if (hasNegation(preVerb)) return "negated";
      return "positive";
    }
  }
  // 1) Verb AFTER the object: 屏幕换过 / 屏幕没有换过 / 屏幕换过钢化膜.
  //    When the after-verb turns out to act on an accessory or another part
  //    ("换过屏幕没有换电池" — the after-verb 换 belongs to 电池), fall
  //    through to the before-verb check instead of concluding "none".
  const afterVerb = findVerbInWindow(after, spec.zhVerbs);
  if (afterVerb) {
    const otherParts = spec.otherParts ?? [];
    const gap = after.slice(0, afterVerb.pos);
    const afterVerbTail = after.slice(afterVerb.pos + afterVerb.verb.length);
    // Cross-part trap: the verb belongs to another part that appears either
    // as its object ("屏幕换电池") or in the gap ("电池原装 屏幕换过" — the
    // verb is 屏幕's). A part followed by another verb is a parallel clause
    // ("屏幕换过电池换过"), not the verb's object.
    const adjacentPart = otherParts.find((part) => afterVerbTail.startsWith(part));
    const isCrossPartObject = adjacentPart
      ? !findVerbInWindow(afterVerbTail.slice(adjacentPart.length), spec.zhVerbs)
      : false;
    const gapHasOtherPart = otherParts.some((part) => gap.includes(part));
    // Accessory trap: 屏幕换过钢化膜 — the verb acts on the protector.
    if (!isCrossPartObject && !gapHasOtherPart && !containsAccessory(afterVerbTail, spec.zhAccessories)) {
      // Negation is scoped to the NEAREST verb ("屏幕没换过电池换过" →
      // screen negated, even though a battery noun follows).
      const preVerb = after.slice(Math.max(0, afterVerb.pos - 3), afterVerb.pos);
      if (hasNegation(gap) || hasNegation(preVerb)) return "negated";
      return "positive";
    }
  }
  // 2) Verb BEFORE the object: 换过屏幕 / 没有换过屏幕 / 换过钢化膜的屏幕
  const beforeVerb = findVerbInWindow(before, spec.zhVerbs);
  if (beforeVerb) {
    const otherParts = spec.otherParts ?? [];
    const gapToNoun = before.slice(beforeVerb.pos + beforeVerb.verb.length);
    if (containsAccessory(gapToNoun, spec.zhAccessories)) return "none";
    // The verb belongs to another part mentioned nearby: either between the
    // verb and this noun ("拆机换过屏 全原电池"), or right before the verb
    // ("屏幕换过 电池原装" — 屏幕's verb).
    const beforeVerbContext = before.slice(Math.max(0, beforeVerb.pos - 4), beforeVerb.pos);
    if (otherParts.some((part) => gapToNoun.includes(part) || beforeVerbContext.includes(part))) {
      return "none";
    }
    // Negation can sit several chars before the verb ("没有拆修和更换屏幕").
    const preVerb = before.slice(Math.max(0, beforeVerb.pos - 6), beforeVerb.pos);
    if (hasNegation(preVerb)) return "negated";
    return "positive";
  }
  return "none";
}

function hasNegation(window: string): boolean {
  return ZH_NEGATIONS.some((n) => n.length > 0 && window.includes(n));
}

function detectCondition(text: string, spec: ConditionSpec): ConditionVerdict {
  const clauses = text.split(CLAUSE_SPLIT);
  let anyNegated = false;
  for (const rawClause of clauses) {
    const clause = rawClause.trim();
    if (!clause) continue;
    // English — negative patterns win within a clause ("no screen
    // replacement or battery" must never trigger the positive regexes).
    if (spec.enNegative.some((re) => re.test(clause))) {
      anyNegated = true;
      continue;
    }
    if (spec.enPositive.some((re) => re.test(clause))) return "positive";
    // Chinese — noun-verb window engine
    const nounVerdict = scanNounVerbClause(clause, spec);
    if (nounVerdict === "positive") return "positive";
    if (nounVerdict === "negated") anyNegated = true;
    // Chinese — phrase patterns. Negative patterns are checked FIRST so
    // "无拆修" / "没换屏" never trigger the positive phrases they contain.
    if (spec.zhPhraseNegative.some((re) => re.test(clause))) {
      anyNegated = true;
      continue;
    }
    if (spec.zhPhrasePositive.some((re) => re.test(clause))) return "positive";
  }
  return anyNegated ? "negated" : "none";
}

/** Extract "Battery Health N%" and "Charge Cycles N" from the text. */
function extractBatteryStats(text: string): { health?: number; cycles?: number } {
  let health: number | undefined;
  let cycles: number | undefined;
  // 电池健康93% / 电池效率100 / 电池93 / battery health 92%
  const healthMatch = text.match(/电池[】】\[\]【]*\s*(?:健康|健康度|效率)?\s*[:：]?\s*(\d{1,3})\s*%?\s*(?:充电\s*(\d{1,4})\s*次)?/);
  if (healthMatch) {
    const n = parseInt(healthMatch[1], 10);
    if (n >= 50 && n <= 100) health = n;
    if (healthMatch[2]) {
      const c = parseInt(healthMatch[2], 10);
      if (c >= 0 && c <= 2000) cycles = c;
    }
  }
  const enHealth = text.match(/\bbattery\s+health\s*[:：]?\s*(\d{1,3})\s*%?/i)
    || text.match(/\bbattery\s*[:：]?\s*(\d{1,3})\s*%/i)
    || text.match(/\b(\d{1,3})\s*%\s+battery\s+health\b/i);
  if (enHealth && !health) {
    const n = parseInt(enHealth[1], 10);
    if (n >= 50 && n <= 100) health = n;
  }
  const enCycles = text.match(/\b(?:charge\s+)?cycles?\s*[:：]?\s*(\d{1,4})\b/i)
    || text.match(/\b(\d{1,4})\s+(?:charge\s+)?cycles?\b/i);
  if (enCycles && !cycles) {
    const c = parseInt(enCycles[1], 10);
    if (c >= 0 && c <= 2000) cycles = c;
  }
  // 充电88次 standalone
  if (!cycles) {
    const cnCycles = text.match(/充电\s*(\d{1,4})\s*次/);
    if (cnCycles) {
      const c = parseInt(cnCycles[1], 10);
      if (c >= 0 && c <= 2000) cycles = c;
    }
  }
  return { health, cycles };
}

/**
 * Detect condition flags and attach them to the listing. Mutates the
 * listing's conditionFlags array.
 *
 * Rules:
 * 1. Factory Sealed suppresses "No Box", "Never Opened", "No Repairs", etc.
 * 2. If any component was replaced/repaired, "Never Opened" and "All Original" are strictly forbidden.
 * 3. Individual negation declarations ("Original Screen", "Original Battery", "No Repairs") are only shown when consistent.
 * 4. "All Original" consolidates redundant declarations.
 */
export function detectConditionFlags(listing: GoofishListing): void {
  let fullText = `${listing.title} ${listing.description}`;
  const flags: string[] = [];

  // Warranty clauses ("人为损坏/进水/屏幕/不在保修范围内") list conditions
  // that are NOT covered by warranty — they are not statements about this
  // device. Mask only the listed items (and the phrase up to the warranty
  // marker), so "进水" etc. don't get flagged as device facts.
  if (/不在保修范围内|保修范围外|不保修|保修不含|保修不包括/.test(fullText)) {
    fullText = fullText.replace(
      /(?:人为损坏|进水|进过水|泡水|泡过水|浸水|碎屏|屏幕碎|屏裂|裂纹|裂痕|漏液|摔碎|屏幕破损|屏破)[^。；\n]{0,25}?(?:不在保修范围内|保修范围外|不保修)/g,
      " ",
    );
  }

  // 0. DETECT STORAGE (e.g., 128GB, 256GB, 512GB, 1TB)
  const storageGB =
    listing.normalized?.storageGB ??
    extractStorage(fullText)?.storageGB;
  const storageFlag = storageGB ? formatStorageGB(storageGB) : null;

  // Sync back to normalized product if missing
  if (storageGB && listing.normalized) {
    if (!listing.normalized.storageGB) {
      listing.normalized.storageGB = storageGB;
    }
    if (
      listing.normalized.family &&
      !listing.normalized.standardKey.includes("GB") &&
      !listing.normalized.standardKey.includes("TB")
    ) {
      listing.normalized.standardKey = `${listing.normalized.standardKey} ${formatStorageGB(storageGB)}`;
    }
  }

  // 1. BRAND NEW / FACTORY SEALED
  const isFactorySealed =
    /全新未拆|原封|未开封|未拆封|全新正品未拆|未激活|factory\s*sealed|brand\s*new\s*sealed/i.test(
      fullText,
    ) && !/拆封|已拆|后封|二手/i.test(fullText);

  if (isFactorySealed) {
    flags.push("Factory Sealed");
    if (storageFlag) flags.push(storageFlag);
    listing.conditionFlags = flags;
    return;
  }

  const screen = detectCondition(fullText, SCREEN_REPLACED);
  const battery = detectCondition(fullText, BATTERY_REPLACED);
  const repaired = detectCondition(fullText, REPAIRED);
  const water = detectCondition(fullText, WATER_DAMAGE);
  const cracked = detectCondition(fullText, CRACKED_SCREEN);
  const leak = detectCondition(fullText, SCREEN_LEAK);
  const locked = detectCondition(fullText, LOCKED);
  const burnIn = detectCondition(fullText, SCREEN_BURN_IN);
  const noBox = detectCondition(fullText, NO_BOX);
  const swollen = detectCondition(fullText, BATTERY_SWOLLEN);
  const spots = detectCondition(fullText, SCREEN_SPOTS);
  const touch = detectCondition(fullText, TOUCH_ISSUES);
  const noPower = detectCondition(fullText, NO_POWER);
  const faceId = detectCondition(fullText, FACE_ID_BROKEN);
  const original = detectCondition(fullText, ALL_ORIGINAL);

  const hasAnyRepair =
    screen === "positive" ||
    battery === "positive" ||
    repaired === "positive";

  const hasHardwareDefect =
    water === "positive" ||
    cracked === "positive" ||
    leak === "positive" ||
    burnIn === "positive" ||
    swollen === "positive" ||
    spots === "positive" ||
    touch === "positive" ||
    noPower === "positive" ||
    faceId === "positive";

  // 1. DEFECT & REPAIR FLAGS (Highest priority / ground truth)
  if (screen === "positive") flags.push("Screen Replaced");
  if (battery === "positive") flags.push("Battery Replaced");
  if (repaired === "positive") flags.push("Opened/Repaired");

  if (water === "positive") flags.push("Water Damage");
  if (cracked === "positive") flags.push("Cracked Screen");
  if (leak === "positive") flags.push("Screen Leak");
  if (burnIn === "positive") flags.push("Screen Burn-in");
  if (swollen === "positive") flags.push("Battery Swollen");
  if (spots === "positive") flags.push("Screen Spots");
  if (touch === "positive") flags.push("Touch Issues");
  if (noPower === "positive") flags.push("Won't Power On");
  if (faceId === "positive") flags.push("Face ID Broken");

  if (locked === "positive") flags.push("Locked");
  else if (locked === "negated") flags.push("Unlocked");

  // 2. TRUST / ORIGINALITY FLAGS (Only valid if NOT contradicted by repairs)
  const isAllOriginal =
    !hasAnyRepair &&
    !hasHardwareDefect &&
    (original === "positive" ||
      /全原|全原装|无修无换|无换无修|原装无修|原装无换|全原无修|原装未修|无拆修无换|all\s+original|fully\s+original/i.test(
        fullText,
      ));

  if (isAllOriginal) {
    flags.push("All Original");
  } else if (!isFactorySealed) {
    // If not All Original, show individual trust declarations if explicitly stated
    if (repaired === "negated" && !hasAnyRepair) {
      flags.push("No Repairs");
    }
    if (screen === "negated") {
      flags.push("Original Screen");
    }
    if (battery === "negated") {
      flags.push("Original Battery");
    }
    if (water === "negated" && !hasHardwareDefect) {
      flags.push("No Water Damage");
    }
  }

  // 3. STORAGE FLAG (e.g. 128GB, 256GB, 512GB, 1TB)
  if (storageFlag) {
    flags.push(storageFlag);
  }

  // 4. PACKAGING / ACCESSORIES
  if (!isFactorySealed && noBox === "positive") {
    flags.push("No Box");
  }

  // 5. BATTERY STATS
  const stats = extractBatteryStats(fullText);
  if (stats.health) flags.push(`Battery ${stats.health}%`);
  if (stats.cycles) flags.push(`Cycles ${stats.cycles}`);

  listing.conditionFlags = flags;
}

/**
 * Returns Tailwind CSS badge classes for a given condition flag.
 */
export function getConditionFlagClasses(flag: string): string {
  if (/Factory Sealed|All Original|No Repairs|Original Screen|Original Battery|No Water Damage/i.test(flag)) {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (/Replaced|Opened|Repaired|Water Damage|Cracked|Leak|Burn-in|Swollen|Spots|Touch|Power|Face ID|Locked/i.test(flag)) {
    return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300";
  }
  if (/No Box|Unlocked/i.test(flag)) {
    return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (/Battery \d+|Cycles \d+/i.test(flag)) {
    return "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300";
  }
  if (/^\d+\s*(?:GB|TB)$/i.test(flag)) {
    return "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300";
  }
  return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300";
}

