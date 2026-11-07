// Prepares a scene for keyboard tests and exposes the state in the window title.
//   dist\Synto.exe --dev app --script tests\e2e-keys.js --data build\test-profile
// Then send real keystrokes (Ctrl+A, Ctrl+Z...) and read the title:
//   "KEYS els=<count> sel=<selected> undo=<steps> focus=<element>"
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !(window.synto && window.synto.renderer.width > 0); i++) await sleep(50);
  const app = window.synto;
  await sleep(500);
  app.clearCanvas();
  app.history.reset([]);
  const c = app.canvas;
  const ev = (type, [x, y]) => {
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse' }));
  };
  const drag = async (a, b) => { ev('pointerdown', a); for (let i = 1; i <= 6; i++) { ev('pointermove', [a[0] + ((b[0] - a[0]) * i) / 6, a[1] + ((b[1] - a[1]) * i) / 6]); await sleep(10); } ev('pointerup', b); await sleep(30); };
  for (let i = 0; i < 5; i++) { app.setTool('shape', { shapeId: 'rect' }); await drag([300 + i * 150, 300], [400 + i * 150, 380]); }
  app.select([]);
  let last = '-', count = 0;
  window.addEventListener('keydown', (e) => { count++; last = `${e.ctrlKey ? 'C+' : ''}${e.shiftKey ? 'S+' : ''}${e.key}${e.repeat ? '(rep)' : ''}${e.defaultPrevented ? '(prevented)' : ''}`; }, true);
  setInterval(() => {
    const f = document.activeElement;
    const title = `KEYS els=${app.elements.length} sel=${app.state.selectedIds.size} undo=${app.history.past.length} redo=${app.history.future.length} keys=${count} last=${last} focus=${f ? f.tagName + (f.id ? '#' + f.id : '') : 'none'}`;
    // The window title is set by the host, so report through it.
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({ type: 'title', title });
  }, 100);
})();
