/**
 * BondEditor — create or edit one bond.
 *
 * Mirrors the flow of the app that inspired it: who and whom, the nature of
 * the bond, who may see it, and notes for the table or for the Storyteller alone.
 */
import { BOND_TYPES, CATEGORIES, DEFAULT_BOND_TYPE, MODULE_ID } from "../constants.mjs";
import { deleteBond, getBond, saveBond } from "../bonds.mjs";
import { controller } from "../controller.mjs";
import { bondText, categoryText, t } from "../i18n.mjs";
import { subtitleFor } from "../system.mjs";
import { buildOwnership, defaultBondOwnership, players, readOwnership } from "../visibility.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

let current = null;
let lastType = DEFAULT_BOND_TYPE;

export class BondEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vr-bond-editor",
    tag: "form",
    classes: ["vr-app", "vr-bond-editor", "themed", "theme-dark"],
    window: { title: "VR.Bond.New", icon: "fa-solid fa-link", resizable: false },
    position: { width: 470, height: "auto" },
    form: { handler: BondEditor.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      swap: BondEditor.#onSwap,
      remove: BondEditor.#onRemove,
      cancel: BondEditor.#onCancel
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/bond-editor.hbs` }
  };

  /**
   * @param {object} [options]
   * @param {string} [options.bondId]  edit this bond; omit to create one
   * @param {string} [options.from]    Actor id to start from
   * @param {string} [options.to]      Actor id to end at
   */
  constructor(options = {}) {
    super(options);
    this.bondId = options.bondId ?? null;
    this.initial = { from: options.from ?? "", to: options.to ?? "" };
  }

  get title() {
    const bond = this.bondId ? getBond(this.bondId) : null;
    if (!bond) return t("Bond.New");
    return t("Bond.Edit", { name: bond.label || bondText(bond.type, "label") });
  }

  async _prepareContext() {
    const bond = this.bondId ? getBond(this.bondId) : null;
    const type = bond?.type ?? lastType;
    const def = BOND_TYPES[type] ?? BOND_TYPES.custom;
    const state = bond ?? {
      from: this.initial.from,
      to: this.initial.to,
      type,
      label: "",
      directed: def.directed,
      strength: 3,
      key: false,
      notes: "",
      gmNotes: "",
      color: "",
      ownership: defaultBondOwnership()
    };

    // Characters already on this map are offered first.
    const onMap = new Set();
    if (controller.active) {
      for (const token of canvas.tokens.placeables) if (token.document.actorId) onMap.add(token.document.actorId);
    }
    const actors = [...game.actors].sort((a, b) => a.name.localeCompare(b.name));
    const listFor = (selectedId) => {
      const entry = (actor) => ({
        id: actor.id,
        name: actor.name,
        hint: subtitleFor(actor, game.user),
        selected: actor.id === selectedId
      });
      return {
        here: actors.filter((actor) => onMap.has(actor.id)).map(entry),
        elsewhere: actors.filter((actor) => !onMap.has(actor.id)).map(entry)
      };
    };

    const categories = Object.keys(CATEGORIES).map((category) => ({
      label: categoryText(category),
      types: Object.entries(BOND_TYPES)
        .filter(([, d]) => d.category === category)
        .map(([id]) => ({ id, label: bondText(id, "label"), selected: id === state.type }))
    }));

    // Everything the form needs to react to a change of type without a round trip.
    // Only lopsided bonds name their ends (Sire / Childe); the rest read From / To.
    const ends = (id) => {
      const from = bondText(id, "from");
      const to = bondText(id, "to");
      return from && to && from !== to ? { from, to } : { from: t("Bond.From"), to: t("Bond.To") };
    };
    const typeData = {};
    for (const [id, d] of Object.entries(BOND_TYPES)) {
      typeData[id] = { ...ends(id), directed: d.directed, color: d.color };
    }

    const audience = readOwnership(state.ownership);
    const users = players().map((user) => ({
      id: user.id,
      name: user.name,
      color: user.color?.css ?? String(user.color ?? "#999999"),
      character: user.character?.name ?? "",
      checked: audience.users.includes(user.id)
    }));

    return {
      isNew: !bond,
      bond: state,
      from: listFor(state.from),
      to: listFor(state.to),
      categories,
      typeData: JSON.stringify(typeData),
      roles: ends(state.type),
      color: state.color || def.color,
      isCustom: state.type === "custom",
      visibility: {
        everyone: audience.mode === "everyone",
        gm: audience.mode === "gm",
        specific: audience.mode === "specific"
      },
      users,
      hasUsers: users.length > 0,
      strengths: [1, 2, 3, 4, 5].map((value) => ({ value, checked: value === state.strength })),
      hasGmNotes: !!state.gmNotes
    };
  }

  _onRender() {
    const form = this.element;
    const typeData = JSON.parse(form.querySelector("[data-type-data]")?.dataset.typeData ?? "{}");
    const typeSelect = form.elements.type;
    const sync = (applyDefaults) => {
      const info = typeData[typeSelect.value] ?? {};
      form.querySelector("[data-role=from]").textContent = info.from || t("Bond.From");
      form.querySelector("[data-role=to]").textContent = info.to || t("Bond.To");
      form.style.setProperty("--vr-bond", form.elements.color?.value || info.color || "#6b7280");
      const custom = typeSelect.value === "custom";
      form.querySelector("[data-custom]").hidden = !custom;
      if (applyDefaults) {
        form.elements.directed.checked = !!info.directed;
        if (!custom) form.elements.color.value = info.color ?? "#6b7280";
        form.style.setProperty("--vr-bond", form.elements.color.value);
      }
    };
    typeSelect.addEventListener("change", () => sync(true));
    form.elements.color?.addEventListener("input", () => sync(false));
    sync(false);

    const syncAudience = () => {
      const mode = form.querySelector('input[name="visibility"]:checked')?.value;
      form.querySelector("[data-users]").hidden = mode !== "specific";
    };
    for (const radio of form.querySelectorAll('input[name="visibility"]')) radio.addEventListener("change", syncAudience);
    syncAudience();
  }

  /* -------------------------------------------- */

  static async #onSubmit(event, form) {
    const value = (name) => form.elements[name]?.value ?? "";
    const from = value("from");
    const to = value("to");
    if (!from || !to) return ui.notifications.warn(t("Notify.BondNeedsTwo"));
    if (from === to) return ui.notifications.warn(t("Notify.BondSelf"));

    const type = BOND_TYPES[value("type")] ? value("type") : "custom";
    const mode = form.querySelector('input[name="visibility"]:checked')?.value ?? "everyone";
    const chosen = [...form.querySelectorAll('input[name="users"]:checked')].map((input) => input.value);
    const strength = Number(form.querySelector('input[name="strength"]:checked')?.value) || 3;

    try {
      await saveBond({
        id: this.bondId ?? undefined,
        from,
        to,
        type,
        label: value("label"),
        directed: form.elements.directed.checked,
        strength,
        key: form.elements.key.checked,
        notes: value("notes"),
        gmNotes: value("gmNotes"),
        color: type === "custom" ? value("color") : "",
        ownership: buildOwnership(mode, chosen)
      });
    } catch (error) {
      console.error(`${MODULE_ID} | could not save bond`, error);
      return ui.notifications.error(t("Notify.BondFailed"));
    }
    lastType = type;
    return this.close();
  }

  static #onSwap() {
    const form = this.element;
    const from = form.elements.from.value;
    form.elements.from.value = form.elements.to.value;
    form.elements.to.value = from;
  }

  static async #onRemove() {
    if (!this.bondId) return;
    const confirmed = await DialogV2.confirm({
      window: { title: t("Bond.DeleteTitle") },
      classes: ["vr-app", "themed", "theme-dark"],
      content: `<p>${foundry.utils.escapeHTML(t("Bond.DeleteBody"))}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await deleteBond(this.bondId);
    this.close();
  }

  static #onCancel() {
    this.close();
  }

  _onClose(options) {
    super._onClose(options);
    if (current === this) current = null;
  }
}

/**
 * Open the editor. Only one is open at a time.
 * With nothing given, a new bond is started from the current selection:
 * one selected token fills "from", two fill both ends.
 */
export async function openBondEditor(options = {}) {
  if (!game.user.isGM) return null;
  const config = { ...options };
  if (!config.bondId && !config.from && canvas?.ready) {
    const selected = canvas.tokens.controlled.map((token) => token.document.actorId).filter(Boolean);
    if (selected[0]) config.from = selected[0];
    if (selected[1] && !config.to) config.to = selected[1];
  }
  if (current) await current.close();
  current = new BondEditor(config);
  current.render({ force: true });
  return current;
}
