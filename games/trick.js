// 作戦トリック(協力トリックテイキング)
// 4色×1〜9と切り札(ロケット)1〜4の40枚。場に1枚ずつ出し、出された色で一番強い札(切り札があれば切り札の一番強い札)が取る。
// 任務「〇〇が△△の札を取る」を全員で達成する。1人でも違う人が任務の札を取れば失敗。
// ミスが「その1枚を出した人のやらかし」になるよう、情報は多めに出す:
//   手札の一部は最初から公開/色ごとの枚数は公開/各自に合図(最高・最低・1枚だけ)/出た札の記録/数字はチャットで伏せ字。

const COLORS = ['r', 'b', 'g', 'y'];
const COLOR_NAME = { r: '赤', b: '青', g: '緑', y: '黄', x: '切り札' };
const cardName = (c) => `${COLOR_NAME[c.c]}${c.n}`;
const cardId = (c) => `${c.c}${c.n}`;

// ステージの難しさ:任務の数/手札の公開割合/合図の回数/順番指定
const STAGES = [
  { tasks: 1, open: 1 / 2, signals: 2, ord: 0, last: false },
  { tasks: 2, open: 1 / 2, signals: 2, ord: 0, last: false },
  { tasks: 2, open: 1 / 2, signals: 2, ord: 2, last: false },
  { tasks: 3, open: 1 / 2, signals: 2, ord: 0, last: false },
  { tasks: 3, open: 1 / 3, signals: 2, ord: 2, last: false },
  { tasks: 3, open: 1 / 3, signals: 1, ord: 0, last: true },
  { tasks: 4, open: 1 / 3, signals: 1, ord: 2, last: false },
  { tasks: 4, open: 1 / 3, signals: 1, ord: 2, last: true },
  { tasks: 5, open: 1 / 4, signals: 1, ord: 0, last: false },
  { tasks: 5, open: 1 / 4, signals: 1, ord: 3, last: true },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fullDeck() {
  const d = [];
  for (const c of COLORS) for (let n = 1; n <= 9; n++) d.push({ c, n });
  for (let n = 1; n <= 4; n++) d.push({ c: 'x', n });
  return d;
}

// その時点の場で、この札が勝っているか
function winnerIndex(trick) {
  const lead = trick[0].card.c;
  let best = 0;
  trick.forEach((t, i) => {
    const b = trick[best].card;
    const c = t.card;
    if (c.c === 'x' && (b.c !== 'x' || c.n > b.n)) best = i;
    else if (c.c === lead && b.c !== 'x' && b.c === lead && c.n > b.n) best = i;
  });
  return best;
}

class TrickGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.players = humanIds.map((id) => ({ id }));
    this.stage = 0;
    this.attempt = 0;
    this.blunders = []; // 今日のやらかし
    this.cleared = 0;
    this.seq = 0;
    this.ctx.system(`作戦トリック開始。全${settings.stages}ステージ。任務の札を、決められた人が取れば成功です`);
    this.startMission(true);
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
  name(id) {
    return this.ctx.nameOf(id);
  }
  p(id) {
    return this.players.find((x) => x.id === id);
  }
  idx(id) {
    return this.players.findIndex((x) => x.id === id);
  }
  conf() {
    return STAGES[Math.min(Math.max(this.stage - 1, 0), STAGES.length - 1)];
  }

  // ---------- 任務の準備 ----------
  startMission(nextStage) {
    this.clearTimers();
    if (nextStage) {
      this.stage++;
      this.attempt = 0;
    }
    this.attempt++;
    const conf = this.conf();
    let deck = shuffle(fullDeck());
    const n = this.players.length;
    // 割り切れない分は、切り札以外から抜いて全員に公開する(3人なら1枚)
    this.removed = [];
    while (deck.length % n) {
      const i = deck.findIndex((c) => c.c !== 'x');
      this.removed.push(deck.splice(i, 1)[0]);
    }
    this.players.forEach((p) => {
      p.hand = [];
      p.won = [];
      p.signals = [];
      p.signalsLeft = conf.signals;
      p.tasks = [];
    });
    deck.forEach((c, i) => this.players[i % n].hand.push({ ...c, open: false }));
    for (const p of this.players) {
      p.hand.sort((a, b) => (a.c === b.c ? a.n - b.n : 'rbgyx'.indexOf(a.c) - 'rbgyx'.indexOf(b.c)));
      const k = Math.floor(p.hand.length * conf.open);
      for (const c of shuffle(p.hand).slice(0, k)) c.open = true;
    }
    // 任務の札:切り札以外から
    const inPlay = (c) => !this.removed.some((r) => r.c === c.c && r.n === c.n);
    const taskCards = shuffle(fullDeck().filter((c) => c.c !== 'x' && inPlay(c))).slice(0, conf.tasks);
    const marks = [];
    for (let i = 1; i <= conf.ord; i++) marks.push(String(i));
    if (conf.last) marks.push('last');
    this.pool = taskCards.map((c, i) => ({ card: c, ord: marks[i] || null, owner: null, done: false }));
    this.captain = this.players.find((p) => p.hand.some((c) => c.c === 'x' && c.n === 4)).id;
    this.picker = this.captain;
    this.trick = [];
    this.leader = this.captain;
    this.turn = null;
    this.played = [];
    this.doneOrder = [];
    this.result = null;
    this.phase = 'draft';
    this.seq++;
    this.ctx.system(
      `ステージ${this.stage}${this.attempt > 1 ? `(${this.attempt}回目の挑戦)` : ''}。任務は${this.pool.length}つ。` +
        `隊長は${this.name(this.captain)}さん(切り札4を持っている人)。隊長から順に任務を選んでください`,
    );
    this.ctx.update();
  }

  pickTask(pid, cid) {
    if (this.phase !== 'draft' || pid !== this.picker) return;
    const t = this.pool.find((x) => !x.owner && cardId(x.card) === cid);
    if (!t) return;
    t.owner = pid;
    this.ctx.system(`${this.name(pid)}さんが任務「${cardName(t.card)}を取る」${t.ord ? `(${t.ord === 'last' ? '最後' : `${t.ord}番目`})` : ''}を引き受けた`);
    const left = this.pool.filter((x) => !x.owner);
    if (!left.length) return this.startPlay();
    this.picker = this.players[(this.idx(pid) + 1) % this.players.length].id;
  }

  startPlay() {
    this.phase = 'play';
    this.turn = this.leader;
    this.seq++;
    this.armTurnTimer();
  }

  armTurnTimer() {
    this.clearTimers();
    this.turnEndsAt = null;
    if (!this.s.turnSeconds) return;
    this.turnEndsAt = Date.now() + this.s.turnSeconds * 1000;
    const who = this.turn;
    this.later(this.s.turnSeconds * 1000, () => {
      if (this.phase !== 'play' || this.turn !== who) return;
      const legal = this.legal(this.p(who));
      const pick = [...legal].sort((a, b) => (a.c === 'x') - (b.c === 'x') || a.n - b.n)[0];
      this.ctx.system(`${this.name(who)}さんは時間切れ。一番弱い札を自動で出した`);
      this.play(who, cardId(pick));
      this.ctx.update();
    });
  }

  // ---------- 手番 ----------
  legal(p) {
    if (!this.trick.length) return p.hand;
    const lead = this.trick[0].card.c;
    const follow = p.hand.filter((c) => c.c === lead);
    return follow.length ? follow : p.hand;
  }

  play(pid, cid) {
    if (this.phase !== 'play' || pid !== this.turn) return;
    const p = this.p(pid);
    const card = this.legal(p).find((c) => cardId(c) === cid);
    if (!card) return;
    // 自分の番の時点で、勝たずに済む札があったか(やらかしの判定用)
    const legal = this.legal(p);
    p.hand = p.hand.filter((c) => c !== card);
    this.trick.push({ player: pid, card: { c: card.c, n: card.n }, couldDuck: this.couldDuck(legal, card) });
    this.played.push({ c: card.c, n: card.n });
    if (this.trick.length < this.players.length) {
      this.turn = this.players[(this.idx(pid) + 1) % this.players.length].id;
      this.armTurnTimer();
      return;
    }
    this.finishTrick();
  }

  // 同じ場で、今出した札の代わりに「勝たない札」を出せたか
  couldDuck(legal, played) {
    const others = legal.filter((c) => c !== played);
    return others.some((c) => {
      const test = [...this.trick, { card: c }];
      return winnerIndex(test) !== test.length - 1;
    });
  }

  finishTrick() {
    const w = winnerIndex(this.trick);
    const win = this.trick[w];
    const winner = win.player;
    this.p(winner).won.push(...this.trick.map((t) => t.card));
    const lastTrick = this.players.every((p) => !p.hand.length);
    // 任務の判定
    let fail = null;
    for (const t of this.pool) {
      if (t.done) continue;
      const inTrick = this.trick.find((x) => x.card.c === t.card.c && x.card.n === t.card.n);
      if (!inTrick) continue;
      if (winner !== t.owner) {
        fail = { task: t, why: 'wrong', winner, culprit: winner, playedBy: inTrick.player, avoidable: win.couldDuck };
        break;
      }
      // 順番の指定
      const ordered = this.pool.filter((x) => x.ord && x.ord !== 'last');
      if (t.ord && t.ord !== 'last' && ordered.some((x) => !x.done && Number(x.ord) < Number(t.ord))) {
        fail = { task: t, why: 'order', winner, culprit: winner, playedBy: inTrick.player, avoidable: win.couldDuck };
        break;
      }
      if (t.ord === 'last' && this.pool.some((x) => x !== t && !x.done)) {
        fail = { task: t, why: 'last', winner, culprit: winner, playedBy: inTrick.player, avoidable: win.couldDuck };
        break;
      }
      t.done = true;
      this.doneOrder.push(cardId(t.card));
    }
    this.lastTrick = { cards: this.trick, winner };
    const text = this.trick.map((t) => `${this.name(t.player)} ${cardName(t.card)}`).join(' / ');
    this.ctx.system(`${text} → ${this.name(winner)}さんが取った`);
    this.trick = [];
    this.leader = winner;

    if (fail) return this.endMission(false, fail);
    if (this.pool.every((t) => t.done)) return this.endMission(true);
    if (lastTrick) return this.endMission(false, { why: 'undone' });
    this.turn = winner;
    this.armTurnTimer();
  }

  endMission(ok, fail = null) {
    this.clearTimers();
    this.phase = 'result';
    this.turn = null;
    this.seq++;
    if (ok) {
      this.cleared = Math.max(this.cleared, this.stage);
      this.result = { ok: true };
      this.ctx.system(`ステージ${this.stage} 成功!(${this.attempt}回目の挑戦)`);
    } else {
      const t = fail.task;
      const reason =
        fail.why === 'wrong'
          ? `${this.name(fail.culprit)}さんが「${cardName(t.card)}」を取ってしまった(${this.name(t.owner)}さんの任務)`
          : fail.why === 'order'
            ? `${this.name(t.owner)}さんが「${cardName(t.card)}」を順番より先に取ってしまった`
            : fail.why === 'last'
              ? `${this.name(t.owner)}さんの「${cardName(t.card)}」は最後に取る任務だった`
              : '手札がなくなったのに、終わっていない任務が残った';
      const culprit = fail.why === 'undone' ? null : fail.culprit;
      this.result = { ok: false, reason, culprit, culpritName: culprit ? this.name(culprit) : null, avoidable: !!fail.avoidable, task: t ? { card: t.card, owner: this.name(t.owner) } : null };
      if (culprit) this.blunders.push({ stage: this.stage, name: this.name(culprit), reason, avoidable: !!fail.avoidable });
      this.ctx.system(`ステージ${this.stage} 失敗…${reason}${fail.avoidable ? '。別の札を出せば取らずに済んだ' : ''}`);
    }
    this.ctx.update();
  }

  next(isHost) {
    if (this.phase !== 'result' || !isHost) return;
    if (this.result.ok && this.stage >= this.s.stages) return this.finish();
    this.startMission(this.result.ok);
  }

  finish() {
    this.clearTimers();
    this.phase = 'ended';
    this.seq++;
    this.ctx.system(`作戦終了。ステージ${this.cleared}までクリア、やらかしは${this.blunders.length}回`);
    this.ctx.update();
  }

  // 合図:非公開の札を1枚見せて「この色の最高/最低/1枚だけ」を添える(正しいものしか選べない)
  signalOptions(p, c) {
    if (c.c === 'x') return [];
    const same = p.hand.filter((x) => x.c === c.c);
    const out = [];
    if (same.length === 1) out.push('only');
    else {
      if (Math.max(...same.map((x) => x.n)) === c.n) out.push('top');
      if (Math.min(...same.map((x) => x.n)) === c.n) out.push('bottom');
    }
    return out;
  }

  signal(pid, cid, label) {
    if (this.phase !== 'play' || this.trick.length) return; // 場に札が出ている途中は合図できない
    const p = this.p(pid);
    if (!p || p.signalsLeft < 1) return;
    const c = p.hand.find((x) => cardId(x) === cid);
    if (!c || c.open || !this.signalOptions(p, c).includes(label)) return;
    c.open = true;
    p.signalsLeft--;
    p.signals.push({ card: { c: c.c, n: c.n }, label });
    const word = { top: 'この色の最高', bottom: 'この色の最低', only: 'この色は1枚だけ' }[label];
    this.ctx.system(`${this.name(pid)}さんの合図:「${cardName(c)}」は${word}`);
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    switch (type) {
      case 'pick':
        this.pickTask(pid, String(payload.card));
        break;
      case 'play':
        this.play(pid, String(payload.card));
        break;
      case 'signal':
        this.signal(pid, String(payload.card), String(payload.label));
        break;
      case 'next':
        return this.next(isHost);
      case 'giveUp':
        if (this.phase !== 'play' || !isHost) return;
        return this.endMission(false, { why: 'undone' });
      case 'finish':
        if (isHost && this.phase === 'result') return this.finish();
        if (isHost && this.phase === 'ended') return this.ctx.finish();
        return;
      default:
        return;
    }
    this.ctx.update();
  }

  // 数字をチャットで言うと作戦が崩れるので、ゲーム中は伏せ字にする
  filterChat(pid, text) {
    if (!['draft', 'play'].includes(this.phase)) return text;
    return text.replace(/[0-9０-９①-⑨]/g, '●');
  }

  onJoin() {}

  onLeave(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.players.length < 2) return this.finish();
    this.ctx.system('メンバーが抜けたので、配り直してこのステージをやり直します');
    this.startMission(false);
  }

  onConnectionChange() {}

  // ---------- 表示用データ ----------
  view(pid) {
    const me = this.p(pid);
    const conf = this.conf();
    const v = {
      phase: this.phase,
      seq: this.seq,
      stage: this.stage,
      stages: this.s.stages,
      attempt: this.attempt,
      conf: { tasks: conf.tasks, open: conf.open, signals: conf.signals },
      captain: this.captain,
      picker: this.picker,
      turn: this.turn,
      leader: this.leader,
      endsAt: this.turnEndsAt || null,
      trick: this.trick.map((t) => ({ player: t.player, card: t.card })),
      lastTrick: this.lastTrick ? { winner: this.lastTrick.winner, cards: this.lastTrick.cards.map((t) => ({ player: t.player, card: t.card })) } : null,
      played: this.played,
      removed: this.removed,
      tasks: this.pool.map((t) => ({ card: t.card, ord: t.ord, owner: t.owner, ownerName: t.owner ? this.name(t.owner) : null, done: t.done })),
      players: this.players.map((p) => {
        const counts = Object.fromEntries(['r', 'b', 'g', 'y', 'x'].map((c) => [c, p.hand.filter((x) => x.c === c).length]));
        return {
          id: p.id,
          name: this.name(p.id),
          count: p.hand.length,
          counts,
          open: p.hand.filter((c) => c.open).map((c) => ({ c: c.c, n: c.n })),
          signals: p.signals,
          signalsLeft: p.signalsLeft,
          won: p.won.length,
        };
      }),
      result: this.result,
      blunders: this.blunders,
      cleared: this.cleared,
    };
    if (me) {
      const legal = this.phase === 'play' && this.turn === pid ? new Set(this.legal(me).map(cardId)) : new Set();
      v.me = {
        hand: me.hand.map((c) => ({
          c: c.c,
          n: c.n,
          open: c.open,
          legal: legal.has(cardId(c)),
          signals: this.phase === 'play' && !this.trick.length && !c.open && me.signalsLeft > 0 ? this.signalOptions(me, c) : [],
        })),
        signalsLeft: me.signalsLeft,
      };
    }
    return v;
  }
}

module.exports = {
  id: 'trick',
  name: '作戦トリック',
  tagline: '全員で任務を達成する協力トランプ。うっかり1枚で台なしに。',
  description:
    '4色と切り札の札で、場に1枚ずつ出して一番強い札の人が取るトランプ遊びを協力でやります。任務「〇〇が赤7を取る」を全員で達成すれば成功。' +
    '手札の一部と色ごとの枚数は公開、合図も使えるので、ミスはだいたい「分かったはずの1枚」。ステージが進むほど任務が増え、見える情報が減ります。',
  minPlayers: 3,
  maxPlayers: 5,
  cpu: false,
  settings: [
    { key: 'stages', label: 'ステージ数', default: 5, options: [3, 5, 8, 10].map((n) => ({ value: n, label: `${n}ステージ` })) },
    {
      key: 'turnSeconds',
      label: '手番の時間',
      default: 0,
      options: [
        { value: 0, label: '制限なし' },
        { value: 60, label: '60秒' },
        { value: 90, label: '90秒' },
      ],
    },
  ],
  create: (ctx, settings, playerIds) => new TrickGame(ctx, settings, playerIds),
  _internal: { winnerIndex, fullDeck },
};
