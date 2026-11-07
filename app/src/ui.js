// DOM user interface around the canvas: toolbar, properties, popovers, dialogs.

import { h, icon } from './util.js';
import { SHAPE_GROUPS, SHAPES, designPath } from './shapelib.js';
import { SNAP_LABELS } from './snapping.js';
import { katexHtml } from './mathrender.js';
import { quickToLatex, applyAutoReplace } from './textinput.js';
import { pdfCurrentPage } from './elements.js';
import { setHostTitle } from './storage.js';

const I = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  lock: 'M8 11V7a4 4 0 0 1 8 0v4M5 11h14v10H5z',
  unlock: 'M8 11V7a4 4 0 0 1 7.5-2M5 11h14v10H5z',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5a1.5 1.5 0 0 1 3 0v8M17 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-12 5l-3-4a1.6 1.6 0 0 1 2.5-2L8 15',
  select: 'M6 3l12 9-5.5 1L10 19z',
  hex: 'M7.5 4.2h9L21 12l-4.5 7.8h-9L3 12z',
  curve: 'M4 19C8 5 14 19 20 5',
  segment: 'M4 20L20 4',
  polyline: 'M3 18l6-10 5 7 7-11',
  arc: 'M4 18A9 9 0 0 1 20 18',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  pen: 'M4 20l4-1 11-11-3-3L5 16z',
  highlighter: 'M9 15l-4 4h6l1-1M9 15l7-11 4 3-7 11z',
  text: 'M5 5h14M12 5v14M9 19h6',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6',
  eraser: 'M4 16l9-9 6 6-6 6H8zM10 19h10',
  laser: 'M12 9a3 3 0 1 0 .01 0M12 3v3M12 18v3M3 12h3M18 12h3',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  caret: 'M6 9l6 6 6-6',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  open: 'M3 7h6l2 2h10v10H3z',
  save: 'M5 3h12l4 4v14H5zM8 3v6h8M8 21v-7h8v7',
  export: 'M12 15V3M7 8l5-5 5 5M4 15v6h16v-6',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  close: 'M6 6l12 12M18 6L6 18',
  grid: 'M4 4h16v16H4zM4 12h16M12 4v16',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5M12 17h.01',
  front: 'M8 8h12v12H8zM4 4h12v4',
  back: 'M4 4h12v12H4zM20 8v12H8',
};

const COLORS = ['#0a0a0a', '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#7048e8', '#868e96'];
const FILLS = ['transparent', '#ffc9c9', '#a5d8ff', '#b2f2bb', '#ffec99', '#d0bfff', '#e9ecef'];

export const SYMBOL_GROUPS = [
  { name: 'Hy Lạp', items: 'α β γ δ Δ ε θ λ μ π ρ σ Σ τ φ Φ ω Ω ξ η'.split(' ') },
  { name: 'So sánh', items: '= ≠ < > ≤ ≥ ≈ ≡ ∝ ≪ ≫ ∼ ≅'.split(' ') },
  { name: 'Phép toán', items: '± ∓ × ÷ · √ ∛ ∞ ∑ ∏ ∫ ∮ ∂ ∇ ′ % ‰ ! ° ²'.split(' ') },
  { name: 'Tập hợp · logic', items: '∈ ∉ ⊂ ⊆ ∪ ∩ ∅ ℕ ℤ ℚ ℝ ℂ ∀ ∃ ¬ ∧ ∨ ⇒ ⇔ ∴ ∵'.split(' ') },
  { name: 'Mũi tên', items: '→ ← ↔ ⇒ ⇐ ⇔ ↑ ↓ ↦ ⇌'.split(' ') },
  { name: 'Hình học', items: '∠ △ ⊥ ∥ ≅ ∼ ⌒ □ ○ ⊙'.split(' ') },
];

const LATEX_TEMPLATES = [
  ['a/b', '\\frac{a}{b}', 'Phân số'], ['√x', '\\sqrt{x}', 'Căn'], ['xⁿ', 'x^{n}', 'Luỹ thừa'], ['xᵢ', 'x_{i}', 'Chỉ số dưới'],
  ['∑', '\\sum_{i=1}^{n}', 'Tổng'], ['∫', '\\int_{a}^{b}', 'Tích phân'], ['lim', '\\lim_{x \\to 0}', 'Giới hạn'],
  ['[ ]', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', 'Ma trận'], ['{', '\\begin{cases} x + y = 1 \\\\ x - y = 0 \\end{cases}', 'Hệ phương trình'],
  ['vec', '\\vec{x}', 'Vectơ'],
];

const SYMBOL_LATEX = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'Δ': '\\Delta', 'ε': '\\epsilon', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu',
  'π': '\\pi', 'ρ': '\\rho', 'σ': '\\sigma', 'Σ': '\\Sigma', 'τ': '\\tau', 'φ': '\\varphi', 'Φ': '\\Phi', 'ω': '\\omega', 'Ω': '\\Omega', 'ξ': '\\xi', 'η': '\\eta',
  '≠': '\\ne', '≤': '\\le', '≥': '\\ge', '≈': '\\approx', '≡': '\\equiv', '∝': '\\propto', '≪': '\\ll', '≫': '\\gg', '∼': '\\sim', '≅': '\\cong',
  '±': '\\pm', '∓': '\\mp', '×': '\\times', '÷': '\\div', '·': '\\cdot', '√': '\\sqrt{}', '∛': '\\sqrt[3]{}', '∞': '\\infty', '∑': '\\sum', '∏': '\\prod',
  '∫': '\\int', '∮': '\\oint', '∂': '\\partial', '∇': '\\nabla', '′': "'", '°': '^\\circ', '²': '^2', '‰': '\\permil', '%': '\\%',
  '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊆': '\\subseteq', '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}',
  'ℚ': '\\mathbb{Q}', 'ℝ': '\\mathbb{R}', 'ℂ': '\\mathbb{C}', '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\land', '∨': '\\lor', '⇒': '\\Rightarrow',
  '⇔': '\\Leftrightarrow', '∴': '\\therefore', '∵': '\\because', '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇐': '\\Leftarrow', '↑': '\\uparrow',
  '↓': '\\downarrow', '↦': '\\mapsto', '⇌': '\\rightleftharpoons', '∠': '\\angle', '△': '\\triangle', '⊥': '\\perp', '∥': '\\parallel', '⌒': '\\frown',
  '□': '\\square', '○': '\\circ', '⊙': '\\odot',
};

function shapeIcon(id, size = 22, params) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', designPath(id, params));
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.appendChild(p);
  return s;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.root = app.root;
    this.layer = this.root.querySelector('#layer');
    this.popover = null;
    this.buildTopLeft();
    this.buildToolbar();
    this.buildTopRight();
    this.buildBottom();
    this.props = this.root.querySelector('#props');
    app.onChange((what) => this.onAppChange(what));
    this.refreshAll();
  }

  onAppChange(what) {
    if (typeof what === 'object' && what) {
      if (what.type === 'open-math') this.openMathEditor(what.element || null, what.point || null);
      return;
    }
    switch (what) {
      case 'tool': this.refreshToolbar(); this.refreshProps(); break;
      case 'selection': case 'style': case 'editing': this.refreshProps(); break;
      case 'elements': this.refreshProps(); this.refreshHistory(); break;
      case 'history': this.refreshHistory(); break;
      case 'camera': this.refreshZoom(); break;
      case 'save': this.refreshStatus(); break;
      case 'file': this.refreshDocName(); break;
      case 'resize': if (this.popover && this.popover.anchor) this.placePopover(); break;
    }
  }

  refreshAll() {
    this.refreshToolbar(); this.refreshProps(); this.refreshHistory(); this.refreshZoom(); this.refreshStatus(); this.refreshDocName(); this.refreshSnap();
  }

  // ---------- top left ----------

  buildTopLeft() {
    const el = this.root.querySelector('#top-left');
    this.menuBtn = h('button', { class: 'tb soft', 'aria-label': 'Menu', title: 'Menu', onclick: () => this.toggleMenu() }, icon(I.menu, 18));
    this.docName = h('span', { class: 'docname' });
    const brand = h('div', { class: 'brand' },
      h('img', { class: 'logo', src: 'assets/logo.png', alt: 'Synto', width: 87, height: 26, draggable: 'false' }),
      h('span', { class: 'credit' }, '© derekdaydoi'));
    el.append(this.menuBtn, brand, this.docName);
  }

  refreshDocName() {
    const n = this.app.state.fileName;
    this.docName.textContent = n ? '/ ' + n : '';
    document.title = n ? `${n} — Synto` : 'Synto';
    setHostTitle(document.title);
  }

  // ---------- toolbar ----------

  buildToolbar() {
    const host = this.root.querySelector('#tools');
    const bar = h('div', { class: 'toolbar isl', role: 'toolbar', 'aria-label': 'Công cụ' });
    const T = (id, label, ic, key, extra = {}) => {
      const b = h('button', { class: 'tb' + (extra.wide ? ' wide' : '') + (extra.cls ? ' ' + extra.cls : ''), 'aria-label': `${label}${key ? ' (' + key + ')' : ''}`, title: `${label}${key ? ' — ' + key : ''}`, 'data-tool': id, onclick: extra.onclick || (() => this.app.setTool(id)) },
        // Shortcut keys stay in the tooltip only; no number badges on the buttons.
        typeof ic === 'string' ? icon(ic, 19) : ic, extra.wide ? icon(I.caret, 9, 'stroke-width="3"') : null);
      return b;
    };
    this.lockBtn = h('button', { class: 'tb', 'aria-label': 'Giữ công cụ sau khi vẽ (Q)', title: 'Giữ công cụ — Q', onclick: () => { this.app.state.toolLocked = !this.app.state.toolLocked; this.refreshToolbar(); } }, icon(I.unlock, 19));
    this.toolButtons = {
      hand: T('hand', 'Kéo', I.hand, 'H'),
      select: T('select', 'Chọn', I.select, '1'),
      shape: T('shape', 'Hình khối', I.hex, '2', { wide: true, onclick: (e) => this.toggleShapes(e.currentTarget) }),
      line: T('line', 'Nét', I.curve, '3', { wide: true, onclick: (e) => this.toggleLines(e.currentTarget) }),
      pen: T('pen', 'Bút', I.pen, '4', { onclick: () => this.app.setTool('pen', { penMode: 'pen' }) }),
      text: T('text', 'Chữ', I.text, '5'),
      math: T('math', 'Công thức', h('span', { class: 'glyph' }, '∑'), '6', { onclick: () => { this.app.setTool('math'); this.openMathEditor(null, null); } }),
      symbol: T('symbol', 'Ký hiệu', h('span', { class: 'glyph' }, 'Ω'), '7', { onclick: (e) => this.toggleSymbols(e.currentTarget) }),
      image: T('image', 'Chèn ảnh', I.image, '8', { cls: 't-extra', onclick: () => this.app.pickAndInsert('image') }),
      file: T('file', 'Chèn PDF', I.file, '9', { cls: 't-extra', onclick: () => this.app.pickAndInsert('pdf') }),
      eraser: T('eraser', 'Tẩy', I.eraser, '0'),
      laser: T('laser', 'Bút laser', I.laser, 'K', { cls: 't-extra' }),
    };
    const moreBtn = h('button', { class: 'tb', 'aria-label': 'Thêm công cụ', title: 'Thêm', onclick: (e) => this.toggleMore(e.currentTarget) }, icon(I.more, 19, 'stroke-width="3"'));
    const tb = this.toolButtons;
    bar.append(this.lockBtn, h('span', { class: 'sep' }), tb.hand, tb.select, tb.shape, tb.line, tb.pen, tb.text, tb.math, tb.symbol, tb.image, tb.file, tb.eraser,
      h('span', { class: 'sep t-extra' }), tb.laser, moreBtn);
    this.hint = h('span', { class: 'hint' });
    host.append(bar, this.hint);
  }

  refreshToolbar() {
    const s = this.app.state;
    for (const [id, b] of Object.entries(this.toolButtons)) {
      const on = id === s.tool || (id === 'pen' && s.tool === 'pen' && s.penMode === 'pen');
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    // Shape / line buttons show the current choice.
    const shapeBtn = this.toolButtons.shape;
    shapeBtn.replaceChild(shapeIcon(s.shapeId, 19, s.shapeParams), shapeBtn.firstChild);
    const lineIcons = { segment: I.segment, polyline: I.polyline, curve: I.curve, arc: I.arc };
    const lineBtn = this.toolButtons.line;
    const lic = s.tool === 'pen' && s.penMode === 'highlighter' ? I.highlighter : lineIcons[s.lineKind] || I.curve;
    lineBtn.replaceChild(icon(lic, 19), lineBtn.firstChild);
    lineBtn.classList.toggle('on', s.tool === 'line' || (s.tool === 'pen' && s.penMode === 'highlighter'));
    this.lockBtn.classList.toggle('on', s.toolLocked);
    this.lockBtn.replaceChild(icon(s.toolLocked ? I.lock : I.unlock, 19), this.lockBtn.firstChild);
    const hints = {
      select: 'Kéo để chọn nhiều · Shift để giữ tỉ lệ · Alt để tắt bắt điểm',
      shape: 'Kéo để vẽ hình · Shift: giữ tỉ lệ',
      line: s.lineKind === 'segment' ? 'Kéo để vẽ đoạn thẳng · Shift: khoá góc 15°' : s.lineKind === 'arc' ? 'Kéo dây cung, rồi bấm để chọn độ cong' : 'Bấm từng điểm · bấm đúp hoặc Enter để kết thúc',
      pen: s.pdfAnnotate ? 'Đang vẽ lên PDF' : 'Vẽ tự do',
      text: 'Bấm để gõ chữ · gõ \\delta rồi dấu cách để chèn Δ',
      eraser: 'Quẹt qua để xoá · giữ Alt để lấy lại',
      hand: 'Kéo để di chuyển mặt giấy',
      laser: 'Bút laser để chỉ, không lưu lại',
      math: 'Bấm lên mặt giấy để đặt công thức',
    };
    this.hint.textContent = hints[s.tool] || '';
  }

  // ---------- top right ----------

  buildTopRight() {
    const el = this.root.querySelector('#top-right');
    this.status = h('span', { class: 'status' });
    this.propsToggle = h('button', { class: 'tb soft props-toggle', 'aria-label': 'Thuộc tính', title: 'Thuộc tính', onclick: () => this.props.classList.toggle('open') }, icon(I.sliders, 16));
    el.append(this.status, this.propsToggle,
      h('button', { class: 'btn primary', title: 'Lưu file — Ctrl+S', onclick: () => this.app.saveToFile() }, icon(I.save, 14), h('span', { class: 'btn-text' }, 'Lưu')));
  }

  refreshStatus() {
    const m = { saved: 'Đã lưu trên máy', saving: 'Đang lưu…', dirty: 'Chưa lưu', error: 'Lỗi lưu tự động' };
    this.status.textContent = m[this.app.saveState] || '';
  }

  // ---------- bottom ----------

  buildBottom() {
    const bl = this.root.querySelector('#bottom-left');
    this.zoomLabel = h('button', { class: 'zoom-label', title: 'Về 100% (Ctrl+0) · bấm đúp: vừa nội dung', onclick: () => this.app.resetZoom(), ondblclick: () => this.app.zoomToFit() });
    this.undoBtn = h('button', { class: 'tb', 'aria-label': 'Hoàn tác (Ctrl+Z)', title: 'Hoàn tác — Ctrl+Z', onclick: () => this.app.undo() }, icon(I.undo, 16));
    this.redoBtn = h('button', { class: 'tb', 'aria-label': 'Làm lại (Ctrl+Y)', title: 'Làm lại — Ctrl+Y', onclick: () => this.app.redo() }, icon(I.redo, 16));
    bl.append(
      h('div', { class: 'group zoom-group' },
        h('button', { class: 'tb', 'aria-label': 'Thu nhỏ', title: 'Thu nhỏ — Ctrl+-', onclick: () => this.app.zoomBy(1 / 1.2) }, '−'),
        this.zoomLabel,
        h('button', { class: 'tb', 'aria-label': 'Phóng to', title: 'Phóng to — Ctrl+=', onclick: () => this.app.zoomBy(1.2) }, '+')),
      h('div', { class: 'group' }, this.undoBtn, this.redoBtn));
    const br = this.root.querySelector('#bottom-right');
    this.snapChip = h('button', { class: 'chip-snap', 'aria-label': 'Bắt điểm', onclick: (e) => this.toggleSnap(e.currentTarget) }, icon(I.magnet, 14), h('span', { class: 'snap-text' }));
    br.append(this.snapChip, h('button', { class: 'tb soft', 'aria-label': 'Phím tắt (?)', title: 'Phím tắt — ?', onclick: () => this.openHelp() }, icon(I.help, 22, 'stroke-width="2.2"')));
  }

  refreshZoom() { this.zoomLabel.textContent = Math.round(this.app.state.camera.zoom * 100) + '%'; }

  refreshHistory() {
    this.undoBtn.disabled = !this.app.history.canUndo;
    this.redoBtn.disabled = !this.app.history.canRedo;
  }

  refreshSnap() {
    const on = this.app.state.snap.enabled;
    this.snapChip.className = 'chip-snap ' + (on ? 'on' : 'off');
    this.snapChip.querySelector('.snap-text').textContent = on ? 'Bắt điểm: Bật' : 'Bắt điểm: Tắt';
  }

  // ---------- properties panel ----------

  refreshProps() {
    const app = this.app, s = app.state;
    const sel = app.selected;
    const drawingTools = ['shape', 'line', 'pen', 'text'];
    const types = new Set(sel.length ? sel.map((e) => e.type) : drawingTools.includes(s.tool) ? [s.tool === 'pen' ? 'draw' : s.tool] : []);
    const panel = this.props;
    panel.replaceChildren();
    if (!sel.length && s.tool === 'eraser') {
      // Eraser settings: preset sizes plus a slider for fine control.
      panel.hidden = false;
      const r = s.eraserSize;
      const sizeLabel = h('span', { class: 'lbl' }, `Tuỳ chỉnh: ${r * 2} px`);
      panel.append(
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Cỡ tẩy'),
          seg([[5, 'Nhỏ'], [12, 'Vừa'], [24, 'Lớn'], [44, 'Rất lớn']], r, (v) => app.setEraserSize(v))),
        h('div', { class: 'row' }, sizeLabel,
          h('input', {
            type: 'range', min: 3, max: 80, step: 1, value: r, 'aria-label': 'Cỡ tẩy',
            oninput: (e) => { app.setEraserSize(Number(e.target.value), true); sizeLabel.textContent = `Tuỳ chỉnh: ${app.state.eraserSize * 2} px`; },
            onchange: () => this.refreshProps(),
          })),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Chế độ'),
          h('span', { class: 'muted', style: { fontSize: '12px', lineHeight: '1.5' } }, 'Quẹt qua để xoá cả nét. Giữ Alt khi quẹt để lấy lại. Phím [ và ] để đổi cỡ nhanh.')));
      return;
    }
    if (!types.size) { panel.hidden = true; panel.classList.remove('open'); return; }
    panel.hidden = false;
    const cur = sel[0] || s.style;
    const st = s.style;
    const row = (label, ...children) => h('div', { class: 'row' }, h('span', { class: 'lbl' }, label), ...children);
    const has = (...t) => t.some((x) => types.has(x));
    const val = (k) => (sel.length && sel[0][k] !== undefined ? sel[0][k] : st[k]);

    if (has('shape', 'line', 'draw', 'text', 'math')) {
      panel.append(row('Màu nét', h('div', { class: 'line' }, COLORS.map((c) => h('button', {
        class: 'swatch' + (val('strokeColor') === c ? ' on' : ''), style: { background: c }, 'aria-label': 'Màu ' + c, onclick: () => app.setStyle({ strokeColor: c }),
      })), colorInput(val('strokeColor'), (c) => app.setStyle({ strokeColor: c })))));
    }
    if (has('shape')) {
      panel.append(row('Màu nền', h('div', { class: 'line' }, FILLS.map((c) => h('button', {
        class: 'swatch' + (c === 'transparent' ? ' none' : '') + (val('fillColor') === c ? ' on' : ''), style: c === 'transparent' ? {} : { background: c },
        'aria-label': c === 'transparent' ? 'Không nền' : 'Nền ' + c, onclick: () => app.setStyle({ fillColor: c }),
      })), colorInput(val('fillColor') === 'transparent' ? '#ffffff' : val('fillColor'), (c) => app.setStyle({ fillColor: c })))));
      if (val('fillColor') !== 'transparent') {
        panel.append(row('Kiểu tô', seg([['hachure', 'Gạch'], ['cross-hatch', 'Chéo'], ['solid', 'Đặc']], val('fillStyle'), (v) => app.setStyle({ fillStyle: v }))));
      }
    }
    if (has('shape', 'line', 'draw')) {
      panel.append(row('Độ dày', seg([[1, 'Mảnh'], [2, 'Vừa'], [4, 'Đậm']], val('strokeWidth'), (v) => app.setStyle({ strokeWidth: v }))));
    }
    if (has('shape', 'line')) {
      panel.append(row('Kiểu nét', seg([['solid', 'Liền'], ['dashed', 'Đứt'], ['dotted', 'Chấm']], val('strokeStyle'), (v) => app.setStyle({ strokeStyle: v }))));
      panel.append(row('Độ phác', seg([[0, 'Mượt'], [1, 'Phác'], [2, 'Rất phác']], val('roughness'), (v) => app.setStyle({ roughness: v }))));
    }
    if (has('line')) {
      const heads = [['none', '—'], ['arrow', '→'], ['dot', '●'], ['bar', '⊢']];
      panel.append(row('Đầu bắt đầu', seg(heads, val('startHead'), (v) => app.setStyle({ startHead: v }))));
      panel.append(row('Đầu kết thúc', seg(heads, val('endHead'), (v) => app.setStyle({ endHead: v }))));
    }
    if (has('text')) {
      panel.append(row('Phông chữ', h('div', { class: 'grid2' },
        h('button', { class: 'pb' + (val('font') === 'hand' ? ' on' : ''), style: { height: '44px', flexDirection: 'column' }, onclick: () => app.setStyle({ font: 'hand' }) },
          h('span', { style: { fontFamily: '"Patrick Hand"', fontSize: '20px', lineHeight: '1' } }, 'Aa'), h('span', { style: { fontSize: '10px' } }, 'Viết tay')),
        h('button', { class: 'pb' + (val('font') === 'arial' ? ' on' : ''), style: { height: '44px', flexDirection: 'column' }, onclick: () => app.setStyle({ font: 'arial' }) },
          h('span', { style: { fontFamily: 'Arial, Arimo, sans-serif', fontSize: '17px', lineHeight: '1.1' } }, 'Aa'), h('span', { style: { fontSize: '10px' } }, 'Arial')))));
      panel.append(row('Cỡ chữ', seg([[16, 'S'], [24, 'M'], [36, 'L'], [52, 'XL']], val('fontSize'), (v) => app.setStyle({ fontSize: v }))));
      panel.append(row('Căn chữ', seg([['left', 'Trái'], ['center', 'Giữa'], ['right', 'Phải']], val('align'), (v) => app.setStyle({ align: v }))));
    }
    const shapeSel = sel.length === 1 && sel[0].type === 'shape' ? sel[0] : null;
    const shapeId = shapeSel ? shapeSel.shapeId : !sel.length && s.tool === 'shape' ? s.shapeId : null;
    const params = shapeSel ? shapeSel.params : s.shapeParams;
    if (shapeId === 'polygon') {
      panel.append(row(`Số cạnh: ${params.sides ?? 6}`, range(3, 12, 1, params.sides ?? 6, (v) => app.setShapeParams({ sides: v }))));
    }
    if (shapeId === 'star') {
      panel.append(row(`Số cánh: ${params.points ?? 5}`, range(3, 12, 1, params.points ?? 5, (v) => app.setShapeParams({ points: v }))));
      panel.append(row(`Độ nhọn: ${Math.round((1 - (params.inner ?? 0.45)) * 100)}%`, range(10, 90, 5, Math.round((1 - (params.inner ?? 0.45)) * 100), (v) => app.setShapeParams({ inner: 1 - v / 100 }))));
    }
    if (has('pdf') && sel.length === 1) {
      const pdf = sel[0];
      panel.append(row('Trang', h('div', { class: 'line' },
        h('button', { class: 'pb', 'aria-label': 'Trang trước', onclick: () => app.pdfPage(-1) }, '‹'),
        h('span', { style: { minWidth: '56px', textAlign: 'center' } }, `${pdfCurrentPage(pdf) + 1} / ${pdf.pages.length}`),
        h('button', { class: 'pb', 'aria-label': 'Trang sau', onclick: () => app.pdfPage(1) }, '›'))));
      panel.append(row('Vẽ lên file', h('button', {
        class: 'pb' + (s.pdfAnnotate ? ' on' : ''), onclick: () => { s.pdfAnnotate = !s.pdfAnnotate; if (s.pdfAnnotate) app.setTool('pen', { penMode: 'pen' }); else this.refreshProps(); app.emit('tool'); },
      }, s.pdfAnnotate ? 'Đang bật — bút vẽ lên trang' : 'Bật')));
    }
    if (has('math') && sel.length === 1) {
      panel.append(row('Công thức', h('button', { class: 'pb', onclick: () => this.openMathEditor(sel[0], null) }, 'Sửa công thức…')));
    }
    if (sel.length || types.size) {
      panel.append(row(`Độ trong suốt: ${val('opacity')}%`, range(10, 100, 10, val('opacity'), (v) => app.setStyle({ opacity: v }))));
    }
    if (sel.length) {
      panel.append(row('Lớp', h('div', { class: 'line' },
        h('button', { class: 'pb', title: 'Đưa xuống dưới cùng (Ctrl+Shift+[)', 'aria-label': 'Đưa xuống dưới cùng', onclick: () => app.reorder('back') }, '⇊'),
        h('button', { class: 'pb', title: 'Đưa xuống (Ctrl+[)', 'aria-label': 'Đưa xuống', onclick: () => app.reorder('backward') }, '↓'),
        h('button', { class: 'pb', title: 'Đưa lên (Ctrl+])', 'aria-label': 'Đưa lên', onclick: () => app.reorder('forward') }, '↑'),
        h('button', { class: 'pb', title: 'Đưa lên trên cùng (Ctrl+Shift+])', 'aria-label': 'Đưa lên trên cùng', onclick: () => app.reorder('front') }, '⇈'))));
      panel.append(row('Thao tác', h('div', { class: 'line' },
        h('button', { class: 'pb', title: 'Nhân bản (Ctrl+D)', 'aria-label': 'Nhân bản', onclick: () => app.duplicateSelected() }, icon(I.copy, 15)),
        h('button', { class: 'pb', title: 'Xoá (Delete)', 'aria-label': 'Xoá', onclick: () => app.deleteSelected() }, icon(I.trash, 15)))));
    }
    void cur;
  }

  // ---------- popovers ----------

  closePopover() {
    if (!this.popover) return;
    this.popover.el.remove();
    document.removeEventListener('pointerdown', this.popover.outside, true);
    this.popover = null;
  }

  openPopover(id, anchor, content, width = 320) {
    if (this.popover && this.popover.id === id) { this.closePopover(); return null; }
    this.closePopover();
    const el = h('div', { class: 'popover', role: 'dialog', style: { width: width + 'px' } }, content);
    this.layer.append(el);
    const outside = (e) => {
      if (!el.contains(e.target) && !(anchor && anchor.contains(e.target))) this.closePopover();
    };
    document.addEventListener('pointerdown', outside, true);
    this.popover = { id, el, anchor, outside };
    this.placePopover();
    return el;
  }

  placePopover() {
    const { el, anchor } = this.popover;
    const rr = this.root.getBoundingClientRect();
    if (!anchor) {
      el.style.left = Math.max(12, (rr.width - el.offsetWidth) / 2) + 'px';
      el.style.top = Math.max(12, (rr.height - el.offsetHeight) / 2) + 'px';
      return;
    }
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth, hgt = el.offsetHeight;
    let left = a.left - rr.left + a.width / 2 - w / 2;
    left = Math.max(12, Math.min(left, rr.width - w - 12));
    let top = a.bottom - rr.top + 8;
    if (top + hgt > rr.height - 12) top = Math.max(12, a.top - rr.top - hgt - 8);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  toggleMenu() {
    const app = this.app;
    const item = (ic, label, k, fn, cls = '') => h('button', { class: 'menu-item ' + cls, onclick: () => { this.closePopover(); fn(); } }, icon(ic, 16), label, k ? h('span', { class: 'k' }, k) : null);
    this.openPopover('menu', this.menuBtn, h('div', { class: 'menu' },
      item(I.open, 'Mở file…', 'Ctrl+O', () => app.openFromFile()),
      item(I.save, 'Lưu file…', 'Ctrl+S', () => app.saveToFile()),
      item(I.export, 'Xuất ảnh PNG', 'Ctrl+Shift+E', () => app.exportPng()),
      h('div', { class: 'menu-sep' }),
      item(I.image, 'Chèn ảnh…', '', () => app.pickAndInsert('image')),
      item(I.file, 'Chèn PDF…', '', () => app.pickAndInsert('pdf')),
      item(I.grid, app.state.showGrid ? 'Ẩn lưới chấm' : 'Hiện lưới chấm', "Ctrl+'", () => { app.state.showGrid = !app.state.showGrid; app.requestRender(); app.autosave(); }),
      h('div', { class: 'menu-sep' }),
      item(I.help, 'Phím tắt', '?', () => this.openHelp()),
      item(I.trash, 'Xoá toàn bộ mặt giấy…', '', () => this.confirm('Xoá toàn bộ mặt giấy?', 'Có thể hoàn tác bằng Ctrl+Z.', 'Xoá hết', () => app.clearCanvas()), 'danger'),
    ), 300);
  }

  toggleShapes(anchor) {
    const app = this.app;
    let filter = '';
    let tab = 'Tất cả';
    const body = h('div');
    const draw = () => {
      body.replaceChildren();
      const q = filter.trim().toLowerCase().normalize('NFC');
      for (const g of SHAPE_GROUPS) {
        if (tab !== 'Tất cả' && g.name !== tab) continue;
        const items = g.items.filter((s) => !q || s.n.toLowerCase().includes(q) || g.name.toLowerCase().includes(q));
        if (!items.length) continue;
        body.append(h('div', { class: 'group-title' }, g.name), h('div', { class: 'tiles' }, items.map((s) => h('button', {
          class: 'tile' + (app.state.shapeId === s.id && app.state.tool === 'shape' ? ' on' : ''), title: s.n, 'aria-label': s.n,
          onclick: () => { app.setTool('shape', { shapeId: s.id }); this.closePopover(); },
        }, shapeIcon(s.id, 24, app.state.shapeParams), h('span', null, s.n)))));
      }
      if (!body.childNodes.length) body.append(h('p', { class: 'muted' }, 'Không có hình nào khớp.'));
    };
    const tabs = h('div', { class: 'tabs' });
    const drawTabs = () => {
      tabs.replaceChildren(...['Tất cả', ...SHAPE_GROUPS.map((g) => g.name)].map((n) => h('button', { class: 'tab' + (tab === n ? ' on' : ''), onclick: () => { tab = n; drawTabs(); draw(); } }, n)));
    };
    drawTabs();
    draw();
    const search = h('input', { placeholder: 'Tìm hình: thang, mũi tên, sao…', 'aria-label': 'Tìm hình', oninput: (e) => { filter = e.target.value; draw(); } });
    const pop = this.openPopover('shapes', anchor, [h('div', { class: 'search' }, icon('M11 5a6 6 0 1 0 .01 0M20 20l-4-4', 14), search), tabs, body], 560);
    if (pop) setTimeout(() => search.focus(), 0);
  }

  toggleLines(anchor) {
    const app = this.app;
    const item = (ic, label, k, fn, on) => h('button', { class: 'menu-item' + (on ? ' on' : ''), style: on ? { background: '#0a0a0a', color: '#fff' } : {}, onclick: () => { fn(); this.closePopover(); } }, icon(ic, 18), label, h('span', { class: 'k' }, k));
    const s = app.state;
    const isLine = (k) => s.tool === 'line' && s.lineKind === k;
    this.openPopover('lines', anchor, h('div', { class: 'menu' },
      item(I.segment, 'Đoạn thẳng', 'L', () => { app.setTool('line', { lineKind: 'segment' }); app.setStyle({ endHead: 'none' }); }, isLine('segment') && s.style.endHead === 'none'),
      item(I.arrow, 'Mũi tên', 'A', () => { app.setTool('line', { lineKind: 'segment' }); app.setStyle({ endHead: 'arrow' }); }, isLine('segment') && s.style.endHead === 'arrow'),
      item(I.polyline, 'Đường gấp khúc', 'Shift+L', () => app.setTool('line', { lineKind: 'polyline' }), isLine('polyline')),
      item(I.curve, 'Đường cong', 'C', () => app.setTool('line', { lineKind: 'curve' }), isLine('curve')),
      item(I.arc, 'Cung tròn qua 3 điểm', 'R', () => app.setTool('line', { lineKind: 'arc' }), isLine('arc')),
      h('div', { class: 'menu-sep' }),
      item(I.pen, 'Bút tự do', 'P', () => app.setTool('pen', { penMode: 'pen' }), s.tool === 'pen' && s.penMode === 'pen'),
      item(I.highlighter, 'Bút dạ quang', 'Shift+P', () => app.setTool('pen', { penMode: 'highlighter' }), s.tool === 'pen' && s.penMode === 'highlighter'),
    ), 280);
  }

  toggleSymbols(anchor, onPick) {
    const app = this.app;
    const pick = onPick || ((sym) => { app.insertSymbol(sym); });
    let tab = 'Tất cả';
    const body = h('div');
    const draw = () => {
      body.replaceChildren(...SYMBOL_GROUPS.filter((g) => tab === 'Tất cả' || g.name === tab).map((g) => h('div', null,
        h('div', { class: 'group-title' }, g.name),
        h('div', { class: 'sym-grid' }, g.items.map((sy) => h('button', { class: 'sym', title: sy, 'aria-label': sy, onclick: () => pick(sy) }, sy))))));
    };
    const tabs = h('div', { class: 'tabs' });
    const drawTabs = () => tabs.replaceChildren(...['Tất cả', ...SYMBOL_GROUPS.map((g) => g.name)].map((n) => h('button', { class: 'tab' + (tab === n ? ' on' : ''), onclick: () => { tab = n; drawTabs(); draw(); } }, n)));
    drawTabs(); draw();
    this.openPopover(onPick ? 'symbols-math' : 'symbols', anchor, [h('h3', null, 'Ký hiệu'), h('p', { class: 'muted', style: { margin: '0 0 4px', fontSize: '11px' } }, 'Hoặc gõ \\tên rồi dấu cách trong ô chữ, ví dụ \\delta → δ'), tabs, body], 420);
  }

  toggleMore(anchor) {
    const app = this.app;
    const item = (ic, label, k, fn) => h('button', { class: 'menu-item', onclick: () => { this.closePopover(); fn(); } }, icon(ic, 16), label, h('span', { class: 'k' }, k));
    this.openPopover('more', anchor, h('div', { class: 'menu' },
      item(I.image, 'Chèn ảnh…', '', () => app.pickAndInsert('image')),
      item(I.file, 'Chèn PDF…', '', () => app.pickAndInsert('pdf')),
      item(I.laser, 'Bút laser', 'K', () => app.setTool('laser')),
      item(I.hand, 'Kéo mặt giấy', 'H', () => app.setTool('hand')),
    ), 240);
  }

  toggleSnap(anchor) {
    const app = this.app;
    const s = app.state.snap;
    const rows = Object.keys(SNAP_LABELS).map((k) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: s[k], onchange: (e) => { s[k] = e.target.checked; app.autosave(); } }), SNAP_LABELS[k]));
    const master = h('label', { class: 'check', style: { fontWeight: '600' } },
      h('input', { type: 'checkbox', checked: s.enabled, onchange: (e) => { s.enabled = e.target.checked; this.refreshSnap(); app.autosave(); } }), 'Bắt điểm tự động');
    this.openPopover('snap', anchor, [master, h('div', { class: 'menu-sep' }), ...rows, h('p', { class: 'muted', style: { margin: '8px 0 0', fontSize: '11px' } }, 'Giữ Alt khi vẽ để tạm tắt · Shift để khoá góc 15°')], 240);
  }

  // ---------- dialogs ----------

  openDialog(title, content, actions, onClose) {
    this.closePopover();
    const backdrop = h('div', { class: 'dialog-backdrop' });
    const close = () => { backdrop.remove(); dlg.remove(); document.removeEventListener('keydown', onKey, true); if (onClose) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, h('h2', null, title),
        h('button', { class: 'tb', 'aria-label': 'Đóng', onclick: () => close() }, icon(I.close, 16))),
      content, actions ? h('div', { class: 'actions' }, actions(close)) : null);
    backdrop.addEventListener('pointerdown', () => close());
    document.addEventListener('keydown', onKey, true);
    this.layer.append(backdrop, dlg);
    return { close, dlg };
  }

  confirm(title, message, okLabel, onOk) {
    this.openDialog(title, h('p', { style: { margin: 0 } }, message), (close) => [
      h('button', { class: 'btn', onclick: () => close() }, 'Huỷ'),
      h('button', { class: 'btn danger', onclick: () => { close(); onOk(); } }, okLabel),
    ]);
  }

  openHelp() {
    const rows = [
      ['Chọn', '1 / V'], ['Kéo mặt giấy', 'H hoặc giữ Space'], ['Hình khối', '2'], ['Nét', '3'], ['Bút', '4 / P'], ['Bút dạ quang', 'Shift+P'],
      ['Chữ', '5 / T'], ['Công thức', '6 / M'], ['Ký hiệu', '7'], ['Chèn ảnh', '8'], ['Chèn PDF', '9'], ['Tẩy', '0 / E'], ['Laser', 'K'],
      ['Giữ công cụ', 'Q'], ['Hoàn tác / Làm lại', 'Ctrl+Z / Ctrl+Y'], ['Nhân bản', 'Ctrl+D'], ['Chọn tất cả', 'Ctrl+A'], ['Xoá', 'Delete'],
      ['Sao chép / Dán', 'Ctrl+C / Ctrl+V'], ['Lưu / Mở', 'Ctrl+S / Ctrl+O'], ['Xuất PNG', 'Ctrl+Shift+E'], ['Phóng to / nhỏ', 'Ctrl+= / Ctrl+-, Ctrl+lăn chuột'],
      ['Về 100%', 'Ctrl+0'], ['Vừa nội dung', 'Shift+1'], ['Đưa lên / xuống', 'Ctrl+] / Ctrl+['], ['Giữ tỉ lệ / khoá góc', 'Shift'], ['Tắt bắt điểm tạm thời', 'Alt'],
      ['Kết thúc nét nhiều điểm', 'Enter / bấm đúp'], ['Đổi cỡ tẩy', '[ / ]'],
    ];
    this.openDialog('Phím tắt', [
      h('div', { class: 'shortcuts' }, rows.map(([a, b]) => h('div', null, h('span', null, a), h('kbd', null, b)))),
      h('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '11px', textAlign: 'center' } }, 'Synto · © derekdaydoi'),
    ]);
  }

  /** Formula editor. element = existing math element or null; point = world position for a new one. */
  openMathEditor(element, point) {
    const app = this.app;
    let mode = element ? element.mode || 'latex' : 'quick';
    const input = h('textarea', { class: 'math-input', spellcheck: 'false', 'aria-label': 'Nhập công thức' });
    input.value = element ? (element.source || element.latex) : '';
    const preview = h('div', { class: 'math-preview', 'aria-live': 'polite' });
    const error = h('div', { class: 'math-error' });
    const latexLine = h('div', { class: 'muted', style: { fontSize: '11px', fontFamily: 'Consolas, monospace', overflowWrap: 'anywhere' } });
    const toLatex = () => (mode === 'quick' ? quickToLatex(input.value) : input.value.trim());
    const update = () => {
      const latex = toLatex();
      if (!latex) { preview.innerHTML = '<span class="muted" style="font-size:13px">Xem trước công thức</span>'; error.textContent = ''; latexLine.textContent = ''; return; }
      const r = katexHtml(latex);
      preview.innerHTML = r.html;
      error.textContent = r.error ? 'Lỗi cú pháp: ' + r.error : '';
      latexLine.textContent = mode === 'quick' ? 'LaTeX: ' + latex : '';
    };
    input.addEventListener('input', (e) => { if (mode === 'quick' && e.inputType === 'insertText') applyAutoReplace(input); update(); });
    const tabs = h('div', { class: 'tabs', style: { margin: '0' } });
    const drawTabs = () => tabs.replaceChildren(
      h('button', { class: 'tab' + (mode === 'quick' ? ' on' : ''), onclick: () => { if (mode !== 'quick') { mode = 'quick'; drawTabs(); update(); } } }, 'Gõ nhanh'),
      h('button', { class: 'tab' + (mode === 'latex' ? ' on' : ''), onclick: () => { if (mode !== 'latex') { input.value = quickToLatex(input.value); mode = 'latex'; drawTabs(); update(); } } }, 'LaTeX'));
    drawTabs();
    const insert = (text) => {
      input.focus();
      if (!document.execCommand('insertText', false, text)) input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
      update();
    };
    const templates = h('div', { class: 'tpl-row' }, LATEX_TEMPLATES.map(([label, tex, title]) => h('button', {
      class: 'tpl', title, 'aria-label': title,
      onclick: () => { if (mode === 'quick') { mode = 'latex'; input.value = quickToLatex(input.value); drawTabs(); } insert(tex); },
    }, label)));
    const symBtn = h('button', { class: 'tpl', title: 'Ký hiệu', 'aria-label': 'Ký hiệu', onclick: (e) => this.toggleSymbols(e.currentTarget, (sy) => {
      if (mode === 'quick') insert(sy); else insert((SYMBOL_LATEX[sy] || sy) + ' ');
    }) }, 'Ω');
    templates.append(symBtn);
    let done = false;
    const { close } = this.openDialog(element ? 'Sửa công thức' : 'Công thức', [
      tabs,
      h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Gõ nhanh: sqrt(x), a/b, x^2, +-, >=, delta, pi, sin… · LaTeX: \\frac{a}{b}, \\sqrt{x}…'),
      input, templates, preview, latexLine, error,
    ], (closeFn) => [
      h('button', { class: 'btn', onclick: () => closeFn() }, 'Huỷ'),
      h('button', { class: 'btn primary', onclick: () => { done = true; closeFn(); } }, 'Xong · Ctrl+Enter'),
    ], () => {
      if (done) {
        const latex = toLatex();
        const r = latex ? katexHtml(latex) : { error: null };
        if (latex && r.error) app.toast('Công thức có lỗi cú pháp nhưng vẫn được lưu để bạn sửa tiếp.', true);
        app.upsertMath({ element, point, latex, source: input.value, mode }).catch((err) => app.toast('Không chèn được công thức: ' + err.message, true));
      }
      if (app.state.tool === 'math' && !app.state.toolLocked) app.setTool('select');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done = true; close(); }
      e.stopPropagation();
    });
    update();
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
  }
}

function seg(options, value, onPick) {
  return h('div', { class: 'line' }, options.map(([v, label]) => h('button', { class: 'pb' + (v === value ? ' on' : ''), 'aria-pressed': v === value ? 'true' : 'false', onclick: () => onPick(v) }, label)));
}

function range(min, max, step, value, onChange) {
  // Apply on release to keep one undo step per change.
  return h('input', { type: 'range', min, max, step, value, onchange: (e) => onChange(Number(e.target.value)) });
}

function colorInput(value, onChange) {
  const v = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return h('input', { type: 'color', value: v, 'aria-label': 'Chọn màu khác', title: 'Màu khác', style: { width: '26px', height: '26px', padding: '0', border: '1px solid #dadada', borderRadius: '6px', background: 'none' }, onchange: (e) => onChange(e.target.value) });
}

export { SHAPES };
