(() => {
  'use strict';

  const KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };

  class MeikyuClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.roomKey = null;
      this.lastDir = null;
      this.lastHit = 0;
      this.onKey = (e) => {
        if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
        const d = KEYS[e.code];
        if (d === undefined || !this.v || this.v.phase !== 'explore' || this.v.spectator) return;
        e.preventDefault();
        this.move(d);
      };
      document.addEventListener('keydown', this.onKey);
      this.tick = setInterval(() => this.refreshCooldown(), 200);
    }

    destroy() {
      document.removeEventListener('keydown', this.onKey);
      clearInterval(this.tick);
    }

    update(v) {
      this.v = v;
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.roomKey = null;
        this.build(v);
      }
      this.refresh(v);
    }

    move(d) {
      const door = this.v.room?.doors[d];
      if (!door?.open || this.api.remaining(this.v.me.cooldownUntil) > 0) return;
      this.lastDir = d;
      this.api.send('move', { dir: d });
    }

    // ---------- 骨組み ----------
    build(v) {
      const e = this.esc;
      if (v.phase === 'ended') {
        const got = v.results.reduce((s, r) => s + r.torch, 0);
        const max = v.results.reduce((s, r) => s + r.torchMax, 0);
        this.root.innerHTML = `
          <div class="kb mk">
            <div class="kb-head"><span class="kb-round">探索終了</span></div>
            <div class="mk-end">
              <p class="mk-rank-label">今回のパーティのランク</p>
              <p class="mk-rank">${e(v.rank)}</p>
              <p class="mk-end-sub">残った松明 ${got} / ${max}</p>
              <table class="gk-table">
                <thead><tr><th>階</th><th>結果</th><th class="num">残りの松明</th></tr></thead>
                <tbody>${v.results.map((r) => `<tr><td>${r.floor}階</td><td>${r.ok ? '合流成功' : r.why === 'time' ? '時間切れ' : '松明切れ'}</td><td class="num">${r.torch} / ${r.torchMax}</td></tr>`).join('')}</tbody>
              </table>
              <p class="kt-note">ランクは3つの階の残り松明の割合で決まります(S 55%以上・A 38%以上・B 20%以上)。</p>
              ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}
            </div>
          </div>`;
        this.root.querySelector('[data-act="finish"]')?.addEventListener('click', () => this.api.send('finish'));
        return;
      }
      this.root.innerHTML = `
        <div class="kb mk">
          <div class="kb-head">
            <span class="kb-round">${v.floor}階 / ${v.floors}</span>
            <span class="kb-phase">${v.compass === 'fixed' ? '方角あり(北が上)' : '方角バラバラ(前後左右)'}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div class="mk-status" id="mk-status"></div>
          <div class="mk-layout">
            <div class="mk-room-wrap" id="mk-room"></div>
            <aside class="mk-side">
              <section class="kt-panel" id="mk-tools"></section>
              <section class="kt-panel"><h3 class="kb-sub">自分の地図</h3><div id="mk-map" class="mk-map"></div>
                <p class="kt-note">自分が歩いた部屋だけが描かれます。${v.compass === 'fixed' ? '上が北です。' : '向きはあなたの画面の向き(上が前)です。仲間の地図とは向きが違うかもしれません。'}</p></section>
              <section class="kt-panel" id="mk-party"></section>
            </aside>
          </div>
          <div id="mk-overlay"></div>
        </div>`;
      this.root.querySelector('#mk-room').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-door]');
        if (b) this.move(Number(b.dataset.door));
      });
      this.root.querySelector('#mk-tools').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b || b.disabled) return;
        this.api.send(b.dataset.act);
      });
    }

    refresh(v) {
      if (v.phase === 'ended') return;
      this.renderStatus(v);
      if (!v.spectator) {
        this.renderRoom(v);
        this.renderTools(v);
        this.renderMap(v);
      } else {
        this.root.querySelector('#mk-room').innerHTML = '<p class="spectate">観戦中です。次のゲームから参加できます。</p>';
      }
      this.renderParty(v);
      this.renderOverlay(v);
    }

    renderStatus(v) {
      const pct = Math.max(0, (v.torch / v.torchMax) * 100);
      this.root.querySelector('#mk-status').innerHTML = `
        <div class="mk-torch">
          <span class="mk-torch-label">🔥 松明(チーム共有)</span>
          <span class="mk-torch-n${v.torch <= v.torchMax * 0.25 ? ' is-low' : ''}">${v.torch}<small> / ${v.torchMax}</small></span>
          <div class="mk-torch-bar"><span style="width:${pct}%"></span></div>
        </div>`;
    }

    // ---------- 部屋 ----------
    renderRoom(v) {
      const e = this.esc;
      const r = v.room;
      const el = this.root.querySelector('#mk-room');
      const entering = this.roomKey !== null && this.roomKey !== r.key;
      const enterFrom = entering && this.lastDir !== null ? this.lastDir : null;
      this.roomKey = r.key;
      if (v.me.lastHit && v.me.lastHit !== this.lastHit) {
        const fresh = this.lastHit !== 0;
        this.lastHit = v.me.lastHit;
        if (fresh) this.flashHit();
      }
      const cd = this.api.remaining(v.me.cooldownUntil) > 0;
      const pos = ['top', 'right', 'bottom', 'left'];
      const doors = r.doors
        .map((d) => {
          if (!d.open) return `<div class="mk-wall mk-${pos[d.rel]}"></div>`;
          return `
            <button class="mk-door mk-${pos[d.rel]}" data-door="${d.rel}" ${cd ? 'disabled' : ''} aria-label="${e(d.label)}の扉へ進む">
              <span class="mk-door-label">${e(d.label)}</span>
              ${d.sense ? `<span class="mk-sense${d.sense.icon === '👹' ? ' is-danger' : ''}">${d.sense.icon} ${e(d.sense.text)}</span>` : ''}
            </button>`;
        })
        .join('');
      const feats = r.features.length
        ? r.features.map((f) => `<div class="mk-feat"><span class="mk-feat-icon">${f.icon}</span><span>${e(f.name)}</span></div>`).join('')
        : '<div class="mk-feat is-empty"><span>何もない部屋</span></div>';
      const marks = r.marks.map((m) => `<span class="mk-mark" style="--c:${m.color}" title="${e(m.colorName)}のチョーク">〆</span>`).join('');
      const others = r.others.map((o) => `<span class="mk-other" style="background:${o.color}">${e([...o.name][0])}</span>`).join('');
      el.innerHTML = `
        <div class="mk-room${enterFrom !== null ? ` enter-${pos[enterFrom]}` : ''}${r.monster ? ' has-monster' : ''}">
          ${doors}
          <div class="mk-floor">
            <div class="mk-feats">${feats}</div>
            ${marks ? `<div class="mk-marks">${marks}<small>チョークの印</small></div>` : ''}
            ${others ? `<div class="mk-others">${others}<small>${r.others.map((o) => e(o.name)).join('・')}がいる</small></div>` : ''}
          </div>
        </div>
        <p class="kt-note mk-help">扉をタップして進みます(PCは矢印キーやWASDでも)。扉の横の文字は、その向こうの部屋から伝わる気配です。</p>`;
    }

    flashHit() {
      const el = this.root.querySelector('#mk-room');
      const f = document.createElement('div');
      f.className = 'mk-hit';
      f.textContent = '👹 魔物に襲われた!';
      el.appendChild(f);
      setTimeout(() => f.remove(), 1600);
    }

    refreshCooldown() {
      if (!this.v || this.v.phase !== 'explore' || this.v.spectator) return;
      const cd = this.api.remaining(this.v.me.cooldownUntil) > 0;
      this.root.querySelectorAll('.mk-door').forEach((b) => { b.disabled = cd; });
    }

    renderTools(v) {
      const hereMarked = v.room.marks.some((m) => m.color === v.me.color);
      this.root.querySelector('#mk-tools').innerHTML = `
        <h3 class="kb-sub">道具</h3>
        <button class="btn btn-block" data-act="report">📍 部屋の様子をチャットに貼る</button>
        <button class="btn btn-block" data-act="chalk" ${v.me.chalk < 1 || hereMarked || v.phase !== 'explore' ? 'disabled' : ''}>
          <span class="mk-chalk" style="--c:${v.me.color}">〆</span> ${this.esc(v.me.colorName)}のチョークで印をつける(残り${v.me.chalk})
        </button>
        <p class="kt-note">印はこの部屋に入った仲間にも見えます。「${this.esc(v.me.colorName)}の印を探して」のように使えます。</p>`;
    }

    renderMap(v) {
      const cells = v.explored;
      const xs = cells.map((c) => c.x);
      const ys = cells.map((c) => c.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const W = Math.max(...xs) - minX + 1;
      const H = Math.max(...ys) - minY + 1;
      const S = 34;
      const parts = [];
      for (const c of cells) {
        const x = (c.x - minX) * S + 6;
        const y = (c.y - minY) * S + 6;
        parts.push(`<rect class="mk-cell${c.here ? ' is-here' : ''}" x="${x + 4}" y="${y + 4}" width="${S - 8}" height="${S - 8}" rx="4"/>`);
        const mid = S / 2;
        const lines = [
          [x + mid, y + 4, x + mid, y],
          [x + S - 4, y + mid, x + S, y + mid],
          [x + mid, y + S - 4, x + mid, y + S],
          [x + 4, y + mid, x, y + mid],
        ];
        c.doors.forEach((open, i) => {
          if (open) parts.push(`<line class="mk-link" x1="${lines[i][0]}" y1="${lines[i][1]}" x2="${lines[i][2]}" y2="${lines[i][3]}"/>`);
        });
        if (c.start) parts.push(`<text class="mk-cell-t" x="${x + mid}" y="${y + mid + 5}">S</text>`);
        if (c.here) parts.push(`<circle class="mk-me" cx="${x + mid}" cy="${y + mid}" r="7" fill="${v.me.color}"/>`);
        else if (c.marked) parts.push(`<circle class="mk-dot" cx="${x + S - 9}" cy="${y + 9}" r="3"/>`);
      }
      const w = W * S + 12;
      const h = H * S + 12;
      this.root.querySelector('#mk-map').innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="max-width:${Math.min(w * 1.2, 320)}px">${parts.join('')}</svg>`;
    }

    renderParty(v) {
      const e = this.esc;
      this.root.querySelector('#mk-party').innerHTML = `
        <h3 class="kb-sub">パーティ</h3>
        <ul class="kt-team">${v.party.map((p) => `
          <li><i class="dot" style="background:${p.color}"></i><span class="player-name">${e(p.name)}</span>
            ${p.cpu ? (p.found ? `<span class="tag tag-done">${e(p.following)}と同行中</span>` : '<span class="tag">助けを待っている</span>') : ''}</li>`).join('')}</ul>
        <p class="kt-note">全員(CPUの仲間も)が同じ部屋に集まれば、この階はクリアです。</p>`;
    }

    renderOverlay(v) {
      const el = this.root.querySelector('#mk-overlay');
      if (v.phase !== 'cleared' || !v.gathered) {
        el.innerHTML = '';
        return;
      }
      const g = v.gathered;
      el.innerHTML = `
        <div class="mn-modal">
          <div class="mn-modal-card">
            <span class="event-label">${g.floor}階</span>
            <h2 class="mn-modal-title">${g.ok ? '合流成功!' : g.why === 'time' ? '時間切れ…' : '松明が尽きた…'}</h2>
            <p class="mn-modal-text">残った松明 <strong>${g.torch}</strong> / ${g.torchMax}</p>
            <p class="kt-note">${v.floor < v.floors ? 'まもなく次の階へ進みます' : 'まもなく結果発表です'}</p>
          </div>
        </div>`;
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.meikyu = { create: (root, api) => new MeikyuClient(root, api) };
})();
