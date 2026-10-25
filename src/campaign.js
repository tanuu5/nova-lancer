// Campaign: story runs vs mission-select runs, what carries over between stages, the saved progress
// (cleared missions, bests, where the story stands, who has been met) and the password that restores a story.
import { mulberry32, loadBest } from './core.js';

// ------------------------------------------------------------ Carry-over between story stages
// diff: difficulty for the whole story, max140: the gold-ring shield upgrade, score: story total so far,
// frags: spear fragments (bit per stage), squad: wingmen still under repair (bit 0 = Kota).
export function freshCarry(diff = 'normal') { return { diff, lives: 3, bombs: 3, laser: 0, max140: false, score: 0, frags: 0, squad: 0 }; }

// mode 'story' carries `carry` from stage to stage; 'select' replays one cleared mission with the default loadout.
export const CAMP = { mode: 'story', stage: 0, carry: freshCarry() };

// ------------------------------------------------------------ Saved progress
// iPhone Safari may wipe a site's storage after about a week without a visit, so nothing here is precious:
// the story can always be resumed from a password.
const PROGRESS_KEY = 'novaLancer.progress.v1';
let P = null;

export function progress() { return P || (P = loadProgress()); }

function loadProgress() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null'); } catch (e) { /* storage unavailable */ }
  if (!p || p.v !== 1) {
    p = { v: 1 };
    // Before story mode there was a single best score, which was mission 01's.
    const old = loadBest();
    if (old && old.score > 0) { p.cleared = { azure: true }; p.best = { azure: { score: old.score, hits: old.hits, rank: old.rank, medal: false } }; }
  }
  p.cleared ||= {};
  p.best ||= {};
  p.story ||= null;           // { stage: index of the mission to play next, carry }
  p.seen ||= {};
  p.seen.chars ||= {};
  return p;
}

export function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress())); } catch (e) { /* ignore */ }
}

export function saveStoryPoint(stage, carry) { progress().story = { stage, carry: { ...carry } }; saveProgress(); }

// Record a cleared mission; returns true when the score is a new best for it.
export function recordClear(id, result) {
  const p = progress();
  p.cleared[id] = true;
  const b = p.best[id];
  const isBest = !b || result.score > b.score;
  if (isBest) p.best[id] = { ...result, medal: result.medal || !!b?.medal };
  else if (result.medal && !b.medal) b.medal = true;
  saveProgress();
  return isBest;
}

export function markSeen(id) {
  const c = progress().seen.chars;
  if (!c[id]) { c[id] = true; saveProgress(); }
}
export const seen = (id) => !!progress().seen.chars[id];

// ------------------------------------------------------------ Password
// 50 bits → 10 characters of Crockford base32 (no I, L, O, U), shown as XXXXX-XXXXX:
//   version 2 | stage 3 | difficulty 2 | lives 4 | bombs 4 | laser 2 | max140 1 | frags 6 | squad 3 | score/1000 14 | check 9
// The bits are XORed with a fixed pseudo-random mask so that neighbouring states don't look alike.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const FIELDS = [['ver', 2], ['stage', 3], ['diff', 2], ['lives', 4], ['bombs', 4], ['laser', 2], ['max140', 1], ['frags', 6], ['squad', 3], ['score', 14]];
const CHECK_BITS = 9, TOTAL_BITS = 50;
const DIFFS = ['easy', 'normal', 'hard'];
const MASK = (() => { const r = mulberry32(0x4e4c4e43); return Array.from({ length: TOTAL_BITS }, () => (r() < 0.5 ? 1 : 0)); })();

function checksum(bits) {
  let h = 0x2f1;
  for (let i = 0; i < bits.length; i++) h = (Math.imul(h ^ bits[i], 0x5bd1e995) + i) >>> 0;
  return (h ^ (h >>> 13)) & ((1 << CHECK_BITS) - 1);
}

export function encodePassword(stage, carry) {
  const v = {
    ver: 1, stage, diff: Math.max(0, DIFFS.indexOf(carry.diff)), lives: Math.min(15, carry.lives), bombs: Math.min(15, carry.bombs),
    laser: carry.laser, max140: carry.max140 ? 1 : 0, frags: carry.frags & 63, squad: carry.squad & 7, score: Math.min(16383, Math.floor(carry.score / 1000)),
  };
  const bits = [];
  for (const [k, n] of FIELDS) for (let b = n - 1; b >= 0; b--) bits.push((v[k] >> b) & 1);
  const c = checksum(bits);
  for (let b = CHECK_BITS - 1; b >= 0; b--) bits.push((c >> b) & 1);
  let s = '';
  for (let i = 0; i < TOTAL_BITS; i += 5) {
    let x = 0;
    for (let b = 0; b < 5; b++) x = (x << 1) | (bits[i + b] ^ MASK[i + b]);
    s += ALPHA[x];
  }
  return s.slice(0, 5) + '-' + s.slice(5);
}

// Accepts lower case, spaces/hyphens, and O/I/L for 0/1/1. Returns { stage, carry } or null.
export function decodePassword(text) {
  const s = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 10) return null;
  const bits = [];
  for (let i = 0; i < 10; i++) {
    const x = ALPHA.indexOf(s[i]);
    if (x < 0) return null;
    for (let b = 4; b >= 0; b--) bits.push(((x >> b) & 1) ^ MASK[i * 5 + (4 - b)]);
  }
  const data = bits.slice(0, TOTAL_BITS - CHECK_BITS);
  let c = 0;
  for (let i = TOTAL_BITS - CHECK_BITS; i < TOTAL_BITS; i++) c = (c << 1) | bits[i];
  if (checksum(data) !== c) return null;
  const v = {};
  let o = 0;
  for (const [k, n] of FIELDS) { let x = 0; for (let b = 0; b < n; b++) x = (x << 1) | data[o++]; v[k] = x; }
  if (v.ver !== 1 || v.stage > 6 || v.diff > 2 || v.bombs > 9 || v.laser > 2) return null;
  return { stage: v.stage, carry: { diff: DIFFS[v.diff], lives: v.lives, bombs: v.bombs, laser: v.laser, max140: !!v.max140, score: v.score * 1000, frags: v.frags, squad: v.squad } };
}

export const PASSWORD_CHARS = ALPHA;
