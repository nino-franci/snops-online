const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['J', 'Q', 'K', '10', 'A'];
const CARD_POINTS = { J: 2, Q: 3, K: 4, '10': 10, A: 11 };
const RANK_POWER = { J: 1, Q: 2, K: 3, '10': 4, A: 5 };

const CONTRACTS = {
  normal: { label: 'Navadna', value: 1, trump: true, melds: true },
  schnops: { label: 'Snops', value: 6, trump: true, melds: true },
  beggar: { label: 'Berac', value: 7, trump: false, melds: false },
  march: { label: 'Durhmars', value: 9, trump: false, melds: false },
  paver: { label: 'Paver', value: 12, trump: true, melds: false }
};

function cleanName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20) || 'Igralec';
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function deck20() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit}-${rank}`, suit, rank, points: CARD_POINTS[rank] });
    }
  }
  return deck;
}

function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextIndex(room, idx) {
  return (idx + 1) % room.playerCount;
}

function log(room, text) {
  room.log.push({ id: `${Date.now()}-${Math.random()}`, text, at: Date.now() });
  if (room.log.length > 80) room.log.shift();
}

function playerBySocket(room, socketId) {
  const index = room.players.findIndex((p) => p.socketId === socketId);
  return { player: room.players[index], index };
}

function createRoom(hostSocket, payload) {
  const playerCount = Number(payload.playerCount) === 3 ? 3 : 4;
  const targetScore = Math.max(7, Math.min(99, Number(payload.targetScore) || 25));
  const room = {
    code: makeCode(),
    hostToken: payload.token || makeToken(),
    playerCount,
    targetScore,
    players: [],
    phase: 'lobby',
    dealerIndex: Math.floor(Math.random() * playerCount),
    roundNo: 0,
    hands: [],
    pendingSecond: [],
    talon: [],
    trumpSuit: null,
    callerIndex: null,
    calledCard: null,
    calledCardRevealed: false,
    partnerIndex: null,
    auction: null,
    contract: null,
    bidderIndex: null,
    trick: [],
    trickLeader: null,
    turnIndex: null,
    trickNo: 0,
    captured: [],
    melds: [],
    roundPoints: [],
    trickCounts: [],
    matchPoints: Array(playerCount).fill(0),
    roundResult: null,
    lastTrickWinner: null,
    log: [],
    chat: []
  };
  const token = payload.token || room.hostToken;
  room.hostToken = token;
  room.players.push({
    name: cleanName(payload.name),
    token,
    socketId: hostSocket.id,
    connected: true
  });
  rooms.set(room.code, room);
  log(room, `${room.players[0].name} je ustvaril sobo ${room.code}.`);
  return room;
}

function splitSecondPackets(deck, count, cardsEach) {
  const packets = Array.from({ length: count }, () => []);
  for (let r = 0; r < cardsEach; r++) {
    for (let p = 0; p < count; p++) packets[p].push(deck.shift());
  }
  return packets;
}

function dealFirst(room) {
  const deck = shuffle(deck20());
  room.hands = Array.from({ length: room.playerCount }, () => []);
  for (let r = 0; r < 3; r++) {
    for (let p = 0; p < room.playerCount; p++) room.hands[p].push(deck.shift());
  }

  if (room.playerCount === 3) {
    room.talon = [deck.shift(), deck.shift()];
    room.pendingSecond = splitSecondPackets(deck, 3, 3);
  } else {
    room.talon = [];
    room.pendingSecond = splitSecondPackets(deck, 4, 2);
  }
}

function startRound(room) {
  room.roundNo += 1;
  room.dealerIndex = room.roundNo === 1 ? room.dealerIndex : nextIndex(room, room.dealerIndex);
  room.callerIndex = nextIndex(room, room.dealerIndex);
  room.trumpSuit = null;
  room.calledCard = null;
  room.calledCardRevealed = false;
  room.partnerIndex = null;
  room.contract = null;
  room.bidderIndex = null;
  room.auction = null;
  room.trick = [];
  room.trickLeader = null;
  room.turnIndex = null;
  room.trickNo = 0;
  room.captured = Array.from({ length: room.playerCount }, () => []);
  room.melds = [];
  room.roundPoints = Array(room.playerCount).fill(0);
  room.trickCounts = Array(room.playerCount).fill(0);
  room.roundResult = null;
  room.lastTrickWinner = null;
  dealFirst(room);

  if (room.playerCount === 3) {
    room.phase = 'choose_trump';
    log(room, `${room.players[room.callerIndex].name} izbira aduta iz prvih treh kart.`);
  } else {
    room.phase = 'choose_call';
    log(room, `${room.players[room.callerIndex].name} rufa karto (barva + vrednost).`);
  }
}

function completeDeal(room) {
  for (let i = 0; i < room.playerCount; i++) {
    room.hands[i].push(...room.pendingSecond[i]);
  }
  room.pendingSecond = [];
}

function beginAuction(room) {
  room.phase = 'auction';
  room.auction = {
    currentIndex: room.callerIndex,
    passed: Array(room.playerCount).fill(false),
    best: { contract: 'normal', playerIndex: room.callerIndex, value: CONTRACTS.normal.value },
    turns: 0
  };
  log(room, 'Zacenja se licitacija. Navadna igra je zacetna ponudba klicatelja.');
}

function finishAuction(room) {
  room.contract = room.auction.best.contract;
  room.bidderIndex = room.auction.best.playerIndex;
  room.phase = 'playing';
  room.trickLeader = room.contract === 'normal' ? room.callerIndex : room.bidderIndex;
  room.turnIndex = room.trickLeader;
  room.auction = null;
  log(room, `${room.players[room.bidderIndex].name} igra: ${CONTRACTS[room.contract].label}.`);
}

function normalTeamMembers(room, forIndex) {
  if (room.playerCount === 3) {
    if (forIndex === room.callerIndex) return [room.callerIndex];
    return room.players.map((_p, i) => i).filter((i) => i !== room.callerIndex);
  }

  const callerSide = room.partnerIndex !== null && room.partnerIndex !== room.callerIndex
    ? [room.callerIndex, room.partnerIndex]
    : [room.callerIndex];
  if (callerSide.includes(forIndex)) return callerSide;
  return room.players.map((_p, i) => i).filter((i) => !callerSide.includes(i));
}

function effectiveSide(room, playerIndex) {
  if (room.contract === 'normal') return normalTeamMembers(room, playerIndex);
  return [playerIndex];
}

function sideKey(indices) {
  return indices.slice().sort((a, b) => a - b).join(',');
}

function sideScore(room, members) {
  return members.reduce((sum, i) => sum + room.roundPoints[i], 0);
}

function sideTricks(room, members) {
  return members.reduce((sum, i) => sum + room.trickCounts[i], 0);
}

function suitCards(hand, suit) {
  return hand.filter((c) => c.suit === suit);
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
  const trumpEnabled = CONTRACTS[room.contract].trump;
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
  const trumpEnabled = CONTRACTS[room.contract].trump;
  const currentWinner = currentWinningPlay(room);
  const follow = suitCards(hand, leadSuit);

  if (follow.length) {
    const beating = follow.filter((c) => compareCards(c, currentWinner.card, leadSuit, room.trumpSuit, trumpEnabled) > 0);
    return (beating.length ? beating : follow).map((c) => c.id);
  }

  if (trumpEnabled) {
    const trumps = suitCards(hand, room.trumpSuit);
    if (trumps.length) {
      if (currentWinner.card.suit === room.trumpSuit) {
        const beatingTrump = trumps.filter((c) => compareCards(c, currentWinner.card, leadSuit, room.trumpSuit, true) > 0);
        return (beatingTrump.length ? beatingTrump : trumps).map((c) => c.id);
      }
      return trumps.map((c) => c.id);
    }
  }

  return hand.map((c) => c.id);
}

function eligibleMelds(room, playerIndex) {
  if (room.phase !== 'playing' || room.turnIndex !== playerIndex || room.trick.length) return [];
  if (!CONTRACTS[room.contract]?.melds) return [];
  const hand = room.hands[playerIndex] || [];
  return SUITS.filter((suit) => {
    const hasK = hand.some((c) => c.suit === suit && c.rank === 'K');
    const hasQ = hand.some((c) => c.suit === suit && c.rank === 'Q');
    const already = room.melds.some((m) => m.playerIndex === playerIndex && m.suit === suit);
    return hasK && hasQ && !already;
  }).map((suit) => ({ suit, points: suit === room.trumpSuit ? 40 : 20 }));
}

function activateMeldsForWinner(room, winnerIndex) {
  let activatedTotal = 0;
  for (const meld of room.melds) {
    if (meld.activated) continue;
    const sameSide = room.contract === 'normal'
      ? sideKey(normalTeamMembers(room, meld.playerIndex)) === sideKey(normalTeamMembers(room, winnerIndex))
      : meld.playerIndex === winnerIndex;
    if (sameSide) {
      meld.activated = true;
      room.roundPoints[meld.playerIndex] += meld.points;
      activatedTotal += meld.points;
    }
  }
  return activatedTotal;
}

function revealCalledPartnerIfNeeded(room, card, playerIndex) {
  if (room.playerCount !== 4 || room.calledCardRevealed || !room.calledCard) return;
  if (card.id === room.calledCard.id) {
    room.calledCardRevealed = true;
    log(room, `${room.players[playerIndex].name} je odigral rufano karto - partner je razkrit.`);
  }
}

function resolveTrick(room) {
  const winningPlay = currentWinningPlay(room);
  const winner = winningPlay.playerIndex;
  const trickPoints = room.trick.reduce((sum, p) => sum + p.card.points, 0);
  room.roundPoints[winner] += trickPoints;
  room.trickCounts[winner] += 1;
  room.captured[winner].push(...room.trick.map((p) => p.card));
  activateMeldsForWinner(room, winner);
  room.lastTrickWinner = winner;
  room.trickNo += 1;
  log(room, `${room.players[winner].name} pobere stih (+${trickPoints}).`);
  room.trick = [];
  room.trickLeader = winner;
  room.turnIndex = winner;

  evaluateRound(room);
}

function awardMatchPoints(room, winners, amount) {
  for (const i of winners) room.matchPoints[i] += amount;
}

function endRound(room, winnerIndices, amount, reason) {
  const unique = [...new Set(winnerIndices)];
  awardMatchPoints(room, unique, amount);
  room.roundResult = {
    winners: unique,
    amount,
    reason,
    contract: room.contract,
    scoreSnapshot: room.roundPoints.slice()
  };
  room.phase = room.matchPoints.some((p) => p >= room.targetScore) ? 'match_end' : 'round_end';
  room.turnIndex = null;
  log(room, `${unique.map((i) => room.players[i].name).join(' + ')} dobijo ${amount} tock. ${reason}`);
}

function evaluateNormal(room) {
  const callerSide = normalTeamMembers(room, room.callerIndex);
  const defenderSide = room.players.map((_p, i) => i).filter((i) => !callerSide.includes(i));
  const callerScore = sideScore(room, callerSide);
  const defenderScore = sideScore(room, defenderSide);

  let winners = null;
  if (callerScore >= 66) winners = callerSide;
  else if (defenderScore >= 66) winners = defenderSide;
  else if (room.hands.every((h) => h.length === 0) && room.lastTrickWinner !== null) {
    winners = normalTeamMembers(room, room.lastTrickWinner);
  }
  if (!winners) return;

  const losers = room.players.map((_p, i) => i).filter((i) => !winners.includes(i));
  const loserScore = sideScore(room, losers);
  const loserTricks = sideTricks(room, losers);
  const amount = loserTricks === 0 ? 3 : loserScore <= 32 ? 2 : 1;

  // Ce se pri 4 igralcih rufana karta do konca ni pokazala in zmaga klicateljeva stran,
  // pise samo klicatelj. To je pogosta slovenska hisna varianta.
  let creditedWinners = winners;
  if (room.playerCount === 4 && winners.includes(room.callerIndex) && !room.calledCardRevealed) {
    creditedWinners = [room.callerIndex];
  }
  endRound(room, creditedWinners, amount, `Navadna igra: ${Math.max(callerScore, defenderScore)} tock v zmagovalni strani.`);
}

function evaluateSpecial(room) {
  const bidder = room.bidderIndex;
  const value = CONTRACTS[room.contract].value;
  const bidderTricks = room.trickCounts[bidder];
  const bidderScore = room.roundPoints[bidder];
  const cardsLeft = room.hands.reduce((sum, h) => sum + h.length, 0);
  const opponents = room.players.map((_p, i) => i).filter((i) => i !== bidder);

  if (room.contract === 'beggar') {
    if (bidderTricks > 0) return endRound(room, opponents, value, 'Berac ni uspel: licitator je pobral stih.');
    if (cardsLeft === 0) return endRound(room, [bidder], value, 'Berac uspel: brez osvojenega stiha.');
    return;
  }

  if (room.contract === 'march' || room.contract === 'paver') {
    const somebodyElseHasTrick = room.trickCounts.some((n, i) => i !== bidder && n > 0);
    if (somebodyElseHasTrick) return endRound(room, opponents, value, `${CONTRACTS[room.contract].label} ni uspel.`);
    if (cardsLeft === 0) return endRound(room, [bidder], value, `${CONTRACTS[room.contract].label} uspel: vsi stihi.`);
    return;
  }

  if (room.contract === 'schnops') {
    const somebodyElseHasTrick = room.trickCounts.some((n, i) => i !== bidder && n > 0);
    if (somebodyElseHasTrick) return endRound(room, opponents, value, 'Snops ni uspel: licitator ni pobral vseh potrebnih stihov.');
    if (room.trickNo >= 3) {
      if (bidderTricks >= 3 && bidderScore >= 66) return endRound(room, [bidder], value, 'Snops uspel v prvih treh stihih.');
      return endRound(room, opponents, value, 'Snops ni dosegel 66 v prvih treh stihih.');
    }
  }
}

function evaluateRound(room) {
  if (room.phase !== 'playing') return;
  if (room.contract === 'normal') evaluateNormal(room);
  else evaluateSpecial(room);
}

function publicState(room, socketId) {
  const me = room.players.findIndex((p) => p.socketId === socketId);
  const revealPartner = room.calledCardRevealed || ['round_end', 'match_end'].includes(room.phase);
  const hostIndex = room.players.findIndex((p) => p.token === room.hostToken);

  return {
    code: room.code,
    playerCount: room.playerCount,
    targetScore: room.targetScore,
    phase: room.phase,
    roundNo: room.roundNo,
    dealerIndex: room.dealerIndex,
    callerIndex: room.callerIndex,
    trumpSuit: room.trumpSuit,
    calledCard: room.calledCard,
    calledCardRevealed: room.calledCardRevealed,
    partnerIndex: revealPartner ? room.partnerIndex : null,
    contract: room.contract,
    bidderIndex: room.bidderIndex,
    auction: room.auction ? {
      currentIndex: room.auction.currentIndex,
      best: room.auction.best,
      passed: room.auction.passed
    } : null,
    players: room.players.map((p, i) => ({
      index: i,
      name: p.name,
      connected: p.connected,
      isHost: i === hostIndex,
      handCount: room.hands[i]?.length || 0,
      matchPoints: room.matchPoints[i] || 0,
      roundPoints: room.roundPoints[i] || 0,
      tricks: room.trickCounts[i] || 0
    })),
    me,
    myHand: me >= 0 ? (room.hands[me] || []) : [],
    legalCardIds: me >= 0 ? legalCardIds(room, me) : [],
    eligibleMelds: me >= 0 ? eligibleMelds(room, me) : [],
    talonCount: room.talon.length,
    myTalon: room.playerCount === 3 && room.phase === 'talon_exchange' && me === room.callerIndex ? room.talon : [],
    trick: room.trick,
    trickLeader: room.trickLeader,
    turnIndex: room.turnIndex,
    trickNo: room.trickNo,
    melds: room.melds,
    roundResult: room.roundResult,
    log: room.log.slice(-20),
    chat: room.chat.slice(-30),
    contracts: CONTRACTS
  };
}

function emitRoom(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', publicState(room, p.socketId));
  }
}

function emitError(socket, message) {
  socket.emit('gameError', message);
}

function roomForSocket(socket) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.socketId === socket.id)) return room;
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('createRoom', (payload = {}, ack = () => {}) => {
    const room = createRoom(socket, payload);
    socket.join(room.code);
    ack({ ok: true, code: room.code, token: room.players[0].token });
    emitRoom(room);
  });

  socket.on('joinRoom', (payload = {}, ack = () => {}) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Soba ne obstaja.' });

    const token = payload.token || makeToken();
    let player = room.players.find((p) => p.token === token);
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
      player.name = cleanName(payload.name || player.name);
      socket.join(code);
      ack({ ok: true, code, token });
      log(room, `${player.name} se je ponovno povezal.`);
      return emitRoom(room);
    }

    if (room.phase !== 'lobby') return ack({ ok: false, error: 'Igra se je ze zacela. Za ponovni vstop uporabi isti telefon/brskalnik.' });
    if (room.players.length >= room.playerCount) return ack({ ok: false, error: 'Soba je polna.' });

    player = { name: cleanName(payload.name), token, socketId: socket.id, connected: true };
    room.players.push(player);
    socket.join(code);
    ack({ ok: true, code, token });
    log(room, `${player.name} se je pridruzil.`);
    emitRoom(room);
  });

  socket.on('startGame', () => {
    const room = roomForSocket(socket);
    if (!room) return;
    const { player } = playerBySocket(room, socket.id);
    if (!player || player.token !== room.hostToken) return emitError(socket, 'Samo gostitelj lahko zacne.');
    if (room.players.length !== room.playerCount) return emitError(socket, `Potrebujete ${room.playerCount} igralce.`);
    if (room.phase !== 'lobby') return;
    startRound(room);
    emitRoom(room);
  });

  socket.on('chooseTrump', ({ suit, fourthCard } = {}) => {
    const room = roomForSocket(socket);
    if (!room || room.phase !== 'choose_trump') return;
    const { index } = playerBySocket(room, socket.id);
    if (index !== room.callerIndex) return emitError(socket, 'Adut izbira klicatelj.');

    if (fourthCard) {
      const revealed = room.pendingSecond[index]?.[0];
      if (!revealed) return emitError(socket, 'Cetrta karta ni na voljo.');
      room.trumpSuit = revealed.suit;
      log(room, `${room.players[index].name} je odprl 4. karto: ${revealed.rank} ${revealed.suit}.`);
    } else {
      if (!SUITS.includes(suit)) return emitError(socket, 'Neveljaven adut.');
      room.trumpSuit = suit;
      log(room, `${room.players[index].name} je izbral adut: ${suit}.`);
    }
    completeDeal(room);
    room.phase = 'talon_exchange';
    emitRoom(room);
  });

  socket.on('exchangeTalon', ({ cardIds = [] } = {}) => {
    const room = roomForSocket(socket);
    if (!room || room.phase !== 'talon_exchange') return;
    const { index } = playerBySocket(room, socket.id);
    if (index !== room.callerIndex) return emitError(socket, 'Talon menja klicatelj.');
    if (cardIds.length !== 0 && cardIds.length !== 2) return emitError(socket, 'Zamenjaj natanko dve karti ali preskoci talon.');

    if (cardIds.length === 2) {
      const hand = room.hands[index];
      const selected = cardIds.map((id) => hand.find((c) => c.id === id));
      if (selected.some((c) => !c) || new Set(cardIds).size !== 2) return emitError(socket, 'Neveljavna izbira kart.');
      room.hands[index] = hand.filter((c) => !cardIds.includes(c.id)).concat(room.talon);
      room.talon = selected;
      log(room, `${room.players[index].name} je zamenjal dve karti s talonom.`);
    } else {
      log(room, `${room.players[index].name} je pustil talon pri miru.`);
    }
    beginAuction(room);
    emitRoom(room);
  });

  socket.on('chooseCall', ({ suit, rank } = {}) => {
    const room = roomForSocket(socket);
    if (!room || room.phase !== 'choose_call') return;
    const { index } = playerBySocket(room, socket.id);
    if (index !== room.callerIndex) return emitError(socket, 'Rufa klicatelj.');
    if (!SUITS.includes(suit) || !RANKS.includes(rank)) return emitError(socket, 'Neveljavna rufana karta.');
    if (room.hands[index].some((c) => c.suit === suit && c.rank === rank)) return emitError(socket, 'Ne mores rufati karte, ki jo ze imas v prvih treh kartah.');

    room.trumpSuit = suit;
    room.calledCard = { id: `${suit}-${rank}`, suit, rank, points: CARD_POINTS[rank] };
    completeDeal(room);
    room.partnerIndex = room.hands.findIndex((h, i) => i !== index && h.some((c) => c.id === room.calledCard.id));
    if (room.partnerIndex < 0) room.partnerIndex = index;
    log(room, `${room.players[index].name} je rufal ${rank} ${suit}.`);
    beginAuction(room);
    emitRoom(room);
  });

  socket.on('bid', ({ contract } = {}) => {
    const room = roomForSocket(socket);
    if (!room || room.phase !== 'auction' || !room.auction) return;
    const { index } = playerBySocket(room, socket.id);
    if (index !== room.auction.currentIndex) return emitError(socket, 'Nisi na vrsti za licitacijo.');
    if (room.auction.passed[index]) return emitError(socket, 'Po pasu ne mores znova licitirati.');

    if (contract === 'pass') {
      room.auction.passed[index] = true;
      log(room, `${room.players[index].name}: pas.`);
    } else {
      if (!CONTRACTS[contract]) return emitError(socket, 'Neznana igra.');
      const value = CONTRACTS[contract].value;
      if (value < room.auction.best.value) return emitError(socket, 'Ponudba mora biti vsaj tako visoka kot trenutna.');
      room.auction.best = { contract, playerIndex: index, value };
      log(room, `${room.players[index].name}: ${CONTRACTS[contract].label}.`);
    }

    room.auction.turns += 1;
    const active = room.players.map((_p, i) => i).filter((i) => !room.auction.passed[i]);
    if (active.length <= 1 || room.auction.turns >= room.playerCount * 2) {
      return finishAuction(room), emitRoom(room);
    }

    let next = nextIndex(room, index);
    let guard = 0;
    while (room.auction.passed[next] && guard < room.playerCount) {
      next = nextIndex(room, next);
      guard += 1;
    }
    room.auction.currentIndex = next;
    emitRoom(room);
  });

  socket.on('declareMeld', ({ suit } = {}) => {
    const room = roomForSocket(socket);
    if (!room) return;
    const { index } = playerBySocket(room, socket.id);
    const eligible = eligibleMelds(room, index);
    const meld = eligible.find((m) => m.suit === suit);
    if (!meld) return emitError(socket, 'Te napovedi trenutno ne mores narediti.');
    room.melds.push({ playerIndex: index, suit, points: meld.points, activated: false });
    log(room, `${room.players[index].name} napove ${meld.points}.`);
    emitRoom(room);
  });

  socket.on('playCard', ({ cardId } = {}) => {
    const room = roomForSocket(socket);
    if (!room || room.phase !== 'playing') return;
    const { index } = playerBySocket(room, socket.id);
    if (index !== room.turnIndex) return emitError(socket, 'Nisi na potezi.');
    if (!legalCardIds(room, index).includes(cardId)) return emitError(socket, 'Ta karta po pravilih trenutno ni dovoljena.');
    const cardIndex = room.hands[index].findIndex((c) => c.id === cardId);
    if (cardIndex < 0) return emitError(socket, 'Karte nimas v roki.');
    const [card] = room.hands[index].splice(cardIndex, 1);
    room.trick.push({ playerIndex: index, card });
    revealCalledPartnerIfNeeded(room, card, index);

    if (room.trick.length === room.playerCount) resolveTrick(room);
    else room.turnIndex = nextIndex(room, index);
    emitRoom(room);
  });

  socket.on('nextRound', () => {
    const room = roomForSocket(socket);
    if (!room || room.phase !== 'round_end') return;
    const { player } = playerBySocket(room, socket.id);
    if (!player || player.token !== room.hostToken) return emitError(socket, 'Samo gostitelj zacne naslednjo rundo.');
    startRound(room);
    emitRoom(room);
  });

  socket.on('adjustScore', ({ playerIndex, delta } = {}) => {
    const room = roomForSocket(socket);
    if (!room) return;
    const { player } = playerBySocket(room, socket.id);
    if (!player || player.token !== room.hostToken) return emitError(socket, 'Samo gostitelj lahko popravi rezultat.');
    const i = Number(playerIndex);
    const d = Number(delta);
    if (!Number.isInteger(i) || i < 0 || i >= room.playerCount || ![-1, 1].includes(d)) return;
    room.matchPoints[i] = Math.max(0, room.matchPoints[i] + d);
    log(room, `Rezultat ${room.players[i].name} je rocno popravljen za ${d > 0 ? '+' : ''}${d}.`);
    emitRoom(room);
  });

  socket.on('chat', ({ text } = {}) => {
    const room = roomForSocket(socket);
    if (!room) return;
    const { player } = playerBySocket(room, socket.id);
    const clean = String(text || '').trim().slice(0, 180);
    if (!player || !clean) return;
    room.chat.push({ id: `${Date.now()}-${Math.random()}`, name: player.name, text: clean, at: Date.now() });
    if (room.chat.length > 50) room.chat.shift();
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;
      player.connected = false;
      player.socketId = null;
      log(room, `${player.name} je izgubil povezavo - lahko se vrne z istim telefonom.`);
      emitRoom(room);
      break;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Snops Online tece na http://localhost:${PORT}`);
});
