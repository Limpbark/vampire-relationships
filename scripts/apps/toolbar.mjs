/**
 * MapToolbar — the strip of controls along the top of a relationship map.
 *
 * It is plain DOM appended to Foundry's #ui-top region, so it centres itself
 * over the canvas and follows the interface scale. The skeleton is built once
 * and then only patched, so typing in the search box never loses focus.
 */
import { BOND_TYPES, CATEGORIES } from "../constants.mjs";
import { controller } from "../controller.mjs";
import { bondText, categoryText, t } from "../i18n.mjs";
import { getViewAs, players } from "../visibility.mjs";

const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

export class MapToolbar {
  constructor({ onNewBond, onAddCast } = {}) {
    this.onNewBond = onNewBond;
    this.onAddCast = onAddCast;
    this.element = null;
    this.popover = null;
    this.banner = null;
    this.menu = null;
    this._outside = (event) => {
      if (this.menu && this.element && !this.element.contains(event.target)) this.closeMenu();
    };
    this._escape = (event) => {
      if (event.key === "Escape" && this.menu) this.closeMenu();
    };
    controller.onChange(() => this.refresh());
  }

  /* -------------------------------------------- */

  _mount() {
    if (this.element?.isConnected) return;
    const host = document.getElementById("ui-top") ?? document.body;
    const nav = document.createElement("nav");
    nav.id = "vr-toolbar";
    nav.className = "vr-ui";
    nav.innerHTML = `
      <div class="vr-bar">
        <div class="vr-group" data-gm>
          <button type="button" class="vr-tool vr-text-tool" data-menu="arrange">
            <i class="fa-solid fa-diagram-project"></i><span>${esc(t("Toolbar.Arrange"))}</span><i class="fa-solid fa-chevron-down vr-caret"></i>
          </button>
        </div>
        <div class="vr-group vr-segment">
          <button type="button" class="vr-tool" data-style="constellation" data-tooltip="${esc(t("Toolbar.Constellation"))}"><i class="fa-solid fa-circle-nodes"></i></button>
          <button type="button" class="vr-tool" data-style="cards" data-tooltip="${esc(t("Toolbar.Cards"))}"><i class="fa-solid fa-address-card"></i></button>
        </div>
        <label class="vr-group vr-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="search" placeholder="${esc(t("Toolbar.Search"))}" autocomplete="off" spellcheck="false">
        </label>
        <div class="vr-group">
          <button type="button" class="vr-tool" data-toggle="labels" data-tooltip="${esc(t("Toolbar.Labels"))}"><i class="fa-solid fa-tag"></i></button>
          <button type="button" class="vr-tool" data-toggle="subtitles" data-tooltip="${esc(t("Toolbar.Subtitles"))}"><i class="fa-solid fa-signature"></i></button>
          <button type="button" class="vr-tool" data-toggle="patterned" data-tooltip="${esc(t("Toolbar.Patterned"))}"><i class="fa-solid fa-grip-lines"></i></button>
          <button type="button" class="vr-tool" data-action="fit" data-tooltip="${esc(t("Toolbar.Fit"))}"><i class="fa-solid fa-expand"></i></button>
        </div>
        <div class="vr-group">
          <button type="button" class="vr-tool" data-menu="viewas" data-gm data-tooltip="${esc(t("Toolbar.ViewAs"))}"><i class="fa-solid fa-eye"></i></button>
          <button type="button" class="vr-tool" data-menu="filters" data-tooltip="${esc(t("Toolbar.Filters"))}"><i class="fa-solid fa-filter"></i></button>
          <button type="button" class="vr-tool" data-menu="appearance" data-gm data-tooltip="${esc(t("Toolbar.Appearance"))}"><i class="fa-solid fa-palette"></i></button>
        </div>
        <div class="vr-group vr-actions" data-gm>
          <button type="button" class="vr-tool vr-text-tool" data-action="cast"><i class="fa-solid fa-user-plus"></i><span>${esc(t("Toolbar.Cast"))}</span></button>
          <button type="button" class="vr-cta" data-action="bond"><i class="fa-solid fa-plus"></i><span>${esc(t("Toolbar.NewBond"))}</span></button>
        </div>
      </div>
      <div class="vr-banner" hidden></div>
      <div class="vr-popover" hidden></div>`;
    host.appendChild(nav);
    this.element = nav;
    this.popover = nav.querySelector(".vr-popover");
    this.banner = nav.querySelector(".vr-banner");

    nav.addEventListener("click", (event) => this._onClick(event));
    nav.addEventListener("change", (event) => this._onChange(event));
    nav.querySelector(".vr-search input").addEventListener("input", (event) => controller.setSearch(event.target.value));
    nav.querySelector(".vr-search input").addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") this._jumpToSearch();
      if (event.key === "Escape") event.target.blur();
    });
    // Keep canvas shortcuts and drags from reacting to toolbar use.
    for (const type of ["pointerdown", "wheel", "contextmenu"]) {
      nav.addEventListener(type, (event) => event.stopPropagation());
    }
    document.addEventListener("pointerdown", this._outside, true);
    document.addEventListener("keydown", this._escape);
  }

  /** Bring the toolbar in line with the controller's state. */
  refresh() {
    if (!controller.active) {
      if (this.element) this.element.hidden = true;
      this.closeMenu();
      return;
    }
    this._mount();
    const el = this.element;
    el.hidden = false;
    const config = controller.config;
    const editing = controller.editing;
    const viewAs = getViewAs();

    for (const node of el.querySelectorAll("[data-gm]")) {
      // The view-as control stays reachable while previewing, so the Storyteller can leave.
      const keep = node.dataset.menu === "viewas" ? game.user.isGM : editing;
      node.hidden = !keep;
    }
    for (const button of el.querySelectorAll("[data-style]")) {
      button.classList.toggle("active", button.dataset.style === config.style);
    }
    for (const button of el.querySelectorAll("[data-toggle]")) {
      button.classList.toggle("active", !!config[button.dataset.toggle]);
    }
    el.querySelector('[data-menu="viewas"]')?.classList.toggle("active", !!viewAs);
    el.querySelector('[data-menu="filters"]')?.classList.toggle("active", controller.hiddenTypes.size > 0);
    for (const button of el.querySelectorAll("[data-menu]")) {
      button.classList.toggle("open", button.dataset.menu === this.menu);
    }

    if (viewAs) {
      this.banner.hidden = false;
      this.banner.innerHTML = `<i class="fa-solid fa-eye"></i><span>${esc(t("Toolbar.SeeingAs", { name: viewAs.name }))}</span>
        <button type="button" data-action="exit-viewas">${esc(t("Toolbar.ExitViewAs"))}</button>`;
    } else {
      this.banner.hidden = true;
      this.banner.innerHTML = "";
    }
    if (this.menu) this._renderMenu();
  }

  destroy() {
    document.removeEventListener("pointerdown", this._outside, true);
    document.removeEventListener("keydown", this._escape);
    this.element?.remove();
    this.element = null;
  }

  /* -------------------------------------------- */
  /*  Menus                                       */
  /* -------------------------------------------- */

  toggleMenu(name, anchor) {
    if (this.menu === name) return this.closeMenu();
    this.menu = name;
    this._anchor = anchor ?? null;
    this.refresh();
  }

  closeMenu() {
    this.menu = null;
    if (this.popover) {
      this.popover.hidden = true;
      this.popover.innerHTML = "";
    }
    for (const button of this.element?.querySelectorAll("[data-menu].open") ?? []) button.classList.remove("open");
  }

  _renderMenu() {
    const builders = {
      arrange: () => this._menuArrange(),
      viewas: () => this._menuViewAs(),
      filters: () => this._menuFilters(),
      appearance: () => this._menuAppearance()
    };
    const html = builders[this.menu]?.();
    if (!html) return this.closeMenu();
    const scroll = this.popover.querySelector(".vr-pop-body")?.scrollTop ?? 0;
    this.popover.innerHTML = html;
    this.popover.hidden = false;
    const body = this.popover.querySelector(".vr-pop-body");
    if (body) body.scrollTop = scroll;
    const anchor = this._anchor?.isConnected ? this._anchor : this.element.querySelector(`[data-menu="${this.menu}"]`);
    const left = anchor ? anchor.offsetLeft : 0;
    const max = Math.max(0, this.element.offsetWidth - this.popover.offsetWidth);
    this.popover.style.left = `${Math.min(left, max)}px`;
  }

  _menuArrange() {
    const item = (mode, icon, title, hint) => `
      <button type="button" class="vr-item" data-arrange="${mode}">
        <i class="fa-solid ${icon}"></i>
        <span><b>${esc(title)}</b><small>${esc(hint)}</small></span>
      </button>`;
    return `
      <header>${esc(t("Arrange.Title"))}</header>
      <div class="vr-pop-body">
        ${item("network", "fa-share-nodes", t("Arrange.Network"), t("Arrange.NetworkHint"))}
        ${item("covenant", "fa-flag", t("Arrange.Covenant"), t("Arrange.CovenantHint"))}
        ${item("clan", "fa-droplet", t("Arrange.Clan"), t("Arrange.ClanHint"))}
        ${item("coterie", "fa-people-group", t("Arrange.Coterie"), t("Arrange.CoterieHint"))}
        ${item("lineage", "fa-sitemap", t("Arrange.Lineage"), t("Arrange.LineageHint"))}
        ${item("circle", "fa-circle-notch", t("Arrange.Circle"), t("Arrange.CircleHint"))}
        <hr>
        <button type="button" class="vr-item" data-action="undo-arrange" ${controller.undo ? "" : "disabled"}>
          <i class="fa-solid fa-rotate-left"></i><span><b>${esc(t("Arrange.Undo"))}</b></span>
        </button>
        <p class="vr-hint">${esc(t("Arrange.SelectionHint"))}</p>
      </div>`;
  }

  _menuViewAs() {
    const current = getViewAs()?.id ?? "";
    const row = (id, name, hint, color) => `
      <button type="button" class="vr-item ${current === id ? "active" : ""}" data-viewas="${esc(id)}">
        <i class="fa-solid ${id ? "fa-user" : "fa-crown"}" ${color ? `style="color:${esc(color)}"` : ""}></i>
        <span><b>${esc(name)}</b><small>${esc(hint)}</small></span>
        ${current === id ? '<i class="fa-solid fa-check vr-check"></i>' : ""}
      </button>`;
    const list = players();
    const rows = list.map((user) => row(
      user.id,
      user.name,
      user.character?.name ?? t("ViewAs.NoCharacter"),
      user.color?.css ?? String(user.color ?? "")
    ));
    return `
      <header>${esc(t("ViewAs.Title"))}</header>
      <div class="vr-pop-body">
        ${row("", t("ViewAs.Storyteller"), t("ViewAs.StorytellerHint"), "")}
        ${rows.join("") || `<p class="vr-hint">${esc(t("ViewAs.NoPlayers"))}</p>`}
      </div>`;
  }

  _menuFilters() {
    const sections = Object.keys(CATEGORIES).map((category) => {
      const types = Object.entries(BOND_TYPES).filter(([, def]) => def.category === category);
      const rows = types.map(([id, def]) => `
        <label class="vr-check-row">
          <input type="checkbox" data-filter="${id}" ${controller.hiddenTypes.has(id) ? "" : "checked"}>
          <span class="vr-pip" style="--vr-bond:${def.color}"></span>
          <span>${esc(bondText(id, "label"))}</span>
        </label>`);
      return `<h4>${esc(categoryText(category))}</h4>${rows.join("")}`;
    });
    return `
      <header>${esc(t("Filters.Title"))}</header>
      <div class="vr-pop-body">
        <div class="vr-inline">
          <button type="button" class="vr-link" data-action="filters-all">${esc(t("Filters.ShowAll"))}</button>
          <button type="button" class="vr-link" data-action="filters-none">${esc(t("Filters.HideAll"))}</button>
        </div>
        ${sections.join("")}
        <p class="vr-hint">${esc(t("Filters.Hint"))}</p>
      </div>`;
  }

  _menuAppearance() {
    const config = controller.config;
    const select = (key, options) => `
      <select data-config="${key}">
        ${options.map(([value, label]) => `<option value="${value}" ${config[key] === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
      </select>`;
    const toggle = (key, title, hint) => `
      <label class="vr-switch-row">
        <span><b>${esc(title)}</b><small>${esc(hint)}</small></span>
        <input type="checkbox" data-config="${key}" ${config[key] ? "checked" : ""}>
      </label>`;
    return `
      <header>${esc(t("Appearance.Title"))}</header>
      <div class="vr-pop-body">
        <h4>${esc(t("Appearance.Portraits"))}</h4>
        ${select("image", [["portrait", t("Appearance.ImagePortrait")], ["token", t("Appearance.ImageToken")]])}
        <h4>${esc(t("Appearance.Groups"))}</h4>
        ${select("groups", [
          ["none", t("Appearance.GroupsNone")],
          ["covenant", t("Appearance.GroupsCovenant")],
          ["clan", t("Appearance.GroupsClan")],
          ["coterie", t("Appearance.GroupsCoterie")]
        ])}
        <h4>${esc(t("Appearance.Details"))}</h4>
        ${toggle("showRank", t("Appearance.Rank"), t("Appearance.RankHint"))}
        ${toggle("showBloodline", t("Appearance.Bloodline"), t("Appearance.BloodlineHint"))}
        ${toggle("showCoterie", t("Appearance.Coterie"), t("Appearance.CoterieHint"))}
        <h4>${esc(t("Appearance.Show"))}</h4>
        ${toggle("hoverFocus", t("Appearance.HoverFocus"), t("Appearance.HoverFocusHint"))}
        ${toggle("backdrop", t("Appearance.Backdrop"), t("Appearance.BackdropHint"))}
        <h4>${esc(t("Appearance.Layout"))}</h4>
        ${toggle("lockLayout", t("Appearance.Lock"), t("Appearance.LockHint"))}
        <p class="vr-hint">${esc(t("Appearance.Shared"))}</p>
      </div>`;
  }

  /* -------------------------------------------- */
  /*  Events                                      */
  /* -------------------------------------------- */

  _jumpToSearch() {
    const query = controller.search;
    if (!query) return;
    const match = controller.visibleTokens().find((token) => String(token.document.name).toLowerCase().includes(query));
    if (match) controller.focusToken(match.document.id);
  }

  async _onClick(event) {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    const data = target.dataset;

    if (data.menu) return this.toggleMenu(data.menu, target);
    if (data.style) return controller.setOption("style", data.style);
    if (data.toggle) return controller.setOption(data.toggle, !controller.config[data.toggle]);
    if (data.arrange) {
      this.closeMenu();
      return controller.arrange(data.arrange);
    }
    if ("viewas" in data) {
      controller.setViewAs(data.viewas || null);
      return this.closeMenu();
    }

    switch (data.action) {
      case "fit":
        return controller.fitView();
      case "undo-arrange":
        this.closeMenu();
        return controller.undoArrange();
      case "exit-viewas":
        return controller.setViewAs(null);
      case "cast":
        this.closeMenu();
        return this.onAddCast?.();
      case "bond":
        this.closeMenu();
        return this.onNewBond?.();
      case "filters-all":
        controller.hiddenTypes.clear();
        controller.requestRender();
        return controller.emit();
      case "filters-none":
        for (const id of Object.keys(BOND_TYPES)) controller.hiddenTypes.add(id);
        controller.requestRender();
        return controller.emit();
      default:
        return undefined;
    }
  }

  _onChange(event) {
    const target = event.target;
    if (target.dataset.filter) {
      controller.setTypeHidden(target.dataset.filter, !target.checked);
    } else if (target.dataset.config) {
      const value = target.type === "checkbox" ? target.checked : target.value;
      controller.setOption(target.dataset.config, value);
    }
  }
}
