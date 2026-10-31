/* 早押しの画面側の道具(どの早押しゲームでも使える)。
   ゲームの定義に client: ['buzz-client.js', '<ゲーム>.js'] と書くと window.NijiBuzz で使える。
   サーバー側の対になる道具は games/buzz.js。

   - NijiBuzz.pressAt(api, ev)        押した瞬間(イベントの timeStamp)をサーバーの時計に直した時刻
   - NijiBuzz.bindPress(root, sel, fn) sel のタップ(pointerdown)とスペースキーで fn(ev) を呼ぶ。入力欄にいるときは反応しない
   - new NijiBuzz.Shower(api, draw)   「サーバー時計で showAt に出す」と予約された表示を、その時刻ちょうどに出し、
                                       実際に出た瞬間を覚えておく。reaction(ev) で反応時間を出す */
(function () {
  'use strict';
  if (window.NijiBuzz) return;

  function pressAt(api, ev) {
    const now = performance.now();
    const t = ev && typeof ev.timeStamp === 'number' && ev.timeStamp > 0 ? ev.timeStamp : now;
    const lag = Math.max(0, Math.min(500, now - t));
    return api.now() - lag;
  }

  function bindPress(root, selector, fn) {
    const onPointer = (ev) => {
      if (!ev.target.closest(selector)) return;
      ev.preventDefault();
      fn(ev);
    };
    const onKey = (ev) => {
      if ((ev.code !== 'Space' && ev.key !== ' ') || ev.repeat) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (!root.querySelector(selector)) return;
      ev.preventDefault();
      fn(ev);
    };
    root.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }

  class Shower {
    constructor(api, draw) {
      this.api = api;
      this.draw = draw; // draw(item) で画面に出す
      this.pending = null;
      this.current = null; // { item, perf }
      this.loop = () => {
        this.raf = requestAnimationFrame(this.loop);
        this.tick();
      };
      this.raf = requestAnimationFrame(this.loop);
    }
    // item.showAt(サーバー時計)になったら出す。同じものを何度渡してもよい(key で見分ける)
    set(item, key = item?.i) {
      if (!item) return;
      if (this.current && this.current.key === key) return;
      if (this.pending && this.pending.key === key) return;
      this.pending = { item, key };
    }
    clear() {
      this.pending = null;
      this.current = null;
    }
    tick() {
      const p = this.pending;
      if (!p || this.api.now() < (p.item.showAt || 0)) return;
      this.pending = null;
      this.draw(p.item);
      const cur = { item: p.item, key: p.key, perf: performance.now() };
      this.current = cur;
      // 次のフレームの時刻 ≒ 実際に画面に出た瞬間
      requestAnimationFrame((t) => { cur.perf = t; });
    }
    // いま出ている表示に対する反応。{ item, rt(ミリ秒), pressAt(サーバー時計) }。まだ何も出ていなければ null
    reaction(ev) {
      if (!this.current) return null;
      const t = ev && typeof ev.timeStamp === 'number' && ev.timeStamp > 0 ? ev.timeStamp : performance.now();
      return { item: this.current.item, rt: Math.round(t - this.current.perf), pressAt: pressAt(this.api, ev) };
    }
    destroy() {
      cancelAnimationFrame(this.raf);
    }
  }

  window.NijiBuzz = { pressAt, bindPress, Shower };
})();
