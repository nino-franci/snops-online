const assert = require('assert');
const { createRoom, scheduleBot, startRound, queueTrickResolution, publicState, publicRoomList, TRICK_REVIEW_MS, TRICK_COLLECT_MS } = require('../server');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testBotsAdvanceFromCutPhase() {
  const room = createRoom({ id: 'host-socket' }, {
    name: 'Human',
    playerCount: 4,
    targetScore: 25,
    strictRules: true,
    token: 'host-token'
  });

  room.players.push(
    { name: 'Bot 1', token: 'bot-1', socketId: null, connected: true, isBot: true },
    { name: 'Bot 2', token: 'bot-2', socketId: null, connected: true, isBot: true },
    { name: 'Bot 3', token: 'bot-3', socketId: null, connected: true, isBot: true }
  );

  room.dealerIndex = 0;
  startRound(room);

  assert.strictEqual(room.phase, 'cut');
  assert.strictEqual(room.cutterIndex, 1);
  assert.strictEqual(room.players[room.cutterIndex].isBot, true);

  scheduleBot(room);
  await wait(1700);

  assert.notStrictEqual(room.phase, 'cut', 'bot should choose cut/knock and advance the game');
  assert.ok(room.log.some((entry) => /predvig|udarec po kartah/.test(entry.text)), 'bot cut action should be logged');
}

async function testCompletedTrickStaysVisibleBeforeCollection() {
  const room = createRoom({ id: 'host-socket-2' }, {
    name: 'Human', playerCount: 4, targetScore: 25, strictRules: true, token: 'host-token-2'
  });
  room.players.push(
    { name: 'P2', token: 'p2', socketId: null, connected: true, isBot: false },
    { name: 'P3', token: 'p3', socketId: null, connected: true, isBot: false },
    { name: 'P4', token: 'p4', socketId: null, connected: true, isBot: false }
  );
  room.phase = 'playing'; room.contract = 'normal'; room.trumpSuit = 'hearts'; room.bidderIndex = 0;
  room.hands = [[{ id:'clubs-J', suit:'clubs', rank:'J', points:2 }],[],[],[]];
  room.roundPoints = [0,0,0,0]; room.trickCounts = [0,0,0,0]; room.captured = [[],[],[],[]]; room.melds = [];
  room.trick = [
    { playerIndex:0, card:{ id:'spades-J', suit:'spades', rank:'J', points:2 } },
    { playerIndex:1, card:{ id:'spades-Q', suit:'spades', rank:'Q', points:3 } },
    { playerIndex:2, card:{ id:'spades-K', suit:'spades', rank:'K', points:4 } },
    { playerIndex:3, card:{ id:'spades-A', suit:'spades', rank:'A', points:11 } }
  ];

  queueTrickResolution(room);
  assert.strictEqual(room.trick.length, 4, 'completed trick must remain visible during review');
  assert.strictEqual(room.trickWinner, 3, 'winner must be available to clients for collection animation');
  await wait(TRICK_REVIEW_MS + 50);
  assert.strictEqual(room.trick.length, 4, 'trick must remain on table while collection animates');
  await wait(TRICK_COLLECT_MS + 100);
  assert.strictEqual(room.trick.length, 0, 'trick must resolve after review and collection animation');
  assert.strictEqual(room.lastTrickWinner, 3);
}

function testRoundScorePrivacy() {
  const room = createRoom({ id: 'host-private' }, {
    name: 'P1', playerCount: 4, targetScore: 25, strictRules: true, token: 'host-private-token'
  });
  room.players.push(
    { name: 'P2', token: 'private-2', socketId: 'socket-2', connected: true, isBot: false },
    { name: 'P3', token: 'private-3', socketId: 'socket-3', connected: true, isBot: false },
    { name: 'P4', token: 'private-4', socketId: 'socket-4', connected: true, isBot: false }
  );
  room.roundPoints = [20, 11, 14, 10];
  room.trickCounts = [1, 1, 1, 1];
  room.captured = [Array(4).fill({}), Array(4).fill({}), Array(4).fill({}), Array(4).fill({})];
  room.teamPileOwner = [0, 1];

  const state = publicState(room, 'host-private');
  assert.strictEqual(state.myTeamRoundPoints, 34);
  assert.strictEqual(state.myTeamCapturedCount, 8);
  assert.strictEqual(state.myTeamPileOwner, 0);
  assert.strictEqual(state.players[1].roundPoints, null, 'opponent round points must stay private');
  assert.strictEqual(state.players[3].tricks, null, 'opponent trick count must stay private');
  assert.strictEqual(state.teams[1].roundPoints, undefined, 'opponent team score must not be serialized');
  assert.deepStrictEqual(state.teams.map((team) => team.penalty), [0, 0], 'match score remains public');
}

function testPublicRoomDiscovery() {
  const publicRoom = createRoom({ id: 'public-host' }, { name:'Ana', playerCount:4, targetScore:25, strictRules:true, isPublic:true, token:'public-token' });
  const privateRoom = createRoom({ id: 'private-host' }, { name:'Miha', playerCount:4, targetScore:25, strictRules:true, isPublic:false, token:'private-token' });
  const rooms = publicRoomList();
  assert.ok(rooms.some((room) => room.code === publicRoom.code && room.name === 'Soba igralca Ana'));
  assert.ok(!rooms.some((room) => room.code === privateRoom.code), 'private rooms must not be discoverable');
  const state = publicState(publicRoom, 'public-host');
  assert.strictEqual(state.isPublic, true);
  assert.deepStrictEqual(state.teams.map((team) => team.name), ['Ekipa 1', 'Ekipa 2']);
}

(async () => {
  await testBotsAdvanceFromCutPhase();
  console.log('PASS bots advance from cut phase');
  await testCompletedTrickStaysVisibleBeforeCollection();
  console.log('PASS completed trick review and collection delay');
  testRoundScorePrivacy();
  console.log('PASS current-round team score remains private');
  testPublicRoomDiscovery();
  console.log('PASS public room discovery hides private rooms');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
