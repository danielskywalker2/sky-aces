// OPERATION: IRON SKY — 2차대전 대체역사 스타일 세로 스크롤 슈팅 (그래픽·사운드 전부 코드로 생성)
'use strict';
(() => {
const W = 480, H = 640, SS = 4, TAU = Math.PI * 2, PI = Math.PI;
const cv = document.getElementById('game'), ctx = cv.getContext('2d');
let VS = 1;
function resize() {
  const dpr = window.devicePixelRatio || 1, s = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
  cv.width = Math.round(W * s * dpr); cv.height = Math.round(H * s * dpr); VS = cv.width / W;
}
addEventListener('resize', resize); resize();

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ───────────────────────── 입력
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const keys = {}; let pressed = {};
const ptr = { down: 0, id: -1, x: 0, y: 0, dx: 0, dy: 0, tx: 0, ty: 0 };
addEventListener('keydown', e => {
  if (!keys[e.code]) pressed[e.code] = 1; keys[e.code] = 1; if (e.isTrusted) unlockAudio();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = 0; });
cv.addEventListener('pointerdown', e => {
  audio(); if (e.button === 2) return;
  const r = cv.getBoundingClientRect(); ptr.down = 1; ptr.id = e.pointerId; ptr.x = e.clientX; ptr.y = e.clientY;
  ptr.tx = (e.clientX - r.left) / r.width * W; ptr.ty = (e.clientY - r.top) / r.height * H; pressed.Tap = 1;
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
});
cv.addEventListener('pointermove', e => {
  if (!ptr.down || e.pointerId !== ptr.id) return; const r = cv.getBoundingClientRect();
  ptr.dx += (e.clientX - ptr.x) / r.width * W; ptr.dy += (e.clientY - ptr.y) / r.height * H; ptr.x = e.clientX; ptr.y = e.clientY;
});
// 다른 손가락(화면 버튼 등)을 뗄 때 이동·사격이 끊기지 않도록 같은 포인터만 해제. iOS 는 손을 뗄 때 오디오가 풀린다.
const ptrUp = e => { unlockAudio(); if (e.pointerId === ptr.id) ptr.down = 0; };
addEventListener('pointerup', ptrUp); addEventListener('pointercancel', ptrUp);
addEventListener('touchend', unlockAudio); addEventListener('click', unlockAudio);
// ── iOS 소리 대책
// 1) 무음 스위치를 켜 둬도 게임 소리가 나도록 오디오 세션을 '재생' 모드로 (iOS 17+)
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
// 2) iOS 는 손을 뗄 때(touchend/click)만 소리를 허락한다 → 그때 오디오를 깨우고 무음 버퍼를 한 번 재생
// 3) iOS 16 이하는 audioSession 이 없으므로 무음 <audio> 를 반복 재생해 같은 효과를 낸다
let audioPrimed = 0, silentEl = null;
function unlockAudio() {
  audio(); if (!AC) return;
  if (AC.state !== 'running') AC.resume().catch(() => {});
  if (!audioPrimed) { audioPrimed = 1; try { const s = AC.createBufferSource(); s.buffer = AC.createBuffer(1, 1, 22050); s.connect(AC.destination); s.start(0); } catch (_) {} }
  if (!navigator.audioSession && !silentEl && /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
    const n = 800, b = new DataView(new ArrayBuffer(44 + n)), w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); b.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, 8000, true); b.setUint32(28, 8000, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true); w(36, 'data'); b.setUint32(40, n, true);
    for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
    silentEl = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' }))); silentEl.loop = true; silentEl.play().catch(() => { silentEl = null; });
  }
}
// 홈 화면 앱에서 다른 앱 갔다 오면 오디오가 '중단' 상태가 되므로 돌아올 때 다시 깨운다
document.addEventListener('visibilitychange', () => { if (!document.hidden && AC && AC.state !== 'running') AC.resume().catch(() => {}); });
cv.addEventListener('contextmenu', e => { e.preventDefault(); pressed.KeyX = 1; });
const hit = (...c) => c.some(k => pressed[k]);
const held = (...c) => c.some(k => keys[k]);

// ───────────────────────── 사운드 (WebAudio 합성: 컴프레서·리버브·딜레이·디스토션·스테레오 패닝)
let AC = null, master, sfxBus, musBus, boomBus, revSend, delSend, noiseBuf, eng = null, muted = false, song = null, songStep = 0, songT = 0, songTr = 0;
function audio() {
  if (AC) { if (AC.state !== 'running') AC.resume().catch(() => {}); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)(); const sr = AC.sampleRate;
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -15; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = .003; comp.release.value = .2;
    master = AC.createGain(); master.gain.value = muted ? 0 : .85; master.connect(comp); comp.connect(AC.destination);
    sfxBus = AC.createGain(); sfxBus.gain.value = .9; sfxBus.connect(master);
    musBus = AC.createGain(); musBus.gain.value = .5; musBus.connect(master);
    noiseBuf = AC.createBuffer(1, sr * 2, sr); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ir = AC.createBuffer(2, sr * 2, sr); for (let c = 0; c < 2; c++) { const b = ir.getChannelData(c); for (let i = 0; i < b.length; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / b.length, 2.8); }
    const conv = AC.createConvolver(); conv.buffer = ir; revSend = AC.createGain(); revSend.gain.value = .55; revSend.connect(conv); conv.connect(master);
    const dl = AC.createDelay(1), fb = AC.createGain(), dlp = AC.createBiquadFilter(); dl.delayTime.value = .29; fb.gain.value = .34; dlp.type = 'lowpass'; dlp.frequency.value = 2400;
    delSend = AC.createGain(); delSend.gain.value = 1; delSend.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(musBus);
    const sh = AC.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) cv[i] = Math.tanh((i / 512 - 1) * 3.2); sh.curve = cv;
    boomBus = AC.createGain(); boomBus.gain.value = 1; boomBus.connect(sh); sh.connect(sfxBus);
    // 프로펠러 엔진음 (플레이 중 상시)
    const eg = AC.createGain(), lp = AC.createBiquadFilter(), trem = AC.createGain(), lfo = AC.createOscillator(), lg = AC.createGain(); eg.gain.value = 0; lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2;
    lfo.frequency.value = 14; lg.gain.value = .4; lfo.connect(lg); lg.connect(trem.gain); lfo.start();
    const os = [[58, 'sawtooth'], [87.4, 'sawtooth'], [29.2, 'square']].map(([f, ty]) => { const o = AC.createOscillator(); o.type = ty; o.frequency.value = f; o.connect(lp); o.start(); return o; });
    lp.connect(trem); trem.connect(eg); eg.connect(sfxBus); eng = { g: eg, os, lfo };
  } catch (_) { AC = null; }
}
function sndOut(n, o) {
  if (o.pan && AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); n.connect(p); n = p; }
  n.connect(o.bus || sfxBus);
  if (o.rev) { const r = AC.createGain(); r.gain.value = o.rev; n.connect(r); r.connect(revSend); }
  if (o.del) { const r = AC.createGain(); r.gain.value = o.del; n.connect(r); r.connect(delSend); }
}
function tone(f, d, type = 'square', v = .1, f2 = 0, when = 0, o = {}) {
  if (!AC || !(f > 0)) return; const t = AC.currentTime + when, g = AC.createGain();
  g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + (o.a || .004)); g.gain.exponentialRampToValueAtTime(.0008, t + d);
  let dst = g; if (o.lp) { const fl = AC.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = o.q || 1; fl.frequency.setValueAtTime(o.lp, t); if (o.lp2) fl.frequency.exponentialRampToValueAtTime(o.lp2, t + d); fl.connect(g); dst = fl; }
  for (const det of (o.det ? [-o.det, o.det] : [0])) { const os = AC.createOscillator(); os.type = type; os.detune.value = det; os.frequency.setValueAtTime(f, t); if (f2) os.frequency.exponentialRampToValueAtTime(f2, t + d); os.connect(dst); os.start(t); os.stop(t + d + .03); }
  sndOut(g, o);
}
function noise(d, v, f0, f1, when = 0, o = {}) {
  if (!AC) return; const t = AC.currentTime + when, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = o.type || 'lowpass'; f.Q.value = o.q || .7; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + d);
  g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + (o.a || .003)); g.gain.exponentialRampToValueAtTime(.0008, t + d);
  s.connect(f); f.connect(g); sndOut(g, o); s.start(t, Math.random() * 1.5); s.stop(t + d + .03);
}
const NF = n => 440 * Math.pow(2, (n - 69) / 12);
const px = x => x === undefined ? 0 : (x / W - .5) * 1.3, rp = () => .85 + Math.random() * .3;
let lastBoom = 0, lastE = 0, lastCancel = 0, lastTk = 0;
const SFX = {
  shot: () => { const p = rp(); noise(.05, .05, 2600 * p, 900, 0, { type: 'bandpass', q: 1.2 }); tone(820 * p, .05, 'square', .026, 260); tone(170, .06, 'triangle', .06, 70); },
  sub: () => { noise(.3, .06, 700, 4200, 0, { type: 'bandpass', q: 2, a: .04 }); tone(240, .25, 'sawtooth', .03, 520, 0, { lp: 1200 }); },
  tick: x => { if (frame - lastTk < 3) return; lastTk = frame; const o = { pan: px(x) }; noise(.035, .08, 6500, 3000, 0, { type: 'bandpass', q: 3, pan: o.pan }); tone(2300 * rp(), .045, 'sine', .035, 1500, 0, o); },
  eshot: x => { if (frame - lastE < 5) return; lastE = frame; tone(340 * rp(), .07, 'square', .03, 150, 0, { pan: px(x), lp: 1400 }); },
  boom: x => {
    if (frame - lastBoom < 3) return; lastBoom = frame; const p = rp(), o = { pan: px(x), bus: boomBus, rev: .25 };
    noise(.06, .3, 5000, 2000, 0, { ...o, type: 'highpass' }); noise(.38, .5, 2800 * p, 140, 0, o); tone(150 * p, .22, 'sine', .5, 42, 0, o); noise(.05, .12, 4000, 2500, .09 + Math.random() * .08, { ...o, type: 'bandpass', q: 2 });
  },
  mid: x => {
    const p = rp(), o = { pan: px(x), bus: boomBus, rev: .45 };
    noise(.07, .4, 6000, 2500, 0, { ...o, type: 'highpass' }); noise(.85, .7, 2200 * p, 70, 0, o); tone(115 * p, .5, 'sine', .7, 30, 0, o); tone(60, .7, 'triangle', .3, 26, .05, o);
    for (let i = 0; i < 4; i++) noise(.05, .14, 3500, 1500, .12 + Math.random() * .4, { ...o, type: 'bandpass', q: 2.5 });
  },
  big: x => {
    const o = { pan: px(x) * .6, bus: boomBus, rev: .7 };
    noise(.09, .5, 7000, 3000, 0, { ...o, type: 'highpass' }); noise(1.5, .9, 1700, 45, 0, o); noise(2.6, .35, 260, 40, .1, o); tone(88, 1.1, 'sine', .9, 24, 0, o); tone(52, 1.4, 'triangle', .45, 20, .16, o); noise(.9, .5, 1200, 60, .2, o);
    for (let i = 0; i < 7; i++) noise(.06, .16, 3000, 1200, .15 + Math.random() * .9, { ...o, type: 'bandpass', q: 2.5, pan: Math.random() * 2 - 1 });
  },
  power: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .17, 'square', .065, 0, i * .055, { det: 7, lp: 3600, rev: .3 })); tone(131, .42, 'sawtooth', .12, 262, 0, { lp: 900 }); noise(.4, .05, 3000, 9000, 0, { type: 'bandpass', q: 3, a: .1 }); },
  item: () => { [392, 494, 587, 784].forEach((f, i) => tone(f, .16, 'triangle', .12, 0, i * .06, { rev: .3 })); tone(98, .35, 'sawtooth', .12, 196, 0, { lp: 700 }); },
  gold: () => { tone(1568, .09, 'sine', .13); tone(2093, .32, 'sine', .13, 0, .07, { rev: .4 }); tone(3136, .25, 'triangle', .035, 0, .07); },
  bomb: ty => {
    SFX.big();
    if (ty === 'carpet') { tone(1900, .8, 'sine', .1, 380, 0, { rev: .5 }); tone(1500, .9, 'sine', .07, 300, .25, { rev: .5, pan: .5 }); tone(72, 3, 'sawtooth', .22, 60, 0, { det: 14, lp: 320, a: .4 }); noise(3, .2, 300, 120, 0, { a: .5 }); }
    else { tone(110, 2.9, 'sawtooth', .24, 98, 0, { det: 18, lp: 400, lp2: 5200, q: 6, a: .15, rev: .5 }); tone(220, 2.9, 'square', .07, 196, 0, { det: 25, lp: 2600 }); noise(2.9, .26, 2500, 9000, 0, { type: 'bandpass', q: 1.5, a: .2, rev: .4 }); tone(1760, .5, 'sine', .1, 3520, 0, { rev: .6 }); }
  },
  chargeUp: () => tone(150, .95, 'sawtooth', .07, 980, 0, { lp: 500, lp2: 4200, a: .35, det: 9 }),
  chargeReady: () => { tone(1319, .08, 'square', .07); tone(1760, .22, 'square', .07, 0, .07, { rev: .4 }); },
  charge: () => { noise(.5, .35, 600, 7000, 0, { type: 'bandpass', q: 1.2, rev: .4 }); tone(1100, .45, 'sawtooth', .18, 90, 0, { det: 12, lp: 4200, lp2: 500, rev: .4 }); tone(120, .32, 'sine', .5, 40, 0, { bus: boomBus }); },
  die: () => { SFX.big(P && P.x); tone(900, 1.2, 'sawtooth', .22, 45, 0, { det: 20, lp: 3200, lp2: 200, rev: .5 }); },
  hit: () => { noise(.22, .45, 3200, 300, 0, { bus: boomBus }); tone(260, .26, 'square', .16, 55, 0, { lp: 1500 }); },
  warn: () => { const o = { det: 9, lp: 2400, rev: .35 }; tone(587, .3, 'sawtooth', .15, 0, 0, o); tone(587, .3, 'square', .05, 0, 0, o); tone(440, .36, 'sawtooth', .15, 0, .34, o); tone(440, .36, 'square', .05, 0, .34, o); tone(55, .72, 'sawtooth', .16, 0, 0, { lp: 220 }); },
  bossIn: () => { noise(2.8, .32, 130, 60, 0, { a: .9 }); tone(41, 2.8, 'sawtooth', .16, 36, 0, { lp: 170, a: .7, det: 12 }); },
  cancel: () => { if (frame - lastCancel < 10) return; lastCancel = frame; [2637, 3136, 3951, 4699].forEach((f, i) => tone(f, .2, 'sine', .035, 0, i * .03, { rev: .5 })); },
  ok: () => { tone(880, .07, 'square', .08); tone(1320, .16, 'square', .08, 0, .07, { rev: .3 }); },
  sel: () => { tone(700, .05, 'square', .06); noise(.03, .04, 5000, 3000, 0, { type: 'bandpass', q: 2 }); },
  start: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, .14, 'square', .08, 0, i * .07, { det: 8, rev: .4 })); noise(1.1, .12, 400, 6000, 0, { type: 'bandpass', q: 1, a: .5 }); tone(60, 1.1, 'sawtooth', .14, 120, 0, { lp: 400, a: .4 }); },
  ext: () => { [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, .16, 'square', .09, 0, i * .1, { det: 8, rev: .4 })); },
  clear: () => {
    const M = { bus: musBus, det: 8, lp: 4200, rev: .4 };
    for (const [n, t, d] of [[72, 0, .14], [72, .16, .14], [72, .32, .14], [76, .48, .3], [79, .8, .3], [76, 1.12, .14], [79, 1.28, .14], [84, 1.44, 1.1]]) { tone(NF(n), d, 'square', .1, 0, t, M); tone(NF(n - 12), d, 'triangle', .12, 0, t, { bus: musBus }); tone(NF(n - 24), d, 'sawtooth', .1, 0, t, { bus: musBus, lp: 500 }); }
    for (const n of [60, 64, 67]) tone(NF(n), 1.2, 'triangle', .06, 0, 1.44, { bus: musBus, rev: .5 });
    for (let i = 0; i < 6; i++) noise(.05, .12, 5000, 1500, 1.2 + i * .04, { bus: musBus, type: 'bandpass', q: .8 }); noise(1.4, .12, 9000, 4000, 1.44, { bus: musBus, type: 'highpass', rev: .4 });
  },
  over: () => { [[76, 0], [72, .4], [69, .8], [65, 1.2], [64, 1.6]].forEach(([n, t], i) => { tone(NF(n), i === 4 ? 1.6 : .45, 'sawtooth', .1, 0, t, { bus: musBus, det: 10, lp: 1800, rev: .6 }); tone(NF(n - 24), i === 4 ? 1.6 : .45, 'triangle', .14, 0, t, { bus: musBus }); }); },
};
const bars = a => a.flatMap(r => Array(8).fill(r));
const SONGS = {
  stage: { bpm: 150, drive: 1, roots: bars([45, 45, 43, 40, 41, 41, 43, 40, 41, 41, 43, 43, 45, 45, 40, 40]),
    lead: [76,0,76,74,76,0,81,0, 79,0,76,0,74,0,72,0, 74,0,74,72,74,0,79,0, 76,0,0,0,71,0,74,0,
           77,0,77,76,77,0,81,0, 79,0,77,0,76,0,74,0, 76,0,79,0,83,0,81,0, 80,0,76,0,80,0,83,0,
           72,0,77,0,81,0,77,0, 84,0,81,0,77,0,81,0, 74,0,79,0,83,0,79,0, 86,0,83,0,79,0,83,0,
           76,0,81,0,84,0,81,0, 88,0,86,0,84,0,81,0, 80,0,83,0,88,0,86,0, 83,0,80,0,76,0,80,0] },
  boss: { bpm: 178, drive: 2, roots: bars([38, 38, 36, 37, 38, 38, 41, 40]),
    lead: [74,0,77,0,81,0,80,81, 0,77,0,74,0,73,74,0, 72,0,76,0,79,0,78,79, 73,0,76,0,79,0,82,0,
           81,0,86,0,89,0,88,86, 0,84,0,81,0,82,81,0, 84,0,89,0,93,0,91,89, 0,88,0,85,0,88,0,91] },
  title: { bpm: 112, drive: 0, roots: bars([45, 41, 36, 43]),
    lead: [69,0,0,72,0,0,76,0, 77,0,0,76,0,0,72,0, 67,0,0,72,0,0,76,0, 74,0,0,71,0,0,67,0] },
};
function music(name) { if (song === SONGS[name]) return; song = SONGS[name] || null; songStep = 0; songT = AC ? AC.currentTime + .05 : 0; songTr = name === 'stage' ? [0, 3, -2, 5][stage % 4] : name === 'boss' ? [0, 2, -1, 3][stage % 4] : 0; }
function musicTick() {
  if (!AC || !song || muted) return;
  if (songT < AC.currentTime) songT = AC.currentTime + .02;
  while (songT < AC.currentTime + .14) {
    const w = songT - AC.currentTime, sl = 30 / song.bpm, st = songStep, r0 = song.roots[st % song.roots.length], r = r0 + songTr, l = song.lead[st % song.lead.length], b8 = st % 8, barN = st >> 3;
    const pc = r0 % 12, third = pc === 9 || pc === 2 ? 3 : 4, M = { bus: musBus }, dv = song.drive, fill = dv && barN % 8 === 7 && b8 >= 4;
    tone(NF(r + [0, 0, 12, 0, 0, 12, 7, 12][b8]), sl * .95, 'sawtooth', .2, 0, w, { bus: musBus, lp: 950, lp2: 170, q: 4 });
    if (b8 === 0) for (const k of [12, 12 + third, 19]) tone(NF(r + k), sl * 8, 'triangle', dv ? .034 : .06, 0, w, { bus: musBus, a: .08, det: 6, rev: dv ? 0 : .4 });
    if (dv) { const ar = [12, 12 + third, 19, 24, 19, 12 + third, 24, 19]; tone(NF(r + 12 + ar[b8]), sl * .5, 'square', .02, 0, w, { bus: musBus, lp: 2600 }); if (dv > 1) tone(NF(r + 12 + ar[(b8 + 3) % 8]), sl * .45, 'square', .016, 0, w + sl / 2, { bus: musBus, lp: 2600 }); }
    if (l) { tone(NF(l + songTr), sl * 1.7, 'square', .05, 0, w, { bus: musBus, det: 7, lp: 4200, del: .45 }); tone(NF(l + songTr - 12), sl * 1.5, 'sawtooth', .02, 0, w, { bus: musBus, lp: 1800 }); }
    if (b8 === 0 || b8 === 4 || (dv > 1 && b8 === 3) || (dv && barN % 2 && b8 === 7)) { tone(155, .17, 'sine', .55, 38, w, M); noise(.02, .12, 3000, 800, w, M); }
    if (dv ? (b8 === 2 || b8 === 6) : b8 === 4) { noise(.16, dv ? .2 : .1, 5000, 1200, w, { bus: musBus, type: 'bandpass', q: .8, rev: .15 }); tone(190, .09, 'triangle', .13, 110, w, M); }
    if (dv) { noise(.03, .05, 9000, 7000, w, { bus: musBus, type: 'highpass' }); noise(.02, .026, 9000, 7000, w + sl / 2, { bus: musBus, type: 'highpass' }); }
    if (fill) for (let i = 0; i < 2; i++) { noise(.07, .12 + (b8 - 4) * .03, 4500, 1500, w + i * sl / 2, { bus: musBus, type: 'bandpass', q: .8 }); tone(220 - b8 * 16, .1, 'sine', .2, 90, w + i * sl / 2, M); }
    if (dv && b8 === 0 && barN % 8 === 0) noise(1.3, .1, 9000, 4000, w, { bus: musBus, type: 'highpass', rev: .4 });
    songStep++; songT += sl;
  }
}
function engineTick() {
  if (!eng || frame % 6) return; const on = state === 'play' && P && P.alive && !muted, t = AC.currentTime;
  eng.g.gain.setTargetAtTime(on ? .075 : 0, t, .25);
  if (on) { const k = 1 + ((held('ArrowUp', 'KeyW') ? 1 : 0) - (held('ArrowDown', 'KeyS') ? 1 : 0)) * .07;[58, 87.4, 29.2].forEach((f, i) => eng.os[i].frequency.setTargetAtTime(f * k, t, .2)); eng.lfo.frequency.setTargetAtTime(14 * k, t, .2); }
}

// ───────────────────────── 스프라이트 생성
const SP = {};
function mk(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w * SS; c.height = h * SS;
  const g = c.getContext('2d'); g.scale(SS, SS); g.translate(w / 2, h / 2); fn(g); c.w = w; c.h = h; return c;
}
function tint(c, col) {
  const k = '_' + col;
  if (!c[k]) { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; const g = n.getContext('2d'); g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, n.width, n.height); n.w = c.w; n.h = c.h; c[k] = n; }
  return c[k];
}
function draw(c, x, y, rot, sc, sx) {
  if (rot || (sc && sc !== 1) || sx) { ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); const s = sc || 1; ctx.scale(s * (sx || 1), s); ctx.drawImage(c, -c.w / 2, -c.h / 2, c.w, c.h); ctx.restore(); }
  else ctx.drawImage(c, x - c.w / 2, y - c.h / 2, c.w, c.h);
}
function drawE(c, x, y, rot, fl, sc) { draw(c, x, y, rot, sc); if (fl > 0) { ctx.globalAlpha = .75; draw(tint(c, '#fff'), x, y, rot, sc); ctx.globalAlpha = 1; } }
function shadow(c, x, y, rot, sc) { ctx.globalAlpha = .28; draw(tint(c, '#000'), x + 18, y + 26, rot, (sc || 1) * .8); ctx.globalAlpha = 1; }

const LN = 'rgba(0,0,0,.6)';
function hgrad(g, w, c, d) { const q = g.createLinearGradient(-w, 0, w, 0); q.addColorStop(0, d); q.addColorStop(.42, c); q.addColorStop(1, d); return q; }
function fs(g, fill, line = LN) { g.fillStyle = fill; g.fill(); if (line) { g.lineJoin = 'round'; g.lineWidth = 1; g.strokeStyle = line; g.stroke(); } }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function poly(g, p) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); }
function disc(g, x, y, r, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function roundel(g, x, y, r, cols) { cols.forEach((c, i) => disc(g, x, y, r * (1 - i / cols.length), c)); g.lineWidth = .5; g.strokeStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
function star5(g, x, y, r, c) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, q = i % 2 ? r * .42 : r; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } g.closePath(); g.fillStyle = c; g.fill(); }
// 둥근 익단 날개 / 동체 경로
function wingPath(g, S, y, ch, sw, tp, rd = 2.2) {
  const h = S / 2, le = y - ch / 2, tl = le + sw, tt = tl + ch * tp, m = Math.min(rd, ch * tp / 2);
  g.beginPath(); g.moveTo(0, le); g.lineTo(h - rd, tl); g.quadraticCurveTo(h, tl, h, tl + m); g.lineTo(h, tt - m); g.quadraticCurveTo(h, tt, h - rd, tt);
  g.lineTo(0, y + ch / 2); g.lineTo(rd - h, tt); g.quadraticCurveTo(-h, tt, -h, tt - m); g.lineTo(-h, tl + m); g.quadraticCurveTo(-h, tl, rd - h, tl); g.closePath();
}
function bodyPath(g, L, bw, tail = .3) { const y = -L / 2; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(bw * 1.25, y + L * .1, bw, y + L * .55, bw * tail, y + L); g.lineTo(-bw * tail, y + L); g.bezierCurveTo(-bw, y + L * .55, -bw * 1.25, y + L * .1, 0, y); g.closePath(); }
function camo(g, o) { if (!o.camo) return; const R = mulberry(o.seed || 7); g.fillStyle = o.camo; for (let i = 0; i < 12; i++) { const x = (R() * 2 - 1) * o.S * .5, y = (R() * 2 - 1) * o.L * .5, r = (.1 + R() * .13) * o.L; g.beginPath(); g.ellipse(x, y, r * 1.7, r, R() * 3, 0, TAU); g.fill(); } }
// 기본색 → 위장 무늬 → 도색(pre) → 음영 → 패널선(post) → 외곽선
// ───── 실사풍 렌더러: 부품별 높이맵 → 법선 조명 + 드리운 그림자 + 금속 반사 + 웨더링
function hsh(x, y) { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0; n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; }
function vn(x, y) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (hsh(xi, yi) * (1 - u) + hsh(xi + 1, yi) * u) * (1 - v) + (hsh(xi, yi + 1) * (1 - u) + hsh(xi + 1, yi + 1) * u) * v; }
function edt(d, cw, x0, y0, bw, bh) {   // 마스크 안쪽 픽셀의 가장자리까지 거리² (Felzenszwalb)
  const INF = 1e20, f = new Float64Array(bw * bh), m = Math.max(bw, bh), v = new Int32Array(m), z = new Float64Array(m + 1), t = new Float64Array(m), r = new Float64Array(m);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) f[y * bw + x] = d[((y0 + y) * cw + x0 + x) * 4 + 3] >= 128 ? INF : 0;
  const run = n => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) { let s; for (;;) { const p = v[k]; s = ((t[q] + q * q) - (t[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; } k++; v[k] = q; z[k] = s; z[k + 1] = Infinity; }
    k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; r[q] = (q - p) * (q - p) + t[p]; }
  };
  for (let x = 0; x < bw; x++) { for (let y = 0; y < bh; y++) t[y] = f[y * bw + x]; run(bh); for (let y = 0; y < bh; y++) f[y * bw + x] = r[y]; }
  for (let y = 0; y < bh; y++) { for (let x = 0; x < bw; x++) t[x] = f[y * bw + x]; run(bw); for (let x = 0; x < bw; x++) f[y * bw + x] = r[x]; }
  return f;
}
function kit(w, h, rot) {
  const cw = w * SS, ch = h * SS, mc = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d', { willReadFrequently: true }); g.setTransform(SS, 0, 0, SS, cw / 2, ch / 2); if (rot) g.rotate(rot); return g; };
  return { w, h, cw, ch, a: mc(), gv: mc(), sp: mc(), tmp: mc(), H: new Float32Array(cw * ch), A: new Uint8ClampedArray(cw * ch), over: [], seed: (w * 7 + h * 13) % 97 };
}
function solid(K, path, R, z, zs) {     // 경로를 둥글게 부풀린 입체로 높이맵에 합침
  const g = K.tmp, cw = K.cw, ch = K.ch;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch); g.setTransform(K.a.getTransform()); path(g); g.fillStyle = '#fff'; g.fill();
  const d = g.getImageData(0, 0, cw, ch).data; let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (d[(y * cw + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return; x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(cw - 1, x1 + 1); y1 = Math.min(ch - 1, y1 + 1);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, D = edt(d, cw, x0, y0, bw, bh), Rp = R * SS, zz = z * SS, zh = (zs ?? R) * SS;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (y0 + y) * cw + x0 + x, a = d[i * 4 + 3]; if (!a) continue; if (a > K.A[i]) K.A[i] = a;
    const t = Math.min(1, Math.max(0, Math.sqrt(D[y * bw + x]) - .5 + a / 510) / Rp), hh = zz + zh * Math.sqrt(1 - (1 - t) * (1 - t)); if (hh > K.H[i]) K.H[i] = hh;
  }
}
function part(K, path, R, z, zs, sp, paint, lines) {
  solid(K, path, R, z, zs);
  const a = K.a; a.save(); path(a); a.clip(); paint(a); a.restore();
  const v = K.gv; v.save(); path(v); v.clip(); v.clearRect(-999, -999, 1998, 1998); if (lines) { v.strokeStyle = v.fillStyle = '#fff'; v.lineWidth = .38; lines(v); } v.restore();
  const s = K.sp; s.save(); path(s); s.clip(); s.clearRect(-999, -999, 1998, 1998); s.fillStyle = `rgb(${Math.round((sp ?? .2) * 255)},0,0)`; s.fillRect(-999, -999, 1998, 1998); s.restore();
}
function over(K, fn) { const m = K.a.getTransform(); K.over.push(g => { g.setTransform(m); fn(g); }); }
function at(K, x, y, fn) { const gs = [K.a, K.gv, K.sp]; for (const g of gs) { g.save(); g.translate(x, y); } fn(); for (const g of gs) g.restore(); }
function finish(K, ang = 0) {            // ang: 이 스프라이트가 화면에 그려질 회전각 (빛 방향을 맞춤)
  const cw = K.cw, ch = K.ch, n = cw * ch, H = K.H, A = K.A;
  if (!K.pre) {
    K.pre = 1; const T = new Float32Array(n);
    for (let p = 0; p < 2; p++) { for (let i = 1; i < n - 1; i++) T[i] = (H[i - 1] + H[i] + H[i + 1]) / 3; for (let i = cw; i < n - cw; i++) H[i] = (T[i - cw] + T[i] + T[i + cw]) / 3; }
    K.ad = K.a.getImageData(0, 0, cw, ch).data; K.gd = K.gv.getImageData(0, 0, cw, ch).data; K.sd = K.sp.getImageData(0, 0, cw, ch).data;
    for (let i = 0; i < n; i++) { const gA = K.gd[i * 4 + 3]; if (gA) H[i] -= gA / 255 * SS * .45; }
  }
  let lx = -.42, ly = -.56; const lz = .715, ca = Math.cos(ang), sa = Math.sin(ang);[lx, ly] = [lx * ca + ly * sa, -lx * sa + ly * ca];
  const ll = Math.hypot(lx, ly), sx = lx / ll * 1.5, sy = ly / ll * 1.5, rise = lz / ll * 1.5, hl = Math.hypot(lx, ly, lz + 1), hx = lx / hl, hy = ly / hl, hz = (lz + 1) / hl;
  const img = new ImageData(cw, ch), od = img.data, ad = K.ad, gd = K.gd, sd = K.sd, amb = .4, sc = 1 / SS, so = K.seed * 3.7;
  for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) {
    const i = y * cw + x, a = A[i]; if (!a) continue; const j = i * 4, h0 = H[i];
    const nx = (H[i - 1] - H[i + 1]) * .5, ny = (H[i - cw] - H[i + cw]) * .5, inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    let dif = (nx * lx + ny * ly + lz) * inv; if (dif < 0) dif = 0;
    let sh = 1; for (let s = 2; s < 28; s++) { const qx = Math.round(x + sx * s), qy = Math.round(y + sy * s); if (qx < 0 || qy < 0 || qx >= cw || qy >= ch) break; if (H[qy * cw + qx] > h0 + rise * s + 1.2) { sh = .5; break; } }
    const spK = sd[j + 3] ? sd[j] / 255 : .2; let sp = (nx * hx + ny * hy + hz) * inv; sp = sp > 0 ? Math.pow(sp, 10 + spK * 60) * spK * sh : 0;
    const wx = spK > .95 ? 1 : (.9 + .2 * vn(x * sc / 7 + so, y * sc / 7)) * (.93 + .14 * vn(x * sc / .9 + so, y * sc / 14)) * (.97 + .06 * hsh(x, y)) * (1 - .55 * gd[j + 3] / 255);
    const lit = (amb + (1 - amb) * dif / lz * sh) * wx, s255 = 255 * sp;
    od[j] = ad[j] * lit + s255; od[j + 1] = ad[j + 1] * lit + s255; od[j + 2] = ad[j + 2] * lit + s255 * 1.05; od[j + 3] = a;
  }
  const cv2 = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const lc = cv2(); lc.getContext('2d').putImageData(img, 0, 0);
  const sil = cv2(), sg = sil.getContext('2d'); sg.drawImage(lc, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#05070a'; sg.fillRect(0, 0, cw, ch);
  const c = cv2(), g = c.getContext('2d'), e = SS * .4; g.globalAlpha = .4; for (const [dx, dy] of [[-e, 0], [e, 0], [0, -e], [0, e], [-e, -e], [e, e], [-e, e], [e, -e]]) g.drawImage(sil, dx, dy);
  g.globalAlpha = 1; g.drawImage(lc, 0, 0); for (const f of K.over) f(g); c.w = K.w; c.h = K.h; return c;
}
const spins = (K, n) => Array.from({ length: n }, (_, i) => finish(K, i / n * TAU));
// ───── 기체 부품
function ptone(g, R, x, y, w, h, amt = .16) { const v = R(); g.fillStyle = v < .5 ? `rgba(0,0,0,${(.5 - v) * amt})` : `rgba(255,255,255,${(v - .5) * amt})`; g.fillRect(x, y, w, h); }
function propBlur(g, x, y, r) {
  g.fillStyle = 'rgba(235,235,235,.2)'; g.beginPath(); g.ellipse(x, y, r, r * .24, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(20,20,20,.38)'; g.lineWidth = .7; g.beginPath(); g.moveTo(x - r * .92, y - r * .07); g.lineTo(x + r * .92, y + r * .07); g.stroke();
  g.fillStyle = 'rgba(240,190,30,.85)'; g.fillRect(x - r * .96, y - r * .07 - .5, 1.3, 1); g.fillRect(x + r * .96 - 1.3, y + r * .07 - .5, 1.3, 1);
}
function dome(K, x, y, r, z, zs, sp, col, col2) { part(K, g => { g.beginPath(); g.arc(x, y, r, 0, TAU); }, r, z, zs, sp, g => { g.fillStyle = col; g.fillRect(-999, -999, 1998, 1998); if (col2) disc(g, x, y, r * .5, col2); }); }
function wingK(K, o, S, y, ch, sw, tp, k = {}) {
  const h = S / 2, le = y - ch / 2, te = y + ch / 2, tl = le + sw, tt = tl + ch * tp, ribs = k.ribs || 5, Rn = mulberry((o.seed || 1) * 31 + (S | 0)), th = k.th || Math.min(2.4, ch * .2), RR = Math.max(th, ch * .42);
  const path = k.ell ? g => { g.beginPath(); g.ellipse(0, y, h, ch / 2, 0, 0, TAU); } : g => wingPath(g, S, y, ch, sw, tp, k.rd);
  const fy = f => te + (tt - te) * f - (ch + (ch * tp - ch) * f) * .27, ey = f => te + (tt - te) * f;
  part(K, path, RR, 0, th, o.spec, g => {
    g.fillStyle = o.c; g.fillRect(-400, -400, 800, 800); camo(g, o);
    for (const s of [-1, 1]) for (let i = 0; i < ribs; i++) { const x = s > 0 ? h * i / ribs : -h * (i + 1) / ribs, my = le + ch * .4; ptone(g, Rn, x, -99, h / ribs, 99 + my, o.var); ptone(g, Rn, x, my, h / ribs, 99, o.var); }
    const q = g.createLinearGradient(0, Math.min(le, tl), 0, Math.max(te, tt)); q.addColorStop(0, 'rgba(255,255,255,.14)'); q.addColorStop(.3, 'rgba(255,255,255,0)'); q.addColorStop(1, 'rgba(0,0,0,.18)'); g.fillStyle = q; g.fillRect(-400, -400, 800, 800);
    g.fillStyle = 'rgba(0,0,0,.08)'; for (const s of [-1, 1]) { poly(g, [s * h * .1, fy(.1), s * h * .97, fy(.97), s * h * .97, 99, s * h * .1, 99]); g.fill(); }
    if (k.tipc) { g.fillStyle = k.tipc; g.fillRect(-h - 1, -99, h * .16 + 1, 198); g.fillRect(h * .84, -99, h * .16 + 1, 198); }
    if (k.le) { g.strokeStyle = k.le; g.lineWidth = 1.8; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * h * .16, le + sw * .16 + .7); g.lineTo(s * h * (k.lef || .52), le + sw * (k.lef || .52) + .7); g.stroke(); } }
    if (k.paint) k.paint(g);
  }, v => {
    for (const s of [-1, 1]) {
      v.beginPath(); v.moveTo(s * h * .1, fy(.1)); v.lineTo(s * h * .97, fy(.97)); v.stroke();
      v.beginPath(); v.moveTo(s * h * .55, fy(.55)); v.lineTo(s * h * .55, ey(.55) + 2); v.stroke();
      v.globalAlpha = .65; v.beginPath(); v.moveTo(0, le + ch * .36); v.lineTo(s * h, tl + ch * tp * .36); v.stroke();
      v.globalAlpha = .38; for (let i = 1; i < ribs; i++) { v.beginPath(); v.moveTo(s * h * i / ribs, -99); v.lineTo(s * h * i / ribs, 99); v.stroke(); }
      v.setLineDash([.35, 1.15]); for (const f of [.16, .6]) { v.beginPath(); v.moveTo(0, le + ch * f); v.lineTo(s * h, tl + ch * tp * f); v.stroke(); } v.setLineDash([]); v.globalAlpha = 1;
    }
  });
  if (k.guns) over(K, g => { g.fillStyle = '#121315'; for (const s of [-1, 1]) for (const f of k.guns) g.fillRect(s * h * f - .5, le + sw * f - 3 + (k.ell ? ch * .5 * (1 - Math.sqrt(1 - f * f)) : 0), 1, 3.8); });
  if (k.lights) over(K, g => { const my = k.ell ? y : (tl + tt) / 2; disc(g, -h + .9, my, .8, '#ff3a2a'); disc(g, h - .9, my, .8, '#3aff6a'); });
}
function bodyK(K, o, L, bw, k = {}) {
  const y = -L / 2, cf = k.cowl || .18, Rn = mulberry((o.seed || 1) * 17 + (L | 0)), st = [k.nose ? cf : .13, .3, .46, .62, .78];
  part(K, g => bodyPath(g, L, bw, k.tail), bw, k.z ?? .8, bw * 1.15, k.spec ?? o.spec, g => {
    g.fillStyle = k.c || o.c; g.fillRect(-400, -400, 800, 800); if (!k.c) camo(g, o);
    for (let i = 0; i < st.length; i++) ptone(g, Rn, -99, y + L * st[i], 198, L * ((st[i + 1] || 1) - st[i]), o.var);
    if (k.nose) { g.fillStyle = k.nose; g.fillRect(-bw * 2, y, bw * 4, L * cf); }
    if (k.glare) { g.fillStyle = k.glare; g.fillRect(-bw * .5, y + (k.nose ? L * cf : 0), bw, L * .3); }
    if (k.bands) for (const [c, f, hh] of k.bands) { g.fillStyle = c; g.fillRect(-bw * 2, y + L * f, bw * 4, L * hh); }
    if (k.inline) { const q = g.createLinearGradient(0, y + L * .1, 0, y + L * .6); q.addColorStop(0, 'rgba(15,10,8,.5)'); q.addColorStop(1, 'rgba(15,10,8,0)'); g.fillStyle = q; for (const s of [-1, 1]) g.fillRect(s * bw * .8 - bw * .22, y + L * .1, bw * .44, L * .5); }
  }, v => {
    for (const f of st) { v.beginPath(); v.moveTo(-bw * 2, y + L * f); v.lineTo(bw * 2, y + L * f); v.stroke(); }
    v.globalAlpha = .5; v.setLineDash([.35, 1.15]); for (const s of [-1, 1]) { v.beginPath(); v.moveTo(s * bw * .5, y + L * .08); v.lineTo(s * bw * .22, y + L * .95); v.stroke(); } v.setLineDash([]); v.globalAlpha = 1;
  });
  if (k.inline) over(K, g => { g.fillStyle = '#1a100a'; for (const s of [-1, 1]) for (let i = 0; i < 3; i++) g.fillRect(s * bw * .98 - .7, y + L * (.09 + i * .04), 1.4, L * .022); });
}
function finK(K, o, y, w, h, c) { part(K, g => rr(g, -w / 2, y, w, h, w / 2), w / 2, 1, 5.5, o.spec, g => { g.fillStyle = c; g.fillRect(-99, -99, 198, 198); }, v => { v.beginPath(); v.moveTo(-9, y + h * .55); v.lineTo(9, y + h * .55); v.stroke(); }); }
function canopyK(K, o, y, w, h, frames, z) {
  part(K, g => { g.beginPath(); g.ellipse(0, y, w, h, 0, 0, TAU); }, w, z, w * 1.1, 1, g => {
    const q = g.createLinearGradient(0, y - h, 0, y + h); q.addColorStop(0, '#3d6076'); q.addColorStop(.5, '#16303f'); q.addColorStop(1, '#0a161e'); g.fillStyle = q; g.fillRect(-99, -99, 198, 198);
    g.strokeStyle = o.fr || o.c; g.lineWidth = .75; for (let i = 1; i <= frames; i++) { const yy = y - h + 2 * h * i / (frames + 1); g.beginPath(); g.moveTo(-w, yy); g.lineTo(w, yy); g.stroke(); }
    if (frames > 2) { g.beginPath(); g.moveTo(0, y - h * .55); g.lineTo(0, y + h); g.stroke(); }
    g.lineWidth = 1.1; g.beginPath(); g.ellipse(0, y, w, h, 0, 0, TAU); g.stroke();
  });
}
function spinnerK(K, o, y, r) { dome(K, 0, y, r, .8, r * 1.3, .6, o.spin || '#26282b'); }
function fighter(K, o) {
  const L = o.L, S = o.S, wy = o.wy ?? -L * .06, bw = o.bw || L * .12, sw = o.sw ?? 2;
  wingK(K, o, o.ts || S * .4, L * .4, L * .17, 1, .6, { rd: 1.6, ribs: 2, tipc: o.tailc, th: 1.3 });
  wingK(K, o, S, wy, o.ch || L * .3, sw, o.tp ?? .6, { ell: o.ell, guns: o.guns, lights: 1, ribs: 6, le: o.le, tipc: o.tipc, paint: g => { if (o.mark) for (const s of [-1, 1]) roundel(g, s * S * .3, wy + (o.ell ? 0 : sw * .6 + .5), L * .085, o.mark); } });
  bodyK(K, o, L, bw, { nose: o.nose, cowl: o.cowl, inline: o.inline, glare: o.glare, bands: o.bands });
  finK(K, o, L * .25, bw * .42, L * .25, o.finc || o.c);
  canopyK(K, o, o.cy ?? -L * .07, L * .058, o.cl || L * .12, o.cf || 2, bw * .95);
  spinnerK(K, o, -L / 2 + bw * .1, bw * .5); over(K, g => propBlur(g, 0, -L / 2 - .2, L * .22));
}
function bomber(K, o) {
  const L = o.L, S = o.S, bw = L * .085, wy = -L * .08;
  wingK(K, o, S * .36, L * .42, L * .15, 1, .6, { rd: 2, ribs: 3, tipc: o.tipc, th: L * .02 });
  wingK(K, o, S, wy, L * .26, L * .05, .5, { rd: 3, ribs: 10, lights: 1, tipc: o.tipc, le: 'rgba(12,12,12,.75)', lef: .95, th: L * .03, paint: g => {
    for (const x of o.eng) for (const s of [-1, 1]) { const q = g.createLinearGradient(0, -L * .05, 0, L * .14); q.addColorStop(0, 'rgba(10,8,6,.55)'); q.addColorStop(1, 'rgba(10,8,6,0)'); g.fillStyle = q; g.fillRect(s * x - L * .03, -L * .05, L * .06, L * .19); }
    if (o.mark) for (const s of [-1, 1]) roundel(g, s * S * .39, -L * .04, L * .06, o.mark);
  } });
  for (const x of o.eng) for (const s of [-1, 1]) at(K, s * x, -L * .15, () => { bodyK(K, o, L * .32, L * .058, { nose: o.cowlc || '#2a2d31', cowl: .24, tail: .5, z: L * .025 }); spinnerK(K, o, -L * .155, L * .026); over(K, g => propBlur(g, 0, -L * .168, L * .118)); });
  bodyK(K, o, L, bw, { bands: o.bands, c: o.c2, z: L * .025 });
  canopyK(K, o, -L / 2 + L * .055, bw * .6, L * .048, 2, bw * .7); canopyK(K, o, -L * .34, L * .044, L * .062, 3, bw);
  finK(K, o, L * .3, bw * .36, L * .2, o.c);
  for (const ty of [L * .05, L * .24]) { dome(K, 0, ty, L * .042, bw, L * .035, .5, '#3b424b', '#59636f'); for (const s of [-1, 1]) part(K, g => rr(g, s * L * .012 - L * .006, ty - L * .095, L * .012, L * .08, L * .005), L * .006, bw * 1.25, L * .008, .5, g => { g.fillStyle = '#0c0d0f'; g.fillRect(-999, -999, 1998, 1998); }); }
  canopyK(K, o, L * .5 - L * .03, L * .024, L * .024, 1, bw * .3);
}
function orb(r, c0, c1, c2) { return mk(r * 2 + 2, r * 2 + 2, g => { const q = g.createRadialGradient(0, 0, 0, 0, 0, r); q.addColorStop(0, c0); q.addColorStop(.4, c1); q.addColorStop(.8, c2); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); }); }
function glow(w, h, c0, c1) { return mk(w + 4, h + 4, g => { g.scale(w / 2, h / 2); const q = g.createRadialGradient(0, 0, 0, 0, 0, 1); q.addColorStop(0, '#fff'); q.addColorStop(.35, c0); q.addColorStop(.75, c1); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); }); }
// ───── 지상 유닛·보스용 부품 도우미
const fillc = (c, f) => g => { g.fillStyle = c; g.fillRect(-999, -999, 1998, 1998); if (f) f(g); };
const bx = (K, x, y, w, h, r, R, z, zs, sp, col, lines, paint) => part(K, g => rr(g, x, y, w, h, r), R, z, zs, sp, fillc(col, paint), lines);
const blot = (g, seed, col, n, w, h, r) => { const R = mulberry(seed); g.fillStyle = col; for (let i = 0; i < n; i++) { g.beginPath(); g.ellipse((R() - .5) * w, (R() - .5) * h, r * (.6 + R()), r * (.4 + R() * .6), R() * 3, 0, TAU); g.fill(); } };
const hl = (v, ys, x0, x1, lw) => { if (lw) v.lineWidth = lw; for (const y of ys) { v.beginPath(); v.moveTo(x0, y); v.lineTo(x1, y); v.stroke(); } };
const range = (a, b, s) => { const o = []; for (let v = a; v < b; v += s) o.push(v); return o; };
function mechK(h) {
  const K = kit(154, 124), c = `hsl(${h},20%,47%)`, c2 = `hsl(${h},22%,56%)`, d = `hsl(${h},26%,25%)`, ac = `hsl(${(h + 170) % 360},70%,48%)`;
  const tn = n => g => { const R = mulberry(n); for (let x = -80; x < 80; x += 13) for (let y = -60; y < 60; y += 15) ptone(g, R, x, y, 13, 15, .2); blot(g, n + 3, 'rgba(30,30,34,.3)', 10, 150, 110, 5); };
  for (const s of [-1, 1]) {
    part(K, g => poly(g, [s * 16, -30, s * 62, -52, s * 70, -30, s * 30, -8]), 3, 1, 3, .4, fillc(d, tn(2)), v => { v.beginPath(); v.moveTo(s * 22, -22); v.lineTo(s * 64, -42); v.stroke(); v.beginPath(); v.moveTo(s * 44, -44); v.lineTo(s * 50, -18); v.stroke(); });
    part(K, g => poly(g, [s * 18, -25, s * 52, -41, s * 57, -31, s * 27, -13]), 2, 4, 2, .5, fillc(c2, g => { g.fillStyle = ac; poly(g, [s * 46, -38, s * 52, -41, s * 57, -31, s * 51, -28]); g.fill(); }));
    bx(K, s * 14 - 4.5, -42, 9, 16, 2.5, 2.5, 3, 4, .55, '#2a2b2f', v => hl(v, [-38, -34], -30, 30));
  }
  for (const s of [-1, 1]) at(K, s * 46, 14, () => {
    bx(K, -11, -22, 22, 50, 5, 4, 4, 6, .45, c, v => hl(v, [-8, 10, 20], -14, 14), g => { tn(4)(g); g.fillStyle = ac; g.fillRect(-12, 13, 24, 3); g.fillStyle = '#16171a'; g.fillRect(-12, 16.6, 24, 1); });
    bx(K, -8, -17, 16, 11, 2, 1.5, 10.5, 1.6, .4, d, v => { hl(v, [-11.5], -9, 9); for (const x of [-4, 0, 4]) { v.beginPath(); v.moveTo(x, -17); v.lineTo(x, -6); v.stroke(); } });
    bx(K, -6.5, 24, 13, 19, 2.5, 3.2, 5, 4.5, .6, '#3b3d42', v => hl(v, [29, 34, 39], -8, 8, .7));
    over(K, g => { disc(g, 0, 43, 3.6, '#050506'); g.strokeStyle = '#6a6d74'; g.lineWidth = .8; g.beginPath(); g.arc(0, 43, 3.6, 0, TAU); g.stroke(); });
  });
  for (const s of [-1, 1]) { part(K, g => { g.beginPath(); g.ellipse(s * 44, -8, 20, 15, 0, 0, TAU); }, 12, 6, 9, .5, fillc(c2, tn(6)), v => { v.beginPath(); v.ellipse(s * 44, -8, 13, 9, 0, 0, TAU); v.stroke(); }); dome(K, s * 44, -8, 5, 15, 3, .95, ac); }
  bx(K, -26, -28, 52, 56, 9, 8, 5, 9, .45, c, v => { hl(v, [-12, 2], -28, 28); for (const x of [-15, 15]) hl(v, range(-24, -14, 2.4), x - 5, x + 5, .8); }, tn(8));
  part(K, g => poly(g, [-18, 4, 18, 4, 10, 25, -10, 25]), 3, 14, 3, .55, fillc(ac, g => { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-20, 4, 40, 2); }), v => { v.beginPath(); v.moveTo(0, 4); v.lineTo(0, 8); v.stroke(); });
  dome(K, 0, 14, 6, 17, 3, 1, '#b8922e', '#fff3a0'); over(K, g => { const q = g.createRadialGradient(0, 14, 0, 0, 14, 9); q.addColorStop(0, 'rgba(255,252,220,.95)'); q.addColorStop(.5, 'rgba(255,220,110,.45)'); q.addColorStop(1, 'rgba(255,200,80,0)'); g.fillStyle = q; g.fillRect(-9, 5, 18, 18); });
  dome(K, 0, -8, 11.5, 14, 8, .5, d); bx(K, -7.5, -6.5, 15, 5.5, 2, 1.6, 21, 1.6, 1, '#b81f1f');
  over(K, g => { const q = g.createLinearGradient(0, -6.5, 0, -1); q.addColorStop(0, 'rgba(255,120,100,.9)'); q.addColorStop(1, 'rgba(255,40,40,.2)'); g.fillStyle = q; rr(g, -6.5, -5.8, 13, 4, 1.5); g.fill(); });
  bx(K, -1, -24, 2, 12, 1, 1, 18, 3, .6, '#2a2b2f');
  return finish(K);
}

function buildSprites() {
  // ── 플레이어 기체 (실사풍 렌더)
  const air = (w, h, o, ang, fn = fighter) => { const K = kit(w, h); fn(K, o); return ang === 'spin' ? spins(K, 16) : finish(K, ang || 0); };
  {
    const K = kit(68, 58), o = { c: '#b3bbc2', L: 46, S: 60, spec: .85, var: .36, seed: 2 };
    wingK(K, o, 60, -5, 13, 3, .5, { rd: 2.6, ribs: 8, lights: 1, paint: g => { for (const s of [-1, 1]) { const x = s * 22, y = -3.2; g.fillStyle = '#e8e8e2'; g.fillRect(x - 6, y - 1.2, 12, 2.4); g.strokeStyle = '#1b315f'; g.lineWidth = .6; g.strokeRect(x - 6, y - 1.2, 12, 2.4); disc(g, x, y, 3.4, '#1b315f'); star5(g, x, y, 3, '#e8e8e2'); } } });
    part(K, g => rr(g, -15.5, 19, 31, 5.6, 1.6), 1.3, 0, 1.4, o.spec, g => { g.fillStyle = o.c; g.fillRect(-99, -99, 198, 198); const R = mulberry(5); for (let i = 0; i < 6; i++) ptone(g, R, -15.5 + i * 5.2, 0, 5.2, 40, .3); }, v => { v.beginPath(); v.moveTo(-16, 22.5); v.lineTo(16, 22.5); v.stroke(); });
    for (const s of [-1, 1]) at(K, s * 12, 1.5, () => {
      bodyK(K, o, 44, 3.9, { nose: '#98a1a8', cowl: .2, inline: 1, tail: .45, bands: [['#e4e4de', .58, .03], ['#16171a', .61, .03], ['#e4e4de', .64, .03], ['#16171a', .67, .03], ['#e4e4de', .7, .03]] });
      dome(K, 0, 1.5, 1.9, 3.6, 1.2, .6, '#2a2e33', '#7a5c3a');
      for (const t of [-1, 1]) part(K, g => rr(g, t * 3.7 - 1.1, 9.5, 2.2, 5, .9), 1, .8, 1.8, .6, g => { g.fillStyle = '#8a949c'; g.fillRect(-99, -99, 198, 198); });
      finK(K, o, 15, 2, 9, '#c2c9cf'); spinnerK(K, Object.assign({}, o, { spin: '#a8202a' }), -21.8, 1.9); over(K, g => propBlur(g, 0, -23, 8.6));
    });
    at(K, 0, -8, () => bodyK(K, o, 27, 4.9, { nose: '#98a1a8', cowl: .15, glare: '#39462e', tail: .55, z: 1.2 }));
    over(K, g => { g.fillStyle = '#121315'; for (const x of [-1.7, -.6, .6, 1.7]) g.fillRect(x - .3, -24.6, .6, 3.4); });
    canopyK(K, o, -8.5, 3, 5.8, 3, 5); SP.p38 = finish(K);
  }
  SP.spit = air(62, 56, { L: 46, S: 56, c: '#4c5c3c', camo: '#6f5b41', seed: 3, spec: .14, var: .12, bw: 4.8, ell: 1, ch: 17, wy: -4, inline: 1, guns: [.3, .38], mark: ['#1b315f', '#e8e8e2', '#a8202a'], spin: '#c9c3a0', bands: [['#a9b896', .72, .04]], finc: '#8c2a2a', cy: -3, cl: 5.4, cf: 3 });
  SP.zero = air(62, 54, { L: 44, S: 56, c: '#c4c6b9', spec: .32, var: .14, seed: 4, ch: 15, sw: 1.5, tp: .52, nose: '#15161a', cowl: .17, le: '#d8a818', guns: [.3], mark: ['#e8e8e2', '#a8202a', '#a8202a', '#a8202a', '#a8202a'], spin: '#8a8c88', bands: [['#a8202a', .74, .035]], cl: 6.6, cf: 4, cy: -2.5 });
  {
    const K = kit(62, 60), o = { c: '#34503c', camo: '#273d2e', seed: 11, L: 50, S: 56, spec: .2, var: .12 };
    wingK(K, o, 56, 9, 16, 9, .42, { rd: 2, ribs: 7, lights: 1, le: '#d8a818', paint: g => { for (const s of [-1, 1]) roundel(g, s * 21.5, 14, 3.8, ['#e8e8e2', '#a8202a', '#a8202a', '#a8202a']); } });
    wingK(K, o, 22, -18.5, 6, 1.5, .55, { rd: 1.5, ribs: 2, th: 1.2 });
    for (const s of [-1, 1]) at(K, s * 15, 0, () => finK(K, o, 10, 2.6, 14, '#2a4332'));
    bodyK(K, o, 50, 5.5, { glare: '#131c16', tail: .8, bands: [['#d8b020', .88, .03]] });
    for (const s of [-1, 1]) part(K, g => { g.beginPath(); g.ellipse(s * 5.6, 7, 1.5, 3.4, 0, 0, TAU); }, 1.2, 2.5, 2.2, .2, g => { g.fillStyle = '#0c110e'; g.fillRect(-99, -99, 198, 198); });
    over(K, g => { g.fillStyle = '#121315'; for (const x of [-1.8, -.6, .6, 1.8]) g.fillRect(x - .3, -27.6, .6, 3.6); });
    canopyK(K, o, -5, 3.1, 6.8, 3, 5.4); spinnerK(K, Object.assign({}, o, { spin: '#5a3018' }), 24.6, 2.3); over(K, g => propBlur(g, 0, 26.4, 9.8)); SP.shin = finish(K);
  }
  // ── 적 기체 (선회 각도별로 조명을 다시 계산한 16방향)
  SP.zako = air(38, 36, { L: 28, S: 31, c: '#5f7541', camo: '#42562e', seed: 5, spec: .18, var: .12, nose: '#c9a426', cowl: .16, guns: [.32], mark: ['#e8e8e2', '#a8202a', '#a8202a'], tailc: '#c9a426' }, 'spin');
  SP.zakoB = air(38, 36, { L: 28, S: 31, c: '#727d8c', camo: '#525c6a', seed: 9, spec: .28, var: .14, inline: 1, sw: 4, tp: .5, guns: [.3], mark: ['#e8e8e2', '#131416', '#131416'], spin: '#9a2a2a', tipc: '#d8d8d2', bands: [['#d8b020', .7, .04]] }, 'spin');
  SP.zakoR = air(38, 36, { L: 28, S: 31, c: '#b53f2c', seed: 12, spec: .3, var: .12, nose: '#e4e0d0', cowl: .15, guns: [.32], mark: ['#e8e8e2', '#1a1a1c', '#1a1a1c'], tipc: '#e4e0d0', bands: [['#e4e0d0', .7, .04]], spin: '#e8c030' }, 'spin');
  SP.mid = air(84, 62, { L: 56, S: 78, c: '#647550', camo: '#4a5a3a', seed: 4, spec: .16, var: .12, eng: [17], mark: ['#e8e8e2', '#a8202a', '#a8202a'], bands: [['#d8d0b8', .72, .03]] }, PI, bomber);
  SP.big = air(138, 96, { L: 90, S: 130, c: '#717985', camo: '#565d69', seed: 6, spec: .3, var: .14, c2: '#7d7462', eng: [22, 43], mark: ['#e8e8e2', '#131416', '#131416'], tipc: '#9a2a2a', bands: [['#d8b020', .7, .025]] }, PI, bomber);
  SP.b29 = air(170, 120, { L: 112, S: 160, c: '#b9c1c8', spec: .85, var: .34, seed: 7, eng: [26, 52], mark: ['#1b315f', '#e8e8e2'], cowlc: '#8f989f', bands: [['#16171a', .68, .02], ['#16171a', .72, .02]] }, 0, bomber);
  // ── 지상 유닛
  {
    const K = kit(34, 38);
    for (const s of [-1, 1]) bx(K, s * 10.6 - 3.7, -16, 7.4, 32, 2.2, 1.2, .8, 1.4, .25, '#1e1e19', v => hl(v, range(-15, 16, 2.3), -20, 20, .8));
    bx(K, -8.6, -14, 17.2, 28, 2.4, 1.8, 2, 1.8, .2, '#6a7541', v => { hl(v, [-6, 6.5], -20, 20); hl(v, range(8, 14, 1.4), -5.5, 5.5, .6); }, g => { blot(g, 3, '#515b2f', 7, 18, 28, 4); blot(g, 8, 'rgba(120,100,70,.35)', 5, 18, 28, 3); g.fillStyle = '#39411f'; g.fillRect(-6, 7.5, 12, 6); });
    for (const s of [-1, 1]) bx(K, s * 6 - 1, 13, 2, 3.4, .8, .8, 2.5, 1, .4, '#2a2218');
    dome(K, -4.5, -9.5, 1.6, 3.6, .7, .3, '#58632f'); SP.tank = finish(K);
  }
  {
    const K = kit(26, 38);
    bx(K, -1.2, -17, 2.4, 15, 1, 1.1, 4.6, 1.2, .45, '#343922'); bx(K, -1.9, -17.6, 3.8, 3.2, .9, 1, 4.6, 1.6, .45, '#2a2e1c', v => hl(v, [-16], -3, 3));
    part(K, g => poly(g, [-4, -7.5, 4, -7.5, 7, -2, 6.5, 6, 3.5, 8.5, -3.5, 8.5, -6.5, 6, -7, -2]), 2.6, 3.2, 2.4, .25, fillc('#737e47', g => blot(g, 5, '#59632f', 4, 14, 16, 3)), v => hl(v, [3.5], -9, 9));
    bx(K, -3.4, -8.6, 6.8, 3, 1, 1.2, 3.6, 2, .3, '#5c6638'); dome(K, 2.2, 2.4, 2.3, 5.4, 1, .35, '#646f3d', '#4e5830'); dome(K, -3, 4.5, 1, 5.4, .8, .5, '#2c301c');
    SP.tur = spins(K, 24);
  }
  {
    const K = kit(42, 42);
    part(K, g => poly(g, [-8, -18, 8, -18, 18, -8, 18, 8, 8, 18, -8, 18, -18, 8, -18, -8]), 3, 1, 2.6, .12, fillc('#8c8a80', g => { blot(g, 2, 'rgba(60,58,50,.35)', 8, 36, 36, 4); disc(g, 0, 0, 10.5, '#4c4b45'); g.strokeStyle = '#c9a53a'; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.stroke(); g.setLineDash([]); }),
      v => { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + PI / 8; v.beginPath(); v.moveTo(Math.cos(a) * 12, Math.sin(a) * 12); v.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); v.stroke(); } });
    part(K, g => { g.beginPath(); g.arc(0, 0, 12.6, 0, TAU); g.arc(0, 0, 10, 0, TAU, true); }, 1.3, 3.4, 1.6, .15, fillc('#a39f8f', g => { g.strokeStyle = 'rgba(50,45,35,.5)'; g.lineWidth = .5; for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; g.beginPath(); g.moveTo(Math.cos(a) * 9.8, Math.sin(a) * 9.8); g.lineTo(Math.cos(a) * 12.8, Math.sin(a) * 12.8); g.stroke(); } }));
    SP.base = finish(K);
  }
  {
    const K = kit(30, 70), hull = g => { g.beginPath(); g.moveTo(0, 32); g.bezierCurveTo(12, 17, 11.5, -10, 9.5, -31); g.lineTo(-9.5, -31); g.bezierCurveTo(-11.5, -10, -12, 17, 0, 32); g.closePath(); };
    part(K, hull, 3.2, 0, 2.6, .3, fillc('#6f7882', g => { g.save(); g.scale(.78, .93); hull(g); g.fillStyle = '#59616b'; g.fill(); g.restore(); blot(g, 4, 'rgba(110,70,40,.3)', 6, 20, 60, 3); g.strokeStyle = '#c9c9c0'; g.lineWidth = .5; g.beginPath(); g.arc(0, 12, 6, 0, TAU); g.stroke(); }), v => { v.globalAlpha = .5; hl(v, range(-28, 30, 5), -14, 14); v.globalAlpha = 1; });
    bx(K, -6.5, -24, 13, 20, 2, 1.6, 3, 3, .3, '#98a1a9', v => hl(v, [-17, -10], -8, 8), g => { g.fillStyle = '#16212b'; g.fillRect(-5, -6.6, 10, 1.6); });
    bx(K, -4, -21, 8, 9, 1.5, 1.2, 6.2, 1.6, .3, '#b0b8bf'); dome(K, 0, -11.5, 3.1, 6.2, 2.4, .3, '#3a3d42', '#08090a');
    for (const s of [-1, 1]) { bx(K, s * 8.2 - 1.3, -4, 2.6, 6, 1.2, 1, 2.6, 1.3, .2, '#c96a2a'); bx(K, s * 5 - 1.2, -30, 2.4, 4.5, 1, 1, 2.6, 1.2, .4, '#33373c'); }
    dome(K, 0, 12, 4.6, 2.6, 1.2, .3, '#4d555e'); SP.boat = finish(K);
  }
  {
    const K = kit(40, 58);
    for (const s of [-1, 1]) { bx(K, s * 4.6 - 1.5, -27, 3, 22, 1.4, 1.4, 5.6, 1.5, .5, '#2c3036', v => hl(v, [-22, -14], -9, 9)); bx(K, s * 4.6 - 2.2, -12, 4.4, 6, 1.4, 1.4, 5.6, 2.2, .45, '#3d434b'); }
    part(K, g => poly(g, [-8, -9, 8, -9, 12.5, -2, 12.5, 7, 7.5, 12.5, -7.5, 12.5, -12.5, 7, -12.5, -2]), 3.2, 4, 3.6, .32, fillc('#6e7783', g => { blot(g, 6, 'rgba(40,45,52,.4)', 6, 26, 24, 4); blot(g, 9, 'rgba(120,80,50,.25)', 4, 26, 24, 2.5); }), v => { hl(v, [-3, 6], -14, 14); v.beginPath(); v.moveTo(0, -3); v.lineTo(0, 6); v.stroke(); });
    for (const s of [-1, 1]) bx(K, s * 12.5 - 1.6, 1, 3.2, 5, 1.2, 1.2, 5, 1.6, .4, '#4a515a');
    bx(K, -4, -1.5, 8, 6, 1.5, 1.2, 7.6, 1.2, .35, '#59616c'); dome(K, 5, 8, 2, 7.6, 1, .4, '#4e5660'); SP.btur = spins(K, 24);
  }
  // ── 보스 1형태
  {
    const K = kit(108, 300), hull = g => { g.beginPath(); g.moveTo(0, 144); g.bezierCurveTo(32, 112, 42, 60, 42, 0); g.lineTo(37, -130); g.quadraticCurveTo(0, -150, -37, -130); g.lineTo(-42, 0); g.bezierCurveTo(-42, 60, -32, 112, 0, 144); g.closePath(); };
    part(K, hull, 5, 0, 4, .28, fillc('#636c76', g => {
      g.save(); g.scale(.84, .955); hull(g); g.fillStyle = '#866c4c'; g.fill(); g.clip(); const R = mulberry(3); for (let x = -50; x < 50; x += 3) ptone(g, R, x, -160, 3, 320, .22); g.restore();
      blot(g, 12, 'rgba(40,30,20,.3)', 16, 70, 280, 7); blot(g, 15, 'rgba(120,70,40,.28)', 10, 84, 290, 4);
      g.strokeStyle = '#1c1c1c'; g.lineWidth = .8; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 3, 138); g.lineTo(s * 5, 118); g.stroke(); }
    }), v => { v.globalAlpha = .35; for (let x = -42; x < 44; x += 3) { v.beginPath(); v.moveTo(x, -150); v.lineTo(x, 150); v.stroke(); } v.globalAlpha = 1; hl(v, [112, 56, -116], -44, 44, .6); });
    for (const [x, y, r] of [[0, -104, 15], [0, -74, 15], [0, 72, 15], [0, 102, 13.5]]) part(K, g => { g.beginPath(); g.arc(x, y, r, 0, TAU); }, 2, 4, 2, .3, fillc('#565e68'), v => { v.beginPath(); v.arc(x, y, r - 3, 0, TAU); v.stroke(); });
    bx(K, -26, -52, 52, 88, 5, 2.5, 4, 5, .3, '#7d8690', v => hl(v, range(-44, 36, 11), -30, 30), g => { blot(g, 7, 'rgba(50,55,62,.35)', 10, 50, 86, 6); g.fillStyle = '#18232d'; for (let y = -44; y < 30; y += 6) { g.fillRect(-25.5, y, 1.6, 2.6); g.fillRect(23.9, y, 1.6, 2.6); } });
    for (const s of [-1, 1]) for (const y of [-34, -12, 12]) bx(K, s * 31 - 2.6, y - 6, 5.2, 12, 2.4, 2, 4.5, 2.5, .25, '#d0d2cc', v => hl(v, [y - 2, y + 2], -40, 40));
    bx(K, -18, -40, 36, 58, 4, 2.2, 9, 5, .3, '#98a1aa', v => hl(v, range(-32, 16, 9), -20, 20), g => blot(g, 9, 'rgba(60,65,72,.3)', 6, 34, 56, 5));
    for (const y of [-24, 0]) { dome(K, 0, y, 9.5, 14, 6, .3, '#4c535c', '#070809'); part(K, g => { g.beginPath(); g.arc(0, y, 9.6, 0, TAU); g.arc(0, y, 7.2, 0, TAU, true); }, 1.2, 19, 1.6, .35, fillc('#2c3036')); }
    bx(K, -12, 16, 24, 20, 3, 2, 14, 5, .35, '#aab2ba', v => hl(v, [26], -14, 14), g => { g.fillStyle = '#14202a'; g.fillRect(-10, 31.5, 20, 2.4); g.fillRect(-11.6, 20, 1.8, 10); g.fillRect(9.8, 20, 1.8, 10); });
    bx(K, -5, 20, 10, 9, 2, 1.5, 19, 3, .4, '#8a939c'); bx(K, -1.2, -46, 2.4, 9, 1, 1, 14, 9, .4, '#3a4048'); dome(K, 0, 24, 2.6, 22, 3, .6, '#c9cfd4');
    for (const s of [-1, 1]) for (let y = -116; y < 112; y += 19) { if (y > -56 && y < 40) continue; const x = s * 30 * (y > 70 ? .78 : y < -100 ? .9 : 1); dome(K, x, y, 3, 4, 2.4, .35, '#373d45'); bx(K, x - .5, y, 1, 6, .4, .5, 6, 1, .4, '#111214'); }
    SP.b_ship = finish(K);
  }
  {
    const K = kit(180, 190);
    for (const s of [-1, 1]) bx(K, s * 66 - 18, -89, 36, 178, 6, 2.5, 1.5, 3, .25, '#1c1c17', v => hl(v, range(-86, 88, 6.5), s * 66 - 20, s * 66 + 20, 2.2), g => { g.fillStyle = 'rgba(120,100,70,.25)'; g.fillRect(s * 66 - 18, -89, 36, 178); });
    for (const s of [-1, 1]) bx(K, s * 49 - 7, -82, 14, 164, 3, 2, 6, 2.5, .22, '#5b6639', v => hl(v, range(-56, 80, 27), -80, 80, .6), g => blot(g, 4 + s, '#465027', 14, 120, 170, 9));
    bx(K, -55, -79, 110, 158, 10, 5, 6, 6, .22, '#687340', v => { hl(v, [-34, 52], -60, 60, .6); for (const x of [-30, 30]) { v.beginPath(); v.moveTo(x, -34); v.lineTo(x, 52); v.stroke(); } v.globalAlpha = .6; v.setLineDash([.6, 2.4]); hl(v, [-31, 49, 55], -52, 52, .9); v.setLineDash([]); v.globalAlpha = 1; }, g => {
      blot(g, 31, '#4f5a2e', 16, 110, 158, 13); blot(g, 37, '#7c7848', 9, 110, 158, 9); blot(g, 41, 'rgba(40,35,25,.3)', 14, 110, 158, 6);
      for (let i = -6; i < 7; i++) { g.fillStyle = i % 2 ? '#1a1a18' : '#c9a326'; poly(g, [i * 9, 58, i * 9 + 9, 58, i * 9 + 4, 66, i * 9 - 5, 66]); g.fill(); }
      g.fillStyle = '#d8d4c4'; g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.fillText('07', -36, 44); roundel(g, 36, 40, 7, ['#d8d4c4', '#8c2020', '#8c2020']);
    });
    bx(K, -45, -73, 90, 34, 4, 2.2, 11.5, 2.5, .3, '#3f4729', v => hl(v, range(-68, -42, 4.5), -40, 40, 1.5));
    for (const s of [-1, 1]) { bx(K, s * 34 - 6, -88, 12, 13, 3, 2.5, 9, 4, .4, '#23221e'); dome(K, s * 40, 72, 3.4, 9, 2, 1, '#d8d2a0', '#fffbe0'); dome(K, s * 28, 44, 6.5, 12, 2, .3, '#59643a', '#4a5430'); }
    part(K, g => poly(g, [-55, 60, 55, 60, 45, 80, -45, 80]), 4, 3, 4, .22, fillc('#56603a', g => blot(g, 9, 'rgba(110,95,65,.4)', 8, 100, 20, 5)), v => hl(v, [70], -60, 60));
    part(K, g => { g.beginPath(); g.arc(0, 8, 42, 0, TAU); }, 6, 12, 5, .25, fillc('#5f6a3b', g => { blot(g, 51, '#4a5429', 9, 80, 80, 10); blot(g, 55, '#77744a', 5, 80, 80, 7); }), v => { v.beginPath(); v.arc(0, 8, 33, 0, TAU); v.stroke(); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; v.beginPath(); v.moveTo(Math.cos(a) * 33, 8 + Math.sin(a) * 33); v.lineTo(Math.cos(a) * 42, 8 + Math.sin(a) * 42); v.stroke(); } });
    SP.b_tank = finish(K);
  }
  { const K = kit(340, 190, PI); bomber(K, { L: 176, S: 330, c: '#69727e', camo: '#4f5763', seed: 8, spec: .3, var: .14, c2: '#7a715f', eng: [38, 76, 114], mark: ['#e8e8e2', '#131416', '#131416'], tipc: '#9a2a2a', bands: [['#d8b020', .7, .02], ['#9a2a2a', .74, .02]] }); SP.b_bomber = finish(K); }
  {
    const K = kit(350, 170), o = { c: '#7b2c27', camo: '#5d1f1c', seed: 21, L: 150, S: 340, spec: .3, var: .2 }, fill = (c, n) => g => { g.fillStyle = c; g.fillRect(-999, -999, 1998, 1998); if (n) { camo(g, o); const R = mulberry(n); for (let x = -170; x < 170; x += 22) for (let y = -70; y < 80; y += 36) ptone(g, R, x, y, 22, 36, .2); } };
    const grid = v => { v.globalAlpha = .6; for (let x = -154; x < 170; x += 22) { v.beginPath(); v.moveTo(x, -99); v.lineTo(x, 99); v.stroke(); } v.setLineDash([.4, 1.3]); for (const y of [-40, -10, 24]) { v.beginPath(); v.moveTo(-170, y); v.lineTo(170, y); v.stroke(); } v.setLineDash([]); v.globalAlpha = 1; };
    part(K, g => poly(g, [0, 74, 60, 50, 168, -38, 150, -58, 70, -46, 30, -66, 0, -52, -30, -66, -70, -46, -150, -58, -168, -38, -60, 50]), 7, 0, 6, o.spec, fill(o.c, 3), grid);
    part(K, g => poly(g, [0, 60, 40, 40, 120, -28, 60, -30, 0, -38, -60, -30, -120, -28, -40, 40]), 10, 3, 6, .36, fill('#933a30', 5), grid);
    part(K, g => { g.beginPath(); g.ellipse(0, 6, 22, 52, 0, 0, TAU); }, 22, 5, 15, .45, fill('#555a63', 7), v => { for (let y = -30; y < 50; y += 14) { v.beginPath(); v.moveTo(-30, y); v.lineTo(30, y); v.stroke(); } });
    canopyK(K, { c: '#3a3d44' }, 44, 8, 13, 3, 14);
    for (const s of [-1, 1]) for (const x of [50, 96]) { part(K, g => rr(g, s * x - 7, -58, 14, 22, 3), 5, 4, 5, .5, fill('#222327')); over(K, g => { const q = g.createRadialGradient(s * x, -58, 0, s * x, -58, 7); q.addColorStop(0, '#fff3c0'); q.addColorStop(.5, '#ff9a3a'); q.addColorStop(1, 'rgba(255,120,30,0)'); g.fillStyle = q; g.fillRect(s * x - 8, -66, 16, 16); }); }
    dome(K, 0, 0, 12, 16, 8, 1, '#c98a2a', '#ffe9a0'); over(K, g => { const q = g.createRadialGradient(0, 0, 0, 0, 0, 16); q.addColorStop(0, 'rgba(255,250,210,.95)'); q.addColorStop(.5, 'rgba(255,200,80,.5)'); q.addColorStop(1, 'rgba(255,160,40,0)'); g.fillStyle = q; g.fillRect(-16, -16, 32, 32); });
    SP.b_wing = finish(K);
  }
  SP.mech = [205, 30, 185, 270, 350].map(mechK); // 스테이지별 색: 태평양·사막·북극·대서양·요새
  // ── 탄
  SP.eb = [orb(9, '#fff', '#ffe36a', '#ff4a10'), orb(13, '#fff', '#ffa6dc', '#e01f8c'), glow(11, 28, '#ffe36a', '#ff3a1f')];
  SP.pshot = glow(9, 26, '#fff7a8', '#ff9d1c');
  SP.pshotB = glow(10, 28, '#c9f2ff', '#2a8cff');
  SP.side = orb(7, '#fff', '#b5f0ff', '#2a8cff');
  SP.missile = mk(10, 22, g => { g.fillStyle = '#ffb347'; poly(g, [-2.5, 6, 2.5, 6, 0, 11]); g.fill(); rr(g, -2.2, -7, 4.4, 14, 2); fs(g, '#e9edf0'); poly(g, [-2.2, -6, 2.2, -6, 0, -10]); fs(g, '#d02a2a'); });
  SP.rocket = mk(10, 26, g => { g.fillStyle = '#7fd4ff'; poly(g, [-2.5, 8, 2.5, 8, 0, 13]); g.fill(); rr(g, -2.4, -9, 4.8, 18, 2); fs(g, '#f3d34a'); poly(g, [-2.4, -8, 2.4, -8, 0, -12]); fs(g, '#333'); });
  SP.blade = mk(40, 20, g => { g.beginPath(); g.arc(0, 14, 20, PI * 1.15, PI * 1.85); g.arc(0, 22, 24, PI * 1.72, PI * 1.28, true); g.closePath(); const q = g.createLinearGradient(0, -8, 0, 4); q.addColorStop(0, '#fff'); q.addColorStop(1, 'rgba(80,220,255,.2)'); g.fillStyle = q; g.fill(); });
  SP.lance = glow(18, 70, '#bfe6ff', '#2a6cff');
  SP.wave = mk(130, 50, g => { g.beginPath(); g.arc(0, 60, 80, PI * 1.2, PI * 1.8); g.arc(0, 84, 96, PI * 1.72, PI * 1.28, true); g.closePath(); const q = g.createLinearGradient(0, -24, 0, 14); q.addColorStop(0, '#fff'); q.addColorStop(.4, '#8dffcf'); q.addColorStop(1, 'rgba(40,255,160,.1)'); g.fillStyle = q; g.fill(); });
  SP.fireball = orb(18, '#fff', '#ffd75a', '#ff4a12');
  // ── 이펙트
  SP.fxFlash = orb(32, '#fff', '#fff6b0', 'rgba(255,220,90,.4)');
  SP.fxFire = orb(32, '#fff3a0', '#ff9a2a', 'rgba(200,40,10,.5)');
  SP.fxSmoke = orb(32, 'rgba(70,70,70,.9)', 'rgba(50,50,50,.7)', 'rgba(30,30,30,.3)');
  SP.fxBlue = orb(32, '#fff', '#9fdcff', 'rgba(40,120,255,.4)');
  SP.spark = orb(4, '#fff', '#ffe36a', '#ff8a1f');
  // ── 아이템
  const box = (c0, c1, ch) => mk(28, 20, g => { rr(g, -12, -8, 24, 16, 4); const q = g.createLinearGradient(0, -8, 0, 8); q.addColorStop(0, c0); q.addColorStop(1, c1); g.fillStyle = q; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#fff'; g.stroke(); g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000'; g.fillText(ch, 1, 1.5); g.fillStyle = '#fff'; g.fillText(ch, 0, .5); });
  SP.itP = box('#ff6a5a', '#9b1010', 'P'); SP.itB = box('#6adf6a', '#0f6b1a', 'B');
  SP.gold = mk(22, 16, g => { poly(g, [-9, -2, -5, -6, 9, -6, 5, -2]); fs(g, '#fff0a0', '#7a5200'); poly(g, [-9, -2, 5, -2, 5, 6, -9, 6]); fs(g, '#f0b82a', '#7a5200'); poly(g, [5, -2, 9, -6, 9, 2, 5, 6]); fs(g, '#b9820c', '#7a5200'); });
  SP.bombIcon = mk(14, 22, g => { poly(g, [-4, -10, 4, -10, 0, -5]); fs(g, '#888'); g.beginPath(); g.ellipse(0, 1, 4.5, 8, 0, 0, TAU); fs(g, hgrad(g, 5, '#f0e060', '#806a10')); });
  // ── 타격감용 이펙트
  SP.fxWhite = orb(32, 'rgba(255,255,255,.8)', 'rgba(255,255,255,.4)', 'rgba(255,255,255,.1)');
  SP.fxPink = orb(32, '#fff', '#ffa6dc', 'rgba(224,31,140,.4)');
  SP.streak = glow(5, 24, '#fff3a0', '#ff8a1f'); SP.streakB = glow(5, 24, '#d0f0ff', '#2a8cff');
  SP.flame = glow(8, 24, '#ffe9a0', '#ff7a1c');
  SP.rays = mk(128, 128, g => { for (let i = 0; i < 14; i++) { g.rotate(TAU / 14 + (i % 3) * .13); const L = 36 + ((i * 37) % 26), q = g.createLinearGradient(0, 0, 0, -L); q.addColorStop(0, 'rgba(255,250,200,.95)'); q.addColorStop(1, 'rgba(255,160,40,0)'); g.fillStyle = q; poly(g, [-3.5, 0, 3.5, 0, 0, -L]); g.fill(); } });
  SP.debris = [['#3a3a3a', '#9a9a9a', [-5, -2, 1, -5, 5, 0, 2, 4, -3, 3]], ['#4a3a2a', '#ffb347', [-4, -4, 4, -2, 3, 4, -5, 2]], ['#2c3038', '#aab3bd', [-5, 0, 0, -4, 5, -1, 1, 5]]].map(([c, l, p]) => mk(12, 12, g => { poly(g, p); g.fillStyle = c; g.fill(); g.lineWidth = 1.2; g.strokeStyle = l; g.stroke(); }));
  SP.glint = mk(20, 20, g => { g.fillStyle = '#fff'; poly(g, [0, -9, 1.5, -1.5, 9, 0, 1.5, 1.5, 0, 9, -1.5, 1.5, -9, 0, -1.5, -1.5]); g.fill(); });
  SP.scorch = mk(64, 64, g => { const q = g.createRadialGradient(0, 0, 2, 0, 0, 30); q.addColorStop(0, 'rgba(15,10,5,.85)'); q.addColorStop(.5, 'rgba(30,20,10,.55)'); q.addColorStop(1, 'rgba(30,20,10,0)'); g.fillStyle = q; g.fillRect(-32, -32, 64, 64); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.stroke(); g.strokeStyle = 'rgba(255,220,160,.25)'; g.beginPath(); g.arc(0, 0, 10.5, PI, PI * 1.6); g.stroke(); });
  VIG = document.createElement('canvas'); VIG.width = W; VIG.height = H; { const g = VIG.getContext('2d'), q = g.createRadialGradient(W / 2, H / 2, 210, W / 2, H / 2, 440); q.addColorStop(0, 'rgba(0,0,20,0)'); q.addColorStop(1, 'rgba(0,0,20,.55)'); g.fillStyle = q; g.fillRect(0, 0, W, H); }
}

// ───────────────────────── 배경
const BH = 1280;
// bg: buildBG 의 배경 번호 (0 태평양, 1 정글(미사용), 2 사막, 3 하늘 요새, 4 북극, 5 대서양)
const THEMES = [
  { name: 'PACIFIC OCEAN', sea: 1, bg: 0, boss: 'ship', msg: 'BATTLESHIP' },
  { name: 'NORTH AFRICAN DESERT', bg: 2, boss: 'bomber', msg: 'GIANT BOMBER' },
  { name: 'ARCTIC CIRCLE', bg: 4, boss: 'tank', msg: 'LAND FORTRESS' },
  { name: 'ATLANTIC OCEAN', sea: 1, bg: 5, boss: 'ship', msg: 'TRAITOR FLAGSHIP' },
  { name: 'IRON EMPEROR', bg: 3, boss: 'wing', msg: 'IRON EMPEROR' },
];
const BG = [];
function blobR(R, n, jit) { const a = []; for (let i = 0; i < n; i++) a.push(1 - jit + R() * jit * 2); return a; }
function blob(g, x, y, r, rads, add, fill) {
  const n = rads.length, p = i => { const a = i / n * TAU, rr2 = r * rads[(i + n) % n] + add; return [x + Math.cos(a) * rr2, y + Math.sin(a) * rr2 * .9]; };
  g.beginPath(); for (let i = 0; i <= n; i++) { const a = p(i), b = p(i + 1), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; if (!i) g.moveTo(mx, my); else g.quadraticCurveTo(a[0], a[1], mx, my); }
  g.closePath(); g.fillStyle = fill; g.fill();
}
function buildBG(n) {
  const c = document.createElement('canvas'); c.width = W; c.height = BH; const g = c.getContext('2d'), R = mulberry(n * 31 + 7);
  const wrap = (y, r, f) => { f(y); if (y - r < 0) f(y + BH); if (y + r > BH) f(y - BH); };
  const tree = (x, y, r, dk, lt) => wrap(y, r, yy => { disc(g, x + 2, yy + 2, r, 'rgba(0,0,0,.25)'); disc(g, x, yy, r, dk); disc(g, x - r * .25, yy - r * .25, r * .6, lt); });
  if (n === 0) {
    g.fillStyle = '#1b62a4'; g.fillRect(0, 0, W, BH);
    for (let i = 0; i < 40; i++) { const x = R() * W, y = R() * BH, r = 60 + R() * 90; wrap(y, r, yy => { const q = g.createRadialGradient(x, yy, 0, x, yy, r); q.addColorStop(0, R() < .5 ? 'rgba(10,50,110,.35)' : 'rgba(60,150,210,.22)'); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(x - r, yy - r, r * 2, r * 2); }); }
    g.lineWidth = 1.2; for (let i = 0; i < 900; i++) { const x = R() * W, y = R() * BH, r = 4 + R() * 7; g.strokeStyle = `rgba(255,255,255,${.06 + R() * .16})`; g.beginPath(); g.arc(x, y, r, PI * 1.15, PI * 1.85); g.stroke(); }
    for (let i = 0; i < 6; i++) {
      const x = 40 + R() * 400, y = i * 213 + R() * 100, r = 34 + R() * 50, rd = blobR(R, 14, .28), tr = [];
      for (let k = 0; k < r * .9; k++) { const a = R() * TAU, d = R() * r * .62; tr.push([x + Math.cos(a) * d, Math.sin(a) * d * .9, 3 + R() * 4]); }
      wrap(y, r + 30, yy => {
        blob(g, x, yy, r, rd, 22, 'rgba(70,170,215,.55)'); blob(g, x, yy, r, rd, 11, '#69c3d6'); blob(g, x, yy, r, rd, 4, '#e6d7a6'); blob(g, x, yy, r, rd, -3, '#4f8f3c'); blob(g, x - 3, yy - 3, r * .7, rd, -3, '#5fa347');
        for (const t of tr) { disc(g, t[0] + 1.5, yy + t[1] + 1.5, t[2], 'rgba(0,0,0,.25)'); disc(g, t[0], yy + t[1], t[2], '#2f6a2a'); disc(g, t[0] - 1, yy + t[1] - 1, t[2] * .55, '#57a044'); }
      });
    }
  } else if (n === 1) {
    g.fillStyle = '#3f7332'; g.fillRect(0, 0, W, BH);
    for (let i = 0; i < 26; i++) { const x = R() * W, y = R() * BH, w = 50 + R() * 80, h = 40 + R() * 70, col = ['#5f8f3a', '#86993f', '#4d8038', '#9a8f4a'][i % 4]; wrap(y, h, yy => { g.save(); g.translate(x, yy); g.rotate((i % 3 - 1) * .15); g.fillStyle = col; g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = 'rgba(0,0,0,.12)'; for (let k = -h / 2 + 5; k < h / 2; k += 6) { g.beginPath(); g.moveTo(-w / 2, k); g.lineTo(w / 2, k); g.stroke(); } g.restore(); }); }
    const river = (lw, col) => { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); for (let y = -20; y <= BH + 20; y += 8) { const x = 280 + Math.sin(y / BH * TAU * 2) * 120 + Math.sin(y / BH * TAU * 5) * 22; y === -20 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
    river(58, '#b9aa72'); river(46, '#3d86bd'); river(26, '#55a0d2');
    g.fillStyle = '#7a6a50'; g.fillRect(84, 0, 34, BH); g.fillStyle = '#3d3226'; for (let y = 0; y < BH; y += 8) g.fillRect(88, y, 26, 3); g.fillStyle = '#b8bcc0'; g.fillRect(92, 0, 3, BH); g.fillRect(107, 0, 3, BH);
    for (let i = 0; i < 1300; i++) { const x = R() * W, y = R() * BH, r = 3 + R() * 5; if (x > 76 && x < 126) continue; const rx = 280 + Math.sin(y / BH * TAU * 2) * 120 + Math.sin(y / BH * TAU * 5) * 22; if (Math.abs(x - rx) < 34) continue; tree(x, y, r, '#28561f', '#4d8f3a'); }
  } else if (n === 2) {
    g.fillStyle = '#cfa96c'; g.fillRect(0, 0, W, BH);
    for (let i = 0; i < 50; i++) { const x = R() * W, y = R() * BH, r = 50 + R() * 80; wrap(y, r, yy => { const q = g.createRadialGradient(x, yy, 0, x, yy, r); q.addColorStop(0, R() < .5 ? 'rgba(160,110,50,.3)' : 'rgba(240,215,160,.3)'); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(x - r, yy - r, r * 2, r * 2); }); }
    g.lineWidth = 2; for (let i = 0; i < 420; i++) { const x = R() * W, y = R() * BH, r = 18 + R() * 46; g.strokeStyle = R() < .5 ? 'rgba(120,80,30,.2)' : 'rgba(255,240,200,.22)'; g.beginPath(); g.arc(x, y, r, PI * 1.1, PI * 1.6); g.stroke(); }
    g.fillStyle = '#77736c'; g.fillRect(320, 160, 64, 760); g.fillStyle = '#69655e'; g.fillRect(200, 520, 120, 40); g.fillRect(200, 300, 120, 30);
    g.fillStyle = '#e8e4d8'; for (let y = 180; y < 900; y += 44) g.fillRect(350, y, 4, 24); g.fillRect(326, 168, 52, 4); g.fillRect(326, 908, 52, 4);
    for (const [x, y] of [[150, 280], [150, 380], [150, 500], [150, 600]]) { rr(g, x - 34, y - 26, 68, 52, 4); g.fillStyle = 'rgba(0,0,0,.3)'; g.fill(); rr(g, x - 38, y - 30, 68, 52, 4); g.fillStyle = '#8f8a78'; g.fill(); g.fillStyle = '#6f6a5a'; for (let k = -24; k < 20; k += 8) g.fillRect(x - 36, y + k, 64, 3); }
    for (let i = 0; i < 160; i++) { const x = R() * W, y = R() * BH, r = 3 + R() * 8, rd = blobR(R, 7, .3); if (x > 110 && x < 392 && y > 150 && y < 930) continue; wrap(y, r + 4, yy => { blob(g, x + 3, yy + 3, r, rd, 0, 'rgba(0,0,0,.3)'); blob(g, x, yy, r, rd, 0, '#8a6a42'); blob(g, x - 1, yy - 1, r * .6, rd, 0, '#b08a58'); }); }
    for (let i = 0; i < 40; i++) { const x = R() * W, y = R() * BH; if (x > 110 && x < 392 && y > 150 && y < 930) continue; tree(x, y, 3 + R() * 3, '#5d6a2a', '#8a9a3e'); }
  } else if (n === 4) {
    // 북극권: 설원·빙하 균열·얼어붙은 호수·침엽수·연구시설 돔
    g.fillStyle = '#dfe9f2'; g.fillRect(0, 0, W, BH);
    for (let i = 0; i < 46; i++) { const x = R() * W, y = R() * BH, r = 50 + R() * 90; wrap(y, r, yy => { const q = g.createRadialGradient(x, yy, 0, x, yy, r); q.addColorStop(0, R() < .5 ? 'rgba(150,180,210,.32)' : 'rgba(255,255,255,.5)'); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(x - r, yy - r, r * 2, r * 2); }); }
    for (let i = 0; i < 5; i++) { const x = 40 + R() * 400, y = i * 256 + R() * 120, r = 30 + R() * 46, rd = blobR(R, 12, .3); wrap(y, r + 10, yy => { blob(g, x, yy, r, rd, 6, '#b9cfe0'); blob(g, x, yy, r, rd, 0, '#7fa3c2'); blob(g, x - 4, yy - 4, r * .7, rd, 0, '#9dbcd6'); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x - r * .6 + k * 9, yy - r * .3); g.lineTo(x - r * .3 + k * 11, yy + r * .4); g.stroke(); } }); }
    g.lineCap = 'round'; for (let i = 0; i < 26; i++) { let x = R() * W, y = R() * BH; g.strokeStyle = 'rgba(70,110,150,.45)'; g.lineWidth = 1 + R() * 1.6; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - .5) * 50; y += 10 + R() * 30; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 700; i++) { const x = R() * W, y = R() * BH, r = 2.5 + R() * 4; if (R() < .55 && (x > 150 && x < 330)) continue; wrap(y, r + 3, yy => { disc(g, x + 2, yy + 3, r, 'rgba(40,60,90,.22)'); g.fillStyle = '#25433f'; poly(g, [x, yy - r * 1.4, x + r, yy + r, x - r, yy + r]); g.fill(); g.fillStyle = 'rgba(255,255,255,.75)'; poly(g, [x, yy - r * 1.4, x + r * .45, yy - r * .1, x - r * .45, yy - r * .1]); g.fill(); }); }
    g.fillStyle = '#c7d6e3'; g.fillRect(222, 0, 36, BH); g.fillStyle = 'rgba(90,110,130,.35)'; for (let y = 0; y < BH; y += 40) g.fillRect(238, y + 8, 4, 18);
    for (const [x, y, r] of [[120, 300, 26], [370, 700, 32], [110, 1050, 22]]) { disc(g, x + 6, y + 8, r, 'rgba(30,50,80,.3)'); const q = g.createRadialGradient(x - r * .4, y - r * .4, 2, x, y, r); q.addColorStop(0, '#f4f8fb'); q.addColorStop(1, '#6d7f90'); disc(g, x, y, r, q); g.strokeStyle = 'rgba(40,50,60,.5)'; g.lineWidth = 1; for (let k = -r + 6; k < r; k += 8) { g.beginPath(); g.moveTo(x - Math.sqrt(r * r - k * k), y + k); g.lineTo(x + Math.sqrt(r * r - k * k), y + k); g.stroke(); } disc(g, x, y + r * .55, 3, '#ff5a3a'); }
    for (let i = 0; i < 260; i++) { const x = R() * W, y = R() * BH; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(x, y, 1.5, 1.5); }
  } else if (n === 5) {
    // 대서양: 폭풍 치는 어두운 바다·흰 파도·기름띠·잔해
    g.fillStyle = '#1d3a52'; g.fillRect(0, 0, W, BH);
    for (let i = 0; i < 50; i++) { const x = R() * W, y = R() * BH, r = 60 + R() * 110; wrap(y, r, yy => { const q = g.createRadialGradient(x, yy, 0, x, yy, r); q.addColorStop(0, R() < .5 ? 'rgba(8,22,36,.45)' : 'rgba(70,110,135,.25)'); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(x - r, yy - r, r * 2, r * 2); }); }
    g.lineCap = 'round'; for (let i = 0; i < 1400; i++) { const x = R() * W, y = R() * BH, r = 5 + R() * 10; g.strokeStyle = `rgba(225,238,245,${.08 + R() * .28})`; g.lineWidth = 1 + R() * 1.4; g.beginPath(); g.arc(x, y, r, PI * 1.1, PI * 1.75); g.stroke(); }
    for (let i = 0; i < 9; i++) { const x = R() * W, y = R() * BH, r = 20 + R() * 34, rd = blobR(R, 10, .4); wrap(y, r, yy => { blob(g, x, yy, r, rd, 0, 'rgba(10,12,16,.45)'); blob(g, x - 3, yy - 3, r * .5, rd, 0, 'rgba(120,90,160,.12)'); }); }
    for (let i = 0; i < 40; i++) { const x = R() * W, y = R() * BH, w = 3 + R() * 10; g.save(); g.translate(x, y); g.rotate(R() * PI); g.fillStyle = R() < .5 ? '#4b4a44' : '#6b6255'; g.fillRect(-w / 2, -1.5, w, 3); g.restore(); }
  } else {
    g.fillStyle = '#434a55'; g.fillRect(0, 0, W, BH);
    for (let r = 0; r < 20; r++) for (let q = 0; q < 8; q++) {
      const x = q * 60, y = r * 64, k = R(); g.fillStyle = ['#4a525e', '#3d444e', '#525a66', '#454c57'][(k * 4) | 0]; g.fillRect(x, y, 60, 64); g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, 60, 64); g.strokeStyle = 'rgba(255,255,255,.07)'; g.strokeRect(x + 2.5, y + 2.5, 56, 60);
      const t = R();
      if (t < .14) { g.fillStyle = '#23272d'; for (let i = 10; i < 54; i += 7) g.fillRect(x + 10, y + i, 40, 3); }
      else if (t < .24) { disc(g, x + 30, y + 32, 16, '#2a2f36'); disc(g, x + 30, y + 32, 11, '#586270'); disc(g, x + 30, y + 32, 4, '#1b1e22'); }
      else if (t < .32) { g.fillStyle = '#c9a53a'; for (let i = 0; i < 6; i++) { poly(g, [x + 6 + i * 8, y + 52, x + 12 + i * 8, y + 52, x + 8 + i * 8, y + 60, x + 2 + i * 8, y + 60]); g.fill(); } }
      else if (t < .42) { disc(g, x + 12, y + 12, 2.5, R() < .5 ? '#ff5a4a' : '#6affc0'); disc(g, x + 48, y + 52, 2, '#ffd75a'); }
    }
    for (const x of [118, 362]) { g.fillStyle = '#2b3038'; g.fillRect(x - 7, 0, 14, BH); g.fillStyle = '#6b7684'; g.fillRect(x - 4, 0, 4, BH); g.fillStyle = '#20242a'; for (let y = 0; y < BH; y += 64) g.fillRect(x - 9, y + 28, 18, 8); }
    g.fillStyle = 'rgba(20,24,30,.55)'; g.fillRect(226, 0, 28, BH); g.fillStyle = 'rgba(120,200,255,.5)'; for (let y = 0; y < BH; y += 32) g.fillRect(238, y + 6, 4, 14);
  }
  return c;
}
let CLOUD;
function buildClouds() {
  const c = document.createElement('canvas'); c.width = W; c.height = 1024; const g = c.getContext('2d'), R = mulberry(99);
  for (let i = 0; i < 12; i++) { const cx = R() * W, cy = R() * 1024; for (let k = 0; k < 9; k++) { const x = cx + (R() - .5) * 150, y = cy + (R() - .5) * 60, r = 26 + R() * 44; for (const yy of [y, y - 1024, y + 1024]) { const q = g.createRadialGradient(x, yy, 0, x, yy, r); q.addColorStop(0, 'rgba(255,255,255,.5)'); q.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = q; g.fillRect(x - r, yy - r, r * 2, r * 2); } } }
  return c;
}

// ───────────────────────── 기체 정의
const PLANES = [
  { name: 'P-38 LIGHTNING', spr: 'p38', speed: 4.2, dmg: 1, sub: 'homing', chg: 'lance', bomb: 'carpet', shot: 'pshot', ko: ['유도 미사일', '관통 랜스', '융단 폭격'],
    shots: [[[-5, 0], [5, 0]], [[-10, 0], [0, 0], [10, 0]], [[-15, 0], [-5, 0], [5, 0], [15, 0]], [[-15, 0], [-5, 0], [5, 0], [15, 0], [-19, -.14], [19, .14]]] },
  { name: 'SPITFIRE', spr: 'spit', speed: 3.9, dmg: 1.25, sub: 'rocket', chg: 'fireball', bomb: 'pillar', shot: 'pshot', ko: ['직진 로켓', '대형 화염탄', '섬광 기둥'],
    shots: [[[-4, 0], [4, 0]], [[-8, 0], [0, 0], [8, 0]], [[-12, 0], [-4, 0], [4, 0], [12, 0]], [[-16, 0], [-8, 0], [0, 0], [8, 0], [16, 0]]] },
  { name: 'ZERO FIGHTER', spr: 'zero', speed: 4.7, dmg: .9, sub: 'side', chg: 'wingmen', bomb: 'carpet', shot: 'pshotB', ko: ['확산 측면탄', '편대 호위기', '융단 폭격'],
    shots: [[[-5, 0], [5, 0]], [[-5, 0], [5, 0], [-9, -.16], [9, .16]], [[-5, 0], [5, 0], [-9, -.16], [9, .16], [-12, -.32], [12, .32]], [[-8, 0], [0, 0], [8, 0], [-10, -.16], [10, .16], [-13, -.32], [13, .32]]] },
  { name: 'SHINDEN', spr: 'shin', speed: 3.6, dmg: 1.5, sub: 'blade', chg: 'wave', bomb: 'pillar', shot: 'pshotB', ko: ['관통 칼날', '초승달 파동', '섬광 기둥'],
    shots: [[[-4, 0], [4, 0]], [[-7, 0], [0, 0], [7, 0]], [[-10, 0], [-3.5, 0], [3.5, 0], [10, 0]], [[-13, 0], [-6.5, 0], [0, 0], [6.5, 0], [13, 0]]] },
];

// ───────────────────────── 게임 상태
let state = 'title', frame = 0, sel = 0, PL = PLANES[0];
let stage = 0, loop = 0, score = 0, hi = +(localStorage.getItem('sky1945hi') || 50000), lives = 2, nextExt = 400000;
let P = null, pb = [], eb = [], enemies = [], items = [], fx = [], texts = [], ev = [], groups = {}, gidc = 0;
let st = 0, phase = 'run', pt = 0, boss = null, bomb = null, shake = 0, flash = 0, bgY = 0, clY = 0, overT = 0, bigN = 0, god = false;
let hitstop = 0, slow = 0, decals = [], mzF = 0, mzX = 0, lastTick = 0, VIG, CLOUDSH;

const bsp = () => 2.3 + stage * .18 + loop * .7;
const aim = (x, y) => Math.atan2(P.y - y, P.x - x);
function shoot(x, y, a, sp, k = 0) {
  if (mzF !== frame || mzX !== x) { mzF = frame; mzX = x; SFX.eshot(x); fx.push({ x, y, vx: 0, vy: 0, t: 0, life: 7, s0: 9, s1: 26, spr: k === 1 ? SP.fxPink : SP.fxFlash, add: 1 }); }
  if (eb.length < 700) eb.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, k, a });
}
function fan(x, y, a, n, spread, sp, k) { for (let i = 0; i < n; i++) shoot(x, y, a + (n > 1 ? (i / (n - 1) - .5) * spread : 0), sp, k); }
function ring(x, y, n, sp, k, off = 0) { for (let i = 0; i < n; i++) shoot(x, y, off + i / n * TAU, sp, k); }
function addScore(n) { score += n; if (score > hi) hi = score; if (score >= nextExt) { lives++; nextExt += 600000; SFX.ext(); texts.push({ x: W / 2, y: 200, s: '1UP!', t: 0, big: 1 }); } }
function popup(x, y, s) { texts.push({ x, y, s: '' + s, t: 0 }); }

function ringFx(x, y, r0, r1, life, col, lw) { fx.push({ ring: 1, x, y, vx: 0, vy: 0, t: 0, life, s0: r0, s1: r1, col: col || '255,235,180', lw: lw || 4, add: 1 }); }
function debris(x, y, n, v) { for (let i = 0; i < n; i++) { const a = rnd(0, TAU), sp = rnd(1.5, v); fx.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + .6, t: 0, life: 26 + rnd(0, 24), s0: rnd(7, 13), s1: 3, spr: SP.debris[i % 3], add: 0, top: 1, solid: 1, trail: 1, rot: rnd(0, TAU), vr: rnd(-.4, .4) }); } }
function boom(x, y, s = 1, quiet) {
  const R = 16 * s;
  fx.push({ x, y, vx: 0, vy: 0, t: 0, life: 9, s0: R * 1.5, s1: R * 3.6, spr: SP.fxFlash, add: 1 });
  if (s >= 1.4) fx.push({ x, y, vx: 0, vy: 0, t: 0, life: 13, s0: R * 2.6, s1: R * 5.5, spr: SP.rays, add: 1, rot: rnd(0, TAU), vr: .04 });
  ringFx(x, y, R * .5, R * (s >= 2 ? 4.6 : 2.8), s >= 2 ? 24 : 14, null, s >= 2 ? 7 : 3);
  for (let i = 0; i < 3 + s * 2; i++) fx.push({ x: x + rnd(-R, R) * .6, y: y + rnd(-R, R) * .6, vx: rnd(-.8, .8), vy: rnd(-.8, .8) + .6, t: -i * 2, life: 20 + rnd(0, 12), s0: R * .7, s1: R * 2.2, spr: SP.fxFire, add: 1 });
  for (let i = 0; i < 2; i++) fx.push({ x: x + rnd(-R, R) * .5, y: y + rnd(-R, R) * .5, vx: 0, vy: .5, t: -3 - i * 4, life: 10, s0: R * .5, s1: R * 1.4, spr: SP.fxFlash, add: 1 });
  for (let i = 0; i < 2 + (s > 1); i++) fx.push({ x: x + rnd(-R, R) * .4, y: y + rnd(-R, R) * .4, vx: rnd(-.4, .4), vy: 1, t: -6, life: 50, s0: R, s1: R * 2.8, spr: SP.fxSmoke, add: 0 });
  for (let i = 0; i < 5 + s * 4; i++) { const a = rnd(0, TAU), v = rnd(3, 7 + s); fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 10 + rnd(0, 14), s0: 6 + s, s1: 2, spr: SP.streak, add: 1, rot: a + PI / 2 }); }
  debris(x, y, Math.round(1 + s * 2), 3 + s);
  if (!quiet) (s >= 3 ? SFX.big : s >= 2 ? SFX.mid : SFX.boom)(x); if (s >= 2) shake = Math.max(shake, 5 * s);
  if (fx.length > 1100) fx.splice(0, fx.length - 1100);
}
function spark(x, y, blue) {
  fx.push({ x, y, vx: 0, vy: 0, t: 0, life: 7, s0: 7, s1: 20, spr: blue ? SP.fxBlue : SP.fxFlash, add: 1 });
  for (let i = 0; i < 2; i++) { const a = PI / 2 + rnd(-1.2, 1.2), v = rnd(3, 7); fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 7 + rnd(0, 6), s0: 6, s1: 2, spr: blue ? SP.streakB : SP.streak, add: 1, rot: a + PI / 2 }); }
  SFX.tick(x);
}
function clearBullets(sc) { if (eb.length) SFX.cancel(); for (const b of eb) { fx.push({ x: b.x, y: b.y, vx: 0, vy: -1, t: 0, life: 16, s0: 5, s1: 18, spr: SP.fxBlue, add: 1 }); if (sc) addScore(100); } eb.length = 0; }

// ───────────────────────── 적
const ET = {
  zako: { hp: 2, hw: 11, hh: 10, score: 200, air: 1, ai: aiZako, s: 'zako', big: 1 },
  mid: { hp: 45, hw: 32, hh: 20, score: 2000, air: 1, ai: aiMid, s: 'mid', big: 2 },
  big: { hp: 240, hw: 54, hh: 30, score: 10000, air: 1, ai: aiMid, s: 'big', big: 3 },
  tank: { hp: 8, hw: 13, hh: 14, score: 500, ground: 1, ai: aiTank, s: 'tank', tur: 1, big: 1 },
  turret: { hp: 18, hw: 16, hh: 16, score: 1000, ground: 1, ai: aiTank, s: 'base', tur: 1.35, big: 1.4 },
  boat: { hp: 14, hw: 11, hh: 28, score: 800, ground: 1, ai: aiTank, s: 'boat', tur: 1, big: 1.5 },
  boss: { hp: 1, hw: 1, hh: 1, score: 100000, ai: aiBoss, big: 3 },
};
function enemy(type, x, y, o) {
  const e = Object.assign({ type, x, y, t: 0, flash: 0, rot: PI, ta: PI / 2 }, ET[type], o);
  e.hp *= 1 + loop * .5; e.maxhp = e.hp; enemies.push(e); return e;
}
function aiZako(e) {
  const t = e.t, d = e.dir; let w = 0;
  if (e.mode === 'dive') { if (t > 35 && t < 75) w = d * .035; }
  else if (e.mode === 'loop') { if (t > 30 && t < 120) w = d * TAU / 90; }
  else if (e.mode === 'uturn') { if (t > 45 && t < 90) w = d * PI / 45; }
  else if (e.mode === 'side') w = Math.sin(t / 18) * .035 * d;
  e.a += w; e.x += Math.cos(e.a) * e.sp; e.y += Math.sin(e.a) * e.sp; e.rot = e.a + PI / 2;
  if (t === e.ft && e.y < H * .65 && e.y > 0 && P.alive) shoot(e.x, e.y, aim(e.x, e.y), bsp());
  if (t > 70 && (e.x < -40 || e.x > W + 40 || e.y < -40 || e.y > H + 40)) e.gone = true;
}
function aiMid(e) {
  const t = e.t, B = e.type === 'big';
  if (t < e.stay) {
    e.y += (e.ty - e.y) * .04; e.x += Math.sin(t / 50) * (B ? .9 : .5);
    if (t > 50 && P.alive) {
      const u = (t - 50) % e.rate;
      if (B) { if (u === 0) ring(e.x, e.y, 14 + stage * 2, bsp() * .8, 1, t * .01); if (u === 40 || u === 52 || u === 64) for (const s of [-1, 1]) fan(e.x + s * 34, e.y + 10, aim(e.x + s * 34, e.y + 10), 3, .4, bsp() * 1.15, 2); }
      else if (u === 0 || u === 12) fan(e.x, e.y + 14, aim(e.x, e.y + 14), 3 + (loop > 0) * 2, .55, bsp(), 0);
    }
  } else { e.vy = (e.vy || 0) - .04; e.y += e.vy; if (e.y < -80) e.gone = true; }
}
function aiTank(e) {
  e.x += e.vx || 0; if (e.type === 'boat') e.y += .4;
  e.ta = aim(e.x, e.y);
  if (P.alive && e.y > 10 && e.y < H * .7 && e.t % e.rate === e.fp) { if (e.type === 'turret') fan(e.x, e.y, e.ta, 3, .5, bsp() * .9, 0); else shoot(e.x, e.y, e.ta, bsp() * .9, 0); }
  if (e.y > H + 50) e.gone = true;
}
const BOSS = {
  ship: { hw: 34, hh: 128, ty: 170, mx: 24, dir: 1, tur: [[0, -104, 1], [0, -74, 1], [0, 72, 1], [0, 102, .9]] },
  tank: { hw: 70, hh: 80, ty: 140, mx: 70, dir: -1, tur: [[0, 8, 2], [-40, -52, .9], [40, -52, .9], [-40, 62, .9], [40, 62, .9]] },
  bomber: { hw: 130, hh: 34, ty: 120, mx: 90, dir: 1, air: 1, tur: [[-40, 8, .9], [40, 8, .9], [-96, 2, .8], [96, 2, .8], [0, 50, .8]] },
  wing: { hw: 135, hh: 38, ty: 120, mx: 100, dir: -1, air: 1, tur: [[-50, 6, 1], [50, 6, 1], [-112, -24, .8], [112, -24, .8]] },
};
const MECH_TUR = [[-46, 56], [46, 56], [0, 14]];
function spawnBoss() {
  const k = THEMES[stage].boss, D = BOSS[k];
  boss = enemy('boss', W / 2, -D.hh - 40, { kind: k, D, hp: 800 + stage * 260, hp2: (760 + stage * 280) * (1 + loop * .5), hw: D.hw, hh: D.hh, ph: 1, st: 'enter', inv: true, ty: D.ty, air: D.air });
}
function aiBoss(b) {
  const D = b.D, sp = bsp(), T = b.t;
  if (b.st === 'enter') { b.y += (b.ty - b.y) * .025 + .15; if (T > 190) { b.st = 'fight'; b.inv = false; b.t = 0; b.bx = b.x; } return; }
  if (b.st === 'morph') {
    if (T % 6 === 0) boom(b.x + rnd(-b.hw, b.hw), b.y + rnd(-b.hh, b.hh), 1.2);
    if (T === 90) { b.ph = 2; b.air = 1; boom(b.x, b.y, 3); flash = 14; hitstop = 6; ringFx(b.x, b.y, 30, 400, 40, '160,220,255', 12); b.hw = 50; b.hh = 40; }
    if (T > 90) { b.x += (W / 2 - b.x) * .05; b.y += (150 - b.y) * .05; }
    if (T > 180) { b.st = 'fight'; b.inv = false; b.t = 0; b.hp = b.maxhp = b.hp2; }
    return;
  }
  if (b.st === 'die') {
    b.y += .4; if (T % 5 === 0) boom(b.x + rnd(-60, 60), b.y + rnd(-50, 50), 1.5);
    if (T > 170) { for (let i = 0; i < 8; i++) boom(b.x + rnd(-70, 70), b.y + rnd(-60, 60), 3, i > 0); flash = 34; hitstop = 8; shake = 22; for (let i = 0; i < 3; i++) ringFx(b.x, b.y, 20 + i * 30, 420 + i * 60, 40 + i * 12, null, 12); fx.push({ x: b.x, y: b.y, vx: 0, vy: 0, t: 0, life: 44, s0: 180, s1: 520, spr: SP.rays, add: 1, rot: 0, vr: .02 }); debris(b.x, b.y, 24, 9); b.gone = true; boss = null; addScore(b.score); popup(b.x, b.y, b.score); phase = 'clear'; pt = 0; music('none'); }
    return;
  }
  if (b.ph === 1) b.x = W / 2 + Math.sin(T / 130) * D.mx;
  else { b.x = W / 2 + Math.sin(T / 75) * 150; b.y = 150 + Math.sin(T / 50) * 45; }
  if (!P.alive) return;
  const c = Math.floor(T / 220) % 3, u = T % 220, n = stage + loop * 2, tur = b.ph === 1 ? D.tur : MECH_TUR;
  const tp = i => { const q = tur[i % tur.length]; return [b.x + q[0], b.y + q[1]]; };
  if (b.ph === 1) {
    if (c === 0) { if (u % 45 === 10) for (let i = 0; i < tur.length; i++) { const [x, y] = tp(i); fan(x, y, aim(x, y), 3 + (n > 1), .45, sp, 0); } }
    else if (c === 1) { if (u < 150 && u % 7 === 0) { const a = u * .13 * D.dir, m = n >= 2 ? 4 : 2; for (let i = 0; i < m; i++) shoot(b.x, b.y, a + i * TAU / m, sp * .9, 1); } if (u % 60 === 30) { const [x, y] = tp(u); shoot(x, y, aim(x, y), sp * 1.3, 2); } }
    else { if (u % 55 === 5) ring(b.x, b.y, 14 + n * 2, sp * .8, 0, u); if (u % 55 === 30) { const [x, y] = tp(u); fan(x, y, aim(x, y), 5, .9, sp * 1.2, 2); } }
  } else {
    if (c === 0) { if (u < 160 && u % 5 === 0) { const a = PI / 2 + Math.sin(u / 17) * 1.1, [x, y] = tp(0), [x2, y2] = tp(1); shoot(x, y, a, sp * 1.1, 2); shoot(x2, y2, PI - a, sp * 1.1, 2); } }
    else if (c === 1) { if (u % 35 === 0) { const [x, y] = tp(2); fan(x, y, aim(x, y), 7 + n, 1.4, sp * 1.25, 2); } if (u % 70 === 20) ring(b.x, b.y, 12 + n * 2, sp * .7, 1, u * .01); }
    else { if (u < 170 && u % 4 === 0) for (let i = 0; i < 3; i++) shoot(b.x, b.y, u * .09 * D.dir + i * TAU / 3, sp * .95, 0); if (u % 60 === 0) for (let i = 0; i < 2; i++) { const [x, y] = tp(i); shoot(x, y, aim(x, y), sp * 1.3, 1); } }
  }
}
function hurt(e, d) { if (e.dead || e.inv) return; e.hp -= d; e.flash = 3; e.kick = e.type === 'boss' ? 1.5 : 3.5; if (e.hp <= 0) kill(e); }
function kill(e) {
  if (e.type === 'boss') {
    e.inv = true; e.t = 0; clearBullets(1); SFX.big(e.x); hitstop = 10; shake = 14; flash = 8; ringFx(e.x, e.y, 30, 380, 40, null, 10); if (e.ph === 2) slow = 150;
    if (e.ph === 1) { e.st = 'morph'; addScore(30000); popup(e.x, e.y, 30000); } else e.st = 'die';
    return;
  }
  e.dead = true; addScore(e.score); boom(e.x, e.y, e.big);
  shake = Math.max(shake, e.big * 2.2); if (e.big >= 2) hitstop = e.big >= 3 ? 6 : 3;
  if (e.ground) { if (THEMES[stage].sea) { ringFx(e.x, e.y, 10, 64, 40, '255,255,255', 6); for (let i = 0; i < 6; i++) fx.push({ x: e.x + rnd(-14, 14), y: e.y + rnd(-24, 24), vx: 0, vy: 1, t: -i * 3, life: 50, s0: 10, s1: 26, spr: SP.fxWhite, add: 0 }); } else decals.push({ x: e.x, y: e.y, s: e.big }); }
  if (e.gid) { const G = groups[e.gid]; if (G && ++G.k === G.n) items.push(mkItem('P', e.x, e.y)); }
  if (e.drop) items.push(mkItem(e.drop, e.x, e.y));
  if (e.ground && Math.random() < (e.type === 'tank' ? .35 : .7)) items.push({ kind: 'G', x: e.x, y: e.y, t: (Math.random() * 64) | 0 });
  if (e.type !== 'zako') popup(e.x, e.y, e.score);
}
function mkItem(kind, x, y) { const a = rnd(.3, 1.2) * (Math.random() < .5 ? 1 : -1); return { kind, x, y, vx: Math.sin(a) * 1.6, vy: 1.2, t: 0 }; }

// ───────────────────────── 스테이지 구성
function buildStage(n) {
  const R = mulberry(n * 977 + 13 + loop * 5), list = [], at = (t, f) => list.push({ t, f }), T = THEMES[n];
  groups = {}; bigN = 0;
  const zs = red => red ? 'zakoR' : n % 2 ? 'zakoB' : 'zako';
  const zk = (mode, x, y, dir, o) => enemy('zako', x, y, Object.assign({ mode, dir, a: PI / 2, sp: 3 + n * .15, ft: Math.random() < .3 + n * .1 + loop * .3 ? 20 + (Math.random() * 40 | 0) : -1 }, o));
  const wave = (t, mode, x, cnt, dir, red) => {
    const gid = red ? ++gidc : 0; if (red) groups[gid] = { n: cnt, k: 0 };
    for (let i = 0; i < cnt; i++) at(t + i * 11, () => mode === 'side' ? zk(mode, dir > 0 ? -20 : W + 20, x, dir, { a: dir > 0 ? .3 : PI - .3, gid, s: zs(red) }) : zk(mode, x, -20, dir, { gid, s: zs(red) }));
  };
  const ground = t => {
    const cnt = 2 + (R() * 3 | 0), x0 = 50 + R() * 260, type = T.sea ? 'boat' : R() < .35 ? 'turret' : 'tank', vert = R() < .4;
    at(t, () => { for (let i = 0; i < cnt; i++) enemy(type, vert ? x0 : x0 + i * 46, vert ? -30 - i * 50 : -30 - (i % 2) * 20, { rate: Math.max(50, 120 - n * 10 - loop * 25), fp: Math.random() * 50 | 0, vx: type === 'tank' && !vert && R() < .3 ? .3 : 0 }); });
  };
  let t = 150;
  while (t < 4300) {
    const k = R(), x = 60 + R() * 360, dir = x < W / 2 ? 1 : -1;
    if (k < .2) wave(t, 'dive', x, 5 + (n > 1), dir);
    else if (k < .38) { wave(t, 'side', 60 + R() * 200, 5, R() < .5 ? 1 : -1); if (n > 0) wave(t + 30, 'side', 100 + R() * 200, 4, R() < .5 ? 1 : -1); }
    else if (k < .52) wave(t, 'loop', x, 5, dir);
    else if (k < .66) { wave(t, 'uturn', 90 + R() * 80, 4, 1); wave(t, 'uturn', W - 90 - R() * 80, 4, -1); }
    else if (k < .84) { at(t, () => enemy('mid', x, -40, { ty: 90 + Math.random() * 110, stay: 420, rate: Math.max(50, 90 - n * 8) })); if (n > 0 && R() < .5) at(t + 40, () => enemy('mid', W - x, -40, { ty: 90 + Math.random() * 110, stay: 420, rate: Math.max(50, 90 - n * 8) })); }
    else at(t, () => { for (let i = 0; i < 5; i++) zk('str', clamp(x, 100, W - 100) + (i - 2) * 36, -20 - Math.abs(i - 2) * 26, 1, { sp: 2.6, ft: 40 + i * 6, s: zs(0) }); });
    if (R() < .75) ground(t + 40);
    t += 150 - n * 10 + R() * 70;
  }
  for (const [i, tt] of [380, 1250, 2150, 3050, 3850].entries()) wave(tt, i % 2 ? 'dive' : 'loop', i % 2 ? 140 + i * 50 : 340 - i * 40, 5, i % 2 ? 1 : -1, 1);
  const bigAt = tt => at(tt, () => enemy('big', W / 2, -70, { ty: 130, stay: 1000, rate: Math.max(70, 110 - n * 10), drop: (bigN++ + n) % 2 ? 'P' : 'B' }));
  bigAt(2000); if (n >= 1) bigAt(3500);
  at(1000, () => enemy('mid', W / 2, -40, { ty: 120, stay: 420, rate: 80, drop: 'B' }));
  return list.sort((a, b) => a.t - b.t);
}
function startStage() {
  const bgi = THEMES[stage].bg; if (!BG[bgi]) BG[bgi] = buildBG(bgi);
  ev = buildStage(stage); st = 0; phase = 'run'; pt = 0; boss = null; bomb = null;
  pb = []; eb = []; enemies = []; items = []; texts = []; decals = []; hitstop = 0; slow = 0; music('stage');
}
function mechSpr() { return SP.mech[stage % SP.mech.length]; }
function newPlayer(keep) { return { x: W / 2, y: H + 40, pw: keep ? keep.pw : 0, bombs: keep ? keep.bombs : 2, inv: 200, ct: 0, sct: 0, charge: 0, alive: true, enter: 60, bank: 0, wing: 0, dead: 0 }; }
function startGame() { PL = PLANES[sel]; stage = 0; loop = 0; score = 0; lives = 2; nextExt = 400000; P = newPlayer(); fx = []; startStage(); if (STORY && STORY.enabled) enterStory('briefing'); else state = 'play'; }
// ── 스토리 연결 (story.js). 스토리 화면 동안 전투 업데이트는 멈추고 점수·생명·무기 상태는 그대로 유지된다.
const STORY = window.IronStory || null;
let lastBonus = 0;
function storyInfo() { return { stage, loop, score, hi, lives, bombs: P ? P.bombs : 0, bonus: lastBonus, bg: THEMES[stage].bg }; }
function enterStory(mode) { state = 'story'; music('title'); STORY.begin(mode, storyInfo()); }
function nextStage() { stage++; if (stage >= THEMES.length) { stage = 0; loop++; } P = newPlayer(P); startStage(); }
function storyDone(r) {
  if (r.mode === 'briefing') { state = 'play'; music('stage'); return; }
  if (r.mode === 'final' && r.choice === 'title') { try { localStorage.setItem('sky1945hi', hi); } catch (_) {} state = 'title'; return; }
  nextStage();
  if (STORY.enabled) enterStory('briefing'); else state = 'play';
}

// ───────────────────────── 플레이어
function fireMain(x, y) {
  const pat = PL.shots[P.pw]; P.mz = 2;
  for (const [dx, a] of pat) pb.push({ x: x + dx, y: y - 14, vx: Math.sin(a) * 15, vy: -Math.cos(a) * 15, dmg: PL.dmg, hw: 4, hh: 10, spr: SP[PL.shot], rot: a });
}
function fireSub() {
  const lv = P.pw, x = P.x, y = P.y; if (PL.sub === 'homing' || PL.sub === 'rocket') SFX.sub();
  if (PL.sub === 'homing') for (let i = 0; i < (lv > 2 ? 4 : 2); i++) { const s = i % 2 ? 1 : -1, a = -PI / 2 + s * (.5 + (i > 1) * .5); pb.push({ x: x + s * 12, y, a, sp: 3, vx: 0, vy: 0, dmg: 4 + lv, hw: 5, hh: 6, spr: SP.missile, home: 1, rot: 0, life: 150 }); }
  else if (PL.sub === 'rocket') for (let i = 0; i < (lv > 2 ? 4 : 2); i++) { const s = i % 2 ? 1 : -1; pb.push({ x: x + s * (14 + (i > 1) * 10), y: y + 4, vx: 0, vy: -2, acc: .5, dmg: 5 + lv, hw: 4, hh: 10, spr: SP.rocket, rot: 0 }); }
  else if (PL.sub === 'side') for (const s of [-1, 1]) for (let i = 0; i < lv; i++) { const a = s * (.55 + i * .3); pb.push({ x: x + s * 10, y, vx: Math.sin(a) * 11, vy: -Math.cos(a) * 11, dmg: 2.5, hw: 5, hh: 5, spr: SP.side, rot: 0 }); }
  else if (PL.sub === 'blade') for (let i = 0; i < (lv > 2 ? 2 : 1); i++) { const dx = lv > 2 ? (i ? 20 : -20) : 0; pb.push({ x: x + dx, y: y - 16, vx: 0, vy: -7, dmg: .45 + lv * .1, hw: 18, hh: 8, spr: SP.blade, pierce: 1, rot: 0 }); }
}
function chargeShot() {
  const x = P.x, y = P.y; SFX.charge(); flash = 4; shake = 6; ringFx(x, y - 10, 10, 110, 18, '160,220,255', 7);
  if (PL.chg === 'lance') for (let k = 0; k < 3; k++) for (const dx of [-22, 0, 22]) pb.push({ x: x + dx, y: y - 10 + k * 46, vx: 0, vy: -13, dmg: 1.6, hw: 8, hh: 32, spr: SP.lance, pierce: 1, rot: 0 });
  else if (PL.chg === 'fireball') pb.push({ x, y: y - 20, vx: 0, vy: -7, dmg: 0, hw: 16, hh: 16, spr: SP.fireball, fire: 1, rot: 0 });
  else if (PL.chg === 'wingmen') P.wing = 300;
  else for (let k = 0; k < 2; k++) pb.push({ x, y: y - 20 + k * 40, vx: 0, vy: -8, dmg: 1.5, hw: 56, hh: 14, spr: SP.wave, pierce: 1, rot: 0 });
}
function fireBurst(b) {
  boom(b.x, b.y, 3); for (let i = 0; i < 6; i++) boom(b.x + rnd(-70, 70), b.y + rnd(-70, 70), 1.5, 1);
  for (const e of enemies) if (Math.hypot(e.x - b.x, e.y - b.y) < 110 + e.hw) hurt(e, 70);
  eb = eb.filter(q => { const k = Math.hypot(q.x - b.x, q.y - b.y) > 120; if (!k) spark(q.x, q.y, 1); return k; });
}
function useBomb() {
  if (bomb || P.bombs <= 0 || !P.alive || P.enter > 0) return;
  P.bombs--; bomb = { t: 0, type: PL.bomb }; P.inv = Math.max(P.inv, 210); clearBullets(); SFX.bomb(PL.bomb); flash = 10; shake = 12; ringFx(P.x, P.y, 20, 460, 36, '160,220,255', 12); ringFx(P.x, P.y, 10, 260, 26, '255,255,255', 6);
}
function killPlayer() {
  if (god) return;
  P.alive = false; P.dead = 100; P.charge = 0; P.wing = 0; boom(P.x, P.y, 2.5); SFX.die(); flash = 8; hitstop = 9; shake = 16; ringFx(P.x, P.y, 20, 300, 34, '255,120,90', 9); debris(P.x, P.y, 10, 7);
  items.push(mkItem('P', P.x, P.y - 20)); if (P.pw > 1) items.push(mkItem('P', P.x, P.y - 40));
  if (STORY && lives > 0) STORY.radioEvent(lives === 1 ? 'lastLife' : 'hit');
}
function updPlayer() {
  if (!P.alive) {
    if (--P.dead <= 0) { if (lives > 0) { lives--; P = newPlayer(); } else if (state === 'play') { state = 'over'; overT = 600; music('none'); SFX.over(); } }
    return;
  }
  if (P.inv > 0) P.inv--;
  if (P.enter > 0) { P.enter--; P.y -= 2.6; return; }
  if (phase === 'clear' && pt > 150) { P.y -= (pt - 150) * .12; return; }
  let dx = (held('ArrowRight', 'KeyD') ? 1 : 0) - (held('ArrowLeft', 'KeyA') ? 1 : 0), dy = (held('ArrowDown', 'KeyS') ? 1 : 0) - (held('ArrowUp', 'KeyW') ? 1 : 0);
  if (dx && dy) { dx *= .7071; dy *= .7071; }
  P.x += dx * PL.speed + ptr.dx; P.y += dy * PL.speed + ptr.dy;
  P.bank += (clamp(dx + ptr.dx * .3, -1, 1) - P.bank) * .2; ptr.dx = ptr.dy = 0;
  P.x = clamp(P.x, 18, W - 18); P.y = clamp(P.y, 28, H - 26);
  const firing = held('KeyZ', 'Space', 'KeyJ') || ptr.down;
  if (firing && ++P.ct % 5 === 0) { fireMain(P.x, P.y); SFX.shot(); if (P.wing > 0) for (const s of [-1, 1]) pb.push({ x: P.x + s * 36, y: P.y - 2, vx: 0, vy: -15, dmg: 1.5, hw: 4, hh: 10, spr: SP[PL.shot], rot: 0 }); }
  if (firing && P.pw > 0 && ++P.sct % (PL.sub === 'side' ? 16 : PL.sub === 'homing' ? 34 - P.pw * 3 : 30) === 0) fireSub();
  if (P.wing > 0) P.wing--;
  if (held('KeyC', 'KeyK')) { P.charge = Math.min(P.charge + 1, 70); if (P.charge === 8) SFX.chargeUp(); if (P.charge === 55) SFX.chargeReady(); }
  else { if (P.charge >= 55) chargeShot(); P.charge = 0; }
  if (hit('KeyX', 'ShiftLeft', 'KeyL')) useBomb();
}

// ───────────────────────── 업데이트
const ER = [4.2, 6.4, 3.6];
function updPlay() {
  bgY = (bgY + 1) % BH; clY = (clY + 1.7) % 1024; st++;
  if (STORY) STORY.tickPlay(stage, st);
  if (phase === 'run') {
    while (ev.length && ev[0].t <= st) ev.shift().f();
    if (st > 4500 && !enemies.some(e => e.air)) { phase = 'warn'; pt = 0; music('none'); }
  } else if (phase === 'warn') { if (pt === 0) shake = 12; if (pt % 45 === 0 && pt < 180) SFX.warn(); if (++pt > 210) { phase = 'boss'; spawnBoss(); SFX.bossIn(); music('boss'); shake = 16; if (STORY) STORY.bossIntroRadio(stage); } }
  else if (phase === 'clear') {
    pt++; if (pt === 60) { SFX.clear(); lastBonus = P.bombs * 5000 + lives * 10000; addScore(lastBonus); }
    if (pt > 330) { if (STORY) enterStory(stage === THEMES.length - 1 ? 'final' : 'outro'); else nextStage(); }
  }
  updPlayer();
  // 폭탄
  if (bomb) {
    const t = ++bomb.t;
    if (bomb.type === 'carpet') { if (t > 30 && t < 175) { if (t % 4 === 0) boom(rnd(20, W - 20), rnd(30, H - 120), t % 12 === 0 ? 2 : 1.2, t % 12 !== 0); if (t % 10 === 0) { for (const e of enemies) if (e.y > -20) hurt(e, 10); clearBullets(); } } }
    else if (t > 12 && t < 175 && P.alive) { for (const e of enemies) if (Math.abs(e.x - P.x) < 66 + e.hw && e.y < P.y) hurt(e, 1.8); eb = eb.filter(q => Math.abs(q.x - P.x) > 70 || q.y > P.y); if (t % 8 === 0) shake = 3; }
    if (t > 185) bomb = null;
  }
  // 플레이어 탄
  for (const b of pb) {
    if (b.home) {
      let best = null, bd = 1e9; for (const e of enemies) { if (e.dead || e.inv || e.y < 0) continue; const d = (e.x - b.x) ** 2 + (e.y - b.y) ** 2; if (d < bd) { bd = d; best = e; } }
      if (best) { let da = Math.atan2(best.y - b.y, best.x - b.x) - b.a; while (da > PI) da -= TAU; while (da < -PI) da += TAU; b.a += clamp(da, -.16, .16); }
      b.sp = Math.min(b.sp + .35, 10); b.vx = Math.cos(b.a) * b.sp; b.vy = Math.sin(b.a) * b.sp; b.rot = b.a + PI / 2;
      if (frame % 2 === 0) fx.push({ x: b.x, y: b.y, vx: 0, vy: 1, t: 0, life: 12, s0: 5, s1: 12, spr: SP.fxSmoke, add: 0 });
      if (--b.life <= 0) b.dead = 1;
    }
    if (b.acc) b.vy -= b.acc;
    b.x += b.vx; b.y += b.vy;
    if (b.fire && b.y < 90) { fireBurst(b); b.dead = 1; }
    if (b.y < -40 || b.y > H + 30 || b.x < -30 || b.x > W + 30) b.dead = 1;
    if (b.dead) continue;
    for (const e of enemies) {
      if (e.dead || e.inv || e.y < -e.hh) continue;
      if (Math.abs(b.x - e.x) < b.hw + e.hw && Math.abs(b.y - e.y) < b.hh + e.hh) {
        if (b.pierce) { hurt(e, b.dmg); if (frame % 3 === 0) spark(clamp(b.x, e.x - e.hw, e.x + e.hw), e.y, 1); }
        else if (b.fire) { fireBurst(b); b.dead = 1; break; }
        else { hurt(e, b.dmg); spark(b.x, b.y - 6); b.dead = 1; break; }
      }
    }
  }
  pb = pb.filter(b => !b.dead);
  // 적
  for (const e of enemies) {
    e.t++; if (e.flash > 0) e.flash--; e.ai(e); if (e.ground) e.y += 1;
    if (e.kick > 0) e.kick *= .7;
    if (e.big >= 2 && !e.inv && e.hp < e.maxhp * .5 && frame % (e.hp < e.maxhp * .25 ? 2 : 4) === 0) fx.push({ x: e.x + rnd(-e.hw, e.hw) * .7, y: e.y + rnd(-e.hh, e.hh) * .7, vx: rnd(-.3, .3), vy: e.air ? -1.4 : .7, t: 0, life: 26, s0: 6, s1: 17, spr: Math.random() < .5 ? SP.fxFire : SP.fxSmoke, add: 0, top: 1 });
    if (e.type === 'boat' && frame % 3 === 0) fx.push({ x: e.x + rnd(-6, 6), y: e.y - 30, vx: rnd(-.5, .5), vy: .6, t: 0, life: 40, s0: 7, s1: 18, spr: SP.fxWhite, add: 0 });
    if (e.kind === 'ship' && e.ph === 1 && frame % 2 === 0) { const s = frame % 4 ? 1 : -1; fx.push({ x: e.x + s * 42, y: e.y + rnd(-130, 140), vx: s * .5, vy: 1, t: 0, life: 44, s0: 8, s1: 22, spr: SP.fxWhite, add: 0 }); }
    if (e.air && !e.dead && !e.gone && P.alive && P.inv <= 0 && !P.enter && Math.abs(e.x - P.x) < e.hw + 6 && Math.abs(e.y - P.y) < e.hh + 8) {
      if (!god) { if (P.pw > 0) { P.pw--; items.push(mkItem('P', P.x, P.y - 30)); } P.inv = 100; SFX.hit(); shake = 6; if (STORY) STORY.radioEvent('hit'); } hurt(e, 12);
    }
  }
  enemies = enemies.filter(e => !e.dead && !e.gone);
  // 적 탄
  const pr = P.alive && P.inv <= 0 && !P.enter;
  for (const b of eb) {
    b.x += b.vx; b.y += b.vy;
    if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) { b.dead = 1; continue; }
    if (pr) { const r = ER[b.k] + 2.4; if ((b.x - P.x) ** 2 + (b.y - P.y) ** 2 < r * r) { b.dead = 1; killPlayer(); } }
  }
  eb = eb.filter(b => !b.dead);
  // 아이템
  for (const it of items) {
    it.t++;
    if (it.kind === 'G') { it.y += 1; if (it.y > H + 20) it.dead = 1; }
    else { it.x += it.vx; it.y += it.vy; if (it.t < 900) { if (it.x < 16 || it.x > W - 16) it.vx *= -1; if ((it.y < 20 && it.vy < 0) || (it.y > H - 60 && it.vy > 0)) it.vy *= -1; } else if (it.y > H + 30 || it.y < -30) it.dead = 1; }
    if (P.alive && Math.abs(it.x - P.x) < 24 && Math.abs(it.y - P.y) < 24) {
      it.dead = 1;
      if (it.kind === 'P') { if (P.pw < 3) { P.pw++; popup(P.x, P.y - 30, 'POWER UP'); } else { addScore(4000); popup(P.x, P.y - 30, 4000); } SFX.power(); ringFx(P.x, P.y, 10, 80, 20, '255,120,100', 6); flash = Math.max(flash, 3); }
      else if (it.kind === 'B') { if (P.bombs < 6) { P.bombs++; popup(P.x, P.y - 30, 'BOMB'); } else { addScore(10000); popup(P.x, P.y - 30, 10000); } SFX.item(); ringFx(P.x, P.y, 10, 80, 20, '120,255,140', 6); flash = Math.max(flash, 3); }
      else { const v = [200, 500, 1000, 2000, 1000, 500][((it.t % 64) / 64 * 6) | 0]; addScore(v); popup(it.x, it.y - 10, v); SFX.gold(); ringFx(it.x, it.y, 6, 36 + v / 50, 16, '255,220,90', 4); }
    }
  }
  items = items.filter(i => !i.dead);
  for (const f of fx) { f.t++; if (f.t > 0) { f.x += f.vx; f.y += f.vy; if (f.vr) f.rot += f.vr; if (f.trail && f.t % 3 === 0) fx.push({ x: f.x, y: f.y, vx: 0, vy: .5, t: 0, life: 14, s0: 4, s1: 10, spr: SP.fxFire, add: 1 }); } }
  fx = fx.filter(f => f.t < f.life);
  for (const d of decals) d.y += 1; decals = decals.filter(d => d.y < H + 60);
  for (const t of texts) t.t++; texts = texts.filter(t => t.t < 60);
  if (hit('KeyP', 'Escape')) state = 'pause';
}

// ───────────────────────── 렌더
const FONT = s => `${s}px "Press Start 2P","Courier New",monospace`;
function txt(s, x, y, size = 12, col = '#fff', align = 'center') { ctx.font = FONT(size); ctx.textAlign = align; ctx.fillStyle = '#000'; ctx.fillText(s, x + Math.max(1, size / 8), y + Math.max(1, size / 8)); ctx.fillStyle = col; ctx.fillText(s, x, y); }
function ktxt(s, x, y, size = 13, col = '#fff', align = 'center') { ctx.font = `bold ${size}px "Apple SD Gothic Neo","Malgun Gothic",sans-serif`; ctx.textAlign = align; ctx.fillStyle = '#000'; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = col; ctx.fillText(s, x, y); }
function drawBG(n) {
  const c = BG[n] || (BG[n] = buildBG(n)), y = bgY % BH;
  ctx.drawImage(c, 0, y - BH); ctx.drawImage(c, 0, y);
}
function drawClouds(a) { ctx.globalAlpha = a; const y = clY % 1024; ctx.drawImage(CLOUD, 0, y - 1024); ctx.drawImage(CLOUD, 0, y); ctx.globalAlpha = 1; }
const pk = (s, r) => s.length ? s[Math.round(((r % TAU + TAU) % TAU) / TAU * s.length) % s.length] : s, es = e => pk(SP[e.s], e.rot);
function drawEnemy(e) {
  if (e.type === 'boss') return drawBoss(e);
  const s = es(e);
  if (e.ground) { drawE(s, e.x, e.y, 0, e.flash); drawE(pk(SP.tur, e.ta + PI / 2), e.x, e.y + (e.type === 'boat' ? 12 : 0), e.ta + PI / 2, e.flash, e.tur); }
  else drawE(s, e.x, e.y - (e.kick || 0), e.rot, e.flash);
}
function drawBoss(b) {
  const sh = b.st === 'morph' || b.st === 'die' ? rnd(-3, 3) : 0, x = b.x + sh, y = b.y;
  if (b.ph === 1) {
    drawE(SP['b_' + b.kind], x, y, 0, b.flash);
    for (const q of b.D.tur) { const tx = x + q[0], ty = y + q[1], ta = (P.alive ? aim(tx, ty) : PI / 2) + PI / 2; drawE(pk(SP.btur, ta), tx, ty, ta, b.flash, q[2]); }
  } else {
    for (const s of [-1, 1]) { ctx.globalCompositeOperation = 'lighter'; draw(SP.fxFire, x + s * 14, y - 46 - rnd(0, 6), 0, .45); ctx.globalCompositeOperation = 'source-over'; }
    drawE(mechSpr(), x, y - (b.kick || 0), 0, b.flash);
  }
}
function drawFx(f) {
  if (f.t <= 0) return; const k = f.t / f.life;
  if (f.ring) { const q = 1 - (1 - k) * (1 - k); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(${f.col},${(1 - k) * .9})`; ctx.lineWidth = f.lw * (1 - k) + .5; ctx.beginPath(); ctx.arc(f.x, f.y, f.s0 + (f.s1 - f.s0) * q, 0, TAU); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; return; }
  const s = (f.s0 + (f.s1 - f.s0) * k) / f.spr.w * 2;
  ctx.globalAlpha = f.solid ? Math.min(1, (1 - k) * 3) : 1 - k * k; if (f.add) ctx.globalCompositeOperation = 'lighter';
  draw(f.spr, f.x, f.y, f.rot || 0, s); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}
function drawPlay() {
  ctx.save(); if (shake > 0) { const z = 1 + shake / 190; ctx.translate(W / 2 + rnd(-shake, shake), H / 2 + rnd(-shake, shake)); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); shake *= .88; if (shake < .4) shake = 0; }
  drawBG(THEMES[stage].bg);
  if (THEMES[stage].sea) { ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 16; i++) { const c = Math.floor((frame + i * 37) / 90), ph = (frame + i * 37) % 90, k = Math.sin(ph / 90 * PI); ctx.globalAlpha = k * .6; draw(SP.glint, (i * 97.3 + c * 61.7) % W, ((i * 53.1 + c * 113.3) % H + ph) % H, 0, .3 + k * .5); } ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  for (const d of decals) draw(SP.scorch, d.x, d.y, 0, d.s);
  for (const e of enemies) if (!e.air) drawEnemy(e);
  for (const it of items) if (it.kind === 'G') { const k = (it.t % 64) / 64, br = Math.max(0, Math.sin(k * PI)) ** 3; draw(SP.gold, it.x, it.y); if (br > .1) { ctx.globalAlpha = br; ctx.globalCompositeOperation = 'lighter'; draw(SP.fxFlash, it.x, it.y, 0, .25 + br * .3); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; } }
  for (const f of fx) if (!f.add && !f.top) drawFx(f);
  if (THEMES[stage].bg !== 3) { const y = clY % 1024; ctx.globalAlpha = .16; ctx.drawImage(CLOUDSH, 30, y - 1024 + 46); ctx.drawImage(CLOUDSH, 30, y + 46); ctx.globalAlpha = 1; drawClouds(.55); }
  // 그림자
  for (const e of enemies) if (e.air) { if (e.type === 'boss') shadow(e.ph === 1 ? SP['b_' + e.kind] : mechSpr(), e.x + 14, e.y + 20, 0); else shadow(es(e), e.x, e.y, e.rot); }
  const ps = SP[PL.spr], vis = P.alive && (P.inv <= 0 || frame % 4 < 2);
  if (vis) shadow(ps, P.x, P.y, 0);
  if (bomb && bomb.type === 'carpet') { const by = H + 120 - bomb.t * 5; shadow(SP.b29, W / 2, by, 0, 1.3); }
  for (const e of enemies) if (e.air) drawEnemy(e);
  // 폭탄 연출
  if (bomb) {
    if (bomb.type === 'carpet') draw(SP.b29, W / 2, H + 120 - bomb.t * 5, 0, 1.3);
    else if (bomb.t > 8 && bomb.t < 180 && P.alive) {
      const k = Math.min(1, (bomb.t - 8) / 10, (180 - bomb.t) / 15), w = (60 + Math.sin(bomb.t * .8) * 8) * k;
      ctx.globalCompositeOperation = 'lighter'; const q = ctx.createLinearGradient(P.x - w, 0, P.x + w, 0);
      q.addColorStop(0, 'rgba(60,140,255,0)'); q.addColorStop(.3, 'rgba(120,200,255,.8)'); q.addColorStop(.5, '#fff'); q.addColorStop(.7, 'rgba(120,200,255,.8)'); q.addColorStop(1, 'rgba(60,140,255,0)');
      ctx.fillStyle = q; ctx.fillRect(P.x - w, -10, w * 2, P.y); draw(SP.fxBlue, P.x, P.y - 6, 0, 2.2 * k); ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const b of pb) if (!b.home && !b.acc) draw(b.spr, b.x, b.y, b.rot);
  ctx.globalCompositeOperation = 'source-over';
  for (const b of pb) if (b.home || b.acc) draw(b.spr, b.x, b.y, b.rot);
  if (vis) {
    if (P.wing > 0 && (P.wing > 50 || frame % 4 < 2)) for (const s of [-1, 1]) draw(ps, P.x + s * 36, P.y + 10, 0, .62);
    ctx.globalCompositeOperation = 'lighter'; const fl = .7 + Math.random() * .6;
    for (const ex of (PL.spr === 'p38' ? [-12, 12] : [0])) draw(SP.flame, P.x + ex, P.y + 24 + 7 * fl, 0, fl);
    if (P.mz > 0) { P.mz--; for (const [dx] of PL.shots[P.pw]) draw(SP.fxFlash, P.x + dx, P.y - 25, 0, .16 + Math.random() * .14); }
    ctx.globalCompositeOperation = 'source-over';
    draw(ps, P.x, P.y, 0, 1, 1 - Math.abs(P.bank) * .22);
    if (P.charge > 8) { const k = Math.min(1, P.charge / 55); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .5 + .5 * Math.sin(frame * .6); draw(k >= 1 ? SP.fxFlash : SP.fxBlue, P.x, P.y - 14, 0, .25 + k * .55); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  }
  for (const f of fx) if (f.add || f.top) drawFx(f);
  for (const it of items) if (it.kind !== 'G') { if (it.t > 780 && frame % 6 < 3) continue; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .5 + .3 * Math.sin(it.t * .25); draw(it.kind === 'P' ? SP.fxFire : SP.fxBlue, it.x, it.y, 0, .75); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; draw(it.kind === 'P' ? SP.itP : SP.itB, it.x, it.y, 0, 1 + Math.sin(it.t * .2) * .08); }
  for (const b of eb) draw(SP.eb[b.k], b.x, b.y, b.k === 2 ? b.a + PI / 2 : 0, 1 + Math.sin(frame * .55 + b.x * .13) * .13);
  for (const t of texts) { ctx.globalAlpha = Math.min(1, (60 - t.t) / 20); { const v = +t.s, pop = 1 + Math.max(0, 6 - t.t) * .12; txt(t.s, t.x, t.y - t.t * .6, (t.big ? 20 : v >= 10000 ? 14 : v >= 2000 ? 11 : 8) * pop, t.big ? '#7dff7d' : v >= 10000 ? '#fff' : '#ffe36a'); } ctx.globalAlpha = 1; }
  ctx.restore();
  if (THEMES[stage].bg !== 3) { const y = (clY * 2.3) % 1024; ctx.globalAlpha = .17; ctx.drawImage(CLOUD, -160, y - 1024, W * 1.6, 1024); ctx.drawImage(CLOUD, -160, y, W * 1.6, 1024); ctx.globalAlpha = 1; }
  ctx.drawImage(VIG, 0, 0, W, H);
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(.8, flash * .08)})`; ctx.fillRect(0, 0, W, H); flash--; }
  drawHUD();
}
function drawHUD() {
  txt('1UP', 12, 20, 10, '#ff5a4a', 'left'); txt('' + score, 12, 38, 12, '#fff', 'left');
  txt('HI-SCORE', W / 2, 20, 10, '#ffd75a'); txt('' + hi, W / 2, 38, 12, '#fff');
  txt(`STAGE ${loop + 1}-${stage + 1}`, W - 12, 20, 8, '#9fdcff', 'right');
  for (let i = 0; i < lives; i++) draw(SP[PL.spr], 22 + i * 26, H - 20, 0, .4);
  for (let i = 0; i < P.bombs; i++) draw(SP.bombIcon, W - 16 - i * 16, H - 20);
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i <= P.pw ? '#ff5a4a' : 'rgba(255,255,255,.2)'; ctx.fillRect(12 + i * 10, H - 46, 8, 5); }
  if (P.charge > 8) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(W / 2 - 41, H - 17, 82, 8); ctx.fillStyle = P.charge >= 55 ? (frame % 6 < 3 ? '#fff' : '#ffd75a') : '#4ab8ff'; ctx.fillRect(W / 2 - 40, H - 16, 80 * Math.min(1, P.charge / 55), 6); }
  if (boss && boss.st === 'fight') { const k = clamp(boss.hp / boss.maxhp, 0, 1); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(89, 49, 302, 8); ctx.fillStyle = boss.ph === 1 ? '#ffb02a' : '#ff3a4a'; ctx.fillRect(90, 50, 300 * k, 6); }
  if (phase === 'run' && st < 200) { const a = Math.min(1, st / 30, (200 - st) / 30); ctx.globalAlpha = a; txt(`STAGE ${stage + 1}`, W / 2, 260, 24, '#ffd75a'); txt(STORY ? STORY.missionTitle(stage) : THEMES[stage].name, W / 2, 296, 14); if (STORY) txt(THEMES[stage].name, W / 2, 318, 8, '#9fb4c8'); if (loop) txt(`LOOP ${loop + 1}`, W / 2, 344, 10, '#ff8a7a'); ctx.globalAlpha = 1; }
  if (phase === 'warn') { ctx.fillStyle = `rgba(255,0,0,${.12 + .1 * Math.sin(pt * .2)})`; ctx.fillRect(0, 0, W, H); if (STORY) STORY.drawBossIntro(stage, pt); else if (pt % 30 < 20) { txt('WARNING!!', W / 2, 280, 28, '#ff3a3a'); txt(`${THEMES[stage].msg} APPROACHING`, W / 2, 316, 9, '#ffd75a'); } }
  if (phase === 'clear' && pt > 40) { txt('STAGE CLEAR', W / 2, 250, 24, '#ffd75a'); if (pt > 60) { txt(`BOMB  ${P.bombs} x 5000`, W / 2, 300, 10); txt(`PLANE ${lives} x 10000`, W / 2, 324, 10); } if (!STORY && stage === THEMES.length - 1 && pt > 120) txt('ALL STAGES CLEAR! NEXT LOOP', W / 2, 360, 9, '#7dff7d'); }
  if (STORY) STORY.drawRadio();
  if (!P.alive && lives === 0 && state === 'play') txt('LAST PLANE LOST', W / 2, 300, 12, '#ff5a4a');
}
function logo(y) {
  ctx.textAlign = 'center'; ctx.font = FONT(26); ctx.lineWidth = 8; ctx.strokeStyle = '#1a0a05'; ctx.strokeText('OPERATION:', W / 2, y); ctx.fillStyle = '#e9edf2'; ctx.fillText('OPERATION:', W / 2, y);
  ctx.font = FONT(50); const q = ctx.createLinearGradient(0, y + 20, 0, y + 92); q.addColorStop(0, '#fff7a8'); q.addColorStop(.5, '#ffb02a'); q.addColorStop(.52, '#c85a10'); q.addColorStop(1, '#ffd75a');
  ctx.lineWidth = 12; ctx.strokeStyle = '#3a0c05'; ctx.strokeText('IRON SKY', W / 2 + 4, y + 86); ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.strokeText('IRON SKY', W / 2 + 4, y + 86); ctx.fillStyle = q; ctx.fillText('IRON SKY', W / 2 + 4, y + 86);
}
function drawTitle() {
  drawBG(0); drawClouds(.6);
  const t = frame, px = W / 2 + Math.sin(t / 60) * 90, py = 420 + Math.sin(t / 37) * 16;
  for (let i = 0; i < 4; i++) { const s = SP[PLANES[i].spr], x = px + (i - 1.5) * 62, y = py + Math.abs(i - 1.5) * 26; shadow(s, x, y, 0); draw(s, x, y); }
  logo(130);
  if (TOUCH) {
    if (t % 50 < 34) txt('TAP TO START', W / 2, 330, 12, '#fff');
    ktxt('화면을 드래그하면 이동 · 손가락을 대고 있는 동안 자동 사격', W / 2, 558, 12, '#dfe8f2');
    ktxt('아래 버튼: CHARGE 누르다 떼기 · BOMB 폭탄', W / 2, 578, 12, '#dfe8f2');
  } else {
    if (t % 50 < 34) txt('PRESS ENTER OR Z', W / 2, 330, 12, '#fff');
    ktxt('이동 ← ↑ → ↓ / WASD   ·   사격 Z / Space (누르고 있기)', W / 2, 548, 12, '#dfe8f2');
    ktxt('모으기 공격 C (누르다 떼기)   ·   폭탄 X   ·   일시정지 P   ·   음소거 M', W / 2, 568, 12, '#dfe8f2');
    ktxt('마우스·터치 드래그로도 조종 가능 (우클릭 = 폭탄)', W / 2, 588, 12, '#9fb4c8');
  }
  if (STORY) txt(`STORY  ${STORY.enabled ? 'ON' : 'OFF'}   ${TOUCH ? '(TAP)' : '[S]'}`, W / 2, 520, 9, STORY.enabled ? '#7dff7d' : '#ff8a7a');
  txt(`HI ${hi}`, W / 2, 620, 8, '#ffd75a');
}
function drawSelect() {
  drawBG(0); ctx.fillStyle = 'rgba(5,10,25,.72)'; ctx.fillRect(0, 0, W, H);
  txt('SELECT YOUR FIGHTER', W / 2, 70, 14, '#ffd75a');
  for (let i = 0; i < 4; i++) {
    const x = 60 + i * 120, on = i === sel; rr(ctx, x - 52, 110, 104, 150, 8); ctx.fillStyle = on ? 'rgba(80,140,255,.35)' : 'rgba(255,255,255,.07)'; ctx.fill(); ctx.lineWidth = on ? 3 : 1; ctx.strokeStyle = on ? (frame % 20 < 10 ? '#fff' : '#ffd75a') : 'rgba(255,255,255,.3)'; ctx.stroke();
    draw(SP[PLANES[i].spr], x, 180 + (on ? Math.sin(frame / 8) * 5 : 0), 0, on ? 1.55 : 1.25);
  }
  const p = PLANES[sel]; txt(p.name, W / 2, 310, 16, '#fff');
  const bars = [['SPEED', (p.speed - 3) / 1.8], ['POWER', (p.dmg - .6) / 1]];
  bars.forEach(([n, v], i) => { txt(n, 130, 356 + i * 26, 9, '#9fdcff', 'left'); ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(200, 346 + i * 26, 150, 10); ctx.fillStyle = '#ffb02a'; ctx.fillRect(200, 346 + i * 26, 150 * clamp(v, .1, 1), 10); });
  ['보조 무기', '모으기 공격', '폭탄'].forEach((n, i) => { ktxt(n, 130, 430 + i * 28, 14, '#9fdcff', 'left'); ktxt(p.ko[i], 240, 430 + i * 28, 14, '#fff', 'left'); });
  if (frame % 50 < 34) txt('<- ->  SELECT    Z  START', W / 2, 570, 9, '#fff');
}

// ───────────────────────── 메인 루프
function update() {
  frame++; musicTick(); engineTick(); let frozen = false;
  if (hit('KeyM')) { muted = !muted; if (master) master.gain.value = muted ? 0 : .85; }
  const ok = hit('Enter', 'KeyZ', 'Space', 'Tap');
  if (state === 'title') {
    bgY = (bgY + 1) % BH; clY = (clY + 1.7) % 1024; music('title');
    if (STORY && (hit('KeyS') || (pressed.Tap && ptr.ty > 496 && ptr.ty < 534))) { STORY.toggle(); SFX.sel(); }
    else if (ok) { state = 'select'; SFX.ok(); }
  }
  else if (state === 'story') {
    bgY = (bgY + .5) % BH; clY = (clY + 1) % 1024;
    const r = STORY.update({ adv: hit('Enter', 'KeyZ', 'Space', 'Tap'), skip: hit('Escape'), up: hit('ArrowUp', 'KeyW'), down: hit('ArrowDown', 'KeyS'), tap: !!pressed.Tap, tx: ptr.tx, ty: ptr.ty });
    if (r) storyDone(r);
  }
  else if (state === 'select') {
    bgY = (bgY + 1) % BH;
    if (hit('ArrowLeft', 'KeyA')) { sel = (sel + 3) % 4; SFX.sel(); } if (hit('ArrowRight', 'KeyD')) { sel = (sel + 1) % 4; SFX.sel(); }
    if (pressed.Tap) { const i = clamp(ptr.tx / 120 | 0, 0, 3); if (i !== sel) { sel = i; SFX.sel(); pressed.Tap = 0; } }
    if (hit('Enter', 'KeyZ', 'Space', 'Tap')) { SFX.start(); startGame(); }
  }
  else if (state === 'play') { if (hitstop > 0) { hitstop--; frozen = hit('KeyX', 'ShiftLeft', 'KeyL'); } else if (!(slow > 0 && slow-- % 2)) updPlay(); }
  else if (state === 'pause') { if (hit('KeyP', 'Escape', 'Enter')) state = 'play'; }
  else if (state === 'over') {
    for (const f of fx) { f.t++; f.x += f.vx; f.y += f.vy; } fx = fx.filter(f => f.t < f.life);
    overT--; if (ok && overT < 570) { if (overT > 0) { score = 0; lives = 2; P = newPlayer(); state = 'play'; music(boss ? 'boss' : 'stage'); } }
    if (overT <= -120) { localStorage.setItem('sky1945hi', hi); state = 'title'; }
  }
  if (frame % 300 === 0) localStorage.setItem('sky1945hi', hi);
  pressed = frozen ? { KeyX: 1 } : {};
}
function render() {
  ctx.setTransform(VS, 0, 0, VS, 0, 0); ctx.imageSmoothingQuality = 'high';
  if (state === 'title') drawTitle();
  else if (state === 'select') drawSelect();
  else if (state === 'story') STORY.render();
  else {
    drawPlay();
    if (state === 'pause') { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H); txt('PAUSE', W / 2, 310, 24); }
    if (state === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
      if (overT > 0) { txt('CONTINUE?', W / 2, 270, 22, '#ffd75a'); txt('' + Math.ceil(overT / 60 - 1 < 0 ? 0 : overT / 60 - 1), W / 2, 330, 40); txt('PRESS Z', W / 2, 380, 10); }
      else txt('GAME OVER', W / 2, 310, 26, '#ff5a4a');
    }
  }
}
let last = 0, acc = 0;
function tick(t) {
  requestAnimationFrame(tick);
  acc += Math.min(100, t - last); last = t; let n = 0;
  while (acc >= 1000 / 60 && n++ < 4) { update(); acc -= 1000 / 60; }
  if (acc > 100) acc = 0;
  render();
}
buildSprites(); CLOUD = buildClouds(); CLOUDSH = tint(CLOUD, '#000'); BG[0] = buildBG(0);
if (STORY) STORY.init({ ctx, drawBG, SFX });
// 디버그/테스트용 훅
window.__sky = { SP, SFX, get ac() { return AC && AC.state; }, get s() { return { state, stage, loop, score, lives, phase, st, enemies: enemies.length, eb: eb.length, pb: pb.length, pw: P && P.pw, boss: boss && { ph: boss.ph, st: boss.st, hp: boss.hp } }; }, god: v => god = v, get p() { return P && { x: P.x | 0, y: P.y | 0, alive: P.alive, enter: P.enter, inv: P.inv, dead: P.dead }; }, get pt() { return pt; }, get story() { return STORY; }, storyTest: (mode, n) => { stage = n || 0; P = newPlayer(P); startStage(); enterStory(mode); }, clear: () => { phase = 'clear'; pt = 320; boss = null; }, skip: () => { st = 4490; ev = []; }, stage: n => { stage = n; startStage(); }, pw: n => P.pw = n, step: n => { for (let i = 0; i < n; i++) update(); }, hurtBoss: d => boss && hurt(boss, d) };
requestAnimationFrame(tick);
})();
