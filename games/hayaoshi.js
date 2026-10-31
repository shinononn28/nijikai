// 早押しクイズ
// 問題文が前から1文字ずつ表示され、わかった人がボタンを押して答える。
// 問題は「問題集から」「出題者が交代で書く」「ホストが全部出す」から選べる。出題者は文字で書かずに、
// 声(通話)で読み上げることもできる(そのときは押した順番だけを判定し、正誤は出題者が決める)。
//
// 通信と公平さ:
// - 問題文は1回だけ送り、各画面が時計合わせした時刻に沿って表示する(1文字ごとに送らない)。
// - 押した時刻は画面の申告(サーバーの時計)を、サーバーが測った往復時間で丸めて使う(games/buzz.js)。
//   届いた順ではなく押した時刻の順で決めるので、回線の遅い人が不利にならない。

const { QUESTIONS } = require('./hayaoshi-questions');
const { FirstPress, displayLead } = require('./buzz');

const AFTER_MS = 5000; // 全文が出てから押せる時間
const RESUME_MS = 1200; // 誤答のあと読み上げを再開するまで
const RESULT_MS = 7000;
const JUDGE_MS = 20000;
const VOICE_MS = 90000; // 声で出すときの受付時間の上限

function normalize(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・,、。.!?!?「」『』()()\[\]【】"'`]/g, '')
    .replace(/[‐‑–—―−~〜]/g, 'ー')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const splitAnswers = (s) =>
  String(s ?? '')
    .split(/[\//||\n]|、|,|,/)
    .map((x) => x.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 6);

class HayaoshiGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.mode = settings.mode;
    this.charMs = Number(settings.speed);
    this.timers = new Set();
    this.left = new Set();
    this.first = new FirstPress({ rtt: (id) => this.ctx.rtt(id), onDecide: (r) => this.decide(r) });
    this.players = humanIds.map((id) => ({ id, score: 0, correct: 0, wrong: 0, restNext: false, resting: false }));
    this.order = shuffle(humanIds);
    this.turn = -1;
    this.deck = shuffle(QUESTIONS);
    this.qno = 0;
    this.seq = 0;
    this.log = [];
    const how = { bank: '問題集から出題', rotate: '出題者が交代で問題を書きます', host: 'ホストが出題します' }[this.mode];
    this.ctx.system(`早押しクイズ。全${settings.questions}問(${how})。${settings.target ? `${settings.target}点先取で勝ち。` : ''}画面のボタンかスペースキーで押せます`);
    this.nextQuestion();
  }

  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.first.reset();
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
  on(id) {
    return !this.left.has(id) && this.ctx.isConnected(id);
  }
  setPhase(phase, ms = null) {
    this.phase = phase;
    this.endsAt = ms ? Date.now() + ms : null;
    this.seq++;
  }

  // ---------- 出題 ----------
  nextQuestion() {
    this.clearTimers();
    const leader = Math.max(...this.players.map((p) => p.score));
    if (this.qno >= this.s.questions || (this.s.target && leader >= this.s.target)) return this.finish();
    this.qno++;
    this.q = null;
    this.attempts = [];
    this.locked = new Set();
    this.answerer = null;
    this.answerText = null;
    this.reveal = { from: 0, segStart: null };
    for (const p of this.players) {
      p.resting = p.restNext;
      p.restNext = false;
    }
    this.questioner = this.pickQuestioner();
    if (!this.questioner) return this.startQuestion(this.bankQuestion());
    this.setPhase('write', this.s.writeSeconds * 1000);
    this.later(this.s.writeSeconds * 1000, () => {
      this.ctx.system(`時間切れなので、問題集から出題します`);
      this.startQuestion(this.bankQuestion());
    });
    this.ctx.update();
  }

  pickQuestioner() {
    if (this.mode === 'host') {
      const h = this.ctx.hostId();
      return this.p(h) && this.on(h) ? h : null;
    }
    if (this.mode !== 'rotate') return null;
    for (let i = 0; i < this.order.length; i++) {
      this.turn = (this.turn + 1) % this.order.length;
      const id = this.order[this.turn];
      if (this.p(id) && this.on(id)) return id;
    }
    return null;
  }

  bankQuestion() {
    if (!this.deck.length) this.deck = shuffle(QUESTIONS);
    const q = this.deck.pop();
    return { text: q.q, answers: q.a, voice: false, src: 'bank' };
  }

  startQuestion(q) {
    this.clearTimers();
    this.q = q;
    this.voiceEnd = null;
    if (q.src === 'bank') this.questioner = null; // 問題集の問題は出題者も解答できる
    this.reveal = { from: 0, segStart: Date.now() + Math.max(1500, this.lead()) };
    this.setPhase('reading');
    this.armReadTimer();
    this.ctx.update();
  }

  lead() {
    return displayLead(this.players.filter((p) => this.on(p.id)).map((p) => this.ctx.rtt(p.id)));
  }

  // 読み上げ中:時刻 t に何文字まで出ているか
  shownAt(t) {
    const r = this.reveal;
    const len = this.q?.text?.length ?? 0;
    if (!r.segStart) return r.from;
    return Math.min(len, r.from + Math.max(0, Math.floor((t - r.segStart) / this.charMs)));
  }

  armReadTimer() {
    const r = this.reveal;
    const end = this.q.voice
      ? (this.voiceEnd ??= r.segStart + VOICE_MS)
      : r.segStart + (this.q.text.length - r.from) * this.charMs + AFTER_MS;
    this.readEndsAt = end;
    this.later(Math.max(0, end - Date.now()), () => {
      if (this.phase !== 'reading') return;
      if (this.first.decide()) return; // 締め切り直前の押しを先に判定
      this.endQuestion(null);
    });
  }

  // ---------- 早押し ----------
  canBuzz(p) {
    return (
      this.phase === 'reading' && p && p.id !== this.questioner && !p.resting &&
      !this.locked.has(p.id) && this.on(p.id)
    );
  }
  eligible() {
    return this.players.filter((p) => p.id !== this.questioner && !p.resting && !this.locked.has(p.id) && this.on(p.id));
  }

  buzz(p, claimed) {
    if (!this.canBuzz(p)) return;
    // ほかの人の「もっと早い押し」がまだ届いていないかもしれないので、少しだけ待ってから決める(games/buzz.js)
    // 読み始める前の押しは読み始めの瞬間として扱う
    this.first.press(p.id, claimed, { others: this.eligible().map((x) => x.id), notBefore: this.reveal.segStart ?? -Infinity });
  }

  decide({ winner, pressAt, losers }) {
    if (this.phase !== 'reading') return;
    this.clearTimers();
    this.answerer = winner;
    this.answerText = null;
    this.pressAt = pressAt;
    this.reveal = { from: this.shownAt(pressAt), segStart: null };
    this.margin = losers.length ? losers[0].pressAt - pressAt : null;
    this.setPhase('answer', this.s.answerSeconds * 1000);
    this.later(this.s.answerSeconds * 1000, () => {
      if (this.phase !== 'answer') return;
      if (this.answerText !== null && this.hasJudge()) return this.toJudge();
      this.wrong(this.answerText === null ? '(時間切れ)' : this.answerText);
    });
    this.ctx.update();
  }

  hasJudge() {
    return !!this.questioner && this.on(this.questioner);
  }

  answer(p, text) {
    if (this.phase !== 'answer' || p.id !== this.answerer) return;
    const t = String(text ?? '').trim().slice(0, 60);
    if (!t) return;
    this.answerText = t;
    const key = normalize(t);
    if (this.q.answers.some((a) => normalize(a) === key)) return this.correct(t);
    if (this.hasJudge()) return this.toJudge();
    this.wrong(t);
  }

  toJudge() {
    this.clearTimers();
    this.setPhase('judge', JUDGE_MS);
    this.later(JUDGE_MS, () => this.phase === 'judge' && this.wrong(this.answerText ?? '(時間切れ)'));
    this.ctx.update();
  }

  correct(text) {
    const p = this.p(this.answerer);
    p.score++;
    p.correct++;
    this.attempts.push({ id: p.id, text: text ?? '(口頭)', ok: true, at: this.reveal.from });
    this.endQuestion(p.id);
  }

  wrong(text) {
    const p = this.p(this.answerer);
    if (p) {
      p.wrong++;
      if (this.s.penalty === 'minus') p.score--;
      if (this.s.penalty === 'rest') p.restNext = true;
      this.attempts.push({ id: p.id, text: text ?? '(口頭)', ok: false, at: this.reveal.from });
      this.locked.add(p.id);
    }
    this.answerer = null;
    this.answerText = null;
    if (!this.eligible().length) return this.endQuestion(null);
    // 続きから読み上げを再開
    this.clearTimers();
    this.reveal = { from: this.reveal.from, segStart: Date.now() + Math.max(RESUME_MS, this.lead()) };
    this.setPhase('reading');
    this.armReadTimer();
    this.ctx.update();
  }

  endQuestion(winnerId) {
    this.clearTimers();
    this.voiceEnd = null;
    this.answerer = null;
    this.winner = winnerId;
    this.reveal = { from: this.q?.text?.length ?? 0, segStart: null };
    const ans = this.q.answers[0];
    const who = winnerId ? `${this.name(winnerId)}さんが正解` : '正解者なし';
    this.ctx.system(`第${this.qno}問:${who}${ans ? `(答え:${ans})` : ''}`);
    this.log.push({ qno: this.qno, text: this.q.text, answer: ans ?? null, winner: winnerId ? this.name(winnerId) : null });
    this.setPhase('result', RESULT_MS);
    this.later(RESULT_MS, () => this.nextQuestion());
    this.ctx.update();
  }

  finish() {
    this.clearTimers();
    this.setPhase('ended');
    const top = [...this.players].sort((a, b) => b.score - a.score)[0];
    this.ctx.system(`ゲーム終了。優勝は${this.name(top.id)}さん(${top.score}点)`);
    this.ctx.update();
  }

  // ---------- 操作 ----------
  action(pid, type, payload, { isHost }) {
    const p = this.p(pid);
    if (!p) return type === 'finish' && this.phase === 'ended' && isHost ? this.ctx.finish() : undefined;
    const isQ = pid === this.questioner;
    if (type === 'buzz') return this.buzz(p, payload.pressAt); // 押しただけでは状態を送らない(誰が押したか決まったときに送る)
    if (type === 'write' && isQ && this.phase === 'write') {
      const voice = !!payload.voice;
      const text = voice ? null : String(payload.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const answers = splitAnswers(payload.answers);
      if (!voice && (!text || !answers.length)) return;
      this.startQuestion({ text, answers, voice, src: voice ? 'voice' : 'custom' });
      return;
    }
    if (type === 'useBank' && isQ && this.phase === 'write') return this.startQuestion(this.bankQuestion());
    if (type === 'answer') this.answer(p, payload.text);
    else if (type === 'judge' && isQ && ['answer', 'judge'].includes(this.phase)) {
      if (payload.ok) this.correct(this.answerText);
      else this.wrong(this.answerText);
    } else if (type === 'close' && (isQ || (isHost && !this.questioner)) && this.phase === 'reading') this.endQuestion(null);
    else if (type === 'accept' && (isQ || isHost) && this.phase === 'result') {
      // 機械判定で× になった言い回し違いを、あとから正解にする
      const a = this.attempts[Number(payload.i)];
      if (!a || a.ok || this.attempts.some((x) => x.ok)) return;
      const ap = this.p(a.id);
      a.ok = true;
      ap.score += this.s.penalty === 'minus' ? 2 : 1;
      ap.correct++;
      ap.wrong--;
      if (this.s.penalty === 'rest') ap.restNext = false;
      this.winner = a.id;
      this.log[this.log.length - 1].winner = this.name(a.id);
      this.ctx.system(`${this.name(pid)}さんの判定で、${this.name(a.id)}さんの「${a.text}」を正解にしました`);
    } else if (type === 'next' && (isQ || isHost) && this.phase === 'result') return this.nextQuestion();
    else if (type === 'finish' && this.phase === 'ended' && isHost) return this.ctx.finish();
    else return;
    this.ctx.update();
  }

  onJoin(id) {
    this.left.delete(id);
    if (!this.p(id)) {
      this.players.push({ id, score: 0, correct: 0, wrong: 0, restNext: false, resting: false });
      this.order.push(id);
    }
  }

  onLeave(id) {
    this.left.add(id);
    this.onConnectionChange();
    if (id === this.answerer && ['answer', 'judge'].includes(this.phase)) this.wrong('(退室)');
  }

  onConnectionChange() {
    if (this.phase === 'write' && !this.on(this.questioner)) this.startQuestion(this.bankQuestion());
    else if (this.phase === 'reading' && !this.eligible().length && !this.first.pending.length) this.endQuestion(null);
    else if (this.phase === 'judge' && !this.hasJudge()) this.wrong(this.answerText);
  }

  view(pid) {
    const me = this.p(pid);
    const showAnswer = ['result', 'ended'].includes(this.phase) || pid === this.questioner;
    const q = this.q;
    return {
      phase: this.phase,
      seq: this.seq,
      mode: this.mode,
      qno: this.qno,
      total: this.s.questions,
      target: this.s.target,
      penalty: this.s.penalty,
      questioner: this.questioner,
      endsAt: this.endsAt,
      q: q && this.phase !== 'write' ? { text: q.text, voice: q.voice, src: q.src } : null,
      answers: q && showAnswer ? q.answers : null,
      reveal: this.reveal,
      charMs: this.charMs,
      readEndsAt: this.phase === 'reading' ? this.readEndsAt : null,
      answerer: this.answerer,
      answerText: ['judge', 'answer'].includes(this.phase) && (pid === this.questioner || pid === this.answerer || this.phase === 'judge') ? this.answerText : null,
      margin: this.phase === 'answer' ? this.margin : null,
      attempts: (this.attempts || []).map((a) => ({ name: this.name(a.id), text: a.text, ok: a.ok, at: a.at })),
      winner: this.winner && ['result'].includes(this.phase) ? this.name(this.winner) : null,
      canBuzz: !!me && this.phase === 'reading' && this.canBuzz(me),
      myStatus: !me ? 'watch' : pid === this.questioner ? 'questioner' : me.resting ? 'resting' : this.locked?.has(pid) ? 'locked' : 'play',
      players: [...this.players]
        .sort((a, b) => b.score - a.score)
        .map((p) => ({
          id: p.id,
          name: this.name(p.id),
          score: p.score,
          correct: p.correct,
          wrong: p.wrong,
          connected: this.on(p.id),
          status: p.id === this.questioner ? 'questioner' : p.resting ? 'resting' : this.locked?.has(p.id) && !['result', 'ended'].includes(this.phase) ? 'locked' : '',
        })),
      log: this.phase === 'ended' ? this.log : null,
    };
  }
}

module.exports = {
  id: 'hayaoshi',
  name: '早押しクイズ',
  tagline: '1文字ずつ出てくる問題文。わかった瞬間に押して答える。',
  description:
    '問題文が前から1文字ずつ表示され、わかった人がボタン(PCはスペースキー)を押して答えます。正解で+1、間違えると「お手つき」でその問題は押せません。' +
    '問題は内蔵の問題集から出すほか、出題者が交代で書いたり、ホストが全部出したりもできます。出題者は文字を書かずに通話で読み上げてもOK(正誤は出題者が判定)。' +
    '押した時刻は回線の速さで差がつかないよう補正しています。',
  minPlayers: 2,
  maxPlayers: 12,
  settings: [
    {
      key: 'mode',
      label: '問題',
      default: 'bank',
      options: [
        { value: 'bank', label: '問題集から(全員が解答)' },
        { value: 'rotate', label: '出題者が交代で書く' },
        { value: 'host', label: 'ホストが全部出す(司会役)' },
      ],
    },
    { key: 'questions', label: '問題数', default: 10, options: [5, 10, 15, 20, 30].map((n) => ({ value: n, label: `${n}問` })) },
    {
      key: 'target',
      label: '勝ち抜け',
      default: 0,
      options: [{ value: 0, label: 'なし(全問やる)' }, ...[3, 5, 7].map((n) => ({ value: n, label: `${n}点先取` }))],
    },
    {
      key: 'speed',
      label: '問題文の速さ',
      default: 160,
      options: [
        { value: 110, label: '速い' },
        { value: 160, label: 'ふつう' },
        { value: 230, label: 'ゆっくり' },
      ],
    },
    {
      key: 'penalty',
      label: 'お手つき',
      default: 'minus',
      options: [
        { value: 'minus', label: '−1点' },
        { value: 'rest', label: '次の1問お休み' },
        { value: 'none', label: 'その問題に押せないだけ' },
      ],
    },
    { key: 'answerSeconds', label: '解答の時間', default: 10, options: [7, 10, 15].map((n) => ({ value: n, label: `${n}秒` })) },
    { key: 'writeSeconds', label: '問題を書く時間', default: 120, options: [60, 120, 180].map((n) => ({ value: n, label: `${n}秒` })) },
  ],
  client: ['buzz-client.js', 'hayaoshi.js'],
  create: (ctx, settings, playerIds) => new HayaoshiGame(ctx, settings, playerIds),
  _internal: { normalize, splitAnswers },
};
