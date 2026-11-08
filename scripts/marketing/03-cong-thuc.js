// 03 · Math: formulas as canvas objects + the formula editor with quick typing and live preview.
(async () => {
  await boot();
  const W = app.renderer.width;
  const L = 175, R = W - 165;
  await formula('\\int_0^1 x^2\\,dx = \\dfrac{1}{3}', L, 230, 30, '#1971c2');
  await formula('\\lim_{x \\to 0} \\dfrac{\\sin x}{x} = 1', L, 400, 30, '#2f9e44');
  await formula('\\sum_{k=1}^{n} k = \\dfrac{n(n+1)}{2}', L, 570, 28, '#e03131');
  await formula('\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}', R, 230, 30, '#7048e8');
  await formula('\\begin{cases} x + y = 5 \\\\ x - y = 1 \\end{cases}', R, 400, 30, '#f08c00');
  await formula('e^{i\\pi} + 1 = 0', R, 570, 34, '#0a0a0a');
  app.select([]);
  app.setTool('math');
  app.emit({ type: 'open-math', point: [W / 2, 300] });
  await sleep(300);
  const ta = document.querySelector('.math-input');
  ta.value = 'x = (-b +- sqrt(Delta)) / 2a';
  ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
  ta.blur();
  await ready(900);
})();
