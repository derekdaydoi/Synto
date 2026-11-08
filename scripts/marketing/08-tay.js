// 08 · Eraser: swipe across strokes; touched objects fade, the size ring follows the pointer.
(async () => {
  await boot();
  add(text(80, 60, 'Nháp bài tập', { font: 'arial', fontSize: 34 }));
  add(pen(wave(80, 170, 520, 14, 3), { strokeWidth: 2.5 }));
  add(pen(wave(80, 240, 460, 10, 4), { strokeWidth: 2.5, strokeColor: '#1971c2' }));
  add(pen(wave(80, 310, 540, 16, 2.5), { strokeWidth: 2.5 }));
  add(pen(wave(80, 380, 380, 12, 3.5), { strokeWidth: 2.5, strokeColor: '#e03131' }));
  add(shape('ellipse', 700, 140, 220, 130, { strokeColor: '#2f9e44' }));
  add(shape('tri-eq', 760, 320, 160, 140, { fillColor: '#ffec99', fillStyle: 'hachure', strokeColor: '#f08c00' }));
  add(text(690, 480, 'x² − 5x + 6 = 0', { fontSize: 30 }));
  zoomTo(60, 40, 960, 540, 290, 1.3);
  app.setTool('eraser');
  app.setEraserSize(26);
  await sleep(200);
  // Swipe diagonally through the middle strokes and the ellipse; keep the button down.
  const path = [];
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    path.push(S([300 + t * 520, 200 + t * 60 + Math.sin(t * 6) * 30]));
  }
  ev('pointerdown', path[0]);
  for (const p of path) { ev('pointermove', p); await sleep(12); }
  await ready(250);
})();
