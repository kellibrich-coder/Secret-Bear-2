const test = require('node:test');
const assert = require('node:assert/strict');
const { server, rooms, roleCounts, powerFor, makePolicyDeck } = require('../server');

let base;

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function getState(session) {
  const q = new URLSearchParams({ roomCode: session.roomCode, playerToken: session.playerToken });
  const res = await fetch(`${base}/api/state?${q}`);
  return (await res.json()).state;
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  rooms.clear();
  await new Promise((resolve) => server.close(resolve));
});

test('role counts match 5–10 player setup', () => {
  assert.deepEqual(roleCounts(5), { honey: 3, grizzly: 1 });
  assert.deepEqual(roleCounts(6), { honey: 4, grizzly: 1 });
  assert.deepEqual(roleCounts(7), { honey: 4, grizzly: 2 });
  assert.deepEqual(roleCounts(8), { honey: 5, grizzly: 2 });
  assert.deepEqual(roleCounts(9), { honey: 5, grizzly: 3 });
  assert.deepEqual(roleCounts(10), { honey: 6, grizzly: 3 });
});

test('policy deck contains 6 Honey and 11 Grizzly policies', () => {
  const deck = makePolicyDeck();
  assert.equal(deck.length, 17);
  assert.equal(deck.filter((x) => x === 'honey').length, 6);
  assert.equal(deck.filter((x) => x === 'grizzly').length, 11);
});

test('presidential powers use the correct player-count tracks', () => {
  assert.equal(powerFor(5, 1), null);
  assert.equal(powerFor(5, 3), 'peek');
  assert.equal(powerFor(5, 4), 'execute');
  assert.equal(powerFor(7, 2), 'investigate');
  assert.equal(powerFor(7, 3), 'special_election');
  assert.equal(powerFor(9, 1), 'investigate');
  assert.equal(powerFor(9, 2), 'investigate');
  assert.equal(powerFor(9, 3), 'special_election');
});

test('five players can join, start, elect a government, and enact a policy privately', async () => {
  const sessions = [];
  const created = await post('/api/create', { name: 'Bear1' });
  sessions.push(created.session);
  const code = created.session.roomCode;
  for (let i = 2; i <= 5; i += 1) {
    const joined = await post('/api/join', { name: `Bear${i}`, roomCode: code });
    sessions.push(joined.session);
  }

  let out = await post('/api/action', { ...sessions[0], action: 'start_game', payload: {} });
  assert.equal(out.state.phase, 'nominate');
  const president = sessions.find((s) => s.playerId === out.state.currentPresidentId);
  const candidateId = out.state.eligibleChancellorIds[0];

  out = await post('/api/action', { ...president, action: 'nominate', payload: { playerId: candidateId } });
  assert.equal(out.state.phase, 'vote');

  for (const session of sessions) {
    out = await post('/api/action', { ...session, action: 'vote', payload: { choice: 'yes' } });
  }
  assert.equal(out.state.phase, 'president_discard');
  assert.equal(out.state.lastVoteResult.yes, 5);

  const presState = await getState(president);
  assert.equal(presState.privatePolicies.length, 3);
  for (const publicPlayer of presState.players) assert.equal(Object.hasOwn(publicPlayer, 'role'), false);

  out = await post('/api/action', { ...president, action: 'president_discard', payload: { index: 0 } });
  const chancellor = sessions.find((s) => s.playerId === out.state.currentChancellorId);
  const chState = await getState(chancellor);
  assert.equal(chState.privatePolicies.length, 2);

  out = await post('/api/action', { ...chancellor, action: 'chancellor_discard', payload: { index: 0 } });
  assert.equal(out.state.honeyPolicies + out.state.grizzlyPolicies, 1);
});
