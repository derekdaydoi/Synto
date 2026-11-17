// Mind map (XMind-style): topics are labelled shapes, branches are bound connectors.
// Tab adds a child to the right of the selected topic; Space/Enter adds a sibling below it.
// layoutTree keeps every tree tidy: children sit in a column right of their parent, each
// centered on its own subtree, so long labels and new branches push neighbours apart.

import { createElement, withLabel, getBounds, updateElement, center, LABEL_PAD } from './elements.js';
import { borderPoint } from './connectors.js';
import { withWorldPoints } from './elements.js';

export const GAP_X = 64; // parent -> child column distance
export const GAP_Y = 16; // vertical space between sibling subtrees
const PAD = 8; // extra clearance when avoiding overlaps

const isNode = (e) => e.type !== 'line' && e.type !== 'draw';
const childrenOf = (elements, id) => elements.filter((e) => e.parentId === id && isNode(e));

/** Bottom edge of a node's whole subtree (the node and all its descendants). */
function subtreeBottom(elements, node) {
  let bottom = rectOf(node).maxY;
  for (const id of descendantIds(elements, node.id)) {
    const k = elements.find((e) => e.id === id);
    if (k) bottom = Math.max(bottom, rectOf(k).maxY);
  }
  return bottom;
}

function rectOf(el) {
  const b = getBounds(el);
  return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
}

/** First element (other than connectors/ignored) whose box overlaps the candidate rect. */
function blocker(elements, r, ignore) {
  for (const e of elements) {
    if (!isNode(e) || ignore.has(e.id)) continue;
    const b = rectOf(e);
    if (b.minX < r.maxX + PAD && b.maxX > r.minX - PAD && b.minY < r.maxY + PAD && b.maxY > r.minY - PAD) return b;
  }
  return null;
}

/** Moves a w x h box down from (x, y) until it overlaps nothing. */
function findFreeY(elements, x, y, w, h, ignore) {
  let cy = y;
  for (let i = 0; i < 400; i++) {
    const b = blocker(elements, { minX: x, minY: cy, maxX: x + w, maxY: cy + h }, ignore);
    if (!b) return cy;
    cy = b.maxY + GAP_Y;
  }
  return cy;
}

/** Style for a new topic: inherit the parent's look; font steps down per level (min 16). */
export function newTopic(style, like, label) {
  const shapeLike = like && like.type === 'shape';
  const base = createElement('shape', {
    shapeId: shapeLike ? like.shapeId : 'roundrect',
    params: shapeLike && like.params ? { ...like.params } : {},
    topic: true,
    font: like && like.font ? like.font : style.font,
    fontSize: like && like.fontSize ? Math.max(16, like.fontSize - 4) : 20,
    roughness: like ? like.roughness : style.roughness,
    strokeColor: like ? like.strokeColor : style.strokeColor,
    strokeWidth: like && like.strokeWidth ? like.strokeWidth : style.strokeWidth,
    fillColor: shapeLike ? like.fillColor : 'transparent',
    fillStyle: shapeLike ? like.fillStyle : style.fillStyle,
  }, style);
  return withLabel(base, label);
}

/** Central topic created with the mind-map tool. */
export function centralTopic(style, point) {
  const el = withLabel(createElement('shape', {
    shapeId: 'roundrect', topic: true, font: style.font, fontSize: 26, strokeWidth: Math.max(2, style.strokeWidth),
    x: point[0], y: point[1], w: 0, h: 0, strokeColor: style.strokeColor, fillColor: 'transparent',
  }, style), 'Chủ đề trung tâm');
  return updateElement(el, { x: point[0] - el.w / 2, y: point[1] - el.h / 2 });
}

function connector(style, from, to) {
  const line = createElement('line', {
    kind: 'segment', startBinding: from.id, endBinding: to.id, startHead: 'none', endHead: 'none',
    strokeColor: !from.strokeColor || from.strokeColor === 'transparent' ? style.strokeColor : from.strokeColor,
    strokeWidth: from.strokeWidth || style.strokeWidth, roughness: from.roughness ?? style.roughness,
  }, style);
  return withWorldPoints(line, [borderPoint(from, center(to)), borderPoint(to, center(from))]);
}

// ---------- tree structure ----------

/** Root of the tree that `node` belongs to (follows parentId; safe against cycles). */
export function treeRoot(elements, node) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let cur = node;
  const seen = new Set();
  while (cur && cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return cur;
}

/** Ids of every descendant of `id` (not including id). */
export function descendantIds(elements, id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const k of childrenOf(elements, cur)) {
      if (out.has(k.id) || k.id === id) continue;
      out.add(k.id);
      stack.push(k.id);
    }
  }
  return out;
}

/** True when el is part of a mind-map tree (has a live parent or at least one child). */
export function inTree(elements, el) {
  if (!el || !isNode(el)) return false;
  if (el.parentId && elements.some((e) => e.id === el.parentId)) return true;
  return elements.some((e) => e.parentId === el.id && isNode(e));
}

/**
 * XMind-style "logic chart" layout to the right of the root. The root stays put; each child
 * column starts GAP_X right of its parent and every child is centered on its own subtree.
 * Siblings keep their current top-to-bottom order. Returns a Map id -> moved element.
 */
export function layoutTree(elements, rootId) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const root = byId.get(rootId);
  const out = new Map();
  if (!root) return out;
  const kids = new Map();
  for (const e of elements) {
    if (!isNode(e) || !e.parentId || !byId.has(e.parentId)) continue;
    if (!kids.has(e.parentId)) kids.set(e.parentId, []);
    kids.get(e.parentId).push(e);
  }
  const cy = (e) => e.y + e.h / 2;
  for (const list of kids.values()) list.sort((a, b) => cy(a) - cy(b) || a.x - b.x);
  const H = new Map();
  const visiting = new Set();
  const measure = (id) => {
    if (H.has(id)) return H.get(id);
    if (visiting.has(id)) return 0; // cycle in a hand-edited file
    visiting.add(id);
    const node = byId.get(id);
    let sum = 0;
    (kids.get(id) || []).forEach((k, i) => { sum += measure(k.id) + (i ? GAP_Y : 0); });
    const h = Math.max(node.h, sum);
    H.set(id, h);
    return h;
  };
  measure(rootId);
  const placed = new Set([rootId]);
  const place = (node) => {
    const ks = (kids.get(node.id) || []).filter((k) => !placed.has(k.id) && H.has(k.id));
    if (!ks.length) return;
    let total = 0;
    ks.forEach((k, i) => { total += H.get(k.id) + (i ? GAP_Y : 0); });
    let top = cy(node) - total / 2;
    const colX = node.x + node.w + GAP_X;
    for (const k of ks) {
      placed.add(k.id);
      const hk = H.get(k.id);
      const x = colX, y = top + hk / 2 - k.h / 2;
      let next = k;
      if (Math.abs(k.x - x) > 0.01 || Math.abs(k.y - y) > 0.01) {
        next = updateElement(k, { x, y });
        out.set(k.id, next);
      }
      place(next);
      top += hk + GAP_Y;
    }
  };
  place(root);
  return out;
}

/** Layout for every tree that contains one of the given ids. Returns a Map of moved elements. */
export function layoutTreesOf(elements, ids) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const roots = new Set();
  for (const id of ids) {
    const el = byId.get(id);
    if (el && inTree(elements, el)) roots.add(treeRoot(elements, el).id);
  }
  const out = new Map();
  let cur = elements;
  for (const r of roots) {
    const m = layoutTree(cur, r);
    if (!m.size) continue;
    for (const [id, el] of m) out.set(id, el);
    cur = cur.map((e) => m.get(e.id) || e);
  }
  return out;
}

/**
 * Adds a child topic after `parent`'s existing children. The caller runs layoutTree to put it
 * in its final place. Returns {elements, node}.
 */
export function addChild(elements, parent, style, label = 'Chủ đề con') {
  let node = newTopic(style, parent, label);
  const kids = childrenOf(elements, parent.id);
  const pb = rectOf(parent);
  // Provisional spot just below the last child, so layoutTree's sort keeps it last.
  const cy = kids.length ? Math.max(...kids.map((k) => k.y + k.h / 2)) + 1 : (pb.minY + pb.maxY) / 2;
  node = updateElement(node, { parentId: parent.id, x: pb.maxX + GAP_X, y: cy - node.h / 2 });
  const line = connector(style, parent, node);
  // Connector below the boxes so it never covers a label.
  return { elements: [line, ...elements, node], node };
}

/**
 * Adds a sibling right after `node` (same parent). A node without a parent gets a new
 * root topic below its subtree. Returns {elements, node}.
 */
export function addSibling(elements, node, style, label = 'Chủ đề') {
  const parent = node.parentId ? elements.find((e) => e.id === node.parentId) : null;
  let sib = newTopic(style, parent ? node : null, label);
  if (parent) sib = updateElement(sib, { parentId: parent.id, fontSize: node.fontSize || sib.fontSize, font: node.font || sib.font });
  else sib = updateElement(sib, { shapeId: node.type === 'shape' ? node.shapeId : sib.shapeId, fontSize: node.fontSize || sib.fontSize, strokeColor: node.strokeColor === 'transparent' ? style.strokeColor : node.strokeColor, strokeWidth: node.strokeWidth || sib.strokeWidth });
  sib = withLabel(sib, label);
  let y;
  if (parent) y = node.y + node.h / 2 + 0.5 - sib.h / 2; // right after node in sibling order
  else y = findFreeY(elements, node.x, subtreeBottom(elements, node) + GAP_Y * 2, sib.w, sib.h, new Set());
  sib = updateElement(sib, { x: node.x, y });
  const added = parent ? [connector(style, parent, sib)] : [];
  return { elements: [...added, ...elements, sib], node: sib };
}

/** Moves `node` under `newParent` (or detaches it when null), rewiring its branch line. */
export function reparent(elements, node, newParent, style) {
  const old = node.parentId;
  let out = elements.filter((e) => !(e.type === 'line' && old
    && ((e.startBinding === old && e.endBinding === node.id) || (e.startBinding === node.id && e.endBinding === old))));
  out = out.map((e) => (e.id === node.id ? updateElement(e, { parentId: newParent ? newParent.id : null }) : e));
  if (!newParent) return out;
  const moved = out.find((e) => e.id === node.id);
  return [connector(style, newParent, moved), ...out];
}

/** Turns a plain text element into a boxed topic with the same words, font and color. */
export function textToTopic(el) {
  const base = createElement('shape', {
    id: el.id, shapeId: 'roundrect', topic: true, font: el.font, fontSize: el.fontSize,
    x: el.x, y: el.y, w: el.w, h: el.h, parentId: null,
    strokeColor: el.strokeColor, strokeWidth: 2, roughness: 1, fillColor: 'transparent', opacity: el.opacity,
  });
  const t = withLabel(base, el.text || '');
  // Keep the words where they were: the box grows around the text.
  return updateElement(t, { x: el.x - LABEL_PAD.x, y: el.y - LABEL_PAD.y });
}
