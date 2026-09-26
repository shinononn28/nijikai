// 街の地主(すごろく不動産)
// サイコロで街を回って土地を買い、同じ色をそろえて建物を建て、通行料で稼ぐ。
// 土地はプレイヤーどうしでいつでも交換・売買を提案でき、設定で「強制買収」も使える。
// 二次会向けに、決まった周回数で終わり、そのときの総資産で勝負する。

const GROUPS = {
  A: { name: '下町', color: '#8b5a2b', price: 60, house: 50 },
  B: { name: '住宅街', color: '#6fb0d8', price: 100, house: 50 },
  C: { name: '商店街', color: '#c24f9a', price: 140, house: 100 },
  D: { name: '学生街', color: '#e8903a', price: 180, house: 100 },
  E: { name: 'オフィス街', color: '#c8323c', price: 220, house: 150 },
  F: { name: '繁華街', color: '#d9b02a', price: 260, house: 150 },
  G: { name: '湾岸', color: '#2f8a5a', price: 320, house: 200 },
};
// 28マス(8×8の外周)
const SPACES = [
  { t: 'start', name: 'スタート' },
  { t: 'prop', g: 'A', name: '駄菓子屋通り' },
  { t: 'prop', g: 'A', name: '銭湯横丁' },
  { t: 'prop', g: 'B', name: 'ひばりが丘' },
  { t: 'chance', name: 'チャンス' },
  { t: 'prop', g: 'B', name: '緑町' },
  { t: 'prop', g: 'B', name: '桜台' },
  { t: 'park', name: '公園' },
  { t: 'prop', g: 'C', name: '駅前商店街' },
  { t: 'prop', g: 'C', name: '中央通り' },
  { t: 'prop', g: 'C', name: 'のんべえ横丁' },
  { t: 'chance', name: 'チャンス' },
  { t: 'prop', g: 'D', name: '大学通り' },
  { t: 'prop', g: 'D', name: '古本街' },
  { t: 'rest', name: '休憩所' },
  { t: 'prop', g: 'D', name: '学生寮前' },
  { t: 'prop', g: 'E', name: 'ビジネスパーク' },
  { t: 'prop', g: 'E', name: '本町' },
  { t: 'chance', name: 'チャンス' },
  { t: 'prop', g: 'E', name: '金融街' },
  { t: 'prop', g: 'F', name: 'ライブハウス通り' },
  { t: 'tax', name: '税務署', amount: 100 },
  { t: 'prop', g: 'F', name: '劇場前' },
  { t: 'prop', g: 'F', name: '歓楽街' },
  { t: 'prop', g: 'G', name: 'ベイエリア' },
  { t: 'chance', name: 'チャンス' },
  { t: 'prop', g: 'G', name: 'タワー前' },
  { t: 'prop', g: 'G', name: '高級住宅地' },
];
SPACES.forEach((s, i) => {
  s.i = i;
  if (s.t === 'prop') {
    const g = GROUPS[s.g];
    const idxInGroup = SPACES.slice(0, i).filter((x) => x.g === s.g).length;
    s.price = g.price + idxInGroup * 20;
    s.base = Math.round(s.price / 10);
  }
});
const RENT_MULT = [1, 4, 10, 25]; // 建物0〜3軒(そろっていれば建物なしでも2倍)
const MAX_HOUSES = 3;
const PASS_BONUS = 200;
const START_MONEY = 1500;
const CPU_NAMES = ['タナカ', 'スズキ', 'サトウ'];

const CHANCES = [
  { text: '宝くじが当たった。200もらう', money: 200 },
  { text: '財布を落とした。100払う', money: -100 },
  { text: '固定資産税。建物1軒につき25払う', perHouse: -25 },
  { text: 'スタートへ進む', moveTo: 0 },
  { text: '3マス戻る', back: 3 },
  { text: '誕生日!全員から30ずつもらう', fromEach: 30 },
  { text: '町内会の幹事。全員に30ずつ払う', toEach: 30 },
  { text: '臨時収入。100もらう', money: 100 },
  { text: '公園へ移動する', moveTo: 7 },
];

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

class JinushiGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.players = humanIds.map((id) => ({ id, cpu: false }));
    for (let i = 0; i < (settings.cpu || 0); i++) this.players.push({ id: `cpu-${i + 1}`, cpu: true, name: `${CPU_NAMES[i]}(CPU)` });
    this.players.forEach((p, i) => {
      p.money = START_MONEY;
      p.pos = 0;
      p.out = false;
      p.buyoutLeft = settings.buyout ? 1 : 0;
      p.color = ['#c8323c', '#2f6fb0', '#2f8a5a', '#c7801f', '#7a4fb0', '#2f9fa8'][i];
    });
    this.own = {}; // マス番号 → {owner, houses}
    this.trades = []; // {id, from, to, give:{props,money}, get:{props,money}}
    this.tradeSeq = 0;
    this.turnIndex = 0;
    this.turnCount = 0;
    this.maxTurns = settings.laps * this.players.length;
    this.seq = 0;
    this.lastRoll = null;
    this.ctx.system(`全員${settings.laps}ターンずつで終了、総資産(お金+土地+建物)で勝負。${settings.buyout ? '強制買収あり(1人1回・地価の2倍)' : '土地の移動は交渉のみ'}`);
    this.startTurn();
  }

  // ---------- 共通 ----------
  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  clearTurnTimer() {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.timers.delete(this.turnTimer); this.turnTimer = null; }
  }
  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  p(id) {
    return this.players.find((x) => x.id === id);
  }
  name(p) {
    return p.cpu ? p.name : this.ctx.nameOf(p.id);
  }
  current() {
    return this.players[this.turnIndex];
  }
  props(pid) {
    return Object.keys(this.own).map(Number).filter((i) => this.own[i].owner === pid);
  }
  groupOwnedBy(g, pid) {
    return SPACES.filter((s) => s.g === g).every((s) => this.own[s.i]?.owner === pid);
  }
  groupHasHouses(g) {
    return SPACES.filter((s) => s.g === g).some((s) => this.own[s.i]?.houses > 0);
  }
  rent(i) {
    const o = this.own[i];
    const s = SPACES[i];
    if (!o) return 0;
    if (o.houses > 0) return s.base * RENT_MULT[o.houses] * 2;
    return s.base * (this.groupOwnedBy(s.g, o.owner) ? 2 : 1);
  }
  worth(p) {
    return p.money + this.props(p.id).reduce((sum, i) => sum + SPACES[i].price + (this.own[i].houses || 0) * GROUPS[SPACES[i].g].house, 0);
  }

  // ---------- 手番 ----------
  startTurn() {
    if (this.turnCount >= this.maxTurns || this.players.filter((p) => !p.out).length <= 1) return this.finish();
    let guard = 0;
    while (this.current().out && guard++ < 10) this.turnIndex = (this.turnIndex + 1) % this.players.length;
    this.phase = 'roll';
    this.pending = null;
    this.seq++;
    this.armTurnTimer(this.s.turnSeconds * 1000, () => this.roll(this.current().id));
    if (this.current().cpu) this.later(rint(1200, 2000), () => this.roll(this.current().id));
    this.ctx.update();
  }

  armTurnTimer(ms, fn) {
    this.clearTurnTimer();
    this.turnEndsAt = Date.now() + ms;
    this.turnTimer = this.later(ms, fn);
  }

  roll(pid) {
    const p = this.current();
    if (this.phase !== 'roll' || p.id !== pid) return;
    const d = [rint(1, 6), rint(1, 6)];
    this.lastRoll = { d, by: pid, from: p.pos, turn: this.turnCount };
    this.moveBy(p, d[0] + d[1]);
    this.ctx.system(`${this.name(p)}:🎲${d[0]}+${d[1]} → ${SPACES[p.pos].name}`);
    this.land(p);
  }

  moveBy(p, n) {
    const before = p.pos;
    p.pos = (p.pos + n + SPACES.length) % SPACES.length;
    if (n > 0 && p.pos < before) {
      p.money += PASS_BONUS;
      this.ctx.system(`${this.name(p)}はスタートを通過して${PASS_BONUS}もらった`);
    }
  }

  land(p) {
    const s = SPACES[p.pos];
    if (s.t === 'prop') {
      const o = this.own[p.pos];
      if (!o) {
        if (p.money >= s.price) {
          this.phase = 'buy';
          this.pending = { kind: 'buy', space: p.pos, price: s.price };
          this.armTurnTimer(this.s.turnSeconds * 1000, () => this.decideBuy(p.id, false));
          if (p.cpu) this.later(rint(900, 1500), () => this.decideBuy(p.id, p.money - s.price >= 150 || this.cpuWants(p, p.pos)));
          this.seq++;
          return this.ctx.update();
        }
      } else if (o.owner !== p.id) {
        const r = this.rent(p.pos);
        const owner = this.p(o.owner);
        this.pay(p, owner, r, `${s.name}の通行料`);
      }
    } else if (s.t === 'tax') {
      this.pay(p, null, s.amount, '税金');
    } else if (s.t === 'chance') {
      return this.chance(p);
    }
    this.toAct();
  }

  chance(p) {
    const c = pick(CHANCES);
    this.ctx.system(`${this.name(p)}のチャンス:${c.text}`);
    this.lastChance = { by: p.id, text: c.text, turn: this.turnCount };
    if (c.money > 0) p.money += c.money;
    if (c.money < 0) this.pay(p, null, -c.money, 'チャンス');
    if (c.perHouse) this.pay(p, null, -c.perHouse * this.props(p.id).reduce((s, i) => s + (this.own[i].houses || 0), 0), '固定資産税');
    if (c.fromEach) for (const o of this.players.filter((x) => x !== p && !x.out)) this.pay(o, p, c.fromEach, 'お祝い');
    if (c.toEach) for (const o of this.players.filter((x) => x !== p && !x.out)) this.pay(p, o, c.toEach, '幹事代');
    if (c.moveTo !== undefined) {
      const n = (c.moveTo - p.pos + SPACES.length) % SPACES.length;
      this.moveBy(p, n);
      if (c.moveTo !== 0) return this.land(p);
    }
    if (c.back) {
      this.moveBy(p, -c.back);
      return this.land(p);
    }
    this.toAct();
  }

  cpuWants(p, i) {
    const g = SPACES[i].g;
    return SPACES.filter((s) => s.g === g).some((s) => this.own[s.i]?.owner === p.id) && p.money - SPACES[i].price >= 50;
  }

  decideBuy(pid, yes) {
    const p = this.current();
    if (this.phase !== 'buy' || p.id !== pid) return;
    const i = this.pending.space;
    if (yes && p.money >= SPACES[i].price) {
      p.money -= SPACES[i].price;
      this.own[i] = { owner: p.id, houses: 0 };
      this.ctx.system(`${this.name(p)}が${SPACES[i].name}を${SPACES[i].price}で買った`);
    }
    this.pending = null;
    this.toAct();
  }

  toAct() {
    this.phase = 'act';
    this.seq++;
    const p = this.current();
    this.armTurnTimer(this.s.turnSeconds * 1000, () => this.endTurn(p.id));
    if (p.cpu) this.later(rint(1000, 1800), () => { this.cpuBuild(p); this.endTurn(p.id); });
    this.ctx.update();
  }

  endTurn(pid) {
    const p = this.current();
    if (!['act'].includes(this.phase) || p.id !== pid) return;
    this.clearTurnTimer();
    this.turnCount++;
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
    this.startTurn();
  }

  // ---------- お金 ----------
  pay(from, to, amount, why) {
    if (amount <= 0 || from.out) return;
    if (from.money < amount) this.raise(from, amount);
    const paid = Math.min(amount, from.money);
    from.money -= paid;
    if (to) to.money += paid;
    this.ctx.system(`${this.name(from)}が${to ? `${this.name(to)}に` : ''}${why}${paid}を払った`);
    if (paid < amount) this.bankrupt(from, to);
  }

  // 足りないときは建物を半額で、次に土地を半額で銀行に売って工面する
  raise(p, need) {
    const mine = this.props(p.id).sort((a, b) => SPACES[a].price - SPACES[b].price);
    for (const i of mine) {
      while (this.own[i].houses > 0 && p.money < need) {
        this.own[i].houses--;
        p.money += GROUPS[SPACES[i].g].house / 2;
      }
    }
    for (const i of mine) {
      if (p.money >= need) break;
      if (this.own[i].houses > 0) continue;
      p.money += SPACES[i].price / 2;
      delete this.own[i];
      this.ctx.system(`${this.name(p)}は${SPACES[i].name}を銀行に売って工面した`);
    }
  }

  bankrupt(p, creditor) {
    p.out = true;
    for (const i of this.props(p.id)) {
      if (creditor) this.own[i] = { owner: creditor.id, houses: 0 };
      else delete this.own[i];
    }
    this.trades = this.trades.filter((t) => t.from !== p.id && t.to !== p.id);
    this.ctx.system(`${this.name(p)}は破産した…`);
  }

  // ---------- 建物 ----------
  build(pid, i) {
    const p = this.p(pid);
    if (this.phase !== 'act' || this.current().id !== pid) return;
    const s = SPACES[i];
    const o = this.own[i];
    if (!o || o.owner !== pid || !this.groupOwnedBy(s.g, pid) || o.houses >= MAX_HOUSES) return;
    // 同じ色は均等に建てる
    const minH = Math.min(...SPACES.filter((x) => x.g === s.g).map((x) => this.own[x.i].houses));
    if (o.houses > minH) return;
    const cost = GROUPS[s.g].house;
    if (p.money < cost) return;
    p.money -= cost;
    o.houses++;
    this.ctx.system(`${this.name(p)}が${s.name}に建物を建てた(${o.houses}軒目)`);
  }

  cpuBuild(p) {
    for (const i of this.props(p.id)) {
      const g = SPACES[i].g;
      if (!this.groupOwnedBy(g, p.id)) continue;
      for (let k = 0; k < 3; k++) if (p.money - GROUPS[g].house >= 250) this.build(p.id, i);
    }
  }

  // ---------- 取引 ----------
  // offer = { give: {props:[], money}, get: {props:[], money} }  from から見た「渡す/もらう」
  validSide(pid, side) {
    const props = [...new Set((side.props || []).map(Number))];
    const money = Math.max(0, Math.floor(Number(side.money) || 0));
    for (const i of props) {
      const o = this.own[i];
      if (!o || o.owner !== pid || this.groupHasHouses(SPACES[i].g)) return null;
    }
    return { props, money };
  }

  propose(pid, toId, give, get) {
    const from = this.p(pid);
    const to = this.p(toId);
    if (!from || !to || from === to || from.out || to.out || this.phase === 'ended') return;
    const g = this.validSide(pid, give || {});
    const r = this.validSide(toId, get || {});
    if (!g || !r || (!g.props.length && !r.props.length && !g.money && !r.money)) return;
    if (g.money > from.money) return;
    // 同じ相手への古い提案は取り下げる
    this.trades = this.trades.filter((t) => !(t.from === pid && t.to === toId));
    const t = { id: `t${++this.tradeSeq}`, from: pid, to: toId, give: g, get: r };
    this.trades.push(t);
    this.ctx.system(`${this.name(from)}が${this.name(to)}に取引を持ちかけた:${this.tradeText(t)}`);
    if (to.cpu) this.later(rint(1200, 2500), () => this.cpuAnswer(t));
  }

  tradeText(t) {
    const side = (s) => [...s.props.map((i) => SPACES[i].name), s.money ? `${s.money}` : null].filter(Boolean).join('+') || 'なし';
    return `「${side(t.give)}」と「${side(t.get)}」を交換`;
  }

  respond(pid, tradeId, yes) {
    const t = this.trades.find((x) => x.id === tradeId);
    if (!t || t.to !== pid) return;
    this.trades = this.trades.filter((x) => x !== t);
    const from = this.p(t.from);
    const to = this.p(t.to);
    if (!yes) return this.ctx.system(`${this.name(to)}は取引を断った`);
    // 受けた時点で成立できるか確かめる
    const g = this.validSide(t.from, t.give);
    const r = this.validSide(t.to, t.get);
    if (!g || !r || from.money < g.money || to.money < r.money) return this.ctx.system('取引は条件が変わっていたため成立しなかった');
    for (const i of g.props) this.own[i].owner = to.id;
    for (const i of r.props) this.own[i].owner = from.id;
    from.money += r.money - g.money;
    to.money += g.money - r.money;
    this.ctx.system(`取引成立!${this.name(from)}と${this.name(to)}:${this.tradeText(t)}`);
  }

  withdraw(pid, tradeId) {
    this.trades = this.trades.filter((t) => !(t.id === tradeId && t.from === pid));
  }

  cpuValue(p, props) {
    return props.reduce((s, i) => {
      const g = SPACES[i].g;
      const mine = SPACES.filter((x) => x.g === g && this.own[x.i]?.owner === p.id).length;
      const size = SPACES.filter((x) => x.g === g).length;
      return s + SPACES[i].price * (mine + 1 === size ? 2 : 1);
    }, 0);
  }

  cpuAnswer(t) {
    if (!this.trades.includes(t)) return;
    const cpu = this.p(t.to);
    // CPUから見た価値:もらうもの(相手のgive)−渡すもの(相手のget)。そろう色は高く見る
    const gain = this.cpuValue(cpu, t.give.props) + t.give.money;
    const lossProps = t.get.props.reduce((s, i) => {
      const g = SPACES[i].g;
      return s + SPACES[i].price * (this.groupOwnedBy(g, cpu.id) ? 2.5 : 1);
    }, 0);
    const loss = lossProps + t.get.money;
    this.respond(cpu.id, t.id, gain >= loss * 1.1 && cpu.money >= t.get.money);
    this.ctx.update();
  }

  // 強制買収:手番の中で1人1回、地価の2倍を払えば相手の同意なしに土地を奪える(建物のある色は不可)
  buyout(pid, i) {
    const p = this.p(pid);
    if (!this.s.buyout || this.phase !== 'act' || this.current().id !== pid || p.buyoutLeft < 1) return;
    const o = this.own[i];
    if (!o || o.owner === pid || this.groupHasHouses(SPACES[i].g)) return;
    const cost = SPACES[i].price * 2;
    if (p.money < cost) return;
    const victim = this.p(o.owner);
    p.money -= cost;
    victim.money += cost;
    o.owner = pid;
    p.buyoutLeft--;
    this.trades = this.trades.filter((t) => ![...t.give.props, ...t.get.props].includes(i));
    this.ctx.system(`${this.name(p)}が${this.name(victim)}の${SPACES[i].name}を${cost}で強制買収した!`);
    this.lastBuyout = { by: pid, space: i, turn: this.turnCount };
  }

  finish() {
    this.dispose();
    this.phase = 'ended';
    this.seq++;
    const rank = [...this.players].sort((a, b) => this.worth(b) - this.worth(a));
    this.ctx.system(`終了!一番の地主は${this.name(rank[0])}(総資産${this.worth(rank[0])})`);
    this.ctx.update();
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    switch (type) {
      case 'roll':
        this.roll(pid);
        return;
      case 'buy':
        this.decideBuy(pid, payload.yes !== false);
        return;
      case 'build':
        this.build(pid, Number(payload.space));
        break;
      case 'end':
        this.endTurn(pid);
        return;
      case 'propose':
        this.propose(pid, String(payload.to), payload.give, payload.get);
        break;
      case 'respond':
        this.respond(pid, String(payload.id), !!payload.yes);
        break;
      case 'withdraw':
        this.withdraw(pid, String(payload.id));
        break;
      case 'buyout':
        this.buyout(pid, Number(payload.space));
        break;
      case 'finish':
        if (this.phase === 'ended' && isHost) this.ctx.finish();
        return;
      default:
        return;
    }
    this.ctx.update();
  }

  onJoin() {}

  onLeave(id) {
    const p = this.p(id);
    if (!p) return;
    p.cpu = true;
    p.name = `${this.ctx.nameOf(id)}(CPU代行)`;
    this.trades = this.trades.filter((t) => t.from !== id);
    if (this.current() === p) {
      if (this.phase === 'roll') this.later(1000, () => this.roll(id));
      if (this.phase === 'buy') this.later(1000, () => this.decideBuy(id, false));
      if (this.phase === 'act') this.later(1000, () => this.endTurn(id));
    }
  }

  onConnectionChange() {}

  // ---------- 表示用データ ----------
  view(pid) {
    const cur = this.current();
    return {
      phase: this.phase,
      seq: this.seq,
      turn: cur?.id,
      turnName: cur ? this.name(cur) : '',
      turnCount: this.turnCount,
      maxTurns: this.maxTurns,
      endsAt: this.phase === 'ended' ? null : this.turnEndsAt,
      buyoutOn: !!this.s.buyout,
      spaces: SPACES.map((s) => ({
        ...s,
        group: s.g ? { name: GROUPS[s.g].name, color: GROUPS[s.g].color, house: GROUPS[s.g].house } : null,
        owner: this.own[s.i]?.owner ?? null,
        houses: this.own[s.i]?.houses ?? 0,
        rent: this.own[s.i] ? this.rent(s.i) : s.base || 0,
        full: s.g ? !!this.own[s.i] && this.groupOwnedBy(s.g, this.own[s.i].owner) : false,
      })),
      players: this.players.map((p) => ({
        id: p.id,
        name: this.name(p),
        cpu: p.cpu,
        color: p.color,
        money: p.money,
        pos: p.pos,
        out: p.out,
        worth: this.worth(p),
        buyoutLeft: p.buyoutLeft,
        props: this.props(p.id),
      })),
      pending: this.pending,
      lastRoll: this.lastRoll,
      lastChance: this.lastChance,
      lastBuyout: this.lastBuyout,
      trades: this.trades.filter((t) => t.from === pid || t.to === pid),
      me: pid,
    };
  }
}

module.exports = {
  id: 'jinushi',
  name: '街の地主',
  tagline: 'サイコロで街を回って土地を買い占める。交換も買収も交渉しだい。',
  description:
    'サイコロで盤を回り、止まった土地を買い、同じ色をそろえて建物を建てると通行料が跳ね上がります。' +
    '土地はいつでもほかのプレイヤーと交換・売買を提案でき、設定しだいで強制買収も。決まったターン数で終わり、総資産が一番多い人の勝ち。',
  minPlayers: 2,
  maxPlayers: 6,
  cpu: true,
  settings: [
    { key: 'cpu', label: 'CPUの人数', default: 0, options: [0, 1, 2, 3].map((n) => ({ value: n, label: n ? `${n}人` : 'なし' })) },
    { key: 'laps', label: '長さ', default: 12, options: [8, 12, 16, 20].map((n) => ({ value: n, label: `1人${n}ターン` })) },
    {
      key: 'buyout',
      label: '強制買収',
      default: false,
      options: [
        { value: false, label: 'なし(交渉のみ)' },
        { value: true, label: 'あり(1人1回・地価の2倍)' },
      ],
    },
    { key: 'turnSeconds', label: '手番の時間', default: 60, options: [45, 60, 90].map((n) => ({ value: n, label: `${n}秒` })) },
  ],
  create: (ctx, settings, playerIds) => new JinushiGame(ctx, settings, playerIds),
  _internal: { SPACES, GROUPS },
};
