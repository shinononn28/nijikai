// 全ゲーム共通の「時間の長さ」(短め/ふつう/長め)。
// - ロビーの設定欄は games/index.js がすべてのゲームに自動で足す。
// - ゲームを始めるとき(server.js)に withPace で、設定のうち秒数のもの(〜Seconds / 〜Sec と EXTRA_KEYS)に倍率をかける。
// - コードに書いてある制限時間は、各ゲームで paceMs(settings, ミリ秒) を通す。
// 対象は「回答・入力・相談などの制限時間」だけ。結果の表示や「覚える時間」のような見せる時間は変えない。

const FACTOR = { short: 0.7, normal: 1, long: 1.5 };

const SETTING = {
  key: 'pace',
  label: '時間の長さ(回答・入力の制限時間)',
  default: 'normal',
  options: [
    { value: 'short', label: '短め(×0.7)' },
    { value: 'normal', label: 'ふつう' },
    { value: 'long', label: '長め(×1.5)' },
  ],
};

// 秒数の設定のうち、倍率をかけないもの
const SKIP_KEYS = new Set(['memorySec']);
// 名前が 〜Seconds / 〜Sec ではないが秒数の設定
const EXTRA_KEYS = { nimaijita: ['turn', 'prep', 'mitsudan', 'accuse'] };

const factor = (settings) => FACTOR[settings?.pace] || 1;
const paceMs = (settings, ms) => Math.round(ms * factor(settings));

function withPace(game, settings) {
  const f = factor(settings);
  if (f === 1) return settings;
  const out = { ...settings };
  const extra = new Set(EXTRA_KEYS[game.id] || []);
  for (const [k, v] of Object.entries(settings)) {
    if (SKIP_KEYS.has(k) || typeof v !== 'number' || v <= 0) continue; // 0 は「制限なし」
    if (/(Seconds|Sec)$/.test(k) || extra.has(k)) out[k] = Math.max(5, Math.round(v * f));
  }
  return out;
}

module.exports = { SETTING, FACTOR, factor, paceMs, withPace };
