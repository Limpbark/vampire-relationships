/**
 * Dependency-free checks, run with:  node dev/test.mjs
 *
 * Foundry itself is not available here, so a few of its globals are stubbed.
 * That is enough to (1) link every module and catch a bad import, (2) test
 * the logic that does not need a canvas, and (3) confirm every translation
 * key the code asks for exists in lang/en.json.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

/* -------------------------------------------- */
/*  Stand-ins for Foundry globals               */
/* -------------------------------------------- */

class Collection extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
  filter(fn) {
    return [...this.values()].filter(fn);
  }
  find(fn) {
    return [...this.values()].find(fn);
  }
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      merge(target[key], value);
    } else target[key] = value;
  }
  return target;
}

function expand(data) {
  const out = {};
  for (const [path, value] of Object.entries(data)) {
    const keys = path.split(".");
    let cursor = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) cursor[key] = value;
      else cursor = cursor[key] ??= {};
    });
  }
  return out;
}

class Actor {
  constructor(id, name, ownership = { default: 0 }, system = {}) {
    Object.assign(this, { id, name, ownership, system, flags: {}, img: "", type: "character" });
  }
  getUserLevel(user) {
    return this.ownership[user.id] ?? this.ownership.default ?? 0;
  }
  testUserPermission(user, level) {
    if (user.isGM) return true;
    return this.getUserLevel(user) >= level;
  }
  async update(data) {
    merge(this, expand(data));
    return this;
  }
  async setFlag(scope, key, value) {
    return this.update({ [`flags.${scope}.${key}`]: value });
  }
  async unsetFlag(scope, key) {
    const keys = key.split(".");
    let cursor = this.flags[scope];
    for (const part of keys.slice(0, -1)) cursor = cursor?.[part];
    if (cursor) delete cursor[keys.at(-1)];
    return this;
  }
}

const gm = { id: "gm", name: "Storyteller", isGM: true };
const ann = { id: "ann", name: "Ann", isGM: false };
const bob = { id: "bob", name: "Bob", isGM: false };

const strings = JSON.parse(readFileSync(join(root, "lang", "en.json"), "utf8"));
const lookup = (key) => key.split(".").reduce((node, part) => node?.[part], strings);

const settings = new Map([
  ["minCharacterLevel", 1],
  ["defaultBondVisibility", "everyone"],
  ["playersMoveNodes", false],
  ["dossierOnSelect", true],
  ["welcomed", true]
]);

const hooks = new Map();
globalThis.Hooks = {
  on: (name, fn) => {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
  once: (name, fn) => globalThis.Hooks.on(name, fn),
  callAll: () => {}
};

globalThis.CONST = {
  DEFAULT_TOKEN: "icons/svg/mystery-man.svg",
  TOKEN_DISPLAY_MODES: { NONE: 0 },
  GRID_TYPES: { GRIDLESS: 0 },
  FOG_EXPLORATION_MODES: { DISABLED: 0 }
};
globalThis.CONFIG = { Actor: { typeLabels: {} }, Scene: {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.canvas = { ready: false, scene: null };

class FakeApp {}
globalThis.foundry = {
  utils: {
    randomID: () => Math.random().toString(36).slice(2, 12),
    escapeHTML: (s) => String(s),
    debounce: (fn) => fn
  },
  applications: {
    api: { ApplicationV2: FakeApp, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: class {} },
    apps: {}
  },
  canvas: { placeables: { Token: class { get isVisible() { return true; } } }, loadTexture: async () => null }
};

globalThis.game = {
  user: gm,
  users: new Collection([[gm.id, gm], [ann.id, ann], [bob.id, bob]]),
  actors: new Collection(),
  scenes: new Collection(),
  settings: { get: (scope, key) => settings.get(key), register() {}, registerMenu() {}, set: async () => {} },
  keybindings: { register() {} },
  modules: new Map(),
  i18n: {
    has: (key) => typeof lookup(key) === "string",
    localize: (key) => lookup(key) ?? key,
    format: (key, data = {}) => String(lookup(key) ?? key).replace(/\{(\w+)\}/g, (m, k) => data[k] ?? m)
  }
};

function resetActors() {
  game.actors.clear();
  const make = (id, name, ownership, system) => game.actors.set(id, new Actor(id, name, ownership, system));
  make("prince", "Prince Vance", { default: 1 }, {
    characterVariant: "vampire", clan: "Ventrue", bloodline: "Malkovian", covenant: "Invictus", vamp_rank: "Prince", faction: "The Court"
  });
  make("sheriff", "Sheriff Mara", { default: 0, ann: 1 }, { characterVariant: "vampire", clan: "Gangrel", covenant: "Invictus" });
  make("ghoul", "Benny", { default: 0 }, { characterVariant: "ghoul" });
  make("pc", "Ann's Kindred", { default: 0, ann: 3 }, { characterVariant: "vampire", clan: "Daeva", isTypeKnown: true });
}

/* -------------------------------------------- */
/*  Tests                                       */
/* -------------------------------------------- */

const { BOND_TYPES, CATEGORIES, DEFAULT_CONFIG, MODULE_ID, STATUSES, hexToNumber, statusDef } = await import("../scripts/constants.mjs");
const geometry = await import("../scripts/geometry.mjs");
const layout = await import("../scripts/layout.mjs");

await test("every module links (no missing imports or exports)", async () => {
  await import("../scripts/main.mjs");
  for (const name of ["init", "ready", "canvasReady", "refreshToken", "preCreateToken", "preUpdateToken", "updateActor"]) {
    assert.ok(hooks.has(name), `main.mjs should listen for ${name}`);
  }
});

await test("bond catalogue is well formed", () => {
  for (const [id, def] of Object.entries(BOND_TYPES)) {
    assert.ok(CATEGORIES[def.category], `${id}: unknown category`);
    assert.match(def.color, /^#[0-9a-f]{6}$/, `${id}: colour`);
    assert.equal(def.roles.length, 2, `${id}: roles`);
    assert.equal(typeof def.directed, "boolean", `${id}: directed`);
    assert.ok(def.label && def.short, `${id}: labels`);
  }
  assert.equal(hexToNumber("#ff0000"), 0xff0000);
  assert.equal(hexToNumber("nonsense", 7), 7);
  assert.equal(MODULE_ID, JSON.parse(readFileSync(join(root, "module.json"), "utf8")).id);
});

await test("geometry: anchors sit on the border of each shape", () => {
  const circle = { kind: "circle", cx: 0, cy: 0, r: 50 };
  const a = geometry.shapeAnchor(circle, { x: 100, y: 0 });
  assert.ok(Math.abs(a.x - 50) < 1e-9 && Math.abs(a.y) < 1e-9);
  const rect = { kind: "rect", x: -100, y: -20, w: 200, h: 40 };
  const right = geometry.shapeAnchor(rect, { x: 500, y: 0 });
  assert.ok(Math.abs(right.x - 100) < 1e-9);
  const top = geometry.shapeAnchor(rect, { x: 0, y: -500 });
  assert.ok(Math.abs(top.y + 20) < 1e-9);
  const corner = geometry.shapeAnchor(rect, { x: 1000, y: 1000 });
  assert.ok(Math.abs(corner.y - 20) < 1e-9 && corner.x <= 100);
  assert.deepEqual(geometry.shapeAnchor(circle, { x: 0, y: 0 }), { x: 0, y: 0 });
});

await test("geometry: routes, dashes and arrowheads", () => {
  const a = { kind: "circle", cx: 0, cy: 0, r: 50 };
  const b = { kind: "circle", cx: 400, cy: 0, r: 50 };
  const straight = geometry.routeEdge(a, b, 0, 5);
  assert.ok(Math.abs(straight.p0.x - 55) < 1e-9 && Math.abs(straight.p1.x - 345) < 1e-9);
  const curved = geometry.routeEdge(a, b, 80, 0);
  assert.ok(Math.abs(curved.c.y - 80) < 1e-9, "control point is offset along the normal");

  const points = geometry.sampleQuad(curved.p0, curved.c, curved.p1, 20);
  assert.equal(points.length, 21);
  const length = geometry.polylineLength(points);
  assert.ok(length > 300 && length < 400);

  const dashes = geometry.dashPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], [10, 5]);
  assert.equal(dashes.length, 7);
  const inked = dashes.reduce((sum, d) => sum + geometry.polylineLength(d), 0);
  assert.ok(Math.abs(inked - 70) < 1e-6, `dash ink ${inked}`);

  const head = geometry.arrowHead([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, 8);
  assert.deepEqual(head.tip, { x: 100, y: 0 });
  assert.ok(Math.abs(head.left.x - 90) < 1e-9 && Math.abs(Math.abs(head.left.y) - 4) < 1e-9);
  assert.ok(geometry.polylineLength(head.shaft) < 100);
  assert.equal(geometry.arrowHead([{ x: 0, y: 0 }, { x: 5, y: 0 }], 10, 8), null, "too short for an arrow");

  assert.ok(geometry.rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
  assert.ok(!geometry.rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }));
  assert.equal(geometry.parallelOffset(0, 1), 0);
  assert.deepEqual([0, 1, 2].map((i) => geometry.parallelOffset(i, 3)), [-1, 0, 1]);
});

const sampleNodes = (count, groups = 1) =>
  Array.from({ length: count }, (_, i) => ({ id: `n${i}`, group: `g${i % groups}` }));

function minDistance(positions) {
  const pts = [...positions.values()];
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  }
  return min;
}

await test("layouts place every node, finitely, without overlap", () => {
  const nodes = sampleNodes(14, 3);
  const edges = [];
  for (let i = 1; i < nodes.length; i++) edges.push({ a: `n${Math.floor(i / 2)}`, b: `n${i}`, lineage: i < 7 ? 1 : 0 });
  const results = {
    circle: layout.circleLayout(nodes, { spacing: 260 }),
    force: layout.forceLayout(nodes, edges, { spacing: 260 }),
    grouped: layout.groupedLayout(nodes, { spacing: 260 }),
    lineage: layout.lineageLayout(nodes, edges, { spacingX: 260, spacingY: 300 }),
    grid: layout.gridLayout(nodes, { spacingX: 260, spacingY: 260 })
  };
  for (const [name, positions] of Object.entries(results)) {
    assert.equal(positions.size, nodes.length, `${name}: all nodes placed`);
    for (const p of positions.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${name}: finite`);
    assert.ok(minDistance(positions) > 120, `${name}: nodes too close (${minDistance(positions).toFixed(1)})`);
  }
  const a = layout.forceLayout(nodes, edges, { spacing: 260 });
  assert.deepEqual([...a.values()], [...results.force.values()], "force layout is deterministic");
});

await test("layouts cope with empty and single-node input", () => {
  for (const fn of [layout.circleLayout, layout.groupedLayout, layout.gridLayout]) {
    assert.equal(fn([]).size, 0);
    assert.equal(fn([{ id: "solo" }]).size, 1);
  }
  assert.equal(layout.forceLayout([], []).size, 0);
  assert.deepEqual(layout.forceLayout([{ id: "solo" }], []).get("solo"), { x: 0, y: 0 });
  assert.equal(layout.lineageLayout([{ id: "solo" }], []).size, 1);
});

await test("lineage layout puts sires above childer and survives loops", () => {
  const nodes = ["a", "b", "c", "d", "x"].map((id) => ({ id }));
  const edges = [
    { a: "a", b: "b", lineage: 1 },
    { a: "a", b: "c", lineage: 1 },
    { a: "b", b: "d", lineage: 1 },
    { a: "d", b: "a", lineage: 1 }, // a loop: must be ignored, not followed forever
    { a: "a", b: "x", lineage: 0 }
  ];
  const pos = layout.lineageLayout(nodes, edges, { spacingX: 200, spacingY: 300 });
  assert.equal(pos.size, 5);
  assert.ok(pos.get("a").y < pos.get("b").y && pos.get("b").y < pos.get("d").y);
  assert.equal(pos.get("b").y, pos.get("c").y);
  assert.ok(pos.get("x").y > pos.get("d").y, "characters outside the tree sit underneath");
});

await test("grouped layout keeps groups apart", () => {
  const nodes = sampleNodes(12, 3);
  const pos = layout.groupedLayout(nodes, { spacing: 260 });
  const centre = (group) => {
    const pts = nodes.filter((n) => n.group === group).map((n) => pos.get(n.id));
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  };
  const [c0, c1] = [centre("g0"), centre("g1")];
  assert.ok(Math.hypot(c0.x - c1.x, c0.y - c1.y) > 400);
});

const visibility = await import("../scripts/visibility.mjs");
const bonds = await import("../scripts/bonds.mjs");
const system = await import("../scripts/system.mjs");

await test("characters follow Actor ownership", () => {
  resetActors();
  const actor = (id) => game.actors.get(id);
  assert.ok(visibility.canSeeActor(actor("prince"), ann), "default Limited is enough");
  assert.ok(visibility.canSeeActor(actor("sheriff"), ann), "per-user grant");
  assert.ok(!visibility.canSeeActor(actor("sheriff"), bob));
  assert.ok(!visibility.canSeeActor(actor("ghoul"), ann));
  assert.ok(visibility.canSeeActor(actor("ghoul"), gm), "Storyteller sees everyone");

  settings.set("minCharacterLevel", 2);
  assert.ok(!visibility.canSeeActor(actor("prince"), ann), "raising the threshold hides Limited characters");
  assert.ok(visibility.canSeeActor(actor("pc"), ann), "owners still see their own");
  settings.set("minCharacterLevel", 1);

  assert.equal(visibility.actorSecrecy(actor("prince")), "none");
  assert.equal(visibility.actorSecrecy(actor("sheriff")), "some");
  assert.equal(visibility.actorSecrecy(actor("ghoul")), "all");
  assert.equal(visibility.actorSecrecy(actor("prince"), { hidden: true }), "all", "a hidden token is secret");

  const token = { hidden: false, actorId: "prince" };
  assert.ok(visibility.canSeeToken(token, ann));
  assert.ok(!visibility.canSeeToken({ ...token, hidden: true }, ann));
  assert.ok(visibility.canSeeToken({ ...token, hidden: true }, gm));
});

await test("bond ownership: the editor's three modes round-trip", () => {
  for (const [mode, chosen] of [["everyone", []], ["gm", []], ["specific", ["bob"]]]) {
    const ownership = visibility.buildOwnership(mode, chosen);
    const back = visibility.readOwnership(ownership);
    assert.equal(back.mode, mode);
    assert.deepEqual(back.users, chosen);
  }
  // Re-saving over an old record must not leave a stale grant behind.
  const stale = merge({ default: 0, ann: 2, bob: 0 }, visibility.buildOwnership("gm"));
  assert.equal(visibility.readOwnership(stale).mode, "gm");
});

await test("a bond is seen only with its audience AND both characters", () => {
  resetActors();
  const everyone = visibility.buildOwnership("everyone");
  const open = { from: "prince", to: "sheriff", ownership: everyone };
  assert.ok(visibility.canSeeBond(open, ann));
  assert.ok(!visibility.canSeeBond(open, bob), "Bob cannot see the Sheriff, so not the bond either");
  assert.equal(visibility.bondSecrecy(open), "some");

  const secret = { from: "prince", to: "pc", ownership: visibility.buildOwnership("gm") };
  assert.ok(!visibility.canSeeBond(secret, ann), "Storyteller-only bond between visible characters");
  assert.ok(visibility.canSeeBond(secret, gm));
  assert.equal(visibility.bondSecrecy(secret), "all");

  const forAnn = { from: "prince", to: "pc", ownership: visibility.buildOwnership("specific", ["ann"]) };
  assert.ok(visibility.canSeeBond(forAnn, ann));
  assert.ok(!visibility.canSeeBond(forAnn, bob));
});

await test("view-as swaps the viewer for Storytellers only", () => {
  resetActors();
  assert.equal(visibility.viewer(), gm);
  visibility.setViewAs("bob");
  assert.equal(visibility.viewer(), bob);
  assert.ok(!visibility.canSeeActor(game.actors.get("sheriff")));
  visibility.setViewAs(null);
  game.user = ann;
  visibility.setViewAs("bob");
  assert.equal(visibility.viewer(), ann, "players cannot borrow another user's eyes");
  game.user = gm;
});

await test("bonds are stored on the source Actor and indexed both ways", async () => {
  resetActors();
  bonds.invalidateBonds();
  const id = await bonds.saveBond({ from: "prince", to: "sheriff", type: "sire", ownership: visibility.buildOwnership("gm") });
  const stored = game.actors.get("prince").flags[MODULE_ID].bonds[id];
  assert.equal(stored.to, "sheriff");
  assert.equal(stored.directed, true, "type default applied");
  assert.equal(bonds.getBond(id).from, "prince");
  assert.equal(bonds.bondsOf("sheriff").in.length, 1);
  assert.equal(bonds.bondsOf("prince").out.length, 1);
  assert.deepEqual(bonds.perspective(bonds.getBond(id), "sheriff"), { otherId: "prince", outgoing: false });

  // Editing in place
  await bonds.saveBond({ id, from: "prince", to: "sheriff", type: "sire", label: "Embraced 1892", strength: 9 });
  assert.equal(bonds.getBond(id).label, "Embraced 1892");
  assert.equal(bonds.getBond(id).strength, 5, "strength is clamped");
  assert.equal(bonds.allBonds().length, 1);

  // Moving the bond to start from someone else re-homes the record
  await bonds.saveBond({ id, from: "pc", to: "sheriff", type: "ally" });
  assert.equal(bonds.getBond(id).from, "pc");
  assert.equal(game.actors.get("prince").flags[MODULE_ID].bonds[id], undefined);
  assert.equal(bonds.allBonds().length, 1);

  await assert.rejects(bonds.saveBond({ from: "pc", to: "pc", type: "ally" }));
  await assert.rejects(bonds.saveBond({ from: "pc", to: "nobody", type: "ally" }));

  assert.ok(await bonds.deleteBond(id));
  assert.equal(bonds.allBonds().length, 0);
  assert.equal(await bonds.deleteBond("missing"), false);
});

await test("bonds to a deleted Actor are ignored, then pruned", async () => {
  resetActors();
  bonds.invalidateBonds();
  const id = await bonds.saveBond({ from: "prince", to: "ghoul", type: "regnant" });
  game.actors.delete("ghoul");
  bonds.invalidateBonds();
  assert.equal(bonds.allBonds().length, 0, "dangling bond is not indexed");
  await bonds.pruneBondsTo("ghoul");
  assert.equal(game.actors.get("prince").flags[MODULE_ID].bonds[id], undefined);
});

await test("unknown bond types and bad data normalise safely", () => {
  const bond = bonds.normalizeBond({ to: "x", type: "made-up", strength: "abc", color: "red", directed: "yes" }, "y", "id1");
  assert.equal(bond.type, "custom");
  assert.equal(bond.strength, 3);
  assert.equal(bond.color, "");
  assert.equal(bond.directed, false);
  assert.equal(bonds.normalizeBond({ to: "x", type: "custom", color: "#ABCDEF" }, "y", "id2").color, "#abcdef");
});

await test("system adapter reads the Requiem sheet and respects 'type known'", () => {
  resetActors();
  const actor = (id) => game.actors.get(id);
  assert.equal(system.subtitleFor(actor("prince"), gm), "Ventrue · Invictus");
  assert.equal(system.subtitleFor(actor("ghoul"), gm), "Ghoul");
  assert.equal(system.subtitleFor(actor("prince"), ann), "", "Limited ownership does not reveal clan");
  assert.equal(system.subtitleFor(actor("pc"), bob), "Daeva", "the sheet's type-known box reveals it");
  assert.equal(system.groupFor(actor("prince"), "covenant", gm), "Invictus");
  assert.equal(system.groupFor(actor("ghoul"), "clan", gm), "Ghoul");
  assert.equal(system.groupFor(actor("prince"), "clan", ann), "");
  assert.equal(system.imageFor({ texture: { src: "a.webp" } }, { img: "icons/svg/mystery-man.svg" }, "portrait"), "a.webp");
  assert.equal(system.imageFor({ texture: { src: "icons/svg/mystery-man.svg" } }, { img: "" }, "token"), "");
});

await test("rank, bloodline and coterie are read from the sheet and can be switched off", () => {
  resetActors();
  const actor = (id) => game.actors.get(id);
  assert.deepEqual(system.detailLines(actor("prince"), gm), [
    { text: "Prince", tone: "gold", caps: true },
    { text: "Ventrue (Malkovian) · Invictus", tone: "muted" },
    { text: "The Court", tone: "soft" }
  ]);
  assert.deepEqual(
    system.detailLines(actor("prince"), gm, { showRank: false, showBloodline: false, showCoterie: false }),
    [{ text: "Ventrue · Invictus", tone: "muted" }]
  );
  assert.deepEqual(system.detailLines(actor("prince"), ann), [], "Limited ownership reveals none of it");
  assert.deepEqual(system.detailLines(actor("ghoul"), gm), [{ text: "Ghoul", tone: "muted" }]);
  assert.deepEqual(system.detailsFor(actor("prince"), ann), { rank: "", nature: "", coterie: "" });
  assert.equal(system.groupFor(actor("prince"), "coterie", gm), "The Court");
  assert.equal(system.groupFor(actor("sheriff"), "coterie", gm), "", "no coterie, no group");
  assert.equal(system.groupFor(actor("prince"), "coterie", ann), "");
});

await test("an unlinked token's own copy of the sheet is what the map reads", () => {
  resetActors();
  const base = game.actors.get("sheriff");
  const copy = new Actor("sheriff", base.name, base.ownership, { ...base.system, vamp_rank: "Sheriff", isDead: true });
  const linked = { actorId: "sheriff", actorLink: true, actor: base };
  const unlinked = { actorId: "sheriff", actorLink: false, actor: copy };

  assert.equal(visibility.sheetActor(linked), base);
  assert.equal(visibility.sheetActor(unlinked), copy, "the token's copy, not the world Actor");
  assert.equal(visibility.baseActor(unlinked), base, "identity and ownership stay with the world Actor");
  assert.equal(visibility.sheetActor({ actorId: "sheriff", actor: null }), base, "no copy available: fall back");

  const rank = (actor) => system.detailLines(actor, gm).find((line) => line.tone === "gold")?.text;
  assert.equal(rank(visibility.sheetActor(linked)), undefined);
  assert.equal(rank(visibility.sheetActor(unlinked)), "Sheriff");
  assert.equal(system.statusFor(visibility.sheetActor(unlinked)), "destroyed", "the copy's dead box counts too");
  assert.equal(system.statusFor(base), "active");
});

await test("statuses: catalogue, sheet fallback and explicit flags", async () => {
  for (const [id, def] of Object.entries(STATUSES)) {
    assert.ok(def.label, `${id}: label`);
    if (id === "active") continue;
    assert.ok(def.glyph, `${id}: glyph`);
    assert.match(def.color, /^#[0-9a-f]{6}$/, `${id}: colour`);
    assert.ok(["dim", "faded", "grey"].includes(def.art), `${id}: portrait treatment`);
    assert.equal(typeof lookup(`VR.Status.${id}`), "string", `${id}: translated`);
  }
  for (const id of ["missing", "away", "dead", "destroyed"]) assert.ok(STATUSES[id].gone, `${id} counts as gone`);
  assert.equal(statusDef("nonsense"), STATUSES.active);

  resetActors();
  const actor = (id) => game.actors.get(id);
  assert.equal(system.statusFor(actor("prince")), "active");
  actor("prince").system.isDead = true;
  assert.equal(system.statusFor(actor("prince")), "destroyed", "a vampire's ticked dead box is Final Death");
  actor("ghoul").system.isDead = true;
  assert.equal(system.statusFor(actor("ghoul")), "dead", "anyone else is simply dead");

  assert.ok(await system.setStatus(actor("prince"), "missing"));
  assert.equal(system.statusFor(actor("prince")), "missing", "an explicit status wins");
  assert.ok(await system.setStatus(actor("prince"), "active"));
  assert.equal(system.statusFor(actor("prince")), "active", "and can overrule the sheet");
  assert.equal(await system.setStatus(actor("prince"), "nonsense"), false);
  assert.equal(system.statusFor(actor("prince")), "active");
});

await test("map tokens: layout lock and player moves are refused", () => {
  const scene = { flags: { [MODULE_ID]: { isMap: true, config: { ...DEFAULT_CONFIG } } } };
  const plain = { flags: {} };
  const guard = hooks.get("preUpdateToken")[0];
  const doc = (parent) => ({ parent });

  game.user = ann;
  assert.equal(guard(doc(plain), { x: 5 }, {}), undefined, "ordinary scenes are left alone");
  assert.equal(guard(doc(scene), { name: "x" }, {}), undefined, "non-movement updates pass");
  assert.equal(guard(doc(scene), { x: 5 }, {}), false, "players cannot move nodes by default");
  settings.set("playersMoveNodes", true);
  assert.equal(guard(doc(scene), { x: 5 }, {}), undefined);
  settings.set("playersMoveNodes", false);

  game.user = gm;
  assert.equal(guard(doc(scene), { x: 5 }, {}), undefined, "the Storyteller may move nodes");
  scene.flags[MODULE_ID].config.lockLayout = true;
  assert.equal(guard(doc(scene), { y: 5 }, {}), false, "a locked layout refuses everyone");
  assert.equal(guard(doc(scene), { y: 5 }, { vrArrange: true }), undefined, "but Arrange still works");
});

await test("dropping a token on a map tidies it", () => {
  const scene = { flags: { [MODULE_ID]: { isMap: true } } };
  let patch = null;
  const token = { parent: scene, updateSource: (data) => { patch = data; } };
  hooks.get("preCreateToken")[0](token);
  assert.equal(patch.displayName, 0);
  assert.equal(patch.sight.enabled, false);
  assert.equal(patch.width, 1);
  patch = null;
  hooks.get("preCreateToken")[0]({ parent: { flags: {} }, updateSource: (data) => { patch = data; } });
  assert.equal(patch, null, "tokens on other scenes are untouched");
});

await test("every translation key used in code and templates exists", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(mjs|hbs)$/.test(entry)) files.push(full);
    }
  };
  walk(join(root, "scripts"));
  walk(join(root, "templates"));

  const missing = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // t("Section.Key") in scripts, "VR.Section.Key" anywhere (templates, option objects)
    for (const m of text.matchAll(/\bt\(\s*"([A-Za-z0-9.]+)"/g)) if (typeof lookup(`VR.${m[1]}`) !== "string") missing.add(`VR.${m[1]}`);
    for (const m of text.matchAll(/"(VR\.[A-Za-z0-9.]+)"/g)) if (typeof lookup(m[1]) !== "string") missing.add(m[1]);
  }
  assert.deepEqual([...missing], [], "missing translation keys");
});

await test("manifest lists files that exist", () => {
  const manifest = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
  const paths = [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map((l) => l.path)];
  for (const path of paths) assert.ok(statSync(join(root, path)).isFile(), path);
  assert.match(manifest.manifest, /releases\/latest\/download\/module\.json$/);
});

/* -------------------------------------------- */

for (const { name, error } of failures) {
  console.error(`✗ ${name}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}\n`);
}
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
