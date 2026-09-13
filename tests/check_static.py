import io, json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8")
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ok = True

def fail(msg):
    global ok
    ok = False
    print("  FAIL:", msg)

def read(name, bom=False):
    p = os.path.join(root, name)
    with io.open(p, encoding="utf-8-sig" if bom else "utf-8") as f:
        return f.read()

# ---- manifest ----
print("[manifest]")
raw = io.open(os.path.join(root, "manifest.webmanifest"), "rb").read()
print("  BOM:", raw[:3] == b"\xef\xbb\xbf")
m = json.loads(raw.decode("utf-8"))
for icon in m["icons"]:
    p = os.path.join(root, icon["src"].replace("/", os.sep))
    if not os.path.exists(p): fail("icon missing: " + icon["src"])
    else: print("  icon ok:", icon["src"], icon["purpose"])
print("  theme:", m["theme_color"], "bg:", m["background_color"], "lang:", m.get("lang"))

# ---- html/js/css cross-refs ----
html = read("index.html", bom=True)
js = read("app.js", bom=True)
css = read("style.css", bom=True)
sw = read("sw.js", bom=True)

html_ids = set(re.findall(r'id="([^"]+)"', html))
js_ids = set(re.findall(r'\$\("([^"]+)"\)', js))
missing = js_ids - html_ids
print("\n[ids] JS ids not in HTML:", sorted(missing) or "none")
if missing: fail("missing ids")

dup = [i for i in html_ids if re.findall(r'id="%s"' % re.escape(i), html).__len__() > 1]
print("[ids] duplicate ids:", dup or "none")
if dup: fail("duplicate ids")

acts = set(re.findall(r'^\s*"([a-zA-Z0-9_-]+)":', js, re.M))
acts = {a for a in acts if "-" in a}
missing_acts = acts - html_ids
print("[actions] action ids not in HTML:", sorted(missing_acts) or "none")
if missing_acts: fail("missing action ids")

# clickable ids in HTML that have no action (informational)
buttons = set(re.findall(r'<button[^>]*id="([^"]+)"', html))
no_action = buttons - acts
print("[actions] buttons without action handler:", sorted(no_action) or "none")

# ---- assets referenced in html ----
print("\n[html assets]")
for src in re.findall(r'(?:href|src)="([^"]+)"', html):
    if src.startswith(("http", "data:", "#")): continue
    p = os.path.join(root, src.replace("/", os.sep))
    exists = os.path.exists(p)
    print("  ", ("ok " if exists else "MISSING "), src)
    if not exists: fail("asset missing: " + src)

# ---- sw asset list ----
print("\n[sw assets]")
sw_assets = re.findall(r'"\./([^"]*)"', sw) + re.findall(r'"\./"', sw)
for a in set(re.findall(r'"\.\/([^"]+)"', sw)):
    p = os.path.join(root, a.replace("/", os.sep))
    print("  ", ("ok " if os.path.exists(p) else "MISSING "), a)
    if not os.path.exists(p): fail("sw asset missing: " + a)

# ---- css classes used by JS exist in CSS ----
print("\n[css classes toggled in JS]")
for cls in ["pulse", "tick", "countdown", "swap", "closing", "hidden", "is-active", "is-paused", "on"]:
    present = "." + cls in css
    print("  ", ("ok " if present else "MISSING "), cls)
    if not present: fail("css class missing: ." + cls)

# ---- css selectors vs html ----
print("\n[css block-level selectors vs html]")
for sel in ["toggle-haptics", "row-haptics", "app-title", "noscript"]:
    print("  html has", sel, ":", sel in html)

# ---- balanced braces ----
print("\n[syntax sanity]")
for name, text in [("app.js", js), ("sw.js", sw)]:
    bal = text.count("{") - text.count("}")
    print("  %s brace delta: %d" % (name, bal))
    if bal != 0: fail("unbalanced braces in " + name)
for name, text in [("style.css", css)]:
    bal = text.count("{") - text.count("}")
    print("  %s brace delta: %d" % (name, bal))
    if bal != 0: fail("unbalanced braces in " + name)

print("\nRESULT:", "ALL CHECKS PASSED" if ok else "PROBLEMS FOUND")
sys.exit(0 if ok else 1)
