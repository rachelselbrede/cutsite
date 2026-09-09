/* ============================================================
   CutSite  -  game logic
   ------------------------------------------------------------
   How a round works:
     1. A strand of DNA is drawn as a row of base pairs.
     2. Every so often a short stretch fluoresces beside an NGG
        PAM: the target. Cut it before its window closes.
        - A fast cut scores more and builds the combo.
        - Letting it expire breaks the combo.
        - Cutting anything else is an OFF-TARGET cut: the combo
          resets and, when Cas9 would have refused the site, the
          blades jam for a moment.
     3. Three modes. Classic is 30 seconds. Zen is endless and
        keeps tightening. Guide RNA is 45 seconds and lights decoy
        sites too: only the guide's match beside a real NGG is the
        target. Decoys fail the way real sites fail - no PAM, or a
        seed mismatch - except the PAM-distal mismatch, which Cas9
        cuts anyway. That one is the real off-target problem.
     4. Mouse, touch and keyboard all cut through the same path.
     5. When the round ends the score joins that mode's board.
   The code is grouped into: config, state, setup, the DNA
   strand, the target loop, cutting, keyboard, scoring, sound,
   helpers, achievements, and storage.
   ============================================================ */

// ---------- 1. CONFIG ----------
const CONFIG = {
  roundSeconds: 30,      // length of one round
  strandLength: 30,      // number of base pairs drawn
  targetLength: 5,       // how many bases fluoresce at once (a short protospacer)
  pamLength: 3,          // SpCas9's PAM is NGG: three bases, not two
  cutOffsetFromPam: 3,   // Cas9 breaks the duplex 3 bp upstream of the PAM
  basePoints: 100,       // points before combo + speed bonus
  comboCap: 10,          // combo multiplier stops climbing here
  windowStart: 1500,     // ms you get to click an early target
  windowMin: 650,        // ms window once you are fully warmed up
  rampCuts: 25,          // cuts it takes to get from windowStart to windowMin
  lateRampCuts: 50,      // time constant of the slow squeeze past that (zen)
  gapAfterHit: 420,      // pause before the next target appears
  gapAfterMiss: 650,
  lockoutMs: 450,        // blades jam this long after an off-target cut
  speedDemonMs: 250,     // a cut this soon after the glow is a Speed Demon
};

// Per-mode tuning. Classic and Zen are pure reflex: one glowing site, short
// windows. Guide RNA mode lights several sites at once and only the one
// matching the displayed guide beside a real NGG is cuttable, so it trades
// speed for reading time and a longer round.
// windowFloor is where the squeeze past the ramp ends. Classic keeps its
// floor at windowMin so nothing past 25 cuts changes and its leaderboard
// stays comparable; Guide RNA is a reading mode and should not turn into a
// reflex test; Zen is the one that goes on tightening.
const MODES = {
  classic: { label: "Classic", timed: true, roundSeconds: CONFIG.roundSeconds,
             windowStart: CONFIG.windowStart, windowMin: CONFIG.windowMin,
             windowFloor: CONFIG.windowMin, decoys: () => 0 },
  zen:     { label: "Zen", timed: false, roundSeconds: 0,
             windowStart: CONFIG.windowStart, windowMin: CONFIG.windowMin,
             windowFloor: 400, decoys: () => 0 },
  guide:   { label: "Guide RNA", timed: true, roundSeconds: 45,
             windowStart: 4000, windowMin: 1800,
             windowFloor: 1800, decoys: (cuts) => (cuts < 8 ? 1 : 2) },
};
function mode() {
  return MODES[state.gameMode] || MODES.classic;
}

// Why a decoy is not the right target. The first two are the real reasons
// Cas9 leaves a site alone: no PAM means it never even unwinds the DNA to
// check, and a mismatch in the seed (the bases nearest the PAM) stops the
// guide pairing. The third is different in kind: Cas9 TOLERATES a mismatch
// far from the PAM and cuts the site regardless. That is the actual
// off-target problem, and the one the game exists to show.
const DECOY_MESSAGES = {
  nopam: "Perfect match, but no PAM. Cas9 never cuts without an NGG.",
  seed: "Seed mismatch beside the PAM. The guide can't pair there.",
  distal: "Cas9 cut it anyway. A mismatch that far from the PAM is tolerated.",
};

// DNA base pairing. Cas9 needs a PAM immediately 3' of the protospacer.
// For S. pyogenes Cas9 that motif is NGG: any base, then two Gs. The N is
// left as whatever the strand already generated, which is the point of it.
const COMPLEMENT = { A: "T", T: "A", G: "C", C: "G" };
const BASES = ["A", "T", "G", "C"];

// ---------- 2. STATE ----------
const state = {
  running: false,
  score: 0,
  combo: 1,
  cuts: 0,
  misses: 0,
  timeLeft: CONFIG.roundSeconds,
  activeTarget: null,   // { start, end, breakIndex, guide, spawnedAt, window, restore }
  timers: { round: null, spawn: null, expiry: null },
  muted: false,
  gameMode: 'classic',  // a key of MODES
  earnedAchievements: [], // achievements earned this round
  previouslyUnlocked: [], // achievements already unlocked before this round (from storage)
  maxCombo: 1,
  consecutivePerfects: 0,
  offTargets: 0,        // stray cuts on non-target DNA this round
  lockedUntil: 0,       // performance.now() timestamp the blades free up
  cursor: 0,            // column the keyboard is pointing at
};

// ---------- 1.5. ACHIEVEMENTS ----------
const ACHIEVEMENTS = {
  firstBlood: { id: 'firstBlood', name: 'First Blood', desc: 'Make your first cut' },
  comboMaster: { id: 'comboMaster', name: 'Combo Master', desc: 'Reach a 10+ combo streak' },
  speedDemon: { id: 'speedDemon', name: 'Speed Demon', desc: 'Cut a target within a quarter second of the glow' },
  flawless: { id: 'flawless', name: 'Flawless', desc: '3 consecutive perfect hits' },
  perfect: { id: 'perfect', name: 'Precision', desc: 'Achieve 90%+ accuracy' },
  onTarget: { id: 'onTarget', name: 'On Target', desc: 'Finish a round with 10+ cuts and zero off-target snips' },
};

// ---------- 3. DOM + SETUP ----------
const el = {
  strand: document.getElementById("strand"),
  status: document.getElementById("status"),
  score: document.getElementById("score"),
  combo: document.getElementById("combo"),
  time: document.getElementById("time"),
  difficulty: document.getElementById("difficulty"),
  accuracyDisplay: document.getElementById("accuracy-display"),
  guideSeq: document.getElementById("guide-seq"),
  overlay: document.getElementById("overlay"),
  cardStart: document.getElementById("card-start"),
  cardEnd: document.getElementById("card-end"),
  startBtn: document.getElementById("start-btn"),
  againBtn: document.getElementById("again-btn"),
  muteBtn: document.getElementById("mute-btn"),
  stopBtn: document.getElementById("stop-btn"),
  finalScore: document.getElementById("final-score"),
  finalCuts: document.getElementById("final-cuts"),
  finalAcc: document.getElementById("final-acc"),
  finalOff: document.getElementById("final-off"),
  achievements: document.getElementById("achievements"),
  leaderboard: document.getElementById("leaderboard"),
  endTitle: document.getElementById("end-title"),
  endNote: document.getElementById("end-note"),
  scissors: document.getElementById("scissors"),
  stage: document.getElementById("stage"),
};

// Initialize scissors position to center
function initializeScissors() {
  if (!el.scissors) return;
  el.scissors.style.left = window.innerWidth / 2 + "px";
  el.scissors.style.top = window.innerHeight / 2 + "px";
}

// Call initialization immediately
initializeScissors();

// Ensure event listeners are attached after DOM is ready
if (el.startBtn) el.startBtn.addEventListener("click", startGame);
if (el.againBtn) el.againBtn.addEventListener("click", startGame);
if (el.muteBtn) el.muteBtn.addEventListener("click", toggleMute);
if (el.stopBtn) el.stopBtn.addEventListener("click", endGame);

// Mode selection listeners
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(b => {
      b.classList.remove("selected");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("selected");
    btn.setAttribute("aria-pressed", "true");
    state.gameMode = btn.dataset.mode;
  });
});

// A single click handler on the strand decides hit vs miss. The keyboard
// goes through the same cut logic from a roving cursor.
el.strand.addEventListener("click", handleStrandClick);
el.strand.addEventListener("keydown", handleStrandKey);

// The cursor ring should mean one thing: "the keyboard is driving". That is
// tracked directly rather than left to :focus-visible, which only re-evaluates
// when focus moves - and a click on a column never moves it, so after any key
// press the ring would cling on through every mouse click that followed.
document.addEventListener("keydown", () => el.strand.classList.add("kb"));
document.addEventListener("pointerdown", () => el.strand.classList.remove("kb"));

// The scissors follow the pointer while a round is live. On touch there is
// no roaming pointer to follow (CSS hides the scissors there too).
document.addEventListener("pointermove", moveScissors);
document.addEventListener("pointerdown", snipScissors);

buildStrand();

// Rotating a phone or resizing the window between rounds gets a strand
// rebuilt at the right length. Mid-round the strand is left alone so an
// active target's indices stay valid.
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.running) buildStrand();
  }, 150);
});

// ---------- 4. THE DNA STRAND ----------
// On narrow screens 30 columns squeeze below a usable finger width, so the
// strand shortens instead: fewer, fatter base pairs to tap.
function strandColumnCount() {
  const w = window.innerWidth;
  let count = CONFIG.strandLength;
  if (w < 480) count = 16;
  else if (w < 720) count = 22;
  // Guide mode needs room for a decoy beside the real site: two 8-column
  // windows plus the gap between them, with a little slack so the placement
  // is not forced into a single arrangement.
  if (state.gameMode === "guide") count = Math.max(count, 20);
  return count;
}

function buildStrand() {
  el.strand.innerHTML = "";
  const count = strandColumnCount();
  for (let i = 0; i < count; i++) {
    const top = BASES[Math.floor(Math.random() * 4)];
    const bottom = COMPLEMENT[top];

    const col = document.createElement("div");
    col.className = "col";
    col.dataset.index = i;
    col.id = columnId(i);
    col.setAttribute("role", "option");
    col.innerHTML = `
      <span class="base base-${top}">${top}</span>
      <span class="rung"></span>
      <span class="base base-${bottom}">${bottom}</span>`;
    el.strand.appendChild(col);
  }
  relabelColumns();
  setCursor(Math.min(state.cursor, count - 1));
}

function columns() {
  return Array.from(el.strand.children);
}

// ---------- 5. GAME FLOW ----------
function startGame() {
  clearTimers();
  buildStrand();
  const m = mode();

  state.running = true;
  state.score = 0;
  state.combo = 1;
  state.cuts = 0;
  state.misses = 0;
  state.timeLeft = m.roundSeconds;
  state.activeTarget = null;
  state.earnedAchievements = [];
  state.previouslyUnlocked = loadUnlockedAchievements();
  state.maxCombo = 1;
  state.consecutivePerfects = 0;
  state.offTargets = 0;
  state.lockedUntil = 0;

  el.score.textContent = "0";
  el.combo.textContent = "\u00d71";
  el.difficulty.textContent = "0%";
  el.difficulty.setAttribute("data-level", "low");
  el.time.textContent = m.roundSeconds;
  el.time.classList.remove("low");
  el.overlay.classList.add("hidden");
  el.scissors.classList.add("active");
  // Position scissors at center of screen so they're visible immediately
  initializeScissors();
  el.stage.style.cursor = "none";
  showGuide(null);
  // Park the keyboard cursor in the middle, never on the target: in Guide
  // RNA mode that would hand over the answer. Focusing the strand means a
  // keyboard player can cut straight away after pressing Start.
  setCursor(Math.floor(columns().length / 2));
  el.strand.focus({ preventScroll: true });
  setStatus(state.gameMode === "guide"
    ? "Read the guide. Only its match beside an NGG is a real target."
    : "Guide RNA loaded. Watch for the glow.", false);

  // Untimed modes swap the countdown for a stop button. Hide the whole
  // stat box, not just the number, so no empty panel is left.
  const timeStat = el.time.closest(".stat");
  if (!m.timed) {
    timeStat.classList.add("hidden");
    el.stopBtn.classList.remove("hidden");
  } else {
    timeStat.classList.remove("hidden");
    el.stopBtn.classList.add("hidden");
  }

  if (m.timed) {
    state.timers.round = setInterval(() => {
      state.timeLeft--;
      el.time.textContent = state.timeLeft;
      if (state.timeLeft <= 10) el.time.classList.add("low");
      if (state.timeLeft <= 0) endGame();
    }, 1000);
  }

  scheduleSpawn(600);
}

function endGame() {
  state.running = false;
  clearTimers();
  clearTarget();
  el.scissors.classList.remove("active");
  el.stage.style.cursor = "";
  el.stopBtn.classList.add("hidden");

  const mode = state.gameMode;
  const best = getBestScore(mode);
  const isRecord = state.score > best;

  const accuracy = state.cuts + state.misses === 0
    ? 0
    : Math.round((state.cuts / (state.cuts + state.misses)) * 100);

  // The board keeps the round, not just its number, so a score can be read
  // back later with the accuracy and date that earned it.
  const saved = saveScore({
    score: state.score, cuts: state.cuts, accuracy, maxCombo: state.maxCombo,
    offTargets: state.offTargets, date: new Date().toISOString(),
  }, mode);

  // Check for achievements
  checkAchievements();

  if (el.finalScore) el.finalScore.textContent = state.score.toLocaleString();
  el.finalCuts.textContent = state.cuts;
  el.finalAcc.textContent = accuracy + "%";
  if (el.finalOff) el.finalOff.textContent = state.offTargets;
  el.endTitle.textContent = isRecord ? "New personal best" : "Round complete";
  el.endNote.textContent = endMessage(state.cuts, accuracy, isRecord);

  // Newly unlocked this round = earned now but not owned before the round started.
  const newlyUnlocked = state.earnedAchievements.filter(
    (id) => !state.previouslyUnlocked.includes(id)
  );
  renderAchievements(newlyUnlocked);

  // Populate leaderboard for the mode just played
  renderLeaderboard(mode, saved);

  el.cardStart.classList.add("hidden");
  el.cardEnd.classList.remove("hidden");
  el.overlay.classList.remove("hidden");
}

// ---------- 6. THE TARGET LOOP ----------
function scheduleSpawn(delay) {
  state.timers.spawn = setTimeout(spawnTarget, delay);
}

// Pick `count` non-overlapping windows of protospacer + PAM, each at least
// SITE_GAP plain columns clear of the next so the glows read as separate
// sites rather than one long smear. Returns null if they will not fit, so
// the caller can retry with fewer decoys.
const SITE_GAP = 2;
function placeWindows(colCount, count) {
  const span = CONFIG.targetLength + CONFIG.pamLength;
  for (let attempt = 0; attempt < 200; attempt++) {
    const starts = [];
    for (let k = 0; k < count; k++) {
      const s = Math.floor(Math.random() * (colCount - span + 1));
      if (starts.some((o) => Math.abs(o - s) < span + SITE_GAP)) break;
      starts.push(s);
    }
    if (starts.length === count) return starts;
  }
  return null;
}

function spawnTarget() {
  if (!state.running) return;

  const cols = columns();
  const m = mode();
  const readBase = (i) => cols[i].querySelector(".base").textContent;

  // Every base written for this target is recorded so clearTarget can put it
  // back. Writing Gs in permanently made the strand drift towards poly-G over
  // a round - after 500 spawns the N position was a G 94% of the time - which
  // is not a sequence any genome would produce.
  const restore = [];
  const written = new Set();
  const write = (i, letter) => {
    // Only the FIRST write to a column records a base to restore. A seed
    // decoy writes its stretch twice - the guide sequence, then the one
    // mismatched base - and recording both meant clearTarget replayed the
    // intermediate value last, leaking the column's real base for good.
    if (!written.has(i)) {
      written.add(i);
      restore.push({ index: i, base: readBase(i) });
    }
    setBase(cols[i], letter);
  };

  // The strand may be shorter than CONFIG.strandLength on small screens, so
  // fit as many decoys as the real column count allows.
  let decoys = m.decoys(state.cuts);
  let starts = placeWindows(cols.length, decoys + 1);
  while (!starts && decoys > 0) starts = placeWindows(cols.length, --decoys + 1);

  const start = starts[0];
  const end = start + CONFIG.targetLength - 1;

  // The PAM is NGG. Only the two Gs are fixed; the N keeps whatever base the
  // strand already had, because in NGG the first position genuinely is any
  // base. Tagging all three makes the motif on screen the length it really is.
  write(end + 2, "G");
  write(end + 3, "G");
  for (let i = 1; i <= CONFIG.pamLength; i++) cols[end + i].classList.add("pam");
  for (let i = start; i <= end; i++) cols[i].classList.add("candidate", "in-target");

  // The guide's spacer reads the same as the protospacer on this strand
  // (with U for T); it base-pairs with the strand underneath.
  const guide = [];
  for (let i = start; i <= end; i++) guide.push(readBase(i));

  // Decoys carry the same sequence as the guide, then differ in one of three
  // ways. "nopam" and "seed" are sites Cas9 refuses. "distal" is a site Cas9
  // cuts anyway - the one that is hardest to spot, because every base has to
  // be read, so it joins the pool only once a player has a few cuts in.
  // The pool is shuffled so a two-decoy spawn always shows two different
  // kinds and a one-decoy spawn is unpredictable.
  const pool = state.cuts < 4 ? ["nopam", "seed"] : ["nopam", "seed", "distal"];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const decoyRuns = [];
  starts.slice(1).forEach((s, k) => {
    const e = s + CONFIG.targetLength - 1;
    const kind = pool[k % pool.length];
    guide.forEach((b, j) => write(s + j, b));
    if (kind === "nopam") {
      // Any triplet that is not NGG: the last position is forced off G.
      write(e + 2, BASES[Math.floor(Math.random() * 4)]);
      write(e + 3, randomBaseExcept("G"));
    } else {
      write(e + 2, "G");
      write(e + 3, "G");
      // One mismatch. Seed: the base beside the PAM or the next one in. Distal:
      // the base at the far end or the next one in. The middle base is left
      // alone so the two kinds never blur into each other.
      const pos = kind === "seed"
        ? e - Math.floor(Math.random() * 2)
        : s + Math.floor(Math.random() * 2);
      write(pos, randomBaseExcept(readBase(pos)));
    }
    for (let i = 1; i <= CONFIG.pamLength; i++) cols[e + i].classList.add("pam");
    for (let i = s; i <= e; i++) {
      cols[i].classList.add("candidate", "decoy");
      cols[i].dataset.decoy = kind;
    }
    decoyRuns.push({ start: s, end: e, kind });
  });

  // Cas9 makes a blunt double-strand break a fixed 3 bp upstream of the PAM,
  // not across the whole protospacer. The base immediately 3' of the break
  // carries the line on its leading edge. With decoys on screen the line
  // would give the answer away, so it waits for the cut itself.
  const breakIndex = Math.max(start, end - CONFIG.cutOffsetFromPam + 1);
  if (decoys === 0) {
    cols[breakIndex].classList.add("cut-site");
    // One label, centred under the middle base of the motif.
    cols[end + 2].classList.add("pam-label");
  }

  // Named windowMs so it does not shadow the global `window`.
  const windowMs = currentWindow();
  state.activeTarget = {
    start, end, breakIndex, guide, spawnedAt: performance.now(), window: windowMs, restore,
    decoys: decoyRuns,
  };
  relabelColumns();
  showGuide(guide);
  setStatus(decoys > 0 ? "Which site matches the guide? Check its PAM." : "Target locked. Cut it!", true);

  state.timers.expiry = setTimeout(onExpire, windowMs);
}

function onExpire() {
  if (!state.activeTarget) return;
  clearTarget();
  state.combo = 1;
  el.combo.textContent = "\u00d71";
  state.misses++;
  state.consecutivePerfects = 0;
  updateAccuracyDisplay();
  setStatus("The site got away. Combo reset.", false);
  scheduleSpawn(CONFIG.gapAfterMiss);
}

function clearTarget() {
  clearTimeout(state.timers.expiry);
  // Put back the bases the PAM overwrote, so the strand keeps its composition.
  if (state.activeTarget && state.activeTarget.restore) {
    const cols = columns();
    state.activeTarget.restore.forEach((r) => setBase(cols[r.index], r.base));
  }
  columns().forEach((c) => {
    c.classList.remove("candidate", "in-target", "decoy", "pam", "pam-label", "cut-site", "breaking");
    delete c.dataset.decoy;
  });
  relabelColumns();
  // The guide goes with its target. Leaving the last one up between spawns
  // would invite reading a sequence that no longer applies.
  showGuide(null);
  state.activeTarget = null;
}

// ---------- 7. CLICKS + SCORING ----------
function handleStrandClick(e) {
  const col = e.target.closest(".col");
  if (!col) return;
  // A click also parks the keyboard cursor there, so switching input
  // mid-round never leaves the cursor somewhere surprising.
  setCursor(Number(col.dataset.index));
  attemptCut(col);
}

// Every way of cutting - mouse, touch, keyboard - lands here, so scoring,
// the off-target penalty and the lockout cannot drift apart by input.
function attemptCut(col) {
  if (!state.running || !col) return;

  // Blades are still jammed from the last bad cut: this cut does nothing.
  if (performance.now() < state.lockedUntil) return;

  if (!state.activeTarget) {
    // No guide match yet, so there is nothing legitimate to cut here.
    registerOffTarget(col, "Cut before the guide matched. Blades jammed.");
    return;
  }

  if (col.classList.contains("in-target")) {
    registerHit(col);
  } else if (col.dataset.decoy === "distal") {
    registerTolerated(col);
  } else if (col.classList.contains("decoy")) {
    registerOffTarget(col, DECOY_MESSAGES[col.dataset.decoy]);
  } else if (isTargetPam(col)) {
    registerOffTarget(col, "That's the PAM. Cas9 cuts 3 bp upstream of it, never inside.");
  } else {
    registerOffTarget(col, "Off-target cut. Combo lost, blades jammed.");
  }
}

// The three columns immediately 3' of the live target's protospacer.
function isTargetPam(col) {
  const t = state.activeTarget;
  const i = Number(col.dataset.index);
  return !!t && i > t.end && i <= t.end + CONFIG.pamLength;
}

// ---------- keyboard play ----------
// The strand is one focusable listbox with a roving cursor, so a keyboard
// player gets a single Tab stop rather than thirty. Arrows move the cursor,
// Enter or Space cuts there, and the scissors follow it so the amber
// pointer means the same thing whichever hand is driving.
function columnId(i) {
  return "col-" + i;
}

// What a screen reader hears for a column: its base pair, and whether it
// is part of a fluorescing site or the PAM beside one.
function describeColumn(col, i) {
  const [top, bottom] = Array.from(col.querySelectorAll(".base"), (b) => b.textContent);
  let label = "Position " + (i + 1) + ", " + top + " paired with " + bottom;
  if (col.classList.contains("candidate")) label += ", fluorescing";
  if (col.classList.contains("pam")) {
    // With decoys on screen every candidate's triplet is tinted as the place
    // to check, and some of those are not an NGG at all. So the label names
    // the position and leaves the reading to the player, as the screen does.
    const t = state.activeTarget;
    const contested = !!t && !!t.decoys && t.decoys.length > 0;
    label += contested ? ", PAM position" : ", PAM";
  }
  return label;
}

function relabelColumns() {
  columns().forEach((col, i) => col.setAttribute("aria-label", describeColumn(col, i)));
}

function setCursor(i) {
  const cols = columns();
  if (!cols.length) return;
  state.cursor = Math.max(0, Math.min(cols.length - 1, i));
  cols.forEach((c, k) => {
    c.classList.toggle("cursor", k === state.cursor);
    c.setAttribute("aria-selected", k === state.cursor ? "true" : "false");
  });
  el.strand.setAttribute("aria-activedescendant", columnId(state.cursor));
}

function pointScissorsAt(col) {
  const r = col.getBoundingClientRect();
  el.scissors.style.left = r.left + r.width / 2 + "px";
  el.scissors.style.top = r.top + r.height / 2 + "px";
}

// The fluorescing sites on screen, left to right, as their first columns.
// A site is a run of candidate columns; the PAM beside it is not a
// candidate, so runs never merge. Decoys count: a jump lands on a site,
// and reading it is still the job.
function siteStarts() {
  const starts = [];
  let inSite = false;
  columns().forEach((c, i) => {
    const lit = c.classList.contains("candidate");
    if (lit && !inSite) starts.push(i);
    inSite = lit;
  });
  return starts;
}

// The next site along in `dir`, skipping the one the cursor is on, and
// wrapping at the ends. Null when nothing is lit.
function nextSite(dir) {
  const sites = siteStarts();
  if (!sites.length) return null;
  const c = state.cursor;
  if (dir > 0) {
    const ahead = sites.filter((s) => s > c);
    return ahead.length ? ahead[0] : sites[0];
  }
  const behind = sites.filter((s) => s + CONFIG.targetLength - 1 < c);
  return behind.length ? behind[behind.length - 1] : sites[sites.length - 1];
}

function nthSite(n) {
  const sites = siteStarts();
  return n >= 1 && n <= sites.length ? sites[n - 1] : null;
}

function handleStrandKey(e) {
  // Leave browser and OS shortcuts alone: Cmd+1 switches tabs, not sites.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const cols = columns();
  let next = null;
  switch (e.key) {
    case "ArrowLeft":  next = state.cursor - 1; break;
    case "ArrowRight": next = state.cursor + 1; break;
    case "Home":       next = 0; break;
    case "End":        next = cols.length - 1; break;
    // Jumps. A reflex round's window is far too short to walk the strand a
    // column at a time - up to 25 presses inside 650 ms - so J and K hop
    // between fluorescing sites and 1-9 pick one by position. Tab is left
    // alone on purpose: claiming it would trap keyboard focus on the strand.
    case "j": case "J": next = nextSite(+1); break;
    case "k": case "K": next = nextSite(-1); break;
    case "Enter":
    case " ":
      // Between rounds Space is the restart key (handled on document), so
      // only claim it while a round is live.
      if (!state.running) return;
      e.preventDefault();
      pointScissorsAt(cols[state.cursor]);
      snipScissors({ pointerType: "keyboard" });
      attemptCut(cols[state.cursor]);
      return;
    default:
      if (/^[1-9]$/.test(e.key)) next = nthSite(Number(e.key));
      else return;
  }
  if (next === null) return;   // a jump with nothing lit: nowhere to go
  e.preventDefault();
  setCursor(next);
  pointScissorsAt(cols[state.cursor]);
}

// Off-target cutting is the real-world failure mode of CRISPR, so the game
// charges for it: the combo resets, accuracy drops, and the blades jam for
// a moment. That jam is what makes spraying clicks across the strand a
// losing strategy rather than a free way to catch every target instantly.
function registerOffTarget(col, message) {
  state.misses++;
  state.offTargets++;
  state.combo = 1;
  state.consecutivePerfects = 0;
  state.lockedUntil = performance.now() + CONFIG.lockoutMs;

  el.combo.textContent = "\u00d71";
  bump(el.combo);
  updateAccuracyDisplay();
  setStatus(message, false);

  col.classList.add("off-target");
  setTimeout(() => col.classList.remove("off-target"), CONFIG.lockoutMs);
  el.scissors.classList.add("jammed");
  setTimeout(() => el.scissors.classList.remove("jammed"), CONFIG.lockoutMs);

  playJam();
}

// A PAM-distal mismatch is the off-target case that actually happens in a
// lab: Cas9 tolerates it and cuts. So the blades do not jam - Cas9 refused
// nothing. The site is cut for real, with the flash, the break line and the
// snip, and the round's target is spent. Only then does the penalty land:
// the combo goes, it counts as off-target, and there are no points, because
// the wrong site got edited. The enzyme does not protect you; the guide
// design has to.
function registerTolerated(col) {
  const t = state.activeTarget;
  const cols = columns();
  const index = Number(col.dataset.index);
  const run = t.decoys.find((d) => index >= d.start && index <= d.end);

  state.misses++;
  state.offTargets++;
  state.combo = 1;
  state.consecutivePerfects = 0;
  el.combo.textContent = "\u00d71";
  bump(el.combo);
  updateAccuracyDisplay();

  // Spend the target before the animations, as registerHit does, so
  // clearTarget cannot strip them the instant they are added.
  clearTarget();

  for (let i = run.start; i <= run.end; i++) {
    cols[i].classList.add("cut");
    setTimeout(() => cols[i].classList.remove("cut"), 400);
  }
  const breakCol = cols[Math.max(run.start, run.end - CONFIG.cutOffsetFromPam + 1)];
  breakCol.classList.add("cut-site", "breaking");
  setTimeout(() => breakCol.classList.remove("cut-site", "breaking"), 400);
  floatPoints(col, "off-target", true);

  // It cut, then it was bad: the snip, and the thunk on its heels.
  playSnip();
  setTimeout(playJam, 140);

  setStatus(DECOY_MESSAGES.distal, false);
  scheduleSpawn(CONFIG.gapAfterMiss);
}

function registerHit(col) {
  const t = state.activeTarget;
  const cols = columns();

  // reaction bonus: the faster you were inside the window, the more
  const elapsed = performance.now() - t.spawnedAt;
  const speed = Math.max(0, 1 - elapsed / t.window); // 1 = instant
  const bonus = Math.round(CONFIG.basePoints * speed * 0.6);
  let gained = (CONFIG.basePoints + bonus) * state.combo;

  state.cuts++;
  const comboBefore = state.combo;
  state.combo = Math.min(CONFIG.comboCap, state.combo + 1);
  state.maxCombo = Math.max(state.maxCombo, state.combo);

  // Milestone bonus: 500 extra on the cut that lifts the combo to 5 or 10.
  // This used to test the combo before the increment, so once it sat at its
  // cap of 10 every single hit collected the "milestone" again.
  if (state.combo !== comboBefore && state.combo % 5 === 0) {
    gained += 500;
  }
  state.score += gained;

  // Achievement: First Blood
  if (state.cuts === 1) {
    unlockAchievement('firstBlood');
  }

  // Achievement: Speed Demon - a genuinely fast reaction, in absolute time.
  // It used to trigger on 500+ points from one cut, which any combo-5 hit
  // clears on the milestone bonus alone, so it had nothing to do with speed.
  if (elapsed <= CONFIG.speedDemonMs) {
    unlockAchievement('speedDemon');
  }

  // Achievement: Flawless (3 consecutive perfect hits)
  if (speed > 0.8) {
    state.consecutivePerfects++;
    if (state.consecutivePerfects >= 3) {
      unlockAchievement('flawless');
    }
  } else {
    state.consecutivePerfects = 0;
  }

  el.score.textContent = state.score.toLocaleString();
  el.combo.textContent = "\u00d7" + state.combo;
  const diffLevel = getDifficultyLevel();
  el.difficulty.textContent = diffLevel + "%";
  el.difficulty.setAttribute("data-level", diffLevel >= 67 ? "high" : diffLevel >= 34 ? "med" : "low");
  updateAccuracyDisplay();
  bump(el.score);
  bump(el.combo);

  // screen shake on perfect hits (fast reaction)
  if (speed > 0.6) {
    el.stage.classList.add("shake");
    setTimeout(() => el.stage.classList.remove("shake"), 200);
  }

  // Clear the target first: clearTarget strips the site classes, and the
  // cut animations below must outlive that. The next spawn waits
  // gapAfterHit, longer than any of them, so they never collide.
  clearTarget();

  // The protospacer flashes to show which site was edited, but the break
  // itself is drawn at the single scissile position, blunt, 3 bp from the PAM.
  for (let i = t.start; i <= t.end; i++) {
    cols[i].classList.add("cut");
    setTimeout(() => cols[i].classList.remove("cut"), 400);
  }
  const breakCol = cols[t.breakIndex];
  breakCol.classList.add("cut-site", "breaking");
  setTimeout(() => breakCol.classList.remove("cut-site", "breaking"), 400);
  floatPoints(col, "+" + gained.toLocaleString());
  playSnip();

  // Real Cas9 famously stays clamped on its cut product, so the next target
  // means a fresh RNP scanning the strand for PAMs - which is the line.
  setStatus("Clean cut. Scanning for the next PAM.", true);
  scheduleSpawn(CONFIG.gapAfterHit);
}

// difficulty: the window shrinks as you land more cuts.
// The ramp reaches the mode's windowMin at rampCuts, which is about as far
// as a Classic round gets. Zen is endless and used to sit flat there
// forever: every cut past 25 was identical, and the Zen board measured
// nothing but who played longest. So past the ramp the window keeps
// easing down - exponentially, so it is never a cliff - toward the mode's
// floor, which for Zen is tough enough to break a combo eventually and
// never so tight as to be impossible.
function currentWindow() {
  const m = mode();
  const ramp = Math.min(1, state.cuts / CONFIG.rampCuts);
  let w = m.windowStart - (m.windowStart - m.windowMin) * ramp;
  if (state.cuts > CONFIG.rampCuts) {
    const beyond = state.cuts - CONFIG.rampCuts;
    const squeeze = 1 - Math.exp(-beyond / CONFIG.lateRampCuts);
    w = m.windowMin - (m.windowMin - m.windowFloor) * squeeze;
  }
  return Math.round(w);
}

// ---------- 8. SOUND (synthesised, no files) ----------
let audioCtx = null;

// iOS Safari creates the context suspended until a user gesture, and both
// play functions run inside tap handlers, so resuming here is enough.
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playSnip() {
  if (state.muted) return;
  try {
    ensureAudio();
    const now = audioCtx.currentTime;
    // two quick metallic blips for a "snik-snik"
    [0, 0.07].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(880, now + offset);
      osc.frequency.exponentialRampToValueAtTime(320, now + offset + 0.05);
      gain.gain.setValueAtTime(0.12, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.07);
    });
  } catch (err) {
    /* audio is a nice-to-have; ignore if the browser blocks it */
  }
}

// A dull thunk for a bad cut, deliberately unlike the bright snip.
function playJam() {
  if (state.muted) return;
  try {
    ensureAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.18);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  } catch (err) {
    /* audio is a nice-to-have; ignore if the browser blocks it */
  }
}

function toggleMute() {
  state.muted = !state.muted;
  el.muteBtn.textContent = state.muted ? "Sound: off" : "Sound: on";
  el.muteBtn.setAttribute("aria-pressed", String(state.muted));
}

// ---------- 9. HELPERS ----------
function setBase(col, letter) {
  const [topEl, bottomEl] = col.querySelectorAll(".base");
  topEl.textContent = letter;
  topEl.className = "base base-" + letter;
  const comp = COMPLEMENT[letter];
  bottomEl.textContent = comp;
  bottomEl.className = "base base-" + comp;
}

function setStatus(text, hot) {
  el.status.textContent = text;
  el.status.classList.toggle("hot", !!hot);
}

function randomBaseExcept(letter) {
  const pool = BASES.filter((b) => b !== letter);
  return pool[Math.floor(Math.random() * pool.length)];
}

// The guide is RNA, so it is shown 5' to 3' with U in place of T. Its spacer
// matches the protospacer on the top strand and pairs with the bottom one.
function showGuide(bases) {
  if (!el.guideSeq) return;
  if (!bases) {
    el.guideSeq.textContent = "—";
    return;
  }
  el.guideSeq.innerHTML = bases.map((b) => {
    const r = b === "T" ? "U" : b;
    return `<span class="base base-${r}">${r}</span>`;
  }).join("");
}

function bump(node) {
  node.classList.remove("bump");
  void node.offsetWidth; // restart the animation
  node.classList.add("bump");
}

function floatPoints(col, text, bad) {
  const pop = document.createElement("div");
  pop.className = bad ? "pop bad" : "pop";
  pop.textContent = text;
  const rect = col.getBoundingClientRect();
  const stageRect = el.stage.getBoundingClientRect();
  pop.style.left = rect.left - stageRect.left + rect.width / 2 + "px";
  pop.style.top = rect.top - stageRect.top - 6 + "px";
  el.stage.appendChild(pop);
  setTimeout(() => pop.remove(), 700);

  // particle burst effect: a celebration, so a bad outcome skips it
  if (bad) return;
  for (let i = 0; i < 6; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    const angle = (i / 6) * Math.PI * 2;
    const vx = Math.cos(angle) * 80;
    const vy = Math.sin(angle) * 80;
    particle.style.left = (rect.left - stageRect.left + rect.width / 2) + "px";
    particle.style.top = (rect.top - stageRect.top + rect.height / 2) + "px";
    particle.style.setProperty("--vx", vx);
    particle.style.setProperty("--vy", vy);
    el.stage.appendChild(particle);
    setTimeout(() => particle.remove(), 600);
  }
}

function moveScissors(e) {
  // A finger is not a cursor: the scissors are hidden on touch devices,
  // so do not drag them to the last tap point on hybrid screens either.
  if (e.pointerType === "touch") return;
  el.scissors.style.left = e.clientX + "px";
  el.scissors.style.top = e.clientY + "px";
}

function snipScissors(e) {
  if (!state.running) return;
  if (e.pointerType === "touch") return; // scissors are hidden on touch
  if (performance.now() < state.lockedUntil) return; // jammed: no snip animation
  el.scissors.classList.add("snip");
  // Held past the 55ms close so the shut pose is actually visible.
  setTimeout(() => el.scissors.classList.remove("snip"), 150);
}

function clearTimers() {
  clearInterval(state.timers.round);
  clearTimeout(state.timers.spawn);
  clearTimeout(state.timers.expiry);
}

function endMessage(cuts, acc, record) {
  if (record) return "Sharpest editing yet. Cas9 would be proud.";
  if (cuts === 0) return "The glow is your cue. Click it the instant it lights up.";
  if (state.offTargets > cuts) return "Too many off-target cuts. Wait for the glow instead of clicking through it.";
  if (acc >= 90) return "Surgical precision. Try chaining longer combos next.";
  if (acc >= 60) return "Solid work. A little faster and the multiplier climbs.";
  return "Keep an eye on the PAM. The cut always lands 3 bp upstream of it.";
}

// ---------- accuracy display ----------
function updateAccuracyDisplay() {
  if (!state.running) return;
  const total = state.cuts + state.misses;
  if (total === 0) {
    el.accuracyDisplay.textContent = "Accuracy: —";
  } else {
    const acc = Math.round((state.cuts / total) * 100);
    el.accuracyDisplay.textContent = `Accuracy: ${acc}%`;
  }
}

// ---------- achievements ----------
// Achievements persist across sessions in localStorage so they represent
// lasting progression, not just what happened in the current round.
function loadUnlockedAchievements() {
  try {
    const ids = JSON.parse(localStorage.getItem("cutsite-achievements") || "[]");
    return Array.isArray(ids) ? ids : [];
  }
  catch (e) { return []; }
}

function persistAchievement(achievementId) {
  try {
    const ids = loadUnlockedAchievements();
    if (!ids.includes(achievementId)) {
      ids.push(achievementId);
      localStorage.setItem("cutsite-achievements", JSON.stringify(ids));
    }
  }
  catch (e) { /* private mode: skip saving */ }
}

function unlockAchievement(achievementId) {
  if (!state.earnedAchievements.includes(achievementId)) {
    state.earnedAchievements.push(achievementId);
  }
  persistAchievement(achievementId);
}

// The end card lists every achievement, not just the ones this round
// earned. Locked ones sit dimmed with the way to earn them, so a player can
// see what is left instead of discovering trophies by accident.
function renderAchievements(newlyUnlocked) {
  const unlocked = loadUnlockedAchievements();
  const ids = Object.keys(ACHIEVEMENTS);
  const tiles = ids.map((id) => {
    const a = ACHIEVEMENTS[id];
    const isNew = newlyUnlocked.includes(id);
    const isUnlocked = unlocked.includes(id);
    const status = isNew ? "new" : isUnlocked ? "unlocked" : "locked";
    // The lock glyph is decoration; the words are what a screen reader gets.
    const mark = isUnlocked
      ? '<span class="sr-only">Unlocked: </span>'
      : '<span class="sr-only">Locked: </span><span aria-hidden="true">\u{1F512} </span>';
    const badge = isNew ? ' <span class="achievement-new">NEW</span>' : "";
    return `<div class="achievement ${status}">` +
      `<div class="achievement-name">${mark}${a.name}${badge}</div>` +
      `<div class="achievement-desc">${a.desc}</div></div>`;
  }).join("");

  el.achievements.innerHTML =
    `<div class="achievement-progress">\u{1F3C6} ${unlocked.length} / ${ids.length} achievements unlocked</div>` +
    `<div class="achievement-grid">${tiles}</div>`;
}

function checkAchievements() {
  const accuracy = state.cuts + state.misses === 0
    ? 0
    : Math.round((state.cuts / (state.cuts + state.misses)) * 100);

  // Achievement: Combo Master (10+ combo)
  if (state.maxCombo >= 10) {
    unlockAchievement('comboMaster');
  }

  // Achievement: Precision (90%+ accuracy)
  if (accuracy >= 90 && state.cuts >= 5) {
    unlockAchievement('perfect');
  }

  // Achievement: On Target (a full round without a single stray snip)
  if (state.cuts >= 10 && state.offTargets === 0) {
    unlockAchievement('onTarget');
  }
}

// ---------- score management in the browser ----------
// Every mode keeps its own board. Zen is endless and Guide RNA scores on a
// different clock, so a shared top ten would bury every Classic run.
function scoresKey(mode) {
  return "cutsite-scores-" + (MODES[mode] ? mode : "classic");
}

// One-time migration of the old shared keys into the Classic board.
// The pre-Zen game was Classic-only, so legacy scores belong there.
function migrateLegacyScores() {
  try {
    const legacyBest = localStorage.getItem("cutsite-best");
    const legacyScores = localStorage.getItem("cutsite-scores");
    if (!legacyBest && !legacyScores) return;

    const migrated = [];
    if (legacyScores) {
      const parsed = JSON.parse(legacyScores);
      if (Array.isArray(parsed)) parsed.forEach((s) => migrated.push(Number(s)));
    }
    if (legacyBest) migrated.push(Number(legacyBest));

    const existing = JSON.parse(localStorage.getItem(scoresKey("classic")) || "[]");
    const combined = existing.concat(migrated)
      .map(normalizeEntry).filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    localStorage.setItem(scoresKey("classic"), JSON.stringify(combined));
    localStorage.removeItem("cutsite-best");
    localStorage.removeItem("cutsite-scores");
  }
  catch (e) { /* ignore migration failures */ }
}

// A board entry is { score, cuts, accuracy, maxCombo, offTargets, date }.
// Earlier versions stored bare numbers. Those are upgraded to { score } on
// load and written back once, so an old board keeps every score it had and
// only lacks the detail newer rounds carry.
function normalizeEntry(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return { score: raw };
  if (raw && typeof raw === "object" && Number.isFinite(raw.score)) return raw;
  return null;
}

function loadScores(mode) {
  try {
    migrateLegacyScores();
    const key = scoresKey(mode);
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(raw)) return [];
    const entries = raw.map(normalizeEntry).filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    if (raw.some((x) => typeof x === "number")) {
      localStorage.setItem(key, JSON.stringify(entries));
    }
    return entries;
  }
  catch (e) { return []; }
}

// Returns the entry as stored, so the caller can find it on the board.
function saveScore(entry, mode) {
  const saved = normalizeEntry(entry);
  if (!saved) return null;
  try {
    const entries = loadScores(mode);
    entries.push(saved);
    entries.sort((a, b) => b.score - a.score); // stable: an equal score ranks below the older one
    localStorage.setItem(scoresKey(mode), JSON.stringify(entries.slice(0, 10)));
  }
  catch (e) { /* private mode: skip saving */ }
  return saved;
}

function getBestScore(mode) {
  const entries = loadScores(mode);
  return entries.length > 0 ? entries[0].score : 0;
}

// ---------- leaderboard rendering ----------
function formatEntryDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

// One row per entry: rank, score, then accuracy and date. Cuts, best combo
// and off-target count ride along in the tooltip so the row stays one line
// and the card keeps fitting. The round just played is marked so you can
// see where it landed.
function renderLeaderboard(modeName, justSaved) {
  const entries = loadScores(modeName);
  const label = (MODES[modeName] || MODES.classic).label;
  const rows = entries.map((e) => {
    const isYou = !!justSaved && e.date === justSaved.date && e.score === justSaved.score;
    const meta = [];
    if (Number.isFinite(e.accuracy)) meta.push(e.accuracy + "%");
    const when = formatEntryDate(e.date);
    if (when) meta.push(when);
    const detail = [];
    if (Number.isFinite(e.cuts)) detail.push(e.cuts + (e.cuts === 1 ? " cut" : " cuts"));
    if (Number.isFinite(e.maxCombo)) detail.push("best combo \u00d7" + e.maxCombo);
    if (Number.isFinite(e.offTargets)) detail.push(e.offTargets + " off-target");
    const title = detail.length ? ` title="${detail.join(" · ")}"` : "";
    return `<li${isYou ? ' class="you"' : ""}${title}>` +
      `<span class="lb-score">${e.score.toLocaleString()}</span>` +
      `<span class="lb-meta">${meta.length ? meta.join(" · ") : "—"}</span></li>`;
  }).join("");
  el.leaderboard.innerHTML =
    `<div class="leaderboard-title">${label} — top scores</div><ol>${rows}</ol>`;
}

// Display difficulty indicator: how far the window has closed, from the
// mode's opening width to its floor. Reading it off the window rather than
// the cut count is what stops it parking at 100% in Zen.
function getDifficultyLevel() {
  const m = mode();
  const span = m.windowStart - m.windowFloor;
  if (span <= 0) return 0;
  return Math.round(((m.windowStart - currentWindow()) / span) * 100);
}

// Spacebar restarts from the game-over card. Escape ends an untimed round,
// the same as the Stop button; timed rounds are left alone, so a stray
// Escape can never forfeit a Classic run.
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !state.running && el.cardEnd.classList.contains("hidden") === false) {
    e.preventDefault();
    startGame();
  }
  if (e.key === "Escape" && state.running && !mode().timed) {
    e.preventDefault();
    endGame();
  }
});
