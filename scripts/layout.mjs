/**
 * Pure layout algorithms for arranging a relationship map.
 *
 * Every layout takes plain data and returns a Map of id -> {x, y} giving the
 * CENTRE of each node, laid out around the origin. The caller translates the
 * result to wherever it should sit in the scene. (findRoom is the exception:
 * it seats one newcomer among people who are already placed.)
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

/**
 * Find room for a newcomer: the spot nearest to where they would like to
 * stand that crowds nobody. Spots are tried on a lattice around `want`,
 * nearest first, so several newcomers with the same wish form a tidy block.
 *
 *   want:   { x, y }       centre the newcomer would like
 *   taken:  [{ x, y }]     centres already occupied
 *   bounds: { x, y, w, h } optional area the centre must stay within
 */
export function findRoom(want, taken, { pitchX = 260, pitchY = 260, bounds = null } = {}) {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const start = bounds
    ? { x: clamp(want.x, bounds.x, bounds.x + bounds.w), y: clamp(want.y, bounds.y, bounds.y + bounds.h) }
    : { x: want.x, y: want.y };
  const inside = (p) => !bounds
    || (p.x >= bounds.x && p.x <= bounds.x + bounds.w && p.y >= bounds.y && p.y <= bounds.y + bounds.h);
  const crowded = (p) => taken.some((t) => Math.abs(t.x - p.x) < pitchX * 0.98 && Math.abs(t.y - p.y) < pitchY * 0.98);

  for (let ring = 0; ring <= 60; ring++) {
    const spots = [];
    for (let ix = -ring; ix <= ring; ix++) {
      for (let iy = -ring; iy <= ring; iy++) {
        if (Math.max(Math.abs(ix), Math.abs(iy)) !== ring) continue;
        spots.push({ x: start.x + ix * pitchX, y: start.y + iy * pitchY, far: ix * ix + iy * iy });
      }
    }
    spots.sort((a, b) => a.far - b.far || a.y - b.y || a.x - b.x);
    for (const spot of spots) {
      if (inside(spot) && !crowded(spot)) return { x: spot.x, y: spot.y };
    }
  }
  return start;
}

/* -------------------------------------------- */
/*  Auto layout                                 */
/* -------------------------------------------- */

/**
 * The layout behind "Auto layout": built to stay readable as a court grows.
 *
 *   1. Characters with no bonds are set aside, in tidy rows under the web,
 *      instead of drifting about inside it.
 *   2. Every connected web is laid out on its own by stress majorisation: each
 *      pair of characters is drawn as far apart as they are bonds apart, which
 *      untangles far better than springs and repulsion.
 *   3. Local search removes crossings that are left: neighbours trade places
 *      when that leaves fewer bonds crossing.
 *   4. Portraits are moved off bonds that are not theirs, and apart from each
 *      other.
 *   5. The webs are packed side by side, largest first.
 *
 * With `grouped`, characters sharing a `node.group` are also drawn towards
 * one another, and each group ends up in a rectangle of its own that nobody
 * else stands in: outlines drawn around the groups never overlap. A character
 * with no group ("") stays free, next to whoever they are tied to.
 *
 * Deterministic: the same court always gives the same picture.
 *
 * @param {object[]} nodes               [{ id, group? }]
 * @param {object[]} edges               [{ a, b }]
 * @param {object} [options]
 * @param {number} [options.spacing]     Least distance between two centres.
 * @param {number} [options.stretchX]    Widen the result (cards are wide).
 * @param {boolean} [options.grouped]    Keep each group together.
 * @param {number} [options.aspect]      Wanted width / height of the whole.
 * @param {number} [options.bodyOffset]  How far below its centre a character's
 *                                       visual middle lies (name and captions).
 */
export function autoLayout(nodes, edges, {
  spacing = 260,
  stretchX = 1,
  grouped = false,
  aspect = 1.6,
  bodyOffset = 0
} = {}) {
  const out = new Map();
  const n = nodes.length;
  if (!n) return out;
  if (n === 1) {
    out.set(nodes[0].id, { x: 0, y: 0 });
    return out;
  }

  // Everything is worked out in a space where a character is `spacing` wide
  // and tall; stretching x afterwards makes room for wide cards.
  const settings = { spacing, bond: spacing * 1.35, aspect: aspect / stretchX, bodyOffset };
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const ties = uniqueLinks(edges.map((e) => [index.get(e.a), index.get(e.b)]))
    .map(([a, b]) => ({ a, b, length: settings.bond, real: true }));

  // A group of two or more is held together by an unseen hub that every
  // member is tied to. The hubs are points n, n + 1, ... and are dropped again
  // once they have pulled their group together.
  const blockOf = new Int32Array(n).fill(-1);
  let blocks = 0;
  if (grouped) {
    const byGroup = new Map();
    nodes.forEach((node, i) => {
      const key = String(node.group ?? "");
      if (!key) return;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(i);
    });
    for (const members of byGroup.values()) {
      if (members.length < 2) continue;
      const length = spacing * 0.5 * Math.sqrt(members.length);
      for (const member of members) {
        blockOf[member] = blocks;
        ties.push({ a: member, b: n + blocks, length, real: false });
      }
      blocks += 1;
    }
  }

  const boxes = [];
  const loners = [];
  for (const members of componentsOf(n + blocks, ties)) {
    if (members.length === 1) loners.push(members[0]);
    else boxes.push(webLayout(members, ties, n, blockOf, settings));
  }

  const pos = packWebs(n, boxes, loners, settings);
  nodes.forEach((node, i) => out.set(node.id, { x: pos[i].x * stretchX, y: pos[i].y }));
  return recenter(out);
}

/** Undirected index pairs, each once, without loops or dangling ends. */
function uniqueLinks(pairs) {
  const seen = new Set();
  const links = [];
  for (const [a, b] of pairs) {
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(a < b ? [a, b] : [b, a]);
  }
  return links;
}

/** Connected parts of a graph of `count` points, as sorted lists of indices. */
function componentsOf(count, ties) {
  const next = Array.from({ length: count }, () => []);
  for (const { a, b } of ties) {
    next[a].push(b);
    next[b].push(a);
  }
  const seen = new Uint8Array(count);
  const parts = [];
  for (let i = 0; i < count; i++) {
    if (seen[i]) continue;
    const members = [i];
    seen[i] = 1;
    for (let head = 0; head < members.length; head++) {
      for (const j of next[members[head]]) {
        if (seen[j]) continue;
        seen[j] = 1;
        members.push(j);
      }
    }
    parts.push(members.sort((x, y) => x - y));
  }
  return parts;
}

/**
 * Set the webs side by side in columns, the largest first, with the
 * unattached in rows underneath. Returns a position for each of `n` points.
 */
function packWebs(n, boxes, loners, { spacing, aspect }) {
  const pos = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  const gap = spacing * 0.9;
  boxes.sort((a, b) => b.hw * b.hh - a.hw * a.hh || a.ids[0] - b.ids[0]);
  let area = 0;
  let tallest = 0;
  for (const box of boxes) {
    area += (box.hw * 2 + gap) * (box.hh * 2 + gap);
    tallest = Math.max(tallest, box.hh * 2);
  }
  const limit = Math.max(tallest, Math.sqrt(area / aspect));
  const columns = [];
  for (const box of boxes) {
    const height = box.hh * 2;
    let column = columns.find((c) => c.h + gap + height <= limit * 1.02);
    if (!column) {
      column = { boxes: [], w: 0, h: -gap };
      columns.push(column);
    }
    column.boxes.push(box);
    column.w = Math.max(column.w, box.hw * 2);
    column.h += gap + height;
  }
  let websHeight = 0;
  for (const column of columns) websHeight = Math.max(websHeight, column.h);
  let cursorX = 0;
  for (const column of columns) {
    let cursorY = (websHeight - column.h) / 2;
    for (const box of column.boxes) {
      const cx = cursorX + column.w / 2;
      const cy = cursorY + box.hh;
      box.ids.forEach((id, i) => {
        pos[id] = { x: cx + box.local[i].x, y: cy + box.local[i].y };
      });
      cursorY += box.hh * 2 + gap;
    }
    cursorX += column.w + gap;
  }
  const websWidth = Math.max(0, cursorX - gap);

  if (loners.length) {
    const wide = boxes.length ? Math.floor(websWidth / spacing) + 1 : 0;
    const square = Math.ceil(Math.sqrt(loners.length * aspect));
    const perRow = Math.max(1, Math.min(loners.length, Math.max(wide, square)));
    const rows = Math.ceil(loners.length / perRow);
    const top = boxes.length ? websHeight + gap + spacing / 2 : 0;
    loners.forEach((id, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? loners.length - row * perRow : perRow;
      const left = websWidth / 2 - ((inRow - 1) * spacing) / 2;
      pos[id] = { x: left + (i % perRow) * spacing, y: top + row * spacing };
    });
  }
  return pos;
}

/**
 * One connected web: place by stress, turn it to suit the page, untangle,
 * declutter and give each group its own ground. `members` are point indices;
 * those from `n` up are group hubs. Returns the real members (`ids`), their
 * positions about the web's centre (`local`) and its half width and height.
 */
function webLayout(members, ties, n, blockOf, settings) {
  const { spacing, aspect } = settings;
  const count = members.length;
  const slot = new Map(members.map((member, i) => [member, i]));
  const mine = ties.filter((tie) => slot.has(tie.a));

  // How far apart every pair should be: the shortest chain of ties between
  // them. A bond is a little longer than two neighbours need, for its label.
  const dist = new Float64Array(count * count).fill(Infinity);
  for (let i = 0; i < count; i++) dist[i * count + i] = 0;
  for (const tie of mine) {
    const a = slot.get(tie.a);
    const b = slot.get(tie.b);
    dist[a * count + b] = dist[b * count + a] = tie.length;
  }
  for (let k = 0; k < count; k++) {
    for (let i = 0; i < count; i++) {
      const ik = dist[i * count + k];
      if (ik === Infinity) continue;
      for (let j = 0; j < count; j++) {
        const through = ik + dist[k * count + j];
        if (through < dist[i * count + j]) dist[i * count + j] = through;
      }
    }
  }

  const all = count === 2
    ? [{ x: -dist[1] / 2, y: 0 }, { x: dist[1] / 2, y: 0 }]
    : stressMajorize(count, dist, classicalScaling(count, dist, spacing));

  // Lie along the page: the long axis across for a wide page, down for cards.
  if (count > 2) {
    const angle = principalAngle(all) - (aspect >= 1 ? 0 : Math.PI / 2);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    for (const p of all) {
      const x = p.x * cos - p.y * sin;
      p.y = p.x * sin + p.y * cos;
      p.x = x;
    }
  }

  // The hubs have done their work: carry on with the characters alone.
  const ids = members.filter((member) => member < n);
  const local = ids.map((id) => all[slot.get(id)]);
  const place = new Map(ids.map((id, i) => [id, i]));
  const links = mine.filter((tie) => tie.real).map((tie) => [place.get(tie.a), place.get(tie.b)]);
  const block = ids.map((id) => blockOf[id]);

  untangle(local, links, block, settings);
  declutter(local, links, settings);
  separateBlocks(local, block, settings);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of local) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of local) {
    p.x -= cx;
    p.y -= cy;
  }
  return { ids, local, hw: (maxX - minX + spacing) / 2, hh: (maxY - minY + spacing) / 2 };
}

/**
 * A first guess for stress majorisation: classical multidimensional scaling
 * (the two strongest axes of the distance matrix, found by power iteration).
 * Starting here rather than at random is what keeps the result untangled.
 */
function classicalScaling(n, dist, spacing) {
  const b = new Float64Array(n * n);
  const rowMean = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const sq = dist[i * n + j] ** 2;
      rowMean[i] += sq / n;
      mean += sq / (n * n);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      b[i * n + j] = -0.5 * (dist[i * n + j] ** 2 - rowMean[i] - rowMean[j] + mean);
    }
  }

  const axes = [];
  for (let axis = 0; axis < 2; axis++) {
    let v = Float64Array.from({ length: n }, (_, i) => Math.sin((i + 1) * (axis ? 2.399 : 1.618)) + 0.01 * i);
    let value = 0;
    for (let step = 0; step < 80; step++) {
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += b[i * n + j] * v[j];
        w[i] = sum;
      }
      for (const prev of axes) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += w[i] * prev.v[i];
        for (let i = 0; i < n; i++) w[i] -= dot * prev.v[i];
      }
      let norm = 0;
      let dot = 0;
      for (let i = 0; i < n; i++) {
        norm += w[i] * w[i];
        dot += w[i] * v[i];
      }
      norm = Math.sqrt(norm);
      if (norm < 1e-9) break;
      value = dot;
      for (let i = 0; i < n; i++) w[i] /= norm;
      v = w;
    }
    axes.push({ v, scale: Math.sqrt(Math.max(value, 0)) });
  }

  // A touch of spiral keeps twins (two childer of one sire, say) from
  // starting on the very same spot, and a flat start from staying flat.
  return Array.from({ length: n }, (_, i) => {
    const r = spacing * 0.08 * Math.sqrt((i + 1) / n);
    const t = i * GOLDEN_ANGLE;
    return {
      x: axes[0].v[i] * axes[0].scale + Math.cos(t) * r,
      y: axes[1].v[i] * axes[1].scale + Math.sin(t) * r
    };
  });
}

/**
 * Stress majorisation: move each point, in turn, to the place that best fits
 * its wanted distance to every other point. Near pairs count for more than
 * far ones. Mutates and returns `pos`.
 */
function stressMajorize(n, dist, pos) {
  const steps = n > 220 ? 120 : n > 120 ? 200 : 300;
  for (let step = 0; step < steps; step++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const p = pos[i];
      let sumW = 0;
      let sumX = 0;
      let sumY = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const want = dist[i * n + j];
        const weight = 1 / (want * want);
        let dx = p.x - pos[j].x;
        let dy = p.y - pos[j].y;
        let have = Math.hypot(dx, dy);
        if (have < 1e-6) {
          dx = Math.cos((i + 1) * GOLDEN_ANGLE);
          dy = Math.sin((i + 1) * GOLDEN_ANGLE);
          have = 1;
        }
        sumX += weight * (pos[j].x + (want * dx) / have);
        sumY += weight * (pos[j].y + (want * dy) / have);
        sumW += weight;
      }
      const x = sumX / sumW;
      const y = sumY / sumW;
      moved = Math.max(moved, Math.abs(x - p.x), Math.abs(y - p.y));
      p.x = x;
      p.y = y;
    }
    if (moved < 0.05) break;
  }
  return pos;
}

/** The direction a set of points is longest in. */
function principalAngle(pos) {
  let mx = 0;
  let my = 0;
  for (const p of pos) {
    mx += p.x / pos.length;
    my += p.y / pos.length;
  }
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of pos) {
    xx += (p.x - mx) ** 2;
    yy += (p.y - my) ** 2;
    xy += (p.x - mx) * (p.y - my);
  }
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}

/** Do two segments cross (touching at an end does not count)? */
function segmentsCross(p1, p2, p3, p4) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(p3, p4, p1);
  const d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3);
  const d4 = side(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Remove crossings stress leaves behind, by local search: two characters near
 * each other trade places, or one hops to the middle of the people they are
 * tied to, whenever that leaves fewer bonds crossing. A crossing is held to be
 * as bad as one extra bond's length of line. Members of a group only trade
 * with their own, and stay put otherwise. Mutates `pos`.
 */
function untangle(pos, links, block, { spacing, bond }) {
  const n = pos.length;
  if (n < 4 || links.length < 3) return;
  const mine = Array.from({ length: n }, () => []);
  links.forEach(([a, b], e) => {
    mine[a].push(e);
    mine[b].push(e);
  });
  const stamp = new Int32Array(links.length).fill(-1);
  let tick = 0;
  // The search is cut short on very large webs (about 200 characters and up),
  // so that arranging takes a second at most. Counted in crossing tests.
  let budget = 4e7;

  /** Length of the bonds at these points, plus a bond's length for every crossing on them. */
  const cost = (i, j) => {
    tick += 1;
    let total = 0;
    for (const e of j === undefined ? mine[i] : [...mine[i], ...mine[j]]) {
      if (stamp[e] === tick) continue; // the bond between the two, already counted
      stamp[e] = tick;
      const [a, b] = links[e];
      total += Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y);
      budget -= links.length;
      for (let f = 0; f < links.length; f++) {
        if (stamp[f] === tick) continue; // itself, or a pair already counted
        const [c, d] = links[f];
        if (a === c || a === d || b === c || b === d) continue;
        if (segmentsCross(pos[a], pos[b], pos[c], pos[d])) total += bond;
      }
    }
    return total;
  };

  const reach = bond * 3.2;
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;

    // Trade places.
    for (let i = 0; i < n && budget > 0; i++) {
      for (let j = i + 1; j < n; j++) {
        if (block[i] !== block[j]) continue;
        if (Math.abs(pos[i].x - pos[j].x) > reach || Math.abs(pos[i].y - pos[j].y) > reach) continue;
        const before = cost(i, j);
        const hold = pos[i];
        pos[i] = pos[j];
        pos[j] = hold;
        if (cost(i, j) < before - 1) improved = true;
        else {
          pos[j] = pos[i];
          pos[i] = hold;
        }
      }
    }

    // Hop to the middle of one's ties, if there is room there.
    for (let i = 0; i < n && budget > 0; i++) {
      if (block[i] >= 0 || mine[i].length < 2) continue;
      let x = 0;
      let y = 0;
      for (const e of mine[i]) {
        const other = links[e][0] === i ? links[e][1] : links[e][0];
        x += pos[other].x / mine[i].length;
        y += pos[other].y / mine[i].length;
      }
      let free = true;
      for (let j = 0; j < n && free; j++) {
        if (j !== i && Math.hypot(pos[j].x - x, pos[j].y - y) < spacing) free = false;
      }
      if (!free) continue;
      const before = cost(i);
      const hold = pos[i];
      pos[i] = { x, y };
      if (cost(i) < before - 1) improved = true;
      else pos[i] = hold;
    }
    if (!improved || budget <= 0) break;
  }
}

/**
 * Tidy a web: move characters off the bonds that pass through them, and apart
 * from each other. Ends with separation alone, so no two are left closer than
 * `spacing`. Mutates `pos`.
 */
function declutter(pos, links, { spacing, bodyOffset }) {
  const n = pos.length;
  // A bond must keep clear of a portrait and of the name beneath it.
  const clear = spacing * 0.42;

  const offLinks = () => {
    let moved = false;
    for (let k = 0; k < n; k++) {
      for (const [a, b] of links) {
        if (a === k || b === k) continue;
        const px = pos[k].x;
        const py = pos[k].y + bodyOffset;
        const ex = pos[b].x - pos[a].x;
        const ey = pos[b].y - pos[a].y;
        const len2 = ex * ex + ey * ey;
        if (len2 < 1e-6) continue;
        const along = Math.min(1, Math.max(0, ((px - pos[a].x) * ex + (py - pos[a].y) * ey) / len2));
        let dx = px - (pos[a].x + ex * along);
        let dy = py - (pos[a].y + ey * along);
        const gap = Math.hypot(dx, dy);
        if (gap >= clear) continue;
        if (gap < 1e-6) {
          // Dead on the line: step off sideways.
          const len = Math.sqrt(len2);
          dx = -ey / len;
          dy = ex / len;
        } else {
          dx /= gap;
          dy /= gap;
        }
        // The character steps aside and the bond's ends lean the other way.
        const push = (clear - gap) * 0.35;
        pos[k].x += dx * push;
        pos[k].y += dy * push;
        pos[a].x -= dx * push * (1 - along);
        pos[a].y -= dy * push * (1 - along);
        pos[b].x -= dx * push * along;
        pos[b].y -= dy * push * along;
        moved = true;
      }
    }
    return moved;
  };

  const apart = () => {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[j].x - pos[i].x;
        let dy = pos[j].y - pos[i].y;
        let gap = Math.hypot(dx, dy);
        if (gap >= spacing - 0.01) continue;
        if (gap < 1e-6) {
          dx = Math.cos((i + 1) * GOLDEN_ANGLE);
          dy = Math.sin((i + 1) * GOLDEN_ANGLE);
          gap = 0;
        } else {
          dx /= gap;
          dy /= gap;
        }
        const push = (spacing - gap) / 2;
        pos[i].x -= dx * push;
        pos[i].y -= dy * push;
        pos[j].x += dx * push;
        pos[j].y += dy * push;
        moved = true;
      }
    }
    return moved;
  };

  for (let pass = 0; pass < 40; pass++) {
    const a = offLinks();
    const b = apart();
    if (!a && !b) break;
  }
  for (let pass = 0; pass < 300; pass++) {
    if (!apart()) break;
  }
}

/**
 * Give every group ground of its own: slide whole groups, and the free
 * characters among them, until no group's rectangle overlaps another's or has
 * an outsider standing in it. Groups move as one piece, so nothing inside
 * them changes. Mutates `pos`.
 */
function separateBlocks(pos, block, { spacing }) {
  const groups = new Map();
  const bodies = [];
  block.forEach((b, i) => {
    if (b < 0) bodies.push({ members: [i], group: false });
    else if (groups.has(b)) groups.get(b).members.push(i);
    else {
      groups.set(b, { members: [i], group: true });
      bodies.push(groups.get(b));
    }
  });
  if (!groups.size) return;

  const half = spacing / 2;
  const measure = (body) => {
    body.x0 = body.y0 = Infinity;
    body.x1 = body.y1 = -Infinity;
    for (const i of body.members) {
      body.x0 = Math.min(body.x0, pos[i].x - half);
      body.y0 = Math.min(body.y0, pos[i].y - half);
      body.x1 = Math.max(body.x1, pos[i].x + half);
      body.y1 = Math.max(body.y1, pos[i].y + half);
    }
  };
  const shift = (body, dx, dy) => {
    for (const i of body.members) {
      pos[i].x += dx;
      pos[i].y += dy;
    }
    body.x0 += dx;
    body.x1 += dx;
    body.y0 += dy;
    body.y1 += dy;
  };

  for (const body of bodies) measure(body);
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const shareA = b.members.length / (a.members.length + b.members.length);
        if (!a.group && !b.group) {
          // Two free characters: keep them a spacing apart, as discs.
          const p = pos[a.members[0]];
          const q = pos[b.members[0]];
          const gap = Math.hypot(q.x - p.x, q.y - p.y);
          if (gap >= spacing - 0.01) continue;
          const ux = gap < 1e-6 ? 1 : (q.x - p.x) / gap;
          const uy = gap < 1e-6 ? 0 : (q.y - p.y) / gap;
          shift(a, (-ux * (spacing - gap)) / 2, (-uy * (spacing - gap)) / 2);
          shift(b, (ux * (spacing - gap)) / 2, (uy * (spacing - gap)) / 2);
          moved = true;
          continue;
        }
        // Room between two outlines for their titles; less beside one person.
        const pad = a.group && b.group ? spacing * 0.5 : spacing * 0.2;
        const right = a.x1 - b.x0 + pad; // b leaves by a's right side
        const left = b.x1 - a.x0 + pad;
        const down = a.y1 - b.y0 + pad;
        const up = b.y1 - a.y0 + pad;
        if (right <= 0.01 || left <= 0.01 || down <= 0.01 || up <= 0.01) continue;
        const least = Math.min(right, left, down, up);
        let dx = 0;
        let dy = 0;
        if (least === right) dx = right;
        else if (least === left) dx = -left;
        else if (least === down) dy = down;
        else dy = -up;
        shift(a, -dx * shareA, -dy * shareA);
        shift(b, dx * (1 - shareA), dy * (1 - shareA));
        moved = true;
      }
    }
    if (!moved) break;
  }
}
