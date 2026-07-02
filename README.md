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
# set DATABASE_URL (optional for UI-only testing)
npm run dev
```

If `DATABASE_URL` is not set, the server uses temporary in-memory storage so the UI can be tested locally without Postgres.
By default, local development runs on `http://localhost:5055`; set `PORT` to override it.

## Production on Fly.io

### 1. Create Postgres (if needed)
```bash
fly postgres create --name shiny-hunt-tracker-db --region ewr
fly postgres attach shiny-hunt-tracker-db -a shiny-hunt-tracker
```

### 2. Set secrets
```bash
fly secrets set \
  DATABASE_URL="postgres://..." \
  SITE_URL="https://shiny-hunt-tracker.fly.dev" \
  NODE_ENV="production" \
  -a shiny-hunt-tracker
```

`SITE_URL` drives canonical URLs, Open Graph tags, `robots.txt`, and `sitemap.xml`. When you buy a custom domain, update `SITE_URL` and run `fly certs add yourdomain.com`.

### 3. Deploy
```bash
fly deploy
```

Or merge to `main` with `FLY_API_TOKEN` set in GitHub Actions secrets for automatic deploys.

### Health check
`GET /api/health` returns storage mode and database connectivity. Fly.io uses this for machine health checks.

## API Endpoints
- `GET /api/health`
- `GET /api/hunts`
- `POST /api/hunts`
- `PUT /api/hunts/:id`
- `DELETE /api/hunts/:id`
- `GET /api/pokemon/search?q=...`
- `GET /api/pokemon/list`
- `GET /api/stats`

## Owner
- Billyjameshowell
