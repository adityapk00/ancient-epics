# Deployment Checklist

Ancient Epics deploys as:

- Cloudflare Pages for the frontend
- Cloudflare Workers for the API
- Cloudflare D1 for relational data
- Cloudflare R2 for chapter payloads

## One-Time Setup

1. Buy or transfer your domain into Cloudflare.
2. Install dependencies with `pnpm install`.
3. Authenticate Wrangler with `pnpm exec wrangler login`.
4. Copy `cloudflare.config.example.json` to `cloudflare.config.json`.
5. Fill in `cloudflare.config.json` with your real account ID, zone, domains, and resource names.
6. Run `pnpm cf:setup`.
7. Run `pnpm remote:db:seed`.
8. Run `pnpm remote:admin:password <your-password>`.
9. In the Cloudflare dashboard, attach your site domain to the Pages project.

## Repeat Deploy

1. Run `pnpm remote:db:migrate`.
2. Run `pnpm cf:deploy`.

The deploy script:

- builds the frontend with `VITE_API_BASE_URL` pointed at your API domain
- deploys the Worker with the `production` Wrangler environment
- deploys the Vite `dist` output to Cloudflare Pages

## Notes

- The API custom domain is configured in `apps/api/wrangler.jsonc` under `env.production.routes`.
- The Pages custom domain is still a dashboard step.
- `pnpm remote:db:seed` applies remote D1 migrations, seeds D1, and uploads any files under `apps/api/seed/r2`.
- `pnpm local:db:migrate` applies local D1 migrations without reseeding data.
- `pnpm remote:db:migrate` applies remote D1 migrations without reseeding data.
- `pnpm remote:admin:password` only sets the initial admin password in remote D1.
- `SESSION_SECRET` and Stripe secrets are not part of the current production flow because the current code does not consume them yet.
