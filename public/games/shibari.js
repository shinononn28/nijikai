(() => {
  'use strict';

  // 文字しばり伝言の画面。
  // 入力中の文は、使えない文字をその場で赤く表示する(判定は public/games/shibari-rules.js でサーバーと共通)。

  const R = window.ShibariRules;

  class ShibariClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.revealCount = -1;
      this.onClickBound = (e) => this.onClick(e);
      this.onInputBound = (e) => { if (e.target.id === 'sb-text') this.check(); };
      root.addEventListener('click', this.onClickBound);
      root.addEventListener('input', this.onInputBound);
      this.tick = setInterval(() => this.autoSubmit(), 300);
    }

    destroy() {
      this.root.removeEventListener('click', this.onClickBound);
      this.root.removeEventListener('input', this.onInputBound);
      clearInterval(this.tick);
    }

    onEvent(type, data) {
      if (type === 'error') {
        const el = this.root.querySelector('#sb-error');
        if (el) el.textContent = data?.error || '';
      }
    }

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.autoSent = false;
        this.build(v);
      }
      this.refresh(v);
    }

    // ---------- 組み立て ----------
    build(v) {
      const e = this.esc;
      if (v.phase === 'play') {
        const label = { topic: 'お題を作る', desc: '言い換えて伝える', guess: 'お題を当てる' }[v.kind];
        this.root.innerHTML = `
          <div class="kb dg sb">
            <div class="kb-head">
              <span class="kb-round">${v.round + 1} / ${v.rounds}</span>
              <span class="kb-phase">${label}</span>
              <span class="timer" data-ends-at="${v.endsAt}"></span>
            </div>
            ${v.participant ? `<p class="dg-route">${v.from ? `<b>${e(v.from)}</b>さんから受け取り、` : ''}${v.to ? `<b>${e(v.to)}</b>さんへ渡します` : 'あなたが最後です'}</p>` : ''}
            <div class="dg-layout">
              <div class="dg-main" id="sb-main">${v.participant ? this.taskHtml(v) : '<p class="kt-panel">途中から参加した人は、結果発表から見られます。</p>'}</div>
              <aside class="kt-side"><section class="kt-panel" id="sb-status"></section></aside>
            </div>
          </div>`;
        const input = this.root.querySelector('#sb-text');
        if (input) {
          this.api.onEnter(input, () => this.send());
          const yomi = this.root.querySelector('#sb-yomi');
          if (yomi) this.api.onEnter(yomi, () => this.send());
          if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus(), 30);
          this.check();
        }
        return;
      }
      this.revealCount = -1;
      this.root.innerHTML = `
        <div class="kb dg sb">
          <div class="kb-head"><span class="kb-round">${v.phase === 'ended' ? '全部の伝言' : '結果発表'}</span><span class="kb-phase" id="sb-count"></span></div>
          <div id="sb-reveal" class="sb-reveal"></div>
          <section class="kt-panel" id="sb-scores" style="display:none"></section>
          <div class="dg-ctl" id="sb-ctl"></div>
        </div>`;
    }

    taskHtml(v) {
      const e = this.esc;
      const t = v.task;
      if (t.kind === 'topic') {
        return `
          <div class="kt-panel dg-task">
            <h3 class="kb-sub">お題を作ってください(このお題は自分には回ってきません)</h3>
            <div class="sb-topic-form">
              <label><span class="kt-note">お題</span><input id="sb-text" maxlength="20" placeholder="例:冷蔵庫" autocomplete="off"></label>
              <label><span class="kt-note">よみ(ひらがな)</span><input id="sb-yomi" maxlength="30" placeholder="例:れいぞうこ" autocomplete="off"></label>
              <button class="btn btn-primary" data-act="send">決定</button>
            </div>
            <div class="dg-suggest"><span class="kt-note">思いつかなければ:</span>${(v.suggest || []).map((s) => `<button class="btn btn-small" data-suggest="${e(s.text)}" data-yomi="${e(s.yomi)}">${e(s.text)}</button>`).join('')}</div>
            <p class="kt-note">よみの文字は、この伝言ではもう誰も使えなくなります。お題がひらがな・カタカナだけなら、よみは空でも大丈夫です。</p>
            <p class="kt-hint" id="sb-error"></p>
            <p class="dg-sent" id="sb-sent"></p>
          </div>`;
      }
      const prev = t.prev
        ? `<p class="dg-prompt"><span class="kj-label">${t.prev.isTopic ? 'お題' : `${e(v.from || '')}さんからの伝言`}</span><b>${e(t.prev.text)}</b>${t.prev.yomi && t.prev.yomi !== t.prev.text ? `<small class="sb-yomi">(${e(t.prev.yomi)})</small>` : ''}</p>`
        : '<p class="dg-prompt"><b>(何も届きませんでした)</b></p>';
      if (t.kind === 'guess') {
        return `
          <div class="kt-panel dg-task">
            ${prev}
            <h3 class="kb-sub">元のお題は何?(ここは文字の制限なし)</h3>
            <div class="answer-entry"><input id="sb-text" maxlength="20" placeholder="元のお題" autocomplete="off"><button class="btn btn-primary" data-act="send">決定</button></div>
            <p class="kt-hint" id="sb-error"></p>
            <p class="dg-sent" id="sb-sent"></p>
          </div>`;
      }
      return `
        <div class="kt-panel dg-task">
          ${prev}
          <h3 class="kb-sub">別の言葉で言い換えて、次の人に伝えてください(${t.step}人目 / ${v.steps}人)</h3>
          <div class="answer-entry"><input id="sb-text" maxlength="40" placeholder="ひらがな・カタカナで書く" autocomplete="off"><button class="btn btn-primary" data-act="send" id="sb-send">決定</button></div>
          <p class="sb-preview" id="sb-preview" aria-live="polite"></p>
          <p class="kt-hint" id="sb-error"></p>
          <p class="dg-sent" id="sb-sent"></p>
          ${this.bannedHtml(t.banned, v.opts)}
        </div>`;
    }

    // 五十音表(使えない字に×)と、ひらがな以外の使えない字
    bannedHtml(list, opts) {
      const e = this.esc;
      const set = new Set(list);
      const fold = opts.fold;
      const grid = (opts.base ? R.BASE_ROWS : R.KANA_ROWS).map((row) => `<div class="sb-row">${Array.from(row).map((c) => (c === ' ' ? '<span class="sb-k is-blank"></span>' : `<span class="sb-k${set.has(c) ? ' is-out' : ''}">${c}</span>`)).join('')}</div>`).join('');
      const others = list.filter((c) => !R.KANA.has(c));
      return `
        <details class="sb-banned" open>
          <summary>使えない文字(${list.length}字)${fold ? '' : '・カタカナは別に数えます'}</summary>
          <div class="sb-grid">${grid}</div>
          ${others.length ? `<div class="sb-others"><span class="kt-note">ほかに:</span>${others.map((c) => `<span class="sb-chip">${e(c)}</span>`).join('')}</div>` : ''}
          <p class="kt-note">最初からダミーの字も混ざっています。ひらがな・カタカナだけで、自分の伝言の中でも同じ文字は1回まで。記号・空白・のばし棒「ー」はいつでも使えます。${fold ? 'ひらがなとカタカナは同じ文字として数えます。' : ''}${opts.base ? '濁点・半濁点・小さい字は元の字と同じ文字です(「か」が×なら「が」も×)。' : ''}</p>
        </details>`;
    }

    // 入力中の文の使えない文字を赤く
    check() {
      const v = this.v;
      const input = this.root.querySelector('#sb-text');
      if (!input || v?.phase !== 'play' || v.task?.kind !== 'desc') return;
      const marks = R.mark(input.value, v.task.banned, v.opts);
      const pr = R.problems(input.value, v.task.banned, v.opts);
      const bad = [...pr.used, ...pr.repeated, ...pr.other];
      const prev = this.root.querySelector('#sb-preview');
      if (prev) {
        const e = this.esc;
        const msgs = [
          pr.other.length ? `ひらがな・カタカナだけ:${pr.other.map(e).join(' ')}` : '',
          pr.used.length ? `使えない文字:${pr.used.map(e).join(' ')}` : '',
          pr.repeated.length ? `同じ文字は1回まで:${pr.repeated.map(e).join(' ')}` : '',
        ].filter(Boolean);
        prev.innerHTML = input.value
          ? marks.map((m) => (m.bad ? `<mark class="${m.other ? 'is-other' : m.repeat ? 'is-repeat' : ''}">${e(m.ch)}</mark>` : e(m.ch))).join('') +
            (msgs.length ? msgs.map((x) => `<span class="sb-bad">${x}</span>`).join('') : '<span class="sb-ok">OK</span>')
          : '';
      }
      const btn = this.root.querySelector('#sb-send');
      if (btn && !v.submitted) btn.disabled = bad.length > 0 || !R.chars(input.value, v.opts).length;
    }

    // ---------- 毎回の更新 ----------
    refresh(v) {
      if (v.phase === 'play') return this.refreshPlay(v);
      this.renderReveal(v);
    }

    refreshPlay(v) {
      const e = this.esc;
      const st = this.root.querySelector('#sb-status');
      if (st) {
        const done = v.players.filter((p) => p.done).length;
        st.innerHTML = `<h3 class="kb-sub">提出 ${done} / ${v.players.length}</h3>
          <ul class="kt-team">${v.players.map((p) => `<li><span class="player-name">${e(p.name)}</span>${p.done ? '<span class="tag tag-done">提出</span>' : ''}</li>`).join('')}</ul>`;
      }
      const sent = this.root.querySelector('#sb-sent');
      if (sent) {
        sent.innerHTML = v.submitted != null
          ? `提出しました:「${e(v.submitted)}」 <button class="btn btn-quiet btn-small" data-act="unsubmit">書き直す</button>`
          : '';
      }
      this.root.querySelectorAll('#sb-main input, #sb-main [data-act="send"], #sb-main [data-suggest]').forEach((x) => { x.disabled = v.submitted != null; });
      if (v.submitted == null) this.check();
    }

    renderReveal(v) {
      const e = this.esc;
      const r = v.reveal;
      const shown = r.chains.reduce((a, c) => a + c.entries.length, 0);
      const grew = shown > this.revealCount && this.revealCount >= 0;
      this.revealCount = shown;
      this.root.querySelector('#sb-count').textContent = r.chain === null ? '' : `${r.chain + 1} / ${r.total}本目`;
      const label = (x, si) => {
        if (x.type === 'topic') return x.byName ? 'お題' : 'お題(ランダム)';
        if (x.type === 'guess') return `${e(x.byName)}さんの答え`;
        return `${si}. ${e(x.byName)}さんの伝言`;
      };
      this.root.querySelector('#sb-reveal').innerHTML = r.chains.map((c, ci) => `
        <section class="dg-chain">
          <h3 class="dg-chain-h">${v.custom ? `${e(c.owner)}さんのお題` : `${ci + 1}本目のお題`}${c.correct === true ? ' <span class="tag tag-done">正解</span>' : c.correct === false ? ' <span class="tag">不正解</span>' : ''}${c.judged ? ' <small class="kt-note">(人の判定)</small>' : ''}</h3>
          ${c.entries.map((x, si) => `
            <div class="dg-entry dg-e-text${grew && ci === r.chain && si === c.entries.length - 1 ? ' is-new' : ''}">
              <span class="dg-by">${label(x, si)}</span>
              <p class="dg-text${x.type === 'topic' ? ' sb-topic' : ''}">${x.text ? e(x.text) : '<span class="kt-note">(時間切れ)</span>'}${x.yomi && x.yomi !== x.text ? `<small class="sb-yomi">(${e(x.yomi)})</small>` : ''}</p>
              ${x.auto && x.text && x.type === 'desc' ? '<span class="kt-note">時間切れで、使えない文字を消して提出</span>' : ''}
              ${x.type !== 'guess' && x.fresh?.length ? `<span class="sb-fresh">使えなくなった字:${x.fresh.map((ch) => e(ch)).join(' ')}</span>` : ''}
              ${x.type === 'topic' && c.decoys.length ? `<span class="sb-fresh">ダミーで使えなかった字:${c.decoys.map((ch) => e(ch)).join(' ')}</span>` : ''}
              ${x.byName ? `<button class="dg-like${x.liked ? ' is-on' : ''}" data-like="${ci}-${si}" aria-label="いいね">❤ ${x.likes || ''}</button>` : ''}
            </div>`).join('')}
          ${c.canJudge ? `<div class="sb-judge">${c.correct ? `<button class="btn btn-small" data-judge="${ci}" data-ok="0">不正解にする</button>` : `<button class="btn btn-small btn-primary" data-judge="${ci}" data-ok="1">正解にする</button>`}</div>` : ''}
        </section>`).join('');
      if (grew) this.root.querySelector('.dg-entry.is-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const sc = this.root.querySelector('#sb-scores');
      sc.style.display = v.scores ? '' : 'none';
      if (v.scores) {
        sc.innerHTML = `<h3 class="kb-sub">得点(当たった伝言に関わった数)</h3>
          <ul class="kt-team">${v.scores.map((p) => `<li><span class="player-name">${e(p.name)}</span><span class="kt-tickets">${p.score}点</span></li>`).join('')}</ul>`;
      }

      const host = this.api.isHost();
      const cur = r.chain === null ? null : r.chains[r.chain];
      const atEnd = cur && cur.entries.length === cur.total;
      this.root.querySelector('#sb-ctl').innerHTML = v.phase === 'ended'
        ? `${v.best ? `<p class="dg-best">いいね最多:${e(v.best.by)}さんの「${e(v.best.text)}」(❤${v.best.n})</p>` : ''}
           ${host ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}`
        : host
          ? `<button class="btn btn-primary jn-big" data-act="next">${!atEnd ? '次を見る' : r.chain < r.total - 1 ? '次の伝言へ' : '全部の伝言を並べる'}</button>`
          : '<p class="hint wait">ホストがめくるのを待っています</p>';
    }

    // ---------- 操作 ----------
    send(auto = false) {
      const v = this.v;
      if (!v || v.phase !== 'play' || v.submitted != null) return;
      const input = this.root.querySelector('#sb-text');
      const text = input?.value.trim() || '';
      if (!text) {
        if (!auto) input?.focus();
        return;
      }
      if (!auto && v.task?.kind === 'desc' && R.violations(text, v.task.banned, v.opts).length) return this.check();
      const err = this.root.querySelector('#sb-error');
      if (v.task?.kind === 'topic') {
        const yomiEl = this.root.querySelector('#sb-yomi');
        const yomi = yomiEl?.value.trim() || '';
        if (!auto && !(yomi ? R.kanaOnly(yomi) : R.kanaOnly(text))) {
          if (err) err.textContent = yomi ? 'よみはひらがな(カタカナ)だけで書いてください' : 'お題に漢字などがあるときは、よみも入れてください';
          return yomiEl?.focus();
        }
        if (err && !auto) err.textContent = '';
        return this.api.send('submit', { text, yomi, auto });
      }
      if (err && !auto) err.textContent = '';
      this.api.send('submit', { text, auto });
    }

    // 締め切り直前に、書きかけを自動で出す(使えない文字はサーバーが消す)
    autoSubmit() {
      const v = this.v;
      if (!v || v.phase !== 'play' || v.submitted != null || this.autoSent || !v.endsAt) return;
      if (this.api.remaining(v.endsAt) > 600) return;
      this.autoSent = true;
      this.send(true);
    }

    onClick(ev) {
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.suggest) {
        const input = this.root.querySelector('#sb-text');
        if (input) { input.value = t.dataset.suggest; input.focus(); }
        const yomi = this.root.querySelector('#sb-yomi');
        if (yomi) yomi.value = t.dataset.yomi || '';
        return;
      }
      const act = t.dataset.act;
      if (act === 'send') return this.send();
      if (act === 'unsubmit') { this.autoSent = false; return this.api.send('unsubmit'); }
      if (act === 'next') return this.api.send('next');
      if (act === 'finish') return this.api.send('finish');
      if (t.dataset.like) {
        const [chain, step] = t.dataset.like.split('-').map(Number);
        return this.api.send('like', { chain, step });
      }
      if (t.dataset.judge != null) return this.api.send('judge', { chain: Number(t.dataset.judge), ok: t.dataset.ok === '1' });
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.shibari = { create: (root, api) => new ShibariClient(root, api) };
})();
