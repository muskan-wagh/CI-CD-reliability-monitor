# FlakyGuard — Production Deployment Runbook (Free Tier)

> No fake data. No paid services required for the MVP. Follow in order; each step is verifiable.

## 0. Architecture (free)

```
GitHub (App install + webhooks + Actions) → Render Free (Fastify API, https://*.onrender.com)
                                         → Supabase Free (Postgres, dedicated project)
                                         → Vercel Hobby (Next.js, https://*.vercel.app)
```

Free-tier limits: Render sleeps after 15 min idle (keep-alive ping below mitigates); Supabase pauses after 7 days without queries; Vercel Hobby is non-commercial.

---

## 1. Database — dedicated Supabase project

1. supabase.com → New project (any region, strong DB password).
2. Project Settings → Database → copy **Connection string** (pooler, port 6543, `?pgbouncer=true`) — use this as `DATABASE_URL`.
3. Keep this project **dedicated to FlakyGuard** (the previous shared project also hosts `TRAVE_*`/`ai_*` apps).

Verify: `npm run db:migrate` prints `Applied migrations: ...` or `No pending migrations.`

---

## 2. Backend — Render Free

1. Render → New Web Service → connect this repo.
2. Settings:
   - **Build command:** `npm ci && npm run build` (or `npm ci` — API needs no build, `tsx` runs TS directly)
   - **Start command:** `npm start` (`tsx src/server.ts`)
   - **Instance:** Free (512 MB)
   - **Region:** closest to your Supabase region
3. Environment variables (Render → Environment):

```env
GITHUB_WEBHOOK_SECRET=<openssl rand -hex 32>
DATABASE_URL=postgresql://... (pooler, from step 1)
SESSION_SECRET=<openssl rand -hex 32>          # shared with Vercel
GITHUB_APP_ID=<from GitHub App>
GITHUB_PRIVATE_KEY=<paste full PEM with \n>      # or GITHUB_PRIVATE_KEY_PATH in repo root
GITHUB_OAUTH_CLIENT_ID=<from GitHub App>
GITHUB_OAUTH_CLIENT_SECRET=<from GitHub App>
DASHBOARD_URL=https://<your-vercel>.vercel.app
AI_PROVIDER=openrouter                           # or empty to disable AI
AI_MODEL=nvidia/nemotron-3-super-120b-a12b:free  # free tier via OpenRouter; see https://openrouter.ai/models?q=free
AI_API_KEY=<openrouter key>
AI_BASE_URL=https://openrouter.ai/api/v1
FRONTEND_URL=https://<your-vercel>.vercel.app
```

4. Deploy. Copy the service URL: `https://<service>.onrender.com` → this is `API_URL`.

Verify: `curl https://<service>.onrender.com/healthz` → `{"status":"ok"}` and `curl .../api/health` → `ok/degraded`.

---

## 3. Frontend — Vercel Hobby

1. Vercel → Add New Project → import same repo.
2. Root directory: `web`
3. Environment variables (Vercel → Settings → Environment Variables):

```env
API_URL=https://<service>.onrender.com
SESSION_SECRET=<same value as Render>
GITHUB_OAUTH_CLIENT_ID=<same as Render>
GITHUB_OAUTH_CLIENT_SECRET=<same as Render>
FRONTEND_URL=https://<your-vercel>.vercel.app
NEXT_PUBLIC_GITHUB_APP_INSTALL_URL=https://github.com/apps/<your-app-slug>
```

4. Deploy. Copy `https://<your-vercel>.vercel.app`.

Verify: open `https://<your-vercel>.vercel.app` → empty state or your data (once installed).

---

## 4. GitHub App

In GitHub → Settings → Developer settings → GitHub Apps → your FlakyGuard app:

- **Webhook URL:** `https://<service>.onrender.com/webhooks/github`
- **Webhook secret:** same `GITHUB_WEBHOOK_SECRET`
- **Permissions:** Metadata read, Administration read, Actions read, Contents read, Pull requests read+write, Issues read+write
- **Subscribe to events:** `installation`, `workflow_run`
- **User authorization callback URL:** `https://<your-vercel>.vercel.app/api/auth/callback`
- **Setup URL (optional):** `https://<your-vercel>.vercel.app`

Save. Then **Install** the app on at least one repo (select that repo).

---

## 5. Repository Action

In the installed repo, add `.github/workflows/flakyguard.yml` (see `demo/.github/workflows/flakyguard-demo.yml`):

```yaml
- uses: ./action  # or the published action
  if: always()
  continue-on-error: true
  with:
    report-path: junit.xml
    api-url: https://<service>.onrender.com
    api-key: ${{ secrets.FLAKYGUARD_API_KEY }}
```

Get the per-installation API key: sign in on the dashboard → the app installation's **API key** is shown once (stored as SHA-256). Add it as repo secret `FLAKYGUARD_API_KEY`.

Push a commit or run the workflow manually — data appears on the dashboard within seconds.

---

## 6. Keep-alive (mitigate free-tier sleep)

Add a free cron (cron-job.org, UptimeRobot, or Vercel Cron) that hits every 10 minutes:

- `GET https://<service>.onrender.com/healthz`
- `GET https://<your-vercel>.vercel.app` (optional)

And a daily DB ping (same cron hitting `GET https://<service>.onrender.com/api/health` which does `SELECT 1`).

---

## 7. Two-user isolation check (local, no second GitHub account needed)

The test suite already covers this. Run:

```bash
npm test -- test/tenancy.test.ts test/apiKeys.test.ts test/session.test.ts
```

It asserts: user B cannot read user A's `/api/dashboard`, `/api/tests/:id/history`; ingest with the wrong key → 401/403; valid token scopes queries to `r.installation_id = ANY($ids)`.

For a live two-account check, have a second GitHub user install the app on a different repo, and verify each dashboard only shows its own repositories.
