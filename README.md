# Shiny Hunt Tracker (Web)

Track Pokemon shiny hunts with a clean dashboard, tap-friendly encounter counters, shiny odds, target progress, stats, trophy cabinet, and offline-ready PWA support.

## Live App
- https://shiny-hunt-tracker.fly.dev/

## Features
- Search Pokémon
- Choose game/generation context
- Start and track hunts
- Increment/decrement encounter counter
- Mark hunts complete/uncomplete
- Persistent PostgreSQL storage
- PWA support (Add to Home Screen)
- SEO metadata, sitemap, robots.txt, and share image

## Tech Stack
- Node.js + Express
- PostgreSQL
- Vanilla HTML/CSS/JS
- Fly.io deployment
- PokeAPI integration

## Local Development
```bash
npm install
cp .env.example .env
# set DATABASE_URL
npm run dev
```

If `DATABASE_URL` is not set, the server uses temporary in-memory storage so the UI can be tested locally without Postgres.
By default, local development runs on `http://localhost:5055`; set `PORT` to override it.

## Deploy
```bash
fly deploy
```

## API Endpoints
- `GET /api/hunts`
- `POST /api/hunts`
- `PUT /api/hunts/:id`
- `DELETE /api/hunts/:id`
- `GET /api/pokemon/search?q=...`
- `GET /api/pokemon/list`

## Owner
- Billyjameshowell
