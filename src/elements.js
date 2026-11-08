// Element model: creation, immutable updates, geometry, hit testing, validation.
// Elements are treated as immutable: every change returns a new object with version + 1.
// That keeps undo snapshots cheap (arrays of references) and render caches simple.

import { newId, newSeed, isFiniteNumber, clamp, nfc } from './util.js';
import {
  rotate, boundsOfPoints, distToPolyline, pointInRings, catmullRomToBezier, cubicAt, arcThrough, sampleArc,
} from './geometry.js';
import { shapeGeometry, SHAPES } from './shapelib.js';

export const TYPES = ['shape', 'line', 'draw', 'text', 'math', 'image', 'pdf'];
export const ROTATABLE = new Set(['shape', 'text', 'math', 'image']);
export const FONT_FAMILY = { hand: '"Patrick Hand", "Segoe Print", cursive', arial: 'Arial, Arimo, "Liberation Sans", sans-serif' };
export const LINE_HEIGHT = 1.25;
export const PDF = { header: 32, pad: 12, gap: 12 };

export const DEFAULT_STYLE = {
  strokeColor: '#0a0a0a',
  fillColor: 'transparent',
  fillStyle: 'hachure',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  font: 'hand',
  fontSize: 24,
  align: 'left',
  startHead: 'none',
  endHead: 'none',
};

const STYLE_KEYS = ['strokeColor', 'fillColor', 'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity'];

export function createElement(type, props = {}, style = DEFAULT_STYLE) {
  const base = {
    id: newId(), type, x: 0, y: 0, w: 0, h: 0, angle: 0, seed: newSeed(), version: 1,
  };
  for (const k of STYLE_KEYS) base[k] = style[k] ?? DEFAULT_STYLE[k];
  switch (type) {
    // label: text inside the shape; topic: mind-map node (box hugs its label); parentId: mind-map parent.
    case 'shape': Object.assign(base, { shapeId: 'rect', params: {}, label: '', font: style.font ?? 'hand', fontSize: style.fontSize ?? 24, topic: false, parentId: null }); break;
    // startBinding / endBinding: id of the element an end is attached to (connector follows it).
    case 'line': Object.assign(base, { kind: 'segment', points: [[0, 0]], startHead: style.startHead ?? 'none', endHead: style.endHead ?? 'none', startBinding: null, endBinding: null }); break;
    case 'draw': Object.assign(base, { points: [], highlighter: false }); break;
    case 'text': Object.assign(base, { text: '', font: style.font ?? 'hand', fontSize: style.fontSize ?? 24, align: style.align ?? 'left' }); break;
    case 'math': Object.assign(base, { latex: '', source: '', mode: 'quick', fontSize: 28 }); break;
    case 'image': Object.assign(base, { fileId: null }); break;
    case 'pdf': Object.assign(base, { fileId: null, name: '', pages: [], scroll: 0, annotations: [] }); break;
    default: throw new Error('Unknown element type ' + type);
  }
  return Object.assign(base, props);
}

export function updateElement(el, patch) {
  return { ...el, ...patch, version: el.version + 1 };
}

// ---------- line / draw point helpers ----------

/** Re-anchor a points-based element so its bounds start at (0, 0). Points given in world coords. */
export function withWorldPoints(el, worldPoints) {
  const b = boundsOfPoints(worldPoints);
  const points = worldPoints.map((p) => (p.length > 2 ? [p[0] - b.minX, p[1] - b.minY, p[2]] : [p[0] - b.minX, p[1] - b.minY]));
  return updateElement(el, { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY, points });
}

export const worldPoints = (el) => el.points.map((p) => [p[0] + el.x, p[1] + el.y]);

/** Sampled centerline of a line element in local coords. */
export function linePolyline(el) {
  const pts = el.points;
  if (pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  if (el.kind === 'curve' && pts.length > 2) {
    const out = [pts[0]];
    for (const [p0, c1, c2, p1] of catmullRomToBezier(pts)) for (let i = 1; i <= 12; i++) out.push(cubicAt(p0, c1, c2, p1, i / 12));
    return out;
  }
  if (el.kind === 'arc' && pts.length === 3) {
    const arc = arcThrough(pts[0], pts[1], pts[2]);
    if (arc) return sampleArc(arc, 48);
  }
  return pts.map((p) => [p[0], p[1]]);
}

/** SVG path string for a line element (local coords). */
export function linePathD(el) {
  const pts = el.points;
  if (!pts.length) return '';
  const f = (n) => Math.round(n * 100) / 100;
  if (el.kind === 'curve' && pts.length > 2) {
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (const [, c1, c2, p1] of catmullRomToBezier(pts)) d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p1[0])} ${f(p1[1])}`;
    return d;
  }
  if (el.kind === 'arc' && pts.length === 3) {
    const arc = arcThrough(pts[0], pts[1], pts[2]);
    if (arc) {
      const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let sweepAngle = norm(arc.end - arc.start);
      if (arc.ccw) sweepAngle = 2 * Math.PI - sweepAngle;
      const large = sweepAngle > Math.PI ? 1 : 0;
      const sweep = arc.ccw ? 0 : 1;
      return `M${f(pts[0][0])} ${f(pts[0][1])} A${f(arc.r)} ${f(arc.r)} 0 ${large} ${sweep} ${f(pts[2][0])} ${f(pts[2][1])}`;
    }
  }
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join(' ');
}

// ---------- text ----------

let measureCtx = null;
export function measureText(text, font, fontSize) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${fontSize}px ${FONT_FAMILY[font] || FONT_FAMILY.hand}`;
  const lines = String(text).split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l).width);
  return { w: Math.ceil(w) + 2, h: Math.ceil(lines.length * fontSize * LINE_HEIGHT), lines };
}

export function withText(el, text) {
  const t = nfc(text);
  const m = measureText(t, el.font, el.fontSize);
  return updateElement(el, { text: t, w: m.w, h: m.h });
}

export const LABEL_PAD = { x: 18, y: 10 };
export const TOPIC_MIN = { w: 96, h: 44 };
export const labelColor = (el) => (el.strokeColor === 'transparent' ? '#0a0a0a' : el.strokeColor);

/**
 * Sets a shape's label. Topics (mind-map boxes) hug the text; other shapes only grow when the
 * text would not fit. The box stays centered on its current center.
 */
export function withLabel(el, text) {
  const label = nfc(text);
  const m = measureText(label || ' ', el.font, el.fontSize);
  const needW = m.w + LABEL_PAD.x * 2, needH = m.h + LABEL_PAD.y * 2;
  const w = el.topic ? Math.max(TOPIC_MIN.w, needW) : Math.max(el.w, label ? needW : 0);
  const h = el.topic ? Math.max(TOPIC_MIN.h, needH) : Math.max(el.h, label ? needH : 0);
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  return updateElement(el, { label, w, h, x: cx - w / 2, y: cy - h / 2 });
}

// ---------- pdf layout ----------

/** Page rectangles in element-local content space (before scroll), scaled to the element width. */
export function pdfLayout(el) {
  const innerW = Math.max(10, el.w - PDF.pad * 2);
  let y = PDF.pad;
  const pages = (el.pages || []).map(([pw, ph]) => {
    const hh = innerW * (ph / Math.max(1, pw));
    const r = { x: PDF.pad, y, w: innerW, h: hh };
    y += hh + PDF.gap;
    return r;
  });
  const contentH = Math.max(0, y - PDF.gap + PDF.pad);
  const viewH = Math.max(0, el.h - PDF.header);
  const maxScroll = Math.max(0, contentH - viewH);
  return { innerW, pages, contentH, viewH, maxScroll, scrollPx: clamp(el.scroll || 0, 0, 1) * maxScroll };
}

export function pdfCurrentPage(el) {
  const L = pdfLayout(el);
  const center = L.scrollPx + L.viewH / 2;
  for (let i = 0; i < L.pages.length; i++) if (center <= L.pages[i].y + L.pages[i].h + PDF.gap / 2) return i;
  return Math.max(0, L.pages.length - 1);
}

// ---------- geometry in world space ----------

export const center = (el) => [el.x + el.w / 2, el.y + el.h / 2];

/** Map a world point into the element's unrotated local frame (origin top-left). */
export function toLocal(el, p) {
  const c = center(el);
  const q = el.angle ? rotate(p, c, -el.angle) : p;
  return [q[0] - el.x, q[1] - el.y];
}

export function toWorld(el, p) {
  const q = [p[0] + el.x, p[1] + el.y];
  return el.angle ? rotate(q, center(el), el.angle) : q;
}

export function corners(el) {
  return [[0, 0], [el.w, 0], [el.w, el.h], [0, el.h]].map((p) => toWorld(el, p));
}

/** Axis-aligned world bounds, including stroke allowance. */
export function getBounds(el) {
  const pad = (el.strokeWidth || 0) / 2 + (el.type === 'line' ? headSize(el) : 0);
  const b = boundsOfPoints(corners(el));
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

export const headSize = (el) => (el.startHead !== 'none' || el.endHead !== 'none' ? Math.max(10, el.strokeWidth * 4) : 0);

const geoCache = new WeakMap();
/** Local geometry: {polylines: [{points, closed}], fillable, keyPoints, center}. Cached per element object. */
export function localGeometry(el) {
  let g = geoCache.get(el);
  if (g) return g;
  const rect = { points: [[0, 0], [el.w, 0], [el.w, el.h], [0, el.h]], closed: true };
  switch (el.type) {
    case 'shape': {
      const sg = shapeGeometry(el.shapeId, el.params, el.w, el.h);
      g = { polylines: sg.polylines, fillable: sg.closed, keyPoints: sg.keyPoints, cmds: sg.cmds, fillCmds: sg.fillCmds };
      break;
    }
    case 'line': {
      const pl = linePolyline(el);
      const verts = el.points.map((p) => [p[0], p[1]]);
      const mids = [];
      if (el.kind !== 'curve' && el.kind !== 'arc') for (let i = 1; i < verts.length; i++) mids.push([(verts[i - 1][0] + verts[i][0]) / 2, (verts[i - 1][1] + verts[i][1]) / 2]);
      else if (pl.length > 2) mids.push(pl[Math.floor(pl.length / 2)]);
      g = { polylines: [{ points: pl, closed: false }], fillable: false, keyPoints: { vertices: verts, midpoints: mids } };
      break;
    }
    case 'draw':
      g = { polylines: [{ points: el.points.map((p) => [p[0], p[1]]), closed: false }], fillable: false, keyPoints: { vertices: [], midpoints: [] } };
      break;
    default:
      g = { polylines: [rect], fillable: true, keyPoints: { vertices: rect.points, midpoints: [[el.w / 2, 0], [el.w, el.h / 2], [el.w / 2, el.h], [0, el.h / 2]] } };
  }
  g.center = [el.w / 2, el.h / 2];
  geoCache.set(el, g);
  return g;
}

export function worldPolylines(el) {
  return localGeometry(el).polylines.map((s) => ({ points: s.points.map((p) => toWorld(el, p)), closed: s.closed }));
}

/**
 * Hit test in world space. `tol` is in world units (pass screenTolerance / zoom).
 * Boxes (text, math, image, pdf) hit anywhere inside; filled shapes hit inside; otherwise near the stroke.
 */
export function hitTest(el, p, tol) {
  const b = getBounds(el);
  if (p[0] < b.minX - tol || p[0] > b.maxX + tol || p[1] < b.minY - tol || p[1] > b.maxY + tol) return false;
  const lp = toLocal(el, p);
  const stroke = tol + (el.strokeWidth || 1) / 2;
  if (el.type === 'text' || el.type === 'math' || el.type === 'image' || el.type === 'pdf') {
    return lp[0] >= -tol && lp[1] >= -tol && lp[0] <= el.w + tol && lp[1] <= el.h + tol;
  }
  const g = localGeometry(el);
  if (el.type === 'draw') {
    const width = (el.highlighter ? el.strokeWidth * 6 : el.strokeWidth * 2) / 2;
    return distToPolyline(lp, g.polylines[0].points) <= tol + width;
  }
  for (const s of g.polylines) if (distToPolyline(lp, s.points, s.closed) <= stroke) return true;
  // A shape with a label (e.g. a borderless mind-map topic) is grabbable anywhere in its box.
  if (el.type === 'shape' && el.label) return lp[0] >= 0 && lp[1] >= 0 && lp[0] <= el.w && lp[1] <= el.h;
  if (el.type === 'shape' && g.fillable && el.fillColor !== 'transparent') {
    return pointInRings(lp, g.polylines.filter((s) => s.closed).map((s) => s.points));
  }
  return false;
}

/** World-space key points for snapping: {vertices, midpoints, center}. */
export function snapPointsOf(el) {
  const g = localGeometry(el);
  const out = {
    vertices: g.keyPoints.vertices.map((p) => toWorld(el, p)),
    midpoints: g.keyPoints.midpoints.map((p) => toWorld(el, p)),
    centers: [],
  };
  if (el.type !== 'line' && el.type !== 'draw') out.centers.push(toWorld(el, g.center));
  return out;
}

// ---------- validation for imported / restored data ----------

const COLOR_RE = /^(transparent|#[0-9a-fA-F]{3,8})$/;
const num = (v, d = 0) => (isFiniteNumber(v) ? v : d);
const refId = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const pointList = (arr, withPressure) => (Array.isArray(arr) ? arr : [])
  .filter((p) => Array.isArray(p) && isFiniteNumber(p[0]) && isFiniteNumber(p[1]))
  .slice(0, 50000)
  .map((p) => (withPressure && isFiniteNumber(p[2]) ? [p[0], p[1], clamp(p[2], 0, 1)] : [p[0], p[1]]));

/** Returns a safe element or null. Never trusts input shape; unknown fields are dropped. */
export function sanitizeElement(raw) {
  if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return null;
  const el = createElement(raw.type);
  el.id = typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : el.id;
  el.x = num(raw.x); el.y = num(raw.y);
  el.w = Math.max(0, num(raw.w)); el.h = Math.max(0, num(raw.h));
  el.angle = ROTATABLE.has(raw.type) ? num(raw.angle) % (Math.PI * 2) : 0;
  el.seed = Number.isInteger(raw.seed) && raw.seed > 0 ? raw.seed : el.seed;
  el.version = Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1;
  el.strokeColor = COLOR_RE.test(raw.strokeColor) ? raw.strokeColor : DEFAULT_STYLE.strokeColor;
  el.fillColor = COLOR_RE.test(raw.fillColor) ? raw.fillColor : 'transparent';
  el.fillStyle = pick(raw.fillStyle, ['hachure', 'cross-hatch', 'solid'], 'hachure');
  el.strokeWidth = clamp(num(raw.strokeWidth, 2), 0.5, 40);
  el.strokeStyle = pick(raw.strokeStyle, ['solid', 'dashed', 'dotted'], 'solid');
  el.roughness = pick(raw.roughness, [0, 1, 2], 1);
  el.opacity = clamp(num(raw.opacity, 100), 0, 100);
  const str = (v, max) => (typeof v === 'string' ? nfc(v).slice(0, max) : '');
  switch (raw.type) {
    case 'shape':
      el.shapeId = SHAPES.has(raw.shapeId) ? raw.shapeId : 'rect';
      el.params = {
        sides: clamp(Math.round(num(raw.params?.sides, 6)), 3, 24),
        points: clamp(Math.round(num(raw.params?.points, 5)), 3, 24),
        inner: clamp(num(raw.params?.inner, 0.45), 0.1, 0.95),
      };
      el.label = str(raw.label, 5000);
      el.font = pick(raw.font, ['hand', 'arial'], 'hand');
      el.fontSize = clamp(num(raw.fontSize, 24), 4, 400);
      el.topic = raw.topic === true;
      el.parentId = refId(raw.parentId);
      break;
    case 'line':
      el.kind = pick(raw.kind, ['segment', 'polyline', 'curve', 'arc'], 'polyline');
      el.points = pointList(raw.points, false);
      el.startHead = pick(raw.startHead, ['none', 'arrow', 'dot', 'bar'], 'none');
      el.endHead = pick(raw.endHead, ['none', 'arrow', 'dot', 'bar'], 'none');
      el.startBinding = refId(raw.startBinding);
      el.endBinding = refId(raw.endBinding);
      if (el.points.length < 2) return null;
      if (el.kind === 'arc' && el.points.length !== 3) el.kind = 'polyline';
      break;
    case 'draw':
      el.points = pointList(raw.points, true);
      el.highlighter = raw.highlighter === true;
      if (!el.points.length) return null;
      break;
    case 'text':
      el.text = str(raw.text, 100000);
      el.font = pick(raw.font, ['hand', 'arial'], 'hand');
      el.fontSize = clamp(num(raw.fontSize, 24), 4, 400);
      el.align = pick(raw.align, ['left', 'center', 'right'], 'left');
      if (!el.text.trim()) return null;
      break;
    case 'math':
      el.latex = str(raw.latex, 20000);
      el.source = str(raw.source, 20000);
      el.mode = pick(raw.mode, ['quick', 'latex'], 'latex');
      el.fontSize = clamp(num(raw.fontSize, 28), 6, 400);
      if (!el.latex.trim()) return null;
      break;
    case 'image':
    case 'pdf':
      el.fileId = typeof raw.fileId === 'string' && raw.fileId.length <= 64 ? raw.fileId : null;
      if (!el.fileId) return null;
      if (raw.type === 'pdf') {
        el.name = str(raw.name, 260);
        el.pages = (Array.isArray(raw.pages) ? raw.pages : [])
          .filter((p) => Array.isArray(p) && num(p[0]) > 0 && num(p[1]) > 0).slice(0, 5000).map((p) => [p[0], p[1]]);
        el.scroll = clamp(num(raw.scroll), 0, 1);
        el.annotations = (Array.isArray(raw.annotations) ? raw.annotations : []).slice(0, 5000).map((a) => ({
          id: typeof a?.id === 'string' ? a.id.slice(0, 64) : newId(),
          color: COLOR_RE.test(a?.color) ? a.color : '#e03131',
          size: clamp(num(a?.size, 0.004), 0.0005, 0.05),
          points: pointList(a?.points, true),
        })).filter((a) => a.points.length);
      }
      break;
  }
  if (el.type === 'line' || el.type === 'draw') {
    // Re-anchor so local points start at (0, 0); keeps bounds math consistent everywhere.
    const b = boundsOfPoints(el.points);
    el.points = el.points.map((p) => (p.length > 2 ? [p[0] - b.minX, p[1] - b.minY, p[2]] : [p[0] - b.minX, p[1] - b.minY]));
    el.x += b.minX; el.y += b.minY;
    el.w = b.maxX - b.minX; el.h = b.maxY - b.minY;
  }
  return el;
}
