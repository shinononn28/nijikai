// 意地悪コース(アルティメットチキンホース系をターン制に)
// 毎ラウンド部品を1つずつ選んでコースに置き(伏せて置くと中身は本人しか知らない)、
// そのあと全員が経路を計画して一斉にスタート。ゴールした人に得点、ただし全員ゴールしたら誰も得点なし。
// キャラクターごとに動き方が違うので「自分は通れて相手は通れない」コースを作れる。

const W = 12;
const H = 7;
const START = { x: 0, y: 3 };
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]; // 上右下左・右上右下左下左上

const CHARS = {
  jumper: { name: 'ジャンパー', text: '縦横に2マス跳べる(間のマスは無視)' },
  diag: { name: 'ナナメ', text: '斜めにも進める' },
  tough: { name: 'タフ', text: '1回の挑戦で、罠を1回だけ耐える' },
  runner: { name: '健脚', text: '歩数が3多い' },
};
const ITEMS = {
  wall: { name: '壁', text: '通れない(ジャンパーは跳び越せる)' },
  pit: { name: '落とし穴', text: '踏んだら脱落' },
  spike: { name: 'トゲ', text: '踏んだら脱落' },
  spring: { name: 'バネ', text: '踏むと同じ向きに2マス飛ばされる' },
  blink: { name: '点滅床', text: '偶数歩目は穴になる' },
  decoy: { name: '見せかけ', text: 'ただの床。伏せて置くと罠に見える' },
  eraser: { name: '消しゴム', text: '置いてある部品を1つ消す' },
};
const ITEM_POOL = ['wall', 'wall', 'pit', 'pit', 'spike', 'spike', 'spring', 'blink', 'decoy', 'eraser'];
const BASE_STEPS = 12;
const COLORS = ['#c8323c', '#2f6fb0', '#2f8a5a', '#c7801f', '#7a4fb0', '#2f9fa8'];

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
const key = (x, y) => `${x},${y}`;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const isGoal = (x) => x === W - 1;

// 経路の実行(サーバーの本番と、画面の予想の両方で使う同じ手順)
// cells: key → {type} / plan: [{d, jump}] / 戻り値:{steps:[{x,y,t,event}], result, killer}
function simulate(cells, plan, char, maxSteps) {
  let x = START.x;
  let y = START.y;
  let shield = char === 'tough' ? 1 : 0;
  const steps = [{ x, y, t: 0 }];
  const triggered = [];
  const hit = (cell, t) => {
    const c = cells[key(cell.x, cell.y)];
    if (!c) return null;
    const type = c.type;
    if (type === 'pit' || type === 'spike' || (type === 'blink' && t % 2 === 0)) {
      triggered.push(key(cell.x, cell.y));
      if (shield > 0) {
        shield--;
        return 'endure';
      }
      return 'dead';
    }
    if (type === 'spring' || type === 'decoy') triggered.push(key(cell.x, cell.y));
    return type === 'spring' ? 'spring' : null;
  };
  for (let t = 1; t <= Math.min(plan.length, maxSteps); t++) {
    const a = plan[t - 1];
    const [dx, dy] = DIRS[a.d] || [0, 0];
    if (a.d >= 4 && char !== 'diag') return { steps, result: 'invalid', triggered };
    if (a.jump && (char !== 'jumper' || a.d >= 4)) return { steps, result: 'invalid', triggered };
    const len = a.jump ? 2 : 1;
    let nx = x + dx * len;
    let ny = y + dy * len;
    if (!inside(nx, ny)) return { steps: [...steps, { x, y, t, event: 'stuck' }], result: 'stuck', triggered };
    let c = cells[key(nx, ny)];
    if (c && c.type === 'wall') {
      triggered.push(key(nx, ny));
      return { steps: [...steps, { x, y, t, event: 'wall', at: key(nx, ny) }], result: 'wall', killerCell: key(nx, ny), triggered };
    }
    x = nx;
    y = ny;
    let ev = hit({ x, y }, t);
    // バネ:同じ向きに2マス飛ばされる(壁の手前で止まる)
    let bounces = 0;
    while (ev === 'spring' && bounces++ < 3) {
      steps.push({ x, y, t, event: 'spring' });
      let tx = x;
      let ty = y;
      for (let k = 0; k < 2; k++) {
        const qx = tx + dx;
        const qy = ty + dy;
        if (!inside(qx, qy) || cells[key(qx, qy)]?.type === 'wall') break;
        tx = qx;
        ty = qy;
      }
      x = tx;
      y = ty;
      ev = hit({ x, y }, t);
    }
    if (ev === 'dead') return { steps: [...steps, { x, y, t, event: 'dead' }], result: 'dead', killerCell: key(x, y), triggered };
    steps.push({ x, y, t, event: ev === 'endure' ? 'endure' : isGoal(x) ? 'goal' : null });
    if (isGoal(x)) return { steps, result: 'goal', time: t, triggered };
  }
  return { steps, result: 'timeout', triggered };
}

class CourseGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.players = humanIds.map((id, i) => ({ id, color: COLORS[i], score: 0, char: null }));
    this.cells = {}; // key → {type, owner, hidden}
    // 最初から少しだけ壁を置いておく
    for (let i = 0; i < 4; i++) {
      const x = rint(3, W - 3);
      const y = rint(0, H - 1);
      if (!(x === START.x && y === START.y)) this.cells[key(x, y)] = { type: 'wall', owner: null, hidden: false };
    }
    this.round = 0;
    this.picks = {};
    this.plans = {};
    this.offer = [];
    this.history = [];
    this.seq = 0;
    this.phase = 'chars';
    this.endsAt = Date.now() + 40000;
    this.later(40000, () => this.startRound());
    this.ctx.system('キャラクターを選んでください。部品を置いてコースを作り、自分だけがゴールできるコースを狙います');
  }

  // ---------- 共通 ----------
  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  dispose() {
    this.clearTimers();
  }
  p(id) {
    return this.players.find((x) => x.id === id);
  }
  name(id) {
    return this.ctx.nameOf(id);
  }
  steps(p) {
    return BASE_STEPS + (p.char === 'runner' ? 3 : 0);
  }
  active(id) {
    return this.ctx.isConnected(id);
  }

  // ---------- ラウンド ----------
  startRound() {
    if (this.phase !== 'chars' && this.phase !== 'result') return;
    this.clearTimers();
    for (const p of this.players) if (!p.char) p.char = pick(Object.keys(CHARS));
    this.round++;
    this.offer = shuffle(ITEM_POOL).slice(0, this.players.length + 1).map((type, i) => ({ id: `i${this.round}-${i}`, type, taken: null }));
    // 点数の低い人から選ぶ(同点は順不同)
    this.order = shuffle(this.players).sort((a, b) => a.score - b.score).map((p) => p.id);
    this.orderIndex = 0;
    this.picks = {};
    this.plans = {};
    this.run = null;
    this.phase = 'pick';
    this.seq++;
    this.ctx.system(`第${this.round}ラウンド。点数の低い人から部品を選びます`);
    this.nextPicker();
  }

  nextPicker() {
    while (this.orderIndex < this.order.length && !this.p(this.order[this.orderIndex])) this.orderIndex++;
    if (this.orderIndex >= this.order.length) return this.startPlace();
    this.picker = this.order[this.orderIndex];
    this.endsAt = Date.now() + 25000;
    this.clearTimers();
    this.later(25000, () => this.pickItem(this.picker, pick(this.offer.filter((o) => !o.taken)).id));
    this.ctx.update();
  }

  pickItem(pid, itemId) {
    if (this.phase !== 'pick' || pid !== this.picker) return;
    const it = this.offer.find((o) => o.id === itemId && !o.taken);
    if (!it) return;
    it.taken = pid;
    this.picks[pid] = it.type;
    this.orderIndex++;
    this.nextPicker();
  }

  startPlace() {
    this.phase = 'place';
    this.orderIndex = 0;
    this.seq++;
    this.nextPlacer();
  }

  nextPlacer() {
    while (this.orderIndex < this.order.length && (!this.p(this.order[this.orderIndex]) || !this.picks[this.order[this.orderIndex]])) this.orderIndex++;
    if (this.orderIndex >= this.order.length) return this.startPlan();
    this.placer = this.order[this.orderIndex];
    this.endsAt = Date.now() + 40000;
    this.clearTimers();
    this.later(40000, () => {
      this.ctx.system(`${this.name(this.placer)}さんは時間切れで部品を置かなかった`);
      this.orderIndex++;
      this.nextPlacer();
    });
    this.ctx.update();
  }

  place(pid, x, y, hidden) {
    if (this.phase !== 'place' || pid !== this.placer || !inside(x, y)) return;
    const type = this.picks[pid];
    const k = key(x, y);
    if (x === START.x && y === START.y) return;
    if (type === 'eraser') {
      if (!this.cells[k]) return;
      delete this.cells[k];
      this.ctx.system(`${this.name(pid)}さんが消しゴムで部品を1つ消した`);
    } else {
      if (this.cells[k] || isGoal(x)) return;
      this.cells[k] = { type, owner: pid, hidden: !!hidden };
      this.ctx.system(`${this.name(pid)}さんが${hidden ? '何かを伏せて' : `${ITEMS[type].name}を`}置いた`);
    }
    this.orderIndex++;
    this.nextPlacer();
  }

  startPlan() {
    this.phase = 'plan';
    this.seq++;
    this.endsAt = Date.now() + this.s.planSeconds * 1000;
    this.clearTimers();
    this.later(this.s.planSeconds * 1000, () => this.startRun());
    this.ctx.system('経路を計画してください。「?」は置いた人しか中身を知りません');
    this.ctx.update();
  }

  setPlan(pid, plan, ready) {
    const p = this.p(pid);
    if (this.phase !== 'plan' || !p || !Array.isArray(plan)) return;
    this.plans[pid] = {
      plan: plan.slice(0, this.steps(p)).map((a) => ({ d: Math.max(0, Math.min(7, Number(a.d) | 0)), jump: !!a.jump })),
      ready: !!ready,
    };
    if (this.players.every((x) => !this.active(x.id) || this.plans[x.id]?.ready)) this.startRun();
  }

  // ---------- 本番 ----------
  startRun() {
    if (this.phase !== 'plan') return;
    this.clearTimers();
    const cellsTrue = Object.fromEntries(Object.entries(this.cells).map(([k, c]) => [k, { type: c.type }]));
    const runs = {};
    for (const p of this.players) {
      const plan = this.plans[p.id]?.plan || [];
      runs[p.id] = simulate(cellsTrue, plan, p.char, this.steps(p));
    }
    // 踏まれた伏せ札は公開
    for (const r of Object.values(runs)) for (const k of r.triggered) if (this.cells[k]) this.cells[k].hidden = false;
    // 得点
    const goals = this.players.filter((p) => runs[p.id].result === 'goal');
    const gain = Object.fromEntries(this.players.map((p) => [p.id, 0]));
    let note;
    if (goals.length === this.players.length) note = '全員ゴール!簡単すぎたので誰も得点なし';
    else if (!goals.length) note = '誰もゴールできなかった…得点なし';
    else {
      for (const p of goals) gain[p.id] += 3;
      if (goals.length === 1) {
        gain[goals[0].id] += 2;
        note = `${this.name(goals[0].id)}さんだけがゴール!(+3、ひとりだけで+2)`;
      } else note = `${goals.map((p) => this.name(p.id)).join('・')}さんがゴール(+3)`;
    }
    // 罠師:自分の置いた部品で、ほかの人が脱落・停止したら+1
    const trapNotes = [];
    for (const p of this.players) {
      const r = runs[p.id];
      if (!['dead', 'wall'].includes(r.result) || !r.killerCell) continue;
      const owner = this.cells[r.killerCell]?.owner;
      if (owner && owner !== p.id && gain[owner] !== undefined) {
        gain[owner] += 1;
        trapNotes.push(`${this.name(owner)}さんの罠に${this.name(p.id)}さんがかかった(+1)`);
      } else if (owner === p.id) trapNotes.push(`${this.name(p.id)}さんが自分の罠にかかった!`);
    }
    for (const p of this.players) p.score += gain[p.id];
    this.run = {
      runs: Object.fromEntries(Object.entries(runs).map(([id, r]) => [id, { steps: r.steps, result: r.result, time: r.time || null }])),
      gain,
      note,
      trapNotes,
    };
    this.history.push({ round: this.round, note });
    this.phase = 'result';
    this.seq++;
    this.ctx.system(`第${this.round}ラウンド:${note}${trapNotes.length ? `。${trapNotes.join('。')}` : ''}`);
    const top = [...this.players].sort((a, b) => b.score - a.score)[0];
    if (top.score >= this.s.target || this.round >= this.s.maxRounds) this.over = true;
    this.ctx.update();
  }

  next(isHost) {
    if (this.phase !== 'result' || !isHost) return;
    if (this.over) {
      this.phase = 'ended';
      this.seq++;
      const top = [...this.players].sort((a, b) => b.score - a.score)[0];
      this.ctx.system(`ゲーム終了。優勝は${this.name(top.id)}さん(${top.score}点)`);
      return;
    }
    this.startRound();
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    const p = this.p(pid);
    switch (type) {
      case 'char':
        if (this.phase !== 'chars' || !p || !CHARS[payload.char]) return;
        p.char = payload.char;
        if (this.players.every((x) => x.char || !this.active(x.id))) this.startRound();
        break;
      case 'pickItem':
        this.pickItem(pid, String(payload.id));
        break;
      case 'place':
        this.place(pid, Number(payload.x), Number(payload.y), !!payload.hidden);
        break;
      case 'plan':
        this.setPlan(pid, payload.plan, payload.ready);
        break;
      case 'next':
        this.next(isHost);
        break;
      case 'finish':
        if (this.phase === 'ended' && isHost) return this.ctx.finish();
        return;
      default:
        return;
    }
    this.ctx.update();
  }

  onJoin() {}

  onLeave(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.players.length < 2) {
      this.phase = 'ended';
      this.seq++;
      return;
    }
    if (this.phase === 'pick' && this.picker === id) this.nextPicker();
    if (this.phase === 'place' && this.placer === id) { this.orderIndex++; this.nextPlacer(); }
    if (this.phase === 'plan' && this.players.every((x) => !this.active(x.id) || this.plans[x.id]?.ready)) this.startRun();
  }

  onConnectionChange() {
    if (this.phase === 'plan' && this.players.every((x) => !this.active(x.id) || this.plans[x.id]?.ready)) this.startRun();
  }

  // ---------- 表示用データ ----------
  view(pid) {
    const me = this.p(pid);
    const cells = Object.entries(this.cells).map(([k, c]) => {
      const [x, y] = k.split(',').map(Number);
      const mine = c.owner === pid;
      const shown = !c.hidden || mine || this.phase === 'ended';
      return { x, y, type: shown ? c.type : 'hidden', hidden: c.hidden, owner: c.owner, ownerColor: this.p(c.owner)?.color || null };
    });
    return {
      phase: this.phase,
      seq: this.seq,
      round: this.round,
      endsAt: ['result', 'ended'].includes(this.phase) ? null : this.endsAt,
      W,
      H,
      start: START,
      chars: CHARS,
      items: ITEMS,
      cells,
      target: this.s.target,
      players: this.players.map((p) => ({
        id: p.id,
        name: this.name(p.id),
        color: p.color,
        score: p.score,
        char: p.char,
        steps: this.steps(p),
        planned: this.phase === 'plan' ? !!this.plans[p.id]?.ready : null,
        item: this.phase === 'pick' || this.phase === 'place' ? this.picks[p.id] || null : null,
      })),
      offer: this.phase === 'pick' ? this.offer : null,
      picker: this.phase === 'pick' ? this.picker : null,
      placer: this.phase === 'place' ? this.placer : null,
      myItem: me ? this.picks[pid] || null : null,
      myPlan: me ? this.plans[pid] || null : null,
      run: this.run,
      over: !!this.over,
    };
  }
}

module.exports = {
  id: 'course',
  name: '意地悪コース',
  tagline: '部品を置いてコースを作り、自分だけがゴールできるコースを狙う。',
  description:
    '毎ラウンド部品を1つ選んでコースに置き(伏せて置くと中身は本人しか知らない)、全員が経路を計画して一斉にスタート。' +
    'ゴールした人に得点、ただし全員ゴールしたら誰も得点なし。キャラクターごとに動き方が違うので、自分だけ通れる道を仕込めます。',
  minPlayers: 2,
  maxPlayers: 6,
  cpu: false,
  settings: [
    { key: 'target', label: '目標点', default: 12, options: [8, 12, 16].map((n) => ({ value: n, label: `${n}点` })) },
    { key: 'maxRounds', label: '最大ラウンド', default: 10, options: [6, 10, 14].map((n) => ({ value: n, label: `${n}ラウンド` })) },
    { key: 'planSeconds', label: '計画の時間', default: 90, options: [60, 90, 120].map((n) => ({ value: n, label: `${n}秒` })) },
  ],
  create: (ctx, settings, playerIds) => new CourseGame(ctx, settings, playerIds),
  _internal: { simulate, DIRS, W, H, START },
};
