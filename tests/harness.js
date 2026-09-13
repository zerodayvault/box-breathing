/* Мини-DOM shim + управляемые часы для теста логики app.js.
   app.js выполняется в изолированном vm-контексте, поэтому тест видит
   его внутренние let/const-привязки (state, settings, syncTo, ...).

   Честно моделируем:
   - rAF с каденцией 16мс (иначе кадр никогда не сдвинет время),
   - setTimeout/setInterval по виртуальным часам,
   - дерево parentElement (чтобы тесты ловили баги обхода DOM),
   - приведение textContent к строке (как в настоящем DOM),
   - элементы создаются в realm песочницы, иначе `instanceof Element`
     внутри app.js для них всегда false. */
"use strict";
const fs = require("fs");
const vm = require("vm");

let now = 0;
const FRAME_MS = 16;

const elements = {};
const classState = {};
const listeners = {};
const pending = [];        // {id, at, every, kind, fn, cancelled}
let seq = 0;
const log = { sounds: 0, tones: 0, vibrates: 0, console: [] };

/* --- песочница создаётся ПЕРВОЙ: элементы должны жить в её realm --- */
function makeAudioCtx() {
  return {
    state: "running", currentTime: 0,
    resume() { return Promise.resolve(); },
    decodeAudioData() { return Promise.reject(new Error("no decode")); },
    createOscillator() { return { type:"", frequency:{value:0}, connect(){return this;}, start(){log.tones++;}, stop(){} }; },
    createGain() { return { gain:{ value:0, setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){ return { connect(){} }; } }; },
    createBufferSource() { return { buffer:null, connect(){ return { connect(){} }; }, start(){ log.sounds++; } }; },
    destination: {},
  };
}

const sandbox = {
  console: {
    log: (...a) => log.console.push(["log", ...a]),
    warn: (...a) => log.console.push(["warn", ...a]),
    error: (...a) => log.console.push(["error", ...a]),
  },
  performance: { now: () => now },
  navigator: {
    vibrate: () => { log.vibrates++; return true; },
    serviceWorker: { register: () => Promise.resolve({}) },
    wakeLock: { request: () => Promise.resolve({ addEventListener() {}, release: () => Promise.resolve() }) },
  },
  localStorage: {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
  setTimeout(fn, ms) { const t = { id: ++seq, at: now + (ms || 0), every: 0, kind: "timeout", fn, cancelled: false }; pending.push(t); return t.id; },
  clearTimeout(id) { const t = pending.find(x => x.id === id); if (t) t.cancelled = true; },
  setInterval(fn, ms) { const t = { id: ++seq, at: now + (ms || 1), every: ms || 1, kind: "interval", fn, cancelled: false }; pending.push(t); return t.id; },
  clearInterval(id) { const t = pending.find(x => x.id === id); if (t) t.cancelled = true; },
  requestAnimationFrame(cb) { const t = { id: ++seq, at: now + FRAME_MS, every: 0, kind: "raf", fn: cb, cancelled: false }; pending.push(t); return t.id; },
  cancelAnimationFrame(id) { const t = pending.find(x => x.id === id); if (t) t.cancelled = true; },
  fetch: () => Promise.reject(new Error("offline in test")),
  Math, JSON, Number, Object, Array, String, Boolean, Date, Promise, Map, Set, Error, Symbol, RegExp,
  Infinity, NaN, undefined, isNaN, isFinite, parseInt, parseFloat,
};
sandbox.window = sandbox;
sandbox.AudioContext = makeAudioCtx;
sandbox.globalThis = sandbox;
sandbox.addEventListener = (type, fn) => { listeners["window:" + type] = fn; };
sandbox.removeEventListener = () => {};

const ctx = vm.createContext(sandbox);

/* Класс Element живёт в realm песочницы: тогда внутри app.js
   проверка `target instanceof Element` для наших элементов проходит. */
const ElementCtor = vm.runInContext(
  "class Element { constructor(id, tag) { this.nodeType = 1; this.id = id || ''; this.tagName = (tag || 'DIV').toUpperCase(); } } Element",
  ctx
);

function makeEl(id, tag) {
  const el = new ElementCtor(id, tag);
  let tc = "";
  Object.assign(el, {
    innerHTML: "",
    dataset: {}, attrs: {},
    style: {
      _props: {},
      setProperty(k, v) { this._props[k] = String(v); this[k] = String(v); },
      removeProperty(k) { delete this._props[k]; delete this[k]; },
      getPropertyValue(k) { return this._props[k] || ""; },
    },
    offsetWidth: 320, scrollTop: 0,
    parentElement: null,
    children: [],
    classList: {
      add(...c) { c.forEach(x => classState[el.id || "__anon"].add(x)); },
      remove(...c) { c.forEach(x => classState[el.id || "__anon"].delete(x)); },
      toggle(c, f) {
        if (f === undefined) f = !classState[el.id || "__anon"].has(c);
        f ? classState[el.id || "__anon"].add(c) : classState[el.id || "__anon"].delete(c);
        return f;
      },
      contains(c) { return classState[el.id || "__anon"].has(c); },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    querySelectorAll() { return []; },
    querySelector(sel) {
      return sel === ".list__value" && this._valueChild ? this._valueChild : null;
    },
    closest(sel) {
      if (sel !== "[id]") return null;
      let n = this;
      while (n) { if (n.id) return n; n = n.parentElement; }
      return null;
    },
    focus() {},
    addEventListener(type, fn) { listeners[(this.id || "__el") + ":" + type] = fn; },
    removeEventListener() {},
    getTotalLength() { return 1000; },
    getPointAtLength(l) { return { x: (l / 1000) * 300, y: (l % 2) * 10 }; },
    scrollTo(o) { this.scrollTop = (o && o.top) || 0; },
  });
  Object.defineProperty(el, "textContent", {
    get() { return tc; },
    set(v) { tc = v === null || v === undefined ? "" : String(v); },
    enumerable: true, configurable: true,
  });
  classState[el.id || "__anon"] = classState[el.id || "__anon"] || new Set();
  return el;
}

function ensure(id) {
  if (!elements[id]) elements[id] = makeEl(id);
  return elements[id];
}

const IDS = ["screen-setup","screen-session","screen-done","dot","box","box-progress","phase-label",
  "count-label","cycle-label","pause-icon","btn-pause","btn-stop","btn-start","btn-again","btn-settings","box-stage",
  "row-phase","row-cycles","row-sound","row-haptics","toggle-sound","toggle-haptics","phase-value",
  "cycles-value","total-hint","done-text","sheet","sheet-backdrop","picker","picker-scroll","sheet-title",
  "sheet-cancel","sheet-done","app-title","box-svg"];
IDS.forEach(ensure);

/* --- мини-дерево: нужно, чтобы тесты ловили баги обхода DOM
       (например, тап по вложенному <svg id="pause-icon"> вместо кнопки) --- */
function nest(child, parent) { child.parentElement = parent; return child; }

const documentElement = nest(makeEl("", "html"), null);
documentElement.id = "html";
const bodyEl = nest(makeEl("body", "body"), documentElement);
const appEl = nest(makeEl("app", "main"), bodyEl);

["screen-setup", "screen-session", "screen-done"].forEach(id => nest(ensure(id), appEl));
nest(ensure("sheet"), bodyEl);
nest(ensure("sheet-backdrop"), bodyEl);
["btn-start", "row-phase", "row-cycles", "row-sound", "row-haptics"].forEach(id => nest(ensure(id), ensure("screen-setup")));
["btn-stop", "btn-pause", "cycle-label", "phase-label", "count-label", "box", "box-progress", "dot", "box-stage"]
  .forEach(id => nest(ensure(id), ensure("screen-session")));
["sheet-cancel", "sheet-done", "sheet-title", "picker-scroll"].forEach(id => nest(ensure(id), ensure("sheet")));
nest(ensure("pause-icon"), ensure("btn-pause"));
const pauseRect = nest(makeEl("", "rect"), ensure("pause-icon"));

/* .list__value — отдельный span внутри строки, со своим набором классов */
["row-phase", "row-cycles"].forEach(id => {
  const v = makeEl("", "span");
  const key = id + "__value";
  classState[key] = new Set();
  v._classKey = key;
  v.classList = {
    add(...c) { c.forEach(x => classState[key].add(x)); },
    remove(...c) { c.forEach(x => classState[key].delete(x)); },
    toggle(c, f) { if (f === undefined) f = !classState[key].has(c); f ? classState[key].add(c) : classState[key].delete(c); return f; },
    contains(c) { return classState[key].has(c); },
  };
  elements[id]._valueChild = v;
});

const trackEl = makeEl("", "rect");

const documentShim = {
  getElementById: (id) => elements[id] || null,
  querySelector: (sel) => (sel === ".box__track" ? trackEl : null),
  querySelectorAll: () => [],
  activeElement: elements["btn-start"],
  visibilityState: "visible",
  documentElement,
  body: bodyEl,
  createElement: (t) => makeEl("", t),
  createDocumentFragment: () => makeEl("", "#fragment"),
  addEventListener(type, fn) { listeners["document:" + type] = fn; },
  removeEventListener() {},
};
sandbox.document = documentShim;
sandbox.Element = ElementCtor;

function run(src, filename) { vm.runInContext(src, ctx, { filename }); }
const APP_PATH = require("path").resolve(__dirname, "..", "app.js");
run(fs.readFileSync(APP_PATH, "utf8").replace(/^\uFEFF/, ""), "app.js");

/* Прокрутка виртуального времени: задачи выполняются в порядке своих меток. */
function step(to) {
  let guard = 0;
  while (guard++ < 3000000) {
    let best = null;
    for (let i = 0; i < pending.length; i++) {
      const t = pending[i];
      if (t.cancelled || t.at > to) continue;
      if (!best || t.at < best.at) best = t;
    }
    if (!best) break;
    now = best.at;
    if (best.kind === "interval") best.at = now + best.every;
    else best.cancelled = true;
    best.fn(now);
    if (pending.length > 4000) {
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].cancelled) pending.splice(i, 1);
    }
  }
  now = to;
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i].cancelled) pending.splice(i, 1);
}

module.exports = {
  sandbox, ctx, elements, classState, listeners, log, pending,
  pauseRect, bodyEl, documentElement, trackEl,
  advance: (ms) => step(now + ms),
  get now() { return now; },
  setNow: (v) => { now = v; },
  activeCount: () => pending.filter(x => !x.cancelled).length,
  activeIntervals: () => pending.filter(x => !x.cancelled && x.kind === "interval").length,
  run,
};
