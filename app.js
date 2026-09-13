/* ===== Дыхание — таймер квадратного дыхания 4-4-4-4 =====
   Сессия построена на абсолютной временной шкале: фаза и цикл всегда
   вычисляются из performance.now(), поэтому дрейф, троттлинг таймеров
   и уход вкладки в фон не рассинхронизируют таймер. */

/* У каждой фазы свой акцент: интерфейс мягко перекрашивается по ходу цикла. */
const PHASES = [
  { key: "inhale", label: "Вдох",  color: "#64d2ff" },
  { key: "hold1",  label: "Пауза", color: "#5e5ce6" },
  { key: "exhale", label: "Выдох", color: "#30d158" },
  { key: "hold2",  label: "Пауза", color: "#5e5ce6" },
];

const SCALE_MIN = 0.93;
const SCALE_MAX = 1.04;
const SOUND_URL = "sounds/phase.wav";
const COUNTDOWN_SEC = 3;

const PHASE_MIN = 2,  PHASE_MAX = 10;
const CYCLES_MIN = 1, CYCLES_MAX = 20;

const STORAGE_KEY = "breath-settings";
const VIEW = 300;          // размер viewBox квадрата
const GEO_SAMPLES = 512;   // точек таблицы периметра

/* ---------- Хелперы ---------- */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function plural(n, one, few, many) {
  const m = Math.abs(n) % 100, d = m % 10;
  if (m > 10 && m < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}

function formatDuration(totalSec) {
  totalSec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  if (m === 0) return `${s} сек`;
  if (s === 0) return `${m} мин`;
  return `${m} мин ${s} сек`;
}

/* ---------- Настройки ---------- */
const defaults = { phaseDuration: 4, totalCycles: 5, sound: true };

/* Число, приведённое из null/undefined, дало бы 0 и сдвинуло бы значение
   к нижней границе вместо дефолта — поэтому отсутствие поля проверяем отдельно. */
function toBoundedInt(value, fallback, lo, hi) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.round(n), lo, hi);
}

function sanitizeSettings(raw) {
  const out = { ...defaults };
  if (!raw || typeof raw !== "object") return out;

  out.phaseDuration = toBoundedInt(raw.phaseDuration, out.phaseDuration, PHASE_MIN, PHASE_MAX);
  out.totalCycles = toBoundedInt(raw.totalCycles, out.totalCycles, CYCLES_MIN, CYCLES_MAX);

  if (typeof raw.sound === "boolean") out.sound = raw.sound;
  return out;
}

let settings = defaults;
try {
  settings = sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
} catch (e) {
  console.warn("[breath] не удалось прочитать настройки:", e);
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch (e) { console.warn("[breath] не удалось сохранить настройки:", e); }
}

/* ---------- Состояние ---------- */
const state = {
  running: false,        // идут фазы сессии
  counting: false,       // идёт отсчёт 3-2-1
  paused: false,
  pauseStart: 0,
  countdownLeft: 0,
  countdownTimer: null,
  audioReady: false,     // звук готов — можно заводить интервал отсчёта
  rafId: null,
  cueTimer: null,        // setTimeout до следующей границы фазы (звук в фоне)
  cueAt: null,
  sessionToken: 0,       // инвалидирует отложенные колбэки после «Стоп»
  audioCtx: null,
  audioBuffer: null,
  lastCount: null,
  session: null,         // снимок параметров + данные временной шкалы
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const screens = { setup: $("screen-setup"), session: $("screen-session"), done: $("screen-done") };
const dot = $("dot");
const box = $("box");
const stage = $("box-stage");
const boxProgress = $("box-progress");
const phaseLabel = $("phase-label");
const countLabel = $("count-label");
const cycleLabel = $("cycle-label");
const pauseIcon = $("pause-icon");
const btnPause = $("btn-pause");

function showScreen(name) {
  if (!screens[name]) { console.error("[breath] неизвестный экран:", name); return; }
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function pulseValue(rowId) {
  const row = $(rowId);
  const el = row && row.querySelector(".list__value");
  if (!el) return;
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
}

function setToggle(toggleId, on, rowId) {
  const t = $(toggleId);
  if (t) t.classList.toggle("on", on);
  const row = rowId && $(rowId);
  if (row) row.setAttribute("aria-checked", on ? "true" : "false");
}

function renderSettings() {
  $("phase-value").textContent = `${settings.phaseDuration} сек`;
  $("cycles-value").textContent = `${settings.totalCycles}`;
  setToggle("toggle-sound", settings.sound, "row-sound");
  $("total-hint").textContent =
    `Итого ${formatDuration(settings.phaseDuration * PHASES.length * settings.totalCycles)}`;
}

/* ---------- Тема фазы ---------- */
function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(100, 210, 255, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* Акцент живёт в CSS-переменных: прогресс, точка, свечение и кнопки
   перекрашиваются одним движением, с плавными CSS-переходами. */
function applyPhaseTheme(color) {
  const root = document.documentElement.style;
  root.setProperty("--accent", color);
  root.setProperty("--accent-glow", hexToRgba(color, 0.5));
  root.setProperty("--accent-soft", hexToRgba(color, 0.16));
  root.setProperty("--accent-wash", hexToRgba(color, 0.07));
}

/* ---------- Звук ---------- */
let audioLoading = null;

function decodeAudio(ctx, data) {
  // Chrome возвращает promise, старый Safari — только колбэки; поддержим оба.
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (buf) => { if (!settled && buf) { settled = true; resolve(buf); } };
    const fail = (err) => { if (!settled) { settled = true; reject(err || new Error("decode failed")); } };
    try {
      const p = ctx.decodeAudioData(data, ok, fail);
      if (p && typeof p.then === "function") p.then(ok, fail);
    } catch (e) { fail(e); }
  });
}

async function loadSoundBuffer(ctx) {
  const res = await fetch(SOUND_URL, { cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decodeAudio(ctx, await res.arrayBuffer());
}

async function ensureAudio() {
  try {
    if (!state.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      state.audioCtx = new Ctx();
    }
    if (state.audioCtx.state === "suspended") await state.audioCtx.resume();
    if (!state.audioBuffer) {
      if (!audioLoading) audioLoading = loadSoundBuffer(state.audioCtx);
      state.audioBuffer = await audioLoading;
    }
    return true;
  } catch (e) {
    audioLoading = null;
    state.audioBuffer = null;
    console.warn("[breath] звук недоступен, используется запасной сигнал:", e);
    return false;
  }
}

function playTone(freq, dur, vol) {
  if (!state.audioCtx) return;
  try {
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch (e) {}
}

function playSound() {
  if (!settings.sound || !state.audioCtx) return;
  if (state.audioBuffer) {
    try {
      const ctx = state.audioCtx;
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = state.audioBuffer;
      gain.gain.value = 0.6;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return;
    } catch (e) {}
  }
  playTone(880, 0.15, 0.07);
}

/* ---------- Easing ---------- */
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/* ---------- Геометрия ---------- */
let geo = null;

function initGeometry() {
  if (geo) return geo;
  const track = document.querySelector(".box__track");
  let perimeter = null;
  let points = null;

  try {
    if (track && typeof track.getTotalLength === "function") {
      perimeter = track.getTotalLength();
      // Таблица точек считывается один раз — дальше только линейная интерполяция.
      points = [];
      for (let i = 0; i <= GEO_SAMPLES; i++) {
        points.push(track.getPointAtLength((perimeter * i) / GEO_SAMPLES));
      }
    }
  } catch (e) {
    points = null;
    perimeter = null;
  }

  if (!perimeter) {
    // аналитический периметр скруглённого квадрата 272x272, r=56
    const side = 272, r = 56;
    perimeter = (side - 2 * r) * 4 + (Math.PI / 2) * r * 4;
  }

  boxProgress.style.strokeDasharray = `${perimeter}`;
  geo = { perimeter, points };
  updateDotMetrics();
  return geo;
}

/* Размер бокса нужен, чтобы двигать точку через transform (композиторный
   слой) вместо left/top (перерасчёт макета 60 раз в секунду).
   offsetWidth не зависит от CSS-масштаба родителя. */
let dotMetrics = { size: 0, perView: 0 };

function updateDotMetrics() {
  const size = box.offsetWidth || 0;
  if (size > 0 && Number.isFinite(size)) {
    dotMetrics = { size, perView: size / VIEW };
  } else {
    dotMetrics = { size: 0, perView: 0 };
  }
}

function pointAt(len) {
  const g = geo;
  if (!g || !g.points) return null;
  const t = clamp(len / g.perimeter, 0, 1) * (g.points.length - 1);
  const i = clamp(Math.floor(t), 0, g.points.length - 2);
  const f = t - i;
  const a = g.points[i], b = g.points[i + 1];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function renderSession(overallProgress, phaseProgress, phaseKey) {
  const { perimeter } = initGeometry();
  const len = overallProgress * perimeter;
  boxProgress.style.strokeDashoffset = `${perimeter - len}`;

  const pt = pointAt(len);
  let vx, vy;
  if (pt) {
    vx = pt.x;
    vy = pt.y;
  } else {
    const p = ((overallProgress % 1) + 1) % 1;
    let nx, ny;
    if (p < 0.25)      { nx = p / 0.25;             ny = 0; }
    else if (p < 0.5)  { nx = 1;                    ny = (p - 0.25) / 0.25; }
    else if (p < 0.75) { nx = 1 - (p - 0.5) / 0.25; ny = 1; }
    else               { nx = 0;                    ny = 1 - (p - 0.75) / 0.25; }
    vx = nx * VIEW;
    vy = ny * VIEW;
  }

  if (dotMetrics.perView > 0) {
    dot.style.transform =
      `translate3d(${(vx * dotMetrics.perView).toFixed(2)}px, ${(vy * dotMetrics.perView).toFixed(2)}px, 0) translate(-50%, -50%)`;
  } else {
    // запасной путь, если размеры ещё не измерены
    dot.style.transform = "";
    dot.style.left = (vx / VIEW) * 100 + "%";
    dot.style.top = (vy / VIEW) * 100 + "%";
  }

  const t = easeInOutSine(clamp(phaseProgress, 0, 1));
  const range = SCALE_MAX - SCALE_MIN;
  let scale = SCALE_MIN;
  switch (phaseKey) {
    case "inhale": scale = SCALE_MIN + range * t; break;
    case "hold1":  scale = SCALE_MAX; break;
    case "exhale": scale = SCALE_MAX - range * t; break;
    case "hold2":  scale = SCALE_MIN; break;
  }
  box.style.transform = `scale(${scale.toFixed(4)})`;

  // Свечение за квадратом «дышит» синхронно с масштабом.
  if (stage) {
    const breath = (scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
    stage.style.setProperty("--breath", breath.toFixed(3));
  }
}

/* ---------- Анимации текста ---------- */
function animateCount(n) {
  if (n === state.lastCount) return;
  state.lastCount = n;
  countLabel.textContent = n;
  countLabel.classList.remove("tick", "countdown");
  void countLabel.offsetWidth;
  countLabel.classList.add("tick");
}

function animatePhaseSwap() {
  phaseLabel.classList.remove("swap");
  void phaseLabel.offsetWidth;
  phaseLabel.classList.add("swap");
}

/* ---------- Пауза: общий UI ---------- */
const ICON_PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1.6" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.6" fill="currentColor"/>';
const ICON_PLAY  = '<path d="M8 5.5v13c0 1.2 1.3 1.9 2.3 1.3l10-6.5c0.9-0.6 0.9-2 0-2.6l-10-6.5C9.3 3.6 8 4.3 8 5.5z" fill="currentColor"/>';

function setPausedUI(paused) {
  pauseIcon.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
  btnPause.setAttribute("aria-label", paused ? "Продолжить" : "Пауза");
  btnPause.setAttribute("aria-pressed", paused ? "true" : "false");
  screens.session.classList.toggle("is-paused", paused);
}

/* ---------- Обратный отсчёт перед стартом ---------- */
/* UI отсчёта рисуется сразу при нажатии «Начать», а интервал заводится,
   только когда готов звук. Иначе пауза/стоп во время загрузки звука
   теряются, а экран выглядит зависшим. */
function startCountdownInterval(token) {
  if (token !== state.sessionToken) return;
  if (!state.counting || state.paused || !state.audioReady) return;
  clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => countdownStep(token), 1000);
}

function countdownStep(token) {
  if (token !== state.sessionToken) { clearInterval(state.countdownTimer); return; }
  state.countdownLeft--;
  if (state.countdownLeft <= 0) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    state.counting = false;
    state.paused = false;
    beginSession(token);
  } else {
    countLabel.classList.remove("countdown");
    void countLabel.offsetWidth;
    countLabel.classList.add("countdown");
    countLabel.textContent = state.countdownLeft;
    playTone(440, 0.08, 0.05);

  }
}

/* ---------- Сессия ---------- */
function beginSession(token) {
  if (token !== state.sessionToken) return;

  const phaseMs = settings.phaseDuration * 1000;
  state.session = {
    phaseDuration: settings.phaseDuration,
    cycles: settings.totalCycles,
    phaseMs,
    cycleMs: phaseMs * PHASES.length,
    totalMs: phaseMs * PHASES.length * settings.totalCycles,
    timelineStart: performance.now(),
    pausedTotal: 0,
    cycle: -1,
    phaseIndex: -1,
  };

  state.running = true;
  state.paused = false;
  state.lastCount = null;
  countLabel.classList.remove("countdown");
  setPausedUI(false);
  startLoop();
  syncTo(performance.now(), true);
}

/* Единственный источник правды: пересчёт состояния из абсолютного времени. */
function syncTo(now, isFirst) {
  const s = state.session;
  if (!state.running || state.paused || !s) return;

  const elapsed = Math.max(0, now - s.timelineStart - s.pausedTotal);
  if (elapsed >= s.totalMs) { finish(); return; }

  const cycle = Math.floor(elapsed / s.cycleMs);
  const inCycle = elapsed - cycle * s.cycleMs;
  const phaseIndex = clamp(Math.floor(inCycle / s.phaseMs), 0, PHASES.length - 1);
  const phaseElapsed = inCycle - phaseIndex * s.phaseMs;
  const phaseProgress = phaseElapsed / s.phaseMs;
  const phase = PHASES[phaseIndex];

  if (cycle !== s.cycle || phaseIndex !== s.phaseIndex) {
    const newCycle = cycle !== s.cycle;
    s.cycle = cycle;
    s.phaseIndex = phaseIndex;
    if (newCycle) cycleLabel.textContent = `Цикл ${cycle + 1} из ${s.cycles}`;
    phaseLabel.textContent = phase.label;
    animatePhaseSwap();
    state.lastCount = null;
    applyPhaseTheme(phase.color);
    if (isFirst) playTone(880, 0.09, 0.05);
    else playSound();
  }

  renderSession((phaseIndex + phaseProgress) / PHASES.length, phaseProgress, phase.key);
  animateCount(clamp(Math.ceil((s.phaseMs - phaseElapsed) / 1000), 1, s.phaseDuration));

  const nextBoundary = s.timelineStart + s.pausedTotal + (cycle * PHASES.length + phaseIndex + 1) * s.phaseMs;
  scheduleCue(now, nextBoundary);
}

/* setTimeout на границу фазы: сигнал срабатывает даже когда rAF заморожен. */
function scheduleCue(now, boundaryAt) {
  if (state.cueAt === boundaryAt) return;
  state.cueAt = boundaryAt;
  clearTimeout(state.cueTimer);
  state.cueTimer = setTimeout(() => {
    state.cueTimer = null;
    syncTo(performance.now());
  }, Math.max(0, boundaryAt - now) + 2);
}

function startLoop() {
  cancelAnimationFrame(state.rafId);
  const frame = (ts) => {
    if (!state.running || state.paused) { state.rafId = null; return; }
    syncTo(ts);
    if (!state.running || state.paused) { state.rafId = null; return; }
    state.rafId = requestAnimationFrame(frame);
  };
  state.rafId = requestAnimationFrame(frame);
}

function clearTimers() {
  cancelAnimationFrame(state.rafId);
  state.rafId = null;
  clearTimeout(state.cueTimer);
  state.cueTimer = null;
  state.cueAt = null;
  clearInterval(state.countdownTimer);
  state.countdownTimer = null;
}

function start() {
  const token = ++state.sessionToken;
  clearTimers();
  state.running = false;
  state.paused = false;
  state.session = null;
  state.lastCount = null;
  state.counting = true;
  state.countdownLeft = COUNTDOWN_SEC;
  state.audioReady = false;

  applyPhaseTheme(PHASES[0].color);
  cycleLabel.textContent = `Цикл 1 из ${settings.totalCycles}`;
  phaseLabel.textContent = "Приготовьтесь";
  animatePhaseSwap();
  countLabel.classList.remove("tick");
  countLabel.classList.add("countdown");
  countLabel.textContent = COUNTDOWN_SEC;
  showScreen("session");
  initGeometry();
  renderSession(0, 0, "hold2");
  setPausedUI(false);
  requestWakeLock();

  // AudioContext создаётся синхронно внутри пользовательского жеста
  // (требование iOS Safari), а сам отсчёт стартует по готовности звука.
  ensureAudio()
    .then(() => {
      if (token !== state.sessionToken) return;
      state.audioReady = true;
      try {
        playTone(440, 0.08, 0.05);

      } catch (e) { /* звук не должен блокировать сессию */ }
      startCountdownInterval(token);
    })
    .catch(() => {
      // Даже если подготовка звука упала — отсчёт обязан начаться.
      if (token !== state.sessionToken) return;
      state.audioReady = true;
      startCountdownInterval(token);
    });
}

function togglePause() {
  if (state.counting) {
    if (state.paused) {
      state.paused = false;
      setPausedUI(false);
      startCountdownInterval(state.sessionToken);
    } else {
      state.paused = true;
      setPausedUI(true);
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
    return;
  }

  if (!state.running || !state.session) return;

  if (state.paused) {
    state.session.pausedTotal += performance.now() - state.pauseStart;
    state.paused = false;
    setPausedUI(false);
    startLoop();
    syncTo(performance.now());
  } else {
    state.paused = true;
    state.pauseStart = performance.now();
    clearTimers();
    setPausedUI(true);

  }
}

function stop() {
  state.sessionToken++;      // гасит отложенные колбэки ensureAudio/отсчёта
  clearTimers();
  state.running = false;
  state.counting = false;
  state.audioReady = false;
  state.paused = false;
  state.session = null;
  state.lastCount = null;
  releaseWakeLock();
  applyPhaseTheme(PHASES[0].color);
  renderSettings();
  showScreen("setup");
}

function finish() {
  state.running = false;
  state.counting = false;
  state.audioReady = false;
  clearTimers();
  releaseWakeLock();

  const s = state.session;
  const cycles = s ? s.cycles : settings.totalCycles;
  const phaseDuration = s ? s.phaseDuration : settings.phaseDuration;
  $("done-text").textContent =
    `${cycles} ${plural(cycles, "цикл", "цикла", "циклов")} · ${formatDuration(phaseDuration * PHASES.length * cycles)}`;

  playSound();

  const doneToken = state.sessionToken;
  setTimeout(() => {
    // второй тон финала — только если пользователь ещё не начал новую сессию
    if (doneToken === state.sessionToken && !state.running && !state.counting) playSound();
  }, 300);

  state.session = null;
  applyPhaseTheme(PHASES[0].color);
  showScreen("done");
}

/* ---------- Ресайз ---------- */
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    updateDotMetrics();
    if (state.running || state.counting) renderSession(0, 0, "hold2");
  }, 150);
});

/* ---------- Wake Lock ---------- */
let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => { wakeLock = null; });
    wakeLock = lock;
  } catch (e) {
    wakeLock = null;
  }
}

async function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  try { if (lock) await lock.release(); } catch (e) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!state.running && !state.counting) return;

  requestWakeLock();
  ensureAudio();   // контекст мог быть приостановлен системой

  // В фоне rAF не тикает, а setTimeout троттлится: догоняем состояние сразу,
  // не дожидаясь следующего кадра.
  if (state.running && !state.paused) {
    startLoop();
    syncTo(performance.now());
  } else if (state.counting && !state.paused) {
    startCountdownInterval(state.sessionToken);
  }
});

/* ================================================================
   Пикер: нативный scroll + scroll-snap
================================================================ */
const PICKER_ITEM_H = 36;
const SHEET_CLOSE_MS = 250;

const sheet = $("sheet");
const sheetBackdrop = $("sheet-backdrop");
const pickerScroll = $("picker-scroll");

let picker = null;
let sheetOpen = false;
let sheetCloseTimer = null;
let lastFocus = null;
let dragging = false;

function buildPicker(items, selectedValue) {
  pickerScroll.querySelectorAll(".picker__item").forEach((el) => el.remove());
  const spacerEnd = pickerScroll.querySelectorAll(".picker__spacer")[1];

  const frag = document.createDocumentFragment();
  items.forEach((it) => {
    const div = document.createElement("div");
    div.className = "picker__item";
    div.textContent = it.label;
    div.dataset.value = String(it.value);
    frag.appendChild(div);
  });
  pickerScroll.insertBefore(frag, spacerEnd);

  const found = items.findIndex((i) => i.value === selectedValue);
  picker = { items, index: found < 0 ? 0 : found, onDone: null, scrollTimer: null, targetRowId: null };

  pickerScroll.scrollTop = picker.index * PICKER_ITEM_H;
  markActiveItem();
}

function pickerIndexFromScroll() {
  if (!picker) return 0;
  return clamp(Math.round(pickerScroll.scrollTop / PICKER_ITEM_H), 0, picker.items.length - 1);
}

function markActiveItem() {
  if (!picker) return;
  pickerScroll.querySelectorAll(".picker__item").forEach((el, i) => {
    el.classList.toggle("is-active", i === picker.index);
  });
}

function snapToIndex(smooth) {
  if (!picker) return;
  const target = picker.index * PICKER_ITEM_H;
  if (Math.abs(pickerScroll.scrollTop - target) < 1) return;
  try { pickerScroll.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" }); }
  catch (e) { pickerScroll.scrollTop = target; }
}

pickerScroll.addEventListener("scroll", () => {
  if (!picker) return;
  picker.index = pickerIndexFromScroll();
  markActiveItem();
  clearTimeout(picker.scrollTimer);
  picker.scrollTimer = setTimeout(() => snapToIndex(true), 90);
}, { passive: true });

/* Тап по строке — выбрать значение; прокрутку пальцем тапом не считаем. */
pickerScroll.addEventListener("touchstart", () => { dragging = false; }, { passive: true });
pickerScroll.addEventListener("touchmove", () => { dragging = true; }, { passive: true });
pickerScroll.addEventListener("click", (e) => {
  if (!picker || dragging) return;
  const item = e.target.closest(".picker__item");
  if (!item) return;
  const index = Array.prototype.indexOf.call(pickerScroll.querySelectorAll(".picker__item"), item);
  if (index < 0) return;
  picker.index = index;
  dragging = false;
  markActiveItem();
  snapToIndex(true);

});

function openPicker({ title, items, value, onDone, targetRowId }) {
  clearTimeout(sheetCloseTimer);
  sheetCloseTimer = null;
  sheet.classList.remove("closing", "hidden");
  sheetBackdrop.classList.remove("closing", "hidden");

  $("sheet-title").textContent = title;
  buildPicker(items, value);
  picker.onDone = onDone;
  picker.targetRowId = targetRowId || null;

  sheetOpen = true;
  lastFocus = document.activeElement;
  sheet.setAttribute("aria-hidden", "false");
  sheetBackdrop.setAttribute("aria-hidden", "false");
  try { sheet.focus({ preventScroll: true }); } catch (e) {}
}

function closePicker(apply) {
  if (!sheetOpen) return;
  sheetOpen = false;

  if (apply && picker && typeof picker.onDone === "function") {
    const item = picker.items[picker.index];
    if (item) {
      picker.onDone(item.value);
      saveSettings();
      renderSettings();
      if (picker.targetRowId) pulseValue(picker.targetRowId);

    }
  }

  sheet.setAttribute("aria-hidden", "true");
  sheetBackdrop.setAttribute("aria-hidden", "true");
  sheet.classList.add("closing");
  sheetBackdrop.classList.add("closing");

  clearTimeout(sheetCloseTimer);
  sheetCloseTimer = setTimeout(() => {
    sheetCloseTimer = null;
    sheet.classList.add("hidden");
    sheetBackdrop.classList.add("hidden");
    sheet.classList.remove("closing");
    sheetBackdrop.classList.remove("closing");
    if (lastFocus && typeof lastFocus.focus === "function") {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
  }, SHEET_CLOSE_MS);
}

function openPhasePicker() {
  const items = [];
  for (let i = PHASE_MIN; i <= PHASE_MAX; i++) items.push({ value: i, label: `${i} сек` });
  openPicker({
    title: "Длительность фазы",
    items,
    value: settings.phaseDuration,
    targetRowId: "row-phase",
    onDone: (v) => { settings.phaseDuration = v; },
  });
}

function openCyclesPicker() {
  const items = [];
  for (let i = CYCLES_MIN; i <= CYCLES_MAX; i++) items.push({ value: i, label: `${i}` });
  openPicker({
    title: "Циклы",
    items,
    value: settings.totalCycles,
    targetRowId: "row-cycles",
    onDone: (v) => { settings.totalCycles = v; },
  });
}

function toggleSetting(key) {
  settings[key] = !settings[key];
  saveSettings();
  renderSettings();
  if (settings.sound && key === "sound") ensureAudio().then(() => playSound());
}

/* ================================================================
   Обработка нажатий
================================================================ */
const actions = {
  "btn-start": start,
  "btn-again": start,
  "btn-settings": stop,
  "btn-pause": togglePause,
  "btn-stop": stop,
  "row-phase": openPhasePicker,
  "row-cycles": openCyclesPicker,
  "row-sound": () => toggleSetting("sound"),
  "sheet-cancel": () => closePicker(false),
  "sheet-done": () => closePicker(true),
};

function fireAction(el) {
  try {
    actions[el.id]();
  } catch (e) {
    console.error(`[breath] ошибка в действии "${el.id}":`, e);
  }
}

/* Важно: поднимаемся по дереву до ПЕРВОГО элемента с известным действием.
   closest("[id]") здесь не годится — он остановился бы на вложенном
   <svg id="pause-icon">, и кнопка паузы перестала бы реагировать на тап
   по иконке (то есть почти всегда на телефоне). */
function actionableFrom(target) {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.documentElement) {
    if (el.id && Object.prototype.hasOwnProperty.call(actions, el.id)) return el;
    el = el.parentElement;
  }
  return null;
}

/* Дедупликация именно пары touchend→click (она приходит через 10–50 мс),
   а не всех нажатий подряд: сознательные быстрые тапы не должны теряться. */
const lastTouchAt = new Map();
const TOUCH_CLICK_DEDUPE_MS = 500;

document.addEventListener("touchend", (e) => {
  const el = actionableFrom(e.target);
  if (!el) return;
  e.preventDefault();
  lastTouchAt.set(el.id, Date.now());
  fireAction(el);
}, { passive: false });

document.addEventListener("click", (e) => {
  const el = actionableFrom(e.target);
  if (!el) return;
  // preventDefault обычно гасит click, но не во всех браузерах — страхуемся.
  if (Date.now() - (lastTouchAt.get(el.id) || 0) < TOUCH_CLICK_DEDUPE_MS) return;
  fireAction(el);
});

sheetBackdrop.addEventListener("click", () => closePicker(false));

/* ---------- Клавиатура ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (sheetOpen) { e.preventDefault(); closePicker(false); }
    return;
  }

  if (sheetOpen) {
    if (!picker) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      picker.index = clamp(picker.index + (e.key === "ArrowUp" ? -1 : 1), 0, picker.items.length - 1);
      markActiveItem();
      snapToIndex(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      closePicker(true);
    }
    return;
  }

  const onButton = e.target instanceof Element && e.target.closest("button");
  if ((e.key === " " || e.key === "Spacebar") && !onButton && (state.running || state.counting)) {
    e.preventDefault();
    togglePause();
  }
});

/* ---------- Service Worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => {
      console.warn("[breath] service worker не зарегистрирован:", e);
    });
  });
}

renderSettings();
