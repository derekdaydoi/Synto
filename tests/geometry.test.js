import { test, eq, ok, near, nearPt } from './harness.js';
import * as G from '../app/src/geometry.js';

test('geometry: rotate 90° around origin', () => nearPt(G.rotate([1, 0], [0, 0], Math.PI / 2), [0, 1]));
test('geometry: rotate with zero angle returns a copy', () => { const p = [3, 4]; const r = G.rotate(p, [0, 0], 0); eq(r, [3, 4]); ok(r !== p); });
test('geometry: distance to segment (inside, beyond ends, degenerate)', () => {
  near(G.distToSegment([5, 3], [0, 0], [10, 0]), 3);
  near(G.distToSegment([-4, 3], [0, 0], [10, 0]), 5);
  near(G.distToSegment([3, 4], [0, 0], [0, 0]), 5);
});
test('geometry: segment intersection, parallel and disjoint', () => {
  nearPt(G.segmentIntersection([0, 0], [10, 10], [0, 10], [10, 0]), [5, 5]);
  eq(G.segmentIntersection([0, 0], [10, 0], [0, 1], [10, 1]), null);
  eq(G.segmentIntersection([0, 0], [1, 1], [5, 0], [6, -1]), null);
  nearPt(G.segmentIntersection([0, 0], [10, 0], [10, -5], [10, 5]), [10, 0], 1e-9, 'touching endpoint');
});
test('geometry: point in polygon and rings with hole', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  ok(G.pointInPolygon([5, 5], sq));
  ok(!G.pointInPolygon([15, 5], sq));
  const hole = [[3, 3], [7, 3], [7, 7], [3, 7]];
  ok(!G.pointInRings([5, 5], [sq, hole]), 'inside hole');
  ok(G.pointInRings([1, 1], [sq, hole]), 'inside ring');
});
test('geometry: circle through 3 points; collinear returns null', () => {
  const c = G.circleFrom3([1, 0], [0, 1], [-1, 0]);
  near(c.cx, 0); near(c.cy, 0); near(c.r, 1);
  eq(G.circleFrom3([0, 0], [1, 1], [2, 2]), null);
});
test('geometry: arc through 3 points passes through the middle point', () => {
  for (const [a, b, c] of [[[0, 0], [5, -5], [10, 0]], [[0, 0], [5, 5], [10, 0]], [[0, 0], [-3, 6], [2, 10]]]) {
    const arc = G.arcThrough(a, b, c);
    const pts = G.sampleArc(arc, 400);
    nearPt(pts[0], a, 1e-6, 'start');
    nearPt(pts[pts.length - 1], c, 1e-6, 'end');
    const dmin = Math.min(...pts.map((p) => G.dist(p, b)));
    ok(dmin < 0.2, 'middle point on arc, got ' + dmin);
  }
});
test('geometry: Catmull-Rom passes through all points', () => {
  const pts = [[0, 0], [10, 5], [20, 0], [30, 10]];
  const segs = G.catmullRomToBezier(pts);
  eq(segs.length, 3);
  segs.forEach((s, i) => { nearPt(s[0], pts[i]); nearPt(s[3], pts[i + 1]); });
});
test('geometry: snapAngle locks to 15° steps and keeps length', () => {
  const p = G.snapAngle([0, 0], [10, 1]);
  near(p[1], 0, 1e-9); near(G.dist([0, 0], p), Math.hypot(10, 1));
});
test('geometry: bounds of empty list are finite', () => eq(G.boundsOfPoints([]), { minX: 0, minY: 0, maxX: 0, maxY: 0 }));
