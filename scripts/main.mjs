/**
 * Vampire Relationships — module entry point.
 * Wires Foundry's hooks to the map controller and the interface.
 */
import { BOND_TYPES, MODULE_ID } from "./constants.mjs";
import { allBonds, bondsOf, deleteBond, getBond, invalidateBonds, pruneBondsTo, saveBond } from "./bonds.mjs";
import { controller, installVisibilityPatch } from "./controller.mjs";
import { t } from "./i18n.mjs";
import { createMapScene, isMapScene, mapConfig, mapScenes, prepareMapToken, setSceneAsMap } from "./scene.mjs";
import { promptCreateMap, registerSettings } from "./settings.mjs";
import { baseActor, canSeeActor } from "./visibility.mjs";
import { BondEditor, openBondEditor } from "./apps/bond-editor.mjs";
import { CastPicker, openCastPicker } from "./apps/cast-picker.mjs";
import { Dossier } from "./apps/dossier.mjs";
import { MapToolbar } from "./apps/toolbar.mjs";

let toolbar = null;
let dossier = null;

/* -------------------------------------------- */
/*  Start-up                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings({
    onVisibilityChange: () => {
      controller.refreshVisibility();
      dossier?.refresh();
    },
    onDisplayChange: () => controller.emit()
  });
  installVisibilityPatch();

  game.keybindings.register(MODULE_ID, "newBond", {
    name: "VR.Keys.NewBond.Name",
    hint: "VR.Keys.NewBond.Hint",
    editable: [{ key: "KeyB", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => {
      if (!controller.active || !controller.editing) return false;
      openBondEditor();
      return true;
    }
  });
});

Hooks.once("ready", () => {
  dossier = new Dossier({
    hooks: {
      newBond: (options) => openBondEditor(options),
      editBond: (bondId) => bondId && openBondEditor({ bondId })
    }
  });
  toolbar = new MapToolbar({
    onNewBond: () => openBondEditor(),
    onAddCast: () => openCastPicker()
  });
  // Anything that changes what the viewer may see (such as "see as a player")
  // must also reach an open dossier.
  controller.onChange(() => dossier.refresh());

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      controller,
      BOND_TYPES,
      createMapScene,
      promptCreateMap,
      setSceneAsMap,
      isMapScene,
      mapScenes,
      openBondEditor,
      openCastPicker,
      openDossier: (actorId) => dossier.show(actorId),
      bonds: { all: allBonds, get: getBond, of: bondsOf, save: saveBond, delete: deleteBond },
      apps: { BondEditor, CastPicker, Dossier }
    };
  }

  // The canvas may already be up by the time "ready" fires.
  if (canvas?.ready) controller.activate();
  toolbar.refresh();
  offerFirstMap();
});

/** The first time a Storyteller loads a world with the module on, offer to make a map. */
async function offerFirstMap() {
  if (!game.user.isGM || game.users.activeGM !== game.user) return;
  if (game.settings.get(MODULE_ID, "welcomed") || mapScenes().length) return;
  await game.settings.set(MODULE_ID, "welcomed", true);
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("Welcome.Title"), icon: "fa-solid fa-diagram-project" },
    classes: ["vr-app", "vr-dialog", "themed", "theme-dark"],
    position: { width: 440 },
    content: `<p>${foundry.utils.escapeHTML(t("Welcome.Body"))}</p>`,
    rejectClose: false
  });
  if (yes) promptCreateMap();
}

/* -------------------------------------------- */
/*  Canvas                                      */
/* -------------------------------------------- */

// canvasReady is dispatched with Hooks.call, so nothing here may return false.
Hooks.on("canvasReady", () => {
  controller.activate();
});

Hooks.on("canvasTearDown", () => {
  controller.deactivate();
  controller.emit();
});

Hooks.on("drawToken", (token) => {
  controller.suppress(token);
  controller.requestRender();
});

Hooks.on("refreshToken", (token) => {
  controller.suppress(token);
  controller.requestRender();
});

Hooks.on("destroyToken", () => controller.requestRender());

Hooks.on("hoverToken", (token, hovered) => {
  if (!controller.active) return;
  const id = token.document.id;
  if (hovered) controller.hoverId = id;
  else if (controller.hoverId === id) controller.hoverId = null;
  controller.requestRender();
});

const syncDossier = foundry.utils.debounce(() => {
  if (!controller.active || !dossier) return;
  if (!game.settings.get(MODULE_ID, "dossierOnSelect")) return;
  const selected = canvas.tokens.controlled;
  if (selected.length !== 1) return;
  const actor = baseActor(selected[0].document);
  if (actor && canSeeActor(actor)) dossier.show(actor.id);
}, 80);

Hooks.on("controlToken", () => {
  if (!controller.active) return;
  controller.requestRender();
  syncDossier();
});

/* -------------------------------------------- */
/*  Tokens                                      */
/* -------------------------------------------- */

Hooks.on("preCreateToken", (document) => {
  if (isMapScene(document.parent)) prepareMapToken(document);
});

let lastWarning = 0;
function warnOnce(message) {
  const now = Date.now();
  if (now - lastWarning < 2500) return;
  lastWarning = now;
  ui.notifications.warn(message);
}

/** Keep the layout where the Storyteller put it. */
Hooks.on("preUpdateToken", (document, changes, options) => {
  if (!isMapScene(document.parent)) return;
  if (!("x" in changes) && !("y" in changes)) return;
  if (options?.vrArrange) return;
  if (mapConfig(document.parent).lockLayout) {
    warnOnce(t("Notify.LayoutLocked"));
    return false;
  }
  if (!game.user.isGM && !game.settings.get(MODULE_ID, "playersMoveNodes")) {
    warnOnce(t("Notify.PlayersCannotMove"));
    return false;
  }
});

for (const hook of ["createToken", "updateToken", "deleteToken"]) {
  Hooks.on(hook, (document) => {
    if (document.parent !== canvas?.scene) return;
    controller.requestRender();
    dossier?.refresh();
  });
}

/* -------------------------------------------- */
/*  Actors, scenes, users                       */
/* -------------------------------------------- */

Hooks.on("updateActor", (actor, changes) => {
  if (changes.flags?.[MODULE_ID]) invalidateBonds();
  if ("ownership" in changes) controller.refreshVisibility();
  controller.requestRender();
  dossier?.refresh();
});

Hooks.on("createActor", () => {
  invalidateBonds();
  controller.requestRender();
});

Hooks.on("deleteActor", (actor) => {
  invalidateBonds();
  controller.requestRender();
  dossier?.refresh();
  // One Storyteller tidies away bonds that pointed at the deleted character.
  if (game.users.activeGM === game.user) pruneBondsTo(actor.id).catch((error) => console.warn(`${MODULE_ID} |`, error));
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene !== canvas?.scene) return;
  if (!changes.flags?.[MODULE_ID]) return;
  // Marking or unmarking the viewed scene switches the map on or off in place.
  if (controller.active !== isMapScene(scene)) {
    if (isMapScene(scene)) {
      controller.activate();
      for (const token of canvas.tokens.placeables) token.renderFlags.set({ refresh: true });
    } else {
      // Hand the tokens back to core exactly as it would draw them: redraw the scene.
      controller.deactivate();
      controller.emit();
      canvas.draw();
    }
    return;
  }
  controller.requestRender();
  controller.emit();
});

for (const hook of ["createUser", "updateUser", "deleteUser", "userConnected"]) {
  Hooks.on(hook, () => {
    controller.refreshVisibility();
    controller.emit();
    dossier?.refresh();
  });
}

Hooks.on(`${MODULE_ID}.bondClicked`, (bond, { editable } = {}) => {
  if (editable) openBondEditor({ bondId: bond.id });
  else if (canSeeActor(game.actors.get(bond.from))) dossier?.show(bond.from);
});

/* -------------------------------------------- */
/*  Scene directory                             */
/* -------------------------------------------- */

function sceneFromElement(element) {
  const id = element?.dataset?.sceneId
    ?? element?.dataset?.entryId
    ?? element?.closest?.("[data-entry-id]")?.dataset?.entryId;
  return id ? game.scenes.get(id) ?? null : null;
}

// One hook serves both the Scenes sidebar and the navigation bar.
Hooks.on("getSceneContextOptions", (app, items) => {
  if (!game.user.isGM || !Array.isArray(items)) return;
  items.push(
    {
      label: t("Context.Mark"),
      icon: "fa-solid fa-diagram-project",
      visible: (element) => {
        const scene = sceneFromElement(element);
        return !!scene && !isMapScene(scene);
      },
      onClick: (event, element) => setSceneAsMap(sceneFromElement(element), true)
    },
    {
      label: t("Context.Unmark"),
      icon: "fa-solid fa-diagram-project",
      visible: (element) => isMapScene(sceneFromElement(element)),
      onClick: (event, element) => setSceneAsMap(sceneFromElement(element), false)
    }
  );
});

Hooks.on("renderSceneDirectory", (app, element) => {
  if (!game.user.isGM || !(element instanceof HTMLElement)) return;
  const host = element.querySelector(".header-actions");
  if (!host || host.querySelector(".vr-create-map")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "vr-create-map";
  button.innerHTML = `<i class="fa-solid fa-diagram-project"></i><span>${foundry.utils.escapeHTML(t("Scene.Create"))}</span>`;
  button.addEventListener("click", () => promptCreateMap());
  host.appendChild(button);
});
