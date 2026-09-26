(() => {
  'use strict';

  const COLORS = ['#15211d', '#c8323c', '#2f6fb0', '#2f8a5a', '#e0b020', '#8b5a2b', '#e8703a', '#e27fb0'];
  const SIZES = [3, 7, 16];
  const W = 800;
  const H = 600;

  function paint(ctx, s, pts) {
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
  function render(canvas, strokes) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    for (const s of strokes || []) paint(ctx, s, s.pts);
  }

  class DengonClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.strokes = [];
      this.color = COLORS[0];
      this.size = SIZES[1];
      this.eraser = false;
      this.onClickBound = (e) => this.onClick(e);
      root.addEventListener('click', this.onClickBound);
      this.tick = setInterval(() => this.autoSubmit(), 300);
    }

    destroy() {
      this.root.removeEventListener('click', this.onClickBound);
      clearInterval(this.tick);
    }

    update(v) {
      const prev = this.v;
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.strokes = [];
        this.draft = '';
        this.autoSent = false;
        this.build(v);
      }
      this.refresh(v, prev);
    }

    // ---------- 骨組み ----------
    build(v) {
      const e = this.esc;
      if (v.phase === 'play') {
        const title = { write: 'お題の文を書く', draw: '回ってきた文を絵にする', describe: '回ってきた絵を文にする' }[v.kind];
        this.root.innerHTML = `
          <div class="kb dg">
            <div class="kb-head">
              <span class="kb-round">${v.round + 1} / ${v.rounds}</span>
              <span class="kb-phase">${title}</span>
              <span class="timer" data-ends-at="${v.endsAt}"></span>
            </div>
            <div class="dg-layout">
              <div class="dg-main" id="dg-main"></div>
              <aside class="kt-side"><section class="kt-panel" id="dg-status"></section></aside>
            </div>
          </div>`;
        this.buildTask(v);
        return;
      }
      this.root.innerHTML = `
        <div class="kb dg">
          <div class="kb-head"><span class="kb-round">${v.phase === 'ended' ? '全部の伝言' : '結果発表'}</span><span class="kb-phase" id="dg-count"></span></div>
          <div id="dg-reveal"></div>
          <div class="dg-ctl" id="dg-ctl"></div>
        </div>`;
    }

    buildTask(v) {
      const e = this.esc;
      const el = this.root.querySelector('#dg-main');
      if (!v.participant || !v.task) {
        el.innerHTML = '<div class="kt-panel"><p class="kt-note">観戦中です。結果発表から一緒に見られます。</p></div>';
        return;
      }
      const t = v.task;
      if (t.kind === 'write') {
        el.innerHTML = `
          <div class="kt-panel dg-task">
            <h3 class="kb-sub">伝言のスタートになる文を書いてください</h3>
            <div class="answer-entry"><input id="dg-text" maxlength="60" placeholder="例:ペンギンがカラオケで熱唱している" autocomplete="off"><button class="btn btn-primary" data-act="send">決定</button></div>
            <p class="kt-note">思いつかなければ、候補をタップ:</p>
            <div class="dg-suggest">${v.suggest.map((s) => `<button class="btn btn-small" data-suggest="${e(s)}">${e(s)}</button>`).join('')}</div>
            <p class="dg-sent" id="dg-sent"></p>
          </div>`;
      } else if (t.kind === 'draw') {
        el.innerHTML = `
          <div class="kt-panel dg-task">
            <p class="dg-prompt"><span class="kj-label">このお題を絵にする</span><b>${e(t.prev.text)}</b></p>
            <div class="ok-canvas-wrap"><canvas id="dg-canvas" width="${W}" height="${H}"></canvas></div>
            <div class="ok-tools">
              <div class="ok-colors">${COLORS.map((c) => `<button class="ok-color" style="background:${c}" data-color="${c}" aria-label="色"></button>`).join('')}
                <button class="btn btn-small" data-act="eraser">消しゴム</button></div>
              <div class="ok-sizes">${SIZES.map((s, i) => `<button class="btn btn-small" data-size="${s}">${['細', '中', '太'][i]}</button>`).join('')}
                <button class="btn btn-small btn-quiet" data-act="undo">1つ戻す</button><button class="btn btn-small btn-quiet" data-act="clear">全部消す</button></div>
            </div>
            <button class="btn btn-primary btn-block" data-act="send">できた!</button>
            <p class="dg-sent" id="dg-sent"></p>
          </div>`;
        const cv = el.querySelector('#dg-canvas');
        render(cv, []);
        this.bindDraw(cv);
        this.renderTools();
      } else {
        el.innerHTML = `
          <div class="kt-panel dg-task">
            <p class="kj-label">この絵は何?文で書いてください</p>
            <div class="ok-canvas-wrap"><canvas id="dg-view" width="${W}" height="${H}"></canvas></div>
            <div class="answer-entry"><input id="dg-text" maxlength="60" placeholder="見たままを書く" autocomplete="off"><button class="btn btn-primary" data-act="send">決定</button></div>
            <p class="dg-sent" id="dg-sent"></p>
          </div>`;
        render(el.querySelector('#dg-view'), t.prev.strokes);
      }
      const input = el.querySelector('#dg-text');
      if (input) {
        this.api.onEnter(input, () => this.send());
        input.addEventListener('input', () => { this.draft = input.value; });
      }
    }

    refresh(v) {
      if (v.phase === 'play') return this.refreshPlay(v);
      this.renderReveal(v);
    }

    refreshPlay(v) {
      const e = this.esc;
      this.root.querySelector('#dg-status').innerHTML = `
        <h3 class="kb-sub">提出した人</h3>
        <ul class="kt-team">${v.players.map((p) => `<li><span class="player-name">${e(p.name)}</span>${p.done ? '<span class="tag tag-done">提出</span>' : '<span class="tag">作業中</span>'}</li>`).join('')}</ul>
        <p class="kt-note">全員が提出するか、時間が来たら次へ回ります。時間切れのときは、そのとき描けていた分が自動で提出されます。</p>`;
      const sent = this.root.querySelector('#dg-sent');
      if (sent) sent.innerHTML = v.submitted ? '提出しました。<button class="btn btn-small btn-quiet" data-act="unsend">直す</button>' : '';
      this.root.querySelectorAll('#dg-main input, #dg-main [data-act="send"]').forEach((x) => { x.disabled = !!v.submitted; });
      this.locked = !!v.submitted;
    }

    // ---------- 公開 ----------
    renderReveal(v) {
      const e = this.esc;
      const r = v.reveal;
      const el = this.root.querySelector('#dg-reveal');
      const cur = r.chain;
      const chains = cur === null ? r.chains : [r.chains[cur]];
      const offset = cur === null ? 0 : cur;
      const sig = JSON.stringify([cur, r.step, r.chains.map((c) => c.entries.map((x) => [x.likes, x.liked]))]);
      if (sig === this.revealSig) return;
      const grew = this.revealSig && cur !== null;
      this.revealSig = sig;
      this.root.querySelector('#dg-count').textContent = cur === null ? '' : `${cur + 1} / ${r.total}本目`;
      el.innerHTML = chains
        .map((c, k) => {
          const ci = offset + k;
          return `
            <section class="dg-chain">
              <h3 class="dg-chain-h">${e(c.owner)}さんのお題から</h3>
              ${c.entries.map((x, si) => `
                <div class="dg-entry dg-e-${x.type}${grew && si === c.entries.length - 1 ? ' is-new' : ''}">
                  <span class="dg-by">${e(x.byName)}${x.type === 'text' ? (si === 0 ? 'のお題' : 'の解釈') : 'の絵'}</span>
                  ${x.type === 'text' ? `<p class="dg-text">${e(x.text || '(白紙)')}</p>` : `<canvas width="${W}" height="${H}" data-strokes="${ci}-${si}"></canvas>`}
                  <button class="dg-like${x.liked ? ' is-on' : ''}" data-like="${ci}-${si}" aria-label="いいね">❤ ${x.likes || ''}</button>
                </div>`).join('')}
            </section>`;
        })
        .join('');
      el.querySelectorAll('[data-strokes]').forEach((c) => {
        const [ci, si] = c.dataset.strokes.split('-').map(Number);
        render(c, r.chains[ci].entries[si].strokes);
      });
      if (grew) el.querySelector('.dg-entry.is-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const host = this.api.isHost();
      const c = cur === null ? null : r.chains[cur];
      const last = c && r.step >= c.total - 1;
      const lastChain = cur !== null && cur >= r.total - 1;
      this.root.querySelector('#dg-ctl').innerHTML =
        v.phase === 'ended'
          ? `${v.best ? `<p class="dg-best">いいね最多:${e(v.best.by)}の${v.best.type === 'text' ? '文' : '絵'}(❤${v.best.n})</p>` : ''}
             ${host ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}`
          : host
            ? `<button class="btn btn-primary jn-big" data-act="next">${!last ? '次を見る' : lastChain ? '全部の伝言を並べる' : '次の伝言へ'}</button>`
            : '<p class="hint wait">ホストがめくっていきます</p>';
    }

    // ---------- 描く ----------
    renderTools() {
      this.root.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('is-on', !this.eraser && b.dataset.color === this.color));
      this.root.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('btn-primary', Number(b.dataset.size) === this.size));
      this.root.querySelector('[data-act="eraser"]')?.classList.toggle('btn-primary', this.eraser);
    }

    bindDraw(cv) {
      const ctx = cv.getContext('2d');
      const pos = (ev) => {
        const r = cv.getBoundingClientRect();
        return [Math.round(((ev.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((ev.clientY - r.top) / r.height) * 1000) / 1000];
      };
      let cur = null;
      cv.addEventListener('pointerdown', (ev) => {
        if (this.locked) return;
        ev.preventDefault();
        cv.setPointerCapture(ev.pointerId);
        cur = { color: this.eraser ? '#ffffff' : this.color, size: this.eraser ? 26 : this.size, pts: [pos(ev)] };
        this.strokes.push(cur);
        paint(ctx, cur, [cur.pts[0], cur.pts[0]]);
      });
      cv.addEventListener('pointermove', (ev) => {
        if (!cur) return;
        const p = pos(ev);
        const last = cur.pts[cur.pts.length - 1];
        if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.003) return;
        cur.pts.push(p);
        paint(ctx, cur, [last, p]);
      });
      const end = () => { cur = null; };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
    }

    send(auto = false) {
      const v = this.v;
      if (!v?.task || (v.submitted && !auto)) return;
      if (v.task.kind === 'draw') this.api.send('submit', { strokes: this.strokes, auto });
      else {
        const text = this.root.querySelector('#dg-text')?.value.trim() || this.draft || '';
        if (!text && !auto) return;
        this.api.send('submit', { text, auto });
      }
    }

    autoSubmit() {
      const v = this.v;
      if (!v || v.phase !== 'play' || v.submitted || this.autoSent || !v.task) return;
      if (this.api.remaining(v.endsAt) <= 900) {
        this.autoSent = true;
        this.send(true);
      }
    }

    onClick(ev) {
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.suggest) {
        const i = this.root.querySelector('#dg-text');
        if (i) i.value = this.draft = t.dataset.suggest;
        return;
      }
      if (t.dataset.color) {
        this.color = t.dataset.color;
        this.eraser = false;
        return this.renderTools();
      }
      if (t.dataset.size) {
        this.size = Number(t.dataset.size);
        return this.renderTools();
      }
      if (t.dataset.like) {
        const [chain, step] = t.dataset.like.split('-').map(Number);
        return this.api.send('like', { chain, step });
      }
      switch (t.dataset.act) {
        case 'send':
          this.send();
          break;
        case 'unsend':
          this.api.send('unsubmit');
          break;
        case 'eraser':
          this.eraser = !this.eraser;
          this.renderTools();
          break;
        case 'undo':
          if (this.locked) break;
          this.strokes.pop();
          render(this.root.querySelector('#dg-canvas'), this.strokes);
          break;
        case 'clear':
          if (this.locked) break;
          this.strokes = [];
          render(this.root.querySelector('#dg-canvas'), []);
          break;
        case 'next':
          this.api.send('next');
          break;
        case 'finish':
          this.api.send('finish');
          break;
        default:
      }
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.dengon = { create: (root, api) => new DengonClient(root, api) };
})();
