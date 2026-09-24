const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_LOGS = 50;

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = '';
    for (let i = 0; i < 5; i += 1) code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not create a unique room code.');
}

function cleanName(input) {
  return String(input || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22);
}

function cleanCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function addLog(room, text) {
  room.logs.push({ id: randomId(4), text, at: Date.now() });
  if (room.logs.length > MAX_LOGS) room.logs.splice(0, room.logs.length - MAX_LOGS);
  room.touchedAt = Date.now();
}

function createPlayer(name) {
  return {
    id: randomId(8),
    token: randomId(18),
    name,
    stream: null,
    connected: true,
    alive: true,
    role: null,
    party: null,
  };
}

function createRoom(hostName) {
  const code = generateRoomCode();
  const player = createPlayer(hostName);
  const room = {
    code,
    createdAt: Date.now(),
    touchedAt: Date.now(),
    hostPlayerId: player.id,
    players: [player],
    started: false,
    initialPlayerCount: 0,
    phase: 'lobby',
    presidentIndex: -1,
    currentPresidentId: null,
    chancellorCandidateId: null,
    currentChancellorId: null,
    lastPresidentId: null,
    lastChancellorId: null,
    electionTracker: 0,
    honeyPolicies: 0,
    grizzlyPolicies: 0,
    deck: [],
    discard: [],
    legislativeCards: [],
    votes: {},
    lastVoteResult: null,
    investigated: new Set(),
    privateIntel: {},
    executivePower: null,
    specialElectionReturnIndex: null,
    specialElectionActive: false,
    vetoRejected: false,
    winner: null,
    winReason: null,
    logs: [],
  };
  rooms.set(code, room);
  addLog(room, `${player.name} opened a new den.`);
  return { room, player };
}

function roleCounts(n) {
  const table = {
    5: { honey: 3, grizzly: 1 },
    6: { honey: 4, grizzly: 1 },
    7: { honey: 4, grizzly: 2 },
    8: { honey: 5, grizzly: 2 },
    9: { honey: 5, grizzly: 3 },
    10: { honey: 6, grizzly: 3 },
  };
  return table[n];
}

function makePolicyDeck() {
  return shuffle([...Array(6).fill('honey'), ...Array(11).fill('grizzly')]);
}

function powerFor(initialCount, grizzlyPolicyNumber) {
  if (initialCount <= 6) return ({ 3: 'peek', 4: 'execute', 5: 'execute' })[grizzlyPolicyNumber] || null;
  if (initialCount <= 8) return ({ 2: 'investigate', 3: 'special_election', 4: 'execute', 5: 'execute' })[grizzlyPolicyNumber] || null;
  return ({ 1: 'investigate', 2: 'investigate', 3: 'special_election', 4: 'execute', 5: 'execute' })[grizzlyPolicyNumber] || null;
}

function alivePlayers(room) {
  return room.players.filter((p) => p.alive);
}

function playerById(room, id) {
  return room.players.find((p) => p.id === id) || null;
}

function playerByToken(room, token) {
  return room.players.find((p) => p.token === token) || null;
}

function currentPresident(room) {
  return playerById(room, room.currentPresidentId);
}

function nextAliveIndex(room, fromIndex) {
  if (!room.players.some((p) => p.alive)) return -1;
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const index = (fromIndex + offset + room.players.length) % room.players.length;
    if (room.players[index].alive) return index;
  }
  return -1;
}

function setPresidentByIndex(room, index) {
  room.presidentIndex = index;
  room.currentPresidentId = room.players[index]?.id || null;
  room.chancellorCandidateId = null;
  room.currentChancellorId = null;
  room.votes = {};
  room.legislativeCards = [];
  room.vetoRejected = false;
  room.executivePower = null;
  room.phase = 'nominate';
  if (room.currentPresidentId) addLog(room, `${room.players[index].name} is the Bear President.`);
}

function advancePresident(room) {
  let nextIndex;
  if (room.specialElectionActive && room.specialElectionReturnIndex !== null) {
    nextIndex = nextAliveIndex(room, room.specialElectionReturnIndex);
    room.specialElectionActive = false;
    room.specialElectionReturnIndex = null;
  } else {
    nextIndex = nextAliveIndex(room, room.presidentIndex);
  }
  setPresidentByIndex(room, nextIndex);
}

function eligibleChancellors(room) {
  const alive = alivePlayers(room);
  return alive.filter((p) => {
    if (p.id === room.currentPresidentId) return false;
    if (p.id === room.lastChancellorId) return false;
    if (alive.length > 5 && p.id === room.lastPresidentId) return false;
    return true;
  });
}

function ensureDeck(room) {
  if (room.deck.length >= 3) return;
  room.deck = shuffle([...room.deck, ...room.discard]);
  room.discard = [];
  addLog(room, 'The policy deck was quietly reshuffled.');
}

function drawPolicies(room, count) {
  if (room.deck.length < count) ensureDeck(room);
  return room.deck.splice(0, count);
}

function startGame(room) {
  const n = room.players.length;
  if (n < 5 || n > 10) throw new Error('Secret Bear needs 5–10 players.');
  if (room.players.some((p) => !p.connected)) throw new Error('Everyone must be connected before starting.');

  const counts = roleCounts(n);
  const roles = shuffle([
    ...Array(counts.honey).fill('honey'),
    ...Array(counts.grizzly).fill('grizzly'),
    'secret_bear',
  ]);

  room.players.forEach((p, i) => {
    p.alive = true;
    p.role = roles[i];
    p.party = roles[i] === 'honey' ? 'honey' : 'grizzly';
  });

  room.started = true;
  room.initialPlayerCount = n;
  room.phase = 'nominate';
  room.honeyPolicies = 0;
  room.grizzlyPolicies = 0;
  room.electionTracker = 0;
  room.deck = makePolicyDeck();
  room.discard = [];
  room.legislativeCards = [];
  room.votes = {};
  room.lastVoteResult = null;
  room.lastPresidentId = null;
  room.lastChancellorId = null;
  room.investigated = new Set();
  room.privateIntel = {};
  room.executivePower = null;
  room.specialElectionReturnIndex = null;
  room.specialElectionActive = false;
  room.vetoRejected = false;
  room.winner = null;
  room.winReason = null;
  room.logs = [];
  room.players.forEach((p) => { room.privateIntel[p.id] = []; });

  const firstIndex = crypto.randomInt(room.players.length);
  setPresidentByIndex(room, firstIndex);
  addLog(room, 'Roles have been assigned. Keep your screen private!');
}

function resetToLobby(room) {
  room.started = false;
  room.initialPlayerCount = 0;
  room.phase = 'lobby';
  room.presidentIndex = -1;
  room.currentPresidentId = null;
  room.chancellorCandidateId = null;
  room.currentChancellorId = null;
  room.lastPresidentId = null;
  room.lastChancellorId = null;
  room.electionTracker = 0;
  room.honeyPolicies = 0;
  room.grizzlyPolicies = 0;
  room.deck = [];
  room.discard = [];
  room.legislativeCards = [];
  room.votes = {};
  room.lastVoteResult = null;
  room.investigated = new Set();
  room.privateIntel = {};
  room.executivePower = null;
  room.specialElectionReturnIndex = null;
  room.specialElectionActive = false;
  room.vetoRejected = false;
  room.winner = null;
  room.winReason = null;
  room.players.forEach((p) => {
    p.alive = true;
    p.role = null;
    p.party = null;
  });
  addLog(room, 'Back at the den. Ready for another game.');
}

function knowledgeFor(room, viewer) {
  if (!room.started || !viewer.role) return [];
  const others = room.players.filter((p) => p.id !== viewer.id);
  if (viewer.role === 'honey') return [];
  if (room.initialPlayerCount <= 6) {
    return others.filter((p) => p.party === 'grizzly').map((p) => ({ id: p.id, name: p.name, role: p.role }));
  }
  if (viewer.role === 'grizzly') {
    return others.filter((p) => p.party === 'grizzly').map((p) => ({ id: p.id, name: p.name, role: p.role }));
  }
  return [];
}

function roleLabel(role) {
  if (role === 'honey') return 'Honey Bear';
  if (role === 'grizzly') return 'Grizzly';
  if (role === 'secret_bear') return 'Secret Bear';
  return '';
}

function publicPlayer(p, room) {
  return {
    id: p.id,
    name: p.name,
    connected: p.connected,
    alive: p.alive,
    isHost: p.id === room.hostPlayerId,
  };
}

function viewForPlayer(room, playerId) {
  const viewer = playerById(room, playerId);
  if (!viewer) return null;
  const state = {
    roomCode: room.code,
    isHost: room.hostPlayerId === playerId,
    started: room.started,
    phase: room.phase,
    players: room.players.map((p) => publicPlayer(p, room)),
    initialPlayerCount: room.initialPlayerCount,
    currentPresidentId: room.currentPresidentId,
    chancellorCandidateId: room.chancellorCandidateId,
    currentChancellorId: room.currentChancellorId,
    eligibleChancellorIds: room.phase === 'nominate' ? eligibleChancellors(room).map((p) => p.id) : [],
    electionTracker: room.electionTracker,
    honeyPolicies: room.honeyPolicies,
    grizzlyPolicies: room.grizzlyPolicies,
    vetoUnlocked: room.grizzlyPolicies >= 5,
    lastVoteResult: room.lastVoteResult,
    votesCast: Object.keys(room.votes).length,
    hasVoted: Boolean(room.votes[playerId]),
    livingCount: alivePlayers(room).length,
    executivePower: room.executivePower,
    winner: room.winner,
    winReason: room.winReason,
    logs: room.logs.slice(-18),
    me: {
      id: viewer.id,
      name: viewer.name,
      alive: viewer.alive,
      role: viewer.role,
      roleLabel: roleLabel(viewer.role),
      party: viewer.party,
      connected: viewer.connected,
    },
    secretKnowledge: knowledgeFor(room, viewer),
    privateIntel: room.privateIntel[playerId] || [],
    privatePolicies: [],
    vetoRejected: room.vetoRejected,
  };

  if (room.phase === 'president_discard' && playerId === room.currentPresidentId) state.privatePolicies = [...room.legislativeCards];
  if (room.phase === 'chancellor_discard' && playerId === room.currentChancellorId) state.privatePolicies = [...room.legislativeCards];
  return state;
}

function writeSse(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function emitRoom(room) {
  room.players.forEach((p) => {
    if (p.stream && p.connected) {
      const ok = writeSse(p.stream, 'state', viewForPlayer(room, p.id));
      if (!ok) {
        p.stream = null;
        p.connected = false;
      }
    }
  });
}

function setWinner(room, winner, reason) {
  room.winner = winner;
  room.winReason = reason;
  room.phase = 'gameover';
  room.legislativeCards = [];
  room.votes = {};
  addLog(room, `${winner === 'honey' ? '🍯 Honey Bears' : '🐻 Grizzlies'} win — ${reason}`);
}

function enactPolicy(room, policy, { chaos = false } = {}) {
  room.electionTracker = 0;
  if (policy === 'honey') {
    room.honeyPolicies += 1;
    addLog(room, `${chaos ? 'Chaos enacted' : 'The government enacted'} a 🍯 Honey Policy.`);
    if (room.honeyPolicies >= 5) {
      setWinner(room, 'honey', 'Five Honey Policies were enacted.');
      return { ended: true, power: null };
    }
    return { ended: false, power: null };
  }
  room.grizzlyPolicies += 1;
  addLog(room, `${chaos ? 'Chaos enacted' : 'The government enacted'} a 🐻 Grizzly Policy.`);
  if (room.grizzlyPolicies >= 6) {
    setWinner(room, 'grizzly', 'Six Grizzly Policies were enacted.');
    return { ended: true, power: null };
  }
  return { ended: false, power: chaos ? null : powerFor(room.initialPlayerCount, room.grizzlyPolicies) };
}

function topDeckChaos(room) {
  const [policy] = drawPolicies(room, 1);
  room.lastPresidentId = null;
  room.lastChancellorId = null;
  room.chancellorCandidateId = null;
  room.currentChancellorId = null;
  addLog(room, 'Three failed governments! The forest falls into chaos.');
  const result = enactPolicy(room, policy, { chaos: true });
  ensureDeck(room);
  return result;
}

function finishPolicy(room, policy) {
  room.legislativeCards = [];
  const result = enactPolicy(room, policy);
  ensureDeck(room);
  if (result.ended) return;
  if (result.power) {
    room.executivePower = result.power;
    room.phase = 'executive';
    addLog(room, `${currentPresident(room).name} must use a Presidential Bear Power.`);
    return;
  }
  advancePresident(room);
}

function handleFailedGovernment(room) {
  room.electionTracker += 1;
  room.chancellorCandidateId = null;
  room.currentChancellorId = null;
  room.votes = {};
  if (room.electionTracker >= 3) {
    const result = topDeckChaos(room);
    if (!result.ended) advancePresident(room);
  } else {
    advancePresident(room);
  }
}

function requirePlayer(roomCode, token) {
  const room = rooms.get(cleanCode(roomCode));
  if (!room) throw new Error('That den does not exist anymore.');
  const player = playerByToken(room, String(token || ''));
  if (!player) throw new Error('Your seat could not be found.');
  return { room, player };
}

function requireAction(room, player, allowedPhase) {
  if (!room.started) throw new Error('The game has not started.');
  if (!player.alive) throw new Error('You are out of this game.');
  if (room.winner) throw new Error('The game is already over.');
  const phases = Array.isArray(allowedPhase) ? allowedPhase : [allowedPhase];
  if (!phases.includes(room.phase)) throw new Error('That action is not available right now.');
}

function performAction(room, player, action, payload = {}) {
  switch (action) {
    case 'leave_room': {
      if (room.started) throw new Error('During a game, just close the tab. Your seat will be saved for reconnection.');
      room.players = room.players.filter((p) => p.id !== player.id);
      addLog(room, `${player.name} left the den.`);
      if (room.hostPlayerId === player.id) room.hostPlayerId = room.players[0]?.id || null;
      if (player.stream) {
        try { player.stream.end(); } catch {}
      }
      if (room.players.length === 0) rooms.delete(room.code);
      else emitRoom(room);
      return { left: true };
    }
    case 'start_game': {
      if (room.hostPlayerId !== player.id) throw new Error('Only the den host can start.');
      if (room.started) throw new Error('The game has already started.');
      startGame(room);
      break;
    }
    case 'return_to_lobby': {
      if (room.hostPlayerId !== player.id) throw new Error('Only the den host can reset the game.');
      if (room.phase !== 'gameover') throw new Error('Finish this game first.');
      resetToLobby(room);
      break;
    }
    case 'nominate': {
      requireAction(room, player, 'nominate');
      if (player.id !== room.currentPresidentId) throw new Error('Only the Bear President can nominate.');
      const candidate = playerById(room, String(payload.playerId || ''));
      if (!candidate || !eligibleChancellors(room).some((p) => p.id === candidate.id)) throw new Error('That bear is not eligible for Chancellor.');
      room.chancellorCandidateId = candidate.id;
      room.votes = {};
      room.lastVoteResult = null;
      room.phase = 'vote';
      addLog(room, `${player.name} nominated ${candidate.name} for Chancellor.`);
      break;
    }
    case 'vote': {
      requireAction(room, player, 'vote');
      const choice = payload.choice;
      if (!['yes', 'no'].includes(choice)) throw new Error('Choose yes or no.');
      room.votes[player.id] = choice;
      const living = alivePlayers(room);
      if (Object.keys(room.votes).length >= living.length) {
        const yes = living.filter((p) => room.votes[p.id] === 'yes').length;
        const no = living.length - yes;
        room.lastVoteResult = {
          yes,
          no,
          passed: yes > no,
          votes: living.map((p) => ({ id: p.id, name: p.name, choice: room.votes[p.id] })),
        };
        if (yes > no) {
          const president = currentPresident(room);
          const chancellor = playerById(room, room.chancellorCandidateId);
          room.currentChancellorId = chancellor.id;
          room.lastPresidentId = president.id;
          room.lastChancellorId = chancellor.id;
          addLog(room, `Government elected: ${president.name} + ${chancellor.name} (${yes} yes / ${no} no).`);
          if (room.grizzlyPolicies >= 3 && chancellor.role === 'secret_bear') {
            setWinner(room, 'grizzly', 'The Secret Bear was elected Chancellor after three Grizzly Policies.');
          } else {
            room.legislativeCards = drawPolicies(room, 3);
            room.phase = 'president_discard';
          }
        } else {
          addLog(room, `Government rejected (${yes} yes / ${no} no).`);
          handleFailedGovernment(room);
        }
      }
      break;
    }
    case 'president_discard': {
      requireAction(room, player, 'president_discard');
      if (player.id !== room.currentPresidentId) throw new Error('Only the President can discard now.');
      const index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || index >= room.legislativeCards.length) throw new Error('Choose one policy to discard.');
      const [discarded] = room.legislativeCards.splice(index, 1);
      room.discard.push(discarded);
      room.vetoRejected = false;
      room.phase = 'chancellor_discard';
      break;
    }
    case 'chancellor_discard': {
      requireAction(room, player, 'chancellor_discard');
      if (player.id !== room.currentChancellorId) throw new Error('Only the Chancellor can act now.');
      const index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || index >= room.legislativeCards.length) throw new Error('Choose one policy to discard.');
      const [discarded] = room.legislativeCards.splice(index, 1);
      room.discard.push(discarded);
      const [enacted] = room.legislativeCards;
      finishPolicy(room, enacted);
      break;
    }
    case 'request_veto': {
      requireAction(room, player, 'chancellor_discard');
      if (player.id !== room.currentChancellorId) throw new Error('Only the Chancellor can request a veto.');
      if (room.grizzlyPolicies < 5) throw new Error('Veto power is not unlocked yet.');
      if (room.vetoRejected) throw new Error('The President already rejected a veto for this hand.');
      room.phase = 'veto_president';
      addLog(room, `${player.name} requested a policy veto.`);
      break;
    }
    case 'veto_response': {
      requireAction(room, player, 'veto_president');
      if (player.id !== room.currentPresidentId) throw new Error('Only the President can answer the veto request.');
      const agree = Boolean(payload.agree);
      if (agree) {
        room.discard.push(...room.legislativeCards);
        room.legislativeCards = [];
        addLog(room, `${player.name} accepted the veto. No policy was enacted.`);
        handleFailedGovernment(room);
      } else {
        room.vetoRejected = true;
        room.phase = 'chancellor_discard';
        addLog(room, `${player.name} rejected the veto. The Chancellor must enact a policy.`);
      }
      break;
    }
    case 'executive_action': {
      requireAction(room, player, 'executive');
      if (player.id !== room.currentPresidentId) throw new Error('Only the President can use this power.');
      const power = room.executivePower;
      if (power === 'peek') {
        ensureDeck(room);
        const top = room.deck.slice(0, 3);
        room.privateIntel[player.id].push({
          id: randomId(4),
          type: 'peek',
          text: `Policy Peek: ${top.map((x) => x === 'honey' ? '🍯 Honey' : '🐻 Grizzly').join(' • ')}`,
        });
        addLog(room, `${player.name} secretly peeked at the next three policies.`);
        room.executivePower = null;
        advancePresident(room);
        break;
      }
      const target = playerById(room, String(payload.playerId || ''));
      if (!target || !target.alive || target.id === player.id) throw new Error('Choose another living bear.');
      if (power === 'investigate') {
        if (room.investigated.has(target.id)) throw new Error('That player has already been investigated this game.');
        room.investigated.add(target.id);
        room.privateIntel[player.id].push({
          id: randomId(4),
          type: 'investigate',
          text: `Investigation: ${target.name} belongs to the ${target.party === 'honey' ? '🍯 Honey Bear' : '🐻 Grizzly'} faction.`,
        });
        addLog(room, `${player.name} investigated ${target.name}.`);
        room.executivePower = null;
        advancePresident(room);
      } else if (power === 'special_election') {
        room.specialElectionReturnIndex = room.presidentIndex;
        room.specialElectionActive = true;
        room.executivePower = null;
        const targetIndex = room.players.findIndex((p) => p.id === target.id);
        addLog(room, `${player.name} called a Special Election and chose ${target.name}.`);
        setPresidentByIndex(room, targetIndex);
      } else if (power === 'execute') {
        target.alive = false;
        addLog(room, `${player.name} banished ${target.name} from the forest.`);
        room.executivePower = null;
        if (target.role === 'secret_bear') setWinner(room, 'honey', 'The Secret Bear was found and banished.');
        else advancePresident(room);
      } else {
        throw new Error('Unknown Presidential power.');
      }
      break;
    }
    default:
      throw new Error('Unknown action.');
  }
  room.touchedAt = Date.now();
  emitRoom(room);
  return { left: false };
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 20_000) {
        reject(new Error('Request too large.'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  })[ext] || 'application/octet-stream';
}

function serveStatic(urlPath, res) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const normalized = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) filePath = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) filePath = path.join(PUBLIC_DIR, 'index.html');
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mimeFor(filePath),
    'Content-Length': data.length,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  res.end(data);
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });

    if (req.method === 'POST' && url.pathname === '/api/create') {
      const body = await readJson(req);
      const name = cleanName(body.name);
      if (!name) throw new Error('Enter your name first.');
      const { room, player } = createRoom(name);
      return json(res, 200, {
        session: { roomCode: room.code, playerToken: player.token, playerId: player.id },
        state: viewForPlayer(room, player.id),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readJson(req);
      const code = cleanCode(body.roomCode);
      const name = cleanName(body.name);
      if (!name) throw new Error('Enter your name first.');
      const room = rooms.get(code);
      if (!room) throw new Error('That den code does not exist.');
      if (room.started) throw new Error('That game has already started. Rejoin with your saved session instead.');
      if (room.players.length >= 10) throw new Error('That den is full.');
      if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already in the den.');
      const player = createPlayer(name);
      room.players.push(player);
      addLog(room, `${player.name} wandered into the den.`);
      emitRoom(room);
      return json(res, 200, {
        session: { roomCode: room.code, playerToken: player.token, playerId: player.id },
        state: viewForPlayer(room, player.id),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const { room, player } = requirePlayer(url.searchParams.get('roomCode'), url.searchParams.get('playerToken'));
      player.connected = true;
      room.touchedAt = Date.now();
      return json(res, 200, { state: viewForPlayer(room, player.id) });
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const { room, player } = requirePlayer(url.searchParams.get('roomCode'), url.searchParams.get('playerToken'));
      if (player.stream && player.stream !== res) {
        try { player.stream.end(); } catch {}
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      player.stream = res;
      player.connected = true;
      room.touchedAt = Date.now();
      emitRoom(room);
      req.on('close', () => {
        if (player.stream === res) {
          player.stream = null;
          player.connected = false;
          room.touchedAt = Date.now();
          addLog(room, `${player.name} disconnected — their seat is being saved.`);
          emitRoom(room);
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readJson(req);
      const { room, player } = requirePlayer(body.roomCode, body.playerToken);
      const result = performAction(room, player, String(body.action || ''), body.payload || {});
      if (result.left) return json(res, 200, { ok: true, left: true });
      return json(res, 200, { ok: true, state: viewForPlayer(room, player.id) });
    }

    return json(res, 404, { error: 'Not found.' });
  } catch (err) {
    return json(res, 400, { error: err.message || 'Something went wrong.' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
    handleApi(req, res, url);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { error: 'Method not allowed.' });
    return;
  }
  serveStatic(url.pathname, res);
});

setInterval(() => {
  for (const room of rooms.values()) {
    for (const p of room.players) {
      if (p.stream && p.connected) {
        try { p.stream.write(': keepalive\n\n'); } catch {}
      }
    }
  }
}, 20_000).unref();

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms.entries()) {
    if (room.touchedAt < cutoff && room.players.every((p) => !p.connected)) rooms.delete(code);
  }
}, 15 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Secret Bear is listening on http://localhost:${PORT}`));
}

module.exports = { server, rooms, roleCounts, powerFor, makePolicyDeck, startGame, viewForPlayer, performAction };
