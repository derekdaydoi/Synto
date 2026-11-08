// Mind map (XMind-style): topics are labelled shapes, branches are bound connectors.
// Tab adds a child to the right of the selected topic; Space/Enter adds a sibling below it.

import { createElement, withLabel, getBounds, updateElement, center } from './elements.js';
import { borderPoint } from './connectors.js';
import { withWorldPoints } from './elements.js';

export const GAP_X = 72; // parent -> child column distance
export const GAP_Y = 18; // vertical space between siblings
const PAD = 8; // extra clearance when avoiding overlaps

const childrenOf = (elements, id) => elements.filter((e) => e.parentId === id);

/** Bottom edge of a node's whole subtree (the node and all its descendants). */
function subtreeBottom(elements, node) {
  let bottom = rectOf(node).maxY;
  const seen = new Set([node.id]);
  const stack = [node.id];
  while (stack.length) {
    const id = stack.pop();
    for (const k of childrenOf(elements, id)) {
      if (seen.has(k.id)) continue; // guard against parent cycles in hand-edited files
      seen.add(k.id);
      bottom = Math.max(bottom, rectOf(k).maxY);
      stack.push(k.id);
    }
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
    if (e.type === 'line' || e.type === 'draw' || ignore.has(e.id)) continue;
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
  const base = createElement('shape', {
    shapeId: like && like.type === 'shape' ? like.shapeId : 'roundrect',
    params: like && like.params ? { ...like.params } : {},
    topic: true,
    font: like && like.font ? like.font : style.font,
    fontSize: like && like.fontSize ? Math.max(16, like.fontSize - 4) : 20,
    roughness: like ? like.roughness : style.roughness,
    strokeColor: like ? like.strokeColor : style.strokeColor,
    strokeWidth: like ? like.strokeWidth : style.strokeWidth,
    fillColor: like && like.type === 'shape' ? like.fillColor : 'transparent',
    fillStyle: like && like.type === 'shape' ? like.fillStyle : style.fillStyle,
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
    strokeColor: from.strokeColor === 'transparent' ? style.strokeColor : from.strokeColor,
    strokeWidth: from.strokeWidth || style.strokeWidth, roughness: from.roughness ?? style.roughness,
  }, style);
  return withWorldPoints(line, [borderPoint(from, center(to)), borderPoint(to, center(from))]);
}

/**
 * Adds a child topic to the right of `parent`. Returns {elements, node} (new array, new topic).
 */
export function addChild(elements, parent, style, label = 'Chủ đề con') {
  let node = newTopic(style, parent, label);
  node = updateElement(node, { parentId: parent.id });
  const pb = rectOf(parent);
  const kids = childrenOf(elements, parent.id);
  let x = pb.maxX + GAP_X, y;
  if (!kids.length) {
    y = (pb.minY + pb.maxY) / 2 - node.h / 2;
  } else {
    // Below the previous children's whole subtrees, so branches never interleave.
    x = Math.min(...kids.map((k) => k.x));
    y = Math.max(...kids.map((k) => subtreeBottom(elements, k))) + GAP_Y;
  }
  y = findFreeY(elements, x, y, node.w, node.h, new Set([parent.id]));
  node = updateElement(node, { x, y });
  const line = connector(style, parent, node);
  // Connector below the boxes so it never covers a label.
  return { elements: [line, ...elements, node], node };
}

/**
 * Adds a sibling below `node` (same parent). A topic without a parent gets a new root topic
 * below it. Returns {elements, node}.
 */
export function addSibling(elements, node, style, label = 'Chủ đề') {
  const parent = node.parentId ? elements.find((e) => e.id === node.parentId) : null;
  let sib = newTopic(style, parent ? node : null, label);
  if (parent) sib = updateElement(sib, { parentId: parent.id, fontSize: node.fontSize, font: node.font });
  else sib = updateElement(sib, { shapeId: node.type === 'shape' ? node.shapeId : sib.shapeId, fontSize: node.fontSize || sib.fontSize, strokeColor: node.strokeColor, strokeWidth: node.strokeWidth });
  sib = withLabel(sib, label);
  const x = node.x;
  const y = findFreeY(elements, x, subtreeBottom(elements, node) + GAP_Y, sib.w, sib.h, new Set());
  sib = updateElement(sib, { x, y });
  const added = parent ? [connector(style, parent, sib)] : [];
  return { elements: [...added, ...elements, sib], node: sib };
}
