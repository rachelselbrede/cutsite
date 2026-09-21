# CutSite

**A browser game about CRISPR gene editing.** A stretch of DNA fluoresces next to
its **PAM** site, and you have to snip it with the Cas9 scissors before the window
closes. Fast, accurate cuts build a combo and multiply your score.

### [▶ Play it](https://rachelselbrede.github.io/cutsite/)

![CutSite in Guide RNA mode: three sites fluoresce along a DNA strand and the Cas9 scissors hover over the one that matches the loaded guide beside a real NGG PAM.](docs/screenshot.png)

*Guide RNA mode above. Three sites glow, but only one is cuttable: the left one has
an intact PAM but a mismatch in its seed region, the middle one matches the guide
perfectly yet has no `NGG` beside it, and only the right one satisfies both.*

Built with plain HTML, CSS, and JavaScript — nothing to install, no dependencies,
no build step. To run it locally, open `index.html` in a browser.

## Modes and features

- **Classic** — 30-second rounds; the reaction window tightens as you land cuts.
- **Zen** — endless practice, no clock. The reaction window keeps tightening,
  slowly and forever, so a long run eventually has to earn its combo.
- **Guide RNA** — 45-second rounds where decoy sites fluoresce alongside the real
  one. Read the guide and cut only the site that matches it beside a genuine `NGG`.
  Sites face either strand, and a PAM to the left of a glow means read right to left.
- **Daily challenge** — twelve targets under Guide RNA rules, the same for
  everyone that day: the date seeds every random draw, and difficulty ramps on
  targets served rather than cuts landed, so a miss never changes what comes
  next. The first finished run counts. Share a Wordle-style result line
  (✂️✂️❌…) with your lab: the system share sheet on a phone, the clipboard
  elsewhere. The end card lists your finished days
  with their marks, counts a streak of days finished on the day, and says
  how long until the next one. `?day=YYYY-MM-DD` replays any past day back
  to Daily #1 (a replay is listed but never mends a streak), and a future or
  invalid day simply means today.
- **Off-target penalty** — cutting anything else resets your combo and, when
  Cas9 would have refused the site, jams the blades for a moment, so precision
  beats spraying clicks.
- **Leaderboards** — top 10 for Classic, Zen and Guide RNA, each with the
  accuracy and date that earned it, and the round you just played highlighted
  so you can see where it landed. Kept in browser storage; boards from older
  versions upgrade in place. The Daily keeps its per-day history instead,
  since every day is a different puzzle.
- **Achievements** — six unlockables that persist across sessions. The end card
  lists all six, with locked ones dimmed and showing how to earn them.
- **Round debrief** — the end card tallies every mistake by kind and says what
  each one means: how many tolerated off-targets, seed mismatches, no-PAM cuts,
  cuts inside the PAM and windows you let close, each with the biology that
  makes it a mistake. Under the tally sits a short account of how Cas9 really
  cuts, so the science is in the game and not only in this README. Folded shut
  by default, because the end card has to fit the stage.
- **Installable** — a web app manifest, maskable icons and a service worker, so
  the game adds to a phone's home screen and opens without a connection. The
  page itself is fetched network-first, so a deploy is never hidden behind the
  cache; everything else carries its version in the URL and is served from it.
- **Feedback** — screen shake on fast cuts, particle bursts, synthesised sound
  (no audio files), and a live accuracy readout. The sound toggle in the header
  remembers your choice.
- **No reloads** — the end card offers *Edit again* for the same mode and
  *Change mode* for the picker, so a whole session runs from one page load.
- **Pauses when you look away** — a hidden tab freezes the round instead of
  letting its timers run on. Come back and the target is where you left it,
  with nothing counted against you.
- **Plays on a phone** — in Classic and Zen the strand shortens on narrow
  screens so every base pair stays big enough to tap. Guide RNA and the Daily
  keep all thirty base pairs and wrap them into two rows instead, the way a
  sequence viewer wraps a long read, so the puzzle and its decoys are the same
  on a phone as on a desktop.
- **Plays on a keyboard** — Tab to the strand, arrow keys move along it, J or
  1–3 jump straight to a fluorescing site, Enter cuts, Esc ends a Zen round. The
  status line is a live region, so screen readers hear each hit, miss,
  and the reason an off-target cut failed.

## The science behind the game

CRISPR-Cas9 is a real gene-editing system. The short version of how it cuts:

- A **guide RNA** carries a ~20-letter sequence that matches a target spot in the genome.
- Cas9 will only cut next to a short signal called a **PAM** (in the common
  *S. pyogenes* Cas9, the PAM is `NGG`, so it ends in two Gs).
- When the guide matches and a PAM sits right beside it, Cas9 makes a **blunt**
  double-strand break a fixed **3 bp upstream** of the PAM.

Cas9's biggest real-world problem is the **off-target cut**: the enzyme snips a
site that only partly matches the guide. The game charges you for that too. Cut
anywhere other than the right site and you lose your combo - and unless Cas9
would have cut there too, the blades jam briefly - so accuracy matters as much
as speed.

This game keeps those ideas and simplifies the rest:

- The DNA is drawn as base pairs, and the pairing is correct: A always sits
  across from T, and G always sits across from C. The two strands are marked
  5'/3' and run antiparallel, as real duplex DNA does.
- Every target carries a full `NGG` **PAM** immediately 3' of it: three bases,
  of which only the two Gs are fixed. The N really is whatever base happens to
  be there.
- The dashed amber line is the **scissile position**. Cas9 breaks the duplex
  bluntly, 3 bp upstream of the PAM, and that is exactly where the game draws
  it rather than severing the whole target window.
- The **guide RNA** readout above the strand shows the loaded guide's spacer
  as RNA, 5' to 3' with U in place of T. It reads the same as the target's
  top strand because that is the strand it *does not* pair with: the guide
  base-pairs with the bottom strand, which is why the top one has to match.
- In **Guide RNA mode** several sites glow at once and only one is the right
  target. Two kinds of decoy fail the way real sites fail: a perfect sequence
  match with **no PAM** (Cas9 never even unwinds DNA that lacks an `NGG`), or
  an intact PAM next to a **seed mismatch** in the bases nearest it, where the
  guide has to pair or the enzyme lets go. Cut either and the blades jam:
  Cas9 refused.
- The third kind of decoy is the one that matters in a real lab. A
  **PAM-distal mismatch** - one wrong base at the far end from a perfectly good
  PAM - is *tolerated*: Cas9 cuts it anyway. In the game the blades work, the
  DNA parts, and only then does the penalty land, because that is the actual
  off-target problem. The enzyme does not protect you; the guide design has to.
- Sites face **either way**. Half of real genomic targets sit on the reverse
  strand, which runs 3' to 5' left to right on screen, so they read **right to
  left** along the bottom strand and their PAM sits to the **left** - where the
  top strand shows it as `CCN`. The guide is then the reverse complement of what
  the top strand shows, the bases on the site's own strand glow brightest, and
  the cut still lands 3 bp from the PAM, on the PAM's side. Guide RNA mode
  brings reverse sites in after twelve cuts, and each site faces its own way.
- The target length and the 20-letter guide are shortened so the whole thing
  fits on one screen and stays fun.

## How it is built

| File | What it does |
|------|--------------|
| `index.html` | Page structure: scoreboard, the DNA stage, and the start / game-over screens |
| `style.css` | The fluorescence-imaging look, the scissors cursor, and all animations |
| `script.js` | Game logic: drawing the strand, spawning targets, scoring, and sound |
| `manifest.webmanifest` | Web app manifest: name, colours and icons for an installed copy |
| `sw.js` | Service worker: precaches the game so it opens offline |
| `icon-*.png`, `apple-touch-icon.png` | Home-screen icons. **Generated** — see below |
| `build-icons.py` | Draws those icons from the same scissors mark as the favicon |
| `cutsite-standalone.html` | The whole game as one file. **Generated** — see below |
| `build-standalone.py` | Builds the standalone file from the three above |
| `og-image.png` | Link-preview card, referenced by the `og:image` meta tag |
| `docs/screenshot.png` | The screenshot at the top of this README |
| `tests/` | The test suite, its runner, and the app-wiring check |
| `.github/workflows/ci.yml` | Runs the tests on every push to every branch, and on pull requests from forks |

There is still no build step for playing or deploying the game; `index.html`
loads the CSS and JS directly. The script exists only to produce the single-file
copy, which is handy for emailing the game or opening it off a USB stick.

After editing `index.html`, `style.css`, or `script.js`, regenerate it:

```
python3 build-standalone.py
```

`python3 build-standalone.py --check` verifies the committed copy is current
without writing anything, and exits non-zero if it has fallen behind. Do not
edit `cutsite-standalone.html` by hand — the next build overwrites it. The
manifest, the icons and the service-worker registration are stripped on the
way through: none of them means anything to a page with no files beside it.

The icons are generated too, from the same coordinates as the inline SVG
favicon so the mark cannot drift between them:

```
python3 build-icons.py
```

That one needs Pillow, which is why it is run by hand rather than in CI —
the game itself still has no dependencies, and nothing else here needs one.
`tests/check_pwa.py` re-checks the committed PNGs with the standard library
alone, so CI still catches an icon that went missing or changed size.

When `style.css` or `script.js` changes in a way worth busting the cache for,
bump the `?v=` on both tags in `index.html` **and** `VERSION` in `sw.js`.
`tests/check_pwa.py` fails if they disagree: a worker still precaching the old
version would serve returning players the old game with no way to notice.

The JavaScript is organised into clear sections (config, state, the DNA strand,
the target loop, scoring, sound, helpers) and is commented throughout, so it is
easy to read and extend.

## Tests

```
python3 tests/run.py
```

No test framework, and still nothing to install. The suite runs the real game
in a real browser: `tests/run.py` serves the repo, copies `index.html` with
`tests/suite.js` injected just after `script.js` — so the tests share the
game's own scope — and reads the results back out of headless Chrome. It
waits for the web fonts before it starts, so the few tests that measure
layout see what a player sees.

Most of the 104 tests guard the biology, because that is the part of this
project that is easy to break by accident and hard to notice: the PAM is
always `NGG`, the cut always lands 3 bp upstream of it, the guide always
matches the protospacer it labels, no-PAM decoys never accidentally acquire a
real PAM, seed and distal decoys each differ by exactly one base at their own end,
and clearing a target restores the strand's base composition exactly.

That last one earned its place immediately: it failed on the suite's first run
and exposed a live bug in which every seed decoy leaked one base back into the
strand, dragging the sequence toward poly-G and poly-T over a long session.

One thing the browser suite cannot reach is the app wiring: a browser decides
whether a site is installable before any of the game's code runs, and the
pieces are spread over `index.html`, the manifest and the worker, so they drift
without anything failing. That has its own check:

```
python3 tests/check_pwa.py
```

It reads the manifest, measures each icon straight out of its PNG header,
and refuses a service worker whose version or precache list has fallen out of
step with the tags in `index.html`.

Both it and `python3 build-standalone.py --check` run in CI, so neither the
generated single-file copy nor the offline cache can fall behind the sources.

## Ideas for next versions

- Difficulty levels, a longer genome that scrolls, or a two-player mode.
- Other Cas enzymes with their own PAMs (Cas12a's `TTTV`, SaCas9's `NNGRRT`).

## Credits

Made by Rachel Selbrede as a portfolio project. Feedback and pull requests welcome.

Licensed under the [MIT License](LICENSE).
