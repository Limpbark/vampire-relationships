/**
 * Boots the real module inside the mini-Foundry stand-in with an invented court.
 *
 *   /dev/ui.html              as the Storyteller
 *   /dev/ui.html?user=ann     as a player
 *   /dev/ui.html?style=cards  start in Cards view
 */
import { installMiniFoundry, mountCanvas, Hooks } from "./mini-foundry.mjs";
import { forceLayout } from "../scripts/layout.mjs";

const MODULE_ID = "vampire-relationships";
const params = new URLSearchParams(location.search);
const note = document.getElementById("mf-note");

function portrait([from, tone], tall) {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = tall ? 360 : 240;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, "#050505");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = tone;
  ctx.globalAlpha = 0.85;
  const headY = tall ? 110 : 96;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, headY, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, headY + 150, 86, 100, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/png");
}

const kindred = (clan, covenant, extra = {}) => ({ characterVariant: "vampire", clan, covenant, ...extra });
const cast = [
  { id: "vance", name: "Prince Vance", ownership: { default: 1 }, system: kindred("Ventrue", "Invictus", { isTypeKnown: true, vamp_rank: "Prince" }), art: ["#3b0d0d", "#c5a059"], key: true },
  { id: "mara", name: "Sheriff Mara", ownership: { default: 1 }, system: kindred("Gangrel", "Invictus", { isTypeKnown: true, vamp_rank: "Sheriff" }), art: ["#1f2937", "#9ca3af"] },
  { id: "odile", name: "Odile Marchetti", ownership: { default: 1 }, system: kindred("Daeva", "Invictus", { bloodline: "Toreador", vamp_rank: "Harpy" }), art: ["#4a044e", "#f472b6"], tall: true },
  { id: "benny", name: "Benny Ruiz", ownership: { default: 0 }, system: { characterVariant: "ghoul" }, art: null },
  { id: "silas", name: "Brother Silas", ownership: { default: 0, ann: 1 }, system: kindred("Nosferatu", "Lancea et Sanctum", { vamp_rank: "Bishop" }), art: ["#1c1917", "#a8a29e"], status: "missing" },
  { id: "iris", name: "Iris Vey", ownership: { default: 1 }, system: kindred("Mekhet", "Ordo Dracul", { bloodline: "Khaibit", faction: "The After-Party", isTypeKnown: true }), art: ["#0c4a6e", "#7dd3fc"], tall: true },
  { id: "cole", name: "Father Cole", ownership: { default: 0 }, system: { characterVariant: "mortal", isDead: true }, art: ["#292524", "#e7e5e4"] },
  { id: "rook", name: "Rook", ownership: { default: 0, bob: 3 }, system: kindred("Gangrel", "Carthian Movement", { faction: "The After-Party" }), art: ["#14532d", "#86efac"], status: "torpor" },
  { id: "halloran", name: "Aldous Halloran", ownership: { default: 1 }, system: kindred("Ventrue", "Invictus", { isDead: true, isTypeKnown: true }), art: ["#312e81", "#a5b4fc"] },
  { id: "wren", name: "Wren", ownership: { default: 1, ann: 3 }, system: kindred("Daeva", "Carthian Movement", { isTypeKnown: true, faction: "The After-Party" }), art: ["#7c2d12", "#fdba74"], tall: true },
  // Not placed on the map: shows up in the Cast picker.
  { id: "lucien", name: "Lucien Draye", ownership: { default: 0 }, system: kindred("Mekhet", "Circle of the Crone"), art: ["#3f3f46", "#d4d4d8"], offMap: true },
  { id: "nell", name: "Nell", ownership: { default: 1 }, system: { characterVariant: "mortal" }, art: null, offMap: true }
];

const users = [
  { id: "gm", name: "Storyteller", isGM: true, color: { css: "#c5a059" } },
  { id: "ann", name: "Ann", isGM: false, color: { css: "#60a5fa" }, character: { name: "Wren" } },
  { id: "bob", name: "Bob", isGM: false, color: { css: "#86efac" }, character: { name: "Rook" } }
];

const everyone = { default: 2, ann: 2, bob: 2 };
const secret = { default: 0, ann: 0, bob: 0 };
const annOnly = { default: 0, ann: 2, bob: 0 };
const bondSeed = [
  ["halloran", "vance", "sire", everyone, {}],
  ["vance", "mara", "sire", secret, { gmNotes: "Mara does not know who truly made her." }],
  ["vance", "benny", "regnant", secret, {}],
  ["vance", "odile", "ally", everyone, { label: "Old debts", strength: 4, notes: "She kept his secret through the fire of '71." }],
  ["odile", "silas", "rival", everyone, {}],
  ["silas", "cole", "touchstone", annOnly, {}],
  ["iris", "silas", "mentor", everyone, {}],
  ["mara", "rook", "enemy", everyone, { strength: 5, key: true }],
  ["wren", "rook", "coterie", everyone, {}],
  ["wren", "odile", "lover", annOnly, {}],
  ["odile", "wren", "boon", everyone, { label: "Owes a favour" }],
  ["iris", "vance", "distrust", everyone, { strength: 2 }],
  ["mara", "silas", "contact", everyone, { strength: 1 }]
];

async function main() {
  if (!globalThis.PIXI || !globalThis.Handlebars) {
    note.textContent = "PIXI / Handlebars did not load. Point FOUNDRY_APP at your Foundry resources/app folder.";
    return;
  }
  const lang = await (await fetch("/lang/en.json")).json();
  const actors = cast.map((person) => ({
    id: person.id,
    name: person.name,
    ownership: person.ownership,
    system: person.system,
    img: person.art ? portrait(person.art, person.tall) : "icons/svg/mystery-man.svg",
    flags: { [MODULE_ID]: { bonds: {}, ...(person.key ? { key: true } : {}), ...(person.status ? { status: person.status } : {}) } }
  }));
  const kit = installMiniFoundry({ lang, users, actors, moduleId: MODULE_ID });
  if (params.get("user") && game.users.get(params.get("user"))) game.user = game.users.get(params.get("user"));

  bondSeed.forEach(([from, to, type, ownership, extra], i) => {
    game.actors.get(from).flags[MODULE_ID].bonds[`seed${i}`] = { to, type, ownership: { ...ownership }, ...extra };
  });

  const scene = new kit.Scene({
    id: "scene1",
    name: "Relationship Map",
    flags: { [MODULE_ID]: { isMap: true, config: { style: params.get("style") === "cards" ? "cards" : "constellation" } } }
  });
  const cards = params.get("style") === "cards";
  const placed = cast.filter((person) => !person.offMap);
  const positions = forceLayout(
    placed.map((person) => ({ id: person.id })),
    bondSeed.map(([a, b]) => ({ a, b })),
    { spacing: cards ? 250 : 270, stretchX: cards ? 2.1 : 1 }
  );
  for (const person of placed) {
    const p = positions.get(person.id);
    const actor = game.actors.get(person.id);
    scene.tokens.set(`t-${person.id}`, new kit.TokenDocument({
      id: `t-${person.id}`,
      actorId: person.id,
      name: person.name,
      x: Math.round(scene.width / 2 + p.x - 50),
      y: Math.round(scene.height / 2 + p.y - 50),
      texture: { src: actor.img }
    }, scene));
  }
  game.scenes.set(scene.id, scene);

  await import("../scripts/main.mjs");
  Hooks.callAll("init");
  mountCanvas(document.getElementById("board"), scene);
  Hooks.callAll("ready");
  game.modules.get(MODULE_ID).api.controller.fitView({ duration: 0 });

  note.innerHTML = `mini-Foundry preview &middot; signed in as <b>${game.user.name}</b> &middot; `
    + users.map((user) => `<a href="?user=${user.id}">${user.name}</a>`).join(" / ");
}

main().catch((error) => {
  console.error(error);
  note.textContent = `preview failed: ${error.message}`;
});
