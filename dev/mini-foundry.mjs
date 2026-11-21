/**
 * A pocket-sized stand-in for Foundry VTT, just big enough to run this module
 * in a plain browser tab (dev/ui.html) with invented data.
 *
 * It is NOT Foundry and proves nothing about Foundry's own behaviour. What it
 * does give is the real module code, the real PIXI build, real Handlebars and
 * the real stylesheet running together, so the interface can be clicked
 * through and looked at without launching a world.
 */

const PIXI = globalThis.PIXI;
const Handlebars = globalThis.Handlebars;

class Collection extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
  filter(fn) {
    return [...this.values()].filter(fn);
  }
  find(fn) {
    return [...this.values()].find(fn);
  }
  map(fn) {
    return [...this.values()].map(fn);
  }
  get contents() {
    return [...this.values()];
  }
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      merge(target[key], value);
    } else target[key] = value;
  }
  return target;
}

function expand(data) {
  const out = {};
  for (const [path, value] of Object.entries(data)) {
    const keys = path.split(".");
    let cursor = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) {
        if (value && typeof value === "object" && !Array.isArray(value)) cursor[key] = merge(cursor[key] ?? {}, value);
        else cursor[key] = value;
      } else cursor = cursor[key] ??= {};
    });
  }
  return out;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

const handlers = new Map();
const Hooks = {
  on(name, fn) {
    if (!handlers.has(name)) handlers.set(name, []);
    handlers.get(name).push(fn);
  },
  once(name, fn) {
    Hooks.on(name, fn);
  },
  /** Returns false when any listener vetoes, like Foundry's Hooks.call. */
  call(name, ...args) {
    for (const fn of handlers.get(name) ?? []) if (fn(...args) === false) return false;
    return true;
  },
  callAll(name, ...args) {
    for (const fn of handlers.get(name) ?? []) fn(...args);
    return true;
  }
};

/* -------------------------------------------- */
/*  Documents                                   */
/* -------------------------------------------- */

class Actor {
  constructor(data) {
    Object.assign(this, { flags: {}, ownership: { default: 0 }, system: {}, type: "character", img: "", folder: null }, data);
  }
  getUserLevel(user) {
    return this.ownership[user.id] ?? this.ownership.default ?? 0;
  }
  testUserPermission(user, level) {
    return user.isGM || this.getUserLevel(user) >= level;
  }
  async update(data) {
    const changes = expand(data);
    merge(this, changes);
    Hooks.callAll("updateActor", this, changes, {}, game.user.id);
    return this;
  }
  async setFlag(scope, key, value) {
    return this.update({ [`flags.${scope}.${key}`]: value });
  }
  async unsetFlag(scope, key) {
    const keys = key.split(".");
    let cursor = this.flags[scope];
    for (const part of keys.slice(0, -1)) cursor = cursor?.[part];
    if (cursor) delete cursor[keys.at(-1)];
    Hooks.callAll("updateActor", this, { flags: { [scope]: {} } }, {}, game.user.id);
    return this;
  }
  async getTokenDocument(data = {}) {
    return { toObject: () => ({ actorId: this.id, name: this.name, texture: { src: this.img }, ...data }) };
  }
  get sheet() {
    return { render: () => ui.notifications.info(`(preview) would open ${this.name}'s sheet`) };
  }
}

class TokenDocument {
  constructor(data, scene) {
    Object.assign(this, { hidden: false, width: 1, height: 1, texture: { src: "" } }, data);
    this.id = data.id ?? data._id ?? foundry.utils.randomID();
    this.parent = scene;
    this.object = null;
  }
  get actor() {
    return game.actors.get(this.actorId) ?? null;
  }
  getSize() {
    return { width: this.width * 100, height: this.height * 100 };
  }
  updateSource(data) {
    merge(this, expand(data));
  }
}

/** A draggable, hoverable stand-in for Foundry's Token placeable. */
class Token extends PIXI.Container {
  constructor(document) {
    super();
    this.document = document;
    document.object = this;
    this.mesh = { alpha: 1, visible: true };
    this.controlled = false;
    this.isPreview = false;
    this.hasPreview = false;
    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new PIXI.Rectangle(0, 0, this.w, this.h);
    this.position.set(document.x, document.y);
    this.renderFlags = { set: () => this.refresh() };

    this.on("pointerover", () => Hooks.callAll("hoverToken", this, true));
    this.on("pointerout", () => Hooks.callAll("hoverToken", this, false));
    this.on("pointerdown", (event) => this._onDown(event));
  }
  get w() {
    return this.document.getSize().width;
  }
  get h() {
    return this.document.getSize().height;
  }
  get center() {
    return { x: this.document.x + this.w / 2, y: this.document.y + this.h / 2 };
  }
  get isVisible() {
    return !(this.document.hidden && !game.user.isGM);
  }
  refresh() {
    this.visible = this.isVisible;
    this.mesh.visible = this.visible;
    this.mesh.alpha = 1;
    this.position.set(this.document.x, this.document.y);
    Hooks.callAll("refreshToken", this, {});
  }
  control({ releaseOthers = true } = {}) {
    if (releaseOthers) for (const other of canvas.tokens.placeables) if (other !== this && other.controlled) other.release();
    if (this.controlled) return true;
    this.controlled = true;
    Hooks.callAll("controlToken", this, true);
    return true;
  }
  release() {
    if (!this.controlled) return;
    this.controlled = false;
    Hooks.callAll("controlToken", this, false);
  }
  _onDown(event) {
    event.stopPropagation();
    this.control({ releaseOthers: !event.shiftKey });
    const start = canvas.world.toLocal(event.global);
    const origin = { x: this.document.x, y: this.document.y };
    let moved = false;
    const move = (ev) => {
      const now = canvas.world.toLocal(ev.global);
      const target = { x: Math.round(origin.x + now.x - start.x), y: Math.round(origin.y + now.y - start.y) };
      if (!moved && Math.hypot(target.x - origin.x, target.y - origin.y) < 4) return;
      moved = true;
      // A real drag moves a preview clone; here the token itself follows the pointer.
      this.position.set(target.x, target.y);
      this._pending = target;
      Hooks.callAll("refreshToken", this, {});
    };
    const up = () => {
      canvas.app.stage.off("pointermove", move);
      canvas.app.stage.off("pointerup", up);
      canvas.app.stage.off("pointerupoutside", up);
      if (!moved || !this._pending) return;
      const target = this._pending;
      this._pending = null;
      this.position.set(origin.x, origin.y);
      canvas.scene.updateEmbeddedDocuments("Token", [{ _id: this.document.id, ...target }]);
    };
    canvas.app.stage.on("pointermove", move);
    canvas.app.stage.on("pointerup", up);
    canvas.app.stage.on("pointerupoutside", up);
  }
}

class Scene {
  constructor(data) {
    Object.assign(this, { flags: {}, width: 6000, height: 4000 }, data);
    this.tokens = new Collection();
  }
  get dimensions() {
    return { size: 100, sceneRect: new PIXI.Rectangle(0, 0, this.width, this.height), scale: { min: 0.1, max: 3 } };
  }
  async update(data) {
    const changes = expand(data);
    merge(this, changes);
    Hooks.callAll("updateScene", this, changes, {}, game.user.id);
    return this;
  }
  async updateEmbeddedDocuments(type, updates, options = {}) {
    for (const update of updates) {
      const document = this.tokens.get(update._id);
      if (!document) continue;
      const { _id, ...changes } = update;
      if (Hooks.call("preUpdateToken", document, changes, options, game.user.id) === false) {
        document.object?.refresh();
        continue;
      }
      Object.assign(document, changes);
      document.object?.refresh();
      Hooks.callAll("updateToken", document, changes, options, game.user.id);
    }
  }
  async createEmbeddedDocuments(type, list) {
    const made = [];
    for (const data of list) {
      const document = new TokenDocument(data, this);
      if (Hooks.call("preCreateToken", document, data, {}, game.user.id) === false) continue;
      this.tokens.set(document.id, document);
      if (canvas.scene === this) canvas.tokens.add(document);
      Hooks.callAll("createToken", document, {}, game.user.id);
      made.push(document);
    }
    return made;
  }
}

/* -------------------------------------------- */
/*  Applications                                */
/* -------------------------------------------- */

const templates = new Map();
async function renderTemplate(path, context) {
  const url = path.replace(/^modules\/[^/]+\//, "/");
  if (!templates.has(url)) templates.set(url, Handlebars.compile(await (await fetch(url)).text()));
  return templates.get(url)(context, { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true });
}

let windowCount = 0;

class ApplicationV2 {
  static DEFAULT_OPTIONS = {};
  static PARTS = {};

  constructor(options = {}) {
    const chain = [];
    for (let cls = this.constructor; cls && cls !== Object; cls = Object.getPrototypeOf(cls)) {
      if (Object.hasOwn(cls, "DEFAULT_OPTIONS")) chain.unshift(cls.DEFAULT_OPTIONS);
    }
    this.options = chain.reduce((all, part) => merge(all, structuredCloneSafe(part)), {
      classes: [], window: {}, position: {}, actions: {}, form: {}
    });
    merge(this.options, structuredCloneSafe(options));
    this.element = null;
    this.rendered = false;
  }

  get title() {
    return game.i18n.localize(this.options.window.title ?? "");
  }

  async _prepareContext() {
    return {};
  }
  async _onRender() {}
  _onClose() {}

  async render() {
    const context = await this._prepareContext({});
    const parts = Object.entries(this.constructor.PARTS);
    const scrollers = parts.flatMap(([, part]) => part.scrollable ?? []);
    const scroll = scrollers.map((selector) => this.element?.querySelector(selector)?.scrollTop ?? 0);
    const holder = document.createElement("template");
    let html = "";
    for (const [id, part] of parts) {
      holder.innerHTML = await renderTemplate(part.template, context);
      if (holder.content.children.length !== 1) throw new Error(`Template part "${id}" must render a single HTML element.`);
      html += holder.innerHTML;
    }

    if (!this.element) {
      const el = document.createElement(this.options.tag ?? "div");
      el.id = this.options.id ?? `app-${++windowCount}`;
      el.className = ["application", ...this.options.classes].join(" ");
      el.innerHTML = `<header class="window-header"><h1 class="window-title"></h1>
        <button type="button" class="header-control" data-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header>
        <section class="window-content"></section>`;
      const { width, height, top, left } = this.options.position;
      el.style.width = typeof width === "number" ? `${width}px` : "auto";
      if (typeof height === "number") el.style.height = `${height}px`;
      el.style.top = `${top ?? 90 + windowCount * 14}px`;
      el.style.left = `${left ?? Math.max(20, (window.innerWidth - (width ?? 400)) / 2)}px`;
      el.querySelector("[data-close]").addEventListener("click", () => this.close());
      el.addEventListener("click", (event) => {
        const target = event.target.closest("[data-action]");
        const handler = target && this.options.actions[target.dataset.action];
        if (typeof handler === "function") handler.call(this, event, target);
      });
      if (this.options.tag === "form") {
        el.addEventListener("submit", (event) => {
          event.preventDefault();
          this.options.form.handler?.call(this, event, el, new FormData(el));
        });
      }
      for (const type of ["pointerdown", "wheel"]) el.addEventListener(type, (event) => event.stopPropagation());
      document.body.appendChild(el);
      this.element = el;
    }
    this.element.querySelector(".window-title").textContent = this.title;
    this.element.querySelector(".window-content").innerHTML = html;
    scrollers.forEach((selector, i) => {
      const node = this.element.querySelector(selector);
      if (node) node.scrollTop = scroll[i];
    });
    this.rendered = true;
    await this._onRender(context, {});
    return this;
  }

  async close() {
    this.element?.remove();
    this.element = null;
    this.rendered = false;
    this._onClose({});
    return this;
  }
}

function structuredCloneSafe(value) {
  if (Array.isArray(value)) return value.map(structuredCloneSafe);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = structuredCloneSafe(v);
    return out;
  }
  return value;
}

const DialogV2 = {
  async confirm({ content = "" } = {}) {
    return window.confirm(content.replace(/<[^>]+>/g, ""));
  },
  async prompt({ ok } = {}) {
    const name = window.prompt("Scene name", "Relationship Map");
    return name === null ? null : ok?.callback ? name : name;
  }
};

/* -------------------------------------------- */
/*  Install                                     */
/* -------------------------------------------- */

/**
 * Build the globals the module expects and return helpers for the page.
 * @param {object} data  { lang, users, actors, moduleId }
 */
export function installMiniFoundry({ lang, users, actors, moduleId }) {
  const lookup = (key) => key.split(".").reduce((node, part) => node?.[part], lang);
  const core = {
    "OWNERSHIP.LIMITED": "Limited", "OWNERSHIP.OBSERVER": "Observer", "OWNERSHIP.OWNER": "Owner",
    "MTA.Vampire": "Vampire", "MTA.Ghoul": "Ghoul", "MTA.Mortal": "Mortal"
  };
  const localize = (key) => lookup(key) ?? core[key] ?? key;
  const settings = new Map();
  const registered = new Map();

  globalThis.Hooks = Hooks;
  globalThis.CONST = {
    DEFAULT_TOKEN: "icons/svg/mystery-man.svg",
    TOKEN_DISPLAY_MODES: { NONE: 0 },
    GRID_TYPES: { GRIDLESS: 0 },
    FOG_EXPLORATION_MODES: { DISABLED: 0 }
  };
  globalThis.CONFIG = { Actor: { typeLabels: {} }, Scene: { documentClass: Scene } };
  globalThis.ui = {
    notifications: Object.fromEntries(["info", "warn", "error"].map((level) => [level, (message) => toast(level, message)]))
  };
  globalThis.foundry = {
    utils: {
      randomID: (n = 16) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join(""),
      escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      debounce: (fn, delay) => {
        let timer;
        return (...args) => {
          clearTimeout(timer);
          timer = setTimeout(() => fn(...args), delay);
        };
      }
    },
    applications: {
      api: { ApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2 },
      apps: {
        DocumentOwnershipConfig: class {
          render() {
            ui.notifications.info("(preview) Foundry's ownership dialog would open here");
          }
        }
      }
    },
    canvas: {
      placeables: { Token },
      loadTexture: (src) => PIXI.Texture.fromURL(src)
    }
  };

  Handlebars.registerHelper("localize", (key) => localize(key));

  globalThis.game = {
    user: null,
    users: new Collection(users.map((user) => [user.id, user])),
    actors: new Collection(actors.map((data) => [data.id, new Actor(data)])),
    scenes: new Collection(),
    modules: new Map([[moduleId, {}]]),
    settings: {
      register: (scope, key, config) => {
        registered.set(key, config);
        if (!settings.has(key)) settings.set(key, config.default);
      },
      registerMenu: () => {},
      get: (scope, key) => settings.get(key),
      set: async (scope, key, value) => {
        settings.set(key, value);
        registered.get(key)?.onChange?.(value);
      }
    },
    keybindings: { register: () => {} },
    i18n: {
      has: (key) => typeof lookup(key) === "string" || key in core,
      localize,
      format: (key, data = {}) => String(localize(key)).replace(/\{(\w+)\}/g, (m, k) => data[k] ?? m)
    }
  };
  game.user = game.users.find((user) => user.isGM);
  Object.defineProperty(game.users, "activeGM", { get: () => game.users.find((user) => user.isGM) });

  return { Scene, TokenDocument, Token, Actor, settings };
}

/** Stand up a PIXI stage shaped like Foundry's canvas and show a scene on it. */
export function mountCanvas(host, scene) {
  const app = new PIXI.Application({
    resizeTo: window,
    backgroundColor: 0x050505,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1
  });
  host.appendChild(app.view);
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  const world = new PIXI.Container();
  const iface = new PIXI.Container();
  iface.sortableChildren = true;
  iface.eventMode = "passive";
  const tokenLayer = new PIXI.Container();
  tokenLayer.zIndex = 200;
  tokenLayer.eventMode = "passive";
  iface.addChild(tokenLayer);
  world.addChild(iface);
  app.stage.addChild(world);

  const tokens = {
    get placeables() {
      return tokenLayer.children.filter((child) => child instanceof foundry.canvas.placeables.Token);
    },
    get controlled() {
      return this.placeables.filter((token) => token.controlled);
    },
    get: (id) => scene.tokens.get(id)?.object,
    add(document) {
      const token = new foundry.canvas.placeables.Token(document);
      tokenLayer.addChild(token);
      Hooks.callAll("drawToken", token);
      token.refresh();
      return token;
    }
  };

  const view = { x: scene.width / 2, y: scene.height / 2, scale: 0.6 };
  const apply = () => {
    world.scale.set(view.scale);
    world.position.set(app.screen.width / 2 - view.x * view.scale, app.screen.height / 2 - view.y * view.scale);
  };
  apply();

  globalThis.canvas = {
    ready: false,
    app,
    scene,
    world,
    interface: iface,
    tokens,
    stage: { get pivot() { return { x: view.x, y: view.y }; }, get scale() { return { x: view.scale }; } },
    get dimensions() {
      return scene.dimensions;
    },
    pan({ x = view.x, y = view.y, scale = view.scale } = {}) {
      Object.assign(view, { x, y, scale });
      apply();
    },
    async animatePan(target = {}) {
      canvas.pan(target);
      return true;
    }
  };

  // Click empty space to clear the selection; drag it to pan; wheel to zoom.
  let pan = null;
  app.stage.on("pointerdown", (event) => {
    if (event.target !== app.stage) return;
    for (const token of tokens.controlled) token.release();
    pan = { x: event.global.x, y: event.global.y, vx: view.x, vy: view.y };
  });
  app.stage.on("pointermove", (event) => {
    if (!pan) return;
    canvas.pan({ x: pan.vx - (event.global.x - pan.x) / view.scale, y: pan.vy - (event.global.y - pan.y) / view.scale });
  });
  const stop = () => { pan = null; };
  app.stage.on("pointerup", stop);
  app.stage.on("pointerupoutside", stop);
  app.view.addEventListener("wheel", (event) => {
    event.preventDefault();
    canvas.pan({ scale: Math.min(3, Math.max(0.15, view.scale * (event.deltaY < 0 ? 1.1 : 0.9))) });
  }, { passive: false });
  window.addEventListener("resize", apply);

  for (const document of scene.tokens) tokens.add(document);
  canvas.ready = true;
  Hooks.call("canvasReady", canvas);
  return canvas;
}

function toast(level, message) {
  const el = document.createElement("div");
  el.className = `mf-toast mf-${level}`;
  el.textContent = message;
  (document.getElementById("mf-toasts") ?? document.body).appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export { Hooks };
