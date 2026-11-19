// The loading screen, drawn before the app (and its look) has loaded: it uses the picture, size, motion and colour that
// this device saw last time (Studio → Look and feel → Sign-in page → After signing in), so a custom logo shows at once.
(function () {
  // TVs: lay the page out at a computer-like width (Studio → Look and feel → TVs), so nothing looks oversized.
  try {
    if (/AFT|Android TV|GoogleTV|BRAVIA|SmartTV|Tizen|Web0S/i.test(navigator.userAgent) || /[?&]tv\b/.test(location.search)) {
      var w = +localStorage.getItem('hf_tvw') || 1600;
      var m = document.querySelector('meta[name=viewport]');
      if (m && w > 0) m.setAttribute('content', 'width=' + w + ', viewport-fit=cover');
    }
  } catch (e) { /* the usual layout */ }
  try {
    var s = JSON.parse(localStorage.getItem('hf_splash') || 'null');
    var box = document.querySelector('.splash'), img = box && box.querySelector('img');
    if (!s || !img) return;
    if (s.img) img.src = s.img;
    if (s.size) img.style.width = 'min(' + Math.round(46 * s.size) + 'vw, ' + Math.round(320 * s.size) + 'px)';
    if (s.motion) box.setAttribute('data-motion', s.motion);
    if (s.bg) document.documentElement.style.background = document.body.style.background = s.bg;
  } catch (e) { /* first visit or private mode: the usual logo */ }
})();
