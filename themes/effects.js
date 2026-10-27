/* Effects for the Homepage themes in Jellyfin, ported from ~/homepage/themes/loader.js.
 * Loaded on every page by the JavaScript Injector plugin (entry "Homepage theme effects", src /web/themes/homepage/effects.js).
 * Watches which theme Jellyfin has loaded (Settings > Display > Theme) and runs that theme's effect; switching theme
 * stops the old one. Nothing runs while a video plays, in a hidden tab, or with prefers-reduced-motion (static frame
 * only). Homepage "service cards" map to Jellyfin cards (.card / .cardScalable), "groups" to section titles. */
(() => {
  if (window.__hpFx) return;
  window.__hpFx = true;
  const root = document.documentElement;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BASE = "/web/themes/homepage/";
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // overlay styles for the effects
  const css = el("link"); css.rel = "stylesheet"; css.href = BASE + "effects.css"; document.head.appendChild(css);

  // ---- shared state: pointer, hovered card, video playing ----
  let px = innerWidth / 2, py = innerHeight / 2, hot = null;
  addEventListener("pointermove", (e) => {
    px = e.clientX; py = e.clientY;
    hot = e.target.closest?.(".card") || null;
  }, { passive: true });
  const cardBox = (c) => (c.querySelector(".cardScalable") || c).getBoundingClientRect();
  const cardName = (c) => (c.querySelector(".cardText-first") || c.querySelector(".cardText"))?.textContent?.trim() || "";
  const playing = () => location.hash.startsWith("#/video") || !!document.querySelector(".videoPlayerContainer:not(.hide)");
  const paused = () => document.hidden || playing();

  // ---- lifecycle: each effect returns a cleanup function ----
  const live = new Set();
  const track = (fn) => { live.add(fn); return fn; };
  const on = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); track(() => target.removeEventListener(ev, fn, opt)); };
  const every = (ms, fn) => { const id = setInterval(fn, ms); track(() => clearInterval(id)); };
  const later = (ms, fn) => { const id = setTimeout(fn, ms); track(() => clearTimeout(id)); };
  const add = (node, parent = document.body) => { parent.appendChild(node); track(() => node.remove()); return node; };

  const canvas = (opacity = 1, fps = 30, scale = 1) => {
    const c = el("canvas"); c.id = "hp-fx-canvas";
    c.style.cssText = `position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:${opacity}`;
    document.body.prepend(c); track(() => c.remove());
    const ctx = c.getContext("2d");
    const size = () => { c.width = Math.ceil(innerWidth * scale); c.height = Math.ceil(innerHeight * scale); };
    size(); on(window, "resize", size);
    let last = 0, alive = true; track(() => { alive = false; });
    const run = (draw) => {
      const loop = (now) => {
        if (!alive) return;
        requestAnimationFrame(loop);
        if (paused() || now - last < 1000 / fps) return;
        last = now; draw(ctx, c.width, c.height, now);
      };
      if (still) draw(ctx, c.width, c.height, 0); else requestAnimationFrame(loop);
    };
    return { c, ctx, run };
  };
  const raf = (fn) => { let q = false; return () => { if (!q) { q = true; requestAnimationFrame(() => { q = false; fn(); }); } }; };

  // Pointing at a card animates its title (every theme but Cyberpunk, whose "decrypt" is its own): a copy of the title,
  // one <i> per letter (--i = its index, --n = the count), is laid over the real one for effects.css to animate per theme,
  // and removed when the last letter's animation ends. Each letter must run one animation only, delayed by --i.
  const titles = () => {
    if (still) return;
    on(document, "pointerover", (e) => {
      const card = e.target.closest?.(".card");
      if (!card || card.contains(e.relatedTarget)) return;
      const t = card.querySelector(".cardText-first") || card.querySelector(".cardText"), txt = t?.textContent?.trim();
      if (!txt || t.querySelector(".hp-tt")) return;
      const o = el("span", "hp-tt"), chars = [...txt].slice(0, 80);
      o.setAttribute("aria-hidden", "true"); o.style.setProperty("--n", chars.length);
      chars.forEach((ch, i) => { const c = el("i", null, ch); c.style.setProperty("--i", i); o.append(c); });
      let id = 0;
      const done = () => { clearTimeout(id); o.remove(); if (!t.querySelector(".hp-tt")) t.classList.remove("hp-tt-on"); };
      o.addEventListener("animationend", (ev) => { if (ev.target === o.lastElementChild) done(); });
      id = setTimeout(done, 6000); // in case an animation never runs (hidden tab, card re-rendered)
      t.classList.add("hp-tt-on"); t.append(o);
    });
    track(() => document.querySelectorAll(".hp-tt").forEach((o) => { o.parentElement?.classList.remove("hp-tt-on"); o.remove(); }));
  };

  const FX = {
    // Cursor leaves a trail of cyan/magenta pixel sparks.
    neon() {
      titles();
      const { run } = canvas(1, 60);
      const sparks = []; let lx = px, ly = py, dirty = false;
      run((ctx, w, h) => {
        const d = Math.hypot(px - lx, py - ly);
        if (!d && !sparks.length) { if (dirty) { ctx.clearRect(0, 0, w, h); dirty = false; } return; }
        dirty = true; ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < Math.min(6, d / 6); i++) sparks.push({ x: lx + (px - lx) * (i / 6) + (Math.random() - .5) * 8, y: ly + (py - ly) * (i / 6) + (Math.random() - .5) * 8,
          vx: (Math.random() - .5) * 1.5, vy: Math.random() * 1.8 + .3, life: 1, s: 2 + Math.random() * 3, h: Math.random() < .5 ? 320 : 185 });
        lx = px; ly = py;
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]; s.x += s.vx; s.y += s.vy; s.vy += .05; s.life -= .035;
          if (s.life <= 0) { sparks.splice(i, 1); continue; }
          const x = Math.round(s.x / 3) * 3, y = Math.round(s.y / 3) * 3;
          ctx.fillStyle = `hsla(${s.h},100%,60%,${s.life * .25})`; ctx.fillRect(x - 3, y - 3, s.s + 6, s.s + 6);
          ctx.fillStyle = `hsla(${s.h},100%,72%,${s.life})`; ctx.fillRect(x, y, s.s, s.s);
        }
      });
    },

    // Matrix rain; the column under the cursor lights up white.
    terminal() {
      titles();
      const { run } = canvas(.22, 20, .5);
      const glyphs = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789<>/\\{}$#".split("");
      const cell = 8; let drops = [];
      run((ctx, w, h) => {
        const cols = Math.ceil(w / cell);
        if (drops.length !== cols) drops = Array.from({ length: cols }, () => Math.random() * -50);
        ctx.fillStyle = "rgba(0,8,0,.12)"; ctx.fillRect(0, 0, w, h);
        ctx.font = `${cell}px monospace`;
        const under = Math.floor((px * .5) / cell);
        for (let i = 0; i < cols; i++) {
          ctx.fillStyle = i === under ? "#e8ffe8" : Math.random() < .03 ? "#b8ffb8" : "#2bff52";
          ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * cell, drops[i] * cell);
          if (drops[i] * cell > h && Math.random() > .975) drops[i] = 0;
          drops[i] += i === under ? 1.6 : 1;
        }
      });
    },

    // Three-layer parallax starfield that tilts with the cursor, plus shooting stars.
    cosmos() {
      titles();
      const { run } = canvas(1, 24);
      let stars = null; const shots = [];
      run((ctx, w, h, now) => {
        stars ||= Array.from({ length: Math.min(160, w / 7) }, () => ({ x: Math.random() * w, y: Math.random() * h, z: .2 + Math.random() * .8, ph: Math.random() * 6.28, hue: [210, 270, 330, 50][(Math.random() * 4) | 0] }));
        ctx.clearRect(0, 0, w, h);
        const ox = px / w - .5, oy = py / h - .5;
        for (const s of stars) {
          const x = (s.x - ox * 60 * s.z + w) % w, y = (s.y - oy * 60 * s.z + h) % h;
          ctx.fillStyle = `hsla(${s.hue},90%,${s.z > .8 ? 90 : 75}%,${(.35 + .65 * Math.abs(Math.sin(now / 900 + s.ph))) * s.z})`;
          ctx.beginPath(); ctx.arc(x, y, s.z * 1.5, 0, 6.28); ctx.fill();
        }
        if (Math.random() < .012) shots.push({ x: Math.random() * w, y: Math.random() * h * .5, vx: 9 + Math.random() * 6, vy: 4 + Math.random() * 3, life: 1 });
        for (let i = shots.length - 1; i >= 0; i--) {
          const s = shots[i]; s.x += s.vx; s.y += s.vy; s.life -= .025;
          if (s.life <= 0) { shots.splice(i, 1); continue; }
          const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 9, s.y - s.vy * 9);
          g.addColorStop(0, `rgba(255,255,255,${s.life})`); g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 9, s.y - s.vy * 9); ctx.stroke();
        }
      });
    },

    // Drafting-table crosshair with a live coordinate readout; the hovered card's width shows as a dimension.
    blueprint() {
      titles();
      if (matchMedia("(hover: none)").matches) return;
      const v = add(el("div", "bp-x bp-v")), hz = add(el("div", "bp-x bp-h")), read = add(el("div", "bp-read"));
      const pad = (n) => String(Math.max(0, Math.round(n))).padStart(4, "0");
      on(window, "pointermove", raf(() => {
        v.style.transform = `translateX(${px}px)`; hz.style.transform = `translateY(${py}px)`;
        read.style.transform = `translate(${px + 14}px, ${py + 14}px)`;
        const w = hot ? `   W ${pad(cardBox(hot).width)} MM` : "";
        read.textContent = `X ${pad(px)}  Y ${pad(py + scrollY)}${w}`;
      }), { passive: true });
    },

    // Metaball lava drawn at 1/5 resolution and stretched; the cursor is one more blob.
    lava() {
      titles();
      const { run } = canvas(.9, 24, .2);
      const balls = Array.from({ length: 9 }, (_, i) => ({ ph: i * 1.9, sp: .00005 + Math.random() * .00006, r: .045 + Math.random() * .05, x: .06 + Math.random() * .88 }));
      let img = null;
      run((ctx, w, h, now) => {
        if (!img || img.width !== w || img.height !== h) img = ctx.createImageData(w, h);
        const d = img.data, R = Math.max(w, h);
        const bs = balls.map((b) => ({ x: (b.x + .06 * Math.sin(now * b.sp * 2.3 + b.ph)) * w, y: (.5 + .6 * Math.sin(now * b.sp + b.ph)) * h, rr: (b.r * R) ** 2 }));
        bs.push({ x: (px / innerWidth) * w, y: (py / innerHeight) * h, rr: (.035 * R) ** 2 });
        for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
          let f = 0;
          for (const b of bs) { const dx = x - b.x, dy = y - b.y; f += b.rr / (dx * dx + dy * dy + 1); }
          if (f < .9) { d[i + 3] = 0; continue; }
          const k = Math.min(1, (f - 1) / 3);
          d[i] = 255; d[i + 1] = 45 + 120 * k; d[i + 2] = 85 - 45 * k; d[i + 3] = f < 1 ? ((f - .9) / .1) * 255 : 255;
        }
        ctx.putImageData(img, 0, 0);
      });
    },

    // A working taskbar: your libraries as task buttons, a Start menu (sections on this page, Screensaver, Shut Down…),
    // a clock, and a bouncing-logo screensaver after 90 s idle (never while a video plays).
    desktop95() {
      titles();
      const bar = add(el("div")); bar.id = "w95-bar";
      const start = el("button", "w95-start"); start.type = "button"; start.setAttribute("aria-expanded", "false");
      start.append(el("b", "w95-logo", "⊞"), " Start");
      const tasks = el("div", "w95-tasks"), tray = el("div", "w95-tray"), clock = el("span");
      tray.append(clock); bar.append(start, tasks, tray);
      const menu = add(el("div")); menu.id = "w95-menu"; menu.hidden = true;
      const side = el("div", "w95-side"); side.append(el("b", null, "Jellyfin"), "95");
      const list = el("ul"); menu.append(side, list);

      const sections = () => [...document.querySelectorAll(".mainAnimatedPage:not(.hide) h2.sectionTitle")].filter((h) => h.offsetParent).map((h) => ({ h, name: h.textContent.trim() })).filter((x) => x.name);
      const libs = () => [...document.querySelectorAll(".MuiAppBar-root a[href^='#/']")].map((a) => ({ href: a.getAttribute("href"), name: a.textContent.trim() || a.getAttribute("aria-label") || "" })).filter((x) => x.name);
      const item = (label, fn) => { const li = el("li"), b = el("button", null, label); b.type = "button"; b.onclick = () => { close(); fn(); }; li.append(b); return li; };
      const open = () => {
        const secs = sections().map(({ h, name }) => item(`📁  ${name}`, () => h.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" })));
        list.replaceChildren(...secs, ...(secs.length ? [el("hr")] : []), item("⚙  Settings", () => { location.hash = "#/mypreferencesmenu"; }), item("🖥  Screensaver", () => (window.hpScreensaver ? window.hpScreensaver("desktop95") : saver())), item("⏻  Shut Down…", shutdown));
        menu.hidden = false; start.setAttribute("aria-expanded", "true");
      };
      const close = () => { menu.hidden = true; start.setAttribute("aria-expanded", "false"); };
      start.onclick = (e) => { e.stopPropagation(); menu.hidden ? open() : close(); };
      on(document, "click", (e) => { if (!menu.contains(e.target)) close(); });
      on(document, "keydown", (e) => { if (e.key === "Escape") close(); });

      let names = "";
      const tick = () => {
        clock.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const ls = libs(), now = ls.map((x) => x.name).join("|");
        if (now !== names) { names = now; tasks.replaceChildren(...ls.map(({ href, name }) => { const b = el("button", null, name); b.type = "button"; b.onclick = () => { location.hash = href; }; return b; })); }
      };
      tick(); every(5000, tick);

      function shutdown() {
        root.classList.add("w95-off");
        later(still ? 0 : 650, () => {
          const safe = add(el("div", null, "It’s now safe to turn off your computer.")); safe.id = "w95-safe";
          safe.append(el("small", null, "click anywhere to restart"));
          const back = () => { safe.remove(); root.classList.remove("w95-off"); };
          safe.addEventListener("click", back); addEventListener("keydown", back, { once: true });
        });
      }
      let saving = false, lastInput = Date.now();
      ["pointermove", "pointerdown", "keydown", "wheel", "scroll"].forEach((ev) => on(window, ev, () => { lastInput = Date.now(); }, { passive: true }));
      // the built-in idle saver stands down once a Jellyfin screensaver is picked (screensavers.js), so two don't fight
      every(5000, () => { if (!saving && !paused() && !window.hpScreensaverChosen?.() && Date.now() - lastInput > 90000) saver(); });
      function saver() {
        if (saving || still) return;
        saving = true;
        const c = add(el("canvas")); c.id = "w95-saver";
        const ctx = c.getContext("2d"); c.width = innerWidth; c.height = innerHeight;
        const hues = [0, 45, 120, 190, 280, 320];
        let x = 80, y = 80, vx = 2.2, vy = 1.8, hue = 2, alive = true;
        const tw = 300, th = 70, started = Date.now();
        const draw = () => {
          if (!alive) return;
          requestAnimationFrame(draw);
          x += vx; y += vy;
          if (x < 0 || x + tw > c.width) { vx = -vx; hue = (hue + 1) % hues.length; }
          if (y < 0 || y + th > c.height) { vy = -vy; hue = (hue + 1) % hues.length; }
          ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);
          ctx.fillStyle = `hsl(${hues[hue]},100%,55%)`; ctx.font = "italic 900 54px Tahoma, Verdana, sans-serif"; ctx.textBaseline = "top";
          ctx.fillText("JELLYFIN", x, y + 6);
        };
        draw();
        const quit = () => { if (Date.now() - started < 400) return; alive = false; saving = false; c.remove(); lastInput = Date.now(); ["pointermove", "pointerdown", "keydown"].forEach((ev) => removeEventListener(ev, quit)); };
        ["pointermove", "pointerdown", "keydown"].forEach((ev) => addEventListener(ev, quit));
        track(() => { alive = false; saving = false; });
      }
    },

    // Target-lock reticle that snaps around the card you point at, plus a telemetry ticker of the titles on the page.
    hud() {
      titles();
      const lock = add(el("div")); lock.id = "hud-lock";
      for (let i = 0; i < 4; i++) lock.append(el("i"));
      const label = el("span"); lock.append(label);
      let cur = null;
      const place = raf(() => {
        if (hot && document.contains(hot)) {
          const r = cardBox(hot);
          lock.classList.add("on");
          lock.style.transform = `translate(${r.left - 6}px, ${r.top - 6}px)`; lock.style.width = r.width + 12 + "px"; lock.style.height = r.height + 12 + "px";
          if (cur !== hot) { cur = hot; label.textContent = `LOCK ▸ ${(cardName(hot) || "target").toUpperCase()}`; lock.classList.remove("blip"); void lock.offsetWidth; lock.classList.add("blip"); }
        } else {
          cur = null; lock.classList.remove("on"); label.textContent = "";
          lock.style.transform = `translate(${px - 18}px, ${py - 18}px)`; lock.style.width = lock.style.height = "36px";
        }
      });
      on(window, "pointermove", place, { passive: true }); on(window, "scroll", place, { passive: true, capture: true });

      const ticker = add(el("div")), trackEl = el("div");
      ticker.id = "hud-ticker"; ticker.setAttribute("aria-hidden", "true"); ticker.append(trackEl);
      const fill = () => {
        const seen = new Set();
        const parts = [...document.querySelectorAll(".mainAnimatedPage:not(.hide) .card")].map((c) => {
          const n = cardName(c); if (!n || seen.has(n)) return null; seen.add(n);
          const st = c.querySelector(".itemProgressBarForeground, .cardProgressBar") ? "▶ IN PROGRESS" : c.closest(".verticalSection")?.textContent?.match(/On Now/) ? "◉ ON AIR" : "▲ NOMINAL";
          return `${n.toUpperCase()} ${st}`;
        }).filter(Boolean).slice(0, 60);
        const text = parts.join("   ///   ");
        if (text && trackEl.dataset.t !== text) { trackEl.dataset.t = text; trackEl.textContent = `${text}   ///   ${text}   ///   `; }
      };
      fill(); every(5000, () => { if (!paused()) fill(); });
    },

    // Heat simulation at 1/10 resolution in an "ironbow" palette: the cursor is a warm hand, every card on screen
    // radiates warmth from its edges (the pointed-at one hottest), and a probe reads the temperature under the cursor.
    thermal() {
      titles();
      const S = .1;
      const { run } = canvas(1, 30, S);
      const stops = [[0, [10, 0, 26]], [.18, [42, 0, 96]], [.35, [118, 0, 140]], [.5, [200, 20, 92]], [.65, [245, 82, 20]], [.8, [255, 170, 0]], [.92, [255, 236, 96]], [1, [255, 255, 240]]];
      const lut = new Uint8ClampedArray(256 * 3);
      for (let i = 0; i < 256; i++) {
        const v = i / 255; let j = 0;
        while (j < stops.length - 2 && v > stops[j + 1][0]) j++;
        const [a, ca] = stops[j], [b, cb] = stops[j + 1], k = (v - a) / (b - a);
        for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = ca[ch] + (cb[ch] - ca[ch]) * k;
      }
      const probe = matchMedia("(hover: none)").matches ? null : add(el("div")); if (probe) probe.id = "th-read";
      let W = 0, H = 0, heat, next, img, src = [], srcAt = -1e9;
      const sources = () => {
        src = [...document.querySelectorAll(".mainAnimatedPage:not(.hide) .card")].map((c) => {
          const r = cardBox(c);
          return { x0: (r.left * S) | 0, y0: (r.top * S) | 0, x1: (r.right * S) | 0, y1: (r.bottom * S) | 0, t: c === hot ? 1 : .5 };
        }).filter((s) => s.y1 >= 0 && s.y0 < H && s.x1 >= 0 && s.x0 < W);
      };
      const touch = (x, y, s) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = y * W + x; heat[i] = Math.max(heat[i], s.t); };
      run((ctx, w, h, now) => {
        if (w !== W || h !== H) { W = w; H = h; heat = new Float32Array(W * H); next = new Float32Array(W * H); img = ctx.createImageData(W, H); }
        if (now - srcAt > 200) { srcAt = now; sources(); }
        const cx = (px * S) | 0, cy = (py * S) | 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < W && y < H) { const i = y * W + x; heat[i] = Math.min(1, heat[i] + .3 * (1 - (dx * dx + dy * dy) / 9)); }
        }
        for (const s of src) { for (let x = s.x0; x <= s.x1; x++) { touch(x, s.y0, s); touch(x, s.y1, s); } for (let y = s.y0; y <= s.y1; y++) { touch(s.x0, y, s); touch(s.x1, y, s); } }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x, c = heat[i];
          next[i] = ((c * 4 + (x ? heat[i - 1] : c) + (x < W - 1 ? heat[i + 1] : c) + (y ? heat[i - W] : c) + (y < H - 1 ? heat[i + W] : c)) / 8) * .972;
        }
        [heat, next] = [next, heat];
        const d = img.data;
        for (let i = 0, j = 0; i < heat.length; i++, j += 4) { const v = ((heat[i] > 1 ? 1 : heat[i]) * 255) | 0; d[j] = lut[v * 3]; d[j + 1] = lut[v * 3 + 1]; d[j + 2] = lut[v * 3 + 2]; d[j + 3] = 255; }
        ctx.putImageData(img, 0, 0);
        if (probe) {
          const t = heat[Math.min(H - 1, Math.max(0, cy)) * W + Math.min(W - 1, Math.max(0, cx))] || 0;
          probe.style.transform = `translate(${px + 18}px, ${py + 18}px)`; probe.textContent = `${(19 + t * 21).toFixed(1)} °C`;
        }
      });
    },

    // Slanted rain with a few neon-tinted drops; a pointed-at card's name, or side-drawer item (the Dashboard's menu and
    // the main app's), "decrypts" from glyph noise; random glitch bursts.
    cyberpunk() {
      const { run } = canvas(1, 30);
      const drops = [];
      run((ctx, w, h) => {
        const n = Math.min(160, w / 9);
        while (drops.length < n) drops.push({ x: Math.random() * w * 1.2, y: Math.random() * h, l: 10 + Math.random() * 22, v: 9 + Math.random() * 9,
          c: Math.random() < .12 ? (Math.random() < .5 ? "rgba(0,240,255,.55)" : "rgba(255,0,60,.5)") : "rgba(170,200,230,.22)" });
        ctx.clearRect(0, 0, w, h); ctx.lineWidth = 1;
        for (const d of drops) {
          d.y += d.v; d.x -= d.v * .25;
          if (d.y > h) { d.y = -d.l; d.x = Math.random() * w * 1.2; }
          ctx.strokeStyle = d.c; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * .25, d.y - d.l); ctx.stroke();
        }
      });
      const G = "アイウエオカキクケコサシスセソタチツテト01#$%&*<>/=+";
      on(document, "pointerover", (e) => {
        const card = e.target.closest?.(".card, .MuiListItemButton-root");
        if (!card || card.contains(e.relatedTarget)) return;
        const t = card.querySelector(".cardText-first") || card.querySelector(".cardText") || card.querySelector(".MuiListItemText-primary"),
          txt = t?.textContent?.trim();
        if (!txt || t.dataset.scr) return;
        const frames = 10; let f = 0;
        const step = () => {
          f++;
          const shown = Math.floor((txt.length * f) / frames);
          t.dataset.scr = [...txt].map((ch, i) => (i < shown || ch === " " ? ch : G[(Math.random() * G.length) | 0])).join("");
          if (f < frames) setTimeout(step, 35); else delete t.dataset.scr;
        };
        step();
      });
      if (still) return;
      const bars = add(el("div")); bars.id = "cp-bars";
      const burst = () => {
        if (!paused()) { root.classList.add("cp-glitch"); setTimeout(() => root.classList.remove("cp-glitch"), 300); }
        later(9000 + Math.random() * 14000, burst);
      };
      later(4000, burst);
      track(() => root.classList.remove("cp-glitch"));
    },

    // Cherry petals tumbling down; moving the cursor sideways blows them. Section titles get kanji labels.
    sakura() {
      titles();
      const KANJI = { "my media": "媒体", "continue watching": "続き", "next up": "次", "live tv": "生放送", "on now": "放送中", movies: "映画",
        shows: "番組", music: "音楽", favorites: "好き", collections: "収集", "recently added in movies": "新作", "recently added in shows": "新番組",
        "recently added in music": "新曲", programs: "番組表", recordings: "録画", schedule: "予定", series: "連続", channels: "局" };
      const label = () => document.querySelectorAll("h2.sectionTitle:not([data-kanji])").forEach((n) => {
        n.dataset.kanji = KANJI[n.textContent.trim().toLowerCase()] || "和";
      });
      label(); every(2000, label);
      track(() => document.querySelectorAll("h2.sectionTitle[data-kanji]").forEach((n) => delete n.dataset.kanji));
      const pinks = ["#f7b8c8", "#f4a6bb", "#fbd3dd", "#f29bb2"];
      const mk = (w, h, anywhere) => ({ x: Math.random() * w, y: anywhere ? Math.random() * h : -20, v: .5 + Math.random() * 1.1, s: 4 + Math.random() * 5,
        rot: Math.random() * 6.28, spin: (Math.random() - .5) * .05, ph: Math.random() * 6.28, c: pinks[(Math.random() * 4) | 0] });
      const { run } = canvas(1, 30);
      const petals = []; let wind = 0, lx = px;
      run((ctx, w, h, now) => {
        const n = Math.min(45, w / 30);
        while (petals.length < n) petals.push(mk(w, h, true));
        wind = wind * .96 + (px - lx) * .02; lx = px;
        ctx.clearRect(0, 0, w, h);
        for (const p of petals) {
          p.y += p.v; p.x += Math.sin(now / 1200 + p.ph) * .6 + wind + .3; p.rot += p.spin;
          if (p.y > h + 20 || p.x > w + 40 || p.x < -40) Object.assign(p, mk(w, h, false));
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.sin(now / 600 + p.ph)) * .6 + .4);
          ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * .62, 0, 0, 6.28); ctx.fill(); ctx.restore();
        }
      });
    },
  };

  // ---- follow the theme Jellyfin has loaded ----
  let active = null;
  const current = () => {
    for (const l of document.querySelectorAll("link[rel=stylesheet]")) {
      const m = /\/themes\/homepage\/([a-z0-9]+)\/theme\.css/.exec(l.href || "");
      if (m && !l.disabled) return m[1];
    }
    return null;
  };
  const stop = () => {
    for (const fn of [...live].reverse()) { try { fn(); } catch {} }
    live.clear();
    if (active) root.classList.remove("hp-fx", "hp-fx-" + active);
    active = null;
  };
  const sync = () => {
    const t = current();
    if (t === active) return;
    stop();
    if (!t || !FX[t]) return;
    active = t;
    root.classList.add("hp-fx", "hp-fx-" + t);
    try { FX[t](); } catch (e) { console.warn("[homepage theme effects]", t, e); }
  };
  // video playback: hide overlays (canvases already skip their frames)
  const video = () => root.classList.toggle("hp-fx-video", playing());
  const start = () => {
    sync(); video();
    // Jellyfin's React UI renders the theme <link> inside <body>, so watch the whole document (throttled to a frame)
    new MutationObserver(raf(sync)).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "disabled"] });
    addEventListener("hashchange", () => setTimeout(video, 300));
    setInterval(video, 2000);
  };
  document.body ? start() : addEventListener("DOMContentLoaded", start);
})();
