// 05 · Object snapping: drawing a median from C; the pointer snaps to the midpoint of AB.
(async () => {
  await boot();
  const A = [-260, 200], B = [260, 200], C = [-70, -190];
  add(line([A, B, C, A], { kind: 'polyline', strokeWidth: 2.5 }));
  // Circumscribed circle (exact): center and radius from the three vertices.
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  const ux = ((A[0] ** 2 + A[1] ** 2) * (B[1] - C[1]) + (B[0] ** 2 + B[1] ** 2) * (C[1] - A[1]) + (C[0] ** 2 + C[1] ** 2) * (A[1] - B[1])) / d;
  const uy = ((A[0] ** 2 + A[1] ** 2) * (C[0] - B[0]) + (B[0] ** 2 + B[1] ** 2) * (A[0] - C[0]) + (C[0] ** 2 + C[1] ** 2) * (B[0] - A[0])) / d;
  const r = Math.hypot(A[0] - ux, A[1] - uy);
  add(shape('circle', ux - r, uy - r, 2 * r, 2 * r, { strokeColor: '#1971c2', strokeWidth: 2 }));
  // Altitude from C with a right-angle mark.
  add(line([C, [C[0], 200]], { strokeColor: '#2f9e44', strokeStyle: 'dashed', strokeWidth: 2 }));
  add(shape('right-angle', C[0], 172, 28, 28, { strokeColor: '#2f9e44', strokeWidth: 1.5 }));
  add(text(A[0] - 34, A[1] - 4, 'A', { fontSize: 30 }), text(B[0] + 10, B[1] - 4, 'B', { fontSize: 30 }), text(C[0] - 10, C[1] - 44, 'C', { fontSize: 30 }));
  add(text(ux + 8, uy - 6, 'O', { fontSize: 26, strokeColor: '#1971c2' }));
  add(text(ux - 300, uy - r - 70, 'Vẽ trung tuyến từ C: con trỏ tự hít vào trung điểm AB', { fontSize: 24, strokeColor: '#495057' }));
  zoomTo(ux - r - 20, uy - r - 80, ux + r + 20, uy + r + 20, 40, 1.4);
  // Start a segment at C and hover near the midpoint without releasing.
  app.setTool('line', { lineKind: 'segment' });
  app.setStyle({ strokeColor: '#e03131', strokeWidth: 2.5, endHead: 'none' });
  const s = S(C);
  ev('pointerdown', s);
  const target = S([7, 194]);
  for (let i = 1; i <= 12; i++) { ev('pointermove', [s[0] + ((target[0] - s[0]) * i) / 12, s[1] + ((target[1] - s[1]) * i) / 12]); await sleep(16); }
  await ready(600);
})();
