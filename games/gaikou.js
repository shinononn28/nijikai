// 小国の外交
// 自動生成の小さな大陸で陣取り。命令は全員同時に出し、一斉に解決する。
// 条約は囚人のジレンマ:お互い守れば平和配当、片方だけ攻めれば奇襲ボーナス、両方攻めれば共倒れ。
// 拠点(★)の4割を取れば即勝利。8ラウンド終われば ★ + 秘密の目標 の点数で勝負。

const NAMES = [
  '霧ヶ丘', '白樺村', '鉄の峠', '塩の湖', '赤砂原', '風車村', '古城跡', '銀鉱山', '灰の森', '鷹の巣',
  '月見台', '麦畑', '石切場', '渡し場', '狼谷', '葡萄園', '竜骨岬', '星見塔', '薬草原', '黒沼',
  '琥珀港', '鐘楼町', '羊飼い村', '風穴', '霜降り平', '大滝', '砦跡', '市場町', '灯火村', '苔むす谷',
  '水車小屋', '翠湖', '硫黄泉', '巡礼路', '蜂蜜村', '岩塩坑', '雲雀野', '鍛冶町', '花畑', '風見岬',
];
const NATION_NAMES = ['アルバ', 'ベルク', 'カルナ', 'ドーラ', 'エステ', 'フィオ'];
const COLORS = ['#c8323c', '#2f6fb0', '#2f8a5a', '#c7801f', '#7a4fb0', '#2f9fa8'];
const SURPRISE = 2;
const DIVIDEND_CAP = 2;
const BETRAY_PENALTY = 2;
const COOLDOWN = 2;
const OBJECTIVE_POINTS = 2;
const RAIL_CAP = 3; // 鉄道で1回の命令に運べる兵の上限(遠くへの奇襲はできるが、大軍の瞬間移動はできない)

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

// ---------- 地図 ----------
function generateMap(nationCount) {
  // スマホでも見やすいよう縦長〜正方形にする
  const [cols, rows] = { 3: [4, 5], 4: [4, 6], 5: [5, 6], 6: [6, 6] }[nationCount] || [5, 6];
  const GX = 112;
  const GY = 108;
  const PAD = 56;
  const names = shuffle(NAMES);
  const id = (c, r) => r * cols + c;
  const nodes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({ id: id(c, r), c, r, x: PAD + c * GX + (r % 2) * 26 + rint(-16, 16), y: PAD + r * GY + rint(-16, 16), name: names[id(c, r)], star: false });
    }
  }
  let edges = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1) edges.push([id(c, r), id(c + 1, r)]);
      if (r < rows - 1) edges.push([id(c, r), id(c, r + 1)]);
    }
  }
  const connected = (list) => {
    const adj = nodes.map(() => []);
    for (const [a, b] of list) { adj[a].push(b); adj[b].push(a); }
    const seen = new Set([0]);
    const st = [0];
    while (st.length) for (const x of adj[st.pop()]) if (!seen.has(x)) { seen.add(x); st.push(x); }
    return seen.size === nodes.length;
  };
  const deg = (list, n) => list.filter(([a, b]) => a === n || b === n).length;
  for (const e of shuffle(edges)) {
    if (Math.random() > 0.14) continue;
    const rest = edges.filter((x) => x !== e);
    if (deg(rest, e[0]) >= 2 && deg(rest, e[1]) >= 2 && connected(rest)) edges = rest;
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (Math.random() < 0.18) edges.push(r % 2 ? [id(c + 1, r), id(c, r + 1)] : [id(c, r), id(c + 1, r + 1)]);
    }
  }
  const bfs = (adjList) =>
    nodes.map((n) => {
      const d = new Array(nodes.length).fill(Infinity);
      d[n.id] = 0;
      const q = [n.id];
      while (q.length) { const x = q.shift(); for (const y of adjList[x]) if (d[y] === Infinity) { d[y] = d[x] + 1; q.push(y); } }
      return d;
    });
  const roadAdj = nodes.map(() => []);
  for (const [a, b] of edges) { roadAdj[a].push(b); roadAdj[b].push(a); }
  const roadDist = bfs(roadAdj);

  // 鉄道:地図の四隅(と、国が多いときは左右の中ほど)に駅を置いて、対角線どうしを結ぶ。
  // どの方向の「後方」にも駅があるので、前線の後ろを兵0で空けておくと鉄道から突かれる
  const outer = (n) => n.c === 0 || n.c === cols - 1 || n.r === 0 || n.r === rows - 1;
  const zone = (cs, rs) => {
    const list = nodes.filter((n) => cs.includes(n.c) && rs.includes(n.r));
    const edge = list.filter(outer);
    return pick(edge.length ? edge : list).id;
  };
  const left = [0, 1];
  const right = [cols - 2, cols - 1];
  const top = [0, 1];
  const bottom = [rows - 2, rows - 1];
  const rails = [
    [zone(left, top), zone(right, bottom)],
    [zone(right, top), zone(left, bottom)],
  ];
  if (nationCount >= 5) {
    const mid = [Math.floor((rows - 1) / 2), Math.ceil((rows - 1) / 2)];
    rails.push([zone([0], mid), zone([cols - 1], mid)]);
  }
  const stations = new Set(rails.flat());
  const adj = roadAdj.map((list) => [...list]);
  for (const [a, b] of rails) { adj[a].push(b); adj[b].push(a); }
  for (const st of stations) nodes[st].station = true;
  const dist = bfs(adj);
  const width = PAD * 2 + GX * (cols - 1) + 26;
  const height = PAD * 2 + GY * (rows - 1);
  return { nodes: nodes.map(({ c, r, ...n }) => n), edges, rails, adj, roadAdj, dist, width, height, cols, rows };
}

function spread(map, count, gap, excluded = new Set()) {
  for (let g = gap; g >= 1; g--) {
    for (let t = 0; t < 80; t++) {
      const out = [];
      for (const n of shuffle(map.nodes)) {
        if (excluded.has(n.id)) continue;
        if (out.every((o) => map.dist[o][n.id] >= g) && [...excluded].every((e) => map.dist[e][n.id] >= Math.min(g, 2))) out.push(n.id);
        if (out.length === count) return out;
      }
    }
  }
  return shuffle(map.nodes.map((n) => n.id).filter((x) => !excluded.has(x))).slice(0, count);
}

// ---------- ゲーム ----------
class GaikouGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    const count = Math.max(settings.nations, humanIds.length);
    this.map = generateMap(count);
    const names = shuffle(NATION_NAMES);
    this.nations = [];
    shuffle(humanIds).forEach((owner, i) => this.nations.push({ id: `n${i + 1}`, owner, cpu: false }));
    while (this.nations.length < count) this.nations.push({ id: `n${this.nations.length + 1}`, owner: null, cpu: true });
    this.nations.forEach((n, i) => {
      n.color = COLORS[i];
      n.cpuTitle = `${names[i]}国`; // CPUの国の名前(人間の国はプレイヤー名)
      n.broken = 0;
      n.everTreaty = false;
      n.penalty = 0;
      n.ready = false;
    });

    // 領地:owner(国id or null)と兵。首都の位置から★の配置までを何通りか試し、国ごとの差が一番小さいものを使う
    const stationSet = new Set(this.map.nodes.filter((n) => n.station).map((n) => n.id));
    let best = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const capitals = spread(this.map, count, 3, stationSet);
      const terr = this.map.nodes.map(() => ({ owner: null, troops: 0 }));
      this.nations.forEach((n, i) => { terr[capitals[i]] = { owner: n.id, troops: 4 }; });
      this.nations.forEach((n, i) => {
        const free = shuffle(this.map.adj[capitals[i]].filter((x) => !terr[x].owner));
        for (const x of free.slice(0, 2)) terr[x] = { owner: n.id, troops: 2 };
      });
      const taken = new Set(terr.map((t, i) => (t.owner ? i : -1)).filter((i) => i >= 0));
      const placed = this.placeStars(taken, capitals);
      if (!best || placed.sc < best.placed.sc) best = { capitals, terr, placed };
      if (placed.sc === 0) break;
    }
    this.terr = best.terr;
    this.nations.forEach((n, i) => {
      n.capital = best.capitals[i];
      this.map.nodes[n.capital].star = true;
    });
    for (const x of best.placed.stars) {
      this.map.nodes[x].star = true;
      this.terr[x] = { owner: null, troops: 2 };
    }
    this.terr.forEach((t, i) => { if (!t.owner && !this.map.nodes[i].star) t.troops = rint(0, 1); });

    this.starTotal = this.map.nodes.filter((n) => n.star).length;
    this.winStars = Math.ceil(this.starTotal * 0.4);
    this.treaties = []; // {a, b, since}
    this.proposals = []; // {from, to}
    this.cooldown = {}; // "a|b" → このラウンドまで結べない
    this.round = 0;
    this.seq = 0;
    this.lastResult = null;
    this.history = [];
    if (settings.objectives) this.assignObjectives();

    this.ctx.system(`${count}か国で開戦。★は全部で${this.starTotal}つ、${this.winStars}つ取れば即勝利。全${settings.rounds}ラウンドです`);
    this.startRound();
  }

  // --- 無所属の★の配置 ---
  // 各国に「自分の首都のほうが近い★」を1つずつ同じくらいの距離で用意し、残り2つは複数の国から等距離の奪い合いの★にする。
  // 何通りか試して、国ごとの差(近い★の数・一番近い★までの距離)が一番小さい配置を選ぶ
  placeStars(taken, caps) {
    const dist = this.map.dist;
    const nodes = this.map.nodes.map((n) => n.id);
    const nearest = (x) => {
      const ds = caps.map((c) => dist[c][x]);
      const min = Math.min(...ds);
      const who = ds.filter((d) => d === min).length === 1 ? ds.indexOf(min) : -1;
      return { min, who, ds };
    };
    const score = (stars) => {
      const share = caps.map(() => 0);
      for (const x of stars) {
        const { who } = nearest(x);
        if (who >= 0) share[who]++;
      }
      const near = caps.map((c) => Math.min(...stars.map((x) => dist[c][x])));
      const within3 = caps.map((c) => stars.filter((x) => dist[c][x] <= 3).length);
      const gap = (a) => Math.max(...a) - Math.min(...a);
      return gap(within3) * 3 + gap(near) * 2 + gap(share);
    };
    let best = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const stars = [];
      const free = (x) => !taken.has(x) && !stars.includes(x) && stars.every((y) => dist[x][y] >= 2);
      // 1) 各国の「自分の★」:自分の首都から2〜3、ほかの首都よりはっきり近い場所
      for (const i of shuffle(caps.map((_, i) => i))) {
        let cands = nodes.filter((x) => free(x) && [2, 3].includes(dist[caps[i]][x]) && nearest(x).who === i);
        if (!cands.length) cands = nodes.filter((x) => free(x) && dist[caps[i]][x] >= 2 && dist[caps[i]][x] <= 4 && nearest(x).who === i);
        if (cands.length) stars.push(pick(cands));
      }
      // 2) 奪い合いの★:一番近い首都と2番目に近い首都の差が1以内の場所
      const contested = (x) => {
        const ds = [...nearest(x).ds].sort((a, b) => a - b);
        return ds[0] >= 2 && ds[1] - ds[0] <= 1;
      };
      const tied = (x) => {
        const ds = [...nearest(x).ds].sort((a, b) => a - b);
        return ds[0] >= 2 && ds[1] === ds[0];
      };
      while (stars.length < caps.length + 2) {
        let cands = nodes.filter((x) => free(x) && tied(x));
        if (!cands.length) cands = nodes.filter((x) => free(x) && contested(x));
        if (!cands.length) cands = nodes.filter(free);
        if (!cands.length) break;
        stars.push(pick(cands));
      }
      const sc = score(stars);
      if (!best || sc < best.sc) best = { sc, stars };
      if (sc === 0) break;
    }
    return best;
  }

  // --- 共通 ---
  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  nation(id) {
    return this.nations.find((n) => n.id === id);
  }
  nationOf(pid) {
    return this.nations.find((n) => n.owner === pid) || null;
  }
  // 国名:人間の国はプレイヤー名、CPUの国は生成した国名
  nm(n) {
    return n.owner ? this.ctx.nameOf(n.owner) : n.cpuTitle;
  }
  label(n) {
    return n.owner ? this.nm(n) : `${n.cpuTitle}(CPU)`;
  }
  terrName(id) {
    return this.map.nodes[id].name;
  }
  owned(nid) {
    return this.terr.map((t, i) => (t.owner === nid ? i : -1)).filter((i) => i >= 0);
  }
  stars(nid) {
    return this.owned(nid).filter((i) => this.map.nodes[i].star).length;
  }
  troops(nid) {
    return this.owned(nid).reduce((s, i) => s + this.terr[i].troops, 0);
  }
  key(a, b) {
    return [a, b].sort().join('|');
  }
  hasTreaty(a, b) {
    return this.treaties.some((t) => this.key(t.a, t.b) === this.key(a, b));
  }
  isActive(n) {
    return n.cpu || this.ctx.isConnected(n.owner);
  }

  // --- 秘密の目標 ---
  assignObjectives() {
    const half = {
      北: (n) => n.y < this.map.height / 2,
      南: (n) => n.y >= this.map.height / 2,
      西: (n) => n.x < this.map.width / 2,
      東: (n) => n.x >= this.map.width / 2,
    };
    const regions = Object.keys(half).filter((r) => this.map.nodes.filter((n) => n.star && half[r](n)).length >= 3);
    const landGoal = Math.ceil(this.map.nodes.length / this.nations.length) + 2;
    for (const n of this.nations) {
      const kinds = ['capital', 'land', 'honest'];
      if (regions.length) kinds.push('region');
      const kind = pick(kinds);
      if (kind === 'capital') {
        const target = pick(this.nations.filter((x) => x !== n));
        n.objective = { kind, target: target.capital, text: `${this.nm(target)}の首都「${this.terrName(target.capital)}」を持っている` };
      } else if (kind === 'region') {
        const r = pick(regions);
        n.objective = { kind, region: r, text: `大陸の${r}半分にある★を2つ以上持っている` };
        n.objective.test = half[r];
      } else if (kind === 'land') {
        n.objective = { kind, goal: landGoal, text: `領地を${landGoal}つ以上持っている` };
      } else {
        n.objective = { kind, text: '条約を1つ以上結び、一度も破らずに終える' };
      }
    }
  }

  objectiveDone(n) {
    const o = n.objective;
    if (!o) return false;
    if (o.kind === 'capital') return this.terr[o.target].owner === n.id;
    if (o.kind === 'land') return this.owned(n.id).length >= o.goal;
    if (o.kind === 'honest') return n.everTreaty && n.broken === 0;
    if (o.kind === 'region') return this.owned(n.id).filter((i) => this.map.nodes[i].star && o.test(this.map.nodes[i])).length >= 2;
    return false;
  }

  // ---------- ラウンド ----------
  startRound() {
    this.round++;
    this.phase = 'orders';
    this.orders = {};
    for (const n of this.nations) n.ready = false;
    this.respawnRebels();
    const ms = this.s.roundSeconds * 1000;
    this.endsAt = Date.now() + ms;
    this.phaseTimer = this.later(ms, () => this.resolve());
    this.seq++;
    this.ctx.system(`第${this.round}ラウンド / ${this.s.rounds}。交渉して命令を出してください`);
    this.ctx.update();
  }

  respawnRebels() {
    for (const n of this.nations) {
      if (this.owned(n.id).length > 0) continue;
      const leader = [...this.nations]
        .filter((x) => x !== n && this.owned(x.id).length > 1)
        .sort((a, b) => this.stars(b.id) - this.stars(a.id) || this.troops(b.id) - this.troops(a.id))[0];
      if (!leader) continue;
      const lands = this.owned(leader.id).filter((i) => i !== leader.capital);
      const spot = lands.sort((a, b) => this.terr[a].troops - this.terr[b].troops)[0];
      if (spot === undefined) continue;
      this.terr[spot] = { owner: n.id, troops: 3 };
      this.ctx.system(`${this.label(n)}が、${this.nm(leader)}の${this.terrName(spot)}で反乱軍として蜂起した!`);
    }
  }

  // 命令:{from, to, n, kind:'move'|'support', side?}
  sanitizeOrders(nid, list) {
    const out = [];
    const used = {};
    if (!Array.isArray(list)) return out;
    for (const o of list.slice(0, 60)) {
      const from = Number(o?.from);
      const to = Number(o?.to);
      let count = Math.floor(Number(o?.n));
      if (!this.terr[from] || !this.terr[to] || this.terr[from].owner !== nid) continue;
      if (!this.map.adj[from].includes(to) || !(count > 0)) continue;
      if (!this.map.roadAdj[from].includes(to)) count = Math.min(count, RAIL_CAP); // 鉄道は定員つき
      const kind = o.kind === 'support' ? 'support' : 'move';
      let side = null;
      if (kind === 'support') {
        side = String(o.side || '');
        if (!this.nation(side) || side === nid) continue;
      }
      const left = this.terr[from].troops - (used[from] || 0);
      count = Math.min(count, left);
      if (count <= 0) continue;
      used[from] = (used[from] || 0) + count;
      out.push({ from, to, n: count, kind, side });
    }
    return out;
  }

  checkAllReady() {
    if (this.phase !== 'orders') return;
    const waiting = this.nations.some((n) => !n.cpu && this.isActive(n) && !n.ready);
    if (!waiting) this.resolve();
  }

  // 条約相手を攻めているか(攻撃、または第三国の攻撃への援軍)
  hostileTo(nid, target) {
    return (this.orders[nid] || []).some((o) => {
      const owner = this.terr[o.to].owner;
      if (owner !== target) return false;
      return o.kind === 'move' || (o.kind === 'support' && o.side !== target);
    });
  }

  resolve() {
    if (this.phase !== 'orders') return;
    clearTimeout(this.phaseTimer);
    this.timers.delete(this.phaseTimer);
    for (const n of this.nations) if (n.cpu) this.orders[n.id] = this.cpuOrders(n);
    for (const n of this.nations) this.orders[n.id] = this.sanitizeOrders(n.id, this.orders[n.id] || []);

    const events = [];
    // --- 条約の判定 ---
    const surprise = new Set(); // "攻める側|攻められる側"
    const brokenNow = [];
    const breaches = []; // 画面のモーダル用
    for (const t of [...this.treaties]) {
      const ab = this.hostileTo(t.a, t.b);
      const ba = this.hostileTo(t.b, t.a);
      if (!ab && !ba) continue;
      const A = this.nation(t.a);
      const B = this.nation(t.b);
      if (ab && ba) {
        A.penalty += BETRAY_PENALTY;
        B.penalty += BETRAY_PENALTY;
        A.broken++;
        B.broken++;
        events.push(`${this.nm(A)}と${this.nm(B)}が互いに条約を破った。共倒れで両国とも次の増援が${BETRAY_PENALTY}減る`);
        breaches.push({ kind: 'mutual', a: A.id, b: B.id });
      } else {
        const [atk, vic] = ab ? [A, B] : [B, A];
        atk.broken++;
        surprise.add(`${atk.id}|${vic.id}`);
        events.push(`${this.nm(atk)}が${this.nm(vic)}との条約を破って奇襲した!(攻撃に+${SURPRISE})`);
        breaches.push({ kind: 'surprise', a: atk.id, b: vic.id });
      }
      brokenNow.push(t);
      this.cooldown[this.key(t.a, t.b)] = this.round + COOLDOWN;
    }
    this.treaties = this.treaties.filter((t) => !brokenNow.includes(t));

    // --- 兵の移動 ---
    const prevTerr = this.terr.map((t) => ({ ...t }));
    const garrison = this.terr.map((t) => t.troops);
    const returning = []; // {to, owner, n}
    const attacks = {}; // 領地 → {国: 兵}
    const supports = {}; // 領地 → {支援先の国: [{from, owner, n}]}
    for (const [nid, list] of Object.entries(this.orders)) {
      for (const o of list) {
        garrison[o.from] -= o.n;
        if (o.kind === 'move') {
          if (this.terr[o.to].owner === nid) garrison[o.to] += o.n;
          else ((attacks[o.to] ||= {})[nid] = (attacks[o.to]?.[nid] || 0) + o.n);
        } else {
          ((supports[o.to] ||= {})[o.side] ||= []).push({ from: o.from, owner: nid, n: o.n });
        }
      }
    }
    const next = this.terr.map((t, i) => ({ owner: t.owner, troops: garrison[i] }));

    // --- 戦闘 ---
    const battles = [];
    for (const [toStr, atk] of Object.entries(attacks)) {
      const to = Number(toStr);
      const owner = this.terr[to].owner;
      const sides = [];
      const supTroops = (nid) => (supports[to]?.[nid] || []).reduce((s, x) => s + x.n, 0);
      if (owner || garrison[to] > 0) {
        const sup = owner ? supTroops(owner) : 0;
        sides.push({ nation: owner, role: 'def', own: Math.max(0, garrison[to]), sup, dice: owner ? rint(0, 2) : 0, bonus: 0 });
      }
      for (const [nid, n] of Object.entries(atk)) {
        const bonus = owner && surprise.has(`${nid}|${owner}`) ? SURPRISE : 0;
        sides.push({ nation: nid, role: 'atk', own: n, sup: supTroops(nid), dice: rint(0, 2), bonus });
      }
      for (const sd of sides) {
        sd.total = sd.own + sd.sup;
        sd.strength = sd.total + sd.dice + sd.bonus;
      }
      const max = Math.max(...sides.map((x) => x.strength));
      const top = sides.filter((x) => x.strength === max);
      let winner = null;
      if (top.length === 1) winner = top[0];
      else winner = top.find((x) => x.role === 'def') || null;
      const others = sides.filter((x) => x !== winner);
      const second = others.length ? Math.max(...others.map((x) => x.total)) : 0;
      let result;
      if (!winner) {
        // 攻撃側どうしが同点:全員押し返されて元の領地へ
        for (const sd of sides.filter((x) => x.role === 'atk')) {
          for (const o of this.orders[sd.nation].filter((o) => o.kind === 'move' && o.to === to)) returning.push({ to: o.from, owner: sd.nation, n: o.n });
        }
        result = 'bounce';
      } else if (winner.role === 'def') {
        next[to].troops = Math.min(winner.own, Math.max(winner.own > 0 ? 1 : 0, winner.total - second));
        result = 'held';
      } else {
        next[to] = { owner: winner.nation, troops: Math.min(winner.own, Math.max(1, winner.total - second)) };
        result = 'taken';
      }
      battles.push({
        node: to,
        owner,
        result,
        winner: winner?.nation ?? null,
        sides: sides.map((x) => ({ nation: x.nation, role: x.role, own: x.own, sup: x.sup, dice: x.dice, bonus: x.bonus, strength: x.strength })),
        supporters: Object.values(supports[to] || {}).flat().map((x) => x.owner),
      });
    }
    // 援軍は戦闘のあと元の領地へ帰る(その領地を失っていたら帰れない)
    for (const list of Object.values(supports)) for (const arr of Object.values(list)) for (const x of arr) returning.push({ to: x.from, owner: x.owner, n: x.n });
    for (const r of returning) if (next[r.to].owner === r.owner) next[r.to].troops += r.n;
    for (const t of next) if (t.troops < 0) t.troops = 0;
    this.terr = next;

    // --- 平和配当と増援 ---
    const dividend = {};
    for (const t of this.treaties) {
      for (const nid of [t.a, t.b]) dividend[nid] = Math.min(DIVIDEND_CAP, (dividend[nid] || 0) + 1);
    }
    for (const n of this.nations) {
      const lands = this.owned(n.id);
      if (!lands.length) continue;
      const home = this.terr[n.capital].owner === n.id ? n.capital : lands.sort((a, b) => this.terr[b].troops - this.terr[a].troops)[0];
      if (dividend[n.id]) this.terr[home].troops += dividend[n.id];
      let income = lands.filter((i) => this.map.nodes[i].star);
      const cut = Math.min(n.penalty, income.length);
      n.penalty = 0;
      income = shuffle(income).slice(cut);
      for (const i of income) this.terr[i].troops += 1;
    }

    // --- 記録とお知らせ ---
    const taken = battles.filter((b) => b.result === 'taken');
    for (const b of taken) {
      const w = this.nation(b.winner);
      events.push(`${this.nm(w)}が${this.terrName(b.node)}${b.owner ? `を${this.nm(this.nation(b.owner))}から奪った` : 'を占領した'}`);
    }
    if (Object.keys(dividend).length) events.push(`平和配当:${Object.entries(dividend).map(([id, d]) => `${this.nm(this.nation(id))}+${d}`).join('、')}`);
    const moves = Object.entries(this.orders).flatMap(([nid, list]) => list.map((o) => ({ ...o, nation: nid })));
    this.lastResult = { round: this.round, battles, events, moves, prevTerr, breaches };
    this.history.push({ round: this.round, events });
    for (const e of events) this.ctx.system(e);
    for (const n of this.nations) if (this.owned(n.id).length === 0) this.ctx.system(`${this.label(n)}は領地をすべて失った。次のラウンドに反乱軍として再起する`);

    // --- 勝敗 ---
    const reached = this.nations.filter((n) => this.stars(n.id) >= this.winStars);
    if (reached.length) return this.end('instant', reached);
    if (this.round >= this.s.rounds) return this.end('rounds');
    this.startRound();
  }

  score(n) {
    return this.stars(n.id) + (this.objectiveDone(n) ? OBJECTIVE_POINTS : 0);
  }

  // 勝者の決め方(画面にもこの順で表示する)
  //  即勝利:★が勝利ラインに届いた国のうち ★の数 → 領地の数 → 兵の数
  //  最終ラウンド後:全国のうち 点数(★+秘密の目標) → ★の数 → 領地の数 → 兵の数
  //  最後まで並んだら同率で勝ち
  criteria(kind) {
    const lands = ['lands', '領地の数', (n) => this.owned(n.id).length];
    const troops = ['troops', '兵の数', (n) => this.troops(n.id)];
    const stars = ['stars', '★の数', (n) => this.stars(n.id)];
    return kind === 'instant' ? [stars, lands, troops] : [['score', '点数(★+目標)', (n) => this.score(n)], stars, lands, troops];
  }

  end(kind, reached = []) {
    this.phase = 'ended';
    this.seq++;
    let pool = kind === 'instant' ? [...reached] : [...this.nations];
    const steps = [];
    let decidedBy = pool.length === 1 ? 'only' : null;
    for (const [key, label, f] of this.criteria(kind)) {
      if (pool.length === 1) break;
      const best = Math.max(...pool.map(f));
      const next = pool.filter((n) => f(n) === best);
      steps.push({ key, label, best, tied: next.length });
      if (next.length === 1) decidedBy = key;
      pool = next;
    }
    if (pool.length > 1) decidedBy = 'shared';
    this.winners = pool.map((n) => n.id);
    this.endKind = kind;
    this.decision = {
      decidedBy,
      reached: kind === 'instant' ? reached.map((n) => n.id) : [],
      steps,
      order: this.criteria(kind).map(([key, label]) => ({ key, label })),
    };
    const names = this.winners.map((id) => this.label(this.nation(id))).join('、');
    const how = this.decisionText();
    this.ctx.system(
      kind === 'instant'
        ? `${names}が★${this.stars(this.winners[0])}つを押さえて即勝利!${how}`
        : `全ラウンド終了。${names}の勝ち(${this.score(this.nation(this.winners[0]))}点)${how}`,
    );
    this.ctx.update();
  }

  // 「何で決まったか」を一文で
  decisionText() {
    const d = this.decision;
    if (!d || d.decidedBy === 'only') return '';
    const labels = Object.fromEntries(d.order.map((o) => [o.key, o.label]));
    const first = d.order[0];
    if (d.decidedBy === 'shared') return `(${d.order.map((o) => o.label).join('・')}がすべて同じため、同率で勝ち)`;
    if (d.decidedBy === first.key) return this.endKind === 'instant' ? `(同じラウンドに${d.reached.length}か国が届いたが、${first.label}で上回った)` : '';
    const tiedBefore = d.order.slice(0, d.order.findIndex((o) => o.key === d.decidedBy)).map((o) => o.label).join('・');
    return `(${tiedBefore}が同じため、${labels[d.decidedBy]}で決着)`;
  }

  // ---------- 条約 ----------
  propose(from, to) {
    if (!to || to === from || this.hasTreaty(from.id, to.id)) return;
    if ((this.cooldown[this.key(from.id, to.id)] || 0) >= this.round) return;
    const back = this.proposals.find((p) => p.from === to.id && p.to === from.id);
    if (back) return this.sign(to, from);
    if (this.proposals.some((p) => p.from === from.id && p.to === to.id)) return;
    this.proposals.push({ from: from.id, to: to.id });
    this.ctx.system(`${this.nm(from)}が${this.nm(to)}に不可侵条約を申し込んだ`);
    if (to.cpu) this.later(rint(1500, 4000), () => this.cpuAnswer(to, from));
  }

  sign(proposer, accepter) {
    this.proposals = this.proposals.filter((p) => !(this.key(p.from, p.to) === this.key(proposer.id, accepter.id)));
    if (this.hasTreaty(proposer.id, accepter.id)) return;
    this.treaties.push({ a: proposer.id, b: accepter.id, since: this.round });
    proposer.everTreaty = true;
    accepter.everTreaty = true;
    this.ctx.system(`${this.nm(proposer)}と${this.nm(accepter)}が不可侵条約を結んだ`);
  }

  decline(decliner, proposer) {
    const before = this.proposals.length;
    this.proposals = this.proposals.filter((p) => !(p.from === proposer.id && p.to === decliner.id));
    if (this.proposals.length !== before) this.ctx.system(`${this.nm(decliner)}は${this.nm(proposer)}の申し込みを断った`);
  }

  // ---------- CPU ----------
  cpuAnswer(cpu, from) {
    if (this.phase !== 'orders' || !this.proposals.some((p) => p.from === from.id && p.to === cpu.id)) return;
    const strong = this.troops(from.id) >= this.troops(cpu.id) * 0.9;
    if (strong || Math.random() < 0.3) this.sign(from, cpu);
    else this.decline(cpu, from);
    this.ctx.update();
  }

  cpuOrders(n) {
    const orders = [];
    const mine = this.owned(n.id);
    const partners = new Set(this.treaties.filter((t) => t.a === n.id || t.b === n.id).map((t) => (t.a === n.id ? t.b : t.a)));
    const betray = new Set(
      [...partners].filter((p) => {
        const strong = this.troops(n.id) > this.troops(p) * 1.3;
        return (strong && Math.random() < 0.3) || (this.round >= this.s.rounds - 2 && Math.random() < 0.4);
      }),
    );
    const left = Object.fromEntries(mine.map((i) => [i, this.terr[i].troops]));
    const border = (i) => this.map.adj[i].some((x) => this.terr[x].owner !== n.id);
    for (const from of shuffle(mine).sort((a, b) => this.terr[b].troops - this.terr[a].troops)) {
      const targets = this.map.adj[from]
        .filter((x) => this.terr[x].owner !== n.id)
        .filter((x) => !partners.has(this.terr[x].owner) || betray.has(this.terr[x].owner))
        .map((x) => {
          const t = this.terr[x];
          const need = t.troops + (t.owner ? 3 : 1);
          const value = (this.map.nodes[x].star ? 4 : 1) + (t.owner ? 0 : 1) - t.troops * 0.3 + Math.random();
          return { x, need, value };
        })
        .sort((a, b) => b.value - a.value);
      const keep = this.map.nodes[from].star && border(from) ? 1 : 0;
      for (const t of targets) {
        const avail = left[from] - keep;
        if (avail >= t.need) {
          const send = this.map.nodes[t.x].star ? avail : t.need;
          orders.push({ from, to: t.x, n: send, kind: 'move' });
          left[from] -= send;
        }
      }
      // 内陸の兵は前線へ
      if (!border(from) && left[from] > 1) {
        const step = this.map.adj[from]
          .filter((x) => this.terr[x].owner === n.id)
          .sort((a, b) => this.distToEnemy(n.id, a) - this.distToEnemy(n.id, b))[0];
        if (step !== undefined) {
          orders.push({ from, to: step, n: left[from] - 1, kind: 'move' });
          left[from] = 1;
        }
      }
    }
    return orders;
  }

  distToEnemy(nid, from) {
    let best = Infinity;
    this.terr.forEach((t, i) => { if (t.owner !== nid) best = Math.min(best, this.map.dist[from][i]); });
    return best;
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    if (type === 'finish') {
      if (this.phase === 'ended' && isHost) this.ctx.finish();
      return;
    }
    const me = this.nationOf(pid);
    if (!me || this.phase !== 'orders') return;
    const other = this.nation(String(payload.nation || ''));
    switch (type) {
      case 'setOrders':
        this.orders[me.id] = this.sanitizeOrders(me.id, payload.orders);
        break;
      case 'ready':
        me.ready = payload.value !== false;
        if (me.ready) this.checkAllReady();
        break;
      case 'propose':
        this.propose(me, other);
        break;
      case 'accept':
        if (other && this.proposals.some((p) => p.from === other.id && p.to === me.id)) this.sign(other, me);
        break;
      case 'decline':
        if (other) this.decline(me, other);
        break;
      case 'withdraw':
        this.proposals = this.proposals.filter((p) => !(p.from === me.id && p.to === other?.id));
        break;
      default:
        return;
    }
    this.ctx.update();
  }

  // ---------- 密談チャット(人間どうしの1対1) ----------
  chatChannels(pid) {
    const base = [{ id: 'all', label: '全体' }];
    const me = this.nationOf(pid);
    if (!me || this.phase === 'ended') return base;
    for (const n of this.nations) {
      if (n === me || n.cpu) continue;
      base.push({ id: `dm:${this.key(me.owner, n.owner)}`, label: `${this.ctx.nameOf(n.owner)}と密談` });
    }
    return base;
  }

  chatChannel(pid, channel) {
    if (this.phase === 'ended' || !channel.startsWith('dm:')) return null;
    const [a, b] = channel.slice(3).split('|');
    if (pid !== a && pid !== b) return null;
    if (!this.nationOf(a) || !this.nationOf(b)) return null;
    return { label: `密談 ${this.ctx.nameOf(a)}・${this.ctx.nameOf(b)}`, readers: [a, b] };
  }

  onJoin() {}

  onLeave(id) {
    const n = this.nationOf(id);
    if (!n) return;
    n.cpuTitle = `${this.ctx.nameOf(id)}(CPU代行)`;
    n.owner = null;
    n.cpu = true;
    this.ctx.system(`${this.ctx.nameOf(id)}が去ったので、CPUが国を引き継ぎます`);
    this.checkAllReady();
  }

  onConnectionChange() {
    this.checkAllReady();
  }

  // ---------- 表示用データ ----------
  view(pid) {
    const me = this.nationOf(pid);
    const ended = this.phase === 'ended';
    return {
      phase: this.phase,
      seq: this.seq,
      round: this.round,
      rounds: this.s.rounds,
      endsAt: this.phase === 'orders' ? this.endsAt : null,
      map: { width: this.map.width, height: this.map.height, nodes: this.map.nodes, edges: this.map.edges, rails: this.map.rails, railCap: RAIL_CAP },
      terr: this.terr,
      starTotal: this.starTotal,
      winStars: this.winStars,
      nations: this.nations.map((n) => ({
        id: n.id,
        title: this.nm(n),
        leader: n.owner ? this.ctx.nameOf(n.owner) : 'CPU',
        cpu: n.cpu,
        color: n.color,
        capital: n.capital,
        stars: this.stars(n.id),
        lands: this.owned(n.id).length,
        troops: this.troops(n.id),
        broken: n.broken,
        ready: this.phase === 'orders' ? n.ready || n.cpu : null,
        connected: this.isActive(n),
        objective: ended && n.objective ? { text: n.objective.text, done: this.objectiveDone(n) } : null,
        score: ended ? this.score(n) : null,
      })),
      treaties: this.treaties.map((t) => [t.a, t.b]),
      proposals: this.proposals,
      cooldown: Object.entries(this.cooldown).filter(([, r]) => r >= this.round).map(([k, r]) => ({ pair: k.split('|'), until: r })),
      me: me
        ? {
            nation: me.id,
            orders: this.orders[me.id] || [],
            objective: me.objective ? { text: me.objective.text, done: this.objectiveDone(me) } : null,
            ready: me.ready,
          }
        : null,
      lastResult: this.lastResult
        ? this.lastResult
        : null,
      result: ended ? { kind: this.endKind, winners: this.winners, ...this.decision, text: this.decisionText() } : null,
      rules: {
        instant: this.criteria('instant').map(([, label]) => label),
        final: this.criteria('rounds').map(([, label]) => label),
      },
      objectivesOn: !!this.s.objectives,
    };
  }
}

module.exports = {
  id: 'gaikou',
  name: '小国の外交',
  tagline: '小さな大陸で陣取り。条約を守るか、奇襲で裏切るか。',
  description:
    '全員が同時に命令を出して陣取りをします。道のほかに遠くの領地どうしを結ぶ鉄道があり(1回の命令で3兵まで)、内側の領地も安全ではありません。不可侵条約は、お互い守れば平和配当(兵+1)、片方だけ攻めれば奇襲ボーナス(+2)、両方攻めれば共倒れ(増援−2)。' +
    '★の4割を取れば即勝利、8ラウンド終われば★と秘密の目標の点数で勝負。領地を失っても、トップの国で反乱軍として再起します。',
  minPlayers: 1,
  maxPlayers: 6,
  cpu: true, // CPUの数は「国の数」で決まる
  settings: [
    { key: 'nations', label: '国の数', default: 4, options: [3, 4, 5, 6].map((n) => ({ value: n, label: `${n}か国(足りない分はCPU)` })) },
    { key: 'rounds', label: 'ラウンド数', default: 8, options: [6, 8, 10].map((n) => ({ value: n, label: `${n}ラウンド` })) },
    {
      key: 'roundSeconds',
      label: '1ラウンドの時間',
      default: 180,
      options: [120, 180, 240, 300].map((n) => ({ value: n, label: `${n / 60}分` })),
    },
    {
      key: 'objectives',
      label: '秘密の目標',
      default: true,
      options: [
        { value: true, label: 'あり(達成で+2点)' },
        { value: false, label: 'なし' },
      ],
    },
  ],
  create: (ctx, settings, playerIds) => new GaikouGame(ctx, settings, playerIds),
};
