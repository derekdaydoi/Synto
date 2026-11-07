import { test, eq, ok, near } from './harness.js';
import { SHAPE_GROUPS, SHAPES, shapeGeometry, regularPolygonPath, starPath } from '../app/src/shapelib.js';
import { parsePath } from '../app/src/svgpath.js';
import { boundsOfPoints } from '../app/src/geometry.js';

test('shapes: library has 63 unique shapes in 7 groups', () => {
  eq(SHAPE_GROUPS.length, 7);
  const ids = SHAPE_GROUPS.flatMap((g) => g.items.map((s) => s.id));
  eq(ids.length, 63);
  eq(new Set(ids).size, 63, 'unique ids');
});

test('shapes: every shape fills its box exactly at several aspect ratios', () => {
  for (const id of SHAPES.keys()) {
    for (const [w, h] of [[100, 100], [240, 60], [30, 200], [1, 1]]) {
      const g = shapeGeometry(id, {}, w, h);
      const pts = g.polylines.flatMap((s) => s.points);
      ok(pts.length > 1, id + ' has points');
      ok(pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])), id + ' finite');
      const b = boundsOfPoints(pts);
      near(b.minX, 0, 0.6 * Math.max(1, w / 100), `${id} ${w}x${h} minX`);
      near(b.minY, 0, 0.6 * Math.max(1, h / 100), `${id} ${w}x${h} minY`);
      near(b.maxX, w, 0.6 * Math.max(1, w / 100), `${id} ${w}x${h} maxX`);
      near(b.maxY, h, 0.6 * Math.max(1, h / 100), `${id} ${w}x${h} maxY`);
    }
  }
});

test('shapes: open shapes have no fill commands', () => {
  for (const [id, def] of SHAPES) {
    const g = shapeGeometry(id, {}, 100, 100);
    if (def.closed === false) eq(g.fillCmds.length, 0, id);
  }
});

test('shapes: regular polygon clamps sides and is closed', () => {
  eq(parsePath(regularPolygonPath(2)).filter((k) => k.c !== 'Z').length, 3);
  eq(parsePath(regularPolygonPath(99)).filter((k) => k.c !== 'Z').length, 24);
  eq(parsePath(regularPolygonPath(7)).filter((k) => k.c !== 'Z').length, 7);
});

test('shapes: star has 2n vertices', () => {
  eq(parsePath(starPath(5, 0.4)).filter((k) => k.c !== 'Z').length, 10);
});

test('shapes: unknown shape id falls back to rectangle', () => {
  const g = shapeGeometry('nope', {}, 10, 10);
  eq(g.keyPoints.vertices.length, 4);
});
