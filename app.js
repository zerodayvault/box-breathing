/* ===== Дыхание — таймер + нативный scroll-snap пикер + свой звук ===== */

const PHASES = [
  { key: "inhale", label: "Вдох"  },
  { key: "hold1",  label: "Пауза" },
  { key: "exhale", label: "Выдох" },
  { key: "hold2",  label: "Пауза" },
];

const SCALE_MIN = 0.93;
const SCALE_MAX = 1.04;

/* ---------- Настройки (localStorage) ---------- */
const defaults = { phaseDuration: 4, totalCycles: 5, sound: true };
let settings = { ...defaults };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem("breath-settings") || "{}"));
} catch (e) {}

function saveSettings() {
  try { localStorage.setItem("breath-settings", JSON.stringify(settings)); } catch (e) {}
}

/* ---------- Свой звук (IndexedDB) ---------- */
const DB_NAME = "breath-db";
const DB_STORE = "audio";
let customSoundBuffer = null;   // AudioBuffer
let customSoundName = null;

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSaveSound(blob, name) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put({ blob, name }, "custom");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbLoadSound() {
  try {
    const db = await dbOpen();
    return await new Promise((resolve) => {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get("custom");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

async function dbDeleteSound() {
  try {
    const db = await dbOpen();
    return await new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete("custom");
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (e) {}
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
  $("toggle-sound").classList.toggle("on", settings.sound);
  $("sound-file-value").textContent = customSoundName || "Стандартный";
  $("total-hint").textContent = `Итого ${formatDuration(settings.phaseDuration * 4 * settings.totalCycles)}`;
}

/* ---------- Звук ---------- */
function getAudioCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioCtx.state === "suspended") state.audioCtx.resume();
  return state.audioCtx;
}

function beep(freq = 660, duration = 0.12) {
  if (!settings.sound) return;
  try {
    const ctx = getAudioCtx();
    if (customSoundBuffer) {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = customSoundBuffer;
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + Math.min(customSoundBuffer.duration, 1.2));
      src.connect(gain).connect(ctx.destination);
      src.start();
      return;
    }
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

/* ---------- Easing ---------- */
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/* ---------- Геометрия квадрата: 100% синхронизация ----------
   Точка позиционируется через getPointAtLength() того же самого
   rect, что и обводка — расхождение невозможно. */
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
  beep(state.phaseIndex === 0 ? 880 : 660);
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
  beep(880, 0.2);
  setTimeout(() => beep(1100, 0.25), 250);
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
   Пикер: нативный scroll с CSS scroll-snap (инерция и rubber-band —
   настоящие, от браузера). На iOS ощущается как UIPickerView.
================================================================ */
const PICKER_ITEM_H = 36;
const PICKER_SPACER_H = 90;

const sheet = $("sheet");
const sheetBackdrop = $("sheet-backdrop");
const pickerScroll = $("picker-scroll");

let picker = null; // { items, index, onDone, scrollTimer }

function buildPicker(items, selectedValue) {
  // очистить, оставив спейсеры
  pickerScroll.querySelectorAll(".picker__item").forEach((el) => el.remove());
  const spacerEnd = pickerScroll.querySelectorAll(".picker__spacer")[1];
  items.forEach((it) => {
    const div = document.createElement("div");
    div.className = "picker__item";
    div.textContent = it.label;
    pickerScroll.insertBefore(div, spacerEnd);
  });
  const index = Math.max(0, items.findIndex((i) => i.value === selectedValue));
  picker = { items, index, onDone: null, scrollTimer: null, lastIndex: index };
  pickerScroll.scrollTop = index * PICKER_ITEM_H;
}

function pickerIndexFromScroll() {
  return Math.min(picker.items.length - 1, Math.max(0, Math.round(pickerScroll.scrollTop / PICKER_ITEM_H)));
}

pickerScroll.addEventListener("scroll", () => {
  if (!picker) return;
  const idx = pickerIndexFromScroll();
  if (idx !== picker.lastIndex) {
    picker.lastIndex = idx;
    picker.index = idx;
  }
  clearTimeout(picker.scrollTimer);
  picker.scrollTimer = setTimeout(() => {
    // доводка до ближайшего элемента после остановки
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

/* ---------- Звук: тумблер + загрузка своего ---------- */
$("row-sound").addEventListener("click", () => {
  settings.sound = !settings.sound;
  saveSettings();
  renderSettings();
  if (settings.sound) beep(660, 0.1); // сразу проверить
});

const soundInput = $("sound-input");
$("row-sound-file").addEventListener("click", () => {
  if (customSoundName) {
    // долгое нажатие не нужно — простое меню: тап = заменить, двойной смысл через confirm
    const replace = confirm("Заменить звук? (Отмена — вернуть стандартный)");
    if (replace) soundInput.click();
    else {
      customSoundBuffer = null;
      customSoundName = null;
      dbDeleteSound();
      renderSettings();
    }
  } else {
    soundInput.click();
  }
});

soundInput.addEventListener("change", async () => {
  const file = soundInput.files && soundInput.files[0];
  if (!file) return;
  try {
    const ctx = getAudioCtx();
    const buf = await file.arrayBuffer();
    customSoundBuffer = await ctx.decodeAudioData(buf);
    customSoundName = file.name.replace(/\.[^.]+$/, "");
    if (customSoundName.length > 18) customSoundName = customSoundName.slice(0, 17) + "…";
    await dbSaveSound(file, customSoundName);
    beep(); // предпрослушка
  } catch (e) {
    alert("Не удалось прочитать аудиофайл");
  }
  soundInput.value = "";
  renderSettings();
});

// восстановить сохранённый звук
(async () => {
  const saved = await dbLoadSound();
  if (saved && saved.blob) {
    try {
      const ctx = getAudioCtxSafe();
      if (ctx) {
        const buf = await saved.blob.arrayBuffer();
        // декодируем лениво при первом старте — AudioContext может быть заблокирован до жеста
        pendingSoundBuf = buf;
        customSoundName = saved.name;
      }
    } catch (e) {}
  }
  renderSettings();
})();

let pendingSoundBuf = null;
function getAudioCtxSafe() {
  try { return getAudioCtx(); } catch (e) { return null; }
}
async function decodePending() {
  if (pendingSoundBuf && !customSoundBuffer) {
    try {
      customSoundBuffer = await getAudioCtx().decodeAudioData(pendingSoundBuf.slice(0));
    } catch (e) {}
  }
}

/* ---------- События ---------- */
$("btn-start").addEventListener("click", () => { decodePending(); start(); });
$("btn-pause").addEventListener("click", togglePause);
$("btn-stop").addEventListener("click", stop);
$("btn-again").addEventListener("click", () => { decodePending(); start(); });
$("btn-settings").addEventListener("click", stop);

/* ---------- Service Worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

renderSettings();
