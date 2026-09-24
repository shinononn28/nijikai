(() => {
  'use strict';

  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');
  const minus = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));

  class MoonClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.draft = null;
      this.historyOpen = true;
    }

    destroy() {}

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.build(v);
      }
      this.refresh(v);
    }

    name(id) {
      return this.v.players.find((p) => p.id === id)?.name ?? '?';
    }

    // ---------- 骨組み ----------
    build(v) {
      const phaseName = { action: '行動', meeting: '会議', ended: '結果' }[v.phase];
      this.root.scrollTop = 0;
      this.root.innerHTML = `
        <div class="kb mn">
          <div class="kb-head">
            <span class="kb-round">${v.day}日目 / ${v.days}日</span>
            <span class="kb-phase">${phaseName}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div class="mn-status">
            <div class="tank" id="mn-tank"></div>
            <div class="event-card" id="mn-event"></div>
          </div>
          <div id="mn-phase"></div>
          <section class="mn-private" id="mn-private"></section>
          <details class="mn-history" id="mn-history" ${this.historyOpen ? 'open' : ''}>
            <summary>宣言の記録</summary>
            <div class="table-wrap" id="mn-history-body"></div>
          </details>
        </div>`;
      this.root.querySelector('#mn-history').addEventListener('toggle', (e) => { this.historyOpen = e.target.open; });

      const area = this.root.querySelector('#mn-phase');
      if (v.phase === 'action') this.buildAction(area, v);
      if (v.phase === 'meeting') this.buildMeeting(area, v);
      if (v.phase === 'ended') this.buildEnded(area, v);
    }

    refresh(v) {
      this.renderTank(v);
      this.renderEvent(v);
      this.renderPrivate(v);
      this.renderHistory(v);
      if (v.phase === 'action') this.refreshAction(v);
      if (v.phase === 'meeting') this.refreshMeeting(v);
      if (v.phase === 'ended') this.refreshEnded(v);
    }

    // ---------- 共通パネル ----------
    renderTank(v) {
      const pct = Math.max(0, Math.min(100, (v.tank / v.tankStart) * 100));
      const danger = v.tank <= v.N * 2;
      this.root.querySelector('#mn-tank').innerHTML = `
        <div class="tank-top">
          <span class="tank-label">酸素タンク</span>
          <span class="tank-value${danger ? ' is-danger' : ''}">${minus(v.tank)}</span>
        </div>
        <div class="tank-bar${danger ? ' is-danger' : ''}" role="img" aria-label="残り${v.tank}"><span style="width:${pct}%"></span></div>
        <p class="tank-note">毎日の生産は${v.N}〜${v.N * 2}。全員が2ずつ使うと、使用は1日${v.N * 2}です</p>`;
    }

    renderEvent(v) {
      const e = this.esc;
      this.root.querySelector('#mn-event').innerHTML = v.event
        ? `<span class="event-label">今日のイベント</span>
           <p class="event-name">${e(v.event.name)}</p>
           <p class="event-text">${e(v.event.text)}</p>
           ${v.forecast ? `<p class="event-forecast">明日の予報:${e(v.forecast.name)}</p>` : '<p class="event-forecast">最終日</p>'}`
        : '';
    }

    renderPrivate(v) {
      const el = this.root.querySelector('#mn-private');
      if (!v.me) {
        el.innerHTML = '<p class="spectate">観戦中です。次のゲームから参加できます。</p>';
        return;
      }
      const e = this.esc;
      const logs = v.me.monitorLog
        .map((l) => {
          const declared = v.history.find((h) => h.day === l.day)?.declares[l.target];
          const lie = declared !== undefined && l.value !== declared;
          return `<li${lie ? ' class="is-lie"' : ''}>${l.day}日目 ${e(l.targetName)}:実際 ${l.value}(宣言 ${declared ?? '?'})</li>`;
        })
        .join('');
      el.innerHTML = `
        <h3 class="kb-sub">あなただけの情報</h3>
        <div class="private-stats">
          <span>得点 <strong>${v.me.points}</strong></span>
          <span>総使用量 <strong>${v.me.used}</strong><small>(壊滅時はこれが最少の人が生還)</small></span>
        </div>
        ${logs ? `<ul class="monitor-log">${logs}</ul>` : ''}`;
    }

    renderHistory(v) {
      const body = this.root.querySelector('#mn-history-body');
      const wrap = this.root.querySelector('#mn-history');
      if (!v.history.length || v.phase === 'ended') {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
      const e = this.esc;
      const head = v.history.map((h) => `<th>${h.day}日目<small>${e(h.event.name)}</small></th>`).join('');
      const rows = v.players
        .map((p) => {
          const cells = v.history
            .map((h) => {
              if (h.isolated === p.id) return '<td class="num is-muted">隔離</td>';
              const auto = h.auto.includes(p.id);
              return `<td class="num${auto ? ' is-muted' : ''}">${h.declares[p.id]}${auto ? '<small>未入力</small>' : ''}</td>`;
            })
            .join('');
          return `<tr><th scope="row">${e(p.name)}</th>${cells}</tr>`;
        })
        .join('');
      const sumRow = (label, fn, cls = '') => `<tr class="sum ${cls}"><th scope="row">${label}</th>${v.history.map((h) => `<td class="num">${fn(h)}</td>`).join('')}</tr>`;
      body.innerHTML = `
        <table class="mn-table">
          <thead><tr><th>宣言</th>${head}</tr></thead>
          <tbody>
            ${rows}
            ${sumRow('宣言の合計', (h) => h.declaredSum)}
            ${sumRow('監視', (h) => `${h.monitors}件`)}
            ${sumRow('実際の使用', (h) => h.totalUse)}
            ${sumRow('ズレ', (h) => (h.lie ? `<strong class="lie">${signed(h.lie)}</strong>` : '0'), 'is-lie-row')}
            ${sumRow('タンク', (h) => minus(h.tankAfter))}
          </tbody>
        </table>`;
    }

    // ---------- 行動 ----------
    buildAction(area, v) {
      const e = this.esc;
      const mine = v.me?.action;
      this.draft = mine ? { usage: mine.usage, declare: mine.declare, monitor: mine.monitor || '' } : { usage: Math.min(2, v.cap), declare: Math.min(2, v.cap), monitor: '' };

      if (!v.me) {
        area.innerHTML = '';
        return;
      }
      if (v.me.isolated) {
        area.innerHTML = `
          <div class="mn-card">
            <p class="isolated-note">あなたは隔離室にいます。今日は使用量1で固定・得点なしです。会議と投票には参加できます。</p>
          </div>
          <h3 class="kb-sub">決定した人</h3>
          <ul class="status-list" id="mn-status"></ul>`;
        return;
      }
      const seg = (field) =>
        `<div class="seg" data-field="${field}" role="radiogroup">
          ${[1, 2, 3, 4].map((n) => `<button type="button" data-value="${n}" role="radio" ${n > v.cap ? 'disabled' : ''}>${n}</button>`).join('')}
        </div>`;
      const targets = v.players.filter((p) => p.id !== this.api.myId() && p.id !== v.isolated);
      area.innerHTML = `
        <div class="mn-card">
          <div class="pick">
            <span class="pick-label">使う量</span>
            ${seg('usage')}
            <span class="pick-note" id="mn-pts"></span>
          </div>
          <div class="pick">
            <span class="pick-label">宣言する量</span>
            ${seg('declare')}
            <span class="pick-note" id="mn-honest"></span>
          </div>
          <div class="pick">
            <span class="pick-label">監視</span>
            <select id="mn-monitor" ${v.canMonitor ? '' : 'disabled'}>
              <option value="">しない</option>
              ${targets.map((p) => `<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}
            </select>
            <span class="pick-note">${v.canMonitor ? '監視すると酸素を1余分に使い、総使用量にも加算されます(得点なし)' : '通信障害で今日は監視できません'}</span>
          </div>
          <button class="btn btn-primary btn-block" id="mn-submit"></button>
        </div>
        <h3 class="kb-sub">決定した人</h3>
        <ul class="status-list" id="mn-status"></ul>`;

      area.querySelectorAll('.seg').forEach((g) => {
        g.onclick = (ev) => {
          const b = ev.target.closest('button[data-value]');
          if (!b || b.disabled) return;
          this.draft[g.dataset.field] = Number(b.dataset.value);
          this.refreshAction(this.v);
        };
      });
      const mon = area.querySelector('#mn-monitor');
      mon.value = this.draft.monitor;
      mon.onchange = () => {
        this.draft.monitor = mon.value;
        this.refreshAction(this.v);
      };
      area.querySelector('#mn-submit').onclick = () => {
        this.api.send('submit', { usage: this.draft.usage, declare: this.draft.declare, monitor: this.draft.monitor || null });
      };
    }

    refreshAction(v) {
      const e = this.esc;
      const area = this.root.querySelector('#mn-phase');
      const status = area.querySelector('#mn-status');
      if (status) {
        status.innerHTML = v.players
          .map((p) => `
            <li class="${p.connected ? '' : 'is-away'}">
              <span class="player-name">${e(p.name)}</span>
              ${p.id === v.isolated ? '<span class="tag">隔離中</span>' : p.decided ? '<span class="tag tag-done">決定</span>' : '<span class="tag">考え中</span>'}
            </li>`)
          .join('');
      }
      if (!v.me || v.me.isolated || !this.draft) return;

      area.querySelectorAll('.seg').forEach((g) => {
        g.querySelectorAll('button').forEach((b) => {
          const on = Number(b.dataset.value) === this.draft[g.dataset.field];
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', on);
        });
      });
      const mult = v.event?.key === 'night' ? 2 : 1;
      const pts = (this.draft.usage - 1) * mult;
      area.querySelector('#mn-pts').textContent = pts ? `得点 +${pts}${mult > 1 ? '(夜間作業で2倍)' : ''}` : '呼吸だけ。得点なし';
      const diff = this.draft.declare - this.draft.usage;
      const honest = area.querySelector('#mn-honest');
      honest.textContent = diff === 0 ? '正直な宣言' : `実際より${Math.abs(diff)}${diff < 0 ? '少なく' : '多く'}宣言`;
      honest.classList.toggle('is-lie', diff !== 0);

      const sent = v.me.action;
      const same = sent && sent.usage === this.draft.usage && sent.declare === this.draft.declare && (sent.monitor || '') === this.draft.monitor;
      const btn = area.querySelector('#mn-submit');
      btn.textContent = !sent ? 'この内容で決定' : same ? '決定済み(選び直すと変更できます)' : '変更して決定';
      btn.disabled = !!same;
    }

    // ---------- 会議 ----------
    buildMeeting(area, v) {
      const e = this.esc;
      const h = v.history[v.history.length - 1];
      const decl = v.players
        .map((p) => {
          const iso = h.isolated === p.id;
          const auto = h.auto.includes(p.id);
          return `<li><span class="player-name">${e(p.name)}</span><span class="decl${iso || auto ? ' is-muted' : ''}">${iso ? '隔離' : h.declares[p.id]}</span>${auto ? '<small>未入力</small>' : ''}</li>`;
        })
        .join('');
      const census = h.census
        ? `<p class="census">全数調査:${[1, 2, 3, 4].filter((n) => h.census[n]).map((n) => `${n}を使った人 ${h.census[n]}人`).join('、')}</p>`
        : '';
      const myLog = v.me?.monitorLog.find((l) => l.day === h.day);
      area.innerHTML = `
        <div class="mn-result">
          <div class="lie-box${h.lie ? ' has-lie' : ''}">
            <span class="lie-label">今日の嘘の量</span>
            <span class="lie-value">${h.lie ? signed(h.lie) : '0'}</span>
            <span class="lie-formula">使用 ${h.totalUse} − 宣言合計 ${h.declaredSum} − 監視 ${h.monitors}件</span>
          </div>
          <div class="tank-change">
            タンク ${minus(h.tankBefore)} → <strong>${minus(h.tankAfter)}</strong>
            <small>(生産 +${h.production}${h.eventDelta ? `、${e(h.event.name)} ${signed(h.eventDelta)}` : ''}、使用 −${h.totalUse})</small>
          </div>
          ${census}
          <ul class="decl-list">${decl}</ul>
          ${myLog ? `<p class="my-monitor">あなたの監視:${e(myLog.targetName)}の実際の使用量は <strong>${myLog.value}</strong>(宣言 ${h.declares[myLog.target]})</p>` : ''}
        </div>
        <h3 class="kb-sub">隔離投票</h3>
        <p class="kb-lead">${v.majority}票以上集まった人は、明日は使用量1で固定・得点なしになります。投票は全員に見えます。</p>
        <ul class="vote-list" id="mn-votes"></ul>
        ${v.me ? `
          <div class="kb-actions">
            <button class="btn btn-primary" id="mn-ready"></button>
            <span class="kb-ready" id="mn-readycount"></span>
          </div>` : ''}`;

      area.querySelector('#mn-votes').onclick = (ev) => {
        const b = ev.target.closest('[data-target]');
        if (b && !b.disabled) this.api.send('vote', { target: b.dataset.target });
      };
      const ready = area.querySelector('#mn-ready');
      if (ready) ready.onclick = () => {
        const me = this.v.players.find((p) => p.id === this.api.myId());
        this.api.send('ready', { value: !me?.ready });
      };
    }

    refreshMeeting(v) {
      const e = this.esc;
      const myId = this.api.myId();
      const myVote = v.votes[myId];
      const votersFor = (t) => Object.entries(v.votes).filter(([, x]) => x === t).map(([id]) => id);
      const row = (target, label, disabled) => {
        const voters = votersFor(target);
        return `
          <li class="${myVote === target ? 'is-mine' : ''}${target !== 'none' && voters.length >= v.majority ? ' is-majority' : ''}">
            <div class="vote-who"><span class="player-name">${label}</span>
              <span class="voters">${voters.map((id) => `<span class="who">${e(this.name(id))}</span>`).join('')}</span>
            </div>
            <span class="vote-count">${voters.length}票</span>
            ${v.me ? `<button class="btn btn-small${myVote === target ? ' btn-primary' : ''}" data-target="${e(target)}" ${disabled ? 'disabled' : ''}>${myVote === target ? '投票中' : '投票'}</button>` : ''}
          </li>`;
      };
      this.root.querySelector('#mn-votes').innerHTML =
        v.players.map((p) => row(p.id, e(p.name), p.id === myId)).join('') + row('none', '隔離しない', false);

      const ready = this.root.querySelector('#mn-ready');
      if (ready) {
        const me = v.players.find((p) => p.id === myId);
        ready.textContent = me?.ready ? '会議を続ける' : '会議を終える';
        ready.classList.toggle('btn-primary', !me?.ready);
        const active = v.players.filter((p) => p.connected);
        this.root.querySelector('#mn-readycount').textContent = `${active.filter((p) => p.ready).length} / ${active.length}人が終了に同意`;
      }
    }

    // ---------- 結果 ----------
    buildEnded(area, v) {
      const e = this.esc;
      const r = v.result;
      const names = r.winners.map((id) => e(r.players.find((p) => p.id === id)?.name)).join('、');
      const head = r.days.map((d) => `<th>${d.day}日目<small>${e(d.event.name)}</small></th>`).join('');
      const rows = r.players
        .map((p) => {
          const cells = r.days
            .map((d) => {
              if (d.isolated === p.id) return '<td class="num is-muted">隔離</td>';
              const a = d.actual[p.id];
              const c = d.declares[p.id];
              const mon = d.monitoredBy[p.id];
              return `<td class="num${a !== c ? ' is-lie' : ''}">${a}<small>宣言${c}</small>${mon ? `<small class="mon">監視→${e(r.players.find((x) => x.id === mon)?.name)}</small>` : ''}</td>`;
            })
            .join('');
          const win = r.winners.includes(p.id);
          return `<tr class="${win ? 'is-winner' : ''}"><th scope="row">${e(p.name)}</th>${cells}<td class="num">${p.points}</td><td class="num">${p.used}</td></tr>`;
        })
        .join('');
      area.innerHTML = `
        <div class="mn-ended">
          <h2 class="final-title">${r.kind === 'survive' ? '基地は持ちこたえた' : '基地は壊滅した'}</h2>
          <p class="winner-line">${r.kind === 'survive' ? `得点最多で ${names} の勝ち` : `総使用量が最少で、${names} が脱出ポッドで生還`}</p>
          <h3 class="kb-sub">全員の本当の使用量(赤は宣言と違った日)</h3>
          <div class="table-wrap">
            <table class="mn-table reveal-table">
              <thead><tr><th>名前</th>${head}<th>得点</th><th>総使用量</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="kb-actions" id="mn-end-actions"></div>
        </div>`;
      area.querySelector('#mn-end-actions').onclick = (ev) => {
        if (ev.target.closest('[data-act="finish"]')) this.api.send('finish');
      };
    }

    refreshEnded() {
      this.root.querySelector('#mn-end-actions').innerHTML = this.api.isHost()
        ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>'
        : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>';
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.moon = { create: (root, api) => new MoonClient(root, api) };
})();
