// 価値観スライダー
// 答える人が「計画派 ⇔ 行き当たりばったり」のような物差しに、自分の位置を0〜100でこっそり置く。
// ほかの人は「あの人ならこのへん」と予想して置き、近いほど得点。物差しは候補から選ぶか、答える人が自分で書ける。

const SPECTRUMS = [
  ['計画派', '行き当たりばったり'], ['インドア', 'アウトドア'], ['朝型', '夜型'], ['甘党', '辛党'], ['慎重', '大胆'],
  ['聞き役', '話し役'], ['節約家', '浪費家'], ['ひとりが好き', '大勢が好き'], ['理屈で考える', '感覚で動く'], ['几帳面', '大雑把'],
  ['犬派', '猫派'], ['和食派', '洋食派'], ['現実的', '夢見がち'], ['先延ばし', 'すぐやる'], ['負けず嫌い', '勝ち負けどうでもいい'],
  ['寒がり', '暑がり'], ['方向音痴', '地図いらず'], ['流行に乗る', 'わが道を行く'], ['部屋はきれい', '部屋は散らかっている'], ['人見知り', '誰とでもすぐ仲良く'],
  ['早食い', 'ゆっくり食べる'], ['貯める', '使う'], ['山派', '海派'], ['映画は字幕', '映画は吹き替え'], ['紙の本', '電子書籍'],
  ['ツッコミ', 'ボケ'], ['晴れ男・晴れ女', '雨男・雨女'], ['くじ運が悪い', 'くじ運が良い'], ['涙もろい', '泣かない'], ['朝ごはんは和食', '朝ごはんはパン'],
  ['ルールを読み込む', 'ルールは遊びながら覚える'], ['キャラは作り込む', 'キャラはその場で決める'], ['戦闘が好き', 'ロールプレイが好き'], ['ダイス運が悪い', 'ダイス運が良い'], ['GM向き', 'プレイヤー向き'],
  ['リーダー役', 'サポート役'], ['慎重に探索する', '罠ごと突っ込む'], ['メタ読みする', 'キャラになりきる'], ['シナリオは王道が好き', 'シナリオは変化球が好き'], ['ホラーが得意', 'ホラーが苦手'],
  ['占いを信じる', '占いは信じない'], ['恋愛は追う', '恋愛は追われる'], ['LINEの返信が早い', 'LINEの返信が遅い'], ['旅行はきっちり予定', '旅行はノープラン'], ['ラーメンはあっさり', 'ラーメンはこってり'],
];

const PHASE_MS = { topic: 35000, answer: 45000 };
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
// 予想と本人の位置の差 → 得点
const pointsFor = (d) => (d <= 5 ? 5 : d <= 10 ? 3 : d <= 20 ? 2 : d <= 30 ? 1 : 0);

class SliderGame {
  constructor(ctx, settings, humanIds) {
    this.ctx = ctx;
    this.s = settings;
    this.timers = new Set();
    this.players = humanIds.map((id) => ({ id, score: 0 }));
    this.order = [];
    for (let l = 0; l < settings.laps; l++) this.order.push(...shuffle(humanIds));
    this.turnIndex = -1;
    this.deck = shuffle(SPECTRUMS);
    this.seq = 0;
    this.ctx.system(`価値観スライダー。全${this.order.length}回、答える人は順番に交代します`);
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
  draw3() {
    if (this.deck.length < 3) this.deck = shuffle(SPECTRUMS);
    return [this.deck.pop(), this.deck.pop(), this.deck.pop()];
  }

  nextTurn() {
    this.clearTimers();
    this.turnIndex++;
    while (this.turnIndex < this.order.length && !this.p(this.order[this.turnIndex])) this.turnIndex++;
    if (this.turnIndex >= this.order.length) return this.finish();
    this.target = this.order[this.turnIndex];
    this.options = this.draw3();
    this.rerolls = 2;
    this.spectrum = null;
    this.values = {};
    this.result = null;
    this.phase = 'topic';
    this.endsAt = Date.now() + PHASE_MS.topic;
    this.seq++;
    this.later(PHASE_MS.topic, () => this.setSpectrum(this.target, this.options[0]));
    this.ctx.update();
  }

  setSpectrum(pid, pair, custom = false) {
    if (this.phase !== 'topic' || pid !== this.target) return;
    const left = clean(pair?.[0]);
    const right = clean(pair?.[1]);
    if (!left || !right) return;
    this.clearTimers();
    this.spectrum = { left, right, custom };
    this.phase = 'answer';
    this.endsAt = Date.now() + PHASE_MS.answer;
    this.seq++;
    this.later(PHASE_MS.answer, () => this.reveal());
    this.ctx.system(`${this.name(pid)}さんの物差しは「${left} ⇔ ${right}」。${this.name(pid)}さんはどのへん?`);
    this.ctx.update();
  }

  submit(pid, value) {
    if (this.phase !== 'answer' || !this.p(pid)) return;
    const v = Math.max(0, Math.min(100, Math.round(Number(value))));
    if (!Number.isFinite(v)) return;
    this.values[pid] = v;
    if (this.players.every((p) => this.values[p.id] !== undefined || !this.ctx.isConnected(p.id))) this.reveal();
  }

  reveal() {
    if (this.phase !== 'answer') return;
    this.clearTimers();
    const truth = this.values[this.target];
    const guesses = this.players
      .filter((p) => p.id !== this.target && this.values[p.id] !== undefined)
      .map((p) => {
        const d = truth === undefined ? null : Math.abs(this.values[p.id] - truth);
        const pts = d === null ? 0 : pointsFor(d);
        p.score += pts;
        return { id: p.id, name: this.name(p.id), value: this.values[p.id], diff: d, pts };
      });
    // 答えた人は、よく分かってもらえた(差が15以内の)人数だけ得点
    const understood = guesses.filter((g) => g.diff !== null && g.diff <= 15).length;
    const tp = this.p(this.target);
    if (tp && truth !== undefined) tp.score += understood;
    const best = [...guesses].sort((a, b) => (a.diff ?? 999) - (b.diff ?? 999))[0];
    this.result = { truth: truth ?? null, guesses, understood, best: best?.diff !== null ? best : null };
    this.phase = 'reveal';
    this.endsAt = null;
    this.seq++;
    this.ctx.system(
      truth === undefined
        ? `${this.name(this.target)}さんが位置を置かなかったので、このお題は得点なし`
        : `${this.name(this.target)}さんは ${truth}。一番近かったのは${best ? `${best.name}さん(差${best.diff})` : 'なし'}`,
    );
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

  action(pid, type, payload, { isHost }) {
    switch (type) {
      case 'pick': {
        const pair = this.options?.[Number(payload.i)];
        if (pair) this.setSpectrum(pid, pair);
        return;
      }
      case 'custom':
        this.setSpectrum(pid, [payload.left, payload.right], true);
        return;
      case 'reroll':
        if (this.phase !== 'topic' || pid !== this.target || this.rerolls < 1) return;
        this.rerolls--;
        this.options = this.draw3();
        break;
      case 'submit':
        this.submit(pid, payload.value);
        break;
      case 'next':
        if (this.phase === 'reveal' && isHost) return this.nextTurn();
        return;
      case 'finish':
        if (this.phase === 'ended' && isHost) this.ctx.finish();
        return;
      default:
        return;
    }
    this.ctx.update();
  }

  onJoin(id) {
    if (!this.p(id) && this.phase !== 'ended') {
      this.players.push({ id, score: 0 });
      this.order.push(id);
    }
  }

  onLeave(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.players.length < 2) return this.finish();
    if (id === this.target && ['topic', 'answer'].includes(this.phase)) {
      this.ctx.system('答える人が抜けたので次へ進みます');
      return this.nextTurn();
    }
    this.onConnectionChange();
  }

  onConnectionChange() {
    if (this.phase === 'answer' && this.players.every((p) => this.values[p.id] !== undefined || !this.ctx.isConnected(p.id))) this.reveal();
  }

  view(pid) {
    return {
      phase: this.phase,
      seq: this.seq,
      turn: this.turnIndex + 1,
      turns: this.order.length,
      endsAt: ['topic', 'answer'].includes(this.phase) ? this.endsAt : null,
      target: this.target,
      targetName: this.target ? this.name(this.target) : '',
      options: pid === this.target && this.phase === 'topic' ? this.options : null,
      rerolls: pid === this.target ? this.rerolls : null,
      spectrum: this.spectrum,
      myValue: this.values?.[pid] ?? null,
      players: [...this.players].sort((a, b) => b.score - a.score).map((p) => ({
        id: p.id,
        name: this.name(p.id),
        score: p.score,
        target: p.id === this.target,
        done: this.phase === 'answer' ? this.values[p.id] !== undefined : null,
      })),
      result: this.result,
    };
  }
}

module.exports = {
  id: 'slider',
  name: '価値観スライダー',
  tagline: '「計画派⇔行き当たりばったり」、あの人はどのへん?近いほど得点。',
  description:
    '答える人が、両端のある物差しに自分の位置を0〜100でこっそり置きます。ほかの人は「あの人ならこのへん」と予想して置き、近いほど得点(差5以内で5点)。' +
    '物差しは候補から選ぶか、答える人が自分で書けます。答えた人にも、よく分かってもらえた人数だけ得点が入ります。',
  minPlayers: 3,
  maxPlayers: 10,
  cpu: false,
  settings: [
    { key: 'laps', label: '答える回数', default: 1, options: [1, 2].map((n) => ({ value: n, label: n === 1 ? '全員1回ずつ' : '全員2回ずつ' })) },
  ],
  create: (ctx, settings, playerIds) => new SliderGame(ctx, settings, playerIds),
};
