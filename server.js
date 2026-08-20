const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['J', 'Q', 'K', '10', 'A'];
const CARD_POINTS = { J: 2, Q: 3, K: 4, '10': 10, A: 11 };
const RANK_POWER = { J: 1, Q: 2, K: 3, '10': 4, A: 5 };

const CONTRACTS = {
  normal: { label: 'Navadna igra', value: 1, trump: true, melds: true },
  schnops: { label: 'Šnops', value: 6, trump: true, melds: true },
  small: { label: 'Mali', value: 7, trump: false, melds: false },
  big: { label: 'Veliki', value: 9, trump: false, melds: false },
  big_trump: { label: 'Veliki z aduti', value: 12, trump: true, melds: false },
  eighteen: { label: 'Igra 18', value: 18, trump: false, melds: false, instant: true },
  twentyfour: { label: 'Igra 24', value: 24, trump: false, melds: false, instant: true }
};

function cleanName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20) || 'Igralec';
}
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  while (rooms.has(code));
  return code;
}
function makeToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function deck20() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank, points: CARD_POINTS[rank] })));
}
function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function nextIndex(room, idx) { return (idx + 1) % room.playerCount; }
function prevIndex(room, idx) { return (idx - 1 + room.playerCount) % room.playerCount; }
function log(room, text) {
  room.log.push({ id: `${Date.now()}-${Math.random()}`, text, at: Date.now() });
  if (room.log.length > 100) room.log.shift();
}
function playerBySocket(room, socketId) {
  const index = room.players.findIndex((p) => p.socketId === socketId);
  return { player: room.players[index], index };
}
function teamOf(index) { return index % 2; }
function teamMembers(team) { return team === 0 ? [0, 2] : [1, 3]; }
function otherTeam(team) { return team === 0 ? 1 : 0; }
function teamName(room, team) { return teamMembers(team).map((i) => room.players[i]?.name).filter(Boolean).join(' + '); }

function createRoom(hostSocket, payload) {
  const playerCount = Number(payload.playerCount) === 3 ? 3 : 4;
  const targetScore = Math.max(7, Math.min(99, Number(payload.targetScore) || 25));
  const token = payload.token || makeToken();
  const room = {
    code: makeCode(), hostToken: token, playerCount, targetScore,
    players: [{ name: cleanName(payload.name), token, socketId: hostSocket.id, connected: true }],
    phase: 'lobby', dealerIndex: Math.floor(Math.random() * playerCount), roundNo: 0,
    cutterIndex: null, callerIndex: null, dealMode: null, deck: [], hands: [], pendingSecond: [], talon: [],
    trumpSuit: null, auction: null, contract: null, bidderIndex: null,
    contra: null, multiplier: 1,
    trick: [], trickLeader: null, turnIndex: null, trickNo: 0, lastTrickWinner: null, smallHistory: [],
    roundPoints: Array(playerCount).fill(0), trickCounts: Array(playerCount).fill(0), captured: [], melds: [],
    teamPenalty: [0, 0], roundResult: null, log: [], chat: []
  };
  rooms.set(room.code, room);
  log(room, `${room.players[0].name} je ustvaril sobo ${room.code}.`);
  return room;
}

function startRound(room) {
  room.roundNo += 1;
  room.dealerIndex = room.roundNo === 1 ? room.dealerIndex : nextIndex(room, room.dealerIndex);
  // Sedezni dogovor za igro na 4: igralec desno od delivca izbira predvig/udarec,
  // igralec levo od delivca pa dobi prve karte in rufa aduta.
  room.cutterIndex = nextIndex(room, room.dealerIndex);
  room.callerIndex = prevIndex(room, room.dealerIndex);
  room.dealMode = null;
  room.deck = shuffle(deck20());
  room.hands = Array.from({ length: room.playerCount }, () => []);
  room.pendingSecond = [];
  room.talon = [];
  room.trumpSuit = null;
  room.auction = null;
  room.contract = null;
  room.bidderIndex = null;
  room.contra = null;
  room.multiplier = 1;
  room.trick = [];
  room.trickLeader = null;
  room.turnIndex = null;
  room.trickNo = 0;
  room.lastTrickWinner = null;
  room.smallHistory = [];
  room.roundPoints = Array(room.playerCount).fill(0);
  room.trickCounts = Array(room.playerCount).fill(0);
  room.captured = Array.from({ length: room.playerCount }, () => []);
  room.melds = [];
  room.roundResult = null;

  if (room.playerCount === 4) {
    room.phase = 'cut';
    log(room, `${room.players[room.dealerIndex].name} deli. ${room.players[room.cutterIndex].name} (desno od delivca) izbere predvig ali udarec. ${room.players[room.callerIndex].name} (levo od delivca) bo rufal aduta.`);
  } else {
    // 3-player pravila ostajajo začasno po prejšnji različici; natančno jih bomo prilagodili posebej.
    legacyDealThree(room);
  }
}

function legacyDealThree(room) {
  for (let r = 0; r < 3; r++) for (let p = 0; p < 3; p++) room.hands[p].push(room.deck.shift());
  room.talon = [room.deck.shift(), room.deck.shift()];
  room.pendingSecond = Array.from({ length: 3 }, () => []);
  for (let r = 0; r < 3; r++) for (let p = 0; p < 3; p++) room.pendingSecond[p].push(room.deck.shift());
  room.phase = 'choose_trump';
  log(room, `${room.players[room.callerIndex].name} izbira aduta za igro na 3.`);
}

function dealFourFirst(room, mode) {
  room.dealMode = mode;
  if (mode === 'cut') {
    // Prve 3 karte dobi igralec levo od delivca (caller), nato se deli po sedeznem vrstnem redu.
    const order = [];
    let p = room.callerIndex;
    for (let i = 0; i < 4; i++) { order.push(p); p = nextIndex(room, p); }
    for (let r = 0; r < 3; r++) for (const seat of order) room.hands[seat].push(room.deck.shift());
    room.pendingSecond = Array.from({ length: 4 }, () => []);
    for (let r = 0; r < 2; r++) for (const seat of order) room.pendingSecond[seat].push(room.deck.shift());
  } else {
    // Udarec: prvi igralec dobi 3 in rufa; po rufu dobi še 2, ostali po 5.
    for (let i = 0; i < 3; i++) room.hands[room.callerIndex].push(room.deck.shift());
  }
  room.phase = 'choose_call';
  log(room, `${room.players[room.callerIndex].name} ima prve 3 karte in rufa barvo aduta.`);
}

function completeFourDeal(room) {
  if (room.dealMode === 'cut') {
    for (let i = 0; i < 4; i++) room.hands[i].push(...room.pendingSecond[i]);
    room.pendingSecond = [];
  } else {
    for (let i = 0; i < 2; i++) room.hands[room.callerIndex].push(room.deck.shift());
    let p = nextIndex(room, room.callerIndex);
    while (p !== room.callerIndex) {
      for (let i = 0; i < 5; i++) room.hands[p].push(room.deck.shift());
      p = nextIndex(room, p);
    }
  }
  beginAuction(room);
}

function beginAuction(room) {
  room.phase = 'auction';
  room.auction = { currentIndex: room.callerIndex, best: null, passesSinceBid: 0, totalPasses: 0 };
  log(room, 'Licitacija: Dalje ali Višam. Če vsi rečejo dalje, se igra navadna igra.');
}

function canBidInstant(room, index, contract) {
  const hand = room.hands[index] || [];
  if (hand.length !== 5) return false;
  if (contract === 'eighteen') return hand.every((c) => c.suit === hand[0].suit);
  if (contract === 'twentyfour') return hand.every((c) => c.suit === room.trumpSuit);
  return true;
}

function finishAuction(room) {
  if (!room.auction?.best) {
    room.contract = 'normal';
    room.bidderIndex = room.callerIndex;
  } else {
    room.contract = room.auction.best.contract;
    room.bidderIndex = room.auction.best.playerIndex;
  }
  room.auction = null;
  log(room, `${room.players[room.bidderIndex].name} igra ${CONTRACTS[room.contract].label}.`);

  if (CONTRACTS[room.contract].instant) {
    return finishRound(room, teamOf(room.bidderIndex), otherTeam(teamOf(room.bidderIndex)), CONTRACTS[room.contract].value, `${CONTRACTS[room.contract].label} je avtomatsko uspela.`);
  }
  beginContra(room);
}

function beginContra(room) {
  const playingTeam = teamOf(room.bidderIndex);
  room.phase = 'contra';
  room.multiplier = 1;
  room.contra = { stage: 0, actionTeam: otherTeam(playingTeam), passed: [] };
  log(room, `${teamName(room, room.contra.actionTeam)} lahko rečeta kontra ali brez kontre.`);
}

function beginPlay(room) {
  room.phase = 'playing';
  room.trickLeader = room.contract === 'normal' ? room.callerIndex : room.bidderIndex;
  room.turnIndex = room.trickLeader;
  room.contra = null;
  log(room, `Igra se začne. Vrednost x${room.multiplier}.`);
}

function compareCards(a, b, leadSuit, trumpSuit, trumpEnabled) {
  const aTrump = trumpEnabled && a.suit === trumpSuit;
  const bTrump = trumpEnabled && b.suit === trumpSuit;
  if (aTrump !== bTrump) return aTrump ? 1 : -1;
  if (a.suit === b.suit) return Math.sign(RANK_POWER[a.rank] - RANK_POWER[b.rank]);
  if (a.suit === leadSuit && b.suit !== leadSuit) return 1;
  if (b.suit === leadSuit && a.suit !== leadSuit) return -1;
  return 0;
}

function currentWinningPlay(room) {
  if (!room.trick.length) return null;
  const leadSuit = room.trick[0].card.suit;
  const trumpEnabled = ['normal', 'schnops', 'big_trump'].includes(room.contract);
  let best = room.trick[0];
  for (let i = 1; i < room.trick.length; i++) {
    if (compareCards(room.trick[i].card, best.card, leadSuit, room.trumpSuit, trumpEnabled) > 0) best = room.trick[i];
  }
  return best;
}

function legalCardIds(room, playerIndex) {
  const hand = room.hands[playerIndex] || [];
  if (room.phase !== 'playing' || room.turnIndex !== playerIndex) return [];
  if (!room.trick.length) return hand.map((c) => c.id);

  const leadSuit = room.trick[0].card.suit;
  const follow = hand.filter((c) => c.suit === leadSuit);
  const strict = room.contract === 'normal';

  if (!strict) return (follow.length ? follow : hand).map((c) => c.id);

  const winner = currentWinningPlay(room);
  if (follow.length) {
    const beating = follow.filter((c) => compareCards(c, winner.card, leadSuit, room.trumpSuit, true) > 0);
    return (beating.length ? beating : follow).map((c) => c.id);
  }

  const trumps = hand.filter((c) => c.suit === room.trumpSuit);
  if (trumps.length) {
    if (winner.card.suit === room.trumpSuit) {
      const over = trumps.filter((c) => RANK_POWER[c.rank] > RANK_POWER[winner.card.rank]);
      return (over.length ? over : trumps).map((c) => c.id);
    }
    return trumps.map((c) => c.id);
  }
  return hand.map((c) => c.id);
}

function eligibleMelds(room, playerIndex) {
  if (room.phase !== 'playing' || room.turnIndex !== playerIndex) return [];
  if (!['normal', 'schnops'].includes(room.contract)) return [];
  if (room.contract === 'schnops' && playerIndex !== room.bidderIndex) return [];
  const hand = room.hands[playerIndex] || [];
  return SUITS.filter((suit) => {
    const hasK = hand.some((c) => c.suit === suit && c.rank === 'K');
    const hasQ = hand.some((c) => c.suit === suit && c.rank === 'Q');
    const already = room.melds.some((m) => m.playerIndex === playerIndex && m.suit === suit);
    return hasK && hasQ && !already;
  }).map((suit) => ({ suit, points: suit === room.trumpSuit ? 40 : 20 }));
}

function activatePendingMelds(room, team) {
  if (room.playerCount !== 4) return;
  const hasTrick = teamMembers(team).some((i) => room.trickCounts[i] > 0);
  if (!hasTrick) return;
  for (const meld of room.melds) {
    if (meld.activated || teamOf(meld.playerIndex) !== team) continue;
    meld.activated = true;
    room.roundPoints[meld.playerIndex] += meld.points;
    log(room, `${room.players[meld.playerIndex].name}: ${meld.points} se prišteje ekipi.`);
  }
}

function teamRoundScore(room, team) {
  return teamMembers(team).reduce((sum, i) => sum + (room.roundPoints[i] || 0), 0);
}
function teamTricks(room, team) {
  return teamMembers(team).reduce((sum, i) => sum + (room.trickCounts[i] || 0), 0);
}

function finishRound(room, winnerTeam, loserTeam, baseAmount, reason) {
  const amount = baseAmount * room.multiplier;
  room.teamPenalty[loserTeam] += amount;
  room.roundResult = {
    winnerTeam, loserTeam, winners: teamMembers(winnerTeam), losers: teamMembers(loserTeam),
    amount, baseAmount, multiplier: room.multiplier, reason, contract: room.contract,
    teamPenalty: room.teamPenalty.slice()
  };
  room.phase = room.teamPenalty.some((v) => v >= room.targetScore) ? 'match_end' : 'round_end';
  room.turnIndex = null;
  log(room, `${teamName(room, loserTeam)} pišeta ${amount}. ${reason}`);
}

function normalFinishByCount(room, countingTeam) {
  activatePendingMelds(room, countingTeam);
  const score = teamRoundScore(room, countingTeam);
  if (score < 66 || teamTricks(room, countingTeam) < 1) return false;
  const loserTeam = otherTeam(countingTeam);
  const loserScore = teamRoundScore(room, loserTeam);
  const loserTrickCount = teamTricks(room, loserTeam);
  const amount = loserTrickCount === 0 ? 3 : loserScore <= 32 ? 2 : 1;
  finishRound(room, countingTeam, loserTeam, amount, `${teamName(room, countingTeam)} je pravilno štela ${score}.`);
  return true;
}

function resolveSmallTrick(room) {
  const bidder = room.bidderIndex;
  const bidderPlay = room.trick.find((p) => p.playerIndex === bidder);
  if (!bidderPlay) return;
  // Pri Malem se karte NE pobirajo. Shranimo vsak končan štih, da lahko
  // klient vseh 5 krogov vizualno pusti na mizi od sredine proti igralcem.
  const completedTrick = room.trick.map((p) => ({ playerIndex: p.playerIndex, card: p.card }));
  room.smallHistory.push(completedTrick);
  const lowerSameSuit = room.trick.some((p) => p.playerIndex !== bidder && p.card.suit === bidderPlay.card.suit && RANK_POWER[p.card.rank] < RANK_POWER[bidderPlay.card.rank]);
  room.trickNo += 1;
  if (lowerSameSuit) {
    room.trick = [];
    return finishRound(room, otherTeam(teamOf(bidder)), teamOf(bidder), CONTRACTS.small.value, 'Mali ni uspel: v enem štihu je padla nižja karta iste barve.');
  }
  room.trick = [];
  if (room.trickNo >= 5) return finishRound(room, teamOf(bidder), otherTeam(teamOf(bidder)), CONTRACTS.small.value, 'Mali je uspel v vseh 5 štihih.');
  room.trickLeader = bidder;
  room.turnIndex = bidder;
}

function resolveStandardTrick(room) {
  const winning = currentWinningPlay(room);
  const winner = winning.playerIndex;
  const points = room.trick.reduce((sum, p) => sum + p.card.points, 0);
  room.roundPoints[winner] += points;
  room.trickCounts[winner] += 1;
  room.captured[winner].push(...room.trick.map((p) => p.card));
  room.lastTrickWinner = winner;
  room.trickNo += 1;
  activatePendingMelds(room, teamOf(winner));
  log(room, `${room.players[winner].name} pobere štih (+${points}).`);
  room.trick = [];
  room.trickLeader = winner;
  room.turnIndex = winner;

  const bidder = room.bidderIndex;
  const bidderTeam = teamOf(bidder);
  const cardsLeft = room.hands.reduce((sum, h) => sum + h.length, 0);

  if (room.contract === 'schnops') {
    if (winner !== bidder) return finishRound(room, otherTeam(bidderTeam), bidderTeam, 6, 'Šnops ni uspel: štih je pobral drug igralec.');
    if (room.trickNo >= 3) {
      const score = teamRoundScore(room, bidderTeam);
      if (score >= 66) return finishRound(room, bidderTeam, otherTeam(bidderTeam), 6, `Šnops uspel: ${score} točk v 3 štihih.`);
      return finishRound(room, otherTeam(bidderTeam), bidderTeam, 6, `Šnops ni uspel: po 3 štihih samo ${score} točk.`);
    }
    return;
  }

  if (room.contract === 'big' || room.contract === 'big_trump') {
    if (winner !== bidder) return finishRound(room, otherTeam(bidderTeam), bidderTeam, CONTRACTS[room.contract].value, `${CONTRACTS[room.contract].label} ni uspel: štih je pobral drug igralec.`);
    if (cardsLeft === 0) return finishRound(room, bidderTeam, otherTeam(bidderTeam), CONTRACTS[room.contract].value, `${CONTRACTS[room.contract].label} uspel: vseh 5 štihov.`);
    return;
  }

  if (room.contract === 'normal' && cardsLeft === 0) {
    const t0 = teamRoundScore(room, 0);
    const t1 = teamRoundScore(room, 1);
    const winnerTeam = t0 === t1 ? teamOf(winner) : (t0 > t1 ? 0 : 1);
    const loserTeam = otherTeam(winnerTeam);
    const loserScore = teamRoundScore(room, loserTeam);
    const loserTrickCount = teamTricks(room, loserTeam);
    const amount = loserTrickCount === 0 ? 3 : loserScore <= 32 ? 2 : 1;
    return finishRound(room, winnerTeam, loserTeam, amount, `Karte so odigrane. Rezultat ${t0}:${t1}.`);
  }
}

function resolveTrick(room) {
  if (room.contract === 'small') return resolveSmallTrick(room);
  return resolveStandardTrick(room);
}

function publicState(room, socketId) {
  const me = room.players.findIndex((p) => p.socketId === socketId);
  const hostIndex = room.players.findIndex((p) => p.token === room.hostToken);
  const four = room.playerCount === 4;
  const myTeam = four && me >= 0 ? teamOf(me) : null;
  const teamScores = four ? [teamRoundScore(room, 0), teamRoundScore(room, 1)] : null;
  const canCount = four && room.phase === 'playing' && room.contract === 'normal' && room.trick.length === 0 && room.lastTrickWinner !== null && myTeam === teamOf(room.lastTrickWinner);
  const canClose = four && room.phase === 'playing' && room.contract === 'schnops' && me === room.bidderIndex && room.trick.length === 0 && room.trickNo > 0;

  return {
    code: room.code, playerCount: room.playerCount, targetScore: room.targetScore, phase: room.phase, roundNo: room.roundNo,
    dealerIndex: room.dealerIndex, cutterIndex: room.cutterIndex, callerIndex: room.callerIndex, dealMode: room.dealMode,
    trumpSuit: room.trumpSuit, contract: room.contract, bidderIndex: room.bidderIndex, multiplier: room.multiplier,
    auction: room.auction ? { currentIndex: room.auction.currentIndex, best: room.auction.best, passesSinceBid: room.auction.passesSinceBid } : null,
    contra: room.contra ? { stage: room.contra.stage, actionTeam: room.contra.actionTeam, passed: room.contra.passed } : null,
    players: room.players.map((p, i) => ({
      index: i, name: p.name, connected: p.connected, isHost: i === hostIndex, handCount: room.hands[i]?.length || 0,
      team: four ? teamOf(i) : null, matchPoints: four ? room.teamPenalty[teamOf(i)] : 0,
      roundPoints: room.roundPoints[i] || 0, tricks: room.trickCounts[i] || 0
    })),
    teams: four ? [
      { index: 0, members: [0,2], penalty: room.teamPenalty[0], roundPoints: teamScores[0], tricks: teamTricks(room,0) },
      { index: 1, members: [1,3], penalty: room.teamPenalty[1], roundPoints: teamScores[1], tricks: teamTricks(room,1) }
    ] : null,
    me, myTeam, myHand: me >= 0 ? (room.hands[me] || []) : [], legalCardIds: me >= 0 ? legalCardIds(room, me) : [],
    eligibleMelds: me >= 0 ? eligibleMelds(room, me) : [], canCount, canClose,
    talonCount: room.talon.length, myTalon: room.playerCount === 3 && room.phase === 'talon_exchange' && me === room.callerIndex ? room.talon : [],
    trick: room.trick, smallHistory: room.smallHistory || [], trickLeader: room.trickLeader, turnIndex: room.turnIndex, trickNo: room.trickNo,
    melds: room.melds, roundResult: room.roundResult, log: room.log.slice(-25), chat: room.chat.slice(-30), contracts: CONTRACTS
  };
}

function emitRoom(room) { for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('state', publicState(room, p.socketId)); }
function emitError(socket, message) { socket.emit('gameError', message); }
function roomForSocket(socket) {
  for (const room of rooms.values()) if (room.players.some((p) => p.socketId === socket.id)) return room;
  return null;
}

io.on('connection', (socket) => {
  socket.on('createRoom', (payload = {}, ack = () => {}) => {
    const room = createRoom(socket, payload); socket.join(room.code);
    ack({ ok: true, code: room.code, token: room.players[0].token }); emitRoom(room);
  });

  socket.on('joinRoom', (payload = {}, ack = () => {}) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Soba ne obstaja.' });
    const token = payload.token || makeToken();
    let player = room.players.find((p) => p.token === token);
    if (player) {
      player.socketId = socket.id; player.connected = true; player.name = cleanName(payload.name || player.name); socket.join(code);
      ack({ ok: true, code, token }); log(room, `${player.name} se je ponovno povezal.`); return emitRoom(room);
    }
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'Igra se je že začela. Za ponovni vstop uporabi isti telefon/brskalnik.' });
    if (room.players.length >= room.playerCount) return ack({ ok: false, error: 'Soba je polna.' });
    player = { name: cleanName(payload.name), token, socketId: socket.id, connected: true };
    room.players.push(player); socket.join(code); ack({ ok: true, code, token }); log(room, `${player.name} se je pridružil.`); emitRoom(room);
  });

  socket.on('setSeat', ({ playerIndex, seatIndex } = {}) => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'lobby' || room.playerCount !== 4) return;
    const { player } = playerBySocket(room, socket.id);
    if (!player || player.token !== room.hostToken) return emitError(socket, 'Samo gostitelj lahko razporeja sedeže.');
    const from = Number(playerIndex), to = Number(seatIndex);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= room.players.length || to >= room.players.length) return;
    if (from === to) return;
    [room.players[from], room.players[to]] = [room.players[to], room.players[from]];
    log(room, `Gostitelj je zamenjal sedeža ${from + 1} in ${to + 1}.`);
    emitRoom(room);
  });

  socket.on('startGame', () => {
    const room = roomForSocket(socket); if (!room) return;
    const { player } = playerBySocket(room, socket.id);
    if (!player || player.token !== room.hostToken) return emitError(socket, 'Samo gostitelj lahko začne.');
    if (room.players.length !== room.playerCount) return emitError(socket, `Potrebujete ${room.playerCount} igralce.`);
    if (room.phase !== 'lobby') return;
    startRound(room); emitRoom(room);
  });

  socket.on('chooseCut', ({ mode } = {}) => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'cut' || room.playerCount !== 4) return;
    const { index } = playerBySocket(room, socket.id);
    if (index !== room.cutterIndex) return emitError(socket, 'Predvig ali udarec izbere igralec desno od delivca.');
    if (!['cut', 'knock'].includes(mode)) return emitError(socket, 'Neveljavna izbira.');
    log(room, `${room.players[index].name}: ${mode === 'cut' ? 'predvig' : 'udarec po kartah'}.`);
    dealFourFirst(room, mode); emitRoom(room);
  });

  socket.on('chooseCall', ({ suit } = {}) => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'choose_call' || room.playerCount !== 4) return;
    const { index } = playerBySocket(room, socket.id);
    if (index !== room.callerIndex) return emitError(socket, 'Adut rufa igralec levo od delivca.');
    if (!SUITS.includes(suit)) return emitError(socket, 'Neveljavna barva aduta.');
    room.trumpSuit = suit;
    log(room, `${room.players[index].name} rufa ${suit}.`);
    completeFourDeal(room); emitRoom(room);
  });

  // Začasno ohranjena osnovna igra na 3 iz stare različice.
  socket.on('chooseTrump', ({ suit, fourthCard } = {}) => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'choose_trump' || room.playerCount !== 3) return;
    const { index } = playerBySocket(room, socket.id); if (index !== room.callerIndex) return emitError(socket, 'Adut izbira klicatelj.');
    if (fourthCard) room.trumpSuit = room.pendingSecond[index]?.[0]?.suit;
    else if (SUITS.includes(suit)) room.trumpSuit = suit;
    else return emitError(socket, 'Neveljaven adut.');
    for (let i = 0; i < 3; i++) room.hands[i].push(...room.pendingSecond[i]);
    room.pendingSecond = []; room.phase = 'talon_exchange'; emitRoom(room);
  });
  socket.on('exchangeTalon', ({ cardIds = [] } = {}) => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'talon_exchange' || room.playerCount !== 3) return;
    const { index } = playerBySocket(room, socket.id); if (index !== room.callerIndex) return emitError(socket, 'Talon menja klicatelj.');
    if (cardIds.length === 2) {
      const selected = cardIds.map((id) => room.hands[index].find((c) => c.id === id));
      if (selected.some((c) => !c)) return emitError(socket, 'Neveljavne karte.');
      room.hands[index] = room.hands[index].filter((c) => !cardIds.includes(c.id)).concat(room.talon); room.talon = selected;
    }
    // 3-player ostane na starem osnovnem toku; natančna pravila pridejo posebej.
    room.contract = 'normal'; room.bidderIndex = room.callerIndex; room.phase = 'playing'; room.turnIndex = room.callerIndex; room.trickLeader = room.callerIndex; emitRoom(room);
  });

  socket.on('bid', ({ contract } = {}) => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'auction' || !room.auction) return;
    const { index } = playerBySocket(room, socket.id); if (index !== room.auction.currentIndex) return emitError(socket, 'Nisi na vrsti za licitacijo.');
    if (contract === 'pass') {
      room.auction.totalPasses += 1; room.auction.passesSinceBid += 1; log(room, `${room.players[index].name}: dalje.`);
    } else {
      if (!CONTRACTS[contract] || contract === 'normal') return emitError(socket, 'Izberi eno od iger 6, 7, 9, 12, 18 ali 24.');
      const currentValue = room.auction.best?.value || 0;
      const value = CONTRACTS[contract].value;
      if (value <= currentValue) return emitError(socket, 'Višati moraš na višjo igro.');
      if (!canBidInstant(room, index, contract)) return emitError(socket, contract === 'eighteen' ? '18 lahko kličeš samo s 5 kartami iste barve.' : '24 lahko kličeš samo s 5 aduti.');
      room.auction.best = { contract, playerIndex: index, value }; room.auction.passesSinceBid = 0;
      log(room, `${room.players[index].name}: višam na ${CONTRACTS[contract].label}.`);
    }
    if (!room.auction.best && room.auction.totalPasses >= 4) { finishAuction(room); return emitRoom(room); }
    if (room.auction.best && room.auction.passesSinceBid >= 3) { finishAuction(room); return emitRoom(room); }
    room.auction.currentIndex = nextIndex(room, index); emitRoom(room);
  });

  socket.on('contraAction', ({ action } = {}) => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'contra' || !room.contra) return;
    const { index } = playerBySocket(room, socket.id);
    if (teamOf(index) !== room.contra.actionTeam) return emitError(socket, 'Trenutno je na vrsti druga ekipa.');
    if (action === 'raise') {
      if (room.contra.stage === 0) { room.multiplier = 2; room.contra.stage = 1; room.contra.actionTeam = teamOf(room.bidderIndex); log(room, `${room.players[index].name}: KONTRA (x2).`); }
      else if (room.contra.stage === 1) { room.multiplier = 3; room.contra.stage = 2; room.contra.actionTeam = otherTeam(teamOf(room.bidderIndex)); log(room, `${room.players[index].name}: KONTRA NAZAJ (x3).`); }
      else if (room.contra.stage === 2) { room.multiplier = 4; log(room, `${room.players[index].name}: DO KONCA (x4).`); beginPlay(room); return emitRoom(room); }
      room.contra.passed = []; return emitRoom(room);
    }
    if (action === 'pass') {
      if (!room.contra.passed.includes(index)) room.contra.passed.push(index);
      const members = teamMembers(room.contra.actionTeam);
      if (members.every((i) => room.contra.passed.includes(i))) { beginPlay(room); return emitRoom(room); }
      return emitRoom(room);
    }
  });

  socket.on('declareMeld', ({ suit } = {}) => {
    const room = roomForSocket(socket); if (!room) return;
    const { index } = playerBySocket(room, socket.id);
    const meld = eligibleMelds(room, index).find((m) => m.suit === suit);
    if (!meld) return emitError(socket, 'Te napovedi trenutno ne moreš narediti.');
    room.melds.push({ playerIndex: index, suit, points: meld.points, activated: false });
    log(room, `${room.players[index].name} napove ${meld.points}.`);
    activatePendingMelds(room, teamOf(index)); emitRoom(room);
  });

  socket.on('countPoints', () => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'playing' || room.contract !== 'normal' || room.playerCount !== 4) return;
    const { index } = playerBySocket(room, socket.id); const team = teamOf(index);
    if (room.trick.length || room.lastTrickWinner === null || teamOf(room.lastTrickWinner) !== team) return emitError(socket, 'Šteješ lahko po štihu, ki ga je pobrala tvoja ekipa.');
    const score = teamRoundScore(room, team);
    log(room, `${room.players[index].name} reče: ŠTEJEM (${score}).`);
    if (!normalFinishByCount(room, team)) log(room, `Ni dovolj: ekipa ima ${score}, potrebuje 66.`);
    emitRoom(room);
  });

  socket.on('closeSchnops', () => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'playing' || room.contract !== 'schnops') return;
    const { index } = playerBySocket(room, socket.id); if (index !== room.bidderIndex) return emitError(socket, 'Zapre lahko samo igralec, ki igra Šnops.');
    if (room.trick.length || room.trickNo < 1) return emitError(socket, 'Zapreš lahko po osvojenem štihu.');
    activatePendingMelds(room, teamOf(index));
    const score = teamRoundScore(room, teamOf(index));
    log(room, `${room.players[index].name} reče: ZAPREM (${score}).`);
    if (score >= 66) finishRound(room, teamOf(index), otherTeam(teamOf(index)), 6, `Šnops zaprt pri ${score} točkah.`);
    else finishRound(room, otherTeam(teamOf(index)), teamOf(index), 6, `Prezgodaj zaprt Šnops: samo ${score} točk.`);
    emitRoom(room);
  });

  socket.on('playCard', ({ cardId } = {}) => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'playing') return;
    const { index } = playerBySocket(room, socket.id); if (index !== room.turnIndex) return emitError(socket, 'Nisi na potezi.');
    if (!legalCardIds(room, index).includes(cardId)) return emitError(socket, 'Ta karta po pravilih trenutno ni dovoljena.');
    const cardIndex = room.hands[index].findIndex((c) => c.id === cardId); if (cardIndex < 0) return emitError(socket, 'Karte nimaš v roki.');
    const [card] = room.hands[index].splice(cardIndex, 1); room.trick.push({ playerIndex: index, card });
    if (room.trick.length === room.playerCount) resolveTrick(room); else room.turnIndex = nextIndex(room, index);
    emitRoom(room);
  });

  socket.on('nextRound', () => {
    const room = roomForSocket(socket); if (!room || room.phase !== 'round_end') return;
    const { player } = playerBySocket(room, socket.id); if (!player || player.token !== room.hostToken) return emitError(socket, 'Samo gostitelj začne naslednjo rundo.');
    startRound(room); emitRoom(room);
  });

  socket.on('adjustScore', ({ team, delta } = {}) => {
    const room = roomForSocket(socket); if (!room || room.playerCount !== 4) return;
    const { player } = playerBySocket(room, socket.id); if (!player || player.token !== room.hostToken) return emitError(socket, 'Samo gostitelj lahko popravi rezultat.');
    const t = Number(team), d = Number(delta); if (![0,1].includes(t) || ![-1,1].includes(d)) return;
    room.teamPenalty[t] = Math.max(0, room.teamPenalty[t] + d); log(room, `Rezultat ekipe ${t + 1} popravljen za ${d > 0 ? '+' : ''}${d}.`); emitRoom(room);
  });

  socket.on('chat', ({ text } = {}) => {
    const room = roomForSocket(socket); if (!room) return;
    const { player } = playerBySocket(room, socket.id); const clean = String(text || '').trim().slice(0, 180);
    if (!player || !clean) return;
    room.chat.push({ id: `${Date.now()}-${Math.random()}`, name: player.name, text: clean, at: Date.now() });
    if (room.chat.length > 50) room.chat.shift(); emitRoom(room);
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.socketId === socket.id); if (!player) continue;
      player.connected = false; player.socketId = null; log(room, `${player.name} je izgubil povezavo - lahko se vrne z istim telefonom.`); emitRoom(room); break;
    }
  });
});

server.listen(PORT, () => console.log(`Šnops Online teče na http://localhost:${PORT}`));
