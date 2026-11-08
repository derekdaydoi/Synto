// Object snapping ("auto hit"): vertices, midpoints, centers, intersections, perpendicular feet, on-edge.
// All inputs and outputs are in world coordinates; `radius` is in world units.

import { dist, segmentIntersection, projectOnSegment } from './geometry.js';
import { getBounds, snapPointsOf, worldPolylines } from './elements.js';

export const SNAP_LABELS = {
  vertex: 'Đỉnh / đầu mút',
  midpoint: 'Trung điểm',
  center: 'Tâm',
  intersection: 'Giao điểm',
  perpendicular: 'Vuông góc',
  edge: 'Trên cạnh',
};

export const DEFAULT_SNAP = {
  enabled: true, vertex: true, midpoint: true, center: true, intersection: true, perpendicular: true, edge: true,
};

// Lower number wins when two candidates are about equally close.
const PRIORITY = { vertex: 0, intersection: 1, midpoint: 2, center: 3, perpendicular: 4, edge: 5 };

function nearby(elements, p, radius, excludeIds) {
  const out = [];
  for (const el of elements) {
    if (excludeIds && excludeIds.has(el.id)) continue;
    const b = getBounds(el);
    if (p[0] < b.minX - radius || p[0] > b.maxX + radius || p[1] < b.minY - radius || p[1] > b.maxY + radius) continue;
    out.push(el);
  }
  return out;
}

function segmentsNear(el, p, radius) {
  const segs = [];
  for (const s of worldPolylines(el)) {
    const pts = s.points;
    const n = s.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const minX = Math.min(a[0], b[0]) - radius, maxX = Math.max(a[0], b[0]) + radius;
      const minY = Math.min(a[1], b[1]) - radius, maxY = Math.max(a[1], b[1]) + radius;
      if (p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY) segs.push([a, b, el.id]);
    }
  }
  return segs;
}

/**
 * Find the best snap target near p.
 * opts: {radius, settings, excludeIds:Set, from:[x,y] (start of the line being drawn, enables perpendicular)}
 * Returns {point, type, label} or null.
 */
export function findSnap(elements, p, opts) {
  const s = opts.settings || DEFAULT_SNAP;
  if (!s.enabled) return null;
  const radius = opts.radius;
  const els = nearby(elements, p, radius, opts.excludeIds);
  if (!els.length) return null;
  const cands = [];
  const add = (point, type) => {
    const d = dist(point, p);
    if (d <= radius) cands.push({ point, type, d });
  };
  for (const el of els) {
    const k = snapPointsOf(el);
    if (s.vertex) k.vertices.forEach((q) => add(q, 'vertex'));
    if (s.midpoint) k.midpoints.forEach((q) => add(q, 'midpoint'));
    if (s.center) k.centers.forEach((q) => add(q, 'center'));
  }
  const needSegs = s.intersection || s.perpendicular || s.edge;
  if (needSegs) {
    const segs = [];
    for (const el of els) segs.push(...segmentsNear(el, p, radius));
    if (s.intersection && segs.length < 4000) {
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          if (segs[i][2] === segs[j][2]) continue; // only intersections between different elements
          const x = segmentIntersection(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
          if (x) add(x, 'intersection');
        }
      }
    }
    if (s.perpendicular && opts.from) {
      for (const [a, b] of segs) {
        const { point, t } = projectOnSegment(opts.from, a, b);
        if (t > 0.001 && t < 0.999 && dist(point, opts.from) > 1) add(point, 'perpendicular');
      }
    }
    if (s.edge) {
      for (const [a, b] of segs) add(projectOnSegment(p, a, b).point, 'edge');
    }
  }
  if (!cands.length) return null;
  // Named points (vertex, intersection, midpoint, center, perpendicular) always beat the
  // generic "on edge" snap; among them the closest wins, priority breaks near-ties.
  const named = cands.filter((c) => c.type !== 'edge');
  const pool = named.length ? named : cands;
  pool.sort((A, B) => (A.d + PRIORITY[A.type] * 0.01) - (B.d + PRIORITY[B.type] * 0.01));
  const best = pool[0];
  return { point: best.point, type: best.type, label: SNAP_LABELS[best.type] };
}

/**
 * Snap a moving selection: tries its bounding-box key points against other elements' snap points.
 * Returns {dx, dy, snap} with the extra offset to apply, or null.
 */
export function snapMove(elements, movingBounds, excludeIds, radius, settings) {
  const s = settings || DEFAULT_SNAP;
  if (!s.enabled) return null;
  const b = movingBounds;
  const refs = [
    [b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY],
    [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
  ];
  let best = null;
  for (const el of elements) {
    if (excludeIds.has(el.id)) continue;
    const eb = getBounds(el);
    if (eb.minX > b.maxX + radius || eb.maxX < b.minX - radius || eb.minY > b.maxY + radius || eb.maxY < b.minY - radius) continue;
    const k = snapPointsOf(el);
    const targets = [];
    if (s.vertex) targets.push(...k.vertices.map((q) => [q, 'vertex']));
    if (s.midpoint) targets.push(...k.midpoints.map((q) => [q, 'midpoint']));
    if (s.center) targets.push(...k.centers.map((q) => [q, 'center']));
    for (const r of refs) {
      for (const [q, type] of targets) {
        const d = dist(r, q);
        if (d <= radius && (!best || d < best.d)) best = { d, dx: q[0] - r[0], dy: q[1] - r[1], snap: { point: q, type, label: SNAP_LABELS[type] } };
      }
    }
  }
  return best;
}
