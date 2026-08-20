const assert = require('assert');
const { createRoom, scheduleBot, startRound, queueTrickResolution, TRICK_REVIEW_MS, TRICK_COLLECT_MS } = require('../server');

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

(async () => {
  await testBotsAdvanceFromCutPhase();
  console.log('PASS bots advance from cut phase');
  await testCompletedTrickStaysVisibleBeforeCollection();
  console.log('PASS completed trick review and collection delay');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
