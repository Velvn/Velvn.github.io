/* 1-bit dithering engine for the portfolio — Bayer 8x8 (ordered) + Atkinson (error diffusion). No dependencies. */
(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers ---------- */
  const BAYER = [
     0,48,12,60, 3,51,15,63, 32,16,44,28,35,19,47,31,  8,56, 4,52,11,59, 7,55, 40,24,36,20,43,27,39,23,
     2,50,14,62, 1,49,13,61, 34,18,46,30,33,17,45,29, 10,58, 6,54, 9,57, 5,53, 42,26,38,22,41,25,37,21
  ].map(v => (v + 0.5) / 64);

  function hexToRgb(h) {
    h = h.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Tritone: level 0 = midnight (background), 1 = deep azure, 2 = coral rose
  let TONES, DARK = true;
  function readColors() {
    const cs = getComputedStyle(root);
    TONES = [cs.getPropertyValue('--midnight'), cs.getPropertyValue('--azure'), cs.getPropertyValue('--coral')].map(hexToRgb);
  }

  function sizeCanvas(c, scale, minW = 8, minH = 4) {
    const r = c.getBoundingClientRect();
    const w = Math.max(minW, Math.round(r.width / scale));
    const h = Math.max(minH, Math.round(r.height / scale));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return [w, h];
  }

  /** Tritone ordered dither: density 0..1 is split into two bands
   *  (midnight→azure, azure→coral); the Bayer threshold picks between neighbouring tones.
   *  Level 0 stays transparent so the page background shows through. */
  function bayerPaint(ctx, w, h, density) {
    const img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      const by = (y & 7) << 3;
      for (let x = 0; x < w; x++) {
        const v = Math.min(1, density(x, y)) * 2;
        if (v <= 0) continue;
        let lvl = Math.floor(v);
        if (v - lvl > BAYER[by + (x & 7)]) lvl++;
        if (lvl > 0) {
          const c = TONES[Math.min(2, lvl)], i = (y * w + x) << 2;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Atkinson error diffusion quantised to the three tones (0, .5, 1). */
  function atkinsonPaint(ctx, w, h, gray, bias = 0) {
    const g = Float32Array.from(gray);
    const img = ctx.createImageData(w, h), d = img.data;
    const spread = (x, y, e) => { if (x >= 0 && x < w && y < h) g[y * w + x] += e; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, old = g[i] + bias;
      const lvl = Math.max(0, Math.min(2, Math.round(old * 2))), err = (old - lvl / 2) / 8;
      spread(x + 1, y, err); spread(x + 2, y, err); spread(x - 1, y + 1, err);
      spread(x, y + 1, err); spread(x + 1, y + 1, err); spread(x, y + 2, err);
      const p = i << 2, c = TONES[lvl];
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* cheap 3D value noise */
  const hash = (x, y, z) => { let n = x * 374761393 + y * 668265263 + z * 1274126177; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const fade = t => t * t * (3 - 2 * t);
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
    return l(l(l(c(0,0,0), c(1,0,0), xf), l(c(0,1,0), c(1,1,0), xf), yf),
             l(l(c(0,0,1), c(1,0,1), xf), l(c(0,1,1), c(1,1,1), xf), yf), zf);
  }
  const fbm = (x, y, z) => noise3(x, y, z) * 0.65 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.35;

  /* ---------- HERO GLOBE ---------- */
  const globe = document.getElementById('globe');
  const gctx = globe.getContext('2d');
  let mouse = { x: -999, y: -999, tx: 0.35, ty: -0.25, lx: 0.35, ly: -0.25 };
  let gw = 0, gh = 0, angle = 0, globeVisible = true;

  globe.addEventListener('pointermove', e => {
    const r = globe.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width * gw;
    mouse.y = (e.clientY - r.top) / r.height * gh;
  });
  globe.addEventListener('pointerleave', () => { mouse.x = mouse.y = -999; });
  addEventListener('pointermove', e => {
    mouse.tx = (e.clientX / innerWidth - 0.5) * 1.4;
    mouse.ty = (e.clientY / innerHeight - 0.5) * 1.2;
  }, { passive: true });

  function drawGlobe() {
    [gw, gh] = sizeCanvas(globe, 3);
    const cx = gw / 2, cy = gh / 2, R = gw * 0.34;
    mouse.lx += (mouse.tx - mouse.lx) * 0.05; mouse.ly += (mouse.ty - mouse.ly) * 0.05;
    let L = [-mouse.lx - 0.4, -mouse.ly - 0.35, 0.85];
    const ln = Math.hypot(...L); L = L.map(v => v / ln);
    const tilt = -0.36, ct = Math.cos(tilt), st = Math.sin(tilt);
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const lensR = gw * 0.11;

    bayerPaint(gctx, gw, gh, (x, y) => {
      const nx = (x - cx) / R, ny = (y - cy) / R, d2 = nx * nx + ny * ny;
      // orbit ring (tilted ellipse), drawn in front of the sphere on its lower half
      const rx = nx * ct - ny * st, ry = nx * st + ny * ct;
      const e = (rx / 1.55) ** 2 + (ry / 0.3) ** 2;
      const onRing = Math.abs(e - 1) < 0.05;
      let lens = 0;
      if (mouse.x > -900) { const md = Math.hypot(x - mouse.x, y - mouse.y); if (md < lensR) lens = 1 - md / lensR; }

      if (d2 <= 1) {
        if (onRing && ry > 0) return 0.95;
        const nz = Math.sqrt(1 - d2);
        // rotate around Y for longitude spin
        const px = nx * cosA + nz * sinA, pz = -nx * sinA + nz * cosA;
        const land = fbm(px * 2.2 + 10, ny * 2.2, pz * 2.2) > 0.52;
        const lat = Math.asin(-ny), lon = Math.atan2(px, pz);
        const grid = Math.abs(Math.sin(lat * 6)) < 0.06 || Math.abs(Math.sin(lon * 6)) < 0.05;
        let lum = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        lum = 0.08 + 0.92 * lum;
        let dens = DARK ? lum * (land ? 1 : 0.5) : (1 - lum) * 0.85 + (land ? 0.32 : 0.04);
        if (grid) dens += DARK ? 0.18 : 0.14;
        dens += lens * 0.45;
        return Math.min(1, dens);
      }
      if (onRing) {
        // satellite marker travelling the ring
        const a = Math.atan2(ry / 0.3, rx / 1.55);
        return (Math.abs(((a - angle * 1.7) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.08) ? 1 : 0.55;
      }
      // soft atmosphere halo
      const d = Math.sqrt(d2);
      return d < 1.14 ? (1 - (d - 1) / 0.14) * 0.32 + lens * 0.2 : lens * 0.15;
    });
  }

  const gObs = new IntersectionObserver(([en]) => { globeVisible = en.isIntersecting; });
  gObs.observe(globe);
  let last = 0;
  function loop(t) {
    if (globeVisible && t - last > 33) { angle += 0.006; drawGlobe(); last = t; }
    requestAnimationFrame(loop);
  }

  /* ---------- SECTION STRIPS ---------- */
  function drawStrips() {
    document.querySelectorAll('.strip').forEach((c, k) => {
      const [w, h] = sizeCanvas(c, 2, 20, 6);
      const ctx = c.getContext('2d');
      bayerPaint(ctx, w, h, x => Math.pow(1 - x / w, 1.6) * 0.95 + (k % 2 ? 0.02 : 0));
    });
  }

  /* ---------- STAT TILES ---------- */
  function drawStats() {
    document.querySelectorAll('.stat-art').forEach(c => {
      const s = +c.dataset.seed, [w, h] = sizeCanvas(c, 2);
      const ctx = c.getContext('2d');
      bayerPaint(ctx, w, h, (x, y) => {
        const u = x / w, v = y / h;
        let d;
        if (s === 1) d = Math.max(0, 1 - Math.hypot(u - 1, v) * 1.25);                 // corner glow
        else if (s === 2) d = Math.max(0, Math.sin((u + v) * 9) * 0.5 + 0.5) * Math.max(0, u - 0.35);   // diagonal bands
        else if (s === 3) d = Math.max(0, 1 - Math.abs(Math.hypot(u - 0.85, v - 0.15) - 0.35) * 5) * 0.8; // ring
        else d = Math.max(0, (v < 1 - u * 0.9 ? 0 : 1) * (u - 0.2));                       // rising slope
        return d * 0.55;
      });
    });
  }

  /* ---------- CARD ARTWORK (Atkinson) ---------- */
  const scenes = {
    orbit(g, w, h) {
      let gr = g.createRadialGradient(w * 0.32, h * 0.95, 4, w * 0.32, h * 1.1, h * 0.95);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.7, '#555'); gr.addColorStop(1, '#000');
      g.fillStyle = gr; g.beginPath(); g.arc(w * 0.3, h * 1.15, h * 0.75, 0, 7); g.fill();
      g.strokeStyle = '#aaa'; g.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(w * 0.3, h * 1.15, h * (0.95 + i * 0.22), h * (0.55 + i * 0.13), -0.25, 0, 7); g.stroke(); }
      gr = g.createRadialGradient(w * 0.78, h * 0.28, 1, w * 0.78, h * 0.28, 16);
      gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { g.fillStyle = '#fff'; g.fillRect((hash(i, 1, 2) * w) | 0, (hash(i, 3, 4) * h * 0.6) | 0, 1, 1); }
    },
    network(g, w, h) {
      const pts = Array.from({ length: 11 }, (_, i) => [w * (0.1 + 0.8 * hash(i, 7, 1)), h * (0.12 + 0.76 * hash(i, 2, 9)), 3 + hash(i, 5, 5) * 9]);
      g.strokeStyle = '#888'; g.lineWidth = 1;
      pts.forEach((a, i) => pts.forEach((b, j) => { if (j > i && Math.hypot(a[0] - b[0], a[1] - b[1]) < w * 0.38) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } }));
      pts.forEach(([x, y, r]) => {
        const gr = g.createRadialGradient(x - r / 3, y - r / 3, 0, x, y, r * 1.6);
        gr.addColorStop(0, '#fff'); gr.addColorStop(0.6, '#777'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 1.6, 0, 7); g.fill();
      });
    },
    bars(g, w, h) {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const bh = h * (0.15 + 0.7 * Math.pow(i / (n - 1), 1.4)) * (0.85 + hash(i, 4, 4) * 0.25);
        const x = w * 0.08 + i * (w * 0.84 / n), bw = w * 0.84 / n - 4;
        const gr = g.createLinearGradient(0, h - bh, 0, h);
        gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#222');
        g.fillStyle = gr; g.fillRect(x, h - bh - 6, bw, bh);
      }
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i <= 40; i++) { const x = w * 0.06 + i / 40 * w * 0.88, y = h * 0.82 - Math.pow(i / 40, 1.5) * h * 0.66 + Math.sin(i) * 3; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    },
    wave(g, w, h) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = Math.sin(Math.hypot(x - w * 0.7, y - h * 0.4) / 5) * 0.5 + 0.5;
        const f = Math.max(0, 1 - Math.hypot(x - w * 0.7, y - h * 0.4) / (w * 0.6));
        const c = Math.round(255 * v * f);
        g.fillStyle = `rgb(${c},${c},${c})`; g.fillRect(x, y, 1, 1);
      }
    }
  };
  const cardState = new Map();
  function drawCard(c, bias) {
    const st = cardState.get(c);
    atkinsonPaint(c.getContext('2d'), st.w, st.h, st.gray, bias);
  }
  function buildCards() {
    document.querySelectorAll('.art').forEach(c => {
      const [w, h] = sizeCanvas(c, 2.2);
      const off = document.createElement('canvas'); off.width = w; off.height = h;
      const g = off.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      scenes[c.dataset.art](g, w, h);
      const px = g.getImageData(0, 0, w, h).data, gray = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) gray[i] = (px[i * 4] / 255) * 0.92;
      const prev = cardState.get(c);
      cardState.set(c, { w, h, gray, bias: prev ? prev.bias : 0, target: prev ? prev.target : 0 });
      drawCard(c, 0);
      if (!prev) {
        const card = c.closest('.card');
        card.addEventListener('pointerenter', () => animateCard(c, 0.14));
        card.addEventListener('pointerleave', () => animateCard(c, 0));
      }
    });
  }
  function animateCard(c, target) {
    const st = cardState.get(c); st.target = target;
    if (reduced) { st.bias = target; drawCard(c, target); return; }
    if (st.running) return; st.running = true;
    const step = () => {
      st.bias += (st.target - st.bias) * 0.18;
      drawCard(c, st.bias);
      if (Math.abs(st.target - st.bias) > 0.004) requestAnimationFrame(step); else st.running = false;
    };
    requestAnimationFrame(step);
  }

  /* ---------- CONTACT ART ---------- */
  const cArt = document.getElementById('contactArt');
  function drawContact(t = 0) {
    const [w, h] = sizeCanvas(cArt, 3);
    bayerPaint(cArt.getContext('2d'), w, h, (x, y) => {
      const d = Math.hypot(x - w * 0.95, y - h * 1.05) / (w * 0.95);
      const ring = Math.sin(d * 26 - t * 0.04) * 0.08;
      return Math.max(0, 0.78 - d * 0.82 + ring);
    });
  }
  let cVisible = false, ct = 0;
  new IntersectionObserver(([en]) => { cVisible = en.isIntersecting; }).observe(cArt);
  function cLoop() { if (cVisible && !reduced) { ct++; if (ct % 3 === 0) drawContact(ct); } requestAnimationFrame(cLoop); }

  /* ---------- UI: theme, language, clock, reveal ---------- */
  function renderAll() { readColors(); drawStrips(); drawStats(); buildCards(); drawContact(ct); drawGlobe(); }

  function setLang(l) {
    root.dataset.lang = l; root.lang = l;
    document.querySelectorAll('[data-set-lang]').forEach(b => b.classList.toggle('on', b.dataset.setLang === l));
    try { localStorage.setItem('apl-lang', l); } catch (e) {}
  }
  document.querySelectorAll('[data-set-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.setLang)));
  setLang(root.dataset.lang || 'en');

  const clock = document.getElementById('clock');
  const fmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' });
  const tick = () => { clock.textContent = fmt.format(new Date()) + ' CET'; };
  tick(); setInterval(tick, 1000);

  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('.section .sec-head, .lead, .stat, .card, .row, .edu li, .skills, .big, .contact-links')
    .forEach(el => { el.classList.add('reveal'); io.observe(el); });

  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderAll, 150); });

  const start = () => { renderAll(); if (!reduced) { requestAnimationFrame(loop); requestAnimationFrame(cLoop); } };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(start);
})();
