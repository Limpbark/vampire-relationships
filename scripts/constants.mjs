/**
 * Vampire Relationships — shared constants.
 * This file is deliberately free of Foundry API calls so it can be used by the
 * standalone renderer preview (dev/) as well as by the module itself.
 */

export const MODULE_ID = "vampire-relationships";
export const MODULE_TITLE = "Vampire Relationships";

/** Keys used under `flags["vampire-relationships"]`. */
export const FLAG = {
  /** Scene: marks a scene as a relationship map. */
  IS_MAP: "isMap",
  /** Scene: appearance / behaviour config for that map. */
  CONFIG: "config",
  /** Actor: record of outgoing bonds, keyed by bond id. */
  BONDS: "bonds",
  /** Actor: narrative status shown on the map (a key of STATUSES). */
  STATUS: "status",
  /** Actor: marks one of the chronicle's key people. */
  KEY: "key"
};

/** Foundry ownership levels, mirrored here so pure code needs no CONST global. */
export const OWNERSHIP = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

/** Colour tokens (numbers for PIXI, strings for CSS live in the stylesheet). */
export const COLORS = {
  ink: 0x050505,
  panel: 0x0a0a0a,
  card: 0x000000,
  cardBorder: 0x6b7280,
  disc: 0x161618,
  text: 0xf0eeea,
  muted: 0x9f9fa9,
  soft: 0xcbc6bc,
  faint: 0x52525b,
  gold: 0xc5a059,
  blood: 0x991b1b,
  bloodBright: 0xdc2626,
  dead: 0x6b7280
};

/** Default per-scene map configuration. */
export const DEFAULT_CONFIG = Object.freeze({
  /** "constellation" (round portraits) or "cards" (portrait + name plate). */
  style: "constellation",
  /** "portrait" (Actor image) or "token" (Token image). */
  image: "portrait",
  /** Show the label chip on each bond. */
  labels: true,
  /** Show the details under each name (rank, clan, covenant, coterie). */
  subtitles: true,
  /** Which of the optional details are printed there. */
  showBloodline: true,
  showRank: true,
  showCoterie: true,
  /** Distinguish bond categories by dash pattern as well as colour. */
  patterned: false,
  /** Draw an outline around each group: "none" | "covenant" | "clan" | "coterie". */
  groups: "none",
  /** A stray drag moves nothing. */
  lockLayout: false,
  /** Dim everything except the hovered character's ties. */
  hoverFocus: true,
  /** Faint dot grid behind the map. */
  backdrop: true
});

/**
 * Bond categories. The dash pattern is only applied when "patterned lines" is on.
 * Pattern values are multiples of the stroke width: [dash, gap, dash, gap ...].
 */
export const CATEGORIES = Object.freeze({
  blood: { label: "Blood", color: "#dc2626", pattern: null },
  loyalty: { label: "Loyalty", color: "#c5a059", pattern: [7, 4] },
  feeling: { label: "Feeling", color: "#f472b6", pattern: [1.2, 3.2] },
  other: { label: "Other", color: "#9ca3af", pattern: [7, 3.5, 1.2, 3.5] }
});

/**
 * The bond catalogue, phrased for Vampire: The Requiem.
 *  - directed: whether the arrow is on by default
 *  - roles:    what each end is called, [from, to]
 *  - lineage:  used by the Lineage arrangement to build trees
 */
export const BOND_TYPES = Object.freeze({
  // ── Blood ────────────────────────────────────────────────────────────────
  sire: { label: "Sire / Childe", short: "Sire", category: "blood", color: "#dc2626", directed: true, roles: ["Sire", "Childe"], lineage: 1 },
  regnant: { label: "Regnant / Ghoul", short: "Regnant", category: "blood", color: "#f59e0b", directed: true, roles: ["Regnant", "Ghoul"], lineage: 2 },
  vinculum: { label: "Vinculum", short: "Vinculum", category: "blood", color: "#991b1b", directed: true, roles: ["Regnant", "Thrall"] },
  broodmate: { label: "Broodmate", short: "Broodmate", category: "blood", color: "#7c3aed", directed: false, roles: ["Broodmate", "Broodmate"] },
  avus: { label: "Avus / Initiate", short: "Avus", category: "blood", color: "#a855f7", directed: true, roles: ["Avus", "Initiate"] },
  diablerie: { label: "Diablerie", short: "Diablerie", category: "blood", color: "#9d174d", directed: true, roles: ["Diablerist", "Victim"] },
  herd: { label: "Herd / Vessel", short: "Herd", category: "blood", color: "#be123c", directed: true, roles: ["Feeds from", "Vessel"] },

  // ── Loyalty ──────────────────────────────────────────────────────────────
  ally: { label: "Ally", short: "Ally", category: "loyalty", color: "#86efac", directed: false, roles: ["Ally", "Ally"] },
  coterie: { label: "Coterie", short: "Coterie", category: "loyalty", color: "#c5a059", directed: false, roles: ["Coterie-mate", "Coterie-mate"] },
  mentor: { label: "Mentor / Student", short: "Mentor", category: "loyalty", color: "#60a5fa", directed: true, roles: ["Mentor", "Student"] },
  patron: { label: "Patron / Client", short: "Patron", category: "loyalty", color: "#0891b2", directed: true, roles: ["Patron", "Client"] },
  oath: { label: "Oath / Vassal", short: "Oath", category: "loyalty", color: "#ca8a04", directed: true, roles: ["Liege", "Vassal"] },
  retainer: { label: "Master / Retainer", short: "Retainer", category: "loyalty", color: "#a78bfa", directed: true, roles: ["Master", "Retainer"] },
  office: { label: "Office", short: "Office", category: "loyalty", color: "#22d3ee", directed: true, roles: ["Superior", "Officer"] },
  boon: { label: "Boon / Debt", short: "Boon", category: "loyalty", color: "#facc15", directed: true, roles: ["Creditor", "Debtor"] },

  // ── Feeling ──────────────────────────────────────────────────────────────
  friend: { label: "Friend", short: "Friend", category: "feeling", color: "#a7f3d0", directed: false, roles: ["Friend", "Friend"] },
  lover: { label: "Lover", short: "Lover", category: "feeling", color: "#f472b6", directed: false, roles: ["Lover", "Lover"] },
  romantic: { label: "Romantic Interest", short: "Romantic", category: "feeling", color: "#ec4899", directed: true, roles: ["Admirer", "Beloved"] },
  touchstone: { label: "Touchstone", short: "Touchstone", category: "feeling", color: "#e879f9", directed: true, roles: ["Kindred", "Touchstone"] },
  rival: { label: "Rival", short: "Rival", category: "feeling", color: "#fb923c", directed: false, roles: ["Rival", "Rival"] },
  enemy: { label: "Enemy", short: "Enemy", category: "feeling", color: "#ef4444", directed: false, roles: ["Enemy", "Enemy"] },
  distrust: { label: "Distrust", short: "Distrust", category: "feeling", color: "#a16207", directed: true, roles: ["Distrusts", "Distrusted"] },

  // ── Other ────────────────────────────────────────────────────────────────
  contact: { label: "Contact", short: "Contact", category: "other", color: "#9ca3af", directed: false, roles: ["Contact", "Contact"] },
  related: { label: "Related To", short: "Related", category: "other", color: "#d4d4d8", directed: false, roles: ["Kin", "Kin"] },
  killed: { label: "Killed", short: "Killed", category: "other", color: "#b91c1c", directed: true, roles: ["Killer", "Victim"] },
  attempted: { label: "Attempted to Kill", short: "Attempt", category: "other", color: "#f87171", directed: true, roles: ["Attacker", "Target"] },
  custom: { label: "Custom", short: "Custom", category: "other", color: "#6b7280", directed: false, roles: ["", ""] }
});

export const DEFAULT_BOND_TYPE = "ally";

/**
 * Narrative statuses a character can carry on the map.
 *  - glyph:  the mark in the corner badge and before the caption
 *  - color:  caption and badge colour
 *  - art:    how the portrait is treated: "dim" | "faded" | "grey"
 *  - ring:   "dashed" breaks the portrait's border, "grey" drains its colour
 *  - struck: a stroke is drawn through the portrait
 *  - gone:   the character is out of the story, for now or for good
 * Glyphs are kept to Latin-1 so every font in the stacks below can draw them.
 */
export const STATUSES = Object.freeze({
  active: { label: "Active", glyph: "", color: "", gone: false },
  torpor: { label: "Torpor", glyph: "Z", color: "#8fa8c8", art: "dim", gone: false },
  missing: { label: "Missing", glyph: "?", color: "#f59e0b", art: "faded", ring: "dashed", gone: true },
  away: { label: "Left the City", glyph: "»", color: "#a1a1aa", art: "faded", ring: "dashed", gone: true },
  dead: { label: "Dead", glyph: "†", color: "#d4d4d8", art: "grey", ring: "grey", struck: true, gone: true },
  destroyed: { label: "Destroyed", glyph: "×", color: "#ef4444", art: "grey", ring: "grey", struck: true, gone: true }
});

/** Resolve a status id to its definition, falling back to "active". */
export function statusDef(id) {
  return STATUSES[id] ?? STATUSES.active;
}

/**
 * Font stacks. The first family that is actually available wins on the canvas.
 * Amiri ships with Foundry core and is always loaded before the canvas draws,
 * so it is the dependable fallback when Cinzel is not bundled.
 */
export const FONT_STACKS = Object.freeze({
  display: ["Cinzel", "Trajan Pro", "Amiri", "Palatino Linotype", "Georgia", "serif"],
  mono: ["Geist Mono", "Cascadia Mono", "Consolas", "Menlo", "Courier New", "monospace"]
});

/**
 * Outline colours for covenants, clans and coteries: eight hues, alternately
 * light and dark. Every pair stays apart on the dark canvas, for full colour
 * vision (OKLab distance of 15 or more) and under simulated red-green colour
 * blindness (8 or more), so any two may end up as neighbours.
 */
export const GROUP_COLORS = Object.freeze([
  0x13a5bc, 0xaf4d0b, 0x8f80f2, 0x298158, 0xe16190, 0x0e6ecb, 0xaa9325, 0x915398
]);

/** FNV-1a, 32 bit: a small stable hash, the same on every client. */
function hashName(name) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Give each group name a colour of its own.
 *
 * A name asks for the colour its hash picks, so it keeps that colour from map
 * to map; when two names ask for the same one, the later in alphabetical order
 * moves along to the next colour that is free. Past eight groups the colours
 * come round again. The answer depends only on the set of names, never on
 * their order, so pass every group on the map, not just those one viewer sees.
 *
 * @param {Iterable<string>} names
 * @returns {Map<string, number>} name -> colour
 */
export function groupColors(names) {
  const unique = [...new Set([...names].filter((name) => typeof name === "string" && name.trim()))];
  const fold = (name) => name.trim().toLowerCase();
  unique.sort((a, b) => {
    const [x, y] = [fold(a), fold(b)];
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  const size = GROUP_COLORS.length;
  const out = new Map();
  let taken = new Set();
  for (const name of unique) {
    if (taken.size === size) taken = new Set();
    let slot = hashName(fold(name)) % size;
    while (taken.has(slot)) slot = (slot + 1) % size;
    taken.add(slot);
    out.set(name, GROUP_COLORS[slot]);
  }
  return out;
}

/** Blend two colours: 0 gives `a`, 1 gives `b`. */
export function mixColors(a, b, amount) {
  const channel = (shift) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * amount);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Parse "#rrggbb" into a number PIXI understands. */
export function hexToNumber(hex, fallback = 0x9ca3af) {
  if (typeof hex === "number") return hex;
  if (typeof hex !== "string") return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1], 16) : fallback;
}

/** Resolve a bond type id to its definition, falling back to "custom". */
export function bondType(id) {
  return BOND_TYPES[id] ?? BOND_TYPES.custom;
}
