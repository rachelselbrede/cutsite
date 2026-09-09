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

  test("guide mode: distal decoys keep an intact PAM and differ by one base far from it", function () {
    freeze("guide", 10);
    let seen = 0;
    for (let n = 0; n < 150; n++) {
      const t = state.activeTarget, c = cols();
      decoyRuns().filter(function (r) { return r.kind === "distal"; }).forEach(function (r) {
        seen++;
        assert(topOf(c[r.end + 2]) === "G" && topOf(c[r.end + 3]) === "G",
               "a distal decoy should keep a real NGG: Cas9 has to be willing to cut it");
        const seq = seqAt(c, r.start, r.end).split("");
        const diffs = seq.map(function (b, j) { return b === t.guide[j] ? -1 : j; })
                         .filter(function (j) { return j >= 0; });
        eq(diffs.length, 1, "a distal decoy should differ from the guide by exactly one base");
        assert(diffs[0] <= 1, "the mismatch should sit at the far end from the PAM, not at position " + diffs[0]);
      });
      clearTarget(); spawnTarget(); clearTimeout(state.timers.expiry);
    }
    assert(seen > 0, "no distal decoys were generated at all");
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
    click(cols()[t.end + 2]);
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
    assert(/PAM position/.test(c[nopam.end + 2].getAttribute("aria-label")),
           "a no-PAM decoy's triplet is a position to check, not a PAM");
    assert(/PAM position/.test(c[t.end + 2].getAttribute("aria-label")),
           "the real target's triplet reads the same, so the label leaks nothing");
    freeze("classic");
    assert(/, PAM$/.test(cols()[state.activeTarget.end + 2].getAttribute("aria-label")),
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
})();
