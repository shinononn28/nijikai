(() => {
  'use strict';

  const TRANSPORT = { walk: '徒歩', bus: 'バス', subway: '地下鉄', hidden: '変装' };
  const TYPE_ORDER = { walk: 0, bus: 1, subway: 2 };
  const SVGNS = 'http://www.w3.org/2000/svg';

  class KaitoClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.sel = null; // 探偵: {to,type} / 怪盗: {legs:[{to,type}], disguise, double}
    }

    destroy() {}

    update(v) {
      const prev = this.v;
      this.v = v;
      if (!this.adj || prev?.map !== v.map) this.buildAdj(v);
      const key = `${v.phase}:${v.seq}`;
      if (key !== this.key) {
        this.key = key;
        this.resetSelection(v);
        this.build(v);
      }
      this.refresh(v);
    }

    buildAdj(v) {
      this.adj = v.map.nodes.map(() => []);
      for (const e of v.map.edges) {
        this.adj[e.a].push({ to: e.b, type: e.type });
        this.adj[e.b].push({ to: e.a, type: e.type });
      }
    }

    me() {
      return this.v.detectives.find((d) => d.id === this.v.myPiece);
    }
    nodeName(id) {
      return this.v.map.nodes[id]?.name ?? '?';
    }

    resetSelection(v) {
      if (v.role === 'thief') {
        const m = v.myMove;
        this.sel = { legs: m ? m.legs.map((l) => ({ ...l })) : [], disguise: !!m?.disguise, double: (m?.legs.length ?? 1) === 2 };
      } else if (v.role === 'detective') {
        this.sel = v.myMove ? { ...v.myMove } : null;
      } else {
        this.sel = null;
      }
    }

    // ---------- 合法手 ----------
    legalFrom(node) {
      if (this.v.role === 'thief') return this.adj[node];
      const d = this.me();
      return this.adj[node].filter((m) => m.type === 'walk' || d.tickets[m.type] > 0);
    }
    targets() {
      const v = this.v;
      if (v.phase !== 'move') return [];
      if (v.role === 'detective') return this.legalFrom(this.me().node);
      if (v.role === 'thief') {
        const legs = this.sel.legs;
        if (this.sel.double && legs.length === 1) return this.legalFrom(legs[0].to);
        return this.legalFrom(v.thief.node);
      }
      return [];
    }

    // ---------- 骨組み ----------
    build(v) {
      const roleText = { thief: 'あなたは怪盗', detective: 'あなたは探偵', spectator: '観戦中' }[v.role];
      this.root.innerHTML = `
        <div class="kb kt">
          <div class="kb-head">
            <span class="kb-round">${v.phase === 'ended' ? '終了' : `${v.turn}ターン目 / ${v.maxTurns}`}</span>
            <span class="kb-phase">${roleText}</span>
            ${v.endsAt ? `<span class="timer" data-ends-at="${v.endsAt}"></span>` : ''}
          </div>
          <div class="kt-status" id="kt-status"></div>
          <div class="kt-layout">
            <div class="kt-map-wrap">
              <svg id="kt-map" class="kt-map" viewBox="0 0 ${v.map.width} ${v.map.height}" role="group" aria-label="街の地図"></svg>
              <div class="kt-legend">
                <span><i class="lg lg-walk"></i>徒歩</span><span><i class="lg lg-bus"></i>バス</span>
                <span><i class="lg lg-subway"></i>地下鉄</span><span><i class="lg lg-treasure"></i>お宝</span>
              </div>
            </div>
            <aside class="kt-side">
              <section class="kt-panel" id="kt-control"></section>
              <section class="kt-panel" id="kt-log"></section>
              <section class="kt-panel" id="kt-team"></section>
            </aside>
          </div>
        </div>`;

      const svg = this.root.querySelector('#kt-map');
      const choose = (el) => {
        const g = el.closest('[data-node]');
        if (g) this.pickNode(Number(g.dataset.node));
      };
      svg.addEventListener('click', (ev) => choose(ev.target));
      svg.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          choose(ev.target);
        }
      });

      this.root.querySelector('#kt-control').addEventListener('click', (ev) => this.onControl(ev));
      this.root.querySelector('#kt-control').addEventListener('change', (ev) => {
        if (ev.target.id === 'kt-tip-node') this.tipNode = ev.target.value;
      });
    }

    refresh(v) {
      this.renderStatus(v);
      this.renderMap(v);
      this.renderControl(v);
      this.renderLog(v);
      this.renderTeam(v);
    }

    // ---------- 地図 ----------
    renderMap(v) {
      const svg = this.root.querySelector('#kt-map');
      const nodes = v.map.nodes;
      const P = (id) => nodes[id];
      const parts = [];

      const curve = (a, b, bend) => {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        return `M${a.x},${a.y} Q${mx - (dy / len) * bend},${my + (dx / len) * bend} ${b.x},${b.y}`;
      };
      for (const e of v.map.edges.filter((x) => x.type === 'walk')) {
        parts.push(`<line class="e-walk" x1="${P(e.a).x}" y1="${P(e.a).y}" x2="${P(e.b).x}" y2="${P(e.b).y}"/>`);
      }
      for (const e of v.map.edges.filter((x) => x.type === 'bus')) parts.push(`<path class="e-bus" d="${curve(P(e.a), P(e.b), 18)}"/>`);
      for (const e of v.map.edges.filter((x) => x.type === 'subway')) parts.push(`<path class="e-subway" d="${curve(P(e.a), P(e.b), 40)}"/>`);

      // 終了時は怪盗の足取り
      if (v.phase === 'ended' && v.trail) {
        const pts = v.trail.map((id) => `${P(id).x},${P(id).y}`).join(' ');
        parts.push(`<polyline class="trail" points="${pts}"/>`);
      }

      // 選択中の移動ルート
      const route = this.routeNodes();
      if (route.length > 1) {
        const pts = route.map((id) => `${P(id).x},${P(id).y}`).join(' ');
        parts.push(`<polyline class="route" points="${pts}"/>`);
      }

      const targets = new Set(this.targets().map((m) => m.to));
      const chosen = new Set(route.slice(1));
      for (const n of nodes) {
        const isT = targets.has(n.id);
        parts.push(`
          <g class="node${isT ? ' is-target' : ''}${chosen.has(n.id) ? ' is-chosen' : ''}" data-node="${n.id}"
            ${isT ? `tabindex="0" role="button" aria-label="${this.esc(n.name)}へ移動"` : ''}>
            ${n.subway ? `<rect class="n-subway" x="${n.x - 21}" y="${n.y - 21}" width="42" height="42" rx="8"/>` : ''}
            ${isT ? `<circle class="n-target" cx="${n.x}" cy="${n.y}" r="25"/>` : ''}
            <circle class="n-dot${n.bus ? ' is-bus' : ''}" cx="${n.x}" cy="${n.y}" r="14"/>
            <text class="n-label" x="${n.x}" y="${n.y + 34}">${this.esc(n.name)}</text>
            <circle class="n-hit" cx="${n.x}" cy="${n.y}" r="30"/>
          </g>`);
      }

      for (const t of v.treasures) {
        const n = P(t.node);
        const x = n.x + 15;
        const y = n.y - 17;
        parts.push(`<polygon class="treasure${t.stolen ? ' is-stolen' : ''}" points="${x},${y - 9} ${x + 8},${y} ${x},${y + 9} ${x - 8},${y}"><title>${this.esc(t.name)}${t.stolen ? '(盗まれた)' : ''}</title></polygon>`);
      }

      if (v.role !== 'thief' && v.lastKnown && v.phase !== 'ended') {
        const n = P(v.lastKnown.node);
        parts.push(`<g class="last-known"><circle cx="${n.x}" cy="${n.y}" r="21"/><text x="${n.x}" y="${n.y - 27}">${v.lastKnown.turn}T目撃</text></g>`);
      }

      // コマは交差点の中心を避けて周りに置く(移動先のハイライトを隠さないため)。
      // 右上はお宝の印、真下は地名なので使わない
      const SLOTS = [[-19, -15], [-27, 5], [25, 5], [-2, -28], [-42, -10], [42, -4]];
      const stack = {};
      const place = (node) => {
        const i = (stack[node] = (stack[node] ?? -1) + 1);
        const n = P(node);
        const [dx, dy] = SLOTS[i % SLOTS.length];
        return { x: n.x + dx, y: n.y + dy };
      };
      if (v.thief.node !== null && v.thief.node !== undefined) {
        const p = place(v.thief.node);
        parts.push(`<g class="piece piece-thief"><circle cx="${p.x}" cy="${p.y}" r="12"/><text x="${p.x}" y="${p.y + 5}">怪</text></g>`);
      }
      for (const d of v.detectives) {
        const p = place(d.node);
        const mine = d.id === v.myPiece;
        parts.push(`<g class="piece${mine ? ' is-mine' : ''}"><circle cx="${p.x}" cy="${p.y}" r="11" fill="${d.color}"/><text x="${p.x}" y="${p.y + 5}">${this.esc([...d.name][0])}</text></g>`);
      }

      // 移動先のハイライトはコマより上に重ねて、どこへ行けるかを必ず見えるようにする
      for (const id of targets) {
        const n = P(id);
        const occupied = v.detectives.some((d) => d.node === id) || v.thief.node === id;
        parts.push(`<circle class="n-target-top${chosen.has(id) ? ' is-chosen' : ''}${occupied ? ' is-occupied' : ''}" cx="${n.x}" cy="${n.y}" r="25"/>`);
        if (chosen.has(id)) parts.push(`<circle class="n-chosen-dot" cx="${n.x}" cy="${n.y}" r="8"/>`);
      }

      svg.innerHTML = parts.join('');
    }

    routeNodes() {
      const v = this.v;
      if (v.phase !== 'move' || !this.sel) return [];
      if (v.role === 'detective') return this.sel.to !== undefined ? [this.me().node, this.sel.to] : [];
      if (v.role === 'thief') return this.sel.legs.length ? [v.thief.node, ...this.sel.legs.map((l) => l.to)] : [];
      return [];
    }

    bestType(options, current) {
      const same = options.find((o) => o.type === current);
      if (same) return same.type;
      return [...options].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type])[0].type;
    }

    pickNode(id) {
      const v = this.v;
      if (v.phase !== 'move') return;
      const options = this.targets().filter((m) => m.to === id);
      if (!options.length) return;
      if (v.role === 'detective') {
        this.sel = { to: id, type: this.bestType(options, this.sel?.to === id ? this.sel.type : null) };
      } else if (v.role === 'thief') {
        const leg = { to: id, type: this.bestType(options) };
        if (this.sel.double && this.sel.legs.length === 1) this.sel.legs = [this.sel.legs[0], leg];
        else this.sel.legs = [leg];
      }
      this.refresh(v);
    }

    // ---------- 操作パネル ----------
    renderStatus(v) {
      const stolen = v.treasures.filter((t) => t.stolen).length;
      const nextReveal = v.revealTurns.find((t) => t >= v.turn);
      this.root.querySelector('#kt-status').innerHTML = `
        <span class="kt-chip">盗まれたお宝 <strong>${stolen} / ${v.needSteal}</strong></span>
        <span class="kt-chip">怪盗の切り札 変装 <strong>${v.thief.disguise}</strong>・高飛び <strong>${v.thief.double}</strong></span>
        ${v.phase === 'move' && nextReveal ? `<span class="kt-chip">次の位置公開 <strong>${nextReveal}ターン目</strong></span>` : ''}`;
    }

    renderControl(v) {
      const el = this.root.querySelector('#kt-control');
      const e = this.esc;
      if (v.phase === 'ended') {
        const r = v.result;
        const text = {
          captured: '怪盗を確保した',
          stolen: `お宝が${v.needSteal}つ盗まれた`,
          timeout: `${v.maxTurns}ターン守り切った`,
        }[r.kind];
        el.innerHTML = `
          <h2 class="kt-result">${r.winner === 'thief' ? '怪盗の勝ち' : '探偵の勝ち'}</h2>
          <p class="kt-result-sub">${text}。地図の赤い点線が怪盗の本当の足取りです。</p>
          ${this.api.isHost() ? '<button class="btn btn-primary btn-block" data-act="finish">ロビーに戻る</button>' : '<p class="hint wait">ホストがロビーに戻すのを待っています</p>'}`;
        return;
      }
      if (v.role === 'spectator') {
        el.innerHTML = '<p class="kt-note">観戦中です。怪盗の位置は探偵と同じく見えません。</p>';
        return;
      }

      const sent = v.myMove;
      if (v.role === 'detective') {
        const d = this.me();
        const opts = this.sel ? this.legalFrom(d.node).filter((m) => m.to === this.sel.to) : [];
        const same = sent && this.sel && sent.to === this.sel.to && sent.type === this.sel.type;
        el.innerHTML = `
          <div class="kt-me"><i class="dot" style="background:${d.color}"></i><strong>${e(d.name)}</strong>
            <span class="kt-tickets">バス ${d.tickets.bus}・地下鉄 ${d.tickets.subway}</span></div>
          <p class="kt-note">今いるのは ${e(this.nodeName(d.node))}。光っている場所をタップして移動先を選びます(その場にとどまることはできません)。</p>
          ${this.sel ? `
            <p class="kt-pick">移動先:<strong>${e(this.nodeName(this.sel.to))}</strong>(${TRANSPORT[this.sel.type]})</p>
            ${opts.length > 1 ? `<div class="kt-types">${opts.map((o) => `<button class="btn btn-small${o.type === this.sel.type ? ' btn-primary' : ''}" data-type="${o.type}">${TRANSPORT[o.type]}</button>`).join('')}</div>` : ''}
          ` : '<p class="kt-pick is-empty">まだ選んでいません</p>'}
          <button class="btn btn-primary btn-block" data-act="submit" ${!this.sel || same ? 'disabled' : ''}>${same ? '決定済み(選び直すと変更できます)' : sent ? '変更して決定' : 'この移動で決定'}</button>`;
        return;
      }

      // 怪盗
      const t = v.thief;
      const legs = this.sel.legs;
      const needLegs = this.sel.double ? 2 : 1;
      const ready = legs.length === needLegs;
      const same =
        sent && ready && sent.disguise === this.sel.disguise && sent.legs.length === legs.length &&
        sent.legs.every((l, i) => l.to === legs[i].to && l.type === legs[i].type);
      const legText = legs.map((l) => `${e(this.nodeName(l.to))}(${TRANSPORT[l.type]})`).join(' → ');
      const lastOpts = legs.length ? this.legalFrom(legs.length === 2 ? legs[0].to : t.node).filter((m) => m.to === legs[legs.length - 1].to) : [];
      const tipOptions = [...v.map.nodes].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      if (this.tipNode === undefined) this.tipNode = String(tipOptions[0].id);
      el.innerHTML = `
        <div class="kt-me"><i class="dot dot-thief"></i><strong>怪盗(あなた)</strong></div>
        <p class="kt-note">今いるのは <strong>${e(this.nodeName(t.node))}</strong>。探偵と同じマスに入るか、同じ道ですれ違うと確保されます。</p>
        <div class="kt-toggles">
          <button class="btn btn-small${this.sel.disguise ? ' btn-primary' : ''}" data-toggle="disguise" ${t.disguise < 1 ? 'disabled' : ''}>変装(残り${t.disguise})</button>
          <button class="btn btn-small${this.sel.double ? ' btn-primary' : ''}" data-toggle="double" ${t.double < 1 ? 'disabled' : ''}>高飛び(残り${t.double})</button>
        </div>
        <p class="kt-hint">${this.sel.disguise ? '変装中:このターンの移動手段は探偵に伏せられます。' : ''}${this.sel.double ? '高飛び中:2回続けて移動します。途中で探偵と鉢合わせても確保されます。' : ''}</p>
        ${legs.length ? `<p class="kt-pick">ルート:<strong>${legText}</strong>${this.sel.double && legs.length === 1 ? '(2つ目を選んでください)' : ''}</p>` : '<p class="kt-pick is-empty">光っている場所をタップして移動先を選びます</p>'}
        ${lastOpts.length > 1 ? `<div class="kt-types">${lastOpts.map((o) => `<button class="btn btn-small${o.type === legs[legs.length - 1].type ? ' btn-primary' : ''}" data-type="${o.type}">${TRANSPORT[o.type]}</button>`).join('')}</div>` : ''}
        <button class="btn btn-primary btn-block" data-act="submit" ${!ready || same ? 'disabled' : ''}>${same ? '決定済み(選び直すと変更できます)' : sent ? '変更して決定' : 'この移動で決定'}</button>
        <div class="kt-tip">
          <h3 class="kb-sub">偽の通報(残り${t.fakeTips}回)</h3>
          <p class="kt-note">探偵の作戦チャットに、本物の目撃通報と同じ見た目で届きます。</p>
          <div class="kt-tip-row">
            <select id="kt-tip-node" ${t.fakeTips < 1 ? 'disabled' : ''}>${tipOptions.map((n) => `<option value="${n.id}" ${String(n.id) === this.tipNode ? 'selected' : ''}>${e(n.name)}</option>`).join('')}</select>
            <button class="btn btn-small" data-act="fakeTip" ${t.fakeTips < 1 ? 'disabled' : ''}>送る</button>
          </div>
        </div>`;
    }

    onControl(ev) {
      const v = this.v;
      const b = ev.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.act === 'finish') return this.api.send('finish');
      if (b.dataset.act === 'fakeTip') {
        if (confirm(`「${this.nodeName(Number(this.tipNode))}」の偽の通報を送りますか?`)) this.api.send('fakeTip', { node: Number(this.tipNode) });
        return;
      }
      if (b.dataset.act === 'submit') {
        if (v.role === 'detective') this.api.send('move', this.sel);
        else this.api.send('move', { path: this.sel.legs, disguise: this.sel.disguise });
        return;
      }
      if (b.dataset.toggle) {
        this.sel[b.dataset.toggle] = !this.sel[b.dataset.toggle];
        if (b.dataset.toggle === 'double') this.sel.legs = this.sel.legs.slice(0, 1);
        return this.refresh(v);
      }
      if (b.dataset.type) {
        if (v.role === 'detective') this.sel.type = b.dataset.type;
        else this.sel.legs[this.sel.legs.length - 1].type = b.dataset.type;
        this.refresh(v);
      }
    }

    // ---------- 足取りと参加者 ----------
    renderLog(v) {
      const e = this.esc;
      const rows = v.log
        .map((l) => {
          const tr = l.transports.map((t) => `<span class="tk tk-${t}">${TRANSPORT[t]}</span>`).join('');
          const extra = l.stolen
            ? `<span class="kt-found is-stolen">${e(this.nodeName(l.revealed))}で${e(l.stolen)}</span>`
            : l.revealed !== null
              ? `<span class="kt-found">${e(this.nodeName(l.revealed))}で目撃</span>`
              : '';
          return `<li><span class="turn">${l.turn}</span>${tr}${extra}</li>`;
        })
        .join('');
      this.root.querySelector('#kt-log').innerHTML = `
        <h3 class="kb-sub">怪盗の足取り</h3>
        ${rows ? `<ol class="kt-log">${rows}</ol>` : '<p class="kt-note">まだ動いていません。移動手段は毎ターン、位置は3・6・9ターン目とお宝を盗んだときに公開されます。</p>'}`;
    }

    renderTeam(v) {
      const e = this.esc;
      const status = (x) => (v.phase !== 'move' ? '' : x ? '<span class="tag tag-done">決定</span>' : '<span class="tag">考え中</span>');
      this.root.querySelector('#kt-team').innerHTML = `
        <h3 class="kb-sub">参加者</h3>
        <ul class="kt-team">
          <li><i class="dot dot-thief"></i><span class="player-name">怪盗:${e(v.thief.name)}</span>${status(v.thief.decided)}</li>
          ${v.detectives.map((d) => `
            <li><i class="dot" style="background:${d.color}"></i><span class="player-name">${e(d.name)}</span>
              <span class="kt-tickets">バス${d.tickets.bus}・地下鉄${d.tickets.subway}</span>${status(d.decided)}</li>`).join('')}
        </ul>`;
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.kaito = { create: (root, api) => new KaitoClient(root, api) };
})();
