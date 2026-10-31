// 名付けカード
// 順番に山札から1枚ずつ場に出す。初めて出た絵なら、出した人が名前をつける。
// 前に出た絵なら早押し。回答権ボタンを一番早く押した人が名前を書いて答える(設定で名前のボタンから選ぶ方式も)。
// 正解した人は場のカードをすべてもらい、その枚数が得点になる。山札がなくなったら終わり。
//
// - 絵柄と山札づくりは public/games/cards.js(合計枚数は人数で変わり、ロビーで変更可。各絵柄は2枚〜でランダム)
// - 判定は名前の完全一致(ひらがな/カタカナ・全角/半角・記号の違いは無視)。
//   設定で「一致しなければみんなで判定」にすると、回答者以外の多数決(ホストは即決も可)で正解にできる。
// - 押した順は games/buzz.js の FirstPress で、届いた順ではなく押した時刻の順に決める。

const Cards = require('../public/games/cards.js');
const { FirstPress, displayLead } = require('./buzz');

const NAME_MS = 45000; // 名前をつける時間
const FLIP_MS = 20000; // めくらないときは自動でめくる
const AWAY_FLIP_MS = 2500; // 手番の人がいないときは早めにめくる
const JUDGE_MS = 15000;
const TYPE_MS = 20000; // 回答権を取ってから書く時間
const RESULT_MS = 3500;
const MISS_MS = 2500;
const MIN_RESUME_MS = 5000; // 誤答のあと、残り時間がこれより短ければここまで延ばす
const MAX_NAME = 16;

function normalize(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・,、。.!?!?「」『』()()\[\]【】"'`]/g, '')
    .replace(/[‐‑–—―−~〜]/g, 'ー')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 名前の候補(すぐ決めたい人向け)。音を組み合わせて作る
const SYL_A = ['ぽ', 'も', 'ぷ', 'に', 'ぎょ', 'ぴ', 'ど', 'ぺ', 'む', 'ぼ', 'ちゅ', 'ふ', 'ば', 'じゅ', 'ろ', 'ぬ', 'ぐ', 'ぺろ', 'もち', 'ぽこ'];
const SYL_B = ['ん', 'る', 'りん', 'たん', 'ろん', 'ぴー', 'ちょ', 'もん', 'すけ', 'べえ', 'ぽ', 'にゃ', 'ごろう', 'まる', 'っぴ', 'ぼー'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function silly() {
  const a = pick(SYL_A);
  const r = Math.random();
  const s = r < 0.3 ? a + a : r < 0.55 ? a + pick(SYL_B) : a + pick(SYL_A) + pick(SYL_B);
  return Math.random() < 0.5 ? s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)) : s;
}

class NazukeGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.left = new Set();
    this.players = humanIds.map((id) => ({ id, score: 0, taken: 0, correct: 0, named: 0 }));
    const deck = Cards.deckFromSettings(settings, humanIds.length);
    this.deck = deck.cards;
    this.deckTotal = deck.cards.length;
    this.kinds = deck.kinds;
    this.names = new Map(); // cardId → { name, by, at }
    this.field = [];
    this.fieldPts = []; // 場の各カードの点数(後半ほど高い)
    this.turn = -1;
    this.seq = 0;
    this.card = null; // { id, showAt, by }
    this.first = new FirstPress({ rtt: (id) => this.ctx.rtt(id), onDecide: (d) => this.decided(d) });
    this.answers = new Map(); // 決まるまでの各人の答え
    this.locked = new Set(); // このカードで誤答した人
    this.passed = new Set();
    this.judge = null;
    this.result = null;
    this.ctx.system(
      `名付けカード。山札${this.deckTotal}枚(${this.kinds}種類)。初めて出た絵には出した人が名前をつけ、前に出た絵ならみんなで名前を答える。正解した人が場のカードを全部もらえます`,
    );
    this.nextTurn();
  }

  // ---------- 小道具 ----------
  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, Math.max(0, ms));
    this.timers.add(t);
    return t;
  }
  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  dispose() {
    this.clearTimers();
    this.first.reset();
  }
  p(id) {
    return this.players.find((x) => x.id === id);
  }
  on(id) {
    return !this.left.has(id) && this.ctx.isConnected(id);
  }
  name(id) {
    return this.ctx.nameOf(id);
  }
  setPhase(phase, ms = null) {
    this.phase = phase;
    this.endsAt = ms ? Date.now() + ms : null;
    this.seq++;
  }
  turnId() {
    return this.players[this.turn]?.id ?? null;
  }
  // 山札の残りで倍率が上がる:半分を切ったら2倍、残り1/4を切ったら4倍(no 枚目をめくった直後の残りで決める)
  stage(no) {
    const left = this.deckTotal - no;
    if (left < this.deckTotal / 4) return 4;
    if (left < this.deckTotal / 2) return 2;
    return 1;
  }
  // 正解したときの倍率(scaling: 'mult' のとき)
  mult() {
    return this.s.scaling === 'mult' && this.card ? this.stage(this.card.no) : 1;
  }
  fieldValue() {
    return this.fieldPts.reduce((a, b) => a + b, 0) * this.mult();
  }
  answerMs() {
    return (Number(this.s.answerSec) || 15) * 1000;
  }
  // まだ答えられる人(接続中で、このカードで誤答もパスもしていない)
  eligible() {
    return this.players.filter((p) => this.on(p.id) && !this.locked.has(p.id) && !this.passed.has(p.id)).map((p) => p.id);
  }

  // ---------- 進行 ----------
  nextTurn() {
    this.clearTimers();
    this.first.reset();
    this.card = null;
    this.judge = null;
    this.result = null;
    if (!this.deck.length) return this.finish();
    // 次の手番(接続中の人を優先。全員いなければそのまま次の人)
    const n = this.players.length;
    let next = (this.turn + 1) % n;
    for (let i = 0; i < n; i++) {
      const id = this.players[(this.turn + 1 + i) % n].id;
      if (this.on(id)) { next = (this.turn + 1 + i) % n; break; }
    }
    this.turn = next;
    const away = !this.on(this.turnId());
    this.setPhase('flip', away ? AWAY_FLIP_MS : FLIP_MS);
    this.later(away ? AWAY_FLIP_MS : FLIP_MS, () => this.flip(true));
    this.ctx.update();
  }

  flip(auto = false) {
    if (this.phase !== 'flip' || !this.deck.length) return;
    this.clearTimers();
    const id = this.deck.shift();
    const lead = displayLead(this.players.filter((p) => this.on(p.id)).map((p) => this.ctx.rtt(p.id)));
    const showAt = Date.now() + lead;
    this.card = { id, showAt, by: this.turnId(), no: this.deckTotal - this.deck.length };
    this.field.push(id);
    this.fieldPts.push(this.s.scaling === 'card' ? this.stage(this.card.no) : 1);
    this.locked = new Set();
    this.passed = new Set();
    this.answers = new Map();
    if (auto && this.on(this.turnId())) this.ctx.system(`時間切れなので${this.name(this.turnId())}さんのカードを自動でめくりました`);
    if (this.names.has(id)) {
      this.setPhase('answer', lead + this.answerMs());
      this.later(lead + this.answerMs(), () => this.timeUp());
    } else {
      this.suggestions = [silly(), silly(), silly()];
      const away = !this.on(this.turnId());
      this.setPhase('name', lead + (away ? AWAY_FLIP_MS : NAME_MS));
      this.later(lead + (away ? AWAY_FLIP_MS : NAME_MS), () => this.autoName());
    }
    this.ctx.update();
  }

  // ---------- 名付け ----------
  nameTaken(name) {
    const key = normalize(name);
    for (const v of this.names.values()) if (normalize(v.name) === key) return true;
    return false;
  }
  giveName(raw, auto = false) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!name || !normalize(name)) return { ok: false, error: '名前を入れてください' };
    if (this.nameTaken(name)) return { ok: false, error: 'その名前はもう使われています。別の名前にしてください' };
    const by = this.card.by;
    this.names.set(this.card.id, { name, by, at: this.card.no, auto });
    const p = this.p(by);
    if (p && !auto) p.named++;
    this.ctx.system(auto ? `時間切れのため、自動で「${name}」と名付けました` : `${this.name(by)}さんが「${name}」と名付けました`);
    this.clearTimers();
    this.result = { kind: 'named', name, by, cardId: this.card.id };
    // 名前と絵を覚える時間(設定で変えられる)
    const memo = (Number(this.s.memorySec) || 3) * 1000;
    this.setPhase('named', memo);
    this.later(memo, () => this.nextTurn());
    this.ctx.update();
    return { ok: true };
  }
  autoName() {
    if (this.phase !== 'name') return;
    let n = silly();
    for (let i = 0; i < 20 && this.nameTaken(n); i++) n = silly();
    if (this.nameTaken(n)) n = `${n}${this.names.size + 1}`;
    this.giveName(n, true);
  }

  // ---------- 回答 ----------
  answer(pid, payload) {
    if (this.s.answerMode === 'buzz' || this.phase !== 'answer' || this.first.has(pid)) return;
    if (!this.eligible().includes(pid)) return;
    if (Date.now() < this.card.showAt - 50) return; // まだ表示されていない
    const text = String(payload?.text ?? '').trim().slice(0, 40);
    if (!text) return;
    this.answers.set(pid, text);
    this.first.press(pid, payload?.pressAt, { others: this.eligible(), notBefore: this.card.showAt });
    this.ctx.update();
  }

  // 回答権ボタン(選択肢なしで書いて答えるモード)
  buzz(pid, payload) {
    if (this.s.answerMode !== 'buzz' || this.phase !== 'answer' || this.first.has(pid)) return;
    if (!this.eligible().includes(pid)) return;
    if (Date.now() < this.card.showAt - 50) return;
    this.first.press(pid, payload?.pressAt, { others: this.eligible(), notBefore: this.card.showAt });
    this.ctx.update();
  }

  decided({ winner }) {
    if (this.phase !== 'answer') return;
    if (this.s.answerMode === 'buzz') return this.startTyping(winner);
    const text = this.answers.get(winner);
    this.answers = new Map();
    this.judgeText(winner, text);
  }

  startTyping(pid) {
    this.clearTimers();
    this.remainMs = Math.max(MIN_RESUME_MS, (this.endsAt || Date.now()) - Date.now());
    this.typer = pid;
    this.setPhase('typing', TYPE_MS);
    this.later(TYPE_MS, () => this.typeTimeUp());
    this.ctx.update();
  }
  typed(pid, payload) {
    if (this.phase !== 'typing' || pid !== this.typer) return;
    const text = String(payload?.text ?? '').trim().slice(0, 40);
    if (!text) return;
    this.typer = null;
    this.judgeText(pid, text);
  }
  typeTimeUp() {
    if (this.phase !== 'typing') return;
    const pid = this.typer;
    this.typer = null;
    this.wrong(pid, '(時間切れ)', this.remainMs);
  }

  judgeText(pid, text) {
    const correct = this.names.get(this.card.id).name;
    if (normalize(text) === normalize(correct)) return this.correct(pid, text, 'auto');
    if (this.s.judge === 'human') return this.startJudge(pid, text);
    this.wrong(pid, text, this.phase === 'answer' ? null : this.remainMs);
  }

  startJudge(answerer, text) {
    this.clearTimers();
    if (this.phase === 'answer') this.remainMs = Math.max(MIN_RESUME_MS, (this.endsAt || Date.now()) - Date.now());
    this.judge = { answerer, text, votes: new Map() };
    this.setPhase('judge', JUDGE_MS);
    this.later(JUDGE_MS, () => this.closeJudge(true));
    this.ctx.system(`${this.name(answerer)}さんの答え「${text}」は名前と一致しません。みんなで判定してください`);
    this.ctx.update();
  }
  voters() {
    return this.players.filter((p) => this.on(p.id) && p.id !== this.judge?.answerer).map((p) => p.id);
  }
  vote(pid, ok, isHost) {
    if (this.phase !== 'judge' || !this.judge) return;
    // ホストは即決できる(回答者本人がホストのときは、ほかの人の票で決める)
    if (isHost && pid !== this.judge.answerer && this.s.judgeBy === 'host') return this.endJudge(!!ok, 'host');
    if (!this.voters().includes(pid)) return;
    this.judge.votes.set(pid, !!ok);
    this.closeJudge(false);
    this.ctx.update();
  }
  closeJudge(timeUp) {
    if (this.phase !== 'judge') return;
    const voters = this.voters();
    const votes = [...this.judge.votes.entries()].filter(([id]) => voters.includes(id));
    const yes = votes.filter(([, v]) => v).length;
    const no = votes.length - yes;
    const need = Math.floor(voters.length / 2) + 1; // 過半数
    if (yes >= need) return this.endJudge(true, 'vote');
    if (no >= voters.length - need + 1 || !voters.length) return this.endJudge(false, 'vote'); // もう過半数に届かない
    if (timeUp || votes.length >= voters.length) return this.endJudge(yes > no, 'vote');
  }
  endJudge(ok, how) {
    const { answerer, text } = this.judge;
    this.judge = null;
    if (ok) return this.correct(answerer, text, how);
    this.wrong(answerer, text, this.remainMs);
  }

  correct(pid, text, how) {
    this.clearTimers();
    this.first.reset();
    const p = this.p(pid);
    const gain = this.fieldValue();
    const taken = this.field.length;
    const correctName = this.names.get(this.card.id).name;
    if (p) {
      p.score += gain;
      p.taken += taken;
      p.correct++;
    }
    this.result = { kind: 'correct', who: pid, text, name: correctName, gain, taken, mult: this.mult(), how, cardId: this.card.id, cards: [...this.field] };
    this.field = [];
    this.fieldPts = [];
    const by = how === 'host' ? '(ホスト判定)' : how === 'vote' ? '(みんなの判定)' : '';
    this.ctx.system(`${this.name(pid)}さんが「${correctName}」で正解${by}!場の${taken}枚を獲得(+${gain}点)`);
    this.setPhase('result', RESULT_MS);
    this.later(RESULT_MS, () => this.nextTurn());
    this.ctx.update();
  }

  wrong(pid, text, remainMs = null) {
    this.locked.add(pid);
    this.lastWrong = { who: pid, text };
    this.ctx.system(`${this.name(pid)}さんの「${text}」は不正解`);
    if (!this.eligible().length) return this.miss();
    const left = remainMs ?? Math.max(MIN_RESUME_MS, (this.endsAt || Date.now()) - Date.now());
    this.clearTimers();
    this.setPhase('answer', left);
    this.later(left, () => this.timeUp());
    this.ctx.update();
  }

  pass(pid) {
    if (this.phase !== 'answer' || !this.eligible().includes(pid) || this.first.has(pid)) return;
    this.passed.add(pid);
    if (!this.eligible().length && !this.first.pending.length) return this.miss();
    this.ctx.update();
  }

  timeUp() {
    if (this.phase !== 'answer') return;
    if (this.first.decide()) return; // 締め切り直前に押した人がいれば、その人で決める
    this.miss();
  }

  miss() {
    this.clearTimers();
    this.first.reset();
    const correctName = this.names.get(this.card.id).name;
    this.result = { kind: 'miss', name: this.s.revealOnMiss === 'show' ? correctName : null, cardId: this.card.id, field: this.field.length };
    this.ctx.system(`誰も答えられませんでした(場に${this.field.length}枚)`);
    this.setPhase('miss', MISS_MS);
    this.later(MISS_MS, () => this.nextTurn());
    this.ctx.update();
  }

  finish() {
    this.clearTimers();
    this.first.reset();
    this.card = null;
    this.setPhase('ended');
    const ranked = [...this.players].sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const ties = ranked.filter((p) => p.score === top.score);
    const rest = this.field.length ? `。場に残った${this.field.length}枚は誰のものにもなりません` : '';
    this.ctx.system(`ゲーム終了。${ties.length > 1 ? `${ties.map((p) => `${this.name(p.id)}さん`).join('・')}が同点で優勝` : `優勝は${this.name(top.id)}さん`}(${top.score}点)${rest}`);
    this.ctx.update();
  }

  // ---------- 操作 ----------
  action(pid, type, payload, { isHost }) {
    if (!this.p(pid)) return;
    if (type === 'flip') {
      if (this.phase === 'flip' && (pid === this.turnId() || (isHost && !this.on(this.turnId())))) this.flip();
      return;
    }
    if (type === 'name') {
      if (this.phase !== 'name') return;
      if (pid !== this.card.by && !(isHost && !this.on(this.card.by))) return;
      const res = this.giveName(payload?.name);
      if (!res.ok) this.ctx.emitTo(pid, 'nameError', { error: res.error });
      return;
    }
    if (type === 'buzz') return this.buzz(pid, payload);
    if (type === 'answer') return this.phase === 'typing' ? this.typed(pid, payload) : this.answer(pid, payload);
    if (type === 'pass') return this.pass(pid);
    if (type === 'vote') return this.vote(pid, payload?.ok, isHost);
    if (type === 'finish' && this.phase === 'ended' && isHost) return this.ctx.finish();
  }

  onJoin(id) {
    this.left.delete(id);
    if (!this.p(id)) this.players.push({ id, score: 0, taken: 0, correct: 0, named: 0 });
    this.ctx.update();
  }
  onLeave(id) {
    this.left.add(id);
    this.onConnectionChange();
  }
  onConnectionChange() {
    if (this.phase === 'answer' && !this.eligible().length && !this.first.pending.length) return this.miss();
    if (this.phase === 'judge') this.closeJudge(false);
    if (this.phase === 'typing' && !this.on(this.typer)) return this.typeTimeUp();
    // 手番の人がいなくなったら早めに進める
    if (this.phase === 'flip' && !this.on(this.turnId())) {
      this.clearTimers();
      this.endsAt = Date.now() + AWAY_FLIP_MS;
      this.later(AWAY_FLIP_MS, () => this.flip(true));
    }
    if (this.phase === 'name' && !this.on(this.card.by)) {
      this.clearTimers();
      this.endsAt = Date.now() + AWAY_FLIP_MS;
      this.later(AWAY_FLIP_MS, () => this.autoName());
    }
    this.ctx.update();
  }

  // ---------- 見せる情報 ----------
  view(pid) {
    const ph = this.phase;
    const showCard = this.card && ph !== 'flip' && ph !== 'ended';
    // 回答のボタン:これまでにつけた名前(どの絵の名前かは出さない)。五十音順
    const nameList = [...this.names.values()].map((v) => v.name).sort((a, b) => normalize(a).localeCompare(normalize(b), 'ja'));
    const v = {
      phase: ph,
      seq: this.seq,
      endsAt: this.endsAt,
      turnId: this.turnId(),
      deckLeft: this.deck.length,
      deckTotal: this.deckTotal,
      kinds: this.kinds,
      field: this.field.length,
      fieldValue: this.fieldValue(),
      scaling: this.s.scaling,
      stage: this.card ? this.stage(this.card.no) : this.stage(this.deckTotal - this.deck.length + 1),
      cardValue: this.fieldPts.length ? this.fieldPts[this.fieldPts.length - 1] : null,
      card: showCard ? { id: this.card.id, showAt: this.card.showAt, by: this.card.by, no: this.card.no } : null,
      names: nameList,
      answerMode: this.s.answerMode,
      judgeMode: this.s.judge,
      judgeBy: this.s.judgeBy,
      locked: this.locked.has(pid),
      passed: this.passed.has(pid),
      pressed: this.first.has(pid),
      pending: ph === 'answer' && this.first.pending.length > 0,
      typer: ph === 'typing' ? this.typer : null,
      lastWrong: ph === 'answer' && this.lastWrong && this.locked.has(this.lastWrong.who) ? this.lastWrong : null,
      suggestions: ph === 'name' && pid === this.card?.by ? this.suggestions : null,
      judge: null,
      result: ph === 'result' || ph === 'miss' || ph === 'named' ? this.result : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: this.name(p.id),
        score: p.score,
        taken: p.taken,
        correct: p.correct,
        named: p.named,
        connected: this.on(p.id),
        state: ph === 'typing' && p.id === this.typer ? 'typing'
          : ph === 'answer' || ph === 'judge' || ph === 'typing'
          ? this.locked.has(p.id) ? 'wrong' : this.passed.has(p.id) ? 'pass' : this.first.has(p.id) ? 'pressed' : null
          : null,
      })),
    };
    if (ph === 'judge' && this.judge) {
      const voters = this.voters();
      v.judge = {
        answerer: this.judge.answerer,
        text: this.judge.text,
        name: this.names.get(this.card.id).name,
        canVote: voters.includes(pid),
        myVote: this.judge.votes.has(pid) ? this.judge.votes.get(pid) : null,
        yes: [...this.judge.votes.values()].filter(Boolean).length,
        no: [...this.judge.votes.values()].filter((x) => !x).length,
        voters: voters.length,
      };
    }
    if (ph === 'ended') {
      v.gallery = [...this.names.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .map(([id, x]) => ({ id, name: x.name, by: x.auto ? null : this.name(x.by) }));
      v.leftover = this.field.length;
    }
    return v;
  }
}

module.exports = {
  id: 'nazuke',
  name: '名付けカード',
  tagline: '初めて出た絵には名前をつけ、また出たらその名前を早押しで答える。',
  description:
    '順番に山札から1枚ずつ場に出します。初めて出た絵なら、出した人がその場で名前をつけます。前に出た絵なら早押し。回答権ボタンを一番早く押した人が名前を書いて答えます(設定で、これまでの名前のボタンから選ぶ方式にもできる)。' +
    '正解した人は場のカードをすべてもらい得点に。序盤に積もった山だけで決まらないよう、既定では山札が半分を切ってから出たカードは2点、残り1/4を切ってからは4点。外したらそのカードでは答えられません。山札がなくなったら終わり。' +
    '絵は「りんご」「ねこ」のようなふつうの絵と、なんだかわからない生き物(そっくりさんあり)。山札の枚数は人数で変わり、各絵柄は2枚以上でランダムに入ります。',
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    ...Cards.SETTINGS,
    { key: 'memorySec', label: '名付けのあと覚える時間', default: 3, options: [2, 3, 5, 8, 12].map((n) => ({ value: n, label: `${n}秒` })) },
    { key: 'answerSec', label: '答える時間', default: 15, options: [10, 15, 20, 30].map((n) => ({ value: n, label: `${n}秒` })) },
    {
      key: 'answerMode',
      label: '答え方',
      default: 'buzz',
      options: [
        { value: 'buzz', label: '回答権ボタン→書いて答える(選択肢なし)' },
        { value: 'buttons', label: '名前のボタンから選ぶ' },
        { value: 'both', label: 'ボタン+書いて答える' },
      ],
    },
    {
      key: 'judge',
      label: '判定',
      default: 'human',
      options: [
        { value: 'human', label: '一致しなければ人が判定する' },
        { value: 'auto', label: '完全一致だけ(自動)' },
      ],
    },
    {
      key: 'judgeBy',
      label: '人の判定',
      default: 'vote',
      options: [
        { value: 'vote', label: '回答者以外の多数決' },
        { value: 'host', label: 'ホストが決める(多数決も可)' },
      ],
    },
    {
      key: 'scaling',
      label: '得点',
      default: 'card',
      options: [
        { value: 'card', label: '後から出たカードほど高い(山札が半分を切ったら2点・残り1/4で4点)' },
        { value: 'mult', label: '後の正解ほど倍率が高い(山札が半分を切ったら×2・残り1/4で×4)' },
        { value: 'none', label: 'カード1枚=1点' },
      ],
    },
    {
      key: 'revealOnMiss',
      label: '誰も答えられなかったとき',
      default: 'hide',
      options: [
        { value: 'hide', label: '名前は伏せたまま' },
        { value: 'show', label: '名前を見せる' },
      ],
    },
  ],
  client: ['cards.js', 'buzz-client.js', 'nazuke.js'],
  create: (ctx, settings, playerIds) => new NazukeGame(ctx, settings, playerIds),
  _internal: { normalize, silly, NazukeGame },
};
