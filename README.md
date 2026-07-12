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
- When the guide matches and a PAM sits right beside it, Cas9 makes a
  double-strand break just upstream of the PAM.

This game keeps those ideas and simplifies the rest:

- The DNA is drawn as base pairs, and the pairing is correct: A always sits
  across from T, and G always sits across from C.
- Every target has a `GG` **PAM** placed at its edge, and the cut fires at the
  target next to it, the way Cas9 really works.
- The target length and the 20-letter guide are shortened so the whole thing
  fits on one screen and stays fun.

## How it is built

| File | What it does |
|------|--------------|
| `index.html` | Page structure: scoreboard, the DNA stage, and the start / game-over screens |
| `style.css` | The fluorescence-imaging look, the scissors cursor, and all animations |
| `script.js` | Game logic: drawing the strand, spawning targets, scoring, and sound |

The JavaScript is organised into clear sections (config, state, the DNA strand,
the target loop, scoring, sound, helpers) and is commented throughout, so it is
easy to read and extend.

## Ideas for next versions

- A **guide RNA** you have to match: show a target sequence and only score cuts
  at the correct spot.
- **Off-target** sites that look similar but should not be cut, with a penalty
  for cutting them (this is a real CRISPR problem).
- Difficulty levels, a longer genome that scrolls, or a two-player mode.

## Credits

Made by Rachel Selbrede as a portfolio project. Feedback and pull requests welcome.
