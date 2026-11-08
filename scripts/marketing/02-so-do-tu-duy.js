// 02 · Mind map (XMind-style): colored branches, borderless subtopics, balanced layout.
(async () => {
  await boot();
  const { els } = buildMindmap(false);
  app.setElements(els);
  const [x0, y0, x1, y1] = boundsOf(app.elements);
  zoomTo(x0, y0, x1, y1, 40, 1.35);
  await ready();
})();
