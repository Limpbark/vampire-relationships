/**
 * Regenerates the BondType / Category / Status sections of lang/en.json from
 * scripts/constants.mjs, so the catalogue has a single source of truth.
 *
 *   node dev/sync-lang.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BOND_TYPES, CATEGORIES, STATUSES } from "../scripts/constants.mjs";

const file = new URL("../lang/en.json", import.meta.url);
const lang = JSON.parse(readFileSync(file, "utf8"));

lang.VR.Category = Object.fromEntries(Object.entries(CATEGORIES).map(([id, def]) => [id, def.label]));
lang.VR.Status = Object.fromEntries(Object.entries(STATUSES).map(([id, def]) => [id, def.label]));
lang.VR.BondType = Object.fromEntries(Object.entries(BOND_TYPES).map(([id, def]) => [id, {
  label: def.label,
  short: def.short,
  from: def.roles[0],
  to: def.roles[1]
}]));

writeFileSync(file, `${JSON.stringify(lang, null, 2)}\n`);
console.log(`lang/en.json: ${Object.keys(BOND_TYPES).length} bond types synced`);
