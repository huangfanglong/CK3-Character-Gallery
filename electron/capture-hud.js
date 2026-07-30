const beacon = document.querySelector('#capture-beacon');
const label = document.querySelector('#capture-label');
const detail = document.querySelector('#capture-detail');
const time = document.querySelector('#capture-time');
const captureHudStates = new Set(['armed', 'starting', 'recording', 'saving', 'saved', 'failed']);
let clockTimer = null;
let audioContext = null;
let previousState = '';
let cueGeneration = 0;
let audioOperation = Promise.resolve();
const activeOscillators = new Set();

function elapsedLabel(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function stopClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  time.hidden = true;
}

function startClock(startedAt) {
  stopClock();
  const update = () => { time.textContent = elapsedLabel(startedAt); };
  update();
  time.hidden = false;
  clockTimer = setInterval(update, 250);
}

function tone(frequency, start, duration, context) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(.12, start + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  activeOscillators.add(oscillator);
  oscillator.addEventListener('ended', () => activeOscillators.delete(oscillator), { once: true });
  oscillator.start(start);
  oscillator.stop(start + duration + .02);
}

function playCue(name, generation) {
  const patterns = {
    start: [[620, 0, .08], [880, .09, .11]],
    stop: [[740, 0, .08], [430, .09, .12]],
    success: [[520, 0, .07], [660, .08, .07], [880, .16, .14]],
    failure: [[330, 0, .12], [220, .13, .2]],
  };
  if (!patterns[name]) return;
  try {
    audioContext ||= new AudioContext();
    const context = audioContext;
    audioOperation = audioOperation.catch(() => {}).then(async () => {
      if (generation !== cueGeneration || context.state === 'closed') return;
      if (context.state === 'suspended') await context.resume();
      if (generation !== cueGeneration || context.state === 'closed') return;
      const start = audioContext.currentTime + .01;
      patterns[name].forEach(([frequency, offset, duration]) => tone(frequency, start + offset, duration, context));
    }).catch(() => {});
  } catch { /* Visual feedback remains available if audio initialization fails. */ }
}

function suspendAudio() {
  for (const oscillator of activeOscillators) {
    try { oscillator.stop(); } catch { /* The oscillator may already have ended. */ }
  }
  activeOscillators.clear();
  const context = audioContext;
  if (!context || context.state === 'closed') return;
  audioOperation = audioOperation.catch(() => {}).then(async () => {
    if (context.state === 'running') await context.suspend();
  }).catch(() => {});
}

function hideCaptureHud() {
  cueGeneration += 1;
  stopClock();
  suspendAudio();
  beacon.className = 'beacon hidden';
  label.textContent = '';
  detail.textContent = '';
  previousState = '';
}

function updateCaptureHud(status) {
  if (status?.state === 'hidden') { hideCaptureHud(); return; }
  if (!captureHudStates.has(status?.state) || typeof status.label !== 'string' || typeof status.detail !== 'string') return;
  beacon.className = `beacon ${status.state}`;
  label.textContent = status.label;
  detail.textContent = status.detail;
  if (status.state === 'recording' && status.startedAt > 0) startClock(status.startedAt);
  else stopClock();
  if (status.state !== previousState) {
    cueGeneration += 1;
    playCue(status.sound, cueGeneration);
  }
  previousState = status.state;
}

window.captureHud.onState(updateCaptureHud);
window.captureHud.ready();
