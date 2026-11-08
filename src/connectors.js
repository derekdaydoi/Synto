// Connectors: line ends bound to elements. A bound end sits on the element's outline, on the
// side facing the other end, and follows the element when it moves or resizes.

import { segmentIntersection, pointInRings, distToPolyline, dist } from './geometry.js';
import { center, corners, worldPolylines, worldPoints, withWorldPoints, localGeometry, toLocal, updateElement } from './elements.js';

export const isBindable = (el) => !!el && el.type !== 'line' && el.type !== 'draw';

const GAP = 6; // world px between the outline and the line end

/** Point on el's outline along the ray from its center toward `toward`, pushed out by gap. */
export function borderPoint(el, toward, gap = GAP) {
  const c = center(el);
  const dx = toward[0] - c[0], dy = toward[1] - c[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return c;
  const ux = dx / len, uy = dy / len;
  const reach = Math.hypot(el.w, el.h) + 10;
  const far = [c[0] + ux * reach, c[1] + uy * reach];
  let best = null, bestD = -1;
  const scan = (polys) => {
    for (const s of polys) {
      const pts = s.points;
      const n = s.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const x = segmentIntersection(c, far, pts[i], pts[(i + 1) % pts.length]);
        if (x) {
          const d = dist(c, x);
          if (d > bestD) { bestD = d; best = x; } // outermost crossing (works for concave shapes)
        }
      }
    }
  };
  scan(worldPolylines(el));
  if (!best) scan([{ points: corners(el), closed: true }]); // open shapes: fall back to the box
  if (!best) return c;
  return [best[0] + ux * gap, best[1] + uy * gap];
}

/**
 * True when a line end at p should attach to el: p is INSIDE the element, at least `margin`
 * away from its outline. Ends placed on the outline (snapped vertices, midpoints, edges) stay
 * free so exact geometric constructions are never moved.
 */
export function insideForBinding(el, p, margin) {
  if (!isBindable(el)) return false;
  const lp = toLocal(el, p);
  const inBox = lp[0] >= margin && lp[1] >= margin && lp[0] <= el.w - margin && lp[1] <= el.h - margin;
  if (!inBox) return false;
  if (el.type !== 'shape' || el.label) return true;
  // Snapped exactly to the center of a plain shape (e.g. a circle's radius): geometry, not a connector.
  if (dist(p, center(el)) < 0.5) return false;
  const g = localGeometry(el);
  const rings = g.polylines.filter((s) => s.closed).map((s) => s.points);
  if (!rings.length || !pointInRings(lp, rings)) return false;
  return !g.polylines.some((s) => distToPolyline(lp, s.points, s.closed) < margin);
}

/** Topmost element a line end dropped at p should attach to (or null). */
export function bindingTargetAt(elements, p, margin, excludeIds) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (excludeIds && excludeIds.has(el.id)) continue;
    if (insideForBinding(el, p, margin)) return el;
  }
  return null;
}

/**
 * Recomputes bound ends. `changedIds` (optional) limits work to lines touching those elements.
 * Bindings to missing elements are dropped. Returns the same array when nothing changed.
 */
export function reflowConnectors(elements, changedIds) {
  let byId = null;
  let out = null;
  for (let i = 0; i < elements.length; i++) {
    const line = elements[i];
    if (line.type !== 'line' || (!line.startBinding && !line.endBinding)) continue;
    if (changedIds && !changedIds.has(line.id) && !changedIds.has(line.startBinding) && !changedIds.has(line.endBinding)) continue;
    if (!byId) byId = new Map(elements.map((e) => [e.id, e]));
    const A = line.startBinding ? byId.get(line.startBinding) : null;
    const B = line.endBinding ? byId.get(line.endBinding) : null;
    const pts = worldPoints(line);
    if (pts.length < 2) continue;
    const n = pts.length;
    const next = pts.map((p) => [p[0], p[1]]);
    // Straight connectors aim center-to-center; multi-point lines aim at their neighbour point.
    if (A) next[0] = borderPoint(A, B && n === 2 ? center(B) : pts[1]);
    if (B) next[n - 1] = borderPoint(B, A && n === 2 ? center(A) : pts[n - 2]);
    const lostA = line.startBinding && !A, lostB = line.endBinding && !B;
    const moved = next.some((p, k) => Math.abs(p[0] - pts[k][0]) > 0.01 || Math.abs(p[1] - pts[k][1]) > 0.01);
    if (!moved && !lostA && !lostB) continue;
    let updated = moved ? withWorldPoints(line, next) : line;
    if (lostA || lostB) updated = updateElement(updated, { startBinding: A ? line.startBinding : null, endBinding: B ? line.endBinding : null });
    if (!out) out = elements.slice();
    out[i] = updated;
  }
  return out || elements;
}

/**
 * After elements were removed: drops connectors attached to a removed element and clears
 * mind-map parents that no longer exist.
 */
export function dropDangling(elements, removedIds) {
  if (!removedIds.size) return elements;
  return elements
    .filter((e) => !(e.type === 'line' && (removedIds.has(e.startBinding) || removedIds.has(e.endBinding))))
    .map((e) => (e.parentId && removedIds.has(e.parentId) ? { ...e, parentId: null, version: e.version + 1 } : e));
}

/** Re-points bindings/parents of copied elements to the copies (or drops them when not copied). */
export function remapReferences(copies, idMap) {
  return copies.map((e) => {
    const patch = {};
    for (const k of ['startBinding', 'endBinding', 'parentId']) {
      if (e[k]) patch[k] = idMap.get(e[k]) || null;
    }
    return Object.keys(patch).length ? { ...e, ...patch } : e;
  });
}
