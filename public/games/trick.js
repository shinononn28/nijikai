(() => {
  'use strict';

  const CN = { r: '赤', b: '青', g: '緑', y: '黄', x: '切り札' };
  const ORDER = 'rbgyx';
  const LABEL = { top: 'この色の最高', bottom: 'この色の最低', only: 'この色は1枚だけ' };
  const cid = (c) => `${c.c}${c.n}`;
  const same = (a, b) => a && b && a.c === b.c && a.n === b.n;

  class TrickClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.sel = null; // 出す札
      this.sigMode = false;
      this.sigCard = null;
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
        this.sel = null;
        this.sigMode = false;
        this.sigCard = null;
        this.build(v);
      }
      // 自分の番が終わったら選択を解除
      if (v.turn !== this.api.myId()) this.sel = null;
      this.refresh(v);
    }

    name(id) {
      return this.v.players.find((p) => p.id === id)?.name ?? '?';
    }

    card(c, { cls = '', attr = '', tag = '' } = {}) {
      return `<span class="tc tc-${c.c} ${cls}" ${attr}><b>${c.c === 'x' ? '🚀' : ''}${c.n}</b>${tag}</span>`;
    }

    build(v) {
      this.root.innerHTML = `
        <div class="kb tr">
          <div class="kb-head">
            <span class="kb-round">${v.phase === 'ended' ? '作戦終了' : `ステージ ${v.stage} / ${v.stages}${v.attempt > 1 ? `(${v.attempt}回目の挑戦)` : ''}`}</span>
            <span class="kb-phase">${{ draft: '任務の分担', play: '作戦中', result: '結果', ended: '' }[v.phase] || ''}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <section class="tr-tasks" id="tr-tasks"></section>
          <div class="tr-layout">
            <div class="tr-main">
              <section class="kt-panel tr-table" id="tr-table"></section>
              <section class="kt-panel" id="tr-me"></section>
            </div>
            <aside class="kt-side">
              <section class="kt-panel" id="tr-track"></section>
              <section class="kt-panel" id="tr-blunders"></section>
            </aside>
          </div>
          <div id="tr-overlay"></div>
        </div>`;
    }

    refresh(v) {
      if (v.phase === 'ended') return this.renderEnd(v);
      this.renderTasks(v);
      this.renderTable(v);
      this.renderMe(v);
      this.renderTrack(v);
      this.renderBlunders(v);
      this.renderOverlay(v);
    }

    // ---------- 任務 ----------
    renderTasks(v) {
      const e = this.esc;
      const me = this.api.myId();
      const myPick = v.phase === 'draft' && v.picker === me;
      this.root.querySelector('#tr-tasks').innerHTML = `
        <div class="tr-tasks-head"><h3 class="kb-sub">任務</h3>
          ${v.phase === 'draft' ? `<span class="tr-note">${myPick ? '<b>あなたの番:</b>引き受ける任務をタップ' : `${e(this.name(v.picker))}さんが選んでいます`}(隊長:${e(this.name(v.captain))}さん)</span>` : ''}</div>
        <div class="tr-task-list">${v.tasks.map((t) => {
          const ord = t.ord ? `<span class="tr-ord">${t.ord === 'last' ? '最後' : `${t.ord}番目`}</span>` : '';
          const who = t.owner ? `<span class="tr-owner${t.owner === me ? ' is-me' : ''}">${e(t.ownerName)}が取る</span>` : '<span class="tr-owner is-free">未分担</span>';
          return `<button class="tr-task${t.done ? ' is-done' : ''}" ${myPick && !t.owner ? `data-pick="${cid(t.card)}"` : 'disabled'}>${this.card(t.card)}${ord}${who}${t.done ? '<span class="tr-check">✓</span>' : ''}</button>`;
        }).join('')}</div>`;
    }

    // ---------- 卓(全員の公開情報と場) ----------
    renderTable(v) {
      const e = this.esc;
      const me = this.api.myId();
      const rows = v.players
        .map((p) => {
          const counts = ORDER.split('').map((c) => (p.counts[c] ? `<span class="tr-cnt tc-${c}">${c === 'x' ? '🚀' : CN[c]}${p.counts[c]}</span>` : '')).join('');
          const sig = p.signals.map((s) => `${this.card(s.card, { tag: `<small>${LABEL[s.label]}</small>`, cls: 'is-sig' })}`).join('');
          const open = p.open.filter((c) => !p.signals.some((s) => same(s.card, c))).map((c) => this.card(c)).join('');
          const tasks = v.tasks.filter((t) => t.owner === p.id).map((t) => this.card(t.card, { cls: t.done ? 'is-done' : 'is-task' })).join('');
          const inTrick = v.trick.find((t) => t.player === p.id);
          return `
            <div class="tr-row${v.turn === p.id ? ' is-turn' : ''}${p.id === me ? ' is-me' : ''}">
              <div class="tr-who"><span class="player-name">${e(p.name)}${p.id === me ? '(あなた)' : ''}</span>
                ${v.captain === p.id ? '<span class="tag tag-host">隊長</span>' : ''}${v.turn === p.id ? '<span class="tag tag-done">手番</span>' : ''}
                <span class="tr-meta">手札${p.count}・取った${p.won / v.players.length | 0}回</span></div>
              <div class="tr-counts">${counts}</div>
              <div class="tr-open">${sig}${open || (sig ? '' : '<span class="tr-none">公開札なし</span>')}</div>
              ${tasks ? `<div class="tr-mytasks"><span>任務</span>${tasks}</div>` : ''}
              <div class="tr-slot">${inTrick ? this.card(inTrick.card, { cls: 'is-played' }) : ''}</div>
            </div>`;
        })
        .join('');
      const lead = v.trick[0]?.card.c;
      const last = v.lastTrick;
      this.root.querySelector('#tr-table').innerHTML = `
        <div class="tr-trick-info">
          ${v.phase === 'play' ? (v.trick.length ? `場:${lead === 'x' ? '切り札' : `${CN[lead]}`}で始まった回(${v.trick.length}/${v.players.length}枚)` : `${e(this.name(v.leader))}さんが最初の札を出す番`) : ''}
          ${last ? `<span class="tr-last">前の回:${last.cards.map((t) => `${e(this.name(t.player))}${this.card(t.card)}`).join(' ')} → <b>${e(this.name(last.winner))}</b>が取った</span>` : ''}
        </div>
        <div class="tr-rows">${rows}</div>
        <p class="kt-note">出された色の一番強い札が取ります。その色を持っていれば必ず出す必要があり、持っていなければ何を出しても構いません。🚀切り札はどの色より強い札です。</p>`;
    }

    // ---------- 自分の手札 ----------
    renderMe(v) {
      const e = this.esc;
      const el = this.root.querySelector('#tr-me');
      if (!v.me) {
        el.innerHTML = '<p class="kt-note">観戦中です。</p>';
        return;
      }
      const myTurn = v.phase === 'play' && v.turn === this.api.myId();
      const canSignal = v.phase === 'play' && !v.trick.length && v.me.signalsLeft > 0 && v.me.hand.some((c) => c.signals.length);
      const hand = v.me.hand
        .map((c) => {
          const legal = myTurn && c.legal && !this.sigMode;
          const sigOk = this.sigMode && c.signals.length;
          const cls = [c.open ? 'is-open' : 'is-hidden', legal ? 'is-legal' : '', this.sel === cid(c) || this.sigCard === cid(c) ? 'is-sel' : '', this.sigMode && !sigOk ? 'is-dim' : ''].join(' ');
          const attr = legal ? `data-sel="${cid(c)}"` : sigOk ? `data-sig="${cid(c)}"` : '';
          return this.card(c, { cls, attr: `${attr} role="button"`, tag: `<small>${c.open ? '公開' : '非公開'}</small>` });
        })
        .join('');
      let action = '';
      if (this.sigMode) {
        const c = v.me.hand.find((x) => cid(x) === this.sigCard);
        action = c
          ? `<div class="tr-actions">${c.signals.map((l) => `<button class="btn btn-primary" data-label="${l}">「${CN[c.c]}${c.n}」は${LABEL[l]}</button>`).join('')}<button class="btn btn-quiet" data-act="sigCancel">やめる</button></div>`
          : '<div class="tr-actions"><span class="tr-note">合図に使う非公開の札をタップ(光っている札だけ使えます)</span><button class="btn btn-quiet" data-act="sigCancel">やめる</button></div>';
      } else if (myTurn) {
        action = `<div class="tr-actions"><span class="tr-note"><b>あなたの番</b>:出す札を選んでから「出す」</span>
          <button class="btn btn-primary" data-act="play" ${this.sel ? '' : 'disabled'}>${this.sel ? `「${this.cardText(this.sel)}」を出す` : '札を選んでください'}</button></div>`;
      } else if (v.phase === 'play') {
        action = `<div class="tr-actions"><span class="tr-note">${e(this.name(v.turn))}さんの番です</span></div>`;
      }
      el.innerHTML = `
        <div class="tr-me-head"><h3 class="kb-sub">あなたの手札</h3>
          ${v.phase === 'play' ? `<button class="btn btn-small" data-act="sigStart" ${canSignal && !this.sigMode ? '' : 'disabled'}>合図を出す(残り${v.me.signalsLeft})</button>` : ''}</div>
        <div class="tr-hand">${hand}</div>
        ${action}
        <p class="kt-note">「公開」の札はみんなにも見えています。合図は、場に札が出ていないときに、非公開の札を1枚見せて「この色の最高/最低/1枚だけ」を伝えるものです。チャットの数字は自動で伏せ字になります。</p>`;
    }

    cardText(id) {
      const c = id.slice(0, 1);
      return `${CN[c]}${id.slice(1)}`;
    }

    // ---------- 出た札の記録 ----------
    renderTrack(v) {
      const rows = ORDER.split('')
        .map((c) => {
          const max = c === 'x' ? 4 : 9;
          const cells = Array.from({ length: max }, (_, i) => {
            const n = i + 1;
            const card = { c, n };
            const gone = v.played.some((x) => same(x, card));
            const removed = v.removed?.some((x) => same(x, card));
            const task = v.tasks.find((t) => same(t.card, card) && !t.done);
            return `<span class="tr-cell tc-${c}${gone ? ' is-gone' : ''}${removed ? ' is-removed' : ''}${task ? ' is-task' : ''}">${n}</span>`;
          }).join('');
          return `<div class="tr-trow"><span class="tr-tlabel">${c === 'x' ? '🚀' : CN[c]}</span>${cells}</div>`;
        })
        .join('');
      this.root.querySelector('#tr-track').innerHTML = `
        <h3 class="kb-sub">札の記録</h3>
        <div class="tr-track">${rows}</div>
        <p class="kt-note">薄い札はもう出た札、斜線は抜いた札、枠つきは任務の札です。</p>`;
    }

    renderBlunders(v) {
      const e = this.esc;
      this.root.querySelector('#tr-blunders').innerHTML = `
        <h3 class="kb-sub">今日のやらかし</h3>
        ${v.blunders.length ? `<ul class="tr-blist">${v.blunders.map((b) => `<li><b>${e(b.name)}</b> ステージ${b.stage}${b.avoidable ? ' <span class="tag">避けられた</span>' : ''}<small>${e(b.reason)}</small></li>`).join('')}</ul>` : '<p class="kt-note">まだありません。</p>'}`;
    }

    // ---------- 結果 ----------
    renderOverlay(v) {
      const el = this.root.querySelector('#tr-overlay');
      if (v.phase !== 'result' || !v.result) {
        el.innerHTML = '';
        return;
      }
      const e = this.esc;
      const r = v.result;
      const host = this.api.isHost();
      const last = v.lastTrick;
      el.innerHTML = `
        <div class="mn-modal">
          <div class="mn-modal-card tr-result">
            <span class="event-label">ステージ${v.stage}</span>
            ${r.ok
              ? '<h2 class="mn-modal-title">任務成功!</h2>'
              : `<p class="gk-br-stamp">${r.culprit ? 'やらかし!' : '失敗…'}</p>
                 ${r.culprit ? `<p class="tr-culprit">${e(r.culpritName)}</p>` : ''}
                 <p class="mn-modal-text">${e(r.reason)}</p>
                 ${r.avoidable ? '<p class="gk-br-me">そのとき、取らずに済む札も出せました</p>' : ''}
                 ${last ? `<p class="tr-last">最後の回:${last.cards.map((t) => `${e(this.name(t.player))}${this.card(t.card)}`).join(' ')}</p>` : ''}`}
            ${host
              ? `<button class="btn btn-primary btn-block" data-act="next">${r.ok ? (v.stage >= v.stages ? '作戦を終える' : '次のステージへ') : '同じステージに再挑戦'}</button>
                 ${!r.ok || v.stage < v.stages ? '<button class="btn btn-quiet" data-act="end">ここで終わりにする</button>' : ''}`
              : '<p class="hint wait">ホストが次へ進めます</p>'}
          </div>
        </div>`;
    }

    renderEnd(v) {
      const e = this.esc;
      this.root.querySelector('.tr').innerHTML = `
        <div class="mk-end">
          <p class="mk-rank-label">作戦の成果</p>
          <p class="mk-rank">${v.cleared}</p>
          <p class="mk-end-sub">ステージ${v.cleared}までクリア</p>
          <h3 class="kb-sub">今日のやらかし(${v.blunders.length}回)</h3>
          ${v.blunders.length ? `<ul class="tr-blist">${v.blunders.map((b) => `<li><b>${e(b.name)}</b> ステージ${b.stage}${b.avoidable ? ' <span class="tag">避けられた</span>' : ''}<small>${e(b.reason)}</small></li>`).join('')}</ul>` : '<p class="kt-note">ノーミス!</p>'}
          ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}
        </div>`;
    }

    // ---------- 入力 ----------
    onClick(ev) {
      const v = this.v;
      const t = ev.target.closest('[data-pick],[data-sel],[data-sig],[data-label],[data-act]');
      if (!t || t.disabled) return;
      if (t.dataset.pick) return this.api.send('pick', { card: t.dataset.pick });
      if (t.dataset.sel) {
        this.sel = this.sel === t.dataset.sel ? null : t.dataset.sel;
        return this.renderMe(v);
      }
      if (t.dataset.sig) {
        this.sigCard = t.dataset.sig;
        return this.renderMe(v);
      }
      if (t.dataset.label) {
        this.api.send('signal', { card: this.sigCard, label: t.dataset.label });
        this.sigMode = false;
        this.sigCard = null;
        return;
      }
      switch (t.dataset.act) {
        case 'play':
          if (this.sel) this.api.send('play', { card: this.sel });
          this.sel = null;
          break;
        case 'sigStart':
          this.sigMode = true;
          this.sel = null;
          this.renderMe(v);
          break;
        case 'sigCancel':
          this.sigMode = false;
          this.sigCard = null;
          this.renderMe(v);
          break;
        case 'next':
          this.api.send('next');
          break;
        case 'end':
        case 'finish':
          this.api.send('finish');
          break;
        default:
      }
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.trick = { create: (root, api) => new TrickClient(root, api) };
})();
