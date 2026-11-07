import { test, eq, ok, near, nearPt } from './harness.js';
import { resizeElement, scaleElement, selectionFrame, getHandles, rotateAngle, moveLinePoint } from '../app/src/transform.js';
import { createElement, withWorldPoints, worldPoints, toWorld } from '../app/src/elements.js';

test('resize: corner handle keeps the opposite corner fixed (unrotated)', () => {
  const el = createElement('shape', { x: 0, y: 0, w: 100, h: 50 });
  const r = resizeElement(el, 'se', [150, 80], false);
  eq([r.x, r.y, r.w, r.h], [0, 0, 150, 80]);
});

test('resize: rotated element keeps the anchor corner fixed in world space', () => {
  const el = createElement('shape', { x: 0, y: 0, w: 100, h: 50, angle: 0.6 });
  const anchorBefore = toWorld(el, [0, 0]);
  const r = resizeElement(el, 'se', toWorld(el, [160, 90]), false);
  nearPt(toWorld(r, [0, 0]), anchorBefore, 1e-6, 'nw anchor');
  near(r.w, 160); near(r.h, 90);
});

test('resize: dragging past the anchor flips without negative sizes', () => {
  const el = createElement('shape', { x: 0, y: 0, w: 100, h: 50 });
  const r = resizeElement(el, 'e', [-40, 25], false);
  ok(r.w > 0); near(r.x, -40); near(r.w, 40);
});

test('resize: proportional keeps aspect ratio', () => {
  const el = createElement('image', { fileId: 'x', x: 0, y: 0, w: 200, h: 100 });
  const r = resizeElement(el, 'se', [300, 120], true);
  near(r.w / r.h, 2);
});

test('resize: text scales font size and stays positive', () => {
  const el = createElement('text', { x: 0, y: 0, w: 100, h: 30, text: 'abc', fontSize: 24 });
  const r = resizeElement(el, 'se', [200, 60], false);
  ok(r.fontSize > 24);
  const tiny = resizeElement(el, 'se', [-500, -500], false);
  ok(tiny.fontSize >= 4 && tiny.w > 0);
});

test('resize: line points scale from the opposite edge', () => {
  const el = withWorldPoints(createElement('line'), [[0, 0], [100, 50]]);
  const r = resizeElement(el, 'e', [200, 25], false);
  eq(worldPoints(r), [[0, 0], [200, 50]]);
});

test('resize: zero-height line does not produce NaN', () => {
  const el = withWorldPoints(createElement('line'), [[0, 0], [100, 0]]);
  const r = resizeElement(el, 'se', [150, 40], false);
  ok(worldPoints(r).flat().every(Number.isFinite));
});

test('group scale about an anchor', () => {
  const el = createElement('shape', { x: 10, y: 10, w: 10, h: 10 });
  const r = scaleElement(el, [0, 0], 2);
  eq([r.x, r.y, r.w, r.h], [20, 20, 20, 20]);
});

test('frame: rotatable single has a rotation handle; text has no edge handles', () => {
  const s = selectionFrame([createElement('shape', { w: 100, h: 100 })]);
  ok(getHandles(s, 1).some((h) => h.id === 'rot'));
  const t = selectionFrame([createElement('text', { w: 100, h: 100, text: 'x' })]);
  ok(!getHandles(t, 1).some((h) => h.id === 'n'));
  const l = selectionFrame([withWorldPoints(createElement('line'), [[0, 0], [5, 5]])]);
  eq(getHandles(l, 1).map((h) => h.id), ['p0', 'p1']);
});

test('rotate: angle from handle position, snapping to 15°', () => {
  const f = selectionFrame([createElement('shape', { x: 0, y: 0, w: 100, h: 100 })]);
  near(rotateAngle(f, [50, -100], false), 0, 1e-9);
  near(rotateAngle(f, [200, 50], false), Math.PI / 2);
  near(rotateAngle(f, [201, 47], true), Math.PI / 2);
});

test('line point move re-anchors bounds', () => {
  const el = withWorldPoints(createElement('line'), [[0, 0], [10, 10]]);
  const r = moveLinePoint(el, 0, [-20, 5]);
  eq(worldPoints(r), [[-20, 5], [10, 10]]);
  eq([r.x, r.y], [-20, 5]);
});
