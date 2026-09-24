const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { catalog, getGame } = require('./games');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 12;
const CHAT_LIMIT = 300;
const DISCONNECT_GRACE_MS = 10 * 1000; // リロード程度では退出扱いにしない
const REMOVE_AFTER_MS = 10 * 60 * 1000; // 切断が続いたらメンバーから外す
const ROOM_IDLE_MS = 30 * 60 * 1000; // 誰もいない部屋を消す
const DEV_MIN_PLAYERS = Number(process.env.DEV_MIN_PLAYERS) || null;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 20000 });

/** @type {Map<string, any>} */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || '名無し';
const cleanId = (id) => (/^[a-zA-Z0-9-]{8,64}$/.test(String(id ?? '')) ? String(id) : null);

function minPlayersOf(game) {
  return DEV_MIN_PLAYERS ?? game.minPlayers;
}

const publicCatalog = () =>
  catalog.map((g) => ({
    id: g.id,
    name: g.name,
    tagline: g.tagline,
    description: g.description,
    minPlayers: minPlayersOf(g),
    maxPlayers: g.maxPlayers,
    cpu: !!g.cpu,
    comingSoon: !!g.comingSoon,
    settings: g.settings || [],
  }));

function defaultSettings(gameId) {
  const g = getGame(gameId);
  const s = {};
  for (const f of g?.settings || []) s[f.key] = f.default;
  return s;
}

function sanitizeSettings(gameId, input) {
  const g = getGame(gameId);
  const s = defaultSettings(gameId);
  for (const f of g?.settings || []) {
    const v = input?.[f.key];
    if (f.options.some((o) => o.value === v)) s[f.key] = v;
  }
  return s;
}

function createRoom() {
  const code = newCode();
  const first = catalog.find((g) => !g.comingSoon);
  const room = {
    code,
    hostId: null,
    players: new Map(),
    chat: [],
    selectedGame: first.id,
    settings: defaultSettings(first.id),
    game: null,
    gameId: null,
    emptySince: null,
  };
  rooms.set(code, room);
  return room;
}

function deleteRoom(room) {
  room.game?.dispose?.();
  rooms.delete(room.code);
}

// ---------- 送信まわり ----------

function pushChat(room, msg) {
  const full = { ...msg, id: crypto.randomUUID(), ts: Date.now() };
  room.chat.push(full);
  if (room.chat.length > CHAT_LIMIT) room.chat.shift();
  io.to(room.code).emit('chat:message', full);
}

const system = (room, text) => pushChat(room, { type: 'system', text });

function roomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    maxPlayers: MAX_PLAYERS,
    selectedGame: room.selectedGame,
    settings: room.settings,
    catalog: publicCatalog(),
    playing: !!room.game,
    playingGameId: room.gameId,
  };
}

const sendRoomState = (room) => io.to(room.code).emit('room:state', roomState(room));

function sendGameViews(room) {
  for (const p of room.players.values()) {
    if (!p.socketId) continue;
    const view = room.game ? room.game.view(p.id) : null;
    io.to(p.socketId).emit('game:view', view ? { ...view, gameId: room.gameId, serverNow: Date.now() } : null);
  }
}

function ensureHost(room) {
  const host = room.players.get(room.hostId);
  if (host && host.connected) return;
  const next = [...room.players.values()].find((p) => p.connected);
  if (next && next.id !== room.hostId) {
    room.hostId = next.id;
    system(room, `${next.name}さんがホストになりました`);
  }
}

function removePlayer(room, playerId, announce = true) {
  const p = room.players.get(playerId);
  if (!p) return;
  room.game?.onLeave?.(playerId); // 名前を引き継げるよう、消す前に知らせる
  room.players.delete(playerId);
  if (announce) system(room, `${p.name}さんが退室しました`);
  if (room.players.size === 0) return deleteRoom(room);
  if (room.hostId === playerId) {
    room.hostId = null;
    ensureHost(room);
    if (!room.hostId) room.hostId = [...room.players.keys()][0];
  }
  sendRoomState(room);
  sendGameViews(room);
}

function makeGameContext(room) {
  return {
    update: () => sendGameViews(room),
    system: (text) => system(room, text),
    say: (playerId, name, text) => {
      if (rooms.get(room.code) === room) pushChat(room, { type: 'user', playerId, name, text, cpu: true });
    },
    nameOf: (id) => room.players.get(id)?.name ?? '(退室済み)',
    isConnected: (id) => !!room.players.get(id)?.connected,
    finish: () => {
      room.game?.dispose?.();
      room.game = null;
      room.gameId = null;
      sendRoomState(room);
      sendGameViews(room);
    },
  };
}

// ---------- ソケット ----------

function current(socket) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.get(socket.data.playerId);
  return { room, player };
}

function detach(socket) {
  const { room, player } = current(socket);
  if (room) socket.leave(room.code);
  socket.data = {};
  return { room, player };
}

function joinRoom(socket, room, name, clientId, ack) {
  const id = cleanId(clientId);
  if (!id) return ack({ ok: false, error: '接続情報が不正です。ページを再読み込みしてください。' });

  if (socket.data.roomCode && socket.data.roomCode !== room.code) {
    const { room: prev } = detach(socket);
    if (prev) removePlayer(prev, id);
  }

  let p = room.players.get(id);
  if (!p) {
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, error: `この部屋は満員です(最大${MAX_PLAYERS}人)` });
    p = { id, name: cleanName(name), connected: true, socketId: socket.id, leftAt: null, announcedLeave: false };
    room.players.set(id, p);
    if (!room.hostId) room.hostId = id;
    system(room, `${p.name}さんが入室しました`);
    room.game?.onJoin?.(id);
  } else {
    if (p.socketId && p.socketId !== socket.id) {
      const old = io.sockets.sockets.get(p.socketId);
      if (old) {
        old.leave(room.code);
        old.data = {};
        old.emit('room:replaced');
      }
    }
    const newName = cleanName(name);
    if (newName !== p.name) system(room, `${p.name}さんが名前を「${newName}」に変えました`);
    p.name = newName;
    if (p.announcedLeave) system(room, `${p.name}さんが戻ってきました`);
    p.connected = true;
    p.socketId = socket.id;
    p.announcedLeave = false;
  }

  socket.data = { roomCode: room.code, playerId: id };
  socket.join(room.code);
  room.emptySince = null;

  ack({ ok: true, code: room.code, playerId: id });
  socket.emit('chat:history', room.chat);
  sendRoomState(room);
  sendGameViews(room);
}

io.on('connection', (socket) => {
  const safe = (fn) => (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    try {
      fn(args[0] ?? {}, ack);
    } catch (err) {
      console.error(err);
      ack({ ok: false, error: 'サーバーでエラーが起きました' });
    }
  };

  socket.on('room:create', safe(({ name, clientId }, ack) => {
    const room = createRoom();
    joinRoom(socket, room, name, clientId, ack);
  }));

  socket.on('room:join', safe(({ code, name, clientId }, ack) => {
    const room = rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) return ack({ ok: false, error: '部屋が見つかりません。コードを確認するか、新しく部屋を作ってください。' });
    joinRoom(socket, room, name, clientId, ack);
  }));

  socket.on('room:leave', safe((_d, ack) => {
    const { room, player } = detach(socket);
    if (room && player) removePlayer(room, player.id);
    ack({ ok: true });
  }));

  let lastChat = 0;
  socket.on('chat:send', safe(({ text }, ack) => {
    const { room, player } = current(socket);
    if (!room || !player) return ack({ ok: false });
    const t = String(text ?? '').trim().slice(0, 300);
    const now = Date.now();
    if (!t || now - lastChat < 250) return ack({ ok: false });
    lastChat = now;
    pushChat(room, { type: 'user', playerId: player.id, name: player.name, text: t });
    ack({ ok: true });
  }));

  const hostOnly = (fn) => safe((data, ack) => {
    const { room, player } = current(socket);
    if (!room || !player) return ack({ ok: false });
    if (room.hostId !== player.id) return ack({ ok: false, error: 'ホストだけが操作できます' });
    fn(room, player, data, ack);
  });

  socket.on('room:selectGame', hostOnly((room, _p, { gameId }, ack) => {
    const g = getGame(gameId);
    if (room.game || !g || g.comingSoon) return ack({ ok: false });
    room.selectedGame = g.id;
    room.settings = defaultSettings(g.id);
    sendRoomState(room);
    ack({ ok: true });
  }));

  socket.on('room:settings', hostOnly((room, _p, { settings }, ack) => {
    if (room.game) return ack({ ok: false });
    room.settings = sanitizeSettings(room.selectedGame, settings);
    sendRoomState(room);
    ack({ ok: true });
  }));

  socket.on('room:start', hostOnly((room, _p, _d, ack) => {
    if (room.game) return ack({ ok: false });
    const g = getGame(room.selectedGame);
    const members = [...room.players.values()].filter((p) => p.connected).map((p) => p.id);
    const cpuCount = g.cpu ? Number(room.settings.cpu) || 0 : 0;
    const total = members.length + cpuCount;
    const min = minPlayersOf(g);
    if (members.length === 0) return ack({ ok: false });
    if (total < min) return ack({ ok: false, error: `このゲームは${min}人から遊べます(CPUを含む)` });
    if (total > g.maxPlayers) return ack({ ok: false, error: `このゲームは${g.maxPlayers}人までです(CPUを含む)` });
    room.gameId = g.id;
    system(room, `「${g.name}」を始めます`);
    room.game = g.create(makeGameContext(room), room.settings, members);
    sendRoomState(room);
    sendGameViews(room);
    ack({ ok: true });
  }));

  socket.on('game:abort', hostOnly((room, player, _d, ack) => {
    if (!room.game) return ack({ ok: false });
    system(room, `${player.name}さんがゲームを中断しました`);
    makeGameContext(room).finish();
    ack({ ok: true });
  }));

  socket.on('game:action', safe(({ type, payload }, ack) => {
    const { room, player } = current(socket);
    if (!room?.game || !player) return ack({ ok: false });
    room.game.action(player.id, String(type), payload ?? {}, { isHost: room.hostId === player.id });
    ack({ ok: true });
  }));

  socket.on('disconnect', () => {
    const { room, player } = current(socket);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    player.leftAt = Date.now();
    sendRoomState(room);

    setTimeout(() => {
      if (!rooms.has(room.code)) return;
      const p = room.players.get(player.id);
      if (!p || p.connected) return;
      p.announcedLeave = true;
      system(room, `${p.name}さんの接続が切れました`);
      ensureHost(room);
      room.game?.onConnectionChange?.();
      sendRoomState(room);
      sendGameViews(room);
    }, DISCONNECT_GRACE_MS);
  });
});

// 長く切断している人と、誰もいない部屋の掃除
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    for (const p of [...room.players.values()]) {
      if (!p.connected && p.leftAt && now - p.leftAt > REMOVE_AFTER_MS) removePlayer(room, p.id, false);
    }
    if (!rooms.has(room.code)) continue;
    const anyone = [...room.players.values()].some((p) => p.connected);
    if (anyone) room.emptySince = null;
    else {
      room.emptySince ??= now;
      if (now - room.emptySince > ROOM_IDLE_MS) deleteRoom(room);
    }
  }
}, 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`二次会卓: http://localhost:${PORT}`));
}

module.exports = { server, io, rooms };
