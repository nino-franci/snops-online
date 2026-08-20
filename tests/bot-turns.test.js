const assert = require('assert');
const { createRoom, scheduleBot, startRound } = require('../server');

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

(async () => {
  await testBotsAdvanceFromCutPhase();
  console.log('PASS bots advance from cut phase');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
