/* 文字しばり伝言の「同じ文字」の判定(サーバーと画面で共通)。
   - 全角/半角・大文字/小文字は同じ文字。設定 fold が true ならひらがなとカタカナも同じ文字(「か」と「カ」)。
   - 濁点・半濁点・小さい字は、設定 base が false なら別の文字(「か」「が」「ゃ」「や」は別)、true なら元の字と同じ文字。
   - 設定は { fold, base } で渡す(true/false だけなら fold として扱う)。
   - 空白・句読点・長音「ー」・記号は文字として数えない(いつでも使える)。
   - 1つの伝言の中でも、同じ文字は1回しか使えない(2回目からは使えない文字扱い)。
   サーバー: const R = require('../public/games/shibari-rules.js')
   画面:     ゲームの定義に client: ['shibari-rules.js', 'shibari.js'] と書くと window.ShibariRules で使える */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShibariRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 数えない文字(NFKC で正規化したあとで判定)
  const FREE = /[\s、。,.・ー〜~!?!?…‥「」『』()（）［］\[\]【】〈〉《》"'`:;:;\-‐‑–—―−_/\\|*#&%$@^+=<>{}♪☆★○●◯×]/u;

  const SMALL = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', っ: 'つ', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ', ゕ: 'か', ゖ: 'け',
    ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ', ヵ: 'カ', ヶ: 'ケ' };
  function opt(o) {
    return typeof o === 'object' && o ? { fold: o.fold !== false, base: !!o.base } : { fold: o !== false, base: false };
  }
  function keyOf(ch, o = true) {
    const { fold, base } = opt(o);
    let c = ch.normalize('NFKC').toLowerCase();
    if (base) c = c.normalize('NFD').replace(/[\u3099\u309a]/g, '').replace(/[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ]/g, (k) => SMALL[k]).normalize('NFC');
    if (fold) c = c.replace(/[ァ-ヶ]/g, (k) => String.fromCharCode(k.charCodeAt(0) - 0x60));
    return c;
  }

  // 文の中の「数える文字」を並べたもの(重複あり)
  function chars(text, fold = true) {
    const out = [];
    for (const raw of Array.from(String(text ?? '').normalize('NFKC'))) {
      if (FREE.test(raw)) continue;
      for (const ch of Array.from(keyOf(raw, fold))) if (!FREE.test(ch)) out.push(ch);
    }
    return out;
  }

  // 使えない文字の集合に、文の文字を足す
  function addAll(set, text, fold = true) {
    for (const c of chars(text, fold)) set.add(c);
    return set;
  }

  // 文の1文字ずつに印をつける(画面で赤くする用)。
  // bad: 使えない文字か、この文の中で2回目以降の文字。repeat: 2回目以降だから使えない
  function mark(text, banned, fold = true) {
    const set = banned instanceof Set ? banned : new Set(banned);
    const seen = new Set();
    return Array.from(String(text ?? '')).map((raw) => {
      const n = raw.normalize('NFKC');
      if (FREE.test(n)) return { ch: raw, bad: false, repeat: false };
      const keys = Array.from(keyOf(n, fold)).filter((c) => !FREE.test(c));
      const used = keys.some((c) => set.has(c));
      const repeat = !used && keys.some((c) => seen.has(c));
      keys.forEach((c) => seen.add(c));
      return { ch: raw, bad: used || repeat, repeat };
    });
  }

  // 使えない文字のうち文に入っているもの、と、文の中で2回以上使った文字(どちらも重複なし)
  function problems(text, banned, fold = true) {
    const set = banned instanceof Set ? banned : new Set(banned);
    const list = chars(text, fold);
    const used = [...new Set(list.filter((c) => set.has(c)))];
    const count = {};
    for (const c of list) count[c] = (count[c] || 0) + 1;
    const repeated = Object.keys(count).filter((c) => count[c] > 1 && !set.has(c));
    return { used, repeated };
  }
  function violations(text, banned, fold = true) {
    const p = problems(text, banned, fold);
    return [...p.used, ...p.repeated];
  }

  // 使えない文字を取り除く(時間切れの自動提出用)
  function strip(text, banned, fold = true) {
    return mark(text, banned, fold).filter((x) => !x.bad).map((x) => x.ch).join('').replace(/\s+/g, ' ').trim();
  }

  // 正解の判定用(ひらがな/カタカナ・記号・空白の違いは無視)
  function sameAnswer(a, b) {
    const k = (s) => chars(s, { fold: true, base: false }).join('');
    return !!k(a) && k(a) === k(b);
  }

  // 五十音表(画面で、使えなくなったひらがなを消して見せる)
  const KANA_ROWS = [
    'あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの', 'はひふへほ', 'まみむめも', 'や ゆ よ', 'らりるれろ', 'わを ん ',
    'がぎぐげご', 'ざじずぜぞ', 'だぢづでど', 'ばびぶべぼ', 'ぱぴぷぺぽ', 'ぁぃぅぇぉ', 'ゃゅょっ ',
  ];
  const KANA = new Set(KANA_ROWS.join('').replace(/ /g, ''));
  // 濁点・小さい字をまとめるときは、清音の行だけを表に出す
  const BASE_ROWS = KANA_ROWS.slice(0, 10);

  return { keyOf, chars, addAll, mark, problems, violations, strip, sameAnswer, KANA_ROWS, BASE_ROWS, KANA };
});
