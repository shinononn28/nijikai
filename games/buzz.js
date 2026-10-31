// 早押しの公平な判定に使う道具。
//
// 画面は時計合わせをしてあるので、「サーバーの時計で何時に押したか(pressAt)」を送ってくる。
// 回線の遅い人ほど届くのが遅れるので、届いた順ではなく pressAt の早い順で決める。
// ただし pressAt は自己申告なので、サーバーが測った往復時間(ctx.rtt)からありえる範囲に丸める。
//
//   届いた時刻 − 往復時間 − 余裕 ≦ pressAt ≦ 届いた時刻
//
// また、最初の押しが届いてもすぐには決めず、ほかの人の押しが届きうる時間だけ待ってから決める。

const SLACK_MS = 60; // 時計合わせの誤差の見込み
const MAX_RTT_MS = 1500; // これより遅い回線は補正しきれない(補正の上限)

function clampPressAt(claimed, receivedAt, rtt) {
  const r = Math.min(Math.max(rtt || 0, 0), MAX_RTT_MS);
  const lo = receivedAt - r - SLACK_MS;
  const c = Number(claimed);
  if (!Number.isFinite(c)) return receivedAt - r / 2; // 申告がなければ片道ぶん戻す
  return Math.max(lo, Math.min(receivedAt, c));
}

// 最初の押しが届いてから決めるまで待つ時間。ほかの人の片道時間のうち一番長いもの+余裕(上限あり)
function collectWindow(rtts) {
  const oneWay = Math.max(0, ...rtts.map((r) => Math.min(r || 0, MAX_RTT_MS) / 2));
  return Math.min(450, Math.max(80, oneWay + SLACK_MS));
}

// 新しい表示(問題の読み上げ開始・反射のカード)を「少し先の時刻」に予約して、全員の画面で同時に出すための猶予
function displayLead(rtts) {
  const oneWay = Math.max(0, ...rtts.map((r) => Math.min(r || 0, MAX_RTT_MS) / 2));
  return Math.min(700, Math.max(150, oneWay + 100));
}

// ---------- 早押しクイズ型:一番早く押した1人を決める ----------
// const first = new FirstPress({ rtt: (id) => ctx.rtt(id), onDecide: ({ winner, pressAt, losers }) => ... })
// first.press(id, 申告の押した時刻, { others: まだ押せるほかの人の id, notBefore: これより前の押しはこの時刻扱い })
// 最初の押しが届いたら collectWindow だけ待ち、そのあいだに届いた押しの中で一番早い人を onDecide に渡す。
// 決まるまでのあいだは pending に押した人が入っている。フェーズが変わるときは reset() で取り消す。
class FirstPress {
  constructor({ rtt, onDecide }) {
    this.rtt = rtt;
    this.onDecide = onDecide;
    this.pending = [];
    this.timer = null;
  }
  has(id) {
    return this.pending.some((x) => x.id === id);
  }
  press(id, claimed, { others = [], notBefore = -Infinity } = {}) {
    if (this.has(id)) return false;
    const pressAt = Math.max(notBefore, clampPressAt(claimed, Date.now(), this.rtt(id)));
    this.pending.push({ id, pressAt });
    if (!this.timer) this.timer = setTimeout(() => this.decide(), collectWindow(others.filter((x) => x !== id).map((x) => this.rtt(x))));
    return true;
  }
  // 待たずにすぐ決める(締め切りのときなど)。押した人がいなければ false
  decide() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.length) return false;
    const sorted = [...this.pending].sort((a, b) => a.pressAt - b.pressAt);
    this.pending = [];
    this.onDecide({ winner: sorted[0].id, pressAt: sorted[0].pressAt, losers: sorted.slice(1) });
    return true;
  }
  reset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
  }
}

// ---------- 反射型:表示されてから押すまでの時間を判定する ----------
// 画面が測った反応時間(claimedRt)を、サーバーから見てありえる範囲に丸める。minHuman より速ければフライング。
// showAt: その表示をサーバー時計で出す予定だった時刻
function judgeReaction({ claimedRt, claimedPressAt, receivedAt = Date.now(), showAt, rtt, minHuman = 100 }) {
  const r = Math.min(Math.max(rtt || 0, 0), MAX_RTT_MS);
  const pressAt = clampPressAt(claimedPressAt, receivedAt, r);
  const serverRt = pressAt - showAt;
  let rt = Number(claimedRt);
  if (!Number.isFinite(rt)) rt = serverRt;
  // 表示が遅れて届いた人は自分の画面基準で短くなりうるので、下は往復時間ぶんまで許す
  rt = Math.round(Math.max(serverRt - r - 150, Math.min(serverRt + 150, rt)));
  return { rt, flying: rt < minHuman };
}

module.exports = { clampPressAt, collectWindow, displayLead, FirstPress, judgeReaction };
