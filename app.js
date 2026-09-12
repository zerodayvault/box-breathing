/* ===== Квадратное дыхание — логика таймера ===== */

const PHASES = [
  { key: "inhale", label: "Вдох",  edge: "top"    }, // слева направо
  { key: "hold1",  label: "Пауза", edge: "right"  }, // сверху вниз
  { key: "exhale", label: "Выдох", edge: "bottom" }, // справа налево
  { key: "hold2",  label: "Пауза", edge: "left"   }, // снизу вверх
];

const state = {
  phaseDuration: 4,   // секунды на фазу
  totalCycles: 5,
  running: false,
  paused: false,
  cycle: 1,
  phaseIndex: 0,
  phaseStart: 0,      // timestamp начала фазы
  pauseStart: 0,
  rafId: null,
  audioCtx: null,
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const screens = {
  setup: $("screen-setup"),
  session: $("screen-session"),
  done: $("screen-done"),
};
const dot = $("dot");
const phaseLabel = $("phase-label");
const countLabel = $("count-label");
const cycleLabel = $("cycle-label");
const btnPause = $("btn-pause");

/* ---------- Экраны ---------- */
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

/* ---------- Степперы ---------- */
function bindStepper(minusId, plusId, valueId, get, set, min, max, format) {
  const valueEl = $(valueId);
  const render = () => { valueEl.textContent = format(get()); };
  $(minusId).addEventListener("click", () => { set(Math.max(min, get() - 1)); render(); });
  $(plusId).addEventListener("click",  () => { set(Math.min(max, get() + 1)); render(); });
  render();
}

bindStepper("phase-minus", "phase-plus", "phase-value",
  () => state.phaseDuration, (v) => (state.phaseDuration = v), 2, 10, (v) => `${v} с`);

bindStepper("cycles-minus", "cycles-plus", "cycles-value",
  () => state.totalCycles, (v) => (state.totalCycles = v), 1, 20, (v) => `${v}`);

/* ---------- Звук (тихий сигнал на смену фазы) ---------- */
function beep(freq = 660, duration = 0.12) {
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
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* звук недоступен — не страшно */ }
}

/* ---------- Вибрация ---------- */
function buzz(ms = 40) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

/* ---------- Позиция точки на периметре квадрата ---------- */
function moveDot(edge, progress) {
  // progress: 0..1 вдоль текущей стороны
  let x, y; // в процентах 0..100
  switch (edge) {
    case "top":    x = progress * 100;       y = 0;                 break;
    case "right":  x = 100;                  y = progress * 100;    break;
    case "bottom": x = (1 - progress) * 100; y = 100;               break;
    case "left":   x = 0;                    y = (1 - progress) * 100; break;
  }
  dot.style.left = x + "%";
  dot.style.top = y + "%";
}

/* ---------- Цикл таймера ---------- */
function tick(now) {
  if (!state.running || state.paused) return;

  const elapsed = (now - state.phaseStart) / 1000;
  const phase = PHASES[state.phaseIndex];
  const progress = Math.min(elapsed / state.phaseDuration, 1);

  moveDot(phase.edge, progress);

  const remaining = Math.ceil(state.phaseDuration - elapsed);
  countLabel.textContent = Math.max(remaining, 0);

  if (elapsed >= state.phaseDuration) {
    nextPhase(now);
  }
  state.rafId = requestAnimationFrame(tick);
}

function nextPhase(now) {
  state.phaseIndex++;
  if (state.phaseIndex >= PHASES.length) {
    state.phaseIndex = 0;
    state.cycle++;
    if (state.cycle > state.totalCycles) {
      finish();
      return;
    }
    cycleLabel.textContent = `Цикл ${state.cycle} / ${state.totalCycles}`;
  }
  const phase = PHASES[state.phaseIndex];
  phaseLabel.textContent = phase.label;
  state.phaseStart = now;
  beep(state.phaseIndex === 0 ? 880 : 660);
  buzz(30);
}

/* ---------- Управление ---------- */
function start() {
  state.running = true;
  state.paused = false;
  state.cycle = 1;
  state.phaseIndex = 0;
  phaseLabel.textContent = PHASES[0].label;
  cycleLabel.textContent = `Цикл 1 / ${state.totalCycles}`;
  countLabel.textContent = state.phaseDuration;
  btnPause.textContent = "Пауза";
  showScreen("session");
  beep(880);
  buzz(50);
  state.phaseStart = performance.now();
  state.rafId = requestAnimationFrame(tick);
}

function togglePause() {
  if (!state.running) return;
  if (state.paused) {
    state.paused = false;
    btnPause.textContent = "Пауза";
    state.phaseStart = performance.now() - (state.pauseStart - state.phaseStart);
    state.rafId = requestAnimationFrame(tick);
  } else {
    state.paused = true;
    btnPause.textContent = "Продолжить";
    state.pauseStart = performance.now();
    cancelAnimationFrame(state.rafId);
  }
}

function stop() {
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.rafId);
  showScreen("setup");
}

function finish() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  const totalSec = state.phaseDuration * 4 * state.totalCycles;
  $("done-text").textContent = `${state.totalCycles} циклов · ${totalSec} секунд`;
  beep(880, 0.2);
  setTimeout(() => beep(1100, 0.25), 250);
  buzz([60, 80, 60]);
  showScreen("done");
}

/* ---------- События ---------- */
$("btn-start").addEventListener("click", start);
$("btn-pause").addEventListener("click", togglePause);
$("btn-stop").addEventListener("click", stop);
$("btn-again").addEventListener("click", start);
$("btn-settings").addEventListener("click", stop);

/* Не даём экрану уснуть во время сессии (NoSleep через видео-трюк не нужен —
   requestWakeLock поддерживается в Safari 16.4+) */
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (e) { /* не критично */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.running) requestWakeLock();
});
$("btn-start").addEventListener("click", requestWakeLock);

/* ---------- Service Worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
