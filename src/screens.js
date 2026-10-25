// Story-mode screens: briefing, post-clear talk, prologue, "to be continued", mission select, characters and
// password entry. They are DOM screens from template.html; main.js opens them and calls updateScreens(rdt) each frame.
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { portraitSVG, CHARACTERS } from './portraits.js';
import { Menu, showScreen, setMenu, updateMenus } from './hud.js';
import { MISSIONS } from './stages/index.js';
import { PROFILES } from './profiles.js';
import { progress, seen, markSeen, decodePassword, PASSWORD_CHARS } from './campaign.js';

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');

let active = null;   // { name, update(rdt) }
export const screenActive = () => active?.name || null;
export function closeScreens() { active = null; }
export function updateScreens(rdt) { active?.update(rdt); }
function open(name, update) { showScreen(name); active = { name, update }; }

const SHIP_ICON = '<svg viewBox="0 0 34 34" aria-hidden="true"><path d="M17 4 L21 17 L31 21 L21 23.5 L17 30 L13 23.5 L3 21 L13 17 Z" fill="#7fe7ff" opacity=".85"/></svg>';

// A portrait copy with its own gradient/clip ids, so the same face can sit on several screens at once.
let faceN = 0;
function face(id) { const n = ++faceN; return portraitSVG(id).replace(/(id="|url\(#)([a-z]+)-/g, (m, a, k) => `${a}${k}${n}-`); }

// ============================================================ Typed comm lines with a talking portrait
class Talker {
  constructor(prefix) {
    this.box = $(prefix + '-comm'); this.face = $(prefix + '-face'); this.nameEl = $(prefix + '-name'); this.text = $(prefix + '-text');
    this.done = true;
  }
  play(lines) { this.lines = lines; this.i = -1; this.done = false; this.who = null; this.next(); }
  next() {
    this.i++;
    if (this.i >= this.lines.length) { this.done = true; this.box.classList.remove('wait'); return; }
    const L = this.lines[this.i];
    if (L.who !== this.who) { this.face.innerHTML = face(L.who); this.svg = this.face.querySelector('svg'); this.who = L.who; }
    const C = CHARACTERS[L.who] || { name: String(L.who).toUpperCase(), role: '', color: '#fff' };
    this.nameEl.innerHTML = `<span style="color:${C.color}">${C.nameJa || C.name}</span><small>${C.name} · ${C.role}</small>`;
    this.text.classList.toggle('enemy', !!C.enemy);
    this.text.textContent = '';
    this.chars = [...L.text]; this.shown = 0; this.typeT = 0; this.mouthT = 0; this.blinkT = 1.5;
    this.box.classList.remove('wait');
    markSeen(L.who);
  }
  // the first press finishes the line, the next one moves on
  advance() {
    if (this.done) return;
    if (this.shown < this.chars.length) { this.text.textContent = this.lines[this.i].text; this.shown = this.chars.length; }
    else { AudioSys.sfx('uiMove'); this.next(); }
  }
  // jump to the last line, shown in full
  finish() {
    if (this.done) return;
    this.i = this.lines.length - 2;
    this.next();
    this.text.textContent = this.lines[this.i].text;
    this.shown = this.chars.length;
    this.svg?.classList.remove('open');
    this.done = true;
  }
  update(rdt) {
    if (this.done) return;
    if (this.shown < this.chars.length) {
      this.typeT += rdt * 30;
      while (this.typeT >= 1 && this.shown < this.chars.length) {
        this.typeT -= 1;
        const ch = this.chars[this.shown++];
        this.text.textContent += ch;
        if (this.shown % 2 === 0) AudioSys.voiceBlip(this.who, ch);
      }
      this.mouthT += rdt;
      this.svg?.classList.toggle('open', Math.floor(this.mouthT * 10) % 2 === 0);
    } else {
      this.svg?.classList.remove('open');
      this.box.classList.add('wait');
    }
    blink(this, rdt);
  }
}
function blink(o, rdt) {
  o.blinkT -= rdt;
  if (o.svg && o.blinkT < 0) { o.svg.classList.add('blink'); if (o.blinkT < -0.12) { o.svg.classList.remove('blink'); o.blinkT = 1.5 + Math.random() * 2.5; } }
}

const T = {};   // talkers
const M = {};   // menus
let CB = {};    // callbacks of the screen that is open

export function initScreens() {
  T.br = new Talker('br');
  T.tk = new Talker('tk');
  M.br = new Menu($('br-menu'), (act) => { AudioSys.sfx('uiSelect'); if (act === 'sortie') CB.onSortie(); else CB.onBack(); });
  M.tbc = new Menu($('tbc-menu'), () => { AudioSys.sfx('uiSelect'); CB.onTitle(); });
  M.ch = new Menu($('ch-menu'), () => { AudioSys.sfx('uiBack'); CB.onBack(); });
  M.pw = new Menu($('pw-menu'), () => { AudioSys.sfx('uiBack'); CB.onBack(); });
  $('br-comm').addEventListener('click', () => { if (active?.name === 'briefing') T.br.advance(); });
  $('br-skip').addEventListener('click', () => { if (active?.name === 'briefing') T.br.finish(); });
  $('tk-comm').addEventListener('click', () => { if (active?.name === 'talk') T.tk.advance(); });
  $('tk-skip').addEventListener('click', () => { if (active?.name === 'talk') T.tk.finish(); });
  $('st-box').addEventListener('click', () => { if (active?.name === 'story') storyAdvance(); });
  $('st-skip').addEventListener('click', () => { if (active?.name === 'story') storyEnd(); });
  initPassword();
}

// ============================================================ Briefing
// opts: { password (story only), onSortie, onBack }
export function openBriefing(def, opts) {
  CB = opts;
  $('br-no').textContent = `MISSION ${pad2(def.no)}`;
  $('br-title').textContent = def.title;
  $('br-place').textContent = def.place;
  $('br-map').innerHTML = starMap(def.map?.target);
  $('br-obj').textContent = def.briefing.objective;
  $('br-pass').innerHTML = opts.password
    ? `<span class="lbl">PASSWORD</span><b>${opts.password}</b><small>保存が消えたときは、タイトルの「ストーリー → パスワード」で、この面の始めから続けられます。</small>` : '';
  $('br-menu').hidden = true;
  $('br-skip').hidden = false;
  open('briefing', updateBriefing);
  setMenu(null);
  T.br.play(def.briefing.lines);
}
function updateBriefing(rdt) {
  T.br.update(rdt);
  const menu = $('br-menu');
  if (menu.hidden) {
    if (!T.br.done) {
      if (Input.pressed('confirm')) T.br.advance();
      else if (Input.pressed('pause') || Input.pressed('back')) T.br.finish();
    }
    // the lines can also end between frames, from the SKIP button or a tap on the comm box
    if (T.br.done) { menu.hidden = false; $('br-skip').hidden = true; setMenu(M.br); M.br.focus(0); menu.scrollIntoView({ block: 'nearest' }); }
    return;
  }
  if (Input.pressed('back')) { AudioSys.sfx('uiBack'); CB.onBack(); return; }
  updateMenus();
}

// The Amatera system, seen from above. The mission's planet is ringed and labelled.
const BODIES = [
  { id: 'ignia', name: 'イグニア', r: 36, a: -40, col: '#ff6a3d', size: 4.5 },
  { id: 'aridia', name: 'アリディア', r: 60, a: 205, col: '#f2b45a', size: 5.5 },
  { id: 'aquelia', name: 'アクエリア', r: 86, a: 325, col: '#4fc8ff', size: 6.5 },
  { id: 'silva', name: 'シルヴァ', r: 110, a: 62, col: '#5ed27a', size: 6 },
  { id: 'sargasso', name: 'サルガッソ宙域', r: 132, a: 245, col: '#b28cff', belt: true },
  { id: 'glacia', name: 'グラシア', r: 154, a: 148, col: '#d8f0ff', size: 5.5 },
];
function starMap(target) {
  const cx = 200, cy = 132, k = 0.52, pos = (b, a = b.a) => [cx + b.r * Math.cos(a * Math.PI / 180), cy + b.r * k * Math.sin(a * Math.PI / 180)];
  let s = `<svg viewBox="0 0 400 264" xmlns="http://www.w3.org/2000/svg" font-family="'M PLUS 1', sans-serif">
    <defs><radialGradient id="map-sun"><stop offset="0" stop-color="#fff6d8"/><stop offset=".35" stop-color="#ffc24a"/><stop offset="1" stop-color="#ff7a1e" stop-opacity="0"/></radialGradient></defs>`;
  for (const b of BODIES) s += `<ellipse cx="${cx}" cy="${cy}" rx="${b.r}" ry="${b.r * k}" fill="none" stroke="${b.id === target ? 'rgba(127,231,255,.55)' : 'rgba(127,231,255,.16)'}" stroke-width="${b.belt ? 6 : 1}" ${b.belt ? 'stroke-dasharray="1 5"' : ''}/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="34" fill="url(#map-sun)" opacity=".7"/><circle cx="${cx}" cy="${cy}" r="9" fill="#fff3c4"/>
    <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="8" fill="#ffd27a" letter-spacing="2">恒星アマテラ</text>`;
  for (const b of BODIES) {
    const on = b.id === target;
    if (b.belt) {
      for (let i = 0; i < 22; i++) { const [x, y] = pos(b, b.a - 34 + i * 3.2 + (i % 3) * 0.7); s += `<circle cx="${x.toFixed(1)}" cy="${(y + ((i * 7) % 5) - 2).toFixed(1)}" r="${1 + (i % 3) * 0.5}" fill="${b.col}" opacity="${on ? 1 : 0.55}"/>`; }
    } else {
      const [x, y] = pos(b);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${b.size}" fill="${b.col}" opacity="${on ? 1 : 0.6}"/>`;
    }
    const [x, y] = pos(b);
    if (on) {
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="none" stroke="#7fe7ff" stroke-width="1.5"><animate attributeName="r" values="11;19;11" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;.2;1" dur="1.6s" repeatCount="indefinite"/></circle>
        <text x="${(x + 18).toFixed(1)}" y="${(y - 10).toFixed(1)}" font-size="7" fill="#7fe7ff" letter-spacing="3" font-family="Oxanium, sans-serif">TARGET</text>
        <text x="${(x + 18).toFixed(1)}" y="${(y + 1).toFixed(1)}" font-size="11" font-weight="700" fill="#ffffff">${b.name}</text>`;
    } else {
      s += b.belt ? `<text x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="rgba(200,225,245,.65)">${b.name}</text>`
        : `<text x="${(x + 9).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="8.5" fill="rgba(200,225,245,.65)">${b.name}</text>`;
    }
  }
  return s + '</svg>';
}

// ============================================================ Post-clear talk
export function openTalk(lines, onDone) {
  CB = { onDone };
  open('talk', updateTalk);
  setMenu(null);
  T.tk.play(lines);
}
function updateTalk(rdt) {
  T.tk.update(rdt);
  if (Input.pressed('confirm')) T.tk.advance();
  else if (Input.pressed('pause') || Input.pressed('back')) T.tk.finish();
  if (T.tk.done) { active = null; CB.onDone(); }
}

// ============================================================ Prologue (one page at a time)
const ST = { pages: [], i: 0, shown: 0, t: 0 };
export function openStory(head, pages, onDone) {
  CB = { onDone };
  $('st-head').textContent = head;
  Object.assign(ST, { pages, i: 0 });
  storyPage();
  open('story', updateStory);
  setMenu(null);
}
function storyPage() { ST.chars = [...ST.pages[ST.i]]; ST.shown = 0; ST.t = 0; $('st-text').textContent = ''; $('st-box').classList.remove('wait'); }
function storyAdvance() {
  if (ST.shown < ST.chars.length) { ST.shown = ST.chars.length; $('st-text').textContent = ST.pages[ST.i]; return; }
  AudioSys.sfx('uiMove');
  if (++ST.i >= ST.pages.length) storyEnd(); else storyPage();
}
function storyEnd() { if (active?.name !== 'story') return; active = null; CB.onDone(); }
function updateStory(rdt) {
  if (ST.shown < ST.chars.length) {
    ST.t += rdt * 26;
    while (ST.t >= 1 && ST.shown < ST.chars.length) { ST.t -= 1; $('st-text').textContent += ST.chars[ST.shown++]; if (ST.shown % 3 === 0) AudioSys.sfx('countTick', { vol: 0.12 }); }
  } else $('st-box').classList.add('wait');
  if (Input.pressed('confirm')) storyAdvance();
  else if (Input.pressed('pause') || Input.pressed('back')) storyEnd();
}

// ============================================================ To be continued (the next mission isn't built yet)
export function openTbc(nextNo, password, onTitle, afterClear) {
  CB = { onTitle };
  $('tbc-head').textContent = afterClear ? 'MISSION COMPLETE' : 'STORY';
  $('tbc-sub').textContent = `MISSION ${pad2(nextNo)} は準備中です`;
  $('tbc-pass').innerHTML = password ? `<span class="lbl">PASSWORD</span><b>${password}</b><small>MISSION ${pad2(nextNo)} ができたら、「ストーリー → つづきから」か、このパスワードで続けられます。</small>` : '';
  open('tbc', () => updateMenus());
  setMenu(M.tbc); M.tbc.focus(0);
}

// ============================================================ Mission select
export function openSelect(onPick, onBack) {
  CB = { onBack };
  const P = progress();
  $('sel-list').innerHTML = MISSIONS.map(m => {
    const ok = !!(m.def && P.cleared[m.id]);
    const b = P.best[m.id];
    return `<button class="mi${ok ? '' : ' locked'}" data-act="${ok ? 'm' + m.no : 'locked'}">
      <span class="m-no">MISSION ${pad2(m.no)}</span><span class="m-name">${ok ? m.title : '？？？'}</span>
      <span class="m-best">${ok && b ? `BEST <b>${b.score.toLocaleString()}</b><br>RANK <b>${b.rank}</b>${b.medal ? '　MEDAL' : ''}${P.found?.[m.id] ? '　かけら<b>◆</b>' : ''}` : ''}</span>
      <span class="m-place">${ok ? m.place : ''}</span></button>`;
  }).join('');
  $('sel-actions').innerHTML = '<button class="mi" data-act="back"><span>戻る</span><span class="en">BACK</span></button>';
  M.sel = new Menu($('sel-panel'), (act) => {
    if (act === 'back') { AudioSys.sfx('uiBack'); onBack(); }
    else if (act === 'locked') AudioSys.sfx('uiBack');
    else { AudioSys.sfx('uiSelect'); onPick(+act.slice(1)); }
  });
  open('select', () => { if (Input.pressed('back')) { AudioSys.sfx('uiBack'); onBack(); return; } updateMenus(); });
  setMenu(M.sel); M.sel.focus(0);
}

// ============================================================ Characters
// onFocus(ship) asks main to circle that ship with the title camera ('player', a wingman id, or null).
const CH = { list: [], i: 0, voice: null };
export function openChars(onFocus, onBack) {
  CB = { onFocus, onBack };
  CH.list = PROFILES.map(p => ({ p, known: p.known || seen(p.id) }));
  const el = $('ch-list');
  el.innerHTML = CH.list.map((c, i) => `<button class="ch-item${c.known ? '' : ' unknown'}" data-i="${i}">
    <span class="mini">${c.known && c.p.face ? face(c.p.face) : c.known ? SHIP_ICON : face('')}</span>
    <span>${c.known ? c.p.nameJa : '？？？'}<span class="grp">${c.known ? c.p.group : ''}</span></span></button>`).join('');
  for (const b of el.querySelectorAll('.ch-item')) {
    b.addEventListener('click', () => { if (active?.name === 'chars') pickChar(+b.dataset.i, true); });
  }
  open('chars', updateChars);
  setMenu(M.ch); M.ch.focus(0);
  pickChar(0, false);
}
function pickChar(i, speak) {
  CH.i = (i + CH.list.length) % CH.list.length;
  const { p, known } = CH.list[CH.i];
  $('ch-list').querySelectorAll('.ch-item').forEach((b, k) => b.classList.toggle('sel', k === CH.i));
  $('ch-list').children[CH.i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const f = $('ch-face');
  f.classList.toggle('ship', known && !p.face);
  f.innerHTML = !known ? face('') : p.face ? face(p.face) : `<div>${SHIP_ICON.replace('<svg', '<svg style="position:static;width:58%;height:auto"')}<br>${p.name}</div>`;
  CH.svg = f.querySelector('svg');
  CH.blinkT = 1.5;
  $('ch-role').textContent = known ? `${p.group} · ${p.role}` : '？？？';
  $('ch-name').textContent = known ? p.nameJa : '？？？';
  $('ch-en').textContent = known ? p.name : 'UNKNOWN';
  $('ch-stats').innerHTML = known ? p.stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('') : '';
  $('ch-prof').textContent = known ? p.text : 'まだ出会っていません。';
  $('ch-line').textContent = known && !p.line ? '（無線では喋らない）' : '';
  CH.voice = known && p.line ? { chars: [...p.line], shown: 0, t: speak ? 0 : -0.35, mouthT: 0, who: p.face } : null;
  CB.onFocus(known ? p.ship : null);
  if (speak) AudioSys.sfx('uiMove');
}
function updateChars(rdt) {
  if (Input.pressed('back')) { AudioSys.sfx('uiBack'); CB.onBack(); return; }
  if (Input.menu('mUp') || Input.menu('mLeft')) pickChar(CH.i - 1, true);
  else if (Input.menu('mDown') || Input.menu('mRight')) pickChar(CH.i + 1, true);
  else if (Input.pressed('confirm') && CH.list[CH.i].known && CH.list[CH.i].p.line) pickChar(CH.i, true);   // say it again
  const v = CH.voice;
  if (v && v.shown < v.chars.length) {
    v.t += rdt * 22;
    while (v.t >= 1 && v.shown < v.chars.length) { v.t -= 1; const ch = v.chars[v.shown++]; $('ch-line').textContent += ch; if (v.shown % 2 === 0) AudioSys.voiceBlip(v.who, ch); }
    v.mouthT += rdt;
    CH.svg?.classList.toggle('open', Math.floor(v.mouthT * 10) % 2 === 0);
  } else CH.svg?.classList.remove('open');
  blink(CH, rdt);
}

// ============================================================ Password entry
// Keyboard: type, Backspace, Enter, Esc. Pad: d-pad moves over the grid, A presses, B backs out. Touch: tap.
const PW = { text: '', r: 0, c: 0 };
const PW_ROWS = 4, PW_COLS = 8;   // 32 characters, then a row with 削除 and 決定
function initPassword() {
  const grid = $('pw-grid');
  grid.innerHTML = [...PASSWORD_CHARS].map((ch, i) => `<button class="pw-key" data-r="${(i / PW_COLS) | 0}" data-c="${i % PW_COLS}">${ch}</button>`).join('')
    + `<button class="pw-key wide" data-r="4" data-c="0">← 削除</button><button class="pw-key wide" data-r="4" data-c="4">決定 OK</button>`;
  for (const b of grid.querySelectorAll('.pw-key')) b.addEventListener('click', () => { if (active?.name !== 'password') return; PW.r = +b.dataset.r; PW.c = +b.dataset.c; pwPress(); });
  window.addEventListener('keydown', (e) => {
    if (active?.name !== 'password' || e.repeat) return;
    if (e.key === 'Enter') pwOk();
    else if (e.key === 'Backspace') pwDel();
    else if (e.key === 'Escape') { AudioSys.sfx('uiBack'); CB.onBack(); }
    else if (e.key.startsWith('Arrow')) pwMove(e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
    else if (e.key.length === 1) {
      const ch = e.key.toUpperCase().replace('O', '0').replace(/[IL]/, '1');
      if (PASSWORD_CHARS.includes(ch)) pwType(ch);
    }
  });
}
export function openPassword(onOk, onBack) {
  CB = { onOk, onBack };
  PW.text = ''; PW.r = 0; PW.c = 0;
  pwMsg('', '');
  pwRender();
  open('password', updatePassword);
  setMenu(null);
}
function pwRender() {
  let s = '';
  for (let i = 0; i < 10; i++) { if (i === 5) s += '<i></i>'; s += `<span class="${i === PW.text.length ? 'cur' : ''}">${PW.text[i] || ''}</span>`; }
  $('pw-slots').innerHTML = s;
  for (const b of $('pw-grid').children) {
    const r = +b.dataset.r, c = +b.dataset.c;
    b.classList.toggle('sel', r === PW.r && (r < PW_ROWS ? c === PW.c : (PW.c < 4 ? c === 0 : c === 4)));
  }
}
function pwMsg(text, cls) { const m = $('pw-msg'); m.textContent = text; m.className = 'pw-msg ' + cls; }
function pwMove(dx, dy) {
  PW.r = (PW.r + dy + PW_ROWS + 1) % (PW_ROWS + 1);
  PW.c = PW.r === PW_ROWS ? (dx ? (PW.c < 4 ? 4 : 0) : PW.c) : (PW.c + dx + PW_COLS) % PW_COLS;
  AudioSys.sfx('uiMove');
  pwRender();
}
function pwType(ch) { if (PW.text.length >= 10) return; PW.text += ch; AudioSys.sfx('uiMove'); pwMsg('', ''); pwRender(); }
function pwDel() { PW.text = PW.text.slice(0, -1); AudioSys.sfx('uiBack'); pwRender(); }
function pwPress() {
  if (PW.r < PW_ROWS) pwType(PASSWORD_CHARS[PW.r * PW_COLS + PW.c]);
  else if (PW.c < 4) pwDel();
  else pwOk();
  pwRender();
}
function pwOk() {
  if (PW.text.length < 10) { AudioSys.sfx('uiBack'); pwMsg('10文字すべて入れてください', 'bad'); return; }
  const res = decodePassword(PW.text);
  if (!res) { AudioSys.sfx('uiBack'); pwMsg('パスワードが違います', 'bad'); return; }
  AudioSys.sfx('uiSelect');
  pwMsg(`MISSION ${pad2(res.stage + 1)} から再開します`, 'ok');
  CB.onOk(res);
}
function updatePassword() {
  if (Input.device !== 'gamepad') return;   // keyboard and touch have their own handlers
  if (Input.pressed('back')) { AudioSys.sfx('uiBack'); CB.onBack(); return; }
  if (Input.menu('mUp')) pwMove(0, -1); else if (Input.menu('mDown')) pwMove(0, 1);
  else if (Input.menu('mLeft')) pwMove(-1, 0); else if (Input.menu('mRight')) pwMove(1, 0);
  else if (Input.pressed('confirm')) pwPress();
}
