# Echo — Production Deployment Runbook (Free Tier)

> No fake data. No paid services required for the MVP. Follow in order; each step is verifiable.

## 0. Architecture (free)

```
GitHub (App install + webhooks + Actions) → Render Free (Fastify API, https://*.onrender.com)
                                          → Supabase Free (Postgres, dedicated project)
                                          → Vercel Hobby (Next.js, https://*.vercel.app)
                                          → Clerk (dashboard sign-in / tenant auth)
```

Free-tier limits: Render sleeps after 15 min idle (keep-alive ping below mitigates); Supabase pauses after 7 days without queries; Vercel Hobby is non-commercial.

Auth is split into two trust levels:

- **Machine → API**: GitHub webhooks (HMAC `X-Hub-Signature-256`) and the upload action (per-installation API key, stored as SHA-256).
- **Human → dashboard**: Clerk. Users sign in on the Vercel frontend; the session token is forwarded to the API, which verifies it against Clerk and derives the caller's tenant scope (installation ids) server-side.

---

## 1. Database — dedicated Supabase project

1. supabase.com → New project (any region, strong DB password).
2. Project Settings → Database → copy **Connection string** (pooler, port 6543, `?pgbouncer=true`) — use this as `DATABASE_URL`.
3. Keep this project **dedicated to Echo** (don't share it with other apps).

Verify: `npm run db:migrate` prints `Applied migrations: ...` or `No pending migrations.`

---

## 2. GitHub App

In GitHub → Settings → Developer settings → GitHub Apps → New GitHub App:

- **Webhook URL:** `https://<service>.onrender.com/webhooks/github`
- **Webhook secret:** generate one (`openssl rand -hex 32`) — this is `GITHUB_WEBHOOK_SECRET`
- **Permissions:**
  - Metadata: read
  - Administration: read
  - Actions: read
  - Contents: read
  - Pull requests: read & write
  - Issues: read & write
- **Subscribe to events:** `installation`, `workflow_run`
- **No user authorization callback is needed** — dashboard sign-in is handled by Clerk, not GitHub OAuth.
- Download the **private key** (`.pem`) and note the **App ID**.
- (Optional) Set the **Setup URL** to `https://<your-vercel>.vercel.app`.

Save. Install the app on the repos you want to monitor.

---

## 3. Backend — Render Free

1. Render → New Web Service → connect this repo.
2. Settings:
   - **Build command:** `npm ci`
   - **Start command:** `npm start` (`tsx src/server.ts`)
   - **Instance:** Free (512 MB)
   - **Region:** closest to your Supabase region
3. Environment variables (Render → Environment):

```env
GITHUB_WEBHOOK_SECRET=<openssl rand -hex 32>
DATABASE_URL=postgresql://...          # pooler connection string from step 1
CLERK_SECRET_KEY=sk_...                # from step 4 (same Clerk app as Vercel)

# GitHub App (enables issue creation + PR enrichment)
GITHUB_APP_ID=<from GitHub App>
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"  # inline (recommended on Render); or GITHUB_PRIVATE_KEY_PATH

# Optional public dashboard base URL (linked from issues / comments)
DASHBOARD_URL=https://<your-vercel>.vercel.app

# Optional — AI failure investigation (leave unset to disable)
AI_PROVIDER=openrouter
AI_MODEL=nvidia/nemotron-3-super-120b-a12b:free
AI_API_KEY=<openrouter key>
AI_BASE_URL=https://openrouter.ai/api/v1
```

4. Deploy. Copy the service URL: `https://<service>.onrender.com` → this is `API_URL`.

Verify:
- `curl https://<service>.onrender.com/healthz` → `{"status":"ok"}`
- `curl https://<service>.onrender.com/api/health` → `{"status":"ok"|"degraded", ...}` (real checks: DB `SELECT 1`, webhook/ingestion/scoring counts).

---

## 4. Clerk — dashboard auth & tenant mapping

1. clerk.com → New application. Copy the **publishable key** and the **secret key**.
2. The **same Clerk app** must be used by both the Vercel frontend and the Render API, so the API can verify tokens the frontend mints.
3. Map each user to the GitHub App installations they may access. This is what enforces tenancy — the API only ever trusts the installation ids stored on the Clerk user's metadata, never ids supplied by the browser:

```bash
npm run clerk:grant -- --list
npm run clerk:grant -- --email you@example.com --all
npm run clerk:grant -- --email you@example.com --installations 123456789
```

`clerk:grant` reads `CLERK_SECRET_KEY` and `DATABASE_URL` from `.env`, so run it from wherever those are set (locally, or as a one-off Render shell).

> If `CLERK_SECRET_KEY` is unset on the API, it runs in **unauthenticated dev mode** (all data visible). Never ship production without it.

---

## 5. Frontend — Vercel Hobby

1. Vercel → Add New Project → import the same repo.
2. Root directory: `web`.
3. Environment variables (Vercel → Settings → Environment Variables):

```env
API_URL=https://<service>.onrender.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...                     # same Clerk app as Render
NEXT_PUBLIC_GITHUB_APP_INSTALL_URL=https://github.com/apps/<your-app-slug>/installations/new
```

4. Deploy. Copy `https://<your-vercel>.vercel.app`.

Verify: open the dashboard, sign in with Clerk, and confirm the repositories you installed the app on are listed (empty state if no runs yet).

---

## 6. Repository action & API key

In the installed repo, add `.github/workflows/echo-demo.yml` (or your own), using the published action:

```yaml
- name: Upload results to Echo
  if: always()
  continue-on-error: true
  uses: muskan-wagh/CI-CD-reliability-monitor/action@v1
  with:
    report-path: junit.xml
    api-url: ${{ vars.ECHO_API_URL }}
    api-key: ${{ secrets.ECHO_API_KEY }}
```

Get the per-installation API key: sign in on the dashboard → open the installation → reveal the **API key** (plaintext shown once, stored as SHA-256). Add it as repo secret `ECHO_API_KEY`, and `ECHO_API_URL` as a repo variable.

Push a commit or run the workflow manually — data appears on the dashboard within seconds.

---

## 7. Keep-alive (mitigate free-tier sleep)

Add a free cron (cron-job.org, UptimeRobot, or Vercel Cron) that hits every 10 minutes:

- `GET https://<service>.onrender.com/healthz`
- `GET https://<your-vercel>.vercel.app` (optional)

And a daily DB ping (same cron hitting `GET https://<service>.onrender.com/api/health`, which does `SELECT 1`).

---

## 8. Two-user isolation check

The test suite already covers this. Run:

```bash
npm test -- test/tenancy.test.ts test/apiKeys.test.ts
```

It asserts: user B cannot read user A's `/api/dashboard`, `/api/tests/:id/history`; ingest with the wrong key → 401/403; a valid token scopes queries to the caller's installations.

For a live two-account check, have a second GitHub user install the app on a different repo, `clerk:grant` their own installations, and verify each dashboard only shows its own repositories.
