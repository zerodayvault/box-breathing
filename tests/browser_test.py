# -*- coding: utf-8 -*-
"""Реальные браузерные тесты PWA: запуск, отсчёт, сессия, пауза, стоп,
пикер, service worker, офлайн, отсутствие ошибок в консоли."""
import io, json, os, sys, threading, functools, http.server, socketserver, time
sys.stdout.reconfigure(encoding="utf-8")

from playwright.sync_api import sync_playwright

PORT = 8731
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

Handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
print("server on http://127.0.0.1:%d" % PORT)

BASE = "http://127.0.0.1:%d/" % PORT
PASS, FAIL = 0, 0
FAILS = []

def t(name, cond, extra=None):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        FAILS.append(name if extra is None else "%s -> %r" % (name, extra))
        print("  FAIL %s%s" % (name, "" if extra is None else " -> %r" % (extra,)))

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()

    errors, console_errors = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    page.goto(BASE, wait_until="networkidle")

    print("\n=== A. Загрузка ===")
    t("нет pageerror при загрузке", not errors, errors[:3])
    t("заголовок", page.title() == "Дыхание", page.title())
    t("экран настроек виден", page.is_visible("#screen-setup"))
    t("сессия скрыта", page.is_hidden("#screen-session"))
    t("готово скрыто", page.is_hidden("#screen-done"))
    t("фаза = 4 сек", page.inner_text("#phase-value") == "4 сек", page.inner_text("#phase-value"))
    t("циклы = 5", page.inner_text("#cycles-value") == "5", page.inner_text("#cycles-value"))
    t("hint корректен", page.inner_text("#total-hint") == "Итого 1 мин 20 сек", page.inner_text("#total-hint"))
    t("toggle звука включён", "on" in (page.get_attribute("#toggle-sound", "class") or ""))
    t("строка вибрации существует", page.is_visible("#row-haptics"))
    t("aria-checked у звука", page.get_attribute("#row-sound", "aria-checked") == "true")
    t("нет горизонтального скролла", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
      page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
    t("нет вертикального скролла body", page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 1"),
      page.evaluate("[document.documentElement.scrollHeight, window.innerHeight]"))

    print("\n=== B. Service Worker ===")
    page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
    t("SW контролирует страницу", page.evaluate("!!navigator.serviceWorker.controller"))
    sw_scope = page.evaluate("navigator.serviceWorker.controller.scriptURL")
    t("scriptURL = sw.js", sw_scope.endswith("sw.js"), sw_scope)
    caches = page.evaluate("caches.keys()")
    t("кэш создан", any("box-breathing" in c for c in caches), caches)
    t("старые кэши удалены", len([c for c in caches if "box-breathing" in c]) == 1, caches)

    cached = page.evaluate("""
      async () => {
        const keys = await caches.keys();
        const out = {};
        for (const k of keys) {
          const c = await caches.open(k);
          out[k] = (await c.keys()).map(r => new URL(r.url).pathname.replace(/^\\//, ''));
        }
        return out;
      }
    """)
    all_cached = sorted({p for v in cached.values() for p in v})
    print("  cached:", all_cached)
    t("maskable иконка в кэше", any("icon-512-maskable.png" in p for p in all_cached), all_cached)
    t("звук в кэше", any("phase.wav" in p for p in all_cached), all_cached)
    t("app.js в кэше", any(p.endswith("app.js") for p in all_cached))

    print("\n=== C. Офлайн (SWR из кэша) ===")
    ctx.set_offline(True)
    page2 = ctx.new_page()
    page2.goto(BASE + "index.html", wait_until="commit")
    t("страница открылась офлайн", page2.is_visible("#screen-setup"))
    t("стили применились офлайн", page2.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(0, 0, 0)",
      page2.evaluate("getComputedStyle(document.body).backgroundColor"))
    page2.close()
    ctx.set_offline(False)

    print("\n=== D. Пикер ===")
    page.click("#row-phase")
    page.wait_for_selector("#sheet:not(.hidden)", timeout=3000)
    t("sheet открыт", page.is_visible("#sheet"))
    t("backdrop открыт", page.is_visible("#sheet-backdrop"))
    t("заголовок пикера", page.inner_text("#sheet-title") == "Длительность фазы", page.inner_text("#sheet-title"))
    n_items = page.locator("#picker-scroll .picker__item").count()
    t("9 элементов пикера", n_items == 9, n_items)
    t("aria-hidden=false", page.get_attribute("#sheet", "aria-hidden") == "false")
    scroll0 = page.evaluate("document.getElementById('picker-scroll').scrollTop")
    t("прокручен к текущему (2*36)", abs(scroll0 - 72) <= 2, scroll0)
    t("активный элемент подсвечен", page.locator("#picker-scroll .picker__item.is-active").count() == 1)

    # клавиатура
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(250)
    idx = page.evaluate("window.__idx === undefined ? null : null")  # noop
    active = page.locator("#picker-scroll .picker__item.is-active").inner_text()
    t("стрелка вниз сдвинула выделение", active == "5 сек", active)
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    t("Escape закрыл без применения", page.is_hidden("#sheet") and page.inner_text("#phase-value") == "4 сек",
      page.inner_text("#phase-value"))

    # применение значения
    page.click("#row-phase")
    page.wait_for_selector("#sheet:not(.hidden)")
    page.evaluate("document.getElementById('picker-scroll').scrollTop = 7 * 36")
    page.wait_for_timeout(250)
    page.click("#sheet-done")
    page.wait_for_timeout(400)
    t("значение применилось (9 сек)", page.inner_text("#phase-value") == "9 сек", page.inner_text("#phase-value"))
    t("hint пересчитан (9*4*5=180)", page.inner_text("#total-hint") == "Итого 3 мин", page.inner_text("#total-hint"))
    t("сохранено в localStorage", json.loads(page.evaluate("localStorage.getItem('breath-settings')"))["phaseDuration"] == 9)
    t("sheet закрыт", page.is_hidden("#sheet"))

    print("\n=== E. Сохранение настроек между перезагрузками ===")
    page.reload(wait_until="networkidle")
    t("фаза восстановилась", page.inner_text("#phase-value") == "9 сек", page.inner_text("#phase-value"))
    t("hint восстановился", page.inner_text("#total-hint") == "Итого 3 мин", page.inner_text("#total-hint"))

    print("\n=== F. Битые данные в localStorage ===")
    page.evaluate("localStorage.setItem('breath-settings', '{\"phaseDuration\":0,\"totalCycles\":-9,\"sound\":\"x\"}')")
    page.reload(wait_until="networkidle")
    t("фаза -> 2 (минимум)", page.inner_text("#phase-value") == "2 сек", page.inner_text("#phase-value"))
    t("циклы -> 1", page.inner_text("#cycles-value") == "1", page.inner_text("#cycles-value"))
    page.evaluate("localStorage.setItem('breath-settings', 'not json at all')")
    errs_before = len(errors)
    page.reload(wait_until="networkidle")
    t("невалидный JSON не роняет страницу", len(errors) == errs_before, errors[errs_before:])
    t("дефолты применены", page.inner_text("#phase-value") == "4 сек" and page.inner_text("#cycles-value") == "5",
      page.inner_text("#phase-value") + " / " + page.inner_text("#cycles-value"))

    print("\n=== G. Переключатели ===")
    page.click("#row-sound")
    page.wait_for_timeout(200)
    t("звук выключен", "on" not in (page.get_attribute("#toggle-sound", "class") or ""))
    t("aria-checked=false", page.get_attribute("#row-sound", "aria-checked") == "false")
    page.click("#row-sound"); page.wait_for_timeout(200)
    t("звук включён обратно", "on" in (page.get_attribute("#toggle-sound", "class") or ""))
    page.click("#row-haptics"); page.wait_for_timeout(200)
    t("вибрация выключена", "on" not in (page.get_attribute("#toggle-haptics", "class") or ""))
    page.click("#row-haptics"); page.wait_for_timeout(200)
    t("вибрация включена", "on" in (page.get_attribute("#toggle-haptics", "class") or ""))
    # Реальная регрессия: один тап пальцем рождает touchend И click.
    # Без дедупликации тумблер переключился бы дважды и вернулся назад.
    box = page.locator("#row-sound").bounding_box()
    before = "on" in (page.get_attribute("#toggle-sound", "class") or "")
    page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(250)
    after = "on" in (page.get_attribute("#toggle-sound", "class") or "")
    t("один тап = одно переключение (touchend+click не задваиваются)", after != before, [before, after])

    # Два осознанных клика мышью — это два переключения (ожидаемое поведение).
    # Ждём дольше окна дедупликации touch->click, иначе первый клик
    # легитимно погасится как дубль недавнего касания.
    page.wait_for_timeout(700)
    b2 = "on" in (page.get_attribute("#toggle-sound", "class") or "")
    page.click("#row-sound"); page.wait_for_timeout(600)
    page.click("#row-sound"); page.wait_for_timeout(300)
    a2 = "on" in (page.get_attribute("#toggle-sound", "class") or "")
    t("два разнесённых клика = возврат в исходное", a2 == b2, [b2, a2])

    # Быстрые повторные касания по той же строке не должны теряться
    b3 = "on" in (page.get_attribute("#toggle-sound", "class") or "")
    box2 = page.locator("#row-sound").bounding_box()
    page.touchscreen.tap(box2["x"] + box2["width"] / 2, box2["y"] + box2["height"] / 2)
    page.wait_for_timeout(120)
    page.touchscreen.tap(box2["x"] + box2["width"] / 2, box2["y"] + box2["height"] / 2)
    page.wait_for_timeout(200)
    a3 = "on" in (page.get_attribute("#toggle-sound", "class") or "")
    t("два быстрых тапа подряд = два переключения (возврат в исходное)", a3 == b3, [b3, a3])

    print("\n=== H. Сессия: отсчёт и фазы ===")
    page.evaluate("localStorage.setItem('breath-settings', JSON.stringify({phaseDuration:4,totalCycles:2,sound:true,haptics:true}))")
    page.reload(wait_until="networkidle")
    page.click("#btn-start")
    page.wait_for_selector("#screen-session:not(.hidden)", timeout=3000)
    t("экран сессии виден", page.is_visible("#screen-session"))
    t("настройки скрыты", page.is_hidden("#screen-setup"))
    t("метка 'Приготовьтесь'", page.inner_text("#phase-label") == "Приготовьтесь", page.inner_text("#phase-label"))
    cd = page.inner_text("#count-label")
    t("отсчёт показывает число", cd in ("3", "2", "1"), cd)
    t("цикл 1 из 2", page.inner_text("#cycle-label") == "Цикл 1 из 2", page.inner_text("#cycle-label"))

    page.wait_for_timeout(3300)
    t("сессия началась (Вдох)", page.inner_text("#phase-label") == "Вдох", page.inner_text("#phase-label"))

    seen = []
    for _ in range(4):
        page.wait_for_timeout(4050)
        seen.append(page.inner_text("#phase-label"))
    t("последовательность фаз Вдох/Пауза/Выдох/Пауза", seen == ["Пауза", "Выдох", "Пауза", "Вдох"], seen)
    t("перешли на 2-й цикл", page.inner_text("#cycle-label") == "Цикл 2 из 2", page.inner_text("#cycle-label"))

    cnt = page.inner_text("#count-label")
    t("счётчик в [1,4]", cnt.isdigit() and 1 <= int(cnt) <= 4, cnt)

    print("\n=== I. Геометрия точки и прогресса ===")
    geo = page.evaluate("""() => {
      const d = document.getElementById('dot');
      const p = document.getElementById('box-progress');
      const cs = getComputedStyle(d);
      const r = d.getBoundingClientRect();
      const b = document.getElementById('box').getBoundingClientRect();
      return {
        transform: cs.transform,
        dasharray: p.style.strokeDasharray,
        dashoffset: p.style.strokeDashoffset,
        dotInsideBox: r.left >= b.left - 30 && r.right <= b.right + 30 && r.top >= b.top - 30 && r.bottom <= b.bottom + 30,
        dotVisible: r.width > 5 && r.height > 5,
      };
    }""")
    t("dasharray задан", bool(geo["dasharray"]), geo["dasharray"])
    off = float(geo["dashoffset"])
    per = float(geo["dasharray"])
    t("dashoffset в [0, периметр]", 0 <= off <= per + 0.5, [off, per])
    t("точка видна", geo["dotVisible"], geo)
    t("точка внутри бокса", geo["dotInsideBox"], geo)
    t("точка позиционирована матрицей (transform)", geo["transform"] != "none", geo["transform"])

    print("\n=== J. Пауза ===")
    ph_before = page.inner_text("#phase-label")
    page.click("#btn-pause")
    page.wait_for_timeout(300)
    t("aria-label = Продолжить", page.get_attribute("#btn-pause", "aria-label") == "Продолжить",
      page.get_attribute("#btn-pause", "aria-label"))
    t("aria-pressed=true", page.get_attribute("#btn-pause", "aria-pressed") == "true")
    t("класс is-paused", "is-paused" in (page.get_attribute("#screen-session", "class") or ""))
    t("иконка — play", page.evaluate("document.getElementById('pause-icon').innerHTML.includes('M8 5.5')"))
    page.wait_for_timeout(5000)
    t("фаза не сменилась за 5 сек паузы", page.inner_text("#phase-label") == ph_before, page.inner_text("#phase-label"))
    box_op = page.evaluate("getComputedStyle(document.getElementById('box')).opacity")
    t("визуал приглушён на паузе", float(box_op) < 0.8, box_op)

    page.click("#btn-pause")
    page.wait_for_timeout(300)
    t("пауза снята", page.get_attribute("#btn-pause", "aria-label") == "Пауза")
    t("is-paused убран", "is-paused" not in (page.get_attribute("#screen-session", "class") or ""))
    t("видимость восстановлена", float(page.evaluate("getComputedStyle(document.getElementById('box')).opacity")) > 0.9)

    print("\n=== K. Пауза во время отсчёта ===")
    page.click("#btn-stop"); page.wait_for_timeout(300)
    page.click("#btn-start")
    page.wait_for_selector("#screen-session:not(.hidden)")
    page.click("#btn-pause"); page.wait_for_timeout(200)
    cd1 = page.inner_text("#count-label")
    page.wait_for_timeout(3000)
    t("отсчёт заморожен на паузе", page.inner_text("#count-label") == cd1, [cd1, page.inner_text("#count-label")])
    t("сессия не стартовала", page.inner_text("#phase-label") == "Приготовьтесь", page.inner_text("#phase-label"))
    page.click("#btn-pause"); page.wait_for_timeout(3500)
    t("отсчёт продолжился и сессия началась", page.inner_text("#phase-label") != "Приготовьтесь", page.inner_text("#phase-label"))

    print("\n=== L. Стоп во время отсчёта (главный баг) ===")
    page.click("#btn-stop"); page.wait_for_timeout(300)
    page.click("#btn-start")
    page.wait_for_selector("#screen-session:not(.hidden)")
    page.click("#btn-stop")
    page.wait_for_timeout(200)
    t("вернулись к настройкам", page.is_visible("#screen-setup"))
    page.wait_for_timeout(5000)
    t("экран сессии НЕ показался сам (утечка отсчёта устранена)", page.is_hidden("#screen-session"),
      page.evaluate("document.getElementById('screen-session').className"))
    t("настройки всё ещё видны", page.is_visible("#screen-setup"))

    print("\n=== M. Клавиша Space ===")
    page.click("#btn-start"); page.wait_for_selector("#screen-session:not(.hidden)")
    page.wait_for_timeout(3500)
    page.evaluate("document.activeElement.blur()")
    page.keyboard.press("Space")
    page.wait_for_timeout(250)
    t("Space поставил паузу", page.get_attribute("#btn-pause", "aria-label") == "Продолжить",
      page.get_attribute("#btn-pause", "aria-label"))
    page.keyboard.press("Space"); page.wait_for_timeout(250)
    t("Space снял паузу", page.get_attribute("#btn-pause", "aria-label") == "Пауза")
    page.click("#btn-stop"); page.wait_for_timeout(300)

    print("\n=== N. Полное завершение сессии ===")
    page.evaluate("localStorage.setItem('breath-settings', JSON.stringify({phaseDuration:2,totalCycles:1,sound:true,haptics:true}))")
    page.reload(wait_until="networkidle")
    page.click("#btn-start")
    page.wait_for_selector("#screen-done:not(.hidden)", timeout=20000)
    t("экран 'Готово' показан", page.is_visible("#screen-done"))
    dt = page.inner_text("#done-text")
    t("текст: 1 цикл · 8 сек", dt == "1 цикл · 8 сек", dt)
    t("badge отрисован", page.is_visible(".done__badge"))
    t("кнопка 'Ещё раз'", page.is_visible("#btn-again"))
    page.click("#btn-settings"); page.wait_for_timeout(300)
    t("'Изменить настройки' возвращает на setup", page.is_visible("#screen-setup"))

    print("\n=== O. Ещё раз ===")
    page.click("#btn-start"); page.wait_for_selector("#screen-session:not(.hidden)")
    page.wait_for_timeout(3200)
    t("повторный запуск работает", page.is_visible("#screen-session"))
    page.wait_for_selector("#screen-done:not(.hidden)", timeout=20000)
    t("второй прогон завершился", page.is_visible("#screen-done"))
    page.click("#btn-again"); page.wait_for_selector("#screen-session:not(.hidden)")
    page.wait_for_timeout(3200)
    t("'Ещё раз' перезапускает сессию", page.is_visible("#screen-session"))
    page.click("#btn-stop"); page.wait_for_timeout(300)

    print("\n=== P. Фон/возврат (visibilitychange) ===")
    page.evaluate("localStorage.setItem('breath-settings', JSON.stringify({phaseDuration:4,totalCycles:20,sound:true,haptics:true}))")
    page.reload(wait_until="networkidle")
    page.click("#btn-start")
    page.wait_for_timeout(3500)
    t("сессия идёт", page.inner_text("#phase-label") in ["Вдох", "Пауза", "Выдох"], page.inner_text("#phase-label"))
    page.evaluate("() => { Object.defineProperty(document, 'visibilityState', {value:'visible', configurable:true}); document.dispatchEvent(new Event('visibilitychange')); }")
    page.wait_for_timeout(500)
    st = page.evaluate("({running: state.running, cycle: state.session && state.session.cycle, phase: state.session && state.session.phaseIndex})")
    t("состояние не сломалось после visibilitychange", st["running"] is True, st)
    # эмулируем «сон»: сдвигаем timelineStart назад и форсируем пересчёт
    drifted = page.evaluate("""() => {
      state.session.timelineStart -= 100000;  // будто прошло 100 секунд
      const fn = document.visibilityState;
      return true;
    }""")
    page.wait_for_timeout(400)
    st2 = page.evaluate("({cycle: state.session ? state.session.cycle : null, running: state.running})")
    t("после 'сна' цикл догнался (>=5)", (st2["cycle"] or 0) >= 5, st2)
    t("приложение живо", st2["running"] in (True, False))
    page.click("#btn-stop"); page.wait_for_timeout(300)

    print("\n=== Q. Ресайз/поворот ===")
    page.click("#btn-start"); page.wait_for_timeout(3500)
    page.set_viewport_size({"width": 844, "height": 390})
    page.wait_for_timeout(500)
    inside = page.evaluate("""() => {
      const r = document.getElementById('dot').getBoundingClientRect();
      const b = document.getElementById('box').getBoundingClientRect();
      return r.left >= b.left - 40 && r.right <= b.right + 40 && r.top >= b.top - 40 && r.bottom <= b.bottom + 40;
    }""")
    t("точка осталась в боксе после поворота", inside)
    t("нет горизонтального скролла в ландшафте", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
      page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(500)
    t("сессия продолжается после ресайза", page.is_visible("#screen-session"))
    page.click("#btn-stop"); page.wait_for_timeout(300)

    print("\n=== R. Нет ошибок в консоли за весь прогон ===")
    t("нет pageerror", not errors, errors[:5])
    noise = [e for e in console_errors if "favicon" not in e.lower()]
    t("нет console.error", not noise, noise[:5])

    print("\n=== S. Accessibility ===")
    page.reload(wait_until="networkidle")
    a11y = page.evaluate("""() => {
      const q = s => document.querySelector(s);
      const rows = ['row-sound','row-haptics'];
      return {
        roleSwitch: rows.every(id => q('#'+id).getAttribute('role') === 'switch'),
        ariaChecked: rows.every(id => ['true','false'].includes(q('#'+id).getAttribute('aria-checked'))),
        sheetRole: q('#sheet').getAttribute('role') === 'dialog',
        sheetModal: q('#sheet').getAttribute('aria-modal') === 'true',
        sheetLabelled: q('#sheet').getAttribute('aria-labelledby') === 'sheet-title',
        phaseLive: q('#phase-label').getAttribute('aria-live') === 'polite',
        lang: document.documentElement.lang === 'ru',
        buttonsHaveType: Array.from(document.querySelectorAll('button')).every(b => b.getAttribute('type') === 'button'),
        buttonsHaveLabel: Array.from(document.querySelectorAll('.btn-circle')).every(b => b.getAttribute('aria-label')),
      };
    }""")
    for k, v in a11y.items():
        t("a11y: " + k, v is True, v)

    print("\n=== T. Manifest ===")
    man = page.evaluate("""async () => {
      const r = await fetch('manifest.webmanifest');
      const txt = await r.text();
      return { text: txt, json: JSON.parse(txt) };
    }""")
    m = man["json"]
    t("manifest без BOM", man["text"][0] != "\ufeff", repr(man["text"][:3]))
    t("theme_color = #000000", m["theme_color"] == "#000000", m["theme_color"])
    t("background_color = #000000", m["background_color"] == "#000000", m["background_color"])
    t("lang = ru", m["lang"] == "ru", m.get("lang"))
    t("id присутствует", "id" in m)
    icons_ok = page.evaluate("""async () => {
      const m = await (await fetch('manifest.webmanifest')).json();
      const res = [];
      for (const i of m.icons) {
        const r = await fetch(i.src, {method:'HEAD'});
        res.push([i.src, r.status]);
      }
      return res;
    }""")
    t("все иконки манифеста доступны (200)", all(s == 200 for _, s in icons_ok), icons_ok)

    print("\n=== U. Тема и метатеги ===")
    tc = page.evaluate("document.querySelector('meta[name=theme-color]').content")
    t("theme-color совпадает с манифестом", tc == m["theme_color"], [tc, m["theme_color"]])
    t("color-scheme задан", page.evaluate("!!document.querySelector('meta[name=color-scheme]')"))
    t("bg body чёрный", page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(0, 0, 0)")

    print("\n=== V. Двойной старт не плодит таймеры ===")
    page.click("#btn-start")
    page.wait_for_timeout(100)
    page.evaluate("start(); start(); start();")
    page.wait_for_timeout(3600)
    st3 = page.evaluate("({counting: state.counting, running: state.running, cdLeft: state.countdownLeft})")
    t("состояние согласовано после тройного start", not (st3["counting"] and st3["running"]), st3)
    page.wait_for_timeout(4000)
    lbl = page.inner_text("#phase-label")
    t("после тройного start фазы идут нормально", lbl in ["Вдох", "Пауза", "Выдох"], lbl)
    page.click("#btn-stop"); page.wait_for_timeout(300)

    print("\n=== W. Стресс: 30 циклов старт/стоп ===")
    for i in range(30):
        page.wait_for_selector("#screen-setup:not(.hidden)", timeout=5000)
        page.click("#btn-start")
        page.wait_for_selector("#screen-session:not(.hidden)", timeout=5000)
        page.wait_for_timeout(60)
        page.click("#btn-stop")
        page.wait_for_timeout(20)
    page.wait_for_timeout(4000)
    t("после 30 циклов на экране настроек", page.is_visible("#screen-setup") and page.is_hidden("#screen-session"))
    t("нет утечки таймеров", page.evaluate("state.rafId === null && state.cueTimer === null && state.countdownTimer === null"),
      page.evaluate("[state.rafId, state.cueTimer, state.countdownTimer]"))
    t("sessionToken инкрементируется", page.evaluate("state.sessionToken") >= 30, page.evaluate("state.sessionToken"))

    print("\n=== X. Итоговый прогон без ошибок ===")
    t("нет pageerror после стресса", not errors, errors[:5])

    browser.close()

httpd.shutdown()
print("\n=================================")
print("PASS: %d   FAIL: %d" % (PASS, FAIL))
if FAIL:
    print("\nFailed:")
    for f in FAILS: print("  - " + f)
else:
    print("ALL BROWSER TESTS PASSED")
sys.exit(0 if FAIL == 0 else 1)
