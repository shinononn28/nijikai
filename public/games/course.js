(() => {
  'use strict';

  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  const ARROW = ['↑', '→', '↓', '←', '↗', '↘', '↙', '↖'];
  const ICON = { wall: '🧱', pit: '🕳️', spike: '🔺', spring: '🌀', blink: '⏳', decoy: '🟫', hidden: '❓' };
  const EVENT = { dead: '💥', wall: '🧱', spring: '🌀', endure: '🛡', goal: '🏁', stuck: '✋' };
  const KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
  const k = (x, y) => `${x},${y}`;

  // サーバーと同じ手順で経路を予想する(伏せ札はただの床とみなす)
  function simulate(cells, plan, char, maxSteps, W, H, start) {
    const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    let x = start.x;
    let y = start.y;
    let shield = char === 'tough' ? 1 : 0;
    const steps = [{ x, y, t: 0 }];
    const hit = (t) => {
      const c = cells[k(x, y)];
      if (!c) return null;
      if (c === 'pit' || c === 'spike' || (c === 'blink' && t % 2 === 0)) {
        if (shield > 0) { shield--; return 'endure'; }
        return 'dead';
      }
      return c === 'spring' ? 'spring' : null;
    };
    for (let t = 1; t <= Math.min(plan.length, maxSteps); t++) {
      const a = plan[t - 1];
      const [dx, dy] = DIRS[a.d];
      const len = a.jump ? 2 : 1;
      const nx = x + dx * len;
      const ny = y + dy * len;
      if (!inside(nx, ny)) return { steps: [...steps, { x, y, t, event: 'stuck' }], result: 'stuck' };
      if (cells[k(nx, ny)] === 'wall') return { steps: [...steps, { x, y, t, event: 'wall' }], result: 'wall' };
      x = nx;
      y = ny;
      let ev = hit(t);
      let b = 0;
      while (ev === 'spring' && b++ < 3) {
        steps.push({ x, y, t, event: 'spring' });
        for (let i = 0; i < 2; i++) {
          const qx = x + dx;
          const qy = y + dy;
          if (!inside(qx, qy) || cells[k(qx, qy)] === 'wall') break;
          x = qx;
          y = qy;
        }
        ev = hit(t);
      }
      if (ev === 'dead') return { steps: [...steps, { x, y, t, event: 'dead' }], result: 'dead' };
      steps.push({ x, y, t, event: ev === 'endure' ? 'endure' : x === W - 1 ? 'goal' : null });
      if (x === W - 1) return { steps, result: 'goal', time: t };
    }
    return { steps, result: 'timeout' };
  }

  const RESULT = { goal: 'ゴール', dead: '脱落', wall: '壁で止まった', stuck: '行き止まり', timeout: '歩数切れ', invalid: '動けない' };

  class CourseClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.plan = [];
      this.hideItem = false;
      this.onClickBound = (e) => this.onClick(e);
      root.addEventListener('click', this.onClickBound);
      this.onKey = (e) => {
        if (!this.v || this.v.phase !== 'plan' || e.target.closest('input, textarea, select')) return;
        if (e.key === 'Backspace') { e.preventDefault(); return this.undo(); }
        const d = KEYS[e.key];
        if (d === undefined) return;
        e.preventDefault();
        this.add(d, e.shiftKey && this.me()?.char === 'jumper');
      };
      document.addEventListener('keydown', this.onKey);
    }

    destroy() {
      this.root.removeEventListener('click', this.onClickBound);
      document.removeEventListener('keydown', this.onKey);
      clearInterval(this.animTimer);
      clearTimeout(this.sendTimer);
    }

    me() {
      return this.v.players.find((p) => p.id === this.api.myId());
    }

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        if (v.phase === 'plan') this.plan = v.myPlan?.plan ? [...v.myPlan.plan] : [];
        if (v.phase === 'result') this.startAnim();
        this.build(v);
      }
      this.refresh(v);
    }

    startAnim() {
      clearInterval(this.animTimer);
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const maxT = Math.max(0, ...Object.values(this.v.run.runs).map((r) => r.steps[r.steps.length - 1].t));
      this.animT = reduced ? maxT : 0;
      if (reduced) return;
      this.animTimer = setInterval(() => {
        this.animT++;
        if (this.animT >= maxT) clearInterval(this.animTimer);
        this.renderBoard(this.v);
      }, 380);
    }

    build(v) {
      this.root.innerHTML = `
        <div class="kb cs">
          <div class="kb-head">
            <span class="kb-round">${v.phase === 'chars' ? 'キャラクター選び' : v.phase === 'ended' ? '終了' : `ラウンド ${v.round}`}</span>
            <span class="kb-phase">${{ chars: '', pick: '部品を選ぶ', place: '部品を置く', plan: '経路を計画', result: '結果', ended: '' }[v.phase] || ''}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div class="cs-layout">
            <div class="cs-board-wrap"><div class="cs-board" id="cs-board" style="grid-template-columns:repeat(${v.W},1fr)"></div>
              <p class="kt-note cs-legend">🚩スタート 🏁右端がゴール 🧱壁 🕳️落とし穴 🔺トゲ 🌀バネ ⏳点滅床(偶数歩目は穴) ❓伏せ札(点線の色は置いた人)</p></div>
            <aside class="kt-side">
              <section class="kt-panel" id="cs-panel"></section>
              <section class="kt-panel" id="cs-score"></section>
            </aside>
          </div>
        </div>`;
    }

    refresh(v) {
      this.renderBoard(v);
      this.renderPanel(v);
      this.renderScore(v);
    }

    // ---------- 盤 ----------
    knownCells(v) {
      const m = {};
      for (const c of v.cells) if (c.type !== 'hidden' && c.type !== 'decoy') m[k(c.x, c.y)] = c.type;
      return m;
    }

    preview(v) {
      const me = this.me();
      if (!me) return null;
      return simulate(this.knownCells(v), this.plan, me.char, me.steps, v.W, v.H, v.start);
    }

    renderBoard(v) {
      const e = this.esc;
      const cellAt = Object.fromEntries(v.cells.map((c) => [k(c.x, c.y), c]));
      const marks = {};
      const tokens = {};
      if (v.phase === 'plan') {
        const pv = this.preview(v);
        if (pv) pv.steps.forEach((s, i) => { if (i > 0) (marks[k(s.x, s.y)] ||= []).push(`<span class="cs-step">${s.t}${s.event ? EVENT[s.event] : ''}</span>`); });
      }
      if (v.phase === 'result' || v.phase === 'ended') {
        for (const p of v.players) {
          const r = v.run?.runs[p.id];
          if (!r) continue;
          const upto = r.steps.filter((s) => s.t <= (this.animT ?? 99));
          const s = upto[upto.length - 1];
          (tokens[k(s.x, s.y)] ||= []).push(`<i class="cs-tok" style="background:${p.color}" title="${e(p.name)}">${s.event && s.t === this.animT ? EVENT[s.event] : ''}</i>`);
          for (const q of upto.slice(1)) (marks[k(q.x, q.y)] ||= []).push(`<span class="cs-trail" style="background:${p.color}"></span>`);
        }
      } else {
        (tokens[k(v.start.x, v.start.y)] ||= []).push('<span class="cs-start">🚩</span>');
      }
      const placing = v.phase === 'place' && v.placer === this.api.myId();
      const out = [];
      for (let y = 0; y < v.H; y++) {
        for (let x = 0; x < v.W; x++) {
          const c = cellAt[k(x, y)];
          const goal = x === v.W - 1;
          const start = x === v.start.x && y === v.start.y;
          const canPlace = placing && !start && (v.myItem === 'eraser' ? !!c : !c && !goal);
          const icon = c ? ICON[c.type] || '' : '';
          const blinkNote = c?.type === 'blink' ? '<small>偶</small>' : '';
          out.push(`
            <div class="cs-cell${goal ? ' is-goal' : ''}${start ? ' is-start' : ''}${c?.hidden ? ' is-hidden' : ''}${canPlace ? ' is-placeable' : ''}"
              ${canPlace ? `data-place="${x},${y}"` : ''} style="${c?.ownerColor ? `--oc:${c.ownerColor}` : ''}">
              ${icon ? `<span class="cs-icon">${icon}${blinkNote}</span>` : ''}
              ${c?.hidden && c.type !== 'hidden' ? '<span class="cs-mine">伏</span>' : ''}
              ${(marks[k(x, y)] || []).join('')}
              ${(tokens[k(x, y)] || []).join('')}
            </div>`);
        }
      }
      this.root.querySelector('#cs-board').innerHTML = out.join('');
    }

    // ---------- 操作パネル ----------
    renderPanel(v) {
      const e = this.esc;
      const el = this.root.querySelector('#cs-panel');
      const me = this.me();
      const myId = this.api.myId();
      if (v.phase === 'chars') {
        el.innerHTML = `
          <h3 class="kb-sub">キャラクターを選ぶ</h3>
          <div class="cs-chars">${Object.entries(v.chars).map(([id, c]) => `
            <button class="cs-char${me?.char === id ? ' is-on' : ''}" data-char="${id}"><b>${e(c.name)}</b><small>${e(c.text)}</small></button>`).join('')}</div>
          <p class="kt-note">全員が選ぶか、時間が来たら始まります。同じキャラを選んでも構いません。</p>`;
        return;
      }
      if (v.phase === 'pick') {
        const my = v.picker === myId;
        el.innerHTML = `
          <h3 class="kb-sub">${my ? 'あなたの番:部品を1つ選ぶ' : `${e(this.name(v.picker))}さんが選んでいます`}</h3>
          <div class="cs-items">${v.offer.map((o) => `
            <button class="cs-item${o.taken ? ' is-taken' : ''}" ${my && !o.taken ? `data-item="${o.id}"` : 'disabled'}>
              <span class="cs-item-icon">${ICON[o.type]}</span><b>${e(v.items[o.type].name)}</b><small>${o.taken ? `${e(this.name(o.taken))}が取った` : e(v.items[o.type].text)}</small></button>`).join('')}</div>`;
        return;
      }
      if (v.phase === 'place') {
        const my = v.placer === myId;
        const it = v.myItem ? v.items[v.myItem] : null;
        el.innerHTML = my
          ? `<h3 class="kb-sub">あなたの番:${ICON[v.myItem]} ${e(it.name)}を置く</h3>
             <p class="kt-note">${v.myItem === 'eraser' ? '消したい部品のマスをタップ' : '光っているマスをタップして置きます'}</p>
             ${v.myItem !== 'eraser' ? `<label class="cs-hide"><input type="checkbox" data-hide ${this.hideItem ? 'checked' : ''}> 伏せて置く(ほかの人には「❓」に見える)</label>` : ''}`
          : `<h3 class="kb-sub">${e(this.name(v.placer))}さんが部品を置いています</h3>`;
        return;
      }
      if (v.phase === 'plan') {
        if (!me) {
          el.innerHTML = '<p class="kt-note">観戦中です。</p>';
          return;
        }
        const pv = this.preview(v);
        const ready = v.myPlan?.ready;
        const pad = [0, 1, 2, 3].map((d) => `<button class="btn btn-small" data-move="${d}">${ARROW[d]}</button>`).join('');
        const diag = me.char === 'diag' ? [4, 5, 6, 7].map((d) => `<button class="btn btn-small" data-move="${d}">${ARROW[d]}</button>`).join('') : '';
        const jump = me.char === 'jumper' ? [0, 1, 2, 3].map((d) => `<button class="btn btn-small" data-jump="${d}">跳${ARROW[d]}</button>`).join('') : '';
        el.innerHTML = `
          <h3 class="kb-sub">経路を計画(${this.plan.length} / ${me.steps}歩)</h3>
          <p class="kt-note">あなたは<b>${e(v.chars[me.char].name)}</b>:${e(v.chars[me.char].text)}</p>
          <div class="cs-pad">${pad}</div>
          ${diag ? `<div class="cs-pad">${diag}</div>` : ''}
          ${jump ? `<div class="cs-pad">${jump}</div>` : ''}
          <div class="kb-actions"><button class="btn btn-quiet btn-small" data-act="undo">1歩戻す</button><button class="btn btn-quiet btn-small" data-act="clear">やり直す</button></div>
          <p class="cs-pv cs-${pv.result}">予想:${RESULT[pv.result]}${pv.result === 'goal' ? `(${pv.time}歩目)` : ''}<small>(❓は踏んでみるまで中身がわかりません)</small></p>
          <button class="btn ${ready ? '' : 'btn-primary'} btn-block" data-act="ready">${ready ? '決定済み(直すなら押す)' : 'この経路で決定'}</button>
          <p class="kt-note">PCは矢印キーで進む、Shift+矢印で跳ぶ(ジャンパー)、Backspaceで1歩戻せます。</p>`;
        return;
      }
      if (v.phase === 'result' || v.phase === 'ended') {
        const r = v.run;
        el.innerHTML = `
          <h3 class="kb-sub">第${v.round}ラウンドの結果</h3>
          <p class="cs-note">${e(r?.note || '')}</p>
          ${r?.trapNotes?.length ? `<ul class="gk-events">${r.trapNotes.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : ''}
          <ul class="kt-team">${v.players.map((p) => `<li><i class="dot" style="background:${p.color}"></i><span class="player-name">${e(p.name)}</span><span class="kt-tickets">${RESULT[r?.runs[p.id]?.result] || ''} ${r?.gain[p.id] ? `+${r.gain[p.id]}` : ''}</span></li>`).join('')}</ul>
          ${v.phase === 'ended'
            ? (this.api.isHost() ? '<button class="btn btn-primary btn-block" data-act="finish">ロビーに戻る</button>' : '')
            : this.api.isHost() ? `<button class="btn btn-primary btn-block" data-act="next">${v.over ? '最終結果へ' : '次のラウンドへ'}</button>` : '<p class="hint wait">ホストが次へ進めます</p>'}`;
      }
    }

    renderScore(v) {
      const e = this.esc;
      this.root.querySelector('#cs-score').innerHTML = `
        <h3 class="kb-sub">得点(${v.target}点で勝利)</h3>
        <ul class="kt-team">${[...v.players].sort((a, b) => b.score - a.score).map((p) => `
          <li><i class="dot" style="background:${p.color}"></i><span class="player-name">${e(p.name)}</span>
            <span class="kt-tickets">${p.char ? e(v.chars[p.char].name) : ''}${p.item ? `・${ICON[p.item]}` : ''}${p.planned === null ? '' : p.planned ? '・決定' : '・計画中'}</span><b>${p.score}</b></li>`).join('')}</ul>`;
    }

    name(id) {
      return this.v.players.find((p) => p.id === id)?.name ?? '?';
    }

    // ---------- 計画の操作 ----------
    add(d, jump) {
      const me = this.me();
      if (!me || this.plan.length >= me.steps || this.v.myPlan?.ready) return;
      this.plan.push({ d, jump: !!jump });
      this.sync(false);
    }
    undo() {
      if (this.v.myPlan?.ready) return;
      this.plan.pop();
      this.sync(false);
    }
    sync(ready) {
      clearTimeout(this.sendTimer);
      const send = () => this.api.send('plan', { plan: this.plan, ready });
      if (ready) send();
      else this.sendTimer = setTimeout(send, 300);
      this.renderBoard(this.v);
      this.renderPanel(this.v);
    }

    onClick(ev) {
      const t = ev.target.closest('[data-char],[data-item],[data-place],[data-move],[data-jump],[data-act],[data-hide]');
      if (!t || t.disabled) return;
      if (t.dataset.hide !== undefined) {
        this.hideItem = t.checked;
        return;
      }
      if (t.dataset.char) return this.api.send('char', { char: t.dataset.char });
      if (t.dataset.item) return this.api.send('pickItem', { id: t.dataset.item });
      if (t.dataset.place) {
        const [x, y] = t.dataset.place.split(',').map(Number);
        this.api.send('place', { x, y, hidden: this.hideItem });
        this.hideItem = false;
        return;
      }
      if (t.dataset.move) return this.add(Number(t.dataset.move), false);
      if (t.dataset.jump) return this.add(Number(t.dataset.jump), true);
      switch (t.dataset.act) {
        case 'undo':
          this.undo();
          break;
        case 'clear':
          if (!this.v.myPlan?.ready) { this.plan = []; this.sync(false); }
          break;
        case 'ready':
          if (this.v.myPlan?.ready) this.api.send('plan', { plan: this.plan, ready: false });
          else this.sync(true);
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
  window.GameClients.course = { create: (root, api) => new CourseClient(root, api) };
})();
