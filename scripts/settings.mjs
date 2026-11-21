/**
 * Module settings and the "create a map" flow.
 */
import { MODULE_ID, OWNERSHIP } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { createMapScene } from "./scene.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/** Ask for a name, then create a relationship-map scene. */
export async function promptCreateMap() {
  if (!game.user.isGM) return null;
  const escape = foundry.utils.escapeHTML;
  const name = await DialogV2.prompt({
    window: { title: t("Scene.CreateTitle"), icon: "fa-solid fa-diagram-project" },
    classes: ["vr-app", "vr-dialog", "themed", "theme-dark"],
    position: { width: 420 },
    content: `
      <p class="vr-hint">${escape(t("Scene.CreateHint"))}</p>
      <div class="vr-field">
        <label for="vr-scene-name">${escape(t("Scene.Name"))}</label>
        <input id="vr-scene-name" type="text" name="name" value="${escape(t("Scene.DefaultName"))}" autofocus>
      </div>`,
    ok: {
      label: t("Scene.CreateConfirm"),
      icon: "fa-solid fa-diagram-project",
      callback: (event, button) => button.form?.elements?.name?.value ?? ""
    },
    rejectClose: false
  });
  if (name === null || name === undefined) return null;
  return createMapScene({ name: String(name) });
}

/**
 * Settings "menu" entries must be Applications. This one never draws a window:
 * asking it to render simply starts the create-a-map prompt.
 */
class CreateMapMenu extends ApplicationV2 {
  async render() {
    promptCreateMap();
    return this;
  }
}

export function registerSettings({ onVisibilityChange, onDisplayChange } = {}) {
  game.settings.registerMenu(MODULE_ID, "createMap", {
    name: "VR.Settings.CreateMap.Name",
    label: "VR.Settings.CreateMap.Label",
    hint: "VR.Settings.CreateMap.Hint",
    icon: "fa-solid fa-diagram-project",
    type: CreateMapMenu,
    restricted: true
  });

  game.settings.register(MODULE_ID, "minCharacterLevel", {
    name: "VR.Settings.MinLevel.Name",
    hint: "VR.Settings.MinLevel.Hint",
    scope: "world",
    config: true,
    type: Number,
    choices: {
      [OWNERSHIP.LIMITED]: "OWNERSHIP.LIMITED",
      [OWNERSHIP.OBSERVER]: "OWNERSHIP.OBSERVER",
      [OWNERSHIP.OWNER]: "OWNERSHIP.OWNER"
    },
    default: OWNERSHIP.LIMITED,
    onChange: () => onVisibilityChange?.()
  });

  game.settings.register(MODULE_ID, "defaultBondVisibility", {
    name: "VR.Settings.DefaultBond.Name",
    hint: "VR.Settings.DefaultBond.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      everyone: "VR.Visibility.Everyone",
      gm: "VR.Visibility.Storyteller"
    },
    default: "everyone"
  });

  game.settings.register(MODULE_ID, "playersMoveNodes", {
    name: "VR.Settings.PlayersMove.Name",
    hint: "VR.Settings.PlayersMove.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "dossierOnSelect", {
    name: "VR.Settings.DossierOnSelect.Name",
    hint: "VR.Settings.DossierOnSelect.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => onDisplayChange?.()
  });

  // Whether the first-run invitation to create a map has been shown.
  game.settings.register(MODULE_ID, "welcomed", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
}
