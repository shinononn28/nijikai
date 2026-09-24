(() => {
  'use strict';

  const kindLabel = { move: '移動・攻撃', support: '援軍' };

  class GaikouClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.from = null;
      this.to = null;
      this.choice = null; // {kind, side}
      this.count = 1;
      this.orders = [];
      this.sendTimer = null;
    }

    destroy() {
      clearTimeout(this.sendTimer);
    }

    update(v) {
      this.v = v;
      this.adj = this.adj && this.adjFor === v.map ? this.adj : this.buildAdj(v);
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.from = this.to = this.choice = null;
        this.orders = v.me ? v.me.orders.map((o) => ({ ...o })) : [];
        this.build(v);
      }
      this.refresh(v);
    }

    buildAdj(v) {
      const adj = v.map.nodes.map(() => []);
      for (const [a, b] of v.map.edges) {
        adj[a].push(b);
        adj[b].push(a);
      }
      this.adjFor = v.map;
      return adj;
    }

    nation(id) {
      return this.v.nations.find((n) => n.id === id);
    }
    my() {
      return this.v.me ? this.nation(this.v.me.nation) : null;
    }
    tname(i) {
      return this.v.map.nodes[i].name;
    }
    used(from) {
      return this.orders.filter((o) => o.from === from).reduce((s, o) => s + o.n, 0);
    }
    avail(from) {
      return this.v.terr[from].troops - this.used(from);
    }

    // ---------- 骨組み ----------
    build(v) {
      const my = this.my();
      this.root.innerHTML = `
        <div class="kb kt gk">
          <div class="kb-head">
            <span class="kb-round">${v.phase === 'ended' ? '終了' : `第${v.round}ラウンド / ${v.rounds}`}</span>
            <span class="kb-phase">${my ? `<i class="dot" style="background:${my.color}"></i>${this.esc(my.title)}` : '観戦中'}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div class="kt-status" id="gk-status"></div>
          <div class="kt-layout">
            <div class="kt-map-wrap">
              <svg id="gk-map" class="kt-map gk-map" viewBox="0 0 ${v.map.width} ${v.map.height}" role="group" aria-label="大陸の地図"></svg>
              <div class="kt-legend"><span>★ 拠点(1つにつき毎ラウンド兵+1)</span><span>♛ 首都</span><span>数字は兵の数</span></div>
            </div>
            <aside class="kt-side">
              <section class="kt-panel" id="gk-orders"></section>
              <section class="kt-panel" id="gk-treaty"></section>
              <section class="kt-panel" id="gk-nations"></section>
              <section class="kt-panel" id="gk-last"></section>
            </aside>
          </div>
        </div>`;
      const svg = this.root.querySelector('#gk-map');
      const choose = (el) => {
        const g = el.closest('[data-t]');
        if (g) this.pick(Number(g.dataset.t));
      };
      svg.addEventListener('click', (e) => choose(e.target));
      svg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose(e.target);
        }
      });
      this.root.querySelector('#gk-orders').addEventListener('click', (e) => this.onOrders(e));
      this.root.querySelector('#gk-treaty').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tr]');
        if (b) this.api.send(b.dataset.tr, { nation: b.dataset.n });
      });
    }

    refresh(v) {
      this.renderStatus(v);
      this.renderMap(v);
      this.renderOrders(v);
      this.renderTreaty(v);
      this.renderNations(v);
      this.renderLast(v);
    }

    // ---------- 地図 ----------
    renderMap(v) {
      const svg = this.root.querySelector('#gk-map');
      const N = v.map.nodes;
      const parts = [
        `<defs>${v.nations.map((n) => `<marker id="ar-${n.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${n.color}"/></marker>`).join('')}
          <marker id="ar-move" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#15211d"/></marker></defs>`,
      ];
      for (const [a, b] of v.map.edges) parts.push(`<line class="e-walk" x1="${N[a].x}" y1="${N[a].y}" x2="${N[b].x}" y2="${N[b].y}"/>`);

      // 自分の命令の矢印(領地の上に重ねるので、あとで足す)
      const my = this.my();
      const arrows = [];
      for (const o of this.orders) {
        const a = N[o.from];
        const b = N[o.to];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const sx = a.x + (dx / len) * 26;
        const sy = a.y + (dy / len) * 26;
        const ex = b.x - (dx / len) * 30;
        const ey = b.y - (dy / len) * 30;
        const own = v.terr[o.to].owner === my?.id;
        const cls = o.kind === 'support' ? 'ord-sup' : own ? 'ord-move' : 'ord-atk';
        const marker = o.kind === 'support' ? `ar-${o.side}` : own ? 'ar-move' : `ar-${my.id}`;
        const stroke = o.kind === 'support' ? this.nation(o.side).color : own ? '#15211d' : my.color;
        arrows.push(`<line class="${cls}" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${stroke}" marker-end="url(#${marker})"/>`);
        arrows.push(`<text class="ord-n" x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 6}">${o.n}</text>`);
      }

      const targets = new Set(this.from !== null ? this.adj[this.from] : []);
      N.forEach((n, i) => {
        const t = v.terr[i];
        const owner = t.owner ? this.nation(t.owner) : null;
        const mine = owner && owner.id === my?.id;
        const isCap = owner && v.nations.some((x) => x.capital === i);
        const clickable = v.phase === 'orders' && my && (mine || (this.from !== null && targets.has(i)));
        parts.push(`
          <g class="terr${mine ? ' is-mine' : ''}${this.from === i ? ' is-from' : ''}${this.to === i ? ' is-to' : ''}${targets.has(i) ? ' is-target' : ''}" data-t="${i}"
            ${clickable ? `tabindex="0" role="button" aria-label="${this.esc(n.name)}"` : ''}>
            <circle class="t-body" cx="${n.x}" cy="${n.y}" r="24" fill="${owner ? owner.color : '#d9d3c3'}"/>
            ${targets.has(i) ? `<circle class="t-ring" cx="${n.x}" cy="${n.y}" r="30"/>` : ''}
            ${this.from === i ? `<circle class="t-from" cx="${n.x}" cy="${n.y}" r="30"/>` : ''}
            <text class="t-n" x="${n.x}" y="${n.y + 7}">${t.troops}</text>
            ${n.star ? `<text class="t-star" x="${n.x + 20}" y="${n.y - 14}">★</text>` : ''}
            ${v.nations.some((x) => x.capital === i) ? `<text class="t-cap" x="${n.x - 21}" y="${n.y - 14}">♛</text>` : ''}
            <text class="n-label" x="${n.x}" y="${n.y + 42}">${this.esc(n.name)}</text>
            <circle class="n-hit" cx="${n.x}" cy="${n.y}" r="32"/>
          </g>`);
        void isCap;
      });

      // 前のラウンドで戦闘があった場所
      if (v.lastResult && v.lastResult.round === v.round - 1) {
        for (const b of v.lastResult.battles) {
          const n = N[b.node];
          parts.push(`<text class="t-boom" x="${n.x - 26}" y="${n.y + 30}">⚔</text>`);
        }
      }
      svg.innerHTML = parts.join('') + arrows.join('');
    }

    pick(i) {
      const v = this.v;
      const my = this.my();
      if (v.phase !== 'orders' || !my) return;
      const mine = v.terr[i].owner === my.id;
      if (this.from !== null && this.adj[this.from].includes(i) && i !== this.from) {
        this.to = i;
        this.choice = this.options()[0] || null;
        this.count = Math.max(1, Math.min(this.avail(this.from), this.count));
      } else if (mine) {
        this.from = this.from === i ? null : i;
        this.to = null;
        this.choice = null;
        this.count = Math.max(1, this.avail(i));
      } else {
        this.from = this.to = this.choice = null;
      }
      this.refresh(v);
    }

    options() {
      const v = this.v;
      const my = this.my();
      if (this.to === null) return [];
      const owner = v.terr[this.to].owner;
      if (owner === my.id) return [{ kind: 'move', side: null, label: '兵を移動する' }];
      const out = [{ kind: 'move', side: null, label: owner ? `${this.nation(owner).title}に攻め込む` : '占領しに行く' }];
      if (owner) out.push({ kind: 'support', side: owner, label: `${this.nation(owner).title}の守備に援軍` });
      for (const n of v.nations) {
        if (n.id === my.id || n.id === owner) continue;
        out.push({ kind: 'support', side: n.id, label: `${n.title}の攻撃に援軍` });
      }
      return out;
    }

    // ---------- 命令パネル ----------
    renderOrders(v) {
      const el = this.root.querySelector('#gk-orders');
      const e = this.esc;
      const my = this.my();
      if (v.phase === 'ended') {
        const r = v.result;
        const rows = [...v.nations].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        el.innerHTML = `
          <h2 class="kt-result">${r.winners.map((id) => e(this.nation(id).title)).join('・')}の勝ち</h2>
          <p class="kt-result-sub">${r.kind === 'instant' ? `★を${v.winStars}つ押さえて即勝利` : '全ラウンド終了。★+秘密の目標で決着'}</p>
          <table class="gk-table">
            <thead><tr><th>国</th><th>★</th><th>目標</th><th>点</th></tr></thead>
            <tbody>${rows.map((n) => `<tr class="${r.winners.includes(n.id) ? 'is-win' : ''}"><td><i class="dot" style="background:${n.color}"></i>${e(n.title)}<small>${e(n.leader)}</small></td><td class="num">${n.stars}</td>
              <td>${n.objective ? `<span class="${n.objective.done ? 'ok' : 'ng'}">${n.objective.done ? '達成' : '未達'}</span><small>${e(n.objective.text)}</small>` : '—'}</td><td class="num">${n.score}</td></tr>`).join('')}</tbody>
          </table>
          ${this.api.isHost() ? '<button class="btn btn-primary btn-block" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}`;
        return;
      }
      if (!my) {
        el.innerHTML = '<p class="kt-note">観戦中です。次のゲームから参加できます。</p>';
        return;
      }
      let picker = '<p class="kt-note">自分の領地をタップして兵を出す場所を選び、続けて隣の領地をタップします。命令は解決まで何度でも変えられ、誰にも見えません。</p>';
      if (this.from !== null && this.to === null) {
        picker = `<p class="kt-pick"><strong>${e(this.tname(this.from))}</strong>(出せる兵 ${this.avail(this.from)})から、隣の領地をタップ</p>`;
      } else if (this.from !== null && this.to !== null) {
        const opts = this.options();
        const max = this.avail(this.from);
        picker = `
          <p class="kt-pick"><strong>${e(this.tname(this.from))}</strong> → <strong>${e(this.tname(this.to))}</strong></p>
          <div class="gk-opts">${opts.map((o, i) => `<button class="btn btn-small${this.choice && o.kind === this.choice.kind && o.side === this.choice.side ? ' btn-primary' : ''}" data-opt="${i}">${e(o.label)}</button>`).join('')}</div>
          ${this.choice?.kind === 'support' ? '<p class="kt-note">援軍は戦闘に加わって兵力を足し、終わると元の領地へ戻ります(その間、元の領地の守りは薄くなります)。</p>' : ''}
          <div class="gk-count">
            <button class="btn btn-small" data-cnt="-1" ${this.count <= 1 ? 'disabled' : ''}>−</button>
            <span class="gk-n">${Math.min(this.count, Math.max(0, max))}</span><span>兵</span>
            <button class="btn btn-small" data-cnt="1" ${this.count >= max ? 'disabled' : ''}>+</button>
            <button class="btn btn-small btn-quiet" data-cnt="max">全部</button>
          </div>
          <button class="btn btn-primary btn-block" data-act="add" ${max < 1 || !this.choice ? 'disabled' : ''}>この命令を追加</button>`;
      }
      const list = this.orders.length
        ? `<ul class="gk-list">${this.orders.map((o, i) => {
            const own = v.terr[o.to].owner === my.id;
            const what = o.kind === 'support' ? `${this.nation(o.side).title}に援軍` : own ? '移動' : '攻撃';
            return `<li><span>${e(this.tname(o.from))} → ${e(this.tname(o.to))}</span><span class="gk-k gk-k-${o.kind === 'support' ? 'sup' : own ? 'move' : 'atk'}">${what} ${o.n}</span><button class="x" data-del="${i}" aria-label="取り消す">×</button></li>`;
          }).join('')}</ul>`
        : '<p class="kt-note">まだ命令はありません(何もしなければ全軍が守りにつきます)。</p>';
      const ready = v.nations.filter((n) => !n.cpu && n.connected);
      el.innerHTML = `
        <h3 class="kb-sub">命令</h3>
        ${picker}
        ${list}
        <div class="kb-actions">
          <button class="btn ${v.me.ready ? '' : 'btn-primary'}" data-act="ready">${v.me.ready ? '確定を取り消す' : '命令を確定'}</button>
          <span class="kb-ready" style="color:var(--muted)">${ready.filter((n) => n.ready).length} / ${ready.length}人が確定</span>
        </div>`;
    }

    onOrders(ev) {
      const b = ev.target.closest('button');
      if (!b || b.disabled) return;
      const v = this.v;
      if (b.dataset.act === 'finish') return this.api.send('finish');
      if (b.dataset.act === 'ready') return this.api.send('ready', { value: !v.me.ready });
      if (b.dataset.opt !== undefined) this.choice = this.options()[Number(b.dataset.opt)];
      if (b.dataset.cnt) {
        const max = this.avail(this.from);
        this.count = b.dataset.cnt === 'max' ? max : Math.max(1, Math.min(max, this.count + Number(b.dataset.cnt)));
      }
      if (b.dataset.act === 'add') {
        const n = Math.min(this.count, this.avail(this.from));
        if (n > 0 && this.choice) {
          this.orders.push({ from: this.from, to: this.to, n, kind: this.choice.kind, side: this.choice.side });
          this.from = this.to = this.choice = null;
          this.save();
        }
      }
      if (b.dataset.del !== undefined) {
        this.orders.splice(Number(b.dataset.del), 1);
        this.save();
      }
      this.refresh(v);
    }

    save() {
      clearTimeout(this.sendTimer);
      this.sendTimer = setTimeout(() => this.api.send('setOrders', { orders: this.orders }), 250);
    }

    // ---------- 条約 ----------
    renderTreaty(v) {
      const el = this.root.querySelector('#gk-treaty');
      const e = this.esc;
      const my = this.my();
      const has = (a, b) => v.treaties.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
      const cool = (a, b) => v.cooldown.find((c) => c.pair.includes(a) && c.pair.includes(b));
      const rows = v.nations
        .filter((n) => n.id !== my?.id)
        .map((n) => {
          let status = '';
          let btn = '';
          if (my && v.phase === 'orders') {
            const sent = v.proposals.some((p) => p.from === my.id && p.to === n.id);
            const got = v.proposals.some((p) => p.from === n.id && p.to === my.id);
            const cd = cool(my.id, n.id);
            if (has(my.id, n.id)) status = '<span class="tag tag-done">条約中</span>';
            else if (got) {
              status = '<span class="tag">申し込まれた</span>';
              btn = `<button class="btn btn-small btn-primary" data-tr="accept" data-n="${n.id}">受ける</button><button class="btn btn-small" data-tr="decline" data-n="${n.id}">断る</button>`;
            } else if (sent) {
              status = '<span class="tag">返事待ち</span>';
              btn = `<button class="btn btn-small btn-quiet" data-tr="withdraw" data-n="${n.id}">取り下げ</button>`;
            } else if (cd) status = `<span class="tag">${cd.until + 1}ラウンドから結べる</span>`;
            else btn = `<button class="btn btn-small" data-tr="propose" data-n="${n.id}">条約を申し込む</button>`;
          }
          return `<li><i class="dot" style="background:${n.color}"></i><span class="player-name">${e(n.title)}</span>${status}<span class="gk-btns">${btn}</span></li>`;
        })
        .join('');
      const others = v.treaties
        .filter(([a, b]) => !my || (a !== my.id && b !== my.id))
        .map(([a, b]) => `${e(this.nation(a).title)}・${e(this.nation(b).title)}`);
      el.innerHTML = `
        <h3 class="kb-sub">不可侵条約</h3>
        <table class="gk-payoff">
          <tr><th></th><th>相手が守る</th><th>相手が攻める</th></tr>
          <tr><th>守る</th><td>両国に平和配当 兵+1</td><td>奇襲される</td></tr>
          <tr><th>攻める</th><td>奇襲 兵力+2</td><td>共倒れ 両国の増援−2</td></tr>
        </table>
        <ul class="gk-treaties">${rows}</ul>
        ${others.length ? `<p class="kt-note">ほかの条約:${others.join('、')}</p>` : ''}
        <p class="kt-note">破った条約は全体に公開され、同じ相手とは2ラウンド結び直せません。平和配当は2つの条約まで。</p>`;
    }

    renderNations(v) {
      const el = this.root.querySelector('#gk-nations');
      const e = this.esc;
      const my = this.my();
      el.innerHTML = `
        <h3 class="kb-sub">国の様子(★${v.winStars}つで即勝利)</h3>
        <ul class="kt-team">${v.nations.map((n) => `
          <li><i class="dot" style="background:${n.color}"></i><span class="player-name">${e(n.title)}<small class="gk-leader">${e(n.leader)}</small></span>
            <span class="kt-tickets">★${n.stars}・領地${n.lands}・兵${n.troops}${n.broken ? `・破約${n.broken}` : ''}</span>
            ${v.phase === 'orders' ? (n.ready ? '<span class="tag tag-done">確定</span>' : '<span class="tag">考え中</span>') : ''}</li>`).join('')}</ul>
        ${v.objectivesOn && v.me?.objective && v.phase !== 'ended' ? `<div class="gk-obj"><strong>あなたの秘密の目標(+2点)</strong><p>${e(v.me.objective.text)}</p><small>${v.me.objective.done ? '今は達成しています' : '今は未達成'}</small></div>` : ''}
        ${my ? '' : ''}`;
    }

    renderLast(v) {
      const el = this.root.querySelector('#gk-last');
      const e = this.esc;
      const r = v.lastResult;
      if (!r) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      const nm = (id) => (id ? this.nation(id).title : '無所属');
      const battles = r.battles
        .map((b) => {
          const sides = b.sides
            .map((s) => `<span class="gk-side" style="--c:${s.nation ? this.nation(s.nation).color : '#9aa39e'}">${e(nm(s.nation))} ${s.own}${s.sup ? `+援${s.sup}` : ''}${s.bonus ? '+奇襲2' : ''}${s.nation ? ` 🎲${s.dice}` : ''} = ${s.strength}</span>`)
            .join(' vs ');
          const res = b.result === 'taken' ? `${e(nm(b.winner))}が奪取` : b.result === 'held' ? `${e(nm(b.winner ?? b.owner))}が守った` : '押し返し合い';
          return `<li><strong>${e(this.tname(b.node))}</strong>:${sides} → <em>${res}</em></li>`;
        })
        .join('');
      el.innerHTML = `
        <h3 class="kb-sub">第${r.round}ラウンドの結果</h3>
        ${battles ? `<ul class="gk-battles">${battles}</ul>` : '<p class="kt-note">戦闘はなかった</p>'}
        ${r.events.length ? `<ul class="gk-events">${r.events.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : ''}`;
    }

    renderStatus(v) {
      const my = this.my();
      this.root.querySelector('#gk-status').innerHTML = `
        <span class="kt-chip">★は全部で <strong>${v.starTotal}</strong>、<strong>${v.winStars}</strong>つで即勝利</span>
        ${my ? `<span class="kt-chip">あなたの★ <strong>${my.stars}</strong>・兵 <strong>${my.troops}</strong></span>` : ''}`;
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.gaikou = { create: (root, api) => new GaikouClient(root, api) };
})();
