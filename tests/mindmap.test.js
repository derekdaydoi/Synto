import { test, eq, ok, near } from './harness.js';
import { createElement, withLabel, withText, getBounds, worldPoints, sanitizeElement, hitTest, DEFAULT_STYLE } from '../app/src/elements.js';
import { borderPoint, reflowConnectors, bindingTargetAt, dropDangling, remapReferences } from '../app/src/connectors.js';
import { addChild, addSibling, centralTopic, layoutTreesOf, descendantIds, reparent, textToTopic, inTree, treeRoot } from '../app/src/mindmap.js';
import { jpegToPdf } from '../app/src/pdfexport.js';

const box = (x, y, w = 100, h = 50, extra = {}) => createElement('shape', { shapeId: 'rect', x, y, w, h, ...extra });

test('connectors: border point lies on the facing side of a box', () => {
  const b = box(0, 0, 100, 50);
  const p = borderPoint(b, [500, 25], 0);
  near(p[0], 100, 1e-6); near(p[1], 25, 1e-6);
  const q = borderPoint(b, [50, -300], 6);
  near(q[0], 50, 1e-6); near(q[1], -6, 1e-6);
});

test('connectors: border point works for a circle and a concave star', () => {
  const c = createElement('shape', { shapeId: 'circle', x: 0, y: 0, w: 100, h: 100 });
  const p = borderPoint(c, [500, 50], 0);
  near(p[0], 100, 0.5); near(p[1], 50, 0.5);
  const s = createElement('shape', { shapeId: 'star', params: { points: 5, inner: 0.4 }, x: 0, y: 0, w: 100, h: 100 });
  const q = borderPoint(s, [50, -500], 0);
  near(q[1], 0, 0.6, 'outermost crossing at the top point');
});

test('connectors: bound line follows a moved box and drops a missing binding', () => {
  const a = box(0, 0), b = box(300, 0);
  let line = createElement('line', { startBinding: a.id, endBinding: b.id });
  line = { ...line, points: [[0, 0], [10, 0]], x: 0, y: 0, w: 10, h: 0 };
  let els = reflowConnectors([a, b, line]);
  let pts = worldPoints(els[2]);
  near(pts[0][0], 106, 1e-6); near(pts[1][0], 294, 1e-6);
  const moved = { ...b, y: 200, version: b.version + 1 };
  els = reflowConnectors([a, moved, els[2]], new Set([moved.id]));
  pts = worldPoints(els[2]);
  ok(pts[1][1] > 150, 'end followed the box down');
  const orphan = reflowConnectors([a, els[2]]);
  eq(orphan[1].endBinding, null);
});

test('connectors: reflow returns the same array when nothing changes', () => {
  const a = box(0, 0);
  const els = [a, box(300, 300)];
  ok(reflowConnectors(els) === els);
});

test('connectors: binding needs the end inside the shape, not on its outline', () => {
  const a = box(0, 0, 100, 50);
  ok(bindingTargetAt([a], [30, 20], 4), 'inside');
  ok(!bindingTargetAt([a], [100, 25], 4), 'on the edge (snapped midpoint) stays free');
  ok(!bindingTargetAt([a], [0, 0], 4), 'on a vertex stays free');
  const circle = createElement('shape', { shapeId: 'circle', x: 0, y: 0, w: 100, h: 100 });
  ok(!bindingTargetAt([circle], [50, 50], 4), 'exact center of a plain shape stays free (radius)');
  const topic = withLabel(box(0, 0, 100, 50, { topic: true }), 'A');
  ok(bindingTargetAt([topic], [topic.x + topic.w / 2, topic.y + topic.h / 2], 4), 'topic center binds');
});

test('connectors: deleting a node removes its branches and orphans its children', () => {
  const a = box(0, 0), b = { ...box(300, 0), parentId: null };
  const child = { ...box(300, 100), parentId: a.id };
  const line = { ...createElement('line', { startBinding: a.id, endBinding: b.id }), points: [[0, 0], [1, 0]] };
  const out = dropDangling([b, child, line], new Set([a.id]));
  eq(out.length, 2);
  eq(out.find((e) => e.id === child.id).parentId, null);
});

test('connectors: copies re-link among themselves only', () => {
  const idMap = new Map([['a', 'A2'], ['l', 'L2']]);
  const out = remapReferences([{ id: 'L2', type: 'line', startBinding: 'a', endBinding: 'zz' }], idMap);
  eq(out[0].startBinding, 'A2');
  eq(out[0].endBinding, null);
});

test('labels: topics hug their text, shapes only grow', () => {
  const t = withLabel(box(0, 0, 10, 10, { topic: true, fontSize: 20 }), 'Xin chào thế giới');
  ok(t.w > 96 && t.h >= 44);
  const s = withLabel(box(0, 0, 400, 200), 'A');
  eq([s.w, s.h], [400, 200]);
  const grown = withLabel(box(0, 0, 20, 20), 'Một câu khá dài trong hình');
  ok(grown.w > 20);
  near(grown.x + grown.w / 2, 10, 1e-6, 'stays centered');
});

test('labels: a borderless labelled shape is clickable inside', () => {
  const t = withLabel(box(0, 0, 100, 50, { topic: true, strokeColor: 'transparent' }), 'A');
  ok(hitTest(t, [t.x + t.w / 2, t.y + t.h / 2], 1));
});

// Apply the XMind layout to the whole element list (what the app does after each change).
const tidy = (els, id) => { const m = layoutTreesOf(els, [id]); return els.map((e) => m.get(e.id) || e); };
const byId = (els, id) => els.find((e) => e.id === id);
const overlaps = (a, b) => { const p = getBounds(a), q = getBounds(b); return p.minX < q.maxX && p.maxX > q.minX && p.minY < q.maxY && p.maxY > q.minY; };

test('mindmap: Tab places children to the right, stacked without overlap', () => {
  const root = centralTopic(DEFAULT_STYLE, [0, 0]);
  let r = addChild([root], root, DEFAULT_STYLE, 'Một');
  let els = tidy(r.elements, r.node.id);
  const c1 = byId(els, r.node.id);
  ok(c1.x > getBounds(root).maxX, 'right of parent');
  eq(c1.parentId, root.id);
  ok(els.some((e) => e.type === 'line' && e.startBinding === root.id && e.endBinding === c1.id), 'branch connector');
  r = addChild(els, root, DEFAULT_STYLE, 'Hai');
  els = tidy(r.elements, r.node.id);
  const a = byId(els, c1.id), b = byId(els, r.node.id);
  near(b.x, a.x, 1e-6, 'same column');
  ok(b.y >= getBounds(a).maxY, 'second child below the first');
  near((a.y + b.y + b.h) / 2, root.y + root.h / 2, 0.5, 'children centered on the parent');
  ok(b.fontSize < root.fontSize, 'children get a smaller font');
});

test('mindmap: a sibling goes right after its node, between existing siblings', () => {
  const root = centralTopic(DEFAULT_STYLE, [0, 0]);
  let els = [root];
  const ids = [];
  for (const k of ['A', 'B', 'C']) { const r = addChild(els, root, DEFAULT_STYLE, k); ids.push(r.node.id); els = tidy(r.elements, r.node.id); }
  const s = addSibling(els, byId(els, ids[0]), DEFAULT_STYLE, 'A2');
  els = tidy(s.elements, s.node.id);
  eq(byId(els, s.node.id).parentId, root.id);
  const order = els.filter((e) => e.parentId === root.id).sort((p, q) => p.y - q.y).map((e) => e.label);
  eq(order, ['A', 'A2', 'B', 'C']);
  ok(s.elements.some((e) => e.type === 'line' && e.startBinding === root.id && e.endBinding === s.node.id));
  const lone = addSibling([root], root, DEFAULT_STYLE, 'Khác');
  eq(lone.node.parentId, null);
  ok(!lone.elements.some((e) => e.type === 'line'), 'a root sibling has no branch');
});

test('mindmap: subtrees never overlap, even with deep and long branches', () => {
  const root = centralTopic(DEFAULT_STYLE, [0, 0]);
  let els = [root];
  const add = (pid, label) => { const r = addChild(els, byId(els, pid), DEFAULT_STYLE, label); els = tidy(r.elements, r.node.id); return r.node.id; };
  const a = add(root.id, 'A'), b = add(root.id, 'B');
  for (const k of ['a1', 'a2', 'a3']) add(a, k);
  const b1 = add(b, 'b1');
  add(b1, 'một nhánh cháu có chữ khá là dài');
  add(b1, 'cháu 2');
  const nodes = els.filter((e) => e.type === 'shape');
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) ok(!overlaps(nodes[i], nodes[j]), `${nodes[i].label} / ${nodes[j].label}`);
  const lowestA = Math.max(...[...descendantIds(els, a), a].map((id) => getBounds(byId(els, id)).maxY));
  ok(byId(els, b).y >= lowestA, 'B sits below all of A');
});

test('mindmap: a longer label pushes its children further right', () => {
  const root = centralTopic(DEFAULT_STYLE, [0, 0]);
  let r = addChild([root], root, DEFAULT_STYLE, 'A');
  let els = tidy(r.elements, r.node.id);
  const a = r.node.id;
  r = addChild(els, byId(els, a), DEFAULT_STYLE, 'a1');
  els = tidy(r.elements, r.node.id);
  const before = byId(els, r.node.id).x;
  els = els.map((e) => (e.id === a ? withLabel(e, 'A với một tên rất rất dài') : e));
  els = tidy(els, a);
  ok(byId(els, r.node.id).x > before + 50, 'grandchild column moved right');
  ok(byId(els, a).x > getBounds(root).maxX, 'the grown topic still starts right of its parent');
});

test('mindmap: reparent moves the branch line; textToTopic boxes a text', () => {
  const root = centralTopic(DEFAULT_STYLE, [0, 0]);
  let r = addChild([root], root, DEFAULT_STYLE, 'A');
  const a = r.node.id;
  r = addChild(r.elements, root, DEFAULT_STYLE, 'B');
  let els = reparent(r.elements, byId(r.elements, r.node.id), byId(r.elements, a), DEFAULT_STYLE);
  eq(byId(els, r.node.id).parentId, a);
  eq(els.filter((e) => e.type === 'line' && e.endBinding === r.node.id).map((e) => e.startBinding), [a]);
  ok(inTree(els, byId(els, a)) && treeRoot(els, byId(els, r.node.id)).id === root.id);
  const t = withText(createElement('text', { x: 10, y: 20 }), 'Ý tưởng');
  const topic = textToTopic(t);
  eq([topic.id, topic.type, topic.label, topic.topic], [t.id, 'shape', 'Ý tưởng', true]);
  ok(topic.x < t.x && topic.y < t.y && topic.x + topic.w > t.x + t.w, 'box surrounds the words');
});

test('sanitize: keeps labels, bindings and parent ids; rejects bad ones', () => {
  const s = sanitizeElement({ type: 'shape', label: 'Việt', topic: true, parentId: 'p1', font: 'evil' });
  eq([s.label, s.topic, s.parentId, s.font], ['Việt', true, 'p1', 'hand']);
  const l = sanitizeElement({ type: 'line', points: [[0, 0], [5, 5]], startBinding: 'a', endBinding: 42 });
  eq([l.startBinding, l.endBinding], ['a', null]);
});

test('pdf: structure and xref offsets are valid', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const bytes = new Uint8Array(jpegToPdf(jpeg, 10, 20, 300, 600, 'Thử (1)'));
  const text = new TextDecoder('latin1').decode(bytes);
  ok(text.startsWith('%PDF-1.4'));
  ok(text.trimEnd().endsWith('%%EOF'));
  const startxref = +/startxref\n(\d+)/.exec(text)[1];
  ok(text.slice(startxref).startsWith('xref'), 'startxref points at the xref table');
  const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => +m[1]);
  eq(entries.length, 6);
  entries.forEach((off, i) => ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
  ok(/\/MediaBox \[0 0 300 600\]/.test(text));
  ok(/\/Title \(Th\? \\\(1\\\)\)/.test(text), 'title escaped');
});

test('pdf: huge pages are scaled to the 14400 pt limit', () => {
  const text = new TextDecoder('latin1').decode(new Uint8Array(jpegToPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 1, 1, 30000, 15000)));
  ok(/\/MediaBox \[0 0 14400 7200\]/.test(text));
});
