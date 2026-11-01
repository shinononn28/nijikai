/* カードの絵柄と山札づくり(サーバーと画面で共通)。
   - 絵柄は「一般名詞のイラスト」(絵文字)と「正体不明のイラスト」(SVG を番号から自動生成)の2種類。
     正体不明のほうは2体ずつ「そっくりさん」になっていて、どこか1か所だけ違う。
   - 山札は人数から合計枚数を決め(設定で変更可)、各絵柄の枚数は 2枚〜(山札の大きさに応じた上限)でランダム。
     選ばれない絵柄があってもよい。
   サーバー: const Cards = require('../public/games/cards.js')
   画面:     ゲームの定義に client: ['cards.js', '<ゲーム>.js'] と書くと window.NijiCards で使える */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NijiCards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 乱数(番号から毎回同じ絵を作るため、種つき) ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
  const choice = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function shuffle(arr, rng = Math.random) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 一般名詞のイラスト ----------
  // 行を足すだけで増やせる。[id, 名前, 絵文字]
  const NOUN_ROWS = [
    ['apple', 'りんご', '🍎'], ['banana', 'バナナ', '🍌'], ['grape', 'ぶどう', '🍇'], ['watermelon', 'すいか', '🍉'],
    ['strawberry', 'いちご', '🍓'], ['carrot', 'にんじん', '🥕'], ['mushroom', 'きのこ', '🍄'], ['bread', 'パン', '🍞'],
    ['onigiri', 'おにぎり', '🍙'], ['sushi', 'すし', '🍣'], ['cake', 'ケーキ', '🍰'], ['icecream', 'アイス', '🍦'],
    ['coffee', 'コーヒー', '☕'], ['dog', 'いぬ', '🐶'], ['cat', 'ねこ', '🐱'], ['rabbit', 'うさぎ', '🐰'],
    ['pig', 'ぶた', '🐷'], ['frog', 'かえる', '🐸'], ['penguin', 'ペンギン', '🐧'], ['octopus', 'たこ', '🐙'],
    ['fish', 'さかな', '🐟'], ['snake', 'へび', '🐍'], ['whale', 'くじら', '🐳'], ['bee', 'はち', '🐝'],
    ['umbrella', 'かさ', '☂️'], ['glasses', 'めがね', '👓'], ['shoe', 'くつ', '👟'], ['hat', 'ぼうし', '🎩'],
    ['key', 'かぎ', '🔑'], ['phone', 'でんわ', '📞'], ['clock', 'めざまし', '⏰'], ['book', 'ほん', '📕'],
    ['pencil', 'えんぴつ', '✏️'], ['scissors', 'はさみ', '✂️'], ['bulb', 'でんきゅう', '💡'], ['bicycle', 'じてんしゃ', '🚲'],
    ['car', 'くるま', '🚗'], ['airplane', 'ひこうき', '✈️'], ['sailboat', 'ヨット', '⛵'], ['rocket', 'ロケット', '🚀'],
    ['house', 'いえ', '🏠'], ['tree', 'き', '🌳'], ['tulip', 'チューリップ', '🌷'], ['sun', 'たいよう', '☀️'],
    ['moon', 'つき', '🌙'], ['snowman', 'ゆきだるま', '⛄'], ['guitar', 'ギター', '🎸'], ['dice', 'サイコロ', '🎲'],
    ['balloon', 'ふうせん', '🎈'], ['present', 'プレゼント', '🎁'],
    ['cherry', 'さくらんぼ', '🍒'], ['tomato', 'トマト', '🍅'], ['corn', 'とうもろこし', '🌽'], ['peach', 'もも', '🍑'],
    ['lemon', 'レモン', '🍋'], ['pizza', 'ピザ', '🍕'], ['hamburger', 'ハンバーガー', '🍔'], ['ramen', 'ラーメン', '🍜'],
    ['egg', 'たまご', '🥚'], ['donut', 'ドーナツ', '🍩'], ['bear', 'くま', '🐻'], ['panda', 'パンダ', '🐼'],
    ['monkey', 'さる', '🐵'], ['chick', 'ひよこ', '🐤'], ['turtle', 'かめ', '🐢'], ['crab', 'かに', '🦀'],
    ['butterfly', 'ちょうちょ', '🦋'], ['snail', 'かたつむり', '🐌'], ['elephant', 'ぞう', '🐘'], ['owl', 'ふくろう', '🦉'],
    ['crown', 'おうかん', '👑'], ['ribbon', 'リボン', '🎀'], ['bell', 'すず', '🔔'], ['candle', 'ろうそく', '🕯️'],
    ['hammer', 'かなづち', '🔨'], ['train', 'でんしゃ', '🚃'], ['bus', 'バス', '🚌'], ['star', 'ほし', '⭐'],
    ['rainbow', 'にじ', '🌈'], ['cactus', 'サボテン', '🌵'], ['sunflower', 'ひまわり', '🌻'], ['volcano', 'かざん', '🌋'],
  ];
  const NOUNS = NOUN_ROWS.map(([id, name, emoji]) => ({ id: `n:${id}`, type: 'noun', name, emoji }));

  // ---------- 正体不明のイラスト ----------
  const MYSTERY_COUNT = 40; // 2体ずつそっくりさん(20組)
  const MYSTERY = Array.from({ length: MYSTERY_COUNT }, (_, i) => ({
    id: `m:${String(i + 1).padStart(2, '0')}`,
    type: 'mystery',
    name: null, // 名前はない
    code: `なぞ${String(i + 1).padStart(2, '0')}`,
    pair: `m:${String((i ^ 1) + 1).padStart(2, '0')}`, // そっくりさんの id
  }));

  const ALL = [...NOUNS, ...MYSTERY];
  const BY_ID = new Map(ALL.map((k) => [k.id, k]));
  const get = (id) => BY_ID.get(id) || null;

  // 組ごとの基本の見た目。2体目はどこか1か所だけ変える
  function mysteryParams(index) {
    const family = Math.floor(index / 2);
    const rng = mulberry32(0x9e3779b1 ^ (family * 7919 + 13));
    const p = {
      hue: Math.floor((family * 137.5 + rng() * 40) % 360),
      sat: randInt(rng, 48, 72),
      lobes: randInt(rng, 2, 6),
      wobble: 0.06 + rng() * 0.16,
      phase: rng() * Math.PI * 2,
      rx: randInt(rng, 26, 34),
      ry: randInt(rng, 24, 34),
      extra: choice(rng, ['none', 'antennae', 'horns', 'ears', 'spikes', 'tentacles', 'tail']),
      extraN: randInt(rng, 3, 6),
      pattern: choice(rng, ['none', 'spots', 'stripes', 'belly']),
      eyes: choice(rng, [1, 2, 2, 3]),
      eyeStyle: choice(rng, ['round', 'round', 'sleepy', 'big']),
      mouth: choice(rng, ['smile', 'o', 'teeth', 'none', 'wavy']),
      cheeks: rng() < 0.4,
      noise: Array.from({ length: 12 }, () => rng() * 0.08 - 0.04),
    };
    if (index % 2 === 1) {
      // そっくりさん:1か所だけ変える
      const rng2 = mulberry32(0x85ebca6b ^ (index * 31 + 7));
      const what = choice(rng2, ['eyes', 'mouth', 'extra', 'pattern', 'hue', 'cheeks']);
      if (what === 'eyes') p.eyes = p.eyes === 2 ? choice(rng2, [1, 3]) : 2;
      if (what === 'mouth') p.mouth = choice(rng2, ['smile', 'o', 'teeth', 'none', 'wavy'].filter((m) => m !== p.mouth));
      if (what === 'extra') p.extra = choice(rng2, ['none', 'antennae', 'horns', 'ears', 'spikes', 'tentacles', 'tail'].filter((x) => x !== p.extra));
      if (what === 'pattern') p.pattern = choice(rng2, ['none', 'spots', 'stripes', 'belly'].filter((x) => x !== p.pattern));
      if (what === 'hue') p.hue = (p.hue + randInt(rng2, 35, 70)) % 360;
      if (what === 'cheeks') p.cheeks = !p.cheeks;
    }
    return p;
  }

  const f1 = (n) => Math.round(n * 10) / 10;

  // なめらかな閉曲線(Catmull-Rom を3次ベジェに)
  function smoothPath(pts) {
    const n = pts.length;
    let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
    }
    return `${d}Z`;
  }

  const svgCache = new Map();
  function mysterySvg(id) {
    if (svgCache.has(id)) return svgCache.get(id);
    const index = Number(String(id).slice(2)) - 1;
    const p = mysteryParams(index);
    const cx = 50;
    const cy = 56;
    const body = `hsl(${p.hue} ${p.sat}% 64%)`;
    const dark = `hsl(${p.hue} 40% 26%)`;
    const light = `hsl(${p.hue} ${p.sat}% 82%)`;
    const shade = `hsl(${(p.hue + 20) % 360} ${p.sat}% 50%)`;
    // 体の輪郭
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const k = 1 + p.wobble * Math.sin(p.lobes * a + p.phase) + p.noise[i];
      pts.push([cx + Math.cos(a) * p.rx * k, cy + Math.sin(a) * p.ry * k]);
    }
    const top = cy - p.ry;
    const bottom = cy + p.ry;
    let back = '';
    const sw = 'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
    if (p.extra === 'antennae') {
      for (const s of [-1, 1]) back += `<path d="M${cx + s * 8},${top + 6} Q${cx + s * 14},${top - 12} ${cx + s * 20},${top - 14}" fill="none" stroke="${dark}" ${sw}/><circle cx="${cx + s * 20}" cy="${top - 14}" r="4" fill="${shade}" stroke="${dark}" stroke-width="2.5"/>`;
    } else if (p.extra === 'horns') {
      for (const s of [-1, 1]) back += `<path d="M${cx + s * 10},${top + 8} L${cx + s * 20},${top - 12} L${cx + s * 22},${top + 10} Z" fill="${light}" stroke="${dark}" ${sw}/>`;
    } else if (p.extra === 'ears') {
      for (const s of [-1, 1]) back += `<ellipse cx="${cx + s * 20}" cy="${top + 4}" rx="9" ry="13" transform="rotate(${s * 25} ${cx + s * 20} ${top + 4})" fill="${shade}" stroke="${dark}" stroke-width="3"/>`;
    } else if (p.extra === 'spikes') {
      for (let i = 0; i < p.extraN; i++) {
        const a = Math.PI + ((i + 0.5) / p.extraN) * Math.PI;
        const bx = cx + Math.cos(a) * p.rx * 0.9;
        const by = cy + Math.sin(a) * p.ry * 0.9;
        const tx = cx + Math.cos(a) * (p.rx + 14);
        const ty = cy + Math.sin(a) * (p.ry + 14);
        const nx = -Math.sin(a) * 6;
        const ny = Math.cos(a) * 6;
        back += `<path d="M${f1(bx - nx)},${f1(by - ny)} L${f1(tx)},${f1(ty)} L${f1(bx + nx)},${f1(by + ny)} Z" fill="${shade}" stroke="${dark}" ${sw}/>`;
      }
    } else if (p.extra === 'tentacles') {
      for (let i = 0; i < p.extraN; i++) {
        const x = cx - p.rx * 0.7 + (i / (p.extraN - 1)) * p.rx * 1.4;
        const s = i % 2 ? 1 : -1;
        back += `<path d="M${f1(x)},${bottom - 6} q${s * 6},8 0,14 q${-s * 6},5 ${s * 2},10" fill="none" stroke="${dark}" stroke-width="5" stroke-linecap="round"/><path d="M${f1(x)},${bottom - 6} q${s * 6},8 0,14 q${-s * 6},5 ${s * 2},10" fill="none" stroke="${shade}" stroke-width="2.5" stroke-linecap="round"/>`;
      }
    } else if (p.extra === 'tail') {
      back += `<path d="M${cx + p.rx - 4},${cy + 8} q18,-2 16,-18 q-2,-8 6,-10" fill="none" stroke="${dark}" stroke-width="7" stroke-linecap="round"/><path d="M${cx + p.rx - 4},${cy + 8} q18,-2 16,-18 q-2,-8 6,-10" fill="none" stroke="${shade}" stroke-width="3.5" stroke-linecap="round"/>`;
    }
    // 足(全員にある小さな足)
    const feet = [-1, 1].map((s) => `<ellipse cx="${cx + s * p.rx * 0.45}" cy="${bottom + 1}" rx="7" ry="4.5" fill="${shade}" stroke="${dark}" stroke-width="2.5"/>`).join('');
    // 模様
    let pattern = '';
    if (p.pattern === 'spots') {
      const r = mulberry32(index * 101 + 5);
      for (let i = 0; i < 4; i++) pattern += `<circle cx="${f1(cx + (r() - 0.5) * p.rx * 1.2)}" cy="${f1(cy + 4 + r() * p.ry * 0.6)}" r="${f1(2.5 + r() * 3)}" fill="${light}"/>`;
    } else if (p.pattern === 'stripes') {
      for (let i = 0; i < 3; i++) pattern += `<path d="M${cx - p.rx * 0.6},${cy + 6 + i * 7} q${p.rx * 0.6},5 ${p.rx * 1.2},0" fill="none" stroke="${shade}" stroke-width="3" stroke-linecap="round"/>`;
    } else if (p.pattern === 'belly') {
      pattern = `<ellipse cx="${cx}" cy="${cy + p.ry * 0.38}" rx="${p.rx * 0.55}" ry="${p.ry * 0.4}" fill="${light}"/>`;
    }
    // 目
    const ey = cy - p.ry * 0.25;
    const xs = p.eyes === 1 ? [cx] : p.eyes === 2 ? [cx - 10, cx + 10] : [cx - 14, cx, cx + 14];
    const eyes = xs
      .map((x, i) => {
        const y = p.eyes === 3 && i === 1 ? ey - 6 : ey;
        if (p.eyeStyle === 'sleepy') return `<path d="M${x - 5},${y} q5,4 10,0" fill="none" stroke="${dark}" ${sw}/>`;
        const r = p.eyeStyle === 'big' || p.eyes === 1 ? 7.5 : 5.5;
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${dark}" stroke-width="2.5"/><circle cx="${x + 1.2}" cy="${y + 1}" r="${f1(r * 0.45)}" fill="${dark}"/>`;
      })
      .join('');
    // 口
    const my = cy + p.ry * 0.12;
    const mouth = {
      smile: `<path d="M${cx - 7},${my} q7,7 14,0" fill="none" stroke="${dark}" ${sw}/>`,
      o: `<ellipse cx="${cx}" cy="${my + 2}" rx="4" ry="5" fill="${dark}"/>`,
      teeth: `<path d="M${cx - 9},${my} h18 l-3,5 l-3,-5 l-3,5 l-3,-5 l-3,5 Z" fill="#fff" stroke="${dark}" stroke-width="2.2" stroke-linejoin="round"/>`,
      wavy: `<path d="M${cx - 9},${my + 1} q3,-3 6,0 t6,0 t6,0" fill="none" stroke="${dark}" ${sw}/>`,
      none: '',
    }[p.mouth];
    const cheeks = p.cheeks ? [-1, 1].map((s) => `<ellipse cx="${cx + s * 17}" cy="${my - 1}" rx="4.5" ry="3" fill="hsl(350 80% 72%)" opacity="0.8"/>`).join('') : '';
    const svg =
      `<svg class="nc-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="正体不明のなにか">` +
      back + feet +
      `<path d="${smoothPath(pts)}" fill="${body}" stroke="${dark}" stroke-width="3"/>` +
      pattern + cheeks + eyes + mouth +
      `</svg>`;
    svgCache.set(id, svg);
    return svg;
  }

  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // カードの絵の HTML(画面用)。opts.label: 名前を下に出す
  function render(id, opts = {}) {
    const k = get(id);
    if (!k) return '<span class="nc-art nc-unknown">?</span>';
    const art = k.type === 'noun' ? `<span class="nc-emoji" role="img" aria-label="${escHtml(k.name)}">${k.emoji}</span>` : mysterySvg(k.id);
    const label = opts.label ? `<span class="nc-label">${escHtml(k.name ?? '???')}</span>` : '';
    return `<span class="nc-art nc-${k.type}">${art}${label}</span>`;
  }

  // ---------- 山札 ----------
  // 人数から山札の合計枚数を決める(2人34枚・4人48枚・6人62枚…、30〜80枚)
  function autoDeckSize(players) {
    return Math.min(80, Math.max(30, 20 + 7 * Math.max(1, players)));
  }
  function deckSize(players, setting = 'auto') {
    const n = Number(setting);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : autoDeckSize(players);
  }
  // 何種類の絵柄を使うか。人数に合わせて増やし、少しランダムにぶらす(2人8〜11種類・4人12〜15種類・6人16〜19種類…)
  // level: 'few' 少なめ / 'many' 多め / それ以外はふつう
  function autoKinds(players, rng = Math.random, level = 'auto') {
    const base = 4 + 2 * Math.max(1, players) + randInt(rng, 0, 3);
    const mul = level === 'few' ? 0.7 : level === 'many' ? 1.4 : 1;
    return Math.max(3, Math.round(base * mul));
  }
  // 1種類あたりの上限枚数。山札が大きいほど多くなる(30枚→4、50枚→6、80枚→10)
  function maxCopiesFor(size, minCopies = 2) {
    return Math.max(minCopies + 1, Math.round(size / 8));
  }
  function pool(kind = 'mix') {
    if (kind === 'nouns') return NOUNS.map((k) => k.id);
    if (kind === 'mystery') return MYSTERY.map((k) => k.id);
    return ALL.map((k) => k.id);
  }

  // 山札を作る。返り値 { cards: [id...](シャッフル済み), counts: { id: 枚数 }, kinds: 使った絵柄の数, unused: 使わなかった id }
  // options: size(合計枚数), pool(絵柄の id の配列), kinds(使う種類の数の目安), minCopies(既定2), maxCopies(既定は size から), rng(既定 Math.random),
  //          mysteryShare(正体不明の割合 0〜1。省略時は絵柄をそのまま混ぜて選ぶ)
  function buildDeck(options = {}) {
    const rng = options.rng || Math.random;
    const size = Math.max(2, Math.round(options.size || 40));
    const kinds = options.pool || pool('mix');
    const minCopies = Math.max(1, options.minCopies ?? 2);
    if (!kinds.length) throw new Error('絵柄がありません');
    let maxCopies = Math.max(minCopies, options.maxCopies ?? maxCopiesFor(size, minCopies));
    maxCopies = Math.max(maxCopies, Math.ceil(size / kinds.length)); // 絵柄が少なすぎるときは上限を上げる
    const kMin = Math.max(1, Math.ceil(size / maxCopies));
    const kMax = Math.max(kMin, Math.min(kinds.length, Math.floor(size / minCopies)));
    // 種類の数:指定があればそれに近づける(山札の枚数から無理のない範囲に収める)。なければ範囲内でランダム
    const k = options.kinds ? Math.max(kMin, Math.min(kMax, Math.round(options.kinds))) : randInt(rng, kMin, kMax);
    // 使う絵柄を選ぶ(正体不明の割合の指定があればそれに寄せる)
    let chosen;
    if (typeof options.mysteryShare === 'number') {
      const ms = shuffle(kinds.filter((id) => id.startsWith('m:')), rng);
      const ns = shuffle(kinds.filter((id) => !id.startsWith('m:')), rng);
      const wantM = Math.min(ms.length, Math.round(k * options.mysteryShare));
      chosen = [...ms.slice(0, wantM), ...ns.slice(0, k - wantM)];
      if (chosen.length < k) chosen.push(...ms.slice(wantM, wantM + k - chosen.length));
    } else chosen = shuffle(kinds, rng).slice(0, k);
    const counts = Object.fromEntries(chosen.map((id) => [id, minCopies]));
    let rest = size - chosen.length * minCopies;
    while (rest > 0) {
      const open = chosen.filter((id) => counts[id] < maxCopies);
      const id = open.length ? choice(rng, open) : choice(rng, chosen);
      counts[id]++;
      rest--;
    }
    const cards = shuffle(chosen.flatMap((id) => Array(counts[id]).fill(id)), rng);
    const used = new Set(chosen);
    return { cards, counts, kinds: chosen.length, minCopies, maxCopies, unused: kinds.filter((id) => !used.has(id)) };
  }

  // ゲームの定義の settings にそのまま足せるロビーの設定欄
  const SETTINGS = [
    {
      key: 'deckSize',
      label: '山札の枚数',
      default: 'auto',
      options: [
        { value: 'auto', label: 'おまかせ(人数で決める)' },
        ...[30, 40, 50, 60, 80, 100].map((n) => ({ value: n, label: `${n}枚` })),
      ],
    },
    {
      key: 'cardPool',
      label: '絵柄',
      default: 'mix',
      options: [
        { value: 'mix', label: 'ふつうの絵となぞの絵をまぜる' },
        { value: 'mysteryMost', label: 'なぞの絵を多めに' },
        { value: 'nouns', label: 'ふつうの絵だけ' },
        { value: 'mystery', label: 'なぞの絵だけ(むずかしい)' },
      ],
    },
    {
      key: 'kinds',
      label: '絵柄の種類',
      default: 'auto',
      options: [
        { value: 'auto', label: '人数に合わせる(少しランダム)' },
        { value: 'few', label: '少なめ(同じ絵がよく出る)' },
        { value: 'many', label: '多め(覚えることが増える)' },
      ],
    },
  ];
  // settings から山札を作る近道
  function deckFromSettings(settings, players, rng) {
    const kind = settings?.cardPool;
    const mysteryShare = kind === 'mysteryMost' ? 0.7 : undefined;
    const r = rng || Math.random;
    const kinds = autoKinds(players, r, settings?.kinds);
    return buildDeck({ size: deckSize(players, settings?.deckSize), pool: pool(kind), kinds, mysteryShare, rng: r });
  }

  return {
    NOUNS, MYSTERY, ALL, get, render, mysterySvg, pool,
    autoDeckSize, autoKinds, deckSize, maxCopiesFor, buildDeck, deckFromSettings, SETTINGS,
    mulberry32, shuffle,
  };
});
