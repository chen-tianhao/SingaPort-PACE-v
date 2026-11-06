"""Repair double-encoded UTF-8 (Chinese shown as mojibake) and strip BOM.

The damaged text mixes Latin-1 control chars (0x80–0x9F) with cp1252
punctuation, so neither codec alone round-trips; map per character.
"""
import os

ROOT = r"E:\github_code\SingaPort-PACE-v"
FILES = [
    "README.md",
    r"review-2026-11-06\README.md",
    r"src\main.js",
    r"src\terminal.js",
    r"src\equipment.js",
    r"src\yards.js",
    r"src\geo.js",
    "index.html",
]


def cjk(s):
    return sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")


def to_bytes(s):
    out = bytearray()
    for ch in s:
        o = ord(ch)
        if o < 0x100:
            out.append(o)
        else:
            out.append(ch.encode("cp1252")[0])
    return bytes(out)


for rel in FILES:
    p = os.path.join(ROOT, rel)
    b = open(p, "rb").read()
    bom = b.startswith(b"\xef\xbb\xbf")
    s = b.decode("utf-8-sig")
    best, best_cjk = s, cjk(s)
    try:
        r = to_bytes(s).decode("utf-8")
        if cjk(r) > best_cjk:
            best, best_cjk = r, cjk(r)
    except Exception as e:  # noqa: BLE001
        print(f"{rel}: recovery failed: {e}")
    print(f"{rel}: bom={bom} cjk={cjk(s)} -> {best_cjk}")
    if best is not s:
        open(p, "w", encoding="utf-8", newline="\n").write(best)
        print("  fixed")
