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

module.exports = { clampPressAt, collectWindow, displayLead };
