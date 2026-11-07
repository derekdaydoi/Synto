import { test, eq, ok, near, throws } from './harness.js';
import { parsePath, pathToString, transformPath, flattenPath, pathBounds, closedSubpaths, pathKeyPoints } from '../app/src/svgpath.js';

test('svgpath: relative and shorthand commands become absolute', () => {
  const c = parsePath('M3 6h18v12H3z');
  eq(c.map((k) => k.c).join(''), 'MLLLZ');
  eq(c[1].p, [21, 6]); eq(c[2].p, [21, 18]); eq(c[3].p, [3, 18]);
});
test('svgpath: implicit lineto after moveto', () => {
  const c = parsePath('M0 0 10 0 10 10z');
  eq(c.map((k) => k.c).join(''), 'MLLZ');
});
test('svgpath: compact numbers like 1.5.5 and exponents', () => {
  const c = parsePath('M1.5.5L1e1-2');
  eq(c[0].p, [1.5, 0.5]); eq(c[1].p, [10, -2]);
});
test('svgpath: arc flags written without separators', () => {
  const c = parsePath('M0 0a5 5 0 015 5');
  eq(c[1].c, 'A'); eq(c[1].large, 0); eq(c[1].sweep, 1); eq(c[1].p, [5, 5]);
});
test('svgpath: S and T reflect control points', () => {
  const c = parsePath('M0 0C0 10 10 10 10 0S20-10 20 0');
  eq(c[2].c1, [10, -10]);
  const q = parsePath('M0 0Q5 10 10 0T20 0');
  eq(q[2].c1, [15, -10]);
});
test('svgpath: invalid input throws', () => {
  throws(() => parsePath('10 10'));
  throws(() => parsePath('M10'));
});
test('svgpath: full circle from two arcs has correct bounds', () => {
  const b = pathBounds(parsePath('M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0'));
  near(b.minX, 3, 0.2); near(b.maxX, 21, 0.2); near(b.minY, 3, 0.2); near(b.maxY, 21, 0.2);
});
test('svgpath: transform scales arcs and round-trips through string', () => {
  const t = transformPath(parsePath('M0 0A5 5 0 0 1 10 0'), 2, 3, 1, 1);
  eq(t[1].rx, 10); eq(t[1].ry, 15); eq(t[1].p, [21, 1]);
  const again = parsePath(pathToString(t));
  eq(again[1].p, [21, 1]);
});
test('svgpath: closedSubpaths drops open strokes', () => {
  const c = closedSubpaths(parsePath('M0 0h10v10z M20 20h5'));
  eq(c.map((k) => k.c).join(''), 'MLLZ');
});
test('svgpath: flatten marks closed subpaths', () => {
  const f = flattenPath(parsePath('M0 0h10v10zM20 20h5'));
  eq(f.length, 2); ok(f[0].closed); ok(!f[1].closed);
});
test('svgpath: key points include closing-edge midpoint', () => {
  const k = pathKeyPoints(parsePath('M0 0h10v10z'));
  eq(k.vertices.length, 3);
  ok(k.midpoints.some((p) => p[0] === 5 && p[1] === 5), 'diagonal midpoint');
});
