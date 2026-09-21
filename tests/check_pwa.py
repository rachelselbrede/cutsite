#!/usr/bin/env python3
"""
Check the progressive-web-app wiring hangs together.

    python3 tests/check_pwa.py

The browser suite cannot do this part. Installing an app is something the
browser does before any of the game's code runs, and the pieces live in four
different files, so the failure mode is drift: bump the ?v= on script.js,
forget the one in sw.js, and every returning player is served last week's
game out of the cache with no way to tell. So this is a file check, in the
same spirit as build-standalone.py --check, and it runs in CI beside it.

Standard library only, like everything else here.
"""

import json
import pathlib
import re
import struct
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
problems = []


def check(cond, msg):
    if not cond:
        problems.append(msg)
    return cond


def png_size(path):
    """(width, height) straight out of the IHDR, so this needs no Pillow."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


index = (ROOT / "index.html").read_text(encoding="utf-8")
sw = (ROOT / "sw.js").read_text(encoding="utf-8")

# ---------- index.html ----------
check(
    '<link rel="manifest" href="manifest.webmanifest" />' in index,
    "index.html does not link manifest.webmanifest",
)
check(
    'rel="apple-touch-icon"' in index,
    "index.html has no apple-touch-icon; iOS falls back to a screenshot",
)
for fence in ("pwa:head", "pwa"):
    check(
        index.count(f"<!-- {fence}:start -->") == 1
        and index.count(f"<!-- {fence}:end -->") == 1,
        f"index.html needs exactly one {fence} fence; "
        f"build-standalone.py and tests/run.py both cut on it",
    )
check(
    "navigator.serviceWorker.register" in index,
    "index.html never registers the service worker, so the app is not installable",
)

# ---------- the version on the assets, in both places ----------
asset_versions = dict(re.findall(r'"(style\.css|script\.js)\?v=(\d+)"', index))
check(
    set(asset_versions) == {"style.css", "script.js"},
    f"expected a ?v= on both style.css and script.js in index.html, got {asset_versions}",
)
versions = set(asset_versions.values())
check(len(versions) == 1, f"style.css and script.js carry different ?v=: {asset_versions}")

sw_version = re.search(r'const VERSION = "(\d+)"', sw)
if check(sw_version is not None, 'sw.js has no `const VERSION = "..."`') and versions:
    check(
        sw_version.group(1) in versions,
        f"sw.js VERSION is {sw_version.group(1)} but index.html loads ?v={sorted(versions)}. "
        f"Returning players would be served the cached build instead of the new one.",
    )

# ---------- the manifest ----------
manifest_path = ROOT / "manifest.webmanifest"
manifest = {}
if check(manifest_path.exists(), "manifest.webmanifest is missing"):
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        check(False, f"manifest.webmanifest is not valid JSON: {err}")

for field in ("name", "short_name", "start_url", "scope", "display",
              "background_color", "theme_color", "icons"):
    check(field in manifest, f"manifest.webmanifest has no {field!r}")

check(
    manifest.get("display") in ("standalone", "fullscreen", "minimal-ui"),
    f"manifest display is {manifest.get('display')!r}; a browser will not offer to install that",
)
# Relative, because the game is served from a project subpath
# (/cutsite/), not from the root of the domain.
for field in ("start_url", "scope"):
    value = manifest.get(field, "")
    check(
        value.startswith("."),
        f"manifest {field} is {value!r}; it must be relative or it breaks on /cutsite/",
    )
check(
    manifest.get("theme_color") == "#070d1a",
    "manifest theme_color should match the theme-color meta in index.html",
)

# ---------- the icons ----------
declared = {}
for icon in manifest.get("icons", []):
    src = icon.get("src", "")
    path = ROOT / src
    if not check(path.exists(), f"manifest lists {src}, which does not exist"):
        continue
    size = png_size(path)
    if not check(size is not None, f"{src} is not a PNG"):
        continue
    want = icon.get("sizes", "")
    check(
        want == f"{size[0]}x{size[1]}",
        f"manifest says {src} is {want}, but the file is {size[0]}x{size[1]}",
    )
    declared[(icon.get("purpose", "any"), size[0])] = src

# Chrome will not offer to install without both of these.
for need in (192, 512):
    check(
        ("any", need) in declared,
        f"no {need}x{need} icon with purpose 'any'; Chrome needs both 192 and 512 to install",
    )
check(
    any(purpose == "maskable" for purpose, _ in declared),
    "no maskable icon; Android will letterbox the square one inside its mask",
)

apple = ROOT / "apple-touch-icon.png"
if check(apple.exists(), "apple-touch-icon.png is missing"):
    size = png_size(apple)
    check(size is not None and size[0] == size[1], f"apple-touch-icon.png is not square ({size})")

# ---------- the precache list ----------
# The list is written with string concatenation for the version, so rebuild
# the real URLs the same way the worker does.
precache = re.findall(r'"(\./[^"]*)"', sw.split("const PRECACHE")[1].split("];")[0])
sw_v = sw_version.group(1) if sw_version else ""
precache_urls = {u.replace("./", "").replace('" + VERSION', "").strip('"') for u in precache}
precache_urls = {re.sub(r"\?v=$", f"?v={sw_v}", u) for u in precache_urls}

must_cache = {"", "index.html", "manifest.webmanifest", "apple-touch-icon.png"}
must_cache |= {icon.get("src", "") for icon in manifest.get("icons", [])}
must_cache |= {f"{name}?v={v}" for name, v in asset_versions.items()}
missing = sorted(must_cache - precache_urls)
check(not missing, f"sw.js PRECACHE is missing: {', '.join(missing)}")

for url in sorted(precache_urls):
    path = ROOT / (url.split("?")[0] or "index.html")
    check(path.exists(), f"sw.js precaches {url!r}, which is not a file in the repo")

# ---------- report ----------
if problems:
    for p in problems:
        print("FAIL  " + p, file=sys.stderr)
    sys.exit(f"\n{len(problems)} problem(s) with the PWA wiring")
print("ok  manifest, icons, service worker and index.html agree")
