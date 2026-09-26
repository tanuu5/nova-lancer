// NOVA LANCER — boot, game state machine and the main loop.
import * as THREE from 'three';
import {
  G, loadSettings, saveSettings, newRun, updateTimers, clearTimers, on, emit, clamp, lerp, damp,
  loadBest, saveBest, easeInOutCubic, easeOutCubic, rand, after,
} from './core.js';
import { initInput, updateInput, endInputFrame, Input } from './input.js';
import { initRenderer, createSky, createLights, makeTextures, renderFrame, updatePost, updateLights, POST, applyQuality, ATMO, GFX } from './gfx.js';
import { initWorld, updateWorld, updateTerrain, resetTerrain, setWorldAtmosphere, railFrame, railToWorld, terrainHeight, worldToRail } from './world.js';
import { initFX, beginFXFrame, updateFX, clearFX, bigFlash, addShake, FX, explode } from './fx.js';
import { PlayerShip, updateCamera, resetCamera, CAM } from './ship.js';
import { updatePlayerWeapons, updateEnemyBullets, clearWeapons, resetCharge, WSTATE, ebullets } from './weapons.js';
import { updateEnemies, clearEnemies, warmEnemies, unwarmEnemies, enemies } from './enemies.js';
import { initProps, updateProps, spawnProp } from './props.js';
import { initWingmen, resetWingmen, updateWingmen, updateWingmenTrails, setWingMode, WING } from './wingmen.js';
import { initBoss, BOSS } from './boss.js';
import { initLevel, startLevel, updateLevel } from './level.js';
import {
  initHUD, showScreen, hideScreens, hudVisible, updateHUD, radio, clearRadio, tip, clearTip, banner, hideBanner, warning, bossBar,
  setBossHP, popText, MENU_CB, titlePressed, titleReset, updateMenus, menuBack, refreshTitle, setLoading, showResults,
  updateResults, skipResults, resetHUDCache, setGameOverText, clearMarkers,
} from './hud.js';
import { AudioSys } from './audio.js';

// Resolve on the next animation frame, or after a short timeout when the tab is in the background.
const nextFrame = () => new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 60); });
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

let ship = null;
let best = null;
const S = { t: 0, phase: '', fadeTo: null };   // per-state scratch

// ============================================================ Boot
async function boot() {
  G.settings = loadSettings();
  best = loadBest();
  const app = document.getElementById('app');
  initHUD();
  setLoading(0.05, 'RENDERER');
  await nextFrame();
  initRenderer(app);
  initInput(G.renderer.domElement);
  makeTextures();
  setLoading(0.18, 'ATMOSPHERE');
  await nextFrame();
  createSky();
  createLights();
  initWorld();
  setLoading(0.42, 'TERRAIN');
  await nextFrame();
  initFX();
  initProps();
  initBoss();
  initWingmen();
  ship = new PlayerShip();
  G.player = ship;
  G.run = newRun(G.settings.difficulty);
  initLevel();
  setLoading(0.6, 'SQUADRON');
  await nextFrame();
  G.rail.d = 0;
  setWorldAtmosphere(0);
  updateTerrain(0, true);
  setLoading(0.8, 'SHADERS');
  await nextFrame();
  warmEnemies();
  resetCamera(ship);
  updateCamera(0.016, ship);
  // compile every program up-front to avoid hitches mid-game
  // Parallel shader compilation can stall while the page is hidden; don't let it block boot forever.
  try { await Promise.race([G.renderer.compileAsync(G.scene, G.camera), new Promise(r => setTimeout(r, 2500))]); }
  catch (e) { try { G.renderer.compile(G.scene, G.camera); } catch (e2) { /* ignore */ } }
  renderFrame(0.016);
  unwarmEnemies();
  setLoading(1, 'READY');
  await nextFrame();
  AudioSys.setVolume('master', G.settings.master);
  AudioSys.setVolume('music', G.settings.music);
  AudioSys.setVolume('sfx', G.settings.sfx);
  wireEvents();
  enterTitle(true);
  requestAnimationFrame(loop);
  if (__DEV__) Object.assign(window, {
    G, BOSS, WING, ship, emit, Input, POST, GFX, THREE,
    __jump: (d) => { G.run = G.run || newRun(); hideScreens(); setupStage(d, false); },
    __start: () => startMission(),
    __step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); return { state: G.state, d: Math.round(G.rail.d), hits: G.run.hits, shield: G.run.shield }; },
    enemies, WSTATE, ebullets, explode,
    __key: (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })),
    // test bot: steer toward the nearest enemy ahead and tap fire
    __bot: (n = 60, opts = {}) => {
      const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
      const held = {};
      const set = (code, on) => { if (!!held[code] !== on) { held[code] = on; key(code, on); } };
      for (let i = 0; i < n; i++) {
        let best = null, bd = 1e9;
        for (const e of enemies) { if (!e.alive) continue; const ds = e.s - G.rail.d; if (ds < 30 || ds > 600) continue; if (ds < bd) { bd = ds; best = e; } }
        let tu = best ? best.u : 0, tv = best ? Math.max(8, best.v) : 22;
        const B = BOSS.inst;
        if (B.active && B.phase !== 'intro') {
          let tgt = null;
          for (const sg of B.segs) if (sg.turret && sg.turret.alive && sg.pos.y > 0) { tgt = sg.turret.pos; break; }
          if (!tgt && B.jawOpen > 0.5) tgt = B.coreT.pos;
          if (!tgt) tgt = B.headPos;
          const rr = worldToRail(tgt, _v); tu = clamp(rr.y, -44, 44); tv = clamp(rr.z, 6, 56);
        }
        set('KeyD', tu > ship.u + 2); set('KeyA', tu < ship.u - 2);
        set('KeyW', tv > ship.v + 2); set('KeyS', tv < ship.v - 2);
        if (opts.fire !== false) set('KeyJ', i % 6 === 0);
        frame(1 / 60);
      }
      for (const c of Object.keys(held)) set(c, false);
      return { d: Math.round(G.rail.d), hits: G.run.hits, shield: Math.round(G.run.shield), lives: G.run.lives, state: G.state, enemies: enemies.length };
    },
  });
}

// Pause automatically when the page loses focus mid-mission.
window.addEventListener('blur', () => { if (G.state === 'play' && !S.intro) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play' && !S.intro) pause(); });

// Unlock audio on any genuine user gesture.
for (const ev of ['keydown', 'pointerdown', 'touchstart', 'mousedown']) window.addEventListener(ev, () => AudioSys.init(), { passive: true });

// ============================================================ Game events
function wireEvents() {
  on('enemyKilled', (e, source) => {
    const run = G.run;
    run.hits += e.def.hits;
    run.score += e.def.score;
    if (e.def.hits > 1) popText(e.pos, `+${e.def.hits}`, '#ffd166', 22);
  });
  on('combo', (kills, pos) => {
    const bonus = kills - 1;
    G.run.hits += bonus;
    G.run.score += bonus * 300;
    popText(pos, `BONUS +${bonus}`, '#ffd166', 24);
    AudioSys.sfx('item', { pitch: 1.2 });
  });
  on('propDestroyed', (p, pos) => { G.run.hits += 1; G.run.score += 300; popText(pos, '+1', '#b4ff6a'); });
  on('missileDown', () => { G.run.score += 50; });
  on('bonus', (amt, pos, label) => { G.run.score += amt; popText(pos, label, '#ffd166', 22); AudioSys.sfx('goldRing'); });
  on('ring', (kind) => {
    const run = G.run;
    if (kind === 'silver') { run.shield = Math.min(run.maxShield, run.shield + 25); run.score += 500; run.rings++; AudioSys.sfx('ring'); }
    else if (kind === 'gold') {
      run.shield = Math.min(run.maxShield, run.shield + 50); run.score += 1000; run.rings++;
      run.goldRings++; AudioSys.sfx('goldRing');
      if (run.goldRings >= 3) {
        run.goldRings = 0;
        if (run.maxShield < 140) { run.maxShield = 140; run.shield = 140; tip('シールド最大値アップ！', 3); }
        else { run.lives++; AudioSys.sfx('extraLife'); tip('1UP！', 3); }
      }
    } else if (kind === 'check') {
      run.checkpoint = 6100;
      run.shield = Math.min(run.maxShield, run.shield + run.maxShield * 0.5);
      AudioSys.sfx('checkpoint');
      banner('SUPPLY RING', 'CHECKPOINT', '', 2.2);
    }
  });
  on('item', (kind, it) => {
    const run = G.run;
    if (kind === 'laser') {
      run.laser = Math.min(2, run.laser + 1);
      AudioSys.sfx('powerUp');
      tip(run.laser === 2 ? 'ハイパーレーザー！' : 'ツインレーザー！', 2.5);
      radio('rio', run.laser === 2 ? 'ハイパーレーザー装備完了。威力が上がったわ！' : 'ツインレーザーに換装完了。これで戦いやすくなるわ！', { prio: 1 });
    } else if (kind === 'bomb') { run.bombs = Math.min(9, run.bombs + 1); AudioSys.sfx('item'); tip('スマートボム +1', 2); }
    else { run.shield = Math.min(run.maxShield, run.shield + 40); AudioSys.sfx('shieldUp'); }
  });
  on('dropItem', (kind, pos, s, u, v) => {
    spawnProp('item', G.rail.d + 90, { kind, u: clamp(u, -40, 40), v: clamp(v, 8, 50), hold: 7, ahead: 90 });
  });
  on('playerDead', () => { S.deadT = 0; G.state = 'dead'; });
  on('playerDamaged', () => { G.hitStop = 0.05; });
  on('bossStart', startBoss);
  on('bossHit', () => {});
  on('bossTurretDown', () => { G.run.hits += 1; G.run.score += 1500; });
  on('bossDefeated', () => { G.run.hits += 10; G.run.score += 20000; startClear(); });
  on('bossDying', () => { bossBar(false); setWingMode('formation'); });

  // ---- reactive radio chatter (each fires at most once per run unless noted)
  const once = (key, fn) => { const r = G.run; r.said ||= {}; if (r.said[key]) return; r.said[key] = true; fn(); };
  on('enemyKilled', () => {
    const h = G.run.hits;
    if (h >= 50) once('h50', () => radio('kota', '撃墜数50突破！　隊長すごいや！'));
    if (h >= 100) once('h100', () => radio('gantetsu', '100機撃墜か……腕を上げたな、隊長。'));
  });
  on('combo', (kills) => { if (kills >= 3) once('combo', () => radio('gantetsu', '見事なまとめ撃ちだ。その調子で行け。')); });
  on('deflect', () => once('deflect', () => radio('gantetsu', 'いいぞ、その要領だ！　弾は正面から受けるな。')));
  on('playerDamaged', () => {
    const r = G.run;
    if (r.shield > 0 && r.shield < r.maxShield * 0.3) once('low', () => radio('rio', 'シールド残量低下！　リングを探して回復して！', { prio: 1 }));
  });
  on('ring', (kind) => { if (kind === 'gold') once('gold', () => radio('kota', '金色のリングだ！　3つ集めるといいことあるよ！')); });
  on('bossTurretDown', (left) => {
    if (left === 5) radio('kota', 'ひとつ潰した！　その調子！');
    if (left === 2) radio('rio', '砲台、残り2基よ！');
  });
  on('bombUsed', () => once('bomb', () => radio('kota', 'ボムだー！　どっかーん！')));

  MENU_CB.start = () => startMission();
  MENU_CB.resume = () => resume();
  MENU_CB.retry = () => { resume(); hideScreens(); respawn(true); };
  MENU_CB.quit = () => { resume(); hideScreens(); enterTitle(false); };
  MENU_CB.continue = () => { G.run.score = 0; G.run.lives = 3; G.run.continues++; G.run.hits = 0; hideScreens(); respawn(true); };
  MENU_CB.again = () => startMission();
  MENU_CB.pause = () => pause();
  MENU_CB.quality = (q) => applyQuality(q);
}

// ============================================================ States
function enterTitle(first) {
  G.state = 'title';
  G.paused = false;
  G.slowMo = 1;
  clearTimers();
  clearEnemies(); clearWeapons(); clearFX(); clearRadio(); clearMarkers();
  if (BOSS.inst.active) BOSS.inst.stop();
  bossBar(false); warning(false); hideBanner();
  if (G.warnLoop) { G.warnLoop.stop(0.2); G.warnLoop = null; }
  hudVisible(false);
  G.run = newRun(G.settings.difficulty);
  G.rail.d = 150;
  G.rail.speed = 45;
  resetTerrain();
  updateTerrain(G.rail.d, true);
  startLevel(1e9);             // no events in attract mode
  ship.reset(0, 24);
  ship.controllable = false;
  ship.autoPilot = { u: 0, v: 24 };
  resetWingmen(true);
  titleFormation();
  resetCamera(ship);
  CAM.override = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 55 };
  POST.letterbox = 0;
  POST.fade = first ? 1 : POST.fade;
  S.t = 0;
  best = loadBest();
  refreshTitle(best);
  showScreen('title');
  titleReset();
  if (AudioSys.ready) { titlePressed(); AudioSys.playMusic('title', { fade: 1.2 }); }
  S.titleStarted = AudioSys.ready;
}

// Attract-mode formation sits behind the leader so the orbiting camera never clips a wingman.
const TITLE_SLOTS = { kota: { ds: -70, u: 34, v: 38 }, gantetsu: { ds: -90, u: -20, v: 33 }, rio: { ds: -120, u: 10, v: 46 } };
function titleFormation() { for (const w of WING.list) w.override = TITLE_SLOTS[w.id]; }

function startMission() {
  if (S.transition) return;
  S.transition = true;
  hideScreens();
  fadeTo(1, 0.6, () => {
    S.transition = false;
    G.run = newRun(G.settings.difficulty);
    G.run.startTime = G.time;
    setupStage(0, true);
  });
}

// Prepare the world for play starting at distance d
function setupStage(d, intro) {
  hideScreens();
  G.state = 'play';
  G.paused = false;
  G.slowMo = 1;
  clearTimers();
  clearEnemies(); clearWeapons(); clearFX(); clearRadio(); clearMarkers();
  if (BOSS.inst.active) BOSS.inst.stop();
  bossBar(false); warning(false); hideBanner(); clearTip();
  if (G.warnLoop) { G.warnLoop.stop(0.2); G.warnLoop = null; }
  G.rail.d = d;
  G.rail.speed = 100;
  resetTerrain();
  updateTerrain(d, true);
  setWorldAtmosphere(d);
  startLevel(d);
  ship.reset(0, 24);
  ship.controllable = !intro;
  ship.autoPilot = null;
  resetWingmen(true);
  if (G.run.kotaLost && d > 3850) WING.byId.kota.hide();
  resetCamera(ship);
  CAM.override = null;
  resetHUDCache();
  hudVisible(true);
  POST.letterbox = intro ? 1 : 0;
  S.intro = intro ? { t: 0 } : null;
  S.bossCine = null;
  if (d < 10500) AudioSys.playMusic('stage1', { fade: 0.4 });
  else AudioSys.stopMusic(0.5);
  fadeTo(0, 0.8);
  if (intro) {
    after(0.8, () => banner('MISSION 01', 'AZURE COAST', '惑星アクエリア　沿岸防衛線', 3.6));
  } else if (d > 0) {
    banner('RESTART', d >= 10500 ? 'BOSS' : 'CHECKPOINT', '', 2);
  }
  if (!intro && G.run.deaths > 0) after(1.2, () => radio('hou', '無理をするな、ランサー1。体勢を立て直せ！', { prio: 1 }));
}

function respawn(fromMenu) {
  const cp = G.run.checkpoint;
  const d = cp === 0 ? 0 : Math.max(0, cp - 150);
  const run = G.run;
  run.shield = run.maxShield = Math.max(100, run.maxShield === 140 ? 140 : 100);
  run.laser = Math.max(0, run.laser - 1);
  run.bombs = Math.max(run.bombs, 3);
  fadeTo(1, fromMenu ? 0.35 : 0.6, () => setupStage(d, false));
}

function pause() {
  if (G.state !== 'play' && G.state !== 'dead') return;
  if (G.paused) return;
  G.paused = true;
  showScreen('pause');
  AudioSys.sfx('pause');
  AudioSys.setPaused(true);
}
function resume() {
  if (!G.paused) return;
  G.paused = false;
  hideScreens();
  AudioSys.setPaused(false);
  Input.clearAll();
}

function gameOver() {
  G.state = 'gameover';
  AudioSys.playMusic('gameover', { fade: 0.3 });
  hudVisible(false);
  setGameOverText(G.run.hits > 0 ? `撃墜数 ${G.run.hits}　スコア ${G.run.score.toLocaleString()}` : 'ランサー隊、撃墜……');
  S.goT = 0; S.goShown = false;
}

function startBoss() {
  const B = BOSS.inst;
  B.start();
  AudioSys.playMusic('boss', { fade: 0.2 });
  setWingMode('boss');
  S.bossCine = { t: 0 };
  POST.letterbox = 1;
  radio('mizuchi', '……侵入者ヲ確認。排除スル。', { prio: 2, hold: 1.2 });
  after(3.2, () => { banner('WARNING', 'MIZUCHI', '海竜型機動兵器　ミズチ', 3, 'boss'); });
  after(6.2, () => bossBar(true));
}

function startClear() {
  G.state = 'clear';
  S.t = 0;
  S.clearDone = false;
  ship.controllable = false;
  ship.autoPilot = { u: 0, v: 34 };
  resetCharge();
  AudioSys.playMusic('clear', { fade: 0.6 });
  hudVisible(true);
  after(1.2, () => banner('MISSION', 'COMPLETE', 'ミッション　コンプリート', 5, 'gold'));
  after(1.4, () => G.run.kotaLost
    ? radio('rio', '目標の沈黙を確認。……お見事よ、隊長。', { prio: 2 })
    : radio('kota', 'やったー！　隊長、最高だよ！', { prio: 2 }));
  after(1.5, () => radio('gantetsu', '見事な腕だ。……帰還するぞ。'));
  after(1.6, () => radio('hou', 'よくやった、ランサー隊。アクエリアは守られた。', { hold: 2.4 }));
  WING.list.forEach((w, i) => after(2.4 + i * 0.35, () => { if (!w.gone) { w.barrelRoll(); AudioSys.sfx('roll', { vol: 0.5, pan: i - 1 }); } }));
  for (const w of WING.list) {
    if (w.id === 'kota' && G.run.kotaLost) continue;
    w.reset(); w.show(); w.mode = 'formation';
  }
}

function finishRun() {
  const run = G.run;
  run.time = G.time - run.startTime;
  const acc = run.shots ? Math.round(run.shotsHit / run.shots * 100) : 0;
  const hitBonus = run.hits * 100;
  const shieldBonus = Math.round(run.shield / run.maxShield * 100) * 50;
  const lifeBonus = run.lives * 3000;
  const nomiss = run.deaths === 0 ? 10000 : 0;
  const total = run.score + hitBonus + shieldBonus + lifeBonus + nomiss;
  const rank = run.hits >= 125 && run.deaths === 0 ? 'S' : run.hits >= 100 ? 'A' : run.hits >= 70 ? 'B' : 'C';
  const medal = run.hits >= 115;
  const mm = Math.floor(run.time / 60), ss = Math.floor(run.time % 60);
  const rows = [
    { label: 'HITS 撃墜数', value: run.hits },
    { label: 'SCORE スコア', value: run.score },
    { label: 'HIT BONUS', value: hitBonus },
    { label: 'SHIELD BONUS', value: shieldBonus, note: `${Math.round(run.shield / run.maxShield * 100)}%` },
    { label: 'LIFE BONUS', value: lifeBonus, note: `×${run.lives}` },
    { label: 'NO MISS', value: nomiss },
  ];
  const isBest = total > (best?.score || 0);
  const meta = `命中率 <b>${acc}%</b>　リング <b>${run.rings}</b>　タイム <b>${mm}:${String(ss).padStart(2, '0')}</b><br>${run.savedKota ? 'コタ救出 <b>成功</b>' : 'コタ救出 <b>失敗</b>'}${isBest ? '　<b>NEW RECORD!</b>' : ''}`;
  if (isBest) { best = { score: total, hits: run.hits, rank }; saveBest(best); }
  G.state = 'results';
  hudVisible(false);
  showResults({ rows, total, rank, medal, meta });
}

// ============================================================ Transitions
function fadeTo(target, dur, cb) { S.fade = { from: POST.fade, to: target, t: 0, dur, cb }; }
function updateFade(rdt) {
  const f = S.fade;
  if (!f) return;
  f.t += rdt;
  const k = clamp(f.t / f.dur, 0, 1);
  POST.fade = lerp(f.from, f.to, easeInOutCubic(k));
  if (k >= 1) { S.fade = null; f.cb?.(); }
}

// ============================================================ Cinematic cameras
function titleCamera(dt) {
  const t = G.clock;
  const a = 0.95 + Math.sin(t * 0.09) * 0.85;   // sweep between front-on and side-on views
  const o = CAM.override;
  railFrame(G.rail.d, _p, _f, _r);
  const r = 24 + Math.sin(t * 0.21) * 4;
  o.pos.copy(ship.pos).addScaledVector(_r, Math.sin(a) * r).addScaledVector(_f, Math.cos(a) * r);
  o.pos.y = ship.pos.y + 5 + Math.sin(t * 0.33) * 3;
  // aim to the left of the ship so it sits right of centre (the logo occupies the left side)
  _v.subVectors(ship.pos, o.pos).normalize();
  _v2.crossVectors(_v, THREE.Object3D.DEFAULT_UP).normalize();
  o.target.copy(ship.pos).addScaledVector(_v2, -8);
  o.fov = 50;
}

function introCamera(dt) {
  const I = S.intro;
  I.t += dt;
  const k = easeInOutCubic(clamp((I.t - 0.4) / 3.0, 0, 1));
  railFrame(G.rail.d, _p, _f, _r);
  // start: in front of the ship looking back at it, end: normal chase camera
  const startPos = _v.copy(ship.pos).addScaledVector(_f, 26).addScaledVector(_r, 9).setY(ship.pos.y + 3);
  const endPos = _v2.copy(ship.pos).addScaledVector(_f, -22).setY(ship.pos.y + 6);
  CAM.override = CAM.override || { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 60 };
  CAM.override.pos.lerpVectors(startPos, endPos, k);
  CAM.override.pos.addScaledVector(_r, Math.sin(k * Math.PI) * 14);
  CAM.override.target.copy(ship.pos).addScaledVector(_f, 30 * k);
  CAM.override.fov = lerp(48, 62, k);
  POST.letterbox = 1 - clamp((I.t - 2.8) / 0.8, 0, 1);
  if (I.t > 2.6 && !ship.controllable) { ship.controllable = true; }
  if (I.t > 3.4) { CAM.override = null; S.intro = null; POST.letterbox = 0; resetCamera(ship); }
}

function bossCamera(dt) {
  const C = S.bossCine;
  C.t += dt;
  const B = BOSS.inst;
  const T = C.t;
  if (T < 1.6) { POST.letterbox = 1; return; }       // chase cam watching the sea churn
  if (T < 6.0) {
    // look at the rising head
    CAM.override = CAM.override || { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 60 };
    railFrame(G.rail.d, _p, _f, _r);
    const k = easeOutCubic(clamp((T - 1.6) / 1.2, 0, 1));
    CAM.override.pos.copy(ship.pos).addScaledVector(_f, -24 + 10 * k).addScaledVector(_r, -12 * k).setY(ship.pos.y + 4 - 2 * k);
    CAM.override.target.lerpVectors(_v.copy(ship.pos).addScaledVector(_f, 40), B.headPos, k);
    CAM.override.fov = lerp(62, 42, k);
    POST.letterbox = 1;
    return;
  }
  CAM.override = null;
  POST.letterbox = Math.max(0, 1 - (T - 6) / 0.6);
  if (T > 6.6) S.bossCine = null;
}

function clearCamera(dt) {
  const t = S.t;
  railFrame(G.rail.d, _p, _f, _r);
  CAM.override = CAM.override || { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 55 };
  const a = -0.6 + t * 0.35;
  const r = 26 + t * 1.2;
  CAM.override.pos.copy(ship.pos).addScaledVector(_r, Math.sin(a) * r).addScaledVector(_f, Math.cos(a) * r).setY(ship.pos.y + 4 + t * 0.6);
  CAM.override.target.copy(ship.pos);
  CAM.override.fov = 52;
  POST.letterbox = Math.min(1, t / 0.8);
}

// ============================================================ Lens flare visibility (CPU occlusion against terrain)
let sunVis = 0;
function updateSunFlare(dt) {
  const cam = G.camera;
  const dir = ATMO.uSunDir.value;
  _v.copy(cam.position).addScaledVector(dir, 3000).project(cam);
  let target = 0;
  if (_v.z < 1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.15) {
    target = 1 - clamp((Math.max(Math.abs(_v.x), Math.abs(_v.y)) - 0.8) / 0.35, 0, 1);
    for (let i = 1; i <= 14 && target > 0; i++) {
      const dist = i * i * 12;
      const x = cam.position.x + dir.x * dist, y = cam.position.y + dir.y * dist, z = cam.position.z + dir.z * dist;
      if (y < terrainHeight(x, z)) target = 0;
    }
    if (BOSS.inst.active && BOSS.inst.head.visible) {
      _v2.copy(BOSS.inst.headPos).project(cam);
      if (Math.hypot(_v2.x - _v.x, _v2.y - _v.y) < 0.12 && _v2.z < 1) target = 0;
    }
    POST.sunPos.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
  }
  sunVis = damp(sunVis, target, 8, dt);
  POST.sunVis = sunVis * 0.9;
}

// ============================================================ Main loop
let last = performance.now();
let lowShieldT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let rdt = (now - last) / 1000;
  last = now;
  if (!(rdt > 0)) rdt = 0.016;
  frame(Math.min(rdt, 0.05));
}

function frame(rdt) {
  G.rdt = rdt;
  G.clock += rdt;
  updateInput(rdt);
  beginFXFrame();

  // time scaling (pause, hit-stop, slow motion)
  let ts = G.paused ? 0 : 1;
  if (G.hitStop > 0) { G.hitStop -= rdt; ts *= 0.15; }
  ts *= G.slowMo;
  const dt = rdt * ts;
  G.dt = dt;
  G.time += dt;

  // global input
  if (G.state === 'title') updateTitle(rdt);
  else if (G.state === 'play' || G.state === 'dead') updatePlay(dt, rdt);
  else if (G.state === 'clear') updateClear(dt, rdt);
  else if (G.state === 'gameover') {
    S.goT += rdt;
    if (!S.goShown && S.goT > 1.6) { S.goShown = true; showScreen('gameover'); }
    if (S.goShown) updateMenus();
    simulate(dt * 0.4, rdt, false);
  }
  else if (G.state === 'results') {
    S.t += rdt;
    G.rail.d += G.rail.speed * dt;
    clearCamera(dt);
    updateResults(rdt);
    if (Input.pressed('confirm') && skipResults()) { /* consumed */ } else updateMenus();
    simulate(dt, rdt, false);
  }

  updateEngineSound();
  updateFade(rdt);
  updatePost(rdt);
  POST.ca = damp(POST.ca, 0.0012, 3, rdt);
  if (ship) POST.radial = damp(POST.radial, G.state === 'play' ? ship.boostAmt * 0.9 : 0, 6, rdt);
  updateSunFlare(rdt);
  renderFrame(rdt);
  endInputFrame();
}

function updateTitle(rdt) {
  if (!S.titleStarted) {
    if (Input.any() || AudioSys.ready) {
      AudioSys.init();
      S.titleStarted = true;
      titlePressed();
      AudioSys.playMusic('title', { fade: 1.0 });
      AudioSys.sfx('uiSelect');
    }
  } else {
    if (Input.pressed('back') && menuBack()) { /* closed sub menu */ }
    else updateMenus();
  }
  if (S.fade == null && POST.fade > 0.99 && S.t === 0) fadeTo(0, 1.4);
  S.t += rdt;
  // attract mode: gentle cruise over the sunset sea
  const t = G.clock;
  ship.autoPilot.u = Math.sin(t * 0.23) * 14;
  ship.autoPilot.v = 24 + Math.sin(t * 0.37) * 6;
  G.rail.speed = 45;
  G.rail.d += G.rail.speed * rdt;
  if (G.rail.d > 3800) { G.rail.d = 150; resetTerrain(); updateTerrain(G.rail.d, true); resetWingmen(true); titleFormation(); }
  titleCamera(rdt);
  simulate(rdt, rdt, false);
}

function updatePlay(dt, rdt) {
  const run = G.run;
  // pause toggle
  if (Input.pressed('pause')) {
    if (G.paused) { if (!menuBack()) resume(); }
    else pause();
  } else if (G.paused) {
    if (Input.pressed('back') && !Input.pressed('pause')) { if (!menuBack()) resume(); }
    else updateMenus();
  }
  if (G.paused) { renderPausedHUD(rdt); return; }

  // rail advance
  if (ship.alive) G.rail.speed = 100 * ship.speedMul;
  else G.rail.speed = damp(G.rail.speed, 60, 2, dt);
  G.rail.d += G.rail.speed * dt;
  run.time += dt;

  updateTimers();
  updateLevel();
  if (S.intro) introCamera(dt);
  if (S.bossCine) bossCamera(dt);

  simulate(dt, rdt, true);

  // low shield alarm
  if (ship.alive && run.shield < run.maxShield * 0.25) {
    lowShieldT -= dt;
    if (lowShieldT <= 0) { lowShieldT = 1.1; AudioSys.sfx('lowShield', { vol: 0.5 }); }
  }
  // boss HP
  if (BOSS.inst.active) setBossHP(BOSS.inst.hp / BOSS.inst.maxHp);
  // death flow
  if (G.state === 'dead') {
    S.deadT += rdt;
    if (S.deadT > 2.0 && !S.deadHandled) {
      S.deadHandled = true;
      run.deaths++;
      if (run.lives > 0) { run.lives--; respawn(false); }
      else gameOver();
    }
  } else S.deadHandled = false;
}

function renderPausedHUD(rdt) {
  // keep the HUD alive (radio typing freezes, flare, etc.) — nothing to simulate
  updateCamera(0, ship);
}

function updateClear(dt, rdt) {
  S.t += rdt;
  G.rail.speed = damp(G.rail.speed, 110, 1, dt);
  G.rail.d += G.rail.speed * dt;
  updateTimers();
  clearCamera(dt);
  ship.boosting = S.t > 4.5;
  simulate(dt, rdt, false);
  if (S.t > 4.5 && S.t < 4.6) { AudioSys.sfx('boost'); addShake(0.2); }
  if (S.t > 8.5 && !S.clearDone) { S.clearDone = true; fadeTo(0.55, 0.8, finishRun); }
}

// Continuous engine hum while the player's ship is flying in a mission.
function updateEngineSound() {
  const want = (G.state === 'play' || G.state === 'clear') && ship.alive && ship.dying <= 0;
  if (want && !S.engine && AudioSys.ready) S.engine = AudioSys.loop('engine');
  if (!want && S.engine) { S.engine.stop(0.6); S.engine = null; }
  if (S.engine) S.engine.set({ speed: ship.speedMul, boost: ship.boosting, brake: ship.braking });
}

// Shared world simulation
function simulate(dt, rdt, gameplay) {
  ship.update(dt);
  if (gameplay) updatePlayerWeapons(dt, ship, ship.controllable && !S.intro && G.state === 'play');
  updateEnemies(dt);
  if (BOSS.inst.active) BOSS.inst.update(dt);
  updateWingmen(dt);
  updateProps(dt);
  updateEnemyBullets(dt, ship);
  updateWorld(dt, G.rail.d, ship.pos);
  updateCamera(rdt, ship);
  updateLights(dt, ship.pos);
  ship.updateTrails(G.camera.position);
  updateWingmenTrails(G.camera.position);
  updateFX(dt);
  updateHUD(dt, rdt);
}

// ============================================================ Start (supports hot-reload hooks when hosted)
const hot = typeof window !== 'undefined' ? window.claude?.hot : null;
try { hot?.snapshot?.(() => ({ settings: G.settings })); } catch (e) { /* optional */ }
const start = () => { boot().catch(err => { console.error(err); const m = document.getElementById('loadmsg'); if (m) m.textContent = 'ERROR: ' + (err?.message || err); }); };
if (hot?.ready) { try { hot.ready(start); } catch (e) { start(); } } else start();
