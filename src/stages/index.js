// Stage definitions in story order. A definition holds everything one mission needs; azure.js is the reference.
//   id, no, title, place, sub, resultSub      names for banners and panels
//   music, bossAt, checkpoints, wingRearAt     course pacing (bossAt: restarts past it skip the stage music)
//   attract                                    rail range for the title fly-through (first stage only)
//   world: { zoneW, pathX, terrainHeight, faceColor, decorate, palettes, paletteKeys, water, clouds }
//   script(at)                                 registers events with at(distance, fn) and schedules props
//   onSetup(d, run), onClear(run), absent(run) hooks around (re)starts and the clear sequence
//   boss: { id, en, title, bar, voice, intro } + onBossPhase / onBossCharge / onBossDying
//   rank: { S, A, B, medal }, resultNote(run)  results screen
//   map: { target }                            star-map body highlighted in the briefing (see screens.js)
//   briefing: { lines: [{ who, text }], objective }, talk: [{ who, text }] (story mode, after the results)
//   squadAfter(run, squad)                     wingmen still under repair when the next stage starts (bit 0 = Kota)
import azure from './azure.js';

// The seven missions of the story, in order. `def` is the stage definition once the mission has been built.
export const MISSIONS = [
  { no: 1, id: 'azure', title: 'AZURE COAST', place: '惑星アクエリア', def: azure },
  { no: 2, id: 'violet', title: 'VIOLET SARGASSO', place: 'サルガッソ宙域' },
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
