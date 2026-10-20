/* Sets the colour theme before first paint (no inline scripts: strict CSP). */
(function () {
  var t = null;
  try { t = localStorage.getItem('talo-theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
