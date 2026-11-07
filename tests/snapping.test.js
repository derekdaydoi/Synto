import { test, eq, ok, nearPt } from './harness.js';
import { findSnap, snapMove, DEFAULT_SNAP } from '../app/src/snapping.js';
import { createElement, withWorldPoints } from '../app/src/elements.js';

const tri = () => withWorldPoints(createElement('line', { kind: 'polyline' }), [[0, 100], [100, 100], [50, 0], [0, 100]]);
const opts = (extra = {}) => ({ radius: 12, settings: { ...DEFAULT_SNAP }, ...extra });

test('snap: vertex of a polyline', () => {
  const s = findSnap([tri()], [97, 103], opts());
  eq(s.type, 'vertex'); nearPt(s.point, [100, 100]);
});

test('snap: midpoint of a segment', () => {
  const s = findSnap([tri()], [52, 96], opts());
  eq(s.type, 'midpoint'); nearPt(s.point, [50, 100]);
});

test('snap: center of a shape', () => {
  const c = createElement('shape', { shapeId: 'circle', x: 0, y: 0, w: 80, h: 80 });
  const s = findSnap([c], [43, 38], opts());
  eq(s.type, 'center'); nearPt(s.point, [40, 40]);
});

test('snap: intersection between two different elements', () => {
  const a = withWorldPoints(createElement('line'), [[0, 0], [100, 100]]);
  const b = withWorldPoints(createElement('line'), [[0, 100], [100, 0]]);
  const s = findSnap([a, b], [58, 47], opts({ settings: { ...DEFAULT_SNAP, midpoint: false } }));
  eq(s.type, 'intersection'); nearPt(s.point, [50, 50]);
});

test('snap: perpendicular foot from the line start', () => {
  const base = withWorldPoints(createElement('line'), [[0, 100], [200, 100]]);
  const s = findSnap([base], [63, 95], opts({ from: [60, 20], settings: { ...DEFAULT_SNAP, midpoint: false, vertex: false } }));
  eq(s.type, 'perpendicular'); nearPt(s.point, [60, 100]);
});

test('snap: disabled settings and excluded elements', () => {
  eq(findSnap([tri()], [97, 103], opts({ settings: { ...DEFAULT_SNAP, enabled: false } })), null);
  const t = tri();
  eq(findSnap([t], [97, 103], opts({ excludeIds: new Set([t.id]) })), null);
  eq(findSnap([tri()], [500, 500], opts()), null, 'far away');
});

test('snap: vertex wins over on-edge when both are close', () => {
  const s = findSnap([tri()], [96, 100], opts());
  eq(s.type, 'vertex');
});

test('snap: on-edge is used when no named point is in range', () => {
  const s = findSnap([tri()], [25, 103], opts());
  eq(s.type, 'edge'); nearPt(s.point, [25, 100]);
});

test('snap: closed circle (implicit close) is fillable and hit inside', async () => {
  const { hitTest } = await import('../app/src/elements.js');
  const c = createElement('shape', { shapeId: 'ellipse', x: 0, y: 0, w: 100, h: 60, fillColor: '#a5d8ff' });
  ok(hitTest(c, [50, 30], 1));
});

test('snapMove: aligns moving box corner to a vertex', () => {
  const r = snapMove([tri()], { minX: 103, minY: 97, maxX: 150, maxY: 140 }, new Set(), 12, DEFAULT_SNAP);
  ok(r); nearPt([r.dx, r.dy], [-3, 3]);
});
