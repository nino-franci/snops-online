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
const suitName = { hearts: 'srce', diamonds: 'kara', clubs: 'križ', spades: 'pik' };
const suitLetter = { hearts: 'S', diamonds: 'K', clubs: 'K', spades: 'P' };

let playerCount = 4;
let state = null;
let selectedTalon = new Set();
let deferredInstall = null;
let seatSwapFrom = null;
const savedFocusPreference = localStorage.getItem('snops-focus');
let focusEnabled = savedFocusPreference === null ? true : savedFocusPreference === '1';
let strictRulesChoice = true;
let trickAnimationTimer = null;
let previousTeamPenalties = null;
let lastRoundDialogKey = null;
let chatOpen = false;
let unreadChatCount = 0;
let previousChatCount = 0;

const cardAssetUrls = ['J','Q','K','10','A'].flatMap((rank) =>
  ['C','D','H','S'].map((suit) => `/cards/${rank}${suit}.png`)
);

nameInput.value = localStorage.getItem('snops-name') || '';
roomCodeInput.value = new URLSearchParams(location.search).get('room') || '';

function preloadCardAssets() {
  for (const url of cardAssetUrls) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  }
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.add('hidden'), 2800);
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
  return String(s ?? '').replace(/[&<>'"]/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[m]));
}

function pipLayout(rank, symbol) {
  const n = rank === 'A' ? 1 : rank === '10' ? 10 : 0;
  if (!n) return `<div class="face-mark">${rank}</div><div class="face-suit">${symbol}</div>`;
  if (n === 1) return `<div class="pip single">${symbol}</div>`;
  return `<div class="ten-pips">${Array.from({length:10}, () => `<span>${symbol}</span>`).join('')}</div>`;
}

function cardAssetName(card) {
  const suitCode = { hearts:'H', diamonds:'D', clubs:'C', spades:'S' }[card.suit];
  return `${card.rank}${suitCode}.png`;
}
function cardHTML(card, { button=false, playable=false, selected=false, ghost=false } = {}) {
  const red = ['hearts','diamonds'].includes(card.suit) ? ' red' : '';
  const classes = `card${red}${playable ? ' playable' : ''}${selected ? ' selected' : ''}${ghost ? ' ghost-card' : ''}`;
  const attrs = button ? `data-card-id="${safe(card.id)}" ${playable ? '' : 'disabled'}` : '';
  const tag = button ? 'button' : 'div';
  const asset = `/cards/${cardAssetName(card)}`;
  return `<${tag} class="${classes}" ${attrs} aria-label="${safe(card.rank)} ${safe(suitName[card.suit])}">
    <span class="card-fallback">
      <span class="corner top"><b>${safe(card.rank)}</b><i>${suitSymbol[card.suit]}</i></span>
      <span class="card-center">${pipLayout(card.rank, suitSymbol[card.suit])}</span>
      <span class="corner bottom"><b>${safe(card.rank)}</b><i>${suitSymbol[card.suit]}</i></span>
    </span>
    <img class="card-art" src="${asset}" alt="" draggable="false" onerror="this.remove()" />
  </${tag}>`;
}

function roleLabel(index) {
  if (!state) return '';
  const roles = [];
  if (index === state.dealerIndex) roles.push('deli');
  if (index === state.cutterIndex && state.playerCount === 4) roles.push('desno od delivca: predvig/udarec');
  if (index === state.callerIndex) roles.push('levo od delivca: rufa');
  if (state.bidderIndex === index) roles.push('igra');
  return roles.join(' · ');
}

function renderScoreboard() {
  const isHost = state.players[state.me]?.isHost;
  if (state.playerCount === 4 && state.teams) {
    $('#scoreboard').innerHTML = state.teams.map((t) => {
      const names = t.members.map((i) => state.players[i]?.name).filter(Boolean).join(' + ');
      const oldScore = previousTeamPenalties?.[t.index];
      const gain = Number.isFinite(oldScore) && t.penalty > oldScore ? t.penalty - oldScore : 0;
      return `<div class="score-card team-card ${state.myTeam === t.index ? 'me' : ''}">
        <div class="score-name"><b>Ekipa ${t.index + 1}</b></div>
        <div class="team-names">${safe(names)}</div>
        <div class="score-main"><strong class="${gain ? 'score-gained' : ''}">${gain ? `<span>${oldScore}</span><em>+${gain}</em><span>→ ${t.penalty}</span>` : t.penalty}</strong><span class="score-small">/ ${state.targetScore}</span></div>
      </div>`;
    }).join('');
    $('#hostScoreTools').classList.toggle('hidden', !isHost);
    $('#scoreTools').innerHTML = isHost ? state.teams.map((t) => `<div class="score-adjust-row"><span>Ekipa ${t.index + 1}: <b>${t.penalty}</b></span><span><button data-team-score="${t.index}" data-delta="-1">−</button><button data-team-score="${t.index}" data-delta="1">+</button></span></div>`).join('') : '';
    $$('[data-team-score]').forEach((b) => b.addEventListener('click', () => socket.emit('adjustScore', { team:Number(b.dataset.teamScore), delta:Number(b.dataset.delta) })));
    previousTeamPenalties = state.teams.map((t) => t.penalty);
    return;
  }
  $('#scoreboard').innerHTML = state.players.map((p) => `<div class="score-card ${p.index===state.me?'me':''}"><b>${safe(p.name)}</b><div class="score-small">${p.roundPoints} t. · ${p.tricks} štihov</div></div>`).join('');
}

function phaseText() {
  const p = state.phase;
  if (p === 'lobby') return ['Čakalnica', 'Počakajte na vse igralce'];
  if (p === 'cut') return ['Deljenje', `${state.players[state.cutterIndex].name}: predvig ali udarec?`];
  if (p === 'choose_call') return ['Rufanje', `${state.players[state.callerIndex].name} rufa aduta`];
  if (p === 'choose_trump') return ['Adut', `${state.players[state.callerIndex].name} izbira aduta`];
  if (p === 'talon_exchange') return ['Talon', `${state.players[state.callerIndex].name} ureja talon`];
  if (p === 'auction') return ['Licitacija', `${state.players[state.auction.currentIndex].name} je na vrsti`];
  if (p === 'contra') return ['Kontra', `Vrednost igre ×${state.multiplier}`];
  if (p === 'playing' && state.trickCollectAt) return ['Štih', `${state.players[state.trickWinner]?.name || ''} pobere`];
  if (p === 'playing') return ['Igra', `${state.players[state.turnIndex]?.name || ''} je na potezi`];
  if (p === 'round_end') return ['Konec runde', 'Rezultat runde je zapisan'];
  if (p === 'match_end') return ['Konec partije', 'Dosežen je rezultat 25'];
  return ['', ''];
}

function renderGameInfo() {
  const pills = [];
  if (state.phase === 'playing') {
    if (!focusEnabled) pills.push(`Pravila <b>${state.strictRules ? 'stroga' : 'ohlapna'}</b>`);
    if (state.trumpSuit && ['normal','schnops','big_trump'].includes(state.contract)) pills.push(`Adut <b>${suitSymbol[state.trumpSuit]} ${safe(suitName[state.trumpSuit])}</b>`);
    else pills.push('<b>Brez aduta</b>');
    const turnName = state.players[state.turnIndex]?.name || '';
    pills.push(`Na vrsti <b>${safe(turnName)}${state.turnIndex===state.me?' (ti)':''}</b>`);
  } else {
    if (state.playerCount === 4 && state.players.length === 4) pills.push(`<b>Pari:</b> ${safe(state.players[0].name)} + ${safe(state.players[2].name)} / ${safe(state.players[1].name)} + ${safe(state.players[3].name)}`);
    if (state.trumpSuit) pills.push(`Adut: <b>${suitSymbol[state.trumpSuit]} ${safe(suitName[state.trumpSuit])}</b>`);
    if (state.contract) pills.push(`Igra: <b>${safe(state.contracts[state.contract].label)}</b>`);
    if (state.multiplier > 1) pills.push(`Kontra: <b>×${state.multiplier}</b>`);
  }
  $('#gameInfo').innerHTML = pills.map((p) => `<span class="info-pill">${p}</span>`).join('');
}

function relativeSeat(index) {
  if (state.playerCount !== 4 || state.me < 0) return 'seat-inline';
  const delta = (index - state.me + 4) % 4;
  return ['seat-bottom','seat-right','seat-top','seat-left'][delta];
}
function cardBacks(count) {
  const visible = Math.min(5, Math.max(0, count));
  return `<div class="back-fan" aria-label="${count} skritih kart">${Array.from({length:visible},()=>'<span class="mini-back"></span>').join('')}</div>`;
}
function renderPlayersAround() {
  const players = state.players.map((p) => {
    const mine = p.index === state.me;
    const partner = state.playerCount===4 && ((p.index-state.me+4)%4===2);
    const turn = state.turnIndex===p.index;
    return `<div class="table-seat ${relativeSeat(p.index)} ${turn?'turn':''} ${mine?'mine':''}">
      <div class="seat-name">${turn?'<span class="turn-dot"></span>':''}<b>${p.isBot?'🤖 ':''}${safe(p.name)}</b>${mine?' <span class="you">ti</span>':partner?' <span class="partner">partner</span>':''}</div>
      ${mine ? `<span class="seat-meta">${p.handCount} kart</span>` : cardBacks(p.handCount)}
    </div>`;
  }).join('');
  const pileOwner = state.myTeamPileOwner;
  const pile = Number.isInteger(pileOwner) && state.myTeamCapturedCount > 0
    ? `<div class="captured-pile ${relativeSeat(pileOwner)}"><div class="pile-cards" aria-hidden="true"><i></i><i></i><i></i></div><div><b>${state.myTeamCapturedCount} kart</b><span>${state.myTeamRoundPoints} točk</span></div></div>`
    : '';
  $('#playersAround').innerHTML = players + pile;
}

function smallTrackPosition(seatClass, step) {
  // step 0..4: prva karta je blizu sredine, naslednje gredo proti igralcu.
  const t = 0.25 + step * 0.12;
  const targets = {
    'seat-bottom':[50,88,0], 'seat-top':[50,12,180],
    'seat-left':[8,50,90], 'seat-right':[92,50,-90]
  };
  const [tx,ty,rot] = targets[seatClass] || [50,50,0];
  const x = 50 + (tx-50)*t;
  const y = 50 + (ty-50)*t;
  return `left:${x}%;top:${y}%;--card-rot:${rot}deg;`;
}
function renderSmallTracks(area) {
  const completed = state.smallHistory || [];
  const byPlayer = new Map(state.players.map((p) => [p.index, []]));
  completed.forEach((trick) => trick.forEach((play) => byPlayer.get(play.playerIndex)?.push(play.card)));
  state.trick.forEach((play) => byPlayer.get(play.playerIndex)?.push(play.card));
  const cards = [];
  for (const p of state.players) {
    const seat = relativeSeat(p.index);
    const list = byPlayer.get(p.index) || [];
    list.forEach((card, i) => cards.push(`<div class="small-played ${seat} ${i === list.length-1 && state.trick.some(x=>x.playerIndex===p.index) ? 'current':''}" style="${smallTrackPosition(seat,i)}">${cardHTML(card)}</div>`));
  }
  area.innerHTML = `<div class="small-track-layer"><div class="table-center-mark">Mali · ${completed.length + 1}/5</div>${cards.join('')}</div>`;
}
function renderTrick() {
  const area = $('#trickArea');
  if (state.phase === 'playing' && state.contract === 'small') {
    renderSmallTracks(area);
    return;
  }
  if (!state.trick.length) {
    area.innerHTML = `<div class="table-center-mark">${state.phase==='playing'?'Šnops':'Miza'}</div>`;
    return;
  }
  const meld = state.meldDisplay;
  const collecting = state.trickCollectAt && Date.now() >= state.trickCollectAt;
  const winnerSeat = Number.isInteger(state.trickWinner) ? relativeSeat(state.trickWinner) : '';
  area.innerHTML = `<div class="trick-cross ${collecting ? `collecting collect-${winnerSeat}` : ''}">${state.trick.map((p) => {
    const extra = meld && meld.playerIndex === p.playerIndex
      ? `<div class="meld-pair-preview"><div class="meld-main">${cardHTML(p.card)}</div><div class="meld-ghost">${cardHTML(meld.shownCard,{ghost:true})}</div><span class="meld-badge">${meld.points}</span></div>`
      : cardHTML(p.card);
    return `<div class="played ${relativeSeat(p.playerIndex)}">${extra}</div>`;
  }).join('')}</div>`;
}

function renderTip() {
  const tip = $('#gameTip');
  if (state.phase !== 'playing') { tip.innerHTML = ''; tip.classList.add('hidden'); return; }
  let text = 'Karte drugih igralcev ostanejo skrite.';
  if (state.trickCollectAt) text = 'Poglej štih — karte bodo pobrane čez trenutek.';
  else if (state.me === state.turnIndex) text = 'Tvoja poteza: izberi označeno karto.';
  else if (state.strictRules) text = 'Stroga pravila samodejno označijo dovoljene karte.';
  tip.innerHTML = `<span aria-hidden="true">💡</span><span>${safe(text)}</span>`;
  tip.classList.remove('hidden');
}

function scheduleTrickAnimation() {
  clearTimeout(trickAnimationTimer);
  trickAnimationTimer = null;
  if (!state?.trickCollectAt) return;
  const startCollection = () => {
    if (!state?.trickCollectAt || Date.now() < state.trickCollectAt) {
      scheduleTrickAnimation();
      return;
    }
    const cross = $('#trickArea .trick-cross');
    if (!cross || !Number.isInteger(state.trickWinner)) return;
    // Paint the cards first so the browser has a stable animation start frame.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cross.classList.add('collecting', `collect-${relativeSeat(state.trickWinner)}`);
      renderTip();
    }));
  };
  const delay = Math.max(0, state.trickCollectAt - Date.now());
  trickAnimationTimer = setTimeout(startCollection, delay + 8);
}

function renderLobbyActions() {
  const me = state.players[state.me];
  const full = state.players.length === state.playerCount;
  const seatLabels = ['Sedež 1','Sedež 2','Sedež 3','Sedež 4'];
  const visualManager = me?.isHost && state.playerCount===4 ? `<div class="team-manager visual-manager">
    <h4>Razporedi ekipe</h4>
    <p class="muted">Povleci igralca na drug sedež ali tapni dva igralca za zamenjavo. Nasprotna sedeža sta partnerja.</p>
    <div class="seat-editor-board">
      ${state.players.map((p)=>`<button type="button" class="seat-editor-chip seat-editor-${p.index} ${seatSwapFrom===p.index?'picked':''}" draggable="true" data-seat-chip="${p.index}" data-drop-seat="${p.index}">
        <small>${seatLabels[p.index]}</small><b>${p.isBot?'🤖 ':''}${safe(p.name)}</b><span>${p.index%2===0?'Ekipa A':'Ekipa B'}</span>
      </button>`).join('')}
      <div class="pair-line pair-a"></div><div class="pair-line pair-b"></div>
      <div class="seat-editor-center">A ↕<br>B ↔</div>
    </div>
    <div class="pair-summary"><span><b>Ekipa A:</b> ${safe(state.players[0]?.name||'—')} + ${safe(state.players[2]?.name||'—')}</span><span><b>Ekipa B:</b> ${safe(state.players[1]?.name||'—')} + ${safe(state.players[3]?.name||'—')}</span></div>
    <div class="bot-manager">${state.players.length < state.playerCount ? '<button type="button" class="secondary" id="addBotBtn">🤖 Dodaj bota</button>' : ''}${state.players.filter(p=>p.isBot).map(p=>`<button type="button" class="ghost bot-remove" data-remove-bot="${p.index}">Odstrani ${safe(p.name)}</button>`).join('')}</div>
    <p class="muted bot-note">Bot vedno igra po strogih pravilih, tudi če je soba nastavljena na ohlapna pravila.</p>
  </div>` : '';
  return `<div class="action-box lobby-action"><h3>${state.players.length}/${state.playerCount} igralcev</h3>
    ${full ? '<p class="ready-note">Vsi ste za mizo. Gostitelj naj uredi sedeže in začne deljenje.</p>' : '<p class="muted">Čakamo še ostale igralce.</p>'}
    ${visualManager}
    ${me?.isHost ? `<div class="strict-lobby"><span><b>Stroga pravila</b><small>${state.strictRules ? ' Program prepreči napačno karto.' : ' Igralec lahko švingla.'}</small></span><div class="segmented compact-seg"><button type="button" class="seg ${state.strictRules?'active':''}" data-lobby-strict="1">DA</button><button type="button" class="seg ${!state.strictRules?'active':''}" data-lobby-strict="0">NE</button></div></div><button id="startBtn" class="primary big" ${full?'':'disabled'}>Sedeži so pravilni · začni deljenje</button>` : `<p class="muted">Gostitelj razporedi ekipe in začne deljenje.</p><p class="muted">Stroga pravila: <b>${state.strictRules?'DA':'NE'}</b></p>`}
  </div>`;
}

function renderCutActions() {
  if (state.me !== state.cutterIndex) return `<div class="action-box"><p class="muted">${safe(state.players[state.cutterIndex].name)} izbira predvig ali udarec.</p></div>`;
  return `<div class="action-box"><h3>Predvig ali udarec?</h3><p class="muted">To izbira igralec desno od delivca. Predvig: igralec levo od delivca najprej dobi 3 in rufa, po 3 kartah za vse sledi se 2-2-2-2. Udarec: igralec levo od delivca dobi 3, rufa, nato se 2; ostali dobijo po 5.</p><div class="action-buttons"><button class="primary" data-cut="cut">Predvig</button><button class="secondary" data-cut="knock">Udari po kartah</button></div></div>`;
}
function renderCallActions() {
  if (state.me !== state.callerIndex) return `<div class="action-box"><p class="muted">Počakaj, da ${safe(state.players[state.callerIndex].name)} rufa aduta.</p></div>`;
  return `<div class="action-box"><h3>Rufaj aduta</h3><p class="muted">Lahko izbereš katerokoli barvo, tudi če jo že imaš v roki.</p><div class="action-buttons">${Object.keys(suitSymbol).map((s) => `<button class="secondary suit-btn" data-call-suit="${s}">${suitSymbol[s]} ${safe(suitName[s])}</button>`).join('')}</div></div>`;
}
function renderTrumpActions() {
  if (state.me !== state.callerIndex) return `<div class="action-box"><p class="muted">Počakaj na izbiro aduta.</p></div>`;
  return `<div class="action-box"><h3>Izberi aduta</h3><div class="action-buttons">${Object.keys(suitSymbol).map((s) => `<button class="secondary suit-btn" data-trump="${s}">${suitSymbol[s]}</button>`).join('')}<button id="fourthBtn" class="ghost">Odpri 4. karto</button></div></div>`;
}
function renderTalonActions() {
  if (state.me !== state.callerIndex) return `<div class="action-box"><p class="muted">Klicatelj ureja talon.</p></div>`;
  return `<div class="action-box"><h3>Talon</h3><div class="action-buttons"><button id="exchangeBtn" class="primary" ${selectedTalon.size===2?'':'disabled'}>Zamenjaj 2</button><button id="skipTalonBtn" class="ghost">Brez menjave</button></div></div>`;
}
function renderAuctionActions() {
  const mine = state.me === state.auction.currentIndex;
  const best = state.auction.best;
  const bestText = best ? `${state.contracts[best.contract].label} — ${state.players[best.playerIndex].name}` : 'še brez posebne igre';
  const order = ['schnops','small','big','big_trump','eighteen','twentyfour'];
  return `<div class="action-box"><h3>Licitacija</h3><p class="muted">Trenutno: <b>${safe(bestText)}</b></p>
    ${mine ? `<div class="contract-grid">${order.map((key) => { const c=state.contracts[key]; const disabled=best && c.value<=best.value; return `<button class="contract-btn" data-bid="${key}" ${disabled?'disabled':''}>${safe(c.label)}<br><small>${c.value}</small></button>`; }).join('')}<button class="contract-btn pass" data-bid="pass">Dalje</button></div>` : `<p class="muted">Na vrsti je ${safe(state.players[state.auction.currentIndex].name)}.</p>`}
  </div>`;
}
function contraLabel() {
  if (!state.contra) return '';
  if (state.contra.stage === 0) return 'Kontra';
  if (state.contra.stage === 1) return 'Kontra nazaj';
  return 'Do konca';
}
function renderContraActions() {
  const mine = state.myTeam === state.contra.actionTeam;
  const alreadyPassed = state.contra.passed.includes(state.me);
  if (!mine) return `<div class="action-box"><h3>Pred prvo karto</h3><p class="muted">Druga ekipa se odloča. Trenutno ×${state.multiplier}.</p></div>`;
  return `<div class="action-box"><h3>${contraLabel()}</h3><p class="muted">Kontra je možna samo pred prvo odigrano karto.</p><div class="action-buttons"><button class="primary" data-contra="raise" ${alreadyPassed?'disabled':''}>${contraLabel()}</button><button class="ghost" data-contra="pass" ${alreadyPassed?'disabled':''}>Brez / dalje</button></div>${alreadyPassed?'<p class="muted">Čakamo partnerja.</p>':''}</div>`;
}
function renderPlayActions() {
  const melds = state.eligibleMelds || [];
  const myTurn = state.me === state.turnIndex;
  const buttons = [];
  if (melds.length) {
    const hand = state.myHand || [];
    for (const m of melds) {
      for (const rank of ['Q','K']) {
        const c = hand.find((x) => x.suit === m.suit && x.rank === rank);
        if (c) buttons.push(`<button class="secondary meld-choice" data-meld-card="${safe(c.id)}">${m.points}: odigraj ${rank}${suitSymbol[m.suit]}</button>`);
      }
    }
  }
  if (state.canCount) buttons.push('<button class="primary" id="countBtn">Štejem</button>');
  if (state.canClose) buttons.push('<button class="primary" id="closeBtn">Zaprem</button>');
  const waitingText = state.trickCollectAt
    ? 'Končan štih bo čez trenutek pobran z mize.'
    : `Na potezi je ${safe(state.players[state.turnIndex]?.name || 'naslednji igralec')}.`;
  return `<div class="action-box"><h3>${myTurn?'Ti si na vrsti':'Igra poteka'}</h3><p class="muted">${myTurn?'Izberi karto.':waitingText}</p>${buttons.length?`<div class="action-buttons">${buttons.join('')}</div>`:''}</div>`;
}

function renderRoundDialog() {
  const r = state.roundResult;
  if (!r || !['round_end','match_end'].includes(state.phase)) return;
  const key = `${state.roundNo}:${r.winnerTeam}:${r.amount}:${r.reason}`;
  if (lastRoundDialogKey === key) return;
  lastRoundDialogKey = key;
  const winnerNames = r.winners.map((i) => state.players[i]?.name).filter(Boolean).join(' in ');
  $('#roundResultTitle').textContent = `Zmagala je ekipa ${r.winnerTeam + 1}`;
  const multiplierText = r.multiplier > 1 ? `<p class="muted">Vrednost: ${r.baseAmount} × ${r.multiplier} = ${r.amount}.</p>` : '';
  $('#roundResultBody').innerHTML = `<p><b>${safe(winnerNames)}</b></p><p>${safe(r.reason)}</p>${multiplierText}<div class="result-score">Ekipa ${r.loserTeam + 1}: <span>${state.teams[r.loserTeam].penalty - r.amount}</span><em>+${r.amount}</em><strong>→ ${state.teams[r.loserTeam].penalty}</strong></div>`;
  $('#roundDialog').classList.remove('hidden');
}
function renderEndActions() {
  const r = state.roundResult;
  let title = 'Konec runde';
  if (r && state.playerCount===4) title = `Zmaga ekipa ${r.winnerTeam + 1}`;
  if (state.phase === 'match_end' && state.playerCount===4) {
    const losingTeam = state.teams.find((t) => t.penalty >= state.targetScore)?.index ?? r?.loserTeam;
    title = `🏆 Partijo dobi ekipa ${losingTeam === 0 ? 2 : 1}`;
  }
  return `<div class="action-box"><h3>${title}</h3>${r?`<p class="muted">Ekipa ${r.loserTeam+1} piše <b>${r.amount}</b>${r.multiplier>1?` (${r.baseAmount} × ${r.multiplier})`:''}. ${safe(r.reason)}</p>`:''}${state.phase==='round_end'&&state.players[state.me]?.isHost?'<button id="nextRoundBtn" class="primary big">Naslednja runda</button>':''}</div>`;
}

function renderActions() {
  let html = '';
  if (state.phase==='lobby') html=renderLobbyActions();
  else if (state.phase==='cut') html=renderCutActions();
  else if (state.phase==='choose_call') html=renderCallActions();
  else if (state.phase==='choose_trump') html=renderTrumpActions();
  else if (state.phase==='talon_exchange') html=renderTalonActions();
  else if (state.phase==='auction') html=renderAuctionActions();
  else if (state.phase==='contra') html=renderContraActions();
  else if (state.phase==='playing') html=renderPlayActions();
  else if (state.phase==='round_end'||state.phase==='match_end') html=renderEndActions();
  $('#actionArea').innerHTML = html;

  $('#startBtn')?.addEventListener('click', () => socket.emit('startGame'));
  $('#addBotBtn')?.addEventListener('click', () => socket.emit('addBot'));
  $$('[data-remove-bot]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); socket.emit('removeBot', { playerIndex:Number(b.dataset.removeBot) }); }));
  $$('[data-lobby-strict]').forEach((b) => b.addEventListener('click', () => socket.emit('setStrictRules', { enabled: b.dataset.lobbyStrict === '1' })));
  $$('[data-seat-chip]').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.seatChip);
      if (seatSwapFrom === null) { seatSwapFrom = idx; renderActions(); return; }
      if (seatSwapFrom === idx) { seatSwapFrom = null; renderActions(); return; }
      socket.emit('setSeat', { playerIndex: seatSwapFrom, seatIndex: idx });
      seatSwapFrom = null;
    });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.seatChip); e.dataTransfer.effectAllowed='move'; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect='move'; el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('drag-over');
      const from = Number(e.dataTransfer.getData('text/plain')), to = Number(el.dataset.dropSeat);
      if (Number.isInteger(from) && Number.isInteger(to) && from !== to) socket.emit('setSeat', { playerIndex: from, seatIndex: to });
      seatSwapFrom = null;
    });
  });
  $('#nextRoundBtn')?.addEventListener('click', () => { selectedTalon.clear(); socket.emit('nextRound'); });
  $$('[data-cut]').forEach((b) => b.addEventListener('click', () => socket.emit('chooseCut', { mode:b.dataset.cut })));
  $$('[data-call-suit]').forEach((b) => b.addEventListener('click', () => socket.emit('chooseCall', { suit:b.dataset.callSuit })));
  $$('[data-trump]').forEach((b) => b.addEventListener('click', () => socket.emit('chooseTrump', { suit:b.dataset.trump })));
  $('#fourthBtn')?.addEventListener('click', () => socket.emit('chooseTrump', { fourthCard:true }));
  $('#exchangeBtn')?.addEventListener('click', () => socket.emit('exchangeTalon', { cardIds:[...selectedTalon] }));
  $('#skipTalonBtn')?.addEventListener('click', () => socket.emit('exchangeTalon', { cardIds:[] }));
  $$('[data-bid]').forEach((b) => b.addEventListener('click', () => socket.emit('bid', { contract:b.dataset.bid })));
  $$('[data-contra]').forEach((b) => b.addEventListener('click', () => socket.emit('contraAction', { action:b.dataset.contra })));
  $$('[data-meld-card]').forEach((b) => b.addEventListener('click', () => socket.emit('playMeld', { cardId:b.dataset.meldCard })));
  $('#countBtn')?.addEventListener('click', () => socket.emit('countPoints'));
  $('#closeBtn')?.addEventListener('click', () => socket.emit('closeSchnops'));
}

function sortHand(cards) {
  const sOrder={hearts:0,diamonds:1,clubs:2,spades:3};
  const rOrder={J:0,Q:1,K:2,'10':3,A:4};
  return cards.slice().sort((a,b)=>sOrder[a.suit]-sOrder[b.suit]||rOrder[a.rank]-rOrder[b.rank]);
}
function renderHand() {
  const hand=sortHand(state.myHand||[]);
  if (!hand.length) { $('#handArea').innerHTML=''; return; }
  const talonMode=state.phase==='talon_exchange'&&state.me===state.callerIndex;
  const legal=new Set(state.legalCardIds||[]);
  $('#handArea').innerHTML=`<div class="hand-title"><b>Tvoje karte</b><span class="muted">${hand.length} kart</span></div><div class="hand-scroll">${hand.map((c)=>cardHTML(c,{button:true,playable:talonMode||legal.has(c.id),selected:selectedTalon.has(c.id)})).join('')}</div>`;
  $$('#handArea [data-card-id]').forEach((b)=>b.addEventListener('click',()=>{
    const id=b.dataset.cardId;
    if (talonMode) { if (selectedTalon.has(id)) selectedTalon.delete(id); else if (selectedTalon.size<2) selectedTalon.add(id); renderActions(); renderHand(); return; }
    if (legal.has(id)) socket.emit('playCard',{cardId:id});
  }));
}
function renderLogs() {
  $('#logTab').innerHTML=state.log.slice().reverse().map((l)=>`<div class="log-line">${safe(l.text)}</div>`).join('')||'<div class="muted">Še brez dogodkov.</div>';
  const chat=$('#chatMessages');
  chat.innerHTML=state.chat.map((m)=>`<div class="chat-line"><b>${safe(m.name)}:</b> ${safe(m.text)}</div>`).join('')||'<div class="muted">Klepet je prazen.</div>';
  chat.scrollTop=chat.scrollHeight;
}
function render() {
  if (!state) return;
  enterGame(state.code); $('#roomCode').textContent=state.code; $('#roundNo').textContent=state.roundNo;
  gameView.classList.toggle('lobby-view', state.phase === 'lobby');
  gameView.classList.toggle('active-game-view', state.phase !== 'lobby');
  // Focus mode is for card play, not for the lobby and setup controls.
  const focusAvailable = state.playerCount === 4 && state.players.length === 4 && state.phase === 'playing';
  const focusOn = focusAvailable && focusEnabled;
  gameView.classList.toggle('focus-mode', focusOn);
  document.body.classList.toggle('focus-active', focusOn);
  const focusToggle = $('#focusToggle');
  focusToggle.classList.toggle('hidden', !focusAvailable);
  focusToggle.textContent = focusOn ? 'Izhod iz fokusa' : 'Fokus';
  gameView.classList.toggle('seating-mode', state.phase === 'lobby' && state.playerCount === 4 && state.players.length === 4);
  const [phase,title]=phaseText(); $('#phaseLabel').textContent=phase; $('#statusTitle').textContent=title;
  renderScoreboard(); renderGameInfo(); renderPlayersAround(); renderTrick(); renderTip(); renderActions(); renderHand(); renderLogs(); scheduleTrickAnimation();
  renderRoundDialog();
}

$$('[data-count]').forEach((b)=>b.addEventListener('click',()=>{ $$('[data-count]').forEach((x)=>x.classList.remove('active')); b.classList.add('active'); playerCount=Number(b.dataset.count); }));
$$('[data-strict]').forEach((b)=>b.addEventListener('click',()=>{ strictRulesChoice=b.dataset.strict==='1'; $$('[data-strict]').forEach((x)=>x.classList.toggle('active',x===b)); }));
$('#createBtn').addEventListener('click',()=>{
  const name=nameInput.value.trim(); if(!name) return homeError.textContent='Vpiši ime.'; homeError.textContent='';
  const tempToken=`p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  socket.emit('createRoom',{name,playerCount,targetScore:Number(targetScoreInput.value),strictRules:strictRulesChoice,token:tempToken},(res)=>{ if(!res.ok)return homeError.textContent=res.error||'Napaka.'; roomCodeInput.value=res.code; saveSession(res.code,res.token,name); enterGame(res.code); });
});
$('#joinBtn').addEventListener('click',()=>{
  const name=nameInput.value.trim(), code=roomCodeInput.value.trim().toUpperCase();
  if(!name||code.length!==5)return homeError.textContent='Vpiši ime in 5-mestno kodo sobe.'; homeError.textContent='';
  const token=localStorage.getItem(`snops-token-${code}`)||`p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  socket.emit('joinRoom',{name,code,token},(res)=>{ if(!res.ok)return homeError.textContent=res.error||'Pridružitev ni uspela.'; saveSession(code,res.token,name); enterGame(code); });
});
roomCodeInput.addEventListener('input',()=>roomCodeInput.value=roomCodeInput.value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,5));
$('#shareBtn').addEventListener('click',async()=>{
  const url=`${location.origin}${location.pathname}?room=${encodeURIComponent(state.code)}`; const text=`Pridruži se naši igri Šnops Online. Koda: ${state.code}`;
  try { if(navigator.share) await navigator.share({title:'Šnops Online',text,url}); else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Povezava je kopirana.'); } } catch(_){}
});
$('#chatForm').addEventListener('submit',(e)=>{ e.preventDefault(); const input=$('#chatInput'), text=input.value.trim(); if(!text)return; socket.emit('chat',{text}); input.value=''; });
$('#focusToggle').addEventListener('click',()=>{ focusEnabled=!focusEnabled; localStorage.setItem('snops-focus', focusEnabled?'1':'0'); render(); });
$('#menuToggle').addEventListener('click',()=>$('#gameDrawer').classList.remove('hidden'));
$('#menuClose').addEventListener('click',()=>$('#gameDrawer').classList.add('hidden'));
$('#chatToggle').addEventListener('click',()=>{
  chatOpen = true; unreadChatCount = 0; $('#chatUnread').classList.add('hidden');
  $('#chatPanel').classList.remove('hidden'); $('#chatInput').focus();
});
$('#chatClose').addEventListener('click',()=>{ chatOpen = false; $('#chatPanel').classList.add('hidden'); });
$('#leaveRoomBtn').addEventListener('click',()=>$('#leaveDialog').classList.remove('hidden'));
$('#leaveCancel').addEventListener('click',()=>$('#leaveDialog').classList.add('hidden'));
$('#leaveConfirm').addEventListener('click',()=>{
  if (state?.code) localStorage.removeItem(`snops-token-${state.code}`);
  history.replaceState(null, '', location.pathname); location.reload();
});
$('#roundDialogClose').addEventListener('click',()=>$('#roundDialog').classList.add('hidden'));

socket.on('state',(next)=>{
  if (!chatOpen && next.chat.length > previousChatCount) {
    unreadChatCount += next.chat.length - previousChatCount;
    $('#chatUnread').textContent = unreadChatCount > 9 ? '9+' : unreadChatCount;
    $('#chatUnread').classList.toggle('hidden', unreadChatCount === 0);
  }
  previousChatCount = next.chat.length;
  state=next; if(state.phase!=='talon_exchange') selectedTalon.clear(); render();
});
socket.on('gameError',(message)=>toast(message));
socket.on('connect',()=>{
  connectionBadge.textContent='online'; connectionBadge.className='status online';
  const code=new URLSearchParams(location.search).get('room')?.toUpperCase(); const name=localStorage.getItem('snops-name'); const token=code?localStorage.getItem(`snops-token-${code}`):null;
  if(code&&name&&token&&!state) socket.emit('joinRoom',{name,code,token},(res)=>{ if(res.ok)enterGame(code); });
});
socket.on('disconnect',()=>{ connectionBadge.textContent='brez povezave'; connectionBadge.className='status offline'; });
window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden');});
$('#installBtn').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').classList.add('hidden');});
preloadCardAssets();
if('serviceWorker'in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
