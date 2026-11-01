// ゲームの一覧。新しいゲームはここに追加する。
// 実装済みのゲームは create(ctx, settings, playerIds) を持ち、
// 返すオブジェクトに action / view / onJoin / onLeave / onConnectionChange / dispose を実装する。
const kaburi = require('./kaburi');
const moon = require('./moon');
const kaito = require('./kaito');
const nimaijita = require('./nimaijita');
const gaikou = require('./gaikou');
const kijun = require('./kijun');
const trick = require('./trick');
const course = require('./course');
const oekaki = require('./oekaki');
const dengon = require('./dengon');
const tasuketsu = require('./tasuketsu');
const slider = require('./slider');
const nazuke = require('./nazuke');
const shibari = require('./shibari');

const catalog = [
  kaburi,
  kijun,
  oekaki,
  dengon,
  shibari,
  tasuketsu,
  slider,
  nazuke,
  moon,
  kaito,
  nimaijita,
  gaikou,
  trick,
  course,
];

// 全ゲーム共通の「時間の長さ」の設定欄を足す(games/pace.js)
const { SETTING: PACE } = require('./pace');
for (const g of catalog) {
  g.settings = g.settings || [];
  if (!g.settings.some((f) => f.key === PACE.key)) g.settings.push(PACE);
}

const getGame = (id) => catalog.find((g) => g.id === id) || null;

module.exports = { catalog, getGame };
