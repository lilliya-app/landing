(function () {
  'use strict';

  var S = [document.getElementById('s1'), document.getElementById('s2'), document.getElementById('s3')];
  var hint = document.getElementById('hint');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- scene triggers ----------
     Scroll progress only decides WHICH scene should be on screen. The reveal
     itself is a CSS animation with a fixed duration, so pausing mid-scroll can
     never strand a scene half-dissolved. */

  var EDGE = [0.30, 0.65], HYST = 0.03;
  var cur = 0; // s1 ships with .in already on it, so it reveals at first paint

  function sceneAt(g) {
    var n = g >= EDGE[1] ? 2 : g >= EDGE[0] ? 1 : 0;
    if (n === cur) return cur;
    // only commit once we are clear of the boundary being crossed
    return Math.abs(g - EDGE[Math.min(n, cur)]) > HYST ? n : cur;
  }

  var CONCEAL = 700; // keep in sync with .scene.out in the stylesheet

  function show(n) {
    if (n === cur) return;
    var prev = S[cur], next = S[n];
    prev.classList.remove('in', 'settled', 'live');
    next.classList.remove('out', 'settled');
    void prev.offsetWidth; // restart animations on scenes we have played before
    prev.classList.add('out');
    // the incoming scene waits out the outgoing one — the two never overlap.
    // animation-fill-mode:both holds it fully masked for the duration of the delay.
    next.style.animationDelay = CONCEAL + 'ms';
    next.classList.add('in');
    cur = n;
  }

  S.forEach(function (el) {
    el.addEventListener('animationend', function (e) {
      if (e.target !== el) return; // ignore the flowers' sway animations
      if (el.classList.contains('in')) el.classList.add('settled', 'live');
      else el.classList.remove('out');
    });
  });

  /* ---------- one rAF loop, parked when nothing is moving ---------- */

  var P = [
    ['.s1 .txt', -26], ['.s1 .flw.cone', -70],
    ['.s2 .txt', -26], ['.s2 .flw.gold', -80], ['.s2 .flw.pops', 24],
    ['.s3 .txt', -20], ['.s3 .flw.corner', -60],
    ['#greens', 26]
  ].map(function (p) { return [document.querySelector(p[0]), p[1]]; });

  var raf = 0, last = -1, idle = 0, span = 0;

  function measure() { span = document.documentElement.scrollHeight - innerHeight; }

  function frame() {
    var g = span > 0 ? scrollY / span : 0;
    if (g === last) {
      if (++idle > 12) { raf = 0; return; } // nothing moved for ~200ms, stand down
    } else {
      idle = 0; last = g;
      for (var i = 0; i < P.length; i++) P[i][0].style.translate = '0 ' + (g * P[i][1]).toFixed(1) + 'px';
      show(sceneAt(g));
      hint.classList.toggle('gone', g > 0.04);
    }
    raf = requestAnimationFrame(frame);
  }

  function wake() { if (!raf) raf = requestAnimationFrame(frame); }

  if (reduce) {
    // static fallback: land on the final scene, fully visible
    S[0].style.display = S[1].style.display = 'none';
    S[0].classList.remove('in');
    S[2].classList.add('in', 'settled', 'live');
    document.getElementById('runway').style.height = '100lvh';
    hint.style.display = 'none';
  } else {
    measure();
    addEventListener('scroll', wake, { passive: true });
    // A collapsing mobile URL bar fires resize with a height-only change. Acting
    // on it would move the scroll span under us and jitter the triggers, so only
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
