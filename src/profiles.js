// Character page entries (title → キャラクター). Texts only tell what the player could know at the start;
// anyone marked `known: false` shows as ？？？ until they have been met in the game (campaign.markSeen).
// face: portrait id (portraits.js; null = no face), ship: whose 3D ship the title camera circles while selected.
export const PROFILES = [
  {
    id: 'lancer1', group: 'ランサー隊', role: 'LANCER 1 · 隊長', nameJa: 'ランサー1', name: 'LANCER 1', face: null, ship: 'player', known: true,
    stats: [['所属', '新生ランサー隊'], ['機体', '白に青とオレンジ']],
    text: '新生ランサー隊の隊長。士官学校を首席で出た若いエースで、ガンテツの教え子。先代の隊長機を受け継いだ後継機に乗る。無線では喋らない——それは、あなた自身だから。',
    line: null,
  },
  {
    id: 'kota', group: 'ランサー隊', role: 'LANCER 2', nameJa: 'コタ', name: 'KOTA', face: 'kota', ship: 'kota', known: true,
    stats: [['種族', 'レッサーパンダ'], ['年齢', '18'], ['カラー', 'オレンジ'], ['一人称', 'ボク']],
    text: '元気でおしゃべり、怖いもの知らず。腕はいいが突っ込みすぎて、よく敵に追い回される。森の惑星シルヴァの出身。胸の星のワッペンは、子どもの頃に航空ショーで憧れのパイロットからもらった宝物。',
    line: 'よーし、いっくぞー！　隊長、しっかりついてくからね！',
  },
  {
    id: 'gantetsu', group: 'ランサー隊', role: 'LANCER 3', nameJa: 'ガンテツ', name: 'GANTETSU', face: 'gantetsu', ship: 'gantetsu', known: true,
    stats: [['種族', 'ニホンアナグマ'], ['年齢', '52'], ['カラー', 'オリーブ'], ['一人称', '俺']],
    text: '寡黙。口を開けば短く的確な助言。ゴーグルと顔の傷がトレードマーク。旧ランサー隊の古参で、隊の解散後は士官学校の教官として、隊長とコタを鍛えた。',
    line: '落ち着け。一機ずつ、確実にだ。',
  },
  {
    id: 'rio', group: 'ランサー隊', role: 'LANCER 4', nameJa: 'リオ', name: 'RIO', face: 'rio', ship: 'rio', known: true,
    stats: [['種族', 'カワウソ'], ['年齢', '24'], ['カラー', 'ターコイズ'], ['一人称', 'わたし']],
    text: '冷静な電子戦・解析担当。片目の小型モニターで敵を解析する。口調はやわらかいが、判断は誰より速い。海の惑星アクエリアの漁村の出身で、祖母から昔話を聞いて育った。',
    line: '解析はわたしに任せて。隊長は前だけ見てて。',
  },
  {
    id: 'hou', group: '司令部', role: 'COMMAND', nameJa: 'ホウ司令', name: 'HOU', face: 'hou', ship: null, known: true,
    stats: [['種族', 'ワシミミズク'], ['年齢', '64'], ['カラー', 'ゴールド'], ['一人称', '私']],
    text: '母艦アケボノの司令。厳格で、無線ではあまり多くを語らない。昔話の研究家でもあり、伝説の「槍持ち」にちなんで、ランサー隊と名付けた。',
    line: '無理をするな、ランサー1。',
  },
  {
    id: 'ibuki', group: '？？？', role: '？？？', nameJa: 'イブキ', name: 'IBUKI', face: 'ibuki', ship: null, known: false,
    stats: [['種族', 'ユキヒョウ'], ['年齢', '38']],
    text: '黒い機体に乗る、正体不明のパイロット。',
    line: null,
  },
  {
    id: 'tsumuji', group: 'カマイタチ隊', role: 'KAMAITACHI 1', nameJa: 'ツムジ', name: 'TSUMUJI', face: 'tsumuji', ship: null, known: false,
    stats: [['種族', 'イタチ']],
    text: '傭兵カマイタチ隊のリーダー。三きょうだいの長兄。お調子者で、挑発が大好き。',
    line: null,
  },
  {
    id: 'kiri', group: 'カマイタチ隊', role: 'KAMAITACHI 2', nameJa: 'キリ', name: 'KIRI', face: 'kiri', ship: null, known: false,
    stats: [['種族', 'イタチ']],
    text: 'カマイタチ隊の長女。無口で冷たい。刃の翼で斬り込んでくる。',
    line: null,
  },
  {
    id: 'hari', group: 'カマイタチ隊', role: 'KAMAITACHI 3', nameJa: 'ハリ', name: 'HARI', face: 'hari', ship: null, known: false,
    stats: [['種族', 'イタチ']],
    text: 'カマイタチ隊の末っ子。気弱だが、整備の腕は天才的。戦闘中に兄と姉の機体を直してしまう。',
    line: null,
  },
  {
    id: 'mizuchi', group: '機械獣', role: 'MACHINE BEAST', nameJa: 'ミズチ', name: 'MIZUCHI', face: 'mizuchi', ship: null, known: false,
    stats: [['昔話', '蛟（みずち）：水に棲む竜'], ['出現', '惑星アクエリア']],
    text: '海から現れた、竜の姿の大型機動兵器。背中に砲台を並べ、口の中のコアから掃射ビームを放つ。片言の言葉を話す。',
    line: '……侵入者ヲ確認。排除スル。',
  },
];
