// 基準当て
// 親は秘密の「基準」(重い、強そう、魔王が欲しがりそう…)を選ぶ。
// 子は手札の言葉から2つを指名して「どっちが上?」と親に比べてもらい、その結果から基準を推理する。
// 最後に、基準に一番合うと思う手札を1枚出して親に順位をつけてもらう。基準そのものを当てても得点。
const { CRITERIA, NOUNS } = require('./words');

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);

const PHASE_MS = { prepare: 75000, ask: 40000, answer: 30000, final: 60000, rank: 90000 };
const HAND = 5; // 手札の枚数
const CANDS = 8; // 用意された候補の数
const REROLLS = 3; // 候補の引き直し回数
const RANK_POINTS = [3, 2, 1];

class KijunGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.players = shuffle(humanIds).map((id) => ({ id, score: 0 }));
    this.order = []; // 親の順番
    for (let r = 0; r < settings.laps; r++) this.order.push(...this.players.map((p) => p.id));
    this.roundIndex = -1;
    this.seq = 0;
    this.deck = shuffle(NOUNS);
    this.usedCriteria = new Set();
    this.ctx.system(`全${this.order.length}ラウンド。全員が${settings.laps === 1 ? '1回ずつ' : `${settings.laps}回ずつ`}親をやります`);
    this.nextRound();
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
  player(id) {
    return this.players.find((p) => p.id === id);
  }
  children() {
    return this.players.filter((p) => p.id !== this.parent);
  }
  active(id) {
    return this.ctx.isConnected(id);
  }
  setPhase(phase, ms) {
    this.clearTimers();
    this.phase = phase;
    this.endsAt = ms ? Date.now() + ms : null;
    this.seq++;
  }
  drawCriteria() {
    const fresh = CRITERIA.filter((c) => !this.usedCriteria.has(c) && !(this.options || []).includes(c));
    return shuffle(fresh.length >= 3 ? fresh : CRITERIA).slice(0, 3);
  }
  newCard(pid, w, own) {
    return { id: `c${++this.cardSeq}`, w, own };
  }
  draw(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) this.deck = shuffle(NOUNS);
      out.push(this.deck.pop());
    }
    return out;
  }

  // ---------- ラウンド ----------
  nextRound() {
    this.roundIndex++;
    if (this.roundIndex >= this.order.length) return this.finish();
    // 抜けた人の番は飛ばす
    this.parent = this.order[this.roundIndex];
    if (!this.player(this.parent)) return this.nextRound();

    this.options = this.drawCriteria();
    this.critRerolls = REROLLS;
    this.criterion = null;
    this.criterionOwn = false;
    // 子は、用意された候補から選んでも、自分で書いてもよい
    this.hands = {};
    this.cands = {};
    this.rerolls = {};
    this.ready = {};
    for (const c of this.children()) {
      this.hands[c.id] = [];
      this.cands[c.id] = this.draw(CANDS);
      this.rerolls[c.id] = REROLLS;
      this.ready[c.id] = false;
    }
    this.cardSeq = 0;
    this.asks = [];
    this.askQueue = [];
    for (let k = 0; k < this.s.asks; k++) for (const c of shuffle(this.children())) this.askQueue.push(c.id);
    this.pending = null;
    this.finals = {};
    this.ranking = null;
    this.verdicts = {};
    this.roundResult = null;

    this.setPhase('prepare', PHASE_MS.prepare);
    this.later(PHASE_MS.prepare, () => this.startAsk());
    this.ctx.system(`第${this.roundIndex + 1}ラウンド。親は${this.name(this.parent)}さん。基準を選んでいます`);
    this.ctx.update();
  }

  prepareDone() {
    const childrenReady = this.children().every((c) => !this.active(c.id) || this.ready[c.id]);
    if (this.criterion && childrenReady) this.startAsk();
  }

  startAsk() {
    if (this.phase !== 'prepare') return;
    if (!this.criterion) this.criterion = this.options[rint(0, 2)];
    this.usedCriteria.add(this.criterion);
    // 選びきれなかった分は候補の上から補う
    for (const c of this.children()) {
      const hand = this.hands[c.id];
      const rest = this.cands[c.id].filter((w) => !hand.some((h) => h.w === w && !h.own));
      while (hand.length < HAND) hand.push(this.newCard(c.id, rest.shift() || this.draw(1)[0], false));
    }
    this.nextAsk();
  }

  pool() {
    return this.children().flatMap((c) => (this.hands[c.id] || []).map((h) => ({ id: h.id, w: h.w, owner: c.id })));
  }

  // 準備中の手札の操作(候補から選ぶ/自分で書く/外す/候補の引き直し/決定)
  prep(pid, type, payload) {
    if (this.phase !== 'prepare' || !this.hands[pid]) return;
    const hand = this.hands[pid];
    if (type === 'pickCand') {
      const w = String(payload.word);
      if (!this.cands[pid].includes(w) || hand.length >= HAND || hand.some((h) => h.w === w)) return;
      hand.push(this.newCard(pid, w, false));
    } else if (type === 'write') {
      const w = clean(payload.word);
      if (!w || hand.length >= HAND || hand.some((h) => h.w === w)) return;
      hand.push(this.newCard(pid, w, true));
    } else if (type === 'remove') {
      const i = hand.findIndex((h) => h.id === payload.id);
      if (i >= 0) hand.splice(i, 1);
    } else if (type === 'reroll') {
      if (this.rerolls[pid] < 1) return;
      this.rerolls[pid]--;
      const keep = this.cands[pid].filter((w) => hand.some((h) => h.w === w && !h.own));
      this.cands[pid] = [...keep, ...this.draw(CANDS - keep.length)];
    } else if (type === 'ready') {
      if (hand.length < HAND) return;
      this.ready[pid] = payload.value !== false;
      return this.prepareDone();
    }
    this.ready[pid] = false;
  }

  nextAsk() {
    while (this.askQueue.length && !this.active(this.askQueue[0])) this.askQueue.shift();
    if (!this.askQueue.length) return this.startFinal();
    this.asker = this.askQueue.shift();
    this.pending = null;
    this.setPhase('ask', PHASE_MS.ask);
    this.later(PHASE_MS.ask, () => {
      this.ctx.system(`${this.name(this.asker)}さんは時間切れで指名をパスした`);
      this.nextAsk();
    });
    this.ctx.update();
  }

  askPair(pid, aId, bId) {
    if (this.phase !== 'ask' || pid !== this.asker || aId === bId) return;
    const pool = this.pool();
    const A = pool.find((x) => x.id === aId);
    const B = pool.find((x) => x.id === bId);
    if (!A || !B) return;
    const a = A.w;
    const b = B.w;
    this.pending = { a, b, aId, bId, by: pid };
    this.setPhase('answer', PHASE_MS.answer);
    this.later(PHASE_MS.answer, () => this.answer(this.parent, null));
    this.ctx.system(`${this.name(pid)}さん:「${a}」と「${b}」、どっちが上?`);
    this.ctx.update();
  }

  answer(pid, pick) {
    if (this.phase !== 'answer' || pid !== this.parent) return;
    const p = this.pending;
    const result = pick === 'a' ? '>' : pick === 'b' ? '<' : pick === 'draw' ? '=' : null;
    this.asks.push({ ...p, result });
    const text =
      result === '>' ? `「${p.a}」の勝ち` : result === '<' ? `「${p.b}」の勝ち` : result === '=' ? '引き分け' : '親が答えなかった';
    this.ctx.system(`判定:${p.a} vs ${p.b} → ${text}`);
    this.nextAsk();
  }

  startFinal() {
    this.asker = null;
    this.pending = null;
    this.setPhase('final', PHASE_MS.final);
    this.later(PHASE_MS.final, () => this.startRank());
    this.ctx.system('最後の勝負。基準に一番合うと思う手札を1枚出してください(基準の予想も書けます)');
    this.ctx.update();
  }

  submitFinal(pid, cardId, guess) {
    if (this.phase !== 'final' || pid === this.parent || !this.hands[pid]) return;
    const card = this.hands[pid].find((h) => h.id === cardId);
    if (!card) return;
    this.finals[pid] = { word: card.w, cardId, guess: clean(guess) };
    if (this.children().every((c) => !this.active(c.id) || this.finals[c.id])) this.startRank();
  }

  startRank() {
    if (this.phase !== 'final') return;
    // 出さなかった人は手札の先頭を自動で出す
    for (const c of this.children()) if (!this.finals[c.id] && this.hands[c.id]?.length) this.finals[c.id] = { word: this.hands[c.id][0].w, cardId: this.hands[c.id][0].id, guess: '', auto: true };
    // 親には誰の札かわからないように並べ替えて見せる
    this.rankOrder = shuffle(Object.keys(this.finals));
    this.setPhase('rank', PHASE_MS.rank);
    this.later(PHASE_MS.rank, () => this.decide(this.parent, null, null));
    this.ctx.update();
  }

  decide(pid, ranking, verdicts) {
    if (this.phase !== 'rank' || pid !== this.parent) return;
    const ids = this.rankOrder;
    let order = Array.isArray(ranking) ? ranking.map(String).filter((id) => ids.includes(id)) : [];
    order = [...new Set(order)];
    if (order.length !== ids.length) order = [...order, ...shuffle(ids.filter((id) => !order.includes(id)))];
    const v = {};
    for (const id of ids) {
      const x = verdicts?.[id];
      v[id] = this.finals[id].guess ? (['hit', 'near', 'miss'].includes(x) ? x : 'miss') : null;
    }
    // 得点
    const gain = Object.fromEntries(this.players.map((p) => [p.id, 0]));
    order.forEach((id, i) => { gain[id] += RANK_POINTS[i] || 0; });
    for (const id of ids) {
      if (v[id] === 'hit') gain[id] += 2;
      if (v[id] === 'near') gain[id] += 1;
      if (v[id] === 'hit' || v[id] === 'near') gain[this.parent] += 1;
    }
    for (const p of this.players) p.score += gain[p.id] || 0;
    this.roundResult = { criterion: this.criterion, order, verdicts: v, gain };
    this.setPhase('result', null);
    this.ctx.system(
      `基準は「${this.criterion}もの」でした。1位は${this.name(order[0])}さんの「${this.finals[order[0]].word}」。` +
        `得点:${this.players.map((p) => `${this.name(p.id)} +${gain[p.id] || 0}`).join(' / ')}`,
    );
    this.ctx.update();
  }

  finish() {
    this.clearTimers();
    this.phase = 'ended';
    this.seq++;
    const top = [...this.players].sort((a, b) => b.score - a.score)[0];
    if (top) this.ctx.system(`ゲーム終了。優勝は${this.name(top.id)}さん(${top.score}点)`);
    this.ctx.update();
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    const p = this.player(pid);
    switch (type) {
      case 'choose':
        if (this.phase !== 'prepare' || pid !== this.parent || !this.options.includes(payload.criterion)) return;
        this.criterion = payload.criterion;
        this.criterionOwn = false;
        this.prepareDone();
        break;
      case 'customCriterion': {
        // 親が基準を自分で書く(「〜もの」は付けても付けなくてもよい)
        if (this.phase !== 'prepare' || pid !== this.parent) return;
        const t = clean(payload.text).replace(/もの$/, '');
        if (!t) return;
        this.criterion = t;
        this.criterionOwn = true;
        this.prepareDone();
        break;
      }
      case 'rerollCriteria':
        if (this.phase !== 'prepare' || pid !== this.parent || this.critRerolls < 1) return;
        this.critRerolls--;
        this.options = this.drawCriteria();
        if (!this.criterionOwn) this.criterion = null;
        break;
      case 'pickCand':
      case 'write':
      case 'remove':
      case 'reroll':
      case 'ready':
        this.prep(pid, type, payload);
        break;
      case 'ask':
        this.askPair(pid, String(payload.a), String(payload.b));
        return;
      case 'answer':
        this.answer(pid, payload.pick);
        return;
      case 'final':
        this.submitFinal(pid, String(payload.id), payload.guess);
        break;
      case 'decide':
        this.decide(pid, payload.ranking, payload.verdicts);
        return;
      case 'next':
        if (this.phase !== 'result' || !isHost) return;
        return this.nextRound();
      case 'finish':
        if (this.phase === 'ended' && isHost) this.ctx.finish();
        return;
      default:
        return;
    }
    if (!p) return;
    this.ctx.update();
  }

  onJoin() {}

  onLeave(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.players.length < 2) return this.finish();
    if (id === this.parent && !['result', 'ended'].includes(this.phase)) {
      this.ctx.system('親が抜けたので、このラウンドは流して次へ進みます');
      return this.nextRound();
    }
    delete this.hands[id];
    this.askQueue = this.askQueue.filter((x) => x !== id);
    if (this.asker === id && this.phase === 'ask') this.nextAsk();
    this.onConnectionChange();
  }

  onConnectionChange() {
    if (this.phase === 'prepare') this.prepareDone();
    if (this.phase === 'final' && this.children().every((c) => !this.active(c.id) || this.finals[c.id])) this.startRank();
  }

  // ---------- 表示用データ ----------
  view(pid) {
    const isParent = pid === this.parent;
    const me = this.player(pid);
    const showCriterion = isParent || ['result', 'ended'].includes(this.phase);
    const v = {
      phase: this.phase,
      seq: this.seq,
      round: this.roundIndex + 1,
      rounds: this.order.length,
      endsAt: this.endsAt,
      parent: this.parent,
      parentName: this.name(this.parent),
      role: !me ? 'spectator' : isParent ? 'parent' : 'child',
      criterion: showCriterion ? this.criterion : null,
      options: isParent && this.phase === 'prepare' ? this.options : null,
      critRerolls: isParent ? this.critRerolls : null,
      criterionOwn: isParent ? this.criterionOwn : null,
      criterionChosen: !!this.criterion,
      pool: this.phase === 'prepare' ? [] : this.pool().map((x) => ({ id: x.id, w: x.w, owner: x.owner, ownerName: this.name(x.owner) })),
      asks: this.asks,
      asker: this.asker,
      askerName: this.asker ? this.name(this.asker) : null,
      askLeft: this.askQueue.length + (this.phase === 'ask' || this.phase === 'answer' ? 1 : 0),
      pending: this.pending,
      players: this.players.map((p) => ({
        id: p.id,
        name: this.name(p.id),
        score: p.score,
        parent: p.id === this.parent,
        ready:
          this.phase === 'prepare' ? (p.id === this.parent ? !!this.criterion : !!this.ready[p.id])
          : this.phase === 'final' ? p.id !== this.parent && !!this.finals[p.id]
          : null,
      })),
    };
    if (me && !isParent && this.hands[pid]) {
      v.myHand = this.hands[pid];
      v.handSize = HAND;
      v.myFinal = this.finals[pid] || null;
      if (this.phase === 'prepare') {
        v.myCands = this.cands[pid];
        v.myRerolls = this.rerolls[pid];
        v.myReady = !!this.ready[pid];
      }
    }
    if (this.phase === 'rank' && isParent) {
      v.submitted = this.rankOrder.map((id) => ({ id, word: this.finals[id].word, guess: this.finals[id].guess }));
    }
    if (this.phase === 'result' || this.phase === 'ended') {
      const r = this.roundResult;
      if (r) {
        v.result = {
          criterion: r.criterion,
          order: r.order.map((id, i) => ({
            name: this.name(id),
            word: this.finals[id].word,
            guess: this.finals[id].guess,
            verdict: r.verdicts[id],
            points: RANK_POINTS[i] || 0,
            gain: r.gain[id] || 0,
          })),
          parentGain: r.gain[this.parent] || 0,
        };
      }
      v.isLast = this.roundIndex >= this.order.length - 1;
    }
    return v;
  }
}

module.exports = {
  id: 'kijun',
  name: '基準当て',
  tagline: '親の秘密の「基準」を、言葉の比べっこから推理する。',
  description:
    '親は「重い」「魔王が欲しがりそう」などの基準を秘密で選びます(自分で書いても可)。子は用意された候補から選ぶか自分で書いて手札を5枚作り、場の言葉を2つ指名して「どっちが上?」と比べてもらい、その結果から基準を推理。' +
    '最後に基準に一番合うと思う手札を出して、親に順位をつけてもらいます。基準そのものを当てても得点。',
  minPlayers: 3,
  maxPlayers: 8,
  cpu: false,
  settings: [
    { key: 'asks', label: '1人あたりの指名回数', default: 2, options: [1, 2, 3].map((n) => ({ value: n, label: `${n}回` })) },
    { key: 'laps', label: '親の回数', default: 1, options: [1, 2].map((n) => ({ value: n, label: n === 1 ? '全員1回ずつ' : '全員2回ずつ' })) },
  ],
  create: (ctx, settings, playerIds) => new KijunGame(ctx, settings, playerIds),
};
