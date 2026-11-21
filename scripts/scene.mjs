/**
 * Relationship-map scenes: how one is recognised, configured and created.
 */
import { DEFAULT_CONFIG, FLAG, MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";

export function isMapScene(scene = canvas?.scene) {
  return scene?.flags?.[MODULE_ID]?.[FLAG.IS_MAP] === true;
}

export function mapScenes() {
  return game.scenes.filter((scene) => isMapScene(scene));
}

/** The scene's saved configuration layered over the defaults. */
export function mapConfig(scene = canvas?.scene) {
  return { ...DEFAULT_CONFIG, ...(scene?.flags?.[MODULE_ID]?.[FLAG.CONFIG] ?? {}) };
}

export async function updateMapConfig(patch, scene = canvas?.scene) {
  if (!scene || !game.user.isGM) return;
  await scene.update({ flags: { [MODULE_ID]: { [FLAG.CONFIG]: patch } } });
}

/**
 * Create a scene set up as a relationship map: gridless, dark, with vision
 * and fog switched off so every placed character is simply there.
 *
 * Foundry v14 keeps a scene's background on its Level; passing the legacy
 * `backgroundColor` at creation lets core build that Level for us.
 */
export async function createMapScene({ name, view = true } = {}) {
  if (!game.user.isGM) return null;
  const SceneClass = CONFIG.Scene.documentClass;
  const scene = await SceneClass.create({
    name: name?.trim() || t("Scene.DefaultName"),
    width: 6000,
    height: 4000,
    padding: 0,
    backgroundColor: "#050505",
    grid: { type: CONST.GRID_TYPES.GRIDLESS, size: 100 },
    tokenVision: false,
    fog: { mode: CONST.FOG_EXPLORATION_MODES?.DISABLED ?? 0 },
    environment: { darknessLevel: 0 },
    navigation: true,
    flags: { [MODULE_ID]: { [FLAG.IS_MAP]: true, [FLAG.CONFIG]: { ...DEFAULT_CONFIG } } }
  });
  if (!scene) return null;
  ui.notifications.info(t("Notify.MapCreated", { name: scene.name }));
  if (view) await scene.view();
  return scene;
}

/** Turn an existing scene into a relationship map, or back into an ordinary scene. */
export async function setSceneAsMap(scene, enabled) {
  if (!scene || !game.user.isGM) return;
  await scene.update({
    flags: {
      [MODULE_ID]: {
        [FLAG.IS_MAP]: !!enabled,
        [FLAG.CONFIG]: mapConfig(scene)
      }
    }
  });
  ui.notifications.info(t(enabled ? "Notify.MapMarked" : "Notify.MapUnmarked", { name: scene.name }));
}

/**
 * Tidy a token as it is dropped onto a map: one grid square, no bars, no
 * nameplate (the map draws its own), no vision, no dynamic ring.
 * Called from the preCreateToken hook.
 */
export function prepareMapToken(tokenDocument) {
  const none = CONST.TOKEN_DISPLAY_MODES.NONE;
  tokenDocument.updateSource({
    width: 1,
    height: 1,
    rotation: 0,
    lockRotation: true,
    displayName: none,
    displayBars: none,
    sight: { enabled: false },
    ring: { enabled: false }
  });
}
