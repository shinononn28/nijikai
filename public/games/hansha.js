(() => {
  'use strict';

  // フェイント早押しの画面。
  // カードは「サーバー時計で showAt に出す」と予約付きで届くので、その時刻になったら表示する。
  // 実際に表示した瞬間(描画されたフレームの時刻)から押した瞬間(イベントの timeStamp)までを反応時間として送る。

  const INK = { red: '#d33a3a', blue: '#2f6fd0', green: '#2f9a5a', yellow: '#c99a00', purple: '#8a4fc8' };

  class HanshaClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.shownCard = null; // いま画面に出ているカード { i, perf }
      this.pending = null; // 表示待ちのカード
      this.sent = false;
      this.onPointerBound = (e) => this.onPointer(e);
      this.onKeyBound = (e) => this.onKey(e);
      this.onClickBound = (e) => this.onClick(e);
      root.addEventListener('pointerdown', this.onPointerBound);
      root.addEventListener('click', this.onClickBound);
      window.addEventListener('keydown', this.onKeyBound);
      this.loop = () => {
        this.raf = requestAnimationFrame(this.loop);
        this.tick();
      };
      this.raf = requestAnimationFrame(this.loop);
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      this.root.removeEventListener('pointerdown', this.onPointerBound);
      this.root.removeEventListener('click', this.onClickBound);
      window.removeEventListener('keydown', this.onKeyBound);
    }

    face(f, cls = '') {
      if (typeof f === 'string') return this.esc(f);
      return `<span class="hs-face${f.k ? ' is-kanji' : ''} ${cls}" style="${f.c ? `color:${INK[f.c]}` : ''}">${this.esc(f.t)}</span>`;
    }

    update(v) {
      const prev = this.v;
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        if (v.phase !== 'run' && v.phase !== 'result') {
          this.shownCard = null;
          this.pending = null;
        }
        if (v.phase === 'rule') this.sent = false;
        this.build(v);
      }
      if (v.phase === 'run' && v.card && v.card.i !== (prev?.card?.i ?? -1) && v.card.i !== this.shownCard?.i) this.pending = v.card;
      this.refresh(v);
    }

    build(v) {
      const e = this.esc;
      const phase = { rule: 'お題', run: '本番', result: '結果', ended: '最終結果' }[v.phase];
      this.root.innerHTML = `
        <div class="kb hs">
          <div class="kb-head">
            <span class="kb-round">ラウンド ${v.round} / ${v.rounds}</span>
            <span class="kb-phase">${phase}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          ${v.phase === 'ended' ? this.endedHtml(v) : `
            <p class="hs-rule">${(v.rule || []).map((x) => this.face(x, 'hs-rule-face')).join('')}</p>
            <button class="hs-pad" id="hs-pad" type="button" aria-label="押す">
              <span class="hs-card" id="hs-card"></span>
              <span class="hs-status" id="hs-status"></span>
            </button>
            <p class="kt-note hs-help">お題のカードが出た瞬間に、カードをタップ(PCはスペースキー)。違うカードで押すとお手つき−1点。速い順に3・2・1点。</p>`}
          <div class="kt-layout"><section class="kt-panel" id="hs-players"></section></div>
        </div>`;
    }

    endedHtml(v) {
      const e = this.esc;
      const top = v.players[0];
      const fast = [...v.players].filter((p) => p.best != null).sort((a, b) => a.best - b.best)[0];
      return `
        <div class="kt-panel hy-end">
          <h2 class="kt-result">${e(top.name)}さんの優勝(${top.score}点)</h2>
          ${fast ? `<p>最速反応:${e(fast.name)}さん ${fast.best}ms</p>` : ''}
          ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}
        </div>`;
    }

    refresh(v) {
      this.renderPlayers(v);
      this.renderStatus(v);
      if (v.phase === 'rule') this.setCard('<span class="hs-ready">準備…</span>');
      if (v.phase === 'result' && v.card) this.setCard(this.face(v.card), true);
      if (v.phase === 'run' && !this.shownCard && !this.pending) this.setCard('<span class="hs-ready">集中!</span>');
    }

    setCard(html, hit = false) {
      const el = this.root.querySelector('#hs-card');
      if (!el) return;
      el.innerHTML = html;
      el.classList.toggle('is-hit', hit);
    }

    tick() {
      const c = this.pending;
      if (!c || this.v?.phase !== 'run') return;
      if (this.api.now() < c.showAt) return;
      this.pending = null;
      this.setCard(this.face(c));
      const card = { i: c.i, perf: performance.now() };
      this.shownCard = card;
      // 次のフレームの時刻 ≒ 実際に画面に出た瞬間
      requestAnimationFrame((t) => { card.perf = t; });
      this.renderStatus(this.v);
    }

    renderStatus(v) {
      const el = this.root.querySelector('#hs-status');
      if (!el) return;
      const m = v.players.find((p) => p.id === this.api.myId());
      const st = m?.state;
      const mine = v.phase === 'result' && m ? (m.state === 'hit' ? `${m.rt}ms${m.gain ? ` +${m.gain}点` : ''}` : m.state === 'foul' ? 'お手つき' : m.state === 'flying' ? 'フライング' : '押せず') : '';
      el.textContent = v.phase === 'result' ? `あなた:${mine}` : st === 'pressed' || (this.sent && !st) ? '押した!' : st === 'foul' ? 'お手つき…' : st === 'flying' ? 'フライング…' : '';
      this.root.querySelector('#hs-pad')?.classList.toggle('is-done', !!st || this.sent);
    }

    renderPlayers(v) {
      const e = this.esc;
      const st = (p) => {
        if (v.phase === 'result') {
          if (p.state === 'hit') return `<span class="tag tag-done">${p.rt}ms</span>${p.gain ? `<b class="ts-gain">+${p.gain}</b>` : ''}`;
          if (p.state === 'foul') return '<span class="tag">お手つき</span>';
          if (p.state === 'flying') return '<span class="tag">フライング</span>';
          return '<span class="tag">—</span>';
        }
        if (p.state === 'pressed') return '<span class="tag tag-done">押した</span>';
        if (p.state === 'foul') return '<span class="tag">お手つき</span>';
        if (p.state === 'flying') return '<span class="tag">フライング</span>';
        return '';
      };
      this.root.querySelector('#hs-players').innerHTML = `
        <h3 class="kb-sub">得点(かっこ内は最速の反応)</h3>
        <ul class="kt-team">${v.players.map((p) => `<li class="${p.connected ? '' : 'is-away'}"><span class="player-name">${e(p.name)}</span>${st(p)}<span class="kt-tickets">${p.score}点${p.best != null ? ` <small>(${p.best}ms)</small>` : ''}</span></li>`).join('')}</ul>`;
    }

    press(ev) {
      const v = this.v;
      if (!v || v.phase !== 'run' || this.sent || !this.shownCard) return;
      const me = v.players.find((p) => p.id === this.api.myId());
      if (!me || me.state) return;
      const t = typeof ev?.timeStamp === 'number' && ev.timeStamp > 0 ? ev.timeStamp : performance.now();
      const lag = Math.max(0, Math.min(500, performance.now() - t));
      this.sent = true;
      this.renderStatus(v);
      this.api.send('press', {
        i: this.shownCard.i,
        rt: Math.round(t - this.shownCard.perf),
        pressAt: this.api.now() - lag,
      });
    }

    onPointer(ev) {
      if (ev.target.closest('#hs-pad')) {
        ev.preventDefault();
        this.press(ev);
      }
    }

    onKey(ev) {
      if (ev.code !== 'Space' && ev.key !== ' ') return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || ev.repeat) return;
      if (this.v?.phase !== 'run') return;
      ev.preventDefault();
      this.press(ev);
    }

    onClick(ev) {
      const t = ev.target.closest('[data-act="finish"]');
      if (t) this.api.send('finish');
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.hansha = { create: (root, api) => new HanshaClient(root, api) };
})();
