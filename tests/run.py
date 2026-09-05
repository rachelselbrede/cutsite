#!/usr/bin/env python3
"""
Run the CutSite test suite.

There is no test framework and nothing to install. The suite runs against
the real game, in a real browser:

  1. serve the repo over http (the game needs a real origin for storage),
  2. copy index.html and inject tests/suite.js right after script.js, so the
     suite shares the game's global scope,
  3. load that page in headless Chrome and read the results back out.

    python3 tests/run.py            run everything
    python3 tests/run.py --keep     leave the generated page in place

Exits non-zero if any test fails, so CI can gate on it.
"""

import functools
import html
import http.server
import pathlib
import re
import shutil
import subprocess
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / ".test-runner.tmp.html"
PORT = 4180

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "/usr/bin/google-chrome",
]


def find_chrome():
    for candidate in CHROME_CANDIDATES:
        if pathlib.Path(candidate).exists():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    sys.exit(
        "error: could not find Chrome or Chromium.\n"
        "Install Google Chrome, or set one of: " + ", ".join(CHROME_CANDIDATES)
    )


def build_page():
    """index.html plus the suite, so the tests run inside the real page."""
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    if "</body>" not in source:
        sys.exit("error: index.html has no </body> to inject the suite before")
    page = source.replace(
        "</body>", '  <script src="tests/suite.js"></script>\n</body>', 1
    )
    PAGE.write_text(page, encoding="utf-8")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler without the per-request logging."""

    def log_message(self, *args, **kwargs):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_chrome(chrome, url):
    """Load the page and dump the finished DOM. Returns stdout."""
    base = [
        chrome,
        "--disable-gpu",
        "--no-sandbox",              # CI runs as root in a container
        "--hide-scrollbars",
        "--virtual-time-budget=25000",
        "--dump-dom",
        url,
    ]
    # --headless=new on modern Chrome, plain --headless on older builds.
    for flag in ("--headless=new", "--headless"):
        proc = subprocess.run(
            [base[0], flag] + base[1:], capture_output=True, text=True, timeout=120
        )
        if "cutsite-test-output" in proc.stdout:
            return proc.stdout
        last = proc
    sys.stderr.write(last.stderr[-2000:] + "\n")
    sys.exit("error: the test page never reported results (did script.js throw?)")


def main():
    chrome = find_chrome()
    build_page()
    server = serve()
    try:
        dom = run_chrome(chrome, f"http://127.0.0.1:{PORT}/{PAGE.name}")
    finally:
        server.shutdown()
        if "--keep" not in sys.argv:
            PAGE.unlink(missing_ok=True)

    match = re.search(
        r'<pre id="cutsite-test-output">(.*?)</pre>', dom, re.S
    )
    if not match:
        sys.exit("error: could not find the test output in the page")
    report = html.unescape(match.group(1))
    print(report.strip())

    tally = re.search(r"CUTSITE-RESULT passed=(\d+) failed=(\d+)", report)
    if not tally:
        sys.exit("error: the suite did not report a tally")
    passed, failed = int(tally.group(1)), int(tally.group(2))
    print()
    if failed:
        print(f"FAILED  {failed} of {passed + failed} tests")
        sys.exit(1)
    print(f"passed  {passed} tests")


if __name__ == "__main__":
    main()
