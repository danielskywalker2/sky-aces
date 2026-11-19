// OPERATION: IRON SKY — 스토리 시스템
// 게임(game.js)은 정해진 지점에서 window.IronStory 를 호출만 한다. 전투 로직은 이 파일과 무관하다.
//   AssetLoader    : 스토리 이미지 로딩·캐시 (없으면 대체 화면)
//   StoryManager   : 장면(브리핑·아웃트로·엔딩) 진행, 건너뛰기, ON/OFF 설정
//   DialogueSystem : 대사 타이핑·진행
//   StoryRenderer  : 일러스트·패널·초상화·작전 지도·CRT 효과
//   MissionBriefing / MissionResult / Ending : 페이지별 화면
//   Radio / BossIntro : 전투 중 무전, 보스 경고 연출
(() => {
'use strict';
const W = 480, H = 640, IH = 270, TOTAL = 5;
const DATA = window.IRON_STORY;
const ASSETS = window.IRON_ASSETS || { backgrounds: {}, endings: {}, characters: {} };
const FONT = s => `${s}px "Press Start 2P","Courier New",monospace`;
let ctx = null, drawBG = null, SFX = {}, frame = 0;
const play = n => { try { SFX[n] && SFX[n](); } catch (_) {} };

// ───────── AssetLoader
const IMG = {};
function img(key) {
  if (!key) return null;
  const rec = IMG[key];
  if (rec) return rec.ok ? rec.el : null;
  const src = ASSETS.backgrounds[key] || ASSETS.endings[key] || ASSETS.characters[key];
  const r = IMG[key] = { ok: false, el: null };
  if (!src) return null;
  const el = new Image(); r.el = el; el.decoding = 'async';
  el.onload = () => { r.ok = true; }; el.onerror = () => { r.ok = false; };
  el.src = src;
  return null;
}
function preloadStage(i) {
  const s = DATA.stages[i]; if (!s) return;
  img(s.briefingImage); img(s.outroImage);
  for (const L of s.introDialogues.concat(s.outroDialogues, [s.bossIntroduction])) img(DATA.characters[L[0]].portrait);
}

// ───────── 설정 (스토리 ON/OFF)
const KEY = 'ironsky_story';
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== '0'; } catch (_) {}
function setEnabled(v) { enabled = !!v; try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (_) {} }

// ───────── StoryRenderer 기본 도구
function t(s, x, y, size = 10, col = '#fff', align = 'left') {
  ctx.font = FONT(size); ctx.textAlign = align;
  ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = col; ctx.fillText(s, x, y);
}
const wrapCache = new Map();
function wrap(s, size, maxW) {
  const k = size + '|' + maxW + '|' + s; if (wrapCache.has(k)) return wrapCache.get(k);
  ctx.font = FONT(size); const out = []; let cur = '';
  for (const w of s.split(' ')) { const tt = cur ? cur + ' ' + w : w; if (cur && ctx.measureText(tt).width > maxW) { out.push(cur); cur = w; } else cur = tt; }
  if (cur) out.push(cur); wrapCache.set(k, out); return out;
}
let scanPat = null;
function scan(x, y, w, h, a = .22) {
  if (!scanPat) { const c = document.createElement('canvas'); c.width = 2; c.height = 3; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 2, 2, 1); scanPat = ctx.createPattern(c, 'repeat'); }
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = scanPat; ctx.fillRect(x, y, w, h); ctx.restore();
}
function panel(x, y, w, h, edge = '#3fae6a', fill = 'rgba(6,14,12,.9)') {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(63,174,106,.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  ctx.fillStyle = edge; const c = 7;
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) { ctx.fillRect(cx - (dx < 0 ? c : 0), cy - (dy < 0 ? 2 : 0), c, 2); ctx.fillRect(cx - (dx < 0 ? 2 : 0), cy - (dy < 0 ? c : 0), 2, c); }
}
function tri(x, y, s, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - s, y - s * .6); ctx.lineTo(x + s, y - s * .6); ctx.lineTo(x, y + s * .6); ctx.fill(); }
function button(label, x, y, w, h, tt, col = '#ffd75a') {
  const on = (tt >> 4) % 2 === 0;
  ctx.fillStyle = on ? 'rgba(255,215,90,.18)' : 'rgba(255,215,90,.06)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  t(label, x + w / 2, y + h / 2 + 5, 11, on ? '#fff' : col, 'center');
}
function skipBtn() { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(404, 8, 66, 24); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.strokeRect(404.5, 8.5, 65, 23); t('SKIP', 418, 25, 8, '#fff'); tri(456, 20, 4, '#fff'); }
const HINT = ('ontouchstart' in window) ? 'TAP: NEXT    SKIP: TOP RIGHT' : 'Z/SPACE/TAP: NEXT   ESC: SKIP';
const pad2 = n => String(n).padStart(2, '0');

// 일러스트 (천천히 확대·이동하는 패럴랙스). 이미지가 없으면 게임 배경으로 대체.
function illus(key, x, y, w, h, tt, dir, bgIndex) {
  const im = img(key);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#05080a'; ctx.fillRect(x, y, w, h);
  if (im) {
    const p = Math.min(1, tt / 900), z = 1.14 - p * .1, iw = im.naturalWidth, ih = im.naturalHeight;
    let sw = iw / z, sh = sw * h / w; if (sh > ih / z) { sh = ih / z; sw = sh * w / h; }
    const sx = (iw - sw) / 2 + dir * (iw - sw) / 2 * (p * 2 - 1) * .7, sy = (ih - sh) / 2 + (ih - sh) * .2 * (1 - p);
    ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h);
  } else if (drawBG && bgIndex != null) {
    ctx.translate(x, y); drawBG(bgIndex); ctx.translate(-x, -y);
    ctx.fillStyle = 'rgba(0,10,20,.45)'; ctx.fillRect(x, y, w, h);
  }
  const g = ctx.createLinearGradient(0, y + h * .55, 0, y + h); g.addColorStop(0, 'rgba(5,8,10,0)'); g.addColorStop(1, 'rgba(5,8,10,.95)'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  const v = ctx.createLinearGradient(0, y, 0, y + 46); v.addColorStop(0, 'rgba(0,0,0,.6)'); v.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = v; ctx.fillRect(x, y, w, 46);
  scan(x, y, w, h, .2);
  ctx.restore();
}

// 초상화 (이미지가 없으면 픽셀 아바타)
function portrait(who, x, y, s) {
  const ch = DATA.characters[who] || DATA.characters.command, im = img(ch.portrait);
  ctx.fillStyle = '#0b1418'; ctx.fillRect(x, y, s, s);
  if (im) ctx.drawImage(im, x, y, s, s); else pixelAvatar(ch, x, y, s);
  scan(x, y, s, s, .25);
  ctx.strokeStyle = ch.color; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
}
function pixelAvatar(ch, x, y, s) {
  const p = s / 16, R = (a, b, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x + a * p, y + b * p, w * p, h * p); };
  R(0, 0, 16, 16, '#18232c'); R(3, 12, 10, 4, ch.color); R(2, 14, 12, 2, ch.color);
  R(5, 4, 6, 8, '#c99872'); R(4, 3, 8, 3, '#3a2a1e'); R(4, 2, 8, 2, '#4a3524');
  R(6, 7, 1, 1, '#111'); R(9, 7, 1, 1, '#111'); R(6, 10, 4, 1, '#7a4a3a');
  if (ch.name === 'IRON SHADOW') { R(4, 3, 8, 6, '#555c66'); R(9, 6, 2, 2, '#ff3a2a'); }
}

// 작전 지도 + 레이더 스캔 + 목표 지점 깜빡임
function tacMap(x, y, w, h, st, tt, label = 'TGT') {
  panel(x, y, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
  ctx.strokeStyle = 'rgba(80,220,130,.13)'; ctx.lineWidth = 1;
  for (let gx = x; gx < x + w; gx += 12) { ctx.beginPath(); ctx.moveTo(gx + .5, y); ctx.lineTo(gx + .5, y + h); ctx.stroke(); }
  for (let gy = y; gy < y + h; gy += 12) { ctx.beginPath(); ctx.moveTo(x, gy + .5); ctx.lineTo(x + w, gy + .5); ctx.stroke(); }
  // 대륙 윤곽 (스테이지마다 다른 고정 형태)
  let sd = st.stageId * 97; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = 'rgba(80,220,130,.22)';
  for (let i = 0; i < 6; i++) { const cx = x + rr() * w, cy = y + rr() * h, r = 8 + rr() * 22; ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.4, r, rr() * 3, 0, 6.29); ctx.fill(); }
  const cx = x + w / 2, cy = y + h / 2, R = Math.max(w, h), a = tt * .045;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, 'rgba(90,255,150,.35)'); g.addColorStop(1, 'rgba(90,255,150,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - .5, a); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,255,150,.25)'; for (const r of [h * .2, h * .4]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.29); ctx.stroke(); }
  const tx = x + st.map.x * w, ty = y + st.map.y * h;
  if ((tt >> 4) % 2 === 0) { ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 2; ctx.strokeRect(tx - 5, ty - 5, 10, 10); }
  ctx.strokeStyle = 'rgba(255,90,70,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx - 12, ty); ctx.lineTo(tx + 12, ty); ctx.moveTo(tx, ty - 12); ctx.lineTo(tx, ty + 12); ctx.stroke();
  ctx.restore();
  t(label, tx + 9, ty - 7, 7, '#ff8a7a');
}

// ───────── DialogueSystem
function dialogue(lines) { return { lines, i: 0, ch: 0, done: !lines.length }; }
function dlgTick(d) {
  if (d.done) return; const L = d.lines[d.i];
  if (d.ch < L[1].length) { const before = d.ch | 0; d.ch = Math.min(L[1].length, d.ch + 1.6); if ((d.ch | 0) !== before && (d.ch | 0) % 5 === 0) play('tick'); }
}
function dlgTyping(d) { return !d.done && d.ch < d.lines[d.i][1].length; }
function dlgAdvance(d) { // true = 모든 대사 끝
  if (d.done) return true;
  if (dlgTyping(d)) { d.ch = d.lines[d.i][1].length; return false; }
  d.i++; d.ch = 0; if (d.i >= d.lines.length) { d.done = true; d.i = d.lines.length - 1; d.ch = 1e9; return true; }
  play('sel'); return false;
}
function dlgBox(d, x, y, w, h, tt) {
  panel(x, y, w, h);
  if (!d.lines.length) return;
  const L = d.lines[d.i], ch = DATA.characters[L[0]];
  const ps = h - 24, pIn = Math.min(1, tt / 10);
  ctx.globalAlpha = pIn; portrait(L[0], x + 12 - (1 - pIn) * 20, y + 12, ps); ctx.globalAlpha = 1;
  const tx = x + ps + 26;
  t(ch.name, tx, y + 24, 10, ch.color); t(ch.full, x + w - 12, y + 24, 6, '#6f8494', 'right');
  let left = Math.floor(d.ch);
  wrap(L[1], 10, w - ps - 40).forEach((ln, k) => { if (left > 0) t(ln.slice(0, left), tx, y + 50 + k * 17, 10, '#e6efe9'); left -= ln.length + 1; });
  t(`${d.i + 1}/${d.lines.length}`, x + w - 12, y + h - 9, 7, '#55705f', 'right');
  if (!dlgTyping(d) && !d.done && (tt >> 4) % 2 === 0) tri(x + w - 56, y + h - 13, 5, '#9fe8a8');
}

// ───────── StoryManager
let S = null;
const stageOf = i => DATA.stages[Math.max(0, Math.min(DATA.stages.length - 1, i))];
function begin(mode, info) {
  // mode: 'briefing' | 'outro' | 'final'(마지막 스테이지 클리어 → 엔딩)
  const st = stageOf(info.stage), pages = [];
  if (mode === 'briefing') pages.push({ type: 'briefing', dlg: dialogue(st.introDialogues) });
  else {
    pages.push({ type: 'clear' });
    if (enabled) pages.push({ type: 'outro', dlg: dialogue(st.outroDialogues) });
    if (mode === 'outro') pages.push({ type: 'result' });
    else {
      const E = DATA.ending;
      if (enabled) pages.push({ type: 'return', dlg: dialogue(E.epilogue) });
      pages.push({ type: 'lines', ch: 0 });
      if (enabled) pages.push({ type: 'tease', dlg: dialogue([E.tease]) });
      pages.push({ type: 'final', menu: 0 });
    }
  }
  pages.forEach(p => { p.t = 0; });
  S = { mode, info, st, pages, pi: 0, fade: 0 };
  preloadStage(info.stage); preloadStage(info.stage + 1);
  if (mode === 'final') { img(DATA.ending.returnImage); img('enemy'); }
  clearRadio();
}
function goPage(i) { S.pi = Math.max(0, Math.min(S.pages.length - 1, i)); S.pages[S.pi].t = 0; S.fade = 10; }
function nextPage() { if (S.pi + 1 >= S.pages.length) return finish(); goPage(S.pi + 1); return null; }
function finish(extra) { const r = Object.assign({ mode: S.mode }, extra); S = null; return r; }
function skip() {
  play('cancel');
  if (S.mode === 'briefing') return finish();
  const idx = type => S.pages.findIndex(p => p.type === type);
  if (S.mode === 'outro') { goPage(idx('result')); return null; }
  // 엔딩: 아웃트로를 건너뛰면 엔딩 시작으로, 엔딩 중에 건너뛰면 마지막 화면으로 (엔딩은 따로 선택해서 넘김)
  const endStart = S.pages.findIndex(p => p.type === 'return' || p.type === 'lines');
  goPage(S.pi < endStart ? endStart : idx('final')); return null;
}
function update(inp) {
  if (!S) return null;
  frame++; const pg = S.pages[S.pi]; pg.t++; if (S.fade > 0) S.fade--;
  let adv = inp.adv, sk = inp.skip;
  if (inp.tap) { if (inp.ty < 40 && inp.tx > 396 && pg.type !== 'final') { sk = true; adv = false; } }
  if (pg.t < 12) adv = sk = false; // 앞 화면에서 누른 키가 그대로 넘어가지 않게
  if (sk) return skip();
  if (pg.dlg) dlgTick(pg.dlg);
  switch (pg.type) {
    case 'briefing':
      if (adv) { if (pg.dlg.done) { play('start'); return finish(); } dlgAdvance(pg.dlg); }
      break;
    case 'clear':
      if (pg.t > 150 || (adv && pg.t > 40)) return nextPage();
      break;
    case 'outro': case 'return': case 'tease':
      if (adv && dlgAdvance(pg.dlg) && pg.done) return nextPage();
      if (pg.dlg.done) { if (!pg.done) pg.done = pg.t; }
      break;
    case 'result':
      if (adv) { play('ok'); return nextPage(); }
      break;
    case 'lines':
      pg.ch = Math.min(999, pg.ch + .5);
      if (adv) { const all = DATA.ending.lines.join('').length; if (pg.ch < all + 10) pg.ch = all + 10; else return nextPage(); }
      break;
    case 'final': {
      if (inp.up || inp.down) { pg.menu ^= 1; play('sel'); }
      if (inp.tap) { const m = inp.ty > 470 && inp.ty < 512 ? 0 : inp.ty >= 512 && inp.ty < 556 ? 1 : -1; if (m >= 0) { pg.menu = m; adv = true; } else adv = false; }
      if (adv) { play('ok'); return finish({ choice: pg.menu === 0 ? 'loop' : 'title' }); }
      break;
    }
  }
  return null;
}

// ───────── 화면별 렌더 (MissionBriefing / MissionResult / Ending)
function header(st, label) {
  t(`MISSION ${pad2(st.stageId)} / ${pad2(TOTAL)}`, 14, 25, 9, '#9fe8a8');
  if (label) t(label, 14, 40, 6, '#ff8a7a');
}
function renderBriefing(pg, st, info) {
  illus(st.briefingImage, 0, 0, W, IH, pg.t, 1, info.bg);
  header(st, 'CLASSIFIED // EYES ONLY'); skipBtn();
  t('OPERATION', 16, 290, 8, '#7fd49a');
  t(st.missionTitle, 16, 316, 20, '#ffd75a');
  t('AREA: ' + st.location, 16, 336, 8, '#9fb4c8');
  tacMap(16, 350, 150, 100, st, pg.t);
  t('OBJECTIVE', 182, 364, 8, '#7fd49a');
  wrap(st.missionObjective, 9, 280).forEach((ln, k) => t(ln, 182, 384 + k * 15, 9, '#e6efe9'));
  wrap(st.briefingText, 6, 280).slice(0, 2).forEach((ln, k) => t(ln, 182, 436 + k * 11, 6, '#8fa3b0'));
  dlgBox(pg.dlg, 12, 462, 456, 124, pg.t);
  if (pg.dlg.done) button('START MISSION', 140, 596, 200, 34, pg.t);
  else t(HINT, W / 2, 616, 7, '#55705f', 'center');
}
function renderClear(pg, st, info) {
  illus(st.outroImage, 0, 0, W, IH, pg.t + 400, -1, info.bg);
  header(st);
  const k = Math.min(1, pg.t / 14), sc = 1 + (1 - k) * 1.6;
  if (pg.t < 8) { ctx.fillStyle = `rgba(255,255,255,${.6 - pg.t * .07})`; ctx.fillRect(0, 0, W, H); }
  ctx.save(); ctx.translate(W / 2, 360); ctx.scale(sc, sc); ctx.globalAlpha = k;
  t('MISSION CLEAR', 0, 0, 26, '#ffd75a', 'center'); ctx.restore(); ctx.globalAlpha = 1;
  if (pg.t > 24) { t(`OPERATION ${st.missionTitle}`, W / 2, 402, 10, '#e6efe9', 'center'); t('STATUS: SUCCESS', W / 2, 426, 8, '#7fd49a', 'center'); }
}
function renderOutro(pg, st, info) {
  illus(st.outroImage, 0, 0, W, IH, pg.t + 400, -1, info.bg);
  header(st, 'DEBRIEFING'); skipBtn();
  t(st.missionTitle, 16, 300, 16, '#ffd75a'); t('MISSION COMPLETE', 16, 322, 8, '#7fd49a');
  t('AREA: ' + st.location, 16, 340, 7, '#9fb4c8');
  // 전투 기록 로그 (레이더)
  tacMap(16, 352, 448, 96, st, pg.t, 'CLEAR');
  dlgBox(pg.dlg, 12, 462, 456, 124, pg.t);
  if (pg.dlg.done) button('CONTINUE', 160, 596, 160, 34, pg.t);
  else t(HINT, W / 2, 616, 7, '#55705f', 'center');
}
function renderResult(pg, st, info) {
  illus(st.outroImage, 0, 0, W, IH, pg.t + 800, -1, info.bg);
  ctx.fillStyle = 'rgba(5,8,10,.55)'; ctx.fillRect(0, 0, W, IH);
  header(st);
  t('MISSION RESULT', W / 2, 150, 16, '#ffd75a', 'center'); t(st.missionTitle, W / 2, 176, 10, '#e6efe9', 'center');
  panel(40, 252, 400, 128);
  const rows = [['SCORE', info.score], ['CLEAR BONUS', info.bonus], ['PLANES LEFT', info.lives], ['BOMBS LEFT', info.bombs]];
  rows.forEach(([k, v], i) => { if (pg.t > 8 + i * 8) { t(k, 64, 284 + i * 24, 9, '#9fb4c8'); t(String(v), 416, 284 + i * 24, 9, '#fff', 'right'); } });
  const nx = DATA.stages[st.stageId];
  if (nx && pg.t > 44) {
    t('NEXT MISSION', 40, 412, 8, '#ff8a7a');
    t(`${pad2(nx.stageId)}  ${nx.missionTitle}`, 40, 434, 13, '#ffd75a');
    t(nx.location, 40, 452, 7, '#9fb4c8');
    wrap(st.nextMission || '', 8, 250).forEach((ln, k) => t(ln, 40, 476 + k * 14, 8, '#e6efe9'));
    tacMap(300, 400, 140, 92, nx, pg.t);
  }
  if (pg.t > 30) button('CONTINUE', 160, 560, 160, 36, pg.t);
}
function renderReturn(pg, st, info) {
  illus(DATA.ending.returnImage, 0, 0, W, IH, pg.t, 1, info.bg);
  t('OPERATION COMPLETE', 14, 25, 9, '#9fe8a8'); skipBtn();
  t('IRON EMPEROR', 16, 300, 16, '#ffd75a'); t('TARGET DESTROYED', 16, 322, 8, '#7fd49a');
  t('FALCON 1: RETURNING TO BASE', 16, 344, 7, '#9fb4c8');
  tacMap(16, 356, 448, 92, { stageId: 9, map: { x: .2, y: .62 } }, pg.t, 'HOME BASE');
  dlgBox(pg.dlg, 12, 462, 456, 124, pg.t);
  if (pg.dlg.done) button('CONTINUE', 160, 596, 160, 34, pg.t);
}
function renderLines(pg, st, info) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const a = Math.min(1, pg.t / 60);
  ctx.globalAlpha = a; illus(DATA.ending.returnImage, 0, 110, W, IH, pg.t + 300, 1, info.bg); ctx.globalAlpha = 1;
  let left = Math.floor(pg.ch);
  DATA.ending.lines.forEach((ln, k) => { if (left > 0) t(ln.slice(0, left), W / 2, 450 + k * 34, k ? 10 : 12, k ? '#c9d6e0' : '#ffd75a', 'center'); left -= ln.length + 8; });
  if (pg.ch > DATA.ending.lines.join('').length + 10 && (pg.t >> 4) % 2 === 0) tri(W / 2, 560, 6, '#9fe8a8');
  if (S.pages.some(p => p.type === 'final')) skipBtn();
}
function renderTease(pg, st, info) {
  ctx.fillStyle = '#050000'; ctx.fillRect(0, 0, W, H);
  const pulse = .5 + .5 * Math.sin(pg.t * .08), im = img('enemy');
  ctx.globalAlpha = Math.min(1, pg.t / 50) * (.55 + .25 * pulse);
  if (im) ctx.drawImage(im, W / 2 - 110, 70, 220, 220); else pixelAvatar(DATA.characters.enemy, W / 2 - 110, 70, 220);
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(255,30,20,${.08 + .05 * pulse})`; ctx.fillRect(0, 0, W, H); scan(0, 0, W, H, .35);
  if ((pg.t >> 5) % 2 === 0) t('IRON SHADOW SIGNAL DETECTED', W / 2, 330, 10, '#ff4a4a', 'center');
  t('LOCATION: UNKNOWN', W / 2, 352, 7, '#a05050', 'center');
  dlgBox(pg.dlg, 12, 462, 456, 124, pg.t);
  skipBtn();
}
function renderFinal(pg, st, info) {
  ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = .35; illus(DATA.ending.returnImage, 0, 0, W, H * .55, pg.t + 900, 1, info.bg); ctx.globalAlpha = 1;
  const a = Math.min(1, pg.t / 30); ctx.globalAlpha = a;
  t('THE END', W / 2, 200, 30, '#ffd75a', 'center');
  t(DATA.title, W / 2, 236, 10, '#e6efe9', 'center');
  t('FINAL SCORE', W / 2, 330, 9, '#9fb4c8', 'center'); t(String(info.score), W / 2, 360, 18, '#fff', 'center');
  t('THANK YOU FOR PLAYING', W / 2, 412, 8, '#7fd49a', 'center');
  const items = [`CONTINUE  (LOOP ${info.loop + 2})`, 'RETURN TO TITLE'];
  items.forEach((s, i) => { const y = 494 + i * 42, on = pg.menu === i; if (on) { ctx.fillStyle = 'rgba(255,215,90,.15)'; ctx.fillRect(90, y - 22, 300, 32); tri(110, y - 6, 5, '#ffd75a'); } t(s, W / 2 + 8, y, 10, on ? '#ffd75a' : '#9fb4c8', 'center'); });
  ctx.globalAlpha = 1;
}
const RENDER = { briefing: renderBriefing, clear: renderClear, outro: renderOutro, result: renderResult, return: renderReturn, lines: renderLines, tease: renderTease, final: renderFinal };
function render() {
  if (!S) return;
  const pg = S.pages[S.pi];
  ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, W, H);
  RENDER[pg.type](pg, S.st, S.info);
  // 화면 전환: 빠른 페이드
  const f = Math.max(S.fade / 10, pg.t < 10 ? 1 - pg.t / 10 : 0);
  if (f > 0) { ctx.fillStyle = `rgba(0,0,0,${f})`; ctx.fillRect(0, 0, W, H); }
}

// ───────── Radio (전투 중 무전) — 게임 화면 상단, 조작을 막지 않음
let radioQ = [], radioCur = null;
function radio(who, text) { if (!enabled) return; if (radioQ.length < 3) radioQ.push({ who, text }); }
function radioEvent(name) { const a = DATA.events[name]; if (a && !radioCur) { const L = a[Math.random() * a.length | 0]; radio(L[0], L[1]); } }
function clearRadio() { radioQ = []; radioCur = null; }
function tickPlay(stageIdx, st) {
  if (!enabled) return;
  const s = stageOf(stageIdx);
  for (const m of s.inGameMessages) if (m[0] === st) radio(m[1], m[2]);
  if (!radioCur && radioQ.length) { radioCur = Object.assign(radioQ.shift(), { t: 0 }); radioCur.end = radioCur.text.length / 1.6 + 170; play('sel'); }
  if (radioCur && ++radioCur.t > radioCur.end) radioCur = null;
}
function drawRadio() {
  const r = radioCur; if (!r) return;
  const a = Math.min(1, r.t / 8, (r.end - r.t) / 14), ch = DATA.characters[r.who];
  ctx.globalAlpha = a * .92; ctx.fillStyle = 'rgba(4,12,10,.82)'; ctx.fillRect(8, 40, 464, 50);
  ctx.strokeStyle = ch.color; ctx.lineWidth = 1; ctx.strokeRect(8.5, 40.5, 463, 49);
  ctx.globalAlpha = a; portrait(r.who, 13, 45, 40);
  t(ch.name, 62, 55, 8, ch.color); if ((r.t >> 3) % 2 === 0) t('● RADIO', 464, 55, 6, '#ff6a5a', 'right');
  let left = Math.floor(r.t * 1.6);
  wrap(r.text, 9, 400).slice(0, 2).forEach((ln, k) => { if (left > 0) t(ln.slice(0, left), 62, 71 + k * 13, 9, '#e6efe9'); left -= ln.length + 1; });
  ctx.globalAlpha = 1;
}

// ───────── BossIntro (기존 WARNING 단계 위에 덮어 그리는 경고 연출)
function drawBossIntro(stageIdx, pt) {
  const s = stageOf(stageIdx), a = Math.max(0, Math.min(1, pt / 10, (210 - pt) / 16));
  ctx.save(); ctx.globalAlpha = a;
  for (const by of [182, 446]) {
    ctx.fillStyle = '#16120a'; ctx.fillRect(0, by, W, 20);
    ctx.save(); ctx.beginPath(); ctx.rect(0, by, W, 20); ctx.clip(); ctx.fillStyle = '#e8b81a';
    for (let x = -40 + (pt * 2 * (by > 300 ? -1 : 1)) % 40; x < W + 40; x += 40) { ctx.beginPath(); ctx.moveTo(x, by + 20); ctx.lineTo(x + 20, by); ctx.lineTo(x + 34, by); ctx.lineTo(x + 14, by + 20); ctx.fill(); }
    ctx.restore();
  }
  const k = Math.min(1, pt / 14); ctx.translate(W / 2, 314); ctx.scale(1, k); ctx.translate(-W / 2, -314);
  panel(40, 216, 400, 214, '#ff4a3a', 'rgba(20,4,4,.82)');
  if (pt % 30 < 20) t('WARNING', W / 2, 262, 30, '#ff3a3a', 'center');
  t('HOSTILE BOSS DETECTED', W / 2, 292, 10, '#fff', 'center');
  t(s.bossName, W / 2, 330, s.bossName.length > 20 ? 11 : 13, '#ffd75a', 'center');
  t('THREAT LEVEL', 150, 370, 8, '#ff8a7a');
  for (let i = 0; i < 5; i++) { const on = i < s.bossThreat && (i < s.bossThreat - 1 || pt % 20 < 14); ctx.fillStyle = on ? '#ff3a2a' : 'rgba(255,80,60,.2)'; ctx.fillRect(268 + i * 14, 360, 10, 12); }
  // 레이더: 보스 위치(화면 위쪽)를 표시
  const rx = W / 2, ry = 404, R = 18, ang = pt * .12;
  ctx.strokeStyle = 'rgba(255,90,70,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(rx, ry, R, 0, 6.29); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(ang) * R, ry + Math.sin(ang) * R); ctx.stroke();
  if (pt % 20 < 12) { ctx.fillStyle = '#ff3a2a'; ctx.fillRect(rx - 2, ry - R + 4, 4, 4); }
  scan(40, 216, 400, 214, .3);
  ctx.restore();
}

window.IronStory = {
  init(o) { ctx = o.ctx; drawBG = o.drawBG; SFX = o.SFX || {}; preloadStage(0); },
  get enabled() { return enabled; }, setEnabled, toggle() { setEnabled(!enabled); return enabled; },
  get active() { return !!S; },
  begin, update, render,
  radio, radioEvent, clearRadio, tickPlay, drawRadio,
  drawBossIntro,
  bossIntroRadio(i) { const L = stageOf(i).bossIntroduction; if (L) { clearRadio(); radio(L[0], L[1]); } },
  missionTitle(i) { return stageOf(i).missionTitle; },
  title: DATA.title,
};
})();
