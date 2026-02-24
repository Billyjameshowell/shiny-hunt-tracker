# Shiny Hunt Tracker (Web)

Track your Pokémon shiny hunts with a clean dashboard and tap counter.

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

## Owner
- Billyjameshowell
