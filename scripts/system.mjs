/**
 * System adapter: turns an Actor into the handful of facts the map shows.
 *
 * Written for the "vampire-the-requiem-2e" system, where a character keeps
 * clan / bloodline / covenant as free text and has `characterVariant`
 * (vampire | ghoul | mortal), `isDead` and `isTypeKnown`. Every read is
 * defensive so the module still behaves in other systems; it simply shows
 * less under each name.
 */
import { FLAG, MODULE_ID, OWNERSHIP, STATUSES } from "./constants.mjs";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function localizeIfKey(key, fallback) {
  return game.i18n.has(key) ? game.i18n.localize(key) : fallback;
}

function capitalize(text) {
  const s = String(text ?? "");
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * @returns {{kind: string, kindLabel: string, clan: string, bloodline: string,
 *            covenant: string, dead: boolean, typeKnown: boolean}}
 */
export function characterFacts(actor) {
  const system = actor?.system ?? {};
  let kind = actor?.type ?? "";
  if (kind === "character") kind = clean(system.characterVariant) || clean(system.characterType) || "mortal";

  const labels = { vampire: "MTA.Vampire", ghoul: "MTA.Ghoul", mortal: "MTA.Mortal" };
  let kindLabel;
  if (labels[kind]) kindLabel = localizeIfKey(labels[kind], capitalize(kind));
  else {
    const typeKey = CONFIG.Actor?.typeLabels?.[actor?.type];
    kindLabel = typeKey ? game.i18n.localize(typeKey) : capitalize(String(kind).replace(/_/g, " "));
  }

  return {
    kind,
    kindLabel,
    clan: clean(system.clan),
    bloodline: clean(system.bloodline),
    covenant: clean(system.covenant),
    dead: system.isDead === true,
    typeKnown: system.isTypeKnown === true
  };
}

/**
 * Does this user know what the character is?
 * Storytellers and anyone who can open the full sheet do; so does everyone
 * once the sheet's "type known" box is ticked.
 */
export function knowsNature(actor, user) {
  if (!actor || !user) return false;
  if (user.isGM) return true;
  if (actor.testUserPermission(user, OWNERSHIP.OBSERVER)) return true;
  return characterFacts(actor).typeKnown;
}

/** The line under a character's name, e.g. "Daeva · Invictus". */
export function subtitleFor(actor, user) {
  if (!actor || !knowsNature(actor, user)) return "";
  const facts = characterFacts(actor);
  const parts = [];
  if (facts.kind === "vampire") parts.push(facts.clan || facts.kindLabel);
  else parts.push(facts.kindLabel);
  if (facts.covenant) parts.push(facts.covenant);
  return parts.filter(Boolean).join(" · ");
}

/** Which outline a character belongs to when grouping by "covenant" or "clan". */
export function groupFor(actor, by, user) {
  if (!actor || !knowsNature(actor, user)) return "";
  const facts = characterFacts(actor);
  if (by === "covenant") return facts.covenant;
  if (by === "clan") return facts.kind === "vampire" ? facts.clan : facts.kindLabel;
  return "";
}

/** Narrative status: an explicit flag wins, otherwise the sheet's "dead" box. */
export function statusFor(actor) {
  const flagged = actor?.flags?.[MODULE_ID]?.[FLAG.STATUS];
  if (flagged && STATUSES[flagged]) return flagged;
  return characterFacts(actor).dead ? "dead" : "active";
}

export function isKeyPerson(actor) {
  return actor?.flags?.[MODULE_ID]?.[FLAG.KEY] === true;
}

/** Image shown for a character: the Actor portrait or the Token art. */
export function imageFor(tokenDocument, actor, source) {
  // A default "mystery man" counts as no image, so the other source can stand in.
  const usable = (src) => (src && !isPlaceholderImage(src) ? src : "");
  const tokenArt = usable(tokenDocument?.texture?.src);
  const portrait = usable(actor?.img);
  return source === "token" ? tokenArt || portrait : portrait || tokenArt;
}

export function isPlaceholderImage(src) {
  if (!src) return true;
  return src === CONST.DEFAULT_TOKEN || /icons\/svg\/mystery-man(-black)?\.svg$/.test(src);
}
