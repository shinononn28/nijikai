// フェイント早押し
// ラウンドごとに「🍎が出たら押す」「文字と色が一致したら押す」などのお題が出て、カードが次々にめくられる。
// お題に合うカードが出た瞬間に押す。早い順に得点、違うカードで押したら「お手つき」(−1点、そのラウンドは終わり)。
//
// 判定は「その人の画面にカードが出てから押すまでの時間(反応時間)」で比べる。
// - カードは「サーバー時計で◯時◯分◯秒に出す」と少し先の時刻を付けて送り、時計合わせした全員の画面で同時に出す。
// - 画面は、実際に表示した瞬間から押した瞬間までを測って送る。届くのが遅れた人も自分の画面基準で測るので不利にならない。
// - 自己申告なので、サーバーが測った往復時間から「ありえる範囲」に丸め、100ms 未満はフライング扱いにする。

const { judgeReaction, displayLead } = require('./buzz');

const RULE_MS = 3500;
const FIRST_CARD_MS = 1600;
const COLLECT_MS = 2500; // お題のカードが出てから押せる時間
const RESULT_MS = 5000;
const MIN_HUMAN_MS = 100; // これより速い反応は人間には無理なのでフライング

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const COLORS = [
  { id: 'red', name: '赤' },
  { id: 'blue', name: '青' },
  { id: 'green', name: '緑' },
  { id: 'yellow', name: '黄' },
  { id: 'purple', name: '紫' },
];
const PICTS = [
  ['🍎', '🍅', '🍒', '🍓', '🌶️', '🥕'],
  ['🐶', '🐱', '🐻', '🐼', '🦊', '🐯'],
  ['⚽', '🏀', '🏐', '🎾', '⚾', '🏈'],
  ['🌙', '⭐', '☀️', '☁️', '⚡', '🌈'],
  ['🗡️', '🛡️', '🏹', '🪄', '🔮', '💎'],
];
const KANJI = [
  ['大', '犬', '太', '天', '丈', '夫'],
  ['土', '士', '上', '工', '王', '干'],
  ['未', '末', '本', '木', '米', '来'],
  ['日', '目', '白', '田', '旧', '由'],
];
const SHAPES = ['●', '■', '▲', '★', '◆'];

// お題ごとに「お手つき用のカード」と「お題のカード」を作る。prev は1つ前のカード
const RULES = {
  pict: {
    easy: true,
    make() {
      const g = pick(PICTS);
      const target = pick(g);
      const others = g.filter((x) => x !== target);
      return {
        parts: [{ t: target }, 'が出たら押す'],
        decoy: () => ({ t: pick(others) }),
        hit: () => ({ t: target }),
      };
    },
  },
  kanji: {
    easy: true,
    make() {
      const g = pick(KANJI);
      const target = pick(g);
      const others = g.filter((x) => x !== target);
      return {
        parts: ['「', { t: target }, '」が出たら押す'],
        decoy: () => ({ t: pick(others), k: 1 }),
        hit: () => ({ t: target, k: 1 }),
      };
    },
  },
  color: {
    easy: true,
    make() {
      const c = pick(COLORS);
      const others = COLORS.filter((x) => x !== c);
      return {
        parts: [{ t: `${c.name}色`, c: c.id }, 'のものが出たら押す'],
        decoy: () => ({ t: pick(SHAPES), c: pick(others).id }),
        hit: () => ({ t: pick(SHAPES), c: c.id }),
      };
    },
  },
  stroop: {
    make() {
      const word = (meaning, ink) => ({ t: meaning.name, c: ink.id, k: 1 });
      return {
        parts: ['文字の', { t: '意味' }, 'と', { t: '色' }, 'が一致したら押す'],
        decoy: () => {
          const m = pick(COLORS);
          return word(m, pick(COLORS.filter((x) => x !== m)));
        },
        hit: () => {
          const m = pick(COLORS);
          return word(m, m);
        },
      };
    },
  },
  sum10: {
    make() {
      const pair = (ok) => {
        for (;;) {
          const a = rint(1, 9);
          const b = rint(1, 9);
          if ((a + b === 10) === ok && (ok || Math.abs(a + b - 10) <= 2 || Math.random() < 0.3)) return { t: `${a}+${b}`, k: 1 };
        }
      };
      return {
        parts: ['足して', { t: '10' }, 'になったら押す'],
        decoy: () => pair(false),
        hit: () => pair(true),
      };
    },
  },
  same: {
    make() {
      const g = pick(PICTS);
      return {
        parts: [{ t: '1つ前' }, 'と同じ絵が出たら押す'],
        decoy: (prev) => ({ t: pick(g.filter((x) => x !== prev?.t)) }),
        hit: (prev) => ({ t: prev.t }),
      };
    },
  },
};

class HanshaGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.left = new Set();
    this.players = humanIds.map((id) => ({ id, score: 0, best: null, hits: 0, fouls: 0 }));
    this.round = 0;
    this.seq = 0;
    this.lastRule = null;
    this.ctx.system(`フェイント早押し。全${settings.rounds}ラウンド。お題に合うカードが出た瞬間に押す!違うカードで押すとお手つき(−1点)`);
    this.nextRound();
  }

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
  lead() {
    return displayLead(this.players.filter((p) => this.on(p.id)).map((p) => this.ctx.rtt(p.id)));
  }

  nextRound() {
    this.clearTimers();
    this.round++;
    if (this.round > this.s.rounds) return this.finish();
    const pool = Object.keys(RULES).filter((k) => (this.s.level === 'easy' ? RULES[k].easy : true) && k !== this.lastRule);
    this.ruleKind = pick(pool);
    this.lastRule = this.ruleKind;
    this.rule = RULES[this.ruleKind].make();
    // カードの並び:お手つき用を3〜7枚、そのあとにお題のカード
    const n = rint(3, 7);
    this.cards = [];
    for (let i = 0; i < n; i++) this.cards.push(this.rule.decoy(this.cards[i - 1]));
    this.cards.push(this.rule.hit(this.cards[n - 1]));
    this.targetIdx = n;
    this.card = null;
    this.presses = new Map(); // id → { kind: 'hit'|'foul'|'flying', rt }
    this.result = null;
    this.setPhase('rule', RULE_MS);
    this.later(RULE_MS, () => this.startRun());
    this.ctx.update();
  }

  startRun() {
    this.setPhase('run');
    this.ctx.update();
    this.schedule(0, Date.now() + FIRST_CARD_MS);
  }

  // i 枚目を showAt に出す。全員に届くよう lead だけ前に送る
  schedule(i, showAt) {
    this.later(showAt - this.lead() - Date.now(), () => {
      if (this.phase !== 'run') return;
      this.cards[i].showAt = showAt;
      this.card = { ...this.cards[i], i, showAt };
      this.ctx.update();
      if (i === this.targetIdx) this.later(showAt + COLLECT_MS - Date.now(), () => this.resolve());
      else {
        const gap = i + 1 === this.targetIdx && Math.random() < 0.4 ? rint(450, 700) : rint(750, 1500);
        this.schedule(i + 1, showAt + gap);
      }
    });
  }

  eligible() {
    return this.players.filter((p) => this.on(p.id) && !this.presses.has(p.id));
  }

  press(p, payload) {
    if (this.phase !== 'run' || this.presses.has(p.id)) return;
    const i = Number(payload.i);
    const card = this.cards[i];
    if (!card || !card.showAt || !this.card || i > this.card.i) return;
    if (i !== this.targetIdx) {
      this.foul(p, 'foul');
    } else {
      // 画面の申告した反応時間を、サーバーから見てありえる範囲に丸める(games/buzz.js)
      const { rt, flying } = judgeReaction({
        claimedRt: payload.rt, claimedPressAt: payload.pressAt, showAt: card.showAt, rtt: this.ctx.rtt(p.id), minHuman: MIN_HUMAN_MS,
      });
      if (flying) this.foul(p, 'flying', rt);
      else {
        this.presses.set(p.id, { kind: 'hit', rt });
        if (p.best === null || rt < p.best) p.best = rt;
        p.hits++;
      }
    }
    if (!this.eligible().length && this.card?.i === this.targetIdx) return this.resolve();
    this.ctx.update();
  }

  foul(p, kind, rt = null) {
    p.score--;
    p.fouls++;
    this.presses.set(p.id, { kind, rt });
    this.ctx.system(`${this.name(p.id)}さん、${kind === 'flying' ? 'フライング' : 'お手つき'}!(−1点)`);
  }

  resolve() {
    if (this.phase !== 'run') return;
    this.clearTimers();
    const hits = [...this.presses.entries()].filter(([, x]) => x.kind === 'hit').sort((a, b) => a[1].rt - b[1].rt);
    const awards = [3, 2, 1].slice(0, Math.max(1, this.players.length - 1));
    const gain = {};
    hits.forEach(([id], k) => {
      if (k < awards.length) {
        gain[id] = awards[k];
        this.p(id).score += awards[k];
      }
    });
    this.result = { gain };
    const top = hits[0];
    this.ctx.system(`第${this.round}ラウンド:${top ? `一番は${this.name(top[0])}さん(${top[1].rt}ms)` : '誰も押せず'}`);
    this.card = { ...this.cards[this.targetIdx], i: this.targetIdx, showAt: this.cards[this.targetIdx].showAt };
    this.setPhase('result', RESULT_MS);
    this.later(RESULT_MS, () => this.nextRound());
    this.ctx.update();
  }

  finish() {
    this.clearTimers();
    this.setPhase('ended');
    const top = [...this.players].sort((a, b) => b.score - a.score)[0];
    const fast = this.players.filter((p) => p.best !== null).sort((a, b) => a.best - b.best)[0];
    this.ctx.system(`ゲーム終了。優勝は${this.name(top.id)}さん(${top.score}点)${fast ? `。最速反応は${this.name(fast.id)}さんの${fast.best}ms` : ''}`);
    this.ctx.update();
  }

  action(pid, type, payload, { isHost }) {
    const p = this.p(pid);
    if (type === 'press' && p) return this.press(p, payload);
    if (type === 'finish' && this.phase === 'ended' && isHost) return this.ctx.finish();
  }

  onJoin(id) {
    this.left.delete(id);
    if (!this.p(id)) this.players.push({ id, score: 0, best: null, hits: 0, fouls: 0 });
  }
  onLeave(id) {
    this.left.add(id);
    this.onConnectionChange();
  }
  onConnectionChange() {
    if (this.phase === 'run' && this.card?.i === this.targetIdx && !this.eligible().length) this.resolve();
  }

  view(pid) {
    const me = this.presses?.get(pid);
    const showAll = this.phase === 'result';
    return {
      phase: this.phase,
      seq: this.seq,
      round: Math.min(this.round, this.s.rounds),
      rounds: this.s.rounds,
      endsAt: this.endsAt,
      rule: this.phase === 'ended' ? null : this.rule?.parts,
      card: this.card,
      mine: me ? { kind: me.kind, rt: showAll || me.kind !== 'hit' ? me.rt : me.rt } : null,
      players: [...this.players]
        .sort((a, b) => b.score - a.score || (a.best ?? 1e9) - (b.best ?? 1e9))
        .map((p) => {
          const x = this.presses?.get(p.id);
          return {
            id: p.id,
            name: this.name(p.id),
            score: p.score,
            best: p.best,
            hits: p.hits,
            fouls: p.fouls,
            connected: this.on(p.id),
            // 走っている間は「押した/お手つき」だけ。反応時間は結果で公開
            state: x ? (x.kind === 'hit' && !showAll ? 'pressed' : x.kind) : null,
            rt: showAll && x ? x.rt : null,
            gain: showAll ? this.result?.gain[p.id] ?? 0 : null,
          };
        }),
    };
  }
}

module.exports = {
  id: 'hansha',
  name: 'フェイント早押し',
  tagline: 'お題のカードが出た瞬間に押す。似たカードに釣られたらお手つき。',
  description:
    '「🍎が出たら押す」「文字と色が一致したら押す」などのお題が出て、カードが次々にめくられます。お題に合うカードが出た瞬間に押し、速い順に3点・2点・1点。' +
    '違うカードで押すとお手つき(−1点)。反応時間はミリ秒で表示され、自分の画面に出てから押すまでで比べるので、回線の速さでは差がつきません。',
  minPlayers: 2,
  maxPlayers: 12,
  settings: [
    { key: 'rounds', label: 'ラウンド数', default: 8, options: [5, 8, 12].map((n) => ({ value: n, label: `${n}ラウンド` })) },
    {
      key: 'level',
      label: 'お題',
      default: 'mix',
      options: [
        { value: 'mix', label: 'ぜんぶ(色と文字・足し算・1つ前と同じ も出る)' },
        { value: 'easy', label: 'やさしめ(絵・漢字・色だけ)' },
      ],
    },
  ],
  client: ['buzz-client.js', 'hansha.js'],
  create: (ctx, settings, playerIds) => new HanshaGame(ctx, settings, playerIds),
  _internal: { RULES },
};
