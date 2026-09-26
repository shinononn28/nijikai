(() => {
  'use strict';

  class TasuketsuClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.onClickBound = (e) => this.onClick(e);
      root.addEventListener('click', this.onClickBound);
    }

    destroy() {
      this.root.removeEventListener('click', this.onClickBound);
    }

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.build(v);
      }
      this.refresh(v);
    }

    build(v) {
      const phase = { declare: '宣言(守らなくていい)', vote: '本番の投票', result: '結果', ended: '最終結果' }[v.phase];
      this.root.innerHTML = `
        <div class="kb ts">
          <div class="kb-head">
            <span class="kb-round">ラウンド ${v.round} / ${v.rounds}</span>
            <span class="kb-phase">${phase}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div class="ts-options" id="ts-options"></div>
          <p class="ts-note" id="ts-note"></p>
          <div class="kt-layout ts-layout">
            <section class="kt-panel" id="ts-players"></section>
            <section class="kt-panel" id="ts-history"></section>
          </div>
        </div>`;
    }

    refresh(v) {
      this.renderOptions(v);
      this.renderPlayers(v);
      this.renderHistory(v);
    }

    renderOptions(v) {
      const e = this.esc;
      const el = this.root.querySelector('#ts-options');
      const note = this.root.querySelector('#ts-note');
      if (v.phase === 'ended') {
        const top = v.players[0];
        el.innerHTML = `<div class="kt-panel ts-end"><h2 class="kt-result">${e(top.name)}の勝ち(${top.score}点)</h2>
          ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}</div>`;
        note.textContent = '';
        return;
      }
      const mine = v.phase === 'declare' ? v.myDeclare : v.phase === 'vote' ? v.myVote : null;
      const r = v.result;
      el.innerHTML = v.labels
        .map((l, i) => {
          const minority = r?.minority.includes(i);
          const count = r ? r.counts[i] : null;
          const voters = r ? v.players.filter((p) => p.vote === i).map((p) => e(p.name)).join('・') : '';
          return `
            <button class="ts-opt${mine === i ? ' is-on' : ''}${minority ? ' is-minority' : ''}${r && !minority ? ' is-out' : ''}" data-i="${i}" ${['declare', 'vote'].includes(v.phase) ? '' : 'disabled'}>
              <span class="ts-label">${l}</span>
              <span class="ts-pts">${v.points[i]}<small>点</small></span>
              ${r ? `<span class="ts-count">${count}票${minority ? '・少数派!' : ''}</span><span class="ts-voters">${voters || '—'}</span>` : mine === i ? `<span class="ts-count">${v.phase === 'declare' ? '宣言中' : '投票中'}</span>` : ''}
            </button>`;
        })
        .join('');
      note.innerHTML =
        v.phase === 'declare' ? 'まずは宣言です。全員の宣言が公開されてから、本番の投票をします(宣言と違う方に入れてもかまいません)。'
        : v.phase === 'vote' ? '票が一番少ない選択肢に入れた人だけが、その点数をもらえます。少数派が1人だけなら2倍。変更は締め切りまで何度でも。'
        : r ? e(r.note) : '';
    }

    renderPlayers(v) {
      const e = this.esc;
      const status = (p) => {
        if (v.phase === 'declare') return p.declared ? '<span class="tag tag-done">宣言済み</span>' : '<span class="tag">考え中</span>';
        if (v.phase === 'vote') return `${p.declare !== null && p.declare !== undefined ? `<span class="tag">宣言${v.labels[p.declare]}</span>` : ''}${p.voted ? '<span class="tag tag-done">投票済み</span>' : '<span class="tag">考え中</span>'}`;
        if (v.phase === 'result') return `${p.vote !== null ? `<span class="tag">${v.labels[p.vote]}</span>` : '<span class="tag">未投票</span>'}${p.gain ? `<b class="ts-gain">+${p.gain}</b>` : ''}`;
        return '';
      };
      this.root.querySelector('#ts-players').innerHTML = `
        <h3 class="kb-sub">得点</h3>
        <ul class="kt-team">${v.players.map((p) => `<li><span class="player-name">${e(p.name)}</span>${status(p)}<span class="kt-tickets">${p.score}点</span></li>`).join('')}</ul>`;
    }

    renderHistory(v) {
      this.root.querySelector('#ts-history').innerHTML = `
        <h3 class="kb-sub">これまで</h3>
        ${v.history.length ? `<table class="gk-table"><thead><tr><th>回</th><th>点数</th><th>票</th><th>少数派</th></tr></thead><tbody>
          ${v.history.map((h) => `<tr><td>${h.round}</td><td>${h.points.map((p, i) => `${v.labels[i]}${p}`).join(' ')}</td><td>${h.counts.map((c, i) => `${v.labels[i]}${c}`).join(' ')}</td><td>${h.minority.map((i) => v.labels[i]).join('・') || 'なし'}</td></tr>`).join('')}
        </tbody></table>` : '<p class="kt-note">まだありません。</p>'}`;
    }

    onClick(ev) {
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.i !== undefined) return this.api.send('choose', { i: Number(t.dataset.i) });
      if (t.dataset.act === 'finish') this.api.send('finish');
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.tasuketsu = { create: (root, api) => new TasuketsuClient(root, api) };
})();
