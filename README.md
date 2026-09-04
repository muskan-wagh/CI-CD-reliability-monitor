# Echo

**Every failure leaves a signal.**

Echo is a CI/CD reliability monitor: it ingests JUnit reports and GitHub
workflow events, fingerprints failures, scores test flakiness deterministically,
investigates root causes, and reports back via dashboard, PR comments, and
issues.

## Quickstart

- `npm run dev` — start the API (repo root)
- `npm run demo` — seed deterministic demo data (requires the API running)
- `npm run db:status` — inspect stored rows
- `cd web && npm run dev` — start the dashboard
- `npm test` — run the test suite
- `npm run db:migrate` — apply pending migrations

See `.env.example` for required configuration and `DEPLOY.md` for the
free-tier production runbook (Render + Supabase + Vercel + Clerk).

## Architecture

```
GitHub (App webhooks + Actions) ──► Fastify API (Render)
                                    │  /webhooks/github  (HMAC)
                                    │  /v1/ingest       (API key)
                                    │  /api/*           (Clerk session)
                                    ▼
                                 PostgreSQL (Supabase)
                                    ▲
Next.js dashboard (Vercel) ────────┘  (reads via /api/*)
```

One backend service, two entrypoints conceptually: the **receiver** (verify,
dedupe, ack fast) and the **processor** (parse → normalize → fingerprint →
score). Data flows:

```
push → workflow run → action uploads junit.xml → /v1/ingest
                    └─ workflow_run.completed webhook ──► run facts + PR correlation
```

## How it works

1. **Ingest** — a tiny composite action POSTs JUnit XML + run metadata, keyed by
   a per-installation API key (stored as SHA-256, shown once).
2. **Identity** — each test is keyed by `file + suite + name` (never line
   numbers), hashed to a stable identity. Parameterized cases roll up to a
   parent.
3. **Fingerprinting** — failures are normalized (ANSI stripped, paths/ids/timestamps
   redacted) and hashed, so one root cause surfacing as N test failures groups
   into one signature.
4. **Scoring** — a rolling window computes a 0–100 flake score from the
   recency-weighted transition rate (PASS↔FAIL flips) plus failure rate, with a
   BROKEN override for long consecutive-failure streaks. A test needs ≥8 runs
   before it is scored at all.

## Decisions (and why)

- **Action upload, not log-scraping.** JUnit XML is a contract; CI logs are
  framework-specific prose. Parsing a contract beats scraping output.
- **No AI in the detection core.** Flakiness classification is a statistics
  problem over small, noisy samples — it must be auditable and reproducible, so
  a human can verify *why* a test was flagged. Deterministic normalization +
  transition-rate analysis is used instead. Language models are confined to the
  presentation layer (optional root-cause investigation, gated behind
  `AI_*` env).
- **Synchronous ingest with fire-and-forget scoring.** The original design
  called for a pg-boss queue + separate worker. At this scale that buys
  operational pain for nothing: the receiver verifies and acks in milliseconds,
  then parsing runs inline while scoring is scheduled asynchronously. All writes
  are idempotent (upserts + unique constraints), so the queue is an easy later
  addition if throughput ever demands it.

## Known limitations

- **Fork PRs** — GitHub does not expose repository secrets to fork-triggered
  workflows, so the upload action skips cleanly in that case. Same-repo branch
  support is the v1 path.
- **Test renames/moves** — identity intentionally breaks (a "new" test is born,
  the old one decays out of the window). Auto-linking renames is a future,
  genuinely-hard matching problem.
- **Correlated failures** — one flaky helper can make many tests flicker
  together; per-test scores can overcount. Failure-signature grouping exposes
  the shared cause as partial mitigation.

Echo is a triage instrument, not a judge: it tells you *which test to fix
first* and *why*, then gets out of the way.
