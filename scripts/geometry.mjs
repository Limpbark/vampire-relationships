/**
 * Pure geometry helpers for routing bonds between nodes.
 * No PIXI and no Foundry here: everything takes and returns plain {x, y} points.
 *
 * A node "shape" is either
 *   { kind: "circle", cx, cy, r }            (constellation portraits)
 *   { kind: "rect", x, y, w, h }             (cards)
 */

export function shapeCenter(shape) {
  if (shape.kind === "circle") return { x: shape.cx, y: shape.cy };
  return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
}

/** The point where a ray from the shape's centre toward `toward` leaves the shape. */
export function shapeAnchor(shape, toward, gap = 0) {
  const c = shapeCenter(shape);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return c;
  if (shape.kind === "circle") {
    const r = shape.r + gap;
    return { x: c.x + (dx / dist) * r, y: c.y + (dy / dist) * r };
  }
  const hw = shape.w / 2 + gap;
  const hh = shape.h / 2 + gap;
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** Axis-aligned bounds of a shape as {x, y, w, h}. */
export function shapeBounds(shape) {
  if (shape.kind === "circle") {
    return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: shape.r * 2, h: shape.r * 2 };
  }
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
}

/**
 * Route one bond as a quadratic curve.
 * `bend` is the signed distance the control point sits off the straight line
 * (0 gives a straight bond). Anchors sit on each shape's border, facing the
 * control point, so curved bonds leave their nodes at a natural angle.
 */
export function routeEdge(shapeA, shapeB, bend = 0, gap = 0) {
  const a = shapeCenter(shapeA);
  const b = shapeCenter(shapeB);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const c = { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend };
  const p0 = shapeAnchor(shapeA, c, gap);
  const p1 = shapeAnchor(shapeB, c, gap);
  return { p0, c, p1 };
}

export function quadPoint(p0, c, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y
  };
}

/** Sample a quadratic curve into a polyline with `segments` pieces. */
export function sampleQuad(p0, c, p1, segments = 24) {
  const n = Math.max(1, Math.floor(segments));
  const pts = new Array(n + 1);
  for (let i = 0; i <= n; i++) pts[i] = quadPoint(p0, c, p1, i / n);
  return pts;
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Point at a given distance along a polyline (clamped to its ends). */
export function pointAtLength(points, distance) {
  if (!points.length) return { x: 0, y: 0 };
  if (distance <= 0) return { ...points[0] };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + seg >= distance && seg > 0) {
      const t = (distance - walked) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += seg;
  }
  return { ...points[points.length - 1] };
}

/** The part of a polyline between two distances along it. */
export function slicePolyline(points, from, to) {
  const out = [];
  if (points.length < 2 || to <= from) return out;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const start = walked;
    const end = walked + seg;
    walked = end;
    if (seg === 0 || end < from) continue;
    if (start > to) break;
    const t0 = Math.max(0, (from - start) / seg);
    const t1 = Math.min(1, (to - start) / seg);
    const pa = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
    const pb = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
    if (!out.length) out.push(pa);
    out.push(pb);
  }
  return out;
}

/**
 * Break a polyline into dashes.
 * `pattern` is [dash, gap, dash, gap, ...] in the same units as the points.
 * Returns an array of polylines, one per dash.
 */
export function dashPolyline(points, pattern) {
  if (!pattern || pattern.length < 2) return [points];
  const total = polylineLength(points);
  const dashes = [];
  let at = 0;
  let i = 0;
  let guard = 0;
  while (at < total && guard++ < 5000) {
    const span = Math.max(0.5, pattern[i % pattern.length]);
    if (i % 2 === 0) {
      const piece = slicePolyline(points, at, Math.min(total, at + span));
      if (piece.length > 1) dashes.push(piece);
    }
    at += span;
    i++;
  }
  return dashes;
}

/**
 * Arrowhead geometry for the end of a polyline.
 * Returns the three corners plus the polyline shortened so the stroke stops
 * at the base of the arrowhead instead of poking through its tip.
 */
export function arrowHead(points, length, width) {
  const total = polylineLength(points);
  if (points.length < 2 || total < length * 1.5) return null;
  const tip = points[points.length - 1];
  const base = pointAtLength(points, total - length);
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const d = Math.hypot(dx, dy) || 1;
  const px = (-dy / d) * (width / 2);
  const py = (dx / d) * (width / 2);
  return {
    tip,
    left: { x: base.x + px, y: base.y + py },
    right: { x: base.x - px, y: base.y - py },
    shaft: slicePolyline(points, 0, total - length * 0.85)
  };
}

/**
 * Spread parallel bonds between the same two nodes.
 * Returns the bend for bond `index` of `count`, as a multiple of `spread`.
 */
export function parallelOffset(index, count) {
  return index - (count - 1) / 2;
}

/** Bounding box of several {x, y, w, h} rectangles, or null when empty. */
export function unionBounds(rects) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!r) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
