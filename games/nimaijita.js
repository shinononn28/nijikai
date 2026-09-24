// 二枚舌(二枚舌の酒場):赤と青の陣営に分かれて、誰が味方かわからないままダイスの嘘を読み合う陣営戦ライアーズダイス。
// ルールとCPUは public/games/nimaijita-engine.js(元のエンジンをそのまま使用)。
// このファイルはエンジンを二次会卓の部屋・チャットにつなぐアダプター。
const engineLib = require('../public/games/nimaijita-engine.js');

const LOG_LIMIT = 600;
const secs = (list) => list.map((n) => ({ value: n, label: n >= 60 && n % 60 === 0 ? `${n / 60}分` : `${n}秒` }));

class NimaijitaGame {
  constructor(ctx, s, humanIds) {
    this.ctx = ctx;
    this.ids = [...humanIds];
    this.logs = Object.fromEntries(this.ids.map((id) => [id, []]));
    this.stopped = false;
    this.relaying = false;
    this.updateTimer = null;
    this.game = engineLib.createGame({
      humans: this.ids.map((id) => ({ id, name: ctx.nameOf(id) })),
      total: Math.max(s.n, this.ids.length),
      speed: 1,
      botChat: s.botChat,
      emit: (to, type, data) => this.emit(to, type, data),
      timeouts: {
        turn: s.turn * 1000,
        prep: s.prep * 1000,
        matta: 15000,
        partner: 30000,
        mitsudan: s.mitsudan * 1000,
        accuse: s.accuse * 1000,
      },
    });
    // 画面の準備(最初の view の送信)が済んでから始める
    this.startTimer = setTimeout(() => this.game.start(), 300);
  }

  emit(to, type, data) {
    if (this.stopped) return;
    if (type === 'state') return this.scheduleUpdate();

    // 卓での発言は二次会卓のチャットに流す
    if (type === 'log' && data.kind === 'chat') {
      if (this.relaying) return; // チャット欄から送られた発言そのもの
      if (this.ids.includes(data.from)) {
        this.ctx.post({ type: 'user', playerId: data.from, name: this.ctx.nameOf(data.from), text: data.text });
      } else {
        this.ctx.say(data.from, `${data.name}(CPU)`, data.text);
      }
      return;
    }

    const targets = to === '*' ? this.ids : [to];
    for (const id of targets) {
      if (!this.logs[id]) continue;
      if (type === 'log') {
        this.logs[id].push(data);
        if (this.logs[id].length > LOG_LIMIT) this.logs[id].shift();
      }
      this.ctx.emitTo(id, type, data);
    }
  }

  scheduleUpdate() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      if (!this.stopped) this.ctx.update();
    }, 0);
  }

  action(pid, type, payload, { isHost }) {
    if (!this.ids.includes(pid)) return;
    if (type === 'respond') this.game.respond(pid, payload.kind, payload.value);
    else if (type === 'card') this.game.action(pid, { ...payload, type: 'card' });
    else if (type === 'dm') this.game.dm(pid, payload);
    else if (type === 'finish' && isHost && this.game.isOver()) this.ctx.finish();
  }

  // 全体チャットの発言は卓での発言としても扱う(CPUが反応し、推理の材料にする)
  onPublicChat(pid, text) {
    if (!this.ids.includes(pid) || this.game.isOver()) return;
    this.relaying = true;
    try {
      this.game.chat(pid, text);
    } finally {
      this.relaying = false;
    }
  }

  backlog(pid) {
    return this.logs[pid] ? [{ type: 'logs', data: this.logs[pid] }] : [];
  }

  view(pid) {
    const v = this.ids.includes(pid) ? this.game.view(pid) : null;
    return v || { spectator: true };
  }

  onJoin() {}

  onLeave(id) {
    if (this.ids.includes(id)) this.game.setConnected(id, false);
  }

  onConnectionChange() {
    for (const id of this.ids) this.game.setConnected(id, this.ctx.isConnected(id));
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.startTimer);
    clearTimeout(this.updateTimer);
    this.game.stop();
  }
}

module.exports = {
  id: 'nimaijita',
  name: '二枚舌',
  tagline: '赤と青に分かれ、誰が味方かわからないままダイスの嘘を読み合う陣営戦ライアーズダイス。',
  description:
    '全員がこっそり赤と青に分かれ(奇数なら詐欺師が1人)、ダイスの個数を宣言し合ってダウトで金貨を奪い合います。' +
    'カードで陣営を調べたり、濡れ衣を着せたり。折り返しで密談、最後に全員の陣営を告発して、金貨の合計が多い陣営の勝ち。',
  minPlayers: 1,
  maxPlayers: 6,
  cpu: true, // CPUの数は「卓の人数」で決まる
  settings: [
    { key: 'n', label: '卓の人数', default: 5, options: [4, 5, 6].map((n) => ({ value: n, label: `${n}人(足りない分はCPU)` })) },
    {
      key: 'botChat',
      label: 'CPUの発言',
      default: 'on',
      options: [
        { value: 'on', label: 'あり' },
        { value: 'low', label: '推理だけ' },
        { value: 'off', label: 'なし' },
      ],
    },
    { key: 'turn', label: '手番の時間', default: 60, options: secs([30, 60, 90, 120]) },
    { key: 'prep', label: 'ラウンド準備', default: 45, options: secs([30, 45, 60]) },
    { key: 'mitsudan', label: '密談の時間', default: 180, options: secs([120, 180, 300]) },
    { key: 'accuse', label: '告発の時間', default: 90, options: secs([60, 90, 120]) },
  ],
  create: (ctx, settings, playerIds) => new NimaijitaGame(ctx, settings, playerIds),
};
