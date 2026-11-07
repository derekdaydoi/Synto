import { test, eq, ok, near } from './harness.js';
import {
  createElement, updateElement, sanitizeElement, hitTest, getBounds, withWorldPoints, worldPoints, toLocal, toWorld,
  pdfLayout, pdfCurrentPage, linePathD, linePolyline,
} from '../app/src/elements.js';
import { parsePath } from '../app/src/svgpath.js';
import { History } from '../app/src/history.js';

test('elements: update is immutable and bumps version', () => {
  const a = createElement('shape', { x: 1 });
  const b = updateElement(a, { x: 2 });
  ok(a !== b); eq(a.x, 1); eq(b.x, 2); eq(b.version, a.version + 1);
});

test('elements: withWorldPoints anchors bounds at (0,0)', () => {
  const el = withWorldPoints(createElement('line'), [[10, 20], [30, 5], [15, 40]]);
  eq([el.x, el.y, el.w, el.h], [10, 5, 20, 35]);
  eq(worldPoints(el), [[10, 20], [30, 5], [15, 40]]);
});

test('elements: local/world round trip with rotation', () => {
  const el = createElement('shape', { x: 10, y: 20, w: 100, h: 50, angle: 0.7 });
  const p = [37, 61];
  const q = toWorld(el, toLocal(el, p));
  near(q[0], p[0]); near(q[1], p[1]);
});

test('elements: hit test rotated rectangle stroke and empty interior', () => {
  const el = createElement('shape', { shapeId: 'rect', x: 0, y: 0, w: 100, h: 100, angle: Math.PI / 4 });
  // Interior of an unfilled shape should not hit; the stroke should.
  ok(!hitTest(el, [50, 50], 2), 'empty interior');
  const top = toWorld(el, [50, 25]); // the rect path spans y 25..75 of its 24-box -> stretched to full box
  ok(hitTest(el, toWorld(el, [50, 0]), 3), 'on stroke');
  void top;
});

test('elements: filled shape hits inside', () => {
  const el = createElement('shape', { shapeId: 'circle', x: 0, y: 0, w: 100, h: 100, fillColor: '#ffc9c9' });
  ok(hitTest(el, [50, 50], 1));
  ok(!hitTest(el, [3, 3], 1), 'outside the circle but inside the box');
});

test('elements: text box hit test uses the box', () => {
  const el = createElement('text', { x: 0, y: 0, w: 50, h: 20, text: 'hi' });
  ok(hitTest(el, [25, 10], 0));
  ok(!hitTest(el, [80, 10], 2));
});

test('elements: bounds include rotation', () => {
  const el = createElement('shape', { x: 0, y: 0, w: 100, h: 0.0001, angle: Math.PI / 2 });
  const b = getBounds(el);
  near(b.maxY - b.minY, 100 + el.strokeWidth, 0.01);
});

test('elements: line paths parse for every kind', () => {
  for (const kind of ['segment', 'polyline', 'curve', 'arc']) {
    const el = withWorldPoints(createElement('line', { kind }), [[0, 0], [50, -30], [100, 0]]);
    parsePath(linePathD(el));
    ok(linePolyline(el).length >= 2, kind);
  }
});

test('elements: collinear arc falls back to a straight polyline', () => {
  const el = withWorldPoints(createElement('line', { kind: 'arc' }), [[0, 0], [50, 0], [100, 0]]);
  eq(linePolyline(el).length, 3);
});

test('sanitize: rejects junk and unknown types', () => {
  for (const raw of [null, 1, 'x', {}, { type: 'script' }, { type: 'line', points: [[0, 0]] }, { type: 'text', text: '   ' }, { type: 'image' }]) {
    eq(sanitizeElement(raw), null, JSON.stringify(raw));
  }
});

test('sanitize: clamps numbers, colors and enums; drops unknown fields', () => {
  const el = sanitizeElement({ type: 'shape', x: 'NaN', y: Infinity, w: -5, h: 10, strokeColor: 'red;}', opacity: 999, strokeWidth: 0, roughness: 7, shapeId: '__proto__', evil: '<script>' });
  eq([el.x, el.y, el.w, el.h], [0, 0, 0, 10]);
  eq(el.strokeColor, '#0a0a0a'); eq(el.opacity, 100); eq(el.strokeWidth, 0.5); eq(el.roughness, 1); eq(el.shapeId, 'rect');
  ok(!('evil' in el));
});

test('sanitize: re-anchors line points that do not start at origin', () => {
  const el = sanitizeElement({ type: 'line', kind: 'segment', x: 100, y: 100, points: [[10, 10], [20, 30]] });
  eq([el.x, el.y, el.w, el.h], [110, 110, 10, 20]);
  eq(el.points, [[0, 0], [10, 20]]);
});

test('sanitize: normalizes Vietnamese text to NFC', () => {
  const el = sanitizeElement({ type: 'text', text: 'Việt' });
  eq(el.text, 'Việt');
});

test('pdf: layout scroll is clamped and current page follows scroll', () => {
  const el = createElement('pdf', { fileId: 'f', w: 300, h: 300, pages: [[600, 800], [600, 800], [600, 800]], scroll: 2 });
  const L = pdfLayout(el);
  eq(L.pages.length, 3);
  near(L.scrollPx, L.maxScroll);
  eq(pdfCurrentPage(el), 2);
  eq(pdfCurrentPage({ ...el, scroll: 0 }), 0);
});

test('history: undo/redo and no-op commits', () => {
  const h = new History();
  const a = createElement('shape');
  h.reset([]);
  ok(h.commit([a]));
  ok(!h.commit([a]), 'same scene is not recorded');
  eq(h.undo(), []);
  eq(h.redo(), [a]);
  eq(h.redo(), null);
  h.undo();
  ok(h.canRedo);
  h.commit([createElement('text', { text: 'b' })]);
  ok(!h.canRedo, 'new commit clears redo');
});
