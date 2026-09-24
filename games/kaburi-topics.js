// お題の素材。i: true のカテゴリは頭文字縛りと組み合わせられる(答えが十分に多いもの)。
// ここに行を足すだけでお題が増える。
const CATEGORIES = [
  { t: '動物', i: true },
  { t: '食べ物', i: true },
  { t: '果物' },
  { t: '野菜' },
  { t: '飲み物' },
  { t: 'お菓子', i: true },
  { t: '料理', i: true },
  { t: '麺類' },
  { t: 'パンの種類' },
  { t: '調味料' },
  { t: '寿司ネタ' },
  { t: '国', i: true },
  { t: '日本の地名', i: true },
  { t: '職業', i: true },
  { t: 'スポーツ' },
  { t: '楽器' },
  { t: '乗り物' },
  { t: '体の部位', i: true },
  { t: '色' },
  { t: '花' },
  { t: '虫' },
  { t: '海の生き物' },
  { t: '鳥' },
  { t: '家にあるもの', i: true },
  { t: '台所にあるもの' },
  { t: '文房具' },
  { t: '身につけるもの', i: true },
  { t: '学校にあるもの', i: true },
  { t: 'コンビニで買えるもの', i: true },
  { t: '遊園地にあるもの' },
  { t: '趣味', i: true },
  { t: '天気・自然現象' },
  { t: '病院にあるもの' },
  { t: '丸いもの', i: true },
  { t: '四角いもの', i: true },
  { t: '赤いもの', i: true },
  { t: '白いもの', i: true },
  { t: '黒いもの', i: true },
  { t: '硬いもの', i: true },
  { t: '柔らかいもの', i: true },
  { t: '冷たいもの', i: true },
  { t: '熱いもの', i: true },
  { t: '光るもの' },
  { t: 'いい匂いがするもの' },
  { t: '音が出るもの', i: true },
  { t: '重いもの', i: true },
  { t: '小さいもの', i: true },
  { t: '長いもの', i: true },
  { t: '空を飛ぶもの' },
  { t: '水に浮くもの' },
  { t: '夏っぽいもの', i: true },
  { t: '冬っぽいもの', i: true },
  { t: '旅行に持っていくもの' },
  { t: 'お祭りにあるもの' },
  { t: '宇宙にあるもの' },
  { t: 'ファンタジーのモンスター' },
  { t: '神話・伝説に出てくるもの' },
  { t: '武器' },
  { t: '冒険者の持ち物', i: true },
  { t: 'お城にあるもの' },
  { t: '魔法使いっぽいもの' },
  { t: 'ボードゲームやカードゲームで使うもの' },
  { t: 'カタカナ5文字の言葉', i: true },
  { t: '漢字2文字の言葉', i: true },
  { t: 'ひらがな3文字の言葉', i: true },
];

// 答えを出しにくい頭文字(ぬ・を・ん など)は外している
const KANA = 'あいうえおかきくけこさしすせそたちつてとなにねのはひふへほまみむめもやゆよらりれろわ'.split('');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function formatTopic({ category, initial }) {
  return initial ? `「${initial}」で始まる${category}` : category;
}

/**
 * @param {'off'|'on'|'mix'} mode 頭文字縛り
 * @param {Set<string>} used 同じゲーム内で使ったお題
 */
function pickTopic(mode, used) {
  const useInitial = mode === 'on' || (mode === 'mix' && Math.random() < 0.4);
  const pool = useInitial ? CATEGORIES.filter((c) => c.i) : CATEGORIES;
  let topic;
  for (let tries = 0; tries < 60; tries++) {
    topic = { category: rand(pool).t, initial: useInitial ? rand(KANA) : null };
    topic.text = formatTopic(topic);
    if (!used.has(topic.text)) break;
  }
  return topic;
}

module.exports = { pickTopic, CATEGORIES, KANA };
