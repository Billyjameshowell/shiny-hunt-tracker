# Launch Checklist

## Product
- Verify the core loop on desktop and mobile: search Pokemon, select game, start hunt, increment/decrement encounters, mark found, unmark, delete, and switch tabs.
- Confirm the PWA install prompt appears on supported browsers and that the app shell loads offline after one successful visit.
- Use a real `DATABASE_URL` in production. Without it, the server intentionally falls back to temporary in-memory storage for local UI testing.

## SEO
- Replace `https://shiny-hunt-tracker.fly.dev/` in `public/index.html`, `public/robots.txt`, and `public/sitemap.xml` after buying a domain.
- Add the production domain in Fly.io with `fly certs add yourdomain.com`.
- Submit `https://yourdomain.com/sitemap.xml` to Google Search Console and Bing Webmaster Tools.
- Keep the title near 50-60 characters and the meta description near 150-160 characters when changing copy.

## Domain Shortlist Criteria
- Prefer `.com`, `.app`, or `.tools` if the first-year and renewal price are both under $20/year.
- Avoid domains that are cheap only for year one but renew above budget.
- Avoid trademark-heavy names that imply official Pokemon ownership.

## Pre-Launch QA
- Run `npm run build`.
- Test at 390px mobile, 768px tablet, and 1440px desktop.
- Check Lighthouse for SEO, accessibility, best practices, and PWA issues.
- Confirm share previews render with `public/og-image.svg`.
