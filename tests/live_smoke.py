# -*- coding: utf-8 -*-
"""Смоук-тест живого продакшена после деплоя."""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

URL = "https://zerodayvault.github.io/box-breathing/"
ok = True
def t(name, cond, extra=None):
    global ok
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond or extra is None else " -> %r" % (extra,)))
    if not cond: ok = False

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL, wait_until="networkidle")
    t("сайт открывается", pg.is_visible("#screen-setup"))
    t("новая версия app.js", pg.evaluate("typeof startCountdownInterval === 'function'"))
    t("строка вибрации на месте", pg.is_visible("#row-haptics"))
    pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=20000)
    t("SW активен", pg.evaluate("navigator.serviceWorker.controller.scriptURL.includes('sw.js')"))
    t("кэш v10", pg.evaluate("caches.keys().then(k => k.some(x => x.includes('v10')))"))

    pg.click("#btn-start")
    pg.wait_for_selector("#screen-session:not(.hidden)")
    t("отсчёт пошёл", pg.inner_text("#phase-label") == "Приготовьтесь")
    pg.wait_for_timeout(3500)
    t("сессия началась", pg.inner_text("#phase-label") == "Вдох", pg.inner_text("#phase-label"))
    pg.touchscreen.tap(*(lambda bb: (bb["x"] + bb["width"]/2, bb["y"] + bb["height"]/2))(pg.locator("#btn-pause").bounding_box()))
    pg.wait_for_timeout(300)
    t("тап по кнопке паузы работает", pg.get_attribute("#btn-pause", "aria-label") == "Продолжить",
      pg.get_attribute("#btn-pause", "aria-label"))
    pg.touchscreen.tap(*(lambda bb: (bb["x"] + bb["width"]/2, bb["y"] + bb["height"]/2))(pg.locator("#btn-pause").bounding_box()))
    pg.wait_for_timeout(300)
    t("пауза снимается тапом", pg.get_attribute("#btn-pause", "aria-label") == "Пауза")
    pg.click("#btn-stop"); pg.wait_for_timeout(400)
    t("возврат на настройки", pg.is_visible("#screen-setup"))

    # офлайн
    ctx.set_offline(True)
    pg2 = ctx.new_page()
    pg2.goto(URL + "index.html", wait_until="commit")
    t("офлайн открывается из кэша", pg2.is_visible("#screen-setup"))
    ctx.set_offline(False)

    t("нет pageerror", not errors, errors[:3])
    b.close()
print("LIVE SMOKE:", "PASSED" if ok else "FAILED")
sys.exit(0 if ok else 1)
