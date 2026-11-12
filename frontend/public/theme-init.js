// Applies the saved theme before the app renders, so the page never flashes the wrong colours.
// A separate file (not inline) so the strict Content-Security-Policy still blocks inline scripts.
(function () {
  try {
    var choice = localStorage.getItem('op-theme');
    if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
  } catch (e) {
    // Storage blocked: follow the device theme.
  }
})();
