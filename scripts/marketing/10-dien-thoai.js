// 10 · Narrow window / phone layout: toolbar at the bottom, the logo always visible.
(async () => {
  await boot();
  const { els } = buildMindmap(true);
  app.setElements(els);
  const [x0, y0, x1, y1] = boundsOf(app.elements);
  zoomTo(x0, y0, x1, y1, 16, 1.2);
  await ready();
})();
