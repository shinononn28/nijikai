// ゲームの一覧。新しいゲームはここに追加する。
// 実装済みのゲームは create(ctx, settings, playerIds) を持ち、
// 返すオブジェクトに action / view / onJoin / onLeave / onConnectionChange / dispose を実装する。
const kaburi = require('./kaburi');
const moon = require('./moon');
const kaito = require('./kaito');
const nimaijita = require('./nimaijita');
const gaikou = require('./gaikou');
const meikyu = require('./meikyu');
const kijun = require('./kijun');
const trick = require('./trick');
const jinushi = require('./jinushi');
const course = require('./course');

const catalog = [
  kaburi,
  kijun,
  moon,
  kaito,
  nimaijita,
  gaikou,
  meikyu,
  trick,
  jinushi,
  course,
];

const getGame = (id) => catalog.find((g) => g.id === id) || null;

module.exports = { catalog, getGame };
