
// Animated weather backgrounds, drawn on <canvas id="bg"> behind the card.
// Usage: WeatherBG.set("rain")  (clear | night | cloudy | fog | rain | snow | storm)
(function () {
  const canvas = document.getElementById("bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
 
  let w = 0, h = 0;
  let scene = null;
  let themeName = "default";
  let raf = 0, last = 0, time = 0;
  let swapTimer = 0, resizeTimer = 0;
 
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
 
  // ---------- Cloud sprites (drawn once, reused every frame) ----------
  const CW = 480, CH = 200;
 
  function cloudSprite(rgb) {
    const c = document.createElement("canvas");
    c.width = CW; c.height = CH;
    const g = c.getContext("2d");
    const puffs = [[110, 125, 70], [190, 98, 85], [280, 112, 75], [350, 128, 60], [240, 132, 80], [150, 138, 60]];
    puffs.forEach(([x, y, r]) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${rgb},0.9)`);
      grad.addColorStop(0.6, `rgba(${rgb},0.45)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    });
    return c;
  }
 
  const sprites = {
    white: cloudSprite("255,255,255"),
    gray: cloudSprite("165,178,202"),
    dark: cloudSprite("58,64,96")
  };
 
  // ---------- Building blocks ----------
  function clouds(sprite, n, o) {
    const list = Array.from({ length: n }, () => {
      const scale = rand(o.minScale, o.maxScale);
      return {
        scale,
        x: rand(-CW * scale, w),
        y: rand(o.minY, o.maxY) * h,
        speed: o.speed * scale,
        alpha: o.alpha * rand(0.65, 1)
      };
    });
    return {
      draw(dt) {
        for (const c of list) {
          c.x += c.speed * dt;
          if (c.x > w) c.x = -CW * c.scale;
          ctx.globalAlpha = c.alpha;
          ctx.drawImage(sprite, c.x, c.y, CW * c.scale, CH * c.scale);
        }
        ctx.globalAlpha = 1;
      }
    };
  }
 
  function rain({ area, speed, slant, alpha }) {
    const newDrop = anywhere => ({
      x: rand(-slant * h, w),
      y: anywhere ? rand(0, h) : rand(-60, -10),
      len: rand(10, 22),
      v: speed * rand(0.8, 1.3)
    });
    const drops = Array.from({ length: Math.round((w * h) / area) }, () => newDrop(true));
    return {
      draw(dt) {
        ctx.strokeStyle = `rgba(214,228,255,${alpha})`;
        ctx.lineWidth = 1.3;
        ctx.lineCap = "round";
        ctx.beginPath();
        for (const d of drops) {
          d.y += d.v * dt;
          d.x += d.v * slant * dt;
          if (d.y > h + 20) Object.assign(d, newDrop(false));
          ctx.moveTo(d.x - slant * d.len, d.y - d.len);
          ctx.lineTo(d.x, d.y);
        }
        ctx.stroke();
      }
    };
  }
 
  function snow() {
    const flakes = Array.from({ length: Math.round((w * h) / 9000) }, () => ({
      x: rand(0, w), y: rand(0, h), r: rand(1.2, 4), phase: rand(0, TAU), sway: rand(8, 28)
    }));
    return {
      draw(dt, t) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        for (const f of flakes) {
          f.y += (18 + f.r * 9) * dt;
          f.x += Math.sin(t * 0.9 + f.phase) * f.sway * dt;
          if (f.y > h + 6) { f.y = -6; f.x = rand(0, w); }
          if (f.x > w + 6) f.x = -6; else if (f.x < -6) f.x = w + 6;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, TAU);
          ctx.fill();
        }
      }
    };
  }
 
  function sun() {
    const cx = w * 0.82, cy = h * 0.18;
    const R = clamp(Math.min(w, h) * 0.08, 36, 70);
    return {
      draw(dt, t) {
        const pulse = 1 + 0.04 * Math.sin(t * 1.2);
 
        // Soft glow
        let g = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 5 * pulse);
        g.addColorStop(0, "rgba(255,248,215,0.85)");
        g.addColorStop(1, "rgba(255,248,215,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
 
        // Slowly turning rays
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 0.05);
        g = ctx.createLinearGradient(R * 1.2, 0, R * 7, 0);
        g.addColorStop(0, "rgba(255,255,255,0.3)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        for (let i = 0; i < 14; i++) {
          ctx.rotate(TAU / 14);
          const len = (i % 2 ? 5.2 : 7) * R;
          ctx.beginPath();
          ctx.moveTo(R * 1.2, -R * 0.16);
          ctx.lineTo(len, -R * 0.5);
          ctx.lineTo(len, R * 0.5);
          ctx.lineTo(R * 1.2, R * 0.16);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
 
        // Sun disc
        g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.7, "#fff1a8");
        g.addColorStop(1, "#ffd95a");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R * pulse, 0, TAU);
        ctx.fill();
      }
    };
  }
 
  function stars() {
    const list = Array.from({ length: Math.round((w * h) / 5000) }, () => ({
      x: rand(0, w), y: rand(0, h), r: rand(0.3, 1.5), phase: rand(0, TAU), speed: rand(0.8, 2.6)
    }));
    const mx = w * 0.82, my = h * 0.17;
    const R = clamp(Math.min(w, h) * 0.055, 22, 40);
    let shoot = null;
    let nextShoot = rand(2, 5);
 
    return {
      draw(dt, t) {
        // Twinkling stars
        ctx.fillStyle = "#ffffff";
        for (const s of list) {
          ctx.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
 
        // Moon
        const g = ctx.createRadialGradient(mx, my, R * 0.8, mx, my, R * 5);
        g.addColorStop(0, "rgba(220,230,255,0.3)");
        g.addColorStop(1, "rgba(220,230,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#f3f0e2";
        ctx.beginPath();
        ctx.arc(mx, my, R, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(150,150,175,0.28)";
        [[-0.35, -0.25, 0.22], [0.3, 0.1, 0.3], [-0.1, 0.45, 0.16]].forEach(([dx, dy, k]) => {
          ctx.beginPath();
          ctx.arc(mx + dx * R, my + dy * R, k * R, 0, TAU);
          ctx.fill();
        });
 
        // Shooting star every so often
        nextShoot -= dt;
        if (!shoot && nextShoot <= 0) {
          shoot = { x: rand(0.1 * w, 0.7 * w), y: rand(0, 0.3 * h), vx: rand(500, 700), vy: rand(200, 300), life: 0 };
          nextShoot = rand(5, 11);
        }
        if (shoot) {
          shoot.life += dt;
          shoot.x += shoot.vx * dt;
          shoot.y += shoot.vy * dt;
          const a = Math.max(0, 1 - shoot.life / 0.9);
          const mag = Math.hypot(shoot.vx, shoot.vy);
          const tx = shoot.x - (shoot.vx / mag) * 90;
          const ty = shoot.y - (shoot.vy / mag) * 90;
          const lg = ctx.createLinearGradient(tx, ty, shoot.x, shoot.y);
          lg.addColorStop(0, "rgba(255,255,255,0)");
          lg.addColorStop(1, `rgba(255,255,255,${a})`);
          ctx.strokeStyle = lg;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(shoot.x, shoot.y);
          ctx.stroke();
          if (shoot.life > 0.9) shoot = null;
        }
      }
    };
  }
 
  function lightning() {
    let nextBolt = rand(1.5, 3.5);
    let flash = 0, second = false, bolt = null;
 
    function makeBolt() {
      const pts = [];
      let x = rand(0.2, 0.8) * w, y = 0;
      const endY = rand(0.45, 0.7) * h;
      pts.push([x, y]);
      while (y < endY) {
        x += rand(-35, 35);
        y += rand(25, 60);
        pts.push([x, y]);
      }
      return pts;
    }
 
    return {
      draw(dt) {
        nextBolt -= dt;
        if (nextBolt <= 0) {
          flash = 1; second = false; bolt = makeBolt();
          nextBolt = rand(3, 9);
        }
        if (flash > 0) {
          flash -= dt * 3.5;
          if (flash < 0.35 && !second && Math.random() < 0.5) { flash = 0.9; second = true; }
          if (flash <= 0) { flash = 0; bolt = null; return; }
 
          ctx.fillStyle = `rgba(220,230,255,${flash * 0.35})`;
          ctx.fillRect(0, 0, w, h);
 
          if (bolt && flash > 0.3) {
            ctx.save();
            ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, flash + 0.2)})`;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = "round";
            ctx.shadowColor = "#bcd0ff";
            ctx.shadowBlur = 18;
            ctx.beginPath();
            bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    };
  }
 
  function compose(...parts) {
    return { draw(dt, t) { parts.forEach(p => p.draw(dt, t)); } };
  }
 
  // ---------- Scenes ----------
  const cloudCount = () => Math.max(4, Math.round(w / 260));
 
  const builders = {
    default: () => compose(
      clouds(sprites.white, cloudCount(), { minScale: 0.6, maxScale: 1.3, minY: 0.03, maxY: 0.6, speed: 14, alpha: 0.5 })
    ),
    clear: () => compose(
      sun(),
      clouds(sprites.white, 2, { minScale: 0.5, maxScale: 0.9, minY: 0.1, maxY: 0.5, speed: 10, alpha: 0.4 })
    ),
    night: () => compose(stars()),
    cloudy: () => compose(
      clouds(sprites.white, Math.max(6, Math.round(w / 200)), { minScale: 0.7, maxScale: 1.6, minY: 0, maxY: 0.75, speed: 18, alpha: 0.6 })
    ),
    fog: () => compose(
      clouds(sprites.white, 7, { minScale: 1.6, maxScale: 2.8, minY: 0.2, maxY: 0.95, speed: 12, alpha: 0.22 })
    ),
    rain: () => compose(
      clouds(sprites.gray, cloudCount(), { minScale: 0.9, maxScale: 1.7, minY: -0.06, maxY: 0.3, speed: 16, alpha: 0.6 }),
      rain({ area: 7000, speed: 620, slant: 0.12, alpha: 0.45 })
    ),
    snow: () => compose(
      clouds(sprites.white, cloudCount(), { minScale: 0.9, maxScale: 1.7, minY: -0.06, maxY: 0.3, speed: 8, alpha: 0.5 }),
      snow()
    ),
    storm: () => compose(
      clouds(sprites.dark, cloudCount() + 1, { minScale: 1, maxScale: 1.9, minY: -0.08, maxY: 0.32, speed: 22, alpha: 0.7 }),
      rain({ area: 4200, speed: 820, slant: 0.28, alpha: 0.5 }),
      lightning()
    )
  };
 
  // ---------- Loop ----------
  function build() {
    scene = (builders[themeName] || builders.default)();
  }
 
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((ts - last) / 1000, 0.05);
    last = ts;
    time += dt;
    ctx.clearRect(0, 0, w, h);
    scene.draw(dt, time);
  }
 
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
 
  function start() {
    stop();
    ctx.clearRect(0, 0, w, h);
    // Respect "reduce motion": leave just the plain gradient behind the card
    if (!scene || reduceMotion.matches || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
 
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
 
  function set(name) {
    if (name === themeName && scene) return;
    themeName = name;
    clearTimeout(swapTimer);
    // Fade out, swap the scene, fade back in
    canvas.classList.add("fading");
    swapTimer = setTimeout(() => {
      build();
      start();
      canvas.classList.remove("fading");
    }, 450);
  }
 
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); build(); start(); }, 150);
  });
  document.addEventListener("visibilitychange", start);
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", start);
 
  resize();
  build();
  start();
 
  window.WeatherBG = { set };
})();