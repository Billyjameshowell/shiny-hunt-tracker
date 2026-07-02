const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5055;
const host = process.env.HOST || '0.0.0.0';
const hasDatabase = Boolean(process.env.DATABASE_URL);
const SITE_URL = (process.env.SITE_URL || 'https://shiny-hunt-tracker.fly.dev').replace(/\/$/, '');

if (process.env.NODE_ENV === 'production' && !hasDatabase) {
  console.error('WARNING: DATABASE_URL is not set in production. Hunts will not persist across restarts.');
}

app.disable('x-powered-by');
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
}));
app.use(express.json());

const pool = hasDatabase ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;

function siteTemplate(filename) {
  const raw = fs.readFileSync(path.join(__dirname, 'public', filename), 'utf8');
  return raw.replaceAll('__SITE_URL__', SITE_URL);
}

app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    storage: hasDatabase ? 'postgres' : 'memory',
    siteUrl: SITE_URL,
    timestamp: new Date().toISOString(),
  };

  if (hasDatabase) {
    try {
      await pool.query('SELECT 1');
      health.database = 'connected';
    } catch (_) {
      health.status = 'degraded';
      health.database = 'error';
    }
  }

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.get('/', (req, res) => {
  res.type('html').send(siteTemplate('index.html'));
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(siteTemplate('robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(siteTemplate('sitemap.xml'));
});

app.use(express.static('public'));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

const memoryHunts = [];
let memoryId = 1;

// ── Caches ─────────────────────────────────────────────────────────────────────
// Full Pokémon list (name + id + shiny sprite URL) — refresh every 6 hours
let pokemonListCache = null;
let pokemonListFetchedAt = 0;
const POKEMON_LIST_TTL = 1000 * 60 * 60 * 6;

// Per-name full data cache — refresh every 24 hours
const pokemonByNameCache = new Map();
const POKEMON_BY_NAME_TTL = 1000 * 60 * 60 * 24;

// ── DB init ────────────────────────────────────────────────────────────────────

async function initDB() {
  if (!hasDatabase) {
    console.warn('DATABASE_URL not set; using in-memory storage for local UI development.');
    return;
  }
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
    // Safe migrations for deployments on existing tables
    await client.query(`ALTER TABLE shiny_hunts ADD COLUMN IF NOT EXISTS types TEXT DEFAULT '[]'`);
    await client.query(`ALTER TABLE shiny_hunts ADD COLUMN IF NOT EXISTS target_count INTEGER`);
    await client.query(`ALTER TABLE shiny_hunts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
    // Index to keep list queries fast as the table grows
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_shiny_hunts_date_started
      ON shiny_hunts (date_started DESC)
    `);
    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// ── PokeAPI helpers ────────────────────────────────────────────────────────────

async function getPokemonList() {
  const now = Date.now();
  if (pokemonListCache && now - pokemonListFetchedAt < POKEMON_LIST_TTL) {
    return pokemonListCache;
  }

  const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1302');
  if (!response.ok) throw new Error(`PokeAPI list fetch failed: ${response.status}`);
  const data = await response.json();

  // Include shiny sprite URL directly so clients don't need a second request
  pokemonListCache = data.results.map((p, i) => ({
    id: i + 1,
    name: p.name,
    sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${i + 1}.png`,
  }));
  pokemonListFetchedAt = now;
  return pokemonListCache;
}

async function getPokemonByName(name) {
  const key = String(name).toLowerCase().trim();
  const cached = pokemonByNameCache.get(key);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < POKEMON_BY_NAME_TTL) {
    return cached.data;
  }

  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${key}`);
  if (!response.ok) return null;

  const data = await response.json();
  pokemonByNameCache.set(key, { data, fetchedAt: now });
  return data;
}

// ── Hunts ──────────────────────────────────────────────────────────────────────

app.get('/api/hunts', async (req, res) => {
  if (!hasDatabase) {
    res.json([...memoryHunts].sort((a, b) => new Date(b.date_started) - new Date(a.date_started)));
    return;
  }
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
  if (!pokemon_name || !game || !sprite_url) {
    return res.status(400).json({ error: 'pokemon_name, game, and sprite_url are required' });
  }
  if (!hasDatabase) {
    const hunt = {
      id: memoryId++,
      pokemon_name,
      game,
      sprite_url,
      types: Array.isArray(types) ? types : [],
      hunt_count: 0,
      target_count: target_count || null,
      date_started: new Date().toISOString(),
      completed: false,
      completed_at: null,
    };
    memoryHunts.unshift(hunt);
    res.json(hunt);
    return;
  }
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
    if (!hasDatabase) {
      const hunt = memoryHunts.find(h => String(h.id) === String(id));
      if (!hunt) return res.status(404).json({ error: 'Hunt not found' });
      if (hunt_count !== undefined) hunt.hunt_count = hunt_count;
      if (completed !== undefined) hunt.completed = completed;
      if (completed_at !== undefined) hunt.completed_at = completed_at;
      if (target_count !== undefined) hunt.target_count = target_count;
      res.json(hunt);
      return;
    }

    const setClauses = [];
    const params = [];
    let idx = 1;

    if (hunt_count !== undefined)   { setClauses.push(`hunt_count = $${idx++}`);   params.push(hunt_count); }
    if (completed !== undefined)    { setClauses.push(`completed = $${idx++}`);    params.push(completed); }
    if (completed_at !== undefined) { setClauses.push(`completed_at = $${idx++}`); params.push(completed_at); }
    if (target_count !== undefined) { setClauses.push(`target_count = $${idx++}`); params.push(target_count); }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);
    const result = await pool.query(
      `UPDATE shiny_hunts SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Hunt not found' });
    const row = { ...result.rows[0], types: JSON.parse(result.rows[0].types || '[]') };
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/hunts/:id', async (req, res) => {
  try {
    if (!hasDatabase) {
      const index = memoryHunts.findIndex(h => String(h.id) === String(req.params.id));
      if (index !== -1) memoryHunts.splice(index, 1);
      res.json({ success: true });
      return;
    }
    await pool.query('DELETE FROM shiny_hunts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pokémon ────────────────────────────────────────────────────────────────────

// Exact name lookup — returns name, sprite, types, id (used when user selects a Pokémon)
app.get('/api/pokemon/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json([]);

  try {
    const data = await getPokemonByName(q);
    if (!data) return res.json([]);

    res.json([{
      name: data.name,
      sprite: data.sprites.front_shiny || data.sprites.front_default,
      types: data.types.map(t => t.type.name),
      id: data.id,
    }]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full Pokémon list — cached; includes shiny sprite URL for instant autocomplete
app.get('/api/pokemon/list', async (req, res) => {
  try {
    const list = await getPokemonList();
    res.json(list);
  } catch (_) {
    // Return empty — client will fall back to exact search
    res.json([]);
  }
});

// ── Stats ──────────────────────────────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  try {
    if (!hasDatabase) {
      const completed = memoryHunts.filter(h => h.completed);
      const total = memoryHunts.reduce((sum, h) => sum + (h.hunt_count || 0), 0);
      res.json({
        active_count: memoryHunts.length - completed.length,
        completed_count: completed.length,
        total_encounters: total,
        avg_encounters: completed.length ? Math.round(completed.reduce((sum, h) => sum + (h.hunt_count || 0), 0) / completed.length) : null,
        luckiest: completed.sort((a, b) => a.hunt_count - b.hunt_count)[0] || null,
        longest: completed.sort((a, b) => b.hunt_count - a.hunt_count)[0] || null,
      });
      return;
    }
    const totals = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT completed)    AS active_count,
        COUNT(*) FILTER (WHERE completed)        AS completed_count,
        SUM(hunt_count)                          AS total_encounters,
        AVG(hunt_count) FILTER (WHERE completed) AS avg_encounters
      FROM shiny_hunts
    `);
    const luckiest = await pool.query(
      'SELECT pokemon_name, hunt_count FROM shiny_hunts WHERE completed = true ORDER BY hunt_count ASC  LIMIT 1'
    );
    const longest = await pool.query(
      'SELECT pokemon_name, hunt_count FROM shiny_hunts WHERE completed = true ORDER BY hunt_count DESC LIMIT 1'
    );
    res.json({ ...totals.rows[0], luckiest: luckiest.rows[0] || null, longest: longest.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Boot ───────────────────────────────────────────────────────────────────────

initDB().then(() => {
  app.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
  });
});
