// Stage script: MISSION 01 "AZURE COAST" — ocean → red-rock canyon → fortress → boss at sea.
import * as THREE from 'three';
import { G, rand, clamp, emit, on, after } from './core.js';
import { spawnEnemy, wave, makeGroup } from './enemies.js';
import { scheduleProp, clearSchedule, resetProps, spawnProp } from './props.js';
import { radio, tip, banner, warning, bossBar, addMarker, clearMarkers } from './hud.js';
import { WING, setWingMode, setWingStance, holdOut } from './wingmen.js';
import { BOSS } from './boss.js';
import { AudioSys } from './audio.js';

export const CHECKPOINTS = [0, 6100, 10700];
const WING_REAR_AT = 640;   // the wingmen fly in front until here, then mostly behind the camera
const EVENTS = [];
const at = (d, fn) => EVENTS.push({ d, fn });
let idx = 0;

const D = () => G.rail.d;
const K = (k) => `<kbd>${k}</kbd>`;

// ------------------------------------------------------------ Wave helpers
function vWing(type, n, dist, v, opts = {}) {
  return wave(type, 'approach', n, (i) => {
    const c = i - (n - 1) / 2;
    return { s: D() + dist + Math.abs(c) * 14, u: (opts.u ?? 0) + c * 11, v: v + Math.abs(c) * 3, speed: opts.speed ?? 28, au: opts.au ?? 6, fu: 0.9, ph: 0, av: 3 };
  }, opts);
}
function snake(type, n, dist, u0, v, opts = {}) {
  return wave(type, 'approach', n, (i) => ({ s: D() + dist + i * 32, u: u0, au: opts.au ?? 26, fu: 1.3, ph: i * 0.55, v, av: 6, fv: 1.7, speed: opts.speed ?? 22 }), opts);
}
function fromBehind(type, n, opts = {}) {
  return wave(type, 'behind', n, (i) => ({ rel: 62 + i * 7, u0: (i % 2 ? 1 : -1) * (12 + i * 4), u: (i - (n - 1) / 2) * 14, v0: 34, v: 18 + (i % 3) * 7, dist: 110 + (i % 2) * 30, stay: opts.stay ?? 6, ph: i }), opts);
}
function holders(type, n, dist, opts = {}) {
  return wave(type, 'hold', n, (i) => ({ s: D() + 700, dist: dist + i * 25, enter: 2.4, stay: opts.stay ?? 7, u: (i - (n - 1) / 2) * 30, au: 16, fu: 0.7, ph: i * 1.7, v: opts.v ?? 26, av: 8 }), opts);
}
function ringOf(type, n, dist, opts = {}) {
  return wave(type, 'circle', n, (i) => ({ s: D() + 700, dist, enter: 2.6, stay: opts.stay ?? 7, r: opts.r ?? 18, a0: i / n * Math.PI * 2, spin: 1.3, u: opts.u ?? 0, v: opts.v ?? 26 }), opts);
}
function crossing(type, n, dist, dir, v, opts = {}) {
  return wave(type, 'cross', n, (i) => ({ dist: dist + i * 6, u0: -dir * (100 + i * 18), su: dir * 42, v: v + (i % 2) * 6, av: 4, ph: i }), opts);
}
function divers(type, n, opts = {}) {
  return wave(type, 'dive', n, (i) => ({ s: D() + 520 + i * 40, speed: 20, dur: 3.5, v0: 110, v: 14 + (i % 2) * 8, u: (i - (n - 1) / 2) * 18, au: 8, ph: i }), opts);
}
function turret(s, u, opts = {}) { return spawnEnemy(opts.type || 'turret', 'fixed', { s, u, v: opts.v ?? 0, onGround: opts.onGround, minY: opts.minY }, opts); }
function mine(s, u, v) { return spawnEnemy('mine', 'fixed', { s, u, v, bob: 3, ph: Math.random() * 6 }); }

// ------------------------------------------------------------ Script
function buildScript() {
  EVENTS.length = 0;
  clearSchedule();

  // ===== OCEAN =====
  at(120, () => radio('hou', 'こちらホウ司令。ランサー隊、アクエリア沿岸に敵の侵攻部隊を確認した。全機、迎撃に向かえ！', { hold: 2.2 }));
  at(520, () => radio('kota', 'よーし、いっくぞー！　隊長、しっかりついてくからね！'));
  at(330, () => tip(`${K('W')}${K('A')}${K('S')}${K('D')} / 矢印キー：移動　${K('J')} / ${K('Space')}：ショット`, 6, '左下をドラッグで移動 ／ FIRE でショット'));
  at(WING_REAR_AT, () => setWingStance('rear', 0.5));   // after Kota's "I'll stick with you": the squadron drops back to cover the leader
  at(700, () => { vWing('dart', 5, 760, 20, { noFire: true }); });
  at(820, () => radio('gantetsu', '前方に敵編隊。落ち着いて、一機ずつ確実に落とせ。'));
  at(1250, () => snake('dart', 5, 720, 18, 20));
  at(1400, () => { scheduleNow('ring', 1750, { u: -8, v: 18 }); });
  at(960, () => radio('rio', '前方にリング。通るとシールドが回復するわ。'));
  at(1700, () => { fromBehind('dart', 6); radio('kota', '後ろから来るよ！　抜かせて撃っちゃえ！', { prio: 1 }); });
  at(2150, () => crossing('dart', 5, 230, 1, 24));
  at(2350, () => radio('gantetsu', '岩のアーチだ。くぐり抜けろ！'));
  at(2500, () => { holders('raptor', 2, 170); });
  at(2560, () => { radio('gantetsu', '敵弾はローリングではじける。傾けるキーを素早く2回だ！', { prio: 1 }); tip(`${K('Q')} / ${K('E')} を素早く2回：ローリング（敵弾をはじく）`, 7, 'ROLL ボタン：ローリング（敵弾をはじく）'); });
  at(3000, () => { ringOf('drone', 8, 190, { r: 20 }); radio('rio', 'ショットを長押しでチャージ！　ロックオンしてまとめて吹き飛ばして！', { prio: 1 }); tip(`ショット長押し → チャージ完了で離す：ロックオン弾`, 7, 'FIRE 長押し → 離す：ロックオン弾'); });
  at(3400, () => { holders('carrier', 1, 150, { carry: 'laser', carryIndex: 0, stay: 8, v: 24 }); snake('dart', 3, 650, -20, 26); radio('kota', 'あの輸送機、何か積んでるよ！　撃ち落として！'); });
  at(3850, () => rescueKota());
  at(4300, () => { fromBehind('interceptor', 4, { stay: 5 }); });
  at(4500, () => { radio('gantetsu', '峡谷に入るぞ。岩壁に擦るなよ。'); tip(`${K('L')} / ${K('Shift')}：ブースト　${K('I')} / ${K('V')}：ブレーキ`, 6, 'BOOST / BRAKE ボタンで加減速'); });
  at(4680, () => { gunshipFlyby(); });

  // ===== CANYON =====
  at(4950, () => radio('rio', '岩柱が倒れてくる！　撃てば砕けるわ！', { prio: 1 }));
  at(5250, () => divers('dart', 4));
  at(5500, () => { turret(5850, -34); turret(5930, 30); turret(6010, -12); });
  at(5900, () => { holders('raptor', 1, 160, { v: 22 }); snake('dart', 4, 700, 10, 22, { au: 18 }); });
  at(6150, () => { radio('rio', '中間地点を通過。いい調子よ、隊長。'); });
  at(6300, () => { turret(6720, -26, { onGround: false, v: 33 }); turret(6720, 26, { onGround: false, v: 33 }); radio('gantetsu', '橋の上に砲台だ。下をくぐるか、先に潰せ！'); });
  at(6700, () => { ringOf('drone', 10, 200, { r: 22, v: 30 }); });
  at(7050, () => { for (let i = 0; i < 8; i++) mine(7450 + i * 45, rand(-30, 30), rand(10, 40)); radio('kota', '機雷だ！　近づくと爆発するよ！'); });
  at(7300, () => { fromBehind('interceptor', 5); radio('kota', 'また後ろ！　しつこいなぁ、もう！', { prio: 1 }); });
  at(7700, () => { holders('raptor', 2, 170, { v: 30 }); crossing('drone', 6, 240, -1, 20); });

  // ===== FORTRESS =====
  at(7900, () => radio('hou', '前方に敵の前線基地を確認。防衛網を突破せよ！', { hold: 2 }));
  at(8150, () => { turret(8600, -60, { type: 'aagun' }); turret(8700, 60, { type: 'aagun' }); turret(8850, -58, { type: 'aagun' }); });
  at(8300, () => { divers('interceptor', 4); });
  at(8650, () => { radio('gantetsu', 'エネルギーゲートだ！　両脇の発生装置を撃て！', { prio: 1 }); });
  at(8900, () => { vWing('dart', 7, 700, 24, { speed: 34 }); });
  at(9250, () => { turret(9600, -40); turret(9660, 40); turret(9760, 0); turret(9850, -20, { type: 'aagun' }); });
  at(9500, () => { crossing('dart', 6, 220, -1, 30); });
  at(9800, () => { fromBehind('interceptor', 6); holders('raptor', 2, 190, { v: 34 }); });
  at(10150, () => { ringOf('drone', 10, 200, { r: 24, v: 28 }); });
  at(10350, () => radio('gantetsu', '基地を抜けるぞ！　全機、上昇して海へ出ろ！'));

  // ===== BOSS =====
  at(10550, () => { radio('hou', '待て……海中から巨大な反応！　警戒しろ！', { prio: 2, hold: 1.4 }); warning(true); AudioSys.stopMusic(1.2); G.warnLoop = AudioSys.loop('siren'); });
  at(10720, () => { G.run.checkpoint = 10700; });
  at(10760, () => { warning(false); if (G.warnLoop) { G.warnLoop.stop(0.5); G.warnLoop = null; } emit('bossStart'); });

  // ----- props -----
  scheduleProp('ring', 1150, { u: 0, v: 22 });
  scheduleProp('arch', 2650, { u: 0 });
  scheduleProp('ring', 2650, { u: 0, v: 14 });
  scheduleProp('stack', 2960, { u: -28, scale: 1 });
  scheduleProp('stack', 3080, { u: 32, scale: 1.1 });
  scheduleProp('stack', 3230, { u: 2, scale: 0.9 });
  scheduleProp('ring', 3600, { u: 20, v: 30 });
  scheduleProp('ring', 4150, { kind: 'gold', u: -34, v: 9 });
  scheduleProp('pillar', 5350, { u: 36, side: 1 });
  scheduleProp('ring', 5500, { u: 0, v: 18 });
  scheduleProp('pillar', 5750, { u: -36, side: -1 });
  scheduleProp('ring', 6100, { kind: 'check', u: 0, v: 24 });
  scheduleProp('bridge', 6720, { u: 0, v: 30 });
  scheduleProp('ring', 6720, { u: 0, v: 14 });
  scheduleProp('ring', 6900, { kind: 'gold', u: 38, v: 50 });
  scheduleProp('pillar', 7250, { u: 34, side: 1, maxAngle: 1.0 });
  scheduleProp('ring', 7600, { u: -14, v: 26 });
  scheduleProp('tower', 8400, { u: -24, h: 95 });
  scheduleProp('tower', 8520, { u: 26, h: 75 });
  scheduleProp('tower', 8640, { u: 0, h: 38 });
  scheduleProp('gate', 9050, { u: 0, w: 30 });
  scheduleProp('ring', 9250, { u: 0, v: 20 });
  scheduleProp('tower', 9450, { u: 30, h: 110 });
  scheduleProp('tower', 9560, { u: -30, h: 85 });
  scheduleProp('gate', 9900, { u: 0, w: 28 });
  scheduleProp('ring', 10000, { kind: 'gold', u: 0, v: 56 });
  scheduleProp('ring', 10300, { u: 0, v: 26 });
  EVENTS.sort((a, b) => a.d - b.d);
}

function scheduleNow(type, s, o) { spawnProp(type, s, o); }

// Gunship crossing overhead, carrying a bomb
function gunshipFlyby() {
  spawnEnemy('gunship', 'flyby', { s: D() + 900, dist: 260, enter: 4, close: 3, u0: 80, su: -8, v: 40, life: 20 }, { carry: 'bomb' });
  radio('gantetsu', '大型艦だ！　砲撃に注意しつつ集中攻撃しろ！', { prio: 1 });
  tip(`大型艦には ${K('K')} / ${K('B')} のスマートボムが有効`, 5, '大型艦には BOMB が有効');
}

// Wingman rescue event
function rescueKota() {
  const kota = WING.byId.kota;
  if (!kota || kota.gone) return;
  kota.mode = 'chased'; kota.modeT = 0;
  radio('kota', 'うわっ！　後ろに付かれた！　隊長、助けてー！', { prio: 2 });
  const anchor = kota;
  const marker = addMarker(kota.pos, 'KOTA', '#ffb070');
  let resolved = false;
  const group = makeGroup(() => {
    if (resolved) return;
    resolved = true;
    marker.active = false;
    kota.mode = 'formation'; kota.modeT = 0; kota.barrelRoll();
    holdOut(kota, 5);
    if (group.byPlayer > 0) { G.run.savedKota = true; emit('bonus', 3000, kota.pos.clone(), 'RESCUE +3000'); }
    radio('kota', '助かったぁ！　隊長、恩に着るよ！', { prio: 1 });
  });
  for (let i = 0; i < 3; i++) {
    spawnEnemy('dart', 'chase', { anchor, back: 20 + i * 9, ou: (i - 1) * 7, ov: (i - 1) * 3, ph: i, s: kota.s - 40, u: kota.u, v: kota.v }, { group, noFire: true });
  }
  after(16, () => {
    if (resolved) return;
    resolved = true;
    marker.active = false;
    kota.mode = 'retreat'; kota.modeT = 0; kota.damaged = true;
    G.run.kotaLost = true;
    radio('kota', 'くっ……被弾した！　ごめん、いったん離脱する！', { prio: 1 });
  });
}

// ------------------------------------------------------------ Runner
export function initLevel() {
  buildScript();
  // boss radio hooks
  on('bossPhase', (p) => {
    if (p === 1) { radio('rio', 'あれが敵の新型……ミズチ！　まず背中の砲台を叩いて！', { prio: 1 }); }
    if (p === 2) { radio('rio', '砲台は全滅！　口が開いた瞬間、中のコアを狙って！', { prio: 2 }); }
    if (p === 3) { radio('mizuchi', '……ハイジョ……ハイジョ、スル……', { prio: 2, hold: 1.2 }); radio('kota', 'お、怒ってる！？　みんな気をつけて！'); }
  });
  let firstCharge = true;
  on('bossCharge', () => { if (firstCharge) { firstCharge = false; radio('gantetsu', 'ビームが来るぞ！　射線から外れろ！', { prio: 2, hold: 1 }); } });
  on('bossDying', () => radio('mizuchi', 'ガ……ガガ……キノウ、テイ……シ……', { prio: 2, hold: 0.8 }));
}

export function startLevel(fromD) {
  setWingStance(fromD < WING_REAR_AT ? 'front' : 'rear');
  idx = 0;
  while (idx < EVENTS.length && EVENTS[idx].d < fromD) idx++;
  resetProps(fromD);
  clearMarkers();
}

export function updateLevel() {
  while (idx < EVENTS.length && G.rail.d >= EVENTS[idx].d) { const e = EVENTS[idx++]; e.fn(); }
}
