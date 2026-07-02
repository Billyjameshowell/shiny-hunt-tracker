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
  huntsLoading: false,
};

let searchActiveIndex = -1;
let confirmResolve    = null;
let lastFocusedEl     = null;
let foundTriggerEl    = null;
let toastTimer        = null;
let initialHuntsLoad  = true;

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
  setupConfirmModal();
  setupInstallPrompt();
  setupOnlineOffline();
  setupGlobalKeydown();

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
      if (op.type === 'create') {
        const res = await fetch(`${API}/hunts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.data),
        });
        if (!res.ok) throw new Error('create failed');
        const saved = await res.json();
        state.hunts = state.hunts.map(h => String(h.id) === String(op.tempId) ? saved : h);
        ops.forEach(nextOp => {
          if (String(nextOp.id) === String(op.tempId)) nextOp.id = saved.id;
        });
        saveToStorage();
      } else if (op.type === 'update') {
        const res = await fetch(`${API}/hunts/${op.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.data),
        });
        if (!res.ok) throw new Error('update failed');
      } else if (op.type === 'delete') {
        const res = await fetch(`${API}/hunts/${op.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete failed');
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
  if (!state.isOnline) {
    if (initialHuntsLoad) initialHuntsLoad = false;
    return;
  }

  const isBoot = initialHuntsLoad;
  if (isBoot) setHuntsLoading(true);

  try {
    const res = await fetch(`${API}/hunts`);
    if (!res.ok) return;
    const hunts = await res.json();
    // Keep local temp hunts (offline-created), replace everything else
    const tempHunts = state.hunts.filter(h => String(h.id).startsWith('t_'));
    state.hunts = [...tempHunts, ...hunts];
    saveToStorage();
    renderAll();
  } catch (_) {
    if (state.hunts.length > 0) showToast('Using cached hunt data');
  } finally {
    if (isBoot) {
      setHuntsLoading(false);
      initialHuntsLoad = false;
    }
  }
}

function setHuntsLoading(loading) {
  state.huntsLoading = loading;
  const section   = document.querySelector('.hunts-section');
  const container = document.getElementById('hunts-container');
  let indicator   = document.getElementById('hunts-loading-indicator');

  if (loading) {
    section.classList.add('hunts-loading');
    const hasActive = state.hunts.some(h => !h.completed);

    if (!hasActive) {
      container.innerHTML = buildHuntsSkeleton();
      container.setAttribute('aria-busy', 'true');
    } else if (!indicator) {
      indicator = document.createElement('p');
      indicator.id = 'hunts-loading-indicator';
      indicator.className = 'hunts-loading-indicator';
      indicator.textContent = 'Refreshing hunts…';
      section.querySelector('h2').insertAdjacentElement('afterend', indicator);
    }
    return;
  }

  section.classList.remove('hunts-loading');
  indicator?.remove();
  container.removeAttribute('aria-busy');
  renderActiveHunts();
}

function buildHuntsSkeleton() {
  return Array.from({ length: 2 }, () => `
    <div class="hunt-card-skeleton" aria-hidden="true">
      <div class="skeleton-bar"></div>
      <div class="skeleton-body">
        <div class="skeleton-circle"></div>
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line narrow"></div>
        <div class="skeleton-line medium"></div>
      </div>
    </div>
  `).join('');
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

  if (!state.isOnline) {
    if (state.pokemonList.length === 0) showToast('Offline — search may be limited');
    return;
  }

  const input = document.getElementById('pokemon-search');
  const prevPlaceholder = input.placeholder;
  input.placeholder = 'Loading Pokémon…';

  try {
    const res = await fetch(`${API}/pokemon/list`);
    if (!res.ok) return;
    const list = await res.json();
    if (list.length === 0) return;
    state.pokemonList = list;
    localStorage.setItem(LS_PKMN_LIST, JSON.stringify(list));
    localStorage.setItem(LS_PKMN_TIME, String(Date.now()));
  } catch (_) {
    showToast('Could not load Pokémon list');
  } finally {
    input.placeholder = prevPlaceholder;
  }
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
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">🔍</span>
        <div class="empty-state-title">No active hunts yet</div>
        Search for a Pokémon above to start.
      </div>`;
    return;
  }
  container.innerHTML = active.map(buildHuntCard).join('');
}

function renderTrophy() {
  const container = document.getElementById('trophy-container');
  const found     = state.hunts.filter(h => h.completed);

  if (found.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">🏆</span>
        <div class="empty-state-title">No shinies found yet</div>
        Your first shiny belongs here. Keep hunting!
      </div>`;
    return;
  }
  container.innerHTML = found.map(buildTrophyCard).join('');
}

function updateHuntCard(id) {
  const hunt = getHunt(id);
  if (!hunt || hunt.completed) return;

  const container = document.getElementById('hunts-container');
  const existing  = container.querySelector(`[data-id="${id}"]`);

  if (existing) {
    const temp    = document.createElement('div');
    temp.innerHTML = buildHuntCard(hunt);
    const newCard = temp.firstElementChild;
    existing.replaceWith(newCard);

    const counter = newCard.querySelector('.counter-value');
    if (counter) {
      counter.classList.add('bump');
      counter.addEventListener('animationend', () => counter.classList.remove('bump'), { once: true });
    }
  } else {
    renderActiveHunts();
  }
}

function renderFullStats() {
  const container = document.getElementById('stats-container');
  const hunts     = state.hunts;

  if (hunts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">📊</span>
        <div class="empty-state-title">No statistics yet</div>
        Start your first hunt to see stats here.
      </div>`;
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
    { icon: '⚔️', label: 'Hunts Started',            value: hunts.length },
    { icon: '✨', label: 'Shinies Found',             value: found.length },
    { icon: '🎯', label: 'Active Hunts',              value: active.length },
    { icon: '🔢', label: 'Total Encounters',           value: totalE.toLocaleString() },
    { icon: '📊', label: 'Avg Encounters per Shiny',  value: avgE ? avgE.toLocaleString() : '—' },
    luckiest ? { icon: '🍀', label: 'Luckiest Hunt', value: `${cap(luckiest.pokemon_name)} (${luckiest.hunt_count.toLocaleString()})` } : null,
    longest  ? { icon: '⏳', label: 'Longest Hunt',  value: `${cap(longest.pokemon_name)} (${longest.hunt_count.toLocaleString()})` } : null,
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
    `<span class="type-badge" style="background:${TYPE_COLOR[t] || '#888'}">${escapeHtml(t)}</span>`
  ).join('');

  const odds = GAME_ODDS[hunt.game];
  const oddsHtml = odds
    ? `<div class="odds-row">
         <span class="odds-base">1/${odds.toLocaleString()} base</span>
         <span class="odds-prob ${probClass(count, odds)}">${calcProb(count, odds)}% chance</span>
         <span class="odds-help-wrap">
           <button type="button" class="odds-help-btn" aria-label="Explain shiny odds">?</button>
           <span class="odds-tooltip" role="tooltip">${escapeHtml(oddsHelpText(count, odds))}</span>
         </span>
       </div>`
    : `<div class="odds-row"><span class="odds-base" title="No shiny mechanic in Gen 1">No shinies in Gen 1</span></div>`;

  const target      = hunt.target_count;
  const progressPct = target ? Math.min(100, Math.round(count / target * 100)) : 0;
  const nearTarget  = target && progressPct >= 90;
  const progressHtml = target
    ? `<div class="progress-wrapper">
         <div class="progress-bar${nearTarget ? ' near-target' : ''}" style="width:${progressPct}%"></div>
         <span class="progress-label">${count.toLocaleString()} / ${Number(target).toLocaleString()}</span>
       </div>`
    : '';

  return `
    <div class="hunt-card" data-id="${id}" style="--card-color:${cardColor}">
      <div class="card-type-bar"></div>
      <div class="card-body">
        <div class="sprite-wrap">
          <img src="${escapeAttr(hunt.sprite_url || '/icon.svg')}" alt="${escapeAttr(hunt.pokemon_name)}" class="pokemon-sprite" loading="lazy" onerror="this.onerror=null;this.src='/icon.svg';">
        </div>
        <div class="pokemon-name">${escapeHtml(cap(hunt.pokemon_name))}</div>
        <div class="game-label">${escapeHtml(hunt.game)}</div>
        <div class="type-badges">${typeBadgesHtml}</div>
        ${oddsHtml}
        ${progressHtml}
        <div class="counter-section">
          <button class="counter-btn" data-action="dec" data-id="${id}" aria-label="Decrease">−</button>
          <span class="counter-value">${count.toLocaleString()}</span>
          <button class="counter-btn" data-action="inc" data-id="${id}" aria-label="Increase">+</button>
        </div>
        <button class="found-btn" data-action="found" data-id="${id}">Found It</button>
        <button class="delete-btn" data-action="delete" data-id="${id}">Delete</button>
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
    `<span class="type-badge" style="background:${TYPE_COLOR[t] || '#888'}">${escapeHtml(t)}</span>`
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
          <img src="${escapeAttr(hunt.sprite_url || '/icon.svg')}" alt="${escapeAttr(hunt.pokemon_name)}" class="pokemon-sprite" loading="lazy" onerror="this.onerror=null;this.src='/icon.svg';">
        </div>
        <div class="pokemon-name">${escapeHtml(cap(hunt.pokemon_name))}</div>
        <div class="game-label">${escapeHtml(hunt.game)}</div>
        <div class="type-badges">${typeBadgesHtml}</div>
        <div class="found-count">Found after<br><strong>${(hunt.hunt_count || 0).toLocaleString()}</strong> encounters</div>
        ${foundDate ? `<div class="date-label">${foundDate}</div>` : ''}
        <button class="unmark-btn" data-action="unmark" data-id="${id}">Un-mark</button>
      </div>
    </div>`;
}

/* ============================================================
   EVENT DELEGATION
   ============================================================ */

document.addEventListener('click', e => {
  const helpBtn = e.target.closest('.odds-help-btn');
  if (helpBtn) {
    e.stopPropagation();
    const wrap = helpBtn.closest('.odds-help-wrap');
    const wasOpen = wrap.classList.contains('open');
    document.querySelectorAll('.odds-help-wrap.open').forEach(w => w.classList.remove('open'));
    if (!wasOpen) wrap.classList.add('open');
    return;
  }
  document.querySelectorAll('.odds-help-wrap.open').forEach(w => w.classList.remove('open'));

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
    if (q.length < 2) {
      results.classList.remove('active');
      input.setAttribute('aria-expanded', 'false');
      searchActiveIndex = -1;
      return;
    }
    timer = setTimeout(() => showSearchResults(q), 220);
  });

  input.addEventListener('keydown', e => {
    const items = results.querySelectorAll('.search-item');
    if (!results.classList.contains('active') || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchActiveIndex = Math.min(searchActiveIndex + 1, items.length - 1);
      highlightSearchItem(items, input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchActiveIndex = Math.max(searchActiveIndex - 1, 0);
      highlightSearchItem(items, input);
    } else if (e.key === 'Enter' && searchActiveIndex >= 0) {
      e.preventDefault();
      items[searchActiveIndex].click();
    } else if (e.key === 'Escape') {
      results.classList.remove('active');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      searchActiveIndex = -1;
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      results.classList.remove('active');
      input.setAttribute('aria-expanded', 'false');
      searchActiveIndex = -1;
    }, 200);
  });

  document.getElementById('clear-selection').addEventListener('click', clearSelection);
}

function highlightSearchItem(items, input) {
  items.forEach((item, i) => {
    const active = i === searchActiveIndex;
    item.classList.toggle('active', active);
    if (active) {
      item.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', item.id);
    }
  });
}

function showSearchResults(q) {
  const results = document.getElementById('search-results');
  const input   = document.getElementById('pokemon-search');
  searchActiveIndex = -1;

  let matches = state.pokemonList
    .filter(p => p.name.includes(q))
    .slice(0, 10);

  if (matches.length > 0) {
    results.innerHTML = matches.map((p, i) => `
      <div class="search-item" id="search-item-${i}" data-name="${p.name}" data-sprite="${p.sprite || ''}" role="option" tabindex="-1">
        ${p.sprite ? `<img src="${escapeAttr(p.sprite)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/icon.svg';">` : ''}
        <span>${escapeHtml(cap(p.name))}</span>
      </div>`).join('');
    results.classList.add('active');
    input.setAttribute('aria-expanded', 'true');
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
  const input   = document.getElementById('pokemon-search');
  results.innerHTML = '<div class="search-loading">Searching…</div>';
  results.classList.add('active');
  input.setAttribute('aria-expanded', 'true');

  try {
    const res  = await fetch(`${API}/pokemon/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.length) {
      results.classList.remove('active');
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    results.innerHTML = data.map((p, i) => `
      <div class="search-item" id="search-item-${i}" data-name="${p.name}" data-sprite="${p.sprite || ''}" data-types="${(p.types || []).join(',')}" role="option" tabindex="-1">
        ${p.sprite ? `<img src="${escapeAttr(p.sprite)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/icon.svg';">` : ''}
        <span>${escapeHtml(cap(p.name))}</span>
      </div>`).join('');

    results.querySelectorAll('.search-item').forEach(item => {
      item.addEventListener('click', () => {
        const types = item.dataset.types ? item.dataset.types.split(',') : [];
        applySelection(item.dataset.name, item.dataset.sprite, types);
      });
    });
  } catch (_) {
    results.classList.remove('active');
    input.setAttribute('aria-expanded', 'false');
  }
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
    `<span class="type-badge" style="background:${TYPE_COLOR[t] || '#888'}">${escapeHtml(t)}</span>`
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
  const game  = document.getElementById('game-select').value;
  const hint  = document.getElementById('start-hunt-hint');
  const btn   = document.getElementById('start-hunt');

  const duplicate = state.selected && game && state.hunts.some(
    h => !h.completed && h.pokemon_name === state.selected.name && h.game === game
  );

  if (duplicate) {
    hint.textContent = `You already have an active ${cap(state.selected.name)} hunt in ${game}`;
    hint.classList.add('warning');
    hint.classList.remove('hidden');
    btn.disabled = true;
  } else if (!state.selected || !game) {
    hint.textContent = 'Select a Pokémon and game to continue';
    hint.classList.remove('warning');
    hint.classList.remove('hidden');
    btn.disabled = true;
  } else {
    hint.classList.add('hidden');
    btn.disabled = false;
  }
}

async function startHunt() {
  if (!state.selected) return;

  const game   = document.getElementById('game-select').value;
  const rawTgt = document.getElementById('target-count').value;
  const target = rawTgt ? parseInt(rawTgt, 10) : null;
  const btn    = document.getElementById('start-hunt');
  const name   = cap(state.selected.name);

  btn.disabled = true;
  btn.textContent = 'Starting…';

  const huntData = {
    pokemon_name: state.selected.name,
    game,
    sprite_url:   state.selected.sprite,
    types:        state.selected.types,
    target_count: target,
  };

  try {
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
        } else {
          addTempHunt(huntData);
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
    showToast(`Hunt started: ${name}`);
  } finally {
    btn.textContent = 'Start Hunt ✨';
    updateStartBtn();
  }
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
  queueOp({ type: 'create', tempId, data: huntData });
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
  updateHuntCard(id);
  renderStatsBar();

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
  document.getElementById('found-cancel').addEventListener('click', closeFoundOverlay);
  document.getElementById('found-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFoundOverlay();
  });
}

function closeFoundOverlay() {
  document.getElementById('found-overlay').classList.add('hidden');
  document.querySelector('.app').removeAttribute('aria-hidden');
  state.pendingFoundId = null;
  if (foundTriggerEl) {
    foundTriggerEl.focus();
    foundTriggerEl = null;
  }
}

function foundIt(id) {
  const hunt = getHunt(id);
  if (!hunt) return;

  state.pendingFoundId = id;
  foundTriggerEl = document.querySelector(`[data-action="found"][data-id="${id}"]`);

  document.getElementById('found-sprite').src    = hunt.sprite_url || '';
  document.getElementById('found-message').textContent =
    `${cap(hunt.pokemon_name)} found after ${(hunt.hunt_count || 0).toLocaleString()} encounter${hunt.hunt_count !== 1 ? 's' : ''}!`;

  buildOverlaySparkles();
  document.querySelector('.app').setAttribute('aria-hidden', 'true');
  document.getElementById('found-overlay').classList.remove('hidden');
  document.getElementById('found-confirm').focus();
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
  document.querySelector('.app').removeAttribute('aria-hidden');
  foundTriggerEl = null;

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
  showToast('Added to trophy cabinet!');
  setTimeout(() => switchTab('trophy'), 450);
}

async function unmarkComplete(id) {
  const hunt = getHunt(id);
  const name = hunt ? cap(hunt.pokemon_name) : 'this Pokémon';

  const confirmed = await showConfirm({
    title: 'Un-mark shiny?',
    message: `Move ${name} back to active hunts?`,
    actionLabel: 'Un-mark',
    destructive: false,
  });
  if (!confirmed) return;

  if (hunt) { hunt.completed = false; hunt.completed_at = null; }
  saveToStorage();
  renderAll();
  showToast('Moved back to active hunts');

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
  const hunt = getHunt(id);
  const name = hunt ? cap(hunt.pokemon_name) : 'this hunt';

  const confirmed = await showConfirm({
    title: 'Delete hunt?',
    message: `Remove ${name} from your hunts? This cannot be undone.`,
    actionLabel: 'Delete',
    destructive: true,
  });
  if (!confirmed) return;

  state.hunts = state.hunts.filter(h => String(h.id) !== String(id));
  saveToStorage();
  renderAll();
  showToast('Hunt deleted');

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
  const tablist = document.querySelector('.tab-nav');

  tablist.addEventListener('keydown', e => {
    const tabs = [...document.querySelectorAll('.tab-btn')];
    const idx  = tabs.findIndex(t => t.classList.contains('active'));
    if (idx < 0) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = tabs[(idx + 1) % tabs.length];
      switchTab(next.dataset.tab);
      next.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      switchTab(prev.dataset.tab);
      prev.focus();
    }
  });

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
    const isActive = el.id === `tab-${tab}`;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-hidden', !isActive);
  });
}

/* ============================================================
   CONFIRM MODAL
   ============================================================ */

function setupConfirmModal() {
  document.getElementById('confirm-cancel').addEventListener('click', () => closeConfirm(false));
  document.getElementById('confirm-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeConfirm(false);
  });
}

function showConfirm({ title, message, actionLabel, destructive = false }) {
  return new Promise(resolve => {
    confirmResolve = resolve;
    lastFocusedEl  = document.activeElement;

    document.getElementById('confirm-title').textContent   = title;
    document.getElementById('confirm-message').textContent = message;

    const actionBtn = document.getElementById('confirm-action');
    actionBtn.textContent = actionLabel;
    actionBtn.className   = `confirm-action-btn ${destructive ? 'destructive' : 'primary'}`;
    actionBtn.onclick     = () => closeConfirm(true);

    document.querySelector('.app').setAttribute('aria-hidden', 'true');
    document.getElementById('confirm-overlay').classList.remove('hidden');
    document.getElementById('confirm-cancel').focus();
  });
}

function closeConfirm(confirmed = false) {
  document.getElementById('confirm-overlay').classList.add('hidden');
  document.querySelector('.app').removeAttribute('aria-hidden');
  if (lastFocusedEl) {
    lastFocusedEl.focus();
    lastFocusedEl = null;
  }
  if (confirmResolve) {
    confirmResolve(confirmed);
    confirmResolve = null;
  }
}

/* ============================================================
   TOAST
   ============================================================ */

function showToast(message, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

/* ============================================================
   GLOBAL KEYBOARD
   ============================================================ */

function setupGlobalKeydown() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.odds-help-wrap.open').forEach(w => w.classList.remove('open'));

      const foundOverlay   = document.getElementById('found-overlay');
      const confirmOverlay = document.getElementById('confirm-overlay');

      if (!foundOverlay.classList.contains('hidden')) {
        closeFoundOverlay();
        return;
      }
      if (!confirmOverlay.classList.contains('hidden')) {
        closeConfirm(false);
      }
      return;
    }
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
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

function oddsHelpText(count, odds) {
  const n = count || 0;
  return `Chance of at least one shiny in ${n.toLocaleString()} encounter${n !== 1 ? 's' : ''} at 1/${odds.toLocaleString()} odds per encounter.`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
