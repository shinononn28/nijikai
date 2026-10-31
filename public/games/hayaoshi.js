(() => {
  'use strict';

  // 早押しクイズの画面。
  // 問題文は1回だけ届き、時計合わせしたサーバー時刻(api.now())に沿ってこの画面で1文字ずつ出す。
  // 押した瞬間はイベントの timeStamp から「サーバー時計で何時に押したか」を出して送る。

  class HayaoshiClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.pressed = false;
      this.shown = -1;
      this.onClickBound = (e) => this.onClick(e);
      this.onPointerBound = (e) => this.onPointer(e);
      this.onKeyBound = (e) => this.onKey(e);
      root.addEventListener('click', this.onClickBound);
      root.addEventListener('pointerdown', this.onPointerBound);
      window.addEventListener('keydown', this.onKeyBound);
      this.loop = () => {
        this.raf = requestAnimationFrame(this.loop);
        this.tick();
      };
      this.raf = requestAnimationFrame(this.loop);
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      this.root.removeEventListener('click', this.onClickBound);
      this.root.removeEventListener('pointerdown', this.onPointerBound);
      window.removeEventListener('keydown', this.onKeyBound);
    }

    me() {
      return this.api.myId();
    }

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.pressed = false;
        this.frozen = null;
        this.shown = -1;
        this.build(v);
      }
      this.refresh(v);
    }

    // ---------- 組み立て ----------
    build(v) {
      const e = this.esc;
      const phase = { write: '出題待ち', reading: '問題', answer: '解答中', judge: '判定中', result: '結果', ended: '最終結果' }[v.phase];
      this.root.innerHTML = `
        <div class="kb hy">
          <div class="kb-head">
            <span class="kb-round">第${v.qno}問 / ${v.total}</span>
            <span class="kb-phase">${phase}</span>
            ${v.target ? `<span>${v.target}点先取</span>` : ''}
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div id="hy-stage"></div>
          <div class="kt-layout hy-layout">
            <section class="kt-panel" id="hy-players"></section>
            <section class="kt-panel" id="hy-side"></section>
          </div>
        </div>`;
      const stage = this.root.querySelector('#hy-stage');
      if (v.phase === 'write') stage.innerHTML = this.writeHtml(v);
      else if (v.phase === 'ended') stage.innerHTML = this.endedHtml(v);
      else {
        stage.innerHTML = `
          <div class="hy-card${v.q?.voice ? ' is-voice' : ''}">
            <div class="hy-meta" id="hy-meta"></div>
            <p class="hy-text" id="hy-text"></p>
          </div>
          <div id="hy-act"></div>`;
      }
      this.root.querySelector('#hy-q')?.focus();
    }

    writeHtml(v) {
      const e = this.esc;
      if (v.questioner !== this.me()) {
        const name = v.players.find((p) => p.id === v.questioner)?.name;
        return `<div class="kt-panel hy-wait"><p>${e(name)}さんが問題を考えています。</p><p class="kt-note">待っているあいだもチャットで話せます。</p></div>`;
      }
      return `
        <div class="kt-panel hy-write">
          <h2 class="kb-sub">あなたが出題者です</h2>
          <label class="field"><span>問題文(前から1文字ずつ表示されます)</span>
            <textarea id="hy-q" maxlength="200" rows="3" placeholder="例:日本で一番大きな湖は何でしょう?"></textarea></label>
          <label class="field"><span>答え(別解は / で区切る。ひらがな・カタカナの違いは自動で同じ扱い)</span>
            <input id="hy-a" maxlength="200" placeholder="例:琵琶湖 / びわこ" autocomplete="off"></label>
          <div class="kb-actions">
            <button class="btn btn-primary" data-act="write">この問題を出す</button>
            <button class="btn" data-act="voice" title="問題文を書かずに、通話で読み上げます">通話で読み上げる</button>
            <button class="btn btn-quiet" data-act="useBank">問題集から出す</button>
          </div>
          <p class="kt-note">「通話で読み上げる」では押した順番だけを判定します。答えを書いておけば自動で判定し、書かなければ〇×をあなたが押します。</p>
          <p class="error" id="hy-err" role="alert"></p>
        </div>`;
    }

    endedHtml(v) {
      const e = this.esc;
      const top = v.players[0];
      return `
        <div class="kt-panel hy-end">
          <h2 class="kt-result">${e(top.name)}さんの優勝(${top.score}点)</h2>
          ${(v.log || []).length ? `<ol class="hy-log">${v.log.map((l) => `<li><b>第${l.qno}問</b> ${l.text ? e(l.text) : '(通話で出題)'}<br><span class="kt-note">答え:${e(l.answer ?? '—')} ・ ${l.winner ? `${e(l.winner)}さんが正解` : '正解者なし'}</span></li>`).join('')}</ol>` : ''}
          ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}
        </div>`;
    }

    // ---------- 更新 ----------
    refresh(v) {
      this.renderPlayers(v);
      this.renderSide(v);
      if (!['write', 'ended'].includes(v.phase)) {
        this.renderMeta(v);
        this.renderAct(v);
        this.shown = -1;
        this.tick();
      }
    }

    // 時刻 t(サーバー時計)に何文字まで出ているか
    shownAt(v, t) {
      const r = v.reveal;
      const len = v.q?.text?.length ?? 0;
      if (!r.segStart) return r.from;
      return Math.min(len, r.from + Math.max(0, Math.floor((t - r.segStart) / v.charMs)));
    }

    tick() {
      const v = this.v;
      const el = this.root.querySelector('#hy-text');
      if (!v || !el || !v.q) return;
      if (v.q.voice) {
        const n = v.phase === 'reading' && v.reveal.segStart && this.api.now() < v.reveal.segStart;
        const txt = n ? 'まもなく読み上げ…' : v.phase === 'result' ? '(通話で出題)' : '🎙 出題者が読み上げています';
        if (el.textContent !== txt) el.textContent = txt;
        return;
      }
      const now = this.api.now();
      let count = this.frozen != null && this.pressed ? this.frozen : this.shownAt(v, now);
      const waiting = v.phase === 'reading' && v.reveal.segStart && now < v.reveal.segStart && v.reveal.from === 0;
      const stateKey = `${count}:${waiting}`;
      if (stateKey === this.shown) return;
      this.shown = stateKey;
      if (waiting) {
        el.innerHTML = '<span class="hy-ready">まもなく出題…</span>';
        return;
      }
      const text = v.q.text;
      // お手つき・正解した位置に「/」を入れる
      const marks = new Map();
      for (const a of v.attempts) marks.set(a.at, a.ok ? 'ok' : 'ng');
      if (['answer', 'judge'].includes(v.phase)) marks.set(v.reveal.from, 'now');
      const e = this.esc;
      let html = '';
      const full = v.phase === 'result';
      for (let i = 0; i <= text.length; i++) {
        if (marks.has(i) && i <= (full ? text.length : count)) html += `<span class="hy-slash is-${marks.get(i)}">/</span>`;
        if (i === text.length) break;
        if (i < count) html += e(text[i]);
        else if (full) html += `<span class="hy-rest">${e(text[i])}</span>`;
      }
      if (!full && count < text.length && v.phase === 'reading') html += '<span class="hy-caret"></span>';
      el.innerHTML = html;
    }

    renderMeta(v) {
      const e = this.esc;
      const el = this.root.querySelector('#hy-meta');
      if (!el) return;
      const by = v.q?.src === 'bank' ? '問題集' : `出題:${e(v.players.find((p) => p.id === v.questioner)?.name ?? '')}`;
      el.innerHTML = `<span>${by}</span>${v.phase === 'reading' && v.readEndsAt ? `<span>締め切りまで <span class="timer" data-ends-at="${v.readEndsAt}"></span></span>` : ''}`;
    }

    renderAct(v) {
      const e = this.esc;
      const el = this.root.querySelector('#hy-act');
      if (!el) return;
      const me = this.me();
      const isQ = v.questioner === me;
      const answererName = v.players.find((p) => p.id === v.answerer)?.name ?? '';
      if (v.phase === 'reading') {
        if (isQ) {
          el.innerHTML = `<div class="kb-actions hy-qctl"><p class="kt-note">あなたは出題者です。答え:${e((v.answers || []).join(' / ') || '(なし)')}</p><button class="btn" data-act="close">締め切って答えを出す</button></div>`;
          return;
        }
        const label = { resting: 'お休み中(前の問題のお手つき)', locked: 'お手つき(この問題は押せません)', watch: '見学中' }[v.myStatus];
        el.innerHTML = label
          ? `<button class="hy-buzz is-off" disabled>${label}</button>`
          : `<button class="hy-buzz${this.pressed ? ' is-pressed' : ''}" id="hy-buzz" ${this.pressed ? 'disabled' : ''}>${this.pressed ? '押した!判定中…' : '押す!'}<small>スペースキーでも押せます</small></button>`;
        if (!label && !this.pressed && v.attempts.length === 0 && this.api.isHost() && !v.questioner) {
          el.insertAdjacentHTML('beforeend', '<div class="kb-actions hy-qctl"><button class="btn btn-quiet btn-small" data-act="close">誰もわからなそうなら締め切る</button></div>');
        }
        return;
      }
      if (v.phase === 'answer' || v.phase === 'judge') {
        const margin = v.margin != null ? `<span class="hy-margin">2番手と${(v.margin / 1000).toFixed(2)}秒差</span>` : '';
        if (v.answerer === me && v.phase === 'answer') {
          if (this.root.querySelector('#hy-answer')) return; // 入力中の内容を消さない
          el.innerHTML = `
            <div class="kt-panel hy-answering">
              <p class="hy-you">あなたが押しました!${margin}</p>
              <div class="join-row"><input id="hy-answer" maxlength="60" placeholder="答えを入力してEnter" autocomplete="off"><button class="btn btn-primary" data-act="answer">答える</button></div>
              ${v.questioner ? '<p class="kt-note">通話で答えてもOK(出題者が判定します)。</p>' : ''}
            </div>`;
          const ans = el.querySelector('#hy-answer');
          this.api.onEnter(ans, () => this.submitAnswer());
          ans.focus();
          return;
        }
        const judge = isQ
          ? `<div class="kb-actions"><button class="btn btn-primary" data-act="judge" data-ok="1">〇 正解</button><button class="btn" data-act="judge" data-ok="0">× 不正解</button></div>
             <p class="kt-note">答え:${e((v.answers || []).join(' / ') || '(書いていません)')}</p>`
          : '';
        el.innerHTML = `
          <div class="kt-panel hy-answering">
            <p class="hy-you">${e(answererName)}さんが${v.phase === 'judge' ? '答えました。出題者が判定中' : '回答中'}${margin}</p>
            ${v.answerText ? `<p class="hy-given">「${e(v.answerText)}」</p>` : ''}
            ${judge}
          </div>`;
        return;
      }
      if (v.phase === 'result') {
        const canFix = isQ || this.api.isHost();
        const anyOk = v.attempts.some((a) => a.ok);
        el.innerHTML = `
          <div class="kt-panel hy-result">
            <p class="hy-answer-line">答え:<b>${e(v.answers?.[0] ?? '(出題者のみ知る)')}</b>${v.answers?.length > 1 ? `<span class="kt-note">(${e(v.answers.slice(1).join(' / '))})</span>` : ''}</p>
            <p class="hy-winner">${v.winner ? `🎉 ${e(v.winner)}さんが正解!` : '正解者なし'}</p>
            ${v.attempts.length ? `<ul class="hy-attempts">${v.attempts.map((a, i) => `<li class="${a.ok ? 'is-ok' : 'is-ng'}"><span>${a.ok ? '〇' : '×'}</span><span>${e(a.name)}</span><span>「${e(a.text)}」</span><span class="kt-note">${a.at}文字目</span>${!a.ok && !anyOk && canFix && a.text && !a.text.startsWith('(') ? `<button class="btn btn-small" data-act="accept" data-i="${i}">正解にする</button>` : ''}</li>`).join('')}</ul>` : ''}
            ${canFix ? '<div class="kb-actions"><button class="btn btn-small" data-act="next">次の問題へ</button></div>' : ''}
          </div>`;
      }
    }

    renderPlayers(v) {
      const e = this.esc;
      const st = { questioner: '<span class="tag">出題者</span>', resting: '<span class="tag">お休み</span>', locked: '<span class="tag">お手つき</span>' };
      this.root.querySelector('#hy-players').innerHTML = `
        <h3 class="kb-sub">得点</h3>
        <ul class="kt-team">${v.players.map((p) => `<li class="${p.connected ? '' : 'is-away'}${p.id === v.answerer ? ' hy-is-answerer' : ''}"><span class="player-name">${e(p.name)}</span>${st[p.status] || ''}${p.id === this.me() ? '<span class="tag">あなた</span>' : ''}<span class="kt-tickets">${p.score}点</span></li>`).join('')}</ul>`;
    }

    renderSide(v) {
      const pen = { minus: 'お手つきは−1点', rest: 'お手つきは次の1問お休み', none: 'お手つきはその問題に押せないだけ' }[v.penalty];
      this.root.querySelector('#hy-side').innerHTML = `
        <h3 class="kb-sub">ルール</h3>
        <p class="kt-note">正解で+1点。${pen}。押した時刻は回線の速さで差がつかないよう補正しています。${this.api.rtt() != null ? `(あなたの通信の往復:約${Math.round(this.api.rtt())}ms)` : ''}</p>`;
    }

    // ---------- 操作 ----------
    press(ev) {
      const v = this.v;
      if (!v || v.phase !== 'reading' || !v.canBuzz || this.pressed) return;
      // イベントが起きた瞬間(timeStamp)まで戻した、サーバー時計での押した時刻
      const lag = ev && typeof ev.timeStamp === 'number' ? Math.max(0, performance.now() - ev.timeStamp) : 0;
      const pressAt = this.api.now() - Math.min(lag, 500);
      this.frozen = this.shownAt(v, pressAt);
      this.pressed = true;
      this.shown = -1;
      this.renderAct(v);
      this.tick();
      this.api.send('buzz', { pressAt });
      // 届かなかったときのために、しばらくしたら押し直せるようにする
      const key = this.key;
      setTimeout(() => {
        if (this.key === key && this.pressed && this.v.phase === 'reading') {
          this.pressed = false;
          this.shown = -1;
          this.renderAct(this.v);
        }
      }, 3000);
    }

    onPointer(ev) {
      if (ev.target.closest('#hy-buzz')) {
        ev.preventDefault();
        this.press(ev);
      }
    }

    onKey(ev) {
      if (ev.code !== 'Space' && ev.key !== ' ') return;
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || ev.repeat) return;
      if (this.v?.phase !== 'reading') return;
      ev.preventDefault();
      this.press(ev);
    }

    submitAnswer() {
      const input = this.root.querySelector('#hy-answer');
      const text = input?.value.trim();
      if (!text) return;
      input.disabled = true;
      this.api.send('answer', { text });
    }

    async onClick(ev) {
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      const act = t.dataset.act;
      if (act === 'write' || act === 'voice') {
        const text = this.root.querySelector('#hy-q')?.value.trim();
        const answers = this.root.querySelector('#hy-a')?.value.trim();
        const err = this.root.querySelector('#hy-err');
        if (act === 'write' && (!text || !answers)) {
          err.textContent = '問題文と答えの両方を書いてください';
          return;
        }
        t.disabled = true;
        this.api.send('write', { text, answers, voice: act === 'voice' });
      } else if (act === 'useBank') this.api.send('useBank');
      else if (act === 'answer') this.submitAnswer();
      else if (act === 'judge') this.api.send('judge', { ok: t.dataset.ok === '1' });
      else if (act === 'accept') this.api.send('accept', { i: Number(t.dataset.i) });
      else if (act === 'close' || act === 'next' || act === 'finish') this.api.send(act);
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.hayaoshi = { create: (root, api) => new HayaoshiClient(root, api) };
})();
