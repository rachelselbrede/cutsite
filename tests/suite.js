/* ============================================================
   CutSite  -  test suite
   ------------------------------------------------------------
   This file is injected into a copy of the real index.html,
   immediately after script.js, so it runs in the game's own
   global scope and can reach its bindings (state, CONFIG,
   spawnTarget, ...) directly. Nothing is stubbed: every
   assertion below is made against the real DOM the game draws.

   Run it with:  python3 tests/run.py

   A few tests measure layout, and the web fonts change it, so the
   suite runs once the fonts have loaded (or failed to, offline):
   the numbers are then the ones a player sees, the same every run.
   ============================================================ */
function runCutSiteSuite() {
  "use strict";

  // ---------- tiny harness ----------
  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (err) { results.push({ name, ok: false, err: err.message }); }
    finally { try { clearTimers(); state.running = false; } catch (e) {} }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
  function eq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg || "values differ") + " -- expected " + expected + ", got " + actual);
    }
  }

  // ---------- helpers ----------
  const COMP = { A: "T", T: "A", G: "C", C: "G" };
  const cols = () => Array.from(document.querySelectorAll("#strand .col"));
  const topOf = (c) => c.querySelector(".base").textContent;
  const botOf = (c) => c.querySelectorAll(".base")[1].textContent;
  const composition = () => cols().map(topOf).sort().join("");
  const seqAt = (list, a, b) => list.slice(a, b + 1).map(topOf).join("");
  // A site read the way Cas9 reads it: 5' to 3' along the strand that carries
  // the PAM. Forward sites read the top strand left to right; reverse sites
  // read the bottom strand right to left. Computed here with plain column
  // arithmetic, on purpose, so a slip in the game's own helpers cannot hide.
  const site5to3 = (st) => {
    const c = cols(), out = [];
    if (st.reverse) for (let i = st.end; i >= st.start; i--) out.push(COMP[topOf(c[i])]);
    else for (let i = st.start; i <= st.end; i++) out.push(topOf(c[i]));
    return out.join("");
  };
  const pam5to3 = (st) => {
    const c = cols(), p = st.pamStart;
    return st.reverse
      ? COMP[topOf(c[p + 2])] + COMP[topOf(c[p + 1])] + COMP[topOf(c[p])]
      : topOf(c[p]) + topOf(c[p + 1]) + topOf(c[p + 2]);
  };
  const isNGG = (st) => /^.GG$/.test(pam5to3(st));
  const revcomp = (str) => str.split("").reverse().map((b) => COMP[b]).join("");
  const tag = (st) => (st.reverse ? " (reverse site)" : " (forward site)");

  // Start a round and freeze one target on screen, with no timers left
  // running to disturb the next assertion.
  function freeze(modeName, cuts) {
    clearTimers();
    state.gameMode = modeName;
    startGame();
    if (cuts !== undefined) state.cuts = cuts;
    state.lockedUntil = 0;
    clearTimeout(state.timers.spawn);
    clearTimeout(state.timers.expiry);
    spawnTarget();
    clearTimeout(state.timers.expiry);
    return state.activeTarget;
  }

  function click(col) {
    col.querySelector(".base").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  // Contiguous runs of decoy columns, with the kind each one carries.
  function decoyRuns() {
    const runs = [];
    cols().forEach((c, i) => {
      if (!c.classList.contains("decoy")) return;
      const last = runs[runs.length - 1];
      if (last && i === last.end + 1 && c.dataset.decoy === last.kind) last.end = i;
      else runs.push({ start: i, end: i, kind: c.dataset.decoy });
    });
    return runs;
  }

  function withWidth(px, fn) {
    Object.defineProperty(window, "innerWidth", { configurable: true, get: () => px });
    try { return fn(); } finally { delete window.innerWidth; }
  }

  localStorage.clear();

  // ============================================================
  // The strand itself
  // ============================================================
  test("strand: every column is a Watson-Crick pair", function () {
    buildStrand();
    cols().forEach(function (c, i) {
      eq(botOf(c), COMP[topOf(c)], "column " + i + " is not complementary");
    });
  });

  test("strand: only A, T, G and C are drawn", function () {
    buildStrand();
    cols().forEach(function (c, i) {
      assert("ATGC".includes(topOf(c)), "column " + i + " holds " + topOf(c));
    });
  });

  test("strand: narrow screens shorten it, wide screens do not", function () {
    withWidth(375, function () { eq(strandColumnCount(), 16, "phone width"); });
    withWidth(700, function () { eq(strandColumnCount(), 22, "tablet width"); });
    withWidth(1200, function () { eq(strandColumnCount(), CONFIG.strandLength, "desktop width"); });
  });

  test("strand: reading modes keep the full strand on a phone and wrap it into two rows", function () {
    ["guide", "daily"].forEach(function (m) {
      state.gameMode = m;
      withWidth(375, function () {
        eq(strandColumnCount(), CONFIG.strandLength, m + " should keep every column on a phone");
        assert(strandWraps(), m + " should wrap on a phone");
        buildStrand();
        const rows = Array.from(el.strand.querySelectorAll(".row"));
        eq(rows.length, 2, m + " should draw two rows");
        rows.forEach(function (r) { eq(r.querySelectorAll(".col").length, 15, "each row should hold half the strand"); });
        eq(cols().length, CONFIG.strandLength, "every column should still be there");
        cols().forEach(function (c, i) { eq(Number(c.dataset.index), i, "columns should keep strand order across the wrap"); });
      });
      withWidth(1200, function () {
        assert(!strandWraps(), m + " should not wrap on a desktop");
        buildStrand();
        eq(el.strand.querySelectorAll(".row").length, 1, "one row on a desktop");
      });
    });
    state.gameMode = "classic";
    withWidth(375, function () {
      assert(!strandWraps(), "classic keeps its short strand instead of wrapping");
      buildStrand();
      eq(el.strand.querySelectorAll(".row").length, 1, "one row of fatter columns");
    });
  });

  test("strand: the 5' and 3' marks sit at the true ends of each strand, wrapped or not", function () {
    const marks = function () {
      const rows = Array.from(el.strand.querySelectorAll(".row"));
      const first = rows[0], last = rows[rows.length - 1];
      const text = function (row, cls) { const s = row.querySelector("." + cls); return s ? s.textContent : ""; };
      return { rows: rows.length,
               tl: text(first, "polarity-tl"), tr: text(last, "polarity-tr"),
               bl: text(first, "polarity-bl"), br: text(last, "polarity-br"),
               strayTr: text(first, "polarity-tr"), strayBl: text(last, "polarity-bl") };
    };
    state.gameMode = "classic";
    withWidth(1200, function () { buildStrand(); });
    let m = marks();
    eq(m.rows, 1, "one row");
    eq(m.tl + m.tr, "5\u20323\u2032", "the top strand should run 5' to 3' left to right");
    eq(m.bl + m.br, "3\u20325\u2032", "and the bottom strand the other way");
    state.gameMode = "guide";
    withWidth(375, function () { buildStrand(); });
    m = marks();
    eq(m.rows, 2, "two rows");
    eq(m.tl + m.tr, "5\u20323\u2032", "wrapped, the top strand should still start on the first row and end on the last");
    eq(m.bl + m.br, "3\u20325\u2032", "and so should the bottom strand, the other way");
    eq(m.strayTr + m.strayBl, "", "the wrap itself is not an end, so it should carry no mark");
    state.gameMode = "classic";
  });

  test("guide mode: the two-decoy tier fits on a phone", function () {
    withWidth(375, function () {
      freeze("guide", 20);
      let two = 0;
      for (let n = 0; n < 60; n++) {
        if (state.activeTarget.decoys.length === 2) two++;
        clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
      }
      assert(two > 0, "a phone's strand should have room for two decoys beside the target");
    });
  });

  // ============================================================
  // The target: PAM, cut site, guide
  // ============================================================
  test("target: the PAM is always NGG, read along the site's own strand", function () {
    freeze("classic");
    const seen = { fwd: 0, rev: 0 };
    for (let n = 0; n < 200; n++) {
      const t = state.activeTarget;
      assert(isNGG(t), "PAM read 5' to 3' on its strand should be NGG, got " + pam5to3(t) + tag(t));
      if (t.reverse) seen.rev++; else seen.fwd++;
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(seen.fwd > 20 && seen.rev > 20, "both orientations should turn up in classic: " + JSON.stringify(seen));
  });

  test("target: the protospacer and its PAM stay on the strand, whichever way the site faces", function () {
    freeze("classic");
    for (let n = 0; n < 200; n++) {
      const t = state.activeTarget, last = cols().length - 1;
      assert(t.start >= 0 && t.end <= last, "protospacer off the strand" + tag(t));
      assert(t.pamStart >= 0 && t.pamStart + CONFIG.pamLength - 1 <= last, "PAM off the strand" + tag(t));
      if (t.reverse) eq(t.pamStart + CONFIG.pamLength, t.start, "a reverse PAM should sit immediately left of its protospacer");
      else eq(t.pamStart, t.end + 1, "a forward PAM should sit immediately right of its protospacer");
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
  });

  test("target: the cut site sits 3 bp upstream of the PAM, on the PAM's side", function () {
    freeze("classic");
    for (let n = 0; n < 200; n++) {
      const t = state.activeTarget;
      const expected = t.reverse ? t.start + CONFIG.cutOffsetFromPam : t.end - CONFIG.cutOffsetFromPam + 1;
      eq(t.breakIndex, expected, "break index" + tag(t));
      const marked = cols().findIndex(function (c) { return c.classList.contains("cut-site"); });
      eq(marked, t.breakIndex, "the drawn line and the recorded break disagree" + tag(t));
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
  });

  test("target: the guide matches the protospacer read along its own strand", function () {
    freeze("classic");
    let rev = 0;
    for (let n = 0; n < 200; n++) {
      const t = state.activeTarget;
      eq(site5to3(t), t.guide.join(""), "guide vs protospacer" + tag(t));
      if (t.reverse) {
        rev++;
        eq(t.guide.join(""), revcomp(seqAt(cols(), t.start, t.end)),
           "a reverse site's guide should be the reverse complement of what the top strand shows");
        eq(seqAt(cols(), t.pamStart, t.pamStart + 1), "CC", "a reverse PAM should show as CCN on the top strand");
      }
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(rev > 0, "no reverse sites in 200 spawns");
  });

  test("target: a reverse site's picture is right: PAM left as CCN, glow on the bottom strand, cut on the PAM's side", function () {
    let t = null, tries = 0;
    while ((!t || !t.reverse) && tries++ < 80) t = freeze("classic");
    assert(t && t.reverse, "never spawned a reverse site");
    const c = cols();
    assert(t.pamStart + CONFIG.pamLength === t.start, "the PAM should sit immediately left of the protospacer");
    eq(topOf(c[t.pamStart]) + topOf(c[t.pamStart + 1]), "CC", "the top strand should show CC where the bottom strand has GG");
    for (let i = t.start; i <= t.end; i++) {
      assert(c[i].classList.contains("on-bottom"), "protospacer columns should be marked as bottom-strand");
      assert(!c[i].classList.contains("on-top"), "and not as top-strand");
    }
    assert(c[t.pamStart + 1].classList.contains("pam-label"), "the PAM label should sit under the middle PAM column");
    eq(t.breakIndex, t.start + CONFIG.cutOffsetFromPam, "three bases between the PAM and the break, on the PAM's side");
  });

  test("guide mode: reverse sites wait for the gate, then turn up on target and decoys alike", function () {
    freeze("guide", 11);
    for (let n = 0; n < 60; n++) {
      const t = state.activeTarget;
      assert(!t.reverse && !t.decoys.some(function (d) { return d.reverse; }),
             "no reverse site should appear before the gate");
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    freeze("guide", 20);
    let revTargets = 0, revDecoys = 0, mixed = 0;
    for (let n = 0; n < 150; n++) {
      const t = state.activeTarget;
      if (t.reverse) revTargets++;
      const dr = t.decoys.filter(function (d) { return d.reverse; }).length;
      revDecoys += dr;
      if (dr > 0 && dr < t.decoys.length) mixed++;
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(revTargets > 20, "reverse targets should be common past the gate: " + revTargets);
    assert(revDecoys > 20, "and so should reverse decoys: " + revDecoys);
    assert(mixed > 0, "sites in one spawn should be free to face different ways");
  });

  test("a11y: labels say which strand a fluorescing site is on", function () {
    let t = null, tries = 0;
    while ((!t || !t.reverse) && tries++ < 80) t = freeze("classic");
    assert(t && t.reverse, "never spawned a reverse site");
    assert(/fluorescing on the bottom strand/.test(cols()[t.start].getAttribute("aria-label")),
           "a reverse site should say bottom strand");
    tries = 0;
    while ((!t || t.reverse) && tries++ < 80) t = freeze("classic");
    assert(t && !t.reverse, "never spawned a forward site");
    assert(/fluorescing on the top strand/.test(cols()[t.start].getAttribute("aria-label")),
           "a forward site should say top strand");
  });

  test("guide readout: names the strand and reading direction for a single target, never with decoys", function () {
    let t = null, tries = 0;
    while ((!t || !t.reverse) && tries++ < 80) t = freeze("classic");
    assert(/bottom strand/.test(el.guideStrand.textContent) && /right to left/.test(el.guideStrand.textContent),
           "reverse tag: " + el.guideStrand.textContent);
    tries = 0;
    while ((!t || t.reverse) && tries++ < 80) t = freeze("classic");
    assert(/top strand/.test(el.guideStrand.textContent) && /left to right/.test(el.guideStrand.textContent),
           "forward tag: " + el.guideStrand.textContent);
    freeze("guide", 20);
    eq(el.guideStrand.textContent, "", "with decoys on screen the tag would narrow the field, so it stays blank");
    clearTarget();
    eq(el.guideStrand.textContent, "", "and it clears with the target");
  });

  test("target: clearing it restores the strand exactly", function () {
    ["classic", "guide"].forEach(function (m) {
      freeze(m, 10);
      clearTarget();
      const before = composition();
      for (let n = 0; n < 300; n++) {
        spawnTarget();
        clearTimeout(state.timers.expiry);
        clearTarget();
      }
      eq(composition(), before, m + " mode drifted the strand's base composition");
    });
  });

  // ============================================================
  // The guide RNA readout
  // ============================================================
  test("guide readout: written as RNA, with U and never T", function () {
    for (let n = 0; n < 60; n++) {
      freeze("classic");
      const shown = el.guideSeq.textContent;
      assert(!shown.includes("T"), "the readout shows T, but RNA carries U: " + shown);
      eq(shown, state.activeTarget.guide.map(function (b) { return b === "T" ? "U" : b; }).join(""),
         "readout does not match the loaded guide");
    }
  });

  test("guide readout: clears with its target", function () {
    freeze("classic");
    assert(el.guideSeq.textContent !== "—", "readout should be populated while a target is live");
    clearTarget();
    eq(el.guideSeq.textContent, "—", "readout should clear when the target does");
  });

  // ============================================================
  // Guide RNA mode: the decoys
  // ============================================================
  test("guide mode: no-PAM decoys match the guide but never carry an NGG", function () {
    freeze("guide", 20);
    let seen = 0, rev = 0;
    for (let n = 0; n < 150; n++) {
      const t = state.activeTarget;
      t.decoys.filter(function (d) { return d.kind === "nopam"; }).forEach(function (d) {
        seen++; if (d.reverse) rev++;
        eq(site5to3(d), t.guide.join(""), "a no-PAM decoy should match the guide in its own orientation" + tag(d));
        assert(!isNGG(d), "a no-PAM decoy carried a real NGG (" + pam5to3(d) + "), making it genuinely cuttable" + tag(d));
      });
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(seen > 0, "no no-PAM decoys were generated at all");
    assert(rev > 0, "no reverse no-PAM decoys in 150 spawns");
  });

  test("guide mode: seed decoys keep an intact PAM and differ by one base beside it", function () {
    freeze("guide", 20);
    let seen = 0, rev = 0;
    for (let n = 0; n < 150; n++) {
      const t = state.activeTarget;
      t.decoys.filter(function (d) { return d.kind === "seed"; }).forEach(function (d) {
        seen++; if (d.reverse) rev++;
        assert(isNGG(d), "a seed decoy should keep a real NGG, so the PAM is not the reason it fails" + tag(d));
        const seq = site5to3(d).split("");
        const diffs = seq.map(function (b, j) { return b === t.guide[j] ? -1 : j; })
                         .filter(function (j) { return j >= 0; });
        eq(diffs.length, 1, "a seed decoy should differ from the guide by exactly one base" + tag(d));
        assert(diffs[0] >= CONFIG.targetLength - 2,
               "the mismatch should sit at the 3' end, beside the PAM, not at position " + diffs[0] + tag(d));
      });
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(seen > 0, "no seed decoys were generated at all");
    assert(rev > 0, "no reverse seed decoys in 150 spawns");
  });

  test("guide mode: distal decoys keep an intact PAM and differ by one base far from it", function () {
    freeze("guide", 20);
    let seen = 0, rev = 0;
    for (let n = 0; n < 150; n++) {
      const t = state.activeTarget;
      t.decoys.filter(function (d) { return d.kind === "distal"; }).forEach(function (d) {
        seen++; if (d.reverse) rev++;
        assert(isNGG(d), "a distal decoy should keep a real NGG: Cas9 has to be willing to cut it" + tag(d));
        const seq = site5to3(d).split("");
        const diffs = seq.map(function (b, j) { return b === t.guide[j] ? -1 : j; })
                         .filter(function (j) { return j >= 0; });
        eq(diffs.length, 1, "a distal decoy should differ from the guide by exactly one base" + tag(d));
        assert(diffs[0] <= 1, "the mismatch should sit at the 5' end, far from the PAM, not at position " + diffs[0] + tag(d));
      });
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(seen > 0, "no distal decoys were generated at all");
    assert(rev > 0, "no reverse distal decoys in 150 spawns");
  });

  test("guide mode: all three decoy kinds turn up, and never twice in one spawn", function () {
    freeze("guide", 10);
    const seenKinds = {};
    for (let n = 0; n < 150; n++) {
      const kinds = decoyRuns().map(function (r) { return r.kind; });
      kinds.forEach(function (k) { seenKinds[k] = true; });
      eq(new Set(kinds).size, kinds.length, "a spawn repeated a decoy kind");
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    ["nopam", "seed", "distal"].forEach(function (k) {
      assert(seenKinds[k], "never saw a " + k + " decoy in 150 spawns");
    });
  });

  test("guide mode: distal decoys wait until the player has a few cuts", function () {
    freeze("guide", 0);
    for (let n = 0; n < 80; n++) {
      assert(!decoyRuns().some(function (r) { return r.kind === "distal"; }),
             "a distal decoy appeared before the player had any cuts");
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
  });

  test("guide mode: a spawn that asks for two decoys always gets two, and every window fits the strand", function () {
    freeze("guide", 20);
    const last = cols().length - 1;
    const seenLeft = {};
    for (let n = 0; n < 300; n++) {
      const t = state.activeTarget;
      eq(t.decoys.length, 2, "spawn " + n + " should carry two decoys");
      [t].concat(t.decoys).forEach(function (s) {
        const lo = Math.min(s.start, s.pamStart), hi = Math.max(s.end, s.pamStart + CONFIG.pamLength - 1);
        assert(lo >= 0 && hi <= last, "a site ran off the strand: " + lo + ".." + hi);
      });
      // and the real target is not always the leftmost site
      const leftmost = Math.min.apply(null, [t.start].concat(t.decoys.map(function (d) { return d.start; })));
      seenLeft[leftmost === t.start ? "target" : "decoy"] = true;
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(seenLeft.target && seenLeft.decoy, "the target should sometimes be the leftmost site and sometimes not");
  });

  test("daily: targets five to twelve all carry two decoys", function () {
    state.dailyDate = "2026-09-10";
    freeze("daily");
    const counts = [];
    for (let n = 0; n < 12; n++) {
      if (n) { clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry); }
      counts.push(state.activeTarget.decoys.length);
    }
    state.dailyDate = null;
    eq(counts.join(""), "111122222222", "decoys per target");
  });

  test("guide mode: sites never overlap and keep a readable gap", function () {
    freeze("guide", 10);
    for (let n = 0; n < 150; n++) {
      const runs = [];
      cols().forEach(function (c, i) {
        const lit = c.classList.contains("candidate") || c.classList.contains("pam");
        if (!lit) return;
        const last = runs[runs.length - 1];
        if (last && i === last.end + 1) last.end = i; else runs.push({ start: i, end: i });
      });
      for (let k = 1; k < runs.length; k++) {
        assert(runs[k].start - runs[k - 1].end - 1 >= 2,
               "two sites came within one column of each other");
      }
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
  });

  test("classic and zen spawn no decoys", function () {
    ["classic", "zen"].forEach(function (m) {
      freeze(m, 10);
      for (let n = 0; n < 40; n++) {
        eq(document.querySelectorAll(".decoy").length, 0, m + " mode spawned a decoy");
        clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
      }
    });
  });

  // ============================================================
  // Modes
  // ============================================================
  test("modes: each one uses its own round length and window", function () {
    eq(MODES.classic.roundSeconds, 30, "classic round length");
    eq(MODES.guide.roundSeconds, 45, "guide round length");
    eq(MODES.zen.timed, false, "zen should be untimed");
    state.gameMode = "guide"; state.cuts = 0;
    eq(currentWindow(), MODES.guide.windowStart, "guide should open with its own window");
    state.gameMode = "classic";
    eq(currentWindow(), MODES.classic.windowStart, "classic should open with its own window");
  });

  test("difficulty: classic reaches its floor at the ramp and stays there", function () {
    state.gameMode = "classic";
    state.cuts = 0;   eq(currentWindow(), MODES.classic.windowStart, "opening window");
    state.cuts = 25;  eq(currentWindow(), MODES.classic.windowMin, "at the end of the ramp");
    state.cuts = 200; eq(currentWindow(), MODES.classic.windowMin,
                         "classic must not change past the ramp: its leaderboard depends on it");
    eq(getDifficultyLevel(), 100, "classic shows 100% once the ramp is done");
  });

  test("difficulty: zen keeps tightening past the ramp, toward a floor it never breaks", function () {
    state.gameMode = "zen";
    state.cuts = 25;  const atRamp = currentWindow();
    eq(atRamp, MODES.zen.windowMin, "zen matches classic up to the end of the ramp");
    let prev = atRamp;
    for (let c = 26; c <= 400; c++) {
      state.cuts = c;
      const w = currentWindow();
      assert(w <= prev, "the window widened again at cut " + c);
      assert(w >= MODES.zen.windowFloor, "the window fell through its floor at cut " + c);
      prev = w;
    }
    state.cuts = 100;
    assert(currentWindow() < atRamp - 100, "a hundred cuts in, zen should be clearly tighter than the ramp's end");
    state.cuts = 100000;
    eq(currentWindow(), MODES.zen.windowFloor, "the squeeze converges on the floor");
  });

  test("difficulty: the HUD percentage keeps climbing in zen past the old cap", function () {
    state.gameMode = "zen";
    const at = function (c) { state.cuts = c; return getDifficultyLevel(); };
    assert(at(25) < 100, "zen is not done at 25 cuts any more");
    assert(at(25) < at(60), "60 cuts should read harder than 25");
    assert(at(60) < at(200), "200 cuts should read harder than 60");
    assert(at(200) <= 100, "and it never reads past 100%");
  });

  test("difficulty: the readout describes the target on screen, and moves in the Daily without a hit", function () {
    state.dailyDate = "2026-09-10";
    freeze("daily");
    eq(el.difficulty.textContent, "0%", "the first target opens at the widest window");
    for (let n = 1; n < 12; n++) { onExpire(); clearTimeout(state.timers.spawn); spawnTarget(); clearTimeout(state.timers.expiry); }
    state.dailyDate = null;
    const t = state.activeTarget;
    eq(el.difficulty.textContent, difficultyPercent(t.window) + "%", "the readout should match the live target's window");
    assert(parseInt(el.difficulty.textContent, 10) > 50,
           "eleven misses in, the twelfth target should read well past halfway: " + el.difficulty.textContent);
    eq(el.difficulty.getAttribute("data-level"), "high", "and colour accordingly");
    freeze("classic");
    eq(el.difficulty.textContent, "0%", "classic opens at 0%");
  });

  test("difficulty: guide mode is a reading mode and does not squeeze", function () {
    state.gameMode = "guide";
    state.cuts = 300;
    eq(currentWindow(), MODES.guide.windowMin, "guide should stop at its windowMin");
    state.gameMode = "classic";
  });

  test("modes: zen hides the clock and renders a stop button", function () {
    freeze("zen");
    assert(el.time.closest(".stat").classList.contains("hidden"), "zen should hide the whole time stat");
    // offsetParent is null for anything display:none, including via an
    // ancestor - which is how a stop button inside the hidden overlay once
    // passed a class-only check while never appearing on screen.
    assert(el.stopBtn.offsetParent !== null, "zen's stop button must actually render");
    freeze("classic");
    assert(!el.time.closest(".stat").classList.contains("hidden"), "classic should show the clock");
    assert(el.stopBtn.offsetParent === null, "classic should not render a stop button");
  });

  test("modes: the stop button and Escape both end a zen round, Escape never a timed one", function () {
    freeze("zen");
    el.stopBtn.click();
    assert(!state.running, "the stop button should end the round");
    freeze("zen");
    key("Escape");
    assert(!state.running, "Escape should end an untimed round");
    freeze("classic");
    key("Escape");
    assert(state.running, "Escape must not forfeit a timed round");
  });

  // ============================================================
  // Scoring
  // ============================================================
  test("scoring: a clean cut scores and builds the combo", function () {
    const t = freeze("classic");
    const before = state.combo;
    click(cols()[t.start]);
    eq(state.cuts, 1, "cut count");
    assert(state.score > 0, "a hit should score");
    eq(state.combo, before + 1, "combo should climb");
    eq(state.offTargets, 0, "a clean cut is not an off-target");
  });

  test("scoring: the milestone bonus pays on reaching 5 and 10, never on every capped hit", function () {
    // Back-date every spawn by the same amount so the speed bonus is constant
    // and the only variable is the combo.
    const gainedFrom = function (combo) {
      const t = freeze("classic");
      state.combo = combo;
      t.spawnedAt = performance.now() - 600;
      const before = state.score;
      click(cols()[t.start]);
      return state.score - before;
    };
    const unit = gainedFrom(2) / 2;                 // 2 -> 3: no milestone
    eq(gainedFrom(4), unit * 4 + 500, "the cut that lifts the combo to 5 pays the bonus");
    eq(gainedFrom(5), unit * 5, "the next cut does not");
    eq(gainedFrom(9), unit * 9 + 500, "reaching 10 pays it again");
    eq(gainedFrom(10), unit * 10, "sitting at the cap must not pay it on every hit");
    eq(gainedFrom(10), unit * 10, "...or the one after");
  });

  test("achievements: Speed Demon needs a genuinely fast cut, not a big score", function () {
    localStorage.clear();
    let t = freeze("classic");
    state.combo = 5;                                 // lots of points, but slow
    t.spawnedAt = performance.now() - 600;
    click(cols()[t.start]);
    assert(!state.earnedAchievements.includes("speedDemon"),
           "a slow cut must not count however many points it scores");
    t = freeze("classic");
    t.spawnedAt = performance.now() - 100;           // a quick one
    click(cols()[t.start]);
    assert(state.earnedAchievements.includes("speedDemon"), "a cut within a quarter second should count");
  });

  test("off-target: cutting the PAM itself says where Cas9 really cuts", function () {
    const t = freeze("classic");
    click(cols()[t.pamStart + 1]);
    assert(/never inside/.test(el.status.textContent), "should say the cut is upstream, got: " + el.status.textContent);
    eq(state.offTargets, 1, "it is still an off-target cut");
  });

  test("scoring: the combo is capped", function () {
    const t = freeze("classic");
    state.combo = CONFIG.comboCap;
    click(cols()[t.start]);
    eq(state.combo, CONFIG.comboCap, "combo climbed past its cap");
  });

  test("scoring: a missed target resets the combo and counts a miss", function () {
    freeze("classic");
    state.combo = 5;
    onExpire();
    eq(state.combo, 1, "combo should reset");
    eq(state.misses, 1, "miss count");
  });

  // ============================================================
  // Off-target cutting
  // ============================================================
  test("off-target: cutting plain DNA costs the combo and jams the blades", function () {
    const t = freeze("classic");
    state.combo = 4;
    const plain = cols().findIndex(function (c, i) {
      return !c.classList.contains("candidate") && !c.classList.contains("pam");
    });
    click(cols()[plain]);
    eq(state.combo, 1, "combo should reset");
    eq(state.offTargets, 1, "off-target count");
    assert(state.lockedUntil > performance.now(), "the blades should be jammed");
  });

  test("off-target: cutting a decoy explains why it was not cuttable", function () {
    let checked = 0;
    for (let n = 0; n < 40 && checked < 2; n++) {
      freeze("guide", 10);
      const runs = decoyRuns();
      if (!runs.length) continue;
      const run = runs[0];
      state.lockedUntil = 0;
      click(cols()[run.start]);
      eq(el.status.textContent, DECOY_MESSAGES[run.kind], "wrong explanation for a " + run.kind + " decoy");
      checked++;
    }
    assert(checked > 0, "never managed to cut a decoy");
  });

  test("off-target: a tolerated site really cuts, then costs you, and never jams", function () {
    let run = null, tries = 0;
    while (!run && tries++ < 60) {
      freeze("guide", 10);
      run = decoyRuns().find(function (r) { return r.kind === "distal"; }) || null;
    }
    assert(run, "never spawned a distal decoy to cut");
    state.combo = 5;
    const lockBefore = state.lockedUntil;
    const cutsBefore = state.cuts, scoreBefore = state.score;
    click(cols()[run.start]);
    eq(state.offTargets, 1, "a tolerated cut is still an off-target edit");
    eq(state.misses, 1, "and still a miss");
    eq(state.combo, 1, "the combo should be gone");
    eq(state.cuts, cutsBefore, "it must not count as a cut");
    eq(state.score, scoreBefore, "it must not score");
    eq(state.lockedUntil, lockBefore, "Cas9 did not refuse, so the blades must not jam");
    eq(state.activeTarget, null, "the round's target is spent: the wrong site got edited");
    eq(el.status.textContent, DECOY_MESSAGES.distal, "the status should say Cas9 cut it anyway");
    assert(cols()[run.start].classList.contains("cut"), "the site should show the cut flash");
    clearTimeout(state.timers.spawn);
  });

  test("off-target: clicks are ignored while the blades are jammed", function () {
    const t = freeze("classic");
    state.lockedUntil = performance.now() + 5000;
    const score = state.score, cuts = state.cuts;
    click(cols()[t.start]);
    eq(state.score, score, "a jammed blade should not score");
    eq(state.cuts, cuts, "a jammed blade should not cut");
  });

  // ============================================================
  // Storage
  // ============================================================
  test("storage: each mode keeps its own leaderboard", function () {
    localStorage.clear();
    saveScore(500, "classic");
    saveScore(900, "zen");
    saveScore(700, "guide");
    eq(getBestScore("classic"), 500, "classic best");
    eq(getBestScore("zen"), 900, "zen best");
    eq(getBestScore("guide"), 700, "guide best");
  });

  test("storage: the board holds ten scores, highest first", function () {
    localStorage.clear();
    for (let i = 1; i <= 15; i++) saveScore(i * 100, "classic");
    const board = loadScores("classic");
    eq(board.length, 10, "board length");
    eq(board[0].score, 1500, "highest score first");
    for (let i = 1; i < board.length; i++) {
      assert(board[i - 1].score >= board[i].score, "board is not sorted descending");
    }
  });

  test("storage: pre-Zen scores migrate into the classic board", function () {
    localStorage.clear();
    localStorage.setItem("cutsite-scores", JSON.stringify([300, 100]));
    localStorage.setItem("cutsite-best", "900");
    const board = loadScores("classic");
    eq(board[0].score, 900, "the old best should survive migration");
    const has = function (n) { return board.some(function (e) { return e.score === n; }); };
    assert(has(300) && has(100), "old scores should survive migration");
    eq(localStorage.getItem("cutsite-best"), null, "the legacy key should be cleared");
    eq(localStorage.getItem("cutsite-scores"), null, "the legacy key should be cleared");
  });

  test("storage: an entry keeps the round's accuracy, cuts and date", function () {
    localStorage.clear();
    saveScore({ score: 300, cuts: 5, accuracy: 80, maxCombo: 3, offTargets: 1,
                date: "2026-09-01T12:00:00.000Z" }, "classic");
    saveScore({ score: 900, cuts: 12, accuracy: 95, maxCombo: 7, offTargets: 0,
                date: "2026-09-02T12:00:00.000Z" }, "classic");
    const board = loadScores("classic");
    eq(board[0].score, 900, "highest first");
    eq(board[0].accuracy, 95, "accuracy kept");
    eq(board[0].cuts, 12, "cuts kept");
    eq(board[0].maxCombo, 7, "best combo kept");
    eq(board[0].date, "2026-09-02T12:00:00.000Z", "date kept");
    eq(getBestScore("classic"), 900, "the best score is still a plain number");
  });

  test("storage: an old board of bare numbers is upgraded in place", function () {
    localStorage.clear();
    localStorage.setItem(scoresKey("classic"), JSON.stringify([500, 200, 800]));
    const board = loadScores("classic");
    eq(board.length, 3, "nothing lost");
    eq(board[0].score, 800, "still sorted, highest first");
    eq(typeof board[1], "object", "entries are objects now");
    const stored = JSON.parse(localStorage.getItem(scoresKey("classic")));
    eq(typeof stored[0], "object", "the upgrade should be written back");
    eq(getBestScore("classic"), 800, "the best score survives the upgrade");
  });

  test("storage: a round that scored nothing stays off the board, which says so", function () {
    localStorage.clear();
    freeze("zen");
    endGame();
    eq(loadScores("zen").length, 0, "a Zen run stopped at once must not file a 0");
    assert(!el.leaderboard.querySelector("li"), "no rows to show");
    assert(/No scores yet/.test(el.leaderboard.textContent), "an empty board should say so");
    assert(!/personal best/.test(el.endTitle.textContent), "and nothing scored is not a personal best");
    const t = freeze("classic");
    click(cols()[t.start]);
    endGame();
    eq(loadScores("classic").length, 1, "a round that scored still goes on the board");
    eq(el.leaderboard.querySelectorAll("li.you").length, 1, "and is marked as yours");
  });

  test("end card: this round's row is highlighted, with its accuracy and date", function () {
    localStorage.clear();
    saveScore({ score: 99999, cuts: 40, accuracy: 100, date: "2026-01-01T00:00:00.000Z" }, "classic");
    const t = freeze("classic");
    click(cols()[t.start]);
    endGame();
    const rows = Array.from(el.leaderboard.querySelectorAll("li"));
    eq(rows.length, 2, "two rows on the board");
    const you = el.leaderboard.querySelectorAll("li.you");
    eq(you.length, 1, "exactly one row is yours");
    assert(rows[1] === you[0], "your row should rank below the older, higher score");
    assert(/100%/.test(you[0].textContent), "your row should show this round's accuracy");
    assert(you[0].textContent.indexOf(formatEntryDate(new Date().toISOString())) >= 0,
           "your row should carry today's date");
    assert(/\b1 cut\b/.test(you[0].getAttribute("title")), "the tooltip should carry the cut count");
    assert(!/\byou\b/.test(rows[0].className), "the older row must not be marked as yours");
  });

  test("storage: unlocked achievements persist", function () {
    localStorage.clear();
    unlockAchievement("firstBlood");
    assert(loadUnlockedAchievements().includes("firstBlood"), "achievement did not persist");
    unlockAchievement("firstBlood");
    eq(loadUnlockedAchievements().filter(function (id) { return id === "firstBlood"; }).length, 1,
       "achievement was stored twice");
  });

  test("end card: every achievement is listed, locked ones with how to earn them", function () {
    localStorage.clear();
    const t = freeze("classic");
    t.spawnedAt = performance.now() - 600;   // unhurried, so only First Blood unlocks
    click(cols()[t.start]);
    endGame();
    const ids = Object.keys(ACHIEVEMENTS);
    const tiles = Array.from(el.cardEnd.querySelectorAll(".achievement"));
    eq(tiles.length, ids.length, "one tile per achievement");
    const fresh = tiles.filter(function (x) { return x.classList.contains("new"); });
    eq(fresh.length, 1, "exactly one tile is new");
    assert(/First Blood/.test(fresh[0].textContent), "the new tile is First Blood");
    assert(fresh[0].querySelector(".achievement-new"), "the new tile carries a NEW badge");
    const locked = tiles.filter(function (x) { return x.classList.contains("locked"); });
    eq(locked.length, ids.length - 1, "every other tile is locked");
    locked.forEach(function (x) {
      const id = ids.find(function (k) { return x.textContent.indexOf(ACHIEVEMENTS[k].name) >= 0; });
      assert(id, "a locked tile should name its achievement");
      assert(x.textContent.indexOf(ACHIEVEMENTS[id].desc) >= 0, "a locked tile should say how to earn it: " + id);
      assert(/Locked:/.test(x.textContent), "a locked tile should say so to screen readers");
    });
    assert(/1 \/ 6/.test(el.cardEnd.querySelector(".achievement-progress").textContent), "progress should read 1 / 6");
  });

  test("end card: an achievement from an earlier round shows unlocked, not new", function () {
    localStorage.clear();
    persistAchievement("firstBlood");
    const t = freeze("classic");
    t.spawnedAt = performance.now() - 600;   // unhurried, so nothing new unlocks
    click(cols()[t.start]);
    endGame();
    const tiles = Array.from(el.cardEnd.querySelectorAll(".achievement"));
    eq(tiles.filter(function (x) { return x.classList.contains("new"); }).length, 0, "nothing should be new");
    const fb = tiles.find(function (x) { return /First Blood/.test(x.textContent); });
    assert(fb.classList.contains("unlocked"), "First Blood should show as unlocked");
    assert(!fb.querySelector(".achievement-new"), "and carry no NEW badge");
    assert(/Unlocked:/.test(fb.textContent), "and say so to screen readers");
  });

  test("achievements: the first cut of a round unlocks First Blood", function () {
    localStorage.clear();
    const t = freeze("classic");
    click(cols()[t.start]);
    assert(state.earnedAchievements.includes("firstBlood"), "First Blood was not awarded");
  });

  // ============================================================
  // The overlay cards
  // ============================================================
  // The start card once grew past the stage as features were described on
  // it, which put the mode picker and the Start button below the fold with
  // nothing to say the overlay scrolled. The overlay is no longer a scroll
  // region at all: a card taller than the play area grows the stage. So on
  // a desktop, which is what the headless window is, both cards must fit
  // the stage at its resting height.
  function showCard(card) {
    el.overlay.classList.remove("hidden");
    el.cardStart.classList.toggle("hidden", card !== el.cardStart);
    el.cardEnd.classList.toggle("hidden", card !== el.cardEnd);
  }
  function overlayFits(what) {
    const rest = parseFloat(getComputedStyle(el.stage).minHeight);
    const height = el.stage.getBoundingClientRect().height;
    assert(height <= rest + 0.5, what + " should fit the stage at its resting height: the stage grew to " +
           Math.round(height) + "px from " + rest + "px");
    assert(getComputedStyle(el.overlay).overflowY !== "auto" && getComputedStyle(el.overlay).overflowY !== "scroll",
           "the overlay must not be a scroll region of its own");
  }

  test("start card: the rules start folded and Start sits inside the stage", function () {
    showCard(el.cardStart);
    const howto = el.cardStart.querySelector("details");
    assert(howto, "the start card should fold its rules into a details element");
    assert(!howto.open, "the rules should start folded");
    overlayFits("the start card");
    const start = el.startBtn.getBoundingClientRect(), stage = el.stage.getBoundingClientRect();
    assert(start.top >= stage.top && start.bottom <= stage.bottom, "the Start button should be in view inside the stage");
    document.querySelectorAll(".mode-btn").forEach(function (b) {
      const r = b.getBoundingClientRect();
      assert(r.top >= stage.top && r.bottom <= stage.bottom, "every mode button should be in view: " + b.textContent);
    });
  });

  test("end card: the achievements fold on a phone unless the round unlocked something", function () {
    localStorage.clear();
    const fold = function () { return el.achievements.querySelector("details"); };
    withWidth(375, function () {
      renderAchievements([]);
      assert(fold() && !fold().open, "nothing new on a phone: the panel starts folded");
      renderAchievements(["firstBlood"]);
      assert(fold().open, "something new on a phone: the panel starts open");
      assert(/1 new/.test(el.achievements.querySelector(".achievement-progress").textContent), "and the summary says how many");
    });
    withWidth(1200, function () {
      renderAchievements([]);
      assert(fold().open, "a desktop has the room, so the panel starts open");
    });
    assert(/0 \/ 6/.test(el.achievements.querySelector(".achievement-progress").textContent), "the summary carries the count");
  });

  test("end card: fits the stage with a full board and every achievement", function () {
    localStorage.clear();
    for (let i = 1; i <= 10; i++) {
      saveScore({ score: i * 1000, cuts: 10 + i, accuracy: 80 + i, maxCombo: i, offTargets: 10 - i,
                  date: "2026-09-" + String(i).padStart(2, "0") + "T12:00:00.000Z" }, "classic");
    }
    Object.keys(ACHIEVEMENTS).forEach(persistAchievement);
    freeze("classic");
    endGame();
    overlayFits("the end card");
    const again = el.againBtn.getBoundingClientRect(), stage = el.stage.getBoundingClientRect();
    assert(again.top >= stage.top && again.bottom <= stage.bottom, "Edit again should be in view inside the stage");
  });

  // ============================================================
  // The daily challenge
  // ============================================================
  // Play a pinned day's daily far enough to read its first `targets` targets.
  function dailyRun(day, targets) {
    state.dailyDate = day;
    freeze("daily");
    const strand = cols().map(topOf).join("");
    const sites = [];
    for (let n = 0; n < targets; n++) {
      const t = state.activeTarget;
      sites.push([t.start, t.end, t.reverse ? "r" : "f", t.pamStart, t.guide.join(""),
        t.decoys.map(function (d) { return d.kind + (d.reverse ? "r" : "f") + d.start + ":" + site5to3(d); }).join("|"),
      ].join(","));
      clearTarget();
      if (n < targets - 1) { spawnTarget(); clearTimeout(state.timers.expiry); }
    }
    state.dailyDate = null;
    return { strand: strand, sites: sites };
  }

  test("daily: the card lists your days newest first, marks the one just played, and counts the streak", function () {
    localStorage.clear();
    const today = todayKey();
    const day = function (n) { return shiftDay(today, -n); };
    const rec = function (key, cuts, replay) {
      const outcomes = []; for (let i = 0; i < 12; i++) outcomes.push(i < cuts ? "hit" : "miss");
      return { number: dailyNumberFor(key), date: key, score: cuts * 100, cuts: cuts, total: 12,
               accuracy: Math.round((cuts / 12) * 100), outcomes: outcomes, replay: !!replay };
    };
    saveDailyRecord(day(1), rec(day(1), 5));
    saveDailyRecord(day(2), rec(day(2), 7));
    saveDailyRecord(day(4), rec(day(4), 12));          // a gap at day 3
    eq(dailyStreak(today), 2, "yesterday and the day before, with today still to come");
    saveDailyRecord(today, rec(today, 9));
    eq(dailyStreak(today), 3, "today joins it");
    saveDailyRecord(day(3), rec(day(3), 1, true));     // the missed day, replayed later
    eq(dailyStreak(today), 3, "a replay does not mend the gap");
    eq(loadDailyHistory().map(function (r) { return r.date; }).join(","),
       [today, day(1), day(2), day(3), day(4)].join(","), "newest first");
    state.dailyDate = null;
    renderDailyHistory();
    const rows = Array.from(el.leaderboard.querySelectorAll("li"));
    eq(rows.length, 5, "one row per finished day");
    assert(rows[0].classList.contains("you"), "today's row is the one just played");
    assert(rows[3].classList.contains("replay"), "a replayed day is marked as such");
    eq((rows[0].textContent.match(/\u2702/g) || []).length, 9, "the marks carry the day's cuts");
    assert(/3-day streak/.test(el.leaderboard.textContent), "the streak is shown: " + el.leaderboard.textContent);
    assert(/Next daily in/.test(el.leaderboard.textContent), "and the wait for the next");
    clearInterval(countdownTimer);
  });

  test("daily: a finished round goes on the day's record, not a top-ten board", function () {
    localStorage.clear();
    state.dailyDate = "2026-09-10";
    freeze("daily");
    for (let n = 0; n < 12; n++) {
      if (n) { spawnTarget(); clearTimeout(state.timers.expiry); }
      click(cols()[state.activeTarget.start]); clearTimeout(state.timers.spawn);
    }
    endGame();
    state.dailyDate = null;
    clearInterval(countdownTimer);
    eq(loadScores("daily").length, 0, "no board entry");
    const rec = loadDailyRecord("2026-09-10");
    assert(rec && rec.replay, "the day's record instead, marked as a replay since it is not today");
    assert(/Your dailies/.test(el.leaderboard.textContent), "the card shows the history");
    assert(/#1/.test(el.leaderboard.textContent), "with the day just played");
    assert(el.leaderboard.querySelector("li.you"), "highlighted");
    assert(/Next daily in \S/.test(el.leaderboard.textContent), "and the countdown filled in: " + el.leaderboard.textContent);
  });

  test("daily: the result goes to the share sheet on a touch screen, and copies elsewhere", function () {
    eq(shareLabel(), "Copy result", "a desktop copies");
    const realMatchMedia = window.matchMedia;
    let shared = null;
    window.matchMedia = function (q) { return { matches: /hover: none/.test(q), media: q }; };
    Object.defineProperty(navigator, "share", { configurable: true, writable: true,
      value: function (data) { shared = data; return Promise.resolve(); } });
    try {
      eq(shareLabel(), "Share result", "a touch screen with a share sheet shares");
      el.share.dataset.text = "CutSite Daily #1 \u00b7 12/12 cut";
      copyShare();
      assert(shared && /CutSite Daily #1/.test(shared.text), "the sheet gets the result text");
    } finally {
      window.matchMedia = realMatchMedia;
      delete navigator.share;
    }
    eq(shareLabel(), "Copy result", "and a desktop copies again");
  });

  test("daily: the countdown reads as hours and minutes to local midnight", function () {
    const ms = msUntilNextDaily();
    assert(ms > 0 && ms <= 86400000, "midnight is within a day: " + ms);
    eq(formatCountdown(3 * 3600000 + 5 * 60000), "3h 05m", "hours and minutes");
    eq(formatCountdown(45 * 60000), "45m", "minutes alone");
    eq(formatCountdown(20000), "under a minute", "the last moments");
    eq(msUntilNextDaily(new Date(2026, 8, 17, 12, 0, 0)), 12 * 3600000, "noon is twelve hours from midnight");
  });

  test("daily: a replay must be a real day between Daily #1 and today; anything else means today", function () {
    const today = todayKey();
    const shift = function (days) {
      const d = new Date(); d.setDate(d.getDate() + days);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    };
    assert(isReplayableDay("2026-09-10"), "Daily #1 can be replayed");
    assert(isReplayableDay(today), "today can be replayed");
    assert(!isReplayableDay(shift(1)), "tomorrow cannot be previewed");
    assert(!isReplayableDay("2026-09-09"), "the day before Daily #1 is not a daily");
    assert(!isReplayableDay("2026-02-30"), "a date that does not exist is not a daily");
    assert(!isReplayableDay("2026-13-01"), "nor is a thirteenth month");
    assert(!isReplayableDay("nonsense"), "nor nonsense");
    state.dailyDate = null;
    const url = location.pathname + location.search;
    try {
      history.replaceState(null, "", location.pathname + "?day=" + shift(1));
      eq(dailyDateKey(), today, "a future day in the query should fall back to today");
      history.replaceState(null, "", location.pathname + "?day=2026-09-10");
      eq(dailyDateKey(), "2026-09-10", "a past day in the query should be honoured");
    } finally {
      history.replaceState(null, "", url);
    }
  });

  test("daily: the same day gives everyone the same strand and the same targets", function () {
    const a = dailyRun("2026-09-10", 8), b = dailyRun("2026-09-10", 8);
    eq(a.strand, b.strand, "the strand should be identical");
    eq(a.sites.join("\n"), b.sites.join("\n"), "targets, decoys and orientations should be identical, in order");
    const c = dailyRun("2026-09-11", 8);
    assert(c.strand !== a.strand || c.sites.join() !== a.sites.join(), "a different day should be a different puzzle");
  });

  test("daily: difficulty ramps on targets served, so a miss never changes what comes next", function () {
    // Two players, same day: one hits everything, one misses everything.
    const seen = function (hit) {
      state.dailyDate = "2026-09-10";
      freeze("daily");
      const out = [];
      for (let n = 0; n < 8; n++) {
        const t = state.activeTarget;
        out.push(t.start + ":" + t.decoys.length + ":" + (t.reverse ? "r" : "f") + ":" + t.window);
        if (hit) click(cols()[t.start]); else onExpire();
        clearTimeout(state.timers.spawn);
        if (n < 7) { spawnTarget(); clearTimeout(state.timers.expiry); }
      }
      state.dailyDate = null;
      return out;
    };
    const hitter = seen(true), misser = seen(false);
    eq(misser.join(" "), hitter.join(" "), "both players should meet the same targets, decoys, windows, in the same order");
    assert(misser.some(function (x) { return /:2:/.test(x); }), "the second decoy should still arrive for the player who keeps missing");
  });

  test("daily: counts targets in the clock's box, uses the full strand on any screen, and ends after the last one", function () {
    state.dailyDate = "2026-09-10";
    state.gameMode = "daily";
    withWidth(375, function () { eq(strandColumnCount(), 30, "the daily should use the full strand even on a phone"); });
    freeze("daily");
    eq(el.timeLabel.textContent, "Target", "the clock's box should count targets");
    eq(el.time.textContent, "1 / 12", "first target served");
    assert(!roundFinished(), "not finished after one target");
    for (let n = 1; n < 12; n++) { clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry); }
    eq(el.time.textContent, "12 / 12", "twelfth target served");
    assert(roundFinished(), "finished once the twelfth target is served, so the next spawn slot ends the round");
    freeze("classic");
    eq(el.timeLabel.textContent, "Time", "classic gets its clock back");
    state.dailyDate = null;
  });

  test("daily: the first finished run counts, later runs are practice, an unfinished run records nothing", function () {
    localStorage.clear();
    state.dailyDate = "2026-09-10";
    freeze("daily");
    endGame();
    assert(!loadDailyRecord("2026-09-10"), "an abandoned run must not burn the day");
    assert(/not finished/.test(el.endTitle.textContent), "title: " + el.endTitle.textContent);
    assert(el.share.classList.contains("hidden"), "nothing to share yet");

    // A finished run: hit the first target, miss the other eleven.
    freeze("daily");
    click(cols()[state.activeTarget.start]); clearTimeout(state.timers.spawn);
    for (let n = 1; n < 12; n++) { spawnTarget(); clearTimeout(state.timers.expiry); onExpire(); clearTimeout(state.timers.spawn); }
    eq(state.outcomes.length, 12, "twelve outcomes");
    endGame();
    const rec = loadDailyRecord("2026-09-10");
    assert(rec, "a finished run should be recorded");
    eq(rec.number, 1, "10 Sep 2026 is Daily #1");
    eq(rec.cuts, 1, "one cut");
    eq(rec.outcomes.length, 12, "twelve marks");
    assert(/Daily #1 complete/.test(el.endTitle.textContent), "title: " + el.endTitle.textContent);
    assert(!el.share.classList.contains("hidden"), "the share row should show");
    assert(el.endNote.classList.contains("hidden"), "the share row takes the end-note's slot");
    const text = el.share.dataset.text;
    assert(/^CutSite Daily #1 /.test(text), "the share text should name the daily: " + text.split("\n")[0]);
    eq((text.match(/✂/g) || []).length, 1, "one scissors mark for the one cut");
    eq((text.match(/❌/g) || []).length, 11, "eleven miss marks");
    assert(text.indexOf(SHARE_URL) >= 0, "and it should carry the link");

    // A second finished run is practice and leaves the record alone.
    freeze("daily");
    for (let n = 0; n < 12; n++) {
      if (n) { spawnTarget(); clearTimeout(state.timers.expiry); }
      click(cols()[state.activeTarget.start]); clearTimeout(state.timers.spawn);
    }
    endGame();
    eq(loadDailyRecord("2026-09-10").cuts, 1, "the first run should still be the one that counts");
    assert(/practice run/.test(el.endTitle.textContent), "title: " + el.endTitle.textContent);

    // And nothing leaks into other modes.
    freeze("classic"); endGame();
    assert(el.share.classList.contains("hidden"), "classic should not show a share row");
    assert(!el.endNote.classList.contains("hidden"), "classic gets its end-note back");
    eq(rng, Math.random, "normal randomness should be back after a daily");
    state.dailyDate = null;
  });

  // ============================================================
  // Pausing
  // ============================================================
  test("pause: a hidden tab freezes a live target and hands it back with its clock shifted", function () {
    const t = freeze("classic");
    t.spawnedAt = performance.now() - 1000;          // 500 ms of a 1500 ms window left
    state.combo = 4;
    pauseRound();
    assert(state.paused, "the round should be paused");
    assert(/Paused/.test(el.status.textContent), "the status should say so");
    state.paused.at -= 60000;                        // a minute away
    resumeRound();
    assert(!state.paused, "the round should be running again");
    assert(state.activeTarget === t, "the same target should still be live");
    eq(state.misses, 0, "time away must not count as a miss");
    eq(state.combo, 4, "nor break the combo");
    eq(state.outcomes.length, 0, "nor resolve the target");
    const elapsed = performance.now() - t.spawnedAt;
    assert(elapsed >= 700 && elapsed <= 800,
           "the target's clock should skip the time away and keep at least half the window: elapsed " + Math.round(elapsed));
    assert(state.timers.expiry, "the expiry timer should be re-armed");
    assert(state.timers.round, "and the round clock restarted");
    assert(/Target locked/.test(el.status.textContent), "the status should be back to the target");
  });

  test("pause: between targets, the pending spawn waits out the pause too", function () {
    const t = freeze("classic");
    click(cols()[t.start]);                          // a hit: the next spawn is pending
    assert(state.spawnDue > 0, "a spawn should be pending");
    pauseRound();
    assert(state.paused.spawnIn > 0 && state.paused.spawnIn <= CONFIG.gapAfterHit,
           "the pause should remember how long the spawn had left");
    eq(state.activeTarget, null, "no target is live");
    resumeRound();
    assert(state.spawnDue > 0, "the spawn should be re-armed on return");
    eq(state.activeTarget, null, "and nothing should spawn early");
  });

  test("pause: does nothing between rounds", function () {
    freeze("classic");
    endGame();
    pauseRound();
    assert(!state.paused, "there is nothing to pause after the round");
    resumeRound();
    assert(!state.running, "and nothing to resume");
  });

  // ============================================================
  // Between rounds
  // ============================================================
  test("end card: takes focus when the round ends, as a dialog named by its title", function () {
    freeze("classic");
    assert(document.activeElement === el.strand, "the strand holds focus during a round");
    endGame();
    assert(document.activeElement === el.cardEnd, "the end card should take focus, not leave it on the strand underneath");
    eq(el.cardEnd.getAttribute("role"), "dialog", "it should be a dialog");
    eq(el.cardEnd.getAttribute("aria-labelledby"), "end-title", "named by its title");
    key(" ", "Space");
    assert(state.running, "Space from the card still restarts");
  });

  test("end card: Change mode brings the mode picker back, with the round's mode still selected", function () {
    freeze("zen");
    endGame();
    assert(el.cardStart.classList.contains("hidden"), "the start card is hidden while the end card shows");
    el.menuBtn.click();
    assert(!el.cardStart.classList.contains("hidden"), "Change mode should show the start card");
    assert(el.cardEnd.classList.contains("hidden"), "and hide the end card");
    assert(!el.overlay.classList.contains("hidden"), "with the overlay up");
    eq(state.gameMode, "zen", "the mode just played should stay selected");
    eq(document.querySelector('.mode-btn[data-mode="zen"]').getAttribute("aria-pressed"), "true", "and its button should read as pressed");
    assert(document.activeElement && document.activeElement.classList.contains("mode-btn"), "focus should land on the mode picker");
    document.querySelector('.mode-btn[data-mode="classic"]').click();
    el.startBtn.click();
    eq(state.gameMode, "classic", "a different mode should start without a reload");
    assert(state.running, "and its round should run");
  });

  test("keyboard: Space on an end-card button presses the button instead of restarting", function () {
    freeze("classic");
    endGame();
    el.againBtn.focus();
    const ev = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
    el.againBtn.dispatchEvent(ev);
    assert(!ev.defaultPrevented, "the restart shortcut should leave a button's own Space alone");
    assert(!state.running, "and not restart the round itself");
    key(" ", "Space");
    assert(state.running, "Space anywhere else on the end card should still restart");
  });

  test("sound: the toggle lives outside the overlay and its setting survives a reload", function () {
    assert(!el.overlay.contains(el.muteBtn), "the sound toggle must not live inside the overlay");
    localStorage.removeItem("cutsite-muted");
    state.muted = false; renderMute();
    toggleMute();
    eq(state.muted, true, "toggling should mute");
    eq(localStorage.getItem("cutsite-muted"), "1", "and remember it");
    eq(el.muteBtn.getAttribute("aria-pressed"), "true", "the button should read as pressed");
    state.muted = false; renderMute();          // a fresh page load...
    restoreMute();                              // ...brings the choice back
    eq(state.muted, true, "the saved choice should come back");
    assert(/off/.test(el.muteBtn.textContent), "and the button should say so");
    toggleMute();
    eq(localStorage.getItem("cutsite-muted"), "0", "toggling back should be remembered too");
    eq(state.muted, false, "sound is on again");
  });

  // ============================================================
  // Keyboard play and screen-reader announcements
  // ============================================================
  function key(k, code) {
    el.strand.dispatchEvent(new KeyboardEvent("keydown", {
      key: k, code: code || k, bubbles: true, cancelable: true,
    }));
  }

  test("a11y: the status line is a polite live region", function () {
    eq(el.status.getAttribute("role"), "status", "role");
    eq(el.status.getAttribute("aria-live"), "polite", "aria-live");
  });

  test("a11y: the strand is one focusable listbox with labelled options", function () {
    buildStrand();
    eq(el.strand.getAttribute("role"), "listbox", "strand role");
    eq(el.strand.getAttribute("tabindex"), "0", "strand should be in the Tab order");
    assert(el.strand.getAttribute("aria-label"), "strand needs an accessible name");
    cols().forEach(function (c, i) {
      eq(c.getAttribute("role"), "option", "column " + i + " role");
      assert(c.id, "column " + i + " needs an id for aria-activedescendant");
      assert(/paired with/.test(c.getAttribute("aria-label")),
             "column " + i + " label should name its base pair");
    });
    eq(el.strand.getAttribute("aria-activedescendant"), cols()[state.cursor].id,
       "aria-activedescendant should track the cursor");
  });

  test("a11y: labels say which columns fluoresce and which are the PAM", function () {
    const t = freeze("classic");
    const c = cols();
    assert(/fluorescing/.test(c[t.start].getAttribute("aria-label")), "target column should say fluorescing");
    assert(/PAM/.test(c[t.pamStart + 1].getAttribute("aria-label")), "PAM column should say PAM");
    const plain = c.find(function (x) {
      return !x.classList.contains("candidate") && !x.classList.contains("pam");
    });
    assert(!/fluorescing|PAM/.test(plain.getAttribute("aria-label")), "plain column should say neither");
    clearTarget();
    assert(!c.some(function (x) { return /fluorescing|PAM/.test(x.getAttribute("aria-label")); }),
           "labels should return to plain base pairs when the target clears");
  });

  test("a11y: with decoys on screen, labels name a PAM position, never a PAM that is not there", function () {
    let nopam = null, tries = 0;
    while (!nopam && tries++ < 60) {
      freeze("guide", 10);
      nopam = state.activeTarget.decoys.find(function (d) { return d.kind === "nopam"; }) || null;
    }
    assert(nopam, "never spawned a no-PAM decoy");
    const c = cols(), t = state.activeTarget;
    c.forEach(function (col) {
      assert(!/, PAM$/.test(col.getAttribute("aria-label")),
             "no column may be labelled a bare PAM while decoys are on screen");
    });
    assert(/PAM position/.test(c[nopam.pamStart + 1].getAttribute("aria-label")),
           "a no-PAM decoy's triplet is a position to check, not a PAM");
    assert(/PAM position/.test(c[t.pamStart + 1].getAttribute("aria-label")),
           "the real target's triplet reads the same, so the label leaks nothing");
    freeze("classic");
    assert(/, PAM$/.test(cols()[state.activeTarget.pamStart + 1].getAttribute("aria-label")),
           "with a single target its triplet is simply the PAM");
  });

  test("a11y: mode buttons announce which one is selected", function () {
    const btn = function (m) { return document.querySelector('.mode-btn[data-mode="' + m + '"]'); };
    btn("zen").click();
    eq(btn("zen").getAttribute("aria-pressed"), "true", "zen should read as pressed");
    eq(btn("classic").getAttribute("aria-pressed"), "false", "classic should read as released");
    eq(state.gameMode, "zen", "the mode should follow");
    btn("classic").click();
    eq(btn("classic").getAttribute("aria-pressed"), "true", "classic pressed again");
    assert(document.querySelector(".mode-selector").getAttribute("aria-label"), "the group needs a name");
  });

  test("keyboard: arrows move the cursor, Home/End jump, edges clamp", function () {
    buildStrand();
    const last = cols().length - 1;
    setCursor(5);
    key("ArrowRight"); eq(state.cursor, 6, "right");
    key("ArrowLeft"); key("ArrowLeft"); eq(state.cursor, 4, "left twice");
    key("Home"); eq(state.cursor, 0, "home");
    key("ArrowLeft"); eq(state.cursor, 0, "should clamp at the left edge");
    key("End"); eq(state.cursor, last, "end");
    key("ArrowRight"); eq(state.cursor, last, "should clamp at the right edge");
    assert(cols()[last].classList.contains("cursor"), "cursor class should follow");
    eq(cols().filter(function (c) { return c.classList.contains("cursor"); }).length, 1,
       "exactly one column should carry the cursor");
  });

  test("keyboard: a new round parks the cursor mid-strand, never on the target", function () {
    for (let n = 0; n < 30; n++) {
      freeze("guide", 10);
      eq(state.cursor, Math.floor(cols().length / 2), "cursor should start in the middle");
    }
  });

  test("keyboard: spawning a target leaves the cursor where it was", function () {
    freeze("classic");
    setCursor(3);
    clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    eq(state.cursor, 3, "a spawn must not move the cursor, or it would give the answer away");
  });

  test("keyboard: J jumps to the lit site, so a reflex round is one press plus Enter", function () {
    const t = freeze("classic");
    setCursor(t.start === 0 ? cols().length - 1 : 0);   // start well away from it
    key("j");
    eq(state.cursor, t.start, "J should land on the site");
    key("j");
    eq(state.cursor, t.start, "with one site lit, J stays on it");
    key("Enter");
    eq(state.cuts, 1, "and Enter cuts it");
  });

  test("keyboard: J and K cycle through every lit site in order and wrap at the ends", function () {
    let sites = [], tries = 0;
    while (sites.length < 3 && tries++ < 60) { freeze("guide", 10); sites = siteStarts(); }
    eq(sites.length, 3, "needs three lit sites");
    setCursor(sites[0] === 0 ? cols().length - 1 : 0);
    const seen = [];
    for (let n = 0; n < 4; n++) { key("j"); seen.push(state.cursor); }
    eq(seen.slice(0, 3).join(","), sites.join(","), "J should walk the sites left to right");
    eq(seen[3], sites[0], "and wrap to the first");
    key("k");
    eq(state.cursor, sites[2], "K should wrap back to the last");
    setCursor(sites[1] + 2);                     // inside the middle site
    key("k");
    eq(state.cursor, sites[0], "K from inside a site goes to the previous one, not its own start");
  });

  test("keyboard: digits pick a lit site by position, and ignore positions that do not exist", function () {
    let sites = [], tries = 0;
    while (sites.length < 3 && tries++ < 60) { freeze("guide", 10); sites = siteStarts(); }
    eq(sites.length, 3, "needs three lit sites");
    key("2"); eq(state.cursor, sites[1], "2 is the middle site");
    key("3"); eq(state.cursor, sites[2], "3 is the right-hand site");
    key("1"); eq(state.cursor, sites[0], "1 is the left-hand site");
    key("7"); eq(state.cursor, sites[0], "a position that does not exist should move nothing");
  });

  test("keyboard: jumps do nothing with nothing lit, and never hijack modifier shortcuts", function () {
    freeze("classic");
    clearTarget();
    setCursor(4);
    key("j"); eq(state.cursor, 4, "J with nothing lit should not move");
    key("1"); eq(state.cursor, 4, "nor should 1");
    clearTimeout(state.timers.spawn); spawnTarget(); clearTimeout(state.timers.expiry);
    setCursor(4);
    const ev = new KeyboardEvent("keydown", { key: "1", code: "Digit1", metaKey: true, bubbles: true, cancelable: true });
    el.strand.dispatchEvent(ev);
    assert(!ev.defaultPrevented, "Cmd+1 must be left to the browser");
    eq(state.cursor, 4, "and must not move the cursor");
  });

  test("keyboard: Enter cuts at the cursor and scores on the target", function () {
    const t = freeze("classic");
    setCursor(t.start);
    key("Enter");
    eq(state.cuts, 1, "cut count");
    assert(state.score > 0, "should score");
  });

  test("keyboard: Space cuts mid-round instead of restarting", function () {
    const t = freeze("classic");
    setCursor(t.start);
    key(" ", "Space");
    eq(state.cuts, 1, "Space should cut");
    assert(state.running, "the round should still be running");
  });

  test("keyboard: cutting plain DNA from the keyboard is off-target", function () {
    freeze("classic");
    const plain = cols().findIndex(function (c) {
      return !c.classList.contains("candidate") && !c.classList.contains("pam");
    });
    setCursor(plain);
    key("Enter");
    eq(state.offTargets, 1, "off-target count");
    eq(state.cuts, 0, "should not count as a cut");
  });

  test("keyboard: cuts respect the jam lockout", function () {
    const t = freeze("classic");
    state.lockedUntil = performance.now() + 5000;
    setCursor(t.start);
    key("Enter");
    eq(state.cuts, 0, "a jammed blade should not cut from the keyboard either");
  });

  test("keyboard: a mouse click parks the cursor on that column", function () {
    freeze("classic");
    setCursor(0);
    const plain = cols().findIndex(function (c, i) {
      return i > 2 && !c.classList.contains("candidate") && !c.classList.contains("pam");
    });
    click(cols()[plain]);
    eq(state.cursor, plain, "cursor should follow the click");
  });

  test("keyboard: the cursor ring shows only while the keyboard is driving", function () {
    buildStrand();
    el.strand.focus();
    const ring = function () { return getComputedStyle(document.querySelector(".col.cursor")).outlineStyle; };
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    eq(ring(), "none", "a mouse player should see no ring");
    key("ArrowRight");
    eq(ring(), "solid", "a key press should bring the ring up");
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    eq(ring(), "none", "reaching for the mouse should drop the ring again");
  });

  test("keyboard: Space on the game-over card restarts the round", function () {
    freeze("classic");
    endGame();
    assert(!state.running, "round should be over");
    key(" ", "Space");
    assert(state.running, "Space should restart from the game-over card");
  });

  // ============================================================
  // report
  // ============================================================
  const passed = results.filter(function (r) { return r.ok; }).length;
  const failed = results.length - passed;
  const lines = results.map(function (r) {
    return (r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok ? "" : "\n         " + r.err);
  });
  lines.push("");
  lines.push("CUTSITE-RESULT passed=" + passed + " failed=" + failed);

  const pre = document.createElement("pre");
  pre.id = "cutsite-test-output";
  pre.textContent = lines.join("\n");
  document.body.appendChild(pre);
}
document.fonts.ready.then(runCutSiteSuite, runCutSiteSuite);
