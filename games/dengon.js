// 伝言お絵描き(全員同時に回るガーティックフォン方式)
// 1. 全員がお題の文を書く
// 2. 隣から回ってきた文を絵にする → 次の人はその絵を文にする → … を人数分くり返す(全員同時)
// 3. 最後に1本ずつ、元の文からどう変わっていったかを順番に公開する。気に入った作品には「いいね」
const { NOUNS } = require('./words');

const GRACE_MS = 2500; // 締め切り直前の自動提出を待つ
const ACTIONS = [
  'が空を飛んでいる', 'が泣いている', 'がパーティーをしている', 'が怒っている', 'が寝ている', 'が走っている', 'が踊っている',
  'が料理をしている', 'がお風呂に入っている', 'が迷子になっている', 'が恋をしている', 'がダンジョンに挑んでいる', 'が宇宙に行く',
  'が巨大化した', 'が分身した', 'が王様になった', 'が雨に打たれている', 'が満員電車に乗っている', 'がカラオケで熱唱している',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function cleanStrokes(list) {
  if (!Array.isArray(list)) return [];
  let total = 0;
  const out = [];
  for (const s of list.slice(0, 400)) {
    const pts = Array.isArray(s?.pts) ? s.pts.slice(0, 600).map(([x, y]) => [Math.max(0, Math.min(1, +x || 0)), Math.max(0, Math.min(1, +y || 0))]) : [];
    if (!pts.length) continue;
    total += pts.length;
    if (total > 12000) break;
    out.push({ color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#15211d', size: Math.max(1, Math.min(40, +s.size || 4)), pts });
  }
  return out;
}

class DengonGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.order = shuffle(humanIds);
    this.N = this.order.length;
    this.chains = this.order.map((owner) => ({ owner, entries: [] }));
    this.round = 0;
    this.likes = {}; // "chain-step" → Set(pid)
    this.seq = 0;
    this.ctx.system(`伝言お絵描き。${this.N}人なので、1つのお題が文→絵→文…と${this.N}回形を変えます`);
    this.startRound();
  }

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

  // そのラウンドの作業の種類:0=最初の文、奇数=絵、偶数=文
  kind(r = this.round) {
    return r === 0 ? 'write' : r % 2 === 1 ? 'draw' : 'describe';
  }
  // ラウンドrで、i番目の人が担当するのは (i - r) 番目の人が始めた伝言
  chainFor(pid, r = this.round) {
    const i = this.order.indexOf(pid);
    return (((i - r) % this.N) + this.N) % this.N;
  }

  startRound() {
    this.clearTimers();
    this.phase = 'play';
    this.subs = {};
    const k = this.kind();
    const sec = k === 'draw' ? this.s.drawSeconds : k === 'write' ? 60 : this.s.textSeconds;
    this.endsAt = Date.now() + sec * 1000;
    this.suggest = {};
    if (k === 'write') for (const id of this.order) this.suggest[id] = [0, 1, 2].map(() => `${pick(NOUNS)}${pick(ACTIONS)}`);
    this.seq++;
    this.later(sec * 1000 + GRACE_MS, () => this.closeRound());
    this.ctx.update();
  }

  submit(pid, payload) {
    if (this.phase !== 'play' || !this.order.includes(pid)) return;
    const k = this.kind();
    if (k === 'draw') this.subs[pid] = { type: 'draw', strokes: cleanStrokes(payload.strokes) };
    else {
      const text = clean(payload.text, 60);
      if (!text && !payload.auto) return;
      this.subs[pid] = { type: 'text', text };
    }
    if (payload.auto) return; // 時間切れの自動提出は、締め切りを待つ
    if (this.order.every((id) => this.subs[id] || !this.ctx.isConnected(id))) this.closeRound();
  }

  closeRound() {
    if (this.phase !== 'play') return;
    const k = this.kind();
    for (const id of this.order) {
      const c = this.chains[this.chainFor(id)];
      const sub = this.subs[id] || (k === 'draw' ? { type: 'draw', strokes: [] } : { type: 'text', text: '' });
      if (k === 'write' && !sub.text) sub.text = this.suggest[id]?.[0] || '何か';
      c.entries.push({ ...sub, by: id });
    }
    this.round++;
    if (this.round >= this.N) return this.startReveal();
    this.startRound();
  }

  // ---------- 公開 ----------
  startReveal() {
    this.clearTimers();
    this.phase = 'reveal';
    this.revealChain = 0;
    this.revealStep = 0;
    this.seq++;
    this.ctx.system('結果発表!1本ずつ、元のお題からどう変わったかを見ていきます');
    this.ctx.update();
  }

  advance(isHost) {
    if (this.phase !== 'reveal' || !isHost) return;
    const c = this.chains[this.revealChain];
    if (this.revealStep < c.entries.length - 1) this.revealStep++;
    else if (this.revealChain < this.chains.length - 1) {
      this.revealChain++;
      this.revealStep = 0;
    } else {
      this.phase = 'ended';
      this.seq++;
      this.ctx.system('全部の伝言を見終わりました');
    }
  }

  like(pid, ci, si) {
    if (!['reveal', 'ended'].includes(this.phase) || !this.order.includes(pid)) return;
    const c = this.chains[ci];
    if (!c || !c.entries[si] || c.entries[si].by === pid) return;
    if (this.phase === 'reveal' && (ci > this.revealChain || (ci === this.revealChain && si > this.revealStep))) return;
    const k = `${ci}-${si}`;
    const set = (this.likes[k] ||= new Set());
    if (set.has(pid)) set.delete(pid);
    else set.add(pid);
  }

  action(pid, type, payload, { isHost }) {
    switch (type) {
      case 'submit':
        this.submit(pid, payload);
        break;
      case 'unsubmit':
        if (this.phase === 'play') delete this.subs[pid];
        break;
      case 'next':
        this.advance(isHost);
        break;
      case 'like':
        this.like(pid, Number(payload.chain), Number(payload.step));
        break;
      case 'finish':
        if (isHost && ['reveal', 'ended'].includes(this.phase)) return this.ctx.finish();
        return;
      default:
        return;
    }
    this.ctx.update();
  }

  onJoin() {}

  onLeave(id) {
    // 抜けた人の担当は、空欄のまま回す(順番は変えない)
    if (this.phase === 'play' && this.order.every((x) => this.subs[x] || !this.ctx.isConnected(x) || x === id)) this.closeRound();
  }

  onConnectionChange() {
    if (this.phase === 'play' && this.order.every((id) => this.subs[id] || !this.ctx.isConnected(id))) this.closeRound();
  }

  // ---------- 表示用データ ----------
  entryView(e, ci, si, pid) {
    const set = this.likes[`${ci}-${si}`];
    return { ...e, byName: this.name(e.by), likes: set ? set.size : 0, liked: !!set?.has(pid) };
  }

  view(pid) {
    const v = {
      phase: this.phase,
      seq: this.seq,
      round: this.round,
      rounds: this.N,
      kind: this.phase === 'play' ? this.kind() : null,
      endsAt: this.phase === 'play' ? this.endsAt : null,
      players: this.order.map((id) => ({ id, name: this.name(id), done: this.phase === 'play' ? !!this.subs[id] : null })),
      participant: this.order.includes(pid),
    };
    if (this.phase === 'play' && this.order.includes(pid)) {
      const k = this.kind();
      const c = this.chains[this.chainFor(pid)];
      const prev = c.entries[c.entries.length - 1] || null;
      v.task = { kind: k, prev: prev ? (prev.type === 'text' ? { type: 'text', text: prev.text || '(白紙)' } : { type: 'draw', strokes: prev.strokes }) : null };
      v.suggest = k === 'write' ? this.suggest[pid] : null;
      v.submitted = !!this.subs[pid];
    }
    if (this.phase === 'reveal' || this.phase === 'ended') {
      const upto = this.phase === 'ended' ? this.chains.length - 1 : this.revealChain;
      v.reveal = {
        chain: this.phase === 'ended' ? null : this.revealChain,
        step: this.phase === 'ended' ? null : this.revealStep,
        chains: this.chains.slice(0, upto + 1).map((c, ci) => ({
          owner: this.name(c.owner),
          entries: c.entries
            .slice(0, this.phase === 'ended' || ci < this.revealChain ? c.entries.length : this.revealStep + 1)
            .map((e, si) => this.entryView(e, ci, si, pid)),
          total: c.entries.length,
        })),
        total: this.chains.length,
      };
      if (this.phase === 'ended') {
        let best = null;
        this.chains.forEach((c, ci) => c.entries.forEach((e, si) => {
          const n = this.likes[`${ci}-${si}`]?.size || 0;
          if (n && (!best || n > best.n)) best = { n, ci, si, by: this.name(e.by), type: e.type };
        }));
        v.best = best;
      }
    }
    return v;
  }
}

module.exports = {
  id: 'dengon',
  name: '伝言お絵描き',
  tagline: '文→絵→文…と全員同時に伝言。最後にどう化けたかを見て笑う。',
  description:
    '全員がお題の文を書き、隣から回ってきた文を絵に、その絵を次の人が文に…と全員同時にくり返します。' +
    '最後に1本ずつ、元のお題からどう変わっていったかを順番に公開。お題が思いつかなければ候補から選べます。',
  minPlayers: 3,
  maxPlayers: 12,
  cpu: false,
  settings: [
    { key: 'drawSeconds', label: '絵を描く時間', default: 75, options: [60, 75, 90, 120].map((n) => ({ value: n, label: `${n}秒` })) },
    { key: 'textSeconds', label: '文を書く時間', default: 40, options: [30, 40, 60].map((n) => ({ value: n, label: `${n}秒` })) },
  ],
  create: (ctx, settings, playerIds) => new DengonGame(ctx, settings, playerIds),
};
