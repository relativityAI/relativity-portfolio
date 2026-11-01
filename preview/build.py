#!/usr/bin/env python3
"""Render a harness run's markdown under the relativity-ui-design skill look.

usage: python3 preview/build.py [path/to/run.md]   (default: latest api/runs/**/*.md)
"""
import html
import re
import shutil
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "preview"
SKILL = ROOT / ".agents" / "skills" / "relativity-ui-design" / "assets"

SHELL = """<!DOCTYPE html>
<html lang="en" class="light">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&family=Anek+Latin:wght@100..800&family=IBM+Plex+Mono:wght@400;500;600&family=Tiro+Devanagari+Hindi&display=swap" rel="stylesheet">
<link rel="stylesheet" href="almanac.css">
<link rel="stylesheet" href="article.css">
<script>document.documentElement.classList.add(
  (localStorage.getItem('theme')==='dark' ||
   (!localStorage.getItem('theme') && matchMedia('(prefers-color-scheme: dark)').matches))
  ? 'dark' : 'light');</script>
</head>
<body lang="en" class="dom-economy">
<div class="wrap">
  <nav class="nav">
    <a class="brand" href="index.html">Relativity</a>
    <div class="nav-r">
      <div class="crumb"><span class="here">{symbol}</span><span class="sep">/</span><span>{source}</span><span class="sep">/</span><span>{date}</span></div>
    </div>
  </nav>
  <hr class="r">
  <article style="padding:26px 0 8px">
{body}
  </article>
  <footer class="foot"><div class="foot-brand">Relativity</div><p class="foot-note">Preview render of a harness run under the Almanac design skill.</p></footer>
</div>
</body>
</html>
"""


def latest_run() -> Path:
    runs = sorted((ROOT / "api" / "runs").glob("*/*.md"))
    if not runs:
        sys.exit("no run .md found under api/runs — pass a path")
    return runs[-1]


def to_html(md_text: str) -> str:
    # harness-internal key token — not report prose
    md_text = re.sub(r"^> \[key\] ", "> ", md_text, flags=re.M)
    out = markdown.markdown(md_text, extensions=["tables", "fenced_code"])
    # skill table markup: hairline rows, micro headers, right-aligned numbers
    out = out.replace("<table>", '<div class="table-wrap"><table class="data">')
    out = out.replace("</table>", "</table></div>")
    return out


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else latest_run()
    text = src.read_text(encoding="utf-8")

    m = re.search(r"^#\s+(.*)$", text, re.M)
    title = html.escape(m.group(1).strip()) if m else src.stem
    body = to_html(text)

    shutil.copyfile(SKILL / "almanac.css", OUT / "almanac.css")
    (OUT / "index.html").write_text(
        SHELL.format(
            title=title,
            symbol=src.stem.split("-")[-1],
            source="Report",
            date=src.stem[:16],
            body=body,
        ),
        encoding="utf-8",
    )
    print(f"wrote {OUT / 'index.html'} from {src}")


if __name__ == "__main__":
    main()
