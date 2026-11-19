// OPERATION: IRON SKY — 사운드 엔진
// 모든 소리를 코드로 만들되, 실시간 단순 파형 대신 "미리 정교하게 합성한 샘플"을 만들어 두고 재생한다.
//   1) 로딩 때 JS DSP(필터·포화·리버브·물리적 모델링)로 효과음·악기·환경음 샘플을 렌더링
//   2) 재생할 때마다 변형(음높이·크기·필터)을 줘서 같은 소리가 반복되지 않게
//   3) 거리감(플레이어와 멀수록 작고 둔하게), 스테레오 위치, 동시 재생 수 제한, 큰 폭발 때 음악 덕킹
//   4) 스테이지별 환경음, 프로펠러 엔진 루프, 적기 통과 도플러, 무전 잡음, 군악풍 음악
(() => {
'use strict';
const PI = Math.PI, TAU = PI * 2;
const W = 480, H = 640;

// ───────── DSP 도구
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
class BQ {
  constructor(type, f, q, sr) { this.t = type; this.q = q; this.sr = sr; this.z1 = this.z2 = 0; this.set(f); }
  set(f) {
    const w = TAU * Math.min(Math.max(f, 10), this.sr * .45) / this.sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * this.q);
    let b0, b1, b2;
    if (this.t === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (this.t === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; }
    const a0 = 1 + a; this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
  }
  p(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}
const sat = (x, k) => Math.tanh(k * x) / Math.tanh(k);
const buf = (d, sr) => new Float32Array(Math.max(1, Math.ceil(d * sr)));
// 부드러운 무작위 곡선 (난류·돌풍용), 0..1
function vnoise(r, hz, sr, n) {
  const step = Math.max(1, Math.floor(sr / hz)), pts = []; for (let i = 0; i <= n / step + 2; i++) pts.push(r());
  return i => { const k = i / step, j = k | 0, f = k - j, u = (1 - Math.cos(f * PI)) / 2; return pts[j] * (1 - u) + pts[j + 1] * u; };
}
// Freeverb (야외/홀 잔향)
function reverb(L, R, sr, mix, room = .84, damp = .35) {
  const sc = sr / 44100, combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], apT = [556, 441, 341, 225];
  const mk = (t, sp) => ({ b: new Float32Array(Math.max(2, Math.round((t + sp) * sc))), i: 0, f: 0 });
  const cl = combT.map(t => mk(t, 0)), cr = combT.map(t => mk(t, 23)), al = apT.map(t => mk(t, 0)), ar = apT.map(t => mk(t, 23));
  const comb = (c, x) => { const y = c.b[c.i]; c.f = y * (1 - damp) + c.f * damp; c.b[c.i] = x + c.f * room; if (++c.i >= c.b.length) c.i = 0; return y; };
  const ap = (a, x) => { const bo = a.b[a.i], y = -x + bo; a.b[a.i] = x + bo * .5; if (++a.i >= a.b.length) a.i = 0; return y; };
  for (let i = 0; i < L.length; i++) {
    const x = (L[i] + R[i]) * .015; let yl = 0, yr = 0;
    for (let k = 0; k < 8; k++) { yl += comb(cl[k], x); yr += comb(cr[k], x); }
    for (let k = 0; k < 4; k++) { yl = ap(al[k], yl); yr = ap(ar[k], yr); }
    L[i] = L[i] * (1 - mix * .5) + yl * mix * 3; R[i] = R[i] * (1 - mix * .5) + yr * mix * 3;
  }
}
function norm(ch, peak = .92) { let m = 1e-6; for (const c of ch) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > m) m = a; } const k = peak / m; for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= k; return ch; }
// 끝부분을 앞부분에 겹쳐 끊김 없는 반복 루프로
function loopify(ch, sr, fade) { const F = Math.floor(fade * sr); return ch.map(a => { const n = a.length - F, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a[i]; for (let i = 0; i < F; i++) { const k = i / F; o[i] = a[i] * k + a[n + i] * (1 - k); } return o; }); }
function fadeEnds(ch, sr, a = .002, r = .02) { const A = a * sr, Rr = r * sr; for (const c of ch) { for (let i = 0; i < A && i < c.length; i++) c[i] *= i / A; for (let i = 0; i < Rr && i < c.length; i++) c[c.length - 1 - i] *= i / Rr; } return ch; }
// 대역 제한 톱니파 웨이브테이블 (악기용)
function sawTable(h) { const N = 2048, t = new Float32Array(N + 1); for (let i = 0; i <= N; i++) { let s = 0; for (let k = 1; k <= h; k++) s += Math.sin(TAU * k * i / N) / k * (k > h * .7 ? (h - k) / (h * .3) : 1); t[i] = s * .55; } return t; }
const TBL = { s6: sawTable(6), s14: sawTable(14), s28: sawTable(28) };
const rd = (t, ph) => { const N = 2048, p = (ph - Math.floor(ph)) * N, j = p | 0, f = p - j; return t[j] + (t[j + 1] - t[j]) * f; };

// ───────── 효과음 설계
const S44 = 44100, S32 = 32000, S22 = 22050;
function gun(seed, o) {
  const sr = S44, d = o.dur || .42, L = buf(d, sr), R = buf(d, sr), r = rng(seed), n = L.length;
  const hp = new BQ('hp', 1800, .7, sr), b1 = new BQ('bp', o.f * (.9 + r() * .2), 1.1, sr), b2 = new BQ('bp', o.f * 2.3, 2, sr), mc = new BQ('bp', 4200 + r() * 900, 6, sr), dk = new BQ('lp', o.lp || 16000, .7, sr);
  const pm = [2300, 3650, 5200].map(f => f * (.94 + r() * .12)); let ph = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = r() * 2 - 1; let x = 0;
    if (t < .005) x += hp.p(w) * (1 - t / .005) * 1.6;
    x += (b1.p(w) * 1.4 + b2.p(w) * .6) * Math.exp(-t / (o.bt || .03));
    ph += TAU * ((o.th || 110) * Math.exp(-t / .03) + 40) / sr; x += Math.sin(ph) * Math.exp(-t / (o.tt || .045)) * (o.tw || .9);
    if (o.zip) { pz += TAU * (1300 + 2600 * Math.exp(-t / .015)) / sr; x += Math.sin(pz) * Math.exp(-t / .025) * o.zip; }
    const tm = t - .011; if (tm > 0 && o.mech !== 0) { const e = Math.exp(-tm / .01); for (const f of pm) x += Math.sin(TAU * f * tm) * e * .06; x += mc.p(w) * Math.exp(-tm / .008) * .45; }
    L[i] = R[i] = dk.p(sat(x, 1.8));
  }
  reverb(L, R, sr, o.rev || .16, .72, .5); return fadeEnds(norm([L, R], .9), sr);
}
function explosion(seed, size) {
  const P = [{ d: .8, f0: 95, lt: .1, rc: 2200, rt: .16, deb: 3, rev: .08 }, { d: 1.4, f0: 75, lt: .19, rc: 1900, rt: .3, deb: 6, rev: .11 }, { d: 2.4, f0: 58, lt: .36, rc: 1600, rt: .62, deb: 12, rev: .16 }][size];
  const sr = S44, L = buf(P.d, sr), R = buf(P.d, sr), n = L.length, r = rng(seed);
  const hp = new BQ('lp', 1800, .7, sr), body = new BQ('bp', 420, .9, sr), fl = new BQ('lp', P.rc, .6, sr), fr = new BQ('lp', P.rc, .6, sr), tb = vnoise(r, 14, sr, n), tb2 = vnoise(r, 3, sr, n);
  let ph = 0, bl = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, wl = r() * 2 - 1, wr = r() * 2 - 1;
    if ((i & 31) === 0) { const c = 110 + (P.rc - 110) * Math.exp(-t / (P.d * .22)); fl.set(c); fr.set(c * 1.05); }
    let x = (t < .02 ? hp.p(wl) * (1 - t / .02) * 1.3 : 0) + body.p(wl) * Math.exp(-t / (P.lt * .7)) * 1.1;
    ph += TAU * (26 + (P.f0 - 26) * Math.exp(-t / (P.lt * .6))) / sr;
    const low = sat(Math.sin(ph) * (1 - Math.exp(-t / .004)) * Math.exp(-t / P.lt) * 1.6, 1.4);
    bl = (bl + .02 * wl) / 1.02; br = (br + .02 * wr) / 1.02;
    const env = (1 - Math.exp(-t / .008)) * Math.exp(-t / P.rt) * (.6 + .7 * tb(i)) * (.8 + .4 * tb2(i));
    L[i] = x + low + fl.p(bl * 3.2 + wl * .3) * env * 1.7; R[i] = x * .9 + low + fr.p(br * 3.2 + wr * .3) * env * 1.7;
  }
  // 두 번째 파열 (중·대형)
  if (size) { const t0 = Math.floor((.18 + r() * .15) * sr), f2 = new BQ('bp', 900, .8, sr); for (let i = 0; i < .25 * sr && t0 + i < n; i++) { const e = Math.exp(-i / sr / .07) * .5 * size; const v = f2.p(r() * 2 - 1) * e; L[t0 + i] += v; R[t0 + i] += v * .8; } }
  // 파편 튀는 소리
  for (let k = 0; k < P.deb; k++) {
    const t0 = Math.floor((.05 + P.d * .5 * Math.pow(r(), 1.7)) * sr), f = new BQ('bp', 220 + r() * 600, 1.2, sr), a = (.2 + r() * .3) * (1 - t0 / n), pan = r(), len = (.03 + r() * .04) * sr;
    for (let i = 0; i < len && t0 + i < n; i++) { const v = f.p(r() * 2 - 1) * a * Math.exp(-i / len * 4); L[t0 + i] += v * (1.4 - pan * .8); R[t0 + i] += v * (.6 + pan * .8); }
  }
  for (let i = 0; i < n; i++) { L[i] = sat(L[i], 1.3); R[i] = sat(R[i], 1.3); }
  reverb(L, R, sr, P.rev, .75, .6); return fadeEnds(norm([L, R], .95), sr, .001, .15);
}
function tink(seed) { // 총알이 기체에 맞는 소리: 짧고 둔탁한 금속 타격
  const sr = S44, d = .12, L = buf(d, sr), R = buf(d, sr), r = rng(seed), lp = new BQ('lp', 2600, .7, sr), bp = new BQ('bp', 900 + r() * 500, 1.4, sr);
  const parts = [0, 1].map(() => [500 + r() * 900, .008 + r() * .01, .25 + r() * .2]);
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, w = r() * 2 - 1; let x = lp.p(w) * Math.exp(-t / .006) * .9 + bp.p(w) * Math.exp(-t / .02) * .8;
    for (const [f, dc, a] of parts) x += Math.sin(TAU * f * t) * Math.exp(-t / dc) * a;
    L[i] = R[i] = sat(x, 1.5);
  }
  return fadeEnds(norm([L, R], .75), sr);
}
function clank(seed, d = .45, f0 = 320) {
  const sr = S44, L = buf(d, sr), R = buf(d, sr), r = rng(seed), lp = new BQ('lp', 2500, .7, sr);
  const parts = [1, 2.3, 3.1, 4.7, 6.2].map(k => [f0 * k * (.95 + r() * .1), .03 + r() * .12, .5 / k]);
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, w = r() * 2 - 1; let x = lp.p(w) * Math.exp(-t / .05) * 1.2;
    for (const [f, dc, a] of parts) x += Math.sin(TAU * f * t) * Math.exp(-t / dc) * a;
    L[i] = R[i] = sat(x * 1.4, 2);
  }
  reverb(L, R, sr, .12, .7, .5); return fadeEnds(norm([L, R], .85), sr);
}
// 성형 엔진(레이디얼): 실린더 폭발 펄스 + 배음 + 프로펠러 공기 소리. 반복 루프.
function engineLoop(seed, fe = 36, len = 2, sr = S32) {
  const F = .25, d = len + F, L = buf(d, sr), R = buf(d, sr), n = L.length, r = rng(seed);
  const pl = new BQ('lp', 700, .7, sr), al = new BQ('bp', 600, .6, sr), ar = new BQ('bp', 640, .6, sr), body = new BQ('lp', 1600, .7, sr);
  const amps = []; for (let k = 0; k < fe * d + 2; k++) amps.push(.75 + r() * .5);
  const fb = fe * .75, phs = [0, 1, 2, 3, 4, 5].map(() => r() * TAU);
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = Math.floor(t * fe), tp = t - k / fe, a = amps[k], w = r() * 2 - 1;
    let x = (Math.sin(TAU * 95 * tp) * Math.exp(-tp / .006) * .9 + pl.p(w) * Math.exp(-tp / .004) * 1.2) * a;
    for (let h = 1; h <= 6; h++) x += Math.sin(TAU * h * fe * t + phs[h - 1]) * .22 / h;
    const prop = .6 + .4 * Math.sin(TAU * fb * t);
    const v = body.p(sat(x, 1.5));
    L[i] = v + al.p(w) * prop * .5; R[i] = v + ar.p(r() * 2 - 1) * prop * .5;
  }
  return norm(loopify([L, R], sr, F), .8);
}
// 제트 엔진: 터빈 고음 + 배기 굉음 (반복 루프)
function jetLoop(seed, len = 2.5, sr = S32) {
  const F = .4, d = len + F, L = buf(d, sr), R = buf(d, sr), n = L.length, r = rng(seed), wob = vnoise(r, 3, sr, n);
  const rl = new BQ('lp', 1600, .6, sr), rr2 = new BQ('lp', 1700, .6, sr), bl = new BQ('bp', 380, .8, sr), br = new BQ('bp', 420, .8, sr), hl = new BQ('bp', 5200, 1.5, sr);
  let p1 = 0, p2 = 0, pl = 0, pr = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, wl = r() * 2 - 1, wr = r() * 2 - 1, wb = 1 + (wob(i) - .5) * .006;
    pl = (pl + .05 * wl) / 1.05; pr = (pr + .05 * wr) / 1.05;
    p1 += 1150 * wb / sr; p2 += 2310 * wb / sr;
    const whine = Math.sin(TAU * p1) * .1 + Math.sin(TAU * p2) * .05 + Math.sin(TAU * p1 * 3.02) * .02;
    const roarL = rl.p(pl) * 2.2 + bl.p(wl) * .5, roarR = rr2.p(pr) * 2.2 + br.p(wr) * .5;
    L[i] = roarL + whine + hl.p(wl) * .05; R[i] = roarR + whine * .9 + hl.p(wr) * .05;
  }
  return norm(loopify([L, R], sr, F), .8);
}
// 제트 시동: 터빈이 돌기 시작해 점화되며 굉음이 커짐
function jetStart(seed) {
  const sr = S32, d = 2.6, L = buf(d, sr), R = buf(d, sr), r = rng(seed), lp = new BQ('lp', 300, .6, sr), bp = new BQ('bp', 400, .8, sr);
  let ph = 0, pk = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, k = Math.min(1, t / 1.8), f = 180 + 970 * (1 - (1 - k) ** 2), w = r() * 2 - 1; ph += f / sr; pk = (pk + .05 * w) / 1.05;
    if ((i & 63) === 0) lp.set(300 + 1500 * Math.max(0, (t - .7) / 1.4));
    const ign = t > .75 ? Math.min(1, (t - .75) / .5) : 0, boom = t > .75 && t < .9 ? Math.exp(-(t - .75) / .04) * .6 : 0;
    const x = (Math.sin(TAU * ph) * .3 + Math.sin(TAU * 2 * ph) * .12) * Math.min(1, t / .2) + (lp.p(pk) * 2.4 + bp.p(w) * .4) * ign + boom * w;
    L[i] = R[i] = x * Math.min(1, (d - t) / .5);
  }
  reverb(L, R, sr, .2, .8, .5); return norm([L, R], .85);
}
// 적기 통과음 (도플러로 음높이가 높았다가 낮아짐)
function flyby(seed) {
  const sr = S32, d = 3.4, L = buf(d, sr), R = buf(d, sr), r = rng(seed), lp = new BQ('lp', 900, .7, sr), wh = new BQ('bp', 900, .7, sr), pl = new BQ('lp', 600, .7, sr);
  const tc = 1.5, fe0 = 30 + r() * 10; let ph = 0, last = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, dop = 1 + .14 * Math.tanh((tc - t) * 2.4), env = 1 / (1 + ((t - tc) / .55) ** 2), w = r() * 2 - 1;
    if ((i & 31) === 0) { lp.set(500 + 3200 * env); wh.set(700 + 900 * env * dop); }
    ph += fe0 * dop / sr; const k = Math.floor(ph); if (k !== last) last = k; const tp = (ph - k) / (fe0 * dop);
    let x = Math.sin(TAU * 90 * dop * tp) * Math.exp(-tp / .006) + pl.p(w) * Math.exp(-tp / .004) * 1.2;
    for (let h = 1; h <= 5; h++) x += Math.sin(TAU * h * ph) * .25 / h;
    const v = lp.p(sat(x, 1.4)) * env + wh.p(w) * env * env * .7;
    L[i] = v * (t < tc ? 1 : .85); R[i] = v * (t < tc ? .85 : 1);
  }
  reverb(L, R, sr, .2, .8, .5); return fadeEnds(norm([L, R], .85), sr, .3, .4);
}
// 공습 사이렌 (보스 경고)
function siren() {
  const sr = S32, d = 3.8, L = buf(d, sr), R = buf(d, sr), b1 = new BQ('hp', 260, .7, sr), b2 = new BQ('lp', 3200, .7, sr);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, f = t < 1.3 ? 240 + 420 * (1 - (1 - t / 1.3) ** 2) : t < 2 ? 660 + 6 * Math.sin(TAU * 4 * t) : 660 - 440 * ((t - 2) / 1.8) ** 1.6;
    p1 += f / sr; p2 += f * 1.013 / sr; let x = 0;
    for (let h = 1; h <= 9; h++) x += (Math.sin(TAU * h * p1) + Math.sin(TAU * h * p2) * .7) / h ** 1.1;
    const e = Math.min(1, t / .2) * Math.min(1, (d - t) / .6);
    L[i] = R[i] = b2.p(b1.p(x)) * e * .4;
  }
  reverb(L, R, sr, .4, .9, .4); return norm([L, R], .85);
}
// 여러 엔진이 다가오는 굉음 (보스 등장)
function heavyDrone(seed, d = 3.6) {
  const sr = S32, L = buf(d, sr), R = buf(d, sr), r = rng(seed), lp = new BQ('lp', 200, .8, sr), rl = new BQ('lp', 90, .7, sr), fes = [19, 21.5, 24.3];
  let b = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, w = r() * 2 - 1; if ((i & 63) === 0) lp.set(200 + 1300 * Math.min(1, t / d) ** 1.5);
    let x = 0; for (const fe of fes) { const tp = (t * fe) % 1 / fe; x += Math.sin(TAU * 70 * tp) * Math.exp(-tp / .01) * .6; for (let h = 1; h <= 4; h++) x += Math.sin(TAU * h * fe * t) * .12 / h; }
    b = (b + .02 * w) / 1.02;
    const e = Math.min(1, (t / d) ** 1.4 * 1.3) * Math.min(1, (d - t) / .4);
    L[i] = (lp.p(sat(x, 1.5)) + rl.p(b) * 5) * e; R[i] = L[i];
  }
  reverb(L, R, sr, .3, .88, .5); return norm([L, R], .9);
}
function thunder(seed) {
  const sr = S22, d = 5, L = buf(d, sr), R = buf(d, sr), r = rng(seed), fl = new BQ('lp', 300, .7, sr), fr = new BQ('lp', 300, .7, sr), hp = new BQ('hp', 1500, .7, sr);
  const lobes = [[.05, .5, 1], [.6 + r() * .4, .6, .7], [1.5 + r() * .5, .8, .55], [2.6 + r() * .6, 1.1, .4]]; let bl = 0, br = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, wl = r() * 2 - 1, wr = r() * 2 - 1; bl = (bl + .02 * wl) / 1.02; br = (br + .02 * wr) / 1.02;
    if ((i & 63) === 0) { const c = 80 + 400 * Math.exp(-t / 1.2); fl.set(c); fr.set(c * 1.1); }
    let e = 0; for (const [t0, w, a] of lobes) e += a * Math.exp(-(((t - t0) / w) ** 2) * 3);
    const crack = t < .25 ? hp.p(wl) * Math.exp(-t / .06) * .8 : 0;
    L[i] = fl.p(bl) * e * 6 + crack; R[i] = fr.p(br) * e * 6 + crack * .7;
  }
  reverb(L, R, sr, .35, .9, .6); return norm([L, R], .9);
}
// 스테이지 환경음 (끊김 없는 루프)
function ambience(kind, seed) {
  const sr = S22, len = 7, F = 1.2, d = len + F, L = buf(d, sr), R = buf(d, sr), n = L.length, r = rng(seed);
  const v = [vnoise(r, .25, sr, n), vnoise(r, .4, sr, n), vnoise(r, .18, sr, n), vnoise(r, 2, sr, n)];
  const f = { l1: new BQ('lp', 500, .6, sr), r1: new BQ('lp', 520, .6, sr), b1: new BQ('bp', 600, 1.2, sr), b2: new BQ('bp', 900, 1.2, sr), b3: new BQ('bp', 1400, .5, sr), h1: new BQ('hp', 3000, .7, sr), h2: new BQ('hp', 3200, .7, sr) };
  let bl = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, wl = r() * 2 - 1, wr = r() * 2 - 1; bl = (bl + .02 * wl) / 1.02; br = (br + .02 * wr) / 1.02;
    let l = 0, rr = 0;
    if (kind === 'ocean') {
      const sw = .45 + .55 * v[0](i), sw2 = .45 + .55 * v[2](i);
      l = f.l1.p(bl) * 3 * sw + f.b3.p(wl) * .35 * sw ** 3; rr = f.r1.p(br) * 3 * sw2 + f.b3.p(wr) * .35 * sw2 ** 3;
    } else if (kind === 'desert') {
      if ((i & 63) === 0) { f.b1.set(380 + 320 * v[1](i)); f.b2.set(500 + 360 * v[2](i)); }
      const g = .4 + .6 * v[0](i); l = f.b1.p(wl) * g * .9 + f.h1.p(wl) * .12 * g * g; rr = f.b2.p(wr) * g * .9 + f.h2.p(wr) * .12 * g * g;
    } else if (kind === 'arctic') {
      if ((i & 63) === 0) { f.b1.q = 9; f.b2.q = 9; f.b1.set(480 + 360 * v[1](i)); f.b2.set(820 + 420 * v[2](i)); }
      const g = .35 + .65 * v[0](i); l = f.l1.p(bl) * 2 * g + f.b1.p(wl) * 1.1 * g + f.h1.p(wl) * .05; rr = f.r1.p(br) * 2 * g + f.b2.p(wr) * 1.1 * g + f.h2.p(wr) * .05;
    } else if (kind === 'storm') {
      const g = .55 + .45 * v[0](i); l = f.h1.p(wl) * .32 + f.l1.p(bl) * 2.6 * g + f.b1.p(wl) * .3 * v[1](i); rr = f.h2.p(wr) * .32 + f.r1.p(br) * 2.6 * g + f.b2.p(wr) * .3 * v[2](i);
      if (r() < .0009) { const a = .3 + r() * .5; l += a; rr += a * r(); }
    } else { // fortress: 고공 바람 + 거대 요새의 먼 엔진 저음
      if ((i & 63) === 0) { f.b3.q = 1.6; f.b3.set(1000 + 500 * v[1](i)); }
      const g = .4 + .6 * v[0](i), dr = (Math.sin(TAU * 41 * t) + Math.sin(TAU * 41.7 * t) * .8 + Math.sin(TAU * 62 * t) * .5 + Math.sin(TAU * 83.2 * t) * .3) * .12;
      l = f.b3.p(wl) * .5 * g + dr + f.l1.p(bl) * 1.2; rr = f.b3.p(wr) * .5 * g + dr * .95 + f.r1.p(br) * 1.2;
    }
    L[i] = l; R[i] = rr;
  }
  return norm(loopify([L, R], sr, F), .7);
}
// 무전기: 켜짐(치직), 꺼짐(치직+확인음), 배경 잡음 루프
function radioOn(seed) { const sr = S22, L = buf(.22, sr), b = new BQ('bp', 1900, .8, sr), r = rng(seed); for (let i = 0; i < L.length; i++) { const t = i / sr; L[i] = (i < 40 ? (1 - i / 40) : 0) + b.p(r() * 2 - 1) * Math.exp(-t / .06) * 1.6; } return norm([L, L.slice()], .7); }
function radioOff(seed) {
  const sr = S22, L = buf(.34, sr), b = new BQ('bp', 2100, .7, sr), r = rng(seed);
  for (let i = 0; i < L.length; i++) { const t = i / sr; let x = t < .12 ? b.p(r() * 2 - 1) * (1 - t / .12) * 1.4 : 0; if (t > .14 && t < .22) x += (Math.sin(TAU * 1250 * t) > 0 ? .35 : -.35) * Math.min(1, (t - .14) / .005, (.22 - t) / .005); L[i] = x; }
  return norm([L, L.slice()], .7);
}
function staticLoop(seed) { const sr = S22, F = .3, L = buf(2.3, sr), b = new BQ('bp', 2200, .7, sr), r = rng(seed); for (let i = 0; i < L.length; i++) { L[i] = b.p(r() * 2 - 1) * .3 + (r() < .002 ? (r() - .5) * 1.2 : 0); } const o = loopify([L], sr, F)[0]; return norm([o, o.slice()], .4); }
function click(seed, f = 2600, d = .045, th = 180) { const sr = S44, L = buf(d, sr), b = new BQ('bp', f, 3, sr), r = rng(seed); for (let i = 0; i < L.length; i++) { const t = i / sr; L[i] = b.p(r() * 2 - 1) * Math.exp(-t / .005) * 2 + Math.sin(TAU * th * t) * Math.exp(-t / .006) * .6; } return fadeEnds(norm([L, L.slice()], .7), sr); }
function sw(seed) { const a = click(seed, 3600, .03), b = click(seed + 1, 1700, .05, 140), sr = S44, L = buf(.08, sr); for (let i = 0; i < a[0].length; i++) L[i] += a[0][i]; const o = Math.floor(.018 * sr); for (let i = 0; i < b[0].length && o + i < L.length; i++) L[o + i] += b[0][i] * .8; return norm([L, L.slice()], .7); }
function bell(f0, d = 1, ratios = [1, 2.76, 5.4, 8.93], seed = 1) { const sr = S44, L = buf(d, sr), R = buf(d, sr), r = rng(seed); for (let i = 0; i < L.length; i++) { const t = i / sr; let x = 0; ratios.forEach((k, j) => { x += Math.sin(TAU * f0 * k * t + j) * Math.exp(-t / (d * .5 / (1 + j * .7))) / (1 + j); }); L[i] = x; R[i] = x; } reverb(L, R, sr, .25, .8, .4); return fadeEnds(norm([L, R], .6), sr); }
// 엔진 시동 (작전 시작): 스타터 모터 → 몇 번 털털 → 시동이 걸려 회전
function engineStart(seed) {
  const sr = S32, d = 2.8, L = buf(d, sr), r = rng(seed), pl = new BQ('lp', 700, .7, sr), body = new BQ('lp', 1800, .7, sr);
  const hits = [.55, .78, .95, 1.08, 1.18, 1.26, 1.32]; for (let t = 1.37; t < d; t += 1 / (22 + 14 * Math.min(1, (t - 1.37) / .6))) hits.push(t);
  let hi = 0, last = -1, ph = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, w = r() * 2 - 1; while (hi < hits.length && hits[hi] <= t) { last = hits[hi]; hi++; }
    let x = 0; if (t < 1.3) { ph += (260 + 500 * Math.min(1, t / .9)) / sr; x += (Math.sin(TAU * ph) + Math.sin(TAU * 2 * ph) * .4) * .18 * Math.min(1, t / .1) * (t < 1.1 ? 1 : (1.3 - t) / .2); }
    if (last >= 0) { const tp = t - last; x += (Math.sin(TAU * 85 * tp) * Math.exp(-tp / .012) + pl.p(w) * Math.exp(-tp / .008) * 1.3) * (last < 1.35 ? 1.2 : .9); }
    L[i] = body.p(sat(x, 1.6)) * Math.min(1, (d - t) / .4);
  }
  const R = L.slice(); reverb(L, R, sr, .22, .8, .5); return norm([L, R], .85);
}
function whoosh(seed, d = .6, f0 = 500, f1 = 2800) { const sr = S44, L = buf(d, sr), R = buf(d, sr), r = rng(seed), b = new BQ('bp', f0, 1.2, sr), hp = new BQ('hp', 2000, .7, sr); for (let i = 0; i < L.length; i++) { const t = i / sr, k = t / d; if ((i & 31) === 0) b.set(f0 + (f1 - f0) * Math.min(1, k * 1.6)); const w = r() * 2 - 1; L[i] = (t < .01 ? w * (1 - t / .01) : 0) + b.p(w) * Math.min(1, t / .02) * Math.exp(-t / (d * .35)) * 1.4 + hp.p(w) * .15 * Math.exp(-t / (d * .5)); R[i] = L[i]; } reverb(L, R, sr, .15, .7, .5); return fadeEnds(norm([L, R], .8), sr); }
function spinUp(seed) { const sr = S32, d = 1.05, L = buf(d, sr), r = rng(seed), b = new BQ('bp', 300, 2, sr); let ph = 0; for (let i = 0; i < L.length; i++) { const t = i / sr, k = t / d, f = 160 + 1500 * k * k; ph += f / sr; if ((i & 31) === 0) b.set(f * 2); L[i] = (Math.sin(TAU * ph) * .5 + Math.sin(TAU * 2 * ph) * .25 + Math.sin(TAU * 3.01 * ph) * .15 + b.p(r() * 2 - 1) * .6) * Math.min(1, t / .05) * (.4 + .6 * k); } const R = L.slice(); reverb(L, R, sr, .15, .7, .5); return fadeEnds(norm([L, R], .7), sr); }
function dive(seed) { const sr = S32, d = 1.6, L = buf(d, sr); let ph = 0; for (let i = 0; i < L.length; i++) { const t = i / sr, f = 1000 * Math.pow(.16, t / d); ph += f / sr; L[i] = (Math.sin(TAU * ph) + Math.sin(TAU * 2 * ph) * .35 + Math.sin(TAU * 3 * ph) * .15) * Math.min(1, t / .05) * (1 - t / d); } const R = L.slice(); reverb(L, R, sr, .3, .85, .5); return norm([L, R], .6); }
function shimmer(seed) { const sr = S44, d = .7, L = buf(d, sr), R = buf(d, sr), r = rng(seed), hp = new BQ('hp', 6000, .7, sr), ps = [0, 1, 2, 3, 4, 5].map(() => [2500 + r() * 3500, r() * .08]); for (let i = 0; i < L.length; i++) { const t = i / sr; let x = hp.p(r() * 2 - 1) * Math.exp(-t / .1) * .3; for (const [f, t0] of ps) if (t > t0) x += Math.sin(TAU * f * (t - t0)) * Math.exp(-(t - t0) / .2) * .2; L[i] = x; R[i] = x; } reverb(L, R, sr, .3, .85, .4); return fadeEnds(norm([L, R], .6), sr); }

// ───────── 악기 (군악풍 음악용) — 기준음 C4(60), 재생 속도로 음높이 변경
function brass(seed) {
  const sr = S32, d = 1.9, L = buf(d, sr), R = buf(d, sr), r = rng(seed), f0 = 261.63, nz = new BQ('bp', 1500, .8, sr), lpL = new BQ('lp', 4000, .7, sr), lpR = new BQ('lp', 4000, .7, sr);
  const vs = [-7, 0, 6].map(c => ({ k: Math.pow(2, c / 1200), p: r() })); let phV = r() * TAU;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, br = .2 + .8 * (1 - Math.exp(-t / .06)) - .25 * Math.min(1, t / .8), vib = 1 + (t > .3 ? .004 * Math.min(1, (t - .3) / .3) * Math.sin(phV += TAU * 5.4 / sr) : 0);
    let x = 0;
    for (const v of vs) { v.p += f0 * v.k * vib / sr; const dk = rd(TBL.s6, v.p), md = rd(TBL.s14, v.p), bt = rd(TBL.s28, v.p); x += br < .5 ? dk * (1 - br * 2) + md * br * 2 : md * (2 - br * 2) + bt * (br * 2 - 1); }
    const env = Math.min(1, t / .035) * (1 - .15 * Math.min(1, t / .5)) * Math.min(1, (d - t) / .3);
    const y = (x / 3 + nz.p(r() * 2 - 1) * Math.exp(-t / .05) * .3) * env;
    L[i] = lpL.p(y); R[i] = lpR.p(y);
  }
  return norm([L, R], .8);
}
function strings(seed) {
  const sr = S32, d = 3.6, L = buf(d, sr), R = buf(d, sr), r = rng(seed), f0 = 261.63, l1 = new BQ('lp', 3600, .7, sr), l2 = new BQ('lp', 3600, .7, sr);
  const vs = []; for (let k = 0; k < 6; k++) vs.push({ k: Math.pow(2, (r() * 20 - 10) / 1200), p: r(), vr: 5 + r() * 1.2, vp: r() * TAU, s: k % 2 });
  for (let i = 0; i < L.length; i++) {
    const t = i / sr; let a = 0, b = 0;
    for (const v of vs) { v.p += f0 * v.k * (1 + .0025 * Math.sin(v.vp + TAU * v.vr * t)) / sr; const s = rd(TBL.s28, v.p); if (v.s) a += s; else b += s; }
    const env = Math.min(1, t / .28) * Math.min(1, (d - t) / .5);
    L[i] = l1.p(a / 3) * env; R[i] = l2.p(b / 3) * env;
  }
  return norm([L, R], .75);
}
function cello(seed) { // 저음 스타카토 (베이스)
  const sr = S32, d = .9, L = buf(d, sr), r = rng(seed), f0 = 65.41, lp = new BQ('lp', 1400, .8, sr), nz = new BQ('bp', 900, .7, sr); const vs = [0, 8].map(c => ({ k: Math.pow(2, c / 1200), p: r() }));
  for (let i = 0; i < L.length; i++) { const t = i / sr; let x = 0; for (const v of vs) { v.p += f0 * v.k / sr; x += rd(TBL.s28, v.p); } const env = Math.min(1, t / .012) * Math.exp(-t / .3); L[i] = lp.p(x * .6 + nz.p(r() * 2 - 1) * Math.exp(-t / .03) * .4) * env; }
  return fadeEnds(norm([L, L.slice()], .85), sr);
}
function timpani(seed) { // 기준음 C2(36)
  const sr = S32, d = 2.4, L = buf(d, sr), R = buf(d, sr), r = rng(seed), f0 = 65.41, ml = new BQ('lp', 900, .7, sr);
  const modes = [[1, 1, 1.6], [1.5, .5, .9], [1.99, .35, .6], [2.44, .22, .4], [2.9, .12, .3]];
  for (let i = 0; i < L.length; i++) { const t = i / sr, pb = 1 + .012 * Math.exp(-t / .05); let x = ml.p(r() * 2 - 1) * Math.exp(-t / .015) * .6; for (const [k, a, dc] of modes) x += Math.sin(TAU * f0 * k * pb * t) * a * Math.exp(-t / dc); L[i] = R[i] = sat(x, 1.2); }
  reverb(L, R, sr, .2, .85, .5); return fadeEnds(norm([L, R], .85), sr, .001, .2);
}
function snare(seed) {
  const sr = S44, d = .45, L = buf(d, sr), r = rng(seed), sn = new BQ('bp', 4200 + r() * 800, .5, sr), hp = new BQ('hp', 400, .7, sr);
  for (let i = 0; i < L.length; i++) { const t = i / sr, w = r() * 2 - 1; L[i] = (Math.sin(TAU * 185 * t) * .5 + Math.sin(TAU * 330 * t) * .3) * Math.exp(-t / .045) + sn.p(w) * Math.exp(-t / .14) * 1.3 + hp.p(w) * Math.exp(-t / .006) * .6; }
  const R = L.slice(); reverb(L, R, sr, .15, .75, .5); return fadeEnds(norm([L, R], .85), sr);
}
function bassDrum(seed) { const sr = S32, d = 1.3, L = buf(d, sr), r = rng(seed), lp = new BQ('lp', 220, .7, sr); let ph = 0; for (let i = 0; i < L.length; i++) { const t = i / sr; ph += (48 + 18 * Math.exp(-t / .08)) / sr; L[i] = Math.sin(TAU * ph) * Math.exp(-t / .38) + lp.p(r() * 2 - 1) * Math.exp(-t / .04) * .5; } const R = L.slice(); reverb(L, R, sr, .2, .85, .5); return fadeEnds(norm([L, R], .9), sr); }
function cymbal(seed) {
  const sr = S32, d = 3.2, L = buf(d, sr), R = buf(d, sr), r = rng(seed), hl = new BQ('hp', 5000, .7, sr), hr = new BQ('hp', 5200, .7, sr), bp = new BQ('bp', 7000, .6, sr), fs = [205.3, 304.4, 369.6, 522.7, 540, 800];
  for (let i = 0; i < L.length; i++) { const t = i / sr; let m = 0; for (const f of fs) m += Math.sin(TAU * f * 3.1 * t) > 0 ? 1 : -1; const e = Math.exp(-t / 1.1) * Math.min(1, t / .002); const mt = bp.p(m * .15); L[i] = (hl.p(r() * 2 - 1) * .8 + mt) * e; R[i] = (hr.p(r() * 2 - 1) * .8 + mt) * e; }
  return norm([L, R], .7);
}

// ───────── 현대식 신스·드럼 (액션 음악용) — 기준음: 베이스 C2(36), 리드·패드 C4(60), 플럭 C5(72)
function synBass(seed) { const sr = S32, d = .55, L = buf(d, sr), r = rng(seed), f0 = 65.41, lp = new BQ('lp', 2400, 2.5, sr); const vs = [-9, 9].map(c => ({ k: Math.pow(2, c / 1200), p: r() })); let ps = 0;
  for (let i = 0; i < L.length; i++) { const t = i / sr; if ((i & 15) === 0) lp.set(260 + 2600 * Math.exp(-t / .06)); let x = 0; for (const v of vs) { v.p += f0 * v.k / sr; x += rd(TBL.s28, v.p); } ps += f0 / sr; L[i] = sat((lp.p(x * .6) + Math.sin(TAU * ps) * .55) * Math.min(1, t / .003) * Math.exp(-t / .3), 1.6); }
  return fadeEnds(norm([L, L.slice()], .9), sr); }
function synLead(seed) { const sr = S32, d = 1.3, L = buf(d, sr), R = buf(d, sr), r = rng(seed), f0 = 261.63, l1 = new BQ('lp', 5200, .9, sr), l2 = new BQ('lp', 5200, .9, sr); const vs = [-14, -6, 0, 6, 14].map((c, j) => ({ k: Math.pow(2, c / 1200), p: r(), s: j % 2 })); let vb = 0;
  for (let i = 0; i < L.length; i++) { const t = i / sr, vib = 1 + (t > .18 ? .003 * Math.sin(vb += TAU * 6 / sr) : 0); let a = 0, b = 0; for (const v of vs) { v.p += f0 * v.k * vib / sr; const x = rd(TBL.s28, v.p); if (v.s) a += x; else b += x; } const e = Math.min(1, t / .004) * (.75 + .25 * Math.exp(-t / .08)) * Math.min(1, (d - t) / .15); L[i] = l1.p(a * .45 + b * .2) * e; R[i] = l2.p(b * .45 + a * .2) * e; }
  return norm([L, R], .8); }
function synPluck(seed) { const sr = S32, d = .32, L = buf(d, sr), r = rng(seed), f0 = 523.25, lp = new BQ('lp', 6000, 1.5, sr); let p = r();
  for (let i = 0; i < L.length; i++) { const t = i / sr; if ((i & 15) === 0) lp.set(900 + 6000 * Math.exp(-t / .04)); p += f0 / sr; L[i] = lp.p(rd(TBL.s14, p)) * Math.min(1, t / .002) * Math.exp(-t / .09); }
  const R = L.slice(); return fadeEnds(norm([L, R], .75), sr); }
function synPad(seed) { const sr = S32, d = 2.6, L = buf(d, sr), R = buf(d, sr), r = rng(seed), f0 = 261.63, l1 = new BQ('lp', 2200, .7, sr), l2 = new BQ('lp', 2200, .7, sr); const vs = []; for (let k = 0; k < 7; k++) vs.push({ k: Math.pow(2, (r() * 30 - 15) / 1200), p: r(), s: k % 2 });
  for (let i = 0; i < L.length; i++) { const t = i / sr; let a = 0, b = 0; for (const v of vs) { v.p += f0 * v.k / sr; const x = rd(TBL.s28, v.p); if (v.s) a += x; else b += x; } const e = Math.min(1, t / .06) * Math.min(1, (d - t) / .4); L[i] = l1.p(a / 3) * e; R[i] = l2.p(b / 3) * e; }
  return norm([L, R], .7); }
function kick(seed) { const sr = S44, d = .42, L = buf(d, sr), r = rng(seed); let ph = 0;
  for (let i = 0; i < L.length; i++) { const t = i / sr; ph += TAU * (46 + 130 * Math.exp(-t / .035)) / sr; L[i] = sat(Math.sin(ph) * Math.exp(-t / .2) * 1.6 + (t < .004 ? (r() * 2 - 1) * (1 - t / .004) * .7 : 0), 1.8); }
  return fadeEnds(norm([L, L.slice()], .95), sr); }
function snare2(seed) { const sr = S44, d = .28, L = buf(d, sr), r = rng(seed), hp = new BQ('hp', 1100, .7, sr), bp = new BQ('bp', 3800, .6, sr); let ph = 0;
  for (let i = 0; i < L.length; i++) { const t = i / sr, w = r() * 2 - 1; ph += TAU * (190 + 60 * Math.exp(-t / .01)) / sr; L[i] = Math.sin(ph) * Math.exp(-t / .045) * .8 + (hp.p(w) * .7 + bp.p(w) * .6) * Math.exp(-t / .085); }
  const R = L.slice(); reverb(L, R, sr, .06, .6, .5); return fadeEnds(norm([L, R], .9), sr); }
function clap(seed) { const sr = S44, d = .3, L = buf(d, sr), r = rng(seed), bp = new BQ('bp', 1500, .9, sr);
  for (let i = 0; i < L.length; i++) { const t = i / sr; let e = 0; for (const t0 of [0, .011, .022]) if (t >= t0) e = Math.max(e, Math.exp(-(t - t0) / (t0 === .022 ? .09 : .006))); L[i] = bp.p(r() * 2 - 1) * e; }
  const R = L.slice(); reverb(L, R, sr, .1, .6, .5); return fadeEnds(norm([L, R], .85), sr); }
function hat(seed, open) { const sr = S44, d = open ? .35 : .07, L = buf(d, sr), r = rng(seed), hp = new BQ('hp', 7500, .8, sr), fs = [205.3, 304.4, 369.6, 522.7, 540, 800];
  for (let i = 0; i < L.length; i++) { const t = i / sr; let m = 0; for (const f of fs) m += Math.sin(TAU * f * 8.2 * t) > 0 ? 1 : -1; L[i] = hp.p((r() * 2 - 1) * .7 + m * .08) * Math.exp(-t / (open ? .12 : .018)); }
  return fadeEnds(norm([L, L.slice()], .7), sr); }
// 경보: 빠르게 반복되는 디지털 경고음 + 저음 강하 (보스 경고)
function alarm() { const sr = S32, d = 2, L = buf(d, sr); let p = 0, ps = 0;
  for (let i = 0; i < L.length; i++) { const t = i / sr, k = Math.floor(t / .25), on = (t % .25) < .19, f = k % 2 ? 660 : 880; p += f / sr; ps += (55 + 30 * Math.exp(-t / .5)) / sr;
    L[i] = (on ? sat(((p % 1) < .5 ? .5 : -.5) + Math.sin(TAU * 2 * p) * .2, 2) * .45 * Math.min(1, (t % .25) / .004, (.19 - (t % .25)) / .01) : 0) + Math.sin(TAU * ps) * .35 * Math.min(1, t / .05) * Math.min(1, (d - t) / .3); }
  const R = L.slice(); reverb(L, R, sr, .1, .7, .5); return norm([L, R], .85); }
function blip(seed, f = 1600, d = .07) { const sr = S44, L = buf(d, sr); for (let i = 0; i < L.length; i++) { const t = i / sr; L[i] = (Math.sin(TAU * f * t) + Math.sin(TAU * f * 2 * t) * .3) * Math.min(1, t / .002) * Math.exp(-t / (d * .35)); } return fadeEnds(norm([L, L.slice()], .6), sr); }

// ───────── 샘플 목록 (이름 → 변형 여러 개)
const DEFS = {
  gun: [1, 2, 3, 4].map(s => () => gun(s, { f: 900, th: 150, bt: .014, tt: .028, tw: 1, zip: .28, mech: 0, rev: .03, dur: .17 })),
  egun: [5, 6, 7].map(s => () => gun(s, { f: 1300, th: 220, bt: .012, tt: .02, tw: .45, zip: .35, lp: 5200, rev: .06, mech: 0, dur: .16 })),
  cannon: [8, 9].map(s => () => gun(s, { f: 420, th: 90, bt: .045, tt: .09, tw: 1.4, zip: .3, dur: .7, rev: .1 })),
  boomS: [11, 12, 13].map(s => () => explosion(s, 0)),
  boomM: [21, 22, 23].map(s => () => explosion(s, 1)),
  boomL: [31, 32].map(s => () => explosion(s, 2)),
  tink: [41, 42, 43, 44].map(s => () => tink(s)),
  clank: [51, 52].map(s => () => clank(s)),
  engine: [() => engineLoop(61, 36, 2)],
  jet: [() => jetLoop(62)], jstart: [() => jetStart(63)],
  flyby: [71, 72].map(s => () => flyby(s)),
  siren: [() => siren()],
  drone: [() => heavyDrone(81)],
  thunder: [91, 92].map(s => () => thunder(s)),
  amb_ocean: [() => ambience('ocean', 101)], amb_desert: [() => ambience('desert', 102)], amb_arctic: [() => ambience('arctic', 103)],
  amb_storm: [() => ambience('storm', 104)], amb_fortress: [() => ambience('fortress', 105)],
  rOn: [111, 112].map(s => () => radioOn(s)), rOff: [113].map(s => () => radioOff(s)), rStatic: [() => staticLoop(114)],
  type: [121, 122, 123].map(s => () => click(s, 2400 + s * 40, .04, 170)),
  sw: [131].map(s => () => sw(s)),
  ping: [() => bell(1320, 1.1, [1, 2.76, 5.4], 3)], coin: [() => bell(2600, .5, [1, 2.76, 5.4, 8.93], 4)], coin2: [() => bell(3150, .6, [1, 2.76, 5.4, 8.93], 5)],
  start: [() => engineStart(141)],
  whoosh: [151, 152].map(s => () => whoosh(s)),
  spin: [() => spinUp(161)], dive: [() => dive(162)], shimmer: [() => shimmer(171)],
  i_brass: [() => brass(201)], i_strings: [() => strings(202)], i_cello: [() => cello(203)], i_timp: [() => timpani(204)],
  i_snare: [205, 206, 207].map(s => () => snare(s)), i_bd: [() => bassDrum(208)], i_cym: [() => cymbal(209)],
  m_bass: [() => synBass(301)], m_lead: [() => synLead(302)], m_pluck: [() => synPluck(303)], m_pad: [() => synPad(304)],
  m_kick: [() => kick(305)], m_snare: [306, 307].map(s => () => snare2(s)), m_clap: [() => clap(308)], m_hat: [309, 310].map(s => () => hat(s, 0)), m_ohat: [() => hat(311, 1)],
  alarm: [() => alarm()], blip: [() => blip(320, 1600)], blip2: [() => blip(321, 2400, .09)],
};
const SRATE = { m_bass: S32, m_lead: S32, m_pluck: S32, m_pad: S32, alarm: S32, engine: S32, jet: S32, jstart: S32, flyby: S32, siren: S32, drone: S32, start: S32, spin: S32, dive: S32, thunder: S22, rOn: S22, rOff: S22, rStatic: S22, i_brass: S32, i_strings: S32, i_cello: S32, i_timp: S32, i_bd: S32, i_cym: S32 };
const RAW = {}; // 이름 → [[L,R], ...]
let rendered = false;
// 로딩 직후 백그라운드에서 조금씩 렌더 (화면이 멈추지 않게)
const order = ['blip', 'blip2', 'm_kick', 'm_hat', 'm_snare', 'm_bass', 'm_pluck', 'm_pad', 'm_lead', 'm_ohat', 'm_clap', 'i_cym', 'amb_ocean', 'gun', 'boomS', 'tink', 'egun', 'boomM', 'jet', 'jstart', 'rOn', 'rOff', 'type', 'ping', 'i_bd', 'boomL', 'clank', 'cannon', 'alarm', 'drone', 'sw', 'i_timp', 'flyby', 'whoosh', 'spin', 'dive', 'coin', 'coin2', 'rStatic', 'amb_desert', 'amb_arctic', 'amb_storm', 'amb_fortress', 'thunder'];
const queue = []; for (const k of order) DEFS[k].forEach((f, i) => queue.push([k, i, f]));
function pump() {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < 14) { const [k, i, f] = queue.shift(); try { (RAW[k] = RAW[k] || [])[i] = f(); } catch (e) { console.warn('sound render', k, e); } if (AC) toBuffers(k); }
  if (queue.length) setTimeout(pump, 0); else rendered = true;
}
setTimeout(pump, 30);

// ───────── 실시간 재생
let AC = null, meter = null, sideBus = null, master, limiter, sfxBus, musBus, musWet, ambBus, engBus, radBus, muted = false;
const BUF = {};
function toBuffers(k) {
  if (!RAW[k]) return; const sr = SRATE[k] || (k.startsWith('amb_') ? S22 : S44);
  BUF[k] = RAW[k].filter(Boolean).map(ch => { const b = AC.createBuffer(2, ch[0].length, sr); b.getChannelData(0).set(ch[0]); b.getChannelData(1).set(ch[1]); return b; });
}
function hallIR() {
  const sr = AC.sampleRate, n = Math.floor(sr * 2.2), b = AC.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c), r = rng(900 + c); let lp = 0; for (let i = 0; i < n; i++) { const t = i / sr, k = .15 + .8 * Math.exp(-t / .5); lp += (r() * 2 - 1 - lp) * k; d[i] = lp * Math.exp(-t / .55) * (i < sr * .012 ? i / (sr * .012) : 1); } }
  return b;
}
function unlock() {
  if (AC) { if (AC.state !== 'running') AC.resume().catch(() => {}); return AC; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    limiter = AC.createDynamicsCompressor(); limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 12; limiter.attack.value = .002; limiter.release.value = .25;
    master = AC.createGain(); master.gain.value = muted ? 0 : .9; master.connect(limiter); limiter.connect(AC.destination);
    meter = AC.createAnalyser(); meter.fftSize = 2048; limiter.connect(meter); // 출력 레벨 측정용 (디버그)
    sfxBus = AC.createGain(); sfxBus.gain.value = .85; sfxBus.connect(master);
    musBus = AC.createGain(); musBus.gain.value = .5; musBus.connect(master);
    sideBus = AC.createGain(); sideBus.gain.value = 1; sideBus.connect(musBus);
    const conv = AC.createConvolver(); conv.buffer = hallIR(); musWet = AC.createGain(); musWet.gain.value = .12; musBus.connect(musWet); musWet.connect(conv); conv.connect(master);
    ambBus = AC.createGain(); ambBus.gain.value = .0; ambBus.connect(master);
    engBus = AC.createGain(); engBus.gain.value = 0; engBus.connect(master);
    radBus = AC.createGain(); radBus.gain.value = .5; radBus.connect(master);
    for (const k in RAW) toBuffers(k);
  } catch (e) { AC = null; }
  return AC;
}
const active = {}; // 이름별 동시 재생 수 제한
const LIMIT = { gun: 4, egun: 3, boomS: 6, boomM: 4, boomL: 3, tink: 4, clank: 2, flyby: 2, thunder: 1, type: 2 };
let LP = { x: W / 2, y: H * .8 };
function play(name, o = {}) {
  if (!AC || !BUF[name] || !BUF[name].length) return null;
  const now = AC.currentTime, t = now + (o.when || 0), lim = LIMIT[name];
  if (lim) { const a = (active[name] = (active[name] || []).filter(e => e > now)); if (a.length >= lim) return null; }
  const b = BUF[name][Math.random() * BUF[name].length | 0], s = AC.createBufferSource(); s.buffer = b;
  const rate = (o.rate || 1) * (1 + (Math.random() - .5) * (o.jit == null ? .08 : o.jit)); s.playbackRate.value = rate;
  const g = AC.createGain(); g.gain.value = o.vol == null ? 1 : o.vol; let node = s;
  // 거리감: 플레이어에게서 멀수록 작고 둔하게
  if (o.x != null && o.dist !== false) {
    const dd = Math.min(1, Math.hypot(o.x - LP.x, (o.y == null ? LP.y - 200 : o.y) - LP.y) / 620);
    g.gain.value *= 1 - .5 * dd; const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 18000 * Math.pow(.12, dd); node.connect(f); node = f;
  }
  if (o.lp) { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
  node.connect(g); node = g;
  const pan = o.pan != null ? o.pan : o.x != null ? Math.max(-1, Math.min(1, (o.x / W - .5) * 1.4)) : 0;
  if (pan && AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
  node.connect(o.bus || sfxBus);
  if (o.loop) s.loop = true;
  s.start(t, o.offset || 0);
  const end = t + (o.dur || b.duration / rate);
  if (o.dur) { g.gain.setValueAtTime(g.gain.value, end - (o.rel || .08)); g.gain.linearRampToValueAtTime(0, end); s.stop(end + .02); }
  if (lim) active[name].push(end);
  return { s, g };
}
function duck(amt, hold = .25) { if (!AC) return; const t = AC.currentTime; for (const [b, v] of [[musBus, .5], [ambBus, null]]) { const cur = b.gain.value; b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(cur, t); b.gain.linearRampToValueAtTime(cur * amt, t + .03); if (v != null) b.gain.setTargetAtTime(v, t + hold, .6); } ambDuck = t + hold; }
let ambDuck = 0;

// ───────── 효과음 (게임에서 부르는 이름 그대로)
let lastBoom = 0, lastWarn = -9, lastTick = 0;
const F = () => AC ? AC.currentTime : 0;
const SFX = {
  shot: () => play('gun', { vol: .4, jit: .12, pan: (LP.x / W - .5) * .6 }),
  sub: () => play('whoosh', { vol: .22, pan: (LP.x / W - .5) * .6 }),
  tick: (x, y) => { if (F() - lastTick < .045) return; lastTick = F(); play('tink', { x, y, vol: .3, jit: .15 }); },
  eshot: (x, y) => play('egun', { x, y, vol: .3, jit: .15 }),
  boom: (x, y) => { if (F() - lastBoom < .04) return; lastBoom = F(); play('boomS', { x, y, vol: .6, jit: .14 }); },
  mid: (x, y) => { play('boomM', { x, y, vol: .85 }); duck(.82, .15); },
  big: (x, y) => { play('boomL', { x, y, vol: 1, jit: .05 }); play('m_kick', { vol: .9, rate: .7 }); play('boomM', { x, y, vol: .45, when: .1 }); duck(.6, .3); },
  power: () => { [0, 4, 7, 12].forEach((n, i) => play('m_pluck', { vol: .35, rate: Math.pow(2, n / 12), when: i * .05, jit: 0 })); play('whoosh', { vol: .25, rate: 1.6 }); play('blip2', { vol: .3, when: .2 }); },
  item: () => { play('blip', { vol: .45 }); play('blip2', { vol: .4, when: .06 }); play('clank', { vol: .25, rate: 1.6 }); },
  gold: () => { play('coin', { vol: .4 }); play('coin2', { vol: .35, when: .07 }); },
  bomb: ty => {
    duck(.4, 1.5);
    if (ty === 'carpet') { play('drone', { vol: .7, rate: 1.2 }); for (let i = 0; i < 6; i++) play('boomM', { vol: .7, when: .5 + i * .22, pan: (i % 3 - 1) * .6, jit: .15 }); play('boomL', { vol: .8, when: 1.3 }); }
    else { play('spin', { vol: .35, rate: .7 }); play('boomL', { vol: 1, when: .15 }); play('boomL', { vol: .7, when: .6, rate: .8 }); play('thunder', { vol: .5, when: .2 }); }
  },
  chargeUp: () => play('spin', { vol: .3, jit: 0 }),
  chargeReady: () => { play('sw', { vol: .5 }); play('ping', { vol: .3, rate: 1.33 }); },
  charge: () => { play('cannon', { vol: .9 }); play('whoosh', { vol: .4, rate: .7 }); duck(.7); },
  die: () => { play('boomL', { x: LP.x, y: LP.y, vol: 1 }); play('dive', { vol: .5, pan: (LP.x / W - .5) }); play('clank', { vol: .5, rate: .7 }); duck(.35, 1); },
  hit: () => { play('clank', { vol: .6, jit: .2 }); play('tink', { vol: .3, rate: .8 }); },
  warn: () => { if (F() - lastWarn < 1.9) return; lastWarn = F(); play('alarm', { vol: .5, jit: 0 }); },
  bossIn: () => { play('drone', { vol: .7, jit: 0, rate: 1.3 }); play('m_kick', { vol: 1, when: 2.6, rate: .6 }); play('i_cym', { vol: .4, when: 2.6 }); },
  cancel: () => play('whoosh', { vol: .3, rate: .55 }),
  ok: () => { play('blip', { vol: .5 }); play('blip2', { vol: .45, when: .07 }); },
  sel: () => play('blip', { vol: .4, jit: .05 }),
  start: () => { play('jstart', { vol: .7, jit: 0 }); play('blip2', { vol: .5 }); play('m_kick', { vol: .8, when: .8 }); },
  ext: () => { stinger([[72, 0, .12], [76, .12, .12], [79, .24, .12], [84, .36, .5]], .32); play('blip2', { vol: .3, when: .36 }); },
  clear: () => { stinger([[72, 0, .12], [72, .14, .12], [72, .28, .12], [76, .42, .25], [79, .7, .25], [76, .98, .12], [79, 1.12, .12], [84, 1.26, 1.1]], .34); drum('i_cym', 1.26, .4); drum('m_kick', 1.26, .9); [60, 64, 67].forEach(n => inst('m_pad', n, 1.26, 1.8, .14)); },
  over: () => { [[64, 0, .45], [60, .5, .45], [57, 1, .45], [53, 1.5, .45], [52, 2, 1.8]].forEach(([n, t, d]) => { inst('m_lead', n - 12, t, d, .22); inst('m_bass', n - 24, t, d, .35); }); [40, 47, 52].forEach(n => inst('m_pad', n + 12, 2, 2.2, .14)); drum('m_kick', 2, .7); },
  // 새 효과음
  flyby: x => play('flyby', { x, dist: false, vol: .38, jit: .12, pan: Math.max(-1, Math.min(1, (x / W - .5) * 1.2)) }),
  // 무전: 켜짐 소리 + 정해진 시간만큼 배경 잡음 (스스로 멈추므로 잡음이 남지 않음)
  radioOn: d => { play('rOn', { bus: radBus, vol: .55, jit: .1 }); if (d) { const st = play('rStatic', { bus: radBus, loop: true, vol: .12, jit: 0, dur: d, rel: .15 }); if (st) radioLive.push(st); } },
  radioOff: () => { play('rOff', { bus: radBus, vol: .5 }); },
  squelch: () => play('rOn', { bus: radBus, vol: .35, jit: .15 }),
  type: () => play('type', { vol: .22, jit: .2 }),
  thunder: () => play('thunder', { vol: .45, pan: Math.random() * 1.6 - .8 }),
};
// 진행 중인 무전 잡음 (음소거·화면 전환 때 끄기)
const radioLive = [];
function radioStatic(on) { if (on || !AC) return; const t = AC.currentTime; while (radioLive.length) { const v = radioLive.pop(); try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, .04); v.s.stop(t + .2); } catch (_) {} } }
const BASE = { m_bass: 36, m_lead: 60, m_pad: 60, m_pluck: 72, i_timp: 36, i_cello: 36 };
function inst(name, midi, when, dur, vol, pan = 0, bus) {
  return play(name, { bus: bus || musBus, rate: Math.pow(2, (midi - (BASE[name] ?? 60)) / 12), when, dur, vol, pan, jit: 0, rel: name === 'm_pad' ? .3 : .04 });
}
const drum = (name, when, vol, pan = 0) => play(name, { bus: musBus, when, vol, pan, jit: name === 'm_kick' ? 0 : .04 });
// 사이드체인: 킥이 칠 때 베이스·패드·아르페지오를 순간 눌러 '쿵쿵' 펌핑감을 만든다
function sideDuck(when, depth = .4) { if (!sideBus) return; const g = sideBus.gain, t = AC.currentTime + when; g.setValueAtTime(depth, t); g.linearRampToValueAtTime(1, t + .13); }
function stinger(notes, vol) { for (const [n, t, d] of notes) { inst('m_lead', n - 12, t, d, vol); inst('m_lead', n, t, d, vol * .3); inst('m_bass', n - 36, t, Math.min(d, .3), vol); } drum('m_kick', 0, .8); }

// ───────── 음악: 빠른 액션 신스 (킥·스네어·클랩·하이햇 + 16분음 베이스 + 아르페지오 + 슈퍼소 리드 + 사이드체인)
const bars = a => a.flatMap(r => Array(8).fill(r));
const SONGS = {
  stage: { bpm: 164, drive: 1, roots: bars([45, 45, 43, 40, 41, 41, 43, 40, 41, 41, 43, 43, 45, 45, 40, 40]),
    lead: [76,0,76,74,76,0,81,0, 79,0,76,0,74,0,72,0, 74,0,74,72,74,0,79,0, 76,0,0,0,71,0,74,0,
           77,0,77,76,77,0,81,0, 79,0,77,0,76,0,74,0, 76,0,79,0,83,0,81,0, 80,0,76,0,80,0,83,0,
           72,0,77,0,81,0,77,0, 84,0,81,0,77,0,81,0, 74,0,79,0,83,0,79,0, 86,0,83,0,79,0,83,0,
           76,0,81,0,84,0,81,0, 88,0,86,0,84,0,81,0, 80,0,83,0,88,0,86,0, 83,0,80,0,76,0,80,0] },
  boss: { bpm: 184, drive: 2, roots: bars([38, 38, 36, 37, 38, 38, 41, 40]),
    lead: [74,0,77,0,81,0,80,81, 0,77,0,74,0,73,74,0, 72,0,76,0,79,0,78,79, 73,0,76,0,79,0,82,0,
           81,0,86,0,89,0,88,86, 0,84,0,81,0,82,81,0, 84,0,89,0,93,0,91,89, 0,88,0,85,0,88,0,91] },
  title: { bpm: 118, drive: 0, roots: bars([45, 41, 36, 43]),
    lead: [69,0,0,72,0,0,76,0, 77,0,0,76,0,0,72,0, 67,0,0,72,0,0,76,0, 74,0,0,71,0,0,67,0] },
};
let song = null, songStep = 0, songT = 0, songTr = 0;
function music(name, stage = 0) {
  if (song === SONGS[name]) return; song = SONGS[name] || null; songStep = 0; songT = AC ? AC.currentTime + .05 : 0;
  songTr = name === 'stage' ? [0, 3, -2, 5, 2][stage % 5] : name === 'boss' ? [0, 2, -1, 3, 1][stage % 5] : 0;
}
function musicTick() {
  if (!AC || !song || muted || !BUF.m_kick) return;
  if (songT < AC.currentTime) songT = AC.currentTime + .02;
  while (songT < AC.currentTime + .12) {
    const w = songT - AC.currentTime, s16 = 15 / song.bpm, q = songStep, st = q >> 1, odd = q & 1, b16 = q % 16, barN = q >> 4, dv = song.drive;
    const r0 = song.roots[st % song.roots.length], r = r0 + songTr, pc = r0 % 12, third = pc === 9 || pc === 2 ? 3 : 4;
    const L = song.lead, li = st % L.length, l = odd ? 0 : L[li], fill = dv && barN % 8 === 7 && b16 >= 8;
    // 드럼
    if (dv === 2) { if ([0, 3, 6, 8, 11, 14].includes(b16) && !(fill && b16 > 8)) { drum('m_kick', w, .95); sideDuck(w); } }
    else if (dv === 1) { if ([0, 6, 8].includes(b16) || (b16 === 14 && barN % 2)) { drum('m_kick', w, .95); sideDuck(w); } }
    else if (b16 === 0 || b16 === 8) { drum('m_kick', w, .5); sideDuck(w, .7); }
    if (dv && (b16 === 4 || b16 === 12)) { drum('m_snare', w, .7); drum('m_clap', w, .32); }
    if (dv > 1 && (b16 === 7 || b16 === 15)) drum('m_snare', w, .14);
    if (fill) drum('m_snare', w, .22 + (b16 - 8) * .07);
    if (dv) { if (b16 % 2 === 0 || dv > 1) drum(b16 === 14 ? 'm_ohat' : 'm_hat', w, b16 % 4 === 2 ? .36 : .2, .25); }
    else if (b16 % 4 === 2) drum('m_hat', w, .12, .25);
    if (b16 === 0 && barN % 8 === 0) drum('i_cym', w, dv ? .3 : .15);
    // 베이스: 16분음 옥타브 구동
    const bp = dv ? [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 7, 0, 12, 0] : [0, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, -1, -1, -1, 7, -1];
    if (bp[b16] >= 0) inst('m_bass', r - 12 + bp[b16], w, s16 * (dv ? .85 : 3.5), dv ? .42 : .3, 0, sideBus);
    // 패드 화음 (마디마다)
    if (b16 === 0) for (const k of [12, 12 + third, 19]) inst('m_pad', r + k, w, s16 * 16 + .2, dv ? .08 : .14, (k - 15) / 14, sideBus);
    // 아르페지오
    if (dv || b16 % 2 === 0) { const ar = [12, 19, 12 + third, 24, 19, 12 + third, 24, 31]; inst('m_pluck', r + 12 + ar[b16 % 8], w, s16 * .9, dv ? .09 : .12, b16 % 2 ? .4 : -.4, sideBus); }
    // 리드 선율
    if (l) { let n = 1; while (n < 6 && !L[(li + n) % L.length]) n++; const d = s16 * 2 * n * .9, m = l + songTr - 12; inst('m_lead', m, w, d, dv ? .24 : .2); if (dv) inst('m_lead', m + 12, w, d, .06); }
    // 보스: 코드 스탭
    if (dv > 1 && (b16 === 0 || b16 === 6)) for (const k of [0, third, 7]) inst('m_lead', r + k, w, s16 * 1.2, .07, 0, sideBus);
    songStep++; songT += s16;
  }
}

// ───────── 엔진·환경음·주변 전장 소리 (매 프레임)
const AMB = { 0: 'amb_ocean', 1: 'amb_desert', 2: 'amb_desert', 3: 'amb_fortress', 4: 'amb_arctic', 5: 'amb_storm' };
let engV = null, amb = null, ambName = '', nextEvt = 0, tickN = 0;
function setAmb(name, vol) {
  if (!AC) return; const t = AC.currentTime;
  if (name !== ambName) {
    if (amb) { const o = amb; o.g.gain.setTargetAtTime(0, t, .5); o.s.stop(t + 3); amb = null; }
    ambName = name; if (name && BUF[name]) { amb = play(name, { bus: ambBus, loop: true, vol: 0, jit: 0, offset: Math.random() * 5 }); if (amb) amb.g.gain.setTargetAtTime(1, t, .6); } else ambName = '';
  }
  if (t > ambDuck) ambBus.gain.setTargetAtTime(muted ? 0 : vol, t, .4);
}
function tick(o) {
  musicTick();
  if (!AC || (++tickN % 4)) return;
  const t = AC.currentTime; LP.x = o.px; LP.y = o.py;
  // 플레이어 엔진: 위로 가속하면 회전수 상승
  if (!engV && BUF.jet) { engV = play('jet', { bus: engBus, loop: true, jit: 0, vol: 1 }); }
  if (engV) { engBus.gain.setTargetAtTime(o.playing && !muted ? .2 : 0, t, .3); engV.s.playbackRate.setTargetAtTime(1 + o.throttle * .05, t, .3); }
  const want = o.state === 'title' || o.state === 'select' ? 'amb_ocean' : AMB[o.bg] || 'amb_ocean';
  setAmb(want, o.state === 'play' ? .32 : o.state === 'story' ? .35 : .3);
  // 전장 분위기: 먼 폭발, 대서양 천둥
  if (o.state === 'play' && t > nextEvt) {
    if (nextEvt) { if (o.bg === 5 && Math.random() < .6) SFX.thunder(); else play('boomL', { vol: .16, lp: 900, pan: Math.random() * 1.6 - .8, rate: .8 }); }
    nextEvt = t + 9 + Math.random() * 14;
  }
}
function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : .9; if (m) radioStatic(false); }

// 화면이 숨겨지거나(탭 전환·최소화·창 닫힘) 페이지를 떠나면 소리를 완전히 멈춘다
let hiddenPause = false;
function suspend(on) { if (!AC) return; hiddenPause = on; if (on) { radioStatic(false); AC.suspend().catch(() => {}); } else AC.resume().catch(() => {}); }
document.addEventListener('visibilitychange', () => suspend(document.hidden));
addEventListener('pagehide', () => suspend(true));
addEventListener('pageshow', () => { if (!document.hidden) suspend(false); });
window.IronSound = { suspend, unlock, SFX, music, tick, setMuted, stopRadio: () => radioStatic(false), get ready() { return rendered; }, get ctx() { return AC; }, _buf: BUF, _dbg: () => ({ q: queue.length, raw: Object.keys(RAW), next: queue[0] && queue[0][0] }),
  level() { if (!meter) return null; const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d); let p = 0, q = 0; for (const v of d) { p = Math.max(p, Math.abs(v)); q += v * v; } return { peak: p, rms: Math.sqrt(q / d.length) }; } };
})();
