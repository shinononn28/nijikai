// 多数欠
// 10点がAとB(5人以上ならA・B・C)にランダムに分けられる。全員がどれか1つに投票し、
// 票が一番少なかった選択肢に入れた人(少数派)だけが、その選択肢の点数をもらえる。
// 少数派が1人だけなら点数2倍。同数で少数派が決まらない・全員同じ、なら誰も得点なし。
// 設定で「事前宣言」(守らなくていい宣言を先に公開する)を入れられる。

const LABELS = ['A', 'B', 'C'];
const CPU_NAMES = ['ハル', 'ナギ', 'ソラ'];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function split10(k) {
  if (k === 2) {
    const a = rint(0, 10);
    return [a, 10 - a];
  }
  const x = rint(0, 10);
  const y = rint(0, 10);
  const [lo, hi] = [Math.min(x, y), Math.max(x, y)];
  return [lo, hi - lo, 10 - hi];
}

class TasuketsuGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.players = humanIds.map((id) => ({ id, cpu: false, score: 0 }));
    for (let i = 0; i < (settings.cpu || 0); i++) this.players.push({ id: `cpu-${i + 1}`, cpu: true, name: `${CPU_NAMES[i]}(CPU)`, score: 0 });
    this.k = settings.choices === 'auto' ? (this.players.length >= 5 ? 3 : 2) : Number(settings.choices);
    this.round = 0;
    this.history = [];
    this.seq = 0;
    this.ctx.system(`多数欠。全${settings.rounds}ラウンド、${LABELS.slice(0, this.k).join('・')}の${this.k}択。票が一番少ない方に入れた人だけが得点します`);
    this.nextRound();
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
  p(id) {
    return this.players.find((x) => x.id === id);
  }
  name(p) {
    return p.cpu ? p.name : this.ctx.nameOf(p.id);
  }
  active(p) {
    return p.cpu || this.ctx.isConnected(p.id);
  }

  nextRound() {
    this.clearTimers();
    this.round++;
    if (this.round > this.s.rounds) return this.finish();
    this.points = split10(this.k);
    this.declares = {};
    this.votes = {};
    this.result = null;
    if (this.s.declare) this.startPhase('declare', 20000, () => this.startVote());
    else this.startVote();
  }

  startPhase(phase, ms, onEnd) {
    this.clearTimers();
    this.phase = phase;
    this.endsAt = Date.now() + ms;
    this.seq++;
    this.later(ms, onEnd);
    // CPUも宣言・投票する
    for (const p of this.players.filter((x) => x.cpu)) this.later(rint(1500, Math.min(ms - 500, 6000)), () => this.cpuAct(p));
    this.ctx.update();
  }

  startVote() {
    if (this.phase === 'declare') this.ctx.system(`宣言:${this.players.map((p) => `${this.name(p)}→${this.declares[p.id] !== undefined ? LABELS[this.declares[p.id]] : '?'}`).join(' / ')}`);
    this.startPhase('vote', this.s.voteSeconds * 1000, () => this.resolve());
  }

  choose(p, i) {
    if (!(i >= 0 && i < this.k)) return;
    if (this.phase === 'declare') {
      this.declares[p.id] = i;
      if (this.players.every((x) => !this.active(x) || this.declares[x.id] !== undefined)) this.startVote();
    } else if (this.phase === 'vote') {
      this.votes[p.id] = i;
      if (this.players.every((x) => !this.active(x) || this.votes[x.id] !== undefined)) this.resolve();
    }
  }

  // CPU:点数の高い方に少しだけ寄せつつ、ばらけるように選ぶ
  cpuAct(p) {
    if (!['declare', 'vote'].includes(this.phase)) return;
    const w = this.points.map((pt) => 1 + pt * 0.15 + Math.random() * 2);
    let i = w.indexOf(Math.max(...w));
    if (this.phase === 'vote' && this.s.declare && Math.random() < 0.5) {
      // 宣言で多数派になりそうな方を避ける
      const dc = LABELS.slice(0, this.k).map((_, j) => Object.values(this.declares).filter((x) => x === j).length);
      i = dc.indexOf(Math.min(...dc));
    }
    this.choose(p, i);
    this.ctx.update();
  }

  resolve() {
    if (this.phase !== 'vote') return;
    this.clearTimers();
    const counts = LABELS.slice(0, this.k).map((_, i) => Object.values(this.votes).filter((v) => v === i).length);
    const used = counts.map((c, i) => [c, i]).filter(([c]) => c > 0);
    let minority = [];
    let note;
    if (used.length <= 1) note = used.length ? '全員が同じ選択肢!少数派なしで誰も得点なし' : '誰も投票しなかった';
    else {
      const min = Math.min(...used.map(([c]) => c));
      const max = Math.max(...used.map(([c]) => c));
      if (min === max) note = '同数で少数派が決まらず、誰も得点なし';
      else minority = used.filter(([c]) => c === min).map(([, i]) => i);
    }
    const gain = Object.fromEntries(this.players.map((p) => [p.id, 0]));
    for (const i of minority) {
      const voters = this.players.filter((p) => this.votes[p.id] === i);
      const pts = this.points[i] * (voters.length === 1 ? 2 : 1);
      for (const p of voters) {
        gain[p.id] += pts;
        p.score += pts;
      }
    }
    if (minority.length) {
      note = minority
        .map((i) => {
          const voters = this.players.filter((p) => this.votes[p.id] === i);
          return `少数派は${LABELS[i]}(${voters.map((p) => this.name(p)).join('・')})${voters.length === 1 ? `、ひとりだけで${this.points[i]}×2点` : `、${this.points[i]}点ずつ`}`;
        })
        .join('。');
    }
    this.result = { counts, minority, gain, note };
    this.history.push({ round: this.round, points: this.points, counts, minority });
    this.phase = 'result';
    this.endsAt = null;
    this.seq++;
    this.ctx.system(`第${this.round}ラウンド(${this.points.map((pt, i) => `${LABELS[i]}${pt}`).join('・')}):${note}`);
    this.later(7000, () => this.nextRound());
    this.ctx.update();
  }

  finish() {
    this.clearTimers();
    this.phase = 'ended';
    this.seq++;
    const top = [...this.players].sort((a, b) => b.score - a.score)[0];
    this.ctx.system(`ゲーム終了。優勝は${this.name(top)}(${top.score}点)`);
    this.ctx.update();
  }

  action(pid, type, payload, { isHost }) {
    const p = this.p(pid);
    if (type === 'choose' && p) this.choose(p, Number(payload.i));
    else if (type === 'finish' && this.phase === 'ended' && isHost) return this.ctx.finish();
    else return;
    this.ctx.update();
  }

  onJoin() {}

  onLeave(id) {
    const p = this.p(id);
    if (!p) return;
    p.cpu = true;
    p.name = `${this.ctx.nameOf(id)}(CPU代行)`;
    if (['declare', 'vote'].includes(this.phase)) this.later(800, () => this.cpuAct(p));
  }

  onConnectionChange() {
    if (this.phase === 'declare' && this.players.every((x) => !this.active(x) || this.declares[x.id] !== undefined)) this.startVote();
    else if (this.phase === 'vote' && this.players.every((x) => !this.active(x) || this.votes[x.id] !== undefined)) this.resolve();
  }

  view(pid) {
    const showVotes = ['result', 'ended'].includes(this.phase);
    return {
      phase: this.phase,
      seq: this.seq,
      round: Math.min(this.round, this.s.rounds),
      rounds: this.s.rounds,
      k: this.k,
      labels: LABELS.slice(0, this.k),
      points: this.points,
      endsAt: this.endsAt,
      declareOn: !!this.s.declare,
      myDeclare: this.declares[pid] ?? null,
      myVote: this.votes[pid] ?? null,
      players: [...this.players].sort((a, b) => b.score - a.score).map((p) => ({
        id: p.id,
        name: this.name(p),
        cpu: p.cpu,
        score: p.score,
        declared: this.phase === 'declare' ? this.declares[p.id] !== undefined : null,
        declare: this.phase !== 'declare' ? this.declares[p.id] ?? null : null,
        voted: this.phase === 'vote' ? this.votes[p.id] !== undefined : null,
        vote: showVotes ? this.votes[p.id] ?? null : null,
        gain: this.result ? this.result.gain[p.id] : null,
      })),
      result: this.result,
      history: this.history,
    };
  }
}

module.exports = {
  id: 'tasuketsu',
  name: '多数欠',
  tagline: '10点がランダムに分かれた選択肢に投票。少数派だけが点数をもらえる。',
  description:
    '10点がA・B(5人以上ならA・B・C)にランダムに分けられ、全員がどれか1つに投票します。票が一番少なかった選択肢に入れた人だけが、その点数をもらえます。' +
    '少数派が1人だけなら2倍。同数や全員同じなら誰も得点なし。設定で、守らなくていい「事前宣言」を入れられます。',
  minPlayers: 3,
  maxPlayers: 12,
  cpu: true,
  settings: [
    { key: 'cpu', label: 'CPUの人数', default: 0, options: [0, 1, 2, 3].map((n) => ({ value: n, label: n ? `${n}人` : 'なし' })) },
    { key: 'rounds', label: 'ラウンド数', default: 10, options: [5, 10, 15].map((n) => ({ value: n, label: `${n}ラウンド` })) },
    {
      key: 'choices',
      label: '選択肢',
      default: 'auto',
      options: [
        { value: 'auto', label: 'おまかせ(4人まで2択・5人から3択)' },
        { value: '2', label: 'いつも2択' },
        { value: '3', label: 'いつも3択' },
      ],
    },
    {
      key: 'declare',
      label: '事前宣言',
      default: false,
      options: [
        { value: false, label: 'なし' },
        { value: true, label: 'あり(守らなくていい宣言を先に公開)' },
      ],
    },
    { key: 'voteSeconds', label: '投票の時間', default: 30, options: [20, 30, 45].map((n) => ({ value: n, label: `${n}秒` })) },
  ],
  create: (ctx, settings, playerIds) => new TasuketsuGame(ctx, settings, playerIds),
};
