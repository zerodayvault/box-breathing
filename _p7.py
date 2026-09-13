import io
p = "tests/unit.test.js"
s = io.open(p, encoding="utf-8-sig").read()
old = 't("\u0443 \u043a\u0430\u0436\u0434\u043e\u0439 \u0444\u0430\u0437\u044b \u0441\u0432\u043e\u0439 \u0446\u0432\u0435\u0442", new Set(colors).size === 4, colors);'
new = 't("\u043f\u0430\u0443\u0437\u044b \u043e\u0434\u0438\u043d\u0430\u043a\u043e\u0432\u044b, \u043e\u0441\u0442\u0430\u043b\u044c\u043d\u044b\u0435 \u0440\u0430\u0437\u043b\u0438\u0447\u0430\u044e\u0442\u0441\u044f", colors[1] === colors[3] && new Set(colors).size === 3, colors);'
assert old in s, "anchor not found"
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8-sig", newline="\n").write(s)
print("unit.test.js patched")
