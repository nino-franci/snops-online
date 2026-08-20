const socket = io();

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const homeView = $('#homeView');
const gameView = $('#gameView');
const nameInput = $('#nameInput');
const roomCodeInput = $('#roomCodeInput');
const targetScoreInput = $('#targetScoreInput');
const homeError = $('#homeError');
const toastEl = $('#toast');
const connectionBadge = $('#connectionBadge');

const suitSymbol = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const suitName = { hearts: 'srce', diamonds: 'karo', clubs: 'križ', spades: 'pik' };

let playerCount = 4;
let state = null;
let selectedTalon = new Set();
let deferredInstall = null;

nameInput.value = localStorage.getItem('snops-name') || '';
roomCodeInput.value = new URLSearchParams(location.search).get('room') || '';

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

function currentToken() {
  const code = String(roomCodeInput.value || state?.code || '').toUpperCase();
  return localStorage.getItem(`snops-token-${code}`) || '';
}

function saveSession(code, token, name) {
  localStorage.setItem('snops-name', name);
  localStorage.setItem(`snops-token-${code}`, token);
  history.replaceState(null, '', `?room=${encodeURIComponent(code)}`);
}

function enterGame(code) {
  homeView.classList.add('hidden');
  gameView.classList.remove('hidden');
  $('#roomCode').textContent = code;
}

function safe(s) {
  return String(s ?? '').replace(/[&<>'"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]));
}

function cardHTML(card, { button = false, playable = false, selected = false } = {}) {
  const red = ['hearts', 'diamonds'].includes(card.suit) ? ' red' : '';
  const classes = `card${red}${playable ? ' playable' : ''}${selected ? ' selected' : ''}`;
  const attrs = button ? `data-card-id="${safe(card.id)}" ${playable ? '' : 'disabled'}` : '';
  const tag = button ? 'button' : 'div';
  return `<${tag} class="${classes}" ${attrs} aria-label="${safe(card.rank)} ${safe(suitName[card.suit])}">
    <span class="rank">${safe(card.rank)} ${suitSymbol[card.suit]}</span>
    <span class="suit">${suitSymbol[card.suit]}</span>
    <span class="points">${card.points} t.</span>
  </${tag}>`;
}

function roleLabel(index) {
  if (!state) return '';
  const roles = [];
  if (index === state.dealerIndex) roles.push('deli');
  if (index === state.callerIndex) roles.push('rufa');
  if (state.bidderIndex === index && state.contract !== 'normal') roles.push('licitator');
  if (state.calledCardRevealed && state.partnerIndex === index && index !== state.callerIndex) roles.push('partner');
  return roles.join(' · ');
}

function renderScoreboard() {
  const isHost = state.players[state.me]?.isHost;
  $('#scoreboard').innerHTML = state.players.map((p) => `
    <div class="score-card ${p.index === state.me ? 'me' : ''}">
      <div class="score-name"><span class="dot ${p.connected ? 'on' : ''}"></span><b>${safe(p.name)}</b></div>
      <div class="score-main"><strong>${p.matchPoints}</strong><span class="score-small">/ ${state.targetScore}</span></div>
      <div class="score-small">runda: ${p.roundPoints} · štihi: ${p.tricks}${roleLabel(p.index) ? ` · ${safe(roleLabel(p.index))}` : ''}</div>
      ${isHost ? `<div class="score-tools"><button data-score="${p.index}" data-delta="-1">−</button><button data-score="${p.index}" data-delta="1">+</button></div>` : ''}
    </div>`).join('');

  $$('[data-score]').forEach((b) => b.addEventListener('click', () => {
    socket.emit('adjustScore', { playerIndex: Number(b.dataset.score), delta: Number(b.dataset.delta) });
  }));
}

function phaseText() {
  const p = state.phase;
  if (p === 'lobby') return ['Čakalnica', 'Počakajte, da se pridružijo vsi igralci'];
  if (p === 'choose_trump') return ['Adut', `${state.players[state.callerIndex].name} izbira aduta`];
  if (p === 'talon_exchange') return ['Talon', `${state.players[state.callerIndex].name} lahko zamenja dve karti`];
  if (p === 'choose_call') return ['Rufanje', `${state.players[state.callerIndex].name} kliče karto`];
  if (p === 'auction') return ['Licitacija', `${state.players[state.auction.currentIndex].name} je na vrsti`];
  if (p === 'playing') return ['Igra', `${state.players[state.turnIndex].name} je na potezi`];
  if (p === 'round_end') return ['Konec runde', 'Rezultat runde je zapisan'];
  if (p === 'match_end') return ['Konec tekme', 'Imamo zmagovalca'];
  return ['', ''];
}

function renderGameInfo() {
  const pills = [];
  if (state.trumpSuit) pills.push(`Adut: <b>${suitSymbol[state.trumpSuit]} ${safe(suitName[state.trumpSuit])}</b>`);
  if (state.calledCard) pills.push(`Ruf: <b>${safe(state.calledCard.rank)} ${suitSymbol[state.calledCard.suit]}</b>`);
  if (state.contract) pills.push(`Igra: <b>${safe(state.contracts[state.contract].label)}</b>`);
  if (state.partnerIndex !== null && state.partnerIndex !== undefined && state.playerCount === 4) {
    pills.push(`Partner: <b>${safe(state.players[state.partnerIndex].name)}</b>`);
  } else if (state.playerCount === 4 && state.calledCard && !state.calledCardRevealed) {
    pills.push('Partner: <b>še skrit</b>');
  }
  if (state.talonCount) pills.push(`Talon: <b>${state.talonCount}</b>`);
  $('#gameInfo').innerHTML = pills.map((p) => `<span class="info-pill">${p}</span>`).join('');
}

function renderPlayersAround() {
  $('#playersAround').innerHTML = state.players.map((p) => `
    <div class="player-chip ${state.turnIndex === p.index ? 'turn' : ''}">
      <div><b>${safe(p.name)}</b>${p.index === state.me ? ' <span class="muted">(ti)</span>' : ''}</div>
      <div class="meta"><span>${p.handCount} kart</span><span>${p.roundPoints} t.</span></div>
    </div>`).join('');
}

function renderTrick() {
  const area = $('#trickArea');
  if (!state.trick.length) {
    area.innerHTML = `<div class="empty-table">${state.phase === 'playing' ? 'Miza je prazna. Vodilni igralec odigra karto.' : 'Ko se igra začne, se karte odlagajo tukaj.'}</div>`;
    return;
  }
  area.innerHTML = `<div class="trick-grid">${state.trick.map((p) => `
    <div class="played"><span class="played-name">${safe(state.players[p.playerIndex].name)}</span>${cardHTML(p.card)}</div>
  `).join('')}</div>`;
}

function renderLobbyActions() {
  const me = state.players[state.me];
  const full = state.players.length === state.playerCount;
  return `<div class="action-box">
    <h3>${state.players.length}/${state.playerCount} igralcev v sobi</h3>
    <p class="muted">Pošljite kodo <b>${safe(state.code)}</b> ostalim. Vsak naj odpre stran na svojem telefonu.</p>
    ${me?.isHost ? `<button id="startBtn" class="primary big" ${full ? '' : 'disabled'}>Začni igro</button>` : '<p class="muted">Igro bo začel gostitelj.</p>'}
  </div>`;
}

function renderTrumpActions() {
  if (state.me !== state.callerIndex) return `<div class="action-box"><p class="muted">Počakaj, da ${safe(state.players[state.callerIndex].name)} izbere aduta.</p></div>`;
  return `<div class="action-box">
    <h3>Izberi aduta</h3>
    <div class="action-buttons">
      ${Object.keys(suitSymbol).map((s) => `<button class="secondary suit-btn" data-trump="${s}">${suitSymbol[s]}</button>`).join('')}
      <button class="ghost" id="fourthBtn">Odpri 4. karto</button>
    </div>
  </div>`;
}

function renderTalonActions() {
  if (state.me !== state.callerIndex) return `<div class="action-box"><p class="muted">Klicatelj ureja talon.</p></div>`;
  return `<div class="action-box">
    <h3>Talon</h3>
    <p class="muted">Izberi 2 karti iz roke in ju zamenjaj s talonom, ali talon preskoči.</p>
    <div class="action-buttons">
      <button id="exchangeBtn" class="primary" ${selectedTalon.size === 2 ? '' : 'disabled'}>Zamenjaj izbrani 2</button>
      <button id="skipTalonBtn" class="ghost">Brez menjave</button>
    </div>
  </div>`;
}

function renderCallActions() {
  if (state.me !== state.callerIndex) return `<div class="action-box"><p class="muted">Počakaj na rufanje.</p></div>`;
  return `<div class="action-box">
    <h3>Rufaj karto</h3>
    <p class="muted">Izberi barvo in vrednost karte, ki je nimaš med prvimi tremi.</p>
    ${Object.keys(suitSymbol).map((s) => `<div style="margin:8px 0"><b>${suitSymbol[s]} ${safe(suitName[s])}</b><div class="call-grid">${['J','Q','K','10','A'].map((r) => `<button data-call-suit="${s}" data-call-rank="${r}">${r}</button>`).join('')}</div></div>`).join('')}
  </div>`;
}

function renderAuctionActions() {
  const mine = state.me === state.auction.currentIndex;
  const best = state.auction.best;
  return `<div class="action-box">
    <h3>Licitacija</h3>
    <p class="muted">Trenutno: <b>${safe(state.contracts[best.contract].label)}</b> — ${safe(state.players[best.playerIndex].name)}</p>
    ${mine ? `<div class="contract-grid">
      ${Object.entries(state.contracts).map(([key, c]) => `<button class="contract-btn ${key === best.contract ? 'best' : ''}" data-bid="${key}" ${c.value < best.value ? 'disabled' : ''}>${safe(c.label)}<br><small>${c.value}</small></button>`).join('')}
      <button class="contract-btn" data-bid="pass">Pas</button>
    </div>` : `<p class="muted">Na potezi je ${safe(state.players[state.auction.currentIndex].name)}.</p>`}
  </div>`;
}

function renderPlayActions() {
  if (state.me !== state.turnIndex) return `<div class="action-box"><p class="muted">Na potezi je ${safe(state.players[state.turnIndex].name)}.</p></div>`;
  const melds = state.eligibleMelds || [];
  return `<div class="action-box">
    <h3>Tvoja poteza</h3>
    <p class="muted">Izberi osvetljeno karto. Nedovoljene karte so zatemnjene.</p>
    ${melds.length ? `<div class="action-buttons">${melds.map((m) => `<button class="secondary" data-meld="${m.suit}">Napovej ${m.points} (${suitSymbol[m.suit]})</button>`).join('')}</div>` : ''}
  </div>`;
}

function renderEndActions() {
  const r = state.roundResult;
  const winners = r?.winners?.map((i) => state.players[i].name).join(' + ') || '';
  const matchWinners = state.players.filter((p) => p.matchPoints >= state.targetScore).map((p) => p.name).join(' + ');
  return `<div class="action-box">
    <h3>${state.phase === 'match_end' ? `🏆 ${safe(matchWinners)} je zmagal/a!` : `Rundo dobi: ${safe(winners)}`}</h3>
    ${r ? `<p class="muted">+${r.amount} · ${safe(r.reason)}</p>` : ''}
    ${state.phase === 'round_end' && state.players[state.me]?.isHost ? '<button id="nextRoundBtn" class="primary big">Naslednja runda</button>' : ''}
    ${state.phase === 'round_end' && !state.players[state.me]?.isHost ? '<p class="muted">Gostitelj bo začel naslednjo rundo.</p>' : ''}
  </div>`;
}

function renderActions() {
  let html = '';
  if (state.phase === 'lobby') html = renderLobbyActions();
  if (state.phase === 'choose_trump') html = renderTrumpActions();
  if (state.phase === 'talon_exchange') html = renderTalonActions();
  if (state.phase === 'choose_call') html = renderCallActions();
  if (state.phase === 'auction') html = renderAuctionActions();
  if (state.phase === 'playing') html = renderPlayActions();
  if (state.phase === 'round_end' || state.phase === 'match_end') html = renderEndActions();
  $('#actionArea').innerHTML = html;

  $('#startBtn')?.addEventListener('click', () => socket.emit('startGame'));
  $('#nextRoundBtn')?.addEventListener('click', () => { selectedTalon.clear(); socket.emit('nextRound'); });
  $$('[data-trump]').forEach((b) => b.addEventListener('click', () => socket.emit('chooseTrump', { suit: b.dataset.trump })));
  $('#fourthBtn')?.addEventListener('click', () => socket.emit('chooseTrump', { fourthCard: true }));
  $('#exchangeBtn')?.addEventListener('click', () => socket.emit('exchangeTalon', { cardIds: [...selectedTalon] }));
  $('#skipTalonBtn')?.addEventListener('click', () => socket.emit('exchangeTalon', { cardIds: [] }));
  $$('[data-call-suit]').forEach((b) => b.addEventListener('click', () => socket.emit('chooseCall', { suit: b.dataset.callSuit, rank: b.dataset.callRank })));
  $$('[data-bid]').forEach((b) => b.addEventListener('click', () => socket.emit('bid', { contract: b.dataset.bid })));
  $$('[data-meld]').forEach((b) => b.addEventListener('click', () => socket.emit('declareMeld', { suit: b.dataset.meld })));
}

function sortHand(cards) {
  const sOrder = { hearts: 0, diamonds: 1, clubs: 2, spades: 3 };
  const rOrder = { J: 0, Q: 1, K: 2, '10': 3, A: 4 };
  return cards.slice().sort((a, b) => sOrder[a.suit] - sOrder[b.suit] || rOrder[a.rank] - rOrder[b.rank]);
}

function renderHand() {
  const hand = sortHand(state.myHand || []);
  if (!hand.length) {
    $('#handArea').innerHTML = '';
    return;
  }
  const talonMode = state.phase === 'talon_exchange' && state.me === state.callerIndex;
  const legal = new Set(state.legalCardIds || []);
  $('#handArea').innerHTML = `
    <div class="hand-title"><b>Tvoje karte</b><span class="muted">${hand.length} kart</span></div>
    <div class="hand-scroll">${hand.map((c) => cardHTML(c, {
      button: true,
      playable: talonMode || legal.has(c.id),
      selected: selectedTalon.has(c.id)
    })).join('')}</div>`;

  $$('#handArea [data-card-id]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.cardId;
    if (talonMode) {
      if (selectedTalon.has(id)) selectedTalon.delete(id);
      else if (selectedTalon.size < 2) selectedTalon.add(id);
      renderActions();
      renderHand();
      return;
    }
    if (legal.has(id)) socket.emit('playCard', { cardId: id });
  }));
}

function renderLogs() {
  $('#logTab').innerHTML = state.log.slice().reverse().map((l) => `<div class="log-line">${safe(l.text)}</div>`).join('') || '<div class="muted">Še brez dogodkov.</div>';
  const chat = $('#chatMessages');
  chat.innerHTML = state.chat.map((m) => `<div class="chat-line"><b>${safe(m.name)}:</b> ${safe(m.text)}</div>`).join('') || '<div class="muted">Klepet je prazen.</div>';
  chat.scrollTop = chat.scrollHeight;
}

function render() {
  if (!state) return;
  enterGame(state.code);
  $('#roomCode').textContent = state.code;
  $('#roundNo').textContent = state.roundNo;
  const [phase, title] = phaseText();
  $('#phaseLabel').textContent = phase;
  $('#statusTitle').textContent = title;
  renderScoreboard();
  renderGameInfo();
  renderPlayersAround();
  renderTrick();
  renderActions();
  renderHand();
  renderLogs();
}

$$('.seg').forEach((b) => b.addEventListener('click', () => {
  $$('.seg').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  playerCount = Number(b.dataset.count);
}));

$('#createBtn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) return homeError.textContent = 'Vpiši ime.';
  homeError.textContent = '';
  const tempToken = `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  socket.emit('createRoom', { name, playerCount, targetScore: Number(targetScoreInput.value), token: tempToken }, (res) => {
    if (!res.ok) return homeError.textContent = res.error || 'Napaka.';
    roomCodeInput.value = res.code;
    saveSession(res.code, res.token, name);
    enterGame(res.code);
  });
});

$('#joinBtn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name || code.length !== 5) return homeError.textContent = 'Vpiši ime in 5-mestno kodo sobe.';
  homeError.textContent = '';
  const token = localStorage.getItem(`snops-token-${code}`) || `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  socket.emit('joinRoom', { name, code, token }, (res) => {
    if (!res.ok) return homeError.textContent = res.error || 'Pridružitev ni uspela.';
    saveSession(code, res.token, name);
    enterGame(code);
  });
});

roomCodeInput.addEventListener('input', () => roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5));

$('#shareBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.code)}`;
  const text = `Pridruži se naši igri Šnops Online. Koda sobe: ${state.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Šnops Online', text, url });
    else {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast('Povezava in koda sta kopirani.');
    }
  } catch (_) {}
});

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  input.value = '';
});

$$('.tab').forEach((b) => b.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
  ['log', 'chat', 'rules'].forEach((tab) => $(`#${tab}Tab`).classList.toggle('hidden', tab !== b.dataset.tab));
}));

socket.on('state', (next) => {
  state = next;
  if (state.phase !== 'talon_exchange') selectedTalon.clear();
  render();
});

socket.on('gameError', (message) => toast(message));
socket.on('connect', () => {
  connectionBadge.textContent = 'online';
  connectionBadge.className = 'status online';

  const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
  const name = localStorage.getItem('snops-name');
  const token = code ? localStorage.getItem(`snops-token-${code}`) : null;
  if (code && name && token && !state) {
    socket.emit('joinRoom', { name, code, token }, (res) => {
      if (res.ok) enterGame(code);
    });
  }
});
socket.on('disconnect', () => {
  connectionBadge.textContent = 'brez povezave';
  connectionBadge.className = 'status offline';
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('#installBtn').classList.remove('hidden');
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('#installBtn').classList.add('hidden');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
