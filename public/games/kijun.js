(() => {
  'use strict';

  const VERDICT = { hit: '当たり +2', near: '近い +1', miss: 'はずれ' };

  class KijunClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.sel = [];
      this.finalWord = null;
      this.rank = [];
      this.verdicts = {};
    }

    destroy() {}

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.sel = [];
        this.rank = [];
        this.verdicts = {};
        if (v.phase !== 'final') this.finalWord = null;
        this.build(v);
      }
      this.refresh(v);
    }

    build(v) {
      this.root.innerHTML = `
        <div class="kb kj">
          <div class="kb-head">
            <span class="kb-round">${v.phase === 'ended' ? '終了' : `ラウンド ${v.round} / ${v.rounds}`}</span>
            <span class="kb-phase">親:${this.esc(v.parentName || '')}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div class="kj-banner" id="kj-banner"></div>
          <div class="kt-layout kj-layout">
            <div class="kj-main" id="kj-main"></div>
            <aside class="kt-side">
              <section class="kt-panel" id="kj-asks"></section>
              <section class="kt-panel" id="kj-score"></section>
            </aside>
          </div>
        </div>`;
      this.root.querySelector('#kj-main').addEventListener('click', (e) => this.onClick(e));
      this.root.querySelector('#kj-main').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        if (e.target.id === 'kj-write') {
          e.preventDefault();
          this.root.querySelector('[data-act="write"]')?.click();
        }
        if (e.target.id === 'kj-crit') {
          e.preventDefault();
          this.root.querySelector('[data-act="customCrit"]')?.click();
        }
      });
    }

    refresh(v) {
      this.renderBanner(v);
      // 入力中の文字や選択を消さないよう、手元の表示に関係する情報が変わったときだけ描き直す
      const sig = JSON.stringify([v.phase, v.seq, v.myHand, v.myCands, v.myRerolls, v.myReady, v.options, v.critRerolls, v.criterionOwn, v.criterion, v.pool, v.pending, v.asker, v.myFinal, v.submitted, v.result, v.players.map((p) => p.score)]);
      if (sig !== this.mainSig) {
        this.mainSig = sig;
        this.renderMain(v);
      }
      this.renderAsks(v);
      this.renderScore(v);
    }

    renderBanner(v) {
      const e = this.esc;
      const el = this.root.querySelector('#kj-banner');
      if (v.phase === 'ended') {
        el.innerHTML = '<p class="kj-crit">ゲーム終了</p>';
      } else if (v.criterion && (v.role === 'parent' || v.phase === 'result')) {
        el.innerHTML = `<span class="kj-label">${v.phase === 'result' ? '基準は' : 'あなたの基準(秘密)'}</span><p class="kj-crit">${e(v.criterion)}もの</p>`;
      } else {
        el.innerHTML = `<span class="kj-label">基準は?</span><p class="kj-crit kj-hidden">${v.criterionChosen ? '???もの' : '親が選んでいます…'}</p>`;
      }
    }

    word(id) {
      return this.v.pool.find((x) => x.id === id)?.w || '?';
    }

    card(w, { sel = false, owner = null, own = false, attr = '' } = {}) {
      return `<button class="kj-card${sel ? ' is-sel' : ''}${own ? ' is-own' : ''}" ${attr}>${this.esc(w)}${owner ? `<small>${this.esc(owner)}</small>` : ''}</button>`;
    }

    renderMain(v) {
      const e = this.esc;
      const el = this.root.querySelector('#kj-main');
      const hand = (v.myHand || []).map((h) => this.card(h.w, { own: h.own, attr: 'disabled' })).join('');
      const pool = () =>
        v.pool
          .map((x) => this.card(x.w, { sel: this.sel.includes(x.id), owner: x.ownerName, attr: `data-pick="${e(x.id)}" ${v.phase === 'ask' && v.asker === this.api.myId() ? '' : 'disabled'}` }))
          .join('');

      if (v.phase === 'prepare') {
        if (v.role === 'parent') {
          el.innerHTML = `
            <div class="kt-panel">
              <h3 class="kb-sub">基準を決める(子には秘密)</h3>
              <div class="kj-options">${v.options.map((o) => `<button class="btn${v.criterion === o && !v.criterionOwn ? ' btn-primary' : ''}" data-crit="${e(o)}">${e(o)}もの</button>`).join('')}</div>
              <button class="btn btn-quiet btn-small" data-act="rerollCrit" ${v.critRerolls > 0 ? '' : 'disabled'}>ほかの候補を出す(残り${v.critRerolls}回)</button>
              <h3 class="kb-sub">自分で書く</h3>
              <div class="answer-entry"><input id="kj-crit" maxlength="20" placeholder="例:ドラゴンが嫌がりそうな"><button class="btn${v.criterionOwn ? ' btn-primary' : ''}" data-act="customCrit">これにする</button></div>
              ${v.criterionOwn ? `<p class="kt-note">自分で書いた基準「${e(v.criterion)}もの」に決めました。</p>` : ''}
              <p class="kt-note">比べられたときに「分かりやすく、でも一目では分からない」判定ができる基準がおすすめです。子が基準を当てるほど、あなたにも得点が入ります。</p>
            </div>`;
        } else {
          const full = v.myHand.length >= v.handSize;
          const inHand = new Set(v.myHand.filter((h) => !h.own).map((h) => h.w));
          el.innerHTML = `
            <div class="kt-panel">
              <h3 class="kb-sub">手札(${v.myHand.length} / ${v.handSize})</h3>
              <div class="kj-cards kj-hand">${v.myHand.map((h) => `<button class="kj-card is-sel${h.own ? ' is-own' : ''}" data-remove="${e(h.id)}" title="タップで外す">${e(h.w)}<small>${h.own ? '自作・外す' : '外す'}</small></button>`).join('') || '<p class="kt-note">下の候補から選ぶか、自分で書いて手札を作ります。</p>'}</div>
              <h3 class="kb-sub">候補から選ぶ</h3>
              <div class="kj-cards">${v.myCands.map((w) => this.card(w, { sel: inHand.has(w), attr: `data-cand="${e(w)}" ${inHand.has(w) || full ? 'disabled' : ''}` })).join('')}</div>
              <button class="btn btn-quiet btn-small" data-act="reroll" ${v.myRerolls > 0 ? '' : 'disabled'}>候補を引き直す(残り${v.myRerolls}回・選んだものは残ります)</button>
              <h3 class="kb-sub">自分で書く</h3>
              <div class="answer-entry"><input id="kj-write" maxlength="20" placeholder="例:おばあちゃんの梅干し" ${full ? 'disabled' : ''}><button class="btn" data-act="write" ${full ? 'disabled' : ''}>追加</button></div>
              <button class="btn ${v.myReady ? '' : 'btn-primary'} btn-block" data-act="ready" ${full ? '' : 'disabled'}>${v.myReady ? '決定済み(変えるなら札を外す)' : full ? 'この手札で決定' : `あと${v.handSize - v.myHand.length}枚`}</button>
              <p class="kt-note">時間内に決めきれなかった分は、候補から自動で補います。</p>
            </div>`;
        }
        return;
      }

      if (v.phase === 'ask' || v.phase === 'answer') {
        const myTurn = v.phase === 'ask' && v.asker === this.api.myId();
        let action = '';
        if (v.phase === 'answer' && v.role === 'parent') {
          action = `
            <div class="kj-judge">
              <p>基準「${e(v.criterion)}もの」で比べると?</p>
              <div class="kj-judge-btns">
                <button class="btn btn-primary" data-ans="a">${e(v.pending.a)} の勝ち</button>
                <button class="btn" data-ans="draw">引き分け</button>
                <button class="btn btn-primary" data-ans="b">${e(v.pending.b)} の勝ち</button>
              </div>
            </div>`;
        } else if (v.phase === 'answer') {
          action = `<p class="kj-wait">「${e(v.pending.a)}」と「${e(v.pending.b)}」、親が判定中…</p>`;
        } else if (myTurn) {
          action = `
            <p class="kj-turn">あなたの番:場の言葉を2つ選んで、親に比べてもらいましょう(${this.sel.length}/2)</p>
            <button class="btn btn-primary btn-block" data-act="ask" ${this.sel.length === 2 ? '' : 'disabled'}>「${e(this.word(this.sel[0]))}」と「${e(this.word(this.sel[1]))}」を比べて!</button>`;
        } else {
          action = `<p class="kj-wait">${e(v.askerName)}さんが比べる言葉を選んでいます(残り${v.askLeft}回)。チャットで作戦を話せます。</p>`;
        }
        el.innerHTML = `
          <div class="kt-panel">
            ${action}
            <h3 class="kb-sub">場の言葉(全員の手札)</h3>
            <div class="kj-cards">${pool()}</div>
          </div>`;
        return;
      }

      if (v.phase === 'final') {
        if (v.role === 'child') {
          const chosen = this.finalWord || v.myFinal?.cardId;
          el.innerHTML = `
            <div class="kt-panel">
              <h3 class="kb-sub">基準に一番合うと思う手札を1枚出す</h3>
              <div class="kj-cards">${(v.myHand || []).map((h) => this.card(h.w, { sel: chosen === h.id, own: h.own, attr: `data-final="${e(h.id)}"` })).join('')}</div>
              <label class="field"><span>基準の予想(任意・当たりで+2)</span><input id="kj-guess" maxlength="20" placeholder="例:重い" value="${e(v.myFinal?.guess || this.guessDraft || '')}"></label>
              <button class="btn btn-primary btn-block" data-act="final" ${chosen ? '' : 'disabled'}>${v.myFinal ? '出し直す' : 'この札で勝負'}</button>
              ${v.myFinal ? `<p class="kt-note">「${e(v.myFinal.word)}」を出しました。ほかの人を待っています。</p>` : ''}
            </div>`;
          const g = el.querySelector('#kj-guess');
          g.addEventListener('input', () => { this.guessDraft = g.value; });
        } else {
          el.innerHTML = '<div class="kt-panel"><p class="kj-wait">子が勝負の札を選んでいます…</p></div>';
        }
        return;
      }

      if (v.phase === 'rank') {
        if (v.role === 'parent') {
          const order = this.rank;
          el.innerHTML = `
            <div class="kt-panel">
              <h3 class="kb-sub">基準「${e(v.criterion)}もの」に合う順に、上からタップ</h3>
              <p class="kt-note">誰の札かは伏せてあります。1位+3点・2位+2点・3位+1点です。</p>
              <div class="kj-rank">${v.submitted.map((s) => {
                const i = order.indexOf(s.id);
                return `
                  <div class="kj-rank-row">
                    <button class="kj-card kj-rank-card${i >= 0 ? ' is-sel' : ''}" data-rank="${e(s.id)}">${i >= 0 ? `<b>${i + 1}位</b> ` : ''}${e(s.word)}</button>
                    ${s.guess ? `<div class="kj-verdict"><span>予想「${e(s.guess)}」</span>${['hit', 'near', 'miss'].map((k) => `<button class="btn btn-small${(this.verdicts[s.id] || 'miss') === k ? ' btn-primary' : ''}" data-verdict="${k}" data-id="${e(s.id)}">${VERDICT[k].split(' ')[0]}</button>`).join('')}</div>` : ''}
                  </div>`;
              }).join('')}</div>
              <div class="kb-actions"><button class="btn btn-quiet" data-act="reset">順位をやり直す</button>
                <button class="btn btn-primary" data-act="decide" ${order.length === v.submitted.length ? '' : 'disabled'}>この順位で決定</button></div>
            </div>`;
        } else {
          el.innerHTML = `<div class="kt-panel"><p class="kj-wait">親が順位をつけています…${v.myFinal ? `(あなたは「${e(v.myFinal.word)}」)` : ''}</p></div>`;
        }
        return;
      }

      if (v.phase === 'result' && v.result) {
        const r = v.result;
        el.innerHTML = `
          <div class="kt-panel">
            <h3 class="kb-sub">順位</h3>
            <ol class="kj-result">${r.order.map((o, i) => `
              <li><span class="rank">${i + 1}位</span><span class="kj-word">${e(o.word)}</span><span class="kj-who">${e(o.name)}</span>
                ${o.guess ? `<span class="kj-guess kj-${o.verdict}">予想「${e(o.guess)}」→ ${VERDICT[o.verdict]}</span>` : ''}
                <span class="num">+${o.gain}</span></li>`).join('')}</ol>
            <p class="kt-note">親の${e(v.parentName)}さん:基準を当てた・近かった人の数だけ +${r.parentGain}</p>
            ${this.api.isHost() ? `<button class="btn btn-primary btn-block" data-act="next">${v.isLast ? '最終結果へ' : '次のラウンドへ'}</button>` : '<p class="hint wait">ホストが次へ進めます</p>'}
          </div>`;
        return;
      }

      if (v.phase === 'ended') {
        const rows = [...v.players].sort((a, b) => b.score - a.score);
        el.innerHTML = `
          <div class="kt-panel">
            <h2 class="kt-result">${e(rows[0]?.name || '')}さんの優勝</h2>
            <ol class="kj-result">${rows.map((p, i) => `<li><span class="rank">${i + 1}位</span><span class="kj-word">${e(p.name)}</span><span class="num">${p.score}点</span></li>`).join('')}</ol>
            ${this.api.isHost() ? '<button class="btn btn-primary btn-block" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}
          </div>`;
      }
    }

    renderAsks(v) {
      const e = this.esc;
      const rows = v.asks
        .map((a) => {
          const mark = a.result === '>' ? '>' : a.result === '<' ? '<' : a.result === '=' ? '=' : '?';
          const win = (w, side) => `<span class="kj-w${(side === 'a' && a.result === '>') || (side === 'b' && a.result === '<') ? ' is-win' : ''}">${e(w)}</span>`;
          return `<li>${win(a.a, 'a')}<b class="kj-mark">${mark}</b>${win(a.b, 'b')}</li>`;
        })
        .join('');
      this.root.querySelector('#kj-asks').innerHTML = `
        <h3 class="kb-sub">比べた結果</h3>
        ${rows ? `<ol class="kj-asks">${rows}</ol>` : '<p class="kt-note">まだ比べていません。「>」の左側が基準により合う言葉です。</p>'}`;
    }

    renderScore(v) {
      const e = this.esc;
      const status = (p) => (p.ready === null ? '' : p.ready ? '<span class="tag tag-done">OK</span>' : '<span class="tag">考え中</span>');
      this.root.querySelector('#kj-score').innerHTML = `
        <h3 class="kb-sub">得点</h3>
        <ul class="kt-team">${[...v.players].sort((a, b) => b.score - a.score).map((p) => `
          <li><span class="player-name">${e(p.name)}</span>${p.parent ? '<span class="tag tag-host">親</span>' : ''}${status(p)}<span class="kt-tickets">${p.score}点</span></li>`).join('')}</ul>`;
    }

    onClick(ev) {
      const v = this.v;
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.crit) return this.api.send('choose', { criterion: t.dataset.crit });
      if (t.dataset.cand) return this.api.send('pickCand', { word: t.dataset.cand });
      if (t.dataset.remove) return this.api.send('remove', { id: t.dataset.remove });
      if (t.dataset.pick) {
        const w = t.dataset.pick;
        this.sel = this.sel.includes(w) ? this.sel.filter((x) => x !== w) : [...this.sel, w].slice(-2);
        return this.renderMain(v);
      }
      if (t.dataset.ans) return this.api.send('answer', { pick: t.dataset.ans });
      if (t.dataset.final) {
        this.finalWord = t.dataset.final;
        return this.renderMain(v);
      }
      if (t.dataset.rank) {
        if (!this.rank.includes(t.dataset.rank)) this.rank.push(t.dataset.rank);
        return this.renderMain(v);
      }
      if (t.dataset.verdict) {
        this.verdicts[t.dataset.id] = t.dataset.verdict;
        return this.renderMain(v);
      }
      switch (t.dataset.act) {
        case 'write': {
          const i = this.root.querySelector('#kj-write');
          if (i.value.trim()) this.api.send('write', { word: i.value });
          i.value = '';
          break;
        }
        case 'customCrit': {
          const i = this.root.querySelector('#kj-crit');
          if (i.value.trim()) this.api.send('customCriterion', { text: i.value });
          break;
        }
        case 'rerollCrit':
          this.api.send('rerollCriteria');
          break;
        case 'reroll':
          this.api.send('reroll');
          break;
        case 'ready':
          this.api.send('ready', { value: !v.myReady });
          break;
        case 'ask':
          if (this.sel.length === 2) this.api.send('ask', { a: this.sel[0], b: this.sel[1] });
          break;
        case 'final':
          this.api.send('final', { id: this.finalWord || v.myFinal?.cardId, guess: this.root.querySelector('#kj-guess')?.value || '' });
          break;
        case 'reset':
          this.rank = [];
          this.renderMain(v);
          break;
        case 'decide':
          this.api.send('decide', { ranking: this.rank, verdicts: this.verdicts });
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
  window.GameClients.kijun = { create: (root, api) => new KijunClient(root, api) };
})();
