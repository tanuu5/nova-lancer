// Stage definitions in story order. A definition holds everything one mission needs; azure.js is the reference.
//   id, no, title, place, sub, resultSub      names for banners and panels
//   music, bossAt, checkpoints, wingRearAt     course pacing (bossAt: restarts past it skip the stage music)
//   attract                                    rail range for the title fly-through (first stage only)
//   world: { zoneW, pathX, terrainHeight, faceColor, decorate, palettes, paletteKeys, water, clouds }
//   script(at)                                 registers events with at(distance, fn) and schedules props
//   onSetup(d, run), onClear(run), absent(run) hooks around (re)starts and the clear sequence
//   boss: { id, en, title, bar, voice, intro } + onBossPhase / onBossCharge / onBossDying
//   rank: { S, A, B, medal }, resultNote(run)  results screen
import azure from './azure.js';

export const STAGES = [azure];
