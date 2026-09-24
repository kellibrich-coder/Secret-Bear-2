const els = Object.fromEntries([
  'toast','homeView','gameView','nameInput','roomCodeInput','createBtn','joinBtn','roomCodeDisplay','connectionBadge',
  'lobbySection','lobbyCount','lobbyPlayers','lobbyHostControls','startBtn','startHint','leaveBtn','gameBoard',
  'roleCard','roleToggle','roleReveal','roleEmoji','roleTitle','roleDescription','knownBears','hideRoleBtn',
  'honeyCount','grizzlyCount','honeyTrack','grizzlyTrack','chaosTrack','phaseKicker','phaseTitle','phaseText','actionArea',
  'intelCard','intelList','livingCount','gamePlayers','logList','gameOverCard','winnerEmoji','winnerTitle','winnerReason','againBtn'
].map((id) => [id, document.getElementById(id)]));

let state = null;
let toastTimer = null;
let roleVisible = false;
let eventSource = null;
let currentSession = null;
const SESSION_KEY = 'secretBearSessionV1';

function savedSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function saveSession(session) {
  currentSession = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
function clearSession() {
  currentSession = null;
  localStorage.removeItem(SESSION_KEY);
  if (eventSource) eventSource.close();
  eventSource = null;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3500);
}

function setConnection(connected) {
  els.connectionBadge.textContent = connected ? '● connected' : '○ reconnecting';
  els.connectionBadge.classList.toggle('offline', !connected);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function connectStream(session) {
  if (eventSource) eventSource.close();
  const params = new URLSearchParams({ roomCode: session.roomCode, playerToken: session.playerToken });
  eventSource = new EventSource(`/api/stream?${params.toString()}`);
  eventSource.addEventListener('open', () => setConnection(true));
  eventSource.addEventListener('state', (event) => {
    try { render(JSON.parse(event.data)); } catch {}
  });
  eventSource.addEventListener('error', () => setConnection(false));
}

async function action(actionName, payload = {}) {
  if (!currentSession) return;
  try {
    const data = await api('/api/action', {
      method: 'POST',
      body: { ...currentSession, action: actionName, payload },
    });
    if (data.left) {
      clearSession();
      state = null;
      roleVisible = false;
      els.homeView.classList.remove('hidden');
      els.gameView.classList.add('hidden');
      return;
    }
    if (data.state) render(data.state);
  } catch (err) {
    toast(err.message);
  }
}

function playerName(id) {
  return state?.players.find((p) => p.id === id)?.name || '—';
}

function phaseCopy(s) {
  const p = playerName(s.currentPresidentId);
  const c = playerName(s.chancellorCandidateId || s.currentChancellorId);
  const isMePresident = s.me.id === s.currentPresidentId;
  const isMeChancellor = s.me.id === s.currentChancellorId;
  if (!s.me.alive && s.phase !== 'gameover') return ['You are out of the forest', 'Stay muted about secret information and enjoy the chaos.'];
  switch (s.phase) {
    case 'nominate': return isMePresident
      ? ['Choose a Chancellor', 'You are Bear President. Pick one eligible bear to join your government.']
      : ['Chancellor nomination', `${p} is choosing a Chancellor.`];
    case 'vote': return ['Vote on the government', `${p} + ${c} need a majority of living bears.`];
    case 'president_discard': return isMePresident
      ? ['President’s secret hand', 'Discard exactly one policy. The remaining two go privately to the Chancellor.']
      : ['Legislative session', `${p} is looking at three secret policies.`];
    case 'chancellor_discard': return isMeChancellor
      ? ['Chancellor’s secret hand', 'Discard one policy. The other policy will be enacted.']
      : ['Legislative session', `${c} is choosing the policy that will be enacted.`];
    case 'veto_president': return isMePresident
      ? ['Veto requested', `${c} wants to discard both remaining policies. Accepting counts as a failed government.`]
      : ['Veto requested', `${c} asked ${p} to veto the whole agenda.`];
    case 'executive': return isMePresident
      ? ['Presidential Bear Power', powerText(s.executivePower)]
      : ['Presidential Bear Power', `${p} must use a special power before the next election.`];
    case 'gameover': return ['The forest has decided', s.winReason || 'Game over.'];
    default: return ['Waiting…', 'The forest is thinking.'];
  }
}

function powerText(power) {
  if (power === 'peek') return 'Secretly peek at the next three policies.';
  if (power === 'investigate') return 'Investigate another bear’s faction. You will see Honey vs. Grizzly, not their exact role.';
  if (power === 'special_election') return 'Choose any other living bear to be the next Presidential Candidate.';
  if (power === 'execute') return 'Banish one other living bear from the game.';
  return 'Use your power.';
}

function badge(text, extra = '') {
  const b = document.createElement('span');
  b.className = `badge ${extra}`;
  b.textContent = text;
  return b;
}

function renderPlayerList(container, players, includeOffices = false) {
  container.innerHTML = '';
  players.forEach((p) => {
    const row = document.createElement('div');
    row.className = `player-row ${p.id === state.me.id ? 'me' : ''} ${!p.alive ? 'dead' : ''}`;
    const dot = document.createElement('span');
    dot.className = `player-dot ${p.connected ? '' : 'offline'}`;
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = p.name;
    const badges = document.createElement('span');
    badges.className = 'player-badges';
    if (p.isHost) badges.appendChild(badge('host'));
    if (p.id === state.me.id) badges.appendChild(badge('you'));
    if (!p.connected) badges.appendChild(badge('offline'));
    if (!p.alive) badges.appendChild(badge('banished'));
    if (includeOffices && p.alive && p.id === state.currentPresidentId) badges.appendChild(badge('President', 'president'));
    if (includeOffices && p.alive && (p.id === state.chancellorCandidateId || p.id === state.currentChancellorId)) badges.appendChild(badge('Chancellor', 'chancellor'));
    row.append(dot, name, badges);
    container.appendChild(row);
  });
}

function renderLobby(s) {
  els.lobbySection.classList.toggle('hidden', s.started);
  els.gameBoard.classList.toggle('hidden', !s.started);
  if (s.started) return;
  els.lobbyCount.textContent = `${s.players.length}/10`;
  renderPlayerList(els.lobbyPlayers, s.players);
  els.lobbyHostControls.classList.toggle('hidden', !s.isHost);
  const connected = s.players.filter((p) => p.connected).length;
  const canStart = s.players.length >= 5 && s.players.length <= 10 && connected === s.players.length;
  els.startBtn.disabled = !canStart;
  els.startHint.textContent = s.players.length < 5
    ? `Need ${5 - s.players.length} more ${5 - s.players.length === 1 ? 'bear' : 'bears'} to start.`
    : connected !== s.players.length
      ? 'Waiting for everyone to reconnect.'
      : 'Everyone is here. Protect your screen when roles appear.';
}

function renderRole(s) {
  const role = s.me.role;
  els.roleReveal.className = `role-reveal ${role || ''} ${roleVisible ? '' : 'hidden'}`;
  els.roleToggle.classList.toggle('hidden', roleVisible);
  els.roleToggle.setAttribute('aria-expanded', roleVisible ? 'true' : 'false');
  const copy = {
    honey: ['🍯', 'Honey Bear', 'You are on the Honey Bear team. You do not know anyone else’s role.'],
    grizzly: ['🐻', 'Grizzly', 'You are on the hidden Grizzly team. Blend in, build trust, and protect the Secret Bear.'],
    secret_bear: ['🕶️🐻', 'Secret Bear', s.initialPlayerCount <= 6
      ? 'You are the Secret Bear. In this smaller game, you know your Grizzly teammate.'
      : 'You are the Secret Bear. In this larger game, the Grizzlies know you — but you do not know them.'],
  }[role] || ['🐻', 'Unknown Bear', ''];
  els.roleEmoji.textContent = copy[0];
  els.roleTitle.textContent = copy[1];
  els.roleDescription.textContent = copy[2];
  els.knownBears.innerHTML = '';
  if (s.secretKnowledge.length) {
    s.secretKnowledge.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'known-row';
      row.textContent = `${k.name} — ${k.role === 'secret_bear' ? 'Secret Bear' : 'Grizzly'}`;
      els.knownBears.appendChild(row);
    });
  } else if (role === 'honey' || (role === 'secret_bear' && s.initialPlayerCount >= 7)) {
    const row = document.createElement('div');
    row.className = 'known-row';
    row.textContent = 'You have no teammate identities to reveal.';
    els.knownBears.appendChild(row);
  }
}

function powerIconForSlot(s, indexOneBased) {
  const n = s.initialPlayerCount;
  if (!n) return '';
  if (n <= 6) return ({3:'👀',4:'🚪',5:'🚪'})[indexOneBased] || '';
  if (n <= 8) return ({2:'🔎',3:'👑',4:'🚪',5:'🚪'})[indexOneBased] || '';
  return ({1:'🔎',2:'🔎',3:'👑',4:'🚪',5:'🚪'})[indexOneBased] || '';
}

function renderTracks(s) {
  els.honeyCount.textContent = `${s.honeyPolicies} / 5`;
  els.grizzlyCount.textContent = `${s.grizzlyPolicies} / 6`;
  els.honeyTrack.innerHTML = '';
  for (let i = 1; i <= 5; i += 1) {
    const slot = document.createElement('div');
    slot.className = `policy-slot ${i <= s.honeyPolicies ? 'filled honey' : ''}`;
    slot.textContent = i <= s.honeyPolicies ? '🍯' : '';
    els.honeyTrack.appendChild(slot);
  }
  els.grizzlyTrack.innerHTML = '';
  for (let i = 1; i <= 6; i += 1) {
    const slot = document.createElement('div');
    slot.className = `policy-slot ${i <= s.grizzlyPolicies ? 'filled grizzly' : ''}`;
    if (i <= s.grizzlyPolicies) slot.textContent = '🐻';
    else {
      const icon = document.createElement('span');
      icon.className = 'power-icon';
      icon.textContent = i <= 5 ? powerIconForSlot(s, i) : '';
      slot.appendChild(icon);
    }
    els.grizzlyTrack.appendChild(slot);
  }
  els.chaosTrack.innerHTML = '';
  for (let i = 1; i <= 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = `chaos-dot ${i <= s.electionTracker ? 'filled' : ''}`;
    els.chaosTrack.appendChild(dot);
  }
}

function button(text, className, onClick, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${className}`;
  b.textContent = text;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function notice(text) {
  const d = document.createElement('div');
  d.className = 'notice';
  d.textContent = text;
  return d;
}

function renderVoteResult(s) {
  if (!s.lastVoteResult) return null;
  const wrap = document.createElement('div');
  wrap.className = 'vote-result';
  const heading = document.createElement('div');
  heading.className = 'notice';
  heading.textContent = `Last vote: ${s.lastVoteResult.yes} yes / ${s.lastVoteResult.no} no — ${s.lastVoteResult.passed ? 'PASSED' : 'FAILED'}`;
  wrap.appendChild(heading);
  s.lastVoteResult.votes.forEach((v) => {
    const line = document.createElement('div');
    line.className = 'vote-line';
    const name = document.createElement('span');
    const choice = document.createElement('strong');
    name.textContent = v.name;
    choice.textContent = v.choice === 'yes' ? '🐾 YES' : '🌲 NO';
    line.append(name, choice);
    wrap.appendChild(line);
  });
  return wrap;
}

function renderPolicyChoices(policies, onChoose, verb) {
  const grid = document.createElement('div');
  grid.className = 'choice-grid';
  policies.forEach((policy, index) => {
    const isHoney = policy === 'honey';
    const b = button('', `policy-choice ${isHoney ? 'btn-honey' : 'btn-grizzly'}`, () => onChoose(index));
    const emoji = document.createElement('span');
    emoji.className = 'policy-emoji';
    emoji.textContent = isHoney ? '🍯' : '🐻';
    const label = document.createElement('span');
    label.textContent = `${verb} ${isHoney ? 'Honey' : 'Grizzly'}`;
    b.append(emoji, label);
    grid.appendChild(b);
  });
  els.actionArea.appendChild(grid);
}

function renderAction(s) {
  els.actionArea.innerHTML = '';
  if (s.lastVoteResult && s.phase !== 'vote') {
    const result = renderVoteResult(s);
    if (result) els.actionArea.appendChild(result);
  }
  if (!s.me.alive && s.phase !== 'gameover') {
    els.actionArea.appendChild(notice('You are no longer an active player. Keep secret role information to yourself until the game ends.'));
    return;
  }
  if (s.phase === 'nominate') {
    if (s.me.id !== s.currentPresidentId) {
      els.actionArea.appendChild(notice(`Waiting for ${playerName(s.currentPresidentId)} to nominate.`));
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'choice-grid';
    s.players.filter((p) => s.eligibleChancellorIds.includes(p.id)).forEach((p) => {
      grid.appendChild(button(`${p.name}  →`, 'btn-secondary player-choice', () => action('nominate', { playerId: p.id })));
    });
    els.actionArea.appendChild(grid);
    return;
  }
  if (s.phase === 'vote') {
    if (s.hasVoted) {
      els.actionArea.appendChild(notice(`Vote locked in. ${s.votesCast} / ${s.livingCount} votes submitted.`));
      return;
    }
    const buttons = document.createElement('div');
    buttons.className = 'vote-buttons';
    const yes = button('🐾 YES', 'vote-yes', () => { yes.disabled = true; no.disabled = true; action('vote', { choice: 'yes' }); });
    const no = button('🌲 NO', 'vote-no', () => { yes.disabled = true; no.disabled = true; action('vote', { choice: 'no' }); });
    buttons.append(yes, no);
    els.actionArea.append(buttons, notice(`${s.votesCast} / ${s.livingCount} votes submitted. Votes reveal together.`));
    return;
  }
  if (s.phase === 'president_discard') {
    if (s.me.id !== s.currentPresidentId) {
      els.actionArea.appendChild(notice('Only the President can see the three policies right now.'));
      return;
    }
    renderPolicyChoices(s.privatePolicies, (index) => action('president_discard', { index }), 'Discard');
    return;
  }
  if (s.phase === 'chancellor_discard') {
    if (s.me.id !== s.currentChancellorId) {
      els.actionArea.appendChild(notice('Only the Chancellor can see the remaining policies right now.'));
      return;
    }
    renderPolicyChoices(s.privatePolicies, (index) => action('chancellor_discard', { index }), 'Discard');
    if (s.vetoUnlocked && !s.vetoRejected) els.actionArea.appendChild(button('Request veto of both policies', 'btn-ghost', () => action('request_veto')));
    else if (s.vetoRejected) els.actionArea.appendChild(notice('The President rejected the veto. You must enact one of these policies.'));
    return;
  }
  if (s.phase === 'veto_president') {
    if (s.me.id !== s.currentPresidentId) {
      els.actionArea.appendChild(notice('Waiting for the President to accept or reject the veto.'));
      return;
    }
    const row = document.createElement('div');
    row.className = 'vote-buttons';
    row.append(
      button('Accept veto', 'btn-secondary', () => action('veto_response', { agree: true })),
      button('Reject veto', 'btn-ghost', () => action('veto_response', { agree: false }))
    );
    els.actionArea.appendChild(row);
    return;
  }
  if (s.phase === 'executive') {
    if (s.me.id !== s.currentPresidentId) {
      els.actionArea.appendChild(notice(`Waiting for ${playerName(s.currentPresidentId)} to use the Presidential Bear Power.`));
      return;
    }
    if (s.executivePower === 'peek') {
      els.actionArea.appendChild(button('👀 Peek at next 3 policies', 'btn-primary', () => action('executive_action')));
      return;
    }
    const candidates = s.players.filter((p) => p.alive && p.id !== s.me.id);
    const grid = document.createElement('div');
    grid.className = 'choice-grid';
    candidates.forEach((p) => {
      const klass = s.executivePower === 'execute' ? 'btn-danger player-choice' : 'btn-secondary player-choice';
      const label = s.executivePower === 'execute' ? `Banish ${p.name}` : p.name;
      grid.appendChild(button(label, klass, () => action('executive_action', { playerId: p.id })));
    });
    els.actionArea.appendChild(grid);
  }
}

function renderIntel(s) {
  const has = s.privateIntel.length > 0;
  els.intelCard.classList.toggle('hidden', !has);
  els.intelList.innerHTML = '';
  s.privateIntel.forEach((item) => {
    const d = document.createElement('div');
    d.className = 'intel-item';
    d.textContent = item.text;
    els.intelList.appendChild(d);
  });
}

function renderLogs(s) {
  els.logList.innerHTML = '';
  [...s.logs].reverse().forEach((item) => {
    const d = document.createElement('div');
    d.className = 'log-item';
    d.textContent = item.text;
    els.logList.appendChild(d);
  });
}

function renderGameOver(s) {
  const over = s.phase === 'gameover';
  els.gameOverCard.classList.toggle('hidden', !over);
  if (!over) return;
  els.winnerEmoji.textContent = s.winner === 'honey' ? '🍯🏆' : '🐻🏆';
  els.winnerTitle.textContent = s.winner === 'honey' ? 'Honey Bears win!' : 'Grizzlies win!';
  els.winnerReason.textContent = s.winReason || '';
  els.againBtn.classList.toggle('hidden', !s.isHost);
}

function renderGame(s) {
  if (!s.started) return;
  renderRole(s);
  renderTracks(s);
  renderPlayerList(els.gamePlayers, s.players, true);
  els.livingCount.textContent = `${s.livingCount} alive`;
  const [title, text] = phaseCopy(s);
  els.phaseTitle.textContent = title;
  els.phaseText.textContent = text;
  els.phaseKicker.textContent = s.phase === 'gameover' ? 'final result' : 'current turn';
  renderAction(s);
  renderIntel(s);
  renderLogs(s);
  renderGameOver(s);
}

function render(s) {
  state = s;
  els.homeView.classList.add('hidden');
  els.gameView.classList.remove('hidden');
  els.roomCodeDisplay.textContent = s.roomCode;
  renderLobby(s);
  renderGame(s);
}

els.createBtn.addEventListener('click', async () => {
  try {
    const data = await api('/api/create', { method: 'POST', body: { name: els.nameInput.value.trim() } });
    saveSession(data.session);
    render(data.state);
    connectStream(data.session);
  } catch (err) { toast(err.message); }
});

els.joinBtn.addEventListener('click', async () => {
  try {
    const data = await api('/api/join', { method: 'POST', body: { name: els.nameInput.value.trim(), roomCode: els.roomCodeInput.value.trim() } });
    saveSession(data.session);
    render(data.state);
    connectStream(data.session);
  } catch (err) { toast(err.message); }
});

els.roomCodeInput.addEventListener('input', () => {
  els.roomCodeInput.value = els.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
});
els.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.createBtn.click(); });
els.startBtn.addEventListener('click', () => action('start_game'));
els.leaveBtn.addEventListener('click', () => action('leave_room'));
els.againBtn.addEventListener('click', () => action('return_to_lobby'));
els.roleToggle.addEventListener('click', () => { roleVisible = true; if (state) renderRole(state); });
els.hideRoleBtn.addEventListener('click', () => { roleVisible = false; if (state) renderRole(state); });

(async function boot() {
  setConnection(false);
  const saved = savedSession();
  if (!saved?.roomCode || !saved?.playerToken) return;
  try {
    const params = new URLSearchParams({ roomCode: saved.roomCode, playerToken: saved.playerToken });
    const data = await api(`/api/state?${params.toString()}`);
    saveSession(saved);
    render(data.state);
    connectStream(saved);
  } catch (err) {
    clearSession();
    toast('Your old den has expired. Create or join a new one.');
  }
})();
