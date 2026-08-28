/* ============================================================
   CutSite  -  game logic
   ------------------------------------------------------------
   How a round works:
     1. A strand of DNA is drawn as a row of base pairs.
     2. Every so often a short window of bases starts to
        fluoresce (glow) next to a PAM site. That is the target.
     3. You click the glow before its timer runs out.
        - A fast click scores more and builds your combo.
        - Letting it expire breaks the combo.
        - Cutting plain DNA is an OFF-TARGET cut: it breaks the
          combo and jams the blades for a moment, so spraying
          clicks across the strand costs you the round.
     4. After 30 seconds (classic) or unlimited time (zen)
        the round ends and your score is saved in the browser.
   The code is grouped into: config, state, setup, the DNA
   strand, the target loop, scoring, achievements, sound, and helpers.
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
  gapAfterHit: 420,      // pause before the next target appears
  gapAfterMiss: 650,
  lockoutMs: 450,        // blades jam this long after an off-target cut
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
  activeTarget: null,   // { start, end, spawnedAt, window, expiry }
  timers: { round: null, spawn: null, expiry: null },
  muted: false,
  gameMode: 'classic',  // 'classic' or 'zen'
  earnedAchievements: [], // achievements earned this round
  previouslyUnlocked: [], // achievements already unlocked before this round (from storage)
  maxCombo: 1,
  consecutivePerfects: 0,
  offTargets: 0,        // stray cuts on non-target DNA this round
  lockedUntil: 0,       // performance.now() timestamp the blades free up
};

// ---------- 1.5. ACHIEVEMENTS ----------
const ACHIEVEMENTS = {
  firstBlood: { id: 'firstBlood', name: 'First Blood', desc: 'Make your first cut' },
  comboMaster: { id: 'comboMaster', name: 'Combo Master', desc: 'Reach a 10+ combo streak' },
  speedDemon: { id: 'speedDemon', name: 'Speed Demon', desc: 'Score 500+ points on a single cut' },
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
  best: document.getElementById("best"),
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

if (el.best) el.best.textContent = getBestScore(state.gameMode);

// Ensure event listeners are attached after DOM is ready
if (el.startBtn) el.startBtn.addEventListener("click", startGame);
if (el.againBtn) el.againBtn.addEventListener("click", startGame);
if (el.muteBtn) el.muteBtn.addEventListener("click", toggleMute);
if (el.stopBtn) el.stopBtn.addEventListener("click", endGame);

// Mode selection listeners
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("selected"));
    e.target.classList.add("selected");
    state.gameMode = e.target.dataset.mode;
  });
});

// A single click handler on the strand decides hit vs miss.
el.strand.addEventListener("click", handleStrandClick);

// The scissors follow the pointer while a round is live.
document.addEventListener("pointermove", moveScissors);
document.addEventListener("pointerdown", snipScissors);

buildStrand();

// ---------- 4. THE DNA STRAND ----------
function buildStrand() {
  el.strand.innerHTML = "";
  for (let i = 0; i < CONFIG.strandLength; i++) {
    const top = BASES[Math.floor(Math.random() * 4)];
    const bottom = COMPLEMENT[top];

    const col = document.createElement("div");
    col.className = "col";
    col.dataset.index = i;
    col.innerHTML = `
      <span class="base base-${top}">${top}</span>
      <span class="rung"></span>
      <span class="base base-${bottom}">${bottom}</span>`;
    el.strand.appendChild(col);
  }
}

function columns() {
  return Array.from(el.strand.children);
}

// ---------- 5. GAME FLOW ----------
function startGame() {
  clearTimers();
  buildStrand();

  state.running = true;
  state.score = 0;
  state.combo = 1;
  state.cuts = 0;
  state.misses = 0;
  state.timeLeft = CONFIG.roundSeconds;
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
  el.time.textContent = CONFIG.roundSeconds;
  el.time.classList.remove("low");
  el.overlay.classList.add("hidden");
  el.scissors.classList.add("active");
  // Position scissors at center of screen so they're visible immediately
  initializeScissors();
  el.stage.style.cursor = "none";
  setStatus("Guide RNA loaded. Watch for the glow.", false);

  // Show/hide timer and stop button based on mode
  if (state.gameMode === 'zen') {
    el.time.classList.add("hidden");
    el.stopBtn.classList.remove("hidden");
  } else {
    el.time.classList.remove("hidden");
    el.stopBtn.classList.add("hidden");
  }

  // countdown (only for classic mode)
  if (state.gameMode === 'classic') {
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
  saveScore(state.score, mode);
  if (el.best) el.best.textContent = getBestScore(mode);

  const accuracy = state.cuts + state.misses === 0
    ? 0
    : Math.round((state.cuts / (state.cuts + state.misses)) * 100);

  // Check for achievements
  checkAchievements();

  if (el.finalScore) el.finalScore.textContent = state.score.toLocaleString();
  el.finalCuts.textContent = state.cuts;
  el.finalAcc.textContent = accuracy + "%";
  if (el.finalOff) el.finalOff.textContent = state.offTargets;
  el.endTitle.textContent = isRecord ? "New personal best" : "Round complete";
  el.endNote.textContent = endMessage(state.cuts, accuracy, isRecord);

  // Display achievements (remove any panel left over from a previous round)
  const staleAchievements = el.cardEnd.querySelector(".achievements-earned");
  if (staleAchievements) staleAchievements.remove();

  const unlocked = loadUnlockedAchievements();
  const totalAchievements = Object.keys(ACHIEVEMENTS).length;
  // Newly unlocked this round = earned now but not owned before the round started.
  const newlyUnlocked = state.earnedAchievements.filter(
    (id) => !state.previouslyUnlocked.includes(id)
  );

  const achievementsDiv = document.createElement("div");
  achievementsDiv.className = "achievements-earned";
  let achHTML = `<div class="achievement-progress">🏆 ${unlocked.length} / ${totalAchievements} achievements unlocked</div>`;
  achHTML += newlyUnlocked.map((id) => {
    const ach = ACHIEVEMENTS[id];
    return `<div class="achievement"><div class="achievement-name">${ach.name} <span class="achievement-new">NEW</span></div><div class="achievement-desc">${ach.desc}</div></div>`;
  }).join("");
  achievementsDiv.innerHTML = achHTML;
  el.cardEnd.insertBefore(achievementsDiv, el.cardEnd.querySelector(".scoreline"));

  // Populate leaderboard for the mode just played
  const scores = loadScores(mode);
  const boardLabel = mode === "zen" ? "Zen" : "Classic";
  const leaderboardHTML = scores.slice(0, 10).map((s) =>
    `<li>${s.toLocaleString()}</li>`
  ).join("");
  el.leaderboard.innerHTML =
    `<div class="leaderboard-title">${boardLabel} — top scores</div><ol>${leaderboardHTML}</ol>`;

  el.cardStart.classList.add("hidden");
  el.cardEnd.classList.remove("hidden");
  el.overlay.classList.remove("hidden");
}

// ---------- 6. THE TARGET LOOP ----------
function scheduleSpawn(delay) {
  state.timers.spawn = setTimeout(spawnTarget, delay);
}

function spawnTarget() {
  if (!state.running) return;

  const cols = columns();
  // Leave room for the protospacer plus the whole PAM at its 3' end.
  const maxStart = CONFIG.strandLength - CONFIG.targetLength - CONFIG.pamLength + 1;
  const start = Math.floor(Math.random() * maxStart);
  const end = start + CONFIG.targetLength - 1;

  // The PAM is NGG. Only the two Gs are fixed; the N keeps whatever base the
  // strand already had, because in NGG the first position genuinely is any
  // base. Tagging all three makes the motif on screen the length it really is.
  //
  // The originals are kept so they can go back when the target clears. Writing
  // Gs in permanently made the strand drift towards poly-G over a round - after
  // 500 spawns the N position was a G 94% of the time - which is not a sequence
  // any genome would produce.
  const restore = [end + 2, end + 3].map((i) => ({
    index: i,
    base: cols[i].querySelector(".base").textContent,
  }));
  setBase(cols[end + 2], "G");
  setBase(cols[end + 3], "G");
  for (let i = 1; i <= CONFIG.pamLength; i++) cols[end + i].classList.add("pam");
  // One label, centred under the middle base of the motif.
  cols[end + 2].classList.add("pam-label");

  for (let i = start; i <= end; i++) cols[i].classList.add("in-target");

  // Cas9 makes a blunt double-strand break a fixed 3 bp upstream of the PAM,
  // not across the whole protospacer. Mark the base immediately 3' of the
  // break so the line can be drawn on its leading edge.
  const breakCol = Math.max(start, end - CONFIG.cutOffsetFromPam + 1);
  cols[breakCol].classList.add("cut-site");

  const window = currentWindow();
  state.activeTarget = { start, end, spawnedAt: performance.now(), window, restore };
  setStatus("Target locked. Cut it!", true);

  state.timers.expiry = setTimeout(onExpire, window);
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
  columns().forEach((c) =>
    c.classList.remove("in-target", "pam", "pam-label", "cut-site", "breaking"));
  state.activeTarget = null;
}

// ---------- 7. CLICKS + SCORING ----------
function handleStrandClick(e) {
  if (!state.running) return;

  const col = e.target.closest(".col");
  if (!col) return;

  // Blades are still jammed from the last bad cut: this click does nothing.
  if (performance.now() < state.lockedUntil) return;

  if (!state.activeTarget) {
    // No guide match yet, so there is nothing legitimate to cut here.
    registerOffTarget(col, "Cut before the guide matched. Blades jammed.");
    return;
  }

  if (col.classList.contains("in-target")) {
    registerHit(col, e);
  } else {
    registerOffTarget(col, "Off-target cut. Combo lost, blades jammed.");
  }
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

function registerHit(col, e) {
  const t = state.activeTarget;
  const cols = columns();

  // reaction bonus: the faster you were inside the window, the more
  const elapsed = performance.now() - t.spawnedAt;
  const speed = Math.max(0, 1 - elapsed / t.window); // 1 = instant
  const bonus = Math.round(CONFIG.basePoints * speed * 0.6);
  let gained = (CONFIG.basePoints + bonus) * state.combo;

  // combo milestone bonuses (500 extra at 5, 10 combo streaks)
  if (state.combo > 0 && state.combo % 5 === 0) {
    gained += 500;
  }

  state.score += gained;
  state.cuts++;
  state.combo = Math.min(CONFIG.comboCap, state.combo + 1);
  state.maxCombo = Math.max(state.maxCombo, state.combo);

  // Achievement: First Blood
  if (state.cuts === 1) {
    unlockAchievement('firstBlood');
  }

  // Achievement: Speed Demon (500+ on single cut)
  if (gained >= 500) {
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

  // The protospacer flashes to show which site was edited, but the break
  // itself is drawn at the single scissile position, blunt, 3 bp from the PAM.
  for (let i = t.start; i <= t.end; i++) {
    cols[i].classList.add("cut");
    setTimeout(() => cols[i].classList.remove("cut"), 400);
  }
  const breakCol = cols.find((c) => c.classList.contains("cut-site"));
  if (breakCol) {
    breakCol.classList.add("breaking");
    setTimeout(() => breakCol.classList.remove("breaking"), 400);
  }
  floatPoints(col, "+" + gained.toLocaleString());
  playSnip();

  clearTarget();
  setStatus("Clean cut. Cas9 moves on.", true);
  scheduleSpawn(CONFIG.gapAfterHit);
}

// difficulty: the window shrinks as you land more cuts
function currentWindow() {
  const ramp = Math.min(1, state.cuts / 25);
  return Math.round(CONFIG.windowStart - (CONFIG.windowStart - CONFIG.windowMin) * ramp);
}

// ---------- 8. SOUND (synthesised, no files) ----------
let audioCtx = null;
function playSnip() {
  if (state.muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

function bump(node) {
  node.classList.remove("bump");
  void node.offsetWidth; // restart the animation
  node.classList.add("bump");
}

function floatPoints(col, text) {
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.textContent = text;
  const rect = col.getBoundingClientRect();
  const stageRect = el.stage.getBoundingClientRect();
  pop.style.left = rect.left - stageRect.left + rect.width / 2 + "px";
  pop.style.top = rect.top - stageRect.top - 6 + "px";
  el.stage.appendChild(pop);
  setTimeout(() => pop.remove(), 700);

  // particle burst effect
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
  el.scissors.style.left = e.clientX + "px";
  el.scissors.style.top = e.clientY + "px";
}

function snipScissors() {
  if (!state.running) return;
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
  return "Keep an eye on the PAM. That is where the cut lands.";
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
// Classic and Zen keep separate boards: Zen is endless, so its scores
// would otherwise swamp the shared top-10 and bury every Classic run.
function scoresKey(mode) {
  return "cutsite-scores-" + (mode === "zen" ? "zen" : "classic");
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
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)
      .slice(0, 10);
    localStorage.setItem(scoresKey("classic"), JSON.stringify(combined));
    localStorage.removeItem("cutsite-best");
    localStorage.removeItem("cutsite-scores");
  }
  catch (e) { /* ignore migration failures */ }
}

function loadScores(mode) {
  try {
    migrateLegacyScores();
    const scores = JSON.parse(localStorage.getItem(scoresKey(mode)) || "[]");
    return Array.isArray(scores) ? scores : [];
  }
  catch (e) { return []; }
}

function saveScore(value, mode) {
  try {
    const scores = loadScores(mode);
    scores.push(value);
    scores.sort((a, b) => b - a); // sort descending
    localStorage.setItem(scoresKey(mode), JSON.stringify(scores.slice(0, 10))); // keep top 10
  }
  catch (e) { /* private mode: skip saving */ }
}

function getBestScore(mode) {
  const scores = loadScores(mode);
  return scores.length > 0 ? scores[0] : 0;
}

// Display difficulty indicator
function getDifficultyLevel() {
  const ramp = Math.min(1, state.cuts / 25);
  return Math.round(ramp * 100);
}

// Spacebar to restart game (press during game over screen)
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !state.running && el.cardEnd.classList.contains("hidden") === false) {
    e.preventDefault();
    startGame();
  }
});
