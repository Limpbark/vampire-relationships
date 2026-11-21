/**
 * Bond storage.
 *
 * A bond lives on the Actor it starts from, under
 *   actor.flags["vampire-relationships"].bonds[bondId]
 * so relationships belong to characters rather than to one particular scene:
 * put the same characters on a second map and their ties come with them.
 *
 * Record shape:
 *   { to, type, label, directed, strength, key, notes, gmNotes, color, ownership }
 */
import { BOND_TYPES, FLAG, MODULE_ID, OWNERSHIP } from "./constants.mjs";

let cache = null;

/** Throw the index away; it is rebuilt on next use. */
export function invalidateBonds() {
  cache = null;
}

export function normalizeBond(raw, fromId, id) {
  const type = BOND_TYPES[raw?.type] ? raw.type : "custom";
  const def = BOND_TYPES[type];
  const strength = Number(raw?.strength);
  const ownership = raw?.ownership && typeof raw.ownership === "object"
    ? { ...raw.ownership }
    : { default: OWNERSHIP.OBSERVER };
  return {
    id,
    from: fromId,
    to: String(raw?.to ?? ""),
    type,
    label: String(raw?.label ?? "").trim(),
    directed: typeof raw?.directed === "boolean" ? raw.directed : def.directed,
    strength: Number.isFinite(strength) ? Math.min(5, Math.max(1, Math.round(strength))) : 3,
    key: raw?.key === true,
    notes: String(raw?.notes ?? ""),
    gmNotes: String(raw?.gmNotes ?? ""),
    color: /^#[0-9a-f]{6}$/i.test(raw?.color ?? "") ? raw.color.toLowerCase() : "",
    ownership
  };
}

function build() {
  const byId = new Map();
  const byActor = new Map();
  const bucket = (actorId) => {
    if (!byActor.has(actorId)) byActor.set(actorId, { out: [], in: [] });
    return byActor.get(actorId);
  };
  for (const actor of game.actors) {
    const records = actor.flags?.[MODULE_ID]?.[FLAG.BONDS];
    if (!records || typeof records !== "object") continue;
    for (const [id, raw] of Object.entries(records)) {
      if (!raw || typeof raw !== "object") continue;
      const bond = normalizeBond(raw, actor.id, id);
      if (!bond.to || bond.to === actor.id || !game.actors.has(bond.to)) continue;
      byId.set(id, bond);
      bucket(actor.id).out.push(bond);
      bucket(bond.to).in.push(bond);
    }
  }
  cache = { byId, byActor };
  return cache;
}

function index() {
  return cache ?? build();
}

export function allBonds() {
  return [...index().byId.values()];
}

export function getBond(id) {
  return index().byId.get(id) ?? null;
}

/** Every bond touching an actor, as { out, in }. */
export function bondsOf(actorId) {
  return index().byActor.get(actorId) ?? { out: [], in: [] };
}

/**
 * Create or update a bond. Returns its id.
 * Moving a bond to a different "from" character re-homes the record.
 */
export async function saveBond(data) {
  const from = game.actors.get(data.from);
  const to = game.actors.get(data.to);
  if (!from || !to) throw new Error("Both ends of a bond must be existing Actors.");
  if (from.id === to.id) throw new Error("A character cannot be bound to themselves.");

  const id = data.id || foundry.utils.randomID();
  const previous = data.id ? getBond(data.id) : null;
  if (previous && previous.from !== from.id) await deleteBond(previous.id);

  const clean = normalizeBond({ ...data, to: to.id }, from.id, id);
  const record = {
    to: clean.to,
    type: clean.type,
    label: clean.label,
    directed: clean.directed,
    strength: clean.strength,
    key: clean.key,
    notes: clean.notes,
    gmNotes: clean.gmNotes,
    color: clean.color,
    ownership: clean.ownership
  };
  await from.update({ flags: { [MODULE_ID]: { [FLAG.BONDS]: { [id]: record } } } });
  invalidateBonds();
  return id;
}

/**
 * Remove one bond record from an Actor.
 * `unsetFlag` is the supported route. Foundry v14 replaced the old "-=key"
 * deletion syntax with operator objects, so if the record somehow survives,
 * the operator is applied directly as a second attempt.
 */
async function removeRecord(actor, id) {
  await actor.unsetFlag(MODULE_ID, `${FLAG.BONDS}.${id}`);
  const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
  if (ForcedDeletion && actor.flags?.[MODULE_ID]?.[FLAG.BONDS]?.[id] !== undefined) {
    await actor.update({ flags: { [MODULE_ID]: { [FLAG.BONDS]: { [id]: new ForcedDeletion() } } } });
  }
}

export async function deleteBond(id) {
  const bond = getBond(id);
  if (!bond) return false;
  const actor = game.actors.get(bond.from);
  if (!actor) return false;
  await removeRecord(actor, id);
  invalidateBonds();
  return true;
}

/** Remove bonds that point at an Actor which no longer exists. */
export async function pruneBondsTo(actorId) {
  for (const actor of game.actors) {
    const records = actor.flags?.[MODULE_ID]?.[FLAG.BONDS];
    if (!records) continue;
    for (const [id, raw] of Object.entries(records)) {
      if (raw?.to === actorId) await removeRecord(actor, id);
    }
  }
  invalidateBonds();
}

/**
 * The other end of a bond as seen from `actorId`, with the role each side plays.
 * @returns {{ otherId: string, outgoing: boolean }}
 */
export function perspective(bond, actorId) {
  const outgoing = bond.from === actorId;
  return { otherId: outgoing ? bond.to : bond.from, outgoing };
}
