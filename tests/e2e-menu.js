// Opens the main menu for a visual check.
//   dist\Synto.exe --dev app --script tests\e2e-menu.js --data build\test-profile
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !document.querySelector('.top-l .tb'); i++) await sleep(50);
  await sleep(600);
  document.querySelector('.top-l .tb').click();
})();
