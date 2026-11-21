/**
 * Pure layout algorithms for arranging a relationship map.
 *
 * Every function takes plain data and returns a Map of id -> {x, y} giving the
 * CENTRE of each node, laid out around the origin. The caller translates the
 * result to wherever it should sit in the scene.
 *
 *   nodes: [{ id, group?, name? }]
 *   edges: [{ a, b, lineage? }]      a/b are node ids
 */

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = 2.399963229728653;

/** Shift a layout so its bounding box is centred on the origin. */
export function recenter(positions) {
  if (!positions.size) return positions;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of positions.values()) {
    p.x -= cx;
    p.y -= cy;
  }
  return positions;
}

/** Width and height of a layout. */
export function extent(positions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { w: 0, h: 0 };
  return { w: maxX - minX, h: maxY - minY };
}

/** Everyone on a ring. */
export function circleLayout(nodes, { spacing = 260 } = {}) {
  const out = new Map();
  const n = nodes.length;
  if (!n) return out;
  if (n === 1) {
    out.set(nodes[0].id, { x: 0, y: 0 });
    return out;
  }
  const radius = Math.max(spacing * 0.75, (spacing * n) / TAU);
  nodes.forEach((node, i) => {
    const angle = -Math.PI / 2 + (i / n) * TAU;
    out.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  return out;
}

/**
 * Force-directed layout (Fruchterman-Reingold with a little gravity so that
 * unconnected characters do not drift away). Deterministic: the same input
 * always produces the same picture.
 */
export function forceLayout(nodes, edges, { spacing = 260, iterations = 360, stretchX = 1 } = {}) {
  const out = new Map();
  const n = nodes.length;
  if (!n) return out;
  if (n === 1) {
    out.set(nodes[0].id, { x: 0, y: 0 });
    return out;
  }

  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const links = [];
  const seen = new Set();
  for (const e of edges) {
    const a = index.get(e.a);
    const b = index.get(e.b);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push([a, b]);
  }

  // Seed on a sunflower spiral: evenly spread and free of coincident points.
  const k = spacing;
  const pos = nodes.map((_, i) => {
    const r = k * 0.9 * Math.sqrt(i + 0.5);
    const t = i * GOLDEN_ANGLE;
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  });

  let temperature = k * 1.6;
  const cooling = Math.pow(0.02, 1 / iterations);
  // Gravity keeps unconnected characters within a couple of spacings of the
  // rest; `spring` is the rest length of a bond, a little over one spacing so
  // there is room for its label.
  const gravity = 0.85;
  const spring = k * 1.35;

  for (let step = 0; step < iterations; step++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dx = 0.01 * (i + 1);
          dy = 0.01 * (j + 1);
          dist = Math.hypot(dx, dy);
        }
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[i].x += fx;
        disp[i].y += fy;
        disp[j].x -= fx;
        disp[j].y -= fy;
      }
    }

    for (const [a, b] of links) {
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist * dist) / spring;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp[a].x -= fx;
      disp[a].y -= fy;
      disp[b].x += fx;
      disp[b].y += fy;
    }

    for (let i = 0; i < n; i++) {
      disp[i].x -= pos[i].x * gravity;
      disp[i].y -= pos[i].y * gravity;
      const len = Math.hypot(disp[i].x, disp[i].y) || 0.01;
      const move = Math.min(len, temperature);
      pos[i].x += (disp[i].x / len) * move;
      pos[i].y += (disp[i].y / len) * move;
    }
    temperature *= cooling;
  }

  separate(pos, k);
  nodes.forEach((node, i) => out.set(node.id, { x: pos[i].x * stretchX, y: pos[i].y }));
  return recenter(out);
}

/** Push apart any points closer than `minDistance`. Mutates `pos`. */
function separate(pos, minDistance, passes = 12) {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        let dx = pos[j].x - pos[i].x;
        let dy = pos[j].y - pos[i].y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDistance) continue;
        if (dist < 0.01) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const push = (minDistance - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        pos[i].x -= ux * push;
        pos[i].y -= uy * push;
        pos[j].x += ux * push;
        pos[j].y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Lay a handful of points out compactly around a centre (a sunflower head). */
function cluster(count, spacing) {
  const pts = [];
  if (count === 1) return [{ x: 0, y: 0 }];
  if (count <= 8) {
    const radius = Math.max(spacing * 0.5, (spacing * count) / TAU);
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (i / count) * TAU;
      pts.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
    return pts;
  }
  for (let i = 0; i < count; i++) {
    const r = spacing * 0.62 * Math.sqrt(i + 0.5);
    const t = i * GOLDEN_ANGLE;
    pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
  }
  return pts;
}

/**
 * Characters gathered by `node.group` (covenant, clan ...). Groups are packed
 * in rows, largest first, with the ungrouped ("") bucket last.
 */
export function groupedLayout(nodes, { spacing = 260, stretchX = 1 } = {}) {
  const out = new Map();
  if (!nodes.length) return out;

  const buckets = new Map();
  for (const node of nodes) {
    const key = node.group ?? "";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
  }
  const groups = [...buckets.entries()].sort((a, b) => {
    if (!a[0] !== !b[0]) return a[0] ? -1 : 1;
    return b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0]));
  });

  const placed = groups.map(([key, members]) => {
    const pts = cluster(members.length, spacing);
    let radius = 0;
    for (const p of pts) radius = Math.max(radius, Math.hypot(p.x * stretchX, p.y));
    return { key, members, pts, radius: radius + spacing * 0.75 };
  });

  const totalArea = placed.reduce((sum, g) => sum + Math.pow(g.radius * 2, 2), 0);
  const rowWidth = Math.max(Math.sqrt(totalArea) * 1.35, placed[0].radius * 2);

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const g of placed) {
    const diameter = g.radius * 2;
    if (cursorX > 0 && cursorX + diameter > rowWidth) {
      cursorX = 0;
      cursorY += rowHeight + spacing * 0.35;
      rowHeight = 0;
    }
    const cx = cursorX + g.radius;
    const cy = cursorY + g.radius;
    g.members.forEach((node, i) => {
      out.set(node.id, { x: cx + g.pts[i].x * stretchX, y: cy + g.pts[i].y });
    });
    cursorX += diameter + spacing * 0.35;
    rowHeight = Math.max(rowHeight, diameter);
  }
  return recenter(out);
}

/**
 * Sires above, childer below. Edges flagged `lineage` build the trees
 * (a = parent, b = child); a lower `lineage` number wins when a node has
 * more than one candidate parent. Everyone outside a tree is set out in
 * rows underneath.
 */
export function lineageLayout(nodes, edges, { spacingX = 260, spacingY = 300 } = {}) {
  const out = new Map();
  if (!nodes.length) return out;

  const ids = new Set(nodes.map((node) => node.id));
  const order = new Map(nodes.map((node, i) => [node.id, i]));
  const parentOf = new Map();
  const rank = new Map();
  const sorted = edges
    .filter((e) => e.lineage && ids.has(e.a) && ids.has(e.b) && e.a !== e.b)
    .sort((x, y) => x.lineage - y.lineage);

  const isAncestor = (candidate, of) => {
    let cursor = of;
    let guard = 0;
    while (cursor !== undefined && guard++ < 1000) {
      if (cursor === candidate) return true;
      cursor = parentOf.get(cursor);
    }
    return false;
  };

  for (const e of sorted) {
    if (parentOf.has(e.b)) continue;
    if (isAncestor(e.b, e.a)) continue; // would close a loop
    parentOf.set(e.b, e.a);
    rank.set(e.b, e.lineage);
  }

  const children = new Map();
  for (const [child, parent] of parentOf) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  for (const list of children.values()) {
    list.sort((x, y) => (rank.get(x) - rank.get(y)) || (order.get(x) - order.get(y)));
  }

  const inTree = new Set([...parentOf.keys(), ...children.keys()]);
  const roots = nodes.filter((node) => inTree.has(node.id) && !parentOf.has(node.id)).map((node) => node.id);

  let nextLeaf = 0;
  let maxDepth = 0;
  const place = (id, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = children.get(id) ?? [];
    let x;
    if (!kids.length) {
      x = nextLeaf * spacingX;
      nextLeaf += 1;
    } else {
      const xs = kids.map((kid) => place(kid, depth + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    out.set(id, { x, y: depth * spacingY });
    return x;
  };
  for (const root of roots) {
    place(root, 0);
    nextLeaf += 0.6; // breathing room between separate bloodlines
  }

  const rest = nodes.filter((node) => !out.has(node.id));
  if (rest.length) {
    const treeWidth = Math.max(0, (nextLeaf - 1) * spacingX);
    const perRow = Math.max(4, Math.min(rest.length, Math.round(Math.max(treeWidth, spacingX * 5) / spacingX) + 1));
    const top = roots.length ? (maxDepth + 1.4) * spacingY : 0;
    const rowWidth = (Math.min(perRow, rest.length) - 1) * spacingX;
    const left = roots.length ? treeWidth / 2 - rowWidth / 2 : 0;
    rest.forEach((node, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      out.set(node.id, { x: left + col * spacingX, y: top + row * spacingY * 0.8 });
    });
  }
  return recenter(out);
}

/** A plain grid, used when dropping several new characters onto the map. */
export function gridLayout(nodes, { spacingX = 260, spacingY = 260, columns } = {}) {
  const out = new Map();
  const n = nodes.length;
  if (!n) return out;
  const cols = columns ?? Math.ceil(Math.sqrt(n));
  nodes.forEach((node, i) => {
    out.set(node.id, { x: (i % cols) * spacingX, y: Math.floor(i / cols) * spacingY });
  });
  return recenter(out);
}
