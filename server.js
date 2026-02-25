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

// Server-side Pokémon list cache (avoids repeated PokeAPI calls)
let pokemonListCache = null;
let pokemonListCacheTime = 0;
const POKEMON_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS shiny_hunts (
        id SERIAL PRIMARY KEY,
        pokemon_name VARCHAR(100) NOT NULL,
        game VARCHAR(100) NOT NULL,
        sprite_url TEXT NOT NULL,
        types TEXT DEFAULT '[]',
        hunt_count INTEGER DEFAULT 0,
        target_count INTEGER,
        date_started TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP
      )
    `);
    // Safe migrations for existing tables
    await client.query(`ALTER TABLE shiny_hunts ADD COLUMN IF NOT EXISTS types TEXT DEFAULT '[]'`);
    await client.query(`ALTER TABLE shiny_hunts ADD COLUMN IF NOT EXISTS target_count INTEGER`);
    await client.query(`ALTER TABLE shiny_hunts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// ── Hunts ──────────────────────────────────────────────────────────────────────

app.get('/api/hunts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM shiny_hunts ORDER BY date_started DESC');
    const rows = result.rows.map(r => ({
      ...r,
      types: r.types ? JSON.parse(r.types) : []
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hunts', async (req, res) => {
  const { pokemon_name, game, sprite_url, types = [], target_count } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO shiny_hunts (pokemon_name, game, sprite_url, types, target_count) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [pokemon_name, game, sprite_url, JSON.stringify(types), target_count || null]
    );
    const row = { ...result.rows[0], types: JSON.parse(result.rows[0].types || '[]') };
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/hunts/:id', async (req, res) => {
  const { id } = req.params;
  const { hunt_count, completed, completed_at, target_count } = req.body;

  try {
    const setClauses = [];
    const params = [];
    let idx = 1;

    if (hunt_count !== undefined) { setClauses.push(`hunt_count = $${idx++}`); params.push(hunt_count); }
    if (completed !== undefined)  { setClauses.push(`completed = $${idx++}`);  params.push(completed); }
    if (completed_at !== undefined) { setClauses.push(`completed_at = $${idx++}`); params.push(completed_at); }
    if (target_count !== undefined) { setClauses.push(`target_count = $${idx++}`); params.push(target_count); }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);
    const result = await pool.query(
      `UPDATE shiny_hunts SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    const row = { ...result.rows[0], types: JSON.parse(result.rows[0].types || '[]') };
    res.json(row);
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

// ── Pokémon ────────────────────────────────────────────────────────────────────

// Exact name lookup — returns name, sprite, types, id
app.get('/api/pokemon/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json([]);

  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${q.toLowerCase().trim()}`);
    if (!response.ok) return res.json([]);
    const data = await response.json();
    res.json([{
      name: data.name,
      sprite: data.sprites.front_shiny || data.sprites.front_default,
      types: data.types.map(t => t.type.name),
      id: data.id
    }]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full Pokémon name list — cached server-side for 24h
app.get('/api/pokemon/list', async (req, res) => {
  try {
    const now = Date.now();
    if (pokemonListCache && (now - pokemonListCacheTime) < POKEMON_CACHE_TTL) {
      return res.json(pokemonListCache);
    }

    const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1025');
    if (!response.ok) throw new Error('PokeAPI unavailable');
    const data = await response.json();

    pokemonListCache = data.results.map((p, i) => ({ name: p.name, id: i + 1 }));
    pokemonListCacheTime = now;
    res.json(pokemonListCache);
  } catch (err) {
    // Return empty if PokeAPI is down — client falls back to exact search
    res.json([]);
  }
});

// ── Stats ──────────────────────────────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT completed)  AS active_count,
        COUNT(*) FILTER (WHERE completed)      AS completed_count,
        SUM(hunt_count)                        AS total_encounters,
        AVG(hunt_count) FILTER (WHERE completed) AS avg_encounters
      FROM shiny_hunts
    `);

    const luckiest = await pool.query(
      'SELECT pokemon_name, hunt_count FROM shiny_hunts WHERE completed = true ORDER BY hunt_count ASC LIMIT 1'
    );
    const longest = await pool.query(
      'SELECT pokemon_name, hunt_count FROM shiny_hunts WHERE completed = true ORDER BY hunt_count DESC LIMIT 1'
    );

    res.json({
      ...totals.rows[0],
      luckiest: luckiest.rows[0] || null,
      longest: longest.rows[0] || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Boot ───────────────────────────────────────────────────────────────────────

initDB().then(() => {
  app.listen(port, () => console.log(`Server running on port ${port}`));
});
