const API_BASE = '/api';

let selectedPokemon = null;

document.addEventListener('DOMContentLoaded', () => {
  loadHunts();
  setupSearch();
  setupStartButton();
});

async function loadHunts() {
  try {
    const response = await fetch(`${API_BASE}/hunts`);
    const hunts = await response.json();
    renderHunts(hunts);
  } catch (error) {
    console.error('Failed to load hunts:', error);
  }
}

function renderHunts(hunts) {
  const container = document.getElementById('hunts-container');
  
  if (hunts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No hunts yet! Start hunting for your first shiny!</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = hunts.map(hunt => `
    <div class="hunt-card ${hunt.completed ? 'completed' : ''}" data-id="${hunt.id}">
      <img src="${hunt.sprite_url}" alt="${hunt.pokemon_name}" class="pokemon-sprite">
      <div class="pokemon-name">${hunt.pokemon_name}</div>
      <div class="game-name">${hunt.game}</div>
      <div class="counter-section">
        <button class="counter-btn" onclick="updateCounter(${hunt.id}, ${hunt.hunt_count - 1})">-</button>
        <span class="counter-value">${hunt.hunt_count.toLocaleString()}</span>
        <button class="counter-btn" onclick="updateCounter(${hunt.id}, ${hunt.hunt_count + 1})">+</button>
      </div>
      <button class="complete-btn ${hunt.completed ? 'marked' : ''}" onclick="toggleComplete(${hunt.id}, ${!hunt.completed})">
        ${hunt.completed ? '✓ Completed!' : 'Mark Complete'}
      </button>
      <button class="delete-btn" onclick="deleteHunt(${hunt.id})">Delete</button>
      <div class="date-started">Started: ${new Date(hunt.date_started).toLocaleDateString()}</div>
    </div>
  `).join('');
}

function setupSearch() {
  const searchInput = document.getElementById('pokemon-search');
  const searchResults = document.getElementById('search-results');
  
  let debounceTimer;
  
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = e.target.value.trim();
      if (query.length >= 2) {
        searchPokemon(query);
      } else {
        searchResults.classList.remove('active');
      }
    }, 300);
  });
  
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      searchResults.classList.remove('active');
    }, 200);
  });
  
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2) {
      searchPokemon(searchInput.value.trim());
    }
  });
}

async function searchPokemon(query) {
  try {
    const response = await fetch(`${API_BASE}/pokemon/search?q=${encodeURIComponent(query)}`);
    const results = await response.json();
    renderSearchResults(results);
  } catch (error) {
    console.error('Search failed:', error);
  }
}

function renderSearchResults(results) {
  const searchResults = document.getElementById('search-results');
  
  if (results.length === 0) {
    searchResults.classList.remove('active');
    return;
  }
  
  searchResults.innerHTML = results.map(pokemon => `
    <div class="search-result-item" data-name="${pokemon.name}" data-sprite="${pokemon.sprite}">
      <img src="${pokemon.sprite}" alt="${pokemon.name}">
      <span style="text-transform: capitalize;">${pokemon.name}</span>
    </div>
  `).join('');
  
  searchResults.classList.add('active');
  
  searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      selectPokemon(item.dataset.name, item.dataset.sprite);
      searchResults.classList.remove('active');
      document.getElementById('pokemon-search').value = '';
    });
  });
}

function selectPokemon(name, sprite) {
  selectedPokemon = { name, sprite };
  updateStartButton();
}

function setupStartButton() {
  const gameSelect = document.getElementById('game-select');
  gameSelect.addEventListener('change', updateStartButton);
}

function updateStartButton() {
  const startBtn = document.getElementById('start-hunt');
  const gameSelect = document.getElementById('game-select');
  startBtn.disabled = !selectedPokemon || !gameSelect.value;
}

async function startHunt() {
  if (!selectedPokemon) return;
  
  const gameSelect = document.getElementById('game-select');
  const game = gameSelect.value;
  
  try {
    const response = await fetch(`${API_BASE}/hunts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pokemon_name: selectedPokemon.name,
        game: game,
        sprite_url: selectedPokemon.sprite
      })
    });
    
    if (response.ok) {
      selectedPokemon = null;
      gameSelect.value = '';
      updateStartButton();
      loadHunts();
    }
  } catch (error) {
    console.error('Failed to start hunt:', error);
  }
}

document.getElementById('start-hunt').addEventListener('click', startHunt);

async function updateCounter(id, count) {
  if (count < 0) count = 0;
  
  try {
    await fetch(`${API_BASE}/hunts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hunt_count: count })
    });
    loadHunts();
  } catch (error) {
    console.error('Failed to update counter:', error);
  }
}

async function toggleComplete(id, completed) {
  try {
    await fetch(`${API_BASE}/hunts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed })
    });
    loadHunts();
  } catch (error) {
    console.error('Failed to toggle complete:', error);
  }
}

async function deleteHunt(id) {
  if (!confirm('Delete this hunt?')) return;
  
  try {
    await fetch(`${API_BASE}/hunts/${id}`, { method: 'DELETE' });
    loadHunts();
  } catch (error) {
    console.error('Failed to delete hunt:', error);
  }
}
