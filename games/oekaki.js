// お絵描き当て
// 出題者が3つの候補からお題を選んで描き、ほかの人はチャットに答えを書く。
// 正解はチャットから自動判定し、正解の言葉は伏せて「正解!」に置き換える。早く当てた人ほど高得点、当てられた出題者にも得点。
const { NOUNS } = require('./words');

const CHOOSE_MS = 15000;
const REVEAL_MS = 6000;

function normalize(s) {
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・,、。.!?「」『』()\[\]【】"'`~〜ー-]/g, '')
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
function lev(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[b.length];
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class OekakiGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.players = humanIds.map((id) => ({ id, score: 0 }));
    this.order = [];
    for (let l = 0; l < settings.laps; l++) this.order.push(...shuffle(humanIds));
    this.turnIndex = -1;
    this.deck = shuffle(NOUNS);
    this.seq = 0;
    this.gallery = [];
    this.ctx.system(`お絵描き当て。全${this.order.length}回、全員が${settings.laps === 1 ? '1回ずつ' : `${settings.laps}回ずつ`}描きます。答えはチャットに書いてください`);
    this.nextTurn();
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
  p(id) {
    return this.players.find((x) => x.id === id);
  }
  guessers() {
    return this.players.filter((p) => p.id !== this.drawer);
  }
  broadcast(type, data) {
    for (const p of this.players) this.ctx.emitTo(p.id, type, data);
  }

  // ---------- 手番 ----------
  nextTurn() {
    this.clearTimers();
    this.turnIndex++;
    while (this.turnIndex < this.order.length && !this.p(this.order[this.turnIndex])) this.turnIndex++;
    if (this.turnIndex >= this.order.length) return this.finish();
    this.drawer = this.order[this.turnIndex];
    if (this.deck.length < 3) this.deck = shuffle(NOUNS);
    this.choices = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
    this.word = null;
    this.strokes = [];
    this.correct = []; // 正解した順
    this.phase = 'choose';
    this.endsAt = Date.now() + CHOOSE_MS;
    this.seq++;
    this.later(CHOOSE_MS, () => this.choose(this.drawer, this.choices[0]));
    this.broadcast('clear', {});
    this.ctx.update();
  }

  choose(pid, word) {
    if (this.phase !== 'choose' || pid !== this.drawer || !this.choices.includes(word)) return;
    this.clearTimers();
    this.word = word;
    this.key = normalize(word);
    this.phase = 'draw';
    const ms = this.s.drawSeconds * 1000;
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + ms;
    this.seq++;
    this.later(ms, () => this.endTurn());
    // ヒントが出るタイミングで画面を更新する
    for (const f of [0.25, 0.5, 0.75]) this.later(ms * f + 50, () => this.ctx.update());
    this.ctx.system(`${this.name(pid)}さんが描いています。答えはチャットへ`);
    this.ctx.update();
  }

  // ヒント:時間の半分で文字数と1文字目、4分の3で2文字目まで
  hint() {
    if (this.phase !== 'draw') return null;
    const chars = [...this.word];
    const passed = (Date.now() - this.startedAt) / (this.endsAt - this.startedAt);
    const shown = passed >= 0.75 ? 2 : passed >= 0.5 ? 1 : 0;
    if (passed < 0.25) return null;
    return chars.map((c, i) => (i < shown ? c : '_')).join(' ');
  }

  endTurn() {
    if (this.phase !== 'draw') return;
    this.clearTimers();
    this.phase = 'reveal';
    this.seq++;
    this.gallery.push({ word: this.word, drawer: this.drawer, strokes: this.strokes, correct: this.correct.length });
    this.ctx.system(`答えは「${this.word}」でした(${this.correct.length}人が正解)`);
    this.later(REVEAL_MS, () => this.nextTurn());
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

  // ---------- 絵 ----------
  // 線は細切れで届くので、そのまま全員に流し、記録にも残す(途中から入った人・再接続の人に再生するため)
  draw(pid, payload) {
    if (this.phase !== 'draw' || pid !== this.drawer) return;
    const id = String(payload.id || '').slice(0, 20);
    const pts = Array.isArray(payload.pts) ? payload.pts.slice(0, 400).map(([x, y]) => [Math.max(0, Math.min(1, +x || 0)), Math.max(0, Math.min(1, +y || 0))]) : [];
    if (!id || !pts.length || this.strokes.length > 3000) return;
    let s = this.strokes.find((x) => x.id === id);
    if (!s) {
      s = { id, color: /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : '#15211d', size: Math.max(1, Math.min(40, +payload.size || 4)), pts: [] };
      this.strokes.push(s);
    }
    s.pts.push(...pts);
    for (const p of this.players) if (p.id !== pid) this.ctx.emitTo(p.id, 'stroke', { id, color: s.color, size: s.size, pts });
  }

  // ---------- 回答(チャット) ----------
  filterChat(pid, text) {
    if (this.phase !== 'draw' || !this.word) return text;
    const k = normalize(text);
    // 出題者は答えを書けない
    if (pid === this.drawer) return k.includes(this.key) ? text.replace(new RegExp(this.word, 'g'), '●●') : text;
    if (this.correct.includes(pid)) return k.includes(this.key) ? '(答えは伏せました)' : text;
    if (k === this.key || (this.key.length >= 3 && k.includes(this.key))) {
      this.onCorrect(pid);
      return '🎉 正解!';
    }
    if (k.length >= 2 && (lev(k, this.key) <= 1 || (k.length >= 2 && this.key.includes(k) && k.length >= this.key.length - 2))) {
      this.ctx.post({ type: 'system', text: `「${text}」はおしい!` }, [pid]);
    }
    return text;
  }

  onCorrect(pid) {
    const p = this.p(pid);
    if (!p || this.correct.includes(pid)) return;
    this.correct.push(pid);
    const left = Math.max(0, (this.endsAt - Date.now()) / (this.endsAt - this.startedAt));
    const pts = 5 + Math.ceil(left * 10) + (this.correct.length === 1 ? 3 : 0);
    p.score += pts;
    const d = this.p(this.drawer);
    if (d) d.score += 4;
    this.lastGain = { pid, pts };
    if (this.guessers().every((g) => this.correct.includes(g.id) || !this.ctx.isConnected(g.id))) this.later(800, () => this.endTurn());
    setTimeout(() => this.ctx.update(), 0);
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    switch (type) {
      case 'choose':
        this.choose(pid, String(payload.word));
        return;
      case 'stroke':
        this.draw(pid, payload);
        return; // 線ごとに全員の画面を作り直さない
      case 'undo':
        if (this.phase !== 'draw' || pid !== this.drawer) return;
        this.strokes.pop();
        this.broadcast('redraw', { strokes: this.strokes });
        return;
      case 'clear':
        if (this.phase !== 'draw' || pid !== this.drawer) return;
        this.strokes = [];
        this.broadcast('redraw', { strokes: [] });
        return;
      case 'skip':
        if (this.phase === 'draw' && (pid === this.drawer || isHost)) this.endTurn();
        return;
      case 'finish':
        if (this.phase === 'ended' && isHost) this.ctx.finish();
        return;
      default:
    }
  }

  backlog() {
    return this.strokes?.length ? [{ type: 'redraw', data: { strokes: this.strokes } }] : [];
  }

  onJoin(id) {
    if (!this.p(id) && this.phase !== 'ended') {
      this.players.push({ id, score: 0 });
      this.order.push(id); // 途中参加の人も最後に1回描く
    }
  }

  onLeave(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.players.length < 2) return this.finish();
    if (id === this.drawer && ['choose', 'draw'].includes(this.phase)) {
      this.ctx.system('出題者が抜けたので次へ進みます');
      this.nextTurn();
    }
  }

  onConnectionChange() {}

  view(pid) {
    const isDrawer = pid === this.drawer;
    const showWord = isDrawer || ['reveal', 'ended'].includes(this.phase) || this.correct?.includes(pid);
    return {
      phase: this.phase,
      seq: this.seq,
      turn: this.turnIndex + 1,
      turns: this.order.length,
      endsAt: ['choose', 'draw'].includes(this.phase) ? this.endsAt : null,
      drawer: this.drawer,
      drawerName: this.drawer ? this.name(this.drawer) : '',
      choices: isDrawer && this.phase === 'choose' ? this.choices : null,
      word: showWord ? this.word : null,
      length: this.word ? [...this.word].length : null,
      hint: this.hint(),
      correct: (this.correct || []).map((id) => this.name(id)),
      iGuessed: this.correct?.includes(pid) || false,
      players: [...this.players].sort((a, b) => b.score - a.score).map((p) => ({ id: p.id, name: this.name(p.id), score: p.score, drawer: p.id === this.drawer, correct: this.correct?.includes(p.id) })),
      gallery: this.phase === 'ended' ? this.gallery.map((g) => ({ word: g.word, drawer: this.name(g.drawer), strokes: g.strokes, correct: g.correct })) : null,
    };
  }
}

module.exports = {
  id: 'oekaki',
  name: 'お絵描き当て',
  tagline: '描いて、当てて。答えはチャットに書くと自動で判定。',
  description:
    '出題者が3つの候補からお題を選んで描き、ほかの人はチャットに答えを書きます。正解は自動判定され、答えの言葉は伏せられます。' +
    '早く当てるほど高得点、当てられた出題者にも得点。時間が経つと文字数と頭の文字がヒントで出ます。',
  minPlayers: 2,
  maxPlayers: 12,
  cpu: false,
  settings: [
    { key: 'drawSeconds', label: '描く時間', default: 80, options: [60, 80, 100].map((n) => ({ value: n, label: `${n}秒` })) },
    { key: 'laps', label: '描く回数', default: 1, options: [1, 2].map((n) => ({ value: n, label: n === 1 ? '全員1回ずつ' : '全員2回ずつ' })) },
  ],
  create: (ctx, settings, playerIds) => new OekakiGame(ctx, settings, playerIds),
};
