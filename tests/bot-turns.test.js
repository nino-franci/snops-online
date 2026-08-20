const assert = require('assert');
const { createRoom, scheduleBot, startRound, completeTrickAfterPause } = require('../server');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fillFourPlayerRoom(room) {
  room.players.push(
    { name: 'Bot 1', token: 'bot-1', socketId: null, connected: true, isBot: true },
    { name: 'Bot 2', token: 'bot-2', socketId: null, connected: true, isBot: true },
    { name: 'Bot 3', token: 'bot-3', socketId: null, connected: true, isBot: true }
  );
}

async function testBotsAdvanceFromCutPhase() {
  const room = createRoom({ id: 'host-socket' }, {
    name: 'Human',
    playerCount: 4,
    targetScore: 25,
    strictRules: true,
    token: 'host-token'
  });

  fillFourPlayerRoom(room);

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


async function testCompletedTrickPausesBeforeResolving() {
  const room = createRoom({ id: 'host-socket-2' }, {
    name: 'Human',
    playerCount: 4,
    targetScore: 25,
    strictRules: true,
    token: 'host-token-2'
  });
  fillFourPlayerRoom(room);

  room.phase = 'playing';
  room.contract = 'normal';
  room.bidderIndex = 0;
  room.trumpSuit = 'hearts';
  room.multiplier = 1;
  room.hands = [[], [], [], []];
  room.captured = [[], [], [], []];
  room.roundPoints = [0, 0, 0, 0];
  room.trickCounts = [0, 0, 0, 0];
  room.trick = [
    { playerIndex: 0, card: { id: 'clubs-J', suit: 'clubs', rank: 'J', points: 2 } },
    { playerIndex: 1, card: { id: 'clubs-A', suit: 'clubs', rank: 'A', points: 11 } },
    { playerIndex: 2, card: { id: 'clubs-Q', suit: 'clubs', rank: 'Q', points: 3 } },
    { playerIndex: 3, card: { id: 'clubs-K', suit: 'clubs', rank: 'K', points: 4 } }
  ];

  completeTrickAfterPause(room);

  assert.strictEqual(room.trickCollecting, true);
  assert.strictEqual(room.pendingTrickWinnerIndex, 1);
  assert.strictEqual(room.turnIndex, null);
  assert.strictEqual(room.trick.length, 4, 'cards should stay visible during the pause');

  await wait(2050);

  assert.strictEqual(room.trickCollecting, false);
  assert.strictEqual(room.trick.length, 0, 'cards should be collected after the pause');
  assert.strictEqual(room.lastTrickWinner, 1);
}

(async () => {
  await testBotsAdvanceFromCutPhase();
  await testCompletedTrickPausesBeforeResolving();
  console.log('PASS bots advance from cut phase and completed tricks pause before resolving');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
