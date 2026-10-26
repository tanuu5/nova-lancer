// Stage definitions in story order. A definition holds everything one mission needs; azure.js is the reference
// for a planet, violet.js for space.
//   id, no, title, place, sub, resultSub      names for banners and panels
//   music, bossAt, checkpoints, wingRearAt     course pacing (bossAt: restarts past it skip the stage music)
//   attract                                    rail range for the title fly-through (first stage only)
//   world: { zoneW, pathX, terrainHeight, faceColor, decorate, palettes, paletteKeys, water, clouds }
//          or { space: true | { band }, zoneW, pathX, decorate, palettes, paletteKeys } (no terrain, sea or gravity;
//          nebula sky — see world.useStageWorld)
//   script(at)                                 registers events with at(distance, fn) and schedules props
//   onSetup(d, run), onClear(run), absent(run) hooks around (re)starts and the clear sequence
//   onUpdate(dt, gameplay), onExit()           every simulated frame (the stage's own actors); when another stage is loaded
//   warm()                                     objects whose shaders to compile while the screen is black before the mission
//   boss: { id, en, title, bar, introLines: [{ who, text, hold }], bannerAt }
//          + onBossPhase(p) / onBossCharge() / onBossDying() / onBossPartDown(partsLeft)
//   clearTime, clearShot(t, cam, ship)         length of the clear orbit (default 8.5 s); a camera of its own (return true)
//   onFragment()                               reaction to the spear fragment
//   rank: { S, A, B, medal }, resultNote(run)  results screen
//   map: { target }                            star-map body highlighted in the briefing (see screens.js)
//   briefing: { lines: [{ who, text }] | (carry) => lines, objective }, talk: [{ who, text }] (story mode, after the results)
//   squadAfter(run, squad)                     wingmen still under repair when the next stage starts (bit 0 = Kota)
//   botTargets(), botSteer()                   dev-build test bot: extra things to shoot; a (u, v) to steer for
import azure from './azure.js';
import violet from './violet.js';

// The seven missions of the story, in order. `def` is the stage definition once the mission has been built.
export const MISSIONS = [
  { no: 1, id: 'azure', title: 'AZURE COAST', place: '惑星アクエリア', def: azure },
  { no: 2, id: 'violet', title: 'VIOLET SARGASSO', place: 'サルガッソ宙域', def: violet },
  { no: 3, id: 'amber', title: 'AMBER DUNES', place: '惑星アリディア' },
  { no: 4, id: 'white', title: 'WHITE SILENCE', place: '惑星グラシア' },
  { no: 5, id: 'emerald', title: 'EMERALD STORM', place: '惑星シルヴァ' },
  { no: 6, id: 'scarlet', title: 'SCARLET FORGE', place: '惑星イグニア' },
  { no: 7, id: 'night', title: 'LONG NIGHT', place: '恒星アマテラ' },
];

export const STAGES = MISSIONS.filter(m => m.def).map(m => m.def);

// Title → ストーリー → プロローグ (also shown once before the first briefing). One string per page.
export const PROLOGUE = [
  '5年前。\n氷の惑星グラシアの古代遺跡で、連合の調査隊を異変が襲った。\n護衛についていた精鋭飛行隊「ランサー」の隊長は、調査隊を逃がすために遺跡に残り、そのまま還らなかった。\n事件は事故として処理され、ランサー隊は解散した。',
  'そして現在。\nホウ司令のもとで、ランサー隊は新しく生まれ変わった。\nその隊長機「ランサー1」に乗るのは、あなただ。',
  'ある日、海の惑星アクエリアに、所属不明の機械の軍勢が現れる——。',
];
