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

const {
  BOND_TYPES, CATEGORIES, DEFAULT_CONFIG, GROUP_COLORS, MODULE_ID, STATUSES, groupColors, hexToNumber, mixColors, statusDef
} = await import("../scripts/constants.mjs");
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

await test("every group gets a colour of its own, the same whoever asks", () => {
  const covenants = ["Invictus", "Lancea et Sanctum", "Circle of the Crone", "Carthian Movement", "Ordo Dracul"];
  const colors = groupColors(covenants);
  assert.equal(colors.size, 5);
  assert.equal(new Set(colors.values()).size, 5, "five covenants, five colours");
  for (const color of colors.values()) assert.ok(GROUP_COLORS.includes(color));

  // The answer hangs on the set of names, not on their order or on repeats.
  const shuffled = groupColors([...covenants].reverse().concat(covenants, ["", "  ", null, undefined]));
  assert.deepEqual([...shuffled].sort(), [...colors].sort());

  // Eight groups use all eight colours; a ninth has to share one.
  const eight = groupColors(Array.from({ length: 8 }, (_, i) => `Coterie ${i}`));
  assert.equal(new Set(eight.values()).size, 8);
  const twenty = groupColors(Array.from({ length: 20 }, (_, i) => `Coterie ${i}`));
  assert.equal(twenty.size, 20);
  assert.equal(new Set(twenty.values()).size, 8);

  assert.equal(new Set(GROUP_COLORS).size, GROUP_COLORS.length);
  assert.equal(groupColors([]).size, 0);
  assert.equal(mixColors(0x000000, 0xffffff, 0.5), 0x808080);
  assert.equal(mixColors(0x13a5bc, 0xf0eeea, 0), 0x13a5bc);
  assert.equal(mixColors(0x13a5bc, 0xf0eeea, 1), 0xf0eeea);
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
    auto: layout.autoLayout(nodes, edges, { spacing: 260 }),
    grouped: layout.autoLayout(nodes, edges, { spacing: 260, grouped: true }),
    cards: layout.autoLayout(nodes, edges, { spacing: 260, stretchX: 2 }),
    lineage: layout.lineageLayout(nodes, edges, { spacingX: 260, spacingY: 300 })
  };
  for (const [name, positions] of Object.entries(results)) {
    assert.equal(positions.size, nodes.length, `${name}: all nodes placed`);
    for (const p of positions.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${name}: finite`);
    assert.ok(minDistance(positions) > 120, `${name}: nodes too close (${minDistance(positions).toFixed(1)})`);
  }
  assert.ok(minDistance(results.auto) >= 259, "auto layout keeps everyone a full spacing apart");
  const again = layout.autoLayout(nodes, edges, { spacing: 260 });
  assert.deepEqual([...again.values()], [...results.auto.values()], "auto layout is deterministic");
});

await test("layouts cope with empty, single-node and untidy input", () => {
  assert.equal(layout.circleLayout([]).size, 0);
  assert.equal(layout.circleLayout([{ id: "solo" }]).size, 1);
  assert.equal(layout.autoLayout([], []).size, 0);
  assert.deepEqual(layout.autoLayout([{ id: "solo" }], []).get("solo"), { x: 0, y: 0 });
  assert.equal(layout.lineageLayout([{ id: "solo" }], []).size, 1);

  // Loops, doubled bonds and bonds to people who are not on the map are ignored.
  const pair = layout.autoLayout(
    [{ id: "a" }, { id: "b" }],
    [{ a: "a", b: "a" }, { a: "a", b: "ghost" }, { a: "a", b: "b" }, { a: "b", b: "a" }],
    { spacing: 200 }
  );
  assert.equal(pair.size, 2);
  const span = Math.hypot(pair.get("a").x - pair.get("b").x, pair.get("a").y - pair.get("b").y);
  assert.ok(Math.abs(span - 270) < 1, `two bound characters stand one bond apart (${span.toFixed(1)})`);

  // Nobody bound to anybody: a tidy block, not a pile.
  const strangers = layout.autoLayout(sampleNodes(7), [], { spacing: 200 });
  assert.equal(strangers.size, 7);
  assert.ok(minDistance(strangers) >= 199);
});

/** An invented court as layout input, grouped by a field of its characters. */
async function courtFor(size, groupBy) {
  const { makeCourt } = await import("./court.mjs");
  const court = makeCourt(size);
  return {
    nodes: court.cast.map((person) => ({ id: person.id, group: groupBy ? person[groupBy] : "" })),
    edges: court.bonds.map((bond) => ({ a: bond.a, b: bond.b }))
  };
}

function crossings(edges, pos) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let count = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [e, f] = [edges[i], edges[j]];
      if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
      const [p1, p2, p3, p4] = [pos.get(e.a), pos.get(e.b), pos.get(f.a), pos.get(f.b)];
      if (side(p3, p4, p1) * side(p3, p4, p2) < 0 && side(p1, p2, p3) * side(p1, p2, p4) < 0) count++;
    }
  }
  return count;
}

await test("auto layout keeps a court of sixty readable", async () => {
  const spacing = 260;
  const { nodes, edges } = await courtFor(60);
  const pos = layout.autoLayout(nodes, edges, { spacing });
  assert.equal(pos.size, 60);
  assert.ok(minDistance(pos) >= spacing - 1, `everyone a spacing apart (${minDistance(pos).toFixed(1)})`);

  // Nobody stands on a bond that is not theirs.
  for (const node of nodes) {
    const p = pos.get(node.id);
    for (const e of edges) {
      if (e.a === node.id || e.b === node.id) continue;
      const [a, b] = [pos.get(e.a), pos.get(e.b)];
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const along = Math.min(1, Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
      const gap = Math.hypot(p.x - (a.x + (b.x - a.x) * along), p.y - (a.y + (b.y - a.y) * along));
      assert.ok(gap > spacing * 0.3, `${node.id} stands on the bond ${e.a}-${e.b}`);
    }
  }

  // The unattached wait in rows beneath everyone who has a bond.
  const bound = new Set(edges.flatMap((e) => [e.a, e.b]));
  const loners = nodes.filter((node) => !bound.has(node.id));
  assert.ok(loners.length > 3);
  const floor = Math.max(...[...bound].map((id) => pos.get(id).y));
  for (const node of loners) assert.ok(pos.get(node.id).y > floor, `${node.id} waits below the web`);

  // And the web is all but untangled: a ring of the same court crosses hundreds of times.
  const ring = crossings(edges, layout.circleLayout(nodes, { spacing }));
  const auto = crossings(edges, pos);
  assert.ok(auto <= 8 && auto * 20 < ring, `too many crossed bonds (${auto}, against ${ring} on a ring)`);
});

await test("grouped auto layout gives every group ground of its own", async () => {
  const spacing = 260;
  for (const groupBy of ["covenant", "coterie"]) {
    const { nodes, edges } = await courtFor(90, groupBy);
    const pos = layout.autoLayout(nodes, edges, { spacing, grouped: true });
    assert.equal(pos.size, 90);
    assert.ok(minDistance(pos) >= spacing - 1, `${groupBy}: everyone a spacing apart`);

    const ground = new Map();
    for (const node of nodes) {
      if (!node.group) continue;
      const p = pos.get(node.id);
      const g = ground.get(node.group) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, size: 0 };
      g.x0 = Math.min(g.x0, p.x - spacing / 2);
      g.y0 = Math.min(g.y0, p.y - spacing / 2);
      g.x1 = Math.max(g.x1, p.x + spacing / 2);
      g.y1 = Math.max(g.y1, p.y + spacing / 2);
      g.size += 1;
      ground.set(node.group, g);
    }
    const shared = [...ground].filter(([, g]) => g.size > 1);
    assert.ok(shared.length >= 4, `${groupBy}: the court has groups to keep apart`);
    for (let i = 0; i < shared.length; i++) {
      for (let j = i + 1; j < shared.length; j++) {
        const [a, b] = [shared[i][1], shared[j][1]];
        const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
        assert.ok(apart, `${groupBy}: ${shared[i][0]} and ${shared[j][0]} overlap`);
      }
    }
    // Nobody stands on ground that is not their group's.
    for (const node of nodes) {
      const p = pos.get(node.id);
      for (const [name, g] of shared) {
        if (node.group === name) continue;
        const inside = p.x > g.x0 && p.x < g.x1 && p.y > g.y0 && p.y < g.y1;
        assert.ok(!inside, `${groupBy}: ${node.id} stands inside ${name}`);
      }
    }
  }
});

await test("newcomers are found room beside their ties, on top of nobody", () => {
  const room = { pitchX: 260, pitchY: 270 };
  const taken = [{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 0, y: 270 }];
  const crowds = (spot, list = taken) => list.some((p) => Math.abs(p.x - spot.x) < 250 && Math.abs(p.y - spot.y) < 260);

  // An empty spot is taken as it is.
  assert.deepEqual(layout.findRoom({ x: 1000, y: 1000 }, taken, room), { x: 1000, y: 1000 });
  // A taken one gives the nearest free place beside it.
  const beside = layout.findRoom({ x: 0, y: 0 }, taken, room);
  assert.ok(!crowds(beside));
  assert.ok(Math.hypot(beside.x, beside.y) <= 280, "right next door");
  // Several wanting the same place fill in around it without overlapping.
  const seated = [...taken];
  for (let i = 0; i < 12; i++) {
    const spot = layout.findRoom({ x: 0, y: 0 }, seated, room);
    assert.ok(!crowds(spot, seated), `newcomer ${i} crowds someone`);
    seated.push(spot);
  }
  // The scene's edge is respected, even when the wish lies far outside it.
  const bounds = { x: -400, y: -400, w: 800, h: 800 };
  const kept = layout.findRoom({ x: -5000, y: 90 }, taken, { ...room, bounds });
  assert.ok(kept.x >= -400 && kept.x <= 400 && kept.y >= -400 && kept.y <= 400);
  assert.ok(!crowds(kept));
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
  // The colour of a group is settled from the sheet itself, whoever is looking.
  assert.equal(system.groupOf(actor("prince"), "clan"), "Ventrue");
  assert.equal(system.groupOf(actor("sheriff"), "coterie"), "");
  assert.equal(system.groupOf(null, "covenant"), "");
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
