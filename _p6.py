import io
p = "style.css"
s = io.open(p, encoding="utf-8-sig").read()

old = """.screen--session {
  justify-content: flex-start;
  gap: 0;
  position: relative;
}"""
new = """.screen--session {
  justify-content: center;
  gap: 0;
  position: relative;
}"""
assert old in s, "anchor session"
s = s.replace(old, new)

old2 = """.session__top {
  position: absolute;
  top: 4px;
  left: 0;
  right: 0;
  text-align: center;
  pointer-events: none;
  animation: fadeSlideDown 0.45s var(--spring) both;
}"""
new2 = """.session__top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  text-align: center;
  pointer-events: none;
  animation: fadeSlideDown 0.45s var(--spring) both;
}"""
assert old2 in s, "anchor top"
s = s.replace(old2, new2)

old3 = """.session__controls {
  display: flex;
  gap: 44px;
  margin-top: 64px;
  animation: fadeSlideUp 0.5s var(--spring) 0.1s both;
}"""
new3 = """.session__controls {
  display: flex;
  gap: 44px;
  margin-top: 56px;
  animation: fadeSlideUp 0.5s var(--spring) 0.1s both;
}"""
assert old3 in s, "anchor controls"
s = s.replace(old3, new3)

io.open(p, "w", encoding="utf-8-sig", newline="\n").write(s)
print("style.css session layout fixed")
