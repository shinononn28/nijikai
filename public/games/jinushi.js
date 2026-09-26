(() => {
  'use strict';

  const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  // マス番号 → 8×8の外周の(列,行)。0番(スタート)は右下で、反時計回り
  function cellPos(i) {
    if (i <= 7) return [7 - i, 7];
    if (i <= 14) return [0, 7 - (i - 7)];
    if (i <= 21) return [i - 14, 0];
    return [7, i - 21];
  }

  class JinushiClient {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.esc = api.esc;
      this.key = null;
      this.anim = null;
      this.animKey = null;
      this.draft = { to: null, give: [], get: [], giveMoney: 0, getMoney: 0 };
      this.onClickBound = (e) => this.onClick(e);
      root.addEventListener('click', this.onClickBound);
      root.addEventListener('change', (e) => this.onChange(e));
      root.addEventListener('input', (e) => { if (e.target.type === 'number') this.onChange(e); });
      root.addEventListener('focusout', () => setTimeout(() => { if (this.tradeDirty && this.v) { this.tradeDirty = false; this.renderTrade(this.v, true); } }, 0));
    }

    destroy() {
      this.root.removeEventListener('click', this.onClickBound);
      clearInterval(this.animTimer);
    }

    update(v) {
      this.v = v;
      if (!this.built) this.build();
      // サイコロを振ったら、コマをマスごとに進める
      const r = v.lastRoll;
      const k = r ? `${r.turn}:${r.by}` : null;
      if (k && k !== this.animKey) {
        this.animKey = k;
        if (this.built && !matchMedia('(prefers-reduced-motion: reduce)').matches) this.startAnim(r);
      }
      this.refresh(v);
    }

    startAnim(r) {
      const n = r.d[0] + r.d[1];
      const path = Array.from({ length: n + 1 }, (_, i) => (r.from + i) % 28);
      this.anim = { pid: r.by, path, step: 0 };
      clearInterval(this.animTimer);
      this.animTimer = setInterval(() => {
        this.anim.step++;
        if (this.anim.step >= this.anim.path.length) {
          clearInterval(this.animTimer);
          this.anim = null;
        }
        this.renderBoard(this.v);
      }, 140);
    }

    name(id) {
      return this.v.players.find((p) => p.id === id)?.name ?? '?';
    }

    build() {
      this.built = true;
      this.root.innerHTML = `
        <div class="kb jn">
          <div class="kb-head">
            <span class="kb-round" id="jn-round"></span>
            <span class="kb-phase" id="jn-phase"></span>
            <span class="timer" id="jn-timer"></span>
          </div>
          <div class="jn-layout">
            <div class="jn-board" id="jn-board"><div class="jn-cells" id="jn-cells"></div><div class="jn-center" id="jn-center"></div></div>
            <aside class="kt-side">
              <section class="kt-panel" id="jn-players"></section>
              <section class="kt-panel" id="jn-mine"></section>
              <section class="kt-panel" id="jn-trade"></section>
            </aside>
          </div>
        </div>`;
    }

    refresh(v) {
      const e = this.esc;
      this.root.querySelector('#jn-round').textContent = v.phase === 'ended' ? '終了' : `ターン ${Math.min(v.turnCount + 1, v.maxTurns)} / ${v.maxTurns}`;
      this.root.querySelector('#jn-phase').textContent = v.phase === 'ended' ? '' : `${v.turnName}の番`;
      const tm = this.root.querySelector('#jn-timer');
      if (v.endsAt) tm.dataset.endsAt = v.endsAt;
      else { delete tm.dataset.endsAt; tm.textContent = ''; }
      this.renderBoard(v);
      this.renderCenter(v);
      this.renderPlayers(v);
      this.renderMine(v);
      this.renderTrade(v);
      void e;
    }

    // ---------- 盤 ----------
    renderBoard(v) {
      const e = this.esc;
      const me = this.api.myId();
      const tokenAt = {};
      for (const p of v.players) {
        if (p.out) continue;
        let pos = p.pos;
        if (this.anim && this.anim.pid === p.id) pos = this.anim.path[Math.min(this.anim.step, this.anim.path.length - 1)];
        (tokenAt[pos] ||= []).push(p);
      }
      const cells = v.spaces
        .map((s) => {
          const [c, r] = cellPos(s.i);
          const owner = s.owner ? v.players.find((p) => p.id === s.owner) : null;
          const tokens = (tokenAt[s.i] || []).map((p) => `<i class="jn-tok${p.id === me ? ' is-me' : ''}" style="background:${p.color}" title="${e(p.name)}"></i>`).join('');
          const icon = { start: '🏁', chance: '❓', park: '🌳', rest: '☕', tax: '🏛' }[s.t] || '';
          return `
            <div class="jn-cell jn-${s.t}${owner ? ' is-owned' : ''}${s.full ? ' is-full' : ''}" style="grid-column:${c + 1};grid-row:${r + 1};${owner ? `--oc:${owner.color}` : ''}" data-space="${s.i}">
              ${s.group ? `<span class="jn-band" style="background:${s.group.color}"></span>` : ''}
              <span class="jn-name">${icon}${e(s.name)}</span>
              ${s.t === 'prop' ? `<span class="jn-price">${owner ? `通行料${s.rent}` : `${s.price}`}</span>` : ''}
              ${s.houses ? `<span class="jn-houses">${'🏠'.repeat(s.houses)}</span>` : ''}
              <span class="jn-toks">${tokens}</span>
            </div>`;
        })
        .join('');
      this.root.querySelector('#jn-cells').innerHTML = cells;
    }

    // 中央(サイコロとボタン)は、関係する情報が変わったときだけ描き直す(押そうとしたボタンが消えないように)
    renderCenter(v) {
      const html = this.center(v);
      if (html === this.centerHtml) return;
      this.centerHtml = html;
      this.root.querySelector('#jn-center').innerHTML = html;
    }

    center(v) {
      const e = this.esc;
      const me = this.api.myId();
      const myTurn = v.turn === me;
      const r = v.lastRoll;
      const dice = r ? `<div class="jn-dice"><span>${DICE[r.d[0]]}</span><span>${DICE[r.d[1]]}</span></div><p class="jn-rolled">${e(this.name(r.by))}:${r.d[0] + r.d[1]}</p>` : '<div class="jn-dice"><span>⚀</span><span>⚀</span></div>';
      let act = '';
      if (v.phase === 'ended') {
        const rank = [...v.players].sort((a, b) => b.worth - a.worth);
        act = `<h2 class="kt-result">${e(rank[0].name)}の勝ち</h2>
          <ol class="jn-rank">${rank.map((p, i) => `<li><b>${i + 1}位</b> ${e(p.name)} <span>${p.worth}</span></li>`).join('')}</ol>
          ${this.api.isHost() ? '<button class="btn btn-primary" data-act="finish">ロビーに戻る</button>' : ''}`;
      } else if (myTurn && v.phase === 'roll') {
        act = '<button class="btn btn-primary jn-big" data-act="roll">🎲 サイコロを振る</button>';
      } else if (myTurn && v.phase === 'buy') {
        const s = v.spaces[v.pending.space];
        act = `<p class="jn-q">「${e(s.name)}」を${s.price}で買う?</p>
          <div class="jn-row"><button class="btn btn-primary" data-act="buy">買う</button><button class="btn" data-act="pass">買わない</button></div>`;
      } else if (myTurn && v.phase === 'act') {
        act = `<p class="jn-q">建物を建てたり、取引を持ちかけたりできます</p><button class="btn btn-primary" data-act="end">ターンを終える</button>`;
      } else {
        act = `<p class="jn-q">${e(v.turnName)}の番です</p>`;
      }
      const chance = v.lastChance && v.lastChance.turn === v.turnCount ? `<p class="jn-chance">❓ ${e(v.lastChance.text)}</p>` : '';
      return `${dice}${chance}<div class="jn-act">${act}</div>`;
    }

    // ---------- プレイヤー ----------
    renderPlayers(v) {
      const e = this.esc;
      this.root.querySelector('#jn-players').innerHTML = `
        <h3 class="kb-sub">プレイヤー</h3>
        <ul class="kt-team">${v.players.map((p) => `
          <li class="${p.out ? 'is-away' : ''}"><i class="dot" style="background:${p.color}"></i>
            <span class="player-name">${e(p.name)}${p.id === v.turn ? ' 🎲' : ''}</span>
            <span class="kt-tickets">所持金${p.money}・総資産${p.worth}${p.out ? '・破産' : ''}</span></li>`).join('')}</ul>`;
    }

    // ---------- 自分の土地(建てる・強制買収) ----------
    renderMine(v) {
      const e = this.esc;
      const me = v.players.find((p) => p.id === this.api.myId());
      const el = this.root.querySelector('#jn-mine');
      if (!me) {
        el.innerHTML = '<p class="kt-note">観戦中です。</p>';
        return;
      }
      const myTurn = v.turn === me.id && v.phase === 'act';
      const rows = me.props
        .map((i) => {
          const s = v.spaces[i];
          const same = v.spaces.filter((x) => x.g === s.g);
          const minH = Math.min(...same.map((x) => x.houses));
          const can = myTurn && s.full && s.houses < 3 && s.houses === minH && me.money >= s.group.house;
          return `<li><i class="dot" style="background:${s.group.color}"></i><span>${e(s.name)}${s.houses ? ` ${'🏠'.repeat(s.houses)}` : ''}</span>
            <span class="kt-tickets">通行料${s.rent}</span>
            ${s.full ? `<button class="btn btn-small" data-build="${i}" ${can ? '' : 'disabled'}>建てる(${s.group.house})</button>` : ''}</li>`;
        })
        .join('');
      let buyout = '';
      if (v.buyoutOn) {
        const targets = v.spaces.filter((s) => s.owner && s.owner !== me.id && !v.spaces.some((x) => x.g === s.g && x.houses > 0));
        buyout = `
          <h3 class="kb-sub">強制買収(残り${me.buyoutLeft}回・地価の2倍)</h3>
          ${me.buyoutLeft && myTurn
            ? `<div class="jn-buyout">${targets.map((s) => `<button class="btn btn-small" data-buyout="${s.i}" ${me.money >= s.price * 2 ? '' : 'disabled'}>${e(s.name)}(${e(this.name(s.owner))}・${s.price * 2})</button>`).join('') || '<span class="kt-note">対象がありません</span>'}</div>`
            : '<p class="kt-note">自分の手番の、サイコロを振ったあとに使えます。建物のある色の土地は買収できません。</p>'}`;
      }
      el.innerHTML = `
        <h3 class="kb-sub">あなたの土地</h3>
        ${rows ? `<ul class="jn-props">${rows}</ul>` : '<p class="kt-note">まだ土地がありません。</p>'}
        <p class="kt-note">同じ色をすべて持つと通行料が2倍になり、自分の手番に建物を建てられます(同じ色には均等に、1マス3軒まで)。</p>
        ${buyout}`;
    }

    // ---------- 取引 ----------
    renderTrade(v, force = false) {
      const e = this.esc;
      const me = this.api.myId();
      const el = this.root.querySelector('#jn-trade');
      // 入力中は描き直さない。取引に関係する情報が変わったときだけ描き直す
      const sig = JSON.stringify([v.trades, v.players.map((p) => [p.id, p.props, p.out]), v.spaces.map((x) => x.houses), v.phase === 'ended']);
      if (!force && (sig === this.tradeSig || el.contains(document.activeElement))) {
        if (sig !== this.tradeSig) this.tradeDirty = true;
        return;
      }
      this.tradeSig = sig;
      if (!v.players.some((p) => p.id === me) || v.phase === 'ended') {
        el.innerHTML = '';
        return;
      }
      const incoming = v.trades.filter((t) => t.to === me);
      const outgoing = v.trades.filter((t) => t.from === me);
      const side = (s) => [...s.props.map((i) => v.spaces[i].name), s.money ? `${s.money}` : null].filter(Boolean).map(e).join('+') || 'なし';
      const others = v.players.filter((p) => p.id !== me && !p.out);
      const d = this.draft;
      if (!d.to || !others.some((p) => p.id === d.to)) d.to = others[0]?.id || null;
      const tradable = (pid) => v.players.find((p) => p.id === pid).props.filter((i) => !v.spaces.some((x) => x.g === v.spaces[i].g && x.houses > 0));
      const list = (pid, key) =>
        tradable(pid)
          .map((i) => `<label class="jn-check"><input type="checkbox" data-draft="${key}" value="${i}" ${d[key].includes(i) ? 'checked' : ''}><i class="dot" style="background:${v.spaces[i].group.color}"></i>${e(v.spaces[i].name)}</label>`)
          .join('') || '<span class="kt-note">なし</span>';
      el.innerHTML = `
        <h3 class="kb-sub">取引</h3>
        ${incoming.map((t) => `
          <div class="jn-offer is-in"><p><b>${e(this.name(t.from))}</b>から:あなたが「${side(t.get)}」を渡して、「${side(t.give)}」をもらう</p>
            <div class="jn-row"><button class="btn btn-small btn-primary" data-respond="${t.id}" data-yes="1">受ける</button><button class="btn btn-small" data-respond="${t.id}" data-yes="0">断る</button></div></div>`).join('')}
        ${outgoing.map((t) => `
          <div class="jn-offer"><p><b>${e(this.name(t.to))}</b>へ提案中:「${side(t.give)}」を渡して「${side(t.get)}」をもらう</p>
            <button class="btn btn-small btn-quiet" data-withdraw="${t.id}">取り下げ</button></div>`).join('')}
        ${others.length ? `
          <details class="jn-compose" ${this.composeOpen ? 'open' : ''}>
            <summary>取引を持ちかける</summary>
            <label class="field field-inline"><span>相手</span><select data-draft="to">${others.map((p) => `<option value="${e(p.id)}" ${p.id === d.to ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></label>
            <div class="jn-cols">
              <div><p class="jn-colh">渡すもの</p>${list(me, 'give')}<label class="jn-money">お金 <input type="number" min="0" step="10" data-draft="giveMoney" value="${d.giveMoney || ''}"></label></div>
              <div><p class="jn-colh">もらうもの</p>${d.to ? list(d.to, 'get') : ''}<label class="jn-money">お金 <input type="number" min="0" step="10" data-draft="getMoney" value="${d.getMoney || ''}"></label></div>
            </div>
            <button class="btn btn-primary btn-block" data-act="propose">この条件で持ちかける</button>
            <p class="kt-note">いつでも提案できます(自分の手番でなくても)。建物のある色の土地は取引できません。</p>
          </details>` : ''}`;
      el.querySelector('.jn-compose')?.addEventListener('toggle', (ev) => { this.composeOpen = ev.target.open; });
    }

    onChange(ev) {
      const t = ev.target;
      const k = t.dataset.draft;
      if (!k) return;
      const d = this.draft;
      if (k === 'to') {
        d.to = t.value;
        d.get = [];
        this.renderTrade(this.v, true);
      } else if (k === 'give' || k === 'get') {
        const i = Number(t.value);
        d[k] = t.checked ? [...new Set([...d[k], i])] : d[k].filter((x) => x !== i);
      } else {
        d[k] = Math.max(0, Math.floor(Number(t.value) || 0));
      }
    }

    onClick(ev) {
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      const d = this.draft;
      if (t.dataset.build) return this.api.send('build', { space: Number(t.dataset.build) });
      if (t.dataset.buyout) {
        if (confirm('強制買収しますか?(1ゲームに1回だけ)')) this.api.send('buyout', { space: Number(t.dataset.buyout) });
        return;
      }
      if (t.dataset.respond) return this.api.send('respond', { id: t.dataset.respond, yes: t.dataset.yes === '1' });
      if (t.dataset.withdraw) return this.api.send('withdraw', { id: t.dataset.withdraw });
      switch (t.dataset.act) {
        case 'roll':
          this.api.send('roll');
          break;
        case 'buy':
          this.api.send('buy', { yes: true });
          break;
        case 'pass':
          this.api.send('buy', { yes: false });
          break;
        case 'end':
          this.api.send('end');
          break;
        case 'propose':
          this.api.send('propose', { to: d.to, give: { props: d.give, money: d.giveMoney }, get: { props: d.get, money: d.getMoney } });
          this.draft = { to: d.to, give: [], get: [], giveMoney: 0, getMoney: 0 };
          this.renderTrade(this.v, true);
          break;
        case 'finish':
          this.api.send('finish');
          break;
        default:
      }
    }
  }

  window.GameClients = window.GameClients || {};
  window.GameClients.jinushi = { create: (root, api) => new JinushiClient(root, api) };
})();
