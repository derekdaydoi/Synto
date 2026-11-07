// Application controller: state, tools, pointer/keyboard handling, clipboard, files, autosave.

import { clamp, debounce, newId, nfc, arrayBufferToBase64, base64ToArrayBuffer } from './util.js';
import { dist, snapAngle, boundsContain, boundsOfPoints, rotate } from './geometry.js';
import {
  DEFAULT_STYLE, ROTATABLE, PDF, createElement, updateElement, withWorldPoints, worldPoints, withText, withLabel, labelColor, LABEL_PAD,
  getBounds, hitTest, measureText, pdfLayout, pdfCurrentPage, sanitizeElement,
} from './elements.js';
import { DEFAULT_PARAMS, shapeNeedsSquare, SHAPES } from './shapelib.js';
import { DEFAULT_SNAP, findSnap, snapMove } from './snapping.js';
import { History } from './history.js';
import { Renderer, renderToCanvas, viewportBounds } from './renderer.js';
import { selectionFrame, getHandles, hitHandle, resizeElement, scaleElement, groupScaleFactor, rotateAngle, moveLinePoint } from './transform.js';
import { applyAutoReplace } from './textinput.js';
import { reflowConnectors, dropDangling, remapReferences, bindingTargetAt, isBindable } from './connectors.js';
import { centralTopic, addChild as addChildTopicTo, addSibling as addSiblingTopicTo } from './mindmap.js';
import { canvasToPdf } from './pdfexport.js';
import { renderMathImage, measureMath } from './mathrender.js';
import { readPageSizes, getPageBitmap, setPageReadyCallback } from './pdfdoc.js';
import * as store from './storage.js';

const ZOOM_MIN = 0.1, ZOOM_MAX = 8;
const HIT_TOL = 6; // screen px
const SNAP_RADIUS = 12; // screen px
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp|svg\+xml)$/;
const LASER_LIFE = 900; // ms a laser trail point stays visible

export const TOOLS = ['hand', 'select', 'shape', 'line', 'pen', 'text', 'mindmap', 'math', 'eraser', 'laser'];

export class App {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('#canvas');
    this.renderer = new Renderer(this.canvas);
    this.textEditor = root.querySelector('#text-editor');
    this.state = {
      elements: [],
      selectedIds: new Set(),
      tool: 'select',
      toolLocked: false,
      lineKind: 'segment',
      penMode: 'pen', // 'pen' | 'highlighter'
      shapeId: 'rect',
      shapeParams: { ...DEFAULT_PARAMS },
      style: { ...DEFAULT_STYLE },
      camera: { scrollX: 0, scrollY: 0, zoom: 1 },
      snap: { ...DEFAULT_SNAP },
      editingId: null,
      pdfAnnotate: false,
      showGrid: true,
      fileName: null,
      eraserSize: 12, // radius in screen px
    };
    this.pointerScreen = null; // last pointer position over the canvas (for eraser/laser cursors)
    this.history = new History();
    this.listeners = new Set();
    this.action = null;
    this.lineDraft = null;
    this.snapHint = null;
    this.fadedIds = null;
    this.eraserTrail = null;
    this.laser = [];
    this.pointers = new Map();
    this.spaceDown = false;
    this.altDown = false;
    this.lastPointerWorld = [0, 0];
    this.frameRequested = false;
    this.saveState = 'saved';
    this.fileCache = new Map(); // fileId -> {id, mime, name, bytes}
    this.imageCache = new Map(); // fileId -> {img|null, loading}
    this.mathCache = new Map(); // el.id -> {key, img, pending}
    this.autosave = debounce(() => this.persist(), 400);
    this.res = {
      image: (id) => this.getImage(id),
      math: (el, scale) => this.getMathImage(el, scale),
      pdfPage: (el, i, ppp) => getPageBitmap(el.fileId, i, ppp, (id) => this.getFileBytes(id)),
    };
    setPageReadyCallback(() => this.requestRender());
  }

  // ---------- state plumbing ----------

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const fn of this.listeners) fn(what); }

  get elements() { return this.state.elements; }
  get selected() { return this.state.elements.filter((e) => this.state.selectedIds.has(e.id)); }
  byId(id) { return this.state.elements.find((e) => e.id === id) || null; }

  /** Replace the element list. commit=true records an undo step and autosaves. */
  setElements(next, { commit = false } = {}) {
    this.state.elements = next;
    const ids = new Set(next.map((e) => e.id));
    for (const id of [...this.state.selectedIds]) if (!ids.has(id)) this.state.selectedIds.delete(id);
    if (commit) this.commit();
    this.requestRender();
    this.emit('elements');
  }

  /** Replace some elements; connectors bound to them follow automatically. */
  replaceElements(map) {
    const next = this.state.elements.map((e) => map.get(e.id) || e);
    this.setElements(reflowConnectors(next, new Set(map.keys())));
  }

  /** Remove elements by id, together with connectors attached to them. */
  removeElements(ids, opts = {}) {
    this.setElements(dropDangling(this.elements.filter((e) => !ids.has(e.id)), ids), opts);
  }

  commit() {
    if (this.history.commit(this.state.elements)) {
      this.saveState = 'dirty';
      this.autosave();
      this.emit('history');
    }
  }

  undo() {
    if (this.action || this.lineDraft) return;
    this.finishTextEdit();
    const els = this.history.undo();
    if (els) { this.state.elements = els; this.afterHistoryJump(); }
  }

  redo() {
    if (this.action || this.lineDraft) return;
    this.finishTextEdit();
    const els = this.history.redo();
    if (els) { this.state.elements = els; this.afterHistoryJump(); }
  }

  afterHistoryJump() {
    const ids = new Set(this.state.elements.map((e) => e.id));
    for (const id of [...this.state.selectedIds]) if (!ids.has(id)) this.state.selectedIds.delete(id);
    this.saveState = 'dirty';
    this.autosave();
    this.requestRender();
    this.emit('elements');
    this.emit('history');
    this.emit('selection');
  }

  select(ids) {
    this.state.selectedIds = new Set(ids);
    this.requestRender();
    this.emit('selection');
  }

  setTool(tool, opts = {}) {
    if (!TOOLS.includes(tool)) return;
    this.finishLineDraft();
    this.finishTextEdit();
    this.state.tool = tool;
    if (opts.lineKind) this.state.lineKind = opts.lineKind;
    if (opts.shapeId && SHAPES.has(opts.shapeId)) this.state.shapeId = opts.shapeId;
    if (opts.penMode) this.state.penMode = opts.penMode;
    if (tool !== 'select' && tool !== 'hand') this.select([]);
    this.updateCursor();
    this.emit('tool');
  }

  /** Apply a style change to defaults and to the selected elements. */
  setStyle(patch) {
    Object.assign(this.state.style, patch);
    const sel = this.selected;
    if (sel.length) {
      const map = new Map();
      for (const el of sel) {
        const p = {};
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'font' || k === 'fontSize') { if (el.type === 'text' || el.type === 'shape') p[k] = v; }
          else if (k === 'align') { if (el.type === 'text') p[k] = v; }
          else if (k === 'strokeColor' && v === 'transparent' && el.type !== 'shape') continue; // only shapes go borderless
          else if (k === 'startHead' || k === 'endHead') { if (el.type === 'line') p[k] = v; }
          else if (k === 'fillColor' || k === 'fillStyle') { if (el.type === 'shape') p[k] = v; }
          else if (k in el) p[k] = v;
        }
        if (!Object.keys(p).length) continue;
        let next = updateElement(el, p);
        if (el.type === 'text') next = withText(next, next.text);
        if (el.type === 'shape' && next.label && ('font' in p || 'fontSize' in p)) next = withLabel(next, next.label);
        if (el.type === 'math' && 'strokeColor' in p) this.mathCache.delete(el.id);
        map.set(el.id, next);
      }
      if (map.size) { this.replaceElements(map); this.commit(); this.positionTextEditor(); }
    }
    this.emit('style');
  }

  setShapeParams(patch) {
    Object.assign(this.state.shapeParams, patch);
    const map = new Map();
    for (const el of this.selected) {
      if (el.type === 'shape' && (el.shapeId === 'polygon' || el.shapeId === 'star')) map.set(el.id, updateElement(el, { params: { ...el.params, ...patch } }));
    }
    if (map.size) { this.replaceElements(map); this.commit(); }
    this.emit('style');
  }

  // ---------- coordinates & camera ----------

  toWorld(sx, sy) {
    const c = this.state.camera;
    return [sx / c.zoom - c.scrollX, sy / c.zoom - c.scrollY];
  }

  toScreen(p) {
    const c = this.state.camera;
    return [(p[0] + c.scrollX) * c.zoom, (p[1] + c.scrollY) * c.zoom];
  }

  eventPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  zoomAt(newZoom, sx, sy) {
    const c = this.state.camera;
    const z = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
    const w = this.toWorld(sx, sy);
    c.zoom = z;
    c.scrollX = sx / z - w[0];
    c.scrollY = sy / z - w[1];
    this.afterCameraChange();
  }

  zoomBy(factor) {
    this.zoomAt(this.state.camera.zoom * factor, this.renderer.width / 2, this.renderer.height / 2);
  }

  resetZoom() { this.zoomAt(1, this.renderer.width / 2, this.renderer.height / 2); }

  zoomToFit(elements = this.elements) {
    if (!elements.length) {
      Object.assign(this.state.camera, { scrollX: 0, scrollY: 0, zoom: 1 });
      this.afterCameraChange();
      return;
    }
    const bs = elements.map(getBounds);
    const b = { minX: Math.min(...bs.map((x) => x.minX)), minY: Math.min(...bs.map((x) => x.minY)), maxX: Math.max(...bs.map((x) => x.maxX)), maxY: Math.max(...bs.map((x) => x.maxY)) };
    const W = this.renderer.width, H = this.renderer.height;
    // Leave room for the floating properties panel on wide screens.
    const padLeft = W < 790 ? 24 : W >= 1100 ? 260 : 80, padRight = W < 790 ? 24 : 80;
    const padTop = W < 790 ? 80 : 100, padBottom = W < 790 ? 140 : 80;
    const z = clamp(Math.min(1, (W - padLeft - padRight) / Math.max(1, b.maxX - b.minX), (H - padTop - padBottom) / Math.max(1, b.maxY - b.minY)), ZOOM_MIN, ZOOM_MAX);
    const c = this.state.camera;
    c.zoom = z;
    c.scrollX = (padLeft + (W - padLeft - padRight) / 2) / z - (b.minX + b.maxX) / 2;
    c.scrollY = (padTop + (H - padTop - padBottom) / 2) / z - (b.minY + b.maxY) / 2;
    this.afterCameraChange();
  }

  afterCameraChange() {
    this.positionTextEditor();
    this.requestRender();
    this.emit('camera');
    this.autosave();
  }

  viewportCenter() {
    return this.toWorld(this.renderer.width / 2, this.renderer.height / 2);
  }

  // ---------- rendering ----------

  requestRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.renderNow();
    });
  }

  renderNow() {
    const now = performance.now();
    this.laser = this.laser.filter((p) => now - p.t < LASER_LIFE);
    const tool = this.state.tool;
    const cursorTool = (tool === 'eraser' || tool === 'laser') && !this.spaceDown && this.pointerScreen && !(this.action && this.action.type === 'pan');
    this.renderer.render({
      camera: this.state.camera,
      elements: this.state.elements,
      selectedIds: this.state.selectedIds,
      editingId: this.state.editingId,
      fadedIds: this.fadedIds,
      snap: this.snapHint,
      marquee: this.action && this.action.type === 'marquee' ? [this.action.start, this.action.end] : null,
      eraserTrail: this.eraserTrail,
      eraserWidth: this.state.eraserSize * 2,
      laser: { points: this.laser, now, life: LASER_LIFE },
      eraserCursor: cursorTool && tool === 'eraser' ? { p: this.pointerScreen, r: this.state.eraserSize } : null,
      laserDot: cursorTool && tool === 'laser' ? this.pointerScreen : null,
      hideHandles: !!(this.action && ['move', 'resize', 'rotate'].includes(this.action.type)),
      showGrid: this.state.showGrid,
      res: this.res,
    });
    if (this.laser.length) this.requestRender();
    this.root.querySelector('#empty-hint').hidden = this.state.elements.length > 0 || !!this.action || !!this.lineDraft;
  }

  resize() {
    const r = this.root.getBoundingClientRect();
    this.renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
    this.positionTextEditor();
    this.requestRender();
    this.emit('resize');
  }

  // ---------- resources ----------

  async getFileRecord(id) {
    if (this.fileCache.has(id)) return this.fileCache.get(id);
    const f = await store.getFile(id);
    if (f) this.fileCache.set(id, f);
    return f || null;
  }

  async getFileBytes(id) {
    const f = await this.getFileRecord(id);
    return f ? f.bytes : null;
  }

  getImage(fileId) {
    const c = this.imageCache.get(fileId);
    if (c) return c.img;
    this.imageCache.set(fileId, { img: null });
    this.getFileRecord(fileId).then(async (f) => {
      if (!f) return;
      const url = URL.createObjectURL(new Blob([f.bytes], { type: f.mime }));
      const img = new Image();
      img.src = url;
      try { await img.decode(); this.imageCache.set(fileId, { img }); this.requestRender(); }
      catch { URL.revokeObjectURL(url); }
    }).catch(() => {});
    return null;
  }

  getMathImage(el, scale) {
    const bucket = clamp(2 ** Math.ceil(Math.log2(Math.max(1, scale))), 1, 8);
    const key = `${el.version}|${el.latex}|${el.fontSize}|${el.strokeColor}|${bucket}`;
    const c = this.mathCache.get(el.id);
    if (c && c.key === key && c.img) return c.img;
    if (!c || (c.key !== key && !c.pending)) {
      const entry = { key, img: c ? c.img : null, pending: true };
      this.mathCache.set(el.id, entry);
      renderMathImage(el.latex, el.fontSize, el.strokeColor, bucket).then((r) => {
        const cur = this.mathCache.get(el.id);
        if (cur === entry) { entry.img = r.img; entry.pending = false; this.requestRender(); }
      }).catch(() => { entry.pending = false; });
    }
    return c ? c.img : null;
  }

  // ---------- pointer handling ----------

  snapRadius() { return SNAP_RADIUS / this.state.camera.zoom; }

  snapPoint(p, opts = {}) {
    if (this.altDown) { this.snapHint = null; return p; }
    const s = findSnap(this.state.elements, p, {
      radius: this.snapRadius(), settings: this.state.snap, excludeIds: opts.exclude, from: opts.from,
    });
    this.snapHint = s;
    return s ? s.point : p;
  }

  onPointerDown(e) {
    if (document.activeElement !== this.textEditor) this.canvas.focus({ preventScroll: true });
    this.altDown = e.altKey;
    this.pointers.set(e.pointerId, this.eventPoint(e));
    if (this.pointers.size === 2) { this.startPinch(); return; }
    if (this.pointers.size > 2) return;
    if (this.state.editingId) { this.finishTextEdit(); if (this.state.tool === 'text') return; }
    const sp = this.eventPoint(e);
    const p = this.toWorld(sp[0], sp[1]);
    this.lastPointerWorld = p;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    if (e.button === 1 || this.spaceDown || this.state.tool === 'hand') {
      if (this.spaceTap) this.spaceTap.panned = true; // Space was held to pan, not tapped
      this.action = { type: 'pan', last: sp };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;

    switch (this.state.tool) {
      case 'select': return this.downSelect(p, e);
      case 'shape': return this.downShape(p, e);
      case 'line': return this.downLine(p, e);
      case 'pen': return this.downPen(p, e);
      case 'text': return this.downText(p);
      case 'math': this.emit({ type: 'open-math', point: p }); return;
      case 'mindmap': this.createCentralTopic(p); return;
      case 'eraser': return this.downEraser(p);
      case 'laser': this.action = { type: 'laser' }; this.laser.push({ p, t: performance.now() }); this.requestRender(); return;
    }
  }

  onPointerMove(e) {
    this.altDown = e.altKey;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.eventPoint(e));
    if (this.pinch) { this.movePinch(); return; }
    const sp = this.eventPoint(e);
    const p = this.toWorld(sp[0], sp[1]);
    this.lastPointerWorld = p;
    this.pointerScreen = sp;
    if (this.state.tool === 'eraser' || this.state.tool === 'laser') this.requestRender();
    const a = this.action;
    if (!a) {
      if (this.lineDraft) this.moveLineDraft(p, e.shiftKey);
      else if (this.state.tool === 'line' || this.state.tool === 'shape') { this.snapPoint(p); this.requestRender(); }
      else this.updateHoverCursor(p);
      return;
    }
    switch (a.type) {
      case 'pan': {
        const c = this.state.camera;
        c.scrollX += (sp[0] - a.last[0]) / c.zoom;
        c.scrollY += (sp[1] - a.last[1]) / c.zoom;
        a.last = sp;
        this.afterCameraChange();
        return;
      }
      case 'move': return this.moveSelection(p, e);
      case 'resize': return this.moveResize(p, e);
      case 'rotate': return this.moveRotate(p, e);
      case 'line-point': return this.moveLinePointAction(p, e);
      case 'marquee': a.end = p; this.requestRender(); return;
      case 'create-shape': return this.moveCreateShape(p, e);
      case 'line-drag': this.moveLineDraft(p, e.shiftKey); return;
      case 'draw': return this.moveDraw(p, e);
      case 'pdf-annotate': return this.movePdfAnnotate(p, e);
      case 'erase': return this.moveEraser(p);
      case 'laser': this.laser.push({ p, t: performance.now() }); this.requestRender(); return;
    }
  }

  onPointerUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
    const a = this.action;
    this.action = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!a) return;
    switch (a.type) {
      case 'pan': this.updateCursor(); break;
      case 'line-point':
        this.endLinePoint(a);
        this.snapHint = null;
        this.commit();
        this.emit('selection');
        break;
      case 'move': case 'resize': case 'rotate':
        this.snapHint = null;
        this.commit();
        this.emit('selection');
        break;
      case 'marquee': this.endMarquee(a, e.shiftKey); break;
      case 'create-shape': this.endCreateShape(a); break;
      case 'line-drag': this.endLineDrag(a); break;
      case 'draw': this.endDraw(a); break;
      case 'pdf-annotate': this.endPdfAnnotate(a); break;
      case 'erase': this.endEraser(); break;
      case 'laser': break;
    }
    this.requestRender();
  }

  onPointerCancel(e) {
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    if (!this.action) return;
    // Revert in-progress edits to the last committed state.
    const a = this.action;
    this.action = null;
    this.fadedIds = null;
    this.eraserTrail = null;
    this.snapHint = null;
    if (a.type !== 'pan' && a.type !== 'laser') this.setElements(this.history.current.slice());
    this.requestRender();
  }

  startPinch() {
    // Cancel any single-pointer action that just started.
    if (this.action && this.action.type !== 'pan') this.setElements(this.history.current.slice());
    this.action = null;
    this.cancelLineDraft();
    const [a, b] = [...this.pointers.values()];
    this.pinch = { dist: dist(a, b), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom: this.state.camera.zoom };
  }

  movePinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const d = dist(a, b);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const c = this.state.camera;
    // Pan by midpoint movement, then zoom around the new midpoint.
    c.scrollX += (m[0] - this.pinch.mid[0]) / c.zoom;
    c.scrollY += (m[1] - this.pinch.mid[1]) / c.zoom;
    this.pinch.mid = m;
    this.zoomAt(this.pinch.zoom * (d / Math.max(1, this.pinch.dist)), m[0], m[1]);
  }

  onWheel(e) {
    e.preventDefault();
    const sp = this.eventPoint(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-clamp(e.deltaY, -50, 50) * 0.01);
      this.zoomAt(this.state.camera.zoom * factor, sp[0], sp[1]);
      return;
    }
    const p = this.toWorld(sp[0], sp[1]);
    const pdf = this.pdfUnder(p, true);
    if (pdf) {
      const L = pdfLayout(pdf);
      if (L.maxScroll > 0) {
        const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
        const next = clamp(L.scrollPx + dy / this.state.camera.zoom, 0, L.maxScroll) / L.maxScroll;
        if (next !== pdf.scroll) {
          this.replaceElements(new Map([[pdf.id, { ...pdf, scroll: next }]]));
          this.autosave();
          this.emit('selection');
        }
        return;
      }
    }
    const c = this.state.camera;
    const k = e.deltaMode === 1 ? 30 : 1;
    const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
    const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
    c.scrollX -= dx / c.zoom;
    c.scrollY -= dy / c.zoom;
    this.afterCameraChange();
  }

  /** PDF element under p. With onlySelectedOrAnnotating, only when it is selected (or annotate mode is on). */
  pdfUnder(p, onlySelectedOrAnnotating) {
    const tol = HIT_TOL / this.state.camera.zoom;
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (el.type !== 'pdf') { if (hitTest(el, p, tol)) return null; continue; }
      if (!hitTest(el, p, 0)) continue;
      if (!onlySelectedOrAnnotating || this.state.selectedIds.has(el.id) || this.state.pdfAnnotate) return el;
      return null;
    }
    return null;
  }

  onDoubleClick(e) {
    const sp = this.eventPoint(e);
    const p = this.toWorld(sp[0], sp[1]);
    if (this.lineDraft) { this.finishLineDraft(false); return; }
    if (this.state.tool !== 'select') return;
    const hit = this.topHit(p);
    if (hit && (hit.type === 'text' || hit.type === 'shape')) { this.startTextEdit(hit); return; }
    if (hit && hit.type === 'math') { this.emit({ type: 'open-math', element: hit }); return; }
    if (!hit) this.downText(p);
  }

  // ---------- hit helpers ----------

  topHit(p) {
    const tol = HIT_TOL / this.state.camera.zoom;
    for (let i = this.elements.length - 1; i >= 0; i--) if (hitTest(this.elements[i], p, tol)) return this.elements[i];
    return null;
  }

  hitAny(p) { return !!this.topHit(p); }

  handleAt(p) {
    const sel = this.selected;
    if (!sel.length) return null;
    return hitHandle(getHandles(selectionFrame(sel), this.state.camera.zoom), p, this.state.camera.zoom);
  }

  insideSelectionFrame(p) {
    const sel = this.selected;
    if (!sel.length) return false;
    const f = selectionFrame(sel);
    if (f.kind === 'line') return false;
    if (f.kind === 'single') {
      const el = f.el;
      const c = [el.x + el.w / 2, el.y + el.h / 2];
      const q = rotate(p, c, -el.angle);
      return q[0] >= el.x && q[0] <= el.x + el.w && q[1] >= el.y && q[1] <= el.y + el.h;
    }
    const b = f.bounds;
    return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;
  }

  // ---------- select tool ----------

  downSelect(p, e) {
    const sel = this.selected;
    const hd = this.handleAt(p);
    if (hd) {
      const frame = selectionFrame(sel);
      const origs = new Map(sel.map((el) => [el.id, el]));
      if (hd.id === 'rot') { this.action = { type: 'rotate', frame, origs }; return; }
      if (hd.id.startsWith('p')) {
        // Dragging a bound end detaches it; it re-attaches on release if dropped on an element.
        const index = +hd.id.slice(1);
        const last = frame.el.points.length - 1;
        const orig = index === 0 && frame.el.startBinding ? { ...frame.el, startBinding: null }
          : index === last && frame.el.endBinding ? { ...frame.el, endBinding: null } : frame.el;
        this.action = { type: 'line-point', id: frame.el.id, index, orig };
        return;
      }
      this.action = { type: 'resize', frame, handle: hd.id, origs };
      return;
    }
    const hit = this.topHit(p);
    if (hit) {
      if (e.shiftKey) {
        const ids = new Set(this.state.selectedIds);
        if (ids.has(hit.id)) ids.delete(hit.id); else ids.add(hit.id);
        this.select(ids);
      } else if (!this.state.selectedIds.has(hit.id)) {
        this.select([hit.id]);
      }
      if (this.state.selectedIds.has(hit.id)) this.startMove(p);
      return;
    }
    if (!e.shiftKey && this.insideSelectionFrame(p)) { this.startMove(p); return; }
    if (!e.shiftKey) this.select([]);
    this.action = { type: 'marquee', start: p, end: p, base: new Set(this.state.selectedIds) };
  }

  startMove(p) {
    const sel = this.selected;
    const pts = [];
    for (const el of sel) { const b = getBounds(el); pts.push([b.minX, b.minY], [b.maxX, b.maxY]); }
    const bb = boundsOfPoints(pts);
    // A connector moved without the element it is attached to lets go of that element.
    const ids = new Set(sel.map((el) => el.id));
    const origs = new Map(sel.map((el) => {
      if (el.type !== 'line') return [el.id, el];
      const sb = el.startBinding && !ids.has(el.startBinding), eb = el.endBinding && !ids.has(el.endBinding);
      return [el.id, sb || eb ? { ...el, startBinding: sb ? null : el.startBinding, endBinding: eb ? null : el.endBinding } : el];
    }));
    this.action = { type: 'move', start: p, origs, bounds: bb, moved: false };
  }

  /** On release of a line end: attach it to the element under it (not to the other end's element). */
  endLinePoint(a) {
    const line = this.byId(a.id);
    if (!line) return;
    const last = line.points.length - 1;
    if (a.index !== 0 && a.index !== last) return;
    const p = worldPoints(line)[a.index];
    const other = a.index === 0 ? line.endBinding : line.startBinding;
    const target = bindingTargetAt(this.elements, p, 4 / this.state.camera.zoom, new Set([line.id, other].filter(Boolean)));
    const key = a.index === 0 ? 'startBinding' : 'endBinding';
    if ((target ? target.id : null) === line[key]) return;
    this.replaceElements(new Map([[line.id, updateElement(line, { [key]: target ? target.id : null })]]));
  }

  moveSelection(p, e) {
    const a = this.action;
    let dx = p[0] - a.start[0], dy = p[1] - a.start[1];
    if (!a.moved && Math.hypot(dx, dy) * this.state.camera.zoom < 2) return;
    a.moved = true;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    this.snapHint = null;
    if (!e.altKey) {
      const b = a.bounds;
      const moved = { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy };
      const s = snapMove(this.elements, moved, new Set(a.origs.keys()), this.snapRadius(), this.state.snap);
      if (s) { dx += s.dx; dy += s.dy; this.snapHint = s.snap; }
    }
    const map = new Map();
    for (const [id, el] of a.origs) map.set(id, updateElement(el, { x: el.x + dx, y: el.y + dy }));
    this.replaceElements(map);
  }

  moveResize(p, e) {
    const a = this.action;
    const map = new Map();
    if (a.frame.kind === 'group') {
      const { anchor, s } = groupScaleFactor(a.frame, a.handle, p);
      for (const [id, el] of a.origs) map.set(id, scaleElement(el, anchor, s));
    } else {
      const el = a.frame.el;
      const keep = el.type === 'image' ? !e.shiftKey : e.shiftKey || (el.type === 'shape' && shapeNeedsSquare(el.shapeId));
      map.set(el.id, resizeElement(a.origs.get(el.id), a.handle, p, keep));
    }
    this.replaceElements(map);
  }

  moveRotate(p, e) {
    const a = this.action;
    const angle = rotateAngle(a.frame, p, e.shiftKey);
    const el = a.frame.el;
    this.replaceElements(new Map([[el.id, updateElement(a.origs.get(el.id), { angle })]]));
  }

  moveLinePointAction(p, e) {
    const a = this.action;
    const orig = a.orig;
    const pts = worldPoints(orig);
    const neighbor = pts[a.index === 0 ? 1 : a.index - 1];
    let q = this.snapPoint(p, { exclude: new Set([orig.id]), from: neighbor });
    if (e.shiftKey && neighbor && !this.snapHint) q = snapAngle(neighbor, q);
    this.replaceElements(new Map([[orig.id, moveLinePoint(orig, a.index, q)]]));
  }

  endMarquee(a) {
    const box = { minX: Math.min(a.start[0], a.end[0]), minY: Math.min(a.start[1], a.end[1]), maxX: Math.max(a.start[0], a.end[0]), maxY: Math.max(a.start[1], a.end[1]) };
    if ((box.maxX - box.minX) * this.state.camera.zoom < 3 && (box.maxY - box.minY) * this.state.camera.zoom < 3) { this.requestRender(); return; }
    const ids = new Set(a.base);
    for (const el of this.elements) if (boundsContain(box, getBounds(el))) ids.add(el.id);
    this.select(ids);
  }

  // ---------- shape tool ----------

  downShape(p) {
    const start = this.snapPoint(p);
    const el = createElement('shape', { shapeId: this.state.shapeId, params: { ...this.state.shapeParams }, x: start[0], y: start[1] }, this.state.style);
    this.setElements([...this.elements, el]);
    this.action = { type: 'create-shape', id: el.id, start, moved: false };
  }

  moveCreateShape(p, e) {
    const a = this.action;
    const el = this.byId(a.id);
    if (!el) return;
    let end = this.snapPoint(p, { exclude: new Set([el.id]) });
    let w = end[0] - a.start[0], h = end[1] - a.start[1];
    if (Math.hypot(w, h) * this.state.camera.zoom > 3) a.moved = true;
    if (e.shiftKey || shapeNeedsSquare(el.shapeId)) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = s * Math.sign(w || 1); h = s * Math.sign(h || 1);
    }
    this.replaceElements(new Map([[el.id, updateElement(el, { x: Math.min(a.start[0], a.start[0] + w), y: Math.min(a.start[1], a.start[1] + h), w: Math.abs(w), h: Math.abs(h) })]]));
  }

  endCreateShape(a) {
    this.snapHint = null;
    let el = this.byId(a.id);
    if (!el) return;
    if (!a.moved || el.w < 2 || el.h < 2) {
      const sq = shapeNeedsSquare(el.shapeId);
      const w = sq ? 100 : 140, h = sq ? 100 : 90;
      el = updateElement(el, { x: a.start[0] - w / 2, y: a.start[1] - h / 2, w, h });
      this.replaceElements(new Map([[el.id, el]]));
    }
    this.commit();
    this.afterCreate(el);
  }

  afterCreate(el) {
    if (!this.state.toolLocked) {
      this.state.tool = 'select';
      this.updateCursor();
      this.emit('tool');
    }
    this.select([el.id]);
  }

  // ---------- line tool ----------

  downLine(p, e) {
    const kind = this.state.lineKind;
    if (this.lineDraft) {
      // Click mode: fix the floating point and add a new one.
      const d = this.lineDraft;
      const fixed = d.points[d.points.length - 1];
      const prev = d.points[d.points.length - 2];
      if (prev && dist(fixed, prev) * this.state.camera.zoom < 3) return; // ignore double taps on the same spot
      if ((kind === 'segment' && d.points.length >= 2) || (kind === 'arc' && d.points.length >= 3)) { this.finishLineDraft(true); return; }
      d.points.push([fixed[0], fixed[1]]);
      this.applyLineDraft();
      return;
    }
    const start = this.snapPoint(p);
    const el = createElement('line', { kind: kind === 'arc' ? 'polyline' : kind, x: start[0], y: start[1], points: [[0, 0], [0, 0]] }, this.state.style);
    // The last point is the "floating" one that follows the pointer until fixed by a click.
    this.lineDraft = { id: el.id, kind, points: [start, [start[0], start[1]]], floating: false };
    this.setElements([...this.elements, el]);
    this.action = { type: 'line-drag', startScreen: this.toScreen(start), moved: false };
    void e;
  }

  moveLineDraft(p, shift) {
    const d = this.lineDraft;
    if (!d) return;
    const prev = d.points[d.points.length - 2];
    let q = this.snapPoint(p, { exclude: new Set([d.id]), from: prev });
    if (shift && prev && !this.snapHint) q = snapAngle(prev, q);
    d.points[d.points.length - 1] = q;
    if (this.action && this.action.type === 'line-drag') {
      const s = this.toScreen(q);
      if (dist(s, this.action.startScreen) > 4) this.action.moved = true;
    }
    this.applyLineDraft();
  }

  applyLineDraft() {
    const d = this.lineDraft;
    const el = this.byId(d.id);
    if (!el) { this.lineDraft = null; return; }
    const kind = d.kind === 'arc' && d.points.length === 3 ? 'arc' : d.kind === 'arc' ? 'polyline' : d.kind;
    this.replaceElements(new Map([[el.id, withWorldPoints(updateElement(el, { kind }), d.points)]]));
  }

  endLineDrag(a) {
    const d = this.lineDraft;
    if (!d) return;
    if (a.moved && d.kind === 'segment') { this.finishLineDraft(true); return; }
    if (a.moved) {
      // Dragged polyline/curve: keep adding points by clicks. Arc: the drag was the chord,
      // the next click sets the bulge (reordered on finish).
      if (d.kind === 'arc') d.arcChord = true;
      const last = d.points[d.points.length - 1];
      d.points.push([last[0], last[1]]);
      this.applyLineDraft();
    }
    // From here on the last point floats with the pointer (click mode).
    d.floating = true;
  }

  /** keepFloating: the floating point is a real point (it was just clicked). */
  finishLineDraft(keepFloating = false) {
    const d = this.lineDraft;
    if (!d) return;
    this.lineDraft = null;
    this.snapHint = null;
    let pts = d.points.slice();
    if (d.floating && !keepFloating) pts.pop();
    // Drop near-duplicate points (e.g. the second click of a double-click).
    const zoom = this.state.camera.zoom;
    const clean = pts.length ? [pts[0]] : [];
    for (let i = 1; i < pts.length; i++) if (dist(pts[i], clean[clean.length - 1]) * zoom >= 2) clean.push(pts[i]);
    pts = clean;
    if (d.arcChord && pts.length === 3) pts = [pts[0], pts[2], pts[1]]; // chord drag: start, bulge, end
    const el = this.byId(d.id);
    if (!el || pts.length < 2) {
      this.setElements(this.elements.filter((x) => x.id !== d.id));
      this.requestRender();
      return;
    }
    let kind = d.kind;
    if (kind === 'arc' && pts.length !== 3) kind = 'polyline';
    if (kind === 'segment' && pts.length > 2) pts = [pts[0], pts[pts.length - 1]];
    // Ends drawn on an element attach to it (object-to-object connectors).
    const tol = 4 / this.state.camera.zoom;
    const startEl = bindingTargetAt(this.elements, pts[0], tol, new Set([el.id]));
    const endEl = bindingTargetAt(this.elements, pts[pts.length - 1], tol, new Set([el.id, startEl ? startEl.id : '']));
    const next = withWorldPoints(updateElement(el, { kind, startBinding: startEl ? startEl.id : null, endBinding: endEl ? endEl.id : null }), pts);
    this.replaceElements(new Map([[el.id, next]]));
    this.commit();
    this.afterCreate(this.byId(el.id) || next);
  }

  cancelLineDraft() {
    const d = this.lineDraft;
    if (!d) return;
    this.lineDraft = null;
    this.setElements(this.elements.filter((x) => x.id !== d.id));
  }

  // ---------- pen ----------

  downPen(p, e) {
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
    if (this.state.pdfAnnotate) {
      const pdf = this.pdfUnder(p, true);
      if (pdf && !pdf.angle) {
        const L = pdfLayout(pdf);
        const local = [p[0] - pdf.x, p[1] - pdf.y];
        if (local[1] > PDF.header) {
          this.action = { type: 'pdf-annotate', id: pdf.id, points: [this.pdfNorm(pdf, L, local, pressure)] };
          return;
        }
      }
    }
    const highlighter = this.state.penMode === 'highlighter';
    const el = createElement('draw', {
      x: p[0], y: p[1], points: [[0, 0, pressure]], highlighter,
      strokeColor: highlighter && this.state.style.strokeColor === '#0a0a0a' ? '#fcc419' : this.state.style.strokeColor,
    }, this.state.style);
    this.setElements([...this.elements, el]);
    this.action = { type: 'draw', id: el.id, world: [[p[0], p[1], pressure]] };
  }

  moveDraw(p, e) {
    const a = this.action;
    const last = a.world[a.world.length - 1];
    if (dist(last, p) * this.state.camera.zoom < 1) return;
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
    a.world.push([p[0], p[1], pressure]);
    const el = this.byId(a.id);
    if (el) this.replaceElements(new Map([[el.id, withWorldPoints(el, a.world)]]));
  }

  endDraw(a) {
    const el = this.byId(a.id);
    if (!el) return;
    if (a.world.length === 1) {
      // A tap draws a dot.
      const p = a.world[0];
      this.replaceElements(new Map([[el.id, withWorldPoints(el, [p, [p[0] + 0.5, p[1] + 0.5, p[2]]])]]));
    }
    this.commit();
  }

  pdfNorm(pdf, L, local, pressure) {
    return [(local[0] - PDF.pad) / L.innerW, (local[1] - PDF.header + L.scrollPx - PDF.pad) / L.innerW, pressure];
  }

  movePdfAnnotate(p, e) {
    const a = this.action;
    const pdf = this.byId(a.id);
    if (!pdf) return;
    const L = pdfLayout(pdf);
    a.points.push(this.pdfNorm(pdf, L, [p[0] - pdf.x, p[1] - pdf.y], e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5));
    const ann = { id: a.annId || (a.annId = newId()), color: this.state.style.strokeColor, size: (this.state.style.strokeWidth * 2.2) / L.innerW, points: a.points.slice() };
    const base = a.baseAnnotations || (a.baseAnnotations = pdf.annotations);
    this.replaceElements(new Map([[pdf.id, { ...pdf, annotations: [...base, ann], version: pdf.version + 1 }]]));
  }

  endPdfAnnotate(a) {
    if (a.points.length > 1) this.commit();
  }

  // ---------- text ----------

  downText(p) {
    const style = this.state.style;
    const el = createElement('text', { x: p[0], y: p[1] - (style.fontSize * 1.25) / 2, text: '' }, style);
    const m = measureText('', el.font, el.fontSize);
    const created = { ...el, w: m.w, h: m.h };
    this.setElements([...this.elements, created]);
    this.startTextEdit(created, true);
  }

  /** Edit a text element, or the label inside a shape. selectAll: start with the text selected. */
  startTextEdit(el, isNew = false, selectAll = false) {
    this.finishTextEdit();
    this.state.editingId = el.id;
    this.editIsNew = isNew;
    this.select([el.id]);
    const ta = this.textEditor;
    ta.value = el.type === 'shape' ? el.label || '' : el.text;
    ta.hidden = false;
    this.positionTextEditor();
    // Focus synchronously so keystrokes typed right after the click land in the editor,
    // not on the canvas (where they would trigger tool shortcuts).
    ta.focus({ preventScroll: true });
    if (selectAll) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
    this.requestRender();
    this.emit('editing');
  }

  get editingShape() {
    const el = this.state.editingId ? this.byId(this.state.editingId) : null;
    return el && el.type === 'shape' ? el : null;
  }

  positionTextEditor() {
    const id = this.state.editingId;
    if (!id) return;
    const el = this.byId(id);
    if (!el) return;
    const ta = this.textEditor;
    const z = this.state.camera.zoom;
    const m = measureText(ta.value || ' ', el.font, el.fontSize);
    const fam = el.font === 'arial' ? 'Arial, Arimo, sans-serif' : '"Patrick Hand", cursive';
    let left, top, w, h, align, color, origin;
    if (el.type === 'shape') {
      // Centered inside the shape's box.
      w = Math.max(m.w + 8, el.w - LABEL_PAD.x) * z;
      h = m.h * z;
      const c = this.toScreen([el.x + el.w / 2, el.y + el.h / 2]);
      left = c[0] - w / 2; top = c[1] - h / 2;
      align = 'center'; color = labelColor(el); origin = 'center center';
    } else {
      const tl = this.toScreen([el.x, el.y]);
      w = Math.max(m.w, el.fontSize) * z + 8;
      h = m.h * z;
      left = tl[0]; top = tl[1];
      align = el.align; color = el.strokeColor; origin = `${(el.w * z) / 2}px ${(el.h * z) / 2}px`;
    }
    Object.assign(ta.style, {
      left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px',
      fontSize: el.fontSize * z + 'px', fontFamily: fam, color, textAlign: align,
      transform: el.angle ? `rotate(${el.angle}rad)` : 'none',
      transformOrigin: origin,
      opacity: String(el.opacity / 100),
    });
  }

  onTextInput(e) {
    const ta = this.textEditor;
    if (e && e.inputType === 'insertText' && e.data && /[\s=>\-+~!^2-3.,;:)\]}<]/.test(e.data)) applyAutoReplace(ta);
    const el = this.byId(this.state.editingId);
    if (!el) return;
    const value = nfc(ta.value);
    this.replaceElements(new Map([[el.id, el.type === 'shape' ? withLabel(el, value) : withText(el, value)]]));
    this.positionTextEditor();
  }

  finishTextEdit() {
    const id = this.state.editingId;
    if (!id) return;
    const ta = this.textEditor;
    this.state.editingId = null;
    ta.hidden = true;
    const el = this.byId(id);
    if (el) {
      const text = nfc(ta.value).replace(/\s+$/, '');
      if (el.type === 'shape') {
        // A shape keeps existing when its label is cleared.
        this.replaceElements(new Map([[id, withLabel(el, text)]]));
        this.commit();
      } else {
        if (!text.trim()) this.removeElements(new Set([id]));
        else this.replaceElements(new Map([[id, withText(el, text)]]));
        this.commit();
        if (text.trim() && this.editIsNew) this.afterCreate(this.byId(id));
      }
    }
    ta.blur();
    this.canvas.focus({ preventScroll: true });
    this.requestRender();
    this.emit('editing');
  }

  // ---------- mind map ----------

  /** The single selected element that can be a mind-map node (anything but lines/strokes). */
  get mindmapNode() {
    const sel = this.selected;
    return sel.length === 1 && isBindable(sel[0]) ? sel[0] : null;
  }

  createCentralTopic(p) {
    const node = centralTopic(this.state.style, p);
    this.setElements([...this.elements, node], { commit: true });
    if (!this.state.toolLocked) { this.state.tool = 'select'; this.updateCursor(); this.emit('tool'); }
    this.startTextEdit(node, false, true);
  }

  /** Tab: new child topic to the right, connected by a branch; starts editing its label. */
  addChildTopic(parent = this.mindmapNode) {
    if (!parent) return;
    this.finishTextEdit();
    const cur = this.byId(parent.id);
    if (!cur) return;
    const r = addChildTopicTo(this.elements, cur, this.state.style);
    this.setElements(r.elements, { commit: true });
    this.revealElement(r.node);
    this.startTextEdit(r.node, false, true);
  }

  /** Space / Enter: new sibling topic below (same parent). */
  addSiblingTopic(node = this.mindmapNode) {
    if (!node) return;
    this.finishTextEdit();
    const cur = this.byId(node.id);
    if (!cur) return;
    const r = addSiblingTopicTo(this.elements, cur, this.state.style);
    this.setElements(r.elements, { commit: true });
    this.revealElement(r.node);
    this.startTextEdit(r.node, false, true);
  }

  /** Pan just enough to bring an element into view. */
  revealElement(el) {
    const b = getBounds(el);
    const vb = viewportBounds(this.state.camera, this.renderer.width, this.renderer.height);
    const m = 60 / this.state.camera.zoom;
    const c = this.state.camera;
    if (b.maxX > vb.maxX - m) c.scrollX -= b.maxX - (vb.maxX - m);
    if (b.minX < vb.minX + m) c.scrollX += (vb.minX + m) - b.minX;
    if (b.maxY > vb.maxY - m) c.scrollY -= b.maxY - (vb.maxY - m);
    if (b.minY < vb.minY + m) c.scrollY += (vb.minY + m) - b.minY;
    this.afterCameraChange();
  }

  /** Insert text at the caret if editing; otherwise create a text element at the viewport center. */
  insertSymbol(sym) {
    if (this.state.editingId) {
      const ta = this.textEditor;
      ta.focus();
      if (!document.execCommand('insertText', false, sym)) ta.setRangeText(sym, ta.selectionStart, ta.selectionEnd, 'end');
      this.onTextInput();
      return;
    }
    const c = this.viewportCenter();
    const el = withText(createElement('text', { x: c[0], y: c[1] }, this.state.style), sym);
    this.setElements([...this.elements, el], { commit: true });
    this.startTextEdit(el);
  }

  // ---------- math ----------

  /** Create or update a math element. Returns the element or null when latex is empty. */
  async upsertMath({ element, point, latex, source, mode }) {
    latex = String(latex || '').trim();
    if (!latex) {
      if (element) this.setElements(this.elements.filter((x) => x.id !== element.id), { commit: true });
      return null;
    }
    const fontSize = element ? element.fontSize : 28;
    // Render once first: it waits for the KaTeX fonts, so the measured size is exact.
    let size;
    try { size = await renderMathImage(latex, fontSize, this.state.style.strokeColor, 1); } catch { size = measureMath(latex, fontSize); }
    let el;
    if (element) {
      const cur = this.byId(element.id) || element;
      const c = [cur.x + cur.w / 2, cur.y + cur.h / 2];
      el = updateElement(cur, { latex, source, mode, w: size.w, h: size.h, x: c[0] - size.w / 2, y: c[1] - size.h / 2 });
      this.replaceElements(new Map([[el.id, el]]));
    } else {
      const p = point || this.viewportCenter();
      el = createElement('math', { latex, source, mode, fontSize, x: p[0] - size.w / 2, y: p[1] - size.h / 2, w: size.w, h: size.h }, this.state.style);
      this.setElements([...this.elements, el]);
    }
    this.commit();
    this.afterCreate(el);
    return el;
  }

  // ---------- eraser ----------

  downEraser(p) {
    this.fadedIds = new Set();
    this.eraserTrail = [p];
    this.action = { type: 'erase', last: p, annotationHits: new Map() };
    this.eraseAt(p);
  }

  moveEraser(p) {
    const a = this.action;
    const step = Math.max(2, this.state.eraserSize / 2) / this.state.camera.zoom;
    const d = dist(a.last, p);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) this.eraseAt([a.last[0] + ((p[0] - a.last[0]) * i) / n, a.last[1] + ((p[1] - a.last[1]) * i) / n]);
    a.last = p;
    this.eraserTrail.push(p);
    if (this.eraserTrail.length > 30) this.eraserTrail.shift();
    this.requestRender();
  }

  /** silent: skip the UI refresh (used while dragging the slider so it is not rebuilt mid-drag). */
  setEraserSize(r, silent = false) {
    this.state.eraserSize = clamp(Math.round(r), 3, 80);
    this.autosave();
    this.requestRender();
    if (!silent) this.emit('style');
  }

  eraseAt(p) {
    const tol = this.state.eraserSize / this.state.camera.zoom;
    for (const el of this.elements) {
      if (el.type === 'pdf' && this.state.pdfAnnotate) { this.eraseAnnotations(el, p, tol); continue; }
      if (!hitTest(el, p, tol)) continue;
      if (this.altDown) this.fadedIds.delete(el.id);
      else this.fadedIds.add(el.id);
    }
  }

  eraseAnnotations(pdf, p, tol) {
    if (!hitTest(pdf, p, 0) || !pdf.annotations.length) return;
    const L = pdfLayout(pdf);
    const q = this.pdfNorm(pdf, L, [p[0] - pdf.x, p[1] - pdf.y], 0.5);
    const r = tol / L.innerW;
    const keep = pdf.annotations.filter((ann) => !ann.points.some((pt) => Math.hypot(pt[0] - q[0], pt[1] - q[1]) <= r + ann.size));
    if (keep.length !== pdf.annotations.length) this.replaceElements(new Map([[pdf.id, { ...pdf, annotations: keep, version: pdf.version + 1 }]]));
  }

  endEraser() {
    const ids = this.fadedIds || new Set();
    this.fadedIds = null;
    this.eraserTrail = null;
    if (ids.size) this.removeElements(ids);
    this.commit();
  }

  // ---------- editing commands ----------

  deleteSelected() {
    if (!this.state.selectedIds.size) return;
    this.removeElements(new Set(this.state.selectedIds), { commit: true });
    this.select([]);
  }

  duplicateSelected(offset = 16) {
    const sel = this.selected;
    if (!sel.length) return;
    const idMap = new Map(sel.map((el) => [el.id, newId()]));
    // Copies keep links among themselves; links to elements outside the copy are dropped.
    const copies = remapReferences(sel.map((el) => ({ ...structuredClone(el), id: idMap.get(el.id), version: 1, x: el.x + offset, y: el.y + offset })), idMap);
    this.setElements(reflowConnectors([...this.elements, ...copies]), { commit: true });
    this.select(copies.map((c) => c.id));
  }

  selectAll() { this.setTool('select'); this.select(this.elements.map((e) => e.id)); }

  nudge(dx, dy) {
    const map = new Map();
    for (const el of this.selected) map.set(el.id, updateElement(el, { x: el.x + dx, y: el.y + dy }));
    if (map.size) { this.replaceElements(map); this.commit(); }
  }

  /** dir: 'front' | 'back' | 'forward' | 'backward' */
  reorder(dir) {
    const ids = this.state.selectedIds;
    if (!ids.size) return;
    let els = this.elements.slice();
    if (dir === 'front') els = [...els.filter((e) => !ids.has(e.id)), ...els.filter((e) => ids.has(e.id))];
    else if (dir === 'back') els = [...els.filter((e) => ids.has(e.id)), ...els.filter((e) => !ids.has(e.id))];
    else if (dir === 'forward') {
      for (let i = els.length - 2; i >= 0; i--) if (ids.has(els[i].id) && !ids.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
    } else {
      for (let i = 1; i < els.length; i++) if (ids.has(els[i].id) && !ids.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
    }
    this.setElements(els, { commit: true });
  }

  pdfPage(delta) {
    const pdf = this.selected.find((e) => e.type === 'pdf');
    if (!pdf) return;
    const L = pdfLayout(pdf);
    const cur = pdfCurrentPage(pdf);
    const target = clamp(cur + delta, 0, L.pages.length - 1);
    if (!L.pages[target] || L.maxScroll <= 0) return;
    const scroll = clamp((L.pages[target].y - PDF.pad) / L.maxScroll, 0, 1);
    this.replaceElements(new Map([[pdf.id, { ...pdf, scroll, version: pdf.version + 1 }]]));
    this.autosave();
    this.emit('selection');
  }

  clearCanvas() {
    this.finishTextEdit();
    this.setElements([], { commit: true });
    this.select([]);
  }

  // ---------- clipboard ----------

  /** Must stay synchronous: clipboardData is only writable during the event dispatch. */
  onCopy(e, cut = false) {
    if (this.state.editingId || isFormField(document.activeElement)) return;
    const sel = this.selected;
    if (!sel.length) return;
    e.preventDefault();
    const files = {};
    const copied = [];
    for (const el of sel) {
      if (el.fileId) {
        // Files of visible images/PDFs are already in memory; skip any that are not (yet).
        const f = this.fileCache.get(el.fileId);
        if (!f) continue;
        if (!files[el.fileId]) files[el.fileId] = { mime: f.mime, name: f.name, data: arrayBufferToBase64(f.bytes) };
      }
      copied.push(el);
    }
    e.clipboardData.setData('text/plain', JSON.stringify({ type: 'synto/clipboard', elements: copied, files }));
    if (cut) this.deleteSelected();
  }

  async onPaste(e) {
    if (this.state.editingId || isFormField(document.activeElement)) return;
    const dt = e.clipboardData;
    if (!dt) return;
    e.preventDefault();
    const fileItems = [...dt.files];
    if (fileItems.length) { for (const f of fileItems) await this.insertFile(f.name, f.type, await f.arrayBuffer()); return; }
    const text = dt.getData('text/plain');
    if (!text) return;
    try {
      const data = JSON.parse(text);
      if (data && data.type === 'synto/clipboard' && Array.isArray(data.elements)) { await this.pasteElements(data); return; }
    } catch { /* not ours: plain text */ }
    const c = this.lastPointerInView() ? this.lastPointerWorld : this.viewportCenter();
    const el = withText(createElement('text', { x: c[0], y: c[1] }, this.state.style), nfc(text).slice(0, 20000));
    this.setElements([...this.elements, el], { commit: true });
    this.select([el.id]);
  }

  lastPointerInView() {
    const vb = viewportBounds(this.state.camera, this.renderer.width, this.renderer.height);
    const p = this.lastPointerWorld;
    return p[0] >= vb.minX && p[0] <= vb.maxX && p[1] >= vb.minY && p[1] <= vb.maxY;
  }

  async pasteElements(data) {
    const idMap = new Map();
    for (const [id, f] of Object.entries(data.files || {})) {
      if (!f || typeof f.data !== 'string' || !(IMAGE_MIME.test(f.mime) || f.mime === 'application/pdf')) continue;
      let bytes;
      try { bytes = base64ToArrayBuffer(f.data); } catch { continue; }
      const rec = { id: newId(), mime: f.mime, name: String(f.name || '').slice(0, 260), bytes };
      await store.putFile(rec);
      this.fileCache.set(rec.id, rec);
      idMap.set(id, rec.id);
    }
    const els = data.elements.map(sanitizeElement).filter(Boolean)
      .map((el) => (el.fileId ? (idMap.has(el.fileId) || this.fileCache.has(el.fileId) ? { ...el, fileId: idMap.get(el.fileId) || el.fileId } : null) : el))
      .filter(Boolean);
    if (!els.length) return;
    const b = boundsOfPoints(els.flatMap((el) => { const x = getBounds(el); return [[x.minX, x.minY], [x.maxX, x.maxY]]; }));
    const target = this.lastPointerInView() ? this.lastPointerWorld : this.viewportCenter();
    const dx = target[0] - (b.minX + b.maxX) / 2, dy = target[1] - (b.minY + b.maxY) / 2;
    const pasteIds = new Map(els.map((el) => [el.id, newId()]));
    const placed = remapReferences(els.map((el) => ({ ...el, id: pasteIds.get(el.id), version: 1, x: el.x + dx, y: el.y + dy })), pasteIds);
    this.setElements(reflowConnectors([...this.elements, ...placed]), { commit: true });
    this.setTool('select');
    this.select(placed.map((x) => x.id));
  }

  // ---------- files: images & PDF ----------

  /** Inserts an image or PDF from raw bytes. Validates by content, not by extension. */
  async insertFile(name, mime, bytes, at) {
    if (!bytes || bytes.byteLength === 0) return this.toast('File rỗng.', true);
    if (bytes.byteLength > store.MAX_FILE_BYTES) return this.toast('File quá lớn (tối đa 80 MB).', true);
    const kind = sniff(bytes, mime);
    if (!kind) return this.toast('Chỉ hỗ trợ ảnh (PNG, JPG, GIF, WebP, SVG) và PDF.', true);
    const rec = { id: newId(), mime: kind, name: String(name || '').slice(0, 260), bytes };
    const p = at || (this.lastPointerInView() ? this.lastPointerWorld : this.viewportCenter());
    const maxSide = Math.min(this.renderer.width, this.renderer.height) * 0.6 / this.state.camera.zoom;
    if (kind === 'application/pdf') {
      let pages;
      try { pages = await readPageSizes(rec.id, bytes); } catch (err) {
        const msg = err && err.name === 'PasswordException' ? 'PDF có mật khẩu, chưa hỗ trợ.' : 'Không đọc được PDF này.';
        return this.toast(msg, true);
      }
      if (!pages.length) return this.toast('PDF không có trang nào.', true);
      await store.putFile(rec);
      this.fileCache.set(rec.id, rec);
      const w = Math.max(240, Math.min(480, maxSide));
      const first = pages[0];
      const h = Math.min(w * (first[1] / first[0]) + PDF.header + PDF.pad * 2, maxSide * 1.3);
      const el = createElement('pdf', { fileId: rec.id, name: rec.name || 'tài liệu.pdf', pages, x: p[0] - w / 2, y: p[1] - h / 2, w, h }, this.state.style);
      this.setElements([...this.elements, el], { commit: true });
      this.setTool('select');
      this.select([el.id]);
      return el;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: kind }));
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { URL.revokeObjectURL(url); return this.toast('Ảnh bị lỗi, không mở được.', true); }
    await store.putFile(rec);
    this.fileCache.set(rec.id, rec);
    this.imageCache.set(rec.id, { img });
    const nw = img.naturalWidth || 300, nh = img.naturalHeight || 200;
    const s = Math.min(1, maxSide / Math.max(nw, nh));
    const w = Math.max(8, nw * s), h = Math.max(8, nh * s);
    const el = createElement('image', { fileId: rec.id, x: p[0] - w / 2, y: p[1] - h / 2, w, h }, this.state.style);
    this.setElements([...this.elements, el], { commit: true });
    this.setTool('select');
    this.select([el.id]);
    return el;
  }

  async pickAndInsert(kind) {
    try {
      const f = kind === 'pdf'
        ? await store.openFile('application/pdf,.pdf', 'PDF', ['pdf'])
        : await store.openFile('image/png,image/jpeg,image/gif,image/webp,image/svg+xml', 'Ảnh', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
      if (f) await this.insertFile(f.name, f.mime, f.bytes);
    } catch (err) {
      this.toast(err.message || 'Không mở được file.', true);
    }
  }

  // ---------- save / open / export ----------

  async persist() {
    try {
      this.saveState = 'saving';
      this.emit('save');
      const { camera, style, snap, shapeId, shapeParams, lineKind, showGrid, fileName, eraserSize } = this.state;
      await store.saveScene({ version: 1, elements: this.state.elements, camera, style, snap, shapeId, shapeParams, lineKind, showGrid, fileName, eraserSize });
      this.saveState = 'saved';
    } catch (err) {
      console.error(err);
      this.saveState = 'error';
    }
    this.emit('save');
  }

  async restore() {
    try {
      const s = await store.loadScene();
      if (s && Array.isArray(s.elements)) {
        const els = s.elements.map(sanitizeElement).filter(Boolean);
        this.state.elements = els;
        if (s.camera && Number.isFinite(s.camera.zoom)) this.state.camera = { scrollX: +s.camera.scrollX || 0, scrollY: +s.camera.scrollY || 0, zoom: clamp(+s.camera.zoom, ZOOM_MIN, ZOOM_MAX) };
        if (s.style) for (const k of Object.keys(DEFAULT_STYLE)) if (s.style[k] !== undefined) this.state.style[k] = s.style[k];
        if (s.snap) for (const k of Object.keys(DEFAULT_SNAP)) if (typeof s.snap[k] === 'boolean') this.state.snap[k] = s.snap[k];
        if (SHAPES.has(s.shapeId)) this.state.shapeId = s.shapeId;
        if (s.shapeParams) Object.assign(this.state.shapeParams, sanitizeElement({ type: 'shape', params: s.shapeParams }).params);
        if (['segment', 'polyline', 'curve', 'arc'].includes(s.lineKind)) this.state.lineKind = s.lineKind;
        if (typeof s.showGrid === 'boolean') this.state.showGrid = s.showGrid;
        if (typeof s.fileName === 'string') this.state.fileName = s.fileName;
        if (Number.isFinite(s.eraserSize)) this.state.eraserSize = clamp(Math.round(s.eraserSize), 3, 80);
        // Only now (empty undo history) is it safe to drop files nothing references.
        store.collectGarbage(els).catch(() => {});
      }
    } catch (err) {
      console.error('Restore failed', err);
      this.toast('Không khôi phục được bản lưu trước.', true);
    }
    this.history.reset(this.state.elements);
    this.requestRender();
    this.emit('elements');
    this.emit('tool');
    this.emit('camera');
    this.emit('file');
  }

  async saveToFile() {
    this.finishTextEdit();
    const json = await store.serializeScene(this.state.elements, (id) => this.getFileRecord(id));
    const bytes = new TextEncoder().encode(json).buffer;
    const base = (this.state.fileName || 'ghi-chu').replace(/\.synto$/i, '');
    const r = await store.saveBytes(base + '.synto', 'application/json', bytes, 'Synto', 'synto');
    if (r.ok) {
      if (r.name) this.state.fileName = r.name.replace(/^.*[\\/]/, '');
      this.toast('Đã lưu file.');
      this.emit('file');
      this.autosave();
    } else if (!r.cancelled) this.toast(r.error || 'Không lưu được file.', true);
  }

  async openFromFile() {
    this.finishTextEdit();
    try {
      const f = await store.openFile('.synto,application/json', 'Synto', ['synto', 'json']);
      if (!f) return;
      const { elements, files } = store.parseSceneFile(new TextDecoder().decode(f.bytes));
      for (const rec of files) { await store.putFile(rec); this.fileCache.set(rec.id, rec); }
      this.imageCache.clear();
      this.mathCache.clear();
      this.state.elements = elements;
      this.state.selectedIds = new Set();
      this.state.fileName = f.name.replace(/^.*[\\/]/, '');
      this.history.reset(elements);
      this.zoomToFit();
      this.emit('elements');
      this.emit('file');
      this.emit('selection');
      this.persist();
      this.toast(`Đã mở ${this.state.fileName}`);
    } catch (err) {
      this.toast(err.message || 'Không mở được file.', true);
    }
  }

  async exportPng() {
    this.finishTextEdit();
    const els = this.selected.length ? this.selected : this.elements;
    if (!els.length) return this.toast('Chưa có gì để xuất.', true);
    const exportRes = await this.prepareExport(els);
    let blob = null;
    try {
      const canvas = renderToCanvas(els, exportRes, 2);
      blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    } catch (err) {
      // e.g. an inserted SVG that the browser refuses to export (SecurityError).
      console.error(err);
      return this.toast('Không xuất được ảnh: một ảnh SVG trong vùng chọn chặn việc xuất.', true);
    }
    if (!blob) return this.toast('Không xuất được ảnh.', true);
    const base = (this.state.fileName || 'synto').replace(/\.synto$/i, '');
    const r = await store.saveBytes(base + '.png', 'image/png', await blob.arrayBuffer(), 'Ảnh PNG', 'png');
    if (r.ok) this.toast('Đã xuất ảnh PNG.');
    else if (!r.cancelled) this.toast(r.error || 'Không lưu được ảnh.', true);
  }

  /** Loads images and renders formulas at high resolution so exports never show placeholders. */
  async prepareExport(els) {
    await Promise.all(els.map(async (el) => {
      if (el.type === 'image') { this.getImage(el.fileId); await waitFor(() => this.imageCache.get(el.fileId)?.img, 3000); }
      if (el.type === 'math') {
        try { const r = await renderMathImage(el.latex, el.fontSize, el.strokeColor, 4); this.mathCache.set(el.id, { key: `${el.version}|${el.latex}|${el.fontSize}|${el.strokeColor}|4`, img: r.img, pending: false }); } catch { /* placeholder */ }
      }
    }));
    return { ...this.res, math: (el) => this.mathCache.get(el.id)?.img || null };
  }

  /** Export the selection (or everything) as a one-page PDF sized to the content. */
  async exportPdf() {
    this.finishTextEdit();
    const els = this.selected.length ? this.selected : this.elements;
    if (!els.length) return this.toast('Chưa có gì để xuất.', true);
    const exportRes = await this.prepareExport(els);
    let bytes;
    try {
      const padding = 32;
      const canvas = renderToCanvas(els, exportRes, 2, padding);
      const bs = els.map(getBounds);
      const cssW = Math.max(...bs.map((b) => b.maxX)) - Math.min(...bs.map((b) => b.minX)) + padding * 2;
      const cssH = Math.max(...bs.map((b) => b.maxY)) - Math.min(...bs.map((b) => b.minY)) + padding * 2;
      bytes = await canvasToPdf(canvas, cssW, cssH, (this.state.fileName || 'Synto').replace(/\.synto$/i, ''));
    } catch (err) {
      console.error(err);
      return this.toast('Không xuất được PDF: ' + (err && err.name === 'SecurityError' ? 'một ảnh SVG trong vùng chọn chặn việc xuất.' : (err.message || err)), true);
    }
    const base = (this.state.fileName || 'synto').replace(/\.synto$/i, '');
    const r = await store.saveBytes(base + '.pdf', 'application/pdf', bytes, 'PDF', 'pdf');
    if (r.ok) this.toast('Đã xuất PDF.');
    else if (!r.cancelled) this.toast(r.error || 'Không lưu được PDF.', true);
  }

  // ---------- UI helpers ----------

  toast(msg, isError = false) {
    const t = this.root.querySelector('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4000 : 2200);
    return null;
  }

  updateCursor() {
    const t = this.state.tool;
    const c = this.action && this.action.type === 'pan' ? 'grabbing'
      : this.spaceDown || t === 'hand' ? 'grab'
      : t === 'text' ? 'text'
      : t === 'select' ? 'default'
      : t === 'eraser' || t === 'laser' ? 'none' // drawn on the canvas (size ring / red dot)
      : 'crosshair';
    this.canvas.style.cursor = c;
  }

  updateHoverCursor(p) {
    if (this.state.tool !== 'select' || this.spaceDown) return;
    const hd = this.handleAt(p);
    if (hd) {
      const map = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab' };
      this.canvas.style.cursor = map[hd.id] || 'pointer';
      return;
    }
    this.canvas.style.cursor = this.topHit(p) || this.insideSelectionFrame(p) ? 'move' : 'default';
  }
}

function isFormField(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Identify a file by its first bytes. Returns a safe MIME type or null. */
export function sniff(bytes, declared) {
  const b = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 512));
  const starts = (...sig) => sig.every((v, i) => b[i] === v);
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  const head = new TextDecoder().decode(b).trimStart().toLowerCase();
  if ((declared === 'image/svg+xml' || head.startsWith('<?xml') || head.startsWith('<svg')) && head.includes('<svg')) return 'image/svg+xml';
  return null;
}

function waitFor(check, timeout) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (check() || performance.now() - t0 > timeout) resolve();
      else setTimeout(tick, 50);
    };
    tick();
  });
}

export { ROTATABLE };
