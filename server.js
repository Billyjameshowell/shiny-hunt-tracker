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
    console.log('Database initialized');
  } finally {
    client.release();
  }
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
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${q.toLowerCase()}`);
    if (!response.ok) {
      return res.json([]);
    }
    const data = await response.json();
    res.json([{
      name: data.name,
      sprite: data.sprites.front_shiny,
      id: data.id
    }]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pokemon/:name/shiny-sprite', async (req, res) => {
  const { name } = req.params;
  const { game } = req.query;
  
  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`);
    if (!response.ok) {
      return res.status(404).json({ error: 'Pokemon not found' });
    }
    const data = await response.json();
    
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
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});
