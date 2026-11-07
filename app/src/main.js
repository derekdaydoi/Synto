// Entry point: wires DOM events to the App and builds the UI.

import { App } from './app.js';
import { UI } from './ui.js';
import { ensureKatexStylesheet } from './mathrender.js';
import { hasHost } from './storage.js';

const isField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

async function start() {
  const root = document.getElementById('app');
  ensureKatexStylesheet();
  // Fonts must be ready before measuring text, otherwise boxes get the fallback width.
  await Promise.race([
    Promise.all([
      document.fonts.load('24px "Patrick Hand"'), document.fonts.load('24px Arial'),
      // The most common KaTeX faces, so the first formula measures correctly.
      document.fonts.load('24px KaTeX_Main'), document.fonts.load('italic 24px KaTeX_Math'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]).catch(() => {});

  const app = new App(root);
  const ui = new UI(app);
  window.synto = app; // handy for debugging in DevTools

  // Keep the canvas sized to the window.
  new ResizeObserver(() => app.resize()).observe(root);
  app.resize();

  // ----- canvas pointer events -----
  const c = app.canvas;
  // preventDefault stops the browser's own mousedown focus handling, so focus moves
  // only where the app puts it (canvas, or the text editor when starting to type).
  c.addEventListener('pointerdown', (e) => { e.preventDefault(); ui.closePopover(); app.onPointerDown(e); });
  c.addEventListener('pointermove', (e) => app.onPointerMove(e));
  c.addEventListener('pointerup', (e) => app.onPointerUp(e));
  c.addEventListener('pointercancel', (e) => app.onPointerCancel(e));
  c.addEventListener('lostpointercapture', (e) => { if (app.action && app.pointers.has(e.pointerId)) app.onPointerUp(e); });
  c.addEventListener('dblclick', (e) => app.onDoubleClick(e));
  c.addEventListener('wheel', (e) => app.onWheel(e), { passive: false });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  // Block browser zoom gestures (Ctrl+wheel outside the canvas, pinch) from scaling the UI.
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  // Clicking UI chrome must not steal focus from the text being edited.
  for (const sel of ['#tools', '#props', '#layer', '#bottom-left', '#bottom-right', '#top-right']) {
    root.querySelector(sel).addEventListener('mousedown', (e) => {
      if (app.state.editingId && !isField(e.target)) e.preventDefault();
    });
  }

  // After clicking a toolbar/bottom button, give keyboard focus back to the canvas so
  // Space (pan) or digit shortcuts never re-trigger the focused button.
  for (const sel of ['#tools', '#bottom-left', '#bottom-right']) {
    root.querySelector(sel).addEventListener('click', () => {
      if (!app.state.editingId && !root.querySelector('.dialog') && !root.querySelector('.popover input:focus')) c.focus({ preventScroll: true });
    });
  }

  // ----- text editor -----
  const ta = app.textEditor;
  ta.addEventListener('input', (e) => app.onTextInput(e));
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); app.finishTextEdit(); }
    else if (e.key === 'Tab') { e.preventDefault(); if (!document.execCommand('insertText', false, '    ')) ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); app.onTextInput(); }
  });
  ta.addEventListener('blur', () => {
    // Defer: focus may come right back (e.g. inserting a symbol from the palette).
    setTimeout(() => { if (app.state.editingId && document.activeElement !== ta && !root.querySelector('.dialog')) app.finishTextEdit(); }, 0);
  });

  // ----- keyboard -----
  window.addEventListener('keydown', (e) => onKey(e, app, ui));
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { app.spaceDown = false; app.updateCursor(); }
    if (e.key === 'Alt') app.altDown = false;
  });
  window.addEventListener('blur', () => { app.spaceDown = false; app.altDown = false; });

  // ----- clipboard -----
  document.addEventListener('copy', (e) => app.onCopy(e, false));
  document.addEventListener('cut', (e) => app.onCopy(e, true));
  document.addEventListener('paste', (e) => app.onPaste(e));

  // ----- drag & drop files -----
  const overlay = root.querySelector('#drop-overlay');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; overlay.hidden = false; e.preventDefault(); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    const sp = app.eventPoint(e);
    let p = app.toWorld(sp[0], sp[1]);
    for (const f of files) {
      const el = await app.insertFile(f.name, f.type, await f.arrayBuffer(), p);
      if (el) p = [p[0] + 24, p[1] + 24];
    }
  });

  // ----- persistence on exit -----
  window.addEventListener('beforeunload', () => app.autosave.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) app.autosave.flush(); });
  if (hasHost()) {
    window.chrome.webview.addEventListener('message', async (e) => {
      if (e.data && e.data.type === 'flush') {
        app.finishTextEdit();
        app.autosave.cancel();
        await app.persist();
        window.chrome.webview.postMessage({ type: 'flushed' });
      }
    });
  }

  await app.restore();
  app.resize();
  app.updateCursor();
}

function onKey(e, app, ui) {
  if (e.defaultPrevented) return;
  const dialogOpen = !!app.root.querySelector('.dialog');
  if (dialogOpen || isField(e.target)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const code = e.code;

  if (key === 'Escape') {
    if (ui.popover) { ui.closePopover(); return; }
    if (app.lineDraft) { app.finishLineDraft(false); return; }
    app.select([]);
    return;
  }
  if (key === 'Enter' && app.lineDraft) { e.preventDefault(); app.finishLineDraft(false); return; }
  if (code === 'Space' && !e.repeat) { app.spaceDown = true; app.updateCursor(); e.preventDefault(); return; }
  if (key === 'Alt') { app.altDown = true; e.preventDefault(); return; }

  if (ctrl) {
    const handled = () => e.preventDefault();
    if (key === 'z' && !e.shiftKey) { handled(); app.undo(); return; }
    if ((key === 'z' && e.shiftKey) || key === 'y') { handled(); app.redo(); return; }
    if (key === 'a') { handled(); app.selectAll(); return; }
    if (key === 'd') { handled(); app.duplicateSelected(); return; }
    if (key === 's') { handled(); app.saveToFile(); return; }
    if (key === 'o') { handled(); app.openFromFile(); return; }
    if (key === 'e' && e.shiftKey) { handled(); app.exportPng(); return; }
    if (key === '=' || key === '+') { handled(); app.zoomBy(1.2); return; }
    if (key === '-') { handled(); app.zoomBy(1 / 1.2); return; }
    if (key === '0') { handled(); app.resetZoom(); return; }
    if (code === 'BracketRight') { handled(); app.reorder(e.shiftKey ? 'front' : 'forward'); return; }
    if (code === 'BracketLeft') { handled(); app.reorder(e.shiftKey ? 'back' : 'backward'); return; }
    if (code === 'Quote') { handled(); app.state.showGrid = !app.state.showGrid; app.requestRender(); app.autosave(); return; }
    return; // leave Ctrl+C/V/X to the clipboard events
  }

  if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); app.deleteSelected(); return; }
  if (key.startsWith('Arrow')) {
    if (!app.state.selectedIds.size) return;
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    app.nudge(key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0, key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0);
    return;
  }
  if (e.altKey) return;
  if (key === '?' || (code === 'Slash' && e.shiftKey)) { ui.openHelp(); return; }
  if (code === 'Digit1' && e.shiftKey) { app.zoomToFit(); return; }

  const digit = /^Digit(\d)$/.exec(code);
  const tools = { 1: 'select', 4: 'pen', 5: 'text', 0: 'eraser' };
  if (digit) {
    const n = +digit[1];
    if (tools[n]) { app.setTool(tools[n], n === 4 ? { penMode: 'pen' } : {}); return; }
    if (n === 2) { if (app.state.tool === 'shape') ui.toggleShapes(ui.toolButtons.shape); else app.setTool('shape'); return; }
    if (n === 3) { if (app.state.tool === 'line') ui.toggleLines(ui.toolButtons.line); else app.setTool('line'); return; }
    if (n === 6) { app.setTool('math'); ui.openMathEditor(null, null); return; }
    if (n === 7) { ui.toggleSymbols(ui.toolButtons.symbol); return; }
    if (n === 8) { app.pickAndInsert('image'); return; }
    if (n === 9) { app.pickAndInsert('pdf'); return; }
  }
  switch (key) {
    case 'v': app.setTool('select'); break;
    case 'h': app.setTool('hand'); break;
    case 'p': app.setTool('pen', { penMode: e.shiftKey ? 'highlighter' : 'pen' }); break;
    case 't': app.setTool('text'); break;
    case 'm': app.setTool('math'); ui.openMathEditor(null, null); break;
    case 'e': app.setTool('eraser'); break;
    case 'k': app.setTool('laser'); break;
    case 'l': app.setTool('line', { lineKind: e.shiftKey ? 'polyline' : 'segment' }); break;
    case 'a': app.setTool('line', { lineKind: 'segment' }); app.setStyle({ endHead: 'arrow' }); break;
    case 'c': app.setTool('line', { lineKind: 'curve' }); break;
    case 'r': app.setTool('line', { lineKind: 'arc' }); break;
    case 'q': app.state.toolLocked = !app.state.toolLocked; app.emit('tool'); break;
    default: return;
  }
}

start().catch((err) => {
  console.error(err);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font:14px Segoe UI,sans-serif;color:#c92a2a;background:#fff;padding:24px;text-align:center';
  box.textContent = 'Synto không khởi động được: ' + (err && err.message ? err.message : err);
  document.body.appendChild(box);
});
