// 月面基地の酸素
// 共有タンクの酸素を毎日こっそり使う。使うほど得点になるが、尽きれば基地は壊滅。
// 使用量と宣言は同時に決めて一斉公開。「合計 − 宣言合計 − 監視件数」でその日の嘘の量がわかる。
// 生き延びれば得点最多の人、壊滅したら総使用量が最少の人(脱出ポッド)の勝ち。

const EVENTS = {
  calm: { name: '平穏', text: '特に何も起きない。' },
  meteor: { name: '隕石', text: '外壁に穴が開き、酸素が人数分もれる。' },
  supply: { name: '補給船', text: '補給船が到着し、酸素が人数分増える。' },
  storm: { name: '太陽嵐', text: '今日の酸素の生産量が半分になる。' },
  night: { name: '夜間作業', text: '今日の得点が2倍になる。' },
  saving: { name: '節電命令', text: '今日の使用量と宣言の上限は2。' },
  census: { name: '全数調査', text: '今日の使用量の内訳が公開される(誰がどれかは伏せる)。' },
  jam: { name: '通信障害', text: '今日は監視ができない。' },
};
// 固定の山札。毎ゲームこれをシャッフルして使う(日数+予報1枚)
const DECK = ['calm', 'calm', 'meteor', 'meteor', 'supply', 'storm', 'night', 'saving', 'census', 'jam'];

const CPU_NAMES = ['ソラ', 'カイ', 'ルナ', 'テツ', 'ミオ', 'ゲン', 'ユキ'];
const PERSONALITIES = ['steady', 'reader', 'greedy'];

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const eventInfo = (key) => (key ? { key, ...EVENTS[key] } : null);

class MoonGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.players = humanIds.map((id) => ({ id, cpu: null, name: null }));
    const names = shuffle(CPU_NAMES);
    for (let i = 0; i < (settings.cpu || 0); i++) {
      this.players.push({ id: `cpu-${i + 1}`, cpu: pick(PERSONALITIES), name: `${names[i]}(CPU)` });
    }
    for (const p of this.players) {
      p.points = 0;
      p.used = 0; // 監視分も含む総使用量(脱出ポッドの判定用)
      p.monitorLog = [];
      p.suspect = {}; // CPU用:監視で見抜いた嘘の量
    }
    this.N = this.players.length;
    this.days = settings.days;
    this.tank = this.N * this.days;
    this.tankStart = this.tank;
    this.deck = shuffle(DECK).slice(0, this.days + 1);
    this.day = 0;
    this.history = [];
    this.nextIsolated = null;
    this.seq = 0;
    this.startDay();
  }

  // ---------- 共通 ----------
  later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }
  clearPhaseTimer() {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.timers.delete(this.phaseTimer);
      this.phaseTimer = null;
    }
  }
  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  get(id) {
    return this.players.find((p) => p.id === id);
  }
  nameOf(p) {
    return p.name ?? this.ctx.nameOf(p.id);
  }
  isActive(p) {
    return p.cpu || this.ctx.isConnected(p.id);
  }
  cap() {
    return this.event === 'saving' ? 2 : 4;
  }

  // ---------- 行動フェーズ ----------
  startDay() {
    this.day++;
    this.event = this.deck[this.day - 1];
    this.forecast = this.day < this.days ? this.deck[this.day] : null;
    this.isolated = this.nextIsolated;
    this.nextIsolated = null;
    this.phase = 'action';
    this.actions = {};
    if (this.isolated) this.actions[this.isolated] = { usage: 1, declare: 1, monitor: null, auto: true };
    const ms = this.s.actionSeconds * 1000;
    this.endsAt = Date.now() + ms;
    this.phaseTimer = this.later(ms, () => this.resolve());
    this.seq++;

    const f = this.forecast ? ` 明日の予報は「${EVENTS[this.forecast].name}」` : '';
    this.ctx.system(`${this.day}日目。今日のイベントは「${EVENTS[this.event].name}」(${EVENTS[this.event].text})${f}`);
    if (this.isolated) this.ctx.system(`${this.nameOf(this.get(this.isolated))}は今日は隔離室にいます`);

    for (const p of this.players) {
      if (p.cpu && p.id !== this.isolated) this.later(rint(1500, 6000), () => this.cpuAct(p));
    }
    this.ctx.update();
  }

  submit(p, { usage, declare, monitor }) {
    if (p.id === this.isolated) return;
    const cap = this.cap();
    const u = Number(usage);
    const d = Number(declare);
    if (!Number.isInteger(u) || u < 1 || u > cap) return;
    if (!Number.isInteger(d) || d < 1 || d > cap) return;
    let m = monitor ? String(monitor) : null;
    if (m && (this.event === 'jam' || m === p.id || m === this.isolated || !this.get(m))) m = null;
    this.actions[p.id] = { usage: u, declare: d, monitor: m };
    this.checkAllDecided();
  }

  checkAllDecided() {
    if (this.phase !== 'action') return;
    const waiting = this.players.filter((p) => this.isActive(p) && !this.actions[p.id]);
    if (waiting.length === 0) this.resolve();
  }

  resolve() {
    if (this.phase !== 'action') return;
    this.clearPhaseTimer();
    const N = this.N;
    const mult = this.event === 'night' ? 2 : 1;
    for (const p of this.players) {
      this.actions[p.id] ??= { usage: 1, declare: 1, monitor: null, auto: true };
    }

    let usageSum = 0;
    let declaredSum = 0;
    let monitors = 0;
    const census = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const p of this.players) {
      const a = this.actions[p.id];
      usageSum += a.usage;
      declaredSum += a.declare;
      census[a.usage]++;
      if (a.monitor) monitors++;
      p.points += (a.usage - 1) * mult;
      p.used += a.usage + (a.monitor ? 1 : 0);
    }
    for (const p of this.players) {
      const a = this.actions[p.id];
      if (!a.monitor) continue;
      const target = this.get(a.monitor);
      const value = this.actions[a.monitor].usage;
      p.monitorLog.push({ day: this.day, target: target.id, value });
      const lie = value - this.actions[a.monitor].declare;
      if (lie > 0) p.suspect[target.id] = (p.suspect[target.id] || 0) + lie;
    }

    const totalUse = usageSum + monitors;
    let production = N + rint(0, N);
    if (this.event === 'storm') production = Math.floor(production / 2);
    const eventDelta = this.event === 'meteor' ? -N : this.event === 'supply' ? N : 0;
    const tankBefore = this.tank;
    this.tank = tankBefore + production - totalUse + eventDelta;
    const lie = totalUse - declaredSum - monitors;

    this.history.push({
      day: this.day,
      event: this.event,
      isolated: this.isolated,
      declares: Object.fromEntries(this.players.map((p) => [p.id, this.actions[p.id].declare])),
      auto: this.players.filter((p) => this.actions[p.id].auto && p.id !== this.isolated).map((p) => p.id),
      actual: Object.fromEntries(this.players.map((p) => [p.id, this.actions[p.id].usage])),
      monitoredBy: Object.fromEntries(this.players.filter((p) => this.actions[p.id].monitor).map((p) => [p.id, this.actions[p.id].monitor])),
      totalUse,
      declaredSum,
      monitors,
      lie,
      production,
      eventDelta,
      tankBefore,
      tankAfter: this.tank,
      census: this.event === 'census' ? census : null,
    });

    const lieText = lie === 0 ? 'ズレなし' : `ズレ ${lie > 0 ? '+' : '−'}${Math.abs(lie)}`;
    this.ctx.system(
      `${this.day}日目の結果: 使用 ${totalUse}(宣言合計 ${declaredSum}・監視 ${monitors}件)→ ${lieText}。` +
        `生産 +${production}${eventDelta ? `、${EVENTS[this.event].name} ${eventDelta > 0 ? '+' : '−'}${Math.abs(eventDelta)}` : ''}。タンク残り ${this.tank}`,
    );

    if (this.tank <= 0) return this.end('collapse');
    if (this.day >= this.days) return this.end('survive');
    this.startMeeting();
    this.scheduleCpuTalk();
  }

  // ---------- 会議フェーズ ----------
  startMeeting() {
    this.phase = 'meeting';
    this.votes = {};
    this.ready = new Set();
    const ms = this.s.meetingSeconds * 1000;
    this.endsAt = Date.now() + ms;
    this.phaseTimer = this.later(ms, () => this.closeMeeting());
    this.seq++;
    for (const p of this.players) {
      if (p.cpu) this.later(rint(6000, Math.min(25000, ms - 3000)), () => this.cpuVote(p));
    }
    this.ctx.update();
  }

  majority() {
    return Math.floor(this.N / 2) + 1;
  }

  vote(p, target) {
    if (target === 'none' || target === null) this.votes[p.id] = 'none';
    else if (this.get(target) && target !== p.id) this.votes[p.id] = target;
  }

  checkAllReady() {
    if (this.phase !== 'meeting') return;
    if (this.players.filter((p) => this.isActive(p)).every((p) => this.ready.has(p.id))) this.closeMeeting();
  }

  closeMeeting() {
    if (this.phase !== 'meeting') return;
    this.clearPhaseTimer();
    const count = {};
    for (const t of Object.values(this.votes)) if (t !== 'none') count[t] = (count[t] || 0) + 1;
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= this.majority()) {
      this.nextIsolated = top[0];
      this.ctx.system(`${top[1]}票で${this.nameOf(this.get(top[0]))}を隔離します。明日は使用量1で固定、得点なし`);
    } else {
      this.ctx.system(`隔離なし(過半数は${this.majority()}票)`);
    }
    this.startDay();
  }

  // ---------- 終了 ----------
  end(kind) {
    this.clearPhaseTimer();
    this.phase = 'ended';
    this.result = kind;
    this.seq++;
    const key = kind === 'survive' ? 'points' : 'used';
    const best = kind === 'survive' ? Math.max(...this.players.map((p) => p.points)) : Math.min(...this.players.map((p) => p.used));
    this.winners = this.players.filter((p) => p[key] === best).map((p) => p.id);
    const names = this.winners.map((id) => this.nameOf(this.get(id))).join('、');
    this.ctx.system(
      kind === 'survive'
        ? `基地は${this.days}日間持ちこたえました。得点最多(${best}点)の${names}の勝ち`
        : `酸素が尽きて基地は壊滅しました。総使用量が最少(${best})の${names}が脱出ポッドで生還`,
    );
    this.ctx.update();
  }

  // ---------- CPU ----------
  cpuAct(p) {
    if (this.phase !== 'action' || this.actions[p.id]) return;
    const cap = this.cap();
    const remDays = this.days - this.day + 1;
    let base = 1.5 + this.tank / (this.N * remDays) - 0.6;
    if (['meteor', 'storm'].includes(this.forecast)) base -= 0.2;
    const bias = { steady: -0.4, reader: 0, greedy: 0.5 }[p.cpu];
    const night = this.event === 'night' ? (p.cpu === 'greedy' ? 0.8 : 0.4) : 0;
    const usage = clamp(Math.round(base + bias + night + gauss() * 0.5), 1, cap);

    const honesty = { steady: 0.85, reader: 0.6, greedy: 0.35 }[p.cpu];
    let declare = usage;
    if (Math.random() > honesty) declare = clamp(usage - (p.cpu === 'greedy' ? rint(1, 2) : 1), 1, cap);

    let monitor = null;
    const others = this.players.filter((o) => o.id !== p.id && o.id !== this.isolated);
    const monitorRate = { steady: 0.15, reader: 0.35, greedy: 0.1 }[p.cpu];
    if (this.event !== 'jam' && others.length && Math.random() < monitorRate) {
      const suspects = others.filter((o) => p.suspect[o.id]).sort((a, b) => p.suspect[b.id] - p.suspect[a.id]);
      monitor = (suspects.length && Math.random() < 0.5 ? suspects[0] : pick(others)).id;
    }
    this.submit(p, { usage, declare, monitor });
    this.ctx.update();
  }

  scheduleCpuTalk() {
    if (this.s.cpuChat === false) return;
    const day = this.day;
    const rec = this.history[this.history.length - 1];
    let delay = 1500;
    for (const p of this.players) {
      if (!p.cpu) continue;
      const log = p.monitorLog.find((l) => l.day === day);
      if (log) {
        const r = Math.random();
        const lieRate = { steady: 0, reader: 0.15, greedy: 0.5 }[p.cpu];
        if (p.cpu === 'greedy' && r < 0.3) continue; // 黙っておく
        const value = Math.random() < lieRate ? clamp(log.value + 1, 1, 4) : log.value;
        const target = this.nameOf(this.get(log.target));
        const declared = rec.declares[log.target];
        const line =
          value > declared
            ? pick([`監視したけど、${target}さんは${value}使ってたよ。宣言は${declared}だったよね?`, `${target}さん、実際は${value}だった。宣言と違う`])
            : pick([`${target}さんを監視した。${value}で、宣言どおりだった`, `監視結果、${target}さんは${value}。嘘はついてない`]);
        this.later((delay += rint(1500, 4000)), () => this.phase === 'meeting' && this.day === day && this.ctx.say(p.id, p.name, line));
      } else if (rec.lie >= 2 && Math.random() < 0.25) {
        const line = pick([`ズレが${rec.lie}もあるよ…誰?`, '誰か少なめに宣言してるよね', '私は宣言どおりだよ']);
        this.later((delay += rint(2000, 5000)), () => this.phase === 'meeting' && this.day === day && this.ctx.say(p.id, p.name, line));
      }
    }
  }

  cpuVote(p) {
    if (this.phase !== 'meeting' || this.votes[p.id]) return;
    const others = this.players.filter((o) => o.id !== p.id);
    const suspects = others.filter((o) => (p.suspect[o.id] || 0) >= 1).sort((a, b) => p.suspect[b.id] - p.suspect[a.id]);
    let target = 'none';
    if (suspects.length) target = suspects[0].id;
    else {
      const count = {};
      for (const [voter, t] of Object.entries(this.votes)) if (t !== 'none' && t !== p.id && voter !== p.id) count[t] = (count[t] || 0) + 1;
      const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      if (top && Math.random() < 0.5) target = top[0];
    }
    this.vote(p, target);
    this.ready.add(p.id);
    this.checkAllReady();
    this.ctx.update();
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    const p = this.get(pid);
    if (type === 'finish') {
      if (this.phase === 'ended' && isHost) this.ctx.finish();
      return;
    }
    if (!p || p.cpu) return;
    switch (type) {
      case 'submit':
        if (this.phase !== 'action') return;
        this.submit(p, payload);
        break;
      case 'vote':
        if (this.phase !== 'meeting') return;
        this.vote(p, payload.target);
        break;
      case 'ready':
        if (this.phase !== 'meeting') return;
        if (payload.value === false) this.ready.delete(p.id);
        else this.ready.add(p.id);
        this.checkAllReady();
        break;
      default:
        return;
    }
    this.ctx.update();
  }

  onJoin() {
    // 途中参加は観戦のみ(1ゲームが短いため)
  }

  onLeave(id) {
    const p = this.get(id);
    if (!p || p.cpu) return;
    // 退室した人の席はCPUが引き継ぐ
    p.name = `${this.ctx.nameOf(id) === '(退室済み)' ? '退室者' : this.ctx.nameOf(id)}(CPU代行)`;
    p.cpu = 'steady';
    this.ctx.system(`${p.name}として、CPUが席を引き継ぎます`);
    if (this.phase === 'action') this.later(1000, () => this.cpuAct(p));
    if (this.phase === 'meeting') this.later(2000, () => this.cpuVote(p));
  }

  onConnectionChange() {
    this.checkAllDecided();
    this.checkAllReady();
  }

  // ---------- 表示用データ ----------
  publicHistory() {
    return this.history.map((h) => ({
      day: h.day,
      event: eventInfo(h.event),
      isolated: h.isolated,
      declares: h.declares,
      auto: h.auto,
      totalUse: h.totalUse,
      declaredSum: h.declaredSum,
      monitors: h.monitors,
      lie: h.lie,
      production: h.production,
      eventDelta: h.eventDelta,
      tankBefore: h.tankBefore,
      tankAfter: h.tankAfter,
      census: h.census,
    }));
  }

  view(pid) {
    const me = this.get(pid);
    const v = {
      phase: this.phase,
      seq: this.seq,
      day: this.day,
      days: this.days,
      N: this.N,
      tank: this.tank,
      tankStart: this.tankStart,
      event: eventInfo(this.event),
      forecast: eventInfo(this.forecast),
      endsAt: ['action', 'meeting'].includes(this.phase) ? this.endsAt : null,
      cap: this.cap(),
      canMonitor: this.event !== 'jam',
      isolated: this.isolated,
      majority: this.majority(),
      isParticipant: !!me,
      players: this.players.map((p) => ({
        id: p.id,
        name: this.nameOf(p),
        cpu: !!p.cpu,
        connected: this.isActive(p),
        decided: this.phase === 'action' ? !!this.actions[p.id] : null,
        ready: this.phase === 'meeting' ? this.ready.has(p.id) : null,
      })),
      history: this.publicHistory(),
    };

    if (me) {
      v.me = {
        points: me.points,
        used: me.used,
        monitorLog: me.monitorLog.map((l) => ({ ...l, targetName: this.nameOf(this.get(l.target)) })),
        action: this.phase === 'action' ? this.actions[pid] || null : null,
        isolated: this.isolated === pid,
      };
    }

    if (this.phase === 'meeting') {
      v.votes = this.votes;
    }

    if (this.phase === 'ended') {
      v.result = {
        kind: this.result,
        winners: this.winners,
        players: this.players.map((p) => ({ id: p.id, name: this.nameOf(p), cpu: !!p.cpu, points: p.points, used: p.used })),
        days: this.history.map((h) => ({ day: h.day, event: eventInfo(h.event), actual: h.actual, declares: h.declares, monitoredBy: h.monitoredBy, isolated: h.isolated })),
      };
    }
    return v;
  }
}

const seconds = (list) => list.map((n) => ({ value: n, label: `${n}秒` }));

module.exports = {
  id: 'moon',
  name: '月面基地の酸素',
  tagline: '共有の酸素をこっそり使う。使いすぎた犯人は誰だ。',
  description:
    '毎日、酸素の使用量(1〜4)と、みんなに見せる宣言値を同時に決めます。使った分だけ得点になりますが、タンクが尽きれば基地は壊滅。' +
    '「合計 − 宣言合計 − 監視件数」で嘘の量だけがわかります。生き延びれば得点最多の人、壊滅したら総使用量が最少の人の勝ち。',
  minPlayers: 4,
  maxPlayers: 8,
  cpu: true,
  settings: [
    { key: 'cpu', label: 'CPUの人数', default: 0, options: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n ? `${n}人` : 'なし' })) },
    { key: 'cpuChat', label: 'CPUの発言', default: true, options: [{ value: true, label: 'チャットで話す' }, { value: false, label: '話さない' }] },
    { key: 'days', label: '日数', default: 6, options: [5, 6, 7].map((n) => ({ value: n, label: `${n}日` })) },
    { key: 'actionSeconds', label: '行動時間', default: 60, options: seconds([45, 60, 90]) },
    { key: 'meetingSeconds', label: '会議時間', default: 120, options: seconds([90, 120, 180, 240]) },
  ],
  create: (ctx, settings, playerIds) => new MoonGame(ctx, settings, playerIds),
};
