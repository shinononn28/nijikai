// 被り列挙クイズ
// お題に合う言葉を制限時間内に好きなだけ書く。
// 誰とも被らなかった回答は +1、誰かと被った回答は −1、お題外と判定された回答は 0。
const { pickTopic } = require('./kaburi-topics');

const MAX_ANSWERS = 80;
const MAX_LEN = 24;
const SUBMIT_GRACE_MS = 1500; // 締め切り直前に送られた回答を拾うための猶予
const MAX_PROPOSALS = 60;

// ---------- 表記ゆれの正規化 ----------

function normalize(s) {
  let t = String(s).normalize('NFKC').toLowerCase();
  t = t.replace(/[\s・,、。.!?「」『』()\[\]【】"'`]/g, '');
  t = t.replace(/[‐‑–—―−~〜]/g, 'ー');
  // カタカナ → ひらがな
  t = t.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return t;
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// 機械では断定できない「同じかも?」の組み合わせ
function findHints(groups) {
  const hints = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i].key;
      const b = groups[j].key;
      const contains = a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
      const close = Math.min(a.length, b.length) >= 3 && levenshtein(a, b) <= 1;
      if (contains || close) hints.push([groups[i].id, groups[j].id]);
      if (hints.length >= 30) return hints;
    }
  }
  return hints;
}

function mostCommon(list) {
  const count = new Map();
  for (const x of list) count.set(x, (count.get(x) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- ゲーム本体 ----------

class KaburiGame {
  constructor(ctx, settings, playerIds) {
    this.ctx = ctx;
    this.s = settings;
    this.participants = [...playerIds];
    this.pending = new Set(); // 途中参加者(次のラウンドから)
    this.scores = Object.fromEntries(playerIds.map((id) => [id, 0]));
    this.round = 0;
    this.seq = 0; // 画面の作り直しが必要な変化のたびに増える
    this.timer = null;
    this.used = new Set();
    this.startRound();
  }

  // --- 共通 ---
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
  }
  dispose() {
    clearTimeout(this.timer);
  }
  isParticipant(id) {
    return this.participants.includes(id);
  }
  activeParticipants() {
    return this.participants.filter((id) => this.ctx.isConnected(id));
  }
  allReady() {
    const active = this.activeParticipants();
    return active.length > 0 && active.every((id) => this.ready.has(id));
  }

  // --- 回答フェーズ ---
  startRound() {
    for (const id of this.pending) {
      if (!this.participants.includes(id)) this.participants.push(id);
      this.scores[id] ??= 0;
    }
    this.pending.clear();
    this.round++;
    this.newTopic(false);
  }

  newTopic(isReroll) {
    this.phase = 'answer';
    this.topic = pickTopic(this.s.initialMode, this.used);
    this.used.add(this.topic.text);
    this.answers = {};
    this.ready = new Set();
    const ms = this.s.answerSeconds * 1000;
    this.endsAt = Date.now() + ms;
    this.setTimer(ms + SUBMIT_GRACE_MS, () => this.startJudge());
    this.seq++;
    this.ctx.system(`${isReroll ? 'お題を引き直しました。' : `第${this.round}ラウンド。`}お題は ${this.topic.text}`);
    this.ctx.update();
  }

  setAnswers(pid, list) {
    if (!Array.isArray(list)) return;
    const seen = new Set();
    const out = [];
    for (const a of list.slice(0, MAX_ANSWERS * 2)) {
      if (typeof a !== 'string') continue;
      const raw = a.trim().slice(0, MAX_LEN);
      const key = normalize(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(raw);
      if (out.length >= MAX_ANSWERS) break;
    }
    this.answers[pid] = out;
  }

  // --- 判定フェーズ ---
  startJudge() {
    clearTimeout(this.timer);
    this.phase = 'judge';
    const byKey = new Map();
    let n = 0;
    for (const pid of this.participants) {
      for (const raw of this.answers[pid] || []) {
        const key = normalize(raw);
        let g = byKey.get(key);
        if (!g) {
          g = { id: `g${++n}`, key, entries: [] };
          byKey.set(key, g);
        }
        if (!g.entries.some((e) => e.pid === pid)) g.entries.push({ pid, raw });
      }
    }
    this.groups = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key, 'ja'));
    this.groupIds = new Set(this.groups.map((g) => g.id));
    this.hints = findHints(this.groups);
    this.proposals = [];
    this.propSeq = 0;
    this.ready = new Set();
    this.seq++;

    if (this.groups.length === 0) {
      this.ctx.system('誰も回答しませんでした');
      return this.finishJudge();
    }
    const ms = this.s.judgeSeconds * 1000;
    this.endsAt = Date.now() + ms;
    this.setTimer(ms, () => this.finishJudge());
    this.ctx.system('判定タイム。同じ扱いにしたい回答や、お題に合わない回答があれば提案してください');
    this.ctx.update();
  }

  labelOf(id) {
    const g = this.groups.find((x) => x.id === id);
    return g ? mostCommon(g.entries.map((e) => e.raw)) : '?';
  }

  propose(pid, type, groupIds) {
    if (!['merge', 'invalid'].includes(type) || !Array.isArray(groupIds)) return;
    const ids = [...new Set(groupIds.map(String))].filter((id) => this.groupIds.has(id));
    if ((type === 'merge' && ids.length !== 2) || (type === 'invalid' && ids.length !== 1)) return;
    const sig = `${type}:${[...ids].sort().join(',')}`;
    let p = this.proposals.find((x) => x.sig === sig);
    if (!p) {
      if (this.proposals.length >= MAX_PROPOSALS) return;
      p = { id: `p${++this.propSeq}`, sig, type, groupIds: ids, by: pid, votes: {} };
      this.proposals.push(p);
      this.ready.clear(); // 新しい提案が出たら、全員に見てもらう
      const name = this.ctx.nameOf(pid);
      const text =
        type === 'merge'
          ? `${name}さんの提案: 「${this.labelOf(ids[0])}」と「${this.labelOf(ids[1])}」は同じ扱い?`
          : `${name}さんの提案: 「${this.labelOf(ids[0])}」はお題外?`;
      this.ctx.system(text);
    }
    p.votes[pid] = true;
  }

  tally(p) {
    const v = Object.entries(p.votes).filter(([id]) => this.isParticipant(id));
    const yes = v.filter(([, b]) => b).length;
    return { yes, no: v.length - yes };
  }

  finishJudge() {
    clearTimeout(this.timer);
    const parent = new Map(this.groups.map((g) => [g.id, g.id]));
    const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));

    let merged = 0;
    let invalidated = 0;
    for (const p of this.proposals || []) {
      const { yes, no } = this.tally(p);
      p.approved = yes > no;
      if (p.approved && p.type === 'merge') {
        parent.set(find(p.groupIds[0]), find(p.groupIds[1]));
        merged++;
      }
    }

    const roots = new Map();
    for (const g of this.groups) {
      const r = find(g.id);
      if (!roots.has(r)) roots.set(r, { id: r, raws: [], entries: [], invalid: false });
      const root = roots.get(r);
      for (const e of g.entries) {
        root.raws.push(e.raw);
        if (!root.entries.some((x) => x.pid === e.pid)) root.entries.push(e);
      }
    }
    for (const p of this.proposals || []) {
      if (p.approved && p.type === 'invalid') {
        const root = roots.get(find(p.groupIds[0]));
        if (!root.invalid) invalidated++;
        root.invalid = true;
      }
    }

    const deltas = Object.fromEntries(this.participants.map((id) => [id, 0]));
    const items = [...roots.values()].map((r) => {
      const players = r.entries.map((e) => e.pid);
      const result = r.invalid ? 'invalid' : players.length >= 2 ? 'dup' : 'unique';
      const points = result === 'invalid' ? 0 : result === 'dup' ? -1 : 1;
      for (const id of players) if (id in deltas) deltas[id] += points;
      return {
        id: r.id,
        label: mostCommon(r.raws),
        variants: [...new Set(r.raws)],
        players,
        result,
        points,
      };
    });

    this.phase = 'reveal';
    this.reveal = { items: shuffle(items), index: 0, deltas, applied: false };
    this.seq++;
    if (this.proposals?.length) {
      this.ctx.system(`判定終了。同じ扱い ${merged}件、お題外 ${invalidated}件`);
    }
    if (items.length === 0) this.applyDeltas();
    this.ctx.update();
  }

  // --- 公開フェーズ ---
  applyDeltas() {
    if (this.reveal.applied) return;
    this.reveal.applied = true;
    const parts = [];
    for (const [id, d] of Object.entries(this.reveal.deltas)) {
      if (!(id in this.scores)) continue;
      this.scores[id] += d;
      parts.push(`${this.ctx.nameOf(id)} ${d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0'}`);
    }
    this.ctx.system(`第${this.round}ラウンドの結果: ${parts.join(' / ')}`);
  }

  ranking() {
    return this.participants
      .map((id) => ({ id, name: this.ctx.nameOf(id), score: this.scores[id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    const member = this.isParticipant(pid);
    switch (type) {
      case 'setAnswers':
        if (this.phase !== 'answer' || !member) return;
        this.setAnswers(pid, payload.answers);
        break;
      case 'done':
        if (!['answer', 'judge'].includes(this.phase) || !member) return;
        if (payload.value === false) this.ready.delete(pid);
        else this.ready.add(pid);
        if (this.allReady()) return this.phase === 'answer' ? this.startJudge() : this.finishJudge();
        break;
      case 'reroll':
        if (this.phase !== 'answer' || !isHost) return;
        return this.newTopic(true);
      case 'propose':
        if (this.phase !== 'judge' || !member) return;
        this.propose(pid, payload.type, payload.groupIds);
        break;
      case 'vote': {
        if (this.phase !== 'judge' || !member) return;
        const p = this.proposals.find((x) => x.id === payload.proposalId);
        if (p) p.votes[pid] = !!payload.yes;
        break;
      }
      case 'revealNext':
      case 'revealAll':
        if (this.phase !== 'reveal' || !isHost || this.reveal.applied) return;
        this.reveal.index = type === 'revealAll' ? this.reveal.items.length : this.reveal.index + 1;
        if (this.reveal.index >= this.reveal.items.length) this.applyDeltas();
        break;
      case 'next':
        if (this.phase !== 'reveal' || !isHost || !this.reveal.applied) return;
        if (this.round >= this.s.rounds) {
          this.phase = 'final';
          this.seq++;
          const top = this.ranking()[0];
          if (top) this.ctx.system(`ゲーム終了。優勝は ${top.name}さん(${top.score}点)`);
        } else {
          return this.startRound();
        }
        break;
      case 'finish':
        if (this.phase !== 'final' || !isHost) return;
        return this.ctx.finish();
      default:
        return;
    }
    this.ctx.update();
  }

  onJoin(id) {
    if (!this.isParticipant(id)) this.pending.add(id);
  }

  onLeave(id) {
    this.pending.delete(id);
    this.participants = this.participants.filter((x) => x !== id);
    delete this.scores[id];
    if (this.answers) delete this.answers[id];
    this.onConnectionChange();
  }

  onConnectionChange() {
    if (!['answer', 'judge'].includes(this.phase)) return;
    if (this.ready.size > 0 && this.allReady()) {
      if (this.phase === 'answer') this.startJudge();
      else this.finishJudge();
    }
  }

  // ---------- 表示用データ ----------
  view(pid) {
    const v = {
      phase: this.phase,
      seq: this.seq,
      round: this.round,
      totalRounds: this.s.rounds,
      topic: this.topic.text,
      isParticipant: this.isParticipant(pid),
      isPending: this.pending.has(pid),
      endsAt: ['answer', 'judge'].includes(this.phase) ? this.endsAt : null,
      players: this.participants.map((id) => ({
        id,
        name: this.ctx.nameOf(id),
        score: this.scores[id] ?? 0,
        ready: ['answer', 'judge'].includes(this.phase) ? this.ready.has(id) : false,
        answerCount: this.phase === 'answer' ? (this.answers[id]?.length ?? 0) : null,
        connected: this.ctx.isConnected(id),
      })),
    };

    if (this.phase === 'answer') {
      v.myAnswers = this.answers[pid] || [];
    }

    if (this.phase === 'judge') {
      // 誰が何人書いたかは公開まで伏せる
      v.groups = this.groups.map((g) => ({
        id: g.id,
        label: mostCommon(g.entries.map((e) => e.raw)),
        variants: [...new Set(g.entries.map((e) => e.raw))],
        mine: g.entries.some((e) => e.pid === pid),
      }));
      v.hints = this.hints;
      v.proposals = this.proposals.map((p) => ({
        id: p.id,
        type: p.type,
        groupIds: p.groupIds,
        by: this.ctx.nameOf(p.by),
        ...this.tally(p),
        myVote: p.votes[pid] ?? null,
      }));
    }

    if (this.phase === 'reveal') {
      const r = this.reveal;
      v.reveal = {
        total: r.items.length,
        index: r.index,
        applied: r.applied,
        items: r.items.slice(0, r.index).map((it) => ({
          ...it,
          players: it.players.map((id) => ({ id, name: this.ctx.nameOf(id) })),
          mine: it.players.includes(pid),
        })),
        deltas: r.applied ? r.deltas : null,
      };
      v.isLastRound = this.round >= this.s.rounds;
    }

    if (this.phase === 'final') {
      v.ranking = this.ranking();
    }
    return v;
  }
}

module.exports = {
  id: 'kaburi',
  name: '被り列挙クイズ',
  tagline: 'お題に合う言葉を書きまくる。被らなければ+1、誰かと被ったら−1。',
  description:
    '制限時間内に、お題に合う言葉を好きなだけ書きます。誰とも被らなかった回答は+1点、誰かと被った回答は−1点。' +
    '表記ゆれは自動でまとめ、「それ同じでしょ」「それお題外でしょ」は判定タイムに多数決で決めます。',
  minPlayers: 3,
  maxPlayers: 12,
  cpu: false,
  settings: [
    {
      key: 'rounds',
      label: 'ラウンド数',
      default: 5,
      options: [3, 5, 7].map((n) => ({ value: n, label: `${n}ラウンド` })),
    },
    {
      key: 'answerSeconds',
      label: '回答時間',
      default: 90,
      options: [60, 90, 120, 180].map((n) => ({ value: n, label: `${n}秒` })),
    },
    {
      key: 'judgeSeconds',
      label: '判定時間',
      default: 60,
      options: [45, 60, 90, 120].map((n) => ({ value: n, label: `${n}秒` })),
    },
    {
      key: 'initialMode',
      label: '頭文字縛り',
      default: 'mix',
      options: [
        { value: 'off', label: 'なし' },
        { value: 'mix', label: 'ときどき' },
        { value: 'on', label: '毎回' },
      ],
    },
  ],
  create: (ctx, settings, playerIds) => new KaburiGame(ctx, settings, playerIds),
  _internal: { normalize, findHints },
};
