// Pure 2D geometry. Points are [x, y] arrays. No DOM access here.

export const EPS = 1e-9;

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function rotate(p, c, angle) {
  if (!angle) return [p[0], p[1]];
  const s = Math.sin(angle), co = Math.cos(angle);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co];
}

/** Closest point on segment ab to p, with the segment parameter t in [0, 1]. */
export function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return { point: [a[0], a[1]], t: 0 };
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { point: [a[0] + t * dx, a[1] + t * dy], t };
}

export const distToSegment = (p, a, b) => dist(p, projectOnSegment(p, a, b).point);

/** Intersection of segments ab and cd (endpoints included); null if parallel or apart. */
export function segmentIntersection(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1];
  const s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < EPS) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * s1 - qy * s0) / den;
  const u = (qx * r1 - qy * r0) / den;
  const tol = 1e-9;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  return [a[0] + t * r0, a[1] + t * r1];
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd across several rings (holes work naturally). */
export function pointInRings(p, rings) {
  let inside = false;
  for (const r of rings) if (r.length > 2 && pointInPolygon(p, r)) inside = !inside;
  return inside;
}

export function distToPolyline(p, pts, closed = false) {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return dist(p, pts[0]);
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (d < best) best = d;
  }
  return best;
}

export function boundsOfPoints(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export const boundsIntersect = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const boundsContain = (outer, inner) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export function unionBounds(list) {
  let b = null;
  for (const x of list) {
    if (!b) b = { ...x };
    else {
      b.minX = Math.min(b.minX, x.minX); b.minY = Math.min(b.minY, x.minY);
      b.maxX = Math.max(b.maxX, x.maxX); b.maxY = Math.max(b.maxY, x.maxY);
    }
  }
  return b;
}

/** Uniform Catmull-Rom through points, as cubic Bezier segments [p0, c1, c2, p1]. */
export function catmullRomToBezier(points, tension = 0.5) {
  const segs = [];
  if (points.length < 2) return segs;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const k = tension / 3 * 2;
    const c1 = [p1[0] + (p2[0] - p0[0]) * k / 2, p1[1] + (p2[1] - p0[1]) * k / 2];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k / 2, p2[1] - (p3[1] - p1[1]) * k / 2];
    segs.push([p1, c1, c2, p2]);
  }
  return segs;
}

export function cubicAt(p0, c1, c2, p1, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
}

export function quadAt(p0, c, p1, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

/** Circle through three points, or null when they are (nearly) collinear. */
export function circleFrom3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

/**
 * Arc from a through b to c. Returns {cx, cy, r, start, end, ccw} or null if collinear.
 * Angles in radians; ccw tells which way to sweep from start to end so that b is on the arc.
 */
export function arcThrough(a, b, c) {
  const circ = circleFrom3(a, b, c);
  if (!circ) return null;
  const ang = (p) => Math.atan2(p[1] - circ.cy, p[0] - circ.cx);
  const sa = ang(a), sb = ang(b), sc = ang(c);
  const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Going clockwise (increasing angle in screen coords) from a: is b reached before c?
  const cwB = norm(sb - sa), cwC = norm(sc - sa);
  const ccw = !(cwB < cwC);
  return { ...circ, start: sa, end: sc, ccw };
}

export function sampleArc(arc, segments = 48) {
  const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(arc.end - arc.start);
  if (arc.ccw) sweep = sweep - 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = arc.start + (sweep * i) / segments;
    pts.push([arc.cx + arc.r * Math.cos(t), arc.cy + arc.r * Math.sin(t)]);
  }
  return pts;
}

/** Snap an angle to the nearest multiple of step (radians). */
export function snapAngle(from, to, step = Math.PI / 12) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len];
}

export function polylineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}
