/* Screensavers for the Homepage themes in Jellyfin: one per theme, plus "match my theme" (Settings > Display > Screensaver).
 * Loaded on every page by the JavaScript Injector plugin (entry "Homepage theme screensavers", src
 * /web/themes/homepage/screensavers.js), like effects.js.
 * - Jellyfin only lists the screensavers built into the web client. This reaches the client's plugin manager through
 *   webpack's chunk loader (the module that holds `pluginsList` and `ofType`) and adds ours to it as
 *   {id, name, type: "screensaver", show(), hide() -> Promise}. The Display settings and the idle timer both read that
 *   list, so ours are picked and started exactly like the built-in Backdrop and Logo screensavers.
 * - Every scene is made from the viewer's own library: random movies and shows with artwork, fetched through the
 *   signed-in ApiClient and cached for ten minutes. With no artwork it paints stand-in posters.
 * - One full-screen canvas per run. prefers-reduced-motion slows everything to a third and drops the jitter; nothing
 *   flashes the whole screen.
 * - window.hpScreensaver(id) starts one by hand (Desktop 95's Start menu uses it); it then closes itself on input. */
(() => {
  if (window.hpScreensaver) return;

  const TAU = Math.PI * 2;
  const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const clock = (secs = true) => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(secs ? { second: "2-digit" } : {}) });
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const pad = (v, n) => String(v).padStart(n, "0");

  // value noise, 0..1
  const PERM = new Uint8Array(512);
  { const p = shuffle([...Array(256).keys()]); for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
    const h = (i, j) => PERM[(PERM[(xi + i) & 255] + yi + j) & 255] / 255;
    return lerp(lerp(h(0, 0), h(1, 0), u), lerp(h(0, 1), h(1, 1), u), v);
  }

  // ---- pictures ----
  // img drawn to cover a w x h canvas
  function cover(img, w, h) {
    const c = canvas(w, h), x = c.getContext("2d", { willReadFrequently: true });
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.max(w / iw, h / ih);
    x.imageSmoothingQuality = "high";
    x.drawImage(img, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
    return c;
  }
  const pixels = (img, w, h) => cover(img, w, h).getContext("2d").getImageData(0, 0, w, h);
  function lums(d) {
    const p = d.data, L = new Float32Array(d.width * d.height);
    for (let i = 0; i < L.length; i++) L[i] = (.2126 * p[i * 4] + .7152 * p[i * 4 + 1] + .0722 * p[i * 4 + 2]) / 255;
    return L;
  }
  // stretch to the 2nd..98th percentile, so dark posters still read
  function stretch(L) {
    const h = new Uint32Array(256), n = L.length;
    for (let i = 0; i < n; i++) h[Math.min(255, (L[i] * 255) | 0)]++;
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += h[i]; if (acc > n * .02) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += h[i]; if (acc > n * .02) { hi = i; break; } }
    const a = lo / 255, k = 1 / Math.max(.05, (hi - lo) / 255);
    for (let i = 0; i < n; i++) L[i] = clamp((L[i] - a) * k);
    return L;
  }
  const wide = (a) => a.backdrop || a.poster;

  // ---- the library ----
  const loadImg = (src) => new Promise((res) => {
    const i = new Image(), to = setTimeout(() => res(null), 8000);
    i.onload = () => { clearTimeout(to); res(i); };
    i.onerror = () => { clearTimeout(to); res(null); };
    i.src = src;
  });
  async function fetchArt() {
    const api = window.ApiClient, uid = api?.getCurrentUserId?.();
    if (!uid) return [];
    const res = await api.getItems(uid, { IncludeItemTypes: "Movie,Series", Recursive: true, SortBy: "Random", Limit: 30, ImageTypes: "Primary",
      Fields: "ProductionYear,CommunityRating,RunTimeTicks,Genres", EnableTotalRecordCount: false });
    const out = await Promise.all((res?.Items || []).map(async (it) => {
      const poster = await loadImg(api.getImageUrl(it.Id, { type: "Primary", maxHeight: 720, tag: it.ImageTags?.Primary }));
      if (!poster) return null;
      const bt = it.BackdropImageTags?.[0];
      const backdrop = bt ? await loadImg(api.getImageUrl(it.Id, { type: "Backdrop", maxWidth: 1280, tag: bt })) : null;
      return { title: it.Name || "Untitled", year: it.ProductionYear || "", rating: it.CommunityRating ? +it.CommunityRating.toFixed(1) : null,
        minutes: it.RunTimeTicks ? Math.round(it.RunTimeTicks / 6e8) : null, genre: it.Genres?.[0] || (it.Type === "Series" ? "Series" : "Film"),
        type: it.Type, poster, backdrop };
    }));
    return out.filter(Boolean);
  }
  function standIns() {
    return ["Feature Presentation", "The Late Show", "Double Feature", "Coming Soon", "Midnight Matinee", "Now Playing"].map((title, i) => {
      const c = canvas(400, 600), x = c.getContext("2d"), hue = i * 57;
      const g = x.createLinearGradient(0, 0, 400, 600); g.addColorStop(0, `hsl(${hue},70%,55%)`); g.addColorStop(1, `hsl(${hue + 80},60%,14%)`);
      x.fillStyle = g; x.fillRect(0, 0, 400, 600);
      x.fillStyle = "rgba(255,255,255,.85)"; x.beginPath(); x.arc(200, 230, 110, 0, TAU); x.fill();
      x.fillStyle = "#fff"; x.font = "bold 40px sans-serif"; x.textAlign = "center";
      title.split(" ").forEach((w, k) => x.fillText(w.toUpperCase(), 200, 450 + k * 48));
      return { title, year: "", rating: null, minutes: null, genre: "Feature", type: "Movie", poster: c, backdrop: null };
    });
  }
  let cache = null;
  async function getArt() {
    if (!cache || Date.now() - cache.at > 6e5) {
      let list = [];
      try { list = await Promise.race([fetchArt(), new Promise((r) => setTimeout(() => r([]), 7000))]); } catch { list = []; }
      if (list.length) cache = { at: Date.now(), list };
    }
    return cache ? shuffle(cache.list.slice()) : standIns();
  }

  // ---- the scenes: make(S) returns { frame(t, dt), resize?() }; S = { ctx, W, H, dpr, art, reduced } ----
  const SAVERS = {};

  // NEON ARCADE: a synthwave night drive at 120 bpm. Your posters are neon billboards on the roadside, each one scoring
  // points as it passes; the slatted sun, grid and tubes pulse on the beat.
  SAVERS.neon = { name: "Neon Arcade: Night Drive", make(S) {
    const STOPS = ["#12032e", "#5a0f8a", "#ff2bd6", "#00f0ff", "#ffffff"].map(hex);
    const duo = (img) => {
      const c = cover(img, 240, 360), x = c.getContext("2d"), d = x.getImageData(0, 0, 240, 360), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const l = clamp(((.2126 * p[i] + .7152 * p[i + 1] + .0722 * p[i + 2]) / 255) * 1.15 - .05);
        const f = l * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(f)), m = f - k;
        for (let ch = 0; ch < 3; ch++) p[i + ch] = lerp(STOPS[k][ch], STOPS[k + 1][ch], m);
      }
      x.putImageData(d, 0, 0); return c;
    };
    const boards = S.art.map((a) => ({ a, tex: duo(a.poster) }));
    const TUBES = ["#ff2bd6", "#00f0ff", "#fff35c"];
    const stars = Array.from({ length: 180 }, () => ({ x: rand(), y: rand(), p: rand(TAU), s: rand(.5, 1.8) }));
    const ridge = Array.from({ length: 64 }, (_, i) => noise(i * .35, 3.1) * .8 + noise(i * .9, 7.7) * .35);
    let sun = null, live = [], spawn = 0, n = 0, score = 0, banner = null, scan = null;
    const V = 4; // grid lines per second
    return {
      resize() { const l = canvas(1, 3), x = l.getContext("2d"); x.fillStyle = "rgba(0,0,0,.22)"; x.fillRect(0, 0, 1, 1); scan = S.ctx.createPattern(l, "repeat"); },
      frame(t, dt) {
        const { ctx: c, W, H } = S, hy = H * .58, gh = H - hy, beat = Math.pow(1 - ((t * 2) % 1), 4);
        let g = c.createLinearGradient(0, 0, 0, hy);
        g.addColorStop(0, "#05010f"); g.addColorStop(.55, "#2a0a5e"); g.addColorStop(1, "#ff2bd6");
        c.fillStyle = g; c.fillRect(0, 0, W, hy);
        c.fillStyle = "#fff";
        for (const s of stars) { c.globalAlpha = .3 + .7 * Math.abs(Math.sin(t * s.s + s.p)); c.fillRect(s.x * W, s.y * hy * .75, s.s, s.s); }
        c.globalAlpha = 1;
        // the sun, its slats scrolling down
        const sr = Math.min(W, H) * .3 * (1 + beat * .015), D = Math.ceil(sr * 2);
        if (!sun || sun.width !== D) sun = canvas(D, D);
        const x = sun.getContext("2d");
        x.clearRect(0, 0, D, D);
        g = x.createLinearGradient(0, 0, 0, D); g.addColorStop(0, "#fff35c"); g.addColorStop(.45, "#ff9a3c"); g.addColorStop(1, "#ff2bd6");
        x.fillStyle = g; x.beginPath(); x.arc(D / 2, D / 2, D / 2, 0, TAU); x.fill();
        x.globalCompositeOperation = "destination-out";
        const gap = D * .07;
        for (let y = D * .42 + ((t * 18) % gap); y < D; y += gap) x.fillRect(0, y, D, 1.5 + ((y - D * .42) / D) * 18);
        x.globalCompositeOperation = "source-over";
        c.save(); c.beginPath(); c.rect(0, 0, W, hy); c.clip();
        c.shadowColor = "#ff2bd6"; c.shadowBlur = 50 + beat * 40;
        c.drawImage(sun, W / 2 - sr, hy - sr * 1.42, D, D); c.shadowBlur = 0;
        // wireframe mountains
        c.beginPath(); c.moveTo(0, hy);
        for (let i = 0; i < ridge.length; i++) { const u = i / (ridge.length - 1); c.lineTo(u * W, hy - ridge[i] * H * .12 * (.35 + Math.abs(u - .5) * 1.7)); }
        c.lineTo(W, hy); c.closePath(); c.fillStyle = "#12032e"; c.fill();
        c.strokeStyle = "#00f0ff"; c.lineWidth = 1.5; c.shadowColor = "#00f0ff"; c.shadowBlur = 12; c.stroke(); c.shadowBlur = 0;
        c.restore();
        // the grid floor
        g = c.createLinearGradient(0, hy, 0, H); g.addColorStop(0, "#2a0a5e"); g.addColorStop(1, "#05010f");
        c.fillStyle = g; c.fillRect(0, hy, W, gh);
        const ph = (t * V) % 1;
        c.beginPath();
        for (let i = 0; i < 40; i++) { const z = i + 1 - ph; if (z < .3) continue; const y = hy + gh / z; if (y <= H) { c.moveTo(0, y); c.lineTo(W, y); } }
        for (let i = -24; i <= 24; i++) { const dx = i * W * .09; c.moveTo(W / 2 + dx / 30, hy + gh / 30); c.lineTo(W / 2 + dx * 3, hy + gh * 3); }
        c.strokeStyle = "#ff2bd6"; c.lineWidth = 1.5; c.shadowColor = "#ff2bd6"; c.shadowBlur = 10;
        c.globalAlpha = .5 + beat * .5; c.stroke(); c.globalAlpha = 1; c.shadowBlur = 0;
        // billboards, far to near
        if ((spawn -= dt) <= 0) { const b = boards[n % boards.length]; live.push({ ...b, z: 26, side: n % 2 ? 1 : -1, tube: TUBES[n % 3], named: false }); n++; spawn = 1.5; }
        live.sort((a, b) => b.z - a.z);
        for (const b of live) {
          b.z -= dt * V;
          if (b.z < .35) continue;
          const s = 1 / b.z, bx = W / 2 + b.side * 6 * W * .09 * s, by = hy + gh * s, bh = 2.2 * gh * s, bw = (bh * 2) / 3, top = by - gh * s * 1.1 - bh;
          c.globalAlpha = clamp((26 - b.z) / 5);
          c.strokeStyle = "#3c0c6e"; c.lineWidth = Math.max(1, 8 * s); c.beginPath(); c.moveTo(bx, by); c.lineTo(bx, top + bh); c.stroke();
          c.drawImage(b.tex, bx - bw / 2, top, bw, bh);
          c.shadowColor = b.tube; c.shadowBlur = 18; c.strokeStyle = b.tube; c.lineWidth = Math.max(1.5, 10 * s);
          c.strokeRect(bx - bw / 2, top, bw, bh); c.shadowBlur = 0; c.globalAlpha = 1;
          if (!b.named && b.z < 4) { b.named = true; banner = { a: b.a, t0: t }; score += Math.round((b.a.rating || 6) * 1000); }
        }
        live = live.filter((b) => b.z >= .35);
        // NOW SHOWING, chrome-italic
        if (banner) {
          const k = (t - banner.t0) / 3.2;
          if (k > 1) banner = null;
          else {
            const title = banner.a.title.toUpperCase(), fs = Math.round(Math.min(H * .075, (W * 1.5) / Math.max(8, title.length)));
            c.globalAlpha = clamp(k < .15 ? k / .15 : k > .8 ? (1 - k) / .2 : 1); c.textAlign = "center";
            c.font = `italic 700 ${Math.round(H * .022)}px ${MONO}`; c.fillStyle = "#00f0ff"; c.fillText("NOW SHOWING", W / 2, H * .1);
            const ty = H * .1 + fs * 1.15;
            c.font = `italic 900 ${fs}px "Arial Black", Impact, sans-serif`;
            c.fillStyle = "#ff2bd6"; c.fillText(title, W / 2 + 4, ty);
            c.fillStyle = "#00f0ff"; c.fillText(title, W / 2 - 4, ty);
            g = c.createLinearGradient(0, ty - fs, 0, ty);
            g.addColorStop(0, "#fff"); g.addColorStop(.5, "#9fe9ff"); g.addColorStop(.52, "#3c0c6e"); g.addColorStop(1, "#ff9a3c");
            c.fillStyle = g; c.fillText(title, W / 2, ty); c.globalAlpha = 1;
          }
        }
        c.font = `700 ${Math.round(H * .024)}px ${MONO}`; c.fillStyle = "#fff35c";
        c.textAlign = "left"; c.fillText("1UP " + pad(score, 8), W * .03, H * .055);
        c.textAlign = "right"; c.fillText(clock(false), W * .97, H * .055);
        if (Math.floor(t * 1.6) % 2) { c.textAlign = "center"; c.fillStyle = "#fff"; c.fillText("INSERT COIN", W / 2, H * .95); }
        c.fillStyle = scan; c.fillRect(0, 0, W, H);
      },
    };
  } };

  // PHOSPHOR: a mainframe decompiles your library. It types the job, then a scan beam turns a backdrop into ASCII
  // (characters churning before they settle), holds it on a burning-in green screen, and rains it away.
  SAVERS.terminal = { name: "Phosphor: ASCII Decompiler", make(S) {
    const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
    const NOISE = "01アイウエオカキクケコサシスセソ<>/\\|=+*#%@";
    const LEVELS = ["#0b3d10", "#14661c", "#1f9a2b", "#2fd03f", "#6dff7a", "#d6ffd0"];
    let fs, cw, lh, cols, rows, lines = [], q = [], typing = null, phase = "log", pt = 0, idx = 0, item, G, art, ax, ox, oy, settled = 0, drops, tear = null, ovl;
    const say = (...l) => q.push(...l);
    function prep() {
      item = S.art[idx++ % S.art.length];
      const img = wide(item), iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, asp = cw / lh;
      let c = cols, r = Math.round(c * (ih / iw) * asp);
      if (r > rows) { r = rows; c = Math.round(r / (ih / iw) / asp); }
      // gamma pushes the midtones down, so shapes read as dense glyphs on a sparse field instead of a wall of text
      const L = stretch(lums(pixels(img, c, r))).map((v) => Math.pow(v, 1.9));
      G = { c, r, L };
      ox = Math.round((S.W - c * cw) / 2); oy = Math.round(lh * 8.5 + ((rows - r) * lh) / 2);
      art = canvas(c * cw * S.dpr, r * lh * S.dpr); ax = art.getContext("2d");
      ax.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); ax.font = `${fs}px ${MONO}`; ax.textBaseline = "top";
      settled = 0;
      const meta = [item.year && `(${item.year})`, item.rating && `★${item.rating}`, item.minutes && `${item.minutes} min`].filter(Boolean).join("  ");
      say("> mount /library --read-only", `  ${S.art.length} titles indexed`, "> pick --random", `  "${trunc(item.title, 48)}" ${meta}`,
        `> decompile --ascii --cols ${c} --rows ${r}`);
      phase = "log"; pt = 0;
    }
    function settle(r) {
      for (let lv = 0; lv < LEVELS.length; lv++) {
        ax.fillStyle = LEVELS[lv];
        for (let c = 0; c < G.c; c++) {
          const l = G.L[r * G.c + c];
          if (Math.min(5, (l * 6) | 0) !== lv) continue;
          const ch = RAMP[Math.round(l * (RAMP.length - 1))];
          if (ch !== " ") ax.fillText(ch, c * cw, r * lh);
        }
      }
    }
    return {
      resize() {
        fs = Math.round(clamp(S.H / 64, 9, 16)); S.ctx.font = `${fs}px ${MONO}`; cw = S.ctx.measureText("M").width; lh = Math.round(fs * 1.18);
        cols = Math.floor(S.W / cw) - 6; rows = Math.floor((S.H - lh * 10) / lh);
        ovl = canvas(S.W, S.H); const x = ovl.getContext("2d");
        x.fillStyle = "rgba(0,0,0,.28)"; for (let y = 0; y < S.H; y += 3) x.fillRect(0, y, S.W, 1);
        const g = x.createRadialGradient(S.W / 2, S.H / 2, S.H * .3, S.W / 2, S.H / 2, S.H * .95); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.75)");
        x.fillStyle = g; x.fillRect(0, 0, S.W, S.H);
        lines = []; q = []; typing = null; prep();
      },
      frame(t, dt) {
        const { ctx: c, W, H } = S;
        pt += dt;
        c.fillStyle = "rgba(0,7,0,.4)"; c.fillRect(0, 0, W, H); // phosphor decay: whatever moves leaves a trail
        c.font = `${fs}px ${MONO}`; c.textBaseline = "top"; c.textAlign = "left";
        // the job log, typed
        if (!typing && q.length) { typing = { full: q.shift(), n: 0 }; lines.push(""); lines = lines.slice(-7); }
        if (typing) { typing.n += dt * 60; lines[lines.length - 1] = typing.full.slice(0, typing.n | 0); if (typing.n >= typing.full.length) typing = null; }
        c.fillStyle = "#6dff7a"; c.shadowColor = "rgba(57,255,80,.6)"; c.shadowBlur = 6;
        lines.forEach((l, i) => c.fillText(l, cw * 3, lh * (1 + i)));
        if (Math.floor(t * 2) % 2) { const last = lines[lines.length - 1] || ""; c.fillRect(cw * 3 + c.measureText(last).width + 2, lh * lines.length, cw * .8, fs); }
        c.textAlign = "right"; c.fillText(`SYS ${clock()}  ·  JOB ${pad(idx, 4)}`, W - cw * 3, lh); c.textAlign = "left";
        if (phase === "log" && !typing && !q.length && pt > .5) { phase = "decode"; pt = 0; }
        // the picture
        if (phase === "decode") {
          const beam = (pt / 4.5) * G.r;
          while (settled < Math.min(G.r, Math.floor(beam))) settle(settled++);
          c.drawImage(art, ox, oy, G.c * cw, G.r * lh);
          c.fillStyle = "#d6ffd0";
          for (let r = settled; r < Math.min(G.r, settled + 3); r++) for (let k = 0; k < G.c; k += 1) if (Math.random() < .55) c.fillText(NOISE[(Math.random() * NOISE.length) | 0], ox + k * cw, oy + r * lh);
          if (settled >= G.r) { phase = "hold"; pt = 0; }
        } else if (phase === "hold") {
          c.drawImage(art, ox, oy, G.c * cw, G.r * lh);
          if (!S.reduced && !tear && Math.random() < .012) tear = { y: oy + rand(G.r * lh), h: rand(lh * 2, lh * 6), dx: rand(-40, 40), until: t + rand(.08, .25) };
          if (tear) {
            c.fillStyle = "#000"; c.fillRect(ox - 50, tear.y, G.c * cw + 100, tear.h);
            c.drawImage(art, 0, (tear.y - oy) * S.dpr, art.width, tear.h * S.dpr, ox + tear.dx, tear.y, G.c * cw, tear.h);
            if (t > tear.until) tear = null;
          }
          if (pt > 6) { phase = "rain"; pt = 0; drops = Array.from({ length: G.c }, () => ({ d: rand(1.2), v: rand(.6, 1.4) })); }
        } else if (phase === "rain") {
          let gone = true;
          for (let k = 0; k < G.c; k++) {
            const dr = drops[k], e = Math.max(0, pt - dr.d), y = e * e * H * dr.v;
            if (y < H) gone = false;
            c.drawImage(art, k * cw * S.dpr, 0, cw * S.dpr, art.height, ox + k * cw, oy + y, cw, G.r * lh);
            if (e > 0) { c.fillStyle = "#d6ffd0"; c.fillText(NOISE[(Math.random() * NOISE.length) | 0], ox + k * cw, oy + y + G.r * lh); }
          }
          if (gone || pt > 5) prep();
        }
        c.shadowBlur = 0;
        // rolling interference bar, scanlines and tube vignette
        const by = ((t * .11) % 1.3 - .15) * H, g = c.createLinearGradient(0, by, 0, by + H * .12);
        g.addColorStop(0, "rgba(57,255,80,0)"); g.addColorStop(.5, "rgba(57,255,80,.05)"); g.addColorStop(1, "rgba(57,255,80,0)");
        c.fillStyle = g; c.fillRect(0, by, W, H * .12);
        c.drawImage(ovl, 0, 0, W, H);
      },
    };
  } };

  // COSMOS: your library as an orrery. Each poster is wrapped round a spinning planet, lit by a holographic-foil sun so
  // the far side falls into night; some wear foil rings or a moon, and comets cross the nebula.
  SAVERS.cosmos = { name: "Cosmos: Library Orrery", make(S) {
    const FOIL = ["#ff9be8", "#7dd8ff", "#7873f5", "#b8fff0"];
    const tex = (a) => {
      const c = canvas(512, 256), x = c.getContext("2d"), p = cover(a.poster, 171, 256);
      x.drawImage(p, 0, 0); x.save(); x.translate(342, 0); x.scale(-1, 1); x.drawImage(p, 0, 0); x.restore(); x.drawImage(p, 342, 0);
      return c;
    };
    const planets = S.art.slice(0, 8).map((a, i) => ({ a, tex: tex(a), orbit: .2 + i * .095 + rand(.02), th: rand(TAU), size: rand(.04, .066),
      spin: rand(.03, .07) * (Math.random() < .5 ? -1 : 1), ring: i % 3 === 1, foil: FOIL[i % 4], moon: Math.random() < .5 ? rand(TAU) : null }));
    planets.forEach((p) => { p.w = .32 / Math.pow(p.orbit / .2, 1.5); });
    const stars = [0, 1, 2].map((l) => Array.from({ length: 220 }, () => ({ x: rand(), y: rand(), s: rand(.4, 1.4) * (l + 1) * .6, p: rand(TAU) })));
    const comets = [];
    let nextComet = 3, c, cx, cy, U, sinE;
    function ringHalf(b, back) {
      const { x, y, r } = b, rx = r * 2.2, ry = rx * sinE * .9, g = c.createConicGradient(S.t * .3, x, y);
      FOIL.forEach((f, i) => g.addColorStop(i / 4, f)); g.addColorStop(1, FOIL[0]);
      c.save(); c.globalAlpha = .55; c.strokeStyle = g; c.lineWidth = r * .28;
      c.beginPath(); c.ellipse(x, y, rx, ry, -.25, back ? Math.PI : 0, back ? TAU : Math.PI); c.stroke(); c.restore();
    }
    function moon(b, front) {
      const p = b.p, a = S.t * 1.3 + p.moon, s = Math.sin(a);
      if ((s > 0) !== front) return;
      c.fillStyle = front ? "#e9e4ff" : "#6f6a99"; c.beginPath();
      c.arc(b.x + Math.cos(a) * b.r * 1.9, b.y + s * b.r * 1.9 * sinE, Math.max(1.5, b.r * .16), 0, TAU); c.fill();
    }
    function planet(b) {
      const { p, x, y, r } = b;
      if (p.ring) ringHalf(b, true);
      if (p.moon !== null) moon(b, false);
      c.save(); c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
      const tw = r * 4, off = ((((S.t * p.spin) % 1) + 1) % 1) * tw;
      c.drawImage(p.tex, x - r - off, y - r, tw, r * 2); c.drawImage(p.tex, x - r - off + tw, y - r, tw, r * 2);
      const lx = cx - x, ly = cy - y, ll = Math.hypot(lx, ly) || 1, ux = lx / ll, uy = ly / ll;
      const g = c.createRadialGradient(x + ux * r * .5, y + uy * r * .5, r * .05, x + ux * r * .45, y + uy * r * .45, r * 1.45);
      g.addColorStop(0, "rgba(255,255,255,.22)"); g.addColorStop(.45, "rgba(10,6,36,0)"); g.addColorStop(.72, "rgba(5,3,15,.82)"); g.addColorStop(1, "rgba(5,3,15,.97)");
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      c.restore();
      c.globalAlpha = .75; c.strokeStyle = p.foil; c.lineWidth = Math.max(1, r * .06); c.shadowColor = p.foil; c.shadowBlur = r * .5;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); c.shadowBlur = 0; c.globalAlpha = 1;
      if (p.ring) ringHalf(b, false);
      if (p.moon !== null) moon(b, true);
    }
    return {
      frame(t, dt) {
        c = S.ctx; const { W, H } = S;
        cx = W / 2; cy = H / 2; U = Math.min(W * .5, H * 1.05);
        const e = .4 + Math.sin(t * .05) * .14; sinE = Math.sin(e); const cosE = Math.cos(e);
        c.fillStyle = "#05030f"; c.fillRect(0, 0, W, H);
        c.globalCompositeOperation = "lighter";
        ["rgba(255,155,232,.16)", "rgba(125,216,255,.13)", "rgba(120,115,245,.16)"].forEach((col, i) => {
          const a = t * .02 + i * 2.1, nx = cx + Math.cos(a) * W * .28, ny = cy + Math.sin(a * 1.3) * H * .25, r = Math.max(W, H) * .45;
          const g = c.createRadialGradient(nx, ny, 0, nx, ny, r); g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
        });
        c.fillStyle = "#fff";
        stars.forEach((layer, l) => { const dx = t * (l + 1) * 3; for (const s of layer) { c.globalAlpha = .35 + .65 * Math.abs(Math.sin(t * .8 + s.p)); c.fillRect((s.x * W + dx) % W, s.y * H, s.s, s.s); } });
        c.globalAlpha = 1;
        // comets with tails
        if ((nextComet -= dt) <= 0) { nextComet = rand(6, 12); const fromLeft = Math.random() < .5; comets.push({ x: fromLeft ? -50 : W + 50, y: rand(H * .1, H * .6), vx: (fromLeft ? 1 : -1) * rand(220, 380), vy: rand(30, 110), tail: [], col: pick(FOIL) }); }
        for (const k of comets) {
          k.x += k.vx * dt; k.y += k.vy * dt; k.tail.unshift([k.x, k.y]); k.tail.length = Math.min(k.tail.length, 46);
          k.tail.forEach(([x, y], i) => { c.globalAlpha = (1 - i / 46) * .7; c.fillStyle = i ? k.col : "#fff"; c.beginPath(); c.arc(x, y, Math.max(.5, 3.2 - i * .06), 0, TAU); c.fill(); });
        }
        c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
        for (let i = comets.length - 1; i >= 0; i--) if (comets[i].x < -300 || comets[i].x > W + 300) comets.splice(i, 1);
        // orbits
        c.setLineDash([2, 6]); c.strokeStyle = "rgba(190,170,255,.18)"; c.lineWidth = 1;
        for (const p of planets) { c.beginPath(); c.ellipse(cx, cy, p.orbit * U, p.orbit * U * sinE, 0, 0, TAU); c.stroke(); }
        c.setLineDash([]);
        const bodies = planets.map((p) => {
          p.th += p.w * dt;
          const X = Math.cos(p.th) * p.orbit, Z = Math.sin(p.th) * p.orbit, depth = Z * cosE, persp = 1 / (1 - depth * .35);
          return { p, x: cx + X * U, y: cy + Z * sinE * U, r: p.size * U * persp, depth };
        });
        bodies.push({ sun: true, depth: 0 });
        bodies.sort((a, b) => a.depth - b.depth);
        for (const b of bodies) {
          if (!b.sun) { planet(b); continue; }
          const sr = U * .07;
          c.globalCompositeOperation = "lighter";
          let g = c.createRadialGradient(cx, cy, 0, cx, cy, sr * 4.5);
          g.addColorStop(0, "rgba(255,240,255,.9)"); g.addColorStop(.25, "rgba(255,155,232,.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = g; c.fillRect(cx - sr * 5, cy - sr * 5, sr * 10, sr * 10);
          c.globalCompositeOperation = "source-over";
          g = c.createConicGradient(t * .5, cx, cy); FOIL.forEach((f, i) => g.addColorStop(i / 4, f)); g.addColorStop(1, FOIL[0]);
          c.fillStyle = g; c.beginPath(); c.arc(cx, cy, sr, 0, TAU); c.fill();
          g = c.createRadialGradient(cx - sr * .3, cy - sr * .3, 0, cx, cy, sr); g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
          c.fillStyle = g; c.beginPath(); c.arc(cx, cy, sr, 0, TAU); c.fill();
        }
        // the nearest planet gets a label
        const f = bodies.filter((b) => !b.sun).reduce((m, b) => (b.depth > m.depth ? b : m));
        const lx = f.x + f.r * 1.2 + 30, ly = f.y - f.r - 26, right = lx + 260 < W;
        const tx = right ? lx : f.x - f.r * 1.2 - 30;
        c.strokeStyle = "rgba(244,241,255,.6)"; c.lineWidth = 1; c.beginPath(); c.moveTo(f.x + (right ? f.r * .7 : -f.r * .7), f.y - f.r * .7); c.lineTo(tx, ly); c.lineTo(tx + (right ? 40 : -40), ly); c.stroke();
        c.textAlign = right ? "left" : "right"; c.fillStyle = "#f4f1ff";
        c.font = `600 ${Math.round(H * .02)}px system-ui, sans-serif`; if ("letterSpacing" in c) c.letterSpacing = "3px";
        c.fillText(trunc(f.p.a.title.toUpperCase(), 34), tx, ly - 8);
        c.font = `400 ${Math.round(H * .015)}px system-ui, sans-serif`; c.fillStyle = "#a79ee0";
        c.fillText([f.p.a.year, f.p.a.minutes ? `orbit ${f.p.a.minutes} min` : f.p.a.genre, f.p.a.rating && `★ ${f.p.a.rating}`].filter(Boolean).join("  ·  "), tx, ly + 16);
        if ("letterSpacing" in c) c.letterSpacing = "0px";
      },
    };
  } };

  // BLUEPRINT: a pen plotter draws each poster as line art (its edges, traced in one nearest-neighbour path) on a
  // drafting sheet, with dimension lines, a specification, a luminance cross-section A-A and a title block.
  SAVERS.blueprint = { name: "Blueprint: Plotter", make(S) {
    const INK = "#f1f7ff", HI = "#ffe066", GW = 150, GH = 225;
    let bg, sheet, sx, job = null, idx = 0, box, panel;
    function lineArt(img) {
      const L = stretch(lums(pixels(img, GW, GH))), pts = [];
      for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        const gx = L[i - GW + 1] + 2 * L[i + 1] + L[i + GW + 1] - L[i - GW - 1] - 2 * L[i - 1] - L[i + GW - 1];
        const gy = L[i + GW - 1] + 2 * L[i + GW] + L[i + GW + 1] - L[i - GW - 1] - 2 * L[i - GW] - L[i - GW + 1];
        const m = Math.hypot(gx, gy); if (m > .25) pts.push([x, y, m]);
      }
      pts.sort((a, b) => b[2] - a[2]);
      const P = pts.slice(0, 3400), used = new Uint8Array(P.length), path = [];
      let cur = 0;
      for (let k = 0; k < P.length; k++) {
        used[cur] = 1; path.push(P[cur]);
        let best = -1, bd = 1e9; const [px, py] = P[cur];
        for (let j = 0; j < P.length; j++) if (!used[j]) { const dx = P[j][0] - px, dy = P[j][1] - py, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = j; if (dd <= 1) break; } }
        if (best < 0) break; cur = best;
      }
      const prof = Array.from({ length: GW }, (_, x) => L[(GH >> 1) * GW + x]);
      return { path, prof };
    }
    function newJob() {
      const a = S.art[idx++ % S.art.length], { path, prof } = lineArt(a.poster);
      sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, sheet.width, sheet.height); sx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      job = { a, path, prof, i: 0, phase: "frame", pt: 0, n: idx };
    }
    const at = (p) => [box.x + (p[0] / GW) * box.w, box.y + (p[1] / GH) * box.h];
    function text(c, s, x, y, size, col = INK, align = "left", weight = 400) { c.font = `${weight} ${size}px ${MONO}`; c.fillStyle = col; c.textAlign = align; c.fillText(s, x, y); }
    function arrow(c, x1, y1, x2, y2) {
      const a = Math.atan2(y2 - y1, x2 - x1), h = 8;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
      for (const [x, y, d] of [[x1, y1, 1], [x2, y2, -1]]) { c.moveTo(x + Math.cos(a) * h * d - Math.sin(a) * 4, y + Math.sin(a) * h * d + Math.cos(a) * 4); c.lineTo(x, y); c.lineTo(x + Math.cos(a) * h * d + Math.sin(a) * 4, y + Math.sin(a) * h * d - Math.cos(a) * 4); }
      c.stroke();
    }
    // frame, dimensions and annotations: drawn live each frame (k = 0..1 progress), offset by the sliding sheet
    function frameDims(c, k, ox) {
      const { x, y, w, h } = box, per = 2 * (w + h);
      c.save(); c.translate(ox, 0); c.strokeStyle = INK; c.lineWidth = 1.5;
      c.setLineDash([per * k, per]); c.strokeRect(x, y, w, h); c.setLineDash([]);
      if (k > .5) {
        c.globalAlpha = (k - .5) * 2; c.lineWidth = 1;
        arrow(c, x, y + h + 26, x + w, y + h + 26); c.beginPath(); c.moveTo(x, y + h + 6); c.lineTo(x, y + h + 34); c.moveTo(x + w, y + h + 6); c.lineTo(x + w, y + h + 34); c.stroke();
        arrow(c, x - 26, y, x - 26, y + h); c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x - 34, y); c.moveTo(x - 6, y + h); c.lineTo(x - 34, y + h); c.stroke();
        const s = Math.round(S.H * .016);
        text(c, "686", x + w / 2, y + h + 20, s, INK, "center");
        c.save(); c.translate(x - 32, y + h / 2); c.rotate(-Math.PI / 2); text(c, "1016", 0, 0, s, INK, "center"); c.restore();
      }
      c.restore();
    }
    function annotate(c, k, ox) {
      const a = job.a, s = Math.round(S.H * .017), p = panel, rows = [["TITLE", trunc(a.title.toUpperCase(), 26)], ["TYPE", a.type === "Series" ? "SERIES" : "FEATURE"],
        ["YEAR", a.year || "—"], ["RUNTIME", a.minutes ? `${a.minutes} MIN` : "—"], ["TOLERANCE", a.rating ? `± ${a.rating}` : "—"], ["MATERIAL", String(a.genre).toUpperCase()]];
      c.save(); c.translate(ox, 0); c.strokeStyle = INK; c.lineWidth = 1;
      let budget = Math.floor(k * 400);
      const type = (str, x, y, size, col, align, wt) => { str = String(str); if (budget <= 0) return; const t = str.slice(0, budget); budget -= str.length; text(c, t, x, y, size, col, align, wt); };
      type("SPECIFICATION", p.x, p.y, s * 1.2, HI, "left", 700);
      rows.forEach(([kk, v], i) => { type(kk, p.x, p.y + (i + 1.6) * s * 1.7, s, "#a3c4ec"); type(v, p.x + p.w * .32, p.y + (i + 1.6) * s * 1.7, s, INK); });
      // section A-A: luminance along the poster's middle row, as an elevation profile
      const sy = p.y + s * 14, sh = S.H * .14, n = Math.floor(job.prof.length * clamp(k * 1.6));
      type("SECTION A–A", p.x, sy - 10, s, HI, "left", 700);
      c.beginPath(); c.moveTo(p.x, sy + sh); c.lineTo(p.x + p.w, sy + sh); c.stroke();
      c.beginPath(); for (let i = 0; i < n; i++) { const px = p.x + (i / (job.prof.length - 1)) * p.w, py = sy + sh - job.prof[i] * sh; i ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke();
      for (let i = 0; i <= 10; i++) { const px = p.x + (i / 10) * p.w; c.beginPath(); c.moveTo(px, sy + sh); c.lineTo(px, sy + sh + (i % 5 ? 4 : 8)); c.stroke(); }
      // the cut line across the drawing
      if (k > .2) {
        const ly = box.y + box.h / 2; c.setLineDash([10, 4, 2, 4]); c.beginPath(); c.moveTo(box.x - 20, ly); c.lineTo(box.x + box.w + 20, ly); c.stroke(); c.setLineDash([]);
        for (const ex of [box.x - 30, box.x + box.w + 30]) { c.beginPath(); c.arc(ex, ly, 10, 0, TAU); c.stroke(); text(c, "A", ex, ly + 4, s * .8, INK, "center"); }
      }
      // title block
      const tb = { x: p.x, y: S.H * .76, w: p.w, h: S.H * .17 };
      if (k > .3) {
        c.globalAlpha = clamp((k - .3) * 3); c.strokeRect(tb.x, tb.y, tb.w, tb.h);
        c.beginPath(); c.moveTo(tb.x, tb.y + tb.h * .45); c.lineTo(tb.x + tb.w, tb.y + tb.h * .45); c.moveTo(tb.x + tb.w * .5, tb.y + tb.h * .45); c.lineTo(tb.x + tb.w * .5, tb.y + tb.h); c.stroke();
        text(c, trunc(a.title.toUpperCase(), 30), tb.x + 10, tb.y + tb.h * .3, s * 1.3, INK, "left", 700);
        text(c, "DRAWN  JELLYFIN", tb.x + 10, tb.y + tb.h * .66, s * .8, "#a3c4ec");
        text(c, `DATE  ${new Date().toLocaleDateString()}`, tb.x + 10, tb.y + tb.h * .88, s * .8, "#a3c4ec");
        text(c, `SHEET ${job.n} OF ${S.art.length}`, tb.x + tb.w * .5 + 10, tb.y + tb.h * .66, s * .8, "#a3c4ec");
        text(c, "SCALE 1:4.5", tb.x + tb.w * .5 + 10, tb.y + tb.h * .88, s * .8, "#a3c4ec");
      }
      c.restore();
    }
    return {
      resize() {
        const { W, H } = S;
        bg = canvas(W * S.dpr, H * S.dpr); const b = bg.getContext("2d"); b.scale(S.dpr, S.dpr);
        b.fillStyle = "#0b3a75"; b.fillRect(0, 0, W, H);
        for (const [step, al] of [[20, .06], [100, .13]]) {
          b.strokeStyle = `rgba(255,255,255,${al})`; b.lineWidth = 1; b.beginPath();
          for (let x = .5; x < W; x += step) { b.moveTo(x, 0); b.lineTo(x, H); }
          for (let y = .5; y < H; y += step) { b.moveTo(0, y); b.lineTo(W, y); }
          b.stroke();
        }
        const bh = H * .62; box = { x: W * .1, y: H * .14, w: (bh * 2) / 3, h: bh };
        panel = { x: Math.max(box.x + box.w + 90, W * .56), y: H * .14 }; panel.w = Math.min(W * .36, W - panel.x - W * .05);
        sheet = canvas(W * S.dpr, H * S.dpr); sx = sheet.getContext("2d");
        newJob();
      },
      frame(t, dt) {
        const { ctx: c, W, H } = S, j = job;
        j.pt += dt;
        let ox = 0, k = 1;
        if (j.phase === "frame") { ox = (1 - ease(Math.min(1, j.pt / 1.2))) * W; k = clamp(j.pt / 2); if (j.pt > 2.2) { j.phase = "plot"; j.pt = 0; } }
        // the pen: ~10 s per drawing
        let pen = null;
        if (j.phase === "plot") {
          const to = Math.min(j.path.length, Math.floor((j.pt / 10) * j.path.length));
          sx.strokeStyle = INK; sx.lineWidth = 1.1; sx.lineCap = "round"; sx.beginPath();
          for (let i = Math.max(1, j.i); i < to; i++) {
            const [x0, y0] = j.path[i - 1], [x1, y1] = j.path[i];
            if ((x1 - x0) ** 2 + (y1 - y0) ** 2 > 8) continue; // pen up
            const a = at(j.path[i - 1]), b = at(j.path[i]); sx.moveTo(a[0], a[1]); sx.lineTo(b[0], b[1]);
          }
          sx.stroke(); j.i = to;
          pen = at(j.path[Math.max(0, to - 1)]);
          if (to >= j.path.length) { j.phase = "annotate"; j.pt = 0; }
        } else if (j.phase === "annotate" && j.pt > 3) { j.phase = "hold"; j.pt = 0; }
        else if (j.phase === "hold" && j.pt > 4.5) { j.phase = "slide"; j.pt = 0; }
        if (j.phase === "slide") { ox = -ease(Math.min(1, j.pt / 1.2)) * W * 1.1; if (j.pt > 1.25) newJob(); }
        c.drawImage(bg, 0, 0, W, H);
        frameDims(c, k, ox);
        c.drawImage(sheet, ox, 0, W, H);
        if (["annotate", "hold", "slide"].includes(j.phase)) annotate(c, j.phase === "annotate" ? j.pt / 3 : 1, ox);
        if (pen) {
          // the drafting machine's rails follow the pen
          c.strokeStyle = "rgba(255,224,102,.28)"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, pen[1]); c.lineTo(W, pen[1]); c.moveTo(pen[0], 0); c.lineTo(pen[0], H); c.stroke();
          c.strokeStyle = HI; c.shadowColor = HI; c.shadowBlur = 10; c.lineWidth = 2; c.beginPath(); c.arc(pen[0], pen[1], 7, 0, TAU); c.stroke(); c.shadowBlur = 0;
          c.beginPath(); c.arc(pen[0], pen[1], 22, -t * 2, -t * 2 + 1.2); c.stroke();
          text(c, `X ${(pen[0] - box.x).toFixed(1)}  Y ${(pen[1] - box.y).toFixed(1)}`, pen[0] + 28, pen[1] - 12, Math.round(H * .013), HI);
        }
        text(c, `PLOT ${pad(Math.round((j.i / Math.max(1, j.path.length)) * 100), 3)}%  ·  ${clock(false)}`, W - 24, H - 20, Math.round(H * .014), "#a3c4ec", "right");
      },
    };
  } };

  // LAVA LAMP: real metaball wax with heat physics: blobs warm at the bottom, rise, cool at the top and sink, merging
  // and splitting on the way. The picture is only visible through the wax, which bends it like a lens.
  SAVERS.lava = { name: "Lava Lamp: Wax Cinema", make(S) {
    const GW = 200;
    let GH, low, lx, img, F, cur, prev, mix = 1, idx = 0, swap = 0, label = null, bubbles = [];
    const blobs = Array.from({ length: 9 }, () => ({ x: rand(.1, .9), y: rand(.2, 1), vx: 0, vy: 0, r: rand(.07, .13), temp: rand(), ph: rand(TAU) }));
    function load(first) {
      const a = S.art[idx++ % S.art.length], d = pixels(wide(a), GW, GH).data;
      prev = first ? d : cur; cur = d; mix = first ? 1 : 0; label = { a, t0: S.t };
    }
    return {
      resize() { GH = Math.round((GW * S.H) / S.W); low = canvas(GW, GH); lx = low.getContext("2d"); img = lx.createImageData(GW, GH); F = new Float32Array(GW * GH); load(true); },
      frame(t, dt) {
        const { ctx: c, W, H } = S, asp = W / H;
        if ((swap += dt) > 20) { swap = 0; load(false); }
        mix = Math.min(1, mix + dt / 2.5);
        for (const b of blobs) {
          if (b.y > .86) b.temp += dt * .35; else b.temp -= dt * (b.y < .15 ? .25 : .045);
          b.temp = clamp(b.temp);
          b.vy += (.42 - b.temp) * .16 * dt; // hot wax rises
          b.vx += (noise(b.y * 3, t * .1 + b.ph * 9) - .5) * .03 * dt;
          b.vx *= .995; b.vy *= .992; b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.x < .05) b.vx = Math.abs(b.vx); if (b.x > .95) b.vx = -Math.abs(b.vx);
          if (b.y > 1.06) { b.y = 1.06; b.vy = Math.min(b.vy, 0); }
          if (b.y < -.06) { b.y = -.06; b.vy = Math.max(b.vy, 0); }
        }
        const rr = blobs.map((b) => (b.r * (1 + .08 * Math.sin(t * 1.3 + b.ph))) ** 2);
        for (let j = 0; j < GH; j++) {
          const y = j / GH;
          for (let i = 0; i < GW; i++) {
            const x = i / GW; let f = 0;
            for (let k = 0; k < blobs.length; k++) { const dx = (x - blobs[k].x) * asp, dy = y - blobs[k].y; f += rr[k] / (dx * dx + dy * dy + 1e-4); }
            F[j * GW + i] = Math.min(f, 4);
          }
        }
        const p = img.data;
        for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
          const k = j * GW + i, f = F[k], o = k * 4;
          // outside: dark oil lit by the wax nearby
          const glow = Math.min(1, f) ** 2;
          let r = 28 + lerp(prev[o], cur[o], mix) * .08 + glow * 120, g = 5 + lerp(prev[o + 1], cur[o + 1], mix) * .03 + glow * 30, b = 12 + lerp(prev[o + 2], cur[o + 2], mix) * .04 + glow * 22;
          const w = smooth(clamp((f - .85) / .3)); // a soft edge instead of a hard threshold
          if (w > 0) {
            // inside: the picture seen through the wax, bent along the field's slope
            const fx = F[k + (i < GW - 1 ? 1 : 0)] - F[k - (i > 0 ? 1 : 0)], fy = F[k + (j < GH - 1 ? GW : 0)] - F[k - (j > 0 ? GW : 0)];
            const si = clamp(Math.round(i - fx * 3), 0, GW - 1), sj = clamp(Math.round(j - fy * 3), 0, GH - 1), s = (sj * GW + si) * 4;
            const hot = j / GH, rim = clamp(1 - Math.abs(f - 1.15) * 3);
            r = lerp(r, 255 * .55 + lerp(prev[s], cur[s], mix) * .5 + rim * 70, w);
            g = lerp(g, lerp(61, 179, hot) * .55 + lerp(prev[s + 1], cur[s + 1], mix) * .45 + rim * 45, w);
            b = lerp(b, lerp(127, 71, hot) * .55 + lerp(prev[s + 2], cur[s + 2], mix) * .4 + rim * 25, w);
          }
          p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255;
        }
        lx.putImageData(img, 0, 0);
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.drawImage(low, 0, 0, W, H);
        // rising bubbles, glass reflections, vignette
        if (bubbles.length < 26 && Math.random() < .2) bubbles.push({ x: rand(W), y: H + 10, r: rand(1.5, 4), v: rand(25, 60), ph: rand(TAU) });
        c.strokeStyle = "rgba(255,220,180,.3)"; c.lineWidth = 1;
        for (const b of bubbles) { b.y -= b.v * dt; c.beginPath(); c.arc(b.x + Math.sin(t * 2 + b.ph) * 6, b.y, b.r, 0, TAU); c.stroke(); }
        bubbles = bubbles.filter((b) => b.y > -10);
        for (const [x0, w0] of [[.17, .05], [.8, .025]]) {
          const g = c.createLinearGradient(W * x0, 0, W * (x0 + w0), 0); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.5, "rgba(255,241,230,.08)"); g.addColorStop(1, "rgba(255,255,255,0)");
          c.fillStyle = g; c.fillRect(W * x0, 0, W * w0, H);
        }
        const g = c.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(10,0,4,.7)");
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        if (label) {
          const k = t - label.t0; c.globalAlpha = clamp(Math.min(k / 1.5, (8 - k) / 1.5));
          c.textAlign = "left"; c.fillStyle = "#e6a690"; c.font = `italic 400 ${Math.round(H * .02)}px Georgia, serif`; c.fillText("now melting", W * .05, H * .88);
          c.fillStyle = "#fff1e6"; c.font = `italic 700 ${Math.round(H * .045)}px Georgia, serif`; c.fillText(trunc(label.a.title, 40), W * .05, H * .88 + H * .05);
          c.globalAlpha = 1;
        }
      },
    };
  } };

  // DESKTOP 95: a phantom user opens your posters in media-player windows. One stops responding and is dragged round
  // the screen, smearing copies of itself everywhere, until an error box appears and a defragmenter sorts the mess into
  // colour order, block by block, and the desktop comes back clean.
  SAVERS.desktop95 = { name: "Desktop 95: Meltdown", make(S) {
    const FONT = "Tahoma, Verdana, sans-serif", TEAL = "#008080";
    let smear, sm, icons = [], wins = [], cur = { x: 0, y: 0, down: false, busy: false }, sel = null, zoom = null, dialog = null, defrag = null, round = 0, gen, task;
    const bevel = (c, x, y, w, h, up = true) => {
      c.fillStyle = "#c0c0c0"; c.fillRect(x, y, w, h);
      c.fillStyle = up ? "#fff" : "#808080"; c.fillRect(x, y, w, 1); c.fillRect(x, y, 1, h);
      c.fillStyle = up ? "#000" : "#fff"; c.fillRect(x, y + h - 1, w, 1); c.fillRect(x + w - 1, y, 1, h);
      c.fillStyle = up ? "#808080" : "#000"; c.fillRect(x + 1, y + h - 2, w - 2, 1); c.fillRect(x + w - 2, y + 1, 1, h - 2);
    };
    function drawWin(c, w) {
      const { x, y } = w, W2 = w.w, H2 = w.h;
      bevel(c, x, y, W2, H2);
      const g = c.createLinearGradient(x, 0, x + W2, 0); g.addColorStop(0, w.hung ? "#808080" : "#000080"); g.addColorStop(1, w.hung ? "#c0c0c0" : "#1084d0");
      c.fillStyle = g; c.fillRect(x + 3, y + 3, W2 - 6, 18);
      c.fillStyle = "#fff"; c.font = `bold 11px ${FONT}`; c.textAlign = "left"; c.textBaseline = "middle";
      c.fillText(`${trunc(w.a.title, Math.max(8, Math.floor((W2 - 70) / 6) - 17))}${w.hung ? " (Not Responding)" : " - Media Player"}`, x + 8, y + 12);
      for (let i = 0; i < 3; i++) { bevel(c, x + W2 - 21 - i * 18, y + 5, 16, 14); }
      c.fillStyle = "#000"; c.font = `bold 10px ${FONT}`; c.textAlign = "center";
      ["×", "□", "_"].forEach((s, i) => c.fillText(s, x + W2 - 13 - i * 18, y + 12));
      c.fillStyle = "#000"; c.fillRect(x + 4, y + 24, W2 - 8, H2 - 50);
      const iw = w.a.poster.naturalWidth || w.a.poster.width, ih = w.a.poster.naturalHeight || w.a.poster.height, k = Math.min((W2 - 8) / iw, (H2 - 50) / ih);
      c.drawImage(w.a.poster, x + W2 / 2 - (iw * k) / 2, y + 24 + (H2 - 50) / 2 - (ih * k) / 2, iw * k, ih * k);
      bevel(c, x + 4, y + H2 - 23, W2 - 8, 19, false);
      c.fillStyle = "#000080"; for (let i = 0; i < Math.floor(w.prog * 20); i++) c.fillRect(x + 8 + i * ((W2 - 90) / 20), y + H2 - 19, (W2 - 90) / 20 - 2, 11);
      c.fillStyle = "#000"; c.textAlign = "right"; c.font = `11px ${FONT}`;
      c.fillText(w.a.minutes ? `${Math.floor(w.prog * w.a.minutes)}:00 / ${w.a.minutes}:00` : "Playing", x + W2 - 10, y + H2 - 13);
      c.textBaseline = "alphabetic";
    }
    function drawIcon(c, ic) {
      c.drawImage(ic.thumb, ic.x + 4, ic.y, 32, 44); c.strokeStyle = "#000"; c.strokeRect(ic.x + 4.5, ic.y + .5, 31, 43);
      c.font = `11px ${FONT}`; c.textAlign = "center"; const label = trunc(ic.a.title, 10) + ".avi", tw = c.measureText(label).width;
      if (sel === ic) { c.fillStyle = "#000080"; c.fillRect(ic.x + 20 - tw / 2 - 2, ic.y + 48, tw + 4, 14); }
      c.fillStyle = "#fff"; c.fillText(label, ic.x + 20, ic.y + 59);
    }
    function drawCursor(c) {
      const { x, y } = cur;
      if (cur.busy) { c.fillStyle = "#fff"; c.strokeStyle = "#000"; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 12, y); c.lineTo(x + 6, y + 8); c.lineTo(x + 12, y + 16); c.lineTo(x, y + 16); c.lineTo(x + 6, y + 8); c.closePath(); c.fill(); c.stroke(); return; }
      const P = [[0, 0], [0, 17], [4, 13], [7, 20], [9, 19], [6, 12], [12, 12]];
      c.beginPath(); P.forEach(([a, b], i) => (i ? c.lineTo(x + a, y + b) : c.moveTo(x + a, y + b))); c.closePath();
      c.fillStyle = "#fff"; c.fill(); c.strokeStyle = "#000"; c.lineWidth = 1; c.stroke();
    }
    function drawTaskbar(c) {
      const { W, H } = S, y = H - 30;
      bevel(c, 0, y, W, 30); bevel(c, 3, y + 3, 58, 24);
      [["#f00", 0, 0], ["#0a0", 6, 0], ["#00f", 0, 6], ["#ff0", 6, 6]].forEach(([col, a, b]) => { c.fillStyle = col; c.fillRect(9 + a, y + 9 + b, 5, 5); });
      c.fillStyle = "#000"; c.font = `bold 12px ${FONT}`; c.textAlign = "left"; c.fillText("Start", 25, y + 20);
      wins.forEach((w, i) => { bevel(c, 68 + i * 150, y + 3, 144, 24, i !== wins.length - 1); c.fillStyle = "#000"; c.font = `11px ${FONT}`; c.fillText(trunc(w.a.title, 20), 76 + i * 150, y + 19); });
      bevel(c, W - 92, y + 3, 88, 24, false); c.fillStyle = "#000"; c.textAlign = "center"; c.fillText(clock(false), W - 48, y + 19);
    }
    const wait = (d) => ({ d, f: null });
    const run = (d, f) => ({ d, f });
    function* moveTo(x, y, d) {
      const x0 = cur.x, y0 = cur.y, mx = (x0 + x) / 2 + rand(-120, 120), my = (y0 + y) / 2 + rand(-120, 120);
      yield run(d, (p) => { const k = ease(p), u = 1 - k; cur.x = u * u * x0 + 2 * u * k * mx + k * k * x; cur.y = u * u * y0 + 2 * u * k * my + k * k * y; });
    }
    function* click() { cur.down = true; yield wait(.08); cur.down = false; yield wait(.07); }
    function* script() {
      for (;;) {
        const { W, H } = S;
        wins = []; sm.clearRect(0, 0, W, H);
        for (let k = 0; k < 3; k++) {
          const ic = icons[(round * 3 + k) % icons.length];
          yield* moveTo(ic.x + 20, ic.y + 20, .9);
          sel = ic; yield* click(); yield* click(); yield wait(.15);
          const ww = Math.min(W * .34, 460), wh = Math.min(H * .62, ww * 1.25), to = { x: W * .2 + k * W * .08, y: H * .08 + k * H * .06, w: ww, h: wh };
          yield run(.35, (p) => { zoom = { x: lerp(ic.x, to.x, p), y: lerp(ic.y, to.y, p), w: lerp(40, to.w, p), h: lerp(60, to.h, p) }; });
          zoom = null; sel = null;
          wins.push({ a: ic.a, ...to, prog: rand(.1, .5), hung: false });
          yield wait(.5);
        }
        // the top window stops responding and gets dragged in loops, smearing as it goes
        const w = wins[wins.length - 1];
        yield wait(.6); w.hung = true; cur.busy = true; yield wait(1.2); cur.busy = false;
        yield* moveTo(w.x + w.w * .4, w.y + 10, .6);
        cur.down = true; w.smear = true;
        const x0 = w.x, y0 = w.y, fa = rand(1.5, 2.5), fb = rand(2.5, 3.5);
        yield run(7, (p) => {
          const a = p * TAU;
          w.x = x0 + Math.sin(a * fa) * W * .3 + (W * .5 - x0 - w.w / 2) * Math.sin(p * Math.PI);
          w.y = y0 + Math.sin(a * fb) * H * .22 + (H * .4 - y0 - w.h / 2) * Math.sin(p * Math.PI);
          cur.x = w.x + w.w * .4; cur.y = w.y + 10;
          drawWin(sm, w);
        });
        cur.down = false;
        // the error box
        dialog = { a: w.a, w: 420, h: 150 }; dialog.x = (W - dialog.w) / 2; dialog.y = (H - dialog.h) / 2;
        yield wait(.9);
        yield* moveTo(dialog.x + dialog.w - 120 + 37, dialog.y + dialog.h - 34 + 11, .8);
        yield* click(); dialog = null;
        // the defragmenter sorts the screen into colour order
        yield* defragment();
        round++;
      }
    }
    function* defragment() {
      const { W, H } = S, B = 24, cols = Math.ceil(W / B), rows = Math.ceil((H - 30) / B);
      const snap = canvas(S.cv.width, S.cv.height); snap.getContext("2d").drawImage(S.cv, 0, 0);
      const small = canvas(cols, rows), sx = small.getContext("2d", { willReadFrequently: true });
      sx.drawImage(snap, 0, 0, cols * B * S.dpr, rows * B * S.dpr, 0, 0, cols, rows);
      const d = sx.getImageData(0, 0, cols, rows).data, key = [];
      for (let i = 0; i < cols * rows; i++) {
        const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, s = mx - mn;
        let h = 0; if (s > 0) h = mx === r ? ((g - b) / s) % 6 : mx === g ? (b - r) / s + 2 : (r - g) / s + 4;
        key.push(s < .12 ? l - 2 : ((h + 6) % 6) + l * .5);
      }
      // slots run column by column; block ids are the screen's row-major order, so start with each slot holding its own block
      const N = cols * rows, perm = Array.from({ length: N }, (_, i) => (i % rows) * cols + Math.floor(i / rows)), where = new Array(N);
      perm.forEach((b, i) => { where[b] = i; });
      const target = [...Array(N).keys()].sort((a, b) => key[a] - key[b]);
      defrag = { snap, B, cols, rows, perm, k: 0, N };
      while (defrag.k < N) {
        yield run(1 / 60, () => {});
        for (let s = 0; s < Math.ceil(N / 300) && defrag.k < N; s++, defrag.k++) {
          const k = defrag.k, want = target[k], j = where[want], other = perm[k];
          perm[k] = want; perm[j] = other; where[want] = k; where[other] = j;
        }
      }
      yield wait(1.6);
      defrag = null; wins = []; sm.clearRect(0, 0, W, H);
      yield wait(.5);
    }
    return {
      resize() {
        const { W, H } = S;
        smear = canvas(W * S.dpr, H * S.dpr); sm = smear.getContext("2d"); sm.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
        const per = Math.max(1, Math.floor((H - 50) / 78));
        icons = S.art.slice(0, per * 2).map((a, i) => ({ a, thumb: cover(a.poster, 64, 88), x: 14 + Math.floor(i / per) * 100, y: 14 + (i % per) * 78 }));
        cur = { x: W / 2, y: H / 2, down: false, busy: false };
        gen = script(); task = null;
      },
      frame(t, dt) {
        const { ctx: c, W, H } = S;
        if (!task || task.e >= task.d) { task = { ...gen.next().value, e: 0 }; }
        task.e += dt; task.f && task.f(Math.min(1, task.e / task.d));
        if (defrag) {
          const { snap, B, cols, perm, k, N } = defrag;
          c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
          // slot i is filled column by column, so the sorted colours run left to right
          for (let i = 0; i < N; i++) { const s = perm[i]; c.drawImage(snap, (s % cols) * B * S.dpr, Math.floor(s / cols) * B * S.dpr, B * S.dpr, B * S.dpr, Math.floor(i / defrag.rows) * B, (i % defrag.rows) * B, B, B); }
          if (k < N) { c.strokeStyle = "#ff0"; c.lineWidth = 2; c.strokeRect(Math.floor(k / defrag.rows) * B, (k % defrag.rows) * B, B, B); }
          const dw = 380, dh = 120, dx = (W - dw) / 2, dy = (H - dh) / 2;
          bevel(c, dx, dy, dw, dh); const g = c.createLinearGradient(dx, 0, dx + dw, 0); g.addColorStop(0, "#000080"); g.addColorStop(1, "#1084d0");
          c.fillStyle = g; c.fillRect(dx + 3, dy + 3, dw - 6, 18); c.fillStyle = "#fff"; c.font = `bold 11px ${FONT}`; c.textAlign = "left"; c.fillText("Defragmenting Drive C", dx + 8, dy + 16);
          c.fillStyle = "#000"; c.font = `11px ${FONT}`; c.fillText(k < N ? `Sorting your screen by colour… ${Math.floor((k / N) * 100)}% complete` : "Defragmentation is complete.", dx + 14, dy + 48);
          bevel(c, dx + 14, dy + 60, dw - 28, 20, false); c.fillStyle = "#000080";
          for (let i = 0; i < Math.floor((k / N) * 30); i++) c.fillRect(dx + 17 + i * ((dw - 34) / 30), dy + 63, (dw - 34) / 30 - 2, 14);
          drawTaskbar(c); drawCursor(c); return;
        }
        c.fillStyle = TEAL; c.fillRect(0, 0, W, H);
        icons.forEach((ic) => drawIcon(c, ic));
        for (const w of wins) { if (!w.smear) { w.prog = Math.min(1, w.prog + dt / 200); drawWin(c, w); } }
        c.drawImage(smear, 0, 0, W, H);
        if (zoom) { c.strokeStyle = "#000"; c.setLineDash([2, 2]); c.strokeRect(zoom.x, zoom.y, zoom.w, zoom.h); c.setLineDash([]); }
        if (dialog) {
          const { x, y, w, h } = dialog;
          bevel(c, x, y, w, h); const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, "#000080"); g.addColorStop(1, "#1084d0");
          c.fillStyle = g; c.fillRect(x + 3, y + 3, w - 6, 18); c.fillStyle = "#fff"; c.font = `bold 11px ${FONT}`; c.textAlign = "left"; c.fillText("Media Player", x + 8, y + 16);
          c.fillStyle = "#f00"; c.beginPath(); c.arc(x + 36, y + 56, 16, 0, TAU); c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 3;
          c.beginPath(); c.moveTo(x + 29, y + 49); c.lineTo(x + 43, y + 63); c.moveTo(x + 43, y + 49); c.lineTo(x + 29, y + 63); c.stroke(); c.lineWidth = 1;
          c.fillStyle = "#000"; c.font = `11px ${FONT}`;
          c.fillText("This program has performed an illegal operation", x + 66, y + 48); c.fillText("and will be shut down.", x + 66, y + 63);
          c.fillText(trunc(`"${dialog.a.title}" was too good to stop.`, 52), x + 66, y + 86);
          bevel(c, x + w - 120, y + h - 34, 74, 22, !cur.down); c.textAlign = "center"; c.fillText("Close", x + w - 83, y + h - 19);
        }
        drawTaskbar(c); drawCursor(c);
      },
    };
  } };

  // MISSION HUD: a gimbal camera hunts across a backdrop in amber, finds its most detailed spots and locks onto them
  // one by one with telemetry, while the radar sweeps your library as contacts and the tapes and horizon drift.
  SAVERS.hud = { name: "Mission HUD: Target Lock", make(S) {
    const AMB = "#ffb000", CY = "#4de1ff", A = (al) => `rgba(255,176,0,${al})`;
    let idx = 0, sc = null, next = null, log = [], ovl;
    const say = (s) => { log.push(`${clock(false)}  ${s}`); log = log.slice(-6); };
    function scene() {
      const a = S.art[idx++ % S.art.length], IW = 960, IH = Math.round((IW * S.H) / S.W), d = pixels(wide(a), IW, IH), L = stretch(lums(d)), p = d.data;
      // dimmed, so the instruments stay readable on top
      for (let i = 0; i < L.length; i++) { const l = L[i] * .62; p[i * 4] = 255 * Math.pow(l, .9); p[i * 4 + 1] = 176 * l; p[i * 4 + 2] = 40 * l * l; }
      const mono = canvas(IW, IH); mono.getContext("2d").putImageData(d, 0, 0);
      // targets: the busiest cells of a 12 x 7 grid
      const GX = 12, GY = 7, cells = [];
      for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
        let s = 0, s2 = 0, n = 0;
        for (let y = Math.floor((gy * IH) / GY); y < ((gy + 1) * IH) / GY; y += 3) for (let x = Math.floor((gx * IW) / GX); x < ((gx + 1) * IW) / GX; x += 3) { const l = L[y * IW + x]; s += l; s2 += l * l; n++; }
        cells.push({ x: (gx + .5) / GX, y: (gy + .5) / GY, v: s2 / n - (s / n) ** 2 });
      }
      cells.sort((u, v) => v.v - u.v);
      const tg = [];
      for (const cl of cells) { if (tg.every((q) => Math.hypot(q.x - cl.x, q.y - cl.y) > .22)) tg.push(cl); if (tg.length === 4) break; }
      say(`NEW SCENE · ${trunc(a.title.toUpperCase(), 30)}`);
      return { a, mono, IW, IH, tg, k: 0, phase: "seek", pt: 0, cam: { x: .5, y: .5, z: 1.15 }, ret: { x: S.W / 2, y: S.H / 2 }, from: { x: S.W / 2, y: S.H / 2 } };
    }
    const view = (s) => { const vw = s.IW / s.cam.z, vh = s.IH / s.cam.z; return { sx: clamp(s.cam.x * s.IW - vw / 2, 0, s.IW - vw), sy: clamp(s.cam.y * s.IH - vh / 2, 0, s.IH - vh), vw, vh }; };
    const toScreen = (s, q) => { const v = view(s); return { x: ((q.x * s.IW - v.sx) / v.vw) * S.W, y: ((q.y * s.IH - v.sy) / v.vh) * S.H }; };
    function brackets(c, x, y, r, col) {
      c.strokeStyle = col; c.lineWidth = 2; const l = r * .4;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.beginPath(); c.moveTo(x + dx * r, y + dy * (r - l)); c.lineTo(x + dx * r, y + dy * r); c.lineTo(x + dx * (r - l), y + dy * r); c.stroke(); }
    }
    return {
      resize() {
        ovl = canvas(S.W, S.H); const x = ovl.getContext("2d");
        x.fillStyle = "rgba(0,0,0,.25)"; for (let y = 0; y < S.H; y += 3) x.fillRect(0, y, S.W, 1);
        const g = x.createRadialGradient(S.W / 2, S.H / 2, S.H * .3, S.W / 2, S.H / 2, S.H * .95); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.85)");
        x.fillStyle = g; x.fillRect(0, 0, S.W, S.H);
        sc = scene();
      },
      frame(t, dt) {
        const { ctx: c, W, H } = S, s = sc;
        s.pt += dt;
        const tgt = s.tg[s.k] || { x: .5, y: .5 };
        s.cam.x = lerp(s.cam.x, tgt.x, dt * .6); s.cam.y = lerp(s.cam.y, tgt.y, dt * .6);
        s.cam.z = lerp(s.cam.z, s.phase === "locked" ? 1.6 : 1.2, dt * .8);
        c.fillStyle = "#0a0804"; c.fillRect(0, 0, W, H);
        const v = view(s);
        if (s.phase === "slew") {
          const k = s.pt / .9;
          for (let i = 0; i < 6; i++) { c.globalAlpha = .18; c.drawImage(s.mono, v.sx, v.sy, v.vw, v.vh, -k * W * 1.5 * (i / 6), 0, W, H); }
          c.globalAlpha = 1;
          if (k >= 1) { sc = next || scene(); next = null; }
        } else c.drawImage(s.mono, v.sx, v.sy, v.vw, v.vh, 0, 0, W, H);
        c.font = `${Math.round(H * .015)}px ${MONO}`; c.textAlign = "left";
        const pos = toScreen(s, tgt), size = Math.min(W, H) * .07;
        if (s.phase === "seek") {
          const k = ease(Math.min(1, s.pt / 1.6)); s.ret.x = lerp(s.from.x, pos.x, k) + Math.sin(t * 7) * 6 * (1 - k); s.ret.y = lerp(s.from.y, pos.y, k);
          if (s.pt > 1.6) { s.phase = "lock"; s.pt = 0; }
        } else { s.ret.x = pos.x; s.ret.y = pos.y; }
        const r = s.phase === "lock" ? lerp(size * 2.6, size, ease(Math.min(1, s.pt / 1.2))) : s.phase === "locked" ? size : size * 1.4;
        if (s.phase !== "slew") {
          brackets(c, s.ret.x, s.ret.y, r, s.phase === "locked" ? CY : AMB);
          c.strokeStyle = A(.7); c.lineWidth = 1; c.beginPath(); c.moveTo(s.ret.x - 10, s.ret.y); c.lineTo(s.ret.x + 10, s.ret.y); c.moveTo(s.ret.x, s.ret.y - 10); c.lineTo(s.ret.x, s.ret.y + 10); c.stroke();
        }
        if (s.phase === "lock") {
          if (Math.floor(t * 6) % 2) { c.fillStyle = AMB; c.fillText("LOCKING", s.ret.x + r + 10, s.ret.y - r); }
          if (s.pt > 1.2) { s.phase = "locked"; s.pt = 0; say(`TGT-0${s.k + 1} LOCKED · BRG ${pad(Math.round(tgt.x * 360), 3)}`); }
        } else if (s.phase === "locked") {
          const a = s.a, lines = [`TGT-0${s.k + 1}  LOCK`, `BRG  ${pad(Math.round(tgt.x * 360), 3)}°`, `RNG  ${a.minutes ? a.minutes + " MIN" : "---"}`, `ALT  ${a.year || "----"}`, `IFF  ${a.rating ? "★ " + a.rating : "---"}`];
          if (s.k === 0) lines.unshift(`DESIGNATE ${trunc(a.title.toUpperCase(), 22)}`);
          const bx = s.ret.x + r + 16 + 240 > W ? s.ret.x - r - 256 : s.ret.x + r + 16, by = s.ret.y - r;
          c.fillStyle = "rgba(10,8,4,.75)"; c.fillRect(bx - 6, by - 4, 246, lines.length * 18 + 10); c.strokeStyle = CY; c.strokeRect(bx - 6, by - 4, 246, lines.length * 18 + 10);
          c.fillStyle = CY; lines.forEach((l, i) => c.fillText(l, bx + 4, by + 14 + i * 18));
          if (s.pt > 1.8) {
            s.k++; s.pt = 0; s.from = { ...s.ret };
            if (s.k >= s.tg.length) { s.phase = "slew"; next = scene(); say("SLEW TO NEXT SCENE"); } else s.phase = "seek";
          }
        }
        // heading tape
        const hdg = (200 + Math.sin(t * .1) * 60 + s.cam.x * 40 + 360) % 360, tw = W * .5;
        c.save(); c.beginPath(); c.rect(W / 2 - tw / 2, 0, tw, 60); c.clip();
        c.strokeStyle = A(.8); c.fillStyle = AMB; c.textAlign = "center";
        for (let d = Math.floor(hdg - 30); d <= hdg + 30; d++) {
          if (d % 5) continue; const x = W / 2 + (d - hdg) * 12; c.beginPath(); c.moveTo(x, 20); c.lineTo(x, d % 15 ? 28 : 34); c.stroke();
          if (!(d % 15)) { const dd = ((d % 360) + 360) % 360; c.fillText({ 0: "N", 90: "E", 180: "S", 270: "W" }[dd] || pad(dd, 3), x, 50); }
        }
        c.restore(); c.fillStyle = CY; c.beginPath(); c.moveTo(W / 2, 14); c.lineTo(W / 2 - 6, 6); c.lineTo(W / 2 + 6, 6); c.fill();
        // altitude and speed tapes
        const tape = (x, val, step, label, right) => {
          c.save(); c.beginPath(); c.rect(x - 50, H * .3, 100, H * .4); c.clip(); c.strokeStyle = A(.7); c.fillStyle = AMB; c.textAlign = right ? "left" : "right";
          for (let v2 = Math.floor((val - step * 6) / step) * step; v2 < val + step * 6; v2 += step) { const y = H / 2 - ((v2 - val) / step) * 26; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (right ? 10 : -10), y); c.stroke(); c.fillText(String(v2), x + (right ? 14 : -14), y + 4); }
          c.restore(); c.strokeStyle = CY; c.strokeRect(x - (right ? 0 : 70), H / 2 - 11, 70, 22); c.fillStyle = CY; c.textAlign = "center"; c.fillText(String(Math.round(val)), x + (right ? 35 : -35), H / 2 + 5);
          c.fillStyle = AMB; c.fillText(label, x + (right ? 35 : -35), H * .3 - 10);
        };
        tape(W * .1, 12000 + Math.sin(t * .07) * 3000, 100, "ALT", false);
        tape(W * .9, 480 + Math.sin(t * .13) * 60, 10, "KTS", true);
        // horizon ladder
        const roll = Math.sin(t * .3) * .08, pitch = Math.sin(t * .17) * 30;
        c.save(); c.translate(W / 2, H / 2 + pitch); c.rotate(roll); c.strokeStyle = A(.6); c.lineWidth = 1.5;
        for (const o of [-80, -40, 0, 40, 80]) { c.beginPath(); c.moveTo(-160, o); c.lineTo(-60, o); c.moveTo(60, o); c.lineTo(160, o); c.stroke(); }
        c.restore();
        // radar: your library as contacts
        const rx = W * .1, ry = H * .82, rr = Math.min(W, H) * .11, sw = (t * 1.2) % TAU;
        c.strokeStyle = A(.5); c.lineWidth = 1;
        for (let i = 1; i <= 3; i++) { c.beginPath(); c.arc(rx, ry, (rr * i) / 3, 0, TAU); c.stroke(); }
        c.beginPath(); c.moveTo(rx - rr, ry); c.lineTo(rx + rr, ry); c.moveTo(rx, ry - rr); c.lineTo(rx, ry + rr); c.stroke();
        const g = c.createConicGradient(sw - .9, rx, ry); g.addColorStop(0, A(0)); g.addColorStop(.14, A(.35)); g.addColorStop(.1401, A(0)); g.addColorStop(1, A(0));
        c.fillStyle = g; c.beginPath(); c.arc(rx, ry, rr, 0, TAU); c.fill();
        S.art.forEach((a, i) => {
          const ang = i * 2.39996, dist = (.25 + ((i * .618) % 1) * .7) * rr, since = (((sw - ang) % TAU) + TAU) % TAU, al = Math.max(0, 1 - since / 4);
          if (al <= 0) return; c.fillStyle = a === s.a ? `rgba(77,225,255,${al})` : A(al);
          c.beginPath(); c.arc(rx + Math.cos(ang) * dist, ry + Math.sin(ang) * dist, 3, 0, TAU); c.fill();
        });
        // corner frame, clocks and the log
        c.strokeStyle = A(.8); c.lineWidth = 2;
        for (const [x, y, dx, dy] of [[20, 20, 1, 1], [W - 20, 20, -1, 1], [20, H - 20, 1, -1], [W - 20, H - 20, -1, -1]]) { c.beginPath(); c.moveTo(x, y + dy * 40); c.lineTo(x, y); c.lineTo(x + dx * 40, y); c.stroke(); }
        c.fillStyle = AMB; c.textAlign = "left"; const el = Math.floor(t);
        c.fillText(`MISSION T+ ${pad(Math.floor(el / 3600), 2)}:${pad(Math.floor(el / 60) % 60, 2)}:${pad(el % 60, 2)}`, 40, 46); c.fillText(clock(), 40, 66);
        c.textAlign = "right"; log.forEach((l, i) => { c.globalAlpha = .4 + (i / log.length) * .6; c.fillText(l, W - 40, H - 46 - (log.length - 1 - i) * 18); }); c.globalAlpha = 1;
        c.drawImage(ovl, 0, 0, W, H);
      },
    };
  } };

  // THERMAL VISION: your backdrops as heat, through a thermal camera. Heat sources wander the scene and their plumes
  // rise and spread; the camera tracks the hottest and coldest points, reads the centre, and changes palette with a wipe.
  SAVERS.thermal = { name: "Thermal Vision: Heat Signature", make(S) {
    const PALS = [["IRONBOW", ["#000000", "#10002a", "#3b0a6b", "#7a0f8a", "#c4204f", "#f05a1e", "#fca20e", "#fde34d", "#ffffff"]],
      ["RAINBOW HC", ["#000010", "#1b0cff", "#00b4ff", "#00ff87", "#c8ff00", "#ffb000", "#ff2000", "#ffffff"]],
      ["WHITE HOT", ["#000000", "#ffffff"]], ["LAVA", ["#0a001a", "#3d0a5c", "#ff3d6e", "#f55214", "#ffcc33", "#fff6e6"]]]
      .map(([name, stops]) => { const L = new Uint8Array(768), cs = stops.map(hex); for (let i = 0; i < 256; i++) { const f = (i / 255) * (cs.length - 1), k = Math.min(cs.length - 2, Math.floor(f)), m = f - k; for (let ch = 0; ch < 3; ch++) L[i * 3 + ch] = lerp(cs[k][ch], cs[k + 1][ch], m); } return { name, L }; });
    const GW = 200;
    let GH, low, lx, img, base, baseB, D, D2, mix = 1, idx = 0, swap = 0, pal = 0, wipe = null, item, hot = { x: .5, y: .5 }, cold = { x: .5, y: .5 }, grain, rec = 0;
    const bodies = Array.from({ length: 4 }, () => ({ x: rand(), y: rand(.3, .9), ph: rand(100), heat: rand(.4, .8) }));
    function heatOf(a) {
      const d = pixels(wide(a), GW, GH), p = d.data, L = stretch(lums(d)), out = new Float32Array(GW * GH);
      for (let i = 0; i < out.length; i++) out[i] = clamp(.72 * L[i] + .28 * clamp((p[i * 4] - p[i * 4 + 2]) / 255 + .5));
      return out;
    }
    function load(first) { item = S.art[idx++ % S.art.length]; const h = heatOf(item); baseB = first ? h : base; base = h; mix = first ? 1 : 0; }
    return {
      resize() {
        GH = Math.round((GW * S.H) / S.W); low = canvas(GW, GH); lx = low.getContext("2d"); img = lx.createImageData(GW, GH);
        D = new Float32Array(GW * GH); D2 = new Float32Array(GW * GH); load(true);
        grain = canvas(256, 256); const g = grain.getContext("2d"), gd = g.createImageData(256, 256);
        for (let i = 0; i < gd.data.length; i += 4) { const v = Math.random() * 255; gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = v; gd.data[i + 3] = 40; }
        g.putImageData(gd, 0, 0);
      },
      frame(t, dt) {
        const { ctx: c, W, H } = S;
        if ((swap += dt) > 16) { swap = 0; load(false); }
        mix = Math.min(1, mix + dt / 2);
        if (!wipe && Math.random() < dt / 22) wipe = { to: (pal + 1) % PALS.length, x: 0 };
        if (wipe && (wipe.x += dt / 1.6) >= 1) { pal = wipe.to; wipe = null; }
        // wandering heat sources and their rising plumes
        for (const b of bodies) {
          b.x = clamp(b.x + (noise(b.ph, t * .15) - .5) * dt * .25, .05, .95); b.y = clamp(b.y + (noise(b.ph + 50, t * .15) - .5) * dt * .18, .2, .95);
          const cx = b.x * GW, cy = b.y * GH, rx = GW * .035, ry = GH * .1;
          for (let y = Math.max(0, Math.floor(cy - ry * 2)); y < Math.min(GH, cy + ry * 2); y++) for (let x = Math.max(0, Math.floor(cx - rx * 2)); x < Math.min(GW, cx + rx * 2); x++) {
            D[y * GW + x] += b.heat * Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)) * dt * .8;
          }
        }
        for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
          const k = y * GW + x;
          D2[k] = Math.min(.55, .975 * (.4 * D[k] + .15 * (D[k - (x > 0 ? 1 : 0)] + D[k + (x < GW - 1 ? 1 : 0)]) + .3 * D[k + (y < GH - 1 ? GW : 0)]));
        }
        [D, D2] = [D2, D];
        const p = img.data, P0 = PALS[pal].L, P1 = wipe ? PALS[wipe.to].L : P0, wx = wipe ? wipe.x * GW : -1;
        let mx = -1, mn = 9, mxk = 0, mnk = 0;
        for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
          const k = y * GW + x, sh = clamp(Math.round(x + Math.sin(y * .25 + t * 4) * D[k] * 3), 0, GW - 1), kk = y * GW + sh;
          const T = clamp(lerp(baseB[kk], base[kk], mix) * .8 + D[k], 0, 1);
          if (T > mx) { mx = T; mxk = k; } if (T < mn) { mn = T; mnk = k; }
          const L = x < wx ? P1 : P0, li = ((T * 255) | 0) * 3, o = k * 4;
          p[o] = L[li]; p[o + 1] = L[li + 1]; p[o + 2] = L[li + 2]; p[o + 3] = 255;
        }
        lx.putImageData(img, 0, 0);
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.drawImage(low, 0, 0, W, H);
        c.globalAlpha = .5; const gx = rand(-256, 0), gy = rand(-256, 0);
        for (let y = gy; y < H; y += 256) for (let x = gx; x < W; x += 256) c.drawImage(grain, x, y);
        c.globalAlpha = 1;
        const deg = (T) => (12 + T * 34).toFixed(1);
        hot.x = lerp(hot.x, (mxk % GW) / GW, dt * 3); hot.y = lerp(hot.y, Math.floor(mxk / GW) / GH, dt * 3);
        cold.x = lerp(cold.x, (mnk % GW) / GW, dt * 3); cold.y = lerp(cold.y, Math.floor(mnk / GW) / GH, dt * 3);
        c.font = `600 ${Math.round(H * .016)}px ${MONO}`; c.lineWidth = 1.5;
        // markers stay clear of the header, footer and scale
        const hx = clamp(hot.x * W, 30, W - 230), hy = clamp(hot.y * H, 90, H - 110), cx2 = clamp(cold.x * W, 30, W - 230), cy2 = clamp(cold.y * H, 90, H - 110);
        c.strokeStyle = "#fff"; c.fillStyle = "#fff"; c.strokeRect(hx - 13, hy - 13, 26, 26); c.textAlign = "left"; c.fillText(`▲ MAX ${deg(mx)}°C`, hx + 18, hy + 4);
        c.strokeStyle = "#7dd8ff"; c.fillStyle = "#7dd8ff"; c.strokeRect(cx2 - 10, cy2 - 10, 20, 20); c.fillText(`▼ MIN ${deg(mn)}°C`, cx2 + 15, cy2 + 4);
        // centre spot meter
        const cT = clamp(lerp(baseB[(GH >> 1) * GW + (GW >> 1)], base[(GH >> 1) * GW + (GW >> 1)], mix) * .8 + D[(GH >> 1) * GW + (GW >> 1)]);
        c.strokeStyle = "#fff"; c.fillStyle = "#fff"; c.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(W / 2 + dx * 8, H / 2 + dy * 8); c.lineTo(W / 2 + dx * 30, H / 2 + dy * 30); }
        c.stroke(); c.textAlign = "center"; c.fillText(`${deg(cT)}°C`, W / 2, H / 2 + 50);
        // palette scale
        const bx = W - 60, by = H * .2, bh = H * .6, P = (wipe ? PALS[wipe.to] : PALS[pal]).L;
        for (let i = 0; i < 64; i++) { const li = (255 - i * 4) * 3; c.fillStyle = `rgb(${P[li]},${P[li + 1]},${P[li + 2]})`; c.fillRect(bx, by + (i / 64) * bh, 18, bh / 64 + 1); }
        c.strokeStyle = "#fff"; c.strokeRect(bx, by, 18, bh); c.textAlign = "right"; c.fillStyle = "#fff";
        c.fillText(`${deg(1)}°`, bx - 6, by + 10); c.fillText(`${deg(0)}°`, bx - 6, by + bh);
        // camera chrome
        rec += dt; c.textAlign = "left";
        if (Math.floor(t * 1.5) % 2) { c.fillStyle = "#ff3d3d"; c.beginPath(); c.arc(44, 42, 7, 0, TAU); c.fill(); }
        c.fillStyle = "#fff"; c.fillText(`REC ${pad(Math.floor(rec / 60), 2)}:${pad(Math.floor(rec) % 60, 2)}   ε 0.95   AUTO   ${(wipe ? PALS[wipe.to] : PALS[pal]).name}`, 60, 47);
        c.textAlign = "right"; c.fillText(clock(), W - 40, 47);
        c.textAlign = "left"; c.font = `700 ${Math.round(H * .026)}px ${MONO}`; c.fillText(trunc(item.title.toUpperCase(), 40), 40, H - 70);
        c.font = `500 ${Math.round(H * .016)}px ${MONO}`;
        c.fillText(`SCENE ${item.year || "----"}   HEAT INDEX ${item.rating ? `★${item.rating} → ${(item.rating * 4 + 8).toFixed(1)}°C` : "n/a"}`, 40, H - 44);
      },
    };
  } };

  // CYBERPUNK: a poster cut into data strips, scrambled and glitching. A sorting algorithm you can watch (quick, heap,
  // shell or cocktail-shaker sort) swaps the strips back into place, the glitch easing as each one finds its slot, then
  // the decrypted poster is torn apart again for the next run.
  SAVERS.cyberpunk = { name: "Cyberpunk: Neural Sort", make(S) {
    const N = 36;
    const quick = (a) => { const ops = []; (function q(lo, hi) { if (lo >= hi) return; const pv = a[hi]; let i = lo; for (let j = lo; j < hi; j++) { ops.push(["c", j, hi]); if (a[j] < pv) { if (i !== j) { ops.push(["s", i, j]); [a[i], a[j]] = [a[j], a[i]]; } i++; } } if (i !== hi) { ops.push(["s", i, hi]); [a[i], a[hi]] = [a[hi], a[i]]; } q(lo, i - 1); q(i + 1, hi); })(0, a.length - 1); return ops; };
    const heap = (a) => { const ops = [], n = a.length; const sift = (st, e) => { let r = st; while (2 * r + 1 <= e) { const ch = 2 * r + 1; let sw = r; ops.push(["c", sw, ch]); if (a[sw] < a[ch]) sw = ch; if (ch + 1 <= e) { ops.push(["c", sw, ch + 1]); if (a[sw] < a[ch + 1]) sw = ch + 1; } if (sw === r) return; ops.push(["s", r, sw]); [a[r], a[sw]] = [a[sw], a[r]]; r = sw; } }; for (let st = (n >> 1) - 1; st >= 0; st--) sift(st, n - 1); for (let e = n - 1; e > 0; e--) { ops.push(["s", 0, e]); [a[0], a[e]] = [a[e], a[0]]; sift(0, e - 1); } return ops; };
    const shell = (a) => { const ops = []; for (let gap = a.length >> 1; gap > 0; gap >>= 1) for (let i = gap; i < a.length; i++) for (let j = i; j >= gap; j -= gap) { ops.push(["c", j - gap, j]); if (a[j - gap] > a[j]) { ops.push(["s", j - gap, j]); [a[j - gap], a[j]] = [a[j], a[j - gap]]; } else break; } return ops; };
    const shaker = (a) => { const ops = []; let lo = 0, hi = a.length - 1, sw = true; while (sw) { sw = false; for (let i = lo; i < hi; i++) { ops.push(["c", i, i + 1]); if (a[i] > a[i + 1]) { ops.push(["s", i, i + 1]); [a[i], a[i + 1]] = [a[i + 1], a[i]]; sw = true; } } hi--; for (let i = hi; i > lo; i--) { ops.push(["c", i - 1, i]); if (a[i - 1] > a[i]) { ops.push(["s", i - 1, i]); [a[i - 1], a[i]] = [a[i], a[i - 1]]; sw = true; } } lo++; } return ops; };
    const ALGOS = [["QUICKSORT", quick], ["HEAPSORT", heap], ["SHELLSORT", shell], ["COCKTAIL SHAKER", shaker]];
    const KANJI = ["電脳都市", "侵入成功", "夜の市場", "解読中"];
    const rain = Array.from({ length: 170 }, () => ({ x: rand(1.2), y: rand(), l: rand(.015, .05), v: rand(.5, 1.1), c: Math.random() < .12 ? (Math.random() < .5 ? "rgba(0,240,255,.55)" : "rgba(255,0,60,.5)") : "rgba(170,200,230,.2)" }));
    let job, idx = 0;
    function newJob() {
      const { W, H } = S, a = S.art[idx++ % S.art.length], img = wide(a), iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const k = Math.min((W * .52) / iw, (H * .78) / ih), bw = Math.round(iw * k), bh = Math.round(ih * k), bx = Math.round(W * .38 + (W * .52 - bw) / 2), by = Math.round((H - bh) / 2);
      const src = cover(img, Math.round(bw * S.dpr), Math.round(bh * S.dpr)), d = src.getContext("2d").getImageData(0, 0, src.width, src.height);
      const ch = [0, 1, 2].map((n) => { const c2 = canvas(src.width, src.height), dd = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height); for (let i = 0; i < dd.data.length; i += 4) for (let q = 0; q < 3; q++) if (q !== n) dd.data[i + q] = 0; c2.getContext("2d").putImageData(dd, 0, 0); return c2; });
      const perm = shuffle([...Array(N).keys()]), [algo, fn] = pick(ALGOS), ops = fn(perm.slice());
      const weight = ops.map((o) => (o[0] === "s" ? 1 : .25)), total = weight.reduce((s, w) => s + w, 0), unit = 14 / total;
      job = { a, bx, by, bw, bh, ch, perm, ops, weight, unit, i: 0, e: 0, algo, cmps: 0, swaps: 0, phase: "sort", pt: 0 };
    }
    const disorder = () => job.perm.reduce((s, src, i) => s + Math.abs(src - i), 0) / ((N * N) / 2);
    return {
      resize() { newJob(); },
      frame(t, dt) {
        const { ctx: c, W, H } = S, j = job;
        j.pt += dt;
        c.fillStyle = "#07070b"; c.fillRect(0, 0, W, H);
        c.lineWidth = 1;
        for (const d of rain) { d.y += d.v * dt; d.x -= d.v * dt * .25; if (d.y > 1) { d.y = -d.l; d.x = rand(1.2); } c.strokeStyle = d.c; c.beginPath(); c.moveTo(d.x * W, d.y * H); c.lineTo(d.x * W + d.l * H * .25, d.y * H - d.l * H); c.stroke(); }
        // neon kanji down the right edge
        const kj = KANJI[idx % KANJI.length]; c.font = `900 ${Math.round(H * .07)}px "Noto Sans JP", sans-serif`; c.textAlign = "center";
        c.fillStyle = `rgba(255,0,60,${S.reduced ? .5 : .4 + .2 * Math.sin(t * 3)})`; c.shadowColor = "#ff003c"; c.shadowBlur = 24;
        [...kj].forEach((ch, i) => c.fillText(ch, W * .97, H * .18 + i * H * .085)); c.shadowBlur = 0;
        // the sort
        let op = null, q = 0;
        if (j.phase === "sort") {
          j.e += dt;
          while (j.i < j.ops.length && j.e >= j.weight[j.i] * j.unit) {
            j.e -= j.weight[j.i] * j.unit; const [kind, a2, b2] = j.ops[j.i];
            if (kind === "s") { [j.perm[a2], j.perm[b2]] = [j.perm[b2], j.perm[a2]]; j.swaps++; } else j.cmps++;
            j.i++;
          }
          if (j.i >= j.ops.length) { j.phase = "done"; j.pt = 0; } else { op = j.ops[j.i]; q = clamp(j.e / (j.weight[j.i] * j.unit)); }
        } else if (j.phase === "done" && j.pt > 4.5) { j.phase = "scatter"; j.pt = 0; }
        else if (j.phase === "scatter" && j.pt > 1.3) { newJob(); return; }
        const sh = j.bh / N, ssh = (j.bh * S.dpr) / N;
        c.fillStyle = "#000"; c.fillRect(j.bx - 6, j.by - 6, j.bw + 12, j.bh + 12);
        c.globalCompositeOperation = "lighter";
        for (let s = 0; s < N; s++) {
          const src = j.perm[s]; let y = j.by + s * sh, xo = 0;
          if (op && op[0] === "s" && (s === op[1] || s === op[2])) { const other = s === op[1] ? op[2] : op[1]; y = lerp(y, j.by + other * sh, ease(q)); xo = Math.sin(q * Math.PI) * 40 * (s === op[1] ? -1 : 1); }
          const dis = Math.abs(src - s) / N;
          let split = dis * 16 + 1.2; xo += (S.reduced ? 1 : Math.sin(t * 9 + s * 1.7)) * dis * W * .04;
          let al = 1;
          if (j.phase === "scatter") { const k = ease(Math.min(1, j.pt / 1.2)); xo += (s % 2 ? 1 : -1) * k * W * 1.1; split += k * 40; al = 1 - k; }
          c.globalAlpha = al;
          j.ch.forEach((cc, n) => c.drawImage(cc, 0, src * ssh, cc.width, ssh, j.bx + xo + (n - 1) * split, y, j.bw, sh + .6));
        }
        c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
        if (op) {
          c.strokeStyle = op[0] === "s" ? "#ff003c" : "#00f0ff"; c.lineWidth = 2;
          for (const s of [op[1], op[2]]) { const y = j.by + s * sh; c.beginPath(); c.moveTo(j.bx - 22, y); c.lineTo(j.bx - 8, y + sh / 2); c.lineTo(j.bx - 22, y + sh); c.stroke(); }
        }
        if (j.phase === "done") {
          const y = j.by + ((j.pt * .6) % 1) * j.bh, g = c.createLinearGradient(0, y - 30, 0, y);
          g.addColorStop(0, "rgba(0,240,255,0)"); g.addColorStop(1, "rgba(0,240,255,.35)"); c.fillStyle = g; c.fillRect(j.bx, y - 30, j.bw, 30);
        }
        // the code panel
        const px = W * .04, fs = Math.round(H * .018); let py = H * .16;
        c.save(); c.translate(px, py); c.transform(1, 0, -.25, 1, 0, 0);
        c.fillStyle = "#7b2fd0"; c.fillRect(0, -fs * 1.6, fs * 11, fs * 2.2); c.fillStyle = "#fff"; c.font = `900 ${Math.round(fs * 1.3)}px ${MONO}`; c.textAlign = "left"; c.fillText("NEURAL SORT", fs * .6, 0);
        c.restore(); py += fs * 3;
        c.font = `500 ${fs}px ${MONO}`; c.textAlign = "left";
        const dis = disorder(), rows = [["TARGET", trunc(j.a.title.toUpperCase(), 22)], ["ALGORITHM", j.algo], ["COMPARES", pad(j.cmps, 6)], ["SWAPS", pad(j.swaps, 6)],
          ["ENTROPY", "█".repeat(Math.round(dis * 12)).padEnd(12, "░") + ` ${Math.round(dis * 100)}%`]];
        rows.forEach(([k2, v], i) => { c.fillStyle = "#8197aa"; c.fillText(k2, px, py + i * fs * 1.7); c.fillStyle = i === 4 ? "#ff003c" : "#eaf7ff"; c.fillText(v, px + fs * 7, py + i * fs * 1.7); });
        py += fs * 10;
        for (let s = 0; s < Math.min(N, Math.floor((H * .92 - py) / (fs * 1.35))); s++) {
          const hot2 = op && (s === op[1] || s === op[2]);
          c.fillStyle = hot2 ? (op[0] === "s" ? "#ff003c" : "#00f0ff") : j.perm[s] === s ? "#7b2fd0" : "#3a4652";
          c.fillText(`0x${(0x7f3a0000 + s * 16).toString(16).toUpperCase()}  ${pad(j.perm[s].toString(16).toUpperCase(), 2)} ${j.perm[s] === s ? "OK" : "··"}`, px, py + s * fs * 1.35);
        }
        if (j.phase === "done") {
          const ty = j.by - 24, title = trunc(j.a.title.toUpperCase(), 36);
          c.save(); c.translate(j.bx, ty); c.transform(1, 0, -.25, 1, 0, 0); c.fillStyle = "#7b2fd0"; c.fillRect(0, -fs * 1.5, fs * 9, fs * 2.1);
          c.fillStyle = "#fff"; c.font = `900 ${Math.round(fs * 1.2)}px ${MONO}`; c.fillText("DECRYPTED", fs * .6, 0); c.restore();
          c.font = `900 ${Math.round(fs * 1.4)}px ${MONO}`; c.textAlign = "left";
          const gx = S.reduced ? 0 : Math.sin(t * 20) * 2;
          c.fillStyle = "rgba(255,0,60,.8)"; c.fillText(title, j.bx + fs * 10 + gx, ty); c.fillStyle = "rgba(0,240,255,.8)"; c.fillText(title, j.bx + fs * 10 - gx, ty);
          c.fillStyle = "#eaf7ff"; c.fillText(title, j.bx + fs * 10, ty);
        }
        c.font = `500 ${Math.round(fs * .8)}px ${MONO}`; c.fillStyle = "#3a4652"; c.textAlign = "right"; c.fillText(clock(), W * .96, H * .96);
      },
    };
  } };

  // SAKURA: a mosaic of ~2,400 petals. They drift on a curling wind, gather into the poster in a woodblock-print
  // palette, hold while its title is brushed in, then a gust sweeps across and scatters them for the next one.
  SAVERS.sakura = { name: "Sakura: Petal Mosaic", make(S) {
    const PAL = ["#1f1a17", "#3a2f2a", "#5c4033", "#8a6b4e", "#b8862b", "#e0c48c", "#f5efe3", "#d23a2a", "#9b2c22", "#e98a7a", "#f2b8b0", "#2f4b7c", "#6f8fe0", "#3f6b4f", "#89a76f"];
    const PRGB = PAL.map(hex), sprites = new Map();
    let bg, petals = [], cols, rows, cell, box, phase = "drift", pt = 0, idx = 0, item = null;
    function sprite(col) {
      let s = sprites.get(col); if (s) return s;
      s = canvas(24, 24); const x = s.getContext("2d"); x.translate(12, 12); x.fillStyle = col;
      x.beginPath(); x.moveTo(0, -11); x.bezierCurveTo(10, -8, 10, 6, 0, 11); x.bezierCurveTo(-10, 6, -10, -8, 0, -11); x.fill();
      x.globalCompositeOperation = "destination-out"; x.beginPath(); x.moveTo(-2.5, -12); x.lineTo(0, -7); x.lineTo(2.5, -12); x.fill();
      x.globalCompositeOperation = "source-over"; x.strokeStyle = "rgba(255,255,255,.14)"; x.beginPath(); x.moveTo(0, -6); x.lineTo(0, 8); x.stroke();
      sprites.set(col, s); return s;
    }
    function colours() {
      item = S.art[idx++ % S.art.length];
      const d = pixels(item.poster, cols, rows).data;
      petals.forEach((p, i) => {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; let best = 0, bd = 1e9;
        PRGB.forEach(([R, G, B], k) => { const dd = 2 * (r - R) ** 2 + 4 * (g - G) ** 2 + 3 * (b - B) ** 2; if (dd < bd) { bd = dd; best = k; } });
        p.col = PAL[best];
      });
    }
    return {
      resize() {
        const { W, H } = S;
        const bh = H * .8, bw = (bh * 2) / 3; box = { x: W / 2 - bw / 2 + W * .06, y: H * .1, w: bw, h: bh };
        const N = 2400; cols = Math.round(Math.sqrt((N * bw) / bh)); rows = Math.round(N / cols); cell = bw / cols; box.h = rows * cell;
        petals = Array.from({ length: cols * rows }, (_, i) => ({ x: rand(W), y: rand(H), vx: 0, vy: 0, a: rand(TAU), va: rand(-2, 2), f: rand(TAU), vf: rand(2, 5),
          tx: box.x + ((i % cols) + .5) * cell, ty: box.y + (Math.floor(i / cols) + .5) * cell, s: cell * rand(1.35, 1.6), col: PAL[10], blown: false }));
        colours(); phase = "drift"; pt = 0;
        bg = canvas(W * S.dpr, H * S.dpr); const b = bg.getContext("2d"); b.scale(S.dpr, S.dpr);
        b.fillStyle = "#1f1a17"; b.fillRect(0, 0, W, H);
        const g = b.createRadialGradient(W * .82, H * .24, 0, W * .82, H * .24, H * .24); g.addColorStop(0, "rgba(210,58,42,.85)"); g.addColorStop(.92, "rgba(210,58,42,.75)"); g.addColorStop(1, "rgba(210,58,42,0)");
        b.fillStyle = g; b.beginPath(); b.arc(W * .82, H * .24, H * .24, 0, TAU); b.fill();
        b.strokeStyle = "rgba(245,239,227,.07)"; b.lineWidth = 1.2; const R = 28;
        for (let row = 0, y = H; y > H * .84; row++, y -= R * .5) for (let x = (row % 2) * R; x < W + R; x += R * 2) for (let k = 1; k <= 4; k++) { b.beginPath(); b.arc(x, y, (R * k) / 4, Math.PI, TAU); b.stroke(); }
        for (let i = 0; i < 2500; i++) { b.fillStyle = `rgba(245,239,227,${rand(.015, .04)})`; b.fillRect(rand(W), rand(H), rand(1, 3), rand(1, 3)); }
      },
      frame(t, dt) {
        const { ctx: c, W, H, dpr } = S;
        pt += dt;
        if (phase === "drift" && pt > 4) { phase = "gather"; pt = 0; }
        else if (phase === "gather" && pt > 5.5) { phase = "hold"; pt = 0; }
        else if (phase === "hold" && pt > 6.5) { phase = "gust"; pt = 0; petals.forEach((p) => { p.blown = false; }); }
        else if (phase === "gust" && pt > 2.6) { phase = "drift"; pt = 0; colours(); }
        c.drawImage(bg, 0, 0, W, H);
        const gx = phase === "gust" ? lerp(-W * .1, W * 1.1, pt / 2.6) : -1;
        const K = phase === "gather" ? ease(Math.min(1, pt / 4)) * 9 : 9;
        // the title, brushed in while the picture holds
        if (phase === "hold" || phase === "gust") {
          const chars = [...item.title].slice(0, 14), fs = Math.round(Math.min(H * .05, (H * .8) / Math.max(6, chars.length))), shown = phase === "hold" ? Math.floor(pt * 5) : chars.length;
          c.font = `700 ${fs}px "Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif`; c.textAlign = "center"; c.fillStyle = "#f5efe3";
          c.globalAlpha = phase === "gust" ? 1 - pt / 2.6 : 1;
          chars.slice(0, shown).forEach((ch, i) => c.fillText(ch, box.x - fs * 1.4, box.y + fs + i * fs * 1.1));
          if (item.year && shown >= chars.length) {
            const sy = box.y + fs * 1.4 + chars.length * fs * 1.1; c.fillStyle = "#d23a2a"; c.fillRect(box.x - fs * 2.1, sy, fs * 1.4, fs * 1.4);
            c.fillStyle = "#f5efe3"; c.font = `700 ${Math.round(fs * .45)}px serif`; c.fillText(String(item.year), box.x - fs * 1.4, sy + fs * .85);
          }
          c.globalAlpha = 1;
        }
        for (const p of petals) {
          if (phase === "drift" || p.blown) {
            const ang = noise(p.x * .003 + t * .05, p.y * .003) * TAU * 1.5, tvx = Math.cos(ang) * 40 + 60, tvy = Math.sin(ang) * 40 + 18;
            p.vx += (tvx - p.vx) * dt * 1.5; p.vy += (tvy - p.vy) * dt * 1.5;
            p.a += p.va * dt; p.f += p.vf * dt;
          } else if (phase === "gust" && p.x < gx) {
            p.blown = true; p.vx += rand(250, 520); p.vy += rand(-220, 40); p.va = rand(-7, 7);
          } else {
            p.vx += ((p.tx - p.x) * K - p.vx * 4.5) * dt; p.vy += ((p.ty - p.y) * K - p.vy * 4.5) * dt;
            const settle = phase === "gather" ? ease(Math.min(1, pt / 5)) : 1;
            p.a += (Math.atan2(Math.sin(-p.a), Math.cos(-p.a))) * dt * 3 * settle; p.f += (Math.atan2(Math.sin(-p.f), Math.cos(-p.f))) * dt * 3 * settle + (phase === "hold" ? Math.sin(t * 2 + p.tx) * dt * .3 : 0);
          }
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (phase === "drift" || p.blown) { if (p.x > W + 30) p.x -= W + 60; if (p.y > H + 30) p.y -= H + 60; if (p.y < -30) p.y += H + 60; }
          const k = p.s / 24, sx = Math.max(.15, Math.abs(Math.cos(p.f))), ca = Math.cos(p.a), sa = Math.sin(p.a);
          c.setTransform(dpr * ca * sx * k, dpr * sa * sx * k, -dpr * sa * k, dpr * ca * k, dpr * p.x, dpr * p.y);
          c.drawImage(sprite(p.col), -12, -12);
        }
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.font = `400 ${Math.round(H * .016)}px "Noto Serif JP", serif`; c.textAlign = "right"; c.fillStyle = "rgba(245,239,227,.5)"; c.fillText(clock(false), W - 30, H - 26);
      },
    };
  } };

  // ---- running one ----
  let active = null;
  const ORDER = ["neon", "terminal", "cosmos", "blueprint", "lava", "desktop95", "hud", "thermal", "cyberpunk", "sakura"];
  function themeNow() {
    for (const l of document.querySelectorAll("link[rel=stylesheet]")) { const m = /\/themes\/homepage\/([a-z0-9]+)\/theme\.css/.exec(l.href || ""); if (m && !l.disabled && SAVERS[m[1]]) return m[1]; }
    return pick(ORDER);
  }
  function start(key, manual) {
    if (active) active.kill();
    const def = SAVERS[key] || SAVERS[themeNow()];
    const el = document.createElement("div"), cv = document.createElement("canvas");
    el.className = "hp-screensaver";
    el.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#000;opacity:0;transition:opacity .9s ease;cursor:none;";
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    el.append(cv); document.body.append(el);
    const S = { cv, ctx: cv.getContext("2d"), W: 0, H: 0, dpr: 1, art: [], t: 0, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
    let raf = 0, saver = null, last = 0, dead = false;
    const size = () => {
      S.dpr = Math.min(devicePixelRatio || 1, 1.5); S.W = innerWidth; S.H = innerHeight;
      cv.width = Math.round(S.W * S.dpr); cv.height = Math.round(S.H * S.dpr);
      S.ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      saver?.resize?.();
    };
    size(); addEventListener("resize", size);
    const loop = (now) => {
      if (dead) return;
      const dt = Math.min(.05, last ? (now - last) / 1000 : .016) * (S.reduced ? .35 : 1);
      last = now; S.t += dt;
      S.ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); S.ctx.globalAlpha = 1; S.ctx.globalCompositeOperation = "source-over"; S.ctx.shadowBlur = 0;
      try { saver.frame(S.t, dt); } catch (e) { console.error("[homepage screensavers]", e); return; }
      raf = requestAnimationFrame(loop);
    };
    getArt().then((art) => {
      if (dead) return;
      S.art = art.length ? art : standIns();
      saver = def.make(S); saver.resize?.();
      requestAnimationFrame(() => { el.style.opacity = "1"; });
      raf = requestAnimationFrame(loop);
    });
    const me = {
      kill() { dead = true; cancelAnimationFrame(raf); removeEventListener("resize", size); el.remove(); unbind(); if (active === me) active = null; },
      fade() { return new Promise((res) => { el.style.opacity = "0"; setTimeout(() => { me.kill(); res(); }, 700); }); },
    };
    // started by hand: close on input (after a moment, so the click that opened it doesn't)
    const quit = () => { if (performance.now() - t0 > 600) me.fade(); }, t0 = performance.now();
    const evs = ["pointermove", "pointerdown", "keydown", "wheel"];
    const unbind = () => manual && evs.forEach((ev) => removeEventListener(ev, quit, true));
    if (manual) evs.forEach((ev) => addEventListener(ev, quit, true));
    active = me;
  }
  const stop = () => (active ? active.fade() : Promise.resolve());
  window.hpScreensaver = (key) => start(key || themeNow(), true);
  window.hpScreensaverChosen = () => {
    try { const uid = window.ApiClient?.getCurrentUserId?.(); const v = uid && localStorage.getItem(`${uid}-screensaver`); return !!v && v !== "none"; } catch { return false; }
  };

  // ---- add them to Jellyfin's screensaver list ----
  function pluginManager() {
    let pm = null;
    try {
      self.webpackChunk.push([[Symbol("hp-screensavers")], {}, (req) => {
        for (const id of Object.keys(req.m)) {
          const src = Function.prototype.toString.call(req.m[id]);
          if (!src.includes("pluginsList") || !src.includes("ofType")) continue;
          const ex = req(id);
          for (const k in ex) if (ex[k] && typeof ex[k].ofType === "function" && Array.isArray(ex[k].pluginsList)) pm = ex[k];
        }
      }]);
    } catch { /* the web client isn't up yet */ }
    return pm;
  }
  function register(tries = 0) {
    const pm = self.webpackChunk && pluginManager();
    if (!pm) { if (tries < 120) setTimeout(() => register(tries + 1), 500); return; }
    const list = [["homepagematch", "Homepage: match my theme", null], ...ORDER.map((k) => ["homepage" + k, SAVERS[k].name, k])];
    for (const [id, name, key] of list) {
      if (pm.pluginsList.some((p) => p.id === id)) continue;
      pm.pluginsList.push({ name, id, type: "screensaver", supportsAnonymous: false, show: () => start(key || themeNow(), false), hide: stop });
    }
  }
  register();
})();
