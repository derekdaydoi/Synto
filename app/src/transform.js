// Selection frame, handles and transform math (resize / rotate / point edits). Pure functions.

import { rotate, snapAngle } from './geometry.js';
import {
  ROTATABLE, corners, center, updateElement, worldPoints, withWorldPoints, measureText, toLocal,
} from './elements.js';
import { boundsOfPoints } from './geometry.js';

export const HANDLE_SIZE = 9; // screen px
export const ROTATE_OFFSET = 26; // screen px above the top edge

/** Describes how the current selection is framed: one rotatable element, one line, or an axis-aligned group. */
export function selectionFrame(selected) {
  if (!selected.length) return null;
  if (selected.length === 1) {
    const el = selected[0];
    if (el.type === 'line') return { kind: 'line', el };
    if (ROTATABLE.has(el.type)) return { kind: 'single', el, angle: el.angle, corners: corners(el), center: center(el) };
  }
  const pts = [];
  for (const el of selected) pts.push(...corners(el));
  const b = boundsOfPoints(pts);
  return {
    kind: selected.length === 1 ? 'box' : 'group', el: selected.length === 1 ? selected[0] : null, angle: 0,
    corners: [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]],
    center: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], bounds: b,
  };
}

const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Handles in world coords. zoom converts screen offsets (rotation handle) to world units. */
export function getHandles(frame, zoom) {
  if (!frame) return [];
  if (frame.kind === 'line') return worldPoints(frame.el).map((p, i) => ({ id: 'p' + i, point: p }));
  const [a, b, c, d] = frame.corners;
  const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const pos = { nw: a, n: m(a, b), ne: b, e: m(b, c), se: c, s: m(c, d), sw: d, w: m(d, a) };
  const onlyCorners = frame.el && (frame.el.type === 'text' || frame.el.type === 'math');
  const out = HANDLE_IDS.filter((id) => !onlyCorners || id.length === 2).map((id) => ({ id, point: pos[id] }));
  // Hide edge handles when the frame is tiny on screen so corners stay grabbable.
  const wScreen = Math.hypot(b[0] - a[0], b[1] - a[1]) * zoom, hScreen = Math.hypot(d[0] - a[0], d[1] - a[1]) * zoom;
  const filtered = out.filter((hd) => hd.id.length === 2 || (hd.id === 'n' || hd.id === 's' ? wScreen > 40 : hScreen > 40));
  if (frame.kind === 'single') {
    const up = rotate([0, -1], [0, 0], frame.angle);
    const top = pos.n;
    filtered.push({ id: 'rot', point: [top[0] + up[0] * ROTATE_OFFSET / zoom, top[1] + up[1] * ROTATE_OFFSET / zoom] });
  }
  return filtered;
}

export function hitHandle(handles, p, zoom) {
  const r = (HANDLE_SIZE / 2 + 4) / zoom;
  for (let i = handles.length - 1; i >= 0; i--) {
    const hd = handles[i];
    if (Math.abs(hd.point[0] - p[0]) <= r && Math.abs(hd.point[1] - p[1]) <= r) return hd;
  }
  return null;
}

const MIN_SIZE = 2;

/**
 * Resize one element (any type) from handle `hid`, pointer `p` in world coords.
 * `orig` is the element at drag start. `keepRatio` forces proportional scaling.
 */
export function resizeElement(orig, hid, p, keepRatio) {
  if (orig.type === 'line' || orig.type === 'draw') return resizePoints(orig, hid, p, keepRatio);
  const proportional = keepRatio || orig.type === 'text' || orig.type === 'math';
  const lp = toLocal(orig, p); // pointer in the element's unrotated frame
  const w = orig.w, h = orig.h;
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  if (hid.includes('w')) x0 = lp[0];
  if (hid.includes('e')) x1 = lp[0];
  if (hid.includes('n')) y0 = lp[1];
  if (hid.includes('s')) y1 = lp[1];
  let nw = x1 - x0, nh = y1 - y0;
  if (proportional && w > 0 && h > 0) {
    let s;
    if (hid === 'n' || hid === 's') s = Math.abs(nh) / h;
    else if (hid === 'e' || hid === 'w') s = Math.abs(nw) / w;
    else s = Math.max(Math.abs(nw) / w, Math.abs(nh) / h);
    s = Math.max(s, MIN_SIZE / Math.max(w, h));
    const sw = w * s * Math.sign(nw || 1), sh = h * s * Math.sign(nh || 1);
    if (hid.includes('w')) x0 = x1 - sw; else if (hid.includes('e')) x1 = x0 + sw; else { const cx = w / 2; x0 = cx - Math.abs(sw) / 2; x1 = cx + Math.abs(sw) / 2; }
    if (hid.includes('n')) y0 = y1 - sh; else if (hid.includes('s')) y1 = y0 + sh; else { const cy = h / 2; y0 = cy - Math.abs(sh) / 2; y1 = cy + Math.abs(sh) / 2; }
    nw = x1 - x0; nh = y1 - y0;
  }
  const minX = Math.min(x0, x1), minY = Math.min(y0, y1);
  const W = Math.max(MIN_SIZE, Math.abs(nw)), H = Math.max(MIN_SIZE, Math.abs(nh));
  // New center in local frame -> world (rotating about the original center keeps the anchor fixed).
  const cLocal = [minX + W / 2, minY + H / 2];
  const oc = center(orig);
  const cWorld = rotate([orig.x + cLocal[0], orig.y + cLocal[1]], oc, orig.angle);
  const patch = { x: cWorld[0] - W / 2, y: cWorld[1] - H / 2, w: W, h: H };
  if (orig.type === 'text') {
    const fontSize = Math.max(4, orig.fontSize * (W / Math.max(1, orig.w)));
    const m = measureText(orig.text, orig.font, fontSize);
    // Re-center on the measured box so rounding never drifts the anchor much.
    return updateElement(orig, { fontSize, w: m.w, h: m.h, x: cWorld[0] - m.w / 2, y: cWorld[1] - m.h / 2 });
  }
  if (orig.type === 'math') patch.fontSize = Math.max(6, orig.fontSize * (W / Math.max(1, orig.w)));
  return updateElement(orig, patch);
}

function resizePoints(orig, hid, p, keepRatio) {
  const w = Math.max(orig.w, 1e-6), h = Math.max(orig.h, 1e-6);
  const ax = hid.includes('w') ? orig.x + orig.w : hid.includes('e') ? orig.x : null;
  const ay = hid.includes('n') ? orig.y + orig.h : hid.includes('s') ? orig.y : null;
  let sx = ax === null ? 1 : (hid.includes('w') ? (ax - p[0]) / w : (p[0] - ax) / w);
  let sy = ay === null ? 1 : (hid.includes('n') ? (ay - p[1]) / h : (p[1] - ay) / h);
  if (orig.w < 1e-3) sx = 1;
  if (orig.h < 1e-3) sy = 1;
  if (keepRatio) {
    const s = ax !== null && ay !== null ? Math.max(Math.abs(sx), Math.abs(sy)) : ax !== null ? Math.abs(sx) : Math.abs(sy);
    sx = s * Math.sign(sx || 1); sy = s * Math.sign(sy || 1);
  }
  // Edge handles scale the other axis (when proportional) about the center.
  const anchorX = ax ?? orig.x + orig.w / 2, anchorY = ay ?? orig.y + orig.h / 2;
  const pts = worldPoints(orig).map((q, i) => {
    const nx = anchorX + (q[0] - anchorX) * sx;
    const ny = anchorY + (q[1] - anchorY) * sy;
    const out = [nx, ny];
    if (orig.points[i].length > 2) out.push(orig.points[i][2]);
    return out;
  });
  return withWorldPoints(orig, pts);
}

/** Uniform scale of a group about `anchor` (world). */
export function scaleElement(el, anchor, s) {
  if (el.type === 'line' || el.type === 'draw') {
    const pts = worldPoints(el).map((q, i) => {
      const out = [anchor[0] + (q[0] - anchor[0]) * s, anchor[1] + (q[1] - anchor[1]) * s];
      if (el.points[i].length > 2) out.push(el.points[i][2]);
      return out;
    });
    return withWorldPoints(el, pts);
  }
  const c = center(el);
  const nc = [anchor[0] + (c[0] - anchor[0]) * s, anchor[1] + (c[1] - anchor[1]) * s];
  const w = Math.max(MIN_SIZE, el.w * s), h = Math.max(MIN_SIZE, el.h * s);
  const patch = { x: nc[0] - w / 2, y: nc[1] - h / 2, w, h };
  if (el.type === 'text') {
    const fontSize = Math.max(4, el.fontSize * s);
    const m = measureText(el.text, el.font, fontSize);
    return updateElement(el, { fontSize, w: m.w, h: m.h, x: nc[0] - m.w / 2, y: nc[1] - m.h / 2 });
  }
  if (el.type === 'math') patch.fontSize = Math.max(6, el.fontSize * s);
  return updateElement(el, patch);
}

/** Group resize from a handle: uniform scale about the opposite corner/edge. */
export function groupScaleFactor(frame, hid, p) {
  const b = frame.bounds;
  const W = Math.max(1e-6, b.maxX - b.minX), H = Math.max(1e-6, b.maxY - b.minY);
  const anchor = [hid.includes('w') ? b.maxX : hid.includes('e') ? b.minX : (b.minX + b.maxX) / 2,
    hid.includes('n') ? b.maxY : hid.includes('s') ? b.minY : (b.minY + b.maxY) / 2];
  const sx = hid.includes('w') || hid.includes('e') ? Math.abs(p[0] - anchor[0]) / W : 0;
  const sy = hid.includes('n') || hid.includes('s') ? Math.abs(p[1] - anchor[1]) / H : 0;
  const s = Math.max(0.02, Math.max(sx, sy));
  return { anchor, s };
}

export function rotateAngle(frame, p, snap) {
  const c = frame.center;
  let a = Math.atan2(p[1] - c[1], p[0] - c[0]) + Math.PI / 2;
  if (snap) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** Move one vertex of a line element to world point p. */
export function moveLinePoint(el, index, p, angleLockFrom) {
  const pts = worldPoints(el);
  pts[index] = angleLockFrom ? snapAngle(angleLockFrom, p) : [p[0], p[1]];
  return withWorldPoints(el, pts);
}
