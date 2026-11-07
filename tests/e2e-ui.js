// UI smoke test: opens the shape library and the formula editor for a visual check.
//   dist\Synto.exe --dev app --script tests\e2e-ui.js --data build\test-profile
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !(window.synto && document.querySelector('[data-tool="shape"]')); i++) await sleep(50);
  await sleep(600);
  const step = new URLSearchParams(location.search).get('step') || 'shapes';
  if (step === 'shapes' || !location.search) {
    document.querySelector('[data-tool="shape"]').click();
  }
  await sleep(400);
  window.__openMath = () => {
    document.querySelector('.popover') && document.body.click();
    document.querySelector('[data-tool="math"]').click();
    setTimeout(() => {
      const ta = document.querySelector('.math-input');
      ta.value = 'x = (-b +- sqrt(delta)) / 2a';
      ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }, 200);
  };
  // After 4 s switch to the formula editor so both can be captured.
  setTimeout(() => {
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.__openMath();
  }, 4000);
})();
