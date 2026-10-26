// NOVA LANCER — boot, game state machine and the main loop.
import * as THREE from 'three';
import {
  G, loadSettings, saveSettings, newRun, updateTimers, clearTimers, on, emit, clamp, lerp, damp,
  easeInOutCubic, easeOutCubic, rand, after, mulberry32,
} from './core.js';
import { initInput, updateInput, endInputFrame, Input } from './input.js';
import { initRenderer, createSky, createLights, makeTextures, renderFrame, updatePost, updateLights, POST, applyQuality, ATMO, GFX } from './gfx.js';
import { initWorld, useStageWorld, updateWorld, updateTerrain, resetTerrain, setWorldAtmosphere, railFrame, railToWorld, terrainHeight, worldToRail, pathX, paletteAt, __worldDebug } from './world.js';
import { initFX, beginFXFrame, updateFX, clearFX, bigFlash, addShake, FX, explode } from './fx.js';
import { PlayerShip, updateCamera, resetCamera, CAM } from './ship.js';
import { updatePlayerWeapons, updateEnemyBullets, clearWeapons, resetCharge, WSTATE, ebullets } from './weapons.js';
import { updateEnemies, clearEnemies, warmEnemies, unwarmEnemies, enemies } from './enemies.js';
import { initProps, updateProps, spawnProp } from './props.js';
import { initWingmen, resetWingmen, updateWingmen, updateWingmenTrails, setWingMode, setWingStance, sortieAll, WING } from './wingmen.js';
import { initBoss, useBoss, BOSS } from './boss.js';
import { updateFlybys, clearFlybys } from './flyby.js';
import { initLevel, loadStageScript, startLevel, updateLevel } from './level.js';
import { STAGES, MISSIONS, PROLOGUE } from './stages/index.js';
import { CAMP, freshCarry, progress, saveProgress, saveStoryPoint, recordClear, markSeen, encodePassword } from './campaign.js';
import {
  initScreens, updateScreens, screenActive, closeScreens, openBriefing, openTalk, openStory, openTbc, openSelect, openChars, openPassword,
} from './screens.js';
import {
  initHUD, showScreen, hideScreens, hudVisible, updateHUD, radio, clearRadio, tip, clearTip, banner, hideBanner, warning, bossBar,
  setBossHP, popText, MENU_CB, titlePressed, titleReset, updateMenus, menuBack, refreshTitle, showTitleMenu, setLoading, showResults,
  updateResults, skipResults, resetHUDCache, setGameOverText, clearMarkers,
} from './hud.js';
import { AudioSys } from './audio.js';

// Resolve on the next animation frame, or after a short timeout when the tab is in the background.
const nextFrame = () => new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 60); });
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

let ship = null;
const S = { t: 0, phase: '', fadeTo: null };   // per-state scratch
let CUR = null;                                // the stage definition being played (the title flies over the first one)

// Load a stage: its world (course, terrain, palettes), its script and its boss.
function useStage(def) {
  CUR?.onExit?.();
  CUR = def;
  useStageWorld(def);
  loadStageScript(def);
  useBoss(def.boss.id);
}

// ============================================================ Boot
async function boot() {
  G.settings = loadSettings();
  const app = document.getElementById('app');
  initHUD();
  initScreens();
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
  useStage(STAGES[0]);
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
    CAMP, progress,
    __step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); return { state: G.state, d: Math.round(G.rail.d), hits: G.run.hits, shield: G.run.shield }; },
    enemies, WSTATE, ebullets, explode,
    __key: (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })),
    // Regression helpers: a seeded Math.random makes a __bot run repeatable, __snap/__fp summarise game state and the world.
    __seed: (s) => { const r0 = mulberry32(s); window.__rc = 0; Math.random = () => { window.__rc++; return r0(); }; },
    __snap: () => {
      const r = G.run, B = BOSS.inst, n = (v) => Math.round(v * 100) / 100;
      return [G.state, n(G.rail.d), r.hits, r.score, n(r.shield), r.lives, r.deaths, enemies.length, B.active ? n(B.hp) : -1,
        document.getElementById('rtext').textContent, document.querySelector('#banner .b-big').textContent, n(ship.pos.x), n(ship.pos.y), n(ship.pos.z)].join('|');
    },
    __fp: () => {
      const mix = (h, v) => (Math.imul(h, 31) + v) | 0;
      const hashArr = (h, a) => { const iv = new Int32Array(a.buffer, a.byteOffset, a.length); for (let i = 0; i < iv.length; i++) h = mix(h, iv[i]); return h; };
      let hT = 0;
      for (let d = 0; d <= 12000; d += 40) {
        const cx = pathX(d);
        hT = mix(hT, Math.round(cx * 1000));
        for (let x = -1600; x <= 1600; x += 27) hT = mix(hT, Math.round(terrainHeight(cx + x, -d) * 1000));
      }
      const hC = [];
      for (const d of [0, 2000, 4500, 6500, 8500, 10800]) {
        resetTerrain(); updateTerrain(d, true);
        let h = 0;
        for (const ci of [...__worldDebug.chunks.keys()].sort((a, b) => a - b)) {
          const g = __worldDebug.chunks.get(ci).geometry.attributes;
          h = hashArr(hashArr(hashArr(h, g.position.array), g.normal.array), g.color.array);
          for (const o of __worldDebug.decoByChunk.get(ci) || []) h = hashArr(mix(h, o.count), o.instanceMatrix.array);
        }
        hC.push(h);
      }
      resetTerrain(); updateTerrain(G.rail.d, true);
      const pal = [0, 3000, 5000, 7000, 9000, 10500, 11500].map(d => {
        const p = paletteAt(d, {});
        return Object.keys(p).sort().map(k => k + '=' + (p[k]?.isColor ? p[k].getHexString() : typeof p[k] === 'number' ? p[k].toFixed(5) : p[k])).join(',');
      });
      return { hT, hC: hC.join(','), pal: pal.join(' / ') };
    },
    // test bot: steer toward the nearest enemy ahead and tap fire
    __bot: (n = 60, opts = {}) => {
      const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
      const held = {};
      const set = (code, on) => { if (!!held[code] !== on) { held[code] = on; key(code, on); } };
      for (let i = 0; i < n; i++) {
        let best = null, bd = 1e9;
        const pool = CUR.botTargets ? [...enemies, ...CUR.botTargets()] : enemies;
        for (const e of pool) { if (!e.alive) continue; const ds = e.s - G.rail.d; if (ds < 30 || ds > 600) continue; if (ds < bd) { bd = ds; best = e; } }
        let tu = best ? best.u : 0, tv = best ? Math.max(8, best.v) : 22;
        const B = BOSS.inst;
        if (B.active && B.phase !== 'intro') {
          const rr = worldToRail(B.botAim(), _v); tu = clamp(rr.y, -44, 44); tv = clamp(rr.z, 6, 56);
        }
        const steer = CUR.botSteer?.();
        if (steer) { tu = steer.u; tv = steer.v; }
        set('KeyD', tu > ship.u + 2); set('KeyA', tu < ship.u - 2);
        set('KeyW', tv > ship.v + 2); set('KeyS', tv < ship.v - 2);
        if (opts.fire !== false) set('KeyJ', i % 6 === 0);
        frame(1 / 60);
        opts.onFrame?.(i);
      }
      for (const c of Object.keys(held)) set(c, false);
      return { d: Math.round(G.rail.d), hits: G.run.hits, shield: Math.round(G.run.shield), lives: G.run.lives, state: G.state, enemies: enemies.length };
    },
  });
}

// Pause automatically when the page loses focus mid-mission.
// (Dev builds: `window.__manual = true` hands every frame to __step/__bot, for repeatable test runs.
//  `?manual&seed=N` in the URL turns that on from the first frame and seeds Math.random before boot.)
const manual = () => __DEV__ && window.__manual;
if (__DEV__) {
  const q = new URLSearchParams(location.search);
  if (q.has('manual')) window.__manual = true;
  if (q.has('seed')) { const r0 = mulberry32(+q.get('seed') || 1); window.__rc = 0; Math.random = () => { window.__rc++; return r0(); }; }
}
window.addEventListener('blur', () => { if (G.state === 'play' && !S.intro && !manual()) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play' && !S.intro && !manual()) pause(); });

// Unlock audio on any genuine user gesture. (Test runs stay silent: sound effects are throttled in real time.)
for (const ev of ['keydown', 'pointerdown', 'touchstart', 'mousedown']) window.addEventListener(ev, () => { if (!manual()) AudioSys.init(); }, { passive: true });

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
  on('ring', (kind, ring) => {
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
      run.checkpoint = ring.s;
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
  on('bossPartDown', () => { G.run.hits += 1; G.run.score += 1500; });
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
  on('bombUsed', () => once('bomb', () => radio('kota', 'ボムだー！　どっかーん！')));
  // legendary spear fragment: one bit per mission, carried through the story (all six → the true ending)
  on('fragment', () => {
    const run = G.run;
    run.frags = (run.frags || 0) | (1 << (CUR.no - 1));
    run.gotFrag = true;
    const P = progress();
    P.found ||= {};
    if (!P.found[CUR.id]) { P.found[CUR.id] = true; saveProgress(); }
    AudioSys.sfx('extraLife');
    tip('伝説の槍のかけらを手に入れた', 3.5);
    CUR.onFragment?.();
  });

  on('radioStart', (who) => markSeen(who));   // the character page unlocks whoever has been on the radio

  MENU_CB.story = (act) => {
    if (act === 'continue') continueStory();
    else if (act === 'new') newStory();
    else if (act === 'password') { AudioSys.sfx('uiSelect'); openPassword(passwordOk, () => showTitleMenu('story', 'password')); }
    else if (act === 'prologue') { AudioSys.sfx('uiSelect'); openStory('PROLOGUE', PROLOGUE, () => showTitleMenu('story', 'prologue')); }
  };
  MENU_CB.select = () => openSelectScreen();
  MENU_CB.chars = () => openChars((id) => { S.focus = id; }, () => { S.focus = null; closeScreens(); showTitleMenu('main', 'chars'); });
  MENU_CB.resume = () => resume();
  MENU_CB.retry = () => { resume(); hideScreens(); respawn(true); };
  MENU_CB.quit = () => { resume(); hideScreens(); enterTitle(false); };
  MENU_CB.continue = () => { G.run.score = 0; G.run.lives = 3; G.run.continues++; G.run.hits = 0; hideScreens(); respawn(true); };
  MENU_CB.again = () => startMission();
  MENU_CB.next = () => afterResults();
  MENU_CB.toSelect = () => { hideScreens(); enterTitle(false); openSelectScreen(); };
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
  if (CUR !== STAGES[0]) useStage(STAGES[0]);
  G.rail.d = CUR.attract[0];
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
  S.focus = null;
  closeScreens();
  clearFlybys();
  refreshTitleInfo();
  showScreen('title');
  titleReset();
  if (AudioSys.ready) { titlePressed(); AudioSys.playMusic('title', { fade: 1.2 }); }
  S.titleStarted = AudioSys.ready;
}

// Attract-mode formation sits behind the leader so the orbiting camera never clips a wingman.
const TITLE_SLOTS = { kota: { ds: -70, u: 34, v: 38 }, gantetsu: { ds: -90, u: -20, v: 33 }, rio: { ds: -120, u: 10, v: 46 } };
function titleFormation() { for (const w of WING.list) w.override = TITLE_SLOTS[w.id]; }

const pad2 = (n) => String(n).padStart(2, '0');
function refreshTitleInfo() {
  const P = progress(), st = P.story;
  refreshTitle({
    best: P.best.azure || null,
    canSelect: MISSIONS.some(m => m.def && P.cleared[m.id]),
    cont: st ? { label: `MISSION ${pad2(st.stage + 1)}${MISSIONS[st.stage]?.def ? '' : '（準備中）'}` } : null,
    hasSave: !!st,
    footR: st ? `STORY · MISSION ${pad2(st.stage + 1)}` : 'MISSION 01 · AZURE COAST',
  });
}

// ============================================================ Story flow
// title → (prologue) → briefing → mission → results → talk → next briefing … or "to be continued"
function newStory() {
  AudioSys.sfx('uiSelect');
  CAMP.mode = 'story'; CAMP.stage = 0; CAMP.carry = freshCarry(G.settings.difficulty);
  S.bg = 'attract';
  const P = progress();
  if (P.seen.prologue) { briefingFor(0); return; }
  P.seen.prologue = true; saveProgress();
  openStory('PROLOGUE', PROLOGUE, () => briefingFor(0));
}
function continueStory() {
  const st = progress().story;
  if (!st) return;
  AudioSys.sfx('uiSelect');
  CAMP.mode = 'story'; CAMP.stage = st.stage; CAMP.carry = { ...st.carry };
  S.bg = 'attract';
  briefingFor(st.stage);
}
function passwordOk(res) {
  CAMP.mode = 'story'; CAMP.stage = res.stage; CAMP.carry = res.carry;
  S.bg = 'attract';
  setTimeout(() => { if (screenActive() === 'password') briefingFor(res.stage); }, 700);   // let the OK message show
}
function openSelectScreen() {
  openSelect((no) => { CAMP.mode = 'select'; CAMP.stage = no - 1; S.bg = 'attract'; briefingFor(no - 1); },
    () => { closeScreens(); showTitleMenu('main', 'select'); });
}
// Briefing for mission index i (story: also the save point and the password for this point).
function briefingFor(i) {
  const def = MISSIONS[i]?.def;
  if (!def) { tbcFor(i); return; }
  const story = CAMP.mode === 'story';
  if (story) saveStoryPoint(i, CAMP.carry);
  G.state = 'briefing';
  openBriefing(def, {
    password: story ? encodePassword(i, CAMP.carry) : null,
    carry: story ? CAMP.carry : null,
    onSortie: () => startMission(),
    onBack: () => {
      if (S.bg !== 'attract') { hideScreens(); enterTitle(false); return; }
      G.state = 'title'; closeScreens(); refreshTitleInfo();
      if (story) showTitleMenu('story', 'continue'); else openSelectScreen();
    },
  });
}
function tbcFor(i) {
  const afterClear = G.state === 'talk';
  G.state = 'tbc';
  openTbc(i + 1, CAMP.mode === 'story' ? encodePassword(i, CAMP.carry) : null, () => { hideScreens(); enterTitle(false); }, afterClear);
}
function afterResults() {
  hideScreens();
  G.state = 'talk';
  S.bg = 'clear';
  fadeTo(0, 0.8);   // the results dimmed the scene
  if (CAMP.mode === 'story' && CUR.talk?.length) openTalk(CUR.talk, () => briefingFor(CAMP.stage));
  else briefingFor(CAMP.stage);
}
function applyCarry(run, c) {
  run.lives = c.lives; run.bombs = c.bombs; run.laser = c.laser;
  if (c.max140) run.maxShield = run.shield = 140;
  run.frags = c.frags; run.squad = c.squad;
}

function startMission() {
  if (S.transition) return;
  S.transition = true;
  hideScreens(); closeScreens();
  fadeTo(1, 0.6, () => {
    S.transition = false;
    const def = MISSIONS[CAMP.stage].def;
    if (CUR !== def) { useStage(def); warmStage(); }
    const story = CAMP.mode === 'story';
    G.run = newRun(story ? CAMP.carry.diff : G.settings.difficulty);
    if (story) applyCarry(G.run, CAMP.carry);
    G.run.startTime = G.time;
    setupStage(0, true);
  });
}

// Compile the shaders of things that first appear mid-mission (the boss, the stage's own set pieces) while the
// screen is still black, so they don't stall the game when they show up.
function warmStage() {
  for (const o of [BOSS.inst.root, ...(CUR.warm?.() || [])]) {
    try { G.renderer.compile(o, G.camera, G.scene); } catch (e) { /* best effort */ }
  }
}

// Prepare the world for play starting at distance d
function setupStage(d, intro) {
  hideScreens(); closeScreens(); clearFlybys();
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
  CUR.onSetup?.(d, G.run);
  resetCamera(ship);
  CAM.override = null;
  resetHUDCache();
  hudVisible(true);
  POST.letterbox = intro ? 1 : 0;
  S.intro = intro ? { t: 0 } : null;
  S.bossCine = null;
  if (d < CUR.bossAt) AudioSys.playMusic(CUR.music, { fade: 0.4 });
  else AudioSys.stopMusic(0.5);
  fadeTo(0, 0.8);
  if (intro) {
    after(0.8, () => banner(`MISSION ${String(CUR.no).padStart(2, '0')}`, CUR.title, CUR.sub, 3.6));
  } else if (d > 0) {
    banner('RESTART', d >= CUR.bossAt ? 'BOSS' : 'CHECKPOINT', '', 2);
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
  sortieAll(1.8, 8);            // the squadron overtakes the leader as the boss surfaces
  S.bossCine = { t: 0 };
  POST.letterbox = 1;
  const info = CUR.boss;
  info.introLines.forEach((L, i) => radio(L.who, L.text, { prio: i === 0 ? 2 : 0, hold: L.hold ?? 1.2 }));
  after(info.bannerAt ?? 3.2, () => { banner('WARNING', info.en, info.title, 3, 'boss'); });
  after(6.2, () => { if (B.active && B.phase !== 'dying') bossBar(true, info); });
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
  CUR.onClear?.(G.run);
  WING.list.forEach((w, i) => after(2.4 + i * 0.35, () => { if (!w.gone) { w.barrelRoll(); AudioSys.sfx('roll', { vol: 0.5, pan: i - 1 }); } }));
  setWingStance('front');
  const absent = CUR.absent?.(G.run) || [];
  for (const w of WING.list) {
    if (absent.includes(w.id)) continue;
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
  const R = CUR.rank;
  const rank = run.hits >= R.S && run.deaths === 0 ? 'S' : run.hits >= R.A ? 'A' : run.hits >= R.B ? 'B' : 'C';
  const medal = run.hits >= R.medal;
  const mm = Math.floor(run.time / 60), ss = Math.floor(run.time % 60);
  const rows = [
    { label: 'HITS 撃墜数', value: run.hits },
    { label: 'SCORE スコア', value: run.score },
    { label: 'HIT BONUS', value: hitBonus },
    { label: 'SHIELD BONUS', value: shieldBonus, note: `${Math.round(run.shield / run.maxShield * 100)}%` },
    { label: 'LIFE BONUS', value: lifeBonus, note: `×${run.lives}` },
    { label: 'NO MISS', value: nomiss },
  ];
  const isBest = recordClear(CUR.id, { score: total, hits: run.hits, rank, medal });
  let storyLine = '';
  if (CAMP.mode === 'story') {
    // carry the squad's state into the next mission and move the story save point there
    const c = CAMP.carry;
    CAMP.carry = {
      diff: c.diff, lives: run.lives, bombs: run.bombs, laser: run.laser, max140: run.maxShield >= 140,
      score: c.score + total, frags: (run.frags || 0) | c.frags, squad: CUR.squadAfter ? CUR.squadAfter(run, c.squad) : c.squad,
    };
    CAMP.stage += 1;
    saveStoryPoint(CAMP.stage, CAMP.carry);
    storyLine = `<br>ストーリー合計 <b>${CAMP.carry.score.toLocaleString()}</b>`;
  }
  const meta = `命中率 <b>${acc}%</b>　リング <b>${run.rings}</b>　タイム <b>${mm}:${String(ss).padStart(2, '0')}</b><br>${CUR.resultNote?.(run) ?? ''}${isBest ? '　<b>NEW RECORD!</b>' : ''}${storyLine}`;
  G.state = 'results';
  hudVisible(false);
  showResults({ rows, total, rank, medal, meta, sub: CUR.resultSub, mode: CAMP.mode });
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
  const focus = S.focus === 'player' ? ship : S.focus ? WING.byId[S.focus] : null;
  if (focus && !focus.gone) { focusCamera(dt, focus.pos, t); return; }
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

// Character page: orbit close around one ship, framed low and right of centre (the profile panel sits above it).
// The camera offset is smoothed in the ship's own frame, so it never trails behind a ship that is flying on.
const _focusOff = new THREE.Vector3();
function focusCamera(dt, p, t) {
  const o = CAM.override;
  if (S.focusFor !== S.focus) { S.focusFor = S.focus; _focusOff.subVectors(o.pos, p); }
  railFrame(G.rail.d, _p, _f, _r);
  const a = 0.9 + t * 0.3, r = 19;
  _v.set(0, 3, 0).addScaledVector(_r, Math.sin(a) * r).addScaledVector(_f, Math.cos(a) * r);
  _focusOff.lerp(_v, 1 - Math.exp(-5 * dt));
  o.pos.copy(p).add(_focusOff);
  _v.subVectors(p, o.pos).normalize();
  _v2.crossVectors(_v, THREE.Object3D.DEFAULT_UP).normalize();
  o.target.copy(p).addScaledVector(_v2, -3.2);
  o.target.y += 3.4;
  o.fov = 46;
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
  POST.letterbox = Math.min(1, t / 0.8);
  if (G.state === 'clear' && CUR.clearShot?.(t, CAM.override, ship)) return;   // the stage's own cut (mission 02: the warp)
  const a = -0.6 + t * 0.35;
  const r = 26 + t * 1.2;
  CAM.override.pos.copy(ship.pos).addScaledVector(_r, Math.sin(a) * r).addScaledVector(_f, Math.cos(a) * r).setY(ship.pos.y + 4 + t * 0.6);
  CAM.override.target.copy(ship.pos);
  CAM.override.fov = 52;
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
    if (BOSS.inst.active && BOSS.inst.blocksFlare?.(_v)) target = 0;
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
  if (manual()) return;
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
  else if (G.state === 'briefing' || G.state === 'talk' || G.state === 'tbc') updateInterlude(dt, rdt);
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
  } else if (screenActive()) updateScreens(rdt);   // characters, mission select, password, prologue
  else {
    if (Input.pressed('back') && menuBack()) { /* closed sub menu */ }
    else updateMenus();
  }
  if (S.fade == null && POST.fade > 0.99 && S.t === 0) fadeTo(0, 1.4);
  S.t += rdt;
  attract(rdt);
}

// Briefing, talk and "to be continued" play over whatever was on screen: the title fly-through or the clear orbit.
function updateInterlude(dt, rdt) {
  if (S.bg === 'clear') { S.t += rdt; G.rail.d += G.rail.speed * dt; clearCamera(dt); simulate(dt, rdt, false); }
  else attract(rdt);
  updateScreens(rdt);
}

// attract mode: gentle cruise over the sunset sea
function attract(rdt) {
  const t = G.clock;
  ship.autoPilot.u = Math.sin(t * 0.23) * 14;
  ship.autoPilot.v = 24 + Math.sin(t * 0.37) * 6;
  G.rail.speed = 45;
  G.rail.d += G.rail.speed * rdt;
  if (G.rail.d > CUR.attract[1]) { G.rail.d = CUR.attract[0]; resetTerrain(); updateTerrain(G.rail.d, true); resetWingmen(true); titleFormation(); }
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
  if (S.t > (CUR.clearTime ?? 8.5) && !S.clearDone) { S.clearDone = true; fadeTo(0.55, 0.8, finishRun); }
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
  CUR.onUpdate?.(dt, gameplay);
  updateWingmen(dt);
  updateProps(dt);
  updateEnemyBullets(dt, ship);
  updateWorld(dt, G.rail.d, ship.pos);
  updateCamera(rdt, ship);
  updateLights(dt, ship.pos);
  ship.updateTrails(G.camera.position);
  updateWingmenTrails(G.camera.position);
  updateFlybys(dt);
  updateFX(dt);
  updateHUD(dt, rdt);
}

// ============================================================ Start (supports hot-reload hooks when hosted)
const hot = typeof window !== 'undefined' ? window.claude?.hot : null;
try { hot?.snapshot?.(() => ({ settings: G.settings })); } catch (e) { /* optional */ }
const start = () => { boot().catch(err => { console.error(err); const m = document.getElementById('loadmsg'); if (m) m.textContent = 'ERROR: ' + (err?.message || err); }); };
if (hot?.ready) { try { hot.ready(start); } catch (e) { start(); } } else start();
