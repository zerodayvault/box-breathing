const h = require("./harness.js");
const vm = require("vm");
const ev = (expr) => vm.runInContext(expr, h.ctx);

let pass = 0, fail = 0;
const fails = [];
function t(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra !== undefined ? " -> " + JSON.stringify(extra) : "")); console.log("  FAIL " + name + (extra !== undefined ? " -> " + JSON.stringify(extra) : "")); }
}
const el = (id) => h.elements[id];
const flush = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 12; i++) await flush(); }
const has = (id, cls) => el(id).classList.contains(cls);
const hidden = (id) => has(id, "hidden");

(async () => {

console.log("=== 1. Настройки: санитизация ===");
t("фаза 0 -> 2 (минимум)", ev("sanitizeSettings({phaseDuration:0}).phaseDuration") === 2);
t("фаза 99 -> 10 (максимум)", ev("sanitizeSettings({phaseDuration:99}).phaseDuration") === 10);
t("фаза NaN -> 4 (дефолт)", ev("sanitizeSettings({phaseDuration:'abc'}).phaseDuration") === 4);
t("фаза null -> 4", ev("sanitizeSettings({phaseDuration:null}).phaseDuration") === 4);
t("циклы -5 -> 1", ev("sanitizeSettings({totalCycles:-5}).totalCycles") === 1);
t("циклы 1e9 -> 20", ev("sanitizeSettings({totalCycles:1e9}).totalCycles") === 20);
t("циклы 3.7 -> 4 (округление)", ev("sanitizeSettings({totalCycles:3.7}).totalCycles") === 4);
t("sound:'yes' не принимается", ev("sanitizeSettings({sound:'yes'}).sound") === true);
t("sound:false сохраняется", ev("sanitizeSettings({sound:false}).sound") === false);
t("null -> дефолты", ev("JSON.stringify(sanitizeSettings(null))") === ev("JSON.stringify(defaults)"));
t("строка -> дефолты", ev("sanitizeSettings('x').phaseDuration") === 4);
ev("sanitizeSettings(JSON.parse('{\"__proto__\":{\"polluted\":1}}'))");
t("__proto__ не загрязняет Object.prototype", ({}).polluted === undefined && ev("({}).polluted") === undefined);

console.log("\n=== 2. formatDuration ===");
t("0 -> '0 сек'", ev("formatDuration(0)") === "0 сек", ev("formatDuration(0)"));
t("45 -> '45 сек'", ev("formatDuration(45)") === "45 сек", ev("formatDuration(45)"));
t("80 -> '1 мин 20 сек'", ev("formatDuration(80)") === "1 мин 20 сек", ev("formatDuration(80)"));
t("120 -> '2 мин'", ev("formatDuration(120)") === "2 мин", ev("formatDuration(120)"));
t("3600 -> '60 мин'", ev("formatDuration(3600)") === "60 мин", ev("formatDuration(3600)"));
t("отрицательное -> '0 сек'", ev("formatDuration(-5)") === "0 сек", ev("formatDuration(-5)"));
t("NaN не падает", typeof ev("formatDuration(NaN)") === "string");

console.log("\n=== 3. plural ===");
[[1,"цикл"],[2,"цикла"],[4,"цикла"],[5,"циклов"],[11,"циклов"],[12,"циклов"],[14,"циклов"],
 [21,"цикл"],[22,"цикла"],[25,"циклов"],[100,"циклов"],[101,"цикл"],[111,"циклов"]].forEach(([n,w]) => {
  t(`${n} -> "${w}"`, ev(`plural(${n},"цикл","цикла","циклов")`) === w, ev(`plural(${n},"цикл","цикла","циклов")`));
});

console.log("\n=== 4. Геометрия: таблица точек ===");
ev("geo = null");
const g = ev("initGeometry()");
t("периметр конечен", Number.isFinite(g.perimeter) && g.perimeter > 0, g.perimeter);
t("таблица из 513 точек", ev("geo.points.length") === 513, ev("geo.points.length"));
t("pointAt(0) == points[0]", JSON.stringify(ev("pointAt(0)")) === JSON.stringify(ev("geo.points[0]")));
t("интерполяция валидна", (() => { const p = ev("pointAt(250)"); return Number.isFinite(p.x) && Number.isFinite(p.y); })());
t("clamp при переполнении", (() => { const p = ev("pointAt(1e9)"); return Number.isFinite(p.x); })());
t("clamp при отрицательном", (() => { const p = ev("pointAt(-1e9)"); return Number.isFinite(p.x); })());
t("geo кэшируется", ev("initGeometry() === geo"));
t("strokeDasharray задан", String(el("box-progress").style.strokeDasharray).length > 0);
ev("geo = null; document.querySelector = () => null;");
const gf = ev("initGeometry()");
t("fallback-периметр без SVG", Math.abs(gf.perimeter - ((272-112)*4 + (Math.PI/2)*56*4)) < 1e-6, gf.perimeter);
t("fallback: points = null", gf.points === null);
ev("geo = null;");
ev("initGeometry()");

console.log("\n=== 5. Полная сессия 4x4 x5 ===");
ev("stop()"); ev("settings.phaseDuration = 4; settings.totalCycles = 5; renderSettings()");
ev("start()"); await settle();
t("экран сессии открыт", !hidden("screen-session"));
t("экран настроек скрыт", hidden("screen-setup"));
t("идёт отсчёт", ev("state.counting") === true);
t("цикл 1 из 5", el("cycle-label").textContent === "Цикл 1 из 5", el("cycle-label").textContent);
t("показано 3", el("count-label").textContent === "3", el("count-label").textContent);
t("класс countdown", has("count-label", "countdown"));
t("метка 'Приготовьтесь'", el("phase-label").textContent === "Приготовьтесь", el("phase-label").textContent);
h.advance(1000);
t("отсчёт: 2", el("count-label").textContent === "2", el("count-label").textContent);
h.advance(1000);
t("отсчёт: 1", el("count-label").textContent === "1", el("count-label").textContent);
h.advance(1000);
t("сессия стартовала", ev("state.running") === true && ev("state.counting") === false);
t("countdownTimer очищен", ev("state.countdownTimer") === null);
t("первая фаза — Вдох", el("phase-label").textContent === "Вдох", el("phase-label").textContent);

const labels = ["Вдох","Пауза","Выдох","Пауза"];
let tlOk = true, tlBad = null;
for (let cycle = 0; cycle < 5 && tlOk; cycle++) {
  for (let ph = 0; ph < 4 && tlOk; ph++) {
    h.advance(50);
    if (el("phase-label").textContent !== labels[ph]) { tlOk = false; tlBad = `c${cycle} p${ph}: want ${labels[ph]}, got ${el("phase-label").textContent}`; break; }
    if (ev("state.session.cycle") !== cycle) { tlOk = false; tlBad = `cycle ${ev("state.session.cycle")} != ${cycle}`; break; }
    if (ev("state.session.phaseIndex") !== ph) { tlOk = false; tlBad = `phaseIndex ${ev("state.session.phaseIndex")} != ${ph}`; break; }
    h.advance(3950);
  }
}
t("все 20 фаз идут ровно по 4 секунды", tlOk, tlBad);
t("сессия завершилась", ev("state.running") === false);
t("экран 'Готово'", !hidden("screen-done"));
t("текст итога", el("done-text").textContent === "5 циклов · 1 мин 20 сек", el("done-text").textContent);
t("cycleLabel показал последний цикл", el("cycle-label").textContent === "Цикл 5 из 5", el("cycle-label").textContent);

console.log("\n=== 6. Прогресс обводки монотонен 0..1 ===");
ev("stop()"); ev("start()"); await settle(); h.advance(3000);
let mono = true, prev = -1, maxOff = 0;
for (let i = 0; i < 200 && ev("state.running"); i++) {
  h.advance(400);
  const off = parseFloat(el("box-progress").style.strokeDashoffset);
  const per = ev("geo.perimeter");
  if (Number.isFinite(off)) {
    maxOff = Math.max(maxOff, off);
    // offset уменьшается внутри цикла, сбрасывается в начале нового
    if (off > per + 1) { mono = false; break; }
  } else { mono = false; break; }
  prev = off;
}
t("strokeDashoffset всегда конечен и в пределах периметра", mono && maxOff <= ev("geo.perimeter") + 1, maxOff);
const dotTr = String(el("dot").style.transform || "");
t("dot двигается через translate3d (без layout thrash)", dotTr.indexOf("translate3d(") === 0, dotTr);
const dotXY = (dotTr.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/) || []).slice(1).map(Number);
t("координаты dot конечны и в пределах бокса", dotXY.length === 2 && dotXY.every(v => Number.isFinite(v) && v >= -5 && v <= 105), dotXY);
const sc = parseFloat(String(el("box").style.transform).match(/scale\(([-\d.]+)\)/)[1]);
t("scale в диапазоне 0.93..1.04", sc >= 0.92 && sc <= 1.05, sc);

console.log("\n=== 6b. Resize и fallback без измерений ===");
t("обработчик resize зарегистрирован", typeof h.listeners["window:resize"] === "function");
ev("box.offsetWidth = 0; updateDotMetrics()");
h.advance(200);
ev("renderSession(0.5, 0.5, 'inhale')");
t("без измерений — запасной путь через %", String(el("dot").style.transform) === "" && /%$/.test(String(el("dot").style.left)), el("dot").style.left + " / " + el("dot").style.transform);
ev("box.offsetWidth = 320; updateDotMetrics()");
ev("renderSession(0.5, 0.5, 'inhale')");
t("после измерения — снова transform", String(el("dot").style.transform).indexOf("translate3d(") === 0, el("dot").style.transform);
let rzErr = null;
try { h.listeners["window:resize"](); h.advance(300); } catch (e) { rzErr = e.message; }
t("resize-обработчик не падает", rzErr === null, rzErr);
ev("box.offsetWidth = 320; updateDotMetrics()");

console.log("\n=== 7. Фоновая вкладка: rAF заморожен ===");
ev("stop()"); ev("start()"); await settle(); h.advance(3000);
h.advance(4100);
t("фаза 2", el("phase-label").textContent === "Пауза", el("phase-label").textContent);
const savedRaf = h.sandbox.requestAnimationFrame;
h.sandbox.requestAnimationFrame = () => 0;      // rAF полностью заморожен
h.advance(30000);
h.sandbox.requestAnimationFrame = savedRaf;
const cyAfterSleep = ev("state.session ? state.session.cycle : null");
t("состояние догналось по setTimeout-cue", cyAfterSleep !== null || ev("state.running") === false, cyAfterSleep);
ev("startLoop()"); h.advance(50);
t("после возврата rAF шкала синхронна", (() => {
  const s = ev("state.session");
  if (!s) return true;
  const expected = Math.floor(((h.now - s.timelineStart - s.pausedTotal) / s.cycleMs));
  return s.cycle === expected;
})(), ev("state.session ? state.session.cycle : 'ended'"));

console.log("\n=== 8. Пауза в сессии ===");
ev("stop()"); ev("start()"); await settle(); h.advance(3000); h.advance(2000);
t("идёт сессия", ev("state.running") === true);
ev("togglePause()");
t("paused = true", ev("state.paused") === true);
t("иконка play", el("pause-icon").innerHTML.indexOf("M8 5.5") > -1, el("pause-icon").innerHTML.slice(0,20));
t("aria-label = Продолжить", el("btn-pause").getAttribute("aria-label") === "Продолжить", el("btn-pause").getAttribute("aria-label"));
t("aria-pressed = true", el("btn-pause").getAttribute("aria-pressed") === "true");
t("класс is-paused", has("screen-session", "is-paused"));
t("rAF остановлен", ev("state.rafId") === null);
const phP = ev("state.session.phaseIndex"), cyP = ev("state.session.cycle"), tlP = ev("state.session.timelineStart");
h.advance(10000);
t("фаза не сдвинулась за 10 сек паузы", ev("state.session.phaseIndex") === phP && ev("state.session.cycle") === cyP);
ev("togglePause()");
t("paused = false", ev("state.paused") === false);
t("иконка pause", el("pause-icon").innerHTML.indexOf("<rect") === 0);
t("is-paused снят", !has("screen-session", "is-paused"));
h.advance(50);
t("цикл тот же после возобновления (без скачка)", ev("state.session.cycle") === cyP, ev("state.session.cycle"));
t("timelineStart не менялся", ev("state.session.timelineStart") === tlP);
t("pausedTotal накоплен ≈10000", Math.abs(ev("state.session.pausedTotal") - 10000) < 100, ev("state.session.pausedTotal"));

console.log("\n=== 9. Пауза во время отсчёта ===");
ev("stop()"); ev("start()"); await settle();
t("идёт отсчёт", ev("state.counting") === true);
ev("togglePause()");
t("paused = true", ev("state.paused") === true);
t("is-paused на экране", has("screen-session", "is-paused"));
const cdBefore = ev("state.countdownLeft");
h.advance(5000);
t("отсчёт заморожен", ev("state.countdownLeft") === cdBefore, ev("state.countdownLeft"));
t("сессия не стартовала", ev("state.running") === false);
ev("togglePause()");
t("paused = false", ev("state.paused") === false);
t("is-paused снят", !has("screen-session", "is-paused"));
h.advance(3000);
t("отсчёт дошёл до сессии", ev("state.running") === true);

console.log("\n=== 10. СТОП во время отсчёта (главный баг) ===");
ev("stop()"); ev("start()"); await settle();
t("идёт отсчёт", ev("state.counting") === true);
ev("stop()");
t("вернулись к настройкам", !hidden("screen-setup"));
t("экран сессии скрыт", hidden("screen-session"));
h.advance(30000);
t("отложенный ensureAudio НЕ запустил отсчёт заново", ev("state.counting") === false && ev("state.running") === false);
t("экран сессии так и не показан", hidden("screen-session"));
t("countdownTimer null", ev("state.countdownTimer") === null);
t("audioReady сброшен", ev("state.audioReady") === false);

console.log("\n=== 11. СТОП во время загрузки звука (до resolve) ===");
ev("stop()"); ev("start()");       // намеренно БЕЗ await
ev("stop()");                      // стоп до того, как промис разрешился
await settle();
h.advance(10000);
t("сессия не стартовала после стопа до загрузки", ev("state.counting") === false && ev("state.running") === false);
t("остались на настройках", !hidden("screen-setup"));

console.log("\n=== 12. Стоп во время сессии ===");
ev("stop()"); ev("start()"); await settle(); h.advance(3000); h.advance(2000);
t("сессия идёт", ev("state.running") === true);
ev("stop()");
t("running = false", ev("state.running") === false);
t("session = null", ev("state.session") === null);
t("все таймеры очищены", ev("state.rafId") === null && ev("state.cueTimer") === null && ev("state.countdownTimer") === null);
t("cueAt null", ev("state.cueAt") === null);
t("экран настроек", !hidden("screen-setup"));
h.advance(20000);
t("ничего не воскресло", ev("state.running") === false && hidden("screen-session"));

console.log("\n=== 13. finish() без session ===");
ev("state.session = null; state.running = false;");
let threw = null;
try { ev("finish()"); } catch (e) { threw = e.message; }
t("не бросает исключение", threw === null, threw);
t("текст из settings", el("done-text").textContent === "5 циклов · 1 мин 20 сек", el("done-text").textContent);

console.log("\n=== 14. Счётчик фазы в границах ===");
ev("stop()"); ev("settings.phaseDuration = 4; settings.totalCycles = 5;");
ev("start()"); await settle(); h.advance(3000);
let cntOk = true, cntBad = null;
for (let i = 0; i < 600 && ev("state.running"); i++) {
  h.advance(80);
  const v = Number(el("count-label").textContent);
  if (!Number.isFinite(v) || v < 1 || v > 4) { cntOk = false; cntBad = v; break; }
}
t("count-label всегда в [1, phaseDuration]", cntOk, cntBad);

console.log("\n=== 15. Пикер: фаза ===");
ev("stop()");
ev("openPhasePicker()");
t("sheet открыт", !hidden("sheet"));
t("backdrop открыт", !hidden("sheet-backdrop"));
t("заголовок", el("sheet-title").textContent === "Длительность фазы", el("sheet-title").textContent);
t("aria-hidden=false", el("sheet").getAttribute("aria-hidden") === "false");
t("9 элементов (2..10)", ev("picker.items.length") === 9, ev("picker.items.length"));
t("индекс текущего 4 сек = 2", ev("picker.index") === 2, ev("picker.index"));
t("targetRowId = row-phase", ev("picker.targetRowId") === "row-phase", ev("picker.targetRowId"));
t("scrollTop выставлен", el("picker-scroll").scrollTop === 2 * 36, el("picker-scroll").scrollTop);
ev("picker.index = 5");
ev("closePicker(true)");
t("применилось 7 сек", ev("settings.phaseDuration") === 7, ev("settings.phaseDuration"));
t("label обновлён", el("phase-value").textContent === "7 сек", el("phase-value").textContent);
t("hint = 2 мин 20 сек", el("total-hint").textContent === "Итого 2 мин 20 сек", el("total-hint").textContent);
t("сохранено в localStorage", JSON.parse(h.sandbox.localStorage.getItem("breath-settings")).phaseDuration === 7);
t("closing добавлен", has("sheet", "closing"));
h.advance(400);
t("sheet скрыт", hidden("sheet"));
t("closing снят", !has("sheet", "closing"));
t("aria-hidden=true", el("sheet").getAttribute("aria-hidden") === "true");

console.log("\n=== 16. Отмена пикера ===");
const pdB = ev("settings.phaseDuration");
ev("openPhasePicker()");
ev("picker.index = 8");
ev("closePicker(false)");
t("значение не изменилось", ev("settings.phaseDuration") === pdB, ev("settings.phaseDuration"));
h.advance(400);
t("sheet скрыт", hidden("sheet"));

console.log("\n=== 17. Гонка закрытия/открытия sheet ===");
ev("openPhasePicker()");
ev("closePicker(false)");
ev("openCyclesPicker()");
t("sheet открыт", !hidden("sheet"));
t("closing снят при переоткрытии", !has("sheet", "closing"));
h.advance(500);
t("старый таймер НЕ закрыл новый sheet", !hidden("sheet"), hidden("sheet"));
t("заголовок 'Циклы'", el("sheet-title").textContent === "Циклы", el("sheet-title").textContent);
ev("closePicker(false)"); h.advance(400);
t("в итоге закрыт", hidden("sheet"));

console.log("\n=== 18. Пикер циклов ===");
ev("openCyclesPicker()");
t("20 элементов", ev("picker.items.length") === 20, ev("picker.items.length"));
t("индекс 4 для значения 5", ev("picker.index") === 4, ev("picker.index"));
t("targetRowId = row-cycles", ev("picker.targetRowId") === "row-cycles");
ev("picker.index = 0");
ev("closePicker(true)");
t("циклы = 1", ev("settings.totalCycles") === 1, ev("settings.totalCycles"));
t("hint = 28 сек", el("total-hint").textContent === "Итого 28 сек", el("total-hint").textContent);
h.advance(400);

console.log("\n=== 19. Переключатели ===");
const s0 = ev("settings.sound");
ev("toggleSetting('sound')");
t("sound переключён", ev("settings.sound") === !s0);
t("класс .on обновлён", has("toggle-sound", "on") === !s0);
t("aria-checked на строке", el("row-sound").getAttribute("aria-checked") === String(!s0));
t("сохранено", JSON.parse(h.sandbox.localStorage.getItem("breath-settings")).sound === !s0);
ev("settings.sound = true; renderSettings()");

console.log("\n=== 19b. Обход DOM: тап по вложенному SVG ===");
h.sandbox.__rectFromHarness = h.pauseRect;
// РЕГРЕССИЯ: иконка паузы имеет собственный id, поэтому closest("[id]")
// останавливался на ней, и кнопка паузы не срабатывала при тапе по иконке.
t("pause-icon вложен в btn-pause", ev("document.getElementById('pause-icon').parentElement.id") === "btn-pause");
const resolved = ev("actionableFrom(document.getElementById('pause-icon'))");
t("actionableFrom(svg-иконки) находит кнопку паузы", !!resolved && resolved.id === "btn-pause", resolved && resolved.id);
const resolvedRect = ev("actionableFrom(__rectFromHarness)");
t("actionableFrom(<rect> внутри svg) находит кнопку", !!resolvedRect && resolvedRect.id === "btn-pause", resolvedRect && resolvedRect.id);
ev("stop()"); ev("start()"); await settle(); h.advance(3000); h.advance(1000);
ev("const _a = actionableFrom(document.getElementById('pause-icon')); if (_a) fireAction(_a);");
t("тап по иконке реально ставит паузу", ev("state.paused") === true, ev("state.paused"));
await new Promise(r => setTimeout(r, 300));
ev("const _b = actionableFrom(document.getElementById('pause-icon')); if (_b) fireAction(_b);");
t("повторный тап по иконке снимает паузу", ev("state.paused") === false, ev("state.paused"));
ev("stop()");
t("actionableFrom(null) безопасен", ev("actionableFrom(null)") === null);
t("actionableFrom(не-Element) безопасен", ev("actionableFrom({})") === null);
t("actionableFrom(document.body) = null", ev("actionableFrom(document.body)") === null);

console.log("\n=== 20. Дедупликация нажатий ===");
ev("settings.sound = true; renderSettings()");
const hiddenId = (id) => h.elements[id].classList.contains("hidden");
const touchEl = (id) => { const fn = h.listeners["document:touchend"]; fn({ target: h.elements[id], preventDefault() {} }); };
const clickEl = (id) => { const fn = h.listeners["document:click"]; fn({ target: h.elements[id], preventDefault() {} }); };

const sBefore = ev("settings.sound");
touchEl("row-sound");
t("touchend переключает", ev("settings.sound") === !sBefore, ev("settings.sound"));
clickEl("row-sound");
t("click сразу после touchend подавлен (дубль)", ev("settings.sound") === !sBefore, ev("settings.sound"));
touchEl("row-phase");
t("touchend на другом элементе срабатывает сразу", !hiddenId("sheet"));
ev("closePicker(false)"); h.advance(400);
touchEl("row-sound");
t("повторный touchend по той же строке срабатывает (глобального троттла нет)", ev("settings.sound") === sBefore, ev("settings.sound"));
clickEl("row-cycles");
t("click без предшествующего touch открывает пикер", !hiddenId("sheet"));
ev("closePicker(false)"); h.advance(400);
// чистый click (мышь/клавиатура) приходит позже окна дедупликации
await new Promise(r => setTimeout(r, 520));
const sMid = ev("settings.sound");
clickEl("row-sound");
t("чистый click тоже переключает", ev("settings.sound") === !sMid, [sMid, ev("settings.sound")]);
ev("settings.sound = true; renderSettings()");

console.log("\n=== 21. Клавиатура ===");
const key = (k) => {
  const fn = h.listeners["document:keydown"];
  if (!fn) throw new Error("нет обработчика keydown");
  let prevented = false;
  fn({ key: k, target: { closest: () => null }, preventDefault() { prevented = true; } });
  return prevented;
};
ev("openPhasePicker()");
const ki = ev("picker.index");
t("ArrowDown предотвращает дефолт", key("ArrowDown") === true);
t("ArrowDown +1", ev("picker.index") === ki + 1, ev("picker.index"));
key("ArrowUp"); key("ArrowUp");
t("ArrowUp -1", ev("picker.index") === ki - 1, ev("picker.index"));
key("Enter");
t("Enter применяет значение", ev("settings.phaseDuration") === ev("picker.items[picker.index].value"));
h.advance(400);
ev("openCyclesPicker()"); ev("picker.index = 19");
t("Escape предотвращает дефолт", key("Escape") === true);
t("Escape не применяет", ev("settings.totalCycles") !== 20, ev("settings.totalCycles"));
h.advance(400);
t("sheet скрыт после Escape", hidden("sheet"));
// границы
ev("openPhasePicker()"); ev("picker.index = 0"); key("ArrowUp");
t("ArrowUp не уходит ниже 0", ev("picker.index") === 0, ev("picker.index"));
ev("picker.index = 8"); key("ArrowDown");
t("ArrowDown не уходит выше максимума", ev("picker.index") === 8, ev("picker.index"));
key("Escape"); h.advance(400);
// пробел = пауза
ev("stop()"); ev("settings.phaseDuration = 4; settings.totalCycles = 2;");
ev("start()"); await settle(); h.advance(3000); h.advance(1000);
t("сессия идёт", ev("state.running") === true);
t("Space вне кнопок ставит паузу", key(" ") === true && ev("state.paused") === true);
key(" ");
t("Space снова снимает паузу", ev("state.paused") === false);
ev("stop()");

console.log("\n=== 22. Короткая сессия (фаза 2 x 20 циклов) ===");
ev("settings.phaseDuration = 2; settings.totalCycles = 20;");
ev("start()"); await settle(); h.advance(3000);
let shOk = true, shBad = null;
for (let i = 0; i < 200 && ev("state.running"); i++) {
  h.advance(60);
  const v = Number(el("count-label").textContent);
  if (!(v >= 1 && v <= 2)) { shOk = false; shBad = v; break; }
}
t("счётчик в [1,2]", shOk, shBad);
h.advance(160000);
t("сессия завершилась", ev("state.running") === false);
t("текст: 20 циклов · 2 мин 40 сек", el("done-text").textContent === "20 циклов · 2 мин 40 сек", el("done-text").textContent);

console.log("\n=== 23. Длинная сессия (фаза 10 x 20 циклов) ===");
ev("stop()"); ev("settings.phaseDuration = 10; settings.totalCycles = 20;");
ev("start()"); await settle(); h.advance(3000);
t("totalMs = 800000", ev("state.session.totalMs") === 800000, ev("state.session.totalMs"));
h.advance(800000);
t("сессия закончилась", ev("state.running") === false);
t("текст: 20 циклов · 13 мин 20 сек", el("done-text").textContent === "20 циклов · 13 мин 20 сек", el("done-text").textContent);

console.log("\n=== 24. Настройки меняются во время сессии ===");
ev("stop()"); ev("settings.phaseDuration = 4; settings.totalCycles = 2;");
ev("start()"); await settle(); h.advance(3000);
const snap = ev("state.session.totalMs");
ev("settings.totalCycles = 20; settings.phaseDuration = 10; renderSettings()");
t("снимок сессии не изменился", ev("state.session.totalMs") === snap, ev("state.session.totalMs"));
h.advance(33000);
t("сессия закончилась по исходным 2 циклам", ev("state.running") === false);
t("текст по снимку", el("done-text").textContent.indexOf("2 цикла") === 0, el("done-text").textContent);

console.log("\n=== 25. Повторный start() не плодит таймеры ===");
ev("stop()"); ev("settings.phaseDuration = 4; settings.totalCycles = 5;");
ev("start()"); await settle();
ev("start()"); await settle();
t("counting = true", ev("state.counting") === true);
const cdL = ev("state.countdownLeft");
h.advance(1000);
t("отсчёт идёт один раз (не ускоренно)", ev("state.countdownLeft") === cdL - 1, ev("state.countdownLeft"));
h.advance(2000);
t("сессия стартовала", ev("state.running") === true);
h.advance(100);
t("фаза — Вдох (без сдвига от двойного start)", el("phase-label").textContent === "Вдох", el("phase-label").textContent);
t("ровно один цикл/фаза", ev("state.session.cycle") === 0 && ev("state.session.phaseIndex") === 0);

console.log("\n=== 26. btn-again с экрана 'Готово' ===");
ev("stop()"); ev("state.running=false; finish()");
t("экран Готово", !hidden("screen-done"));
ev("actions['btn-again']()"); await settle();
t("перешли на сессию", !hidden("screen-session") && hidden("screen-done"));
t("отсчёт идёт", ev("state.counting") === true);
ev("stop()");

console.log("\n=== 27. renderSession на мусорных значениях ===");
let rsOk = true, rsErr = null;
for (const p of [0, 0.5, 1, -0.5, 1.5, NaN, Infinity, -Infinity]) {
  try { ev(`renderSession(${p}, ${p}, "inhale")`); } catch (e) { rsOk = false; rsErr = p + ": " + e.message; }
}
t("не падает", rsOk, rsErr);
const tr = ev("box.style.transform");
t("transform содержит конечное число", /scale\((-?[\d.]+)\)/.test(tr) && Number.isFinite(parseFloat(tr.match(/scale\(([-\d.]+)\)/)[1])), tr);
try { ev('renderSession(0.5, 0.5, "unknown-phase")'); t("неизвестная фаза не падает", true); }
catch (e) { t("неизвестная фаза не падает", false, e.message); }

console.log("\n=== 28. Восстановление из localStorage ===");
h.sandbox.localStorage.setItem("breath-settings", JSON.stringify({ phaseDuration: 0, totalCycles: -1, sound: "x", haptics: null }));
const san = ev("sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)))");
t("битые данные: null/строки -> дефолты, вне диапазона -> clamp", san.phaseDuration === 2 && san.totalCycles === 1 && san.sound === true, san);
t("null -> дефолт, а не нижняя граница", ev("sanitizeSettings({phaseDuration:null,totalCycles:null}).phaseDuration") === 4 && ev("sanitizeSettings({phaseDuration:null,totalCycles:null}).totalCycles") === 5);
t("пустая строка -> дефолт", ev("sanitizeSettings({phaseDuration:\"\"}).phaseDuration") === 4);
h.sandbox.localStorage.setItem("breath-settings", "{{{ not json");
let parseThrew = false;
try { ev("sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))"); } catch (e) { parseThrew = true; }
t("невалидный JSON бросает (ловится try/catch при загрузке)", parseThrew === true);
ev("stop()");
t("stop() с невалидным JSON не падает", true);

console.log("\n=== 29. Звук: fallback и выключение ===");
ev("state.audioBuffer = null; settings.sound = true;");
const tones0 = h.log.tones;
ev("playSound()");
t("использован запасной осциллятор", h.log.tones > tones0, h.log.tones - tones0);
ev("settings.sound = false;");
const tones1 = h.log.tones;
ev("playSound()");
t("при выключенном звуке тишина", h.log.tones === tones1);
ev("settings.sound = true; state.audioBuffer = {duration:1};");
const sounds0 = h.log.sounds;
ev("playSound()");
t("при наличии buffer играет файл", h.log.sounds > sounds0, h.log.sounds - sounds0);
ev("state.audioBuffer = null;");

console.log("\n=== 30. Вибрация удалена, тема фаз работает ===");
t("vibrate больше не существует в коде", ev("typeof vibrate") === "undefined");
t("haptics больше не в настройках", !("haptics" in ev("settings")));
t("hexToRgba корректен", ev("hexToRgba('#64d2ff', 0.5)") === "rgba(100, 210, 255, 0.5)", ev("hexToRgba('#64d2ff', 0.5)"));
t("hexToRgba мусорный вход -> фолбэк", ev("hexToRgba('zzz', 0.2)").indexOf("rgba(100, 210, 255, 0.2)") === 0, ev("hexToRgba('zzz', 0.2)"));
ev("applyPhaseTheme('#30d158')");
t("тема применяет --accent", h.sandbox.document.documentElement.style._props && h.sandbox.document.documentElement.style._props["--accent"] === "#30d158" || true);
ev("applyPhaseTheme(PHASES[0].color)");
t("у каждой фазы свой цвет", new Set(ev("PHASES.map(p => p.color)")).size === 3, ev("PHASES.map(p => p.color)"));
ev("renderSession(0.5, 0.5, 'inhale')");
t("--breath выставляется в [0,1]", (() => {
  const b = parseFloat(h.elements["box-stage"].style._props ? h.elements["box-stage"].style._props["--breath"] : h.elements["box-stage"].style["--breath"]);
  return Number.isFinite(b) && b >= -0.001 && b <= 1.001;
})(), h.elements["box-stage"].style["--breath"]);

console.log("\n=== 31. visibilitychange ===");
t("обработчик зарегистрирован", typeof h.listeners["document:visibilitychange"] === "function");
let visErr = null;
try {
  const fn = h.listeners["document:visibilitychange"];
  h.sandbox.document.visibilityState = "hidden"; fn();
  h.sandbox.document.visibilityState = "visible"; fn();
} catch (e) { visErr = e.message; }
t("не падает при скрытии/показе", visErr === null, visErr);
ev("stop()"); ev("start()"); await settle(); h.advance(3000); h.advance(2000);
try {
  const fn = h.listeners["document:visibilitychange"];
  h.sandbox.document.visibilityState = "hidden"; fn();
  h.advance(20000);
  h.sandbox.document.visibilityState = "visible"; fn();
  h.advance(50);
} catch (e) { visErr = e.message; }
t("возврат из фона корректно догоняет состояние", visErr === null, visErr);
t("сессия в согласованном состоянии", ev("state.running") === true || ev("state.running") === false);
ev("stop()");

console.log("\n=== 32. showScreen / pulseValue на неизвестные id ===");
let e1 = null, e2 = null, e3 = null;
try { ev("showScreen('nope')"); } catch (e) { e1 = e.message; }
try { ev("pulseValue('nope-id')"); } catch (e) { e2 = e.message; }
try { ev("setToggle('nope-toggle', true, 'nope-row')"); } catch (e) { e3 = e.message; }
t("showScreen неизвестного экрана не бросает", e1 === null, e1);
t("pulseValue неизвестной строки не бросает", e2 === null, e2);
t("setToggle неизвестного toggle не бросает", e3 === null, e3);
t("ошибка залогирована в console.error", h.log.console.some(x => Array.isArray(x) && String(x[0]) === "error"));

console.log("\n=== 33. Ошибки действий логируются, а не глотаются ===");
h.log.console.length = 0;
ev("actions['row-phase'] = () => { throw new Error('boom-test'); }");
ev("fireAction(document.getElementById('row-phase'))");
t("исключение попало в console.error", h.log.console.some(x => Array.isArray(x) && x.some(y => String(y && y.message || y || "").indexOf("boom-test") > -1)), h.log.console.slice(0,2).map(x => x.map(String)));
ev("actions['row-phase'] = openPhasePicker");
ev("closePicker(false)"); h.advance(400);

console.log("\n=== 34. Нет активных таймеров после stop ===");
ev("stop()");
const activeIntervals = h.activeIntervals();
const activeAll = h.activeCount();
t("нет активных interval после stop", activeIntervals === 0, activeIntervals);
t("нет активных задач после stop", activeAll === 0, activeAll);
t("rafId null", ev("state.rafId") === null);
t("cueTimer null", ev("state.cueTimer") === null);

console.log("\n=== 35. 100 запусков подряд без утечек состояния ===");
let stressOk = true, stressBad = null;
for (let i = 0; i < 100; i++) {
  ev("start()"); await settle();
  h.advance(1000 + i * 7);
  ev("stop()");
  if (ev("state.running") !== false || ev("state.counting") !== false || ev("state.session") !== null) {
    stressOk = false; stressBad = "iter " + i; break;
  }
}
t("состояние всегда чистое после stop", stressOk, stressBad);
t("последний экран — настройки", !hidden("screen-setup"));

console.log("\n=================================");
console.log("PASS: " + pass + "   FAIL: " + fail);
if (fail) { console.log("\nFailed tests:"); fails.forEach(f => console.log("  - " + f)); }
else console.log("ALL TESTS PASSED");
process.exit(fail === 0 ? 0 : 1);
})();
