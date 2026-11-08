// 04 · Shape library: 63 flat shapes, sketchy or smooth, hatched / cross-hatched / solid fills.
(async () => {
  await boot();
  const W = app.renderer.width;
  const picks = [
    ['hexagon', '#a5d8ff', 'hachure'], ['star', '#ffec99', 'solid'], ['heart', '#ffc9c9', 'cross-hatch'], ['cloud', '#e9ecef', 'solid'],
    ['callout-round', '#d0bfff', 'hachure'], ['tri-eq', '#b2f2bb', 'solid'], ['trapezoid', '#ffd8a8', 'hachure'], ['arrow-right', '#a5d8ff', 'solid'],
    ['fc-decision', '#ffec99', 'cross-hatch'], ['fc-database', 'transparent', 'solid'], ['pentagon', '#ffc9c9', 'solid'], ['ring', '#b2f2bb', 'hachure'],
    ['cross', '#d0bfff', 'solid'], ['kite', '#ffd8a8', 'cross-hatch'], ['sector', '#a5d8ff', 'hachure'], ['ribbon', '#ffec99', 'solid'],
    ['star8', '#ffc9c9', 'hachure'], ['parallelogram', '#e9ecef', 'cross-hatch'], ['axes', 'transparent', 'solid'], ['sine', 'transparent', 'solid'],
  ];
  const strokes = ['#1971c2', '#f08c00', '#e03131', '#495057', '#7048e8', '#2f9e44', '#e8590c', '#1971c2', '#f08c00', '#0a0a0a',
    '#e03131', '#2f9e44', '#7048e8', '#e8590c', '#1971c2', '#f08c00', '#e03131', '#495057', '#0a0a0a', '#1971c2'];
  const x0 = W - 520, y0 = 150, cell = 122;
  picks.forEach(([id, fill, fs], i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const sq = ['star', 'heart', 'ring', 'cross', 'star8', 'hexagon', 'pentagon', 'tri-eq'].includes(id);
    add(shape(id, x0 + col * cell, y0 + row * cell, sq ? 90 : 100, sq ? 90 : 76, { fillColor: fill, fillStyle: fs, strokeColor: strokes[i], strokeWidth: 2, params: id === 'star' ? { points: 5, inner: 0.45 } : {} }));
  });
  app.state.shapeId = 'hexagon';
  app.emit('tool');
  await sleep(200);
  document.querySelector('[data-tool="shape"]').click();
  await sleep(300);
  const search = document.querySelector('.popover .search input');
  if (search) search.blur();
  const hint = document.querySelector('.hint');
  if (hint) hint.style.visibility = 'hidden'; // it would peek out behind the popover
  await ready();
})();
