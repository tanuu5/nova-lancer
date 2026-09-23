// NOVA LANCER — radio-comm character portraits (hand-authored inline SVG).
//
// portraitSVG(id) returns a complete <svg> string (viewBox 0 0 128 128, fills its box with
// preserveAspectRatio "xMidYMid slice", transparent background) meant to be dropped into the
// comm panel via innerHTML. The HUD animates it by toggling classes on the root <svg>:
//   .open  -> mouth open   (swaps <g class="pm-closed"> for <g class="pm-open">)
//   .blink -> eyes closed  (swaps <g class="pe-open">   for <g class="pe-closed">)
// Every gradient/clipPath id is prefixed with the character id, so any number of portraits
// can live in one document. Markup is built once per id and cached.
export const CHARACTERS = {
  kota:     { name: 'KOTA',     nameJa: 'コタ',     role: 'LANCER 2', color: '#ff8a3d' },
  gantetsu: { name: 'GANTETSU', nameJa: 'ガンテツ', role: 'LANCER 3', color: '#b7c4a0' },
  rio:      { name: 'RIO',      nameJa: 'リオ',     role: 'LANCER 4', color: '#5ee0c8' },
  hou:      { name: 'HQ',       nameJa: 'ホウ司令', role: 'COMMAND',  color: '#ffd166' },
  mizuchi:  { name: 'MIZUCHI',  nameJa: 'ミズチ',   role: 'UNKNOWN',  color: '#ff3355' },
};

const STYLE = '<style>.pm-open,.pe-closed{display:none}svg.open .pm-open,svg.blink .pe-closed{display:inline}svg.open .pm-closed,svg.blink .pe-open{display:none}</style>';
const MIRROR = 'matrix(-1 0 0 1 128 0)';
const both = (m) => m + `<g transform="${MIRROR}">${m}</g>`;

function wrap(id, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${CHARACTERS[id] ? CHARACTERS[id].name : 'NO SIGNAL'}">${STYLE}<defs>${defs}</defs>${body}</svg>`;
}

// ---------------------------------------------------------------- KOTA (red panda)
function kota() {
  const O = '#3b1a10';
  const W = '#fff4e6';
  const defs = `
<radialGradient id="kota-fur" cx=".5" cy=".28" r=".78"><stop offset="0" stop-color="#f7a05a"/><stop offset=".55" stop-color="#e2692b"/><stop offset="1" stop-color="#b0451b"/></radialGradient>
<linearGradient id="kota-suit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffa45c"/><stop offset="1" stop-color="#e2641d"/></linearGradient>
<linearGradient id="kota-white" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stop-color="#fff6ea"/><stop offset="1" stop-color="#efd9c2"/></linearGradient>
<radialGradient id="kota-eye" cx=".5" cy=".75" r=".75"><stop offset="0" stop-color="#d9782e"/><stop offset=".45" stop-color="#7a3514"/><stop offset="1" stop-color="#241008"/></radialGradient>`;
  const earL = `<path d="M26 48 C16 36 15 20 24 13 C32 7 46 14 56 28 Z" fill="#c2521f" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M29 45 C21 35 20 22 26 17 C32 12 44 18 52 28 Z" fill="${W}"/>
<path d="M33 42 C27 35 26 27 30 23 C35 20 42 25 47 31 Z" fill="#7a2c15"/>`;
  const head = `<path d="M64 24 C84 24 100 34 104 50 C106 58 106 64 104 69 L111 74 L102 77 L107 83 L96 85 C88 91 76 94 64 94 C52 94 40 91 32 85 L21 83 L26 77 L17 74 L24 69 C22 64 22 58 24 50 C28 34 44 24 64 24 Z" fill="url(#kota-fur)" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/>`;
  const cheekL = `<path d="M26 67 C31 63 39 65 43 71 C46 77 44 84 39 87 L32 85 L24 83 L28 78 L20 74 Z" fill="${W}"/>`;
  const browL = `<ellipse cx="46" cy="41.5" rx="7.6" ry="4.1" transform="rotate(-20 46 41.5)" fill="${W}"/>`;
  const tuft = `<path d="M56 27 C55 20 59 14.5 64.5 12.5 C62.5 16.5 63.5 19.5 66 22.5 C68 17.5 72 15.5 76.5 16.5 C73.5 19.5 72.5 23 72 27 Z" fill="#ee8c47"/><path d="M56.3 25.5 C55.5 19.5 59 14.5 64.5 12.5 C62.5 16.5 63.5 19.5 66 22.5 C68 17.5 72 15.5 76.5 16.5 C73.5 19.5 72.5 22.5 72 25.5" fill="none" stroke="${O}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const tearL = `<path d="M44.5 62 C45.5 69.5 49.5 77 55.5 84 C54.5 76 53.5 69 52.5 61 Z" fill="#7c2a16"/>`;
  const muzzle = `<path d="M64 62 C72 62 78 68 78 76 C78 84 72 90 64 90 C56 90 50 84 50 76 C50 68 56 62 64 62 Z" fill="url(#kota-white)"/>`;
  const eyeL = `<ellipse cx="47" cy="56" rx="7.6" ry="9" fill="url(#kota-eye)" stroke="${O}" stroke-width="1.3"/><circle cx="47.4" cy="57.5" r="3.6" fill="#140805"/>`;
  const eyeHi = [[44.3, 52.4], [78.3, 52.4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff"/><circle cx="${x + 5.7}" cy="${y + 8.2}" r="1.3" fill="#fff"/>`).join('');
  const lidL = `<path d="M39.2 55.5 A7.6 9 0 0 1 54.8 55.5" fill="none" stroke="${O}" stroke-width="2.4" stroke-linecap="round"/>`;
  const eyeClosedL = `<path d="M40 57 Q47 51 54 57" fill="none" stroke="${O}" stroke-width="2.2" stroke-linecap="round"/>`;
  const nose = `<path d="M58 67 Q64 64 70 67 Q69 72 64 74 Q59 72 58 67 Z" fill="#241210"/><ellipse cx="62" cy="67" rx="2" ry="1" fill="#7a5a54"/>`;
  const mouthC = `<path d="M64 74 L64 77 M56 76 Q60 80 64 77 Q68 80 72 76" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const mouthO = `<path d="M64 74 L64 76" stroke="${O}" stroke-width="1.6"/><path d="M56 76 Q64 79 72 76 Q70 88 64 88 Q58 88 56 76 Z" fill="#5a1712" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/><path d="M59 85 Q64 81 69 85 Q66 88 64 88 Q61 88 59 85 Z" fill="#ff7a7a"/>`;
  const body = `
<path d="M4 128 C6 110 20 101 42 98 L86 98 C108 101 122 110 124 128 Z" fill="url(#kota-suit)" stroke="${O}" stroke-width="1.6"/>
<path d="M4 128 C6 114 14 106 26 102 C21 110 19 118 19 128 Z" fill="#c9561a"/><path d="M124 128 C122 114 114 106 102 102 C107 110 109 118 109 128 Z" fill="#c9561a"/>
<path d="M44 99 L84 99 C81 110 78 120 77 128 L51 128 C50 120 47 110 44 99 Z" fill="#f4f0e8"/><path d="M47 104 C50 114 51 122 52 128 L51 128 C50 120 47 110 44 99 Z" fill="#d6d2cb"/>
<path d="M64 104 V128" stroke="#b9b2a6" stroke-width="1.2"/>
<rect x="88" y="108" width="14" height="10" rx="2" fill="#2f8f50" stroke="#1f5a33" stroke-width="1"/><path d="M95 109.6 L96.3 112.2 L99.2 112.5 L97 114.4 L97.6 117.1 L95 115.6 L92.4 117.1 L93 114.4 L90.8 112.5 L93.7 112.2 Z" fill="#fff4e6"/>
<path d="M39 91 C50 98 78 98 89 91 L92 101 C78 108 50 108 36 101 Z" fill="#3fae62" stroke="#1f5a33" stroke-width="1.4" stroke-linejoin="round"/><path d="M40 94 C51 100 77 100 88 94" fill="none" stroke="#7fe09a" stroke-width="1.2" stroke-linecap="round"/>`;
  const band = `<path d="M21 60 C20 40 36 25 64 24.5 C92 25 108 40 107 60" fill="none" stroke="#1a1d26" stroke-width="3.6"/><path d="M21 60 C20 40 36 25 64 24.5 C92 25 108 40 107 60" fill="none" stroke="#4a5264" stroke-width="1.2"/>`;
  const cups = `<rect x="101" y="52" width="9" height="16" rx="3.5" fill="#2c3140" stroke="#11141c" stroke-width="1.2"/>
<rect x="15" y="50" width="12" height="20" rx="4.5" fill="#2c3140" stroke="#11141c" stroke-width="1.2"/><rect x="17.5" y="53" width="3" height="14" rx="1.5" fill="#4a5264"/><circle cx="22.5" cy="56" r="1.7" fill="#6fe39a"/>
<path d="M22 68 C23 80 32 86 45 86" fill="none" stroke="#11141c" stroke-width="3"/><path d="M22 68 C23 80 32 86 45 86" fill="none" stroke="#3a4152" stroke-width="1.4"/><rect x="43" y="83" width="7" height="5.6" rx="2.4" fill="#2c3140" stroke="#11141c" stroke-width="1"/>`;
  const faceGroup = `<ellipse cx="64" cy="97.5" rx="25" ry="5" fill="#1f5a33" opacity=".55"/><g transform="rotate(-5 64 64)">
${both(earL)}${head}${tuft}${both(cheekL)}${both(browL)}${muzzle}${both(tearL)}${nose}
<g class="pe-open">${both(eyeL)}${eyeHi}${both(lidL)}</g><g class="pe-closed">${both(eyeClosedL)}</g>
<g class="pm-closed">${mouthC}</g><g class="pm-open">${mouthO}</g>
${band}${cups}</g>`;
  return wrap('kota', defs, body + faceGroup);
}

// ---------------------------------------------------------------- GANTETSU (Japanese badger)
function gantetsu() {
  const O = '#1d1915';
  const defs = `
<radialGradient id="gantetsu-fur" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#a59b8c"/><stop offset=".6" stop-color="#877d6f"/><stop offset="1" stop-color="#5c544a"/></radialGradient>
<linearGradient id="gantetsu-face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe8da"/><stop offset="1" stop-color="#cfc4ae"/></linearGradient>
<linearGradient id="gantetsu-jkt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d8b4e"/><stop offset="1" stop-color="#525e2e"/></linearGradient>
<radialGradient id="gantetsu-lens" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffe6a8"/><stop offset=".45" stop-color="#eaa040"/><stop offset="1" stop-color="#7a3e10"/></radialGradient>
<linearGradient id="gantetsu-wool" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1e6cc"/><stop offset="1" stop-color="#d4c29c"/></linearGradient>`;
  const headD = 'M64 20 C86 20 102 32 104 52 C105 62 104 70 102 76 L108 80 L100 82 L104 88 L94 88 C86 95 76 97 64 97 C52 97 42 95 34 88 L24 88 L28 82 L20 80 L26 76 C24 70 23 62 24 52 C26 32 42 20 64 20 Z';
  const earL = `<ellipse cx="29" cy="36" rx="8.5" ry="8" fill="#4d443b" stroke="${O}" stroke-width="1.6"/><ellipse cx="29.5" cy="36.5" rx="5.2" ry="4.8" fill="#dcd3c2"/><ellipse cx="30" cy="37.2" rx="3" ry="2.8" fill="#3a322b"/>`;
  const face = `<path d="M57 21 C60 20 68 20 71 21 L74 40 C86 44 98 52 101 66 C102 76 100 84 94 89 C86 95 76 97 64 97 C52 97 42 95 34 89 C28 84 26 76 27 66 C30 52 42 44 54 40 Z" fill="url(#gantetsu-face)"/>`;
  const stripeL = `<path d="M25 46 C29 36 37 31 44 33 C52 37 58 49 60 59 C61 65 60 69 57 70 C52 69 46 65 40 61 C34 57 28 52 25 46 Z" fill="#3b322b"/>`;
  const browL = `<path d="M39 47 C45 45.5 52 47.5 57.5 51 L56.5 54.2 C51 51.5 45 50.5 39.5 50.8 Z" fill="#d9d0c0"/>`;
  const eyeL = `<path d="M42 56.6 Q49 51 56 54.8 Q51.5 61.2 42 56.6 Z" fill="#f2c14e"/><circle cx="49.6" cy="56.4" r="2.7" fill="#1a1410"/><path d="M41.5 56.8 Q49 50.6 56.5 54.6" stroke="#15110e" stroke-width="2.1" fill="none" stroke-linecap="round"/>`;
  const eyeHi = `<circle cx="48.6" cy="55.5" r="1" fill="#fff"/><circle cx="77.4" cy="55.5" r="1" fill="#fff"/>`;
  const eyeClosedL = `<path d="M42.5 56 Q49 58.5 55.5 55" stroke="#15110e" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  const nose = `<path d="M55 69 C55 64.5 73 64.5 73 69 C73 73.5 68 76 64 76 C60 76 55 73.5 55 69 Z" fill="#1a1512"/><ellipse cx="60" cy="67.6" rx="2.6" ry="1.2" fill="#6a625c"/>`;
  const muzzle = `<ellipse cx="64" cy="79" rx="15" ry="12" fill="#f4eee2" opacity=".7"/><g fill="#8a7f70"><circle cx="54" cy="79" r=".8"/><circle cx="51" cy="77" r=".8"/><circle cx="52" cy="82" r=".8"/><circle cx="74" cy="79" r=".8"/><circle cx="77" cy="77" r=".8"/><circle cx="76" cy="82" r=".8"/></g>`;
  const mouthC = `<path d="M64 76 V80.5 M54 83 Q59 80.5 64 80.5 Q69 80.5 74 83" fill="none" stroke="${O}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  const mouthO = `<path d="M64 76 V79.4" stroke="${O}" stroke-width="1.7"/><path d="M54.6 81.4 Q64 79 73.4 81.4 Q70.8 89.4 64 89.4 Q57.2 89.4 54.6 81.4 Z" fill="#3b1512" stroke="${O}" stroke-width="1.5" stroke-linejoin="round"/><path d="M58.8 87.2 Q64 84.4 69.2 87.2 Q66.6 89.4 64 89.4 Q61.4 89.4 58.8 87.2 Z" fill="#b8504a"/><path d="M56.6 82 Q64 80.3 71.4 82 L70.9 83.5 Q64 82.2 57.1 83.5 Z" fill="#f1e8d4"/>`;
  const scar = `<path d="M88 40 L79.5 53.5" stroke="#e7bfae" stroke-width="2.8" stroke-linecap="round"/><path d="M87.6 40.8 L80 53" stroke="#9a5646" stroke-width=".9" stroke-linecap="round"/>`;
  const goggles = `<path d="M23 44 C28 30 44 25 64 25 C84 25 100 30 105 44 L104 50 C98 38 84 33 64 33 C44 33 30 38 24 50 Z" fill="#4a3526" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M25 50 C31 39 45 34.5 64 34.5 C83 34.5 97 39 103 50 C97 41.5 83 37.5 64 37.5 C45 37.5 31 41.5 25 50 Z" fill="#2a221c" opacity=".28"/><rect x="57" y="28.5" width="14" height="5" rx="2" fill="#5d5850" stroke="${O}" stroke-width="1"/>
${both(`<circle cx="50" cy="31" r="10" fill="#57524a" stroke="${O}" stroke-width="1.4"/><circle cx="50" cy="31" r="8.3" fill="#a39d8e"/><circle cx="50" cy="31" r="6.9" fill="url(#gantetsu-lens)" stroke="#3a2a1a" stroke-width=".8"/>`)}
<path d="M45 28.5 Q47.5 25.5 51 25.8" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".9"/><path d="M73 28.5 Q75.5 25.5 79 25.8" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".9"/>`;
  const body = `
<path d="M2 128 C4 110 18 100 40 97 L88 97 C110 100 124 110 126 128 Z" fill="url(#gantetsu-jkt)" stroke="${O}" stroke-width="1.6"/>
<path d="M50 98 L78 98 L68 128 L60 128 Z" fill="#3d3a2c"/>
<path d="M56 100 Q64 117 72 100" stroke="#b8bcc4" stroke-width=".9" fill="none"/><rect x="61.5" y="113.5" width="5" height="7" rx="1.2" fill="#c9ced6" stroke="#6a707a" stroke-width=".6"/>
${both(`<path d="M44 92 C34 94 22 99 15 106 Q13 111 17 113 Q17 118 22 118 Q24 122 28 121 Q31 125 35 123 Q38 127 42 125 L57 104 C56 99 52 95 48 92 Z" fill="url(#gantetsu-wool)" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/><path d="M24 108 q2 -2 4 0 M31 113 q2 -2 4 0 M38 118 q2 -2 4 0 M40 106 q2 -2 4 0 M46 112 q2 -2 4 0 M33 102 q2 -2 4 0" stroke="#c4ae84" stroke-width="1" fill="none" stroke-linecap="round"/>`)}`;
  return wrap('gantetsu', defs, body + `
${both(earL)}<path d="${headD}" fill="url(#gantetsu-fur)"/>${face}${both(stripeL)}${muzzle}${both(browL)}${scar}${nose}
<g class="pe-open">${both(eyeL)}${eyeHi}</g><g class="pe-closed">${both(eyeClosedL)}</g>
<g class="pm-closed">${mouthC}</g><g class="pm-open">${mouthO}</g>
<path d="${headD}" fill="none" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/>${goggles}`);
}

// ---------------------------------------------------------------- RIO (otter)
function rio() {
  const O = '#21140e';
  const headD = 'M64 27 C85 27 101 38 102.5 54 C104 68 99 82 88 89 C81 93.5 72 95.5 64 95.5 C56 95.5 47 93.5 40 89 C29 82 24 68 25.5 54 C27 38 43 27 64 27 Z';
  const defs = `
<clipPath id="rio-clip"><path d="${headD}"/></clipPath>
<radialGradient id="rio-fur" cx=".45" cy=".3" r=".8"><stop offset="0" stop-color="#b98056"/><stop offset=".6" stop-color="#94603b"/><stop offset="1" stop-color="#633b22"/></radialGradient>
<linearGradient id="rio-rim" x1="0" y1="0" x2="1" y2="0"><stop offset=".6" stop-color="#b8fff2" stop-opacity="0"/><stop offset="1" stop-color="#b8fff2" stop-opacity=".7"/></linearGradient>
<linearGradient id="rio-cream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7ecd8"/><stop offset="1" stop-color="#dcc6a2"/></linearGradient>
<linearGradient id="rio-suit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d558f"/><stop offset="1" stop-color="#22305a"/></linearGradient>
<radialGradient id="rio-eye" cx=".5" cy=".75" r=".8"><stop offset="0" stop-color="#8a5a3a"/><stop offset=".5" stop-color="#3e2618"/><stop offset="1" stop-color="#140a06"/></radialGradient>
<linearGradient id="rio-visor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ff8e6" stop-opacity=".42"/><stop offset=".45" stop-color="#5ee0c8" stop-opacity=".14"/><stop offset="1" stop-color="#1fb8a0" stop-opacity=".3"/></linearGradient>`;
  const rim = `<path d="${headD}" fill="none" stroke="url(#rio-rim)" stroke-width="3.6" clip-path="url(#rio-clip)"/>`;
  const earL = `<circle cx="28.5" cy="39.5" r="5.8" fill="#7a4a2c" stroke="${O}" stroke-width="1.5"/><circle cx="29.2" cy="40.2" r="3" fill="#3a2216"/>`;
  const cream = `<path d="M33 66 C38 60 50 60 64 63 C78 60 90 60 95 66 C99 76 96 86 88 91 C82 94 73 95.5 64 95.5 C55 95.5 46 94 40 91 C32 86 29 76 33 66 Z" fill="url(#rio-cream)"/>`;
  const fringe = `<path d="M42 33 C50 24 70 21 86 28 C77 28 66 30 57 37 C55 34 49 33 42 33 Z" fill="#6a3f24"/><path d="M47 31 C55 26 66 25 76 26.5" stroke="#e9c49c" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".6"/>`;
  const pads = `<ellipse cx="56.5" cy="75" rx="8.5" ry="6.5" fill="#fcf3e3"/><ellipse cx="71.5" cy="75" rx="8.5" ry="6.5" fill="#fcf3e3"/><g fill="#b89a7a"><circle cx="53" cy="74" r=".7"/><circle cx="56" cy="76.5" r=".7"/><circle cx="52" cy="77.5" r=".7"/><circle cx="75" cy="74" r=".7"/><circle cx="72" cy="76.5" r=".7"/><circle cx="76" cy="77.5" r=".7"/></g>`;
  const whiskers = `<g stroke="#fff8ee" stroke-width=".8" fill="none" stroke-linecap="round" opacity=".85"><path d="M49 74 Q38 71 27 71"/><path d="M49 77 Q38 77 26 80"/><path d="M50 80 Q40 83 30 88"/><path d="M79 74 Q90 71 101 71"/><path d="M79 77 Q90 77 102 80"/><path d="M78 80 Q88 83 98 88"/></g>`;
  const nose = `<path d="M56.5 67.5 C56.5 63.5 71.5 63.5 71.5 67.5 C71.5 71 67 73.5 64 73.5 C61 73.5 56.5 71 56.5 67.5 Z" fill="#2a1a14"/><ellipse cx="61" cy="66.3" rx="2.4" ry="1.1" fill="#8a6a60"/>`;
  const mouthC = `<path d="M64 73.5 V77.6 M59.4 78.9 Q61.9 80.3 64 78.7 Q67.6 81.2 71.6 77" fill="none" stroke="${O}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M71.3 75.6 Q72.6 76.6 72.3 78.2" fill="none" stroke="${O}" stroke-width="1" stroke-linecap="round"/>`;
  const mouthO = `<path d="M64 73.5 V76" stroke="${O}" stroke-width="1.5"/><path d="M58.5 78 Q64 76.5 70 77.5 Q68.5 86 64 86 Q59.5 86 58.5 78 Z" fill="#4a1a18" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/><path d="M60.5 83.5 Q64 81 67.5 83.5 Q66 86 64 86 Q62 86 60.5 83.5 Z" fill="#e8787a"/>`;
  const eyeL = `<path d="M40 51.8 C44 48.6 51.5 48.6 55.5 55.6 C50 58.9 43 57.8 40 51.8 Z" fill="url(#rio-eye)"/><ellipse cx="48.6" cy="54" rx="2" ry="2.5" fill="#0a0504"/><path d="M55.5 55.6 C51.5 48.4 44 48.4 40 51.8 L36.4 50.6" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M42.5 56.6 C46 58.2 50.5 58.2 54 56.6" fill="none" stroke="#5c361f" stroke-width=".8" stroke-linecap="round"/>`;
  const eyeHi = [[46.9, 52.6], [77.7, 52.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.25" fill="#fff"/><circle cx="${x + 3.7}" cy="${y + 3.1}" r=".7" fill="#8ff8e6"/>`).join('');
  const eyeClosedL = `<path d="M55.5 55.6 C51 58.2 44 57.4 40 52.6 L36.4 51.4" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const brows = `<path d="M37 44.5 C42 41 49 40.5 55 43" stroke="#3a2216" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M73 42 C79 39 86 39.5 91 42.5" stroke="#3a2216" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  const headset = `<path d="M26.5 52 C25 35 40 24.5 64 24.5 C88 24.5 103 35 101.5 52" fill="none" stroke="#1d2a33" stroke-width="3.4"/><path d="M26.5 52 C25 35 40 24.5 64 24.5 C88 24.5 103 35 101.5 52" fill="none" stroke="#5ee0c8" stroke-width="1" opacity=".8"/>
<rect x="21.5" y="45" width="8" height="14" rx="3.2" fill="#223340" stroke="#0b1418" stroke-width="1.1"/>
<path d="M101 58 C101.5 70 95 78.5 82.5 81" fill="none" stroke="#0b1418" stroke-width="2.8"/><path d="M101 58 C101.5 70 95 78.5 82.5 81" fill="none" stroke="#35505e" stroke-width="1.2"/><rect x="77.5" y="78.3" width="7" height="5.4" rx="2.3" fill="#223340" stroke="#0b1418" stroke-width="1"/>
<path d="M97.5 50 L94 50.5" stroke="#0b1418" stroke-width="2.4"/>
<rect x="97" y="44" width="10.5" height="16" rx="4" fill="#223340" stroke="#0b1418" stroke-width="1.2"/><rect x="99.2" y="47" width="2.4" height="10" rx="1.2" fill="#5ee0c8"/>
<path d="M70 47.2 L93.2 45.6 Q95.2 45.5 95.1 47.5 L94.4 57.8 Q94.2 59.8 92.2 60 L71.6 61.8 Q69.6 62 69.5 60 L68.2 49.2 Q68.1 47.3 70 47.2 Z" fill="url(#rio-visor)" stroke="#5ee0c8" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M70.4 48.6 L84 47.6" stroke="#e8fffb" stroke-width=".9" stroke-linecap="round" opacity=".8"/>
<g stroke="#b8fff2" stroke-width=".6" fill="none" opacity=".95"><circle cx="88.5" cy="54" r="2.6"/><path d="M88.5 50.2 V51.2 M88.5 56.8 V57.8 M84.7 54 H85.7 M91.3 54 H92.3"/><path d="M71.5 58.8 H76 M71.5 57 H74"/></g>`;
  const body = `
<path d="M8 128 C10 111 23 102 43 99 L85 99 C105 102 118 111 120 128 Z" fill="url(#rio-suit)" stroke="#0f1630" stroke-width="1.6"/>
<path d="M46 88 L82 88 L83 102 L45 102 Z" fill="#e4d2b2"/>
<path d="M22 108 C31 103 40 101 47 101 M106 108 C97 103 88 101 81 101" stroke="#5ee0c8" stroke-width="1.3" fill="none" stroke-linecap="round"/>
<path d="M58 103 L74 128" stroke="#5ee0c8" stroke-width="1.6"/><path d="M60 103 L76 128" stroke="#16204a" stroke-width="1"/>
<circle cx="92" cy="114" r="4.5" fill="#16204a" stroke="#5ee0c8" stroke-width="1"/><path d="M89.5 115.5 Q92 110 94.5 115.5" stroke="#5ee0c8" stroke-width="1" fill="none"/>
<path d="M43 93 C52 99 76 99 85 93 L86 102.5 C76 107.5 52 107.5 42 102.5 Z" fill="#2c3f72" stroke="#0f1630" stroke-width="1.4" stroke-linejoin="round"/><path d="M43.5 95.5 C52 101.5 76 101.5 84.5 95.5" stroke="#5ee0c8" stroke-width="1.1" fill="none"/>`;
  return wrap('rio', defs, body + `
${both(earL)}<path d="${headD}" fill="url(#rio-fur)"/>${cream}${fringe}${pads}${whiskers}${nose}${brows}
<g class="pe-open">${both(eyeL)}${eyeHi}</g><g class="pe-closed">${both(eyeClosedL)}</g>
<g class="pm-closed">${mouthC}</g><g class="pm-open">${mouthO}</g>
${rim}<path d="${headD}" fill="none" stroke="${O}" stroke-width="1.6"/>${headset}`);
}

// ---------------------------------------------------------------- HOU (owl commander)
function hou() {
  const O = '#241c14';
  const defs = `
<radialGradient id="hou-fea" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#b8a88c"/><stop offset=".6" stop-color="#978669"/><stop offset="1" stop-color="#6a5b45"/></radialGradient>
<radialGradient id="hou-disc" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#f1e9d6"/><stop offset=".8" stop-color="#dccfb2"/><stop offset="1" stop-color="#bfab8a"/></radialGradient>
<radialGradient id="hou-eye" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe08a"/><stop offset=".6" stop-color="#f6a623"/><stop offset="1" stop-color="#b8650c"/></radialGradient>
<linearGradient id="hou-uni" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#435179"/><stop offset="1" stop-color="#262e4a"/></linearGradient>
<linearGradient id="hou-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".5" stop-color="#f2c14e"/><stop offset="1" stop-color="#b8862a"/></linearGradient>
<linearGradient id="hou-cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d4d0c6"/></linearGradient>`;
  const headD = 'M64 22 C90 22 108 40 108 62 C108 80 96 94 78 97 L50 97 C32 94 20 80 20 62 C20 40 38 22 64 22 Z';
  const tuftL = `<path d="M36 44 C28 40 20 34 14.5 26.5 L18 27 L7.5 17.5 L15 19.2 L9.5 8.5 L18.2 15.8 L18.5 5 C24 15 30 23 38.5 32 Z" fill="#8a7960" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/><path d="M33 38 L11 20 M35 34 L13.5 11.5 M36 31 L19 8.5" stroke="#4e4030" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;
  const disc = `<path d="M64 46 C58 38 40 36 31 46 C23 56 25 74 36 83 C44 89 56 90 64 92 C72 90 84 89 92 83 C103 74 105 56 97 46 C88 36 70 38 64 46 Z" fill="url(#hou-disc)" stroke="#6a5438" stroke-width="2.2"/>`;
  const browL = `<path d="M61 51 C55 44 43 42 33 46 C29 48 27 51 25.5 54.5 C31 50.5 37 49.5 43 50.5 C48 51.5 53 53 58.5 56 Z" fill="#f7f3ea" stroke="#bdb2a0" stroke-width=".6"/>`;
  const eyeL = `<circle cx="46" cy="62" r="10.6" fill="#1e1610"/><circle cx="46" cy="62" r="9.2" fill="url(#hou-eye)"/><circle cx="46.4" cy="62.8" r="5.1" fill="#140e0a"/>`;
  const eyeHi = [[43.4, 60.6], [79.4, 60.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.3" fill="#fff"/><circle cx="${x + 6.4}" cy="${y + 5.2}" r="1" fill="#fff"/>`).join('');
  const lidL = `<path d="M35.6 60.5 A10.6 10.6 0 0 1 56.3 58.6 Q45.5 54.4 35.6 60.5 Z" fill="#b3a283"/><path d="M35.2 61 Q45.5 54.2 56.7 58.6" stroke="${O}" stroke-width="1.7" fill="none" stroke-linecap="round"/><path d="M38.5 74.2 Q46 76.8 53.5 74" stroke="#b5a486" stroke-width="1" fill="none" stroke-linecap="round"/>`;
  const eyeClosedL = `<circle cx="46" cy="62" r="10.6" fill="#c2b192"/><path d="M36.5 58 A10.6 10.6 0 0 1 55.5 58 Q46 55 36.5 58 Z" fill="#b3a283"/><path d="M36 61.5 Q46 67.5 56 61.5" stroke="${O}" stroke-width="1.9" fill="none" stroke-linecap="round"/><path d="M38.5 74.2 Q46 76.8 53.5 74" stroke="#b5a486" stroke-width="1" fill="none" stroke-linecap="round"/>`;
  const beakU = `<path d="M58 67.5 C60 65 68 65 70 67.5 C70 73.5 67 78.5 64 81.5 C61 78.5 58 73.5 58 67.5 Z" fill="#dcc48a" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/><path d="M64 66 C67 66 69.3 67 69.6 68.5 C69 74 66.5 78 64 81 Z" fill="#b8995a"/>`;
  const mouthC = beakU;
  const mouthO = `<path d="M59 71 Q64 69 69 71 L67.6 83.5 Q64 86 60.4 83.5 Z" fill="#4a1c16" stroke="${O}" stroke-width="1.1" stroke-linejoin="round"/><path d="M60 80.5 Q64 83 68 80.5 Q67 85.8 64 88 Q61 85.8 60 80.5 Z" fill="#c9b074" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/><path d="M58 66.5 C60 64 68 64 70 66.5 C70 71.5 67.2 75.5 64 78.5 C60.8 75.5 58 71.5 58 66.5 Z" fill="#dcc48a" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/><path d="M64 65 C67 65 69.3 66 69.6 67.5 C69 72 66.5 75.5 64 78 Z" fill="#b8995a"/>`;
  const cap = `<path d="M20 24 C22 10 42 3 64 3 C86 3 106 10 108 24 C100 31 86 33 64 33 C42 33 28 31 20 24 Z" fill="url(#hou-cap)" stroke="${O}" stroke-width="1.5"/>
<path d="M30 26 C42 31 86 31 98 26 L97 36 C86 39 42 39 31 36 Z" fill="#232a40" stroke="${O}" stroke-width="1.3"/>
<path d="M29 35 C42 39 86 39 99 35 C97 42 84 46 64 46 C44 46 31 42 29 35 Z" fill="#15171d" stroke="${O}" stroke-width="1.3"/><path d="M36 39.5 C46 42.5 82 42.5 92 39.5" stroke="#4a5162" stroke-width="1.1" fill="none"/>
<path d="M32 34.5 C44 37.5 84 37.5 96 34.5" stroke="url(#hou-gold)" stroke-width="1.8" fill="none"/><circle cx="32.5" cy="34.5" r="1.6" fill="#f2c14e"/><circle cx="95.5" cy="34.5" r="1.6" fill="#f2c14e"/>
${both(`<path d="M58 25 C53 22 47 21 42 22 C46 25 51 27 57 28 Z" fill="url(#hou-gold)" stroke="#6a4a10" stroke-width=".5"/>`)}
<path d="M64 17 L66.2 22.2 L71.8 22.6 L67.5 26.2 L68.9 31.6 L64 28.6 L59.1 31.6 L60.5 26.2 L56.2 22.6 L61.8 22.2 Z" fill="url(#hou-gold)" stroke="#6a4a10" stroke-width=".7" stroke-linejoin="round"/>`;
  const body = `
<path d="M4 128 C6 110 20 100 42 97 L86 97 C108 100 122 110 124 128 Z" fill="url(#hou-uni)" stroke="#0e1222" stroke-width="1.6"/>
<path d="M47 97 L81 97 L64 124 Z" fill="#e6dcc6"/>
<g stroke="#a8987c" stroke-width="1" fill="none" stroke-linecap="round"><path d="M56 102 q2 2 4 0 M64 102 q2 2 4 0 M60 108 q2 2 4 0 M68 108 q2 2 4 0 M56 108 q2 2 4 0 M62 114 q2 2 4 0"/></g>
${both(`<path d="M42 97 L50 97 L64 121 L60 125 L46 107 Z" fill="#53628e" stroke="#0e1222" stroke-width="1" stroke-linejoin="round"/><path d="M48 101.5 L49 103.6 L51.2 103.8 L49.5 105.2 L50 107.4 L48 106.2 L46 107.4 L46.5 105.2 L44.8 103.8 L47 103.6 Z" fill="#f2c14e"/>
<path d="M7 111 C10 104 18 100 31 99 L34 104.5 C24 106 16 110 12 117 Z" fill="url(#hou-gold)" stroke="#6a4a10" stroke-width="1" stroke-linejoin="round"/><path d="M8 113 L6.5 121 M10 115 L9 123 M12 117 L11.5 125" stroke="#e0ae3e" stroke-width="1.4" stroke-linecap="round"/>`)}
<rect x="84" y="108" width="5" height="3" fill="#c8323a"/><rect x="89" y="108" width="5" height="3" fill="#3a6ad0"/><rect x="94" y="108" width="5" height="3" fill="#f2c14e"/><rect x="86.5" y="111.4" width="5" height="3" fill="#2f9a5a"/><rect x="91.5" y="111.4" width="5" height="3" fill="#e8e4dc"/>`;
  return wrap('hou', defs, body + `
<path d="${headD}" fill="url(#hou-fea)" stroke="${O}" stroke-width="1.6"/>${both('<path d="M23.5 69 q3 3.2 6 0 M23 78.5 q3 3.2 6 0 M28.5 87 q3 3.2 6 0 M26 58.5 q3 3.2 6 0 M32 94 q3 2.6 6 0" stroke="#75654d" stroke-width="1" fill="none" stroke-linecap="round"/>')}${disc}${both(browL)}
<g class="pe-open">${both(eyeL)}${eyeHi}${both(lidL)}</g><g class="pe-closed">${both(eyeClosedL)}</g>
<g class="pm-closed">${mouthC}</g><g class="pm-open">${mouthO}</g>
${both(tuftL)}${cap}`);
}

// ---------------------------------------------------------------- MIZUCHI (mechanical sea-dragon AI)
function mizuchi() {
  const R = '#ff3355';
  const K = '#0a0c11';
  const defs = `
<radialGradient id="mizuchi-aura" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="${R}" stop-opacity=".42"/><stop offset=".6" stop-color="#8a1030" stop-opacity=".16"/><stop offset="1" stop-color="${R}" stop-opacity="0"/></radialGradient>
<linearGradient id="mizuchi-plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a94a8"/><stop offset=".45" stop-color="#4d5566"/><stop offset="1" stop-color="#252a34"/></linearGradient>
<linearGradient id="mizuchi-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#434b5a"/><stop offset="1" stop-color="#15181e"/></linearGradient>
<linearGradient id="mizuchi-fang" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8edf5"/><stop offset="1" stop-color="#8a94a8"/></linearGradient>
<radialGradient id="mizuchi-eye" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6f6"/><stop offset=".22" stop-color="#ff9aa8"/><stop offset=".6" stop-color="#ff2447"/><stop offset="1" stop-color="#6e0016"/></radialGradient>
<radialGradient id="mizuchi-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${R}" stop-opacity=".9"/><stop offset=".5" stop-color="${R}" stop-opacity=".3"/><stop offset="1" stop-color="${R}" stop-opacity="0"/></radialGradient>`;
  const glow = (d, w = .9) => `<path d="${d}" stroke="${R}" stroke-width="${(w * 3.2).toFixed(1)}" fill="none" opacity=".25" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" stroke="#ff6b82" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const node = (x, y, r = 1.2) => `<circle cx="${x}" cy="${y}" r="${r * 2.2}" fill="${R}" opacity=".25"/><circle cx="${x}" cy="${y}" r="${r}" fill="#ff8093"/>`;
  // ---- back layers
  const seg = (y, w, h) => `<path d="M${64 - w} ${y + 5} Q64 ${y - 4} ${64 + w} ${y + 5} L${64 + w + 7} ${y + h + 5} Q64 ${y + h - 4} ${64 - w - 7} ${y + h + 5} Z" fill="url(#mizuchi-dark)" stroke="${K}" stroke-width="1.3" stroke-linejoin="round"/>` + glow(`M${64 - w + 2} ${y + 4.2} Q64 ${y - 3.6} ${64 + w - 2} ${y + 4.2}`, .7);
  const neck = seg(98, 30, 12) + seg(110, 37, 12) + seg(122, 44, 12) + both(`<path d="M31 106 L20 98 L27 110 Z M24 118 L10 112 L19 124 Z" fill="url(#mizuchi-plate)" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>`);
  const blade = (d, g) => `<path d="${d}" fill="url(#mizuchi-plate)" stroke="${K}" stroke-width="1.1" stroke-linejoin="round"/>` + glow(g, .6);
  const finL = `<path d="M38 39 L3 21 L0 41 L1 61 L7 81 L39 70 Z" fill="#2a0c16" opacity=".82" stroke="${K}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M3 21 L0 41 L1 61 L7 81" stroke="${R}" stroke-width=".8" fill="none" opacity=".55"/>
${blade('M39 39 L3 21 L7.5 29.5 L38.5 46 Z', 'M34 41.5 L10 28')}${blade('M38 47 L0 41 L4.5 48.5 L38 53 Z', 'M33 48.4 L8 44.6')}${blade('M38 55 L1 61 L6 66.5 L38.5 60.5 Z', 'M33 58 L9 62')}${blade('M38.5 62 L7 81 L12.5 83 L39.5 68 Z', 'M34 66 L13 79')}`;
  const hornL = `<path d="M52 23 C44 13 32 6 13 1 C22 8 33 18 41 33 Z" fill="url(#mizuchi-plate)" stroke="${K}" stroke-width="1.4" stroke-linejoin="round"/><path d="M47 22 C39 14 30 9 18 4" stroke="#aeb7c9" stroke-width=".9" fill="none" stroke-linecap="round"/>
<path d="M38 34 C31 31 24 30 15 31 C22 34 28 38 34 43 Z" fill="url(#mizuchi-dark)" stroke="${K}" stroke-width="1.2" stroke-linejoin="round"/>`;
  const barbelD = 'M47 85 C37 84 31 90 27 98 C23 106 16 107 12 113 C8 119 9 124 11 128';
  const barbelL = `<path d="${barbelD}" stroke="${K}" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="${barbelD}" stroke="#5a6479" stroke-width="1.5" fill="none" stroke-linecap="round"/>${node(28.4, 95.6)}${node(18.4, 107.6)}${node(9.7, 119.8)}`;
  // ---- head
  const skull = `<path d="M64 11 L80 19 L92 35 L97 50 L89 65 L64 71 L39 65 L31 50 L36 35 L48 19 Z" fill="url(#mizuchi-plate)" stroke="${K}" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M64 11 L69 25 L64 37 L59 25 Z" fill="#a9b3c6" stroke="${K}" stroke-width=".8" stroke-linejoin="round"/>
${both(`<path d="M34 53 L46 64 L48 90 L39 95 L28 73 Z" fill="url(#mizuchi-dark)" stroke="${K}" stroke-width="1.3" stroke-linejoin="round"/>`)}
<path d="M43 63 L85 63 L81 88 L74 97 L54 97 L47 88 Z" fill="url(#mizuchi-plate)" stroke="${K}" stroke-width="1.4" stroke-linejoin="round"/>
<path d="M47.6 79 L64 83 L80.4 79" stroke="${K}" stroke-width="1.1" fill="none"/><path d="M48 80.4 L64 84.4 L80 80.4" stroke="#9aa4b8" stroke-width=".7" fill="none"/><path d="M64 66 V82.5" stroke="#a9b3c6" stroke-width="1"/><path d="M51 68 L55 78 M77 68 L73 78" stroke="#2a303b" stroke-width="1"/>
${both(`<circle cx="47.5" cy="85" r="2.6" fill="${K}" stroke="#6b7588" stroke-width=".8"/><circle cx="47.5" cy="85" r="1.1" fill="#ff6b82"/>`)}
${both(`<path d="M56 86.5 L61.4 88.6 L61.4 91 L56 89 Z" fill="#ff5a70"/><path d="M56 86.5 L61.4 88.6 L61.4 91 L56 89 Z" fill="none" stroke="${R}" stroke-width="2.2" opacity=".3"/>`)}
${both(`<path d="M29 35.5 L58.5 39.5 L64 44 L57.5 47 L33 45 Z" fill="url(#mizuchi-dark)" stroke="${K}" stroke-width="1.3" stroke-linejoin="round"/><path d="M30.5 36.2 L58 40" stroke="#b9c2d4" stroke-width="1" stroke-linecap="round"/>`)}
${glow('M64 38.5 V31 L70 25 L77 25 M64 31 L58 25 L51 25')}${node(77, 25)}${node(51, 25)}
${both(glow('M35 57 L41 64 L41 78 L45 86', .7) + node(41, 78, 1))}`;
  const socket = `<circle cx="64" cy="51.5" r="11.8" fill="${K}" stroke="#949eb2" stroke-width="1.4"/><circle cx="64" cy="51.5" r="13.6" fill="none" stroke="${K}" stroke-width="1" opacity=".8"/>`;
  const eyeOpen = `<circle cx="64" cy="51.5" r="26" fill="url(#mizuchi-glow)" opacity=".6"/><circle cx="64" cy="51.5" r="9.2" fill="url(#mizuchi-eye)"/><circle cx="64" cy="51.5" r="6.4" fill="none" stroke="#ffd9de" stroke-width=".55" opacity=".85"/><path d="M64 43.6 Q66.8 51.5 64 59.4 Q61.2 51.5 64 43.6 Z" fill="#26000a"/><circle cx="60.6" cy="48" r="1.3" fill="#fff" opacity=".9"/><path d="M64 38.9 V41.1 M64 61.9 V64.1 M51.4 51.5 H53.6 M74.4 51.5 H76.6" stroke="${R}" stroke-width="1.1"/>`;
  const eyeShut = `<path d="M52.2 51.5 A11.8 11.8 0 0 1 75.8 51.5 Z" fill="url(#mizuchi-plate)" stroke="${K}" stroke-width="1"/><path d="M52.2 51.5 A11.8 11.8 0 0 0 75.8 51.5 Z" fill="url(#mizuchi-dark)" stroke="${K}" stroke-width="1"/><rect x="53.5" y="50.8" width="21" height="1.4" fill="${R}" opacity=".5"/>`;
  const fangs = both(`<path d="M49 93 L55 95 L51.5 104.5 Z" fill="url(#mizuchi-fang)" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>`);
  const jawC = `<path d="M45 95 L83 95 L78.5 111 L49.5 111 Z" fill="url(#mizuchi-dark)" stroke="${K}" stroke-width="1.3" stroke-linejoin="round"/><g fill="#7e1026"><rect x="52" y="98.6" width="24" height="1.6" rx=".8"/><rect x="53" y="102.2" width="22" height="1.6" rx=".8"/><rect x="54" y="105.8" width="20" height="1.5" rx=".7"/></g>${fangs}`;
  const jawO = `<ellipse cx="64" cy="102" rx="30" ry="16" fill="url(#mizuchi-glow)" opacity=".85"/><path d="M50 95.5 L78 95.5 L76.5 100.5 L51.5 100.5 Z" fill="#ffc2cb"/><path d="M45 99.5 L83 99.5 L78.5 116 L49.5 116 Z" fill="url(#mizuchi-dark)" stroke="${K}" stroke-width="1.3" stroke-linejoin="round"/><g fill="#ff5c74"><rect x="52" y="103" width="24" height="2" rx="1"/><rect x="53" y="107" width="22" height="2" rx="1"/><rect x="54" y="111" width="20" height="1.8" rx=".9"/></g><g fill="#ffd0d7"><rect x="56" y="103.5" width="16" height=".9"/><rect x="57" y="107.5" width="14" height=".9"/></g>${fangs}`;
  const glitch = `<rect x="72" y="27" width="56" height="2.2" fill="${R}" opacity=".5"/><rect x="4" y="30.4" width="36" height="1.1" fill="#46e0ff" opacity=".5"/><rect x="0" y="80" width="38" height="2.6" fill="${R}" opacity=".32"/><rect x="88" y="83.4" width="40" height="1.2" fill="#fff" opacity=".38"/><rect x="58" y="122" width="44" height="1" fill="#46e0ff" opacity=".35"/>`;
  return wrap('mizuchi', defs, `<rect width="128" height="128" fill="url(#mizuchi-aura)"/>${neck}${both(finL)}${both(hornL)}${both(barbelL)}${skull}${socket}
<g class="pe-open">${eyeOpen}</g><g class="pe-closed">${eyeShut}</g>
<g class="pm-closed">${jawC}</g><g class="pm-open">${jawO}</g>${glitch}`);
}

// ---------------------------------------------------------------- fallback (unknown caller)
function noSignal() {
  const bars = [[14, 3], [37, 1.4], [61, 2.2], [88, 1.2], [109, 2.6]].map(([y, h], i) => `<rect x="${i % 2 ? 0 : 20}" y="${y}" width="${i % 2 ? 108 : 88}" height="${h}" fill="#9fb4d8" opacity=".22"/>`).join('');
  return wrap('', '', `<path d="M10 128 C12 110 26 101 44 98 L84 98 C102 101 116 110 118 128 Z" fill="#2a3552" stroke="#5a6d99" stroke-width="1.5"/><circle cx="64" cy="58" r="31" fill="#2a3552" stroke="#5a6d99" stroke-width="1.5"/>
<g class="pe-open"><circle cx="52" cy="56" r="3.2" fill="#7fb2ff"/><circle cx="76" cy="56" r="3.2" fill="#7fb2ff"/></g><g class="pe-closed"><path d="M48.5 56.5 H55.5 M72.5 56.5 H79.5" stroke="#7fb2ff" stroke-width="2" stroke-linecap="round"/></g>
<g class="pm-closed"><path d="M58 74 H70" stroke="#7fb2ff" stroke-width="2" stroke-linecap="round"/></g><g class="pm-open"><rect x="58" y="71" width="12" height="6" rx="3" fill="#7fb2ff"/></g>${bars}`);
}

const BUILDERS = { kota, gantetsu, rio, hou, mizuchi };
const ALIASES = { hq: 'hou' };
const cache = {};

/** @param {string} id one of the CHARACTERS keys (case-insensitive; 'hq' works for 'hou'). Unknown ids get a neutral "no signal" silhouette. */
export function portraitSVG(id) {
  let key = String(id ?? '').toLowerCase();
  key = ALIASES[key] || key;
  if (!BUILDERS[key]) key = '';
  return cache[key] || (cache[key] = key ? BUILDERS[key]() : noSignal());
}
