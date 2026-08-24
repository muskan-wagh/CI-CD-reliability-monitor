# Echo

**Every failure leaves a signal.**

Echo is a CI/CD reliability monitor: it ingests JUnit reports and GitHub
workflow events, fingerprints failures, scores test flakiness deterministically,
investigates root causes with AI, and reports back via dashboard, PR comments,
and issues.

- `npm run dev` — start the API (repo root)
- `npm run demo` — seed deterministic demo data (requires the API running)
- `npm run db:status` — inspect stored rows
- `cd web && npm run dev` — start the dashboard

See `.env.example` for required configuration.
