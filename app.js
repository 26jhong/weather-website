const $ = id => document.getElementById(id);

const input = $("city");
const list = $("suggestions");
const out = $("result");
const air = $("air");
const appEl = document.querySelector(".app");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Each chart panel has its own pieces
const hourlyEl = {
  panel: $("hourly"), scroll: $("hourly-scroll"), wrap: $("hourly-wrap"),
  canvas: $("hourly-canvas"), hint: $("hourly-hint"), legend: $("hourly-legend")
};
const weeklyEl = {
  panel: $("weekly"), scroll: $("weekly-scroll"), wrap: $("weekly-wrap"),
  canvas: $("weekly-canvas"), hint: $("weekly-hint"), legend: $("weekly-legend")
};

let timer;
let latestQuery = "";
let currentResults = [];
let activeIndex = -1;
const charts = { hourly: null, weekly: null };
let lastData = null;
let requestId = 0; // lets a newer search cancel an older one that's still loading

const MIN_HOUR_WIDTH = 56; // the hourly chart scrolls sideways only if 24 hours can't fit at this width
const MIN_WEEK_WIDTH = 460;
const toF = c => (c * 9) / 5 + 32;

// ---------- API calls ----------
async function searchCities(name, count = 5) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=${count}&countryCode=US`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}

async function getWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&wind_speed_unit=mph&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed");
  return res.json(); // { current, hourly, daily }
}

// ---------- Air quality ----------
async function getAirQuality(lat, lon) {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.current || null;
  } catch {
    return null; // air quality is a bonus: it should never break the weather view
  }
}

// US EPA AQI categories. `color` fills the gauge, `text` is a darker shade that stays readable on white.
const AQI_LEVELS = [
  { max: 50, label: "Good", color: "#2fb36b", text: "#1c8a50",
    advice: "Air quality is satisfactory. A great day to be outside." },
  { max: 100, label: "Moderate", color: "#f2c200", text: "#9a7400",
    advice: "Acceptable for most people. Unusually sensitive people may want to take it easy outdoors." },
  { max: 150, label: "Unhealthy for sensitive groups", color: "#f28c28", text: "#c25e0a",
    advice: "People with asthma, heart or lung conditions, children and older adults should limit long outdoor exertion." },
  { max: 200, label: "Unhealthy", color: "#e5484d", text: "#c4262c",
    advice: "Everyone may begin to feel effects. Limit prolonged outdoor exertion." },
  { max: 300, label: "Very unhealthy", color: "#8f3fbf", text: "#7a2fa8",
    advice: "Health alert: avoid outdoor exertion. Sensitive groups should stay indoors." },
  { max: Infinity, label: "Hazardous", color: "#7e1d3f", text: "#7e1d3f",
    advice: "Emergency conditions: stay indoors and avoid outdoor activity." }
];
const aqiLevel = aqi => AQI_LEVELS.find(l => aqi <= l.max);

const POLLUTANTS = [
  ["pm2_5", "PM2.5"], ["pm10", "PM10"], ["ozone", "Ozone (O₃)"],
  ["nitrogen_dioxide", "NO₂"], ["sulphur_dioxide", "SO₂"], ["carbon_monoxide", "CO"]
];

function renderAir(aq) {
  if (!aq || aq.us_aqi == null) {
    return `<div class="air reveal"><div class="air-head"><h3>Air quality</h3></div>
      <p class="air-note">Air quality data isn't available for this location.</p></div>`;
  }
  const aqi = Math.round(aq.us_aqi);
  const lv = aqiLevel(aqi);
  const pos = Math.min(aqi, 300) / 3; // the gauge runs from 0 to 300 (shown as %)
  const scale = [0, 50, 100, 150, 200, 300]
    .map(v => `<span style="left:${v / 3}%">${v === 300 ? "300+" : v}</span>`).join("");
  const tiles = POLLUTANTS.filter(([k]) => aq[k] != null).map(([k, name], i) => `
    <div class="detail reveal" style="--i:${4 + i}">
      <span class="label">${name}</span>
      <span class="value"><span data-count="${Math.round(aq[k])}">${Math.round(aq[k])}</span></span>
      <span class="unit">µg/m³</span>
    </div>`).join("");

  return `
    <div class="air reveal">
      <div class="air-head">
        <h3>Air quality</h3>
        <span class="chip" style="--c:${lv.color};--t:${lv.text}">${lv.label}</span>
      </div>
      <div class="air-main">
        <div class="aqi-num" style="color:${lv.text}">
          <span data-count="${aqi}">${aqi}</span><small>US AQI</small>
        </div>
        <p class="advice">${lv.advice}</p>
      </div>
      <div class="gauge"><div class="gauge-marker" data-pos="${pos}" style="--c:${lv.color}"></div></div>
      <div class="gauge-scale">${scale}</div>
      <div class="pollutants">${tiles}</div>
      <p class="footnote">Modeled estimate (Open-Meteo / CAMS), not a ground sensor reading.</p>
    </div>`;
}

// Slide the gauge marker from the left edge to its spot
function animateAir() {
  const m = air.querySelector(".gauge-marker");
  if (!m) return;
  requestAnimationFrame(() => requestAnimationFrame(() => { m.style.left = m.dataset.pos + "%"; }));
}

// ---------- Subtle motion helpers ----------
// Numbers marked with data-count tick up from 0 to their value
function animateCounts(root) {
  root.querySelectorAll("[data-count]").forEach(el => {
    const target = Number(el.dataset.count);
    if (reduceMotion.matches) { el.textContent = target; return; }
    const start = performance.now();
    const tick = now => {
      const p = Math.min(1, (now - start) / 900);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Shimmering placeholders shown while data loads
const SKELETON = `
  <div class="skeleton">
    <div class="sk sk-title"></div><div class="sk sk-circle"></div>
    <div class="sk sk-temp"></div><div class="sk sk-line"></div>
    <div class="sk-row"><div class="sk sk-tile"></div><div class="sk sk-tile"></div></div>
  </div>`;
const AIR_SKELETON = `<div class="air"><div class="sk sk-air"></div></div>`;

// ---------- Weather code -> icon, text, theme ----------
function describe(code, isDay = 1) {
  const night = !isDay;
  if (code === 0) return night
    ? { icon: "🌙", text: "Clear night", theme: "night" }
    : { icon: "☀️", text: "Sunny / clear", theme: "clear" };
  if (code <= 3) return {
    icon: night ? (code === 1 ? "🌙" : "☁️") : (code === 3 ? "☁️" : "⛅"),
    text: "Partly cloudy / cloudy",
    theme: "cloudy"
  };
  if (code === 45 || code === 48) return { icon: "🌫️", text: "Foggy", theme: "fog" };
  if (code >= 51 && code <= 57) return { icon: "🌦️", text: "Drizzle", theme: "rain" };
  if (code >= 61 && code <= 67) return { icon: "🌧️", text: "Raining", theme: "rain" };
  if (code >= 71 && code <= 77) return { icon: "❄️", text: "Snowing", theme: "snow" };
  if (code >= 80 && code <= 82) return { icon: "🌧️", text: "Rain showers", theme: "rain" };
  if (code === 85 || code === 86) return { icon: "❄️", text: "Snow showers", theme: "snow" };
  if (code >= 95) return { icon: "⛈️", text: "Thunderstorm", theme: "storm" };
  return { icon: "🌡️", text: "Unknown", theme: "cloudy" };
}

// ---------- Chart helpers ----------
function hourLabel(t) {
  const h = parseInt(t.slice(11, 13), 10);
  return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
}

function dayLabel(dateStr, i) {
  if (i === 0) return "Today";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}

const both = c => `${Math.round(toF(c))}°F / ${Math.round(c)}°C`;
const tempLabel = c => [`${Math.round(toF(c))}°F`, `${Math.round(c)}°C`];

function setLegend(el, items) {
  el.legend.innerHTML = items
    .map(([color, text]) => `<span><i style="background:${color}"></i>${text}</span>`)
    .join("");
}

// Show the "scroll sideways" hint only when a chart is actually wider than its panel
function updateHints() {
  [hourlyEl, weeklyEl].forEach(el => {
    el.hint.hidden = el.scroll.scrollWidth <= el.scroll.clientWidth + 1;
  });
}

function setChartsHidden(hidden) {
  hourlyEl.panel.hidden = hidden;
  weeklyEl.panel.hidden = hidden;
}

// ---------- Chart styling ----------
const UI_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const EMOJI_FONT = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
const INK = "#1f2a44";
const MUTED = "#6b7694";
const RAIN_BLUE = "59,130,246";
const TEMP_RAMP = "linear-gradient(90deg,#2bb5d6,#3fc08d,#f6b21a,#e5484d)";

// Temperature (°C) -> colour: cold blues, through teal and green, to amber, orange and red
const TEMP_STOPS = [
  [-15, [91, 109, 245]], [-5, [59, 141, 240]], [5, [43, 181, 214]], [12, [63, 192, 141]],
  [18, [166, 207, 58]], [24, [246, 178, 26]], [30, [242, 140, 40]], [36, [229, 72, 77]]
];

function tempColor(c, alpha = 1) {
  const s = TEMP_STOPS;
  let rgb;
  if (c <= s[0][0]) rgb = s[0][1];
  else if (c >= s[s.length - 1][0]) rgb = s[s.length - 1][1];
  else {
    const i = s.findIndex(([t]) => c <= t);
    const [t0, a] = s[i - 1];
    const [t1, b] = s[i];
    const k = (c - t0) / (t1 - t0);
    rgb = a.map((v, j) => Math.round(v + (b[j] - v) * k));
  }
  return `rgba(${rgb.join(",")},${alpha})`;
}

// The page's current weather colour (from the CSS theme), so the charts pick up the same mood
function themeTint(alpha) {
  const hex = getComputedStyle(document.body).getPropertyValue("--bg-end").trim();
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(59,109,240,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function roundedRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// °F on top, °C underneath, with a soft white halo so it stays readable over lines
function drawTempLabel(ctx, x, yF, [f, cel]) {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.font = `700 13px ${UI_FONT}`;
  ctx.strokeText(f, x, yF);
  ctx.fillStyle = INK;
  ctx.fillText(f, x, yF);
  ctx.font = `500 10px ${UI_FONT}`;
  ctx.strokeText(cel, x, yF + 13);
  ctx.fillStyle = MUTED;
  ctx.fillText(cel, x, yF + 13);
}

// Small blue chip showing the chance of precipitation; darker = more likely
function drawRainChip(ctx, x, y, pct) {
  if (!pct) return;
  const text = `${pct}%`;
  ctx.font = `600 11px ${UI_FONT}`;
  const w = Math.max(36, ctx.measureText(text).width + 14);
  ctx.fillStyle = `rgba(${RAIN_BLUE},${0.1 + 0.35 * (pct / 100)})`;
  roundedRect(ctx, x - w / 2, y, w, 18, 9);
  ctx.fill();
  ctx.fillStyle = "#1d4f8f";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 9.5);
}

// Soft column behind one category (used for "now", today and the hovered column)
function drawColumn(ctx, xs, index, chartArea, fill) {
  const step = xs.getPixelForValue(1) - xs.getPixelForValue(0);
  const x = xs.getPixelForValue(index);
  const top = 40;
  ctx.fillStyle = fill;
  roundedRect(ctx, x - step / 2 + 2, top, step - 4, chartArea.bottom + 8 - top, 14);
  ctx.fill();
}

const tooltipStyle = {
  backgroundColor: "rgba(255,255,255,0.98)",
  titleColor: INK,
  bodyColor: "#44506f",
  borderColor: "rgba(31,42,68,0.14)",
  borderWidth: 1,
  cornerRadius: 12,
  padding: 12,
  displayColors: false,
  titleFont: { size: 14, weight: "700" },
  bodyFont: { size: 13 },
  bodySpacing: 5,
  caretPadding: 10
};

const chartBase = () => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: reduceMotion.matches ? false : { duration: 900, easing: "easeOutQuart" },
  interaction: { mode: "index", intersect: false },
  layout: { padding: { top: 52, left: 8, right: 8, bottom: 0 } }
});

// Today, hour by hour: a smooth line that changes colour with the temperature
function renderHourly() {
  if (!lastData) return;
  const { scroll, wrap, canvas } = hourlyEl;
  if (charts.hourly) charts.hourly.destroy();

  const h = lastData.hourly;
  const celsius = h.temperature_2m.slice(0, 24);
  const f = celsius.map(toF);
  const rain = h.precipitation_probability.slice(0, 24).map(v => v ?? 0);
  const fullLabels = h.time.slice(0, 24).map(hourLabel);
  const nowHour = parseInt(lastData.current.time.slice(11, 13), 10);
  const labels = fullLabels.map((l, i) => (i === nowHour ? "Now" : l));
  const isDay = Array.from({ length: 24 }, (_, i) => (h.is_day ? h.is_day[i] !== 0 : true));
  const info = h.weather_code.slice(0, 24).map((code, i) => describe(code, isDay[i] ? 1 : 0));

  // The chart fills its panel; it only scrolls sideways when the screen is too narrow for 24 readable hours
  wrap.style.minWidth = `${24 * MIN_HOUR_WIDTH}px`;
  setLegend(hourlyEl, [
    [TEMP_RAMP, "Temperature (color shows how warm)"],
    [`rgba(${RAIN_BLUE},0.35)`, "Chance of precipitation"],
    [themeTint(0.6), "Now"],
    ["rgba(31,42,68,0.14)", "Night"]
  ]);

  const lo = Math.min(...f), hi = Math.max(...f), span = Math.max(hi - lo, 6);

  const decor = {
    id: "hourlyDecor",
    beforeDatasetsDraw(c) {
      const { ctx, chartArea, scales } = c;
      const xs = scales.x;
      const step = xs.getPixelForValue(1) - xs.getPixelForValue(0);
      ctx.save();

      // Shade the night hours
      for (let i = 0; i < 24; i++) {
        if (isDay[i]) continue;
        let j = i;
        while (j + 1 < 24 && !isDay[j + 1]) j++;
        const x0 = xs.getPixelForValue(i) - step / 2 + 2;
        const x1 = xs.getPixelForValue(j) + step / 2 - 2;
        ctx.fillStyle = "rgba(31,42,68,0.06)";
        roundedRect(ctx, x0, 40, x1 - x0, chartArea.bottom + 8 - 40, 14);
        ctx.fill();
        i = j;
      }

      drawColumn(ctx, xs, nowHour, chartArea, themeTint(0.3));
      const active = c.tooltip?.getActiveElements?.() || [];
      if (active.length) drawColumn(ctx, xs, active[0].index, chartArea, "rgba(31,42,68,0.07)");

      // Glow under the "now" point
      const pt = c.getDatasetMeta(0).data[nowHour];
      if (pt) {
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 22);
        g.addColorStop(0, tempColor(celsius[nowHour], 0.45));
        g.addColorStop(1, tempColor(celsius[nowHour], 0));
        ctx.fillStyle = g;
        ctx.fillRect(pt.x - 22, pt.y - 22, 44, 44);
      }
      ctx.restore();
    },
    afterDatasetsDraw(c) {
      const { ctx, chartArea } = c;
      const pts = c.getDatasetMeta(0).data;
      ctx.save();
      ctx.font = `26px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      pts.forEach((pt, i) => ctx.fillText(info[i].icon, pt.x, 24));
      pts.forEach((pt, i) => drawTempLabel(ctx, pt.x, pt.y - 26, tempLabel(celsius[i])));
      pts.forEach((pt, i) => drawRainChip(ctx, pt.x, chartArea.bottom - 26, rain[i]));
      ctx.restore();
    }
  };

  charts.hourly = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Temperature",
        data: f,
        tension: 0.4,
        fill: "start",
        borderWidth: 4,
        borderCapStyle: "round",
        borderColor: ctx => {
          const area = ctx.chart.chartArea;
          if (!area) return tempColor(celsius[0]);
          const g = ctx.chart.ctx.createLinearGradient(area.left, 0, area.right, 0);
          celsius.forEach((c, i) => g.addColorStop((i + 0.5) / 24, tempColor(c)));
          return g;
        },
        backgroundColor: ctx => {
          const area = ctx.chart.chartArea;
          if (!area) return "transparent";
          const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
          g.addColorStop(0, themeTint(0.55));
          g.addColorStop(1, themeTint(0));
          return g;
        },
        pointRadius: celsius.map((_, i) => (i === nowHour ? 8 : 0)),
        pointHoverRadius: 7,
        pointBackgroundColor: celsius.map(c => tempColor(c)),
        pointBorderColor: "#fff",
        pointBorderWidth: 3,
        pointHoverBorderWidth: 3
      }]
    },
    plugins: [decor],
    options: {
      ...chartBase(),
      scales: {
        x: {
          offset: true,
          grid: { display: false },
          border: { display: false },
          ticks: {
            autoSkip: false,
            padding: 8,
            color: ctx => (ctx.index === nowHour ? INK : MUTED),
            font: ctx => ({ size: 12, weight: ctx.index === nowHour ? "700" : "500" })
          }
        },
        y: { display: false, min: lo - span * 0.9, max: hi + span * 0.55 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle,
          callbacks: {
            title: items => fullLabels[items[0].dataIndex] + (items[0].dataIndex === nowHour ? " (now)" : ""),
            label: ctx => {
              const i = ctx.dataIndex;
              return [`${info[i].icon} ${info[i].text}`, `Temperature: ${both(celsius[i])}`, `Chance of precipitation: ${rain[i]}%`];
            }
          }
        }
      }
    }
  });

  updateHints();
  // If it does scroll, start near the current hour
  scroll.scrollLeft = Math.max(0, nowHour * (wrap.clientWidth / 24) - 120);
}

// The next 7 days: one floating bar per day from the low to the high, coloured by temperature
function renderWeekly() {
  if (!lastData) return;
  const { scroll, wrap, canvas } = weeklyEl;
  if (charts.weekly) charts.weekly.destroy();

  const d = lastData.daily;
  const highsC = d.temperature_2m_max;
  const lowsC = d.temperature_2m_min;
  const rain = d.precipitation_probability_max.map(v => v ?? 0);
  const labels = d.time.map(dayLabel);
  const info = d.weather_code.map(code => describe(code, 1));
  const longDay = d.time.map((s, i) => {
    const [y, m, dd] = s.split("-").map(Number);
    const name = new Date(y, m - 1, dd).toLocaleDateString("en-US", { weekday: "long" });
    return i === 0 ? `Today (${name})` : name;
  });

  wrap.style.minWidth = `${MIN_WEEK_WIDTH}px`;
  setLegend(weeklyEl, [
    [TEMP_RAMP, "Low to high (color shows how warm)"],
    [`rgba(${RAIN_BLUE},0.35)`, "Chance of precipitation"],
    [themeTint(0.6), "Today"]
  ]);

  const lo = Math.min(...lowsC.map(toF)), hi = Math.max(...highsC.map(toF)), span = Math.max(hi - lo, 10);

  const decor = {
    id: "weeklyDecor",
    beforeDatasetsDraw(c) {
      const { ctx, chartArea, scales } = c;
      ctx.save();
      drawColumn(ctx, scales.x, 0, chartArea, themeTint(0.3));
      const active = c.tooltip?.getActiveElements?.() || [];
      if (active.length) drawColumn(ctx, scales.x, active[0].index, chartArea, "rgba(31,42,68,0.07)");
      ctx.restore();
    },
    afterDatasetsDraw(c) {
      const { ctx, chartArea } = c;
      const bars = c.getDatasetMeta(0).data;
      ctx.save();
      bars.forEach((bar, i) => {
        const { x, y, base } = bar.getProps(["x", "y", "base"], true);
        ctx.font = `26px ${EMOJI_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(info[i].icon, x, 24);
        drawTempLabel(ctx, x, Math.min(y, base) - 26, tempLabel(highsC[i]));
        drawTempLabel(ctx, x, Math.max(y, base) + 22, tempLabel(lowsC[i]));
        drawRainChip(ctx, x, chartArea.bottom - 26, rain[i]);
      });
      ctx.restore();
    }
  };

  charts.weekly = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Temperature range",
        data: lowsC.map((low, i) => [toF(low), toF(highsC[i])]),
        borderSkipped: false,
        borderRadius: 24,
        maxBarThickness: 40,
        barPercentage: 0.6,
        categoryPercentage: 0.9,
        backgroundColor: ctx => {
          const i = ctx.dataIndex;
          const bar = ctx.chart.getDatasetMeta(ctx.datasetIndex).data[i];
          if (!bar || !ctx.chart.chartArea) return tempColor(highsC[i]);
          const { y, base } = bar.getProps(["y", "base"], true);
          if (!Number.isFinite(y) || !Number.isFinite(base)) return tempColor(highsC[i]); // not laid out yet
          const g = ctx.chart.ctx.createLinearGradient(0, Math.min(y, base), 0, Math.max(y, base) + 0.01);
          g.addColorStop(0, tempColor(highsC[i]));
          g.addColorStop(1, tempColor(lowsC[i]));
          return g;
        }
      }]
    },
    plugins: [decor],
    options: {
      ...chartBase(),
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            autoSkip: false,
            padding: 8,
            color: ctx => (ctx.index === 0 ? INK : MUTED),
            font: ctx => ({ size: 12, weight: ctx.index === 0 ? "700" : "500" })
          }
        },
        y: { display: false, min: lo - span * 0.85, max: hi + span * 0.5 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle,
          callbacks: {
            title: items => longDay[items[0].dataIndex],
            label: ctx => {
              const i = ctx.dataIndex;
              return [`${info[i].icon} ${info[i].text}`, `High: ${both(highsC[i])}`, `Low: ${both(lowsC[i])}`, `Chance of precipitation: ${rain[i]}%`];
            }
          }
        }
      }
    }
  });

  updateHints();
  scroll.scrollLeft = 0;
}

function renderCharts() {
  if (typeof Chart === "undefined") return; // chart library didn't load (offline?): the rest of the page still works
  renderHourly();
  renderWeekly();
}

window.addEventListener("resize", updateHints);

// ---------- Show the weather ----------
async function chooseCity(city) {
  input.value = `${city.name}, ${city.admin1}`;
  clearTimeout(timer);
  latestQuery = null; // ignore any suggestion request still in flight
  list.innerHTML = "";
  appEl.classList.add("loaded"); // switches from the welcome layout to the full dashboard
  setChartsHidden(true);
  air.innerHTML = AIR_SKELETON;
  out.innerHTML = SKELETON;
  const myId = ++requestId;
  const airPromise = getAirQuality(city.latitude, city.longitude); // runs alongside the weather request
  try {
    const data = await getWeather(city.latitude, city.longitude);
    if (myId !== requestId) return; // a newer search took over
    const w = data.current;
    const d = describe(w.weather_code, w.is_day);
    document.body.dataset.theme = d.theme;
    if (window.WeatherBG) WeatherBG.set(d.theme);
    out.innerHTML = `
      <div class="weather">
        <h2>${city.name}, ${city.admin1}</h2>
        <div class="icon t-${d.theme} reveal" style="--i:1"><span>${d.icon}</span></div>
        <div class="temp reveal" style="--i:2"><span data-count="${Math.round(toF(w.temperature_2m))}">${Math.round(toF(w.temperature_2m))}</span>°F
          <small>/ <span data-count="${Math.round(w.temperature_2m)}">${Math.round(w.temperature_2m)}</span>°C</small></div>
        <div class="condition reveal" style="--i:3">${d.text}</div>
        <div class="details">
          <div class="detail reveal" style="--i:4"><span class="label">Humidity</span><span class="value"><span data-count="${w.relative_humidity_2m}">${w.relative_humidity_2m}</span>%</span></div>
          <div class="detail reveal" style="--i:5"><span class="label">Wind</span><span class="value"><span data-count="${Math.round(w.wind_speed_10m)}">${Math.round(w.wind_speed_10m)}</span> mph</span></div>
        </div>
      </div>`;
    lastData = data;
    animateCounts(out);
    setChartsHidden(false);
    renderCharts();

    // Air quality fills in as soon as it arrives, without holding up the weather
    const aq = await airPromise;
    if (myId !== requestId) return;
    air.innerHTML = renderAir(aq);
    animateCounts(air);
    animateAir();
  } catch (err) {
    if (myId !== requestId) return;
    air.innerHTML = "";
    appEl.classList.remove("loaded");
    out.innerHTML = `<p class="message">Couldn't load the weather. Try again.</p>`;
  }
}

// ---------- Suggestions while typing ----------
input.addEventListener("input", () => {
  clearTimeout(timer);
  const q = input.value.trim();
  latestQuery = q;
  if (q.length < 2) { list.innerHTML = ""; currentResults = []; return; }

  // Debounce: wait 250ms after the last keystroke
  timer = setTimeout(async () => {
    const results = await searchCities(q);
    if (q !== latestQuery) return; // ignore stale responses
    currentResults = results;
    activeIndex = -1;
    list.innerHTML = "";
    results.forEach(c => {
      const li = document.createElement("li");
      li.textContent = `${c.name}, ${c.admin1}`;
      li.addEventListener("mousedown", () => chooseCity(c));
      list.appendChild(li);
    });
  }, 250);
});

// ---------- Keyboard support ----------
input.addEventListener("keydown", (e) => {
  const items = list.querySelectorAll("li");
  if (!items.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("active", i === activeIndex));
  } else if (e.key === "Enter" && activeIndex >= 0) {
    e.preventDefault();
    chooseCity(currentResults[activeIndex]);
  } else if (e.key === "Escape") {
    list.innerHTML = "";
  }
});

input.addEventListener("blur", () => { list.innerHTML = ""; });

// ---------- Search button ----------
$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearTimeout(timer);
  latestQuery = null;
  list.innerHTML = "";
  const results = await searchCities(input.value.trim(), 1);
  if (!results.length) {
    requestId++; // cancel anything still loading
    setChartsHidden(true);
    air.innerHTML = "";
    appEl.classList.remove("loaded");
    out.innerHTML = `<p class="message">City not found.</p>`;
    return;
  }
  chooseCity(results[0]);
});