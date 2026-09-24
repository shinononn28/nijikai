(() => {
  'use strict';

  // サーバーと同じ正規化(自分の回答の重複チェック用)
  function normalize(s) {
    let t = String(s).normalize('NFKC').toLowerCase();
    t = t.replace(/[\s・,、。.!?「」『』()\[\]【】"'`]/g, '');
    t = t.replace(/[‐‑–—―−~〜]/g, 'ー');
    return t.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  const RESULT_TEXT = {
    unique: () => '被りなし',
    dup: (it) => `${it.players.length}人が被り`,
    invalid: () => 'お題外',
  };
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');
  const total = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));

  class KaburiClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.local = [];
      this.sel = [];
      this.shown = 0;
      this.sendTimer = null;
      this.flushedFor = null;
      this.tick = setInterval(() => this.onTick(), 300);
    }

    destroy() {
      clearInterval(this.tick);
      clearTimeout(this.sendTimer);
    }

    update(v) {
      const prev = this.v;
      this.v = v;
      const key = `${v.phase}:${v.seq}:${v.isParticipant}`;
      if (key !== this.key) {
        this.key = key;
        this.build(v, prev);
      }
      this.refresh(v);
    }

    // ---------- 共通パーツ ----------
    header(v, { small = false } = {}) {
      const e = this.esc;
      const phaseName = { answer: '回答タイム', judge: '判定タイム', reveal: '結果発表', final: '最終結果' }[v.phase];
      return `
        <div class="kb-head">
          <span class="kb-round">ラウンド ${v.round} / ${v.totalRounds}</span>
          <span class="kb-phase">${phaseName}</span>
          ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
        </div>
        ${v.phase === 'final' ? '' : `
        <div class="topic-card${small ? ' is-small' : ''}">
          <span class="topic-label">お題</span>
          <p class="topic">${e(v.topic)}</p>
        </div>`}`;
    }

    // ---------- フェーズごとの骨組み ----------
    build(v) {
      const e = this.esc;
      const host = this.api.isHost();
      this.sel = [];

      if (v.phase === 'answer') {
        this.local = [...(v.myAnswers || [])];
        this.flushedFor = null;
        this.root.innerHTML = `
          <div class="kb kb-answer">
            ${this.header(v)}
            ${v.isParticipant ? `
              <div class="answer-entry">
                <input id="kb-input" maxlength="24" placeholder="思いついたら入力して Enter" autocomplete="off" enterkeyhint="send">
                <button class="btn btn-primary" id="kb-add">追加</button>
              </div>
              <p class="kb-rule">誰とも被らなければ +1、誰かと被ったら −1</p>
              <p class="kb-flash" id="kb-flash" role="status"></p>
              <div class="mine-head"><span>自分の回答</span><span id="kb-count"></span></div>
              <ul class="mine" id="kb-mine"></ul>
              <div class="kb-actions">
                <button class="btn" id="kb-done"></button>
                ${host ? '<button class="btn btn-quiet" id="kb-reroll">お題を引き直す</button>' : ''}
              </div>
            ` : `<p class="spectate">途中から入ったので、次のラウンドから参加します。今は様子を見ながらチャットで話せます。</p>`}
            <h3 class="kb-sub">みんなの進み具合</h3>
            <ul class="status-list" id="kb-status"></ul>
          </div>`;

        if (v.isParticipant) {
          const input = this.root.querySelector('#kb-input');
          const add = () => this.addAnswer(input);
          this.api.onEnter(input, add);
          this.root.querySelector('#kb-add').onclick = () => { add(); input.focus(); };
          this.root.querySelector('#kb-mine').onclick = (ev) => {
            const b = ev.target.closest('[data-remove]');
            if (!b) return;
            this.local.splice(Number(b.dataset.remove), 1);
            this.renderMine();
            this.scheduleSend();
          };
          this.root.querySelector('#kb-done').onclick = () => {
            const me = this.v.players.find((p) => p.id === this.api.myId());
            this.flush();
            this.api.send('done', { value: !me?.ready });
          };
          this.renderMine();
          if (!matchMedia('(pointer: coarse)').matches) input.focus();
        }
        const reroll = this.root.querySelector('#kb-reroll');
        if (reroll) reroll.onclick = () => {
          if (confirm('お題を引き直しますか?全員の回答はリセットされます。')) this.api.send('reroll');
        };
        return;
      }

      if (v.phase === 'judge') {
        this.root.innerHTML = `
          <div class="kb kb-judge">
            ${this.header(v, { small: true })}
            <p class="kb-lead">同じものとして扱いたい回答を2つ、またはお題に合わない回答を1つ選んで提案できます。賛成が反対より多ければ可決です。</p>
            <div class="chips" id="kb-chips"></div>
            <div class="selbar" id="kb-selbar"></div>
            <section id="kb-hints"></section>
            <section id="kb-props"></section>
            ${v.isParticipant ? `
              <div class="kb-actions">
                <button class="btn btn-primary" id="kb-jdone"></button>
                <span class="kb-ready" id="kb-ready"></span>
              </div>` : '<p class="spectate">次のラウンドから参加します。</p>'}
          </div>`;

        this.root.querySelector('#kb-chips').onclick = (ev) => {
          const b = ev.target.closest('[data-group]');
          if (!b || !this.v.isParticipant) return;
          const id = b.dataset.group;
          this.sel = this.sel.includes(id) ? this.sel.filter((x) => x !== id) : [...this.sel, id].slice(-2);
          this.refresh(this.v);
        };
        this.root.querySelector('#kb-selbar').onclick = (ev) => {
          const b = ev.target.closest('[data-act]');
          if (!b) return;
          if (b.dataset.act === 'clear') this.sel = [];
          else {
            this.api.send('propose', { type: b.dataset.act, groupIds: this.sel });
            this.sel = [];
          }
          this.refresh(this.v);
        };
        this.root.querySelector('#kb-hints').onclick = (ev) => {
          const b = ev.target.closest('[data-hint]');
          if (b) this.api.send('propose', { type: 'merge', groupIds: b.dataset.hint.split(',') });
        };
        this.root.querySelector('#kb-props').onclick = (ev) => {
          const b = ev.target.closest('[data-vote]');
          if (b) this.api.send('vote', { proposalId: b.dataset.prop, yes: b.dataset.vote === 'yes' });
        };
        const jdone = this.root.querySelector('#kb-jdone');
        if (jdone) jdone.onclick = () => {
          const me = this.v.players.find((p) => p.id === this.api.myId());
          this.api.send('done', { value: !me?.ready });
        };
        return;
      }

      if (v.phase === 'reveal') {
        this.shown = 0;
        this.root.innerHTML = `
          <div class="kb kb-reveal">
            ${this.header(v, { small: true })}
            <div class="reveal-progress" id="kb-progress"></div>
            <div class="reveal-controls" id="kb-controls"></div>
            <ol class="reveal-list" id="kb-reveal"></ol>
          </div>`;
        this.root.querySelector('#kb-controls').onclick = (ev) => {
          const b = ev.target.closest('[data-act]');
          if (b) this.api.send(b.dataset.act);
        };
        return;
      }

      if (v.phase === 'final') {
        this.root.innerHTML = `
          <div class="kb kb-final">
            ${this.header(v)}
            <h2 class="final-title">最終結果</h2>
            <ol class="ranking" id="kb-ranking"></ol>
            <div class="kb-actions" id="kb-final-actions"></div>
          </div>`;
        this.root.querySelector('#kb-final-actions').onclick = (ev) => {
          if (ev.target.closest('[data-act="finish"]')) this.api.send('finish');
        };
      }
    }

    // ---------- 毎回の更新 ----------
    refresh(v) {
      if (v.phase === 'answer') return this.refreshAnswer(v);
      if (v.phase === 'judge') return this.refreshJudge(v);
      if (v.phase === 'reveal') return this.refreshReveal(v);
      if (v.phase === 'final') return this.refreshFinal(v);
    }

    // --- 回答 ---
    addAnswer(input) {
      const raw = input.value.trim().slice(0, 24);
      const flash = this.root.querySelector('#kb-flash');
      if (!raw) return;
      const key = normalize(raw);
      if (!key) return;
      if (this.local.some((a) => normalize(a) === key)) {
        flash.textContent = `「${raw}」はもう書いています`;
        input.select();
        return;
      }
      this.local.push(raw);
      input.value = '';
      flash.textContent = '';
      this.renderMine();
      this.scheduleSend();
    }

    renderMine() {
      const list = this.root.querySelector('#kb-mine');
      if (!list) return;
      const e = this.esc;
      list.innerHTML = this.local
        .map((a, i) => `<li><span>${e(a)}</span><button class="x" data-remove="${i}" aria-label="${e(a)}を消す">×</button></li>`)
        .join('');
      this.root.querySelector('#kb-count').textContent = `${this.local.length}個`;
      list.scrollTop = list.scrollHeight;
    }

    scheduleSend() {
      clearTimeout(this.sendTimer);
      this.sendTimer = setTimeout(() => this.flush(), 400);
    }

    flush() {
      clearTimeout(this.sendTimer);
      if (this.v?.phase !== 'answer' || !this.v.isParticipant) return;
      this.api.send('setAnswers', { answers: this.local });
    }

    onTick() {
      const v = this.v;
      if (v?.phase === 'answer' && v.endsAt && this.flushedFor !== v.seq && this.api.remaining(v.endsAt) <= 600) {
        this.flushedFor = v.seq;
        this.flush();
      }
    }

    refreshAnswer(v) {
      const e = this.esc;
      const me = v.players.find((p) => p.id === this.api.myId());
      const done = this.root.querySelector('#kb-done');
      if (done) {
        done.textContent = me?.ready ? '回答を再開する' : 'もう出ない(回答終了)';
        done.classList.toggle('btn-primary', !me?.ready);
      }
      const input = this.root.querySelector('#kb-input');
      if (input) input.disabled = !!me?.ready;
      const status = this.root.querySelector('#kb-status');
      status.innerHTML = v.players
        .map((p) => `
          <li class="${p.connected ? '' : 'is-away'}">
            <span class="player-name">${e(p.name)}</span>
            <span class="status-count">${p.answerCount}個</span>
            ${p.ready ? '<span class="tag tag-done">終了</span>' : ''}
          </li>`)
        .join('');
    }

    // --- 判定 ---
    refreshJudge(v) {
      const e = this.esc;
      const byId = new Map(v.groups.map((g) => [g.id, g]));
      const label = (id) => e(byId.get(id)?.label ?? '?');
      const participant = v.isParticipant;

      this.root.querySelector('#kb-chips').innerHTML = v.groups
        .map((g) => {
          const title = g.variants.length > 1 ? ` title="${e(g.variants.join(' / '))}"` : '';
          return `<button class="chip${g.mine ? ' is-mine' : ''}${this.sel.includes(g.id) ? ' is-selected' : ''}" data-group="${g.id}"${title} ${participant ? '' : 'disabled'}>
            ${e(g.label)}${g.variants.length > 1 ? `<small>ほか${g.variants.length - 1}表記</small>` : ''}
          </button>`;
        })
        .join('');

      const selbar = this.root.querySelector('#kb-selbar');
      if (this.sel.length === 0) {
        selbar.innerHTML = participant ? '<p class="selbar-hint">回答をタップして選ぶ(●は自分の回答)</p>' : '';
      } else if (this.sel.length === 1) {
        selbar.innerHTML = `
          <span>「${label(this.sel[0])}」を</span>
          <button class="btn btn-small" data-act="invalid">お題外として提案</button>
          <button class="btn btn-quiet btn-small" data-act="clear">選択を解除</button>
          <span class="selbar-hint">もう1つ選ぶと「同じ扱い」を提案できます</span>`;
      } else {
        selbar.innerHTML = `
          <span>「${label(this.sel[0])}」と「${label(this.sel[1])}」を</span>
          <button class="btn btn-small" data-act="merge">同じ扱いとして提案</button>
          <button class="btn btn-quiet btn-small" data-act="clear">選択を解除</button>`;
      }

      const proposed = new Set(v.proposals.filter((p) => p.type === 'merge').map((p) => [...p.groupIds].sort().join(',')));
      const hints = v.hints.filter(([a, b]) => !proposed.has([a, b].sort().join(',')));
      this.root.querySelector('#kb-hints').innerHTML = hints.length
        ? `<h3 class="kb-sub">同じかも?</h3>
           <ul class="hint-list">
             ${hints.map(([a, b]) => `
               <li><span>「${label(a)}」と「${label(b)}」</span>
                 ${participant ? `<button class="btn btn-small btn-quiet" data-hint="${a},${b}">同じ扱いを提案</button>` : ''}
               </li>`).join('')}
           </ul>`
        : '';

      this.root.querySelector('#kb-props').innerHTML = v.proposals.length
        ? `<h3 class="kb-sub">提案</h3>
           <ul class="prop-list">
             ${v.proposals.map((p) => {
               const what = p.type === 'merge'
                 ? `「${label(p.groupIds[0])}」と「${label(p.groupIds[1])}」は同じ扱い`
                 : `「${label(p.groupIds[0])}」はお題外`;
               const passing = p.yes > p.no;
               return `
                 <li class="${passing ? 'is-passing' : ''}">
                   <div class="prop-text">${what}<small>${e(p.by)}さんの提案</small></div>
                   <div class="prop-votes">
                     <button class="vote${p.myVote === true ? ' is-on' : ''}" data-prop="${p.id}" data-vote="yes" ${participant ? '' : 'disabled'}>賛成 ${p.yes}</button>
                     <button class="vote${p.myVote === false ? ' is-on' : ''}" data-prop="${p.id}" data-vote="no" ${participant ? '' : 'disabled'}>反対 ${p.no}</button>
                   </div>
                 </li>`;
             }).join('')}
           </ul>`
        : '';

      const me = v.players.find((p) => p.id === this.api.myId());
      const jdone = this.root.querySelector('#kb-jdone');
      if (jdone) {
        jdone.textContent = me?.ready ? '判定OKを取り消す' : '判定OK';
        jdone.classList.toggle('btn-primary', !me?.ready);
        const readyCount = v.players.filter((p) => p.ready).length;
        this.root.querySelector('#kb-ready').textContent = `${readyCount} / ${v.players.filter((p) => p.connected).length}人がOK`;
      }
    }

    // --- 公開 ---
    refreshReveal(v) {
      const e = this.esc;
      const r = v.reveal;
      const host = this.api.isHost();
      this.root.querySelector('#kb-progress').textContent = r.total
        ? `${r.index} / ${r.total} 枚めくりました`
        : '回答はありませんでした';

      const list = this.root.querySelector('#kb-reveal');
      // 新しくめくったものだけを先頭に足す(めくる演出を毎回やり直さない)
      for (let i = this.shown; i < r.items.length; i++) {
        const it = r.items[i];
        const others = it.variants.filter((x) => x !== it.label);
        const li = document.createElement('li');
        li.className = `reveal-card is-${it.result}${it.mine ? ' is-mine' : ''}${i === r.items.length - 1 && r.items.length - this.shown <= 1 ? ' is-new' : ''}`;
        li.innerHTML = `
          <div class="reveal-main">
            <span class="reveal-label">${e(it.label)}</span>
            ${others.length ? `<span class="reveal-variants">${others.map(e).join(' / ')}</span>` : ''}
          </div>
          <div class="reveal-who">${it.players.map((p) => `<span class="who${p.id === this.api.myId() ? ' is-me' : ''}">${e(p.name)}</span>`).join('')}</div>
          <div class="reveal-result"><span class="points">${signed(it.points)}</span><span>${RESULT_TEXT[it.result](it)}</span></div>`;
        list.prepend(li);
      }
      this.shown = r.items.length;

      const controls = this.root.querySelector('#kb-controls');
      if (!r.applied) {
        controls.innerHTML = host
          ? `<button class="btn btn-primary" data-act="revealNext">次をめくる</button>
             <button class="btn btn-quiet" data-act="revealAll">残りを全部めくる</button>`
          : '<p class="hint wait">ホストが1枚ずつめくります</p>';
        return;
      }

      const rows = [...v.players]
        .map((p) => ({ ...p, delta: r.deltas?.[p.id] ?? 0 }))
        .sort((a, b) => b.delta - a.delta || b.score - a.score);
      controls.innerHTML = `
        <div class="round-result">
          <h3 class="kb-sub">このラウンドの得点</h3>
          <table>
            <thead><tr><th>名前</th><th>今回</th><th>合計</th></tr></thead>
            <tbody>
              ${rows.map((p) => `<tr class="${p.id === this.api.myId() ? 'is-me' : ''}"><td>${e(p.name)}</td><td class="num">${signed(p.delta)}</td><td class="num">${total(p.score)}</td></tr>`).join('')}
            </tbody>
          </table>
          ${host
            ? `<button class="btn btn-primary btn-block" data-act="next">${v.isLastRound ? '最終結果を見る' : '次のラウンドへ'}</button>`
            : '<p class="hint wait">ホストが次に進めます</p>'}
        </div>`;
    }

    // --- 最終結果 ---
    refreshFinal(v) {
      const e = this.esc;
      let rank = 0;
      let last = null;
      this.root.querySelector('#kb-ranking').innerHTML = v.ranking
        .map((p, i) => {
          if (p.score !== last) { rank = i + 1; last = p.score; }
          return `<li class="rank-${rank}${p.id === this.api.myId() ? ' is-me' : ''}">
            <span class="rank">${rank}位</span><span class="player-name">${e(p.name)}</span><span class="num">${total(p.score)}点</span>
          </li>`;
        })
        .join('');
      this.root.querySelector('#kb-final-actions').innerHTML = this.api.isHost()
        ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>'
        : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>';
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.kaburi = { create: (root, api) => new KaburiClient(root, api) };
})();
