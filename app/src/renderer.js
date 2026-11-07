// Canvas rendering. World -> screen: screen = (world + scroll) * zoom.

import rough from '../vendor/roughjs/rough.esm.js';
import { getStroke } from '../vendor/perfect-freehand/index.mjs';
import {
  FONT_FAMILY, LINE_HEIGHT, PDF, getBounds, localGeometry, linePathD, linePolyline, pdfLayout, pdfCurrentPage, headSize, labelColor,
} from './elements.js';
import { pathToString } from './svgpath.js';
import { boundsIntersect } from './geometry.js';
import { selectionFrame, getHandles, HANDLE_SIZE } from './transform.js';

export const SELECTION_COLOR = '#2f6bff';
const DASH = { solid: undefined, dashed: [10, 8], dotted: [2, 7] };

/** Drawable cache keyed by element object identity (elements are immutable). */
const drawableCache = new WeakMap();
const outlineCache = new WeakMap();

export function viewportBounds(camera, width, height) {
  return { minX: -camera.scrollX, minY: -camera.scrollY, maxX: -camera.scrollX + width / camera.zoom, maxY: -camera.scrollY + height / camera.zoom };
}

function roughOptions(el) {
  const sw = el.strokeWidth;
  return {
    seed: el.seed,
    roughness: el.roughness === 0 ? 0 : el.roughness === 2 ? 2.2 : 1,
    bowing: el.roughness === 0 ? 0 : 1,
    stroke: el.strokeColor === 'transparent' ? 'none' : el.strokeColor,
    strokeWidth: sw,
    strokeLineDash: DASH[el.strokeStyle],
    disableMultiStroke: el.strokeStyle !== 'solid',
    preserveVertices: true,
    fillStyle: el.fillStyle,
    hachureGap: Math.max(4, sw * 4),
    fillWeight: Math.max(0.5, sw / 2),
    curveFitting: 0.95,
  };
}

function headPoints(el) {
  const pl = linePolyline(el);
  if (pl.length < 2) return [];
  const heads = [];
  const hs = headSize(el);
  const mk = (tip, from, type) => {
    if (type === 'none') return;
    const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    heads.push({ tip, ang, type, hs });
  };
  // Use a point a few pixels back along the line for a stable tangent.
  const back = (arr) => {
    const tip = arr[0];
    for (let i = 1; i < arr.length; i++) if (Math.hypot(arr[i][0] - tip[0], arr[i][1] - tip[1]) > Math.min(hs, 8)) return arr[i];
    return arr[arr.length - 1];
  };
  mk(pl[pl.length - 1], back(pl.slice().reverse()), el.endHead);
  mk(pl[0], back(pl), el.startHead);
  return heads;
}

function buildDrawables(gen, el) {
  const o = roughOptions(el);
  const list = [];
  if (el.type === 'shape') {
    const g = localGeometry(el);
    if (g.fillCmds.length && el.fillColor !== 'transparent') {
      list.push(gen.path(pathToString(g.fillCmds), { ...o, stroke: 'none', fill: el.fillColor }));
    }
    if (o.stroke !== 'none') list.push(gen.path(pathToString(g.cmds), { ...o, fill: undefined }));
  } else if (el.type === 'line') {
    const d = linePathD(el);
    if (d) list.push(gen.path(d, { ...o, fill: undefined }));
    for (const hd of headPoints(el)) {
      const { tip, ang, hs, type } = hd;
      if (type === 'arrow') {
        const a1 = [tip[0] - hs * Math.cos(ang - 0.45), tip[1] - hs * Math.sin(ang - 0.45)];
        const a2 = [tip[0] - hs * Math.cos(ang + 0.45), tip[1] - hs * Math.sin(ang + 0.45)];
        list.push(gen.linearPath([a1, tip, a2], { ...o, strokeLineDash: undefined }));
      } else if (type === 'dot') {
        list.push(gen.circle(tip[0], tip[1], hs * 0.7, { ...o, fill: el.strokeColor, fillStyle: 'solid', strokeLineDash: undefined }));
      } else if (type === 'bar') {
        const px = Math.cos(ang + Math.PI / 2) * hs * 0.6, py = Math.sin(ang + Math.PI / 2) * hs * 0.6;
        list.push(gen.line(tip[0] - px, tip[1] - py, tip[0] + px, tip[1] + py, { ...o, strokeLineDash: undefined }));
      }
    }
  }
  return list;
}

export function freehandPath(points, size, highlighter) {
  const outline = getStroke(points, {
    size,
    thinning: highlighter ? 0 : 0.55,
    smoothing: 0.6,
    streamline: 0.45,
    simulatePressure: !points.some((p) => p[2] !== undefined && p[2] !== 0.5),
    last: true,
  });
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

/**
 * Draws one element in its local frame. `ctx` must already have the world transform applied.
 * `res` supplies async-loaded resources: {image(fileId), math(el, scale), pdfPage(el, index, ppp)}.
 */
export function drawElement(ctx, rc, el, res, opts = {}) {
  ctx.save();
  ctx.globalAlpha *= (el.opacity / 100) * (opts.faded ? 0.25 : 1);
  ctx.translate(el.x, el.y);
  if (el.angle) {
    ctx.translate(el.w / 2, el.h / 2);
    ctx.rotate(el.angle);
    ctx.translate(-el.w / 2, -el.h / 2);
  }
  switch (el.type) {
    case 'shape':
    case 'line': {
      let list = drawableCache.get(el);
      if (!list) { list = buildDrawables(rc.generator, el); drawableCache.set(el, list); }
      for (const d of list) rc.draw(d);
      if (el.type === 'shape' && el.label && !opts.hideLabel) drawLabel(ctx, el);
      break;
    }
    case 'draw': {
      let path = outlineCache.get(el);
      if (!path) {
        path = freehandPath(el.points, el.highlighter ? el.strokeWidth * 6 : el.strokeWidth * 2.2, el.highlighter);
        outlineCache.set(el, path);
      }
      ctx.fillStyle = el.strokeColor;
      if (el.highlighter) { ctx.globalAlpha *= 0.4; ctx.globalCompositeOperation = 'multiply'; }
      ctx.fill(path);
      break;
    }
    case 'text': {
      ctx.fillStyle = el.strokeColor;
      ctx.font = `${el.fontSize}px ${FONT_FAMILY[el.font] || FONT_FAMILY.hand}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = el.align;
      const lh = el.fontSize * LINE_HEIGHT;
      const x = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w : 0;
      // Center glyphs inside each line box (line-height > 1).
      const pad = (lh - el.fontSize) / 2;
      el.text.split('\n').forEach((line, i) => ctx.fillText(line, x, i * lh + pad));
      break;
    }
    case 'math': {
      const img = res.math(el, opts.scale || 1);
      if (img) ctx.drawImage(img, 0, 0, el.w, el.h);
      else placeholder(ctx, el.w, el.h, el.latex.slice(0, 40));
      break;
    }
    case 'image': {
      const img = res.image(el.fileId);
      if (img) ctx.drawImage(img, 0, 0, el.w, el.h);
      else placeholder(ctx, el.w, el.h, 'Đang tải ảnh…');
      break;
    }
    case 'pdf':
      drawPdf(ctx, el, res, opts);
      break;
  }
  ctx.restore();
}

/** Label centered in a shape's box (local coords). */
function drawLabel(ctx, el) {
  ctx.fillStyle = labelColor(el);
  ctx.font = `${el.fontSize}px ${FONT_FAMILY[el.font] || FONT_FAMILY.hand}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  const lh = el.fontSize * LINE_HEIGHT;
  const lines = el.label.split('\n');
  const top = el.h / 2 - (lines.length * lh) / 2 + (lh - el.fontSize) / 2;
  lines.forEach((line, i) => ctx.fillText(line, el.w / 2, top + i * lh));
}

function placeholder(ctx, w, h, label) {
  ctx.fillStyle = '#f3f3f3';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#cfcfcf';
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(0, 0, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#6b6b6b';
  ctx.font = '12px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2, Math.max(10, w - 8));
}

function drawPdf(ctx, el, res, opts) {
  const L = pdfLayout(el);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, el.w, el.h);
  // Header
  ctx.fillStyle = '#0a0a0a';
  ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const total = el.pages.length;
  const label = total ? `${pdfCurrentPage(el) + 1} / ${total}` : '…';
  ctx.fillText(el.name || 'tài liệu.pdf', 12, PDF.header / 2, Math.max(10, el.w - 90));
  ctx.textAlign = 'right';
  ctx.fillStyle = '#5e5e5e';
  ctx.font = '12px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(label, el.w - 12, PDF.header / 2);
  ctx.fillStyle = '#ececec';
  ctx.fillRect(0, PDF.header - 1, el.w, 1);
  // Content
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, PDF.header, el.w, Math.max(0, el.h - PDF.header));
  ctx.clip();
  ctx.fillStyle = '#f1f1f1';
  ctx.fillRect(0, PDF.header, el.w, el.h - PDF.header);
  const top = PDF.header - L.scrollPx;
  const zoom = opts.zoom || 1, dpr = opts.dpr || 1;
  el.pages.forEach(([pw], i) => {
    const r = L.pages[i];
    const y = top + r.y;
    if (y > el.h || y + r.h < PDF.header) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(r.x, y, r.w, r.h);
    const bmp = res.pdfPage(el, i, (r.w / pw) * zoom * dpr);
    if (bmp) ctx.drawImage(bmp, r.x, y, r.w, r.h);
    ctx.strokeStyle = '#dcdcdc';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, y, r.w, r.h);
  });
  // Annotations (normalized to inner width)
  const k = L.innerW;
  for (const a of el.annotations || []) {
    const pts = a.points.map((p) => [PDF.pad + p[0] * k, top + PDF.pad + p[1] * k, p[2]]);
    ctx.fillStyle = a.color;
    ctx.fill(freehandPath(pts, Math.max(1, a.size * k), false));
  }
  // Scrollbar
  if (L.maxScroll > 0) {
    const trackH = L.viewH - 8;
    const thumbH = Math.max(24, trackH * (L.viewH / L.contentH));
    const ty = PDF.header + 4 + (trackH - thumbH) * (L.scrollPx / L.maxScroll);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, el.w - 8, ty, 5, thumbH, 2.5);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#d4d4d4';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, el.w, el.h);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rc = rough.canvas(canvas);
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
  }

  resize(width, height, dpr) {
    this.width = width; this.height = height; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
  }

  /**
   * view: {camera, elements, selectedIds, editingId, fadedIds, snap, marquee, eraserTrail, laserTrail,
   *        draftHint, showGrid, res}
   */
  render(view) {
    const { ctx, dpr } = this;
    const { camera } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (view.showGrid) this.drawGrid(camera);

    const z = camera.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, camera.scrollX * z, camera.scrollY * z);
    const vb = viewportBounds(camera, this.width, this.height);
    for (const el of view.elements) {
      const editing = el.id === view.editingId;
      if (editing && el.type !== 'shape') continue; // text being edited is shown by the editor
      if (!boundsIntersect(getBounds(el), vb)) continue;
      drawElement(ctx, this.rc, el, view.res, { faded: view.fadedIds && view.fadedIds.has(el.id), zoom: camera.zoom, dpr, scale: camera.zoom * dpr, hideLabel: editing });
    }

    // Screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = (p) => [(p[0] + camera.scrollX) * camera.zoom, (p[1] + camera.scrollY) * camera.zoom];
    const selected = view.elements.filter((e) => view.selectedIds.has(e.id) && e.id !== view.editingId);
    if (selected.length) this.drawSelection(selected, camera, S, view.hideHandles);
    if (view.marquee) {
      const [a, b] = [S(view.marquee[0]), S(view.marquee[1])];
      ctx.fillStyle = 'rgba(47,107,255,0.08)';
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    }
    if (view.eraserTrail && view.eraserTrail.length > 1) this.drawTrail(view.eraserTrail.map(S), 'rgba(120,120,120,', view.eraserWidth || 10);
    if (view.laser && view.laser.points.length) this.drawLaser(view.laser, S);
    if (view.eraserCursor) this.drawEraserCursor(view.eraserCursor.p, view.eraserCursor.r);
    if (view.laserDot) this.drawLaserDot(view.laserDot, 1);
    if (view.snap) this.drawSnap(S(view.snap.point), view.snap.label);
  }

  drawEraserCursor(p, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0a0a0a';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p[0], p[1], r + 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }

  /** Glowing red dot, like the beam of a real laser pointer. */
  drawLaserDot(p, strength) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 14);
    g.addColorStop(0, `rgba(255,70,60,${0.55 * strength})`);
    g.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p[0], p[1], 4.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,30,30,${strength})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p[0], p[1], 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,235,230,${strength})`;
    ctx.fill();
  }

  /**
   * Laser trail: tapers toward the tail, fades with age, red glow with a bright core.
   * laser: {points: [{p, t}], now, life}
   */
  drawLaser(laser, S) {
    const { ctx } = this;
    const pts = laser.points.map((q) => ({ s: S(q.p), a: 1 - (laser.now - q.t) / laser.life }));
    ctx.save();
    // Butt caps: segments meet at shared midpoints with the same tangent, so translucent
    // strokes never overlap (round caps would leave darker "beads" at every joint).
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const pass = (width, color, blur) => {
      ctx.shadowBlur = blur;
      ctx.shadowColor = 'rgba(255,30,30,0.9)';
      for (let i = 1; i < pts.length; i++) {
        const a = Math.max(0, Math.min(pts[i].a, pts[i - 1].a));
        if (a <= 0) continue;
        // Width grows toward the newest point; smooth through midpoints.
        const t = i / pts.length;
        ctx.lineWidth = width * (0.25 + 0.75 * t) * (0.4 + 0.6 * a);
        ctx.strokeStyle = color(a);
        const p0 = pts[i - 1].s, p1 = pts[i].s;
        const pm = i > 1 ? [(pts[i - 2].s[0] + p0[0]) / 2, (pts[i - 2].s[1] + p0[1]) / 2] : p0;
        const pn = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        ctx.beginPath();
        ctx.moveTo(pm[0], pm[1]);
        ctx.quadraticCurveTo(p0[0], p0[1], pn[0], pn[1]);
        if (i === pts.length - 1) ctx.lineTo(p1[0], p1[1]);
        ctx.stroke();
      }
    };
    pass(9, (a) => `rgba(255,40,40,${0.55 * a})`, 14);
    pass(3.5, (a) => `rgba(255,225,220,${0.95 * a})`, 0);
    ctx.restore();
  }

  drawGrid(camera) {
    const { ctx, dpr } = this;
    const step = 24 * camera.zoom;
    if (step < 10) return;
    ctx.fillStyle = '#e4e4e4';
    const ox = ((camera.scrollX * camera.zoom) % step + step) % step;
    const oy = ((camera.scrollY * camera.zoom) % step + step) % step;
    const r = Math.max(0.6, Math.min(1.2, camera.zoom)) * dpr;
    for (let x = ox; x < this.width; x += step) {
      for (let y = oy; y < this.height; y += step) ctx.fillRect(x * dpr - r / 2, y * dpr - r / 2, r, r);
    }
  }

  drawSelection(selected, camera, S, hideHandles) {
    const { ctx } = this;
    const frame = selectionFrame(selected);
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1;
    // Thin outline per element when several are selected.
    if (selected.length > 1) {
      ctx.setLineDash([4, 4]);
      for (const el of selected) {
        const b = getBounds(el);
        const a = S([b.minX, b.minY]), c = S([b.maxX, b.maxY]);
        ctx.strokeRect(a[0] + 0.5, a[1] + 0.5, c[0] - a[0], c[1] - a[1]);
      }
      ctx.setLineDash([]);
    }
    if (frame.kind === 'line') {
      // Outline along the line plus vertex handles.
      if (hideHandles) return;
      for (const hd of getHandles(frame, camera.zoom)) {
        const p = S(hd.point);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.stroke();
      }
      return;
    }
    const pad = 4;
    const cs = frame.corners.map(S);
    const cx = (cs[0][0] + cs[2][0]) / 2, cy = (cs[0][1] + cs[2][1]) / 2;
    // Draw the frame expanded by a few pixels so it does not cover strokes.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(frame.angle || 0);
    const w = Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]);
    const h = Math.hypot(cs[3][0] - cs[0][0], cs[3][1] - cs[0][1]);
    ctx.strokeRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2);
    ctx.restore();
    if (hideHandles) return;
    for (const hd of getHandles(frame, camera.zoom)) {
      const p = S(hd.point);
      ctx.fillStyle = '#fff';
      if (hd.id === 'rot') {
        ctx.beginPath();
        ctx.arc(p[0], p[1], HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        continue;
      }
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(frame.angle || 0);
      roundRect(ctx, -HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE, 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawTrail(pts, rgbaPrefix, width) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const t = i / pts.length;
      ctx.strokeStyle = rgbaPrefix + (0.15 + 0.5 * t) + ')';
      ctx.lineWidth = width * (0.3 + 0.7 * t);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
      ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
  }

  drawSnap(p, label) {
    const { ctx } = this;
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.fillStyle = SELECTION_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (!label) return;
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const x = p[0] + 12, y = p[1] + 12;
    roundRect(ctx, x, y, tw + 14, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 7, y + 10);
  }
}

/** Renders elements to a new canvas for PNG export (no selection, white background). */
export function renderToCanvas(elements, res, scale = 2, padding = 24) {
  const bs = elements.map(getBounds);
  const minX = Math.min(...bs.map((b) => b.minX)) - padding, minY = Math.min(...bs.map((b) => b.minY)) - padding;
  const maxX = Math.max(...bs.map((b) => b.maxX)) + padding, maxY = Math.max(...bs.map((b) => b.maxY)) + padding;
  const W = maxX - minX, H = maxY - minY;
  // Keep within browser canvas limits (~16k px side, ~ 128M px area).
  const s = Math.min(scale, 16000 / W, 16000 / H, Math.sqrt(120e6 / (W * H)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(W * s));
  canvas.height = Math.max(1, Math.ceil(H * s));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, -minX * s, -minY * s);
  const rc = rough.canvas(canvas);
  for (const el of elements) drawElement(ctx, rc, el, res, { zoom: s, dpr: 1, scale: s });
  return canvas;
}
