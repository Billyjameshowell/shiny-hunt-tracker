const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Simple in-memory caches to cut repeated PokeAPI latency
let pokemonListCache = null;
let pokemonListFetchedAt = 0;
const POKEMON_LIST_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

const pokemonByNameCache = new Map();
const POKEMON_BY_NAME_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS shiny_hunts (
        id SERIAL PRIMARY KEY,
        pokemon_name VARCHAR(100) NOT NULL,
        game VARCHAR(100) NOT NULL,
        sprite_url TEXT NOT NULL,
        hunt_count INTEGER DEFAULT 0,
        date_started TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed BOOLEAN DEFAULT FALSE
      )
    `);

    // Helps if hunt list grows over time
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_shiny_hunts_date_started
      ON shiny_hunts (date_started DESC)
    `);

    console.log('Database initialized');
  } finally {
    client.release();
  }
}

async function getPokemonList() {
  const now = Date.now();
  if (pokemonListCache && now - pokemonListFetchedAt < POKEMON_LIST_TTL_MS) {
    return pokemonListCache;
  }

  const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1302');
  if (!response.ok) throw new Error(`Failed pokemon list fetch: ${response.status}`);

  const data = await response.json();
  pokemonListCache = data.results.map((p, index) => ({
    id: index + 1,
    name: p.name,
    sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${index + 1}.png`
  }));
  pokemonListFetchedAt = now;
  return pokemonListCache;
}

async function getPokemonByName(name) {
  const key = String(name).toLowerCase();
  const cached = pokemonByNameCache.get(key);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < POKEMON_BY_NAME_TTL_MS) {
    return cached.data;
  }

  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${key}`);
  if (!response.ok) return null;

  const data = await response.json();
  pokemonByNameCache.set(key, { data, fetchedAt: now });
  return data;
}

app.get('/api/hunts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM shiny_hunts ORDER BY date_started DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hunts', async (req, res) => {
  const { pokemon_name, game, sprite_url } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO shiny_hunts (pokemon_name, game, sprite_url) VALUES ($1, $2, $3) RETURNING *',
      [pokemon_name, game, sprite_url]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/hunts/:id', async (req, res) => {
  const { id } = req.params;
  const { hunt_count, completed } = req.body;

  try {
    let query, params;

    if (hunt_count !== undefined && completed !== undefined) {
      query = 'UPDATE shiny_hunts SET hunt_count = $1, completed = $2 WHERE id = $3 RETURNING *';
      params = [hunt_count, completed, id];
    } else if (hunt_count !== undefined) {
      query = 'UPDATE shiny_hunts SET hunt_count = $1 WHERE id = $2 RETURNING *';
      params = [hunt_count, id];
    } else if (completed !== undefined) {
      query = 'UPDATE shiny_hunts SET completed = $1 WHERE id = $2 RETURNING *';
      params = [completed, id];
    } else {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/hunts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM shiny_hunts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pokemon/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    const normalized = String(q).toLowerCase().trim();
    const pokemonList = await getPokemonList();

    const startsWith = [];
    const includes = [];

    for (const p of pokemonList) {
      if (p.name.startsWith(normalized)) {
        startsWith.push(p);
      } else if (p.name.includes(normalized)) {
        includes.push(p);
      }

      if (startsWith.length >= 10) break;
    }

    const combined = [...startsWith, ...includes].slice(0, 10);
    res.json(combined);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pokemon/:name/shiny-sprite', async (req, res) => {
  const { name } = req.params;
  const { game } = req.query;

  try {
    const data = await getPokemonByName(name);
    if (!data) {
      return res.status(404).json({ error: 'Pokemon not found' });
    }

    let sprite = data.sprites.front_shiny;

    // Different games have different sprite styles
    if (game && game.includes('home')) {
      sprite = data.sprites.other['official-artwork'].front_shiny || sprite;
    }

    res.json({ sprite });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

initDB().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${port}`);
  });
});