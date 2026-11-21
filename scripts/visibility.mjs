/**
 * Who sees what.
 *
 * Characters: a user sees a character on the map when they hold at least the
 * configured ownership level (Limited by default) on its Actor. This is
 * Foundry's own ownership, set through the usual "Configure Ownership" dialog.
 *
 * Bonds: each bond carries an ownership object of the same shape Foundry uses
 * ({ default, [userId]: level }). A user sees a bond when that grants them
 * Limited or better AND they can see the characters at both ends.
 *
 * Storytellers see everything. They can also preview the map through a
 * player's eyes ("view as"), which swaps the viewer used by every test here.
 */
import { MODULE_ID, OWNERSHIP } from "./constants.mjs";

let viewAsId = null;

export function setViewAs(userId) {
  viewAsId = userId && game.users.get(userId) && game.user.isGM ? userId : null;
}

export function getViewAs() {
  return viewAsId ? game.users.get(viewAsId) ?? null : null;
}

/** The user whose eyes the map is drawn through. */
export function viewer() {
  return getViewAs() ?? game.user;
}

export function players() {
  return game.users.filter((user) => !user.isGM);
}

export function minCharacterLevel() {
  const level = Number(game.settings.get(MODULE_ID, "minCharacterLevel"));
  return Number.isFinite(level) && level >= OWNERSHIP.LIMITED ? level : OWNERSHIP.LIMITED;
}

/** The world Actor behind a token (unlinked tokens answer to their base Actor's ownership). */
export function baseActor(tokenDocument) {
  return game.actors.get(tokenDocument?.actorId) ?? tokenDocument?.actor ?? null;
}

/**
 * The Actor whose sheet opens from a token: the world Actor for a linked
 * token, the token's own copy for an unlinked one. A character's sheet facts
 * (clan, rank, coterie, the "dead" box ...) are read from here, so the map
 * always agrees with the sheet the token opens. Identity, ownership and bonds
 * stay with the world Actor: see baseActor().
 */
export function sheetActor(tokenDocument) {
  return tokenDocument?.actor ?? baseActor(tokenDocument);
}

export function canSeeActor(actor, user = viewer()) {
  if (!user) return false;
  if (user.isGM) return true;
  if (!actor) return false;
  return actor.testUserPermission(user, minCharacterLevel());
}

export function canSeeToken(tokenDocument, user = viewer()) {
  if (!user) return false;
  if (user.isGM) return true;
  if (!tokenDocument || tokenDocument.hidden) return false;
  return canSeeActor(baseActor(tokenDocument), user);
}

export function bondLevel(bond, user) {
  const ownership = bond?.ownership ?? {};
  return ownership[user.id] ?? ownership.default ?? OWNERSHIP.NONE;
}

/** The bond's own audience, ignoring whether its ends are visible. */
export function bondAllows(bond, user = viewer()) {
  if (!user) return false;
  if (user.isGM) return true;
  return bondLevel(bond, user) >= OWNERSHIP.LIMITED;
}

/** Full test: the bond's audience and both characters. */
export function canSeeBond(bond, user = viewer()) {
  if (!user) return false;
  if (user.isGM) return true;
  if (!bondAllows(bond, user)) return false;
  return canSeeActor(game.actors.get(bond.from), user) && canSeeActor(game.actors.get(bond.to), user);
}

/**
 * How secret something is among the players: "none" (every player sees it),
 * "some" or "all" (no player sees it). With no player accounts yet, the
 * answer comes from `fallback`, which should test the default ownership.
 */
export function secrecy(test, fallback) {
  const list = players();
  if (!list.length) return fallback() ? "none" : "all";
  const seen = list.filter(test).length;
  if (seen === list.length) return "none";
  return seen === 0 ? "all" : "some";
}

export function actorSecrecy(actor, tokenDocument = null) {
  if (tokenDocument?.hidden) return "all";
  if (!actor) return "all";
  return secrecy(
    (user) => canSeeActor(actor, user),
    () => (actor.ownership?.default ?? OWNERSHIP.NONE) >= minCharacterLevel()
  );
}

export function bondSecrecy(bond) {
  return secrecy(
    (user) => canSeeBond(bond, user),
    () => (bond.ownership?.default ?? OWNERSHIP.NONE) >= OWNERSHIP.LIMITED
  );
}

/** The players who can see an actor, for "Visible to ..." captions. */
export function actorAudience(actor) {
  return players().filter((user) => canSeeActor(actor, user));
}

/* -------------------------------------------- */
/*  Bond ownership <-> the editor's three modes */
/* -------------------------------------------- */

/**
 * Build a bond ownership object.
 * Every current player gets an explicit entry so that saving over an older
 * record can never leave a stale per-user grant behind.
 * @param {"everyone"|"gm"|"specific"} mode
 * @param {string[]} chosen   user ids, for "specific"
 */
export function buildOwnership(mode, chosen = []) {
  const everyone = mode === "everyone";
  const out = { default: everyone ? OWNERSHIP.OBSERVER : OWNERSHIP.NONE };
  for (const user of players()) {
    const allowed = everyone || (mode === "specific" && chosen.includes(user.id));
    out[user.id] = allowed ? OWNERSHIP.OBSERVER : OWNERSHIP.NONE;
  }
  return out;
}

/** The inverse of buildOwnership. */
export function readOwnership(ownership) {
  const data = ownership ?? {};
  const base = data.default ?? OWNERSHIP.NONE;
  const list = players();
  const allowed = list.filter((user) => (data[user.id] ?? base) >= OWNERSHIP.LIMITED);
  if (base >= OWNERSHIP.LIMITED && allowed.length === list.length) return { mode: "everyone", users: [] };
  if (base < OWNERSHIP.LIMITED && !allowed.length) return { mode: "gm", users: [] };
  return { mode: "specific", users: allowed.map((user) => user.id) };
}

export function defaultBondOwnership() {
  const mode = game.settings.get(MODULE_ID, "defaultBondVisibility") === "gm" ? "gm" : "everyone";
  return buildOwnership(mode);
}
