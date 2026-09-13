# -*- coding: utf-8 -*-
"""Визуальная проверка: снимки всех экранов и состояний.
Запуск: python tests/screenshots.py
Снимки сохраняются в корень проекта как shot_*.png (в .gitignore)."""
import functools, http.server, os, socketserver, sys, threading
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8733

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

Handler = functools.partial(Q, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d/" % PORT
print("server up:", BASE)

def shot(pg, name):
    path = os.path.join(ROOT, name)
    pg.screenshot(path=path)
    print("shot", name)

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for label, w, h in [("mobile", 390, 844), ("desktop", 1280, 900)]:
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2,
                                is_mobile=(label == "mobile"), has_touch=(label == "mobile"))
            pg = ctx.new_page()
            pg.goto(BASE, wait_until="load")
            pg.wait_for_timeout(900)
            shot(pg, "shot_01_setup_%s.png" % label)

            pg.evaluate("localStorage.setItem('breath-settings', JSON.stringify({phaseDuration:4,totalCycles:5,sound:true,haptics:true}))")
            pg.reload(wait_until="load"); pg.wait_for_timeout(700)
            pg.click("#btn-start")
            pg.wait_for_selector("#screen-session:not(.hidden)")
            pg.wait_for_timeout(700)
            shot(pg, "shot_02_countdown_%s.png" % label)
            pg.wait_for_timeout(3000)
            shot(pg, "shot_03_inhale_%s.png" % label)
            pg.wait_for_timeout(4050)
            shot(pg, "shot_04_exhale_%s.png" % label)
            pg.click("#btn-pause"); pg.wait_for_timeout(600)
            shot(pg, "shot_05_paused_%s.png" % label)
            pg.click("#btn-pause"); pg.wait_for_timeout(300)

            pg.click("#btn-stop"); pg.wait_for_timeout(400)
            pg.click("#row-phase"); pg.wait_for_selector("#sheet:not(.hidden)")
            pg.wait_for_timeout(700)
            shot(pg, "shot_06_picker_%s.png" % label)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(450)

            pg.evaluate("localStorage.setItem('breath-settings', JSON.stringify({phaseDuration:2,totalCycles:1,sound:true,haptics:true}))")
            pg.reload(wait_until="load"); pg.wait_for_timeout(600)
            pg.click("#btn-start")
            pg.wait_for_selector("#screen-done:not(.hidden)", timeout=20000)
            pg.wait_for_timeout(1400)
            shot(pg, "shot_07_done_%s.png" % label)

            if label == "mobile":
                pg2 = ctx.new_page()
                pg2.set_viewport_size({"width": 844, "height": 390})
                pg2.goto(BASE, wait_until="load"); pg2.wait_for_timeout(800)
                shot(pg2, "shot_08_landscape.png")
                pg3 = ctx.new_page()
                pg3.set_viewport_size({"width": 320, "height": 568})
                pg3.goto(BASE, wait_until="load"); pg3.wait_for_timeout(800)
                pg3.click("#btn-start")
                pg3.wait_for_selector("#screen-session:not(.hidden)")
                pg3.wait_for_timeout(3600)
                shot(pg3, "shot_09_small.png")
            ctx.close()
        b.close()
finally:
    httpd.shutdown()
    httpd.server_close()
print("screenshots done")
