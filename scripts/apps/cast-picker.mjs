/**
 * CastPicker — choose which Actors to place on the relationship map.
 * (Dragging Actors from the sidebar onto the map works too; this is quicker
 * for a whole court.)
 */
import { MODULE_ID } from "../constants.mjs";
import { bondsOf } from "../bonds.mjs";
import { controller } from "../controller.mjs";
import { t } from "../i18n.mjs";
import { isPlaceholderImage, subtitleFor } from "../system.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let current = null;

export class CastPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vr-cast-picker",
    tag: "form",
    classes: ["vr-app", "vr-cast-picker", "themed", "theme-dark"],
    window: { title: "VR.Cast.Title", icon: "fa-solid fa-user-plus", resizable: true },
    position: { width: 420, height: 560 },
    form: { handler: CastPicker.#onSubmit, closeOnSubmit: false },
    actions: {
      all: CastPicker.#onAll,
      none: CastPicker.#onNone,
      cancel: CastPicker.#onCancel
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/cast-picker.hbs`, scrollable: [".vr-cast-list"] }
  };

  async _prepareContext() {
    const onMap = new Set(canvas.tokens.placeables.map((token) => token.document.actorId).filter(Boolean));
    const actors = [...game.actors]
      .filter((actor) => !onMap.has(actor.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((actor) => {
        const ties = bondsOf(actor.id);
        const count = ties.out.length + ties.in.length;
        return {
          id: actor.id,
          name: actor.name,
          search: actor.name.toLowerCase(),
          img: isPlaceholderImage(actor.img) ? "" : actor.img,
          initial: (actor.name ?? "?").trim().slice(0, 1).toUpperCase(),
          subtitle: subtitleFor(actor, game.user),
          folder: actor.folder?.name ?? "",
          ties: count,
          hasTies: count > 0
        };
      });
    return { actors, empty: actors.length === 0 };
  }

  _onRender() {
    const input = this.element.querySelector("input[data-search]");
    const rows = [...this.element.querySelectorAll(".vr-cast-row")];
    const count = this.element.querySelector("[data-count]");
    const updateCount = () => {
      const chosen = this.element.querySelectorAll('input[name="actors"]:checked').length;
      if (count) count.textContent = t("Cast.Chosen", { count: chosen });
    };
    input?.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      for (const row of rows) row.hidden = !!query && !row.dataset.search.includes(query);
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });
    this.element.addEventListener("change", updateCount);
    this._updateCount = updateCount;
    updateCount();
  }

  static async #onSubmit(event, form) {
    const ids = [...form.querySelectorAll('input[name="actors"]:checked')].map((input) => input.value);
    if (!ids.length) return ui.notifications.warn(t("Notify.CastNone"));
    await controller.addActors(ids);
    return this.close();
  }

  static #setVisible(app, checked) {
    for (const row of app.element.querySelectorAll(".vr-cast-row")) {
      if (row.hidden) continue;
      const box = row.querySelector('input[name="actors"]');
      if (box) box.checked = checked;
    }
    app._updateCount?.();
  }

  static #onAll() {
    CastPicker.#setVisible(this, true);
  }

  static #onNone() {
    CastPicker.#setVisible(this, false);
  }

  static #onCancel() {
    this.close();
  }

  _onClose(options) {
    super._onClose(options);
    if (current === this) current = null;
  }
}

export async function openCastPicker() {
  if (!controller.active || !controller.editing) return null;
  if (current) await current.close();
  current = new CastPicker();
  current.render({ force: true });
  return current;
}
