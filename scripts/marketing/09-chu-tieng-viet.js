// 09 · Vietnamese text: Patrick Hand (handwriting) and Arial, every diacritic in place.
(async () => {
  await boot();
  add(text(0, 0, 'VIẾT TAY · PATRICK HAND', { font: 'arial', fontSize: 16, strokeColor: '#868e96' }));
  const hand = add(text(0, 30, 'Đường đời đẹp đẽ, ước mơ xa', { fontSize: 54 }));
  add(text(0, 108, 'Ừ, ỡ, ặ, ữ, ộ, ợ, ỷ — Phương trình có Δ ≥ 0', { fontSize: 34, strokeColor: '#495057' }));
  add(text(0, 210, 'CHỮ IN · ARIAL', { font: 'arial', fontSize: 16, strokeColor: '#868e96' }));
  add(text(0, 240, 'Đường đời đẹp đẽ, ước mơ xa', { font: 'arial', fontSize: 50 }));
  add(text(0, 314, 'Ừ, ỡ, ặ, ữ, ộ, ợ, ỷ — Phương trình có Δ ≥ 0', { font: 'arial', fontSize: 30, strokeColor: '#495057' }));
  add(text(0, 410, 'Gõ  >=  thành  ≥   ·   gõ  \\delta  rồi dấu cách thành  δ', { fontSize: 26, strokeColor: '#1971c2' }));
  zoomTo(-10, -10, 760, 450, 300, 1.25);
  app.select([hand.id]);
  await ready();
})();
