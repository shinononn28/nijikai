(() => {
  'use strict';

  const COLORS = ['#15211d', '#c8323c', '#2f6fb0', '#2f8a5a', '#e0b020', '#8b5a2b', '#e8703a', '#e27fb0'];
  const SIZES = [3, 7, 16];
  const W = 800;
  const H = 600;

  class OekakiClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.strokes = new Map(); // id → {color,size,pts}
      this.color = COLORS[0];
      this.size = SIZES[1];
      this.eraser = false;
      this.cur = null;
      this.buf = [];
      this.onClickBound = (e) => this.onClick(e);
      root.addEventListener('click', this.onClickBound);
      this.flushTimer = setInterval(() => this.flush(), 60);
      this.onResize = () => this.redraw();
      window.addEventListener('resize', this.onResize);
    }

    destroy() {
      this.root.removeEventListener('click', this.onClickBound);
      window.removeEventListener('resize', this.onResize);
      clearInterval(this.flushTimer);
    }

    isDrawer() {
      return this.v?.drawer === this.api.myId() && this.v.phase === 'draw';
    }

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        const prevPhase = this.key?.split(':')[0];
        this.key = key;
        if (v.phase === 'choose' || (v.phase === 'draw' && prevPhase !== 'draw' && prevPhase !== 'choose')) this.strokes.clear();
        this.build(v);
      }
      this.refresh(v);
    }

    onEvent(type, data) {
      if (type === 'clear') {
        this.strokes.clear();
        this.redraw();
      } else if (type === 'redraw') {
        this.strokes.clear();
        for (const s of data.strokes) this.strokes.set(s.id, { color: s.color, size: s.size, pts: [...s.pts] });
        this.redraw();
      } else if (type === 'stroke') {
        let s = this.strokes.get(data.id);
        const from = s ? s.pts[s.pts.length - 1] : null;
        if (!s) {
          s = { color: data.color, size: data.size, pts: [] };
          this.strokes.set(data.id, s);
        }
        s.pts.push(...data.pts);
        this.drawSeg(s, from ? [from, ...data.pts] : data.pts);
      }
    }

    // ---------- 骨組み ----------
    build(v) {
      const e = this.esc;
      if (v.phase === 'ended') {
        this.root.innerHTML = `
          <div class="kb ok">
            <div class="kb-head"><span class="kb-round">終了</span></div>
            <div class="kt-panel">
              <h2 class="kt-result">${e(v.players[0]?.name || '')}さんの優勝</h2>
              <ol class="kj-result">${v.players.map((p, i) => `<li><span class="rank">${i + 1}位</span><span class="kj-word">${e(p.name)}</span><span class="num">${p.score}点</span></li>`).join('')}</ol>
              <h3 class="kb-sub">今日の作品</h3>
              <div class="ok-gallery">${v.gallery.map((g, i) => `<figure><canvas width="${W}" height="${H}" data-g="${i}"></canvas><figcaption>「${e(g.word)}」by ${e(g.drawer)}(${g.correct}人正解)</figcaption></figure>`).join('')}</div>
              ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}
            </div>
          </div>`;
        this.root.querySelectorAll('[data-g]').forEach((c) => {
          const g = v.gallery[Number(c.dataset.g)];
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, W, H);
          for (const s of g.strokes) this.paint(ctx, s, s.pts);
        });
        return;
      }
      this.root.innerHTML = `
        <div class="kb ok">
          <div class="kb-head">
            <span class="kb-round">${v.turn} / ${v.turns}</span>
            <span class="kb-phase">描く人:${e(v.drawerName)}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div class="ok-banner" id="ok-banner"></div>
          <div class="ok-layout">
            <div class="ok-main">
              <div class="ok-canvas-wrap"><canvas id="ok-canvas" width="${W}" height="${H}"></canvas><div class="ok-over" id="ok-over"></div></div>
              <div id="ok-tools"></div>
            </div>
            <aside class="kt-side"><section class="kt-panel" id="ok-score"></section></aside>
          </div>
        </div>`;
      const cv = this.root.querySelector('#ok-canvas');
      this.ctx2d = cv.getContext('2d');
      this.bindDraw(cv);
      this.redraw();
    }

    refresh(v) {
      if (v.phase === 'ended') return;
      this.renderBanner(v);
      this.renderTools(v);
      this.renderScore(v);
      this.renderOver(v);
    }

    renderBanner(v) {
      const e = this.esc;
      const el = this.root.querySelector('#ok-banner');
      if (v.phase === 'choose') {
        el.innerHTML = v.choices
          ? `<span class="kj-label">描くお題を選んでください</span><div class="ok-choices">${v.choices.map((w) => `<button class="btn btn-primary" data-choose="${e(w)}">${e(w)}</button>`).join('')}</div>`
          : `<span class="kj-label">${e(v.drawerName)}さんがお題を選んでいます</span>`;
      } else if (v.word) {
        el.innerHTML = `<span class="kj-label">${v.phase === 'reveal' ? '答え' : v.drawer === this.api.myId() ? 'あなたのお題' : '正解!お題は'}</span><p class="kj-crit">${e(v.word)}</p>`;
      } else {
        el.innerHTML = `<span class="kj-label">何を描いている?(${v.length}文字)</span><p class="kj-crit ok-hint">${e(v.hint || '？'.repeat(v.length || 1))}</p>`;
      }
    }

    renderOver(v) {
      const el = this.root.querySelector('#ok-over');
      el.innerHTML = v.phase === 'reveal' ? `<span>答え:${this.esc(v.word)}</span>` : '';
      el.hidden = v.phase !== 'reveal';
    }

    renderTools(v) {
      const el = this.root.querySelector('#ok-tools');
      if (this.isDrawer()) {
        const sig = `draw:${this.color}:${this.size}:${this.eraser}`;
        if (sig === this.toolSig) return;
        this.toolSig = sig;
        el.innerHTML = `
          <div class="ok-tools">
            <div class="ok-colors">${COLORS.map((c) => `<button class="ok-color${!this.eraser && this.color === c ? ' is-on' : ''}" style="background:${c}" data-color="${c}" aria-label="色"></button>`).join('')}
              <button class="btn btn-small${this.eraser ? ' btn-primary' : ''}" data-act="eraser">消しゴム</button></div>
            <div class="ok-sizes">${SIZES.map((s, i) => `<button class="btn btn-small${this.size === s ? ' btn-primary' : ''}" data-size="${s}">${['細', '中', '太'][i]}</button>`).join('')}
              <button class="btn btn-small btn-quiet" data-act="undo">1つ戻す</button><button class="btn btn-small btn-quiet" data-act="clear">全部消す</button>
              <button class="btn btn-small btn-quiet" data-act="skip">パスする</button></div>
          </div>`;
        return;
      }
      this.toolSig = null;
      if (v.phase === 'draw' && !v.iGuessed) {
        if (el.querySelector('#ok-answer')) return;
        el.innerHTML = `
          <div class="answer-entry"><input id="ok-answer" maxlength="30" placeholder="答えを入力(チャットに送られます)" autocomplete="off"><button class="btn btn-primary" data-act="answer">回答</button></div>
          <p class="kt-note">チャット欄に書いても判定されます。正解した言葉は伏せられ、おしいときはあなただけに知らせます。</p>`;
        const input = el.querySelector('#ok-answer');
        this.api.onEnter(input, () => this.answer());
        return;
      }
      el.innerHTML = v.phase === 'draw' && v.iGuessed ? '<p class="ok-done">🎉 正解!ほかの人を待っています</p>' : '';
    }

    renderScore(v) {
      const e = this.esc;
      this.root.querySelector('#ok-score').innerHTML = `
        <h3 class="kb-sub">得点</h3>
        <ul class="kt-team">${v.players.map((p) => `<li><span class="player-name">${e(p.name)}</span>${p.drawer ? '<span class="tag tag-host">描く人</span>' : ''}${p.correct ? '<span class="tag tag-done">正解</span>' : ''}<span class="kt-tickets">${p.score}点</span></li>`).join('')}</ul>
        <p class="kt-note">早く当てるほど高得点(一番乗りは+3)。当てられた人1人につき、描いた人に+4。</p>`;
    }

    answer() {
      const i = this.root.querySelector('#ok-answer');
      const t = i?.value.trim();
      if (!t) return;
      i.value = '';
      this.api.say(t);
    }

    // ---------- 描画 ----------
    bindDraw(cv) {
      const pos = (ev) => {
        const r = cv.getBoundingClientRect();
        return [Math.round(((ev.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((ev.clientY - r.top) / r.height) * 1000) / 1000];
      };
      cv.addEventListener('pointerdown', (ev) => {
        if (!this.isDrawer()) return;
        ev.preventDefault();
        cv.setPointerCapture(ev.pointerId);
        const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        const color = this.eraser ? '#ffffff' : this.color;
        const size = this.eraser ? SIZES[2] * 1.6 : this.size;
        this.cur = { id, color, size };
        const p = pos(ev);
        const s = { color, size, pts: [p] };
        this.strokes.set(id, s);
        this.buf = [p];
        this.drawSeg(s, [p, p]);
      });
      cv.addEventListener('pointermove', (ev) => {
        if (!this.cur) return;
        const s = this.strokes.get(this.cur.id);
        const p = pos(ev);
        const last = s.pts[s.pts.length - 1];
        if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.002) return;
        s.pts.push(p);
        this.buf.push(p);
        this.drawSeg(s, [last, p]);
      });
      const end = () => {
        if (!this.cur) return;
        this.flush();
        this.cur = null;
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
    }

    flush() {
      if (!this.cur || !this.buf.length) return;
      this.api.send('stroke', { id: this.cur.id, color: this.cur.color, size: this.cur.size, pts: this.buf });
      this.buf = [];
    }

    paint(ctx, s, pts) {
      if (!pts.length) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size * (W / 600);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
      for (const p of pts.length === 1 ? [pts[0], pts[0]] : pts.slice(1)) ctx.lineTo(p[0] * W, p[1] * H);
      ctx.stroke();
    }

    drawSeg(s, pts) {
      if (this.ctx2d) this.paint(this.ctx2d, s, pts);
    }

    redraw() {
      const ctx = this.ctx2d;
      if (!ctx) return;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      for (const s of this.strokes.values()) this.paint(ctx, s, s.pts);
    }

    onClick(ev) {
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.choose) return this.api.send('choose', { word: t.dataset.choose });
      if (t.dataset.color) {
        this.color = t.dataset.color;
        this.eraser = false;
        return this.renderTools(this.v);
      }
      if (t.dataset.size) {
        this.size = Number(t.dataset.size);
        return this.renderTools(this.v);
      }
      switch (t.dataset.act) {
        case 'eraser':
          this.eraser = !this.eraser;
          this.renderTools(this.v);
          break;
        case 'undo': {
          const ids = [...this.strokes.keys()];
          this.strokes.delete(ids[ids.length - 1]);
          this.redraw();
          this.api.send('undo');
          break;
        }
        case 'clear':
          this.strokes.clear();
          this.redraw();
          this.api.send('clear');
          break;
        case 'skip':
          if (confirm('このお題をパスして次へ進みますか?')) this.api.send('skip');
          break;
        case 'answer':
          this.answer();
          break;
        case 'finish':
          this.api.send('finish');
          break;
        default:
      }
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.oekaki = { create: (root, api) => new OekakiClient(root, api) };
})();
