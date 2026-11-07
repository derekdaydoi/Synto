// Visual check for the laser pointer and the eraser cursor.
//   dist\Synto.exe --dev app --script tests\e2e-tools.js --data build\test-profile
// 0-7 s: laser draws loops continuously. After 7 s: eraser tool with its size ring.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !(window.synto && window.synto.renderer.width > 0); i++) await sleep(50);
  const app = window.synto;
  await sleep(500);
  const c = app.canvas;
  const ev = (type, [x, y], buttons) => {
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, clientX: r.left + x, clientY: r.top + y, button: 0, buttons, pointerType: 'mouse' }));
  };
  const W = app.renderer.width, H = app.renderer.height;
  app.setTool('laser');
  const t0 = performance.now();
  ev('pointerdown', [W / 2, H / 2], 1);
  while (performance.now() - t0 < 7000) {
    const t = (performance.now() - t0) / 1000;
    ev('pointermove', [W / 2 + Math.cos(t * 3) * 220 + Math.cos(t * 7) * 40, H / 2 + Math.sin(t * 3) * 140], 1);
    await sleep(16);
  }
  ev('pointerup', [W / 2, H / 2], 0);
  app.setTool('eraser');
  app.setEraserSize(24);
  ev('pointermove', [W / 2, H / 2], 0);
})();
