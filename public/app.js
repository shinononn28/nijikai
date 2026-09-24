(() => {
  'use strict';

  // ---------- 小道具 ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 使えなくても動く */ } },
  };

  // 日本語入力の確定Enterでは反応しない Enter ハンドラ
  function onEnter(input, fn) {
    let composing = false;
    let compEndAt = 0;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; compEndAt = Date.now(); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.isComposing || composing || e.keyCode === 229 || Date.now() - compEndAt < 60) return;
      e.preventDefault();
      fn();
    });
  }

  let clientId = store.get('nijikai.clientId');
  if (!clientId || !/^[a-zA-Z0-9-]{8,64}$/.test(clientId)) {
    clientId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    store.set('nijikai.clientId', clientId);
  }

  const state = {
    screen: 'home',
    code: null,
    room: null,
    view: null,
    chat: [],
    timeOffset: 0,
    tab: 'game',
    unread: 0,
    notice: '',
    channels: [{ id: 'all', label: '全体' }],
    chatView: 'talk',
    sendChannel: 'all',
  };
  let game = null; // { id, instance }
  let pendingEvents = []; // ゲーム画面ができる前に届いたイベント

  const socket = io();
  const app = $('#app');

  const me = () => clientId;
  const isHost = () => state.room?.hostId === clientId;
  const send = (event, data = {}) =>
    new Promise((resolve) => socket.emit(event, data, (res) => resolve(res || { ok: false })));

  // ---------- 時間表示 ----------
  const remaining = (endsAt) => Math.max(0, endsAt - (Date.now() + state.timeOffset));
  const fmt = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  setInterval(() => {
    document.querySelectorAll('[data-ends-at]').forEach((el) => {
      const ms = remaining(Number(el.dataset.endsAt));
      el.textContent = fmt(ms);
      el.classList.toggle('is-low', ms <= 10000);
    });
  }, 250);

  // ---------- ホーム ----------
  function inviteCode() {
    const c = new URLSearchParams(location.search).get('room');
    return c ? c.trim().toUpperCase() : null;
  }

  function renderHome(error = '') {
    state.screen = 'home';
    destroyGame();
    const invited = inviteCode();
    const name = store.get('nijikai.name') || '';
    app.innerHTML = `
      <main class="home">
        <div class="home-card">
          <h1 class="logo">二次会卓</h1>
          <p class="lead">セッションのあとに、もう一卓。ブラウザだけで遊べるパーティゲームとチャットの部屋です。</p>
          ${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
          <label class="field">
            <span>表示名</span>
            <input id="home-name" maxlength="16" value="${esc(name)}" placeholder="卓で呼ばれている名前" autocomplete="nickname">
          </label>
          ${invited ? `
            <p class="invite">部屋 <strong>${esc(invited)}</strong> に招待されています</p>
            <button class="btn btn-primary btn-block" id="home-join-invite">この部屋に入る</button>
            <button class="btn btn-quiet btn-block" id="home-clear-invite">別の部屋を作る・探す</button>
          ` : `
            <button class="btn btn-primary btn-block" id="home-create">部屋を作る</button>
            <div class="or"><span>コードで参加</span></div>
            <div class="join-row">
              <input id="home-code" maxlength="5" placeholder="例:K7QXM" autocomplete="off" autocapitalize="characters">
              <button class="btn" id="home-join">参加</button>
            </div>
          `}
          <p class="error" id="home-error" role="alert">${esc(error)}</p>
        </div>
      </main>`;
    state.notice = '';

    const nameInput = $('#home-name');
    const getName = () => {
      const n = nameInput.value.trim();
      if (!n) {
        $('#home-error').textContent = '表示名を入れてください';
        nameInput.focus();
        return null;
      }
      store.set('nijikai.name', n);
      return n;
    };

    if (invited) {
      $('#home-join-invite').onclick = () => { const n = getName(); if (n) joinRoom(invited, n); };
      $('#home-clear-invite').onclick = () => { history.replaceState(null, '', '/'); renderHome(); };
      onEnter(nameInput, () => $('#home-join-invite').click());
    } else {
      $('#home-create').onclick = async () => {
        const n = getName();
        if (!n) return;
        const res = await send('room:create', { name: n, clientId });
        res.ok ? enterRoom(res.code) : ($('#home-error').textContent = res.error || '部屋を作れませんでした');
      };
      const codeInput = $('#home-code');
      $('#home-join').onclick = () => {
        const n = getName();
        const c = codeInput.value.trim().toUpperCase();
        if (!n) return;
        if (!c) { $('#home-error').textContent = '部屋コードを入れてください'; return codeInput.focus(); }
        joinRoom(c, n);
      };
      onEnter(codeInput, () => $('#home-join').click());
    }
    if (!name) nameInput.focus();
  }

  async function joinRoom(code, name) {
    const res = await send('room:join', { code, name, clientId });
    if (res.ok) enterRoom(res.code);
    else {
      history.replaceState(null, '', '/');
      renderHome(res.error || '参加できませんでした');
    }
  }

  // ---------- 部屋 ----------
  function enterRoom(code) {
    state.code = code;
    history.replaceState(null, '', `/?room=${code}`);
    if (state.screen !== 'room') renderRoomShell();
  }

  function renderRoomShell() {
    state.screen = 'room';
    state.tab = 'game';
    state.unread = 0;
    state.chatView = 'talk';
    app.innerHTML = `
      <div class="room" data-tab="game">
        <header class="topbar">
          <span class="brand">二次会卓</span>
          <button class="room-code" id="copy-invite" title="招待リンクをコピー">
            <span class="room-code-label">部屋</span>
            <span class="room-code-value">${esc(state.code)}</span>
            <span class="room-code-action" id="copy-label">招待リンクをコピー</span>
          </button>
          <div class="topbar-actions" id="topbar-actions"></div>
        </header>
        <div class="room-body">
          <section class="main" id="main" aria-live="polite"></section>
          <aside class="chat" id="chat" aria-label="チャット">
            <div class="chat-views" role="tablist">
              <button type="button" data-view="talk" class="is-on" role="tab">チャット</button>
              <button type="button" data-view="log" role="tab">ログ<span class="view-dot" id="log-dot" hidden></span></button>
            </div>
            <ol class="chat-log" id="chat-log"></ol>
            <ol class="chat-log sys-log" id="sys-log" hidden></ol>
            <div class="chat-channels" id="chat-channels" hidden></div>
            <div class="chat-form">
              <input id="chat-input" maxlength="300" placeholder="メッセージを送る" autocomplete="off">
              <button class="btn btn-primary" id="chat-send">送信</button>
            </div>
          </aside>
        </div>
        <nav class="tabs">
          <button data-tab="game" class="is-active">ゲーム</button>
          <button data-tab="chat">チャット<span class="badge" id="unread" hidden></span></button>
        </nav>
      </div>`;

    $('#copy-invite').onclick = async () => {
      const url = `${location.origin}/?room=${state.code}`;
      try {
        await navigator.clipboard.writeText(url);
        $('#copy-label').textContent = 'コピーしました';
      } catch {
        prompt('このリンクを送ってください', url);
      }
      setTimeout(() => { const l = $('#copy-label'); if (l) l.textContent = '招待リンクをコピー'; }, 2000);
    };

    const input = $('#chat-input');
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const res = await send('chat:send', { text, channel: state.sendChannel });
      if (!res.ok && !input.value) input.value = text;
    };
    onEnter(input, submit);
    $('#chat-send').onclick = submit;

    document.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => setTab(b.dataset.tab);
    });

    $('.chat-views').onclick = (ev) => {
      const b = ev.target.closest('[data-view]');
      if (b) setChatView(b.dataset.view);
    };
    renderChatLog();
    renderChannels();
    renderTopbar();
    renderMain();
  }

  // チャット欄は「チャット(発言)」と「ログ(入退室やゲームの進行)」に分ける
  function setChatView(view) {
    state.chatView = view;
    document.querySelectorAll('.chat-views [data-view]').forEach((b) => b.classList.toggle('is-on', b.dataset.view === view));
    $('#chat-log').hidden = view !== 'talk';
    $('#sys-log').hidden = view !== 'log';
    $('.chat-form').hidden = view !== 'talk';
    const ch = $('#chat-channels');
    if (ch) ch.hidden = view !== 'talk' || state.channels.length < 2;
    if (view === 'log') $('#log-dot').hidden = true;
    scrollChat(true);
  }

  // ゲームによっては「作戦」などのチーム用チャンネルが増える
  function renderChannels() {
    const el = $('#chat-channels');
    if (!el) return;
    if (!state.channels.some((c) => c.id === state.sendChannel)) state.sendChannel = 'all';
    el.hidden = state.channels.length < 2 || state.chatView === 'log';
    el.innerHTML = `<span>送信先</span>${state.channels
      .map((c) => `<button type="button" class="ch-btn ch-${esc(c.id.split(':')[0])}${c.id === state.sendChannel ? ' is-on' : ''}" data-ch="${esc(c.id)}">${esc(c.label)}</button>`)
      .join('')}`;
    el.onclick = (ev) => {
      const b = ev.target.closest('[data-ch]');
      if (!b) return;
      state.sendChannel = b.dataset.ch;
      renderChannels();
      $('#chat-input')?.focus();
    };
    const input = $('#chat-input');
    if (input) {
      const label = state.channels.find((c) => c.id === state.sendChannel)?.label;
      input.placeholder = state.sendChannel === 'all' ? 'メッセージを送る' : `${label}に送る(チームだけに見える)`;
      input.classList.toggle('is-team', state.sendChannel !== 'all');
    }
  }

  function setTab(tab) {
    state.tab = tab;
    const room = $('.room');
    if (!room) return;
    room.dataset.tab = tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    if (tab === 'chat') {
      state.unread = 0;
      updateUnread();
      scrollChat(true);
      if (!matchMedia('(pointer: coarse)').matches) $('#chat-input')?.focus();
    }
  }

  function updateUnread() {
    const b = $('#unread');
    if (!b) return;
    b.hidden = state.unread === 0;
    b.textContent = state.unread > 99 ? '99+' : String(state.unread);
  }

  function renderTopbar() {
    const el = $('#topbar-actions');
    if (!el) return;
    el.innerHTML = `
      ${state.room?.playing && isHost() ? '<button class="btn btn-quiet btn-small" id="abort-game">ゲームを中断</button>' : ''}
      <button class="btn btn-quiet btn-small" id="leave-room">退室</button>`;
    $('#leave-room').onclick = async () => {
      if (!confirm('部屋から退室しますか?')) return;
      await send('room:leave');
      state.code = null;
      state.room = null;
      state.view = null;
      state.chat = [];
      history.replaceState(null, '', '/');
      renderHome();
    };
    const abort = $('#abort-game');
    if (abort) abort.onclick = () => { if (confirm('ゲームを中断してロビーに戻りますか?')) send('game:abort'); };
  }

  // ---------- チャット ----------
  const time = (ts) => new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  function chatItem(m) {
    if (m.type === 'system') return `<li class="msg msg-system"><span>${esc(m.text)}</span></li>`;
    const ch = m.channel && m.channel !== 'all' ? ` msg-ch msg-ch-${esc(m.channel.split(':')[0])}` : '';
    const chTag = ch ? `<span class="tag tag-ch">${esc(m.channelLabel)}</span>` : '';
    if (m.type === 'tip') {
      return `<li class="msg msg-tip${ch}"><div class="msg-meta">${chTag}<time>${time(m.ts)}</time></div><div class="msg-text">${esc(m.text)}</div></li>`;
    }
    const mine = m.playerId === clientId;
    return `
      <li class="msg${mine ? ' msg-mine' : ''}${ch}">
        <div class="msg-meta">${chTag}<span class="msg-name">${esc(m.name)}</span>${m.cpu ? '<span class="tag">CPU</span>' : ''}<time>${time(m.ts)}</time></div>
        <div class="msg-text">${esc(m.text)}</div>
      </li>`;
  }

  function nearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
  const isLog = (m) => m.type === 'system';
  function scrollChat(force = false) {
    for (const log of [$('#chat-log'), $('#sys-log')]) {
      if (log && (force || log.dataset.stick === '1')) log.scrollTop = log.scrollHeight;
    }
  }

  function renderChatLog() {
    const talk = $('#chat-log');
    const sys = $('#sys-log');
    if (!talk || !sys) return;
    const talks = state.chat.filter((m) => !isLog(m));
    const logs = state.chat.filter(isLog);
    talk.innerHTML = talks.length
      ? talks.map(chatItem).join('')
      : '<li class="msg msg-system"><span>ここがチャット欄です。待っているあいだも話せます。入退室やゲームの進行は「ログ」にあります。</span></li>';
    sys.innerHTML = logs.map(chatItem).join('');
    for (const log of [talk, sys]) {
      log.dataset.stick = '1';
      log.onscroll = () => { log.dataset.stick = nearBottom(log) ? '1' : '0'; };
    }
    scrollChat(true);
  }

  function appendChat(m) {
    state.chat.push(m);
    if (state.chat.length > 300) state.chat.shift();
    const log = isLog(m) ? $('#sys-log') : $('#chat-log');
    if (!log) return;
    if (!isLog(m) && state.chat.filter((x) => !isLog(x)).length === 1) return renderChatLog();
    log.insertAdjacentHTML('beforeend', chatItem(m));
    while (log.children.length > 300) log.firstElementChild.remove();
    scrollChat(m.playerId === clientId);
    if (isLog(m) && state.chatView === 'talk') $('#log-dot').hidden = false;
    const mobile = matchMedia('(max-width: 760px)').matches;
    if (mobile && state.tab !== 'chat' && m.type !== 'system' && m.playerId !== clientId) {
      state.unread++;
      updateUnread();
    }
  }

  // ---------- メイン(ロビー or ゲーム) ----------
  function destroyGame() {
    game?.instance?.destroy?.();
    game = null;
  }

  function renderMain() {
    const main = $('#main');
    if (!main || !state.room) return;
    const v = state.view;
    if (v) {
      const client = window.GameClients?.[v.gameId];
      if (!client) {
        destroyGame();
        main.innerHTML = '<p class="empty">ゲーム画面を読み込んでいます…</p>';
        loadGameClient(v.gameId).then((err) => {
          if (!err) return renderMain();
          if (state.view?.gameId === v.gameId) main.innerHTML = `<p class="empty">${esc(err)}</p>`;
        });
        return;
      }
      if (!game || game.id !== v.gameId) {
        destroyGame();
        main.innerHTML = '';
        game = { id: v.gameId, instance: client.create(main, gameApi) };
        // 画面ができる前に届いたイベントを流し込む
        const queued = pendingEvents.filter((ev) => ev.gameId === v.gameId);
        pendingEvents = [];
        for (const ev of queued) game.instance.onEvent?.(ev.type, ev.data);
      }
      game.instance.update(v);
      return;
    }
    destroyGame();
    renderLobby(main);
  }

  // ゲームの画面ファイルを必要になったときに読み込む(失敗したら理由を返す)
  const loading = {};
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(src));
      document.head.appendChild(el);
    });
  }
  function loadGameClient(id) {
    if (!loading[id]) {
      const files = state.room?.catalog.find((g) => g.id === id)?.client || [`${id}.js`];
      const ver = state.room?.build || Date.now();
      loading[id] = (async () => {
        try {
          for (const f of files) await loadScript(`/games/${f}?v=${ver}`);
        } catch (e) {
          delete loading[id];
          return `ゲーム画面のファイル(${e.message.split('?')[0]})を読み込めませんでした。リポジトリの public/games/ にファイルがあるか確認してください。`;
        }
        if (!window.GameClients?.[id]) {
          delete loading[id];
          return 'ゲーム画面のファイルは読み込めましたが、中でエラーが起きました。ブラウザの開発者ツールのコンソールを確認してください。';
        }
        return null;
      })();
    }
    return loading[id];
  }

  const gameApi = {
    send: (type, payload) => send('game:action', { type, payload }),
    myId: me,
    isHost,
    remaining,
    esc,
    onEnter,
    room: () => state.room,
  };

  function renderLobby(main) {
    const r = state.room;
    const selected = r.catalog.find((g) => g.id === r.selectedGame);
    const online = r.players.filter((p) => p.connected).length;
    const cpu = selected.cpu ? Number(r.settings.cpu) || 0 : 0;
    const total = online + cpu;
    const host = isHost();
    const short = selected.minPlayers - total;
    const over = total - selected.maxPlayers;
    const lineup = cpu ? `人間${online}人+CPU${cpu}人で${total}人` : `${online}人`;

    main.innerHTML = `
      <div class="lobby">
        <section class="panel panel-players">
          <h2>卓についている人 <span class="count">${r.players.length} / ${r.maxPlayers}</span></h2>
          <ul class="player-list">
            ${r.players.map((p) => `
              <li class="${p.connected ? '' : 'is-away'}">
                <span class="player-name">${esc(p.name)}</span>
                ${p.id === r.hostId ? '<span class="tag tag-host">ホスト</span>' : ''}
                ${p.id === clientId ? '<span class="tag">あなた</span>' : ''}
                ${p.connected ? '' : '<span class="tag tag-away">接続切れ</span>'}
              </li>`).join('')}
          </ul>
          <p class="hint">部屋コードの横のボタンから招待リンクをコピーして送れます。</p>
        </section>

        <section class="panel panel-games">
          <h2>ゲームを選ぶ</h2>
          <div class="game-list">
            ${r.catalog.map((g) => `
              <button class="game-tile${g.id === r.selectedGame ? ' is-selected' : ''}" data-game="${esc(g.id)}"
                ${g.comingSoon || !host ? 'disabled' : ''} aria-pressed="${g.id === r.selectedGame}">
                <span class="game-name">${esc(g.name)}</span>
                <span class="game-tagline">${esc(g.tagline)}</span>
                <span class="game-meta">
                  <span>${g.minPlayers}〜${g.maxPlayers}人</span>
                  ${g.cpu ? `<span>${g.comingSoon ? 'CPU対応予定' : 'CPU対応'}</span>` : ''}
                  ${g.comingSoon ? '<span class="tag tag-soon">準備中</span>' : ''}
                </span>
              </button>`).join('')}
          </div>
        </section>

        <section class="panel panel-setup">
          <h2>${esc(selected.name)}</h2>
          <p class="desc">${esc(selected.description || selected.tagline)}</p>
          <div class="settings">
            ${selected.settings.map((f) => `
              <label class="field field-inline">
                <span>${esc(f.label)}</span>
                <select data-key="${esc(f.key)}" ${host ? '' : 'disabled'}>
                  ${f.options.map((o) => `<option value="${esc(JSON.stringify(o.value))}" ${r.settings[f.key] === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                </select>
              </label>`).join('')}
          </div>
          ${host
            ? `<button class="btn btn-primary btn-block btn-start" id="start-game" ${short > 0 || over > 0 ? 'disabled' : ''}>ゲームを始める</button>
               <p class="hint">${short > 0 ? `いま${lineup}。あと${short}人${selected.cpu ? '(CPUでも可)' : ''}で始められます` : over > 0 ? `いま${lineup}。${selected.maxPlayers}人までなので${over}人減らしてください` : `${lineup}で始めます`}</p>`
            : '<p class="hint wait">ホストがゲームを始めるのを待っています</p>'}
          <p class="error" id="lobby-error" role="alert"></p>
        </section>
      </div>`;

    if (!host) return;
    main.querySelectorAll('.game-tile:not([disabled])').forEach((b) => {
      b.onclick = () => send('room:selectGame', { gameId: b.dataset.game });
    });
    main.querySelectorAll('select[data-key]').forEach((sel) => {
      sel.onchange = () => {
        const settings = { ...state.room.settings, [sel.dataset.key]: JSON.parse(sel.value) };
        send('room:settings', { settings });
      };
    });
    const start = $('#start-game');
    if (start) {
      start.onclick = async () => {
        start.disabled = true;
        const res = await send('room:start');
        if (!res.ok) {
          $('#lobby-error').textContent = res.error || '始められませんでした';
          start.disabled = false;
        }
      };
    }
  }

  // ---------- ソケットイベント ----------
  socket.on('connect', () => {
    // 再接続時は同じ部屋に入り直す
    if (state.code) send('room:join', { code: state.code, name: store.get('nijikai.name'), clientId }).then((res) => {
      if (!res.ok) {
        state.code = null;
        state.notice = res.error || '部屋に戻れませんでした';
        history.replaceState(null, '', '/');
        renderHome();
      }
    });
  });

  socket.on('room:state', (r) => {
    const wasPlaying = state.room?.playing;
    state.room = r;
    if (state.screen !== 'room') return;
    renderTopbar();
    // ゲーム中の画面はゲーム側の更新に任せる(入力中の内容を消さないため)
    if (!r.playing || !wasPlaying) renderMain();
  });

  socket.on('game:view', (v) => {
    state.view = v;
    if (v) state.timeOffset = v.serverNow - Date.now();
    if (state.screen === 'room') renderMain();
  });

  socket.on('game:event', (ev) => {
    if (game && game.id === ev.gameId) game.instance.onEvent?.(ev.type, ev.data);
    else {
      pendingEvents.push(ev);
      if (pendingEvents.length > 50) pendingEvents.shift();
    }
  });

  socket.on('chat:history', (list) => {
    state.chat = list;
    renderChatLog();
  });

  socket.on('chat:message', appendChat);

  socket.on('chat:channels', (list) => {
    const before = state.channels.map((c) => c.id).join();
    state.channels = Array.isArray(list) && list.length ? list : [{ id: 'all', label: '全体' }];
    if (before !== state.channels.map((c) => c.id).join()) {
      // ゲームが「既定」に指定したチャンネル(怪盗と探偵の作戦など)があれば、そちらを送信先にしておく
      const preferred = state.channels.find((c) => c.default);
      if (preferred) state.sendChannel = preferred.id;
    }
    renderChannels();
  });

  socket.on('room:replaced', () => {
    state.code = null;
    state.room = null;
    state.view = null;
    state.notice = '別のタブでこの部屋に入ったため、こちらの画面は閉じました';
    history.replaceState(null, '', '/');
    renderHome();
  });

  // ---------- 起動 ----------
  const invited = inviteCode();
  const savedName = store.get('nijikai.name');
  if (invited && savedName) {
    // 招待リンクやリロードで開いたときは、そのまま部屋に戻る
    app.innerHTML = '<main class="home"><p class="loading">部屋に入っています…</p></main>';
    joinRoom(invited, savedName);
  } else {
    renderHome();
  }
})();
