/**
 * Localisation helpers. Bond types fall back to the English text in
 * constants.mjs when a translation key is missing.
 */
import { BOND_TYPES, CATEGORIES, STATUSES } from "./constants.mjs";

/** Localise `VR.<key>`, formatting with `data` when given. */
export function t(key, data) {
  const full = `VR.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

function pick(key, fallback) {
  return game.i18n.has(key) ? game.i18n.localize(key) : fallback;
}

/** field: "label" | "short" | "from" | "to" */
export function bondText(typeId, field) {
  const def = BOND_TYPES[typeId] ?? BOND_TYPES.custom;
  const fallback = field === "from" ? def.roles[0] : field === "to" ? def.roles[1] : def[field];
  return pick(`VR.BondType.${typeId}.${field}`, fallback ?? "");
}

export function categoryText(id) {
  return pick(`VR.Category.${id}`, CATEGORIES[id]?.label ?? id);
}

export function statusText(id) {
  return pick(`VR.Status.${id}`, STATUSES[id]?.label ?? id);
}
