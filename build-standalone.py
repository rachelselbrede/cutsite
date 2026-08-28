#!/usr/bin/env python3
"""
Generate cutsite-standalone.html: the whole game as one file you can email,
drop on a USB stick, or open straight off disk with no other files beside it.

It is a build product. Edit index.html / style.css / script.js and re-run:

    python3 build-standalone.py

Run it with --check to verify the committed file is current without writing
anything; it exits non-zero if the standalone has fallen behind the sources.

The standalone file used to be maintained by hand and quietly fell three
features behind the real game (Zen mode, achievements, the leaderboard), which
is why it is generated now.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
SOURCE = ROOT / "index.html"
OUTPUT = ROOT / "cutsite-standalone.html"

BANNER = """<!--
  GENERATED FILE - do not edit by hand.
  Built from index.html + style.css + script.js by build-standalone.py.
  Any edit here is lost on the next build; change the source files instead.
-->
"""

# A "</script>" or "</style>" sitting inside the inlined source would close the
# tag early and silently break the page, so refuse to build rather than ship it.
FORBIDDEN = {"style.css": "</style>", "script.js": "</script>"}


def read_asset(name):
    text = (ROOT / name).read_text(encoding="utf-8")
    bad = FORBIDDEN[name]
    if bad in text:
        sys.exit(f"error: {name} contains {bad!r}, which cannot be inlined safely")
    return text.strip("\n")


def main():
    html = SOURCE.read_text(encoding="utf-8")
    css = read_asset("style.css")
    js = read_asset("script.js")

    # The cache-busting query strings (style.css?v=6) are meaningless once the
    # asset is inlined, so the patterns tolerate any ?v= value or none at all.
    # The replacements are callables: the JS contains escapes like \u00d7 that
    # re.sub would otherwise try to interpret in a plain replacement string.
    html, n_css = re.subn(
        r'[ \t]*<link rel="stylesheet" href="style\.css(?:\?[^"]*)?"\s*/?>\n',
        lambda _: "  <style>\n" + css + "\n  </style>\n",
        html,
    )
    html, n_js = re.subn(
        r'[ \t]*<script src="script\.js(?:\?[^"]*)?"></script>\n',
        lambda _: "  <script>\n" + js + "\n  </script>\n",
        html,
    )

    if n_css != 1 or n_js != 1:
        sys.exit(
            f"error: expected one stylesheet and one script tag in index.html, "
            f"found {n_css} and {n_js}. Did the markup change?"
        )

    html = html.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + BANNER, 1)

    if "--check" in sys.argv:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else None
        if current != html:
            sys.exit(
                f"{OUTPUT.name} is out of date. Run: python3 {pathlib.Path(__file__).name}"
            )
        print(f"{OUTPUT.name} is up to date")
        return

    OUTPUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUTPUT.name} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
