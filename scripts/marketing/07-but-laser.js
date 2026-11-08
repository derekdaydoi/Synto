// 07 · Laser pointer: glowing dot and a fading trail, for presenting (never saved).
(async () => {
  await boot();
  const { els } = buildMindmap(true);
  app.setElements(els);
  const [x0, y0, x1, y1] = boundsOf(app.elements);
  zoomTo(x0, y0, x1, y1, 40, 1.3);
  app.setTool('laser');
  const target = app.elements.find((e) => e.topic && e.label === 'Tiếng Anh') || app.elements[0];
  const c = S([target.x + target.w / 2, target.y + target.h / 2]);
  const t0 = performance.now();
  ev('pointerdown', [c[0] - 170, c[1] + 40]);
  let signaled = false;
  while (performance.now() - t0 < 14000) {
    const t = (performance.now() - t0) / 1000;
    // Circle the topic like a presenter would.
    const a = t * 4.2;
    ev('pointermove', [c[0] + Math.cos(a) * (target.w * 0.85 * app.state.camera.zoom) , c[1] + Math.sin(a) * (target.h * 1.1 * app.state.camera.zoom)]);
    if (!signaled && t > 1.4) { signaled = true; ready(0); }
    await sleep(16);
  }
  ev('pointerup', c, 0);
})();
