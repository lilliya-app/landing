(function () {
  'use strict';

  var S = [document.getElementById('s1'), document.getElementById('s2'), document.getElementById('s3')];
  var hint = document.getElementById('hint');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- dissolve bands ----------
     Each scene reveals over one span of scroll progress and conceals over
     another. Strictly sequential: the cover canvas can only paint one noise
     pattern at a time, so a scene must finish concealing before the next
     starts revealing. Between the two, the canvas holds a full cover. */

  var BAND = [
    { in: null,         out: [0.14, 0.32] }, // s1 fades up on the intro clock
    { in: [0.34, 0.52], out: [0.58, 0.74] },
    { in: [0.76, 0.90], out: null }
  ];

  function ramp(g, a, b) { var t = (g - a) / (b - a); return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

  /* Ease-out for the intro: lands quickly, settles gently. */
  function easeOut(x) { return 1 - Math.pow(1 - x, 1.5); }

  /* ---------- one rAF loop, parked when nothing is moving ---------- */

  var P = [
    ['.s1 .txt', -26], ['.s1 .flw.cone', -70],
    ['.s2 .txt', -26], ['.s2 .flw.gold', -80], ['.s2 .flw.pops', 24],
    ['.s3 .txt', -20], ['.s3 .flw.corner', -60],
    ['#greens', 26]
  ].map(function (p) { return [document.querySelector(p[0]), p[1]]; });

  var raf = 0, last = -1, idle = 0, span = 0;
  var intro = 0, introStart = 0, INTRO = 950; // unhurried first reveal; continuous shader, so duration costs no smoothness
  var gb = { x: 0, w: 0, h: 0 }; // one greens img box in CSS px, for the shader

  function measure() {
    span = document.documentElement.scrollHeight - innerHeight;
    var r = document.querySelector('#greens img').getBoundingClientRect();
    gb.x = r.left; gb.w = r.width; gb.h = r.height;
  }

  /* ---------- dissolve cover (WebGL) ----------
     A fragment shader can't mask DOM, so the problem is inverted: the scene
     renders un-masked and the #dis canvas above it paints the true page
     background — paper with the greens strip composited in at its real DOM
     position — wherever the dissolve says "hidden". The threshold replicates
     the old feTurbulence look, alpha = 1 - clamp(14*(fbm - level) + 0.5),
     over fBm of the tileable assets/perlin.jpg at coprime scales 3/7/13 so
     nothing repeats. level is continuous, so the reveal is smooth at any
     frame rate; a frame costs four texture taps per pixel and nothing on the
     main thread. Off-transition the canvas is hidden and costs nothing. */

  var canvas = document.getElementById('dis');
  var gl = null, texReady = false, lut = null, dpr = 1, up = {}, coverOn = false, wasCss = false;

  // per-scene octave offsets: three decorrelated patterns, like the old
  // three feTurbulence seeds
  var VART = [
    [0.13, 0.71, 0.52, 0.08, 0.33, 0.29],
    [0.62, 0.24, 0.11, 0.83, 0.74, 0.51],
    [0.41, 0.93, 0.87, 0.37, 0.19, 0.58]
  ];

  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;',
    '#else', 'precision mediump float;', '#endif',
    'uniform sampler2D N;',              // perlin
    'uniform sampler2D G;',              // greens
    'uniform float vmax;',
    'uniform float level;',
    'uniform vec2 o1;',                  // per-scene octave offsets
    'uniform vec2 o2;',
    'uniform vec2 o3;',
    'uniform vec4 gbox;',                // greens: x0, y0 bottom, w, h (device px, y up)
    'void main(){',
    ' vec2 p=gl_FragCoord.xy/vmax;',     // square units: blobs stay round on any aspect
    ' float n=(texture2D(N,p*3.0+o1).r',
    '         +texture2D(N,p*7.0+o2).r*0.44',
    '         +texture2D(N,p*13.0+o3).r*0.22)/1.66;',
    ' float a=1.0-clamp(14.0*(n-level)+0.5,0.0,1.0);',
    ' vec3 bg=vec3(0.9686,0.9569,0.9176);', // #F7F4EA paper
    ' vec2 q=(gl_FragCoord.xy-gbox.xy)/gbox.zw;', // 0..2 across the two imgs
    ' if(q.y>=0.0 && q.y<=1.0 && q.x>=0.0 && q.x<=2.0){',
    '  float u=q.x; if(u>1.0){u=2.0-u;}', // 2nd img is scaleX(-1)
    '  vec4 gr=texture2D(G,vec2(u,1.0-q.y));',
    '  bg=mix(bg,gr.rgb,gr.a*0.45);',    // .greens{opacity:.45}
    ' }',
    ' gl_FragColor=vec4(bg*a,a);',       // premultiplied
    '}'
  ].join('\n');

  function initGL() {
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    } catch (e) { gl = null; }
    if (!gl) return;
    function sh(type, src) {
      var x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) {
        console.error('[dis] shader failed, using opacity fades:', gl.getShaderInfoLog(x));
        return null;
      }
      return x;
    }
    var vs = sh(gl.VERTEX_SHADER, 'attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}');
    var fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { gl = null; return; }
    var pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      console.error('[dis] link failed, using opacity fades:', gl.getProgramInfoLog(pr));
      gl = null; return;
    }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(pr, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    ['N', 'G', 'vmax', 'level', 'o1', 'o2', 'o3', 'gbox'].forEach(function (n) { up[n] = gl.getUniformLocation(pr, n); });
    gl.uniform1i(up.N, 0);
    gl.uniform1i(up.G, 1);
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      gl = null; showCover(false); wake(); // opacity fallback takes over
    });
    sizeCanvas();
  }

  function sizeCanvas() {
    if (!gl) return;
    dpr = Math.min(devicePixelRatio || 1, 2);
    var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(up.vmax, Math.max(w, h));
  }

  function texture(img, unit, repeat, raw) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    // raw = data texture: skip the browser's colorspace conversion. Safari maps
    // a profile-less grayscale JPEG through gray->sRGB gamma on upload, which
    // lifted the whole noise field above the threshold (mean 0.44 -> 0.90) and
    // reduced every dissolve to a hard cut. Verified: with conversion off both
    // engines sample identical values, matching the 2D-canvas LUT readback.
    if (raw) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (raw) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    var w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE; // greens is NPOT: clamp, no mips
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, repeat ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    if (repeat) gl.generateMipmap(gl.TEXTURE_2D);
  }

  /* Quantile table so level steps the *revealed area* linearly. Sweeping the
     threshold level linearly instead spends most of its span in the tails of
     the noise distribution, where almost no pixel flips and the dissolve
     visibly stalls at both ends. */
  function buildLut(img) {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0, 128, 128);
    var d = x.getImageData(0, 0, 128, 128).data;
    var n = new Float32Array(16384);
    for (var y = 0; y < 128; y++) {
      for (var i = 0; i < 128; i++) {
        n[y * 128 + i] = (d[(((y * 3) & 127) * 128 + ((i * 3) & 127)) << 2]
                  + .44 * d[(((y * 7) & 127) * 128 + ((i * 7) & 127)) << 2]
                  + .22 * d[(((y * 13) & 127) * 128 + ((i * 13) & 127)) << 2]) / (1.66 * 255);
      }
    }
    n.sort();
    lut = new Float32Array(64);
    for (var k = 0; k < 64; k++) lut[k] = n[Math.round(k * 16383 / 63)];
  }

  // hidden fraction (0 = fully revealed, 1 = full cover) -> threshold level.
  // Cover is transparent where n > level, so P(n > level) must equal the
  // revealed fraction: level = quantile(hidden), exactly as the sheet baker did.
  function level(hidden) {
    var f = Math.min(Math.max(hidden, 0), 1) * 63, i = f | 0;
    return i >= 63 ? lut[63] : lut[i] + (lut[i + 1] - lut[i]) * (f - i);
  }

  function loadAssets() {
    var pi = new Image(), gi = new Image(), left = 2;
    function done() {
      if (--left || !gl) return;
      try {
        buildLut(pi);       // throws on file:// (tainted canvas) — fall back
        texture(pi, 0, true, true); // perlin is data — see texture()
        texture(gi, 1, false);      // greens is color — must match the DOM img
        texReady = true;
      } catch (e) { fail(e); return; }
      wake();
    }
    function fail(e) {
      console.error('[dis] texture setup failed, using opacity fades:', e || 'image load error');
      gl = null; showCover(false); wake();
    }
    pi.onload = done; gi.onload = done;
    pi.onerror = gi.onerror = fail;
    pi.src = 'assets/perlin.jpg';
    gi.src = 'assets/greens.webp'; // cache hit: same URL as the DOM imgs
  }

  function showCover(on) {
    if (on === coverOn) return;
    coverOn = on;
    canvas.style.visibility = on ? 'visible' : 'hidden';
  }

  function draw(lv, v, g) {
    var o = VART[v];
    gl.uniform1f(up.level, lv);
    gl.uniform2f(up.o1, o[0], o[1]);
    gl.uniform2f(up.o2, o[2], o[3]);
    gl.uniform2f(up.o3, o[4], o[5]);
    // greens box in device px, y up from the canvas bottom; the strip is
    // bottom-aligned to the viewport, so only the g*26px parallax moves it
    gl.uniform4f(up.gbox, gb.x * dpr, -g * 26 * dpr, gb.w * dpr, gb.h * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render(g) {
    for (var i = 0; i < P.length; i++) P[i][0].style.translate = '0 ' + (g * P[i][1]).toFixed(1) + 'px';
    var useGL = gl && texReady;
    var full = false, act = -1, ta = 0, T = [0, 0, 0];
    for (var j = 0; j < 3; j++) {
      var b = BAND[j];
      var t = b.in ? ramp(g, b.in[0], b.in[1]) : easeOut(intro);
      if (b.out) t = Math.min(t, 1 - ramp(g, b.out[0], b.out[1]));
      T[j] = t;
      if (t >= 1) full = true;
      else if (t > 0) { act = j; ta = t; }
      S[j].classList.toggle('on', t > 0);
      if (!useGL) S[j].style.opacity = t <= 0 ? '0' : t >= 1 ? '1' : t.toFixed(3);
    }
    if (useGL) {
      if (wasCss) { // GL came up mid-fallback: hand the reveal back to the shader
        wasCss = false;
        for (var k = 0; k < 3; k++) S[k].style.opacity = '';
      }
      if (full) showCover(false); // a scene has settled: zero compositing cost
      else {
        showCover(true); // mid-dissolve, or the full-cover corridor between two
        draw(act < 0 ? 2 : level(1 - ta), act < 0 ? 0 : act, g);
      }
    } else {
      wasCss = true;
      showCover(false); // no GL: plain opacity fade, driven above
    }
    S[2].classList.toggle('live', T[2] > 0.85);
    hint.classList.toggle('gone', g > 0.04);
  }

  function frame(ts) {
    // the intro clock waits for the shader's textures, so the first reveal
    // can't outrun the decode (with no GL the opacity fallback runs it)
    if ((texReady || !gl) && intro < 1) {
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
    S[2].classList.add('on', 'live');
    document.getElementById('runway').style.height = '100lvh';
    hint.style.display = 'none';
  } else {
    measure();
    initGL();
    if (gl) loadAssets();
    addEventListener('scroll', wake, { passive: true });
    // A collapsing mobile URL bar fires resize with a height-only change. Acting
    // on it would move the scroll span under us and jump the dissolves, so only
    // a real width change counts as a relayout.
    var w = innerWidth;
    addEventListener('resize', function () {
      if (innerWidth === w) return;
      w = innerWidth; measure(); sizeCanvas(); last = -1; wake();
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
