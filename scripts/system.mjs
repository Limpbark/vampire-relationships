/**
 * System adapter: turns an Actor into the handful of facts the map shows.
 *
 * Written for the "vampire-the-requiem-2e" system, where a character keeps
 * clan / bloodline / covenant as free text, a vampire's rank in `vamp_rank`,
 * the coterie in `faction` (the sheet labels that box "Coterie"), and has
 * `characterVariant` (vampire | ghoul | mortal), `isDead` and `isTypeKnown`.
 * Every read is defensive so the module still behaves in other systems; it
 * simply shows less under each name.
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
 *            covenant: string, rank: string, coterie: string,
 *            dead: boolean, typeKnown: boolean}}
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
    rank: clean(system.vamp_rank),
    coterie: clean(system.faction),
    dead: system.isDead === true,
    typeKnown: system.isTypeKnown === true
  };
}

/** "Mekhet (Khaibit) · Ordo Dracul": what the character is and where they stand. */
function natureText(facts, { bloodline = true } = {}) {
  const parts = [];
  if (facts.kind === "vampire") {
    const line = bloodline ? facts.bloodline : "";
    if (facts.clan) parts.push(line ? `${facts.clan} (${line})` : facts.clan);
    else parts.push(line || facts.kindLabel);
  } else parts.push(facts.kindLabel);
  if (facts.covenant) parts.push(facts.covenant);
  return parts.filter(Boolean).join(" · ");
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

/** A one-line summary for lists and pickers, e.g. "Daeva · Invictus". */
export function subtitleFor(actor, user) {
  if (!actor || !knowsNature(actor, user)) return "";
  return natureText(characterFacts(actor), { bloodline: false });
}

/**
 * What a user may know about a character, each part "" when unknown or
 * switched off: rank, nature ("Mekhet (Khaibit) · Ordo Dracul") and coterie.
 * @param {object} [show]  the map configuration's showRank / showBloodline / showCoterie switches
 * @returns {{rank: string, nature: string, coterie: string}}
 */
export function detailsFor(actor, user, show = {}) {
  if (!actor || !knowsNature(actor, user)) return { rank: "", nature: "", coterie: "" };
  const facts = characterFacts(actor);
  return {
    rank: show.showRank !== false ? facts.rank : "",
    nature: natureText(facts, { bloodline: show.showBloodline !== false }),
    coterie: show.showCoterie !== false ? facts.coterie : ""
  };
}

/**
 * The lines printed under a character's name, top to bottom: rank, then clan
 * (bloodline) and covenant, then coterie. Empty when the user does not know
 * what the character is.
 * @param {object} [show]  the map configuration's showRank / showBloodline / showCoterie switches
 * @returns {{text: string, tone: "gold"|"muted"|"soft", caps?: boolean}[]}
 */
export function detailLines(actor, user, show = {}) {
  const details = detailsFor(actor, user, show);
  const lines = [];
  if (details.rank) lines.push({ text: details.rank, tone: "gold", caps: true });
  if (details.nature) lines.push({ text: details.nature, tone: "muted" });
  if (details.coterie) lines.push({ text: details.coterie, tone: "soft" });
  return lines;
}

/**
 * The covenant, clan or coterie on a character's sheet, whoever is looking.
 * Used to settle the colour of each group once for the whole table; what a
 * viewer is shown goes through groupFor.
 */
export function groupOf(actor, by) {
  if (!actor) return "";
  const facts = characterFacts(actor);
  if (by === "covenant") return facts.covenant ?? "";
  if (by === "clan") return (facts.kind === "vampire" ? facts.clan : facts.kindLabel) ?? "";
  if (by === "coterie") return facts.coterie ?? "";
  return "";
}

/** Which outline a character belongs to when grouping by "covenant", "clan" or "coterie". */
export function groupFor(actor, by, user) {
  if (!actor || !knowsNature(actor, user)) return "";
  return groupOf(actor, by);
}

/**
 * Narrative status: an explicit flag wins, otherwise the sheet's "dead" box.
 * The system ticks that box when a vampire meets Final Death, so for Kindred
 * it reads as "destroyed" and for everyone else as "dead".
 */
export function statusFor(actor) {
  const flagged = actor?.flags?.[MODULE_ID]?.[FLAG.STATUS];
  if (flagged && STATUSES[flagged]) return flagged;
  const facts = characterFacts(actor);
  if (!facts.dead) return "active";
  return facts.kind === "vampire" ? "destroyed" : "dead";
}

/**
 * Flag a character's narrative status. "active" is stored like any other, so
 * it can overrule a ticked "dead" box on the sheet.
 */
export async function setStatus(actor, status) {
  if (!actor || !STATUSES[status]) return false;
  await actor.setFlag(MODULE_ID, FLAG.STATUS, status);
  return true;
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
