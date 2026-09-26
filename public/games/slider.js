(() => {
  'use strict';

  class SliderClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.val = 50;
      this.onClickBound = (e) => this.onClick(e);
      root.addEventListener('click', this.onClickBound);
    }

    destroy() {
      this.root.removeEventListener('click', this.onClickBound);
    }

    me() {
      return this.api.myId();
    }

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        if (v.phase === 'answer') this.val = v.myValue ?? 50;
        this.build(v);
      }
      this.refresh(v);
    }

    build(v) {
      const e = this.esc;
      const isTarget = v.target === this.me();
      const head = `
        <div class="kb-head">
          <span class="kb-round">${v.phase === 'ended' ? '終了' : `${v.turn} / ${v.turns}`}</span>
          <span class="kb-phase">${v.phase === 'ended' ? '' : `答える人:${e(v.targetName)}`}</span>
          ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
        </div>`;
      let body = '';
      if (v.phase === 'topic') {
        body = isTarget
          ? `<div class="kt-panel">
              <h3 class="kb-sub">あなたが答える番です。物差しを選んでください</h3>
              <div class="sl-options">${v.options.map((o, i) => `<button class="sl-opt" data-pick="${i}"><span>${e(o[0])}</span><b>⇔</b><span>${e(o[1])}</span></button>`).join('')}</div>
              <button class="btn btn-quiet btn-small" data-act="reroll" ${v.rerolls > 0 ? '' : 'disabled'}>ほかの候補(残り${v.rerolls}回)</button>
              <h3 class="kb-sub">自分で書く</h3>
              <div class="sl-custom"><input id="sl-left" maxlength="20" placeholder="左端(例:猫舌)"><span>⇔</span><input id="sl-right" maxlength="20" placeholder="右端(例:熱いの平気)"><button class="btn" data-act="custom">これにする</button></div>
            </div>`
          : `<div class="kt-panel"><p class="kj-wait">${e(v.targetName)}さんが物差しを選んでいます…</p></div>`;
      } else if (v.phase === 'answer') {
        body = `
          <div class="kt-panel sl-panel">
            <p class="sl-q">${isTarget ? 'あなたの<b>本当の位置</b>を置いてください(みんなには秘密)' : `<b>${e(v.targetName)}</b>さんはどのへん?`}</p>
            ${this.track(v.spectrum, `<input type="range" min="0" max="100" step="1" value="${this.val}" id="sl-range" aria-label="位置">`)}
            <p class="sl-val" id="sl-val">${this.val}</p>
            <button class="btn btn-primary btn-block" data-act="submit">${isTarget ? 'この位置で決定' : 'この予想で決定'}</button>
            <p class="kt-note" id="sl-sent"></p>
          </div>`;
      } else if (v.phase === 'reveal' || v.phase === 'ended') {
        body = '<div id="sl-result"></div>';
      }
      this.root.innerHTML = `<div class="kb sl">${head}${body}<section class="kt-panel" id="sl-score"></section></div>`;
      const range = this.root.querySelector('#sl-range');
      if (range) range.addEventListener('input', () => {
        this.val = Number(range.value);
        this.root.querySelector('#sl-val').textContent = this.val;
      });
    }

    track(sp, inner) {
      const e = this.esc;
      return `<div class="sl-track-wrap"><div class="sl-ends"><span>${e(sp.left)}</span><span>${e(sp.right)}</span></div><div class="sl-track">${inner}</div><div class="sl-ticks"><span>0</span><span>50</span><span>100</span></div></div>`;
    }

    refresh(v) {
      const e = this.esc;
      if (v.phase === 'answer') {
        const sent = this.root.querySelector('#sl-sent');
        if (sent) sent.textContent = v.myValue !== null ? `決定済み(${v.myValue})。締め切りまでは置き直せます` : '';
      }
      if (v.phase === 'reveal' || v.phase === 'ended') this.renderResult(v);
      const status = (p) => (p.done === null ? '' : p.done ? '<span class="tag tag-done">決定</span>' : '<span class="tag">考え中</span>');
      this.root.querySelector('#sl-score').innerHTML = `
        <h3 class="kb-sub">得点</h3>
        <ul class="kt-team">${v.players.map((p) => `<li><span class="player-name">${e(p.name)}</span>${p.target ? '<span class="tag tag-host">答える人</span>' : ''}${status(p)}<span class="kt-tickets">${p.score}点</span></li>`).join('')}</ul>
        <p class="kt-note">差5以内で5点・10以内で3点・20以内で2点・30以内で1点。答えた人には、差15以内まで近づけた人数だけ得点。</p>`;
    }

    renderResult(v) {
      const e = this.esc;
      const el = this.root.querySelector('#sl-result');
      if (!el || !v.result) {
        if (el && v.phase === 'ended') el.innerHTML = this.endHtml(v);
        return;
      }
      const r = v.result;
      const markers = r.guesses
        .map((g, i) => `<span class="sl-mark" style="left:${g.value}%;--row:${i % 3}"><i></i><small>${e(g.name)}</small></span>`)
        .join('');
      const truth = r.truth !== null ? `<span class="sl-truth" style="left:${r.truth}%"><i>★</i><small>${e(v.targetName)}</small></span>` : '';
      el.innerHTML = `
        <div class="kt-panel sl-panel">
          <p class="sl-q"><b>${e(v.targetName)}</b>さんは <b class="sl-big">${r.truth ?? '?'}</b></p>
          ${this.track(v.spectrum, `${markers}${truth}`)}
          <ul class="sl-list">${[...r.guesses].sort((a, b) => (a.diff ?? 999) - (b.diff ?? 999)).map((g) => `<li><span class="player-name">${e(g.name)}</span><span>予想${g.value}</span><span>差${g.diff ?? '-'}</span><b>+${g.pts}</b></li>`).join('')}</ul>
          <p class="kt-note">${e(v.targetName)}さん:差15以内まで近づいた${r.understood}人ぶん +${r.understood}</p>
          ${v.phase === 'ended' ? this.endHtml(v) : this.api.isHost() ? '<button class="btn btn-primary btn-block" data-act="next">次の人へ</button>' : '<p class="hint wait">ホストが次へ進めます</p>'}
        </div>`;
    }

    endHtml(v) {
      const e = this.esc;
      return `<h2 class="kt-result">${e(v.players[0]?.name || '')}さんの優勝</h2>
        ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}`;
    }

    onClick(ev) {
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.pick !== undefined) return this.api.send('pick', { i: Number(t.dataset.pick) });
      switch (t.dataset.act) {
        case 'reroll':
          this.api.send('reroll');
          break;
        case 'custom': {
          const l = this.root.querySelector('#sl-left').value.trim();
          const r = this.root.querySelector('#sl-right').value.trim();
          if (l && r) this.api.send('custom', { left: l, right: r });
          break;
        }
        case 'submit':
          this.api.send('submit', { value: this.val });
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
  window.GameClients.slider = { create: (root, api) => new SliderClient(root, api) };
})();
