// 怪盗と探偵
// 全員が同時に移動先を決める追跡ゲーム。怪盗はお宝を3つ盗めば勝ち、探偵は確保するか守り切れば勝ち。
// 探偵には作戦チャットがあり、発言は一定確率で伏せ字まじりに怪盗へ漏れる(盗聴)。
// 作戦チャットには本物の目撃通報が届くが、怪盗も同じ見た目の偽の通報を送り込める。
const { generateMap, spreadPick, TREASURE_NAMES } = require('./kaito-map');

const TRANSPORT = { walk: '徒歩', bus: 'バス', subway: '地下鉄' };
const REVEAL_TURNS = [3, 6, 9];
const NEED_STEAL = 3;
const TICKETS = { bus: 4, subway: 2 };
const CPU_DETECTIVE_NAMES = ['犬塚', '鷹野', '猫田', '狐坂', '熊谷'];
const COLORS = ['#2f6fb0', '#2f8a5a', '#b0702f', '#7a4fb0', '#b04f7a', '#4f9fb0'];
const TIP_TEMPLATES = [
  (n) => `${n}のあたりで怪盗らしき人物を見た`,
  (n) => `${n}の近くを怪しい人影が走っていった`,
  (n) => `${n}付近で黒いマントを見かけた`,
  (n) => `${n}のそばで不審な足音を聞いた`,
];

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 盗聴した発言は、伏せられる文字のうち4割ほどを◯にする
function maskText(text) {
  const chars = [...text];
  const idx = chars.map((ch, i) => (/[\s、。,.!?!?「」()()ー…・]/.test(ch) ? -1 : i)).filter((i) => i >= 0);
  const hide = new Set(shuffle(idx).slice(0, Math.ceil(idx.length * 0.4)));
  return chars.map((ch, i) => (hide.has(i) ? '◯' : ch)).join('');
}

class KaitoGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.map = generateMap();
    this.maxTurns = settings.turns;

    const humans = shuffle(humanIds);
    const thiefOwner = settings.thiefMode === 'cpu' ? null : humans.shift() ?? null;
    this.thief = { owner: thiefOwner, cpu: !thiefOwner, disguise: 2, double: 1, fakeTips: 3, node: null };

    this.detectives = humans.map((id, i) => ({ id: `d${i + 1}`, owner: id, cpu: false }));
    const cpuNames = shuffle(CPU_DETECTIVE_NAMES);
    while (this.detectives.length < settings.detectives) {
      const i = this.detectives.length;
      this.detectives.push({ id: `d${i + 1}`, owner: null, cpu: true, name: `${cpuNames[i % cpuNames.length]}(CPU)` });
    }
    this.detectives.forEach((d, i) => {
      d.color = COLORS[i % COLORS.length];
      d.tickets = { ...TICKETS };
    });

    // 配置:探偵は散らばせ、お宝は互いに離し、怪盗は探偵から3以上離す
    const starts = spreadPick(this.map, this.detectives.length, 3);
    this.detectives.forEach((d, i) => { d.node = starts[i]; });
    const treasureNodes = spreadPick(this.map, TREASURE_NAMES.length, 2, new Set(starts));
    this.treasures = treasureNodes.map((node, i) => ({ node, name: TREASURE_NAMES[i], stolen: false }));
    const tSet = new Set(treasureNodes);
    const far = (n) => this.detectives.every((d) => this.map.dist[d.node][n] >= 3);
    this.thief.node = spreadPick(this.map, 1, 0, new Set([...starts, ...treasureNodes]), far)[0];
    this.trail = [this.thief.node];

    this.turn = 0;
    this.log = [];
    this.lastKnown = null;
    this.possible = new Set(this.map.nodes.map((n) => n.id).filter((id) => !tSet.has(id) && !starts.includes(id)));
    this.seq = 0;
    this.ctx.system(
      `怪盗は${this.thiefName()}。${this.maxTurns}ターン以内にお宝を${NEED_STEAL}つ盗めば怪盗の勝ち、確保するか守り切れば探偵の勝ちです`,
    );
    this.startTurn();
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
  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  thiefName() {
    return this.thief.owner ? `${this.ctx.nameOf(this.thief.owner)}さん` : 'CPU';
  }
  detName(d) {
    return d.owner ? this.ctx.nameOf(d.owner) : d.name;
  }
  detectiveOwners() {
    return this.detectives.filter((d) => d.owner).map((d) => d.owner);
  }
  pieceOf(pid) {
    if (this.thief.owner === pid) return 'thief';
    return this.detectives.find((d) => d.owner === pid)?.id ?? null;
  }
  nodeName(id) {
    return this.map.nodes[id]?.name ?? '?';
  }
  isHumanActive(ownerId) {
    return ownerId && this.ctx.isConnected(ownerId);
  }

  legalDetective(d) {
    return this.map.adj[d.node].filter((m) => m.type === 'walk' || d.tickets[m.type] > 0);
  }
  legalThief(from) {
    return this.map.adj[from];
  }
  isLeg(from, leg, legal) {
    return legal.some((m) => m.to === leg.to && m.type === leg.type);
  }

  // ---------- ターン ----------
  startTurn() {
    this.turn++;
    this.phase = 'move';
    this.moves = {}; // 'thief' / 探偵のid → 移動
    const ms = this.s.turnSeconds * 1000;
    this.endsAt = Date.now() + ms;
    this.phaseTimer = this.later(ms, () => this.resolve());
    this.seq++;
    this.fakeThisTurn = 0;

    const note = REVEAL_TURNS.includes(this.turn) ? '(このターンの終わりに怪盗の位置が公開されます)' : '';
    this.ctx.system(`${this.turn}ターン目 / ${this.maxTurns}${note}`);

    // 本物の目撃通報(タイミングはランダム。偽の通報と見分けがつかないように)
    if (this.turn > 1 && !REVEAL_TURNS.includes(this.turn - 1) && Math.random() < 0.55) {
      this.later(rint(4000, Math.max(5000, ms - 8000)), () => {
        if (this.phase !== 'move') return;
        const near = [this.thief.node, ...this.map.adj[this.thief.node].filter((m) => m.type === 'walk').map((m) => m.to)];
        this.postTip(pick(near));
      });
    }

    for (const d of this.detectives) if (d.cpu) this.later(rint(2000, 7000), () => this.cpuDetective(d));
    if (this.thief.cpu) {
      this.later(rint(2000, 6000), () => this.cpuThief());
      if (this.turn > 1 && this.thief.fakeTips > 0 && Math.random() < 0.35) {
        this.later(rint(4000, Math.max(5000, ms - 8000)), () => this.cpuFakeTip());
      }
    }
    this.ctx.update();
  }

  postTip(node) {
    const text = `匿名の通報:${pick(TIP_TEMPLATES)(this.nodeName(node))}`;
    this.ctx.post({ type: 'tip', channel: 'detective', channelLabel: '作戦', text }, this.detectiveOwners());
  }

  submitDetective(d, { to, type }) {
    const leg = { to: Number(to), type: String(type) };
    if (!this.isLeg(d.node, leg, this.legalDetective(d))) return false;
    this.moves[d.id] = leg;
    return true;
  }

  submitThief({ path, disguise }) {
    if (!Array.isArray(path) || path.length < 1 || path.length > 2) return false;
    if (path.length === 2 && this.thief.double < 1) return false;
    const legs = [];
    let from = this.thief.node;
    for (const p of path) {
      const leg = { to: Number(p?.to), type: String(p?.type) };
      if (!this.isLeg(from, leg, this.legalThief(from))) return false;
      legs.push(leg);
      from = leg.to;
    }
    this.moves.thief = { legs, disguise: !!disguise && this.thief.disguise > 0 };
    return true;
  }

  checkAllDecided() {
    if (this.phase !== 'move') return;
    const waitingDet = this.detectives.some((d) => !this.moves[d.id] && (d.cpu || this.isHumanActive(d.owner)));
    const waitingThief = !this.moves.thief && (this.thief.cpu || this.isHumanActive(this.thief.owner));
    if (!waitingDet && !waitingThief) this.resolve();
  }

  resolve() {
    if (this.phase !== 'move') return;
    clearTimeout(this.phaseTimer);
    this.timers.delete(this.phaseTimer);
    // 決めなかった人の分はCPUと同じ考え方で埋める
    for (const d of this.detectives) if (!this.moves[d.id]) this.cpuDetective(d, true);
    if (!this.moves.thief) this.cpuThief(true);

    const dm = this.detectives.map((d) => ({ d, from: d.node, to: this.moves[d.id].to, type: this.moves[d.id].type }));
    const tm = this.moves.thief;
    const legs = [];
    let from = this.thief.node;
    for (const leg of tm.legs) {
      legs.push({ from, ...leg });
      from = leg.to;
    }
    const final = from;

    // 確保の判定:同じマスに入る/同じ道ですれ違う/高飛びの途中で鉢合わせ
    let capturedBy = null;
    legs.forEach((leg, i) => {
      for (const m of dm) {
        if (capturedBy) return;
        if (m.from === leg.to && m.to === leg.from) capturedBy = m.d;
        if (i < legs.length - 1 && m.to === leg.to) capturedBy = m.d;
      }
    });
    if (!capturedBy) capturedBy = dm.find((m) => m.to === final)?.d ?? null;

    for (const m of dm) {
      m.d.node = m.to;
      if (m.type !== 'walk') m.d.tickets[m.type]--;
    }
    if (legs.length === 2) this.thief.double--;
    if (tm.disguise) this.thief.disguise--;
    this.thief.node = final;
    for (const leg of legs.slice(0, -1)) this.trail.push(leg.to);
    this.trail.push(final);

    let stolen = null;
    if (!capturedBy) {
      const t = this.treasures.find((x) => x.node === final && !x.stolen);
      if (t) {
        t.stolen = true;
        stolen = t.name;
      }
    }
    const stolenCount = this.treasures.filter((t) => t.stolen).length;
    const revealed = capturedBy || stolen || REVEAL_TURNS.includes(this.turn) ? final : null;
    if (revealed !== null) this.lastKnown = { node: final, turn: this.turn };

    const transports = tm.disguise ? legs.map(() => 'hidden') : legs.map((l) => l.type);
    this.log.push({ turn: this.turn, transports, revealed, stolen, double: legs.length === 2 });
    this.updatePossible(transports, revealed);

    const tText = transports.map((t) => (t === 'hidden' ? '変装(不明)' : TRANSPORT[t])).join('→');
    this.ctx.system(`${this.turn}ターン目の怪盗の移動:${tText}${legs.length === 2 ? '(高飛び)' : ''}`);
    if (stolen) this.ctx.system(`${this.nodeName(final)}で${stolen}が盗まれた!(${stolenCount}/${NEED_STEAL})`);
    else if (revealed !== null && !capturedBy) this.ctx.system(`怪盗の位置が判明:${this.nodeName(final)}`);

    if (capturedBy) return this.end('captured', capturedBy);
    if (stolenCount >= NEED_STEAL) return this.end('stolen');
    if (this.turn >= this.maxTurns) return this.end('timeout');
    this.startTurn();
  }

  // CPU探偵用:公開情報から怪盗がいる可能性のあるマスを絞り込む
  updatePossible(transports, revealed) {
    if (revealed !== null) {
      this.possible = new Set([revealed]);
      return;
    }
    let p = this.possible;
    for (const t of transports) {
      const next = new Set();
      for (const n of p) for (const m of this.map.adj[n]) if (t === 'hidden' || m.type === t) next.add(m.to);
      p = next;
    }
    for (const d of this.detectives) p.delete(d.node);
    for (const t of this.treasures) if (!t.stolen) p.delete(t.node);
    if (p.size === 0) {
      const base = this.lastKnown?.node;
      p = new Set(this.map.nodes.map((n) => n.id).filter((id) => base === undefined || this.map.dist[base][id] <= this.turn - (this.lastKnown?.turn ?? 0) + 1));
    }
    this.possible = p;
  }

  end(kind, by) {
    this.phase = 'ended';
    this.result = { kind, winner: kind === 'captured' || kind === 'timeout' ? 'detectives' : 'thief', by: by?.id ?? null };
    this.seq++;
    const text = {
      captured: `${by && this.detName(by)}が怪盗を確保!探偵の勝ち`,
      stolen: `お宝が${NEED_STEAL}つ盗まれた。怪盗(${this.thiefName()})の勝ち`,
      timeout: `${this.maxTurns}ターン守り切った。探偵の勝ち`,
    }[kind];
    this.ctx.system(text);
    this.ctx.update();
  }

  // ---------- CPU ----------
  cpuDetective(d, sync = false) {
    if (this.phase !== 'move' || this.moves[d.id]) return;
    const legal = this.legalDetective(d);
    if (!legal.length) return;
    const P = [...this.possible];
    const dist = this.map.dist;
    const taken = new Set(this.detectives.filter((x) => x !== d && this.moves[x.id]).map((x) => this.moves[x.id].to));
    const openTreasures = this.treasures.filter((t) => !t.stolen).map((t) => t.node);
    let best = null;
    for (const m of legal) {
      const ds = P.map((p) => dist[m.to][p]);
      const minD = Math.min(...ds);
      const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
      const guard = openTreasures.length ? Math.min(...openTreasures.map((t) => dist[m.to][t])) : 0;
      let score = -minD * 2 - avg * (P.length > 6 ? 0.4 : 0.8) - guard * (P.length > 8 ? 0.5 : 0.15);
      if (taken.has(m.to)) score -= 1.5;
      if (m.type === 'bus') score -= 0.4;
      if (m.type === 'subway') score -= 0.8;
      score += Math.random() * 0.6;
      if (!best || score > best.score) best = { score, m };
    }
    this.submitDetective(d, best.m);
    if (!sync) {
      this.checkAllDecided();
      this.ctx.update();
    }
  }

  cpuThief(sync = false) {
    if (this.phase !== 'move' || this.moves.thief) return;
    const dist = this.map.dist;
    const dets = this.detectives.map((d) => d.node);
    const open = this.treasures.filter((t) => !t.stolen).map((t) => t.node);
    const evalNode = (n) => {
      const dmin = Math.min(...dets.map((x) => dist[n][x]));
      let s = dmin === 0 ? -100 : dmin === 1 ? -12 : dmin === 2 ? -2 : 0;
      const tMin = open.length ? Math.min(...open.map((t) => dist[n][t])) : 0;
      s -= tMin * 1.2;
      if (open.includes(n)) s += 6;
      return s + Math.random();
    };
    const from = this.thief.node;
    let best = null;
    for (const m of this.legalThief(from)) {
      const s = evalNode(m.to);
      if (!best || s > best.s) best = { s, path: [m] };
    }
    if (best.s < -8 && this.thief.double > 0) {
      for (const a of this.legalThief(from)) {
        if (dets.includes(a.to)) continue;
        for (const b of this.legalThief(a.to)) {
          const s = evalNode(b.to) - 1;
          if (s > best.s) best = { s, path: [a, b] };
        }
      }
    }
    const fancy = best.path.some((m) => m.type !== 'walk');
    const disguise = this.thief.disguise > 0 && fancy && Math.random() < 0.35;
    this.submitThief({ path: best.path, disguise });
    if (!sync) {
      this.checkAllDecided();
      this.ctx.update();
    }
  }

  cpuFakeTip() {
    if (this.phase !== 'move' || this.thief.fakeTips < 1) return;
    const far = this.map.nodes.filter((n) => this.map.dist[this.thief.node][n.id] >= 3);
    if (!far.length) return;
    this.thief.fakeTips--;
    this.postTip(pick(far).id);
  }

  // ---------- 入力 ----------
  action(pid, type, payload, { isHost }) {
    if (type === 'finish') {
      if (this.phase === 'ended' && isHost) this.ctx.finish();
      return;
    }
    if (this.phase !== 'move') return;
    const piece = this.pieceOf(pid);
    if (!piece) return;

    if (type === 'move') {
      const ok = piece === 'thief' ? this.submitThief(payload) : this.submitDetective(this.detectives.find((d) => d.id === piece), payload);
      if (!ok) return;
      this.checkAllDecided();
    } else if (type === 'fakeTip') {
      if (piece !== 'thief' || this.thief.fakeTips < 1) return;
      const node = Number(payload.node);
      if (!this.map.nodes[node]) return;
      this.thief.fakeTips--;
      this.postTip(node);
      this.ctx.post({ type: 'system', text: `偽の通報を送りました(${this.nodeName(node)})。残り${this.thief.fakeTips}回` }, [pid]);
    } else {
      return;
    }
    this.ctx.update();
  }

  // ---------- チャット ----------
  chatChannels(pid) {
    const base = [{ id: 'all', label: '全体' }];
    if (this.phase !== 'ended' && this.detectiveOwners().includes(pid)) base.push({ id: 'detective', label: '作戦', default: true });
    return base;
  }

  chatChannel(pid, channel) {
    if (channel !== 'detective' || this.phase === 'ended' || !this.detectiveOwners().includes(pid)) return null;
    return { label: '作戦', readers: this.detectiveOwners() };
  }

  onChat(pid, channel, text) {
    if (channel !== 'detective' || !this.thief.owner || this.phase === 'ended') return;
    if (Math.random() >= this.s.leakRate) return;
    this.ctx.post(
      { type: 'leak', channel: 'leak', channelLabel: '盗聴', name: this.ctx.nameOf(pid), text: maskText(text) },
      [this.thief.owner],
    );
  }

  // ---------- 参加・退室 ----------
  onJoin() {}

  onLeave(id) {
    if (this.thief.owner === id) {
      this.thief.owner = null;
      this.thief.cpu = true;
      this.ctx.system('怪盗が退室したので、CPUが引き継ぎます');
      if (this.phase === 'move') this.later(1000, () => this.cpuThief());
      return;
    }
    const d = this.detectives.find((x) => x.owner === id);
    if (d) {
      d.name = `${this.ctx.nameOf(id)}(CPU代行)`;
      d.owner = null;
      d.cpu = true;
      this.ctx.system(`${d.name}として、CPUが探偵を引き継ぎます`);
      if (this.phase === 'move') this.later(1000, () => this.cpuDetective(d));
    }
  }

  onConnectionChange() {
    this.checkAllDecided();
  }

  // ---------- 表示用データ ----------
  view(pid) {
    const piece = this.pieceOf(pid);
    const role = piece === 'thief' ? 'thief' : piece ? 'detective' : 'spectator';
    const ended = this.phase === 'ended';
    const showThief = role === 'thief' || ended;
    const v = {
      phase: this.phase,
      seq: this.seq,
      turn: this.turn,
      maxTurns: this.maxTurns,
      revealTurns: REVEAL_TURNS,
      needSteal: NEED_STEAL,
      endsAt: this.phase === 'move' ? this.endsAt : null,
      map: { width: this.map.width, height: this.map.height, nodes: this.map.nodes, edges: this.map.edges },
      treasures: this.treasures,
      detectives: this.detectives.map((d) => ({
        id: d.id,
        name: this.detName(d),
        owner: d.owner,
        cpu: d.cpu,
        node: d.node,
        color: d.color,
        tickets: d.tickets,
        decided: this.phase === 'move' ? !!this.moves[d.id] : null,
      })),
      thief: {
        name: this.thiefName(),
        cpu: this.thief.cpu,
        disguise: this.thief.disguise,
        double: this.thief.double,
        decided: this.phase === 'move' ? !!this.moves.thief : null,
        node: showThief ? this.thief.node : null,
        fakeTips: role === 'thief' ? this.thief.fakeTips : null,
      },
      lastKnown: this.lastKnown,
      log: this.log,
      role,
      myPiece: piece,
      myMove: piece ? this.moves?.[piece] ?? null : null,
    };
    if (ended) {
      v.result = this.result;
      v.trail = this.trail;
    }
    return v;
  }
}

module.exports = {
  id: 'kaito',
  name: '怪盗と探偵',
  tagline: '街を逃げ回る怪盗を、探偵たちが包囲する。',
  description:
    '全員が同時に移動先を決める追跡ゲーム。怪盗は12ターン以内にお宝を3つ盗めば勝ち、探偵は同じマスに入るかすれ違えば確保です。' +
    '探偵だけの作戦チャットは一定確率で怪盗に盗聴され、届く目撃通報には怪盗の偽物が混ざります。',
  minPlayers: 1,
  maxPlayers: 6,
  cpu: true, // CPUの数は設定の cpu ではなく「探偵のコマ数」と怪盗の担当で決まる
  settings: [
    {
      key: 'thiefMode',
      label: '怪盗',
      default: 'random',
      options: [
        { value: 'random', label: '参加者からランダム' },
        { value: 'cpu', label: 'CPU(全員で探偵)' },
      ],
    },
    { key: 'detectives', label: '探偵のコマ', default: 4, options: [3, 4, 5].map((n) => ({ value: n, label: `最低${n}つ(足りない分はCPU)` })) },
    { key: 'turns', label: 'ターン数', default: 12, options: [10, 12, 14].map((n) => ({ value: n, label: `${n}ターン` })) },
    { key: 'turnSeconds', label: '1ターンの時間', default: 90, options: [30, 45, 60, 90, 120, 150, 180].map((n) => ({ value: n, label: `${n}秒` })) },
    {
      key: 'leakRate',
      label: '盗聴される確率',
      default: 0.3,
      options: [
        { value: 0, label: 'なし' },
        { value: 0.2, label: '20%' },
        { value: 0.3, label: '30%' },
        { value: 0.5, label: '50%' },
      ],
    },
  ],
  create: (ctx, settings, playerIds) => new KaitoGame(ctx, settings, playerIds),
};
