# Launch Checklist

## Product
- Verify the core loop on desktop and mobile: search Pokemon, select game, start hunt, increment/decrement encounters, mark found, unmark, delete, and switch tabs.
- Confirm the PWA install prompt appears on supported browsers and that the app shell loads offline after one successful visit.
- Use a real `DATABASE_URL` in production. Without it, the server intentionally falls back to temporary in-memory storage for local UI testing.

## Production setup (Fly.io)
```bash
# Attach Postgres
fly postgres attach <db-app-name> -a shiny-hunt-tracker

# Required secrets
fly secrets set DATABASE_URL="postgres://..." SITE_URL="https://shiny-hunt-tracker.fly.dev" NODE_ENV=production -a shiny-hunt-tracker

# Optional: auto-deploy from GitHub
# Add FLY_API_TOKEN to GitHub repo secrets (see README)
```

Verify health: `curl https://shiny-hunt-tracker.fly.dev/api/health`

## Custom domain
1. Buy a domain (see `DOMAIN_RESEARCH.md` for naming guidance).
2. `fly certs add yourdomain.com -a shiny-hunt-tracker`
3. Point DNS to Fly.io.
4. Update the site URL:
   ```bash
   fly secrets set SITE_URL="https://yourdomain.com" -a shiny-hunt-tracker
   ```
5. Redeploy (or wait for the next GitHub Actions deploy).

No manual edits to `index.html`, `robots.txt`, or `sitemap.xml` are needed — they use `SITE_URL` at runtime.

## SEO
- Submit `https://yourdomain.com/sitemap.xml` to Google Search Console and Bing Webmaster Tools.
- Keep the title near 50-60 characters and the meta description near 150-160 characters when changing copy.
- Confirm share previews render with `public/og-image.svg` (some platforms prefer PNG).

## Pre-Launch QA
- Run `npm run build`.
- Test at 390px mobile, 768px tablet, and 1440px desktop.
- Check Lighthouse for SEO, accessibility, best practices, and PWA issues.
- Confirm `GET /api/health` reports `storage: "postgres"` in production.

## Domain Shortlist Criteria
- Prefer `.com`, `.app`, or `.tools` if the first-year and renewal price are both under $20/year.
- Avoid domains that are cheap only for year one but renew above budget.
- Avoid trademark-heavy names that imply official Pokemon ownership.
