// 06 · PDF on the canvas: zoomable, scrollable, annotated; a callout box connected to it.
(async () => {
  await boot();
  const pdf = await app.insertFile('bao-cao-quy-3.pdf', 'application/pdf', makePdf([
    reportPage('Report Q3', 'Revenue by month (million VND)', [60, 95, 80, 150]),
    reportPage('Report Q3', 'Costs by department', [40, 55, 70, 65]),
    reportPage('Report Q3', 'Forecast Q4', [90, 110, 130, 170]),
  ]), [0, 0]);
  if (!pdf) return;
  let cur = app.byId(pdf.id);
  cur = E.updateElement(cur, { x: 0, y: 0, w: 470, h: 600, annotations: [
    { id: 'c', color: '#e03131', size: 0.009, points: Array.from({ length: 48 }, (_, i) => { const t = (i / 47) * Math.PI * 2.1; return [0.77 + Math.cos(t) * 0.11, 0.86 + Math.sin(t) * 0.2, 0.5]; }) },
    { id: 'u', color: '#1971c2', size: 0.007, points: Array.from({ length: 30 }, (_, i) => [0.05 + i * 0.026, 0.235 + Math.sin(i / 3) * 0.004, 0.5]) },
  ] });
  app.replaceElements(new Map([[cur.id, cur]]));
  // Callout connected to the PDF with a bound arrow.
  let note = labelBox('callout-round', 600, 60, 'Doanh thu tháng 9\ntăng 60% — kiểm tra lại', { fillColor: '#fff3bf', fillStyle: 'solid', strokeColor: '#f08c00', fontSize: 22, topic: false });
  note = E.withLabel(E.updateElement(note, { w: 300, h: 150 }), note.label);
  add(note);
  const arrow = E.updateElement(line([[note.x + 40, note.y + 120], [380, 470]], { strokeColor: '#f08c00', endHead: 'arrow', strokeWidth: 2.5 }), { startBinding: note.id, endBinding: cur.id });
  app.setElements(window.__connectors.reflowConnectors([...app.elements, arrow]));
  add(text(600, 280, 'PDF nằm ngay trên mặt giấy:', { fontSize: 24 }));
  add(text(600, 318, '• cuộn từng trang trong khung', { fontSize: 22, strokeColor: '#495057' }));
  add(text(600, 352, '• thu phóng vẫn sắc nét', { fontSize: 22, strokeColor: '#495057' }));
  add(text(600, 386, '• vẽ chú thích đè lên trang', { fontSize: 22, strokeColor: '#495057' }));
  app.select([pdf.id]);
  zoomTo(-10, -20, 920, 620, 280, 1.2);
  await ready(2200);
})();
