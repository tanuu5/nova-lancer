// HUD (DOM + 2D canvas overlay), radio comms, banners, menus and touch controls.
import * as THREE from 'three';
import { G, clamp, lerp, DIFF, saveSettings, TAU } from './core.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { portraitSVG, CHARACTERS } from './portraits.js';
import { WSTATE } from './weapons.js';

const $ = (id) => document.getElementById(id);
const EL = {};
let ctx, cw = 1, ch = 1, dpr = 1;

// ============================================================ Init
export function initHUD() {
  for (const id of ['hud', 'hudc', 'g-shield', 'g-boost', 'gold', 'lives', 'hits', 'score', 'bombs', 'laserlv', 'boss', 'bossfill', 'bossghost', 'tip', 'radio', 'rface', 'rname', 'rtext',
    'banner', 'warning', 'title', 'press', 'mainmenu', 'diffval', 'best', 'controls', 'settings', 'pause', 'gameover', 'results', 'loading', 'loadfill', 'loadmsg',
    'resgrid', 'restotal', 'rank', 'rankmeta', 'medal', 'touch', 'tstick', 'tknob', 'tpause', 'go-sub']) EL[id] = $(id);
  EL.shieldFill = EL['g-shield'].querySelector('.g-fill');
  EL.shieldGhost = EL['g-shield'].querySelector('.g-ghost');
  EL.shieldBar = EL['g-shield'].querySelector('.g-bar');
  EL.boostFill = EL['g-boost'].querySelector('.g-fill');
  ctx = EL.hudc.getContext('2d');
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  initMenus();
  initTouch();
}

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cw = window.innerWidth; ch = window.innerHeight;
  EL.hudc.width = Math.round(cw * dpr); EL.hudc.height = Math.round(ch * dpr);
}

export function setLoading(frac, msg) {
  EL.loadfill.style.width = `${Math.round(frac * 100)}%`;
  if (msg) EL.loadmsg.textContent = msg;
}

// ============================================================ Screens
const SCREENS = ['title', 'controls', 'settings', 'pause', 'gameover', 'results', 'loading'];
export function showScreen(name) {
  for (const s of SCREENS) EL[s].classList.toggle('on', s === name);
  const menu = MENUS[name];
  if (menu) menu.focus(0);
  activeMenu = menu || null;
}
export function hideScreens() { for (const s of SCREENS) EL[s].classList.remove('on'); activeMenu = null; }
export function hudVisible(on) { EL.hud.classList.toggle('on', on); if (!on) { ctx.clearRect(0, 0, EL.hudc.width, EL.hudc.height); } EL.touch.classList.toggle('on', on && Input.touchEnabled); }

// ============================================================ Menus
class Menu {
  constructor(el, handler) {
    this.el = el; this.handler = handler; this.i = 0;
    this.items = [...el.querySelectorAll('.mi')];
    this.items.forEach((it, i) => {
      it.addEventListener('mouseenter', () => this.focus(i, true));
      it.addEventListener('click', (e) => {
        if (it.tagName === 'LABEL') return;
        e.preventDefault(); this.focus(i); AudioSys.init(); this.activate();
      });
      const input = it.querySelector('input');
      if (input) input.addEventListener('input', () => { this.focus(i); this.handler(it.dataset.act, 0, input); });
    });
  }
  visibleItems() { return this.items.filter(it => !it.hidden && it.offsetParent !== null); }
  focus(i, silent) {
    const vis = this.visibleItems();
    if (!vis.length) return;
    this.i = ((i % vis.length) + vis.length) % vis.length;
    this.items.forEach(it => it.classList.remove('sel'));
    vis[this.i].classList.add('sel');
    if (!silent) {}
  }
  move(d) { this.focus(this.i + d); AudioSys.sfx('uiMove'); }
  activate(dir = 0) {
    const it = this.visibleItems()[this.i];
    if (!it) return;
    const input = it.querySelector('input');
    if (input && dir) { input.value = clamp(+input.value + dir * 5, 0, 100); this.handler(it.dataset.act, dir, input); AudioSys.sfx('uiMove'); return; }
    if (input) return;
    this.handler(it.dataset.act, dir, null);
  }
  update() {
    if (Input.menu('mUp')) this.move(-1);
    if (Input.menu('mDown')) this.move(1);
    if (Input.menu('mLeft')) this.activate(-1);
    if (Input.menu('mRight')) this.activate(1);
    if (Input.pressed('confirm')) { AudioSys.init(); this.activate(0); }
  }
}

const MENUS = {};
let activeMenu = null;
export const MENU_CB = {};  // set by main: start, resume, retry, quit, continue, again, back
const menuStack = [];

function initMenus() {
  MENUS.title = new Menu(EL.mainmenu, (act, dir) => {
    if (act === 'start') { AudioSys.sfx('uiSelect'); MENU_CB.start?.(); }
    else if (act === 'diff') {
      const keys = Object.keys(DIFF);
      const i = keys.indexOf(G.settings.difficulty);
      G.settings.difficulty = keys[(i + (dir || 1) + keys.length) % keys.length];
      saveSettings(); refreshTitle(); AudioSys.sfx('uiMove');
    } else if (act === 'controls') { openSub('controls', 'title'); }
    else if (act === 'settings') { openSub('settings', 'title'); }
  });
  MENUS.controls = new Menu(EL.controls, (act) => { if (act === 'back') closeSub(); });
  MENUS.settings = new Menu(EL.settings, (act, dir, input) => {
    const S = G.settings;
    if (act.startsWith('vol-')) {
      const k = act.slice(4);
      S[k] = (+input.value) / 100;
      AudioSys.setVolume(k, S[k]);
      saveSettings();
      if (k !== 'music') AudioSys.sfx('uiMove');
    } else if (act === 'invert') { S.invertY = !S.invertY; saveSettings(); refreshSettings(); AudioSys.sfx('uiSelect'); }
    else if (act === 'shake') { S.shake = !S.shake; saveSettings(); refreshSettings(); AudioSys.sfx('uiSelect'); }
    else if (act === 'quality') {
      const order = ['auto', 'low', 'medium', 'high'];
      S.quality = order[(order.indexOf(S.quality) + (dir || 1) + order.length) % order.length];
      saveSettings(); refreshSettings(); MENU_CB.quality?.(S.quality); AudioSys.sfx('uiSelect');
    } else if (act === 'back') closeSub();
  });
  MENUS.pause = new Menu(EL.pause, (act) => {
    AudioSys.sfx('uiSelect');
    if (act === 'resume') MENU_CB.resume?.();
    else if (act === 'retry') MENU_CB.retry?.();
    else if (act === 'controls') openSub('controls', 'pause');
    else if (act === 'settings') openSub('settings', 'pause');
    else if (act === 'quit') MENU_CB.quit?.();
  });
  MENUS.gameover = new Menu(EL.gameover, (act) => {
    AudioSys.sfx('uiSelect');
    if (act === 'continue') MENU_CB.continue?.();
    else if (act === 'quit') MENU_CB.quit?.();
  });
  MENUS.results = new Menu(EL.results, (act) => {
    AudioSys.sfx('uiSelect');
    if (act === 'again') MENU_CB.again?.();
    else if (act === 'quit') MENU_CB.quit?.();
  });
  refreshTitle();
  refreshSettings();
}

function openSub(name, from) {
  AudioSys.sfx('uiSelect');
  menuStack.push(from);
  showScreen(name);
  if (name === 'settings') refreshSettings();
}
function closeSub() {
  AudioSys.sfx('uiBack');
  const from = menuStack.pop() || 'title';
  showScreen(from);
  if (from === 'title') EL.mainmenu.hidden = false;
}
export function menuBack() {
  // Escape / back button inside menus
  const onSub = EL.controls.classList.contains('on') || EL.settings.classList.contains('on');
  if (onSub) { closeSub(); return true; }
  return false;
}

export function refreshTitle(best) {
  EL.diffval.textContent = DIFF[G.settings.difficulty]?.label || 'NORMAL';
  if (best) EL.best.innerHTML = `BEST <b>${best.score.toLocaleString()}</b>　HITS <b>${best.hits}</b>　RANK <b>${best.rank}</b>`;
}
function refreshSettings() {
  const S = G.settings;
  $('s-master').value = Math.round(S.master * 100);
  $('s-music').value = Math.round(S.music * 100);
  $('s-sfx').value = Math.round(S.sfx * 100);
  $('s-invert').textContent = S.invertY ? 'ON' : 'OFF';
  $('s-shake').textContent = S.shake ? 'ON' : 'OFF';
  $('s-quality').textContent = S.quality.toUpperCase();
}

export function titlePressed() {
  EL.press.hidden = true;
  EL.mainmenu.hidden = false;
  MENUS.title.focus(0);
  activeMenu = MENUS.title;
}
export function titleReset() { EL.press.hidden = false; EL.mainmenu.hidden = true; activeMenu = null; }
export function updateMenus() { if (activeMenu) activeMenu.update(); }
export function menuActive() { return !!activeMenu; }

// ============================================================ Touch controls
function initTouch() {
  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  Input.touchEnabled = isTouch;
  if (isTouch) { document.body.classList.add('touch'); EL.press.textContent = 'TAP TO START'; }
  let sid = null, ox = 0, oy = 0;
  EL.tstick.addEventListener('pointerdown', (e) => {
    sid = e.pointerId; ox = e.clientX; oy = e.clientY;
    EL.tknob.style.display = 'block'; EL.tknob.style.left = ox + 'px'; EL.tknob.style.top = (oy - EL.tstick.getBoundingClientRect().top) + 'px';
    EL.tstick.setPointerCapture(sid); AudioSys.init();
  });
  EL.tstick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    let dx = (e.clientX - ox) / 55, dy = (e.clientY - oy) / 55;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    Input.setTouchStick(dx, -dy);
    EL.tknob.firstElementChild.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
  });
  const end = (e) => { if (e.pointerId !== sid) return; sid = null; Input.setTouchStick(0, 0); EL.tknob.style.display = 'none'; EL.tknob.firstElementChild.style.transform = ''; };
  EL.tstick.addEventListener('pointerup', end);
  EL.tstick.addEventListener('pointercancel', end);
  for (const b of EL.touch.querySelectorAll('.t-btn')) {
    const code = b.dataset.code;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('pressed'); Input.touchButton(code, true); AudioSys.init(); });
    const up = () => { b.classList.remove('pressed'); Input.touchButton(code, false); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  }
  EL.tpause.addEventListener('click', () => { MENU_CB.pause?.(); });
}

// ============================================================ Radio comms
const radioQ = [];
let rcur = null;
export function radio(who, text, opts = {}) {
  const msg = { who, text, hold: opts.hold ?? 1.8, prio: opts.prio ?? 0, at: G.time };
  if (msg.prio >= 2) { radioQ.length = 0; if (rcur) rcur.t = 1e9; }
  if (msg.prio >= 1) radioQ.unshift(msg); else radioQ.push(msg);
}
export function clearRadio() { radioQ.length = 0; rcur = null; EL.radio.classList.remove('on'); }

function startRadio(m) {
  const C = CHARACTERS[m.who] || { name: m.who.toUpperCase(), role: '', color: '#fff' };
  EL.rface.innerHTML = portraitSVG(m.who);
  EL.rface.classList.add('static');
  EL.rname.innerHTML = `<span style="color:${C.color}">${C.nameJa || C.name}</span><small>${C.name} · ${C.role}</small>`;
  EL.rtext.textContent = '';
  EL.rtext.classList.toggle('enemy', m.who === 'mizuchi');
  EL.radio.classList.add('on');
  m.svg = EL.rface.querySelector('svg');
  m.chars = [...m.text];
  m.shown = 0; m.t = 0; m.typeT = 0; m.mouthT = 0; m.blinkT = 1 + Math.random() * 2; m.state = 'open';
  AudioSys.sfx('radio', { vol: 0.6 });
  rcur = m;
}

function updateRadio(dt) {
  if (!rcur) {
    // drop low-priority chatter that has gone stale while waiting in the queue
    while (radioQ.length && radioQ[0].prio === 0 && G.time - radioQ[0].at > 8) radioQ.shift();
    if (radioQ.length) startRadio(radioQ.shift());
    return;
  }
  const m = rcur;
  m.t += dt;
  if (m.t > 0.18) EL.rface.classList.remove('static');
  if (m.t < 0.22) return;
  if (m.shown < m.chars.length) {
    m.typeT += dt * 30;
    while (m.typeT >= 1 && m.shown < m.chars.length) {
      m.typeT -= 1;
      const ch = m.chars[m.shown++];
      EL.rtext.textContent += ch;
      if (m.shown % 2 === 0) AudioSys.voiceBlip(m.who, ch);
    }
    m.mouthT += dt;
    if (m.svg) m.svg.classList.toggle('open', Math.floor(m.mouthT * 10) % 2 === 0);
    m.doneT = 0;
  } else {
    if (m.svg) m.svg.classList.remove('open');
    m.doneT += dt;
    if (m.doneT > m.hold + m.chars.length * 0.02) {
      EL.radio.classList.remove('on');
      rcur = null;
      m.gap = true;
    }
  }
  m.blinkT -= dt;
  if (m.svg) {
    if (m.blinkT < 0) { m.svg.classList.add('blink'); if (m.blinkT < -0.12) { m.svg.classList.remove('blink'); m.blinkT = 1.5 + Math.random() * 2.5; } }
  }
}
export function radioBusy() { return !!rcur || radioQ.length > 0; }

// ============================================================ Tips / banners / warning / boss bar
let tipT = 0;
// `touchHtml` replaces keyboard hints on touch devices (keyboard-only hints are skipped there).
export function tip(html, dur = 5, touchHtml) {
  if (Input.touchEnabled) { if (touchHtml === undefined && html.includes('<kbd>')) return; if (touchHtml) html = touchHtml; }
  EL.tip.innerHTML = html; EL.tip.classList.add('on'); tipT = dur;
}
let bannerT = 0;
export function banner(small, big, sub = '', dur = 3.2, cls = '') {
  const b = EL.banner;
  b.className = cls;
  b.querySelector('.b-small').textContent = small;
  b.querySelector('.b-big').textContent = big;
  b.querySelector('.b-sub').textContent = sub;
  b.querySelector('.b-line').style.display = sub ? 'block' : 'none';
  void b.offsetWidth;
  b.classList.add('on');
  bannerT = dur;
}
export function hideBanner() { EL.banner.classList.remove('on'); bannerT = 0; }
export function warning(on) { EL.warning.classList.toggle('on', on); }
let bossOn = false, bossFrac = 1;
export function bossBar(on) { bossOn = on; EL.boss.classList.toggle('on', on); }
export function setBossHP(f) {
  if (Math.abs(f - bossFrac) > 0.0005) {
    bossFrac = f;
    EL.bossfill.style.transform = `scaleX(${clamp(f, 0, 1)})`;
    EL.bossghost.style.transform = `scaleX(${clamp(f, 0, 1)})`;
  }
}

// ============================================================ Floating texts
const floats = [];
export function popText(pos, text, color = '#b4ff6a', size = 18) { floats.push({ pos: pos.clone(), text, color, size, t: 0 }); }

// ============================================================ Per-frame HUD
let lastHits = -1, lastScore = -1, lastBombs = -1, lastLives = -1, lastGold = -1, lastLaser = -1, lastShield = -1, lastMax = -1;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function project(p, out) {
  _v.copy(p).project(G.camera);
  out.x = (_v.x * 0.5 + 0.5) * cw; out.y = (-_v.y * 0.5 + 0.5) * ch; out.z = _v.z;
  return out;
}

export function updateHUD(dt, rdt) {
  const run = G.run;
  updateRadio(dt);
  if (tipT > 0) { tipT -= rdt; if (tipT <= 0) EL.tip.classList.remove('on'); }
  if (bannerT > 0) { bannerT -= rdt; if (bannerT <= 0) EL.banner.classList.remove('on'); }
  if (!run || !EL.hud.classList.contains('on')) return;
  // gauges
  const sh = Math.round(run.shield * 10) / 10;
  if (sh !== lastShield || run.maxShield !== lastMax) {
    const wBase = run.maxShield / 100;
    EL.shieldBar.style.width = `calc(clamp(150px, 22vw, 260px) * ${wBase})`;
    const f = run.shield / run.maxShield;
    EL.shieldFill.style.width = `calc(${f * 100}% - 4px)`;
    if (sh > lastShield) EL.shieldGhost.style.width = `calc(${f * 100}% - 4px)`;
    else setTimeout(() => { EL.shieldGhost.style.width = `calc(${f * 100}% - 4px)`; }, 30);
    EL['g-shield'].classList.toggle('low', f < 0.3);
    lastShield = sh; lastMax = run.maxShield;
  }
  const P = G.player;
  EL.boostFill.style.width = `calc(${(1 - P.heat) * 100}% - 4px)`;
  EL['g-boost'].classList.toggle('hot', P.overheat);
  if (run.hits !== lastHits) { EL.hits.textContent = run.hits; if (lastHits >= 0 && run.hits > lastHits) { EL.hits.classList.remove('pop'); void EL.hits.offsetWidth; EL.hits.classList.add('pop'); } lastHits = run.hits; }
  if (run.score !== lastScore) { EL.score.textContent = run.score.toLocaleString(); lastScore = run.score; }
  if (run.bombs !== lastBombs) { EL.bombs.innerHTML = '<i></i>'.repeat(Math.min(run.bombs, 9)); lastBombs = run.bombs; }
  if (run.lives !== lastLives) {
    EL.lives.innerHTML = `<svg viewBox="0 0 22 14" aria-hidden="true"><path d="M11 0 L14 7 L22 10 L14 11 L11 14 L8 11 L0 10 L8 7Z" fill="#7fe7ff"/></svg>× ${run.lives}`;
    lastLives = run.lives;
  }
  if (run.goldRings !== lastGold) { [...EL.gold.children].forEach((i, k) => i.classList.toggle('on', k < run.goldRings)); lastGold = run.goldRings; }
  if (run.laser !== lastLaser) {
    EL.laserlv.textContent = ['LASER · SINGLE', 'LASER · TWIN', 'LASER · HYPER'][run.laser];
    EL.laserlv.classList.toggle('hyper', run.laser === 2);
    lastLaser = run.laser;
  }
  drawCanvas(dt, rdt);
}

export function resetHUDCache() { lastHits = lastScore = lastBombs = lastLives = lastGold = lastLaser = lastShield = lastMax = -1; }

const pA = { x: 0, y: 0, z: 0 }, pB = { x: 0, y: 0, z: 0 }, pL = { x: 0, y: 0, z: 0 };
function drawCanvas(dt, rdt) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const P = G.player;
  const s = clamp(Math.min(cw, ch) / 900, 0.7, 1.4);
  if (P.alive && P.controllable) {
    // reticles
    project(_v2.copy(P.pos).addScaledVector(P.fwd, 55), pA);
    project(_v2.copy(P.pos).addScaledVector(P.fwd, 130), pB);
    const lock = WSTATE.lock;
    const col = lock ? '#ff5a6e' : '#b4ff6a';
    ctx.lineWidth = 2;
    ctx.strokeStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    if (pA.z < 1) bracket(pA.x, pA.y, 26 * s, 8 * s);
    if (pB.z < 1) {
      ctx.globalAlpha = 0.85;
      bracket(pB.x, pB.y, 17 * s, 6 * s);
      ctx.fillStyle = col; ctx.fillRect(pB.x - 1.5, pB.y - 1.5, 3, 3);
      ctx.globalAlpha = 1;
      // hit marker
      if (WSTATE.hitMark > 0) {
        const k = WSTATE.hitMark / 0.18, r1 = (8 + (1 - k) * 6) * s, r2 = r1 + 7 * s;
        ctx.save();
        ctx.strokeStyle = WSTATE.hitKill ? '#ffd166' : '#ffffff';
        ctx.shadowColor = ctx.strokeStyle; ctx.globalAlpha = k; ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { ctx.moveTo(pB.x + dx * r1, pB.y + dy * r1); ctx.lineTo(pB.x + dx * r2, pB.y + dy * r2); }
        ctx.stroke();
        ctx.restore();
      }
      // charge meter
      const c = WSTATE.charge;
      if (c > 0.02) {
        ctx.beginPath();
        ctx.strokeStyle = WSTATE.charged ? (Math.floor(G.clock * 12) % 2 ? '#ffffff' : '#b4ff6a') : 'rgba(180,255,106,.9)';
        ctx.lineWidth = 3;
        ctx.arc(pB.x, pB.y, 28 * s, -Math.PI / 2, -Math.PI / 2 + c * TAU);
        ctx.stroke();
      }
    }
    // lock-on marker
    if (lock && lock.alive) {
      project(lock.pos, pL);
      if (pL.z < 1) {
        const r = (22 + Math.sin(G.clock * 14) * 3) * s + (lock.radius > 5 ? 10 : 0);
        ctx.save();
        ctx.translate(pL.x, pL.y); ctx.rotate(G.clock * 3);
        ctx.strokeStyle = '#ff4d6a'; ctx.shadowColor = '#ff4d6a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.stroke();
        ctx.restore();
        ctx.font = `600 ${11 * s}px Oxanium, sans-serif`; ctx.fillStyle = '#ff8a9a'; ctx.textAlign = 'center';
        ctx.fillText('LOCK', pL.x, pL.y + r + 14 * s);
      }
    }
    ctx.shadowBlur = 0;
  }
  // floating texts
  ctx.textAlign = 'center';
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.t += rdt;
    if (f.t > 1.1) { floats.splice(i, 1); continue; }
    project(f.pos, pA);
    if (pA.z > 1) continue;
    const a = 1 - Math.max(0, (f.t - 0.6) / 0.5);
    ctx.globalAlpha = a;
    ctx.font = `800 ${f.size * s}px Oxanium, sans-serif`;
    ctx.fillStyle = f.color;
    ctx.shadowColor = f.color; ctx.shadowBlur = 10;
    ctx.fillText(f.text, pA.x, pA.y - f.t * 40 * s - 20 * s);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  // indicators for extra markers (e.g. rescue target)
  for (const m of markers) {
    if (!m.active) continue;
    project(m.pos, pA);
    const onScreen = pA.z < 1 && pA.x > 30 && pA.x < cw - 30 && pA.y > 30 && pA.y < ch - 30;
    ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = 2;
    if (onScreen) {
      const r = 26 * s;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.clock * 8);
      ctx.beginPath(); ctx.arc(pA.x, pA.y, r, 0, TAU); ctx.stroke();
      ctx.font = `700 ${11 * s}px 'M PLUS 1', sans-serif`; ctx.fillText(m.label, pA.x, pA.y - r - 6);
      ctx.globalAlpha = 1;
    } else {
      let x = pA.x - cw / 2, y = pA.y - ch / 2;
      if (pA.z > 1) { x = -x; y = -y; }
      const a = Math.atan2(y, x);
      const ex = cw / 2 + Math.cos(a) * (Math.min(cw, ch) * 0.42), ey = ch / 2 + Math.sin(a) * (Math.min(cw, ch) * 0.42);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}

export const markers = [];
export function addMarker(pos, label, color = '#ffb070') { const m = { pos, label, color, active: true }; markers.push(m); return m; }
export function clearMarkers() { markers.length = 0; }

function bracket(x, y, r, l) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r + l); ctx.lineTo(x - r, y - r); ctx.lineTo(x - r + l, y - r);
  ctx.moveTo(x + r - l, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x + r, y - r + l);
  ctx.moveTo(x + r, y + r - l); ctx.lineTo(x + r, y + r); ctx.lineTo(x + r - l, y + r);
  ctx.moveTo(x - r + l, y + r); ctx.lineTo(x - r, y + r); ctx.lineTo(x - r, y + r - l);
  ctx.stroke();
}

// ============================================================ Results
let resAnim = null;
export function showResults(data) {
  showScreen('results');
  const grid = EL.resgrid;
  grid.innerHTML = '';
  const rows = data.rows;
  const cells = rows.map(r => {
    const dt = document.createElement('dt'); dt.textContent = r.label;
    const dd = document.createElement('dd'); dd.innerHTML = '0';
    grid.append(dt, dd);
    dt.style.opacity = dd.style.opacity = '0';
    return { r, dt, dd };
  });
  EL.restotal.textContent = '0';
  EL.rank.className = 'r';
  EL.rank.textContent = data.rank;
  EL.rankmeta.innerHTML = data.meta;
  EL.medal.classList.remove('on');
  resAnim = { t: 0, cells, total: data.total, rank: data.rank, medal: data.medal, stage: 0, done: false };
}

export function updateResults(rdt) {
  const A = resAnim;
  if (!A || A.done) return;
  A.t += rdt;
  const per = 0.55;
  for (let i = 0; i < A.cells.length; i++) {
    const c = A.cells[i];
    const t0 = 0.4 + i * per;
    if (A.t > t0) {
      c.dt.style.opacity = c.dd.style.opacity = '1';
      const k = clamp((A.t - t0) / 0.4, 0, 1);
      const v = Math.round(c.r.value * k);
      c.dd.innerHTML = (c.r.fmt ? c.r.fmt(v) : v.toLocaleString()) + (c.r.note ? `<small>${c.r.note}</small>` : '');
      if (k < 1 && Math.random() < 0.5) AudioSys.sfx('countTick', { vol: 0.4 });
    }
  }
  const tT = 0.4 + A.cells.length * per + 0.2;
  if (A.t > tT) {
    const k = clamp((A.t - tT) / 1.0, 0, 1);
    EL.restotal.textContent = Math.round(A.total * k).toLocaleString();
    if (k < 1 && Math.random() < 0.6) AudioSys.sfx('countTick', { vol: 0.35, pitch: 1.2 });
  }
  if (A.t > tT + 1.3 && A.stage === 0) {
    A.stage = 1;
    EL.rank.classList.add('on', A.rank);
    AudioSys.sfx('rankStamp');
    if (A.medal) setTimeout(() => { EL.medal.classList.add('on'); AudioSys.sfx('goldRing'); }, 500);
    A.done = true;
  }
}
export function skipResults() { if (resAnim && !resAnim.done) { resAnim.t = 1e3; updateResults(0); return true; } return false; }

export function setGameOverText(t) { EL['go-sub'].textContent = t; }
