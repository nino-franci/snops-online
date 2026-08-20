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

nameInput.value = localStorage.getItem('snops-name') || '';
roomCodeInput.value = new URLSearchParams(location.search).get('room') || '';

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

function cardHTML(card, { button=false, playable=false, selected=false } = {}) {
  const red = ['hearts','diamonds'].includes(card.suit) ? ' red' : '';
  const classes = `card${red}${playable ? ' playable' : ''}${selected ? ' selected' : ''}`;
  const attrs = button ? `data-card-id="${safe(card.id)}" ${playable ? '' : 'disabled'}` : '';
  const tag = button ? 'button' : 'div';
  return `<${tag} class="${classes}" ${attrs} aria-label="${safe(card.rank)} ${safe(suitName[card.suit])}">
    <span class="corner top"><b>${safe(card.rank)}</b><i>${suitSymbol[card.suit]}</i></span>
    <span class="card-center">${pipLayout(card.rank, suitSymbol[card.suit])}</span>
    <span class="corner bottom"><b>${safe(card.rank)}</b><i>${suitSymbol[card.suit]}</i></span>
  </${tag}>`;
}

function roleLabel(index) {
  if (!state) return '';
  const roles = [];
  if (index === state.dealerIndex) roles.push('deli');
  if (index === state.cutterIndex && state.playerCount === 4) roles.push('predvig/udarec');
  if (index === state.callerIndex) roles.push('rufa');
  if (state.bidderIndex === index) roles.push('igra');
  return roles.join(' · ');
}

function renderScoreboard() {
  const isHost = state.players[state.me]?.isHost;
  if (state.playerCount === 4 && state.teams) {
    $('#scoreboard').innerHTML = state.teams.map((t) => {
      const names = t.members.map((i) => state.players[i]?.name).filter(Boolean).join(' + ');
      return `<div class="score-card team-card ${state.myTeam === t.index ? 'me' : ''}">
        <div class="score-name"><b>Ekipa ${t.index + 1}</b></div>
        <div class="team-names">${safe(names)}</div>
        <div class="score-main"><strong>${t.penalty}</strong><span class="score-small">/ ${state.targetScore}</span></div>
        <div class="score-small">v rundi: ${t.roundPoints} · štihi: ${t.tricks}</div>
        ${isHost ? `<div class="score-tools"><button data-team-score="${t.index}" data-delta="-1">−</button><button data-team-score="${t.index}" data-delta="1">+</button></div>` : ''}
      </div>`;
    }).join('');
    $$('[data-team-score]').forEach((b) => b.addEventListener('click', () => socket.emit('adjustScore', { team:Number(b.dataset.teamScore), delta:Number(b.dataset.delta) })));
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
  if (p === 'playing') return ['Igra', `${state.players[state.turnIndex]?.name || ''} je na potezi`];
  if (p === 'round_end') return ['Konec runde', 'Rezultat runde je zapisan'];
  if (p === 'match_end') return ['Konec partije', 'Dosežen je rezultat 25'];
  return ['', ''];
}

function renderGameInfo() {
  const pills = [];
  if (state.playerCount === 4 && state.players.length === 4) pills.push(`<b>Pari:</b> ${safe(state.players[0].name)} + ${safe(state.players[2].name)} / ${safe(state.players[1].name)} + ${safe(state.players[3].name)}`);
  if (state.trumpSuit) pills.push(`Adut: <b>${suitSymbol[state.trumpSuit]} ${safe(suitName[state.trumpSuit])}</b>`);
  if (state.contract) pills.push(`Igra: <b>${safe(state.contracts[state.contract].label)}</b>`);
  if (state.multiplier > 1) pills.push(`Kontra: <b>×${state.multiplier}</b>`);
  if (state.talonCount) pills.push(`Talon: <b>${state.talonCount}</b>`);
  $('#gameInfo').innerHTML = pills.map((p) => `<span class="info-pill">${p}</span>`).join('');
}

function renderPlayersAround() {
  $('#playersAround').innerHTML = state.players.map((p) => `<div class="player-chip ${state.turnIndex===p.index?'turn':''} team-${p.team ?? 'x'}">
    <div><b>${safe(p.name)}</b>${p.index===state.me?' <span class="muted">(ti)</span>':''}</div>
    <div class="meta"><span>${p.handCount} kart</span><span>${roleLabel(p.index)}</span></div>
  </div>`).join('');
}

function renderTrick() {
  const area = $('#trickArea');
  if (!state.trick.length) {
    area.innerHTML = `<div class="empty-table">${state.phase==='playing'?'Miza je prazna.':'Karte se bodo prikazale tukaj.'}</div>`;
    return;
  }
  area.innerHTML = `<div class="trick-grid">${state.trick.map((p) => `<div class="played"><span class="played-name">${safe(state.players[p.playerIndex].name)}</span>${cardHTML(p.card)}</div>`).join('')}</div>`;
}

function renderLobbyActions() {
  const me = state.players[state.me];
  const full = state.players.length === state.playerCount;
  return `<div class="action-box"><h3>${state.players.length}/${state.playerCount} igralcev</h3>
    <p class="muted">Pri 4 igralcih sta partnerja vedno nasproti: 1+3 proti 2+4.</p>
    ${me?.isHost ? `<button id="startBtn" class="primary big" ${full?'':'disabled'}>Začni igro</button>` : '<p class="muted">Gostitelj bo začel.</p>'}
  </div>`;
}
function renderCutActions() {
  if (state.me !== state.cutterIndex) return `<div class="action-box"><p class="muted">${safe(state.players[state.cutterIndex].name)} izbira predvig ali udarec.</p></div>`;
  return `<div class="action-box"><h3>Predvig ali udarec?</h3><p class="muted">Predvig: 3-3-3-3, ruf, nato 2-2-2-2. Udarec: prvi dobi 3, rufa, nato še 2; ostali dobijo po 5.</p><div class="action-buttons"><button class="primary" data-cut="cut">Predvig</button><button class="secondary" data-cut="knock">Udari po kartah</button></div></div>`;
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
  if (melds.length) buttons.push(...melds.map((m) => `<button class="secondary" data-meld="${m.suit}">Napovej ${m.points} (${suitSymbol[m.suit]})</button>`));
  if (state.canCount) buttons.push('<button class="primary" id="countBtn">Štejem</button>');
  if (state.canClose) buttons.push('<button class="primary" id="closeBtn">Zaprem</button>');
  return `<div class="action-box"><h3>${myTurn?'Tvoja poteza':'Igra poteka'}</h3><p class="muted">${myTurn?'Izberi dovoljeno karto.':'Na potezi je '+safe(state.players[state.turnIndex].name)+'.'}</p>${buttons.length?`<div class="action-buttons">${buttons.join('')}</div>`:''}</div>`;
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
  $('#nextRoundBtn')?.addEventListener('click', () => { selectedTalon.clear(); socket.emit('nextRound'); });
  $$('[data-cut]').forEach((b) => b.addEventListener('click', () => socket.emit('chooseCut', { mode:b.dataset.cut })));
  $$('[data-call-suit]').forEach((b) => b.addEventListener('click', () => socket.emit('chooseCall', { suit:b.dataset.callSuit })));
  $$('[data-trump]').forEach((b) => b.addEventListener('click', () => socket.emit('chooseTrump', { suit:b.dataset.trump })));
  $('#fourthBtn')?.addEventListener('click', () => socket.emit('chooseTrump', { fourthCard:true }));
  $('#exchangeBtn')?.addEventListener('click', () => socket.emit('exchangeTalon', { cardIds:[...selectedTalon] }));
  $('#skipTalonBtn')?.addEventListener('click', () => socket.emit('exchangeTalon', { cardIds:[] }));
  $$('[data-bid]').forEach((b) => b.addEventListener('click', () => socket.emit('bid', { contract:b.dataset.bid })));
  $$('[data-contra]').forEach((b) => b.addEventListener('click', () => socket.emit('contraAction', { action:b.dataset.contra })));
  $$('[data-meld]').forEach((b) => b.addEventListener('click', () => socket.emit('declareMeld', { suit:b.dataset.meld })));
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
  const [phase,title]=phaseText(); $('#phaseLabel').textContent=phase; $('#statusTitle').textContent=title;
  renderScoreboard(); renderGameInfo(); renderPlayersAround(); renderTrick(); renderActions(); renderHand(); renderLogs();
}

$$('.seg').forEach((b)=>b.addEventListener('click',()=>{ $$('.seg').forEach((x)=>x.classList.remove('active')); b.classList.add('active'); playerCount=Number(b.dataset.count); }));
$('#createBtn').addEventListener('click',()=>{
  const name=nameInput.value.trim(); if(!name) return homeError.textContent='Vpiši ime.'; homeError.textContent='';
  const tempToken=`p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  socket.emit('createRoom',{name,playerCount,targetScore:Number(targetScoreInput.value),token:tempToken},(res)=>{ if(!res.ok)return homeError.textContent=res.error||'Napaka.'; roomCodeInput.value=res.code; saveSession(res.code,res.token,name); enterGame(res.code); });
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
$$('.tab').forEach((b)=>b.addEventListener('click',()=>{ $$('.tab').forEach((x)=>x.classList.toggle('active',x===b)); ['log','chat','rules'].forEach((tab)=>$(`#${tab}Tab`).classList.toggle('hidden',tab!==b.dataset.tab)); }));

socket.on('state',(next)=>{ state=next; if(state.phase!=='talon_exchange') selectedTalon.clear(); render(); });
socket.on('gameError',(message)=>toast(message));
socket.on('connect',()=>{
  connectionBadge.textContent='online'; connectionBadge.className='status online';
  const code=new URLSearchParams(location.search).get('room')?.toUpperCase(); const name=localStorage.getItem('snops-name'); const token=code?localStorage.getItem(`snops-token-${code}`):null;
  if(code&&name&&token&&!state) socket.emit('joinRoom',{name,code,token},(res)=>{ if(res.ok)enterGame(code); });
});
socket.on('disconnect',()=>{ connectionBadge.textContent='brez povezave'; connectionBadge.className='status offline'; });
window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden');});
$('#installBtn').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').classList.add('hidden');});
if('serviceWorker'in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
