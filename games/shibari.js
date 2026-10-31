// 文字しばり伝言(全員同時に回る伝言ゲーム)
// 1. お題を決める。設定で「ランダム」か「自分で作成」。自分で作ったお題は自分には回ってこない。
// 2. 隣から回ってきた伝言を、別の言葉で説明して次の人へ渡す。
//    ただし、その伝言の中で一度でも使われた文字(お題の文字も含む)はもう使えない。お題ごとに使えない文字が増えていく。
//    1つの伝言の中でも同じ文字は1回まで(「ぺたぺた」は×)。
// 3. お題→伝言1→伝言2→…と人数分まわったら終わり(作った人には戻らない)。1本ずつ、どう変わったかを公開する。
//    設定で「最後の人はお題を当てる」にすると、当たった伝言に関わった全員に+1点(言い回し違いはホストかお題を出した人が直せる)。
//
// 「同じ文字」の判定は public/games/shibari-rules.js(画面と共通)。
const { NOUNS } = require('./words');
const R = require('../public/games/shibari-rules.js');

const TOPIC_MS = 40000;
const GUESS_MS = 45000;
const GRACE_MS = 2500; // 締め切り直前の自動提出を待つ
const MAX_TOPIC = 20;
const MAX_DESC = 40;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const byKana = (a, b) => a.localeCompare(b, 'ja');

class ShibariGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    // 「同じ文字」の数え方(public/games/shibari-rules.js)
    this.fold = { fold: settings.kana !== 'strict', base: settings.marks === 'merge' };
    this.timers = new Set();
    this.order = [...humanIds]; // ロビーの並び順のまま、次の人へ回す
    this.N = this.order.length;
    this.custom = settings.topic === 'custom';
    this.guess = settings.last === 'guess';
    // 伝言を書く人数:自分で作ったお題なら自分以外の全員、ランダムなら全員(設定で上限あり)
    const max = this.custom ? this.N - 1 : this.N;
    const want = settings.steps === 'all' ? max : Number(settings.steps) || max;
    const L = Math.max(this.guess ? 2 : 1, Math.min(max, want));
    // ラウンドごとの作業。ラウンド r で i 番目の人は (i - r) 番目の伝言を担当する
    this.plan = [...(this.custom ? ['topic'] : []), ...Array(L - (this.guess ? 1 : 0)).fill('desc'), ...(this.guess ? ['guess'] : [])];
    this.D = L - (this.guess ? 1 : 0); // 説明する回数
    this.rounds = this.plan.length;
    this.chains = this.order.map((owner) => ({ owner, entries: [], banned: new Set(), judge: null }));
    if (!this.custom) {
      const pool = [...NOUNS].sort(() => Math.random() - 0.5);
      this.chains.forEach((c, i) => {
        const text = pool[i % pool.length];
        c.entries.push({ type: 'topic', text, by: null, auto: false, fresh: [...R.addAll(c.banned, text, this.fold)].sort(byKana) });
      });
    }
    this.round = 0;
    this.likes = {};
    this.seq = 0;
    this.ctx.system(
      `文字しばり伝言。${this.custom ? '各自が作ったお題' : 'ランダムなお題'}を${this.D}人が順に言い換えて伝えます${this.guess ? '(最後の人はお題を当てる)' : ''}。同じ伝言の中で一度使われた文字(お題の文字も)はもう使えません`,
    );
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

  kind(r = this.round) {
    return this.plan[r];
  }
  // ラウンド r で i 番目の人が担当するのは (i - r) 番目の人が始めた伝言
  chainFor(pid, r = this.round) {
    const i = this.order.indexOf(pid);
    return (((i - r) % this.N) + this.N) % this.N;
  }
  // 次の人に見せる伝言(時間切れで空のときは、その前のもの)
  lastText(c) {
    for (let i = c.entries.length - 1; i >= 0; i--) if (c.entries[i].text) return c.entries[i];
    return null;
  }

  startRound() {
    this.clearTimers();
    this.phase = 'play';
    this.subs = {};
    const k = this.kind();
    const ms = k === 'topic' ? TOPIC_MS : k === 'guess' ? GUESS_MS : (Number(this.s.descSec) || 90) * 1000;
    this.endsAt = Date.now() + ms;
    this.suggest = {};
    if (k === 'topic') {
      const used = new Set();
      for (const id of this.order) {
        const list = [];
        while (list.length < 3) {
          const w = pick(NOUNS);
          if (!used.has(w)) { used.add(w); list.push(w); }
        }
        this.suggest[id] = list;
      }
    }
    this.seq++;
    this.later(ms + GRACE_MS, () => this.closeRound());
    this.ctx.update();
  }

  submit(pid, payload) {
    if (this.phase !== 'play' || !this.order.includes(pid)) return;
    const k = this.kind();
    const auto = !!payload.auto;
    if (k === 'topic') {
      const text = clean(payload.text, MAX_TOPIC);
      if (!R.chars(text, this.fold).length) {
        if (!auto) this.ctx.emitTo(pid, 'error', { error: 'お題を入れてください' });
        return;
      }
      this.subs[pid] = { text };
    } else if (k === 'desc') {
      const c = this.chains[this.chainFor(pid)];
      let text = clean(payload.text, MAX_DESC);
      const pr = R.problems(text, c.banned, this.fold);
      const bad = [...pr.used, ...pr.repeated];
      if (bad.length) {
        const msg = [pr.used.length ? `使えない文字:${pr.used.join(' ')}` : '', pr.repeated.length ? `同じ文字を2回使っています:${pr.repeated.join(' ')}` : ''].filter(Boolean).join(' / ');
        if (!auto) return this.ctx.emitTo(pid, 'error', { error: msg });
        text = R.strip(text, c.banned, this.fold); // 時間切れのときは、使えない文字を消して出す
      }
      if (!R.chars(text, this.fold).length) {
        if (!auto) this.ctx.emitTo(pid, 'error', { error: '使える文字で何か書いてください' });
        return;
      }
      this.subs[pid] = { text, auto: auto && bad.length > 0 };
    } else {
      const text = clean(payload.text, MAX_TOPIC);
      if (!text) return;
      this.subs[pid] = { text };
    }
    if (auto) return; // 自動提出は締め切りを待つ
    if (this.order.every((id) => this.subs[id] || !this.ctx.isConnected(id))) this.closeRound();
  }

  closeRound() {
    if (this.phase !== 'play') return;
    const k = this.kind();
    for (const id of this.order) {
      const c = this.chains[this.chainFor(id)];
      let sub = this.subs[id];
      if (!sub) sub = k === 'topic' ? { text: this.suggest[id]?.[0] || 'りんご', auto: true } : { text: '', auto: true };
      if (!sub.text && k !== 'topic') sub.text = '';
      const before = new Set(c.banned);
      if (k !== 'guess') R.addAll(c.banned, sub.text, this.fold);
      const fresh = [...c.banned].filter((x) => !before.has(x)).sort(byKana);
      c.entries.push({ type: k, text: sub.text, by: id, auto: !!sub.auto, fresh });
    }
    this.round++;
    if (this.round >= this.rounds) return this.startReveal();
    this.startRound();
  }

  // ---------- 公開 ----------
  startReveal() {
    this.clearTimers();
    for (const c of this.chains) {
      const topic = c.entries[0]?.text;
      const guess = c.entries[c.entries.length - 1]?.text;
      c.auto = this.guess && R.sameAnswer(topic, guess);
    }
    this.phase = 'reveal';
    this.revealChain = 0;
    this.revealStep = 0;
    this.seq++;
    this.ctx.system('結果発表!1本ずつ、お題がどう伝わったかを見ていきます');
    this.ctx.update();
  }

  advance(isHost) {
    if (this.phase !== 'reveal' || !isHost) return;
    const c = this.chains[this.revealChain];
    if (this.revealStep < c.entries.length - 1) {
      this.revealStep++;
      if (this.guess && this.revealStep === c.entries.length - 1) {
        this.ctx.system(`${this.name(c.owner)}さんのお題「${c.entries[0].text}」→ 答え「${c.entries[this.revealStep].text || '(なし)'}」${this.isCorrect(c) ? ' 正解!' : ''}`);
      }
    } else if (this.revealChain < this.chains.length - 1) {
      this.revealChain++;
      this.revealStep = 0;
    } else {
      this.phase = 'ended';
      this.seq++;
      let tail = '';
      if (this.guess) {
        const sc = this.scores();
        const top = Math.max(...Object.values(sc));
        const winners = this.order.filter((id) => sc[id] === top);
        tail = top > 0 ? `。最多得点は${winners.map((id) => `${this.name(id)}さん`).join('・')}(${top}点)` : '。正解した伝言はありませんでした';
      }
      this.ctx.system(`全部の伝言を見終わりました${tail}`);
    }
  }

  isCorrect(c) {
    return c.judge !== null ? c.judge : c.auto;
  }
  // 答えまで公開された伝言か
  guessShown(ci) {
    if (this.phase === 'ended') return true;
    if (this.phase !== 'reveal') return false;
    return ci < this.revealChain || (ci === this.revealChain && this.revealStep === this.chains[ci].entries.length - 1);
  }
  // 人の判定:ホストかお題を出した人が「正解にする / 不正解にする」
  judge(pid, ci, ok, isHost) {
    const c = this.chains[ci];
    if (!this.guess || !c || !this.guessShown(ci)) return;
    if (!isHost && pid !== c.owner) return;
    c.judge = ok === c.auto ? null : !!ok;
    this.ctx.system(`${this.name(pid)}さんが${this.name(c.owner)}さんのお題の答えを${ok ? '正解' : '不正解'}にしました`);
  }

  // 正解した伝言に関わった全員に+1(公開済みの分だけ)
  scores() {
    const sc = Object.fromEntries(this.order.map((id) => [id, 0]));
    this.chains.forEach((c, ci) => {
      if (!this.guessShown(ci) || !this.isCorrect(c)) return;
      for (const id of new Set(c.entries.map((e) => e.by))) if (id && id in sc) sc[id]++;
    });
    return sc;
  }

  like(pid, ci, si) {
    if (!['reveal', 'ended'].includes(this.phase) || !this.order.includes(pid)) return;
    const c = this.chains[ci];
    if (!c || !c.entries[si] || !c.entries[si].by || c.entries[si].by === pid) return;
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
      case 'judge':
        this.judge(pid, Number(payload.chain), !!payload.ok, isHost);
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
    if (this.phase === 'play' && this.order.every((x) => this.subs[x] || !this.ctx.isConnected(x) || x === id)) this.closeRound();
  }
  onConnectionChange() {
    if (this.phase === 'play' && this.order.every((id) => this.subs[id] || !this.ctx.isConnected(id))) this.closeRound();
  }

  // ---------- 表示用データ ----------
  view(pid) {
    const v = {
      phase: this.phase,
      seq: this.seq,
      round: this.round,
      rounds: this.rounds,
      steps: this.D,
      custom: this.custom,
      guess: this.guess,
      fold: this.fold.fold,
      opts: this.fold,
      kind: this.phase === 'play' ? this.kind() : null,
      endsAt: this.phase === 'play' ? this.endsAt : null,
      players: this.order.map((id) => ({ id, name: this.name(id), done: this.phase === 'play' ? !!this.subs[id] : null })),
      participant: this.order.includes(pid),
    };
    if (this.phase === 'play' && this.order.includes(pid)) {
      const k = this.kind();
      const c = this.chains[this.chainFor(pid)];
      const prev = this.lastText(c);
      v.task = {
        kind: k,
        prev: prev ? { text: prev.text, isTopic: prev.type === 'topic' } : null,
        banned: k === 'desc' ? [...c.banned].sort(byKana) : null,
        step: k === 'desc' ? this.round + (this.custom ? 0 : 1) : null,
      };
      const i = this.order.indexOf(pid);
      const lastBy = c.entries.length ? c.entries[c.entries.length - 1].by : null;
      v.from = lastBy ? this.name(lastBy) : null;
      v.to = this.round < this.rounds - 1 ? this.name(this.order[(i + 1) % this.N]) : null;
      v.suggest = k === 'topic' ? this.suggest[pid] : null;
      v.submitted = this.subs[pid] ? this.subs[pid].text : null;
    }
    if (this.phase === 'reveal' || this.phase === 'ended') {
      const ended = this.phase === 'ended';
      const upto = ended ? this.chains.length - 1 : this.revealChain;
      v.reveal = {
        chain: ended ? null : this.revealChain,
        step: ended ? null : this.revealStep,
        total: this.chains.length,
        chains: this.chains.slice(0, upto + 1).map((c, ci) => {
          const shown = this.guessShown(ci);
          return {
            owner: this.name(c.owner),
            ownerId: c.owner,
            total: c.entries.length,
            done: shown,
            correct: this.guess && shown ? this.isCorrect(c) : null,
            judged: this.guess && shown && c.judge !== null,
            canJudge: this.guess && shown && (this.ctx.hostId() === pid || (this.custom && c.owner === pid)),
            entries: c.entries.slice(0, ended || ci < this.revealChain ? c.entries.length : this.revealStep + 1).map((e, si) => {
              const set = this.likes[`${ci}-${si}`];
              return { type: e.type, text: e.text, auto: e.auto, fresh: e.fresh, byName: e.by ? this.name(e.by) : null, likes: set ? set.size : 0, liked: !!set?.has(pid) };
            }),
          };
        }),
      };
      const sc = this.scores();
      if (this.guess) v.scores = this.order.map((id) => ({ id, name: this.name(id), score: sc[id] })).sort((a, b) => b.score - a.score);
      if (ended) {
        let best = null;
        this.chains.forEach((c, ci) => c.entries.forEach((e, si) => {
          const n = this.likes[`${ci}-${si}`]?.size || 0;
          if (n && e.by && (!best || n > best.n)) best = { n, by: this.name(e.by), text: e.text };
        }));
        v.best = best;
      }
    }
    return v;
  }
}

module.exports = {
  id: 'shibari',
  name: '文字しばり伝言',
  tagline: '同じ伝言の中で一度使われた文字はもう使えない。言い換えて言い換えてお題を届ける。',
  description:
    'お題(ランダムか、自分で作成)を全員同時に隣へ回します。受け取った人はその内容を別の言葉で言い換えて次へ。ただし、その伝言の中で一度でも使われた文字(お題の文字も)はもう使えず、自分の伝言の中でも同じ文字は1回まで。' +
    '使えない文字はお題ごとに増えていき、五十音表で確認できます。人数分まわったら終わりで、自分で作ったお題は自分には回ってきません。最後に1本ずつ、お題がどう変わったかを公開します。',
  minPlayers: 3,
  maxPlayers: 12,
  cpu: false,
  settings: [
    {
      key: 'topic',
      label: 'お題',
      default: 'random',
      options: [
        { value: 'random', label: 'ランダム' },
        { value: 'custom', label: '自分で作成(自分には回ってこない)' },
      ],
    },
    {
      key: 'steps',
      label: '伝言する人数',
      default: 'all',
      options: [
        { value: 'all', label: '全員(人数分まわす)' },
        ...[2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n}人まで` })),
      ],
    },
    {
      key: 'last',
      label: '最後の人',
      default: 'desc',
      options: [
        { value: 'desc', label: 'ほかと同じく伝言を書いて終わり' },
        { value: 'guess', label: '元のお題を当てる(当たったら関わった全員に+1点)' },
      ],
    },
    { key: 'descSec', label: '説明を書く時間', default: 90, options: [60, 90, 120, 180].map((n) => ({ value: n, label: `${n}秒` })) },
    {
      key: 'kana',
      label: 'ひらがなとカタカナ',
      default: 'fold',
      options: [
        { value: 'fold', label: '同じ文字とみなす(「か」を使ったら「カ」も×)' },
        { value: 'strict', label: '別の文字(ゆるめ)' },
      ],
    },
    {
      key: 'marks',
      label: '濁点・半濁点・小さい字',
      default: 'separate',
      options: [
        { value: 'separate', label: '別の文字(「か」と「が」、「や」と「ゃ」は別)' },
        { value: 'merge', label: '元の字と同じ(「か」を使ったら「が」も×・きびしめ)' },
      ],
    },
  ],
  client: ['shibari-rules.js', 'shibari.js'],
  create: (ctx, settings, playerIds) => new ShibariGame(ctx, settings, playerIds),
  _internal: { ShibariGame },
};
