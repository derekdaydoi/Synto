// Mind-map keyboard test: creates a central topic; drive the rest with real keys
// (type, Enter, Tab, Space). The window title reports the state:
//   "MM els=<n> topics=<n> lines=<n> editing=<yes|no> sel=<label>"
//   dist\Synto.exe --dev app --script tests\e2e-mindmap.js --data build\test-profile
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !(window.synto && window.synto.renderer.width > 0); i++) await sleep(50);
  const app = window.synto;
  await sleep(500);
  app.clearCanvas();
  app.history.reset([]);
  Object.assign(app.state.camera, { scrollX: 0, scrollY: 0, zoom: 1 });
  app.setTool('mindmap');
  const c = app.canvas;
  const r = c.getBoundingClientRect();
  const at = [r.width * 0.3, r.height * 0.45];
  for (const type of ['pointerdown', 'pointerup']) {
    c.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, clientX: r.left + at[0], clientY: r.top + at[1], button: 0, buttons: type === 'pointerdown' ? 1 : 0, pointerType: 'mouse' }));
  }
  let keys = '';
  for (const t of ['keydown', 'keyup']) {
    window.addEventListener(t, (e) => { if (e.code === 'Space') keys += (t === 'keydown' ? 'D' : 'U') + (e.repeat ? 'r' : ''); }, true);
  }
  setInterval(() => {
    const els = app.elements;
    const sel = app.selected[0];
    const title = `MM els=${els.length} topics=${els.filter((e) => e.topic).length} lines=${els.filter((e) => e.type === 'line' && e.startBinding && e.endBinding).length} editing=${app.state.editingId ? 'yes' : 'no'} sel=${sel ? (sel.label || sel.type) : '-'} space=${keys.slice(-8)} tap=${app.spaceTap ? 1 : 0}`;
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({ type: 'title', title });
  }, 100);
})();
