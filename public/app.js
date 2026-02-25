/* ============================================================
   CONSTANTS
   ============================================================ */

const API = '/api';

// localStorage keys
const LS_HUNTS     = 'sht_hunts_cache';
const LS_PENDING   = 'sht_pending_ops';
const LS_PKMN_LIST = 'sht_pokemon_list';
const LS_PKMN_TIME = 'sht_pokemon_list_time';
const PKMN_TTL     = 24 * 60 * 60 * 1000; // 24 hours

// Shiny odds denominator per game (null = no shiny mechanic)
const GAME_ODDS = {
  'Red/Blue': null,
  'Yellow': null,
  'Gold/Silver': 8192,
  'Crystal': 8192,
  'Ruby/Sapphire': 8192,
  'Emerald': 8192,
  'FireRed/LeafGreen': 8192,
  'Diamond/Pearl': 8192,
  'Platinum': 8192,
  'HeartGold/SoulSilver': 8192,
  'Black/White': 8192,
  'Black 2/White 2': 8192,
  'X/Y': 4096,
  'Omega Ruby/Alpha Sapphire': 4096,
  'Sun/Moon': 4096,
  'Ultra Sun/Ultra Moon': 4096,
  'Sword/Shield': 4096,
  'Brilliant Diamond/Shining Pearl': 4096,
  'Legends: Arceus': 4096,
  'Scarlet/Violet': 4096,
};

// Standard Pokémon type colours
const TYPE_COLOR = {
  normal:   '#A8A878',
  fire:     '#F08030',
  water:    '#6890F0',
  electric: '#F8D030',
  grass:    '#78C850',
  ice:      '#98D8D8',
  fighting: '#C03028',
  poison:   '#A040A0',
  ground:   '#E0C068',
  flying:   '#A890F0',
  psychic:  '#F85888',
  bug:      '#A8B820',
  rock:     '#B8A038',
  ghost:    '#705898',
  dragon:   '#7038F8',
  dark:     '#705848',
  steel:    '#B8B8D0',
  fairy:    '#EE99AC',
};

/* ============================================================
   STATE
   ============================================================ */

const state = {
  hunts: [],
  pendingOps: [],
  pokemonList: [],       // [{name, id, sprite}]  ← sprite now included
  selected: null,        // {name, sprite, types}
  activeTab: 'hunt',
  isOnline: navigator.onLine,
  pendingFoundId: null,
  tempIdCounter: -1,
};

/* ============================================================
   BOOTSTRAP
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  loadFromStorage();
  renderAll();

  setupTabs();
  setupSearch();
  setupNewHuntForm();
  setupOverlay();
  setupInstallPrompt();
  setupOnlineOffline();

  // Honour ?tab= param from PWA shortcuts
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab) switchTab(tab);

  await Promise.all([loadHunts(), loadPokemonList()]);
});

/* ============================================================
   LOCAL STORAGE
   ============================================================ */

function loadFromStorage() {
  try { state.hunts      = JSON.parse(localStorage.getItem(LS_HUNTS)    || '[]'); } catch (_) {}
  try { state.pendingOps = JSON.parse(localStorage.getItem(LS_PENDING)  || '[]'); } catch (_) {}
}

function saveToStorage() {
  localStorage.setItem(LS_HUNTS,   JSON.stringify(state.hunts));
  localStorage.setItem(LS_PENDING, JSON.stringify(state.pendingOps));
}

/* ============================================================
   ONLINE / OFFLINE
   ============================================================ */

function setupOnlineOffline() {
  const bar = document.getElementById('offline-bar');

  const setOnline = () => {
    state.isOnline = true;
    bar.classList.add('hidden');
    syncPendingOps();
    loadHunts();
  };
  const setOffline = () => {
    state.isOnline = false;
    bar.classList.remove('hidden');
  };

  window.addEventListener('online',  setOnline);
  window.addEventListener('offline', setOffline);
  if (!navigator.onLine) setOffline();
}

async function syncPendingOps() {
  if (!state.isOnline || state.pendingOps.length === 0) return;

  const ops = [...state.pendingOps];
  state.pendingOps = [];
  saveToStorage();

  const badge = document.getElementById('sync-badge');
  badge.classList.remove('hidden');

  for (const op of ops) {
    try {
      if (op.type === 'update') {
        await fetch(`${API}/hunts/${op.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.data),
        });
      } else if (op.type === 'delete') {
        await fetch(`${API}/hunts/${op.id}`, { method: 'DELETE' });
      }
    } catch (_) {
      state.pendingOps.push(op);
    }
  }

  saveToStorage();
  badge.classList.add('hidden');
  await loadHunts();
}

/* ============================================================
   FETCH HUNTS FROM SERVER
   ============================================================ */

async function loadHunts() {
  if (!state.isOnline) return;
  try {
    const res = await fetch(`${API}/hunts`);
    if (!res.ok) return;
    const hunts = await res.json();
    // Keep local temp hunts (offline-created), replace everything else
    const tempHunts = state.hunts.filter(h => String(h.id).startsWith('t_'));
    state.hunts = [...tempHunts, ...hunts];
    saveToStorage();
    renderAll();
  } catch (_) { /* use cache */ }
}

/* ============================================================
   FETCH POKÉMON LIST (for search autocomplete)
   The server now includes `sprite` in each entry, so autocomplete
   can show thumbnails and skip a second API call on selection.
   ============================================================ */

async function loadPokemonList() {
  const cached  = localStorage.getItem(LS_PKMN_LIST);
  const cachedT = localStorage.getItem(LS_PKMN_TIME);

  if (cached && cachedT && (Date.now() - parseInt(cachedT)) < PKMN_TTL) {
    try { state.pokemonList = JSON.parse(cached); return; } catch (_) {}
  }

  if (!state.isOnline) return;

  try {
    const res = await fetch(`${API}/pokemon/list`);
    if (!res.ok) return;
    const list = await res.json();
    if (list.length === 0) return;
    state.pokemonList = list;
    localStorage.setItem(LS_PKMN_LIST, JSON.stringify(list));
    localStorage.setItem(LS_PKMN_TIME, String(Date.now()));
  } catch (_) {}
}

/* ============================================================
   RENDER
   ============================================================ */

function renderAll() {
  renderStatsBar();
  renderActiveHunts();
  renderTrophy();
  renderFullStats();
}

function renderStatsBar() {
  const active = state.hunts.filter(h => !h.completed);
  const found  = state.hunts.filter(h => h.completed);
  const totalE = state.hunts.reduce((s, h) => s + (h.hunt_count || 0), 0);
  const avgE   = found.length
    ? Math.round(found.reduce((s, h) => s + (h.hunt_count || 0), 0) / found.length)
    : null;

  document.getElementById('stat-active').textContent     = active.length;
  document.getElementById('stat-found').textContent      = found.length;
  document.getElementById('stat-encounters').textContent = totalE.toLocaleString();
  document.getElementById('stat-avg').textContent        = avgE ? avgE.toLocaleString() : '—';
}

function renderActiveHunts() {
  const container = document.getElementById('hunts-container');
  const active    = state.hunts.filter(h => !h.completed);

  if (active.length === 0) {
    container.innerHTML = `<div class="empty-state">No active hunts yet.<br>Search for a Pokémon above to start! ✨</div>`;
    return;
  }
  container.innerHTML = active.map(buildHuntCard).join('');
}

function renderTrophy() {
  const container = document.getElementById('trophy-container');
  const found     = state.hunts.filter(h => h.completed);

  if (found.length === 0) {
    container.innerHTML = `<div class="empty-state">No shinies found yet.<br>Keep hunting! 🍀</div>`;
    return;
  }
  container.innerHTML = found.map(buildTrophyCard).join('');
}

function renderFullStats() {
  const container = document.getElementById('stats-container');
  const hunts     = state.hunts;

  if (hunts.length === 0) {
    container.innerHTML = `<div class="empty-state">Start your first hunt to see statistics here.</div>`;
    return;
  }

  const found  = hunts.filter(h => h.completed);
  const active = hunts.filter(h => !h.completed);
  const totalE = hunts.reduce((s, h) => s + (h.hunt_count || 0), 0);
  const avgE   = found.length
    ? Math.round(found.reduce((s, h) => s + (h.hunt_count || 0), 0) / found.length)
    : null;
  const luckiest = found.reduce((m, h) => (!m || h.hunt_count < m.hunt_count) ? h : m, null);
  const longest  = found.reduce((m, h) => (!m || h.hunt_count > m.hunt_count) ? h : m, null);

  const rows = [
    { icon: '🎯', label: 'Hunts Started',           value: hunts.length },
    { icon: '✨', label: 'Shinies Found',            value: found.length },
    { icon: '⚔️', label: 'Active Hunts',             value: active.length },
    { icon: '🎲', label: 'Total Encounters',          value: totalE.toLocaleString() },
    { icon: '📊', label: 'Avg Encounters per Shiny', value: avgE ? avgE.toLocaleString() : '—' },
    luckiest ? { icon: '🍀', label: 'Luckiest Hunt', value: `${cap(luckiest.pokemon_name)} (${luckiest.hunt_count.toLocaleString()})` } : null,
    longest  ? { icon: '😅', label: 'Longest Hunt',  value: `${cap(longest.pokemon_name)} (${longest.hunt_count.toLocaleString()})` } : null,
  ].filter(Boolean);

  container.innerHTML = rows.map(r => `
    <div class="stat-card">
      <div class="stat-icon">${r.icon}</div>
      <div>
        <div class="stat-card-label">${r.label}</div>
        <div class="stat-card-value">${r.value}</div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   CARD BUILDERS
   ============================================================ */

function buildHuntCard(hunt) {
  const types       = Array.isArray(hunt.types) ? hunt.types : [];
  const primaryType = types[0] || 'normal';
  const cardColor   = TYPE_COLOR[primaryType] || TYPE_COLOR.normal;
  const id          = hunt.id;
  const count       = hunt.hunt_count || 0;

  const typeBadgesHtml = types.map(t =>
    `<span class="type-badge" style="background:${TYPE_COLOR[t] || '#888'}">${t}</span>`
  ).join('');

  const odds = GAME_ODDS[hunt.game];
  const oddsHtml = odds
    ? `<div class="odds-row">
         <span class="odds-base">1/${odds.toLocaleString()} base</span>
         <span class="odds-prob ${probClass(count, odds)}">${calcProb(count, odds)}% chance</span>
       </div>`
    : `<div class="odds-row"><span class="odds-base" title="No shiny mechanic in Gen 1">No shinies in Gen 1</span></div>`;

  const target      = hunt.target_count;
  const progressPct = target ? Math.min(100, Math.round(count / target * 100)) : 0;
  const progressHtml = target
    ? `<div class="progress-wrapper">
         <div class="progress-bar" style="width:${progressPct}%"></div>
         <span class="progress-label">${count.toLocaleString()} / ${Number(target).toLocaleString()}</span>
       </div>`
    : '';

  return `
    <div class="hunt-card" data-id="${id}" style="--card-color:${cardColor}">
      <div class="card-type-bar"></div>
      <div class="card-body">
        <div class="sprite-wrap">
          <img src="${hunt.sprite_url || ''}" alt="${hunt.pokemon_name}" class="pokemon-sprite" loading="lazy">
        </div>
        <div class="pokemon-name">${cap(hunt.pokemon_name)}</div>
        <div class="game-label">${hunt.game}</div>
        <div class="type-badges">${typeBadgesHtml}</div>
        ${oddsHtml}
        ${progressHtml}
        <div class="counter-section">
          <button class="counter-btn" data-action="dec" data-id="${id}" aria-label="Decrease">−</button>
          <span class="counter-value">${count.toLocaleString()}</span>
          <button class="counter-btn" data-action="inc" data-id="${id}" aria-label="Increase">+</button>
        </div>
        <button class="found-btn" data-action="found" data-id="${id}">✨ Found It!</button>
        <button class="delete-btn" data-action="delete" data-id="${id}">🗑 Delete</button>
        <div class="date-label">Started ${fmtDate(hunt.date_started)}</div>
      </div>
    </div>`;
}

function buildTrophyCard(hunt) {
  const types       = Array.isArray(hunt.types) ? hunt.types : [];
  const primaryType = types[0] || 'normal';
  const cardColor   = TYPE_COLOR[primaryType] || TYPE_COLOR.normal;
  const id          = hunt.id;

  const typeBadgesHtml = types.map(t =>
    `<span class="type-badge" style="background:${TYPE_COLOR[t] || '#888'}">${t}</span>`
  ).join('');

  const sparkleHtml = Array.from({ length: 10 }, (_, i) => {
    const sx = (Math.random() * 110 - 5).toFixed(1);
    const sy = (Math.random() * 110 - 5).toFixed(1);
    const sd = (i * 0.22).toFixed(2);
    return `<div class="sparkle" style="--sx:${sx}%;--sy:${sy}%;--sd:${sd}s"></div>`;
  }).join('');

  const foundDate = hunt.completed_at ? fmtDate(hunt.completed_at) : '';

  return `
    <div class="trophy-card" style="--card-color:${cardColor}">
      <div class="card-type-bar"></div>
      <div class="sparkle-container">${sparkleHtml}</div>
      <div class="card-body shiny-glow">
        <div class="sprite-wrap">
          <img src="${hunt.sprite_url || ''}" alt="${hunt.pokemon_name}" class="pokemon-sprite" loading="lazy">
        </div>
        <div class="pokemon-name">${cap(hunt.pokemon_name)}</div>
        <div class="game-label">${hunt.game}</div>
        <div class="type-badges">${typeBadgesHtml}</div>
        <div class="found-count">Found after<br><strong>${(hunt.hunt_count || 0).toLocaleString()}</strong> encounters</div>
        ${foundDate ? `<div class="date-label">${foundDate}</div>` : ''}
        <button class="unmark-btn" data-action="unmark" data-id="${id}">↩ Un-mark</button>
      </div>
    </div>`;
}

/* ============================================================
   EVENT DELEGATION
   ============================================================ */

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  switch (action) {
    case 'inc':    incrementCounter(id, +1); break;
    case 'dec':    incrementCounter(id, -1); break;
    case 'found':  foundIt(id);              break;
    case 'delete': deleteHunt(id);           break;
    case 'unmark': unmarkComplete(id);       break;
  }
});

/* ============================================================
   SEARCH
   The pokemon list now includes `sprite`, so autocomplete shows
   thumbnails immediately without any extra network call.
   When a user selects an entry, we apply the sprite right away
   and fetch types in the background.
   ============================================================ */

function setupSearch() {
  const input   = document.getElementById('pokemon-search');
  const results = document.getElementById('search-results');
  let timer;

  input.addEventListener('input', e => {
    clearTimeout(timer);
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 2) { results.classList.remove('active'); return; }
    timer = setTimeout(() => showSearchResults(q), 220);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => results.classList.remove('active'), 200);
  });

  document.getElementById('clear-selection').addEventListener('click', clearSelection);
}

function showSearchResults(q) {
  const results = document.getElementById('search-results');

  let matches = state.pokemonList
    .filter(p => p.name.includes(q))
    .slice(0, 10);

  if (matches.length > 0) {
    results.innerHTML = matches.map(p => `
      <div class="search-item" data-name="${p.name}" data-sprite="${p.sprite || ''}" role="option" tabindex="0">
        ${p.sprite ? `<img src="${p.sprite}" alt="${p.name}" loading="lazy">` : ''}
        <span>${cap(p.name)}</span>
      </div>`).join('');
    results.classList.add('active');
    results.querySelectorAll('.search-item').forEach(item => {
      const handler = () => selectByName(item.dataset.name, item.dataset.sprite);
      item.addEventListener('click', handler);
      item.addEventListener('keydown', e => { if (e.key === 'Enter') handler(); });
    });
    return;
  }

  // Fallback: exact API lookup
  if (state.isOnline) fetchAndShowResult(q);
  else results.classList.remove('active');
}

async function fetchAndShowResult(q) {
  const results = document.getElementById('search-results');
  try {
    const res  = await fetch(`${API}/pokemon/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.length) { results.classList.remove('active'); return; }

    results.innerHTML = data.map(p => `
      <div class="search-item" data-name="${p.name}" data-sprite="${p.sprite || ''}" data-types="${(p.types || []).join(',')}">
        ${p.sprite ? `<img src="${p.sprite}" alt="${p.name}" loading="lazy">` : ''}
        <span>${cap(p.name)}</span>
      </div>`).join('');
    results.classList.add('active');

    results.querySelectorAll('.search-item').forEach(item => {
      item.addEventListener('click', () => {
        const types = item.dataset.types ? item.dataset.types.split(',') : [];
        applySelection(item.dataset.name, item.dataset.sprite, types);
      });
    });
  } catch (_) {}
}

// Apply the sprite immediately (from the list), then fetch types in background
async function selectByName(name, spriteFromList) {
  document.getElementById('search-results').classList.remove('active');
  document.getElementById('pokemon-search').value = '';

  // Instant feedback — sprite already known from the list
  applySelection(name, spriteFromList || '', []);

  // Fetch types (and possibly a better sprite) in the background
  if (state.isOnline) {
    try {
      const res  = await fetch(`${API}/pokemon/search?q=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (data.length) {
        applySelection(data[0].name, data[0].sprite || spriteFromList || '', data[0].types || []);
      }
    } catch (_) {}
  }
}

function applySelection(name, sprite, types) {
  state.selected = { name, sprite, types };

  document.getElementById('selected-sprite').src       = sprite;
  document.getElementById('selected-name').textContent = cap(name);
  document.getElementById('selected-types').innerHTML  = types.map(t =>
    `<span class="type-badge" style="background:${TYPE_COLOR[t] || '#888'}">${t}</span>`
  ).join('');

  document.getElementById('selected-preview').classList.remove('hidden');
  updateStartBtn();
}

function clearSelection() {
  state.selected = null;
  document.getElementById('selected-preview').classList.add('hidden');
  document.getElementById('pokemon-search').value = '';
  updateStartBtn();
}

/* ============================================================
   NEW HUNT FORM
   ============================================================ */

function setupNewHuntForm() {
  document.getElementById('game-select').addEventListener('change', updateStartBtn);
  document.getElementById('start-hunt').addEventListener('click', startHunt);
}

function updateStartBtn() {
  const game = document.getElementById('game-select').value;
  document.getElementById('start-hunt').disabled = !state.selected || !game;
}

async function startHunt() {
  if (!state.selected) return;

  const game   = document.getElementById('game-select').value;
  const rawTgt = document.getElementById('target-count').value;
  const target = rawTgt ? parseInt(rawTgt, 10) : null;

  const huntData = {
    pokemon_name: state.selected.name,
    game,
    sprite_url:   state.selected.sprite,
    types:        state.selected.types,
    target_count: target,
  };

  if (state.isOnline) {
    try {
      const res = await fetch(`${API}/hunts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(huntData),
      });
      if (res.ok) {
        const hunt = await res.json();
        state.hunts = [hunt, ...state.hunts];
      }
    } catch (_) {
      addTempHunt(huntData);
    }
  } else {
    addTempHunt(huntData);
  }

  resetForm();
  saveToStorage();
  renderAll();
}

function addTempHunt(huntData) {
  const tempId = `t_${Date.now()}`;
  state.hunts = [{
    id: tempId,
    ...huntData,
    hunt_count:   0,
    date_started: new Date().toISOString(),
    completed:    false,
    completed_at: null,
  }, ...state.hunts];
}

function resetForm() {
  state.selected = null;
  document.getElementById('selected-preview').classList.add('hidden');
  document.getElementById('pokemon-search').value = '';
  document.getElementById('game-select').value    = '';
  document.getElementById('target-count').value   = '';
  updateStartBtn();
}

/* ============================================================
   COUNTER
   ============================================================ */

function incrementCounter(id, delta) {
  const hunt = getHunt(id);
  if (!hunt) return;

  const newCount = Math.max(0, (hunt.hunt_count || 0) + delta);
  hunt.hunt_count = newCount;
  saveToStorage();
  renderAll();

  if (state.isOnline) {
    fetch(`${API}/hunts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hunt_count: newCount }),
    }).catch(() => queueOp({ type: 'update', id, data: { hunt_count: newCount } }));
  } else {
    // Collapse multiple pending count updates into one
    state.pendingOps = state.pendingOps.filter(
      op => !(op.type === 'update' && String(op.id) === String(id) && 'hunt_count' in op.data)
    );
    queueOp({ type: 'update', id, data: { hunt_count: newCount } });
  }
}

/* ============================================================
   FOUND IT FLOW
   ============================================================ */

function setupOverlay() {
  document.getElementById('found-confirm').addEventListener('click', confirmFound);
  document.getElementById('found-cancel').addEventListener('click', () => {
    document.getElementById('found-overlay').classList.add('hidden');
  });
  document.getElementById('found-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
}

function foundIt(id) {
  const hunt = getHunt(id);
  if (!hunt) return;

  state.pendingFoundId = id;

  document.getElementById('found-sprite').src    = hunt.sprite_url || '';
  document.getElementById('found-message').textContent =
    `${cap(hunt.pokemon_name)} found after ${(hunt.hunt_count || 0).toLocaleString()} encounter${hunt.hunt_count !== 1 ? 's' : ''}!`;

  buildOverlaySparkles();
  document.getElementById('found-overlay').classList.remove('hidden');
}

function buildOverlaySparkles() {
  const container = document.getElementById('overlay-sparkles');
  container.innerHTML = Array.from({ length: 18 }, (_, i) => {
    const left  = (Math.random() * 100).toFixed(1);
    const top   = (Math.random() * 100).toFixed(1);
    const delay = (Math.random() * 2).toFixed(2);
    const dur   = (1.2 + Math.random() * 0.8).toFixed(2);
    return `<div class="o-sparkle" style="left:${left}%;top:${top}%;animation-delay:${delay}s;animation-duration:${dur}s"></div>`;
  }).join('');
}

async function confirmFound() {
  const id = state.pendingFoundId;
  if (!id) return;

  const completedAt = new Date().toISOString();
  const hunt        = getHunt(id);
  if (hunt) { hunt.completed = true; hunt.completed_at = completedAt; }

  saveToStorage();
  document.getElementById('found-overlay').classList.add('hidden');

  const body = { completed: true, completed_at: completedAt };

  if (state.isOnline) {
    try {
      await fetch(`${API}/hunts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (_) { queueOp({ type: 'update', id, data: body }); }
  } else {
    queueOp({ type: 'update', id, data: body });
  }

  renderAll();
  setTimeout(() => switchTab('trophy'), 450);
}

async function unmarkComplete(id) {
  const hunt = getHunt(id);
  if (hunt) { hunt.completed = false; hunt.completed_at = null; }
  saveToStorage();
  renderAll();

  const body = { completed: false, completed_at: null };
  if (state.isOnline) {
    try {
      await fetch(`${API}/hunts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (_) { queueOp({ type: 'update', id, data: body }); }
  } else {
    queueOp({ type: 'update', id, data: body });
  }
}

/* ============================================================
   DELETE
   ============================================================ */

async function deleteHunt(id) {
  if (!confirm('Delete this hunt? This cannot be undone.')) return;

  state.hunts = state.hunts.filter(h => String(h.id) !== String(id));
  saveToStorage();
  renderAll();

  if (state.isOnline) {
    try {
      await fetch(`${API}/hunts/${id}`, { method: 'DELETE' });
    } catch (_) { queueOp({ type: 'delete', id }); }
  } else {
    queueOp({ type: 'delete', id });
  }
}

/* ============================================================
   TABS
   ============================================================ */

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${tab}`);
  });
}

/* ============================================================
   PWA INSTALL PROMPT
   ============================================================ */

function setupInstallPrompt() {
  let deferred = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    if (!localStorage.getItem('pwa_dismissed')) {
      document.getElementById('install-banner').classList.remove('hidden');
    }
  });

  document.getElementById('install-btn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    document.getElementById('install-banner').classList.add('hidden');
  });

  document.getElementById('dismiss-install').addEventListener('click', () => {
    localStorage.setItem('pwa_dismissed', '1');
    document.getElementById('install-banner').classList.add('hidden');
  });
}

/* ============================================================
   HELPERS
   ============================================================ */

function getHunt(id) {
  return state.hunts.find(h => String(h.id) === String(id));
}

function queueOp(op) {
  state.pendingOps.push(op);
  saveToStorage();
}

function cap(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function calcProb(count, odds) {
  if (!odds || !count) return '0.00';
  const p = (1 - Math.pow(1 - 1 / odds, count)) * 100;
  return p >= 10 ? p.toFixed(1) : p.toFixed(2);
}

function probClass(count, odds) {
  if (!odds) return '';
  const p = (1 - Math.pow(1 - 1 / odds, count)) * 100;
  if (p >= 75) return 'odds-high';
  if (p >= 40) return 'odds-medium';
  return 'odds-low';
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
