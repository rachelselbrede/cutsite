/* ============================================================
   CutSite  -  test suite
   ------------------------------------------------------------
   This file is injected into a copy of the real index.html,
   immediately after script.js, so it runs in the game's own
   global scope and can reach its bindings (state, CONFIG,
   spawnTarget, ...) directly. Nothing is stubbed: every
   assertion below is made against the real DOM the game draws.

   Run it with:  python3 tests/run.py
   ============================================================ */
(function () {
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

  test("strand: guide mode keeps room for a decoy on a phone", function () {
    state.gameMode = "guide";
    withWidth(375, function () {
      assert(strandColumnCount() >= 20, "guide mode needs at least 20 columns, got " + strandColumnCount());
    });
    state.gameMode = "classic";
  });

  // ============================================================
  // The target: PAM, cut site, guide
  // ============================================================
  test("target: the PAM is always NGG", function () {
    freeze("classic");
    for (let n = 0; n < 200; n++) {
      const t = state.activeTarget, c = cols();
      eq(topOf(c[t.end + 2]), "G", "PAM position 2");
      eq(topOf(c[t.end + 3]), "G", "PAM position 3");
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
  });

  test("target: the protospacer and its PAM stay on the strand", function () {
    freeze("classic");
    for (let n = 0; n < 200; n++) {
      const t = state.activeTarget;
      assert(t.start >= 0, "start off the left edge");
      assert(t.end + CONFIG.pamLength <= cols().length - 1, "PAM runs off the right edge");
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
  });

  test("target: the cut site sits 3 bp upstream of the PAM", function () {
    freeze("classic");
    for (let n = 0; n < 200; n++) {
      const t = state.activeTarget;
      eq(t.breakIndex, t.end - CONFIG.cutOffsetFromPam + 1, "break index");
      const marked = cols().findIndex(function (c) { return c.classList.contains("cut-site"); });
      eq(marked, t.breakIndex, "the drawn line and the recorded break disagree");
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
  });

  test("target: the guide matches the protospacer exactly", function () {
    freeze("classic");
    for (let n = 0; n < 200; n++) {
      const t = state.activeTarget;
      eq(seqAt(cols(), t.start, t.end), t.guide.join(""), "guide vs protospacer");
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
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
    freeze("guide", 10);
    let seen = 0;
    for (let n = 0; n < 150; n++) {
      const t = state.activeTarget, c = cols();
      decoyRuns().filter(function (r) { return r.kind === "nopam"; }).forEach(function (r) {
        seen++;
        eq(seqAt(c, r.start, r.end), t.guide.join(""), "a no-PAM decoy should match the guide");
        const isNGG = topOf(c[r.end + 2]) === "G" && topOf(c[r.end + 3]) === "G";
        assert(!isNGG, "a no-PAM decoy carried a real NGG, making it genuinely cuttable");
      });
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(seen > 0, "no no-PAM decoys were generated at all");
  });

  test("guide mode: seed decoys keep an intact PAM and differ by one base", function () {
    freeze("guide", 10);
    let seen = 0;
    for (let n = 0; n < 150; n++) {
      const t = state.activeTarget, c = cols();
      decoyRuns().filter(function (r) { return r.kind === "seed"; }).forEach(function (r) {
        seen++;
        assert(topOf(c[r.end + 2]) === "G" && topOf(c[r.end + 3]) === "G",
               "a seed decoy should keep a real NGG, so the PAM is not the reason it fails");
        const seq = seqAt(c, r.start, r.end).split("");
        const diffs = seq.map(function (b, j) { return b === t.guide[j] ? -1 : j; })
                         .filter(function (j) { return j >= 0; });
        eq(diffs.length, 1, "a seed decoy should differ from the guide by exactly one base");
        assert(diffs[0] >= CONFIG.targetLength - 2,
               "the mismatch fell outside the seed, at position " + diffs[0]);
      });
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(seen > 0, "no seed decoys were generated at all");
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

  test("modes: zen hides the clock and offers a stop button", function () {
    freeze("zen");
    assert(el.time.closest(".stat").classList.contains("hidden"), "zen should hide the whole time stat");
    assert(!el.stopBtn.classList.contains("hidden"), "zen should show the stop button");
    freeze("classic");
    assert(!el.time.closest(".stat").classList.contains("hidden"), "classic should show the clock");
    assert(el.stopBtn.classList.contains("hidden"), "classic should hide the stop button");
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
    eq(board[0], 1500, "highest score first");
    for (let i = 1; i < board.length; i++) {
      assert(board[i - 1] >= board[i], "board is not sorted descending");
    }
  });

  test("storage: pre-Zen scores migrate into the classic board", function () {
    localStorage.clear();
    localStorage.setItem("cutsite-scores", JSON.stringify([300, 100]));
    localStorage.setItem("cutsite-best", "900");
    const board = loadScores("classic");
    eq(board[0], 900, "the old best should survive migration");
    assert(board.includes(300) && board.includes(100), "old scores should survive migration");
    eq(localStorage.getItem("cutsite-best"), null, "the legacy key should be cleared");
    eq(localStorage.getItem("cutsite-scores"), null, "the legacy key should be cleared");
  });

  test("storage: unlocked achievements persist", function () {
    localStorage.clear();
    unlockAchievement("firstBlood");
    assert(loadUnlockedAchievements().includes("firstBlood"), "achievement did not persist");
    unlockAchievement("firstBlood");
    eq(loadUnlockedAchievements().filter(function (id) { return id === "firstBlood"; }).length, 1,
       "achievement was stored twice");
  });

  test("achievements: the first cut of a round unlocks First Blood", function () {
    localStorage.clear();
    const t = freeze("classic");
    click(cols()[t.start]);
    assert(state.earnedAchievements.includes("firstBlood"), "First Blood was not awarded");
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
    assert(/PAM/.test(c[t.end + 2].getAttribute("aria-label")), "PAM column should say PAM");
    const plain = c.find(function (x) {
      return !x.classList.contains("candidate") && !x.classList.contains("pam");
    });
    assert(!/fluorescing|PAM/.test(plain.getAttribute("aria-label")), "plain column should say neither");
    clearTarget();
    assert(!c.some(function (x) { return /fluorescing|PAM/.test(x.getAttribute("aria-label")); }),
           "labels should return to plain base pairs when the target clears");
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
})();
