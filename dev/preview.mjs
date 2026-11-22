/**
 * Standalone preview of the map renderer with invented data.
 * Lets the drawing code be checked in a browser without launching Foundry.
 */
import { BOND_TYPES, FONT_STACKS, hexToNumber } from "../scripts/constants.mjs";
import { autoLayout, circleLayout, lineageLayout } from "../scripts/layout.mjs";
import { makeCourt } from "./court.mjs";
import { MapRenderer } from "../scripts/renderer.mjs";

const PIXI = globalThis.PIXI;
const log = (message) => { document.getElementById("log").textContent = message; };

const params = new URLSearchParams(location.search);
const state = {
  style: params.get("style") ?? "constellation",
  layout: params.get("layout") ?? "auto",
  labels: params.get("labels") !== "0",
  subtitles: params.get("subtitles") !== "0",
  patterned: params.get("patterned") === "1",
  groups: params.get("groups") ?? "none",
  focus: params.get("focus") ?? "",
  selected: params.get("selected") ?? ""
};

/* A small invented court. */
const cast = [
  { id: "vance", name: "Prince Vance", clan: "Ventrue", covenant: "Invictus", rank: "Prince", key: true, art: ["#3b0d0d", "#c5a059"] },
  { id: "mara", name: "Sheriff Mara", clan: "Gangrel", covenant: "Invictus", rank: "Sheriff", art: ["#1f2937", "#9ca3af"] },
  { id: "odile", name: "Odile Marchetti", clan: "Daeva", bloodline: "Toreador", covenant: "Invictus", rank: "Harpy", art: ["#4a044e", "#f472b6"], tall: true },
  { id: "benny", name: "Benny Ruiz", clan: "Ghoul", covenant: "", secret: "all", status: "away", art: null },
  { id: "silas", name: "Brother Silas", clan: "Nosferatu", covenant: "Lancea et Sanctum", rank: "Bishop", secret: "some", status: "missing", art: ["#1c1917", "#a8a29e"] },
  { id: "iris", name: "Iris Vey", clan: "Mekhet", bloodline: "Khaibit", covenant: "Ordo Dracul", coterie: "The After-Party", art: ["#0c4a6e", "#7dd3fc"], tall: true },
  { id: "cole", name: "Father Cole", clan: "Mortal", covenant: "", status: "dead", art: ["#292524", "#e7e5e4"] },
  { id: "rook", name: "Rook", clan: "Gangrel", covenant: "Carthian Movement", coterie: "The After-Party", status: "torpor", art: ["#14532d", "#86efac"] },
  { id: "halloran", name: "Aldous Halloran", clan: "Ventrue", covenant: "Invictus", rank: "Former Prince", status: "destroyed", art: ["#312e81", "#a5b4fc"] },
  { id: "wren", name: "Wren", clan: "Daeva", covenant: "Carthian Movement", coterie: "The After-Party", art: ["#7c2d12", "#fdba74"], tall: true }
];

/** What a character is grouped by, for outlines and the grouped layout. */
const groupOf = (person) => (state.groups === "clan" ? person.clan : state.groups === "coterie" ? person.coterie : person.covenant) ?? "";

/** The same lines the module builds from a character sheet. */
function detailLines(person) {
  const lines = [];
  if (person.rank) lines.push({ text: person.rank, tone: "gold", caps: true });
  const clan = person.bloodline ? `${person.clan} (${person.bloodline})` : person.clan;
  const nature = [clan, person.covenant].filter(Boolean).join(" · ");
  if (nature) lines.push({ text: nature, tone: "muted" });
  if (person.coterie) lines.push({ text: person.coterie, tone: "soft" });
  return lines;
}

const bonds = [
  { id: "b1", a: "halloran", b: "vance", type: "sire" },
  { id: "b2", a: "vance", b: "mara", type: "sire", secret: "all" },
  { id: "b3", a: "vance", b: "benny", type: "regnant", secret: "all" },
  { id: "b4", a: "vance", b: "odile", type: "ally", label: "Old debts", strength: 4 },
  { id: "b5", a: "odile", b: "silas", type: "rival" },
  { id: "b6", a: "silas", b: "cole", type: "touchstone", secret: "some" },
  { id: "b7", a: "iris", b: "silas", type: "mentor" },
  { id: "b8", a: "mara", b: "rook", type: "enemy", strength: 5, key: true },
  { id: "b9", a: "wren", b: "rook", type: "coterie" },
  { id: "b10", a: "wren", b: "odile", type: "lover", secret: "all" },
  { id: "b11", a: "odile", b: "wren", type: "boon", label: "Owes a favour" },
  { id: "b12", a: "iris", b: "vance", type: "distrust", strength: 2 },
  { id: "b13", a: "mara", b: "silas", type: "contact", strength: 1 }
];

// ?court=60 swaps the hand-written cast for an invented court of that size (&seed=3 for another).
const courtSize = Number(params.get("court")) || 0;
if (courtSize) {
  const court = makeCourt(courtSize, Number(params.get("seed")) || 7);
  cast.splice(0, cast.length, ...court.cast);
  bonds.splice(0, bonds.length, ...court.bonds);
}

// ?only=vance,odile limits the cast (handy for close-ups); ?max=3 raises the zoom cap.
const only = (params.get("only") ?? "").split(",").filter(Boolean);
if (only.length) {
  for (let i = cast.length - 1; i >= 0; i--) if (!only.includes(cast[i].id)) cast.splice(i, 1);
  for (let i = bonds.length - 1; i >= 0; i--) {
    if (!only.includes(bonds[i].a) || !only.includes(bonds[i].b)) bonds.splice(i, 1);
  }
}
const maxScale = Number(params.get("max")) || 1.5;

/** Paint a stand-in portrait so the preview needs no image files. */
function fakePortrait(person) {
  if (!person.art) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = person.tall ? 360 : 240;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, person.art[0]);
  gradient.addColorStop(1, "#050505");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = person.art[1];
  ctx.globalAlpha = 0.85;
  const headY = person.tall ? 110 : 96;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, headY, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, headY + 150, 86, 100, 0, 0, Math.PI * 2);
  ctx.fill();
  return PIXI.Texture.from(canvas);
}

async function main() {
  if (!PIXI) {
    log("PIXI did not load. Is FOUNDRY_APP pointing at your Foundry resources/app folder?");
    return;
  }
  await Promise.allSettled(
    [...FONT_STACKS.display, ...FONT_STACKS.mono].map((family) => document.fonts.load(`400 20px "${family}"`))
  );

  const app = new PIXI.Application({
    resizeTo: window,
    backgroundColor: 0x050505,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1
  });
  document.getElementById("stage").appendChild(app.view);
  const world = new PIXI.Container();
  app.stage.addChild(world);

  const renderer = new MapRenderer(PIXI);
  world.addChild(renderer.under, renderer.over);
  const textures = new Map(cast.map((person) => [person.id, fakePortrait(person)]));

  let hoverEdge = null;
  renderer.handlers.chipOver = (id) => { hoverEdge = id; draw(); };
  renderer.handlers.chipOut = () => { hoverEdge = null; draw(); };
  renderer.handlers.chipDown = (id) => log(`clicked bond ${id}`);

  function positions() {
    const cards = state.style === "cards";
    const nodes = cast.map((person) => ({ id: person.id, group: groupOf(person) }));
    const edges = bonds.map((bond) => ({ a: bond.a, b: bond.b, lineage: BOND_TYPES[bond.type].lineage }));
    const spacing = cards ? 300 : 270;
    if (state.layout === "circle") return circleLayout(nodes, { spacing });
    if (state.layout === "lineage") return lineageLayout(nodes, edges, { spacingX: cards ? 560 : 280, spacingY: 300 });
    return autoLayout(nodes, edges, {
      spacing,
      stretchX: cards ? 1.7 : 1,
      grouped: state.groups !== "none",
      bodyOffset: cards ? 0 : spacing * 0.12
    });
  }

  function draw() {
    const pos = positions();
    const size = 100;
    const nodes = cast.map((person) => {
      const p = pos.get(person.id);
      return {
        id: person.id,
        x: p.x - size / 2,
        y: p.y - size / 2,
        w: size,
        h: size,
        name: person.name,
        lines: detailLines(person),
        img: person.id,
        texture: textures.get(person.id),
        fit: "cover",
        status: person.status ?? "active",
        key: !!person.key,
        secret: person.secret ?? "none",
        selected: state.selected === person.id
      };
    });
    const edges = bonds.map((bond) => {
      const type = BOND_TYPES[bond.type];
      return {
        id: bond.id,
        a: bond.a,
        b: bond.b,
        color: hexToNumber(type.color),
        strength: bond.strength ?? 3,
        directed: type.directed,
        category: type.category,
        label: bond.label ?? type.short,
        secret: bond.secret ?? "none",
        key: !!bond.key
      };
    });

    let focus = null;
    const focusNode = state.focus || state.selected;
    if (hoverEdge) {
      const edge = edges.find((e) => e.id === hoverEdge);
      focus = { nodes: new Set([edge.a, edge.b]), edges: new Set([edge.id]) };
    } else if (focusNode) {
      const mine = edges.filter((e) => e.a === focusNode || e.b === focusNode);
      focus = { nodes: new Set([focusNode, ...mine.flatMap((e) => [e.a, e.b])]), edges: new Set(mine.map((e) => e.id)) };
    }

    let groups = [];
    if (state.groups !== "none") {
      const buckets = new Map();
      for (const person of cast) {
        // Characters with no covenant, clan or coterie get no outline.
        const key = groupOf(person);
        if (!key) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(person.id);
      }
      groups = [...buckets].map(([key, nodeIds]) => ({ key, label: key, nodeIds }));
    }

    renderer.render({
      style: state.style,
      unit: size,
      labels: state.labels,
      subtitles: state.subtitles,
      patterned: state.patterned,
      backdrop: true,
      bounds: { x: -2400, y: -1600, w: 4800, h: 3200 },
      nodes,
      edges,
      groups,
      focus,
      search: null
    });

    // Fit the picture to the window.
    const box = world.getLocalBounds();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const b = renderer.nodeBounds(node.id);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const margin = 110;
    const scale = Math.min(
      (app.screen.width - margin * 2) / (maxX - minX),
      (app.screen.height - margin * 2) / (maxY - minY),
      maxScale
    );
    world.scale.set(scale);
    world.position.set(
      app.screen.width / 2 - ((minX + maxX) / 2) * scale,
      app.screen.height / 2 + 14 - ((minY + maxY) / 2) * scale
    );
    void box;
  }

  const bar = document.getElementById("bar");
  const controls = [
    ["style", ["constellation", "cards"]],
    ["layout", ["auto", "circle", "lineage"]],
    ["groups", ["none", "covenant", "clan", "coterie"]],
    ["labels", [true, false]],
    ["patterned", [false, true]],
    ["selected", ["", "vance", "odile"]]
  ];
  function buildBar() {
    bar.replaceChildren();
    for (const [key, values] of controls) {
      const button = document.createElement("button");
      button.textContent = `${key}: ${state[key] === "" ? "-" : state[key]}`;
      button.classList.toggle("on", state[key] !== values[0]);
      button.addEventListener("click", () => {
        state[key] = values[(values.indexOf(state[key]) + 1) % values.length];
        buildBar();
        draw();
      });
      bar.appendChild(button);
    }
  }
  buildBar();
  draw();
  window.addEventListener("resize", draw);
  document.fonts.ready.then(() => renderer.invalidate());
  log("renderer preview ready");
  globalThis.__vr = { renderer, state, draw };
}

main().catch((error) => {
  console.error(error);
  log(`preview failed: ${error.message}`);
});
