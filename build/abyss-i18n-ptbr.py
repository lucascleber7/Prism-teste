#!/usr/bin/env python3
"""Replace untranslated (Chinese) UI string literals of the Android frontend and plugins with Portuguese.

Usage:
  abyss-i18n-ptbr.py --list              list every string literal that contains CJK text (key, kind, text)
  abyss-i18n-ptbr.py MAP.tsv             apply the map; run from the root of the OBS-for-Android checkout

MAP.tsv lines:  "@ relative/path"  starts a file section;  "N<TAB>CHK<TAB>text"  replaces the N-th CJK literal
of that file (1-based, in source order, comments ignored) if it starts with CHK. Every replacement must keep the
printf/Qt format specifiers in the same order, contain no CJK and no unescaped double quote.
"""
import re
import sys
from pathlib import Path

CJK = re.compile(r"[　-〿㐀-鿿＀-￯]")
SPEC = re.compile(r"%%|%(?:\d+\$)?[-+ #0]*(?:\*|\d+)?(?:\.(?:\*|\d+))?(?:hh|h|ll|l|z|j|t|L)?[diouxXeEfFgGaAcspn]|%L?\d{1,2}")
EXTS = {".c", ".cpp", ".hpp", ".h", ".java"}
LOG_HINT = re.compile(r"\b(blog|LOG_[A-Z]+|printf|fprintf|__android_log|obs_log)\b|Log\.[ewidv]\(")


def literals(text):
    """Yield (start, end, content) of every ordinary double-quoted string literal in code (not comments)."""
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        two = text[i:i + 2]
        if two == "//":
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif two == "/*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif c == "'":
            i += 1
            while i < n and text[i] != "'":
                i += 2 if text[i] == "\\" else 1
            i += 1
        elif c == '"':
            if i > 0 and text[i - 1] == "R":  # raw string: R"delim( ... )delim"
                m = re.compile(r'"([^()\\ \n]{0,16})\(').match(text, i)
                if m:
                    end = text.find(")" + m.group(1) + '"', m.end())
                    i = n if end < 0 else end + len(m.group(1)) + 2
                    continue
            start = i
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\n":
                    break
                i += 2 if text[i] == "\\" else 1
            if i < n and text[i] == '"':
                yield start, i + 1, text[start + 1:i]
            i += 1
        else:
            i += 1


def cjk_literals(text):
    return [(s, e, c) for s, e, c in literals(text) if CJK.search(c)]


def files(root):
    out = []
    for sub in ("obs-studio/frontend", "obs-studio/plugins"):
        d = root / sub
        if d.is_dir():
            out += [p for p in d.rglob("*") if p.is_file() and p.suffix in EXTS]
    return sorted(out, key=lambda p: str(p))


def spec_list(s):
    return SPEC.findall(s)


def unescaped_quote(s):
    return re.search(r'(?<!\\)(?:\\\\)*"', s) is not None


def main():
    root = Path.cwd()
    if sys.argv[1:] == ["--list"]:
        for p in files(root):
            text = p.read_text(errors="ignore")
            for k, (s, e, c) in enumerate(cjk_literals(text), 1):
                ctx = text[max(0, s - 160):s]
                kind = "log" if LOG_HINT.search(ctx.splitlines()[-1] if ctx.splitlines() else "") or LOG_HINT.search(ctx[-120:]) else "ui"
                print(f"{p.relative_to(root)}#{k}\t{kind}\t{c}")
        return 0
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    plan, section = {}, None
    for raw in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.startswith("#"):
            continue
        if raw.startswith("@ "):
            section = raw[2:].strip()
            plan.setdefault(section, {})
            continue
        n, chk, tr = raw.split("\t", 2)
        plan[section][int(n)] = (chk, tr)
    problems, done = [], 0
    for rel, items in plan.items():
        p = root / rel
        if not p.is_file():
            problems.append(f"missing file {rel}")
            continue
        text = p.read_text(encoding="utf-8")
        lits = cjk_literals(text)
        edits = []
        for n, (chk, tr) in sorted(items.items()):
            if n < 1 or n > len(lits):
                problems.append(f"{rel}#{n}: no such literal (file has {len(lits)})")
                continue
            s, e, orig = lits[n - 1]
            if not orig.startswith(chk):
                problems.append(f"{rel}#{n}: expected start {chk!r}, found {orig[:12]!r}")
                continue
            if CJK.search(tr):
                problems.append(f"{rel}#{n}: translation still has CJK")
                continue
            if unescaped_quote(tr):
                problems.append(f"{rel}#{n}: translation has an unescaped double quote")
                continue
            if spec_list(orig) != spec_list(tr):
                problems.append(f"{rel}#{n}: format specifiers differ {spec_list(orig)} vs {spec_list(tr)}")
                continue
            if orig.count("\\n") != tr.count("\\n"):
                problems.append(f"{rel}#{n}: newline escapes differ")
                continue
            edits.append((s, e, '"' + tr + '"'))
        for s, e, new in sorted(edits, reverse=True):
            text = text[:s] + new + text[e:]
            done += 1
        p.write_text(text, encoding="utf-8")
    print(f"translated {done} string literals in {len(plan)} files")
    for line in problems:
        print("PROBLEM", line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
