(function () {
  'use strict';

  var S = [document.getElementById('s1'), document.getElementById('s2'), document.getElementById('s3')];
  var hint = document.getElementById('hint');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- dissolve bands ----------
     Each scene reveals over one span of scroll progress and conceals over
     another. The bands are laid out so a scene has finished concealing before
     the next one starts revealing — they never overlap. */

  var BAND = [
    { in: null,         out: [0.14, 0.26] }, // s1 fades up on the intro clock
    { in: [0.28, 0.42], out: [0.56, 0.68] },
    { in: [0.70, 0.86], out: null }
  ];

  function ramp(g, a, b) { var t = (g - a) / (b - a); return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

  /* ---------- one rAF loop, parked when nothing is moving ---------- */

  var P = [
    ['.s1 .txt', -26], ['.s1 .flw.cone', -70],
    ['.s2 .txt', -26], ['.s2 .flw.gold', -80], ['.s2 .flw.pops', 24],
    ['.s3 .txt', -20], ['.s3 .flw.corner', -60],
    ['#greens', 26]
  ].map(function (p) { return [document.querySelector(p[0]), p[1]]; });

  var raf = 0, last = -1, idle = 0, span = 0;
  var intro = 0, introStart = 0, INTRO = 800; // quick first reveal, text up fast
  var shown = [-1, -1, -1];

  function measure() { span = document.documentElement.scrollHeight - innerHeight; }

  function paint(el, i, t) {
    if (t === shown[i]) return;
    shown[i] = t;
    el.classList.toggle('on', t > 0);
    el.classList.toggle('full', t >= 1);
    if (t > 0 && t < 1) {
      var p = '0 ' + (t * 100).toFixed(1) + '%';
      el.style.maskPosition = el.style.webkitMaskPosition = p;
    }
  }

  function render(g) {
    for (var i = 0; i < P.length; i++) P[i][0].style.translate = '0 ' + (g * P[i][1]).toFixed(1) + 'px';
    for (var j = 0; j < 3; j++) {
      var b = BAND[j];
      var t = b.in ? ramp(g, b.in[0], b.in[1]) : intro;
      if (b.out) t = Math.min(t, 1 - ramp(g, b.out[0], b.out[1]));
      paint(S[j], j, t);
    }
    S[2].classList.toggle('live', shown[2] > 0.9);
    hint.classList.toggle('gone', g > 0.04);
  }

  function frame(ts) {
    if (intro < 1) {
      if (!introStart) introStart = ts;
      intro = Math.min(1, (ts - introStart) / INTRO);
    }
    var g = span > 0 ? scrollY / span : 0;
    if (g === last && intro >= 1) {
      if (++idle > 12) { raf = 0; return; } // nothing moved for ~200ms, stand down
    } else {
      idle = 0; last = g; render(g);
    }
    raf = requestAnimationFrame(frame);
  }

  function wake() { if (!raf) raf = requestAnimationFrame(frame); }

  if (reduce) {
    // static fallback: land on the final scene, fully visible
    S[0].style.display = S[1].style.display = 'none';
    S[0].classList.remove('on');
    S[2].classList.add('on', 'full', 'live');
    document.getElementById('runway').style.height = '100lvh';
    hint.style.display = 'none';
  } else {
    measure();
    addEventListener('scroll', wake, { passive: true });
    // A collapsing mobile URL bar fires resize with a height-only change. Acting
    // on it would move the scroll span under us and jump the dissolves, so only
    // a real width change counts as a relayout.
    var w = innerWidth;
    addEventListener('resize', function () {
      if (innerWidth === w) return;
      w = innerWidth; measure(); last = -1; wake();
    }, { passive: true });
    wake();
  }

  /* ---------- waitlist ---------- */

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbyGgCW6eR32vagQ_wJfLgWDfPM1x5XkWVj8OUvAMXrpTFuvzOehOiLA4VbcCGn2Z4p7/exec';
  var em = document.getElementById('em'), fz = document.getElementById('formzone');

  document.getElementById('form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!em.value || (em.validity && !em.validity.valid)) { em.focus(); return; }
    fetch(ENDPOINT, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ email: em.value })
    }).catch(function () {});
    fz.classList.add('sent');
  });
})();
