/**
 * Dossier — the panel beside the map that lays out one character's ties.
 *
 * Everyone can open it; what it lists is filtered by the same ownership rules
 * as the map. Storytellers also get quick controls for who can see the
 * character, their status, and their bonds.
 */
import { BOND_TYPES, CATEGORIES, FLAG, MODULE_ID, OWNERSHIP, STATUSES, statusDef } from "../constants.mjs";
import { bondsOf, perspective } from "../bonds.mjs";
import { controller } from "../controller.mjs";
import { bondText, categoryText, statusText, t } from "../i18n.mjs";
import { detailsFor, isKeyPerson, isPlaceholderImage, setStatus, statusFor, subtitleFor } from "../system.mjs";
import {
  actorAudience,
  actorSecrecy,
  bondSecrecy,
  canSeeActor,
  canSeeBond,
  minCharacterLevel,
  viewer
} from "../visibility.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export class Dossier extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vr-dossier",
    classes: ["vr-app", "vr-dossier", "themed", "theme-dark"],
    window: { title: "VR.Dossier.Title", icon: "fa-solid fa-address-book", resizable: true, minimizable: true },
    position: { width: 330, height: 560, top: 96, left: 150 },
    actions: {
      newBond: Dossier.#onNewBond,
      editBond: Dossier.#onEditBond,
      visit: Dossier.#onVisit,
      openSheet: Dossier.#onOpenSheet,
      toggleKey: Dossier.#onToggleKey,
      setStatus: Dossier.#onSetStatus,
      reveal: Dossier.#onReveal,
      conceal: Dossier.#onConceal,
      ownership: Dossier.#onOwnership,
      addToMap: Dossier.#onAddToMap
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/dossier.hbs`, scrollable: [".vr-dossier-scroll"] }
  };

  constructor(options = {}) {
    super(options);
    this.actorId = null;
    /** Callbacks supplied by the module entry point. */
    this.hooks = options.hooks ?? {};
  }

  get actor() {
    return game.actors.get(this.actorId) ?? null;
  }

  get title() {
    return this.actor?.name ?? t("Dossier.Title");
  }

  /** Show the dossier for an Actor (or refresh it if already showing). */
  show(actorId) {
    if (!actorId || !game.actors.has(actorId)) return this;
    this.actorId = actorId;
    this.render({ force: true });
    return this;
  }

  /** Re-render only when the dossier is on screen. */
  refresh() {
    if (!this.rendered) return;
    if (!this.actor || !canSeeActor(this.actor)) {
      this.close();
      return;
    }
    this.render();
  }

  async _prepareContext() {
    const actor = this.actor;
    const user = viewer();
    const editing = controller.editing;
    if (!actor) return { missing: true };

    const picture = (a) => (isPlaceholderImage(a?.img) ? "" : a.img);
    const { out, in: incoming } = bondsOf(actor.id);
    const ties = [];
    for (const bond of [...out, ...incoming]) {
      if (!canSeeBond(bond, user)) continue;
      const { otherId, outgoing } = perspective(bond, actor.id);
      const other = game.actors.get(otherId);
      if (!other) continue;
      const def = BOND_TYPES[bond.type] ?? BOND_TYPES.custom;
      // The role describes what the OTHER person is to this character.
      const role = bondText(bond.type, outgoing ? "to" : "from") || bondText(bond.type, "label");
      const secret = editing ? bondSecrecy(bond) : "none";
      const onMap = !!controller.tokenForActor(otherId);
      const otherStatus = statusFor(other);
      ties.push({
        bondId: bond.id,
        category: def.category,
        otherId,
        otherName: other.name,
        otherImg: picture(other),
        otherInitials: initials(other.name),
        otherSubtitle: subtitleFor(other, user),
        otherStatus: otherStatus === "active" ? "" : statusText(otherStatus),
        otherStatusColor: statusDef(otherStatus).color,
        otherGone: statusDef(otherStatus).gone,
        onMap,
        canEdit: editing,
        canAdd: editing && controller.active && !onMap,
        role,
        label: bond.label,
        color: bond.color || def.color,
        directed: bond.directed,
        arrow: bond.directed ? (outgoing ? "fa-arrow-right" : "fa-arrow-left") : "",
        key: bond.key,
        secretAll: secret === "all",
        secretSome: secret === "some",
        notes: bond.notes,
        gmNotes: editing ? bond.gmNotes : "",
        pips: [1, 2, 3, 4, 5].map((n) => ({ on: n <= bond.strength })),
        type: bond.type
      });
    }
    ties.sort((a, b) => Number(b.key) - Number(a.key) || a.otherName.localeCompare(b.otherName));

    const groups = Object.keys(CATEGORIES)
      .map((id) => ({
        id,
        label: categoryText(id),
        color: CATEGORIES[id].color,
        ties: ties.filter((tie) => tie.category === id)
      }))
      .filter((group) => group.ties.length);
    const counts = Object.keys(CATEGORIES).map((id) => ({
      label: categoryText(id),
      color: CATEGORIES[id].color,
      count: ties.filter((tie) => tie.category === id).length
    })).filter((entry) => entry.count);

    const sires = ties.filter((tie) => tie.type === "sire" && incoming.some((b) => b.id === tie.bondId));
    const childer = ties.filter((tie) => tie.type === "sire" && out.some((b) => b.id === tie.bondId));

    // Storyteller-only: who can currently see this character.
    let audience = null;
    if (editing) {
      const secret = actorSecrecy(actor);
      const names = actorAudience(actor).map((u) => u.name);
      audience = {
        hidden: secret === "all",
        partial: secret === "some",
        open: secret === "none",
        caption: secret === "all"
          ? t("Dossier.HiddenFromPlayers")
          : secret === "none"
            ? t("Dossier.VisibleToAll")
            : t("Dossier.VisibleTo", { names: names.join(", ") })
      };
    }

    const status = statusFor(actor);
    const details = detailsFor(actor, user);
    return {
      editing,
      actorId: actor.id,
      name: actor.name,
      img: picture(actor),
      initials: initials(actor.name),
      nature: details.nature,
      rank: details.rank,
      coterie: details.coterie,
      onMap: !!controller.tokenForActor(actor.id),
      mapActive: controller.active,
      key: isKeyPerson(actor),
      status,
      statusLabel: status === "active" ? "" : statusText(status),
      statusColor: statusDef(status).color,
      statusGlyph: statusDef(status).glyph,
      art: statusDef(status).art ?? "",
      statuses: Object.entries(STATUSES).map(([id, def]) => ({
        id,
        label: statusText(id),
        glyph: def.glyph,
        color: def.color || "#86efac",
        selected: id === status
      })),
      audience,
      counts,
      groups,
      total: ties.length,
      hasTies: ties.length > 0,
      lineage: {
        show: sires.length > 0 || childer.length > 0,
        sires,
        childer,
        unknownSire: !sires.length
      }
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onNewBond() {
    this.hooks.newBond?.({ from: this.actorId });
  }

  static #onEditBond(event, target) {
    if (!controller.editing) return;
    this.hooks.editBond?.(target.closest("[data-bond-id]")?.dataset.bondId);
  }

  /** Jump to the other end of a tie, or open their dossier if they are not on this map. */
  static #onVisit(event, target) {
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!actorId) return;
    const token = controller.tokenForActor(actorId);
    if (token) controller.focusToken(token.document.id);
    this.show(actorId);
  }

  static #onOpenSheet() {
    this.actor?.sheet?.render(true);
  }

  static async #onToggleKey() {
    const actor = this.actor;
    if (!actor || !controller.editing) return;
    await actor.setFlag(MODULE_ID, FLAG.KEY, !isKeyPerson(actor));
  }

  /** Flag the character as active, in torpor, missing, dead and so on. */
  static async #onSetStatus(event, target) {
    const actor = this.actor;
    const status = target.closest("[data-status]")?.dataset.status;
    if (!actor || !controller.editing) return;
    await setStatus(actor, status);
  }

  /** Let every player see this character: raise the default ownership to the map's threshold. */
  static async #onReveal() {
    const actor = this.actor;
    if (!actor || !controller.editing) return;
    const level = Math.max(actor.ownership?.default ?? OWNERSHIP.NONE, minCharacterLevel());
    const update = { "ownership.default": level };
    // Explicit per-player entries below the threshold would still hide the character.
    for (const [userId, value] of Object.entries(actor.ownership ?? {})) {
      if (userId === "default") continue;
      const user = game.users.get(userId);
      if (user && !user.isGM && value < level) update[`ownership.${userId}`] = level;
    }
    await actor.update(update);
  }

  /** Hide this character from players who are not its owners. */
  static async #onConceal() {
    const actor = this.actor;
    if (!actor || !controller.editing) return;
    const update = { "ownership.default": OWNERSHIP.NONE };
    for (const [userId, value] of Object.entries(actor.ownership ?? {})) {
      if (userId === "default") continue;
      const user = game.users.get(userId);
      // Owners keep their character; lesser grants are withdrawn.
      if (user && !user.isGM && value > OWNERSHIP.NONE && value < OWNERSHIP.OWNER) {
        update[`ownership.${userId}`] = OWNERSHIP.NONE;
      }
    }
    await actor.update(update);
  }

  /** Foundry's own ownership dialog, for anything finer than all-or-nothing. */
  static #onOwnership() {
    const actor = this.actor;
    if (!actor || !game.user.isGM) return;
    new foundry.applications.apps.DocumentOwnershipConfig({ document: actor }).render({ force: true });
  }

  static async #onAddToMap(event, target) {
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId ?? this.actorId;
    if (!actorId || !controller.editing) return;
    await controller.addActors([actorId]);
  }
}
