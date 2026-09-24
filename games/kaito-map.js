// 怪盗と探偵の街を自動生成する。
// 5列×6行の交差点を少しずらして並べ、徒歩の道・バス路線3本・地下鉄の環状線1本でつなぐ。

const PLACE_NAMES = [
  '駅前広場', '時計塔', '美術館', '図書館', '港', '市場', '噴水公園', '教会', '劇場', '銀行',
  'ホテル', '大学', '病院', '商店街', '灯台', '石橋', '墓地', '動物園', '倉庫街', '花屋',
  '喫茶店', '古書店', '市役所', '郵便局', '映画館', '神社', '城跡', '展望台', '工場', '裁判所',
  '競技場', '温泉', '屋台通り', '画廊', '骨董店', '天文台', '植物園', '水族館', '博物館', '修道院',
];
const TREASURE_NAMES = ['宝石「月の涙」', '名画「夜の港」', '黄金の王冠', '秘伝の古文書', '翡翠の像'];

const COLS = 5;
const ROWS = 6;
const GAP_X = 120;
const GAP_Y = 124;
const PAD = 60;

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const idOf = (c, r) => r * COLS + c;

function connected(n, edges) {
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    for (const x of adj[stack.pop()]) if (!seen.has(x)) { seen.add(x); stack.push(x); }
  }
  return seen.size === n;
}

function degree(edges, id) {
  return edges.filter((e) => e.a === id || e.b === id).length;
}

function generateMap() {
  const names = shuffle(PLACE_NAMES);
  const nodes = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      nodes.push({
        id: idOf(c, r),
        c,
        r,
        x: PAD + c * GAP_X + rint(-22, 22),
        y: PAD + r * GAP_Y + rint(-22, 22),
        name: names[idOf(c, r)],
        bus: false,
        subway: false,
      });
    }
  }

  // 徒歩:格子の道から少し間引き、斜めの近道を少し足す
  let walk = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c < COLS - 1) walk.push({ a: idOf(c, r), b: idOf(c + 1, r), type: 'walk' });
      if (r < ROWS - 1) walk.push({ a: idOf(c, r), b: idOf(c, r + 1), type: 'walk' });
    }
  }
  for (const e of shuffle(walk)) {
    if (Math.random() > 0.22) continue;
    const rest = walk.filter((x) => x !== e);
    if (degree(rest, e.a) >= 2 && degree(rest, e.b) >= 2 && connected(nodes.length, rest)) walk = rest;
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      if (Math.random() < 0.14) {
        walk.push(Math.random() < 0.5
          ? { a: idOf(c, r), b: idOf(c + 1, r + 1), type: 'walk' }
          : { a: idOf(c + 1, r), b: idOf(c, r + 1), type: 'walk' });
      }
    }
  }

  // バス:横2本・縦1本。停留所は2区画おき
  const bus = [];
  const busLine = (stops) => {
    for (let i = 0; i < stops.length - 1; i++) bus.push({ a: stops[i], b: stops[i + 1], type: 'bus' });
    for (const s of stops) nodes[s].bus = true;
  };
  const rowTop = rint(0, 2);
  const rowBottom = rint(3, 5);
  busLine([0, 2, 4].map((c) => idOf(c, rowTop)));
  busLine([0, 2, 4].map((c) => idOf(c, rowBottom)));
  const col = rint(1, 3);
  const start = rint(0, 1);
  busLine([start, start + 2, start + 4].map((r) => idOf(col, r)));

  // 地下鉄:四隅の区画から1駅ずつ選んで環状にする
  const quad = (cs, rs) => idOf(pick(cs), pick(rs));
  const stations = [quad([0, 1], [0, 1, 2]), quad([3, 4], [0, 1, 2]), quad([3, 4], [3, 4, 5]), quad([0, 1], [3, 4, 5])];
  const subway = stations.map((s, i) => ({ a: s, b: stations[(i + 1) % stations.length], type: 'subway' }));
  for (const s of stations) nodes[s].subway = true;

  const edges = [...walk, ...bus, ...subway];
  const adj = Array.from({ length: nodes.length }, () => []);
  for (const e of edges) {
    adj[e.a].push({ to: e.b, type: e.type });
    adj[e.b].push({ to: e.a, type: e.type });
  }

  // 全点間の最短距離(乗り物の種類は問わない)
  const dist = nodes.map((n) => {
    const d = new Array(nodes.length).fill(Infinity);
    d[n.id] = 0;
    const q = [n.id];
    while (q.length) {
      const x = q.shift();
      for (const { to } of adj[x]) if (d[to] === Infinity) { d[to] = d[x] + 1; q.push(to); }
    }
    return d;
  });

  return {
    width: PAD * 2 + GAP_X * (COLS - 1),
    height: PAD * 2 + GAP_Y * (ROWS - 1),
    nodes: nodes.map(({ c, r, ...n }) => n),
    edges,
    adj,
    dist,
  };
}

// 互いに minGap 以上離れた場所を count 個選ぶ(無理なら条件をゆるめる)
function spreadPick(map, count, minGap, exclude = new Set(), extraOk = () => true) {
  for (let gap = minGap; gap >= 0; gap--) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const chosen = [];
      for (const n of shuffle(map.nodes)) {
        if (exclude.has(n.id) || !extraOk(n.id)) continue;
        if (chosen.every((c) => map.dist[c][n.id] >= gap)) chosen.push(n.id);
        if (chosen.length === count) return chosen;
      }
    }
  }
  return shuffle(map.nodes.map((n) => n.id).filter((id) => !exclude.has(id))).slice(0, count);
}

module.exports = { generateMap, spreadPick, TREASURE_NAMES };
