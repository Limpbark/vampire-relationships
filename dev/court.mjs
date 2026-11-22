/**
 * An invented court of any size, for trying layouts on more characters than
 * anyone wants to type in. Shaped like a real chronicle: covenants with a
 * leader and officers, sire lines, small coteries, ghouls and touchstones
 * hanging off their vampires, a scattering of rivalries and debts across the
 * city, and a number of characters nobody has tied to anything yet.
 *
 * Deterministic: the same size and seed always give the same court.
 * Not part of the released module.
 */

const FIRST = ["Ada", "Bram", "Celia", "Dorian", "Edith", "Felix", "Greta", "Hugo", "Isolde", "Jasper", "Katya", "Lucan",
  "Mina", "Nico", "Ophelia", "Piers", "Quinn", "Rosa", "Stellan", "Thea", "Ulric", "Vera", "Wolfe", "Xenia", "Yorick", "Zelda"];
const LAST = ["Ashdown", "Blackwood", "Crane", "Devereux", "Eastman", "Fairfax", "Graves", "Holloway", "Ironside", "Jarrow",
  "Kessler", "Lachance", "Morrow", "Nightingale", "Orlov", "Pryce", "Quill", "Ravenscroft", "Sorrel", "Thorne", "Underhill",
  "Vance", "Whitlock", "Yarrow"];
const CLANS = ["Daeva", "Gangrel", "Mekhet", "Nosferatu", "Ventrue"];
const COVENANTS = [
  { name: "Invictus", ranks: ["Prince", "Seneschal", "Sheriff", "Harpy", "Herald"] },
  { name: "Carthian Movement", ranks: ["Prefect", "Myrmidon"] },
  { name: "Lancea et Sanctum", ranks: ["Bishop", "Inquisitor", "Priest"] },
  { name: "Ordo Dracul", ranks: ["Kogaion", "Sworn of the Axe"] },
  { name: "Circle of the Crone", ranks: ["Hierophant", "Haruspex"] }
];
const COTERIES = ["The After-Party", "The Hounds", "Saint Jude's", "The Ledger", "Low Tide", "The Understudies",
  "Ash Wednesday", "The Night Shift", "Glasshouse", "The Long Table"];
const CROSS = ["rival", "lover", "boon", "enemy", "contact", "distrust", "ally"];
const ART = [["#3b0d0d", "#c5a059"], ["#1f2937", "#9ca3af"], ["#4a044e", "#f472b6"], ["#1c1917", "#a8a29e"],
  ["#0c4a6e", "#7dd3fc"], ["#14532d", "#86efac"], ["#312e81", "#a5b4fc"], ["#7c2d12", "#fdba74"]];

/** A small seeded random number generator (mulberry32). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} size   How many characters.
 * @param {number} [seed]
 * @returns {{ cast: object[], bonds: object[] }}
 *   cast:  [{ id, name, clan, covenant, coterie, rank, art }]
 *   bonds: [{ id, a, b, type }]
 */
export function makeCourt(size, seed = 7) {
  const random = seeded(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const cast = Array.from({ length: size }, (_, i) => ({
    id: `c${i}`,
    name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]}`,
    clan: CLANS[Math.floor(random() * CLANS.length)],
    covenant: "",
    coterie: "",
    rank: "",
    art: ART[i % ART.length]
  }));
  const bonds = [];
  const tied = new Set();
  const bind = (a, b, type) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (tied.has(key)) return;
    tied.add(key);
    bonds.push({ id: `b${bonds.length}`, a: cast[a].id, b: cast[b].id, type });
  };

  // Who is who: roughly one in seven is unattached, one in six of the rest is
  // a mortal in some vampire's orbit, and the others are Kindred of a covenant.
  const loners = Math.round(size * 0.15);
  const mortals = Math.round((size - loners) * 0.16);
  const kindred = Array.from({ length: size - loners - mortals }, (_, i) => i);
  const firstMortal = kindred.length;

  const leaders = [];
  let coterie = 0;
  const share = Math.max(3, Math.ceil(kindred.length / COVENANTS.length));
  COVENANTS.forEach((covenant, c) => {
    const members = kindred.slice(c * share, (c + 1) * share);
    if (!members.length) return;
    members.forEach((m, i) => {
      cast[m].covenant = covenant.name;
      cast[m].rank = covenant.ranks[i] ?? "";
    });
    leaders.push(members[0]);
    // Officers answer to the leader.
    for (let i = 1; i < Math.min(members.length, covenant.ranks.length); i++) bind(members[0], members[i], "ally");
    // Sire lines run down the covenant.
    for (let i = covenant.ranks.length; i < members.length; i++) {
      if (random() < 0.6) {
        const sire = members[Math.floor(random() * i)];
        bind(sire, members[i], "sire");
        cast[members[i]].clan = cast[sire].clan;
      }
    }
    // The young gather in coteries of three or four.
    for (let i = covenant.ranks.length; i + 2 < members.length; i += 5) {
      const group = members.slice(i, i + 3 + (random() < 0.4 ? 1 : 0));
      const name = COTERIES[coterie++ % COTERIES.length];
      for (let x = 0; x < group.length; x++) {
        cast[group[x]].coterie = name;
        for (let y = x + 1; y < group.length; y++) bind(group[x], group[y], "coterie");
      }
    }
  });
  // The leaders watch one another.
  for (let i = 0; i < leaders.length; i++) bind(leaders[i], leaders[(i + 1) % leaders.length], i % 2 ? "rival" : "distrust");
  // Rivalries, affairs and debts across the city.
  for (let i = Math.round(kindred.length * 0.3); i > 0; i--) bind(pick(kindred), pick(kindred), pick(CROSS));
  // Ghouls and touchstones belong to one vampire each.
  for (let m = firstMortal; m < firstMortal + mortals; m++) {
    const ghoul = random() < 0.6;
    cast[m].clan = ghoul ? "Ghoul" : "Mortal";
    if (ghoul) bind(pick(kindred), m, "regnant");
    else bind(pick(kindred), m, "touchstone");
  }
  // No vampire of the court is left out of it altogether.
  const used = new Set(bonds.flatMap((bond) => [bond.a, bond.b]));
  for (const k of kindred) if (!used.has(cast[k].id)) bind(k, pick(kindred), "contact");
  // The unattached are a mix of mortals and unaligned Kindred.
  for (let i = firstMortal + mortals; i < size; i++) cast[i].clan = random() < 0.5 ? "Mortal" : cast[i].clan;
  return { cast, bonds };
}
