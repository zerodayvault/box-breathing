/* ===== Дыхание — логика таймера + iOS-пикер ===== */

const PHASES = [
  { key: "inhale", label: "Вдох"  },
  { key: "hold1",  label: "Пауза" },
  { key: "exhale", label: "Выдох" },
  { key: "hold2",  label: "Пауза" },
];

const SCALE_MIN = 0.93;
const SCALE_MAX = 1.04;

/* ---------- Настройки (сохраняются) ---------- */
const defaults = { phaseDuration: 4, totalCycles: 5, sound: true, haptics: true };
let settings = { ...defaults };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem("breath-settings") || "{}"));
} catch (e) {}

function saveSettings() {
  try { localStorage.setItem("breath-settings", JSON.stringify(settings)); } catch (e) {}
}

const state = {
  running: false,
  paused: false,
  cycle: 1,
  phaseIndex: 0,
  phaseStart: 0,
  pauseStart: 0,
  rafId: null,
  audioCtx: null,
  lastCount: null,
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const screens = { setup: $("screen-setup"), session: $("screen-session"), done: $("screen-done") };
const dot = $("dot");
const box = $("box");
const boxProgress = $("box-progress");
const phaseLabel = $("phase-label");
const countLabel = $("count-label");
const cycleLabel = $("cycle-label");
const pauseIcon = $("pause-icon");

/* ---------- Хелперы ---------- */
function plural(n, one, few, many) {
  const m = Math.abs(n) % 100, d = m % 10;
  if (m > 10 && m < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}

function formatDuration(totalSec) {
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  if (m === 0) return `${s} сек`;
  if (s === 0) return `${m} мин`;
  return `${m} мин ${s} сек`;
}

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

/* ---------- Список настроек ---------- */
function renderSettings() {
  $("phase-value").textContent = `${settings.phaseDuration} сек`;
  $("cycles-value").textContent = `${settings.totalCycles}`;
  $("sound-value").textContent = settings.sound ? "Вкл" : "Выкл";
  $("haptics-value").textContent = settings.haptics ? "Вкл" : "Выкл";
  $("total-hint").textContent = `Итого ${formatDuration(settings.phaseDuration * 4 * settings.totalCycles)}`;
}

/* ---------- Звук ---------- */
function beep(freq = 660, duration = 0.12) {
  if (!settings.sound) return;
  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = state.audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function buzz(pattern = 12) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

/* ---------- Easing ---------- */
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/* ---------- Геометрия скруглённого квадрата ---------- */
const VIEW = 300;
const INSET = 14;
const SIDE = VIEW - INSET * 2;
const RADIUS = 56;
const STRAIGHT = SIDE - RADIUS * 2;
const ARC = (Math.PI / 2) * RADIUS;
const PERIMETER = STRAIGHT * 4 + ARC * 4;

// Точка на периметре, старт — верхний левый угол, по часовой стрелке.
function pointAt(d) {
  d = ((d % PERIMETER) + PERIMETER) % PERIMETER;
  const segs = [
    { len: ARC,      f: (t) => { const a = Math.PI + (Math.PI / 2) * t;       return { x: INSET + RADIUS + RADIUS * Math.cos(a),           y: INSET + RADIUS + RADIUS * Math.sin(a) }; } },
    { len: STRAIGHT, f: (t) => ({ x: INSET + RADIUS + STRAIGHT * t,           y: INSET }) },
    { len: ARC,      f: (t) => { const a = -Math.PI / 2 + (Math.PI / 2) * t;  return { x: VIEW - INSET - RADIUS + RADIUS * Math.cos(a),    y: INSET + RADIUS + RADIUS * Math.sin(a) }; } },
    { len: STRAIGHT, f: (t) => ({ x: VIEW - INSET,                            y: INSET + RADIUS + STRAIGHT * t }) },
    { len: ARC,      f: (t) => { const a = (Math.PI / 2) * t;                 return { x: VIEW - INSET - RADIUS + RADIUS * Math.cos(a),    y: VIEW - INSET - RADIUS + RADIUS * Math.sin(a) }; } },
    { len: STRAIGHT, f: (t) => ({ x: VIEW - INSET - RADIUS - STRAIGHT * t,    y: VIEW - INSET }) },
    { len: ARC,      f: (t) => { const a = Math.PI / 2 + (Math.PI / 2) * t;   return { x: INSET + RADIUS + RADIUS * Math.cos(a),           y: VIEW - INSET - RADIUS + RADIUS * Math.sin(a) }; } },
    { len: STRAIGHT, f: (t) => ({ x: INSET,                                   y: VIEW - INSET - RADIUS - STRAIGHT * t }) },
  ];
  for (const s of segs) {
    if (d <= s.len) return s.f(d / s.len);
    d -= s.len;
  }
  return segs[0].f(0);
}

// SVG rect path стартует в точке (x, y+ry) = начало левой стороны,
// а SVG повёрнут на -90deg, поэтому визуально штрих стартует в нижнем
// левом углу. Сдвигаем dashoffset так, чтобы видимый старт совпадал
// с точкой (верхний левый угол, по часовой).
const DASH_ZERO = 0; // длина от начала path до верхнего левого угла по path

boxProgress.style.strokeDasharray = `${PERIMETER}`;

function renderSession(overallProgress, phaseProgress, phaseKey) {
  const len = overallProgress * PERIMETER;
  // штрих длины len, заканчивающийся на позиции (DASH_ZERO + len) по path:
  // видимая часть = [DASH_ZERO, DASH_ZERO+len]
  boxProgress.style.strokeDashoffset = `${PERIMETER - len - DASH_ZERO}`;

  const pt = pointAt(len);
  dot.style.left = (pt.x / VIEW * 100) + "%";
  dot.style.top = (pt.y / VIEW * 100) + "%";

  const t = easeInOutSine(phaseProgress);
  let scale;
  switch (phaseKey) {
    case "inhale": scale = SCALE_MIN + (SCALE_MAX - SCALE_MIN) * t; break;
    case "hold1":  scale = SCALE_MAX; break;
    case "exhale": scale = SCALE_MAX - (SCALE_MAX - SCALE_MIN) * t; break;
    case "hold2":  scale = SCALE_MIN; break;
  }
  box.style.transform = `scale(${scale})`;
}

/* ---------- Анимации текста ---------- */
function animateCount(n) {
  if (n === state.lastCount) return;
  state.lastCount = n;
  countLabel.textContent = n;
  countLabel.classList.remove("tick");
  void countLabel.offsetWidth;
  countLabel.classList.add("tick");
}

function animatePhaseSwap() {
  phaseLabel.classList.remove("swap");
  void phaseLabel.offsetWidth;
  phaseLabel.classList.add("swap");
}

/* ---------- Цикл таймера ---------- */
function tick(now) {
  if (!state.running || state.paused) return;

  const elapsed = (now - state.phaseStart) / 1000;
  const phase = PHASES[state.phaseIndex];
  const progress = Math.min(elapsed / settings.phaseDuration, 1);
  const overall = (state.phaseIndex + progress) / 4;

  renderSession(overall, progress, phase.key);
  animateCount(Math.max(Math.ceil(settings.phaseDuration - elapsed), 0));

  if (elapsed >= settings.phaseDuration) nextPhase(now);
  state.rafId = requestAnimationFrame(tick);
}

function nextPhase(now) {
  state.phaseIndex++;
  if (state.phaseIndex >= PHASES.length) {
    state.phaseIndex = 0;
    state.cycle++;
    if (state.cycle > settings.totalCycles) { finish(); return; }
    cycleLabel.textContent = `Цикл ${state.cycle} из ${settings.totalCycles}`;
  }
  phaseLabel.textContent = PHASES[state.phaseIndex].label;
  animatePhaseSwap();
  state.phaseStart = now;
  beep(state.phaseIndex === 0 ? 880 : 660);
  buzz(10);
}

/* ---------- Управление ---------- */
const ICON_PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1.6" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.6" fill="currentColor"/>';
const ICON_PLAY  = '<path d="M8 5.5v13c0 1.2 1.3 1.9 2.3 1.3l10-6.5c0.9-0.6 0.9-2 0-2.6l-10-6.5C9.3 3.6 8 4.3 8 5.5z" fill="currentColor"/>';

function start() {
  state.running = true;
  state.paused = false;
  state.cycle = 1;
  state.phaseIndex = 0;
  state.lastCount = null;
  phaseLabel.textContent = PHASES[0].label;
  cycleLabel.textContent = `Цикл 1 из ${settings.totalCycles}`;
  countLabel.textContent = settings.phaseDuration;
  pauseIcon.innerHTML = ICON_PAUSE;
  renderSession(0, 0, "inhale");
  showScreen("session");
  beep(880);
  buzz(20);
  state.phaseStart = performance.now();
  state.rafId = requestAnimationFrame(tick);
  requestWakeLock();
}

function togglePause() {
  if (!state.running) return;
  if (state.paused) {
    state.paused = false;
    pauseIcon.innerHTML = ICON_PAUSE;
    state.phaseStart = performance.now() - (state.pauseStart - state.phaseStart);
    state.rafId = requestAnimationFrame(tick);
  } else {
    state.paused = true;
    pauseIcon.innerHTML = ICON_PLAY;
    state.pauseStart = performance.now();
    cancelAnimationFrame(state.rafId);
  }
  buzz(10);
}

function stop() {
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.rafId);
  releaseWakeLock();
  renderSettings();
  showScreen("setup");
}

function finish() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  releaseWakeLock();
  const totalSec = settings.phaseDuration * 4 * settings.totalCycles;
  $("done-text").textContent =
    `${settings.totalCycles} ${plural(settings.totalCycles, "цикл", "цикла", "циклов")} · ${formatDuration(totalSec)}`;
  beep(880, 0.2);
  setTimeout(() => beep(1100, 0.25), 250);
  buzz([30, 60, 30]);
  showScreen("done");
}

/* ---------- Wake Lock ---------- */
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) {}
}
async function releaseWakeLock() {
  try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.running) requestWakeLock();
});

/* ================================================================
   iOS-style wheel picker (как в «Часах»)
================================================================ */
const PICKER_ITEM_H = 36;
const PICKER_CENTER = 108; // половина высоты .picker (216)

const sheet = $("sheet");
const sheetBackdrop = $("sheet-backdrop");
const wheel = $("picker-wheel");

let picker = null;

function buildWheel(items, selectedValue) {
  wheel.innerHTML = "";
  items.forEach((it) => {
    const div = document.createElement("div");
    div.className = "picker__item";
    div.textContent = it.label;
    wheel.appendChild(div);
  });
  const index = Math.max(0, items.findIndex((i) => i.value === selectedValue));
  picker = {
    items, index,
    offset: 0, startOffset: 0, startY: 0,
    dragging: false, lastY: 0, lastT: 0, velocity: 0, animId: null,
  };
  setPickerOffset(offsetForIndex(index), false);
}

function minOffset() { return -(picker.items.length - 1) * PICKER_ITEM_H; }
function offsetForIndex(i) { return -i * PICKER_ITEM_H; }
function indexForOffset(o) {
  return Math.min(picker.items.length - 1, Math.max(0, Math.round(-o / PICKER_ITEM_H)));
}

function applyOffset(o) {
  picker.offset = o;
  wheel.style.transform = `translateY(${PICKER_CENTER - PICKER_ITEM_H / 2 + o}px)`;
}

function setPickerOffset(offset, animate = true) {
  cancelAnimationFrame(picker.animId);
  if (!animate) { applyOffset(offset); return; }
  const from = picker.offset, to = offset, t0 = performance.now(), dur = 220;
  const step = (t) => {
    const k = Math.min((t - t0) / dur, 1);
    const e = 1 - Math.pow(1 - k, 3);
    applyOffset(from + (to - from) * e);
    if (k < 1) picker.animId = requestAnimationFrame(step);
  };
  picker.animId = requestAnimationFrame(step);
}

function settlePicker() {
  const idx = indexForOffset(picker.offset);
  setPickerOffset(offsetForIndex(idx), true);
  if (idx !== picker.index) {
    picker.index = idx;
    buzz(6);
  }
}

function openPicker({ title, items, value, onDone }) {
  $("sheet-title").textContent = title;
  buildWheel(items, value);
  picker.onDone = onDone;
  sheet.classList.remove("hidden");
  sheetBackdrop.classList.remove("hidden");
}

function closePicker(apply) {
  if (apply && picker && picker.onDone) picker.onDone(picker.items[picker.index].value);
  sheet.classList.add("hidden");
  sheetBackdrop.classList.add("hidden");
  renderSettings();
  saveSettings();
}

function onDragStart(y) {
  if (!picker) return;
  cancelAnimationFrame(picker.animId);
  picker.dragging = true;
  picker.startY = y;
  picker.startOffset = picker.offset;
  picker.lastY = y;
  picker.lastT = performance.now();
  picker.velocity = 0;
}

function onDragMove(y) {
  if (!picker || !picker.dragging) return;
  const now = performance.now();
  const dt = now - picker.lastT;
  if (dt > 0) picker.velocity = (y - picker.lastY) / dt;
  picker.lastY = y;
  picker.lastT = now;
  let o = picker.startOffset + (y - picker.startY);
  if (o > 0) o *= 0.35;                       // резиновый верхний край
  if (o < minOffset()) o = minOffset() + (o - minOffset()) * 0.35;
  applyOffset(o);
}

function onDragEnd() {
  if (!picker || !picker.dragging) return;
  picker.dragging = false;
  let o = picker.offset + picker.velocity * 160; // инерция
  o = Math.max(minOffset(), Math.min(0, o));
  picker.offset = o;
  settlePicker();
}

sheet.addEventListener("touchstart", (e) => { e.preventDefault(); onDragStart(e.touches[0].clientY); }, { passive: false });
sheet.addEventListener("touchmove",  (e) => { e.preventDefault(); onDragMove(e.touches[0].clientY); }, { passive: false });
sheet.addEventListener("touchend",   () => onDragEnd());
sheet.addEventListener("mousedown",  (e) => {
  e.preventDefault();
  onDragStart(e.clientY);
  const mv = (ev) => onDragMove(ev.clientY);
  const up = () => { onDragEnd(); window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  window.addEventListener("mousemove", mv);
  window.addEventListener("mouseup", up);
});

$("sheet-cancel").addEventListener("click", () => closePicker(false));
$("sheet-done").addEventListener("click", () => closePicker(true));
sheetBackdrop.addEventListener("click", () => closePicker(false));

$("row-phase").addEventListener("click", () => {
  const items = [];
  for (let i = 2; i <= 10; i++) items.push({ value: i, label: `${i} сек` });
  openPicker({
    title: "Длительность фазы",
    items,
    value: settings.phaseDuration,
    onDone: (v) => { settings.phaseDuration = v; },
  });
});

$("row-cycles").addEventListener("click", () => {
  const items = [];
  for (let i = 1; i <= 20; i++) items.push({ value: i, label: `${i}` });
  openPicker({
    title: "Циклы",
    items,
    value: settings.totalCycles,
    onDone: (v) => { settings.totalCycles = v; },
  });
});

function toggleRow(key) {
  settings[key] = !settings[key];
  saveSettings();
  renderSettings();
  buzz(8);
}
$("row-sound").addEventListener("click", () => toggleRow("sound"));
$("row-haptics").addEventListener("click", () => toggleRow("haptics"));

/* ---------- События ---------- */
$("btn-start").addEventListener("click", start);
$("btn-pause").addEventListener("click", togglePause);
$("btn-stop").addEventListener("click", stop);
$("btn-again").addEventListener("click", start);
$("btn-settings").addEventListener("click", stop);

/* ---------- Service Worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

renderSettings();


