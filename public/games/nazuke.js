(() => {
  'use strict';

  // 名付けカードの画面。
  // カードは「サーバー時計で showAt に出す」と予約付きで届くので、その時刻になってから表にする(全員同時)。
  // 全員に同じ入力欄があり(初めての絵でも前に出た絵でも同じ見た目)、送信した時刻をサーバーの時計で送る。
  // 一番早く送った人の答えが判定される。初めての絵なら、出した人の答えが名前になる。

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
      this.draft = { no: null, text: '' }; // 書きかけ(判定のあとで画面を作り直しても消さない)
      this.sending = 0;
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
        this.sending = 0;
        if (this.v) this.refresh(this.v);
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
      const label = { flip: 'めくる', open: '回答', judge: '判定', result: '正解!', miss: '時間切れ', named: '名付け', ended: '最終結果' }[v.phase];
      this.root.innerHTML = `
        <div class="kb nz">
          <div class="kb-head">
            <span class="kb-round">山札 残り${v.deckLeft} / ${v.deckTotal}枚</span>
            <span class="kb-phase">${label}</span>
            ${this.stageHtml(v)}
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
      const input = this.root.querySelector('#nz-ans');
      if (input) {
        if (this.draft.no === v.card?.no) input.value = this.draft.text;
        else this.draft = { no: v.card?.no ?? null, text: '' };
        input.addEventListener('input', () => { this.draft.text = input.value; });
        this.api.onEnter(input, () => this.send(input.value));
        if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus(), 30);
      }
    }

    // 後半ほど得点が高くなる表示
    stageHtml(v) {
      if (v.phase === 'ended' || v.scaling === 'none') return '';
      const name = { 1: '前半', 2: '残り半分', 4: '残り1/4' }[v.stage] || '';
      const what = v.scaling === 'mult' ? `正解で×${v.stage}` : `1枚${v.stage}点`;
      return `<span class="nz-stage-tag nz-stage-${v.stage}">${name}・${what}</span>`;
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
      if (v.phase === 'open') {
        // 初めての絵か前に出た絵かで見た目を変えない
        return `<h3 class="kb-sub">この絵の名前は?</h3>
                <div class="kt-tip-row">
                  <input id="nz-ans" maxlength="40" placeholder="名前を書いて送信" autocomplete="off" enterkeyhint="send">
                  <button class="btn btn-primary" id="nz-send" type="button">送信</button>
                </div>
                ${v.flipper ? `<div class="nz-suggest"><span class="kt-note">名前の候補:</span>${(v.suggestions || []).map((x) => `<button class="btn btn-small" type="button" data-suggest="${e(x)}">${e(x)}</button>`).join('')}</div>` : ''}
                ${v.names.length ? `<div class="nz-names" id="nz-names">${v.names.map((n) => `<button class="btn nz-name-btn" type="button" data-answer="${e(n)}">${e(n)}</button>`).join('')}</div>` : ''}
                <p class="kt-hint" id="nz-error"></p>
                <div class="nz-act-foot">
                  <p class="nz-status" id="nz-status"></p>
                  <button class="btn btn-quiet btn-small" id="nz-pass" type="button">わからない</button>
                </div>
                <p class="kt-note">${v.flipper ? 'あなたが出したカードです。初めての絵なら、あなたの答えがそのまま名前になります。' : '送信が一番早い人の答えで決まります。'}初めての絵に、出した人以外が答えたり、出した人がすでにある名前を答えたりするとお手つき${v.foul !== 'none' ? '(−1点)' : ''}。</p>`;
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
                <p class="nz-gain">場の${r.taken}枚を獲得${r.mult > 1 ? `(×${r.mult})` : ''} <b>+${r.gain}点</b></p>
                ${r.text !== r.name ? `<p class="kt-note">答え:「${e(r.text)}」${r.how === 'host' ? '(ホスト判定)' : r.how === 'vote' ? '(みんなの判定)' : ''}</p>` : ''}`;
      }
      if (v.phase === 'miss' && v.result) {
        return `<p class="nz-big">誰も答えられず…</p>
                <p class="kt-note">${v.result.name ? `正解は「${e(v.result.name)}」。` : ''}カードは場に残ります(場に${v.result.field}枚)。</p>`;
      }
      if (v.phase === 'named' && v.result) {
        return `<p class="nz-big">「${e(v.result.name)}」</p>
                <p class="kt-note">初めての絵でした!${v.result.auto ? '自動で名付けました' : `${e(this.nameOf(v.result.by))}さんが名付けました`}。次に出たら、この名前を答えましょう。</p>`;
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
        const n = v.phase === 'result' ? v.result?.taken ?? 0 : v.field;
        const pts = v.phase === 'result' ? v.result?.gain ?? 0 : v.fieldValue;
        field.textContent = !n ? '場は空' : v.scaling === 'none' ? `場に${n}枚` : `場に${n}枚・${pts}点`;
      }
      const cap = this.root.querySelector('#nz-caption');
      if (cap) {
        const e = this.esc;
        const no = v.card ? `${v.card.no}枚目・${e(this.nameOf(v.card.by))}さんが出した` : '';
        cap.innerHTML = v.phase === 'flip' ? `<b>${e(this.nameOf(v.turnId))}</b>さんの番` : no;
      }
      if (v.phase === 'open') this.refreshOpen(v);
      if (v.phase === 'judge' && v.judge) {
        const t = this.root.querySelector('#nz-tally');
        if (t) t.textContent = `◯ ${v.judge.yes} ・ ✕ ${v.judge.no}(判定する人 ${v.judge.voters}人、過半数で決定)`;
        this.root.querySelectorAll('[data-vote]').forEach((b) => {
          b.classList.toggle('is-on', v.judge.myVote !== null && String(Number(v.judge.myVote)) === b.dataset.vote);
        });
      }
    }

    refreshOpen(v) {
      const shown = this.shown();
      if (v.pressed || v.locked) this.sending = 0;
      const sending = this.sending && Date.now() - this.sending < 2000;
      const blocked = v.locked || v.passed || v.pressed || sending || !shown;
      this.root.querySelectorAll('#nz-ans, #nz-send, #nz-pass, [data-answer], [data-suggest]').forEach((b) => { b.disabled = blocked; });
      const st = this.root.querySelector('#nz-status');
      if (st) {
        const e = this.esc;
        const lw = v.lastWrong;
        const wrong = lw ? `${e(this.nameOf(lw.who))}さんの「${e(lw.text)}」は✕${lw.pen ? '(−1点)' : ''}。` : '';
        st.innerHTML = v.locked ? `${wrong}このカードではもう答えられません`
          : v.passed ? 'パスしました'
          : v.pressed || sending ? '送信しました…'
          : v.pending ? `${wrong}誰かが送信しました…`
          : !shown ? 'めくっています…'
          : wrong;
      }
    }

    renderPlayers(v) {
      const e = this.esc;
      const tag = (p) => {
        if (p.state === 'wrong') return '<span class="tag">✕</span>';
        if (p.state === 'pass') return '<span class="tag">パス</span>';
        if (p.state === 'pressed') return '<span class="tag tag-done">送信</span>';
        return '';
      };
      const list = v.phase === 'ended' ? [...v.players].sort((a, b) => b.score - a.score) : v.players;
      this.root.querySelector('#nz-players').innerHTML = `
        <h3 class="kb-sub">得点</h3>
        <ul class="kt-team">${list.map((p) => `
          <li class="${p.connected ? '' : 'is-away'}${p.id === v.turnId && v.phase !== 'ended' ? ' nz-turn' : ''}">
            <span class="player-name">${e(p.name)}</span>
            ${p.id === this.me() ? '<span class="tag">あなた</span>' : ''}
            ${p.id === v.turnId && v.phase !== 'ended' ? '<span class="tag tag-host">手番</span>' : ''}
            ${tag(p)}
            <span class="kt-tickets"><b class="nz-score">${p.score}</b>点 <small>(${p.taken}枚・正解${p.correct}・名付け${p.named})</small></span>
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
        const input = this.root.querySelector('#nz-ans');
        if (input) { input.value = t.dataset.suggest; this.draft.text = input.value; input.focus(); }
        return;
      }
      if (t.id === 'nz-send') return this.send(this.root.querySelector('#nz-ans')?.value);
      if (t.dataset.answer != null) return this.send(t.dataset.answer);
      if (t.id === 'nz-pass') return this.api.send('pass');
      if (t.dataset.vote != null) return this.api.send('vote', { ok: t.dataset.vote === '1' });
    }

    // 送信した瞬間(サーバーの時計)を一緒に送る。一番早い人の答えで決まる
    send(raw) {
      const v = this.v;
      const text = String(raw ?? '').trim();
      const input = this.root.querySelector('#nz-ans');
      if (!v || v.phase !== 'open' || v.locked || v.passed || v.pressed || !this.shown()) return;
      if (!text) return input?.focus();
      const pressAt = this.api.now();
      const err = this.root.querySelector('#nz-error');
      if (err) err.textContent = '';
      this.sending = Date.now();
      this.refreshOpen(v);
      this.api.send('answer', { text, pressAt });
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.nazuke = { create: (root, api) => new NazukeClient(root, api) };
})();
