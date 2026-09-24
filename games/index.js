// ゲームの一覧。新しいゲームはここに追加する。
// 実装済みのゲームは create(ctx, settings, playerIds) を持ち、
// 返すオブジェクトに action / view / onJoin / onLeave / onConnectionChange / dispose を実装する。
const kaburi = require('./kaburi');
const moon = require('./moon');

const catalog = [
  kaburi,
  {
    id: 'wasureta',
    name: '忘れた単語',
    tagline: '一瞬だけ見えた単語を思い出す。誰も書かなかった単語だけが得点。',
    minPlayers: 3,
    maxPlayers: 12,
    comingSoon: true,
  },
  moon,
  {
    id: 'kaito',
    name: '怪盗と探偵',
    tagline: '街を逃げ回る怪盗を、探偵たちが包囲する。',
    minPlayers: 3,
    maxPlayers: 6,
    cpu: true,
    comingSoon: true,
  },
];

const getGame = (id) => catalog.find((g) => g.id === id) || null;

module.exports = { catalog, getGame };
