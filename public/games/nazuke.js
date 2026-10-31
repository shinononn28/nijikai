(() => {
  'use strict';

  // 名付けカードの画面。
  // カードは「サーバー時計で showAt に出す」と予約付きで届くので、その時刻になってから表にする(全員同時)。
  // 回答は名前のボタン(設定によっては自由入力も)。押した時刻をサーバーの時計で送り、一番早い人の答えが判定される。

  const C = window.NijiCards;

  class NazukeClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.revealTimer = null;
      this.onClickBound = (e) => this.onClick(e);
      root.addEventListener('click', this.onClickBound);
      this.unbind = NijiBuzz.bindPress(root, '#nz-flip', () => this.api.send('flip'));
    }

    destroy() {
      clearTimeout(this.revealTimer);
      this.unbind();
      this.root.removeEventListener('click', this.onClickBound);
    }

    onEvent(type, data) {
      if (type === 'nameError') {
        const el = this.root.querySelector('#nz-error');
        if (el) el.textContent = data?.error || '';
        const btn = this.root.querySelector('#nz-name-send');
        if (btn) btn.disabled = false;
      }
    }

    me() {
      return this.api.myId();
    }
    nameOf(id) {
      return this.v?.players.find((p) => p.id === id)?.name ?? '(退室済み)';
    }
    shown() {
      const c = this.v?.card;
      return !!c && this.api.now() >= c.showAt;
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

    // ---------- 組み立て(フェーズが変わったときだけ) ----------
    build(v) {
      const e = this.esc;
      const label = { flip: 'めくる', name: '名付け', answer: '回答', judge: '判定', result: '正解!', miss: '時間切れ', named: '名付け', ended: '最終結果' }[v.phase];
      this.root.innerHTML = `
        <div class="kb nz">
          <div class="kb-head">
            <span class="kb-round">山札 残り${v.deckLeft} / ${v.deckTotal}枚</span>
            <span class="kb-phase">${label}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          ${v.phase === 'ended' ? this.endedHtml(v) : `
            <div class="nz-stage">
              <div class="nz-pile" aria-label="場のカード">
                <div class="nz-card${v.field > 1 ? ' is-stacked' : ''}${v.field > 3 ? ' is-tall' : ''}" id="nz-card"></div>
                <span class="nz-field" id="nz-field"></span>
              </div>
              <p class="nz-caption" id="nz-caption"></p>
            </div>
            <section class="kt-panel nz-act" id="nz-act">${this.actHtml(v)}</section>`}
          <section class="kt-panel" id="nz-players"></section>
        </div>`;
      clearTimeout(this.revealTimer);
      if (v.card && !this.shown()) {
        this.revealTimer = setTimeout(() => this.update(this.v), Math.max(0, v.card.showAt - this.api.now()) + 10);
      }
      const input = this.root.querySelector('#nz-name, #nz-free');
      if (input) {
        this.api.onEnter(input, () => this.root.querySelector(input.id === 'nz-name' ? '#nz-name-send' : '#nz-free-send')?.click());
        if (input.id === 'nz-name' && !matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus(), 50);
      }
    }

    actHtml(v) {
      const e = this.esc;
      const me = this.me();
      if (v.phase === 'flip') {
        if (v.turnId === me) {
          return `<button class="btn btn-primary btn-block nz-flip" id="nz-flip" type="button">山札から1枚めくる</button>
                  <p class="kt-note">タップ(PCはスペースキー)でめくります。時間が来ると自動でめくります。</p>`;
        }
        return `<p class="nz-wait">${e(this.nameOf(v.turnId))}さんがめくるのを待っています</p>
                ${this.api.isHost() && !v.players.find((p) => p.id === v.turnId)?.connected ? '<button class="btn" id="nz-flip" type="button">代わりにめくる</button>' : ''}`;
      }
      if (v.phase === 'name') {
        if (v.card?.by === me) {
          return `<h3 class="kb-sub">初めて出た絵です。名前をつけてください</h3>
                  <div class="kt-tip-row">
                    <input id="nz-name" maxlength="16" placeholder="例:もちもち" autocomplete="off">
                    <button class="btn btn-primary" id="nz-name-send" type="button">決定</button>
                  </div>
                  <div class="nz-suggest"><span class="kt-note">思いつかなければ:</span>${(v.suggestions || []).map((s) => `<button class="btn btn-small" type="button" data-suggest="${e(s)}">${e(s)}</button>`).join('')}</div>
                  <p class="kt-hint" id="nz-error"></p>`;
        }
        return `<p class="nz-wait">初めて出た絵!${e(this.nameOf(v.card?.by))}さんが名前を考えています</p>
                <p class="kt-note">この絵をよく覚えておきましょう。</p>`;
      }
      if (v.phase === 'answer') {
        const free = v.answerMode === 'both'
          ? `<div class="kt-tip-row nz-free-row">
               <input id="nz-free" maxlength="40" placeholder="書いて答える" autocomplete="off">
               <button class="btn" id="nz-free-send" type="button">答える</button>
             </div>`
          : '';
        return `<h3 class="kb-sub">前に出た絵です。名前は?</h3>
                <div class="nz-names" id="nz-names">${v.names.map((n) => `<button class="btn nz-name-btn" type="button" data-answer="${e(n)}">${e(n)}</button>`).join('')}</div>
                ${free}
                <div class="nz-act-foot">
                  <p class="nz-status" id="nz-status"></p>
                  <button class="btn btn-quiet btn-small" id="nz-pass" type="button">わからない</button>
                </div>`;
      }
      if (v.phase === 'judge' && v.judge) {
        const j = v.judge;
        const hostDecides = v.judgeBy === 'host' && this.api.isHost() && j.answerer !== me;
        return `<h3 class="kb-sub">判定してください</h3>
                <div class="nz-judge">
                  <div><span class="kt-note">${e(this.nameOf(j.answerer))}さんの答え</span><b>${e(j.text)}</b></div>
                  <div><span class="kt-note">つけられた名前</span><b>${e(j.name)}</b></div>
                </div>
                ${j.canVote || hostDecides ? `
                  <div class="nz-vote">
                    <button class="btn btn-primary" type="button" data-vote="1">◯ 正解にする</button>
                    <button class="btn" type="button" data-vote="0">✕ 不正解</button>
                  </div>
                  ${hostDecides ? '<p class="kt-note">ホストが押すとその場で決まります。</p>' : ''}` : `<p class="nz-wait">${j.answerer === me ? 'ほかの人が判定しています' : '判定を待っています'}</p>`}
                <p class="kt-note" id="nz-tally"></p>`;
      }
      if (v.phase === 'result' && v.result) {
        const r = v.result;
        return `<p class="nz-big"><b>${e(this.nameOf(r.who))}</b>さん正解!「${e(r.name)}」</p>
                <p class="nz-gain">場の${r.gain}枚を獲得 <b>+${r.gain}点</b></p>
                ${r.text !== r.name ? `<p class="kt-note">答え:「${e(r.text)}」${r.how === 'host' ? '(ホスト判定)' : r.how === 'vote' ? '(みんなの判定)' : ''}</p>` : ''}`;
      }
      if (v.phase === 'miss' && v.result) {
        return `<p class="nz-big">誰も答えられず…</p>
                <p class="kt-note">${v.result.name ? `正解は「${e(v.result.name)}」。` : ''}カードは場に残ります(場に${v.result.field}枚)。</p>`;
      }
      if (v.phase === 'named' && v.result) {
        return `<p class="nz-big">「${e(v.result.name)}」</p>
                <p class="kt-note">${e(this.nameOf(v.result.by))}さんが名付けました。次に出たら、この名前を答えましょう。</p>`;
      }
      return '';
    }

    endedHtml(v) {
      const e = this.esc;
      const ranked = [...v.players].sort((a, b) => b.score - a.score);
      const top = ranked[0];
      const ties = ranked.filter((p) => p.score === top.score);
      return `
        <div class="kt-panel hy-end">
          <h2 class="kt-result">${ties.length > 1 ? `${ties.map((p) => e(p.name)).join('・')}さんが同点優勝` : `${e(top.name)}さんの優勝`}(${top.score}点)</h2>
          ${v.leftover ? `<p class="kt-result-sub">場に残った${v.leftover}枚は誰のものにもなりませんでした</p>` : ''}
          ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish" type="button">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}
        </div>
        <section class="kt-panel">
          <h3 class="kb-sub">名付けた絵(${v.gallery.length}種類)</h3>
          <div class="nz-gallery">${v.gallery.map((g) => `
            <div class="nz-gcell">${C.render(g.id)}<b>${e(g.name)}</b><span>${g.by ? `${e(g.by)}さん` : '自動'}</span></div>`).join('')}</div>
        </section>`;
    }

    // ---------- 毎回の更新 ----------
    refresh(v) {
      this.renderPlayers(v);
      if (v.phase === 'ended') return;
      const card = this.root.querySelector('#nz-card');
      if (card) {
        const show = this.shown();
        const html = !v.card ? '<span class="nz-back">?</span>' : show ? C.render(v.card.id) : '<span class="nz-back">…</span>';
        if (card.dataset.html !== html) {
          card.dataset.html = html;
          card.innerHTML = html;
          card.classList.toggle('is-face', !!v.card && show);
          card.classList.toggle('is-flip', !!v.card && show);
        }
        card.classList.toggle('is-win', v.phase === 'result');
      }
      const field = this.root.querySelector('#nz-field');
      if (field) {
        const n = v.phase === 'result' ? v.result?.gain ?? 0 : v.field;
        field.textContent = n ? `場に${n}枚` : '場は空';
      }
      const cap = this.root.querySelector('#nz-caption');
      if (cap) {
        const e = this.esc;
        const no = v.card ? `${v.card.no}枚目・${e(this.nameOf(v.card.by))}さんが出した` : '';
        cap.innerHTML = v.phase === 'flip' ? `<b>${e(this.nameOf(v.turnId))}</b>さんの番` : no;
      }
      if (v.phase === 'answer') this.refreshAnswer(v);
      if (v.phase === 'judge' && v.judge) {
        const t = this.root.querySelector('#nz-tally');
        if (t) t.textContent = `◯ ${v.judge.yes} ・ ✕ ${v.judge.no}(判定する人 ${v.judge.voters}人、過半数で決定)`;
        this.root.querySelectorAll('[data-vote]').forEach((b) => {
          b.classList.toggle('is-on', v.judge.myVote !== null && String(Number(v.judge.myVote)) === b.dataset.vote);
        });
      }
    }

    refreshAnswer(v) {
      const shown = this.shown();
      const blocked = v.locked || v.passed || v.pressed || !shown;
      this.root.querySelectorAll('[data-answer], #nz-free-send, #nz-pass, #nz-free').forEach((b) => { b.disabled = blocked; });
      const st = this.root.querySelector('#nz-status');
      if (st) {
        const e = this.esc;
        const wrong = v.lastWrong ? `${e(this.nameOf(v.lastWrong.who))}さんの「${e(v.lastWrong.text)}」は✕。` : '';
        st.innerHTML = v.locked ? `${wrong}このカードではもう答えられません`
          : v.passed ? 'パスしました'
          : v.pressed ? '答えを送りました…'
          : v.pending ? `${wrong}誰かが答えています…`
          : !shown ? 'めくっています…'
          : wrong || '一番早く押した人の答えで判定します';
      }
    }

    renderPlayers(v) {
      const e = this.esc;
      const tag = (p) => {
        if (p.state === 'wrong') return '<span class="tag">✕</span>';
        if (p.state === 'pass') return '<span class="tag">パス</span>';
        if (p.state === 'pressed') return '<span class="tag tag-done">回答中</span>';
        return '';
      };
      const list = v.phase === 'ended' ? [...v.players].sort((a, b) => b.score - a.score) : v.players;
      this.root.querySelector('#nz-players').innerHTML = `
        <h3 class="kb-sub">得点(とったカードの枚数)</h3>
        <ul class="kt-team">${list.map((p) => `
          <li class="${p.connected ? '' : 'is-away'}${p.id === v.turnId && v.phase !== 'ended' ? ' nz-turn' : ''}">
            <span class="player-name">${e(p.name)}</span>
            ${p.id === this.me() ? '<span class="tag">あなた</span>' : ''}
            ${p.id === v.turnId && v.phase !== 'ended' ? '<span class="tag tag-host">手番</span>' : ''}
            ${tag(p)}
            <span class="kt-tickets"><b class="nz-score">${p.score}</b>点 <small>(正解${p.correct}・名付け${p.named})</small></span>
          </li>`).join('')}</ul>`;
    }

    // ---------- 操作 ----------
    onClick(ev) {
      const v = this.v;
      if (!v) return;
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.act === 'finish') return this.api.send('finish');
      if (t.id === 'nz-flip' && !t.dataset.sent) {
        // スペースキーと pointerdown は bindPress が送る。ここはキーボード操作(Enter)のときだけ
        if (ev.detail === 0) this.api.send('flip');
        return;
      }
      if (t.dataset.suggest) {
        const input = this.root.querySelector('#nz-name');
        if (input) { input.value = t.dataset.suggest; input.focus(); }
        return;
      }
      if (t.id === 'nz-name-send') {
        const input = this.root.querySelector('#nz-name');
        const name = input?.value.trim();
        const err = this.root.querySelector('#nz-error');
        if (!name) { if (err) err.textContent = '名前を入れてください'; return input?.focus(); }
        if (err) err.textContent = '';
        t.disabled = true;
        return this.api.send('name', { name });
      }
      if (t.dataset.answer != null) return this.sendAnswer(t.dataset.answer, ev, t);
      if (t.id === 'nz-free-send') {
        const input = this.root.querySelector('#nz-free');
        const text = input?.value.trim();
        if (!text) return input?.focus();
        return this.sendAnswer(text, ev, t);
      }
      if (t.id === 'nz-pass') return this.api.send('pass');
      if (t.dataset.vote != null) return this.api.send('vote', { ok: t.dataset.vote === '1' });
    }

    sendAnswer(text, ev, btn) {
      const v = this.v;
      if (v.phase !== 'answer' || v.locked || v.passed || v.pressed || !this.shown()) return;
      const pressAt = NijiBuzz.pressAt(this.api, ev);
      btn.classList.add('is-picked');
      this.root.querySelectorAll('[data-answer], #nz-free-send, #nz-pass').forEach((b) => { b.disabled = true; });
      this.api.send('answer', { text, pressAt });
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.nazuke = { create: (root, api) => new NazukeClient(root, api) };
})();
