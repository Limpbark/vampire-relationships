/**
 * MapController — the bridge between Foundry's canvas and the MapRenderer.
 *
 * On a relationship-map scene it:
 *   - slots the renderer's two containers either side of the token layer,
 *   - hides each token's stock artwork (the map draws its own portrait),
 *   - turns tokens + Actor flags into the renderer's model on every change,
 *   - applies ownership so each user only meets the characters and bonds
 *     they are allowed to see.
 *
 * Tokens stay real tokens: they are selected, dragged, targeted and opened
 * exactly as on any other scene.
 */
import { FONT_STACKS, MODULE_ID, bondType, groupColors, hexToNumber } from "./constants.mjs";
import { allBonds, getBond } from "./bonds.mjs";
import { bondText, statusText, t } from "./i18n.mjs";
import { autoLayout, circleLayout, extent, findRoom, lineageLayout } from "./layout.mjs";
import { MapRenderer } from "./renderer.mjs";
import { isMapScene, mapConfig, updateMapConfig } from "./scene.mjs";
import { detailLines, groupFor, groupOf, imageFor, isKeyPerson, statusFor } from "./system.mjs";
import {
  actorSecrecy,
  baseActor,
  bondAllows,
  bondSecrecy,
  canSeeToken,
  getViewAs,
  setViewAs,
  sheetActor,
  viewer
} from "./visibility.mjs";

/** The token layer sits at 200 in the interface group; these straddle it. */
const Z_UNDER = 150;
const Z_OVER = 250;

/** Stock token parts the map replaces with its own drawing. */
const HIDDEN_PARTS = ["nameplate", "bars", "effects", "tooltip", "border", "levelIndicator"];

/** What the map can draw an outline around, and arrange by. */
const GROUPINGS = new Set(["covenant", "clan", "coterie"]);

/** Options a player may flip for themselves without touching the scene. */
const LOCAL_KEYS = new Set(["style", "labels", "subtitles", "patterned", "hoverFocus"]);

class MapController {
  constructor() {
    this.active = false;
    this.renderer = null;
    this.fonts = { display: [...FONT_STACKS.display], mono: [...FONT_STACKS.mono] };
    this.textures = new Map();
    this.hoverId = null;
    this.hoverEdge = null;
    this.search = "";
    this.hiddenTypes = new Set();
    this.local = {};
    this.undo = null;
    this.edgeBonds = new Map();
    this._frame = null;
    this._listeners = new Set();
    this._fitPending = false;
  }

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /** Scene configuration, with a player's personal toggles layered on top. */
  get config() {
    const config = mapConfig(canvas?.scene);
    return game.user.isGM ? config : { ...config, ...this.local };
  }

  /** True when the real user is a Storyteller looking with their own eyes. */
  get editing() {
    return game.user.isGM && !getViewAs();
  }

  /** Subscribe to state changes (the toolbar and dossier use this). */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  emit() {
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (error) {
        console.error(`${MODULE_ID} | listener failed`, error);
      }
    }
  }

  async setOption(key, value) {
    if (game.user.isGM) {
      await updateMapConfig({ [key]: value });
    } else if (LOCAL_KEYS.has(key)) {
      this.local[key] = value;
      this.requestRender();
      this.emit();
    }
  }

  setSearch(text) {
    this.search = String(text ?? "").trim().toLowerCase();
    this.requestRender();
  }

  setTypeHidden(typeId, hidden) {
    if (hidden) this.hiddenTypes.add(typeId);
    else this.hiddenTypes.delete(typeId);
    this.requestRender();
    this.emit();
  }

  setViewAs(userId) {
    setViewAs(userId);
    this.refreshVisibility();
    this.emit();
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** Called on canvasReady, and whenever the scene's map flag changes. */
  activate() {
    this.deactivate();
    if (!canvas?.ready || !isMapScene(canvas.scene)) {
      this.emit();
      return;
    }
    this.textures.clear();
    this.renderer = new MapRenderer(PIXI, { fonts: this.fonts });
    this.renderer.under.zIndex = Z_UNDER;
    this.renderer.over.zIndex = Z_OVER;
    canvas.interface.addChild(this.renderer.under);
    canvas.interface.addChild(this.renderer.over);
    this.renderer.handlers = {
      chipOver: (edgeId, event) => this._onChipOver(edgeId, event),
      chipOut: () => this._onChipOut(),
      chipDown: (edgeId, event) => this._onChipDown(edgeId, event)
    };
    this.active = true;
    for (const token of canvas.tokens.placeables) this.suppress(token);
    this.refreshVisibility();
    this._loadFonts();
    this.render();
    if (this._fitPending) {
      this._fitPending = false;
      this.fitView({ duration: 0 });
    }
    this.emit();
  }

  deactivate() {
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = null;
    if (this.renderer) {
      try {
        this.renderer.destroy();
      } catch (error) {
        console.warn(`${MODULE_ID} | renderer teardown`, error);
      }
    }
    this.renderer = null;
    this.active = false;
    this.hoverId = null;
    this.hoverEdge = null;
    this.edgeBonds.clear();
    hideTooltip();
  }

  /** Web fonts may arrive after the first draw; redraw the text when they do. */
  _loadFonts() {
    if (!document.fonts?.load) return;
    const families = [...this.fonts.display, ...this.fonts.mono].filter((f) => !["serif", "monospace"].includes(f));
    Promise.allSettled(families.map((family) => document.fonts.load(`400 20px "${family}"`))).then(() => {
      if (this.active) this.renderer?.invalidate();
    });
  }

  /* -------------------------------------------- */
  /*  Tokens                                      */
  /* -------------------------------------------- */

  /**
   * Hide a token's stock artwork and enforce visibility.
   * Runs after every token refresh, because core re-applies its own values
   * each time it redraws a token.
   */
  suppress(token) {
    if (!this.active || !token?.document) return;
    // Drag previews are clones; treat them as belonging to the viewed scene.
    if (!token.isPreview && token.document.parent !== canvas.scene) return;
    if (token.mesh) token.mesh.alpha = 0;
    for (const key of HIDDEN_PARTS) {
      const part = token[key];
      if (part) part.visible = false;
    }
    if (token.ruler) token.ruler.visible = false;
    if (!token.isPreview && !canSeeToken(token.document)) {
      token.visible = false;
      if (token.mesh) token.mesh.visible = false;
    }
    this._applyHitArea(token);
  }

  /** Make the whole drawn node (disc or card) the token's clickable area. */
  _applyHitArea(token) {
    if (token.isPreview) return;
    const shape = this.renderer?.localShape(token.document.id);
    if (!shape) return;
    token.hitArea = shape.kind === "circle"
      ? new PIXI.Circle(shape.cx, shape.cy, shape.r)
      : new PIXI.Rectangle(shape.x, shape.y, shape.w, shape.h);
  }

  /** Re-evaluate who can see which token (ownership, view-as or a setting changed). */
  refreshVisibility() {
    if (!canvas?.ready) return;
    for (const token of canvas.tokens.placeables) {
      if (this.active && token.controlled && !canSeeToken(token.document)) token.release();
      token.renderFlags.set({ refreshState: true });
    }
    this.requestRender();
  }

  _texture(src) {
    if (!src) return null;
    const cached = this.textures.get(src);
    if (cached) {
      if (cached.baseTexture && cached.valid) return cached;
      this.textures.delete(src);
    } else if (this.textures.has(src)) {
      return null; // already loading
    }
    this.textures.set(src, null);
    foundry.canvas.loadTexture(src)
      .then((texture) => {
        if (!texture) return;
        this.textures.set(src, texture);
        this.requestRender();
      })
      .catch(() => {});
    return null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  requestRender() {
    if (!this.active || this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.render();
    });
  }

  render() {
    if (!this.active || !this.renderer || !canvas?.ready) return;
    try {
      this.renderer.render(this.buildModel());
      for (const token of canvas.tokens.placeables) this._applyHitArea(token);
    } catch (error) {
      console.error(`${MODULE_ID} | render failed`, error);
    }
  }

  /** Tokens on the map that the current viewer may see. */
  visibleTokens() {
    if (!canvas?.ready) return [];
    return canvas.tokens.placeables.filter((token) => !token.isPreview && canSeeToken(token.document));
  }

  buildModel() {
    const config = this.config;
    const user = viewer();
    const marks = this.editing;
    const unit = canvas.dimensions.size;
    const rect = canvas.dimensions.sceneRect;

    const nodes = [];
    const byActor = new Map();
    const sheets = new Map();
    for (const token of this.visibleTokens()) {
      const doc = token.document;
      // The world Actor carries identity, ownership and bonds; the sheet facts
      // come from the token's own actor, which for an unlinked token is its copy.
      const actor = baseActor(doc);
      const sheet = sheetActor(doc);
      sheets.set(doc.id, sheet);
      // While a token is being dragged, follow its preview so bonds stretch live.
      const live = token.hasPreview && token._preview?._previewType === "dragging" ? token._preview : token;
      const src = imageFor(doc, sheet, config.image);
      const status = statusFor(sheet);
      const node = {
        id: doc.id,
        actorId: actor?.id ?? "",
        x: live.position.x,
        y: live.position.y,
        w: token.w,
        h: token.h,
        name: doc.name || actor?.name || "",
        lines: detailLines(sheet, user, config),
        img: src,
        texture: this._texture(src),
        fit: config.image === "token" ? "contain" : "cover",
        status,
        statusLabel: status === "active" ? "" : statusText(status),
        key: isKeyPerson(actor),
        secret: marks ? actorSecrecy(actor, doc) : "none",
        selected: token.controlled
      };
      nodes.push(node);
      if (node.actorId) {
        if (!byActor.has(node.actorId)) byActor.set(node.actorId, []);
        byActor.get(node.actorId).push(node);
      }
    }

    const edges = [];
    this.edgeBonds.clear();
    for (const bond of allBonds()) {
      if (this.hiddenTypes.has(bond.type)) continue;
      const from = byActor.get(bond.from);
      const to = byActor.get(bond.to);
      if (!from || !to) continue;
      if (!bondAllows(bond, user)) continue;
      const def = bondType(bond.type);
      const many = from.length * to.length > 1;
      const secret = marks ? bondSecrecy(bond) : "none";
      for (const a of from) {
        for (const b of to) {
          const id = many ? `${bond.id}.${a.id}.${b.id}` : bond.id;
          this.edgeBonds.set(id, bond.id);
          edges.push({
            id,
            a: a.id,
            b: b.id,
            color: hexToNumber(bond.color || def.color),
            strength: bond.strength,
            directed: bond.directed,
            category: def.category,
            label: bond.label || bondText(bond.type, "short"),
            secret,
            key: bond.key
          });
        }
      }
    }

    let focus = null;
    const hoveredEdge = this.hoverEdge ? edges.find((edge) => edge.id === this.hoverEdge) : null;
    if (hoveredEdge) {
      focus = { nodes: new Set([hoveredEdge.a, hoveredEdge.b]), edges: new Set([hoveredEdge.id]) };
    } else if (config.hoverFocus && this.hoverId && nodes.some((node) => node.id === this.hoverId)) {
      const mine = edges.filter((edge) => edge.a === this.hoverId || edge.b === this.hoverId);
      focus = {
        nodes: new Set([this.hoverId, ...mine.flatMap((edge) => [edge.a, edge.b])]),
        edges: new Set(mine.map((edge) => edge.id))
      };
    }

    let search = null;
    if (this.search) {
      search = new Set(nodes.filter((node) => node.name.toLowerCase().includes(this.search)).map((node) => node.id));
    }

    const groups = [];
    if (GROUPINGS.has(config.groups)) {
      const buckets = new Map();
      for (const node of nodes) {
        // A character with no covenant, clan or coterie gets no outline.
        const key = groupFor(sheets.get(node.id), config.groups, user);
        if (!key) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(node.id);
      }
      // Colours are settled from every group on the map, not just the ones
      // this viewer can see, so a covenant is the same colour for the whole table.
      const colors = groupColors(
        canvas.tokens.placeables
          .filter((token) => !token.isPreview)
          .map((token) => groupOf(sheetActor(token.document), config.groups))
      );
      for (const [key, nodeIds] of buckets) groups.push({ key, label: key, color: colors.get(key), nodeIds });
    }

    return {
      style: config.style === "cards" ? "cards" : "constellation",
      unit,
      labels: config.labels,
      subtitles: config.subtitles,
      patterned: config.patterned,
      backdrop: config.backdrop,
      bounds: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      nodes,
      edges,
      groups,
      focus,
      search
    };
  }

  /* -------------------------------------------- */
  /*  Bond chips                                  */
  /* -------------------------------------------- */

  _onChipOver(edgeId, event) {
    this.hoverEdge = edgeId;
    this.requestRender();
    const bond = getBond(this.edgeBonds.get(edgeId));
    if (bond) showTooltip(bond, event, this.editing);
  }

  _onChipOut() {
    this.hoverEdge = null;
    this.requestRender();
    hideTooltip();
  }

  _onChipDown(edgeId, event) {
    const bond = getBond(this.edgeBonds.get(edgeId));
    if (!bond) return;
    const button = event?.button ?? 0;
    if (button !== 0) return;
    hideTooltip();
    Hooks.callAll(`${MODULE_ID}.bondClicked`, bond, { editable: this.editing });
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  /** Select a token and glide the view to it. */
  focusToken(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token || !token.visible) return false;
    token.control({ releaseOthers: true });
    canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 450 });
    return true;
  }

  /** First token on this map for a given Actor, if the viewer can see it. */
  tokenForActor(actorId) {
    return this.visibleTokens().find((token) => token.document.actorId === actorId) ?? null;
  }

  /**
   * Where to read a character's sheet facts from: their token on this map when
   * they have one (an unlinked token keeps its own copy of the sheet),
   * otherwise the world Actor.
   */
  sheetActorFor(actorId) {
    const token = this.active ? this.tokenForActor(actorId) : null;
    return (token ? sheetActor(token.document) : null) ?? game.actors.get(actorId) ?? null;
  }

  /** Zoom and pan so every visible character fits on screen. */
  fitView({ duration = 500 } = {}) {
    if (!this.active || !canvas?.ready) return;
    const tokens = this.visibleTokens();
    if (!tokens.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const token of tokens) {
      const bounds = this.renderer?.nodeBounds(token.document.id)
        ?? { x: token.document.x, y: token.document.y, w: token.w, h: token.h };
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.w);
      maxY = Math.max(maxY, bounds.y + bounds.h);
    }
    const screen = canvas.app.renderer.screen;
    const pad = canvas.dimensions.size * 1.5;
    const limits = canvas.dimensions.scale ?? {};
    let scale = Math.min(screen.width / (maxX - minX + pad * 2), screen.height / (maxY - minY + pad * 2), 1.25);
    if (Number.isFinite(limits.min)) scale = Math.max(scale, limits.min);
    if (Number.isFinite(limits.max)) scale = Math.min(scale, limits.max);
    const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale };
    if (duration > 0) canvas.animatePan({ ...target, duration });
    else canvas.pan(target);
  }

  /* -------------------------------------------- */
  /*  Arranging                                   */
  /* -------------------------------------------- */

  /**
   * Lay the map out. With two or more tokens selected only those move,
   * around their current centre; otherwise the whole map is arranged.
   * @param {"auto"|"circle"|"covenant"|"clan"|"coterie"|"lineage"} mode
   */
  async arrange(mode) {
    if (!this.active || !this.editing) return;
    const scene = canvas.scene;
    const config = this.config;
    const selected = canvas.tokens.controlled.filter((token) => !token.isPreview);
    const subset = selected.length >= 2;
    const tokens = [...(subset ? selected : canvas.tokens.placeables.filter((token) => !token.isPreview))]
      .sort((a, b) => String(a.document.name).localeCompare(String(b.document.name)));
    if (tokens.length < 2) {
      ui.notifications.info(t("Notify.NothingToArrange"));
      return;
    }

    const user = game.user;
    const unit = canvas.dimensions.size;
    const cards = config.style === "cards";
    // Auto layout keeps together whatever the map is outlining; the grouped
    // arrangements name what to gather by themselves.
    const auto = mode !== "circle" && mode !== "lineage";
    const groupBy = GROUPINGS.has(mode) ? mode : auto && GROUPINGS.has(config.groups) ? config.groups : null;
    const byActor = new Map();
    const nodes = tokens.map((token) => {
      const actor = baseActor(token.document);
      if (actor) {
        if (!byActor.has(actor.id)) byActor.set(actor.id, []);
        byActor.get(actor.id).push(token.document.id);
      }
      return { id: token.document.id, group: groupBy ? groupFor(sheetActor(token.document), groupBy, user) : "" };
    });
    const edges = [];
    for (const bond of allBonds()) {
      const lineage = bondType(bond.type).lineage;
      for (const a of byActor.get(bond.from) ?? []) {
        for (const b of byActor.get(bond.to) ?? []) edges.push({ a, b, lineage });
      }
    }

    // Cards are wide, so layouts are stretched horizontally to suit them.
    let width = unit;
    if (cards) {
      // Make room for the wider cards, not the average one: names vary a lot in length.
      const widths = tokens.map((token) => this.renderer?.localShape(token.document.id)?.w ?? unit * 4)
        .sort((a, b) => a - b);
      width = widths[Math.floor((widths.length - 1) * 0.85)];
    }
    const spacing = unit * (cards ? 2.5 : 2.7);
    const stretchX = cards ? Math.min(3.4, Math.max(1.3, (width + unit * 0.9) / spacing)) : 1;

    let positions;
    if (mode === "circle") positions = circleLayout(nodes, { spacing: cards ? Math.max(spacing, width * 0.95) : spacing });
    else if (mode === "lineage") {
      positions = lineageLayout(nodes, edges, { spacingX: cards ? width + unit * 0.9 : unit * 2.8, spacingY: unit * 3 });
    } else {
      const screen = canvas.app.renderer.screen;
      positions = autoLayout(nodes, edges, {
        spacing,
        stretchX,
        grouped: !!groupBy,
        // Shaped like the window it will be looked at in.
        aspect: Math.min(2.2, Math.max(1.2, screen.width / screen.height)),
        // A constellation portrait has its name and captions hanging beneath it.
        bodyOffset: cards ? 0 : unit * 0.3
      });
    }

    // Where the arrangement is centred.
    let centre;
    if (subset) {
      centre = { x: 0, y: 0 };
      for (const token of tokens) {
        centre.x += token.center.x / tokens.length;
        centre.y += token.center.y / tokens.length;
      }
    } else {
      const size = extent(positions);
      const margin = unit * 3 + (cards ? width : 0);
      const need = { w: size.w + margin * 2, h: size.h + margin * 2 };
      if (need.w > scene.width || need.h > scene.height) {
        // Not enough room: grow the scene (this redraws the canvas for everyone).
        this._fitPending = true;
        await scene.update({
          width: Math.ceil(Math.max(scene.width, need.w) / 500) * 500,
          height: Math.ceil(Math.max(scene.height, need.h) / 500) * 500
        });
      }
      const rect = scene.dimensions.sceneRect;
      centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }

    this.undo = {
      sceneId: scene.id,
      positions: tokens.map((token) => ({ _id: token.document.id, x: token.document.x, y: token.document.y }))
    };
    const updates = tokens.map((token) => {
      const p = positions.get(token.document.id);
      const size = token.document.getSize();
      return {
        _id: token.document.id,
        x: Math.round(centre.x + p.x - size.width / 2),
        y: Math.round(centre.y + p.y - size.height / 2)
      };
    });
    await this._moveTokens(scene, updates);

    if (GROUPINGS.has(mode) && config.groups !== mode) await updateMapConfig({ groups: mode }, scene);
    ui.notifications.info(t("Notify.Arranged", { count: tokens.length }));
    if (!this._fitPending && canvas.scene === scene) {
      // Let the tokens settle into place before framing them.
      setTimeout(() => this.fitView(), 60);
    }
    this.emit();
  }

  async undoArrange() {
    if (!this.undo || !this.editing) return;
    const scene = game.scenes.get(this.undo.sceneId);
    const positions = this.undo.positions.filter((p) => scene?.tokens.has(p._id));
    this.undo = null;
    if (scene && positions.length) await this._moveTokens(scene, positions);
    this.emit();
  }

  /** Place tokens instantly, bypassing walls, costs and the layout lock. */
  _moveTokens(scene, updates) {
    return scene.updateEmbeddedDocuments("Token", updates, {
      animate: false,
      vrArrange: true,
      constrainOptions: { ignoreWalls: true, ignoreCost: true }
    });
  }

  /**
   * Put new characters on the map: beside the people they are bound to when
   * those are here already, otherwise around the middle of the view, and never
   * on top of anyone.
   */
  async addActors(actorIds) {
    if (!this.active || !this.editing) return [];
    const scene = canvas.scene;
    const actors = actorIds.map((id) => game.actors.get(id)).filter(Boolean);
    if (!actors.length) return [];
    const unit = canvas.dimensions.size;
    const cards = this.config.style === "cards";
    const rect = canvas.dimensions.sceneRect;
    const room = {
      pitchX: unit * (cards ? 5.6 : 2.6),
      pitchY: unit * (cards ? 2.2 : 2.7),
      bounds: { x: rect.x + unit * 1.5, y: rect.y + unit * 1.5, w: rect.width - unit * 3, h: rect.height - unit * 3 }
    };

    // Who is bound to whom, and where everyone already stands.
    const partners = new Map();
    const tie = (a, b) => {
      if (!partners.has(a)) partners.set(a, new Set());
      partners.get(a).add(b);
    };
    for (const bond of allBonds()) {
      tie(bond.from, bond.to);
      tie(bond.to, bond.from);
    }
    const taken = [];
    const standing = new Map();
    const stand = (actorId, centre) => {
      taken.push(centre);
      if (!standing.has(actorId)) standing.set(actorId, []);
      standing.get(actorId).push(centre);
    };
    for (const token of canvas.tokens.placeables) {
      if (!token.isPreview) stand(token.document.actorId, { x: token.center.x, y: token.center.y });
    }
    const beside = (actor) => [...(partners.get(actor.id) ?? [])].flatMap((id) => standing.get(id) ?? []);
    const view = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };

    const data = [];
    const waiting = [...actors];
    while (waiting.length) {
      // Whoever has someone to stand beside goes first, so that their own
      // ties can follow them onto the map.
      let next = waiting.findIndex((actor) => beside(actor).length);
      if (next < 0) next = 0;
      const [actor] = waiting.splice(next, 1);
      const friends = beside(actor);
      const want = friends.length
        ? {
          x: friends.reduce((sum, p) => sum + p.x, 0) / friends.length,
          y: friends.reduce((sum, p) => sum + p.y, 0) / friends.length
        }
        : view;
      const spot = findRoom(want, taken, room);
      stand(actor.id, spot);
      const document = await actor.getTokenDocument(
        { x: Math.round(spot.x - unit / 2), y: Math.round(spot.y - unit / 2) },
        { parent: scene }
      );
      data.push(document.toObject());
    }
    return scene.createEmbeddedDocuments("Token", data);
  }
}

export const controller = new MapController();

/* -------------------------------------------- */
/*  Token visibility                            */
/* -------------------------------------------- */

/**
 * Teach Token#isVisible about map ownership.
 * The getter is wrapped once on the base class, so system subclasses (such as
 * the Requiem system's TokenMTA) inherit it. `suppress()` enforces the same
 * rule after each refresh as a second line of defence.
 */
export function installVisibilityPatch() {
  const TokenClass = foundry.canvas.placeables.Token;
  const descriptor = Object.getOwnPropertyDescriptor(TokenClass.prototype, "isVisible");
  if (!descriptor?.get || descriptor.get.vampireRelationships) return;
  const original = descriptor.get;
  const patched = function () {
    if (
      controller.active
      && !this.isPreview
      && this.document?.parent === canvas.scene
      && !canSeeToken(this.document)
    ) return false;
    return original.call(this);
  };
  patched.vampireRelationships = true;
  Object.defineProperty(TokenClass.prototype, "isVisible", { ...descriptor, get: patched });
}

/* -------------------------------------------- */
/*  Bond tooltip                                */
/* -------------------------------------------- */

let tooltipElement = null;

function escape(text) {
  return foundry.utils.escapeHTML(String(text ?? ""));
}

function showTooltip(bond, event, editing) {
  const from = game.actors.get(bond.from);
  const to = game.actors.get(bond.to);
  if (!from || !to) return;
  if (!tooltipElement) {
    tooltipElement = document.createElement("aside");
    tooltipElement.id = "vr-tooltip";
    tooltipElement.className = "vr-ui";
    document.body.appendChild(tooltipElement);
  }
  const def = bondType(bond.type);
  const color = bond.color || def.color;
  const roleFrom = bondText(bond.type, "from");
  const roleTo = bondText(bond.type, "to");
  const arrow = bond.directed ? "→" : "—";
  const rows = [
    `<header style="--vr-bond:${escape(color)}"><span class="vr-pip"></span>${escape(bondText(bond.type, "label"))}</header>`,
    `<p class="vr-tip-names"><b>${escape(from.name)}</b> <i>${arrow}</i> <b>${escape(to.name)}</b></p>`
  ];
  if (roleFrom && roleTo && roleFrom !== roleTo) {
    rows.push(`<p class="vr-tip-roles">${escape(roleFrom)} ${arrow} ${escape(roleTo)}</p>`);
  }
  if (bond.label) rows.push(`<p class="vr-tip-label">${escape(bond.label)}</p>`);
  if (bond.notes) rows.push(`<p class="vr-tip-notes">${escape(bond.notes)}</p>`);
  if (editing && bond.gmNotes) {
    rows.push(`<p class="vr-tip-secret"><i class="fa-solid fa-lock"></i> ${escape(bond.gmNotes)}</p>`);
  }
  if (editing) rows.push(`<footer>${escape(t("Tooltip.ClickToEdit"))}</footer>`);
  tooltipElement.innerHTML = rows.join("");
  tooltipElement.hidden = false;

  const x = event?.clientX ?? event?.client?.x ?? 0;
  const y = event?.clientY ?? event?.client?.y ?? 0;
  const box = tooltipElement.getBoundingClientRect();
  tooltipElement.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, x + 16))}px`;
  tooltipElement.style.top = `${Math.max(8, Math.min(window.innerHeight - box.height - 8, y + 18))}px`;
}

function hideTooltip() {
  if (tooltipElement) tooltipElement.hidden = true;
}
