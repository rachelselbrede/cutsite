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
     4. After 60 seconds the round ends and your best score
        is saved in the browser.
   The code is grouped into: config, state, setup, the DNA
   strand, the target loop, scoring, sound, and helpers.
   ============================================================ */

// ---------- 1. CONFIG ----------
const CONFIG = {
  roundSeconds: 60,      // length of one round
  strandLength: 30,      // number of base pairs drawn
  targetLength: 5,       // how many bases fluoresce at once
  basePoints: 100,       // points before combo + speed bonus
  comboCap: 10,          // combo multiplier stops climbing here
  windowStart: 1500,     // ms you get to click an early target
  windowMin: 650,        // ms window once you are fully warmed up
  gapAfterHit: 420,      // pause before the next target appears
  gapAfterMiss: 650,
};

// DNA base pairing. Cas9 needs a PAM (here we use "GG") just
// 3' of the target, so we make sure one shows up at the target end.
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
};

// ---------- 3. DOM + SETUP ----------
const el = {
  strand: document.getElementById("strand"),
  status: document.getElementById("status"),
  score: document.getElementById("score"),
  combo: document.getElementById("combo"),
  time: document.getElementById("time"),
  best: document.getElementById("best"),
  overlay: document.getElementById("overlay"),
  cardStart: document.getElementById("card-start"),
  cardEnd: document.getElementById("card-end"),
  startBtn: document.getElementById("start-btn"),
  againBtn: document.getElementById("again-btn"),
  muteBtn: document.getElementById("mute-btn"),
  finalScore: document.getElementById("final-score"),
  finalCuts: document.getElementById("final-cuts"),
  finalAcc: document.getElementById("final-acc"),
  endTitle: document.getElementById("end-title"),
  endNote: document.getElementById("end-note"),
  scissors: document.getElementById("scissors"),
  stage: document.getElementById("stage"),
};

el.best.textContent = loadBest();

el.startBtn.addEventListener("click", startGame);
el.againBtn.addEventListener("click", startGame);
el.muteBtn.addEventListener("click", toggleMute);

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

  el.score.textContent = "0";
  el.combo.textContent = "\u00d71";
  el.time.textContent = CONFIG.roundSeconds;
  el.time.classList.remove("low");
  el.overlay.classList.add("hidden");
  el.scissors.classList.add("active");
  el.stage.style.cursor = "none";
  setStatus("Guide RNA loaded. Watch for the glow.", false);

  // countdown
  state.timers.round = setInterval(() => {
    state.timeLeft--;
    el.time.textContent = state.timeLeft;
    if (state.timeLeft <= 10) el.time.classList.add("low");
    if (state.timeLeft <= 0) endGame();
  }, 1000);

  scheduleSpawn(600);
}

function endGame() {
  state.running = false;
  clearTimers();
  clearTarget();
  el.scissors.classList.remove("active");
  el.stage.style.cursor = "";

  const best = loadBest();
  const isRecord = state.score > best;
  if (isRecord) saveBest(state.score);
  el.best.textContent = loadBest();

  const accuracy = state.cuts + state.misses === 0
    ? 0
    : Math.round((state.cuts / (state.cuts + state.misses)) * 100);

  el.finalScore.textContent = state.score.toLocaleString();
  el.finalCuts.textContent = state.cuts;
  el.finalAcc.textContent = accuracy + "%";
  el.endTitle.textContent = isRecord ? "New personal best" : "Round complete";
  el.endNote.textContent = endMessage(state.cuts, accuracy, isRecord);

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
  // Leave room for the target plus its PAM at the 3' end.
  const maxStart = CONFIG.strandLength - CONFIG.targetLength - 1;
  const start = Math.floor(Math.random() * maxStart);
  const end = start + CONFIG.targetLength - 1;

  // Force a PAM ("GG") on the two bases just past the target so the
  // cut site is biologically motivated, and tag them for the label.
  setBase(cols[end + 1], "G");
  setBase(cols[end + 2], "G");
  cols[end + 1].classList.add("pam");
  cols[end + 2].classList.add("pam");

  for (let i = start; i <= end; i++) cols[i].classList.add("in-target");

  const window = currentWindow();
  state.activeTarget = { start, end, spawnedAt: performance.now(), window };
  setStatus("Target locked. Cut it!", true);

  state.timers.expiry = setTimeout(onExpire, window);
}

function onExpire() {
  if (!state.activeTarget) return;
  clearTarget();
  state.combo = 1;
  el.combo.textContent = "\u00d71";
  state.misses++;
  setStatus("The site got away. Combo reset.", false);
  scheduleSpawn(CONFIG.gapAfterMiss);
}

function clearTarget() {
  clearTimeout(state.timers.expiry);
  columns().forEach((c) => c.classList.remove("in-target", "pam"));
  state.activeTarget = null;
}

// ---------- 7. CLICKS + SCORING ----------
function handleStrandClick(e) {
  if (!state.running || !state.activeTarget) return;

  const col = e.target.closest(".col");
  const hit = col && col.classList.contains("in-target");

  if (hit) {
    registerHit(col, e);
  } else {
    // A stray snip on plain DNA. Kept gentle: no combo loss.
    setStatus("Missed the strand. No damage done.", false);
  }
}

function registerHit(col, e) {
  const t = state.activeTarget;
  const cols = columns();

  // reaction bonus: the faster you were inside the window, the more
  const elapsed = performance.now() - t.spawnedAt;
  const speed = Math.max(0, 1 - elapsed / t.window); // 1 = instant
  const bonus = Math.round(CONFIG.basePoints * speed * 0.6);
  const gained = (CONFIG.basePoints + bonus) * state.combo;

  state.score += gained;
  state.cuts++;
  state.combo = Math.min(CONFIG.comboCap, state.combo + 1);

  el.score.textContent = state.score.toLocaleString();
  el.combo.textContent = "\u00d7" + state.combo;
  bump(el.score);
  bump(el.combo);

  // visual + audio snip across the whole target window
  for (let i = t.start; i <= t.end; i++) {
    cols[i].classList.add("cut");
    setTimeout(() => cols[i].classList.remove("cut"), 400);
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
}

function moveScissors(e) {
  el.scissors.style.left = e.clientX + "px";
  el.scissors.style.top = e.clientY + "px";
}

function snipScissors() {
  if (!state.running) return;
  el.scissors.classList.add("snip");
  setTimeout(() => el.scissors.classList.remove("snip"), 110);
}

function clearTimers() {
  clearInterval(state.timers.round);
  clearTimeout(state.timers.spawn);
  clearTimeout(state.timers.expiry);
}

function endMessage(cuts, acc, record) {
  if (record) return "Sharpest editing yet. Cas9 would be proud.";
  if (cuts === 0) return "The glow is your cue. Click it the instant it lights up.";
  if (acc >= 90) return "Surgical precision. Try chaining longer combos next.";
  if (acc >= 60) return "Solid work. A little faster and the multiplier climbs.";
  return "Keep an eye on the PAM. That is where the cut lands.";
}

// ---------- best score in the browser ----------
function loadBest() {
  try { return Number(localStorage.getItem("cutsite-best") || 0); }
  catch (e) { return 0; }
}
function saveBest(value) {
  try { localStorage.setItem("cutsite-best", String(value)); }
  catch (e) { /* private mode: skip saving */ }
}
