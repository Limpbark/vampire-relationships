/**
 * MapRenderer — draws a relationship map with PIXI.
 *
 * The renderer knows nothing about Foundry. It is handed a plain "model"
 * (nodes, bonds, groups, options) and keeps two containers up to date:
 *
 *   under  backdrop, group outlines, bond lines and node art   (never interactive)
 *   over   bond label chips                                     (clickable)
 *
 * Inside Foundry the two containers are slotted either side of the token
 * layer; in the dev preview they are simply stacked on a bare PIXI stage.
 *
 * Model shape:
 *   {
 *     style: "constellation" | "cards",
 *     unit: 100,                       // nominal node size in px, scales strokes and type
 *     labels, subtitles, patterned, backdrop,
 *     bounds: { x, y, w, h },          // area the backdrop covers
 *     nodes:  [{ id, x, y, w, h, name, img, texture, fit,
 *                lines: [{ text, tone: "gold" | "muted" | "soft", caps }],
 *                status, statusLabel, key, secret, selected }],
 *     edges:  [{ id, a, b, color, strength, directed, category, label, secret, key }],
 *     groups: [{ key, label, nodeIds }],
 *     focus:  { nodes: Set, edges: Set } | null,
 *     search: Set | null
 *   }
 */

import { CATEGORIES, COLORS, FONT_STACKS, hexToNumber, statusDef } from "./constants.mjs";
import {
  arrowHead,
  dashPolyline,
  parallelOffset,
  pointAtLength,
  polylineLength,
  rectsOverlap,
  routeEdge,
  sampleQuad,
  shapeCenter,
  unionBounds
} from "./geometry.mjs";

const DIM_NODE = 0.16;
const DIM_EDGE = 0.07;
const EDGE_ALPHA = 0.9;

/** Colours of the detail lines under a name. */
const TONES = { gold: COLORS.gold, muted: COLORS.muted, soft: COLORS.soft };

/** How a status drains a portrait: opacity, saturation shift (-1 is greyscale), tint. */
const PORTRAIT_LOOKS = {
  dim: { alpha: 0.72, saturation: -0.5, tint: 0xb4c2d8 },
  faded: { alpha: 0.42, saturation: -0.65 },
  grey: { alpha: 0.55, saturation: -1 }
};

function translateRect(rect, dx, dy) {
  return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
}

function translateShape(shape, dx, dy) {
  if (shape.kind === "circle") return { kind: "circle", cx: shape.cx + dx, cy: shape.cy + dy, r: shape.r };
  return { kind: "rect", x: shape.x + dx, y: shape.y + dy, w: shape.w, h: shape.h };
}

function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export class MapRenderer {
  /**
   * @param {object} PIXI                 the PIXI namespace (v7)
   * @param {object} [options]
   * @param {{display: string[], mono: string[]}} [options.fonts]
   * @param {number} [options.resolution] text rasterisation scale
   */
  constructor(PIXI, { fonts, resolution } = {}) {
    this.PIXI = PIXI;
    this.fonts = fonts ?? { display: [...FONT_STACKS.display], mono: [...FONT_STACKS.mono] };
    const dpr = globalThis.devicePixelRatio || 1;
    this.resolution = resolution ?? Math.min(4, Math.max(2, Math.ceil(dpr * 2)));

    this.under = new PIXI.Container();
    this.under.eventMode = "none";
    this.over = new PIXI.Container();
    this.over.eventMode = "passive";

    this.backdrop = new PIXI.Container();
    this.groupsG = new PIXI.Graphics();
    this.groupLabels = new PIXI.Container();
    this.edgesG = new PIXI.Graphics();
    this.nodesC = new PIXI.Container();
    this.under.addChild(this.backdrop, this.groupsG, this.groupLabels, this.edgesG, this.nodesC);

    /** @type {Map<string, object>} */
    this.nodeViews = new Map();
    /** @type {Map<string, object>} */
    this.chipViews = new Map();
    /** @type {Map<string, object>} */
    this.groupViews = new Map();
    /** World-space shape of every drawn node, keyed by node id. */
    this.shapes = new Map();

    /** Callbacks: chipOver(edgeId, event), chipOut(edgeId, event), chipDown(edgeId, event). */
    this.handlers = {};
    this.model = null;
    this._backdropKey = "";
  }

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  render(model) {
    if (!model) return;
    this.model = model;
    const unit = model.unit || 100;
    this._drawBackdrop(model, unit);
    this._syncNodes(model);
    this._drawGroups(model, unit);
    this._drawEdges(model, unit);
  }

  /** Force every piece of text to be rebuilt (after a web font arrives). */
  invalidate() {
    for (const view of this.nodeViews.values()) view.sig = null;
    for (const view of this.chipViews.values()) view.sig = null;
    for (const view of this.groupViews.values()) view.sig = null;
    if (this.model) this.render(this.model);
  }

  /** Local-space shape of a node, relative to its top-left corner. */
  localShape(nodeId) {
    return this.nodeViews.get(nodeId)?.localShape ?? null;
  }

  /** World-space bounds of a node including its labels. */
  nodeBounds(nodeId) {
    return this.nodeViews.get(nodeId)?.bounds ?? null;
  }

  destroy() {
    for (const container of [this.under, this.over]) {
      // Foundry may already have torn the canvas down around us.
      if (container.destroyed) continue;
      container.parent?.removeChild(container);
      container.destroy({ children: true });
    }
    this._backdropTextures?.forEach((t) => t.destroy(true));
    this._backdropTextures = null;
    this.nodeViews.clear();
    this.chipViews.clear();
    this.groupViews.clear();
    this.shapes.clear();
    this.model = null;
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  _text(string, { family, size, fill, letterSpacing = 0, align = "left", wrap = 0, outline = false, weight = "400" }) {
    const PIXI = this.PIXI;
    const style = new PIXI.TextStyle({
      fontFamily: family,
      fontSize: Math.max(4, size),
      fontWeight: weight,
      fill,
      letterSpacing,
      align,
      wordWrap: wrap > 0,
      wordWrapWidth: wrap > 0 ? wrap : 100,
      lineJoin: "round",
      padding: Math.ceil(size * 0.3),
      ...(outline ? { stroke: COLORS.ink, strokeThickness: Math.max(2, size * 0.24) } : {})
    });
    const text = new PIXI.Text(String(string ?? ""), style);
    text.resolution = this.resolution;
    return text;
  }

  _clear(container) {
    for (const child of container.removeChildren()) child.destroy({ children: true });
  }

  _stroke(g, points, width, color, alpha) {
    if (!points || points.length < 2) return;
    const PIXI = this.PIXI;
    g.lineStyle({ width, color, alpha, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  }

  /** Gold lock disc: the "secret" mark. mode is "all" or "some". */
  _lock(g, x, y, r, mode) {
    g.lineStyle({ width: Math.max(1, r * 0.16), color: COLORS.ink, alpha: 1 });
    if (mode === "some") {
      g.beginFill(COLORS.ink, 1).drawCircle(x, y, r).endFill();
      g.lineStyle(0);
      g.beginFill(COLORS.gold, 1);
      g.moveTo(x, y - r * 0.82);
      g.arc(x, y, r * 0.82, -Math.PI / 2, Math.PI / 2);
      g.lineTo(x, y - r * 0.82);
      g.endFill();
      g.lineStyle({ width: Math.max(1, r * 0.18), color: COLORS.gold, alpha: 1 });
      g.drawCircle(x, y, r * 0.82);
      g.lineStyle(0);
      return;
    }
    g.beginFill(COLORS.gold, 1).drawCircle(x, y, r).endFill();
    g.lineStyle(0);
    g.beginFill(COLORS.ink, 1).drawRoundedRect(x - r * 0.42, y - r * 0.12, r * 0.84, r * 0.6, r * 0.1).endFill();
    g.lineStyle({ width: Math.max(1, r * 0.17), color: COLORS.ink, alpha: 1 });
    g.moveTo(x - r * 0.26, y - r * 0.12);
    g.arc(x, y - r * 0.12, r * 0.26, Math.PI, Math.PI * 2);
    g.lineStyle(0);
  }

  /** Five-pointed gold star: the "key person / key tie" mark. */
  _star(g, x, y, r) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? r : r * 0.45;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    g.lineStyle({ width: Math.max(1, r * 0.2), color: COLORS.ink, alpha: 1 });
    g.beginFill(COLORS.gold, 1).drawPolygon(pts).endFill();
    g.lineStyle(0);
  }

  /* -------------------------------------------- */
  /*  Backdrop                                    */
  /* -------------------------------------------- */

  _drawBackdrop(model, unit) {
    const b = model.bounds;
    const key = model.backdrop && b ? [b.x, b.y, b.w, b.h, unit].join("|") : "";
    if (key === this._backdropKey) return;
    this._backdropKey = key;
    this._clear(this.backdrop);
    this._backdropTextures?.forEach((t) => t.destroy(true));
    this._backdropTextures = [];
    if (!key || typeof document === "undefined") return;
    const PIXI = this.PIXI;

    // A faint haze of old blood rising from the middle of the map.
    const haze = document.createElement("canvas");
    haze.width = haze.height = 256;
    const hctx = haze.getContext("2d");
    const gradient = hctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(127, 29, 29, 0.20)");
    gradient.addColorStop(0.55, "rgba(127, 29, 29, 0.06)");
    gradient.addColorStop(1, "rgba(127, 29, 29, 0)");
    hctx.fillStyle = gradient;
    hctx.fillRect(0, 0, 256, 256);
    const hazeTexture = PIXI.Texture.from(haze);
    const hazeSprite = new PIXI.Sprite(hazeTexture);
    hazeSprite.position.set(b.x, b.y);
    hazeSprite.width = b.w;
    hazeSprite.height = b.h;
    this.backdrop.addChild(hazeSprite);

    // Dot grid.
    const tile = Math.max(16, Math.round(unit * 0.4));
    const dots = document.createElement("canvas");
    dots.width = dots.height = tile;
    const dctx = dots.getContext("2d");
    dctx.fillStyle = "rgba(240, 238, 234, 0.085)";
    dctx.beginPath();
    dctx.arc(tile / 2, tile / 2, Math.max(1, unit * 0.014), 0, Math.PI * 2);
    dctx.fill();
    const dotTexture = PIXI.Texture.from(dots);
    const grid = new PIXI.TilingSprite(dotTexture, b.w, b.h);
    grid.position.set(b.x, b.y);
    this.backdrop.addChild(grid);

    this._backdropTextures.push(hazeTexture, dotTexture);
  }

  /* -------------------------------------------- */
  /*  Nodes                                       */
  /* -------------------------------------------- */

  _nodeAlpha(node, model) {
    let alpha = 1;
    if (model.focus && !model.focus.nodes.has(node.id)) alpha = Math.min(alpha, DIM_NODE);
    if (model.search && !model.search.has(node.id)) alpha = Math.min(alpha, DIM_NODE);
    return alpha;
  }

  _syncNodes(model) {
    const PIXI = this.PIXI;
    const seen = new Set();
    this.shapes.clear();

    for (const node of model.nodes) {
      seen.add(node.id);
      let view = this.nodeViews.get(node.id);
      if (!view) {
        view = { root: new PIXI.Container(), sig: null, localShape: null, localBounds: null, bounds: null };
        this.nodeViews.set(node.id, view);
        this.nodesC.addChild(view.root);
      }
      const texture = node.texture && node.texture.valid ? node.texture : null;
      const sig = [
        model.style,
        node.w,
        node.h,
        node.name,
        this._lines(node, model).map((line) => `${line.tone}:${line.caps ? 1 : 0}:${line.text}`).join("\n"),
        node.img,
        texture ? `${texture.width}x${texture.height}` : "none",
        node.fit,
        node.status,
        node.statusLabel ?? "",
        node.key ? 1 : 0,
        node.secret,
        node.selected ? 1 : 0
      ].join("|");
      if (view.sig !== sig) {
        this._clear(view.root);
        if (model.style === "cards") this._buildCard(view, node, model, texture);
        else this._buildDisc(view, node, model, texture);
        view.sig = sig;
      }
      view.root.position.set(node.x, node.y);
      view.root.alpha = this._nodeAlpha(node, model);
      view.root.zIndex = node.selected ? 2 : 1;
      view.bounds = translateRect(view.localBounds, node.x, node.y);
      this.shapes.set(node.id, translateShape(view.localShape, node.x, node.y));
    }

    for (const [id, view] of this.nodeViews) {
      if (seen.has(id)) continue;
      view.root.parent?.removeChild(view.root);
      view.root.destroy({ children: true });
      this.nodeViews.delete(id);
    }
  }

  /**
   * Portrait art clipped to a circle or rectangle, or initials when there is no image.
   * @param {"dim"|"faded"|"grey"} [art]  how the character's status drains the picture
   */
  _addPortrait(root, node, texture, clip, art) {
    const PIXI = this.PIXI;
    const look = PORTRAIT_LOOKS[art] ?? null;
    const box = clip.kind === "circle"
      ? { x: clip.cx - clip.r, y: clip.cy - clip.r, w: clip.r * 2, h: clip.r * 2 }
      : clip;

    if (!texture || texture.width < 2 || texture.height < 2) {
      const label = this._text(initials(node.name), {
        family: this.fonts.display,
        size: box.h * 0.36,
        fill: look ? COLORS.faint : COLORS.muted,
        letterSpacing: box.h * 0.02
      });
      label.anchor.set(0.5);
      label.position.set(box.x + box.w / 2, box.y + box.h / 2);
      root.addChild(label);
      return;
    }

    const sprite = new PIXI.Sprite(texture);
    const contain = node.fit === "contain";
    const scale = contain
      ? Math.min(box.w / texture.width, box.h / texture.height)
      : Math.max(box.w / texture.width, box.h / texture.height);
    sprite.scale.set(scale);
    // Tall portraits are cropped a little above centre so faces stay in frame.
    const tall = !contain && texture.height / texture.width > 1.15;
    const focus = tall ? 0.28 : 0.5;
    sprite.anchor.set(0.5, focus);
    sprite.position.set(box.x + box.w / 2, box.y + box.h * focus);

    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff, 1);
    if (clip.kind === "circle") mask.drawCircle(clip.cx, clip.cy, clip.r);
    else mask.drawRect(clip.x, clip.y, clip.w, clip.h);
    mask.endFill();
    root.addChild(sprite, mask);
    sprite.mask = mask;

    if (look) {
      sprite.alpha = look.alpha;
      if (look.tint) sprite.tint = look.tint;
      const Filter = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
      if (Filter) {
        const drain = new Filter();
        drain.saturate(look.saturation);
        sprite.filters = [drain];
      } else if (!look.tint) {
        sprite.tint = 0x8a8a8a;
      }
    }
  }

  /** Small round badge carrying a status glyph, in the status's own colour. */
  _statusBadge(root, x, y, r, status) {
    const def = statusDef(status);
    if (!def.glyph) return;
    const color = hexToNumber(def.color, COLORS.muted);
    const g = new this.PIXI.Graphics();
    g.lineStyle({ width: Math.max(1, r * 0.18), color, alpha: 1 });
    g.beginFill(COLORS.ink, 0.95).drawCircle(x, y, r).endFill();
    root.addChild(g);
    const label = this._text(def.glyph, { family: this.fonts.display, size: r * 1.25, fill: color, weight: "700" });
    label.anchor.set(0.5);
    label.position.set(x, y);
    root.addChild(label);
  }

  /** The detail lines under a name. `subtitle` is the older single-line form. */
  _lines(node, model) {
    if (!model.subtitles) return [];
    if (Array.isArray(node.lines)) return node.lines.filter((line) => line?.text);
    return node.subtitle ? [{ text: node.subtitle, tone: "muted" }] : [];
  }

  /** One text object per detail line, coloured by its tone. */
  _detailTexts(node, model, size, { align = "left", wrap = 0, outline = false, spacing = 0.05 } = {}) {
    const drained = statusDef(node.status).art === "grey";
    return this._lines(node, model).map((line) => this._text(line.caps ? String(line.text).toUpperCase() : line.text, {
      family: this.fonts.mono,
      size,
      fill: drained ? COLORS.faint : TONES[line.tone] ?? COLORS.muted,
      align,
      wrap,
      outline,
      letterSpacing: size * (line.caps ? 0.16 : spacing)
    }));
  }

  /**
   * Boxed caption naming a character's status (MISSING, DESTROYED ...).
   * It is drawn whether or not the detail lines are switched on.
   * @returns {{root: object, w: number, h: number} | null}
   */
  _statusTag(node, size) {
    const def = statusDef(node.status);
    if (!def.glyph) return null;
    const PIXI = this.PIXI;
    const color = hexToNumber(def.color, COLORS.muted);
    const spacing = size * 0.2;
    const text = this._text(String(node.statusLabel || def.label).toUpperCase(), {
      family: this.fonts.mono,
      size,
      fill: color,
      letterSpacing: spacing
    });
    const padX = size * 0.6;
    const padY = size * 0.22;
    const w = text.width - spacing + padX * 2;
    const h = text.height + padY * 2;
    const g = new PIXI.Graphics();
    g.lineStyle({ width: Math.max(1, size * 0.09), color, alpha: 0.8, alignment: 0 });
    g.beginFill(COLORS.ink, 0.92).drawRect(0, 0, w, h).endFill();
    g.lineStyle(0);
    text.position.set(padX, padY);
    const root = new PIXI.Container();
    root.addChild(g, text);
    return { root, w, h };
  }

  /** A broken ring: the character's whereabouts are unknown. */
  _dashedCircle(g, cx, cy, radius, width, color) {
    const steps = 96;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const angle = -Math.PI / 2 + (i / steps) * Math.PI * 2;
      points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
    const segment = polylineLength(points) / 14;
    for (const piece of dashPolyline(points, [segment * 0.56, segment * 0.44])) this._stroke(g, piece, width, color, 1);
    g.lineStyle(0);
  }

  /** A stroke through the portrait: the character is gone for good. */
  _strike(g, from, to, width, color) {
    this._stroke(g, [from, to], width * 2.6, COLORS.ink, 0.7);
    this._stroke(g, [from, to], width, color, 0.95);
    g.lineStyle(0);
  }

  _buildDisc(view, node, model, texture) {
    const PIXI = this.PIXI;
    const root = view.root;
    const size = Math.min(node.w, node.h);
    const cx = node.w / 2;
    const cy = node.h / 2;
    const r = size / 2;
    const status = statusDef(node.status);
    const drained = status.art === "grey";
    const ringWidth = Math.max(2, size * 0.035);
    const ringColor = status.ring === "grey" ? COLORS.dead : node.key ? COLORS.gold : COLORS.blood;

    const g = new PIXI.Graphics();
    g.beginFill(COLORS.disc, 1).drawCircle(cx, cy, r).endFill();
    root.addChild(g);

    this._addPortrait(root, node, texture, { kind: "circle", cx, cy, r: r - ringWidth * 0.5 }, status.art);

    const ring = new PIXI.Graphics();
    if (status.struck) {
      // Drawn before the ring so its ends tuck underneath.
      const d = (r - ringWidth * 0.5) * Math.SQRT1_2;
      this._strike(ring, { x: cx - d, y: cy + d }, { x: cx + d, y: cy - d }, size * 0.028, hexToNumber(status.color, COLORS.dead));
    }
    if (status.ring === "dashed") {
      this._dashedCircle(ring, cx, cy, r - ringWidth / 2, ringWidth, ringColor);
    } else {
      ring.lineStyle({ width: ringWidth, color: ringColor, alpha: 1 });
      ring.drawCircle(cx, cy, r - ringWidth / 2);
    }
    if (node.selected) {
      ring.lineStyle({ width: Math.max(1.5, ringWidth * 0.55), color: COLORS.gold, alpha: 1 });
      ring.drawCircle(cx, cy, r + ringWidth * 1.1);
    }
    ring.lineStyle(0);
    const badge = size * 0.115;
    const diag = r * Math.SQRT1_2;
    if (node.secret === "all" || node.secret === "some") this._lock(ring, cx + diag, cy - diag, badge, node.secret);
    if (node.key) this._star(ring, cx - diag, cy - diag, badge * 1.05);
    root.addChild(ring);
    this._statusBadge(root, cx + diag, cy + diag, badge, node.status);

    const nameSize = size * 0.17;
    const name = this._text(node.name, {
      family: this.fonts.display,
      size: nameSize,
      fill: drained ? COLORS.dead : status.gone ? COLORS.muted : COLORS.text,
      align: "center",
      wrap: size * 2.4,
      outline: true,
      letterSpacing: nameSize * 0.03
    });
    name.anchor.set(0.5, 0);
    name.position.set(cx, node.h + size * 0.07);
    root.addChild(name);

    // Under the name: the status tag, then rank, clan and covenant, coterie.
    let bottom = name.y + name.height;
    let halfWidth = name.width / 2;
    const subSize = size * 0.105;
    const tag = this._statusTag(node, subSize * 1.08);
    if (tag) {
      tag.root.position.set(cx - tag.w / 2, bottom + subSize * 0.05);
      root.addChild(tag.root);
      bottom = tag.root.y + tag.h + subSize * 0.3;
      halfWidth = Math.max(halfWidth, tag.w / 2);
    }
    // Text boxes carry generous leading, so each line is pulled up a little.
    let lift = tag ? 0 : nameSize * 0.12;
    const details = this._detailTexts(node, model, subSize, { align: "center", wrap: size * 2.6, outline: true, spacing: 0.06 });
    for (const text of details) {
      text.anchor.set(0.5, 0);
      text.position.set(cx, bottom - lift);
      root.addChild(text);
      bottom = text.y + text.height;
      halfWidth = Math.max(halfWidth, text.width / 2);
      lift = subSize * 0.3;
    }

    view.localShape = { kind: "circle", cx, cy, r: r + (node.selected ? ringWidth * 1.6 : 0) };
    const left = Math.min(cx - r, cx - halfWidth);
    const right = Math.max(cx + r, cx + halfWidth);
    view.localBounds = { x: left, y: cy - r, w: right - left, h: bottom - (cy - r) };
  }

  _buildCard(view, node, model, texture) {
    const PIXI = this.PIXI;
    const root = view.root;
    const size = node.h;
    const status = statusDef(node.status);
    const drained = status.art === "grey";
    const pad = size * 0.2;
    const gap = size * 0.26;
    const padRight = size * 0.36;
    const line = Math.max(1, size * 0.012);

    const nameSize = size * 0.3;
    const name = this._text(String(node.name ?? "").toUpperCase(), {
      family: this.fonts.display,
      size: nameSize,
      fill: drained ? COLORS.dead : status.gone ? COLORS.muted : COLORS.text,
      letterSpacing: nameSize * 0.05,
      wrap: size * 5
    });

    // Beside the portrait: name, status tag, then rank, clan and covenant, coterie.
    const subSize = size * 0.19;
    const between = size * 0.03;
    const rows = [{ item: name, w: name.width, h: name.height, margin: 0 }];
    const tag = this._statusTag(node, subSize * 0.82);
    if (tag) rows.push({ item: tag.root, w: tag.w, h: tag.h, margin: size * 0.035 });
    for (const text of this._detailTexts(node, model, subSize, { wrap: size * 5, spacing: 0.04 })) {
      rows.push({ item: text, w: text.width, h: text.height, margin: 0 });
    }
    const textWidth = Math.max(...rows.map((row) => row.w));
    const blockHeight = rows.reduce((sum, row) => sum + row.h + row.margin * 2, 0) + between * (rows.length - 1);
    const cardWidth = pad + node.w + gap + textWidth + padRight;
    const cardHeight = Math.max(node.h + pad * 2, blockHeight + pad * 2);
    const card = { x: -pad, y: node.h / 2 - cardHeight / 2, w: cardWidth, h: cardHeight };

    const g = new PIXI.Graphics();
    g.lineStyle({ width: line, color: node.key ? COLORS.gold : COLORS.cardBorder, alpha: node.key ? 0.7 : 0.3, alignment: 0 });
    g.beginFill(COLORS.card, 0.9).drawRect(card.x, card.y, card.w, card.h).endFill();
    if (node.selected) {
      const off = line * 3;
      g.lineStyle({ width: line * 1.6, color: COLORS.gold, alpha: 1, alignment: 0.5 });
      g.drawRect(card.x - off, card.y - off, card.w + off * 2, card.h + off * 2);
      g.lineStyle({ width: line, color: COLORS.gold, alpha: 0.55, alignment: 0.5 });
      g.drawRect(card.x - off * 2, card.y - off * 2, card.w + off * 4, card.h + off * 4);
    }
    g.lineStyle({ width: line, color: 0xffffff, alpha: 0.1, alignment: 0 });
    g.beginFill(0x18181b, 0.65).drawRect(0, 0, node.w, node.h).endFill();
    g.lineStyle(0);
    root.addChild(g);

    this._addPortrait(root, node, texture, { kind: "rect", x: 0, y: 0, w: node.w, h: node.h }, status.art);
    if (status.struck) {
      const strike = new PIXI.Graphics();
      const inset = size * 0.1;
      this._strike(
        strike,
        { x: inset, y: node.h - inset },
        { x: node.w - inset, y: inset },
        size * 0.03,
        hexToNumber(status.color, COLORS.dead)
      );
      root.addChild(strike);
    }

    const textX = node.w + gap;
    let rowY = node.h / 2 - blockHeight / 2;
    for (const row of rows) {
      row.item.position.set(textX, rowY + row.margin);
      root.addChild(row.item);
      rowY += row.h + row.margin * 2 + between;
    }

    const marks = new PIXI.Graphics();
    const badge = size * 0.13;
    if (node.secret === "all" || node.secret === "some") this._lock(marks, card.x + card.w, card.y, badge, node.secret);
    if (node.key) this._star(marks, card.x, card.y, badge * 1.05);
    root.addChild(marks);
    this._statusBadge(root, node.w, node.h, badge, node.status);

    const grow = node.selected ? line * 6 : 0;
    view.localShape = { kind: "rect", x: card.x - grow, y: card.y - grow, w: card.w + grow * 2, h: card.h + grow * 2 };
    view.localBounds = { ...card };
  }

  /* -------------------------------------------- */
  /*  Groups                                      */
  /* -------------------------------------------- */

  _drawGroups(model, unit) {
    const g = this.groupsG;
    g.clear();
    const seen = new Set();
    for (const group of model.groups ?? []) {
      const rects = group.nodeIds.map((id) => this.nodeViews.get(id)?.bounds).filter(Boolean);
      const box = unionBounds(rects);
      if (!box) continue;
      seen.add(group.key);
      const pad = unit * 0.42;
      const r = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
      g.lineStyle({ width: Math.max(1, unit * 0.012), color: COLORS.gold, alpha: 0.3 });
      g.beginFill(COLORS.gold, 0.022).drawRoundedRect(r.x, r.y, r.w, r.h, unit * 0.16).endFill();

      let view = this.groupViews.get(group.key);
      if (!view) {
        view = { root: new this.PIXI.Container(), sig: null };
        this.groupViews.set(group.key, view);
        this.groupLabels.addChild(view.root);
      }
      const size = unit * 0.135;
      const caption = `${group.label} · ${rects.length}`.toUpperCase();
      const sig = `${caption}|${size}`;
      if (view.sig !== sig) {
        this._clear(view.root);
        view.root.addChild(this._text(caption, {
          family: this.fonts.mono,
          size,
          fill: COLORS.gold,
          letterSpacing: size * 0.24
        }));
        view.sig = sig;
      }
      const label = view.root.children[0];
      view.root.position.set(r.x + unit * 0.06, r.y - (label?.height ?? size) - unit * 0.05);
      view.root.alpha = 0.85;
    }
    g.lineStyle(0);
    for (const [key, view] of this.groupViews) {
      if (seen.has(key)) continue;
      view.root.parent?.removeChild(view.root);
      view.root.destroy({ children: true });
      this.groupViews.delete(key);
    }
  }

  /* -------------------------------------------- */
  /*  Bonds                                       */
  /* -------------------------------------------- */

  _drawEdges(model, unit) {
    const g = this.edgesG;
    g.clear();
    const cards = model.style === "cards";
    const seenChips = new Set();

    // Bonds between the same two nodes fan out side by side.
    const pairs = new Map();
    for (const edge of model.edges) {
      if (edge.a === edge.b || !this.shapes.has(edge.a) || !this.shapes.has(edge.b)) continue;
      const key = edge.a < edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`;
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(edge);
    }

    for (const list of pairs.values()) {
      list.forEach((edge, i) => {
        const shapeA = this.shapes.get(edge.a);
        const shapeB = this.shapes.get(edge.b);
        const ca = shapeCenter(shapeA);
        const cb = shapeCenter(shapeB);
        const distance = Math.hypot(cb.x - ca.x, cb.y - ca.y);

        let bend;
        if (list.length === 1) bend = cards ? distance * 0.12 : 0;
        else bend = parallelOffset(i, list.length) * Math.max(unit * 0.55, distance * 0.16);
        // The curve's normal flips with direction, so flip the bend to match.
        if (edge.a > edge.b) bend = -bend;

        const { p0, c, p1 } = routeEdge(shapeA, shapeB, bend, unit * 0.045);
        const span = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (span < unit * 0.08) return;
        const points = bend === 0
          ? [p0, p1]
          : sampleQuad(p0, c, p1, Math.min(40, Math.max(8, Math.round(span / 14))));

        const focused = !model.focus || model.focus.edges.has(edge.id);
        const searched = !model.search || (model.search.has(edge.a) && model.search.has(edge.b));
        const alpha = focused && searched ? EDGE_ALPHA : DIM_EDGE;
        const strength = Math.min(5, Math.max(1, Number(edge.strength) || 3));
        // Cards are several times larger than discs, so their bonds are drawn heavier.
        const width = unit * (0.012 + 0.006 * strength) * (cards ? 1.5 : 1);

        let shaft = points;
        let head = null;
        if (edge.directed) {
          const headLength = Math.max(width * 4.2, unit * 0.11);
          head = arrowHead(points, headLength, headLength * 0.8);
          if (head) shaft = head.shaft;
        }

        if (edge.key) this._stroke(g, shaft, width * 3.4, edge.color, alpha * 0.17);
        const pattern = model.patterned ? CATEGORIES[edge.category]?.pattern : null;
        const pieces = pattern ? dashPolyline(shaft, pattern.map((v) => v * width)) : [shaft];
        for (const piece of pieces) this._stroke(g, piece, width, edge.color, alpha);

        if (head) {
          g.lineStyle(0);
          g.beginFill(edge.color, alpha);
          g.drawPolygon([head.tip.x, head.tip.y, head.left.x, head.left.y, head.right.x, head.right.y]);
          g.endFill();
        }

        const emphasised = !!model.focus && model.focus.edges.has(edge.id);
        const showChip = !!edge.label && (model.labels || emphasised);
        const avoid = [this.nodeViews.get(edge.a)?.bounds, this.nodeViews.get(edge.b)?.bounds];
        const chipSize = unit * (cards ? 0.185 : 0.125);
        // Side-by-side bonds stagger their chips along the line so they do not stack.
        // The stagger follows the pair's fixed order, whichever way each bond points.
        let prefer = 0.5 + parallelOffset(i, list.length) * 0.17;
        if (edge.a > edge.b) prefer = 1 - prefer;
        this._syncChip(edge, points, avoid, chipSize, focused && searched ? 1 : 0.14, showChip, prefer);
        seenChips.add(edge.id);
      });
    }
    g.lineStyle(0);

    for (const [id, view] of this.chipViews) {
      if (seenChips.has(id)) continue;
      view.root.parent?.removeChild(view.root);
      view.root.destroy({ children: true });
      this.chipViews.delete(id);
    }
  }

  /**
   * Where along a bond its chip should sit: the midpoint if that is clear,
   * otherwise the nearest spot that does not cover either end's name.
   */
  _chipPosition(points, view, avoid, prefer = 0.5) {
    const total = polylineLength(points);
    const tries = [0, -0.08, 0.08, -0.16, 0.16, -0.23, 0.23].map((d) => Math.min(0.8, Math.max(0.2, prefer + d)));
    for (const t of tries) {
      const p = pointAtLength(points, total * t);
      const rect = { x: p.x - view.w / 2, y: p.y - view.h / 2, w: view.w, h: view.h };
      if (!avoid.some((bounds) => rectsOverlap(rect, bounds))) return p;
    }
    return pointAtLength(points, total * prefer);
  }

  _syncChip(edge, points, avoid, size, alpha, visible, prefer = 0.5) {
    const PIXI = this.PIXI;
    let view = this.chipViews.get(edge.id);
    if (!view) {
      const root = new PIXI.Container();
      view = { root, sig: null, edgeId: edge.id };
      root.cursor = "pointer";
      root.on("pointerover", (event) => this.handlers.chipOver?.(view.edgeId, event));
      root.on("pointerout", (event) => this.handlers.chipOut?.(view.edgeId, event));
      root.on("pointerdown", (event) => {
        event.stopPropagation();
        this.handlers.chipDown?.(view.edgeId, event);
      });
      this.chipViews.set(edge.id, view);
      this.over.addChild(root);
    }

    const sig = [edge.label, edge.color, edge.secret, edge.key ? 1 : 0, size].join("|");
    if (view.sig !== sig) {
      this._clear(view.root);
      const text = this._text(String(edge.label).toUpperCase(), {
        family: this.fonts.mono,
        size,
        fill: edge.color,
        letterSpacing: size * 0.2
      });
      const padX = size * 0.8;
      const padY = size * 0.42;
      const pip = size * 0.34;
      const space = size * 0.55;
      const lock = size * 0.62;
      const hasLock = edge.secret === "all" || edge.secret === "some";
      const extra = (hasLock ? space * 0.4 + lock * 2 : 0) + (edge.key ? space * 0.4 + lock * 1.7 : 0);
      const width = padX * 2 + pip * 2 + space + text.width - size * 0.2 + extra;
      const height = text.height + padY * 2;
      const left = -width / 2;

      const g = new PIXI.Graphics();
      g.lineStyle({ width: Math.max(1, size * 0.09), color: edge.color, alpha: 0.42, alignment: 0 });
      g.beginFill(COLORS.ink, 0.9).drawRect(left, -height / 2, width, height).endFill();
      g.lineStyle(0);
      const px = left + padX + pip;
      g.beginFill(edge.color, 1).drawPolygon([px, -pip, px + pip, 0, px, pip, px - pip, 0]).endFill();
      let cursor = width / 2 - padX * 0.8;
      if (hasLock) {
        this._lock(g, cursor - lock, 0, lock, edge.secret);
        cursor -= lock * 2 + space * 0.4;
      }
      if (edge.key) this._star(g, cursor - lock * 0.85, 0, lock * 0.9);
      view.root.addChild(g);

      text.anchor.set(0, 0.5);
      text.position.set(px + pip + space, 0);
      view.root.addChild(text);
      view.root.hitArea = new PIXI.Rectangle(left, -height / 2, width, height);
      view.w = width;
      view.h = height;
      view.sig = sig;
    }

    const position = this._chipPosition(points, view, avoid, prefer);
    view.root.position.set(position.x, position.y);
    view.root.alpha = alpha;
    view.root.visible = visible;
    view.root.eventMode = visible ? "static" : "none";
  }
}
