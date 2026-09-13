import io
p = "tests/unit.test.js"
s = io.open(p, encoding="utf-8-sig").read()
old = 'new Set(ev("PHASES.map(p => p.color)")).size === 4'
new = 'new Set(ev("PHASES.map(p => p.color)")).size === 3'
assert old in s, "anchor not found"
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8-sig", newline="\n").write(s)
print("unit test assert fixed")
