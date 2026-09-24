// ダンジョン合流(協力・リアルタイム)
// バラバラの部屋から出発し、チャットで様子を伝え合って全員が同じ部屋に集まる。
// 見えるのは自分の部屋の目印・扉・扉の向こうの気配と、自分が歩いた地図だけ。
// 松明はチーム共有で1部屋1本。徘徊する魔物に出くわすと松明を失って隣の部屋へ逃げ出す。

const FEATURES = [
  { key: 'statue', name: '石像', icon: '🗿', sense: null },
  { key: 'fountain', name: '泉', icon: '⛲', sense: { icon: '💧', text: '水の音' } },
  { key: 'skull', name: '骸骨', icon: '💀', sense: { icon: '🌬', text: '冷たい風' } },
  { key: 'chest', name: '空の宝箱', icon: '📦', sense: null },
  { key: 'moss', name: '苔むした壁', icon: '🌿', sense: { icon: '🍄', text: '湿った匂い' } },
  { key: 'pillar', name: '崩れた柱', icon: '🏛', sense: null },
  { key: 'brazier', name: '燃える松明台', icon: '🔥', sense: { icon: '✨', text: '光が漏れている' } },
  { key: 'web', name: '蜘蛛の巣', icon: '🕸', sense: { icon: '🕷', text: 'カサカサという音' } },
  { key: 'altar', name: '祭壇', icon: '🕯', sense: { icon: '🌫', text: 'お香の匂い' } },
  { key: 'chains', name: '壁の鎖', icon: '⛓', sense: { icon: '🔔', text: '金属のきしむ音' } },
  { key: 'jar', name: '割れた壺', icon: '🏺', sense: null },
  { key: 'painting', name: '古い絵画', icon: '🖼', sense: null },
];
const MONSTER_SENSE = { icon: '👹', text: 'うなり声' };
const COLORS = ['#c8323c', '#2f6fb0', '#2f8a5a', '#c7801f', '#7a4fb0', '#2f9fa8'];
const COLOR_NAMES = ['赤', '青', '緑', '橙', '紫', '水色'];
const CPU_NAMES = ['ルカ', 'ミナ', 'ソウ', 'エマ'];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const SIZE = 7;
const MOVE_COOLDOWN = 1800;
const MONSTER_STEP = 5000;
const MONSTER_DAMAGE = 3;
const CHALK = 3;

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

// ---------- 迷宮 ----------
// 棒倒しではなく、ランダムな深さ優先で一本道の迷路を作り、階に応じて抜け道(ループ)を足す
function generateMaze(floor) {
  const rooms = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) rooms.push({ x, y, doors: [false, false, false, false], features: [], marks: [] });
  const at = (x, y) => (x >= 0 && y >= 0 && x < SIZE && y < SIZE ? rooms[y * SIZE + x] : null);
  const seen = new Set([0]);
  const stack = [rooms[0]];
  while (stack.length) {
    const r = stack[stack.length - 1];
    const opts = shuffle([0, 1, 2, 3]).filter((d) => {
      const n = at(r.x + DX[d], r.y + DY[d]);
      return n && !seen.has(n.y * SIZE + n.x);
    });
    if (!opts.length) { stack.pop(); continue; }
    const d = opts[0];
    const n = at(r.x + DX[d], r.y + DY[d]);
    r.doors[d] = true;
    n.doors[(d + 2) % 4] = true;
    seen.add(n.y * SIZE + n.x);
    stack.push(n);
  }
  // 抜け道:浅い階ほど多く(迷いにくい)
  const loops = [0.28, 0.2, 0.13][Math.min(floor - 1, 2)];
  for (const r of rooms) {
    for (const d of [1, 2]) {
      const n = at(r.x + DX[d], r.y + DY[d]);
      if (n && !r.doors[d] && Math.random() < loops) {
        r.doors[d] = true;
        n.doors[(d + 2) % 4] = true;
      }
    }
  }
  // 目印:深い階ほど種類を絞って、同じ目印の部屋を増やす
  const pool = shuffle(FEATURES).slice(0, [12, 10, 8][Math.min(floor - 1, 2)]);
  for (const r of rooms) {
    const k = Math.random() < 0.18 ? 0 : Math.random() < 0.7 ? 1 : 2;
    r.features = shuffle(pool).slice(0, k).map((f) => f.key);
  }
  return { rooms, at };
}

function bfsDist(maze, from) {
  const d = new Map([[from, 0]]);
  const q = [from];
  while (q.length) {
    const r = q.shift();
    r.doors.forEach((open, dir) => {
      const n = open && maze.at(r.x + DX[dir], r.y + DY[dir]);
      if (n && !d.has(n)) { d.set(n, d.get(r) + 1); q.push(n); }
    });
  }
  return d;
}

const feature = (key) => FEATURES.find((f) => f.key === key);

// ---------- ゲーム ----------
class MeikyuGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.members = humanIds.map((id, i) => ({ id, cpu: false, color: COLORS[i], colorName: COLOR_NAMES[i] }));
    const names = shuffle(CPU_NAMES);
    for (let i = 0; i < (settings.cpu || 0); i++) {
      const k = this.members.length;
      this.members.push({ id: `cpu-${i + 1}`, cpu: true, name: `${names[i]}(CPU)`, color: COLORS[k], colorName: COLOR_NAMES[k] });
    }
    this.floor = 0;
    this.results = [];
    this.seq = 0;
    this.ctx.system(`迷宮に入った。全${settings.floors}階、全員が同じ部屋に集まれば次の階へ`);
    this.startFloor();
  }

  // ---------- 共通 ----------
  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  every(ms, fn) {
    const t = setInterval(fn, ms);
    this.timers.add({ interval: t });
    return t;
  }
  dispose() {
    for (const t of this.timers) (t.interval ? clearInterval(t.interval) : clearTimeout(t));
    this.timers.clear();
  }
  nameOf(m) {
    return m.cpu ? m.name : this.ctx.nameOf(m.id);
  }
  member(id) {
    return this.members.find((m) => m.id === id);
  }
  humans() {
    return this.members.filter((m) => !m.cpu);
  }
  compassFor(floor) {
    if (this.s.compass === 'fixed') return 'fixed';
    if (this.s.compass === 'rotated') return 'rotated';
    return floor === 1 ? 'fixed' : 'rotated';
  }

  // ---------- 階 ----------
  startFloor() {
    for (const t of this.timers) (t.interval ? clearInterval(t.interval) : clearTimeout(t));
    this.timers.clear();
    this.floor++;
    this.maze = generateMaze(this.floor);
    this.compass = this.compassFor(this.floor);

    // スタート地点:互いに3部屋以上離す
    const placed = [];
    for (const m of shuffle(this.members)) {
      let best = null;
      for (const r of shuffle(this.maze.rooms)) {
        const minD = placed.length ? Math.min(...placed.map((p) => bfsDist(this.maze, p).get(r) ?? 99)) : 99;
        if (!best || minD > best.minD) best = { r, minD };
        if (minD >= 4) break;
      }
      placed.push(best.r);
      m.room = best.r;
      m.start = best.r;
      m.rot = this.compass === 'fixed' ? 0 : rint(0, 3);
      m.chalk = CHALK;
      m.explored = new Set([best.r]);
      m.cooldownUntil = 0;
      m.found = false;
      m.follow = null;
    }
    // 松明:その階で「地図が見えていれば最短で何歩で集まれるか」の約2.4倍+8本。迷宮の形によらず難しさをそろえる
    this.torchMax = Math.ceil(this.shortestGather() * 2.4) + 8;
    this.torch = this.torchMax;
    // 魔物:誰からも遠い部屋から
    if (this.s.monster) {
      const far = [...this.maze.rooms].sort((a, b) => this.minDistToMembers(b) - this.minDistToMembers(a));
      this.monster = { room: far[0], prev: null };
      this.every(MONSTER_STEP, () => this.moveMonster());
    } else {
      this.monster = null;
    }
    this.phase = 'explore';
    this.endsAt = Date.now() + this.s.floorMinutes * 60000;
    this.later(this.s.floorMinutes * 60000, () => this.failFloor('time'));
    this.seq++;
    const note = this.compass === 'fixed' ? '方角:全員の画面で北が上' : '方角:各自の画面の向きがバラバラ(前後左右しかわからない)';
    this.ctx.system(`${this.floor}階。松明は${this.torch}本。${note}`);
    // CPUの仲間は定期的に様子を報告する
    for (const m of this.members.filter((x) => x.cpu)) {
      this.later(rint(2500, 5000), () => this.cpuReport(m));
      this.every(rint(22000, 28000), () => this.cpuReport(m));
    }
    this.ctx.update();
  }

  shortestGather() {
    const humans = this.members.filter((m) => !m.cpu);
    const cpus = this.members.filter((m) => m.cpu);
    if (!cpus.length) {
      const ds = humans.map((m) => bfsDist(this.maze, m.room));
      return Math.min(...this.maze.rooms.map((r) => ds.reduce((s, d) => s + (d.get(r) ?? 99), 0)));
    }
    // 動けない仲間がいるときは、1人目の仲間の部屋に集まり、ほかの仲間は誰かが迎えに行って戻る目安
    const d0 = bfsDist(this.maze, cpus[0].room);
    return humans.reduce((s, m) => s + (d0.get(m.room) ?? 99), 0) + cpus.slice(1).reduce((s, c) => s + (d0.get(c.room) ?? 99) * 2, 0);
  }

  minDistToMembers(room) {
    return Math.min(...this.members.map((m) => bfsDist(this.maze, m.room).get(room) ?? 99));
  }

  checkGathered() {
    if (this.phase !== 'explore') return;
    const room = this.members[0].room;
    if (this.members.every((m) => m.room === room)) this.clearFloor();
  }

  clearFloor() {
    this.phase = 'cleared';
    this.results.push({ floor: this.floor, ok: true, torch: this.torch, torchMax: this.torchMax });
    this.seq++;
    this.ctx.system(`${this.floor}階、全員合流!残りの松明 ${this.torch} / ${this.torchMax}`);
    this.afterFloor();
  }

  failFloor(why) {
    if (this.phase !== 'explore') return;
    this.phase = 'cleared';
    this.results.push({ floor: this.floor, ok: false, torch: 0, torchMax: this.torchMax, why });
    this.seq++;
    this.ctx.system(`${this.floor}階は失敗…(${why === 'time' ? '時間切れ' : '松明が尽きた'})`);
    this.afterFloor();
  }

  afterFloor() {
    for (const t of this.timers) (t.interval ? clearInterval(t.interval) : clearTimeout(t));
    this.timers.clear();
    this.ctx.update();
    this.later(6000, () => {
      if (this.floor >= this.s.floors) this.finish();
      else this.startFloor();
    });
  }

  finish() {
    this.phase = 'ended';
    this.seq++;
    const got = this.results.reduce((s, r) => s + r.torch, 0);
    const max = this.results.reduce((s, r) => s + r.torchMax, 0);
    const ratio = max ? got / max : 0;
    this.rank = ratio >= 0.55 ? 'S' : ratio >= 0.38 ? 'A' : ratio >= 0.2 ? 'B' : 'C';
    this.ctx.system(`探索終了。残った松明 ${got} / ${max}、ランク ${this.rank}`);
    this.ctx.update();
  }

  // ---------- 移動 ----------
  neighbor(room, dir) {
    return room.doors[dir] ? this.maze.at(room.x + DX[dir], room.y + DY[dir]) : null;
  }

  moveMember(m, to) {
    m.room = to;
    m.explored.add(to);
    // 見つけた仲間(CPU)はついてくる
    for (const f of this.members.filter((x) => x.follow === m.id)) {
      f.room = to;
    }
    // CPUの部屋に入ったら、その仲間が見つかってついてくるようになる
    for (const c of this.members.filter((x) => x.cpu && !x.found && x.room === to)) {
      c.found = true;
      c.follow = m.id;
      if (this.s.cpuChat !== false) this.ctx.say(c.id, c.name, pick(['来てくれた!肩を貸してくれ、ついていくよ', '助かった…一緒に行こう', 'やっと会えた!']));
      else this.ctx.system(`${c.name}を見つけた。${this.nameOf(m)}についていく`);
    }
    if (this.monster && this.monster.room === to) this.attack(m);
  }

  step(m, relDir) {
    if (this.phase !== 'explore' || m.cpu) return;
    const now = Date.now();
    if (now < m.cooldownUntil) return;
    const dir = (relDir + m.rot) % 4;
    const to = this.neighbor(m.room, dir);
    if (!to) return;
    m.cooldownUntil = now + MOVE_COOLDOWN;
    this.torch -= 1;
    this.moveMember(m, to);
    if (this.torch <= 0) return this.failFloor('torch');
    this.checkGathered();
  }

  // ---------- 魔物 ----------
  moveMonster() {
    if (this.phase !== 'explore' || !this.monster) return;
    const r = this.monster.room;
    const opts = [0, 1, 2, 3].map((d) => this.neighbor(r, d)).filter(Boolean);
    const fresh = opts.filter((n) => n !== this.monster.prev);
    const to = pick(fresh.length ? fresh : opts);
    this.monster.prev = r;
    this.monster.room = to;
    for (const m of this.members.filter((x) => !x.cpu && x.room === to)) this.attack(m);
    this.ctx.update();
  }

  attack(m) {
    if (this.phase !== 'explore') return;
    this.torch = Math.max(0, this.torch - MONSTER_DAMAGE);
    const exits = [0, 1, 2, 3].map((d) => this.neighbor(m.room, d)).filter(Boolean);
    const run = pick(exits);
    this.ctx.system(`${this.nameOf(m)}が魔物に襲われ、松明を${MONSTER_DAMAGE}本落として逃げ出した!`);
    m.room = run;
    m.explored.add(run);
    for (const f of this.members.filter((x) => x.follow === m.id)) f.room = run;
    m.cooldownUntil = Date.now() + MOVE_COOLDOWN;
    m.lastHit = Date.now();
    if (this.torch <= 0) this.failFloor('torch');
  }

  // ---------- 部屋の様子 ----------
  // relDir → その人の画面での向き。方角ありなら北東南西、なければ前右後左
  dirLabel(m, absDir) {
    const rel = (absDir - m.rot + 4) % 4;
    return this.compass === 'fixed' ? ['北', '東', '南', '西'][absDir] : ['前', '右', '後ろ', '左'][rel];
  }

  senseOf(room) {
    if (this.monster && this.monster.room === room) return MONSTER_SENSE;
    for (const key of room.features) {
      const f = feature(key);
      if (f.sense) return f.sense;
    }
    return null;
  }

  describe(m) {
    const r = m.room;
    const feats = r.features.map((k) => feature(k).name);
    const parts = [feats.length ? `${feats.join('と')}がある部屋` : '何もない部屋'];
    const doors = [0, 1, 2, 3].filter((d) => r.doors[d]).map((d) => this.dirLabel(m, d));
    parts.push(`扉は${doors.join('・')}`);
    const senses = [0, 1, 2, 3]
      .filter((d) => r.doors[d])
      .map((d) => ({ d, s: this.senseOf(this.neighbor(r, d)) }))
      .filter((x) => x.s)
      .map((x) => `${this.dirLabel(m, x.d)}から${x.s.text}`);
    if (senses.length) parts.push(senses.join('、'));
    const marks = r.marks.map((k) => `${k.colorName}のチョーク`);
    if (marks.length) parts.push(`${marks.join('と')}の印あり`);
    return parts.join('。');
  }

  cpuReport(m) {
    if (this.phase !== 'explore' || m.found || this.s.cpuChat === false) return;
    const text = `${pick(['足を怪我して動けない…', 'ここから動けないんだ。', '誰か来てくれ!'])}${this.describe(m)}`;
    this.ctx.say(m.id, m.name, text);
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    if (type === 'finish') {
      if (this.phase === 'ended' && isHost) this.ctx.finish();
      return;
    }
    const m = this.member(pid);
    if (!m) return;
    if (type === 'move') {
      const d = Number(payload.dir);
      if ([0, 1, 2, 3].includes(d)) this.step(m, d);
    } else if (type === 'chalk') {
      if (this.phase !== 'explore' || m.chalk < 1 || m.room.marks.some((k) => k.id === m.id)) return;
      m.chalk--;
      m.room.marks.push({ id: m.id, color: m.color, colorName: m.colorName });
    } else if (type === 'report') {
      if (this.phase !== 'explore') return;
      const now = Date.now();
      if (now - (m.lastReport || 0) < 4000) return;
      m.lastReport = now;
      this.ctx.post({ type: 'user', playerId: m.id, name: this.ctx.nameOf(m.id), text: `📍${this.describe(m)}` });
    } else {
      return;
    }
    this.ctx.update();
  }

  onJoin() {}

  onLeave(id) {
    // 抜けた人は、その場で待つCPUの仲間になる(迎えに行けば合流扱い)
    const m = this.member(id);
    if (!m) return;
    m.cpu = true;
    m.name = `${this.ctx.nameOf(id)}(CPU代行)`;
    m.found = false;
    for (const f of this.members.filter((x) => x.follow === id)) f.follow = null;
    this.ctx.system(`${m.name}はその場で待っています。迎えに行けば合流できます`);
  }

  onConnectionChange() {}

  // ---------- 表示用データ ----------
  view(pid) {
    const m = this.member(pid);
    const base = {
      phase: this.phase,
      seq: this.seq,
      floor: this.floor,
      floors: this.s.floors,
      endsAt: this.phase === 'explore' ? this.endsAt : null,
      torch: this.torch,
      torchMax: this.torchMax,
      compass: this.compass,
      party: this.members.map((x) => ({
        name: this.nameOf(x),
        color: x.color,
        cpu: x.cpu,
        found: x.found,
        following: x.follow ? this.nameOf(this.member(x.follow)) : null,
      })),
      results: this.results,
      rank: this.rank || null,
      gathered: this.phase !== 'explore' ? this.results[this.results.length - 1] || null : null,
    };
    if (!m || m.cpu) return { ...base, spectator: true };
    const r = m.room;
    const others = this.members.filter((x) => x !== m && x.room === r);
    return {
      ...base,
      me: {
        color: m.color,
        colorName: m.colorName,
        chalk: m.chalk,
        rot: m.rot,
        cooldownUntil: m.cooldownUntil,
        lastHit: m.lastHit || 0,
      },
      room: {
        key: `${r.x},${r.y}`,
        features: r.features.map((k) => ({ name: feature(k).name, icon: feature(k).icon })),
        marks: r.marks.map((k) => ({ color: k.color, colorName: k.colorName })),
        others: others.map((x) => ({ name: this.nameOf(x), color: x.color, cpu: x.cpu })),
        monster: !!(this.monster && this.monster.room === r),
        // 扉はその人の画面の向き(0=上/前, 1=右, 2=下/後ろ, 3=左)で返す
        doors: [0, 1, 2, 3].map((rel) => {
          const abs = (rel + m.rot) % 4;
          const open = r.doors[abs];
          const s = open ? this.senseOf(this.neighbor(r, abs)) : null;
          return { rel, open, label: this.dirLabel(m, abs), sense: s };
        }),
      },
      // 自分が歩いた部屋だけ。座標はスタート地点からの相対を、その人の画面の向きに回して返す
      explored: [...m.explored].map((x) => {
        let dx = x.x - m.start.x;
        let dy = x.y - m.start.y;
        for (let i = 0; i < m.rot; i++) [dx, dy] = [dy, -dx];
        const doors = [0, 1, 2, 3].map((rel) => x.doors[(rel + m.rot) % 4]);
        return { x: dx, y: dy, doors, here: x === r, start: x === m.start, marked: x.marks.length > 0 };
      }),
    };
  }
}

module.exports = {
  id: 'meikyu',
  name: 'ダンジョン合流',
  tagline: 'はぐれたパーティが、チャットで様子を伝え合って迷宮の中で合流する協力ゲーム。',
  description:
    '見えるのは自分の部屋の目印・扉・扉の向こうの気配だけ。チャットで「石像があって東から水の音」と伝え合い、全員が同じ部屋に集まれば次の階へ。' +
    '松明はチーム共有で1部屋1本、徘徊する魔物に出くわすと松明を落とします。残った松明でランクが決まります。',
  minPlayers: 2,
  maxPlayers: 6,
  cpu: true,
  settings: [
    { key: 'cpu', label: 'CPUの仲間', default: 0, options: [0, 1, 2, 3].map((n) => ({ value: n, label: n ? `${n}人(動けない負傷者)` : 'なし' })) },
    { key: 'cpuChat', label: 'CPUの発言', default: true, options: [{ value: true, label: '様子を報告する' }, { value: false, label: '話さない(難しい)' }] },
    {
      key: 'compass',
      label: '方角',
      default: 'staged',
      options: [
        { value: 'staged', label: '1階だけ方角あり、2階からバラバラ' },
        { value: 'fixed', label: 'ずっと方角あり(全員北が上)' },
        { value: 'rotated', label: 'ずっとバラバラ(前後左右だけ)' },
      ],
    },
    { key: 'floors', label: '階の数', default: 3, options: [1, 2, 3].map((n) => ({ value: n, label: `${n}階` })) },
    { key: 'floorMinutes', label: '1階の制限時間', default: 8, options: [5, 8, 12].map((n) => ({ value: n, label: `${n}分` })) },
    { key: 'monster', label: '徘徊する魔物', default: true, options: [{ value: true, label: 'あり' }, { value: false, label: 'なし' }] },
  ],
  create: (ctx, settings, playerIds) => new MeikyuGame(ctx, settings, playerIds),
};
