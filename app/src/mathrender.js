// Formula rendering: KaTeX lays the formula out in a hidden DOM box, then we paint that layout
// onto a canvas ourselves (glyph runs, rules, KaTeX's inline SVG paths). Painting with the
// regular 2D API keeps canvases untainted (PNG export works) and stays sharp at any scale.
// KaTeX is loaded as a classic script (window.katex) from index.html.

const KATEX_CSS = new URL('../vendor/katex/katex.min.css', import.meta.url).href;

/** Returns {html, error} for preview UIs. Never throws. */
export function katexHtml(latex, displayMode = true) {
  if (!window.katex) return { html: '', error: 'KaTeX chưa tải' };
  const opts = { displayMode, output: 'html', strict: 'ignore', trust: false, maxSize: 50, maxExpand: 500 };
  try {
    return { html: window.katex.renderToString(latex, { ...opts, throwOnError: true }), error: null };
  } catch (e) {
    const html = window.katex.renderToString(latex, { ...opts, throwOnError: false });
    return { html, error: e && e.message ? e.message.replace(/^KaTeX parse error: /, '') : String(e) };
  }
}

let host = null;
function layoutHost() {
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    // Off-screen and transparent (not visibility:hidden, which children would inherit and
    // which the painter uses to skip intentionally hidden parts).
    host.style.cssText = 'position:absolute;left:-20000px;top:0;opacity:0;pointer-events:none;white-space:nowrap;contain:layout style';
    document.body.appendChild(host);
  }
  return host;
}

function buildBox(latex, fontSize, color) {
  const { html } = katexHtml(latex);
  const box = document.createElement('div');
  box.style.cssText = `display:inline-block;font-size:${fontSize}px;color:${color};padding:4px 6px;line-height:1.2`;
  box.innerHTML = html;
  box.querySelectorAll('.katex-display').forEach((d) => { d.style.margin = '0'; });
  layoutHost().appendChild(box);
  return box;
}

/** Ensure every font used inside the box is loaded so measurements and painting agree. */
async function loadFonts(box) {
  const fonts = new Set();
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const cs = getComputedStyle(n.parentElement);
    fonts.add(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
  }
  await Promise.all([...fonts].map((f) => document.fonts.load(f).catch(() => {})));
}

/** Measures a formula synchronously (uses whatever fonts are loaded right now). */
export function measureMath(latex, fontSize) {
  const box = buildBox(latex, fontSize, '#000');
  const r = box.getBoundingClientRect();
  box.remove();
  return { w: Math.max(8, Math.ceil(r.width)), h: Math.max(8, Math.ceil(r.height)) };
}

/**
 * Renders a formula to a canvas at `scale` x resolution.
 * Resolves {img: HTMLCanvasElement, w, h} where w/h are CSS-pixel sizes at scale 1.
 */
export async function renderMathImage(latex, fontSize, color, scale = 2) {
  const box = buildBox(latex, fontSize, color);
  try {
    await loadFonts(box);
    const r = box.getBoundingClientRect();
    const w = Math.max(8, Math.ceil(r.width)), h = Math.max(8, Math.ceil(r.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * scale));
    canvas.height = Math.max(1, Math.ceil(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(-r.left, -r.top);
    paintTree(ctx, box);
    return { img: canvas, w, h };
  } finally {
    box.remove();
  }
}

function paintTree(ctx, root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.currentNode; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) { paintText(ctx, n); continue; }
    if (n instanceof SVGSVGElement) { paintSvg(ctx, n); continue; }
    if (n instanceof SVGElement) continue; // children of an <svg> are painted with it
    paintBox(ctx, n);
  }
}

function paintText(ctx, node) {
  const text = node.nodeValue;
  if (!text || !text.trim()) return;
  const el = node.parentElement;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.fillStyle = cs.color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  // Paint per character run using the browser's own glyph boxes, so spacing matches exactly.
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = range.getClientRects();
  if (rects.length <= 1) {
    const r = rects[0] || el.getBoundingClientRect();
    const m = ctx.measureText(text);
    ctx.fillText(text, r.left, r.top + m.fontBoundingBoxAscent);
    return;
  }
  // Text wrapped across several boxes (rare in KaTeX): paint character by character.
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const m = ctx.measureText(text[i]);
    ctx.fillText(text[i], r.left, r.top + m.fontBoundingBoxAscent);
  }
}

function paintBox(ctx, el) {
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return;
  if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
    ctx.fillStyle = cs.backgroundColor;
    ctx.fillRect(r.left, r.top, r.width, r.height);
  }
  // Rules (fraction bars, overlines, \hline...) are drawn by KaTeX as borders.
  const sides = [
    ['Top', (bw) => [r.left, r.top, r.width, bw]],
    ['Bottom', (bw) => [r.left, r.bottom - bw, r.width, bw]],
    ['Left', (bw) => [r.left, r.top, bw, r.height]],
    ['Right', (bw) => [r.right - bw, r.top, bw, r.height]],
  ];
  for (const [side, rect] of sides) {
    const bw = parseFloat(cs[`border${side}Width`]);
    const style = cs[`border${side}Style`];
    if (!bw || style === 'none' || style === 'hidden') continue;
    ctx.fillStyle = cs[`border${side}Color`];
    if (style === 'dashed' || style === 'dotted') {
      const [x, y, w, hh] = rect(bw);
      const horizontal = w >= hh;
      const dash = style === 'dashed' ? bw * 3 : bw;
      const len = horizontal ? w : hh;
      for (let t = 0; t < len; t += dash * 2) {
        if (horizontal) ctx.fillRect(x + t, y, Math.min(dash, len - t), hh);
        else ctx.fillRect(x, y + t, w, Math.min(dash, len - t));
      }
    } else {
      ctx.fillRect(...rect(bw));
    }
  }
}

function paintSvg(ctx, svg) {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : { x: 0, y: 0, width: r.width, height: r.height };
  const par = (svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim().split(/\s+/);
  const align = par[0], slice = par[1] === 'slice';
  let sx = r.width / vb.width, sy = r.height / vb.height;
  let tx = r.left - vb.x * sx, ty = r.top - vb.y * sy;
  if (align !== 'none') {
    const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
    const extraX = r.width - vb.width * s, extraY = r.height - vb.height * s;
    const fx = align.includes('xMid') ? 0.5 : align.includes('xMax') ? 1 : 0;
    const fy = align.includes('YMid') ? 0.5 : align.includes('YMax') ? 1 : 0;
    sx = sy = s;
    tx = r.left + extraX * fx - vb.x * s;
    ty = r.top + extraY * fy - vb.y * s;
  }
  const color = getComputedStyle(svg).color;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.left, r.top, r.width, r.height);
  ctx.clip();
  ctx.transform(sx, 0, 0, sy, tx, ty);
  for (const shape of svg.querySelectorAll('path, line, rect')) {
    const cs = getComputedStyle(shape);
    const fill = cs.fill === 'none' ? null : cs.fill === 'currentcolor' || cs.fill === 'currentColor' ? color : cs.fill;
    const stroke = cs.stroke === 'none' ? null : cs.stroke;
    let path;
    if (shape.tagName === 'path') path = new Path2D(shape.getAttribute('d') || '');
    else if (shape.tagName === 'line') {
      path = new Path2D();
      path.moveTo(+shape.getAttribute('x1') || 0, +shape.getAttribute('y1') || 0);
      path.lineTo(+shape.getAttribute('x2') || 0, +shape.getAttribute('y2') || 0);
    } else {
      path = new Path2D();
      path.rect(+shape.getAttribute('x') || 0, +shape.getAttribute('y') || 0, +shape.getAttribute('width') || 0, +shape.getAttribute('height') || 0);
    }
    if (fill && shape.tagName !== 'line') { ctx.fillStyle = fill; ctx.fill(path); }
    if (stroke) {
      ctx.strokeStyle = stroke === 'currentcolor' ? color : stroke;
      ctx.lineWidth = parseFloat(shape.getAttribute('stroke-width')) || parseFloat(cs.strokeWidth) || 1;
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

/** Make sure the KaTeX stylesheet is in the document (fonts + layout rules). */
export function ensureKatexStylesheet() {
  if (document.getElementById('katex-css')) return;
  const link = document.createElement('link');
  link.id = 'katex-css';
  link.rel = 'stylesheet';
  link.href = KATEX_CSS;
  document.head.appendChild(link);
}
