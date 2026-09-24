(() => {
  'use strict';

  // 鉄道は少し弧を描いて引く(道と重ならないように)。コマもこの弧に沿って動く
  const RAIL_BEND = 46;
  function railCtrl(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: (a.x + b.x) / 2 - (dy / len) * RAIL_BEND, y: (a.y + b.y) / 2 + (dx / len) * RAIL_BEND };
  }
  function railPoint(a, b, k) {
    const c = railCtrl(a, b);
    const u = 1 - k;
    return { x: u * u * a.x + 2 * u * k * c.x + k * k * b.x, y: u * u * a.y + 2 * u * k * c.y + k * k * b.y };
  }

  // 戦闘の結果の言葉:無所属の土地は「占領」、他国の領地は「陥落/防衛」
  const resultText = (b) =>
    b.result === 'taken' ? (b.owner ? '陥落' : '占領') : b.result === 'held' ? (b.owner ? '防衛' : '占領失敗') : '押し返し';

  // 解決の演出のタイミング(ミリ秒)
  const FX = { TRAVEL: 1100, BATTLE: 900, BACK: 600, FLASH: 900 };
  FX.SWAP = FX.TRAVEL + FX.BATTLE;
  FX.TOTAL = FX.SWAP + Math.max(FX.BACK, FX.FLASH) + 200;

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
      cancelAnimationFrame(this.raf);
      this.closeModal();
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
      // ラウンドが解決したら、全員の兵の動きを地図の上で再生する
      const r = v.lastResult;
      if (r && this.animRound !== r.round && (r.round === v.round - 1 || v.phase === 'ended')) {
        this.animRound = r.round;
        this.startAnim(r);
      }
      this.refresh(v);
    }

    // ---------- 解決の演出 ----------
    startAnim(r) {
      cancelAnimationFrame(this.raf);
      // 「動きを減らす」設定の人には、コマを動かさずに矢印と結果を静止表示する(情報は同じ)
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.anim = { r, t0: performance.now(), reduced };
      this.swapped = false;
      const loop = () => {
        if (!this.anim) return;
        const t = performance.now() - this.anim.t0;
        if (t >= FX.TOTAL + (this.anim.reduced ? 1200 : 0)) return this.endAnim();
        if (!this.swapped && t >= FX.SWAP) {
          this.swapped = true;
          this.renderMap(this.v);
        }
        this.drawFx(t);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    endAnim() {
      const r = this.anim?.r;
      cancelAnimationFrame(this.raf);
      this.anim = null;
      if (this.v) this.renderMap(this.v);
      if (r) this.showBreaches(r);
    }

    // 条約破りがあったラウンドは、動きの再生のあとにモーダルで知らせる(1ラウンド1回)
    showBreaches(r) {
      if (!r.breaches?.length || this.breachShown === r.round) return;
      this.breachShown = r.round;
      const e = this.esc;
      const myId = this.v.me?.nation;
      const nm = (id) => e(this.nation(id)?.title ?? '?');
      const items = r.breaches
        .map((b) => {
          const mine = b.a === myId || b.b === myId;
          const personal =
            b.kind === 'surprise'
              ? b.b === myId ? '<p class="gk-br-me">あなたが裏切られました</p>' : b.a === myId ? '<p class="gk-br-me">あなたの奇襲です</p>' : ''
              : mine ? '<p class="gk-br-me">あなたも相手も約束を破りました</p>' : '';
          return b.kind === 'surprise'
            ? `<div class="gk-br"><p class="gk-br-stamp">裏切り!</p><p><strong>${nm(b.a)}</strong>が<strong>${nm(b.b)}</strong>との条約を破って奇襲した</p><small>奇襲した側の攻撃に兵力+2</small>${personal}</div>`
            : `<div class="gk-br"><p class="gk-br-stamp is-mutual">共倒れ!</p><p><strong>${nm(b.a)}</strong>と<strong>${nm(b.b)}</strong>が互いに条約を破った</p><small>両国とも次の増援が2減る</small>${personal}</div>`;
        })
        .join('');
      this.closeModal();
      const wrap = document.createElement('div');
      wrap.className = 'mn-modal';
      wrap.innerHTML = `
        <div class="mn-modal-card gk-br-card" role="dialog" aria-modal="true" aria-label="条約破り">
          <span class="event-label">第${r.round}ラウンド・条約破り</span>
          ${items}
          <button class="btn btn-primary btn-block" data-close>閉じる</button>
        </div>`;
      wrap.addEventListener('click', (ev) => {
        if (ev.target === wrap || ev.target.closest('[data-close]')) this.closeModal();
      });
      this.onKey = (ev) => { if (ev.key === 'Escape') this.closeModal(); };
      document.addEventListener('keydown', this.onKey);
      document.body.appendChild(wrap);
      this.modal = wrap;
      wrap.querySelector('[data-close]').focus();
    }

    closeModal() {
      if (this.onKey) document.removeEventListener('keydown', this.onKey);
      this.onKey = null;
      this.modal?.remove();
      this.modal = null;
    }

    drawFx(t) {
      const fx = this.root.querySelector('#gk-fx');
      if (!fx || !this.anim) return;
      const v = this.v;
      const r = this.anim.r;
      const N = v.map.nodes;
      const color = (id) => (id ? this.nation(id)?.color : '#9aa39e') || '#9aa39e';
      const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3));
      const out = [];
      const battleAt = new Map(r.battles.map((b) => [b.node, b]));

      // 兵のコマ:行って(援軍と押し返された攻撃は)帰ってくる
      const kindOf = (m) => (m.kind === 'support' ? 'sup' : r.prevTerr[m.to].owner === m.nation ? 'move' : r.prevTerr[m.to].owner ? 'atk' : 'occ');
      if (this.anim.reduced && t < FX.SWAP) {
        for (const m of r.moves) {
          const a = N[m.from];
          const b = N[m.to];
          out.push(`<line class="fx-line fx-${kindOf(m)}" x1="${a.x}" y1="${a.y}" x2="${a.x + (b.x - a.x) * 0.75}" y2="${a.y + (b.y - a.y) * 0.75}" stroke="${color(m.nation)}"/>`);
          out.push(`<g class="fx-tok fx-${kindOf(m)}"><circle cx="${a.x + (b.x - a.x) * 0.75}" cy="${a.y + (b.y - a.y) * 0.75}" r="13" fill="${color(m.nation)}"/><text x="${a.x + (b.x - a.x) * 0.75}" y="${a.y + (b.y - a.y) * 0.75 + 5}">${m.n}</text></g>`);
        }
      }
      for (const m of this.anim.reduced ? [] : r.moves) {
        const a = N[m.from];
        const b = N[m.to];
        const b0 = battleAt.get(m.to);
        const goesBack = m.kind === 'support' || (b0 && b0.result === 'bounce');
        const reach = m.kind === 'support' ? 0.6 : 0.8;
        let k;
        if (t < FX.TRAVEL) k = ease(t / FX.TRAVEL) * reach;
        else if (t < FX.SWAP) k = reach;
        else if (goesBack && t < FX.SWAP + FX.BACK) k = reach * (1 - ease((t - FX.SWAP) / FX.BACK));
        else continue; // 到着して合流したか、戦いで散った
        const lost = b0 && t >= FX.TRAVEL + FX.BATTLE * 0.5 && !goesBack && b0.winner !== m.nation;
        const pt = this.isRail(m.from, m.to) ? railPoint(a, b, k) : { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        const { x, y } = pt;
        out.push(`<g class="fx-tok fx-${kindOf(m)}${lost ? ' is-lost' : ''}"><circle cx="${x}" cy="${y}" r="14" fill="${color(m.nation)}"/><text x="${x}" y="${y + 5}">${m.n}</text></g>`);
      }

      // 戦闘:広がる輪と結果
      if (t >= FX.TRAVEL * 0.85 && t < FX.SWAP + FX.FLASH) {
        const p = this.anim.reduced ? 0.5 : Math.min(1, (t - FX.TRAVEL * 0.85) / FX.BATTLE);
        for (const b of r.battles) {
          const n = N[b.node];
          const rad = 26 + p * 22;
          // 他国の領地への攻撃は赤い衝撃、無所属の土地の占領は控えめな輪
          out.push(`<circle class="fx-burst${b.owner ? '' : ' is-occ'}" cx="${n.x}" cy="${n.y}" r="${rad}" style="opacity:${1 - p * 0.7}"/>`);
          if (this.anim.reduced || t >= FX.TRAVEL + FX.BATTLE * 0.4) {
            out.push(`<text class="fx-result" x="${n.x}" y="${n.y - 34 < 44 ? n.y + 60 : n.y - 34}" fill="${b.result === 'taken' ? color(b.winner) : '#15211d'}">${resultText(b)}</text>`);
          }
        }
      }

      // 持ち主が変わった領地を光らせる
      if (t >= FX.SWAP) {
        const p = Math.min(1, (t - FX.SWAP) / FX.FLASH);
        v.terr.forEach((tt, i) => {
          if (r.prevTerr[i]?.owner === tt.owner || !tt.owner) return;
          out.push(`<circle class="fx-flash" cx="${N[i].x}" cy="${N[i].y}" r="${26 + p * 14}" stroke="${color(tt.owner)}" style="opacity:${1 - p}"/>`);
        });
      }

      out.push(`<g class="fx-banner"><rect x="${v.map.width / 2 - 110}" y="6" width="220" height="30" rx="15"/><text x="${v.map.width / 2}" y="27">第${r.round}ラウンドの結果(タップで飛ばす)</text></g>`);
      fx.innerHTML = out.join('');
    }

    buildAdj(v) {
      const adj = v.map.nodes.map(() => []);
      for (const [a, b] of [...v.map.edges, ...(v.map.rails || [])]) {
        adj[a].push(b);
        adj[b].push(a);
      }
      this.railSet = new Set((v.map.rails || []).flatMap(([a, b]) => [`${a}-${b}`, `${b}-${a}`]));
      this.adjFor = v.map;
      return adj;
    }
    isRail(a, b) {
      return this.railSet?.has(`${a}-${b}`);
    }
    // この命令で出せる兵の上限(鉄道は定員つき)
    cap(from, to) {
      const n = this.avail(from);
      return to !== null && this.isRail(from, to) ? Math.min(n, this.v.map.railCap) : n;
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
              <div class="kt-legend"><span>★ 拠点(1つにつき毎ラウンド兵+1)</span><span><i class="lg lg-rail"></i>鉄道(1回に${v.map.railCap}兵まで)</span><span>♛ 首都</span><span>数字は兵の数</span></div>
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
      svg.addEventListener('click', (e) => (this.anim ? this.endAnim() : choose(e.target)));
      svg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose(e.target);
        }
      });
      this.root.querySelector('#gk-orders').addEventListener('click', (e) => this.onOrders(e));
      this.root.querySelector('#gk-last').addEventListener('click', (e) => {
        if (e.target.closest('[data-replay]') && this.v.lastResult) {
          this.breachShown = null;
          this.startAnim(this.v.lastResult);
          this.renderMap(this.v);
          this.root.querySelector('#gk-map').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
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
      const animating = !!this.anim && performance.now() - this.anim.t0 < FX.SWAP;
      const terrNow = animating ? this.anim.r.prevTerr : v.terr;
      const parts = [
        `<defs>${v.nations.map((n) => `<marker id="ar-${n.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${n.color}"/></marker>`).join('')}
          <marker id="ar-move" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#15211d"/></marker></defs>`,
      ];
      for (const [a, b] of v.map.edges) parts.push(`<line class="e-walk" x1="${N[a].x}" y1="${N[a].y}" x2="${N[b].x}" y2="${N[b].y}"/>`);
      for (const [a, b] of v.map.rails || []) {
        const c = railCtrl(N[a], N[b]);
        const d = `M${N[a].x},${N[a].y} Q${c.x},${c.y} ${N[b].x},${N[b].y}`;
        parts.push(`<path class="e-rail" d="${d}"/><path class="e-rail-ties" d="${d}"/>`);
      }

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
        const occ = !own && !v.terr[o.to].owner;
        const cls = o.kind === 'support' ? 'ord-sup' : own ? 'ord-move' : occ ? 'ord-occ' : 'ord-atk';
        const marker = o.kind === 'support' ? `ar-${o.side}` : own ? 'ar-move' : `ar-${my.id}`;
        const stroke = o.kind === 'support' ? this.nation(o.side).color : own ? '#15211d' : my.color;
        arrows.push(`<line class="${cls}" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${stroke}" marker-end="url(#${marker})"/>`);
        arrows.push(`<text class="ord-n" x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 6}">${o.n}</text>`);
      }

      const targets = new Set(this.from !== null ? this.adj[this.from] : []);
      N.forEach((n, i) => {
        const t = terrNow[i];
        const owner = t.owner ? this.nation(t.owner) : null;
        const mine = owner && owner.id === my?.id;
        const isCap = owner && v.nations.some((x) => x.capital === i);
        const clickable = v.phase === 'orders' && my && (mine || (this.from !== null && targets.has(i)));
        parts.push(`
          <g class="terr${mine ? ' is-mine' : ''}${this.from === i ? ' is-from' : ''}${this.to === i ? ' is-to' : ''}${targets.has(i) ? ' is-target' : ''}" data-t="${i}"
            ${clickable ? `tabindex="0" role="button" aria-label="${this.esc(n.name)}"` : ''}>
            ${n.station ? `<rect class="t-station" x="${n.x - 29}" y="${n.y - 29}" width="58" height="58" rx="12"/>` : ''}
            <circle class="t-body" cx="${n.x}" cy="${n.y}" r="24" fill="${owner ? owner.color : '#d9d3c3'}"/>
            ${targets.has(i) ? `<circle class="t-ring" cx="${n.x}" cy="${n.y}" r="30"/>` : ''}
            ${this.from === i ? `<circle class="t-from" cx="${n.x}" cy="${n.y}" r="30"/>` : ''}
            <text class="t-n" x="${n.x}" y="${n.y + 7}">${t.troops}</text>
            ${n.star ? `<text class="t-star" x="${n.x + 20}" y="${n.y - 14}">★</text>` : ''}
            ${owner?.protected && !animating ? `<circle class="t-shield" cx="${n.x}" cy="${n.y}" r="28"/><text class="t-shield-icon" x="${n.x + 20}" y="${n.y + 24}">🛡</text>` : ''}
            ${v.nations.some((x) => x.capital === i) ? `<text class="t-cap" x="${n.x - 21}" y="${n.y - 14}">♛</text>` : ''}
            <text class="n-label" x="${n.x}" y="${n.y + 42}">${this.esc(n.name)}</text>
            <circle class="n-hit" cx="${n.x}" cy="${n.y}" r="32"/>
          </g>`);
        void isCap;
      });

      svg.innerHTML = parts.join('') + (animating ? '' : arrows.join('')) + '<g id="gk-fx"></g>';
      if (this.anim) this.drawFx(performance.now() - this.anim.t0);
    }

    pick(i) {
      const v = this.v;
      const my = this.my();
      if (v.phase !== 'orders' || !my) return;
      const mine = v.terr[i].owner === my.id;
      if (this.from !== null && this.adj[this.from].includes(i) && i !== this.from) {
        this.to = i;
        this.choice = this.options()[0] || null;
        this.count = Math.max(1, Math.min(this.cap(this.from, i), this.count));
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
      const guarded = owner && this.nation(owner).protected;
      const out = guarded ? [] : [{ kind: 'move', side: null, label: owner ? `${this.nation(owner).title}に攻め込む` : '占領しに行く' }];
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
        const instant = r.kind === 'instant';
        const val = {
          score: (n) => n.score,
          stars: (n) => n.stars,
          lands: (n) => n.lands,
          troops: (n) => n.troops,
        };
        // 決め方の順に並べ替える(即勝利のときは、ラインに届いた国を先に)
        const reached = new Set(r.reached || []);
        const rows = [...v.nations].sort((a, b) => {
          if (instant && reached.has(a.id) !== reached.has(b.id)) return reached.has(a.id) ? -1 : 1;
          for (const o of r.order) if (val[o.key](b) !== val[o.key](a)) return val[o.key](b) - val[o.key](a);
          return 0;
        });
        const cols = instant ? ['stars', 'lands', 'troops'] : ['score', 'stars', 'lands', 'troops'];
        const head = { score: '点', stars: '★', lands: '領地', troops: '兵' };
        const decisive = r.decidedBy;
        el.innerHTML = `
          <h2 class="kt-result">${r.winners.map((id) => e(this.nation(id).title)).join('・')}の勝ち</h2>
          <p class="kt-result-sub">${instant ? `★${v.winStars}つに届いて即勝利` : '全ラウンド終了'}${e(r.text || '')}</p>
          <table class="gk-table">
            <thead><tr><th>国</th>${cols.map((c) => `<th class="num${c === decisive ? ' is-key' : ''}">${head[c]}</th>`).join('')}${v.objectivesOn ? '<th>目標</th>' : ''}</tr></thead>
            <tbody>${rows.map((n) => `<tr class="${r.winners.includes(n.id) ? 'is-win' : ''}${instant && !reached.has(n.id) ? ' is-out' : ''}">
              <td><i class="dot" style="background:${n.color}"></i>${e(n.title)}${n.cpu ? '<small>CPU</small>' : ''}</td>
              ${cols.map((c) => `<td class="num${c === decisive ? ' is-key' : ''}">${val[c](n)}</td>`).join('')}
              ${v.objectivesOn ? `<td>${n.objective ? `<span class="${n.objective.done ? 'ok' : 'ng'}">${n.objective.done ? '達成+2' : '未達'}</span><small>${e(n.objective.text)}</small>` : '—'}</td>` : ''}</tr>`).join('')}</tbody>
          </table>
          <p class="kt-note">決め方:${instant ? '即勝利ラインに届いた国のうち、' : ''}${r.order.map((o) => e(o.label)).join(' → ')} の順に比べ、最後まで同じなら同率で勝ち。${instant ? '(ラインに届かなかった国は薄く表示)' : ''}</p>
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
        const max = this.cap(this.from, this.to);
        const rail = this.isRail(this.from, this.to);
        picker = `
          <p class="kt-pick"><strong>${e(this.tname(this.from))}</strong> ${rail ? '🚂' : '→'} <strong>${e(this.tname(this.to))}</strong></p>
          ${rail ? `<p class="kt-note">鉄道で移動します。1回の命令で運べる兵は${v.map.railCap}までです。</p>` : ''}
          <div class="gk-opts">${opts.map((o, i) => `<button class="btn btn-small${this.choice && o.kind === this.choice.kind && o.side === this.choice.side ? ' btn-primary' : ''}" data-opt="${i}">${e(o.label)}</button>`).join('')}</div>
          ${this.nation(v.terr[this.to].owner)?.protected ? `<p class="kt-note">${e(this.nation(v.terr[this.to].owner).title)}は蜂起したばかりで、このラウンドは攻め込めません(援軍は出せます)。</p>` : ''}
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
            const occ = !own && !v.terr[o.to].owner;
            const what = o.kind === 'support' ? `${this.nation(o.side).title}に援軍` : own ? '移動' : occ ? '占領' : `${this.nation(v.terr[o.to].owner).title}を攻撃`;
            const k = o.kind === 'support' ? 'sup' : own ? 'move' : occ ? 'occ' : 'atk';
            return `<li><span>${e(this.tname(o.from))} ${this.isRail(o.from, o.to) ? '🚂' : '→'} ${e(this.tname(o.to))}</span><span class="gk-k gk-k-${k}">${e(what)} ${o.n}</span><button class="x" data-del="${i}" aria-label="取り消す">×</button></li>`;
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
        const max = this.cap(this.from, this.to);
        this.count = b.dataset.cnt === 'max' ? max : Math.max(1, Math.min(max, this.count + Number(b.dataset.cnt)));
      }
      if (b.dataset.act === 'add') {
        const n = Math.min(this.count, this.cap(this.from, this.to));
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
          <li><i class="dot" style="background:${n.color}"></i><span class="player-name">${e(n.title)}${n.cpu ? '<small class="gk-leader">CPU</small>' : ''}</span>
            <span class="kt-tickets">★${n.stars}・領地${n.lands}・兵${n.troops}${n.broken ? `・破約${n.broken}` : ''}${n.protected ? '・🛡守護中' : ''}</span>
            ${v.phase === 'orders' ? (n.ready ? '<span class="tag tag-done">確定</span>' : '<span class="tag">考え中</span>') : ''}</li>`).join('')}</ul>
        <details class="gk-rules">
          <summary>勝敗の決め方</summary>
          <ul>
            <li><strong>即勝利</strong>:ラウンドの解決後に★が${v.winStars}つ以上ある国があれば、その時点で終了。同じラウンドに複数の国が届いたら、${v.rules.instant.map((x) => e(x)).join(' → ')}の順に比べて多い国の勝ち。</li>
            <li><strong>最終ラウンド後</strong>:全部の国を${v.rules.final.map((x) => e(x)).join(' → ')}の順に比べて多い国の勝ち。</li>
            <li>最後まで同じなら同率で勝ち。★や領地は、そのラウンドの戦闘と増援が終わったあとの数で数えます。</li>
            <li><strong>再起</strong>:領地をすべて失った国は、次のラウンドの始めにトップの国の手薄な場所で反乱軍(兵4+ラウンド数の半分、隣の領地も1つ)として蜂起し、そのラウンドは攻撃を受けません(🛡)。</li>
          </ul>
        </details>
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
          const res =
            b.result === 'taken'
              ? `${e(nm(b.winner))}が${b.owner ? '奪取' : '占領'}`
              : b.result === 'held'
                ? b.owner ? `${e(nm(b.owner))}が守った` : '占領失敗(守備兵が残った)'
                : '押し返し合い';
          return `<li><strong>${e(this.tname(b.node))}</strong>:${sides} → <em>${res}</em></li>`;
        })
        .join('');
      el.innerHTML = `
        <div class="gk-last-head"><h3 class="kb-sub">第${r.round}ラウンドの結果</h3><button class="btn btn-small" data-replay>動きをもう一度見る</button></div>
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
