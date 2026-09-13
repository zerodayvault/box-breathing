/* ===== Дыхание — таймер + пикер + звук из файла ===== */

const PHASES = [
  { key: "inhale", label: "Вдох"  },
  { key: "hold1",  label: "Пауза" },
  { key: "exhale", label: "Выдох" },
  { key: "hold2",  label: "Пауза" },
];

const SCALE_MIN = 0.93;
const SCALE_MAX = 1.04;
const SOUND_URL = "sounds/phase.wav";

/* ---------- Настройки ---------- */
const defaults = { phaseDuration: 4, totalCycles: 5, sound: true };
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
  audioBuffer: null,   // декодированный звук из файла
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

function renderSettings() {
  $("phase-value").textContent = `${settings.phaseDuration} сек`;
  $("cycles-value").textContent = `${settings.totalCycles}`;
  $("toggle-sound").classList.toggle("on", settings.sound);
  $("total-hint").textContent = `Итого ${formatDuration(settings.phaseDuration * 4 * settings.totalCycles)}`;
}

/* ---------- Звук ----------
   AudioContext создаётся и разблокируется ТОЛЬКО в момент тапа
   (user gesture) — иначе Safari блокирует старт. */
async function ensureAudio() {
  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === "suspended") {
      await state.audioCtx.resume();
    }
    if (!state.audioBuffer) {
      const res = await fetch(SOUND_URL);
      const buf = await res.arrayBuffer();
      state.audioBuffer = await state.audioCtx.decodeAudioData(buf);
    }
  } catch (e) {
    state.audioBuffer = null; // останется fallback-синтез
  }
}

function playSound() {
  if (!settings.sound || !state.audioCtx) return;
  try {
    const ctx = state.audioCtx;
    if (state.audioBuffer) {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = state.audioBuffer;
      gain.gain.value = 0.6;
      src.connect(gain).connect(ctx.destination);
      src.start();
    } else {
      // fallback: синтезированный сигнал
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    }
  } catch (e) {}
}

/* ---------- Easing ---------- */
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/* ---------- Геометрия: точка и обводка по одному getPointAtLength ---------- */
const VIEW = 300;
const trackRect = document.querySelector(".box__track");
const PERIMETER = trackRect.getTotalLength();

boxProgress.style.strokeDasharray = `${PERIMETER}`;

function renderSession(overallProgress, phaseProgress, phaseKey) {
  const len = overallProgress * PERIMETER;
  boxProgress.style.strokeDashoffset = `${PERIMETER - len}`;

  const pt = trackRect.getPointAtLength(len);
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
  playSound();
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
  // аудио разблокируется этим же тапом
  ensureAudio().then(() => playSound());
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
  playSound();
  setTimeout(() => playSound(), 300);
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
   Пикер: нативный scroll + scroll-snap
================================================================ */
const PICKER_ITEM_H = 36;

const sheet = $("sheet");
const sheetBackdrop = $("sheet-backdrop");
const pickerScroll = $("picker-scroll");

let picker = null;

function buildPicker(items, selectedValue) {
  pickerScroll.querySelectorAll(".picker__item").forEach((el) => el.remove());
  const spacerEnd = pickerScroll.querySelectorAll(".picker__spacer")[1];
  items.forEach((it) => {
    const div = document.createElement("div");
    div.className = "picker__item";
    div.textContent = it.label;
    pickerScroll.insertBefore(div, spacerEnd);
  });
  const index = Math.max(0, items.findIndex((i) => i.value === selectedValue));
  picker = { items, index, onDone: null, scrollTimer: null };
  // scrollTop после layout — иначе Safari/Chromium сбрасывает в 0
  requestAnimationFrame(() => { pickerScroll.scrollTop = index * PICKER_ITEM_H; });
}

function pickerIndexFromScroll() {
  return Math.min(picker.items.length - 1, Math.max(0, Math.round(pickerScroll.scrollTop / PICKER_ITEM_H)));
}

pickerScroll.addEventListener("scroll", () => {
  if (!picker) return;
  picker.index = pickerIndexFromScroll();
  clearTimeout(picker.scrollTimer);
  picker.scrollTimer = setTimeout(() => {
    const target = pickerIndexFromScroll() * PICKER_ITEM_H;
    if (Math.abs(pickerScroll.scrollTop - target) > 1) {
      pickerScroll.scrollTo({ top: target, behavior: "smooth" });
    }
  }, 90);
}, { passive: true });

function openPicker({ title, items, value, onDone }) {
  $("sheet-title").textContent = title;
  buildPicker(items, value);
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

$("row-sound").addEventListener("click", () => {
  settings.sound = !settings.sound;
  saveSettings();
  renderSettings();
  if (settings.sound) ensureAudio().then(() => playSound());
});

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

