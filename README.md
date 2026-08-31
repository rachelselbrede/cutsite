# CutSite

A small browser game about gene editing. A stretch of DNA fluoresces next to its
**PAM** site, and you have to snip it with the Cas9 scissors before the window
closes. Fast, accurate cuts build a combo and multiply your score.

Built with plain HTML, CSS, and JavaScript, so there is nothing to install and it
runs on GitHub Pages for free.

## Play it

If this repo is deployed with GitHub Pages, the game lives at:

```
https://rachelselbrede.github.io/cutsite/
```

To run it on your own machine, just open `index.html` in a browser. No build step,
no dependencies.

## The science behind the game

CRISPR-Cas9 is a real gene-editing system. The short version of how it cuts:

- A **guide RNA** carries a ~20-letter sequence that matches a target spot in the genome.
- Cas9 will only cut next to a short signal called a **PAM** (in the common
  *S. pyogenes* Cas9, the PAM is `NGG`, so it ends in two Gs).
- When the guide matches and a PAM sits right beside it, Cas9 makes a **blunt**
  double-strand break a fixed **3 bp upstream** of the PAM.

Cas9's biggest real-world problem is the **off-target cut**: the enzyme snips a
site that only partly matches the guide. The game charges you for that too. Cut
anywhere other than the fluorescing window and you lose your combo and the blades
jam briefly, so accuracy matters as much as speed.

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
- The target length and the 20-letter guide are shortened so the whole thing
  fits on one screen and stays fun.

## How it is built

| File | What it does |
|------|--------------|
| `index.html` | Page structure: scoreboard, the DNA stage, and the start / game-over screens |
| `style.css` | The fluorescence-imaging look, the scissors cursor, and all animations |
| `script.js` | Game logic: drawing the strand, spawning targets, scoring, and sound |
| `cutsite-standalone.html` | The whole game as one file. **Generated** — see below |
| `build-standalone.py` | Builds the standalone file from the three above |

There is still no build step for playing or deploying the game; `index.html`
loads the CSS and JS directly. The script exists only to produce the single-file
copy, which is handy for emailing the game or opening it off a USB stick.

After editing `index.html`, `style.css`, or `script.js`, regenerate it:

```
python3 build-standalone.py
```

`python3 build-standalone.py --check` verifies the committed copy is current
without writing anything, and exits non-zero if it has fallen behind. Do not
edit `cutsite-standalone.html` by hand — the next build overwrites it.

The JavaScript is organised into clear sections (config, state, the DNA strand,
the target loop, scoring, sound, helpers) and is commented throughout, so it is
easy to read and extend.

## Ideas for next versions

- A **guide RNA** you have to match: show a target sequence and only score cuts
  at the correct spot.
- Difficulty levels, a longer genome that scrolls, or a two-player mode.
- Decoy sites that *look* like valid targets but carry a mismatched PAM.
- A **seed region**: mismatches in the ~10-12 bases nearest the PAM abolish
  cutting, while PAM-distal mismatches are tolerated. That asymmetry is the
  actual mechanism behind off-target editing.
- Perfect guide matches with **no adjacent PAM**, which Cas9 will never cut.

## Credits

Made by Rachel Selbrede as a portfolio project. Feedback and pull requests welcome.

## Features

- **Classic Mode**: 30-second timed rounds with escalating difficulty
- **Zen Mode**: Endless practice mode for relaxation  
- **Leaderboard**: Track your top 10 scores with persistent browser storage
- **Visual Feedback**: Screen shake on perfect hits, particle burst effects, combo bonuses
- **Off-target penalty**: Cutting plain DNA resets your combo and jams the blades
  for a moment, so precision beats spraying clicks
- **Authentic CRISPR**: Accurate base pairing (A-T, G-C), antiparallel 5'/3'
  strands, a full `NGG` PAM immediately 3' of the target, and the blunt cut
  drawn 3 bp upstream of the PAM, where Cas9 really breaks the duplex
