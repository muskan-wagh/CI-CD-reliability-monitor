# Echo demo

A self-contained, deterministic flaky-test demo you can drop into any
repository to verify an Echo installation end to end.

## What it does

- `flaky-tests.mjs` — writes a `junit.xml` report where `testLogin` fails
  whenever the GitHub run number is a multiple of 3 (pass/pass/fail/pass/pass…),
  which is the canonical flaky pattern. No randomness, no sleeps.
- `.github/workflows/echo-demo.yml` — runs that script and uploads the report
  to Echo via the published action.

## Use in another repository

1. Copy these two files into the target repo, keeping their paths:
   - `demo/flaky-tests.mjs`
   - `.github/workflows/echo-demo.yml`
2. In the target repo's **Settings → Secrets and variables → Actions**, add:
   - `vars.ECHO_API_URL` → your Echo API base URL (e.g. `https://<service>.onrender.com`)
   - `secrets.ECHO_API_KEY` → the per-installation ingest API key (shown once on
     the Echo dashboard under the installation).
3. Trigger the workflow with a push to `main`, or run it manually N times:

   ```bash
   gh workflow run echo-demo.yml
   ```

   The outcome is a pure function of `GITHUB_RUN_NUMBER`, so ~10 runs produce a
   clear flaky score without any randomness.

The workflow references the action as
`muskan-wagh/CI-CD-reliability-monitor/action@v1`, so it works from any repo
once the tag is published.
