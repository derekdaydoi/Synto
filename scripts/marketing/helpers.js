// Shared helpers for the marketing screenshot scenes. Concatenated in front of each scene by
// scripts\make-screenshots.ps1 and run inside the exe (--dev --script) with a throwaway profile.
// A scene builds its picture, then calls `await ready()`; the capture script waits for that.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app, E, MM, UIX;

async function boot() {
  for (let i = 0; i < 200 && !(window.synto && window.synto.renderer.width > 0); i++) await sleep(50);
  app = window.synto;
  E = await import('./src/elements.js');
  MM = await import('./src/mindmap.js');
  window.__connectors = await import('./src/connectors.js');
  await sleep(400);
  app.clearCanvas();
  app.history.reset([]);
  app.state.snap.enabled = true;
  Object.assign(app.state.camera, { scrollX: 0, scrollY: 0, zoom: 1 });
  app.setTool('select');
  app.select([]);
  document.querySelectorAll('.toast').forEach((t) => t.classList.remove('show'));
}

/** Tell the capture script the frame is final. */
async function ready(extraDelay = 700) {
  app.requestRender();
  await sleep(extraDelay);
  document.querySelectorAll('.toast').forEach((t) => t.classList.remove('show'));
  await sleep(150);
  window.chrome.webview.postMessage({ type: 'title', title: 'READY' });
}

const canvasRect = () => app.canvas.getBoundingClientRect();
function ev(type, [x, y], buttons = 1, opts = {}) {
  const r = canvasRect();
  app.canvas.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y,
    button: 0, buttons: type === 'pointerup' ? 0 : buttons, pointerType: 'mouse', ...opts,
  }));
}
const S = (p) => app.toScreen(p); // world -> screen

/** Adds elements without undo noise. */
function add(...els) { app.setElements([...app.elements, ...els.flat()]); return els.length === 1 ? els[0] : els; }

const style = (over = {}) => ({ ...E.DEFAULT_STYLE, ...over });

function shape(shapeId, x, y, w, h, over = {}) {
  return E.createElement('shape', { shapeId, x, y, w, h, ...over }, style(over));
}

function text(x, y, value, over = {}) {
  return E.withText(E.createElement('text', { x, y, ...over }, style(over)), value);
}

function line(points, over = {}) {
  return E.withWorldPoints(E.createElement('line', { kind: 'segment', ...over }, style(over)), points);
}

function pen(points, over = {}) {
  return E.withWorldPoints(E.createElement('draw', { ...over }, style(over)), points.map((p) => [p[0], p[1], 0.5]));
}

/** Smooth hand-written-looking stroke through control points. */
function wave(x0, y0, len, amp, periods, n = 80) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + t * len, y0 + Math.sin(t * Math.PI * 2 * periods) * amp + Math.sin(t * 17) * 1.2]);
  }
  return pts;
}

function labelBox(shapeId, x, y, label, over = {}) {
  const el = E.withLabel(shape(shapeId, x, y, 10, 10, { topic: true, ...over }), label);
  return E.updateElement(el, { x, y });
}

async function formula(latex, x, y, fontSize = 28, color = '#0a0a0a') {
  const el = await app.upsertMath({ point: [x, y], latex, source: latex, mode: 'latex' });
  let out = el;
  if (fontSize !== 28 || color !== '#0a0a0a') {
    const cur = app.byId(el.id);
    const scale = fontSize / cur.fontSize;
    out = E.updateElement(cur, { fontSize, strokeColor: color, w: cur.w * scale, h: cur.h * scale, x: x - (cur.w * scale) / 2, y: y - (cur.h * scale) / 2 });
    app.replaceElements(new Map([[out.id, out]]));
  }
  app.select([]);
  return out;
}

function makePng(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  return new Promise((r) => c.toBlob(async (b) => r(await b.arrayBuffer()), 'image/png'));
}

/** Simple multi-page PDF (ASCII text, colored blocks) for the PDF scenes. */
function makePdf(pages) {
  const objs = [], kids = [];
  const n = pages.length;
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  pages.forEach((content, i) => {
    const p = 3 + i * 2, cc = 4 + i * 2;
    kids.push(`${p} 0 R`);
    objs[p] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cc} 0 R /Resources << /Font << /F1 ${3 + n * 2} 0 R /F2 ${4 + n * 2} 0 R >> >> >>`;
    objs[cc] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`;
  objs[3 + n * 2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  objs[4 + n * 2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let out = '%PDF-1.4\n';
  const off = [];
  for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new TextEncoder().encode(out).buffer;
}

/** A report-like page: title, paragraph lines, a bar chart. */
function reportPage(title, sub, bars) {
  let s = `BT /F1 30 Tf 60 720 Td (${title}) Tj ET BT /F2 13 Tf 60 696 Td (${sub}) Tj ET 0.85 0.85 0.85 rg `;
  for (let i = 0; i < 9; i++) s += `60 ${650 - i * 18} ${440 - (i % 3) * 60} 7 re f `;
  s += '0.2 0.2 0.2 RG 1 w 60 220 m 552 220 l S ';
  bars.forEach((v, i) => { s += `${i === bars.length - 1 ? '0.1 0.45 0.76' : '0.7 0.75 0.8'} rg ${90 + i * 110} 220 60 ${v} re f `; });
  return s;
}

/** Fit a world rect into the free canvas area. left: extra room on the left (e.g. properties panel). */
function zoomTo(minX, minY, maxX, maxY, left = 40, maxZoom = 2) {
  const W = app.renderer.width, H = app.renderer.height;
  const top = W < 790 ? 90 : 120, bottom = W < 790 ? 150 : 90, right = 40;
  const z = Math.min((W - left - right) / (maxX - minX), (H - top - bottom) / (maxY - minY), maxZoom);
  const c = app.state.camera;
  c.zoom = z;
  c.scrollX = (left + (W - left - right) / 2) / z - (minX + maxX) / 2;
  c.scrollY = (top + (H - top - bottom) / 2) / z - (minY + maxY) / 2;
  app.afterCameraChange();
}

function boundsOf(els) {
  const bs = els.map(E.getBounds);
  return [Math.min(...bs.map((b) => b.minX)), Math.min(...bs.map((b) => b.minY)), Math.max(...bs.map((b) => b.maxX)), Math.max(...bs.map((b) => b.maxY))];
}

/** XMind-style study plan with colored branches. Returns the element list. */
function buildMindmap(compact = false) {
  const st = style({ roughness: 1 });
  let central = MM.centralTopic(st, [0, 0]);
  central = E.withLabel(E.updateElement(central, { fillColor: '#ffec99', fillStyle: 'solid', strokeWidth: 2.5 }), 'Kế hoạch học kỳ');
  let els = [central];
  const branches = compact
    ? [['Toán', '#1971c2', '#d0ebff', ['Đại số', 'Hình học']], ['Ngữ văn', '#e03131', '#ffe3e3', ['Đọc hiểu']], ['Tiếng Anh', '#2f9e44', '#d3f9d8', ['IELTS 7.0', 'Từ vựng']]]
    : [['Toán', '#1971c2', '#d0ebff', ['Đại số', 'Hình học', 'Giải tích']], ['Ngữ văn', '#e03131', '#ffe3e3', ['Đọc hiểu', 'Nghị luận xã hội']],
      ['Tiếng Anh', '#2f9e44', '#d3f9d8', ['IELTS 7.0', '2000 từ vựng']], ['Thể thao', '#f08c00', '#fff3bf', ['Chạy 5 km', 'Bơi mỗi tuần']]];
  const recolor = (id, patch) => { els = els.map((e) => (e.id === id ? E.updateElement(e, patch) : e)); };
  const byId = (id) => els.find((e) => e.id === id);
  const nodes = {};
  for (const [name, color, tint, kids] of branches) {
    let r = MM.addChild(els, byId(central.id), st, name);
    els = r.elements;
    const main = r.node;
    recolor(main.id, { strokeColor: color, fillColor: tint, fillStyle: 'solid', fontSize: 22 });
    els = els.map((e) => (e.id === main.id ? E.withLabel(e, name) : e));
    const conn = els.find((e) => e.type === 'line' && e.endBinding === main.id);
    recolor(conn.id, { strokeColor: color, strokeWidth: 2.5 });
    nodes[name] = main.id;
    for (const k of kids) {
      r = MM.addChild(els, byId(main.id), st, k);
      els = r.elements;
      recolor(r.node.id, { strokeColor: 'transparent', fontSize: 19 });
      els = els.map((e) => (e.id === r.node.id ? E.withLabel(e, k) : e));
      const c2 = els.find((e) => e.type === 'line' && e.endBinding === r.node.id);
      recolor(c2.id, { strokeColor: color, strokeWidth: 1.5 });
      nodes[k] = r.node.id;
    }
  }
  // Presentation polish: center each parent on its children (like XMind's balanced layout).
  const centerOn = (parentId) => {
    const kids = els.filter((e) => e.parentId === parentId);
    if (!kids.length) return;
    const mid = (Math.min(...kids.map((k) => k.y)) + Math.max(...kids.map((k) => k.y + k.h))) / 2;
    const p = els.find((e) => e.id === parentId);
    recolor(parentId, { y: mid - p.h / 2 });
  };
  for (const [name] of branches) centerOn(nodes[name]);
  centerOn(central.id);
  const mod = window.__connectors;
  return { els: mod ? mod.reflowConnectors(els) : els, nodes };
}
