// 01 · Overview: one infinite page mixing notes, math, geometry, a mind map, a PDF and an image.
(async () => {
  await boot();
  const hl = pen([[56, 92], [420, 92]], { highlighter: true, strokeColor: '#ffd43b', strokeWidth: 3 });
  add(hl);
  add(text(60, 40, 'Ghi chú tuần 45', { font: 'arial', fontSize: 44 }));
  add(text(62, 112, 'Phương trình bậc hai — ôn trước thứ Năm', { fontSize: 26 }));
  await formula('x = \\dfrac{-b \\pm \\sqrt{\\Delta}}{2a}', 250, 215, 34);
  add(text(62, 268, 'Δ > 0 → 2 nghiệm · Δ = 0 → nghiệm kép · Δ < 0 → vô nghiệm', { fontSize: 22, strokeColor: '#495057' }));

  // Geometry: triangle with a snapped median.
  const A = [70, 640], B = [430, 640], C = [250, 360], M = [250, 640];
  add(line([A, B, C, A], { kind: 'polyline' }));
  add(line([C, M], { strokeColor: '#e03131', strokeStyle: 'dashed' }));
  add(text(42, 640, 'A', { fontSize: 26 }), text(440, 640, 'B', { fontSize: 26 }), text(240, 322, 'C', { fontSize: 26 }), text(256, 646, 'M', { fontSize: 26, strokeColor: '#e03131' }));
  add(text(262, 584, 'trung tuyến', { fontSize: 20, strokeColor: '#e03131' }));

  // Small mind map.
  const st = style();
  let root = MM.centralTopic(st, [640, 150]);
  root = E.withLabel(E.updateElement(root, { fillColor: '#d0ebff', fillStyle: 'solid', strokeColor: '#1971c2', fontSize: 22 }), 'Dự án cuối kỳ');
  let els = [...app.elements, root];
  for (const k of ['Ý tưởng', 'Phác thảo', 'Ra mắt']) {
    const r = MM.addChild(els, els.find((e) => e.id === root.id), st, k);
    els = r.elements.map((e) => (e.id === r.node.id ? E.withLabel(E.updateElement(e, { strokeColor: '#1971c2' }), k) : e.type === 'line' && e.endBinding === r.node.id ? E.updateElement(e, { strokeColor: '#1971c2' }) : e));
  }
  app.setElements(window.__connectors.reflowConnectors(els));

  // PDF with a handwritten note on it.
  const pdf = await app.insertFile('bao-cao-quy-3.pdf', 'application/pdf', makePdf([
    reportPage('Report Q3', 'Revenue by month (million VND)', [60, 95, 80, 150]),
    reportPage('Report Q3', 'Costs', [40, 55, 70, 65]),
  ]), [1080, 470]);
  if (pdf) {
    const cur = app.byId(pdf.id);
    const next = E.updateElement(cur, { x: 900, y: 300, w: 360, h: 430, annotations: [
      { id: 'a1', color: '#e03131', size: 0.012, points: Array.from({ length: 40 }, (_, i) => { const t = (i / 39) * Math.PI * 2; return [0.78 + Math.cos(t) * 0.1, 0.84 + Math.sin(t) * 0.17, 0.5]; }) },
    ] });
    app.replaceElements(new Map([[next.id, next]]));
    add(text(1120, 262, 'tăng 60%?', { fontSize: 24, strokeColor: '#e03131' }));
  }
  // Photo of a whiteboard (generated).
  const png = await makePng(520, 320, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#e9ecef'); gr.addColorStop(1, '#ced4da');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1971c2'; g.lineWidth = 6; g.beginPath(); g.moveTo(60, 230); g.bezierCurveTo(160, 60, 300, 300, 460, 90); g.stroke();
    g.fillStyle = '#343a40'; g.font = 'bold 34px Arial'; g.fillText('y = ax² + bx + c', 40, 70);
  });
  const img = await app.insertFile('bang-trang.png', 'image/png', png, [640, 560]);
  if (img) { const c = app.byId(img.id); app.replaceElements(new Map([[c.id, E.updateElement(c, { x: 520, y: 470, w: 300, h: 185 })]])); }
  add(text(530, 668, 'ảnh chụp bảng hôm thứ Ba', { fontSize: 20, strokeColor: '#868e96' }));
  add(shape('star', 820, 40, 70, 70, { fillColor: '#ffec99', fillStyle: 'solid' }));
  app.select([]);
  app.setTool('select');
  zoomTo(30, 20, 1280, 720);
  await ready(1500);
})();
