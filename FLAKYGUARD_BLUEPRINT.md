# FLAKYGUARD — Complete Technical Blueprint

> CI & Flaky-Test Intelligence — build plan for Muskan Wagh
> Read this like a design doc your senior wrote before letting you touch the codebase.
> Wherever a default assumption was rejected, it says so explicitly. The biggest one:
> **the original pipeline assumed we fetch and parse raw CI logs. We are not doing that for the MVP** — explanation in Parts 4 and 6.

---

## PART 1 — UNDERSTAND THE PROBLEM

### 1. What is a flaky test?

A **flaky test** is a test that produces *different outcomes on identical code*. Same commit, same code, same environment config — one run passes, the next fails. The failure is a property of *time and chance*, not of the code.

Formally: `outcome(commit, environment) ≠ deterministic`. A healthy test is a pure function of code + environment. A flaky test has hidden inputs: thread scheduling, wall-clock time, port availability, network latency, random seeds, leftover state.

### 2. Real examples

- **Time dependence:** `expect(formatDate(now)).toBe("2026-08-21")` — passes all day, fails at midnight or in a different timezone.
- **Race condition:** the test fires an async save and asserts immediately without awaiting; usually the write wins the race, occasionally it doesn't.
- **Test-order dependence:** test #12 mutates a shared module-level cache; run alone it passes, in the full suite it fails. Reordering tests "fixes" it — until the next reorder.
- **Port collision:** two test files both start a dev server on port 3000; parallel runners collide sporadically.
- **External dependency:** a test hits a real staging API; any network hiccup = red build.
- **Random data:** generated usernames collide with a leftover row in a shared database once every ~200 runs.
- **Floating point/locale:** `0.1 + 0.2 !== 0.3`, or `toLocaleString()` behaving differently on the CI runner's locale.

### 3. The four-way distinction (memorize this — it's the heart of the product)

| Type | Definition | Signature over time |
|---|---|---|
| **Stable test** | Passes whenever code is correct | Long PASS streaks |
| **Genuinely failing (broken)** | Deterministic failure from a real regression | Fails *every* run from some commit onward |
| **Flaky** | Nondeterministic outcome on identical code | Alternating/random PASS↔FAIL |
| **Infrastructure failure** | The test never really ran — runner OOM'd, npm install failed, checkout timed out | Fails *before* test execution |

The critical insight: **a broken test and a flaky test can both have a 50% failure rate**, but they look completely different in sequence. Broken = `FAIL FAIL FAIL FAIL`. Flaky = `PASS FAIL PASS FAIL PASS`. This is why FlakyGuard stores *ordered outcomes*, not just counts. Most naive tools only store counts. That's the gap.

Infra failures must be **excluded** from flake math entirely — a network outage failing 400 tests at once says nothing about those tests. (Detection heuristic for later: one run where >50% of tests fail simultaneously = infra event, quarantine the whole run.)

### 4. Why flaky tests are dangerous

1. **Trust erosion → alert fatigue.** Once a team learns "red CI is usually a flake," they stop taking red CI seriously — and then *real* regressions get merged behind a green-by-rerun build.
2. **Masking real bugs.** A flaky test that fails 20% of the time will eventually fail on the exact commit that broke something, and everyone clicks "rerun."
3. **Compounding time tax.** 10-minute pipeline × 2 extra reruns × 30 developers × every day. This is measurable money.
4. **They encode production bugs.** A race condition in a test is often a race condition in the product, caught early for free. Deleting the test deletes the warning.

### 5. Why developers rerun CI until green

Because the incentive gradient points there. A red X blocks the merge. The fastest legal path to green is "Re-run failed jobs." Nobody is punished for rerunning; investigating a flake costs an hour with no visible reward. Rerunning is individually rational and collectively catastrophic. **FlakyGuard's real product is information: it converts "is this red thing my fault?" from a 30-minute investigation into a glance.**

### 6. Why GitHub Actions alone doesn't solve it

Actions is *stateless across runs*. It knows: this run failed, these jobs failed, here are logs. It has **no memory** — no per-test history, no cross-run statistics, no notion of "this test has failed 14 of the last 60 times." Logs also expire (default 90 days), and there's no API-level concept of "test" at all — only jobs and steps and exit codes. GitHub gives you raw material; the intelligence layer doesn't exist. That layer is FlakyGuard.

### 7. How companies deal with it today

- **Google/Meta-scale:** internal systems that track per-test outcomes, auto-quarantine flaky tests, and file bugs with attribution. Google published a famous paper on this ("Flaky Tests at Google and How We Mitigate Them"). Nobody outside gets the tooling.
- **Paid SaaS:** BuildPulse, Trunk Flaky Tests, Datadog Test Optimization — enterprise pricing, closed source.
- **DIY:** cron scripts grepping JUnit files, spreadsheets, tribal knowledge ("oh yeah, that test, just rerun").
- **Suppression:** `jest.retryTimes()`, `pytest-rerunfailures` — auto-retry failing tests inside the run. This *hides* flakes rather than fixing them and silently inflates CI time.

### 8. What existing tools do

Ingest test results per run → build per-test history → compute failure rates/transitions → rank flakiest tests → integrate with CI to comment or gate. That's the genre. The good ones also detect *newly* flaky tests (regression detection) and attribute failures to commits.

### 9. Why FlakyGuard is still worth building

Brutally honest framing, two layers:

- **As a product:** free, self-hostable, OSS-friendly, cross-framework via JUnit XML, zero-config GitHub App install. There's room, but you will not out-feature Trunk. Accept this.
- **As a portfolio project (the actual goal):** it forces you through webhook security, idempotent ingestion, background processing, statistical modeling, schema design, and multi-tenant authorization — with a demo every engineer instantly understands. The value is the engineering scar tissue, and it's fully intact whether or not anyone installs it.

### 10. Realistic scenario

Five-person startup. For three weeks, `payments/refunds.test.ts > "refunds a user after dispute"` fails roughly every third run. Devs rerun twice a day; yesterday Priya's legitimate bug sat unnoticed for four hours behind two flake-reruns. They install FlakyGuard (two clicks) and add one workflow step. After a week the dashboard shows that test at score 71, CRITICAL, with a sparkline of alternating outcomes and three failure messages all normalizing to one signature: `Timeout: Exceeded 5000ms waiting for promise`. On the next PR touching `payments/`, FlakyGuard comments: *"⚠️ 2 tests in your diff area are flaky (score 71)."* They find the unawaited promise, fix it, and over the next two weeks the score decays to 0. Total engineer-hours spent: ~2, versus ~1 hour/week forever before.

---

## PART 2 — WHAT EXACTLY ARE WE BUILDING?

**One sentence:** FlakyGuard is a GitHub App that collects structured test results from your CI runs, builds per-test history, statistically identifies flaky tests, and surfaces them on a dashboard and in PR comments.

| Question | Answer |
|---|---|
| Who uses it? | Maintainers/teams who install the GitHub App on their repos |
| What do they install? | (1) The GitHub App (OAuth click), (2) one workflow step that uploads JUnit XML after tests run |
| What does it receive? | Webhooks (`installation.created/deleted`, `workflow_run.completed`) + JUnit XML pushed by our GitHub Action |
| What does it store? | Normalized per-test outcomes, failure fingerprints, computed scores, installation/repo metadata |
| What does it calculate? | Canonical test identities, failure fingerprints, rolling-window flake scores (0–100), broken-vs-flaky classification |
| What does the user see? | Dashboard: flakiest-tests leaderboard, per-test outcome timeline; later: PR comments |
| What action follows? | Fix the test, quarantine it, ignore/mute it, or blame the right commit with confidence |

### The complete user journey, arrow by arrow

```
Developer pushes commit
   │  (1) git push
   ▼
GitHub schedules a Workflow Run
   │  (2) Actions spins up a runner, executes jobs/steps,
   │      test framework writes junit.xml
   ▼
flakyguard-action step (if: always())
   │  (3) HTTPS POST: junit.xml + run metadata + API key → FlakyGuard /v1/ingest
   ▼
Webhook Receiver (Fastify)
   │  (4) verifies HMAC, checks delivery-id dedupe, INSERTS job into pg-boss, returns 202
   │      GitHub simultaneously sent workflow_run.completed → same receiver → another job
   ▼
Worker (background process)
   │  (5) picks job → parses XML → normalizes → computes identity + fingerprints
   │  (6) INSERTS test_results / failure_signatures (idempotent upserts)
   │  (7) enqueues scoring job for affected tests
   ▼
Scoring job
   │  (8) loads last ≤30 outcomes per test → computes score → UPSERTS flake_scores
   │  (9) if threshold crossed && run came from a PR → enqueue annotation job
   ▼
Annotation job (P1)
   │  (10) mints installation token → resolves PR from head SHA → creates/updates comment
   ▼
PostgreSQL  ◄── (11) Next.js dashboard reads via REST ──► Developer sees leaderboard + PR comment
```

Every arrow is either **HTTP with authentication** (3, 10, 11), **HMAC-verified webhook** (2→4), or **queue-mediated async work** (4→10). Arrow 4 returning `202` in milliseconds is deliberate: GitHub times out slow receivers and retries, so the receiver's only jobs are *verify, dedupe, enqueue, ack*.

---

## PART 3 — WHY A GITHUB APP?

### 1. What is a GitHub App?

A first-class *integration identity* on GitHub that you own. Users "install" it on their repos; it then acts within those repos with exactly the permissions you declared (e.g., "Pull requests: write"), as itself — not as any human. It has an App ID, a private key you hold, a webhook configuration, and per-installation access.

### 2. Why not a Personal Access Token (PAT)?

| | PAT | GitHub App |
|---|---|---|
| Belongs to | Your personal user | Your integration |
| Scope | All repos that user can access | Only repos explicitly installed |
| Permissions | Coarse (full `repo` scope) | Fine-grained (PRs:write, no code access) |
| Token lifetime | Static, essentially forever | 1 hour, minted on demand |
| Lifecycle awareness | None | `installation.created/deleted` events |
| Rate limits | Shared with the user | Per-installation budget |
| Multi-tenant ready | No | Yes — this is the killer feature |

A PAT means every customer trusts *you personally* with a master key. An App means access is revocable, scoped, and auditable. Building on a PAT would also undermine the project's own pitch (multi-tenant security).

### 3. What is an installation?

One grant of your app to one account (user or org), covering selected repositories. Installing on 3 repos = 1 installation with 3 repos. Uninstall = `installation.deleted` webhook → you must stop processing that tenant's data. `installation_id` is your **tenant key** throughout the system.

### 4. What is an installation token?

The short-lived credential your server uses to call the GitHub API *as the app, within one installation*. Minting flow:

1. Build a JWT signed with the app's **private key** (RS256), claims: `iss = app_id`, `iat`, `exp` (≤10 min).
2. `POST /app/installations/{installation_id}/access_tokens` with that JWT.
3. Receive a token valid **1 hour**, scoped to that installation's permissions.

So the auth chain is: **private key → JWT → installation token → API call.** Three levels, each narrower than the last. Learn this cold — it is a guaranteed interview question.

### 5. What is a webhook?

GitHub's HTTP push mechanism: when an event happens, GitHub POSTs a JSON body to your registered URL with headers including `X-GitHub-Event` (type), `X-GitHub-Delivery` (unique GUID per delivery), and `X-Hub-Signature-256`.

### 6. Events we need

- `installation.created` — provision tenant, generate ingest API key.
- `installation.deleted` — deactivate tenant, halt processing.
- `workflow_run.completed` — run finished; enrich/trigger processing (and later, PR resolution).

That's it. Resist `*` (all events) — it's noise and a security smell.

### 7. What GitHub sends (annotated real shape)

```jsonc
// POST https://your-host/webhooks/github
// Headers: X-GitHub-Event: workflow_run
//          X-GitHub-Delivery: 72d3162e-cc78-11e3-81ab-4c9367dc0958
//          X-Hub-Signature-256: sha256=b1c8...
{
  "action": "completed",
  "workflow_run": {
    "id": 9756363321,              // ← foreign key to everything about this run
    "run_attempt": 1,               // ← reruns increment this; key part of identity
    "event": "pull_request",        // what triggered the workflow
    "status": "completed",
    "conclusion": "failure",        // success | failure | cancelled | ...
    "head_branch": "feat/refunds",
    "head_sha": "d6f3c44...",       // ← how we later find the PR
    "repository": { "id": 881234, "full_name": "acme/payments-api" },
    "created_at": "2026-08-21T10:02:11Z",
    "updated_at": "2026-08-21T10:07:43Z"
  },
  "installation": { "id": 51200987 },   // ← tenant
  "sender": { "login": "priya" }
}
```

Known gotcha worth knowing before it bites you: `workflow_run.pull_requests[]` is **frequently empty** (notably for fork PRs). Resolve PRs via the commit SHA endpoint instead (`GET /repos/{o}/{r}/commits/{sha}/pulls`). Cite this in your README; seniors love this detail.

### 8–9. Verification / signature verification

Anyone can find your public webhook URL and POST fake "successful" payloads. GitHub signs each delivery: `X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(rawBody, webhookSecret)`.

**HMAC (Hash-based Message Authentication Code):** a hash that mixes a secret key into the computation, so only someone holding the secret can produce a matching tag for a given payload. It proves both *authenticity* (sender knows the secret) and *integrity* (body wasn't tampered with).

Implementation rules that matter:

1. Hash the **raw request body** — the exact bytes. If you `JSON.parse` then re-serialize, key order/whitespace changes and verification fails. (Express/Fastify: grab the raw body via a hook.)
2. Compare with a **timing-safe** comparison (`crypto.timingSafeEqual`). Naive `===` leaks match-length/prefix info through timing.
3. Reject without a signature header (some clients omit it; GitHub never does).

```ts
import crypto from "node:crypto";
export function verifyGithubSignature(rawBody: Buffer, header: string | undefined, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### 10–12. Duplicates and idempotency

GitHub webhook delivery is **at-least-once**: if your server returns a non-2xx (or times out ~10s), GitHub retries with backoff for hours. Network blips can also double-deliver. So duplicates are *normal*, not exceptional.

**Idempotency** = performing the same operation twice produces the same result as once. Layers we implement (defense in depth):

1. **Delivery dedupe:** `webhook_deliveries.delivery_id` PRIMARY KEY. Insert first; on conflict, skip. One row per delivery = perfect audit trail *and* dedupe in one constraint.
2. **Job-level keys:** pg-boss supports deduplication keys per job.
3. **Database constraints (final boss):** `UNIQUE(repository_id, github_run_id, run_attempt)` on runs and `UNIQUE(test_id, workflow_run_id, ...)` on results mean even a totally buggy double-process physically cannot create duplicate rows. Upserts (`ON CONFLICT DO NOTHING/UPDATE`) make reprocessing harmless.

Rule to internalize: **unique constraints are your last-line idempotency; application checks are just optimization.**

---

## PART 4 — COMPLETE SYSTEM ARCHITECTURE

```
                        ┌──────────────────── FlakyGuard (ONE Node.js codebase) ─────────────────────┐
                        │                                                                             │
 GitHub ──webhook──────►│  [A] Webhook Receiver (Fastify)      [B] pg-boss queue (tables in Postgres) │
 Action ──POST /v1/ingest►│   verify · dedupe · enqueue · 202    jobs: process-ingest | enrich-run     │
                        │                                       score | annotate                      │
                        │        [C] Worker process(es) ── consumes ┘                                  │
                        │          [D] Parser → [E] Normalizer → [F] Fingerprinter → [G] Scorer       │
                        │                          │                                                  │
                        │                     [H] PostgreSQL (Supabase or local Docker)               │
                        │                          ▲                                                  │
                        │        [I] REST API (same Fastify app)                                      │
                        └──────────────────────────┼──────────────────────────────────────────────────┘
                                                   ▼
                                     [J] Next.js Dashboard (Vercel)
```

Deliberately **one backend service, two entrypoints** (api, worker) sharing `packages/core` and `packages/db`. Not microservices. Justification: your scale is thousands of events/day; a second deployable buys you nothing but operational pain.

| Component | Responsibility | Input → Output | Sync? | Failure cases | Why it exists |
|---|---|---|---|---|---|
| **A. Receiver** | Trust boundary. Verify HMAC, dedupe by delivery id, validate API key on ingest, enqueue, respond fast | HTTP → queue job | **Sync** (must ack <10s) | Bad signature → 401; DB down → 500 (GitHub retries); slow → timeout storms | Isolates "accept bytes" from "understand bytes"; keeps GitHub happy |
| **B. pg-boss** | Durable job storage, retries, concurrency control | Jobs → jobs | Async | Table bloat (archive old jobs) | Decouples intake from processing; absorbs bursts; survives crashes |
| **C. Worker** | Executes jobs | Job → side effects + DB rows | Async | Crash mid-job → pg-boss expires & retries → **handlers must be idempotent** | Retryable, scalable (run N containers), isolates slowness from the receiver |
| **D. Parser** | JUnit XML → structured records | XML string → `{tests: [...]}` | Inside worker job | Malformed XML, huge files, encoding | Converts vendor chaos into one internal shape |
| **E. Normalizer** | Stable identity + cleaned failure text | Raw record → identity fields + normalized message | Same | Weird paths, parameterized names | Everything downstream depends on stability of these outputs |
| **F. Fingerprinter** | Group same-root-cause failures | Normalized msg → hash | Same | Over/under-grouping | Enables "this one bug broke 12 tests" views |
| **G. Scorer** | Math: flake score, category | Outcome history → score row | Async, debounced per test | Insufficient data, stale windows | The product's brain |
| **H. Postgres** | Source of truth + queue storage | SQL | — | Connection limits (Supabase free ≈ 60), pausing on free tier | Relational fit: results×tests×runs is inherently relational |
| **I. REST API** | Authenticated reads for dashboard | Session → JSON | Sync | Tenant leakage (see Part 17) | Keeps the frontend dumb |
| **J. Dashboard** | Decision surface | — | — | — | Where the value becomes visible |

**Explicitly NOT building initially:** realtime websocket updates (polling is fine), log storage/search UI, GitLab/Bitbucket support, ML anything, billing/SSO, public API, mobile anything, Kubernetes.

### The rejected alternative — and why (interview gold)

The original instinct was: webhook → download job logs via GitHub API → grep test results. Rejected for MVP:

1. **Log format is whatever the framework prints** — ANSI codes, progress bars, truncated output, reporter-dependent. You'd be writing a fragile N-framework log parser.
2. **Cost:** downloading logs for every job burns your per-installation rate limit for zero informational gain.
3. **Determinism:** a JUnit file uploaded by our own action is a *contract*. Parsing a contract beats scraping prose.

We keep webhooks for lifecycle + enrichment, and get results via a 20-line GitHub Action. Log-parsing becomes a documented future feature ("zero-config mode"). Knowing what *not* to parse is senior judgment.

---

## PART 5 — BACKGROUND JOBS (taught from zero)

**Synchronous processing:** the HTTP handler does all the work before responding. Problem: parsing a 5MB XML takes seconds; GitHub's webhook timeout is ~10s; one slow request blocks a server slot; a crash loses the work with no record.

**Asynchronous processing:** the handler does the minimum (validate + persist an intent) and responds; the actual work happens in another process, later.

**Queue:** a durable, ordered list of work items persisted in a database. Key property vs an in-memory array: it **survives crashes**. If the worker dies mid-job, the job is still there.

**Worker:** a loop: pick unclaimed job → execute → mark done, repeated forever. Multiple workers run concurrently; the DB's locking ensures each job is claimed by exactly one.

**Retries:** if a job throws, the queue marks it failed and reschedules with increasing delay (**exponential backoff**: 10s, 60s, 5m…). After N attempts → dead-letter (parked for inspection). Why backoff: if GitHub's API is down, hammering it every second makes things worse.

**Idempotency (again, because it's THE concept of this project):** retries mean every job may run more than once. Handlers must tolerate that — via unique constraints and upserts, never blind INSERTs.

### Walkthrough: `"GitHub sends workflow_run.completed"`

1. `POST /webhooks/github` hits the receiver. HMAC verifies. `delivery_id` inserted into `webhook_deliveries` — conflict → return 200, done (duplicate).
2. Receiver extracts `{installation_id, repo, run_id, attempt, sha, branch, conclusion}` and enqueues job `enrich-run`. Responds `200`. Elapsed: ~15ms.
3. Worker claims `enrich-run`: upserts the `workflow_runs` row (conclusion, timestamps). If an ingest for this `(run_id, attempt)` already arrived, marks run complete; otherwise notes "results pending."
4. Separately, the action's `POST /v1/ingest` enqueued `process-ingest` with the XML. Worker parses → inserts results → enqueues `score` jobs (deduplicated by key so many changed tests = one batched job).
5. Scorer recomputes, writes `flake_scores`, maybe enqueues `annotate`.
6. Any step throws (GitHub 500, DB blip) → pg-boss retries with backoff → eventually dead-letters with the error attached. Nothing is silently lost.

### Queue technology comparison

| | pg-boss (Postgres) | BullMQ (Redis) | RabbitMQ | Kafka |
|---|---|---|---|---|
| Extra infrastructure | **None** (it's tables) | Redis server | Erlang broker | ZooKeeper/KRaft cluster |
| Transactional with business data | **Yes** — insert results + enqueue in ONE transaction | No (dual-write problem) | No | No |
| Throughput | ~hundreds/sec | tens of thousands/sec | tens of thousands/sec | millions/sec |
| Ops burden | Zero new | Low-medium | Medium | High |
| Delayed/retry jobs | Built-in | Built-in | Plugin | Manual |
| Fit for FlakyGuard | ✅ perfect | fine but unnecessary | absurd overkill | comical overkill |

**Decision: pg-boss.** Reasons: (1) volume is trivial; (2) **atomicity** — "store these 100 results AND schedule scoring" succeeds or fails together, eliminating dual-write inconsistency bugs; (3) one fewer service to secure/monitor/pay for; (4) you can inspect the queue with SQL, which accelerates learning. Redis+BullMQ is right at 100× our scale — saying exactly that in an interview demonstrates judgment.

Under the hood (read the source later): pg-boss claims jobs with `FOR UPDATE SKIP LOCKED` — a Postgres feature where concurrent readers skip rows already locked by others, giving safe work-stealing without coordination. That one clause powers half the job systems on earth.

---

## PART 6 — GITHUB ACTIONS DEEP DIVE

### The hierarchy

```
Repository  acme/payments-api
└─ Workflow       .github/workflows/ci.yml  (a file; triggered by events: push, pull_request, schedule...)
   └─ Workflow Run     one execution instance → id, run_attempt 1, 2, 3 (reruns!)
      └─ Job            a VM (runner); a matrix (node 18/20/22) fans out to multiple jobs
         └─ Step        one shell command or one `uses:` action; steps share the workspace
            └─ Tests    processes run inside steps; GitHub sees only the EXIT CODE
```

Crucial mental model: **GitHub Actions does not know tests exist.** It knows jobs passed (exit 0) or failed (≠0). "Test results" are a convention we impose via JUnit XML.

### The questions

- **How do we know a workflow finished?** Either the `workflow_run.completed` webhook (preferred, instant) or polling `GET /repos/{o}/{r}/actions/runs/{id}` until `status === "completed"`.
- **How do we know it failed?** `conclusion`: `success | failure | cancelled | timed_out | ...`. Note `cancelled` ≠ failure — exclude from flake math.
- **How do we retrieve logs?** `GET .../actions/runs/{id}/logs` (302 → zip) or per-job. **We deliberately don't, for MVP** (Part 4).
- **How do we retrieve test results?** We don't fetch them — our action ships them to us.
- **What is JUnit XML?** The de-facto universal test-report format, descended from Java's Ant/JUnit. Every serious framework emits it:

```xml
<testsuites name="vitest" tests="3" failures="1" time="4.21">
  <testsuite name="tests/auth.test.ts" tests="3" failures="1" errors="0" skipped="0" time="1.02">
    <testcase classname="tests/auth.test.ts" name="login accepts valid credentials" time="0.31"/>
    <testcase classname="tests/auth.test.ts" name="login rejects bad password" time="0.22">
      <failure message="Expected: 401 Received: 500" type="AssertionError">
        at Object.&lt;anonymous&gt; (/home/runner/work/repo/tests/auth.test.ts:42:11)
      </failure>
    </testcase>
    <testcase classname="tests/auth.test.ts" name="rate limit blocks 6th attempt" time="0.19">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>
```

- **Why JUnit XML?** One parser → Jest, Vitest, pytest, Go (gotestsum), JUnit, xUnit. Reporters are battle-tested; we inherit their edge-case handling instead of writing N scrapers.
- **Can our frameworks produce it?** Yes: `jest-junit`, Vitest's built-in `junit` reporter, `pytest --junitxml=out.xml`. Usually one line of config.
- **Why JUnit-only initially?** Because supporting "everything" is how student projects die. One format done excellently, with a documented extension point, beats five formats done badly.

### Reference workflow (also the demo repo's workflow)

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx vitest run --reporters=junit --outputFile=junit.xml
        # continue past failures so the upload step still runs
      - name: Upload results to FlakyGuard
        if: always()                      # ← critical: upload even when tests fail
        uses: flakyguard/action@v1
        with:
          report-path: junit.xml
          api-url: https://api.flakyguard.example
          api-key: ${{ secrets.FLAKYGUARD_API_KEY }}
```

`if: always()` is the difference between learning about failures and only ever seeing successes. Fork-PR caveat (expert detail): secrets are **not available to workflows triggered by PRs from forks** — FlakyGuard v1 documents same-repo branch support; fork support comes later via the artifact-download path.

---

## PART 7 — TEST RESULT PARSING

Pipeline: `XML string → fast-xml-parser (non-strict, huge-file-capped) → walk testsuite/testcase nodes → internal record`.

Internal record — the ONLY shape the rest of the system knows:

```ts
interface ParsedTest {
  filePath: string;        // normalized, repo-relative, forward slashes
  suitePath: string;       // describe-chain or classname, ">"-joined
  name: string;            // leaf test title
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  failureMessage?: string; // truncated to 2000 chars
  errorClass?: string;     // AssertionError, TimeoutError, text-before-colon, else "Unknown"
  topFrame?: string;       // first stack frame, normalized
}
```

Framework mapping (all three land in the same shape):

| Framework | classname/source | name | Notes |
|---|---|---|---|
| **Jest** (jest-junit) | relative file path, e.g. `tests/auth.test.ts` | full title incl. describe nesting (`Auth login rejects bad password`) | split nesting heuristically or store whole chain as suitePath |
| **Vitest** (junit reporter) | file path | test title (suite prefix configurable) | cleanest citizen |
| **pytest** (--junitxml) | dotted module: `tests.auth_test` | `test_login[case-empty]` | convert dots→path best-effort; bracket suffix = parameterization (Part 8) |

**Keep:** identity fields, status, duration, failure message (truncated), error class, top stack frame, run/attempt linkage, timestamp.
**Discard:** `system-out`/`system-err` dumps (huge, noisy, privacy-leaky), full stack traces beyond the top frame, environment metadata, absolute paths (normalized away), sub-second timing noise beyond durationMs.

Parsing rules that save pain: strip ANSI escape codes *first*; handle self-closing `<testcase/>` (passed); treat `errors>0` as failed; cap input at ~10MB and stream-reject bigger; never trust `time` attributes to be seconds (some tools emit milliseconds — normalize defensively and document).

---

## PART 8 — TEST IDENTITY (the quiet hardest problem)

**The question:** how do we know `testLogin()` from yesterday is the same test today?

Answer: identity must be built from things that are *stable across runs but specific across tests*. Evaluate each candidate:

| Signal | Stable? | Verdict |
|---|---|---|
| Repo-relative file path | ✅ unless moved | **Use** (normalize `\`→`/`, strip cwd/runner prefixes) |
| Describe/suite chain | ✅ unless refactored | **Use** |
| Test name | ✅ unless renamed | **Use** |
| Line number | ❌ shifts with any edit above | **Exclude** — the #1 amateur mistake |
| Duration/timestamps | ❌ | Exclude |
| Absolute runner paths (`/home/runner/work/...`) | ❌ machine-specific | Normalize away |
| Browser/device matrix dimensions | semi | Later concern; fold into suite suffix if needed |

**Canonical identity string:** `filePath + "»" + suitePath + "»" + name`, hashed with SHA-256 → `identity_hash`. Store the *components as columns too* — hash for joins/uniqueness, components for humans and future rename-detection.

**Parameterized tests** (`login validates [case=empty]`, `test_login[admin]`): each case gets its own identity (they genuinely behave differently), but we also derive a **parent identity** by stripping the bracket suffix, enabling rollups: "the login test family is flaky." Implemented as a nullable `parent_hash` column.

**Renames/moves:** identity intentionally breaks (new test born, old goes stale and decays out of windows). Auto-linking renames is a genuinely hard matching problem — document as a known limitation with a future idea (similarity on path+name). Documenting limitations honestly is a senior signal; pretending you solved everything is a junior one.

**Normalization ladder** (applied to failure text, and partially to identity):

```
1. strip ANSI escapes                \x1b\[...m        → ""
2. absolute paths → repo-relative    /home/runner/work/x/y/tests/a.ts → tests/a.ts
3. temp dirs                         /tmp/xyz831/, C:\Users\RUNNER~1\AppData\Local\Temp\abc → <TMP>
4. UUIDs                             [0-9a-f]{8}-[0-9a-f]{4}-... → <UUID>
5. long hex hashes                   [0-9a-f]{16,} → <HASH>
6. integers ≥ 3 digits (configurable) 98231 → <N>        (keep 404, 500, 2xx-class codes!)
7. quoted strings                    "req_abc123" → "<S>"
8. ISO timestamps / epoch millis     → <TS>
9. collapse whitespace
```

Step 6 is deliberately conservative: status codes and small numbers are semantically load-bearing (`expected 404 but received 500` must NOT become `expected <N> but received <N>` — that would erase the actual bug signal). Threshold ≥3 digits keeps `404` intact while crushing `98231`.

**Worked example:**

Raw: `/home/muskan/project/tests/auth.test.js:183 expected request-98231 but received request-73192`

- Identity extraction: path → `tests/auth.test.js` (line `:183` dropped — identity never includes lines).
- Message normalization: `expected request-<N> but received request-<N>`
- Fingerprint = SHA-256(normalizedMessage + topFrame) — tomorrow's `request-55123` failure lands in the *same* bucket; a genuinely different assertion (`expected 201 but received 500`) lands elsewhere.

---

## PART 9 — FAILURE FINGERPRINTING

**What:** a stable key grouping failures that share a root cause. **Why:** one race condition manifests as 12 different test failures; without grouping, the dashboard screams "12 problems" and humans tune out. With grouping: "1 signature, 12 tests affected, first seen after commit `d6f3c44`" — an actionable sentence.

**Test A (db timeout) vs Test B (db timeout): same fingerprint?** Yes — *deliberately*. The fingerprint describes the **cause**, not the victim. Storage models it many-to-many: each failing result points at a signature; a signature aggregates its affected tests. Both views matter: "which tests suffer from this?" and "why does this test keep failing?" (its signature history).

**Approaches compared:**

| Approach | Idea | Pros | Cons | Verdict |
|---|---|---|---|---|
| Exact hash of raw message | hash as-is | trivial | any number/timestamp splits the group — useless | ❌ |
| **Normalized hash** | Part-8 ladder → SHA-256 | deterministic, free, debuggable, explainable | regex maintenance; near-duplicates with different wording split | ✅ **MVP** |
| SimHash/MinHash | locality-sensitive hashing → near-duplicate texts cluster | catches fuzzy variants | tuning, false positives, harder to explain | later, if fragmentation measured |
| Embeddings | semantic similarity | groups "connection refused" with "could not connect" | cost, model-version drift, **nondeterminism**, wrong groupings destroy trust, unexplainable in a debug conversation | ❌ not MVP |

**Why not embeddings (the honest interview answer):** fingerprinting is a *trust* component — when FlakyGuard says "these 12 failures are the same," a human will check. A deterministic hash can be *debugged* ("here's the exact normalization that produced this key"); an embedding cannot. Semantic recall gains a few percent grouping accuracy and costs determinism, money, and explainability. If measurement later shows normalized-hash groups fragmenting badly (>N singleton signatures per repo), *that metric* is the trigger to revisit — not hype.

MVP fingerprint = SHA-256(`errorClass + "\n" + normalizedMessage + "\n" + topFrame`), store a 16-byte hex prefix + the normalized sample text for display.

---

## PART 10 — WHAT MAKES A TEST "FLAKY"? (the mathematics)

Given an ordered outcome sequence per test (oldest→newest), candidate signals:

1. **Failure rate** `r = fails / n` over a window. Necessary but insufficient — a *broken* test also has high `r`.
2. **Transition rate** `tr = #(adjacent PASS↔FAIL pairs) / (n−1)`. The key discriminator: flaky = many transitions; broken = one long FAIL streak with ~1 transition. This single idea separates the two pathologies naive tools conflate.
3. **Rolling window** (last N=30): recent behavior dominates; ancient history shouldn't haunt a fixed test.
4. **Minimum sample size** (n ≥ 8): below that, percentages are theater. 1 fail in 2 runs ≠ 50% flaky in any meaningful sense.
5. **Confidence:** report the **Wilson score interval** lower bound on `r` — a proportion estimate that stays sane at small n (unlike raw percentages). Display it; don't pretend certainty.
6. **Recency weighting:** exponential decay λ=0.9 so last week outweighs last month.
7. **Consecutive-failure override:** trailing streak ≥5 FAILs ⇒ label **BROKEN** regardless of score — a flaky test failing 5 straight is possible but unlikely; a broken test failing 5 straight is certain.
8. **Duration anomalies:** p95 ≫ median hints at performance flakes — track, display, don't score in v1.

### The MVP formula

```
Window W = last n results (n ≤ 30). Require n ≥ 8, else category = INSUFFICIENT_DATA.

r    = (#FAIL in W) / n                                   // failure rate
tr_w = Σ λ^(age_i) · transition_i  /  Σ λ^(age_i)         // recency-weighted transition rate, λ = 0.9
       (age 0 = newest boundary; denominator = weighted count of all boundaries)

raw   = 0.7 · tr_w  +  0.3 · min(r / 0.5, 1)              // r contribution capped at r=0.5
score = round(100 · raw)                                  // 0–100

if trailing consecutive FAILs ≥ 5 → category = BROKEN (score still shown)
else categorize: 0–9 STABLE · 10–29 WATCH · 30–59 FLAKY · 60–100 CRITICAL
```

Variable rationale: `tr_w` carries the flake signal (weight 0.7); `r` adds "how often is it even red" but is **capped at r=0.5** so a permanently-dead test can't ride the failure term to a maximal *flake* score — being consistently broken is a different disease than flakiness. λ=0.9 means a transition 10 runs ago weighs ~0.35 vs 1.0 for the newest.

**Worked example — sequence `P P F P P F P P P F` (n=10):**
- `r = 3/10 = 0.3`
- Transitions at boundaries 1,2,4,5,8 → unweighted `tr = 5/9 ≈ 0.556`; λ-weighted `tr_w ≈ 0.554`
- `raw = 0.7(0.554) + 0.3(min(0.3/0.5,1)=0.6) = 0.388 + 0.180 = 0.568`
- **Score ≈ 57 → FLAKY.** Streak = 1 → not BROKEN. ✔ Matches intuition perfectly.

Sanity checks: 30×PASS → 0 STABLE. Perfect alternation → ~100 CRITICAL. 27×PASS then 3×FAIL → ~12 WATCH (early warning, correctly timid), escalating to BROKEN at streak 5. One ancient fail among 30 passes → ~5 STABLE. The formula behaves.

**Why this is not mathematical certainty (say this proactively):** code changes make history non-stationary (a "fixed" test's old failures are noise); failures correlate (one flaky auth mock makes 8 auth tests flicker together — individually they look flaky, really one root cause); samples are small; we're running many implicit hypotheses. Therefore: minimum-sample gates, Wilson bounds, conservative thresholds, and human confirmation via fix/quarantine. FlakyGuard is a **triage instrument**, not a judge — articulating that boundary is precisely what makes the project credible.

---

## PART 11 — DATABASE DESIGN

Design principles: raw facts are immutable and append-only; computed values (`flake_scores`) are disposable caches, always rebuildable from facts; GitHub IDs are `bigint` (int64); all times `timestamptz`; every tenant-scoped table carries `repository_id` for the security filter (Part 17).

```sql
CREATE TYPE test_status    AS ENUM ('passed','failed','skipped');
CREATE TYPE flake_category AS ENUM ('insufficient','stable','watch','flaky','critical','broken');

-- ── Tenancy ────────────────────────────────────────────────────────────
CREATE TABLE installations (
  id              BIGINT PRIMARY KEY,          -- GitHub installation_id (GitHub's own id: idempotent across reinstalls)
  account_login   TEXT NOT NULL,
  account_type    TEXT NOT NULL,               -- 'User' | 'Organization'
  status          TEXT NOT NULL DEFAULT 'active',   -- active | removed
  installed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at      TIMESTAMPTZ
);

CREATE TABLE repositories (
  id              BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL REFERENCES installations(id),
  github_repo_id  BIGINT NOT NULL UNIQUE,      -- GitHub's repo id: survives renames
  full_name       TEXT NOT NULL,               -- 'acme/payments-api' (display; may go stale on rename)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_repos_installation ON repositories(installation_id);

CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id BIGINT NOT NULL REFERENCES installations(id),
  key_hash        TEXT NOT NULL UNIQUE,        -- sha256(key); plaintext NEVER stored, shown once at creation
  label           TEXT NOT NULL DEFAULT 'default',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);

-- ── Facts: runs & results ─────────────────────────────────────────────
CREATE TABLE workflow_runs (
  id              BIGSERIAL PRIMARY KEY,
  repository_id   BIGINT NOT NULL REFERENCES repositories(id),
  github_run_id   BIGINT NOT NULL,
  run_attempt     INT   NOT NULL DEFAULT 1,
  head_sha        TEXT NOT NULL,
  head_branch     TEXT,
  trigger_event   TEXT,                        -- push | pull_request | schedule ...
  conclusion      TEXT,                        -- success | failure | cancelled ...
  results_state   TEXT NOT NULL DEFAULT 'pending', -- pending | received | missing
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, github_run_id, run_attempt)   -- ← idempotency backbone
);

CREATE TABLE tests (
  id              BIGSERIAL PRIMARY KEY,
  repository_id   BIGINT NOT NULL REFERENCES repositories(id),
  identity_hash   TEXT NOT NULL,               -- sha256(canonical identity), 64 hex
  file_path       TEXT NOT NULL,               -- components kept for humans + future rename detection
  suite_path      TEXT NOT NULL DEFAULT '',
  name            TEXT NOT NULL,
  parent_hash     TEXT,                        -- parameterized tests → family rollup
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, identity_hash)
);

CREATE TABLE failure_signatures (
  id                BIGSERIAL PRIMARY KEY,
  repository_id     BIGINT NOT NULL REFERENCES repositories(id),
  fingerprint       TEXT NOT NULL,             -- sha256 prefix of normalized cause
  error_class       TEXT NOT NULL DEFAULT 'Unknown',
  sample_message    TEXT NOT NULL,             -- normalized, for display
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count  INT NOT NULL DEFAULT 1,
  UNIQUE (repository_id, fingerprint)
);

CREATE TABLE test_results (
  id                   BIGSERIAL PRIMARY KEY,
  test_id              BIGINT NOT NULL REFERENCES tests(id),
  workflow_run_id      BIGINT NOT NULL REFERENCES workflow_runs(id),
  status               test_status NOT NULL,
  duration_ms          INT,
  failure_signature_id BIGINT REFERENCES failure_signatures(id),  -- NULL unless failed
  source_job_name      TEXT NOT NULL DEFAULT 'test',  -- matrix legs upload separately
  executed_at          TIMESTAMPTZ NOT NULL,          -- from run, NOT arrival time (order safety)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, workflow_run_id, source_job_name)    -- ← reprocessing-safe
);
-- The two indexes that carry 95% of query traffic:
CREATE INDEX idx_results_test_time ON test_results(test_id, executed_at DESC);
CREATE INDEX idx_results_run       ON test_results(workflow_run_id);

-- ── Computed cache ────────────────────────────────────────────────────
CREATE TABLE flake_scores (
  test_id          BIGINT PRIMARY KEY REFERENCES tests(id),   -- 1:1, upsert target
  score            INT  NOT NULL,                             -- 0–100
  category         flake_category NOT NULL,
  window_size      INT  NOT NULL,
  failure_count    INT  NOT NULL,
  failure_rate     NUMERIC(5,4) NOT NULL,
  transition_rate  NUMERIC(5,4) NOT NULL,
  wilson_lower     NUMERIC(5,4),                              -- confidence display
  previous_score   INT,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scores_category ON flake_scores(category)
  WHERE category IN ('flaky','critical');                      -- partial index: leaderboard is the hot query

-- ── Plumbing ──────────────────────────────────────────────────────────
CREATE TABLE webhook_deliveries (
  delivery_id  UUID PRIMARY KEY,             -- X-GitHub-Delivery: dedupe + audit in one constraint
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE pr_annotations (                  -- P1; defined now so schema doesn't churn
  id             BIGSERIAL PRIMARY KEY,
  repository_id  BIGINT NOT NULL REFERENCES repositories(id),
  pr_number      INT NOT NULL,
  comment_id     BIGINT NOT NULL,              -- GitHub comment id → enables UPDATE-not-spam
  body_snapshot  TEXT NOT NULL,
  posted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, pr_number)            -- ONE living report comment per PR
);
```

**Relationships:** `installation 1─N repos 1─N runs, tests, signatures`; `run 1─N results N─1 tests`; `result 0..1─1 signature`; `test 1─1 flake_score`.

Note what's absent: no `jobs` table (matrix handled by `source_job_name` — one less join until proven necessary), no log storage, no users table (dashboard auth maps to installations dynamically via the GitHub API — Part 13).

---

## PART 12 — DATA FLOW (one run, end to end)

Setup: `acme/payments-api` PR #142 runs CI: 100 tests — 95 pass, 5 fail (3 hit the same unawaited-promise timeout).

1. **Webhook in:** `workflow_run.completed` (conclusion `failure`, run 9756363321, attempt 1, sha `d6f3c44`). Receiver: HMAC ✓ → `INSERT INTO webhook_deliveries` (new delivery id ✓) → enqueue `enrich-run{installation:51200987, repo:881234, run:9756363321, ...}` → `200` in 14ms.
2. **Ingest in (parallel):** the action POSTs `junit.xml` (100 testcases) + `{github_run_id, run_attempt, head_sha, head_branch, job_name:"test"}` + API key to `/v1/ingest`. Server: hash key → lookup `api_keys` → `installation_id` → enqueue `process-ingest{batch}` → `202 Accepted {"jobId":"..."}` in 30ms.
3. **Worker: enrich-run** — `INSERT INTO workflow_runs ... ON CONFLICT (repository_id, github_run_id, run_attempt) DO UPDATE SET conclusion=..., completed_at=...` → row id 401.
4. **Worker: process-ingest** — parse XML → 100 `ParsedTest`s. For each: normalize identity → `INSERT INTO tests ... ON CONFLICT (repository_id, identity_hash) DO UPDATE SET last_seen_at=now() RETURNING id` (get-or-create). 97 known tests, 3 brand-new.
5. **Fingerprinting:** the 5 failures normalize to just 2 distinct causes → 2 signature upserts (`occurrence_count += 1`); 3 results link to signature #77 (`Timeout: Exceeded 5000ms waiting for promise`), 2 to #41.
6. **Insert results:** 100 rows into `test_results` with `executed_at` from the run's timestamps, `ON CONFLICT DO NOTHING` (safe on retry). Batched in one transaction *with* the enqueue of scoring work — atomicity courtesy of pg-boss living in the same DB.
7. **Score job(s):** for each affected test, load last ≤30 outcomes ordered by `executed_at` (index `idx_results_test_time` — this is why it exists), apply the Part-10 formula. Our villain `refunds a user after dispute`: history now `P F P P F P F ...` → score 61 → CRITICAL (was 54, FLAKY). Upsert `flake_scores` keeping `previous_score=54`.
8. **Annotation decision (P1):** score ≥ 60 ∧ crossing upward ∧ run's `trigger_event=pull_request` → resolve PR via `GET /repos/acme/payments-api/commits/d6f3c44/pulls` → #142 → enqueue `annotate`.
9. **Annotate:** mint installation token (JWT→POST access_tokens), render markdown report, create/update the single report comment (idempotent via `pr_annotations` unique row), store `comment_id`.
10. **Dashboard read:** maintainer opens `/repos/881234`: `SELECT t.*, s.* FROM flake_scores s JOIN tests t USING(test_id) WHERE t.repository_id=$1 ORDER BY s.score DESC LIMIT 50` — villain tops the list; clicking it loads history via `idx_results_test_time`; sparkline renders 30 colored squares. Total elapsed webhook→visible: ~2 seconds.

---

## PART 13 — API DESIGN

Two trust levels: **machine** (GitHub webhooks: HMAC; action ingest: API key) and **human** (dashboard: GitHub OAuth session).

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /webhooks/github` | HMAC signature | Receive events; 200 fast, always |
| `POST /v1/ingest` | `Authorization: Bearer fg_<key>` | Upload JUnit report for a run |
| `GET /api/me/installations` | session | Installations the caller may see (via GitHub `GET /user/installations`) |
| `GET /api/repos?installation=` | session | Repos for an installation |
| `GET /api/repos/:id/tests?category=flaky,critical&sort=score&q=&page=` | session+tenancy | Leaderboard |
| `GET /api/tests/:id` | session+tenancy | Detail: identity, current score, category, top signatures |
| `GET /api/tests/:id/history?limit=100` | session+tenancy | Ordered outcomes (sparkline/timeline fuel) |
| `GET /api/runs/:id` | session+tenancy | Run summary: totals, failures, signatures, ingest state |
| `GET /api/repos/:id/signatures` | session+tenancy | Cause-centric view (P1) |
| `POST /api/tests/:id/mute` | session+tenancy | P1 |

Tenancy rule enforced in middleware: `:id` of repo/test/run is resolved → its `repository_id` → its `installation_id` → membership check against the caller's installation list. **Never** filter by client-supplied ids alone.

```jsonc
// GET /api/repos/881234/tests?category=flaky,critical
{
  "data": [{
    "id": 301,
    "name": "refunds a user after dispute",
    "filePath": "tests/payments/refunds.test.ts",
    "score": 61, "previousScore": 54, "category": "critical",
    "windowSize": 30, "failureCount": 11, "failureRate": 0.37,
    "transitionRate": 0.52, "wilsonLower": 0.21,
    "lastFailedAt": "2026-08-21T10:07:43Z",
    "topSignature": { "id": 77, "errorClass": "TimeoutError",
                      "sample": "Timeout: Exceeded 5000ms waiting for promise" },
    "recentOutcomes": ["pass","fail","pass","pass","fail","pass","fail"]
  }],
  "meta": { "page": 1, "total": 3 }
}

// POST /v1/ingest  → 202
{ "status": "accepted", "jobId": "b1c8…", "testsReceived": 100 }
// 401 {"error":"invalid_api_key"} · 422 {"error":"invalid_report","detail":"no <testcase> elements found"} · 429 rate-limited
```

Errors: consistent `{error, detail?}` JSON; webhook endpoint returns 200 even for *recognized-but-unprocessable* payloads (log them; only 4xx/5xx on auth/infra failure so GitHub's retries mean something).

---

## PART 14 — DASHBOARD

Design axiom: **every pixel answers "what do I fix first?"** If an element doesn't change a decision, cut it.

Pages (MVP): Login → Installations/Repos → **Repo Dashboard** → Test Detail → Runs. (Signatures page = P1.)

**Repo Dashboard:**

- Header cards: `Critical: 2 · Flaky: 5 · Watch: 9 · Insufficient data: 14` — the triage funnel at a glance.
- **Main table (the product):**
  - `Outcome ribbon` — last 20 results as tiny colored squares (green/red/grey). One glance = the whole story. Cheapest highest-impact visual in the app.
  - Score (0–100) + delta arrow (↑7 since last week), Category badge (color-coded), Test name + file path, Failure rate, Last failed (relative), Top failure signature (truncated), Trend sparkline.
  - Default sort: score desc. Filters: category chips, path substring, search. Pagination.
- Empty states that teach: "Not enough data yet — FlakyGuard needs ≥8 runs per test. Push a few more PRs." (An empty dashboard that explains itself beats a pretty one that looks broken.)

**Test Detail:** full outcome timeline (hover = run, sha, duration), score-over-time line, failure messages **grouped by signature** with counts and first/last seen, links out to the GitHub run, banner if BROKEN ("consistent failure since commit d6f3c44 — this is not flakiness, it's breakage").

Anti-dashboard guidance: no vanity gauges, no world-map widgets, no dark-pattern "AI insights" panel. Restraint reads senior.

---

## PART 15 — FLAKE SCORE (product semantics)

- **0** = every recent run passed (STABLE). **100** = maximum observed instability (near-alternating outcomes, CRITICAL).
- **Runs required:** ≥8 to score at all (INSUFFICIENT before that); full fidelity at 30.
- **Confidence:** Wilson 95% lower bound on failure rate shown alongside (`failureRate 37%, worst-case ≥21%`); small-n tests get a "low confidence" chip.
- Archetypes:
  - **Stable** — 30/30 pass → 0–5
  - **Slightly flaky** — 1 fail in 30, isolated → ~6–15 (WATCH; deliberately timid)
  - **Very flaky** — alternating → 80–100
  - **Recently broken** — long pass streak then FAILs → climbs WATCH→FLAKY, flips to **BROKEN** at 5 consecutive failures
- **Broken vs flaky disambiguation, layered:** (1) streak rule; (2) transition-rate anatomy (broken ≈ 1 transition, flaky ≈ many); (3) signature homogeneity — all failures sharing one brand-new signature that appeared at a specific commit smells like breakage; heterogeneous rotating causes smells like flake. Layers 1–2 ship in MVP; 3 is a cheap P1 refinement.

---

## PART 16 — PR COMMENTS (P1)

Mechanics: scoring detects upward threshold-crossing on a test whose failing run originated from a PR → resolve PR via the commit-SHA endpoint (`GET /repos/{o}/{r}/commits/{sha}/pulls`) → mint installation token (needs **Pull requests: read & write**) → post.

**Anti-spam design (this is where amateurs get muted by repo owners):**

- **One living report comment per PR** — identified by an HTML marker `<!-- flakyguard:report:v1 -->` embedded in the body; on repeat events we find our comment and PATCH it (also tracked locally via `pr_annotations.comment_id`).
- Comment only when: score crosses INTO flaky/critical, the failing test relates to the PR (touched file or same directory — v1 heuristic), data ≥ minimum.
- Never comment when: insufficient data, test muted, PR closed/merged, score merely bouncing within band, more than once per day per PR (throttle).
- Tone: informative, never blocking, always linked evidence.

```markdown
<!-- flakyguard:report:v1 -->
## ⚠️ FlakyGuard: 1 flaky test detected

| Test | Score | Recent | Top failure |
|---|---|---|---|
| `refunds a user after dispute` | **61** 🔴 ↑7 | 🟩🟥🟩🟩🟥🟩🟥 | `Timeout: Exceeded 5000ms…` (×3) |

This test has failed 11 of the last 30 runs on `main` — with ~79% likelihood unrelated to your changes.
[Full history](https://flakyguard.example/repos/881234/tests/301) · [Failure details](…)

<sub>FlakyGuard • manage settings in the dashboard</sub>
```

---

## PART 17 — SECURITY MODEL

| Surface | Control |
|---|---|
| Webhooks | HMAC-SHA256 verify on raw body, timing-safe compare; no signature → 401 |
| App private key (PEM) | Server env only; mints JWTs; never serialized, logged, or sent client-side; rotatable |
| Installation tokens | 1h TTL, minimal permission set (Metadata:read, Actions:read, PRs:write — nothing else) |
| Ingest API keys | 32-byte random, shown once, stored as SHA-256, constant-time compare, revocable, scoped to installation |
| Dashboard auth | GitHub OAuth; authorization = intersection of caller's `GET /user/installations` with our records |
| Tenancy isolation | Every query derives `installation_id` from the *authenticated principal*, then filters by it — middleware-enforced, not developer-memory-enforced |
| Defense in depth | If using Supabase directly from client anywhere: enable **RLS** (row-level policies keyed on an `installation_id` claim). If all reads go through our API with a server-side pool, RLS is optional belt-and-braces |
| Secrets mgmt | `.env` gitignored; `gitleaks` in CI (dogfooding); prod secrets in platform env store, never baked into images |
| Rate limiting | Per-API-key ingest limits (counter table or pg-boss lane); webhook endpoint protected by HMAC itself |
| Data privacy | Never store full logs; failure messages truncated + already number/string-redacted by normalization; 90-day retention on raw `test_results`, aggregates retained |

**Never expose to frontend:** app private key, webhook secret, ingest key plaintexts, `DATABASE_URL`, Supabase service-role key, GitHub client secret. Frontend gets its own session cookie and API JSON. Nothing else exists.

---

## PART 18 — RATE LIMITS

GitHub App REST budget: **1,500 requests/hour per installation** (fresh per token), plus secondary limits (concurrency/abuse → HTTP 403 with `retry-after`).

- **One repo, 10,000 historical runs (backfill):** paginate `per_page=100` → 100 requests; use conditional requests (`If-None-Match`/ETag → `304`s don't consume core budget); pace through the queue, not a firehose loop.
- **100 installations:** volume scales linearly but stays trivial (thousands of events/day). Track budgets per installation: persist `x-ratelimit-remaining` / `x-ratelimit-reset` from responses; workers consult before spending; low-budget → defer jobs (pg-boss delayed retry). This little "rate budget ledger" is a fantastic interview artifact.
- **Burst of events:** receiver only enqueues (O(ms)); queue absorbs; worker concurrency bounded (e.g., 5) so a slow GitHub API can't stampede.
- **Avoiding duplicate processing:** delivery dedupe → job dedupe keys → DB unique constraints (three layers, Part 3).
- **Backoff:** on 403-secondary/5xx: wait `retry-after` if present, else exponential with **jitter** (`delay = base·2^n ± random`). Jitter matters: without it, 50 synchronized workers retry in lockstep and DDoS the API together. On 404: don't retry blindly — distinguish "transient" from "gone" (repo deleted → archive, stop).

---

## PART 19 — FAILURE SCENARIOS (the operational contract)

| # | Scenario | Handling |
|---|---|---|
| 1 | Duplicate webhook | `webhook_deliveries` PK conflict → 200, no-op |
| 2 | Out-of-order events (rerun attempt 2 completes before attempt 1's ingest) | Ordering derives from `executed_at`/run+attempt keys, never arrival time; scoring sorts by time |
| 3 | GitHub API down | Job throws → pg-boss backoff (10s→…→1h) → DLQ after ~8 tries with error attached |
| 4 | Report missing (action skipped/broken) | Run stays `results_state='pending'`; sweep job flags `missing` after 24h; counter surfaced on dashboard |
| 5 | Malformed JUnit XML | Typed parse error → job fails into DLQ with reason; `parse_failures_total` metric; never poisons other batches |
| 6 | Huge XML | Cap 10MB, reject 413 with clear message |
| 7 | Repository deleted | API 404 → mark archived; skip future work quietly |
| 8 | Installation removed | `installation.deleted` → status='removed'; middleware denies; data retained (soft) for reinstall |
| 9 | Worker crashes mid-job | pg-boss expires claim → another worker retries → handlers idempotent (upserts) so redo is safe |
| 10 | DB connection failure | Pool retry w/ backoff; `/readyz` fails → orchestrator restarts; queue durability means nothing lost |
| 11 | Same test twice in one report | Dedupe within batch by identity (keep first failure, log warning — indicates reporter bug) |
| 12 | Test renamed/moved | New identity born; old goes stale, decays from windows; documented limitation |
| 13 | GitHub rate limit hit | Budget ledger + `retry-after` + jittered backoff (Part 18) |
| 14 | PR already has our comment | Find via marker/comment_id → PATCH update, never duplicate |
| 15 | Deployment crashes | Stateless services + durable queue + idempotent consumers = resume exactly where left |
| 16 | Clock skew | Use GitHub-provided timestamps exclusively; never `Date.now()` for facts |
| 17 | Fork PRs | Secrets unavailable to fork workflows → documented v1 limitation (same-repo branches only) |
| 18 | Report with 0 tests | Skip scoring, increment `empty_reports_total`, warn in logs |

---

## PART 20 — LOCAL DEVELOPMENT (Ubuntu, exact order)

**Software:** Node 20 LTS via nvm · Docker Engine + compose plugin · pnpm (`corepack enable`) · VS Code (ESLint, Prettier extensions) · cloudflared (webhook tunnel).

**No domain needed:** `cloudflared tunnel --url http://localhost:3000` prints a free `https://<random>.trycloudflare.com` URL. Point the GitHub App webhook there. (Alternative: smee.io — official but flakier.)

**GitHub App setup (dev):** github.com → Settings → Developer settings → GitHub Apps → New. Webhook URL = tunnel URL + `/webhooks/github`; generate a webhook secret; permissions: Metadata R, Actions R, Pull requests RW, Administration R (for `GET /user/installations`); subscribe: `installation`, `workflow_run`; download the private key PEM; note App ID + Client ID + Client Secret (OAuth for dashboard login); **Install** it on a scratch repo.

**`.env.example`:**

```
DATABASE_URL=postgres://flaky:flaky@localhost:5432/flakyguard
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY_PATH=./dev.pem
GITHUB_WEBHOOK_SECRET=dev-secret
GITHUB_CLIENT_ID=Iv1.xxxx
GITHUB_CLIENT_SECRET=xxxx
PORT=3000
WORKER_CONCURRENCY=5
```

**Setup order:**
① install tools →
② `docker compose up -d db` →
③ `pnpm i` →
④ `pnpm db:migrate` (node-pg-migrate) →
⑤ `pnpm dev` (api + worker concurrently) →
⑥ start tunnel →
⑦ paste tunnel URL into App settings →
⑧ add workflow (Part 6) + `FLAKYGUARD_API_KEY` secret to scratch repo (key printed by `pnpm key:create`) →
⑨ push a commit →
⑩ watch rows appear (`psql` / TablePlus) and dashboard render.

Migrations are versioned SQL files in `packages/db/migrations` — checked in, forward-only, applied by script. Never edit applied migrations; always add new ones.

---

## PART 21 — PROJECT STRUCTURE

Opinionated: **pnpm monorepo, three apps, three packages — no more.**

```
flakyguard/
├── apps/
│   ├── api/            # Fastify: /webhooks/github, /v1/ingest, /api/*, /healthz, /metrics
│   ├── worker/         # thin entrypoint: registers job handlers, starts pg-boss workers
│   ├── web/            # Next.js dashboard (App Router)
│   └── action/         # the GitHub Action (composite JS action: read junit.xml → POST /v1/ingest)
├── packages/
│   ├── core/           # PURE domain logic: normalize, identity, fingerprint, scoring. ZERO I/O. Heavily tested.
│   ├── db/             # pg pool, migrations, typed query helpers
│   └── config/         # zod-validated env loading (fail fast on misconfig)
├── fixtures/           # real JUnit samples: jest, vitest, pytest (+ malformed variants)
├── docker-compose.yml  # db + api + worker (+web) for one-command local/prod-ish
└── .github/workflows/ci.yml   # lint, typecheck, test — and DOGFOODS flakyguard on itself
```

Rules that keep it honest:

- `packages/core` imports nothing from apps (pure functions in, pure objects out — this is what makes scoring/normalization unit-testable to obsession level).
- Apps are thin shells over core+db.
- Do NOT create `packages/utils`, `packages/logger`, `packages/types` — that's résumé-driven packaging.
- A single-package layout would also work at this size; the monorepo earns its keep specifically because action + api + worker + web genuinely share `core`.

---

## PART 22 — STRICT MVP

**P0 — must exist (the project is not FlakyGuard without these):**

- [ ] GitHub App: install/uninstall lifecycle + `workflow_run.completed` webhook, HMAC-verified, delivery-idempotent
- [ ] `POST /v1/ingest` with hashed API keys
- [ ] JUnit parser (Vitest + Jest fixtures minimum; pytest fixture stretch)
- [ ] Identity normalization + parameterized parent handling
- [ ] Failure fingerprinting (normalized hash)
- [ ] Full schema (Part 11) + migrations
- [ ] pg-boss pipeline: process → score, retries + DLQ
- [ ] Flake score engine (Part 10) incl. BROKEN override + INSUFFICIENT state
- [ ] Dashboard: repos list, leaderboard table w/ outcome ribbons, test detail w/ history
- [ ] Demo repo with an intentionally flaky test; CI on FlakyGuard itself; README with architecture diagram + honest limitations

**P1 — immediately after MVP (week 5–6 candidates):** PR report comments (upsert style), signatures view, mute/ignore, pytest support, run detail page, backfill-from-OSS script.

**P2 — explicitly later:** embedding clustering, LLM summaries, Slack digests, GitLab, quarantine automation, public API, org-level rollups, rename detection.

**MUST NOT exist in MVP:** log parsing/scraping, websockets, multi-forge support, billing, AI anything, Kubernetes, a second database, a notifications subsystem.

---

## PART 23 — 6-WEEK BUILD PLAN

### Week 1 — Skeleton + the trust boundary

- **Learn:** HMAC, raw-body pitfalls, pg-boss basics, migrations.
- **Build:** monorepo scaffold, strict tsconfig, eslint/prettier, docker compose (db), config loader (zod), Fastify app with `/healthz`, webhook route with signature verify + delivery dedupe + enqueue, first migration set.
- **Tests:** signature vectors (valid/tampered/missing), duplicate-delivery rejection.
- **Done =** forged POST → 401; genuine POST (curl with computed HMAC) → 200 + one row in `webhook_deliveries` + one job in the queue table.

### Week 2 — Ingestion + parsing

- **Learn:** fast-xml-parser, table-driven testing, upserts.
- **Build:** api_keys (create/hash/verify middleware), `/v1/ingest`, parser + normalizer + identity in `packages/core`, fixtures for 3 frameworks, `tests`/`test_results` inserts.
- **Tests:** parser fixtures (each framework + malformed + empty + huge-truncated), identity table-driven cases (incl. the Part-8 worked example), idempotent re-ingest (same payload twice → same row count).
- **Done =** curl a real junit.xml → correct rows in Postgres — twice.

### Week 3 — Worker + the math

- **Learn:** pg-boss handlers, exponential backoff, windowed queries (ORDER BY + LIMIT or window functions), Wilson interval.
- **Build:** worker entrypoint, `process-ingest` + `score` handlers, scoring engine in core, BROKEN override, `flake_scores` upserts.
- **Tests:** scoring golden cases (all Part-10/15 archetypes with asserted numbers), property tests (score ∈ [0,100]; monotone in transitions; INSUFFICIENT below 8 samples).
- **Done =** push flaky commits to scratch repo → scores appear and climb; kill worker mid-job → retry completes with no duplicate rows.

### Week 4 — Dashboard

- **Learn:** Next.js App Router data fetching, GitHub OAuth flow.
- **Build:** OAuth login + installation authorization middleware, repos page, leaderboard (ribbons, filters, sort), test detail (timeline, signatures, score chart), runs page.
- **Tests:** component smoke tests; API integration tests with tenancy assertions (user B cannot read repo A — write this test, it will catch real bugs).
- **Done =** full browse flow on real data from your scratch repo.

### Week 5 — PR comments + hardening

- **Learn:** installation-token minting chain, GitHub comments API, throttling.
- **Build:** JWT→token mint helper, PR resolution via SHA, report-comment upsert with marker, thresholds config, rate-budget ledger, Part-19 scenario fixes (at minimum: 1, 3, 4, 5, 8, 9, 13, 14).
- **Tests:** mocked-Octokit comment flows (create vs update), rate-limit backoff unit tests.
- **Done =** PR opens → comment appears → subsequent runs UPDATE it, never duplicate.

### Week 6 — Dogfood, deploy, document, demo

- **Build:** seed script (synthetic 3-week history for demo richness), optional OSS backfill script, `/metrics` + structured logs, production Dockerfiles + compose, deploy (Part 25) or polished local demo, README (architecture diagram, decisions-and-why section, limitations), 90-second demo video.
- **Done =** an interviewer can go from README to "whoa" in under 5 minutes.

---

## PART 24 — TESTING STRATEGY

- **Unit (bulk of tests, all in `packages/core`):** normalizer table-driven (`"/tmp/x9:183 expected request-98231…" → exact normalized string`); fingerprint stability (same-normalized ⇒ same hash; different cause ⇒ different hash); scorer golden cases + properties (bounds, INSUFFICIENT gating, BROKEN override).
- **Parser:** fixture files per framework incl. hostile inputs (ANSI soup, nested suites, self-closing testcases, 0 tests, 10MB truncation).
- **Integration (real Postgres via docker compose/testcontainers):** migrations apply cleanly; unique constraints hold under double-insert; tenancy filters return nothing for wrong installation.
- **Webhook:** build payload + HMAC with test secret → 200 + exactly one job; replay identical delivery → still one job; tampered body → 401.
- **API:** ingest auth matrix (valid/revoked/wrong-scope keys); 202 + queued assertion.
- **E2E (thin):** compose up → POST fixture ingest → poll API → expect flaky test visible. GitHub interactions mocked via recorded fixtures (never hit real GitHub in CI).
- **Load-lite:** autocannon 100 concurrent ingests → no 5xx, queue drains.

Target: core package ≥90% coverage; apps lighter. The scoring tests with hand-computed expected numbers are the ones interviewers want to see.

---

## PART 25 — DEPLOYMENT ($0, honestly)

| Piece | Option | Reality check |
|---|---|---|
| Dashboard | **Vercel free** | Perfect fit, always-on ✅ |
| API + Worker | **Oracle Cloud Always Free** ARM VM (docker compose) | Genuinely free forever, always-on; ~half a day of setup. Best true-$0 option. Alternatives: Fly.io (~$3/mo smallest VM), Render free (**sleeps → missed webhooks** — acceptable only for demos), Koyeb free (sleeps). |
| Database | **Supabase free** | 500MB, fine — **but projects pause after ~1 week of inactivity**; for live demos keep it warm or accept reactivation delay. Local Docker for development. |
| Tunnel (dev only) | cloudflared quick tunnels | Free, ephemeral URLs |

**Honest recommendation:** develop locally; for the "deployed" checkbox do Vercel + Oracle VM + Supabase; and **for interviews lead with the 90-second screen recording + local demo anyway** — it never 404s, never sleeps, never paused. A crisp recording of the real flow beats a dead URL every time.

---

## PART 26 — DOCKER

Dockerize: **db, api, worker** (yes), **web** (optional — Vercel owns it in prod; include for one-command local parity). Do NOT containerize the tunnel or GitHub itself.

```yaml
services:
  db:
    image: postgres:16
    environment: [POSTGRES_USER=flaky, POSTGRES_PASSWORD=flaky, POSTGRES_DB=flakyguard]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U flaky"], interval: 5s, retries: 10 }
    volumes: [pgdata:/var/lib/postgresql/data]
  api:
    build: { context: ., dockerfile: Dockerfile }   # ONE multi-stage image…
    command: ["node", "apps/api/dist/index.js"]     # …two entrypoints
    env_file: .env
    depends_on: { db: { condition: service_healthy } }
    ports: ["3000:3000"]
  worker:
    build: { context: ., dockerfile: Dockerfile }   # same image, different command —
    command: ["node", "apps/worker/dist/index.js"]  # this pattern IS the lesson
    depends_on: { db: { condition: service_healthy } }
volumes: { pgdata: {} }
```

Why each exists:

- db = state.
- api = ingress (needs published port).
- worker = consumption (no inbound port — note the absence of `ports:`; that's a security posture, not an omission).
- healthcheck + `depends_on.condition` = orderly startup instead of crash-loop roulette.
- One image, two commands teaches more than two bespoke Dockerfiles.

---

## PART 27 — OBSERVABILITY (dogfood lightly)

You're building monitoring for a living; monitoring yourself is the narrative cherry — **cap it at two days** or it becomes project #2.

- **Logs:** pino, structured JSON, request-id + delivery-id + job-id correlation; one log line per lifecycle event. No console.log sprawl.
- **Health:** `/healthz` (process alive) + `/readyz` (DB reachable) — wired to compose/orchestrator restarts.
- **Metrics:** `prom-client` exposing `/metrics`: counters `webhooks_received_total`, `ingest_batches_total`, `parse_failures_total`, `job_retries_total`, `github_api_requests_total{status}`; gauges `queue_depth` (pg-boss stats); histograms `processing_duration_seconds` per job type.
- **View:** either a `grafana` container pointed at it (one afternoon) or — sufficient and more honest — a tiny "System health" card on your own dashboard reading queue depth + last-hour error counts. The latter is *actual dogfooding* and a better story.
- **Explicitly out:** distributed tracing, alertmanager, PagerDuty jokes. README line: *"FlakyGuard monitors itself with the same philosophy it sells: minimal, actionable signals."*

---

## PART 28 — AI (brutal honesty)

**Does the MVP need AI? No. Zero. The MVP's credibility comes from refusing it.**

Where AI would *later* earn its place (each with a concrete trigger, not vibes):

1. **Semantic failure clustering** — trigger: normalized-hash groups measurably fragment (e.g., >50 singleton signatures/repo/week). Embeddings would merge `Connection refused 127.0.0.1:5432` with `connect ECONNREFUSED` variants the regexes miss.
2. **Digest summarization** — weekly "what changed in flakiness" paragraph. Cheap, cached, low-stakes.
3. **Root-cause suggestion** — "signature #77 first appeared right after commit X which touched `payments/client.ts`" — half heuristic diff-correlation, half LLM narration.

Where AI is *unnecessary or harmful*: the scoring path (nondeterminism + latency + cost in a hot path that must be reproducible), a chatbot over test history (wrapper), "AI flakiness prediction" (unvalidatable).

**Interview line, verbatim:** *"We deliberately kept AI out of the detection core. Flakiness classification is a statistics problem with small, noisy samples — an LLM adds nondeterminism to the one component that must be auditable, since humans act on its output. We use deterministic normalization + transition-rate analysis instead, and confine language models to presentation-layer summaries where a wrong answer costs nothing."* That sentence is worth more than any bolted-on GPT call.

---

## PART 29 — THE INTERVIEW DEMO (scripted, 5 minutes)

Prep: a `flakyguard-demo` repo — 25 solid tests + `flaky.test.ts` (fails ~35% via seeded-random/time check) + `broken.test.ts` (fails when `env BREAK_ME=1`). A seed script pre-loads ~3 weeks of synthetic history (disclosed openly — seeding demo data is standard practice; hiding it is not).

1. **Push a commit opening a PR** → CI runs → the flaky test fails (rerun if unlucky — narrate the luck: "this is the product's reason to exist").
2. **GitHub App settings tab, Deliveries section** — show the real webhook, its HMAC, the redeliver button. Proof of genuine platform integration, not a mock.
3. **Terminal:** `psql` → `SELECT count(*) FROM test_results;` — raw facts landed.
4. **Dashboard:** leaderboard with the villain at score ~60↑, outcome ribbon visibly speckled; click through: timeline, grouped signatures (`Timeout ×9`), BROKEN banner on the other test.
5. **Back on the PR:** FlakyGuard's report comment, updated (not duplicated) by this latest run.
6. **Kill-switch flourish:** `docker compose stop worker` → push again → show the job waiting safely in the queue → start worker → it drains. *"At-least-once delivery with idempotent consumers — restart anything, anytime."*
7. Close on the README's decisions section (why not log-parsing, why not AI, why pg-boss).

Backup: the 90-second recording, for when live CI is slow (it will be — have the recording).

---

## PART 30 — INTERVIEW PREP (34 questions, tight answers)

**GitHub Apps & webhooks**

1. *Why a GitHub App over a PAT?* Scoped per-installation access, fine-grained permissions, 1h tokens, install/uninstall lifecycle events, per-installation rate limits. A PAT is one user's master key — unacceptable for multi-tenant.
2. *How do you authenticate API calls?* Chain: RSA-signed JWT (private key, ≤10min) → `POST /app/installations/{id}/access_tokens` → 1h installation token scoped to that install's permissions.
3. *How do you trust a webhook?* HMAC-SHA256 over the raw body with a shared secret, compared timing-safely. Proves sender knowledge + payload integrity.
4. *Why hash the raw body, not parsed JSON?* The signature covers exact bytes; re-serialization changes whitespace/key order → mismatch.
5. *Why timingSafeEqual?* Naive comparison short-circuits on first mismatch; response-time differences leak how many leading characters matched — a timing oracle.
6. *Are webhooks guaranteed once?* No — at-least-once; GitHub retries non-2xx for hours. Design consumers idempotently.
7. *How do you dedupe?* Three layers: delivery-ID primary key, job dedupe keys, DB unique constraints as final authority.
8. *What's in the delivery headers?* Event type, delivery GUID, signature — the GUID is our idempotency key.
9. *Fork PR limitation?* Secrets aren't injected into fork-PR workflows, so our action can't upload — documented v1 constraint, artifact-based path later.
10. *Which events and why?* `installation.*` (tenancy lifecycle), `workflow_run.completed` (run facts). Subscribing to everything is noise + attack surface.

**Queues & async**

11. *Why a queue at all?* Webhook handlers must ack in seconds; real work takes longer and fails transiently. The queue decouples intake from processing and makes work crash-survivable.
12. *Why pg-boss over BullMQ/Redis?* Volume is tiny; pg-boss needs zero new infra and lets "insert results + enqueue scoring" be one transaction — eliminating dual-write inconsistency. Redis earns its keep at much higher throughput.
13. *What is SKIP LOCKED?* Postgres row-locking clause letting concurrent workers claim distinct rows without blocking each other — lock-free-feeling work stealing.
14. *Exactly-once delivery?* Myth at the queue level; achievable as an *effect* via at-least-once + idempotent consumers. Enforce the effect with unique constraints.
15. *Retry policy?* Exponential backoff with jitter, capped attempts, then dead-letter with the error preserved for inspection.
16. *Worker dies mid-job?* Claim lease expires, another worker retries; handlers are upsert-based so redo is harmless.
17. *Priority handling?* Separate lanes — ingest outranks PR comments so user-facing data never waits behind cosmetics.

**Data & statistics**

18. *Why store raw results if scores are cached?* Scores are opinions; results are facts. Cache-invalidation debates vanish when you can recompute from immutable facts.
19. *Why exclude line numbers from identity?* They shift on unrelated edits, shattering history — the classic identity-design mistake.
20. *Broken vs flaky discrimination?* Sequence anatomy: broken = high failure rate, ~1 transition, long streak (override at 5); flaky = frequent transitions. Same average, opposite shapes.
21. *Why Wilson interval, not raw percentage?* Raw proportions lie at small n ("1/2 = 50%!"); Wilson's lower bound shrinks claims honestly as samples shrink.
22. *Why cap the failure-rate term?* So a permanently broken test can't max a *flakiness* score — chronic failure is a different disease with a different label.
23. *Correlated failures?* One flaky auth mock flickers 8 auth tests together; per-test scores overcount. Signature grouping exposes the shared cause — partial mitigation, documented honestly.
24. *Why is the score not "mathematical certainty"?* Non-stationary code, small samples, correlation; therefore gates, intervals, conservative bands, human confirmation. Triage instrument, not judge.

**Postgres & schema**

25. *Key indexes?* `(test_id, executed_at DESC)` for history, `(workflow_run_id)` for run views, partial index on flaky/critical scores for the leaderboard. Indexes follow queries, not tables.
26. *Why a partial index?* The leaderboard reads only 2 of 6 categories; indexing just those rows keeps it small and hot.
27. *Why timestamptz?* Stores UTC absolutely; plain `timestamp` stores naive wall time — DST/timezone corruption waiting to happen.
28. *Why bigint for GitHub IDs?* GitHub IDs are int64; int overflows silently at ~2.1B — real outages have happened on lesser projects.
29. *Enum vs text?* Enums for closed sets (status/category) buy type safety; text for open sets (conclusion strings GitHub may extend).

**Security & ops**

30. *Multi-tenant isolation?* Principal → installations → derive `installation_id` in middleware → every query filtered by it; never trust client-supplied IDs; RLS as belt-and-braces.
31. *Rate-limit strategy?* Persist remaining/reset headers per installation, spend consciously, back off with jitter honoring `retry-after`, ETags for free wins.
32. *Scale to 1,000 repos?* Nothing architectural breaks: stateless api/worker replicas + time-partitioned `test_results` + read replicas. The design's honesty is that current scale needs none of it.

**Docker / architecture**

33. *Why one image, two containers?* Same build artifact, different entrypoints — api faces ingress, worker faces the queue; fewer artifacts, clear runtime separation.
34. *Why a monolith?* Team of one, trivial scale; module boundaries (core/db/apps) preserve future extractability. Microservices would buy distributed-systems problems with no customers to serve.

---

## PART 31 — PREREQUISITES

**MUST KNOW BEFORE STARTING (days, not months):**
HTTP fundamentals (methods, status codes, headers) · JSON · async JS (promises, why blocking handlers hurt) · basic SQL (joins, indexes conceptually) · git + writing/consuming a GitHub Actions workflow · what a cryptographic hash is · secrets hygiene (never commit `.env`) · Docker basics (image vs container, compose up).

**LEARN WHILE BUILDING (the project teaches these):**
GitHub Apps auth chain · HMAC + timing-safe compare · at-least-once delivery & idempotency patterns · pg-boss / SKIP LOCKED · upserts & constraint-driven invariants · windowed statistics + Wilson intervals · migration discipline · OAuth · rate-limit etiquette · structured logging · integration testing against real Postgres.

**OPTIONAL/LATER:**
OpenTelemetry · Kafka-style event sourcing · Kubernetes · advanced stats (change-point detection) · SimHash/embedding theory · Rust parsers.

None block day 1.

---

## PART 32 — BRUTAL REVIEW

### What could make this project fail?

- **Week-1 GitHub App friction.** Auth chains, tunnels, webhook secrets — fiddlier than expected. Budget the whole first week for plumbing and don't panic; everyone stumbles here.
- **Cold-start emptiness.** An unseeded dashboard shows nothing. Fix: seed script + demo repo from day one.
- **Parser rabbit hole.** Real-world JUnit files have infinite edge cases. Cap formats, cap file sizes, ship.
- **Nobody installs it.** Almost certain. Irrelevant — portfolio value ≠ adoption. Build for the README, the demo, and the interview.

### What is actually hard?

Test identity normalization (Part 8), end-to-end idempotency, and making the score trustworthy enough that a human acts on it. These three are the project.

### What sounds impressive but isn't?

Microservices, Kafka, Kubernetes, websockets, "AI-powered", multi-CI-platform support, a Chrome extension. Every one of these is scope creep wearing a tuxedo.

### What teaches real engineering?

At-least-once processing with idempotent consumers · auth chains (JWT → installation token) · statistics under uncertainty · schema/index design driven by real queries · operational hardening (retries, DLQs, health checks). These transfer directly to any backend job.

### What should be cut without mercy?

PR comments if week 5 slips · digest emails · mutes · pytest support (ship Vitest+Jest only if needed). The P0 list in Part 22 is the contract.

### Is it resume-worthy?

Yes — genuinely. It's infrastructure-shaped (rare for students), universally understood ("flaky tests, ugh"), demonstrable in 5 minutes, and every subsystem maps to an interview question you can now answer from experience instead of from a blog post.

### What makes a senior engineer say "this is actually good"?

- Correct HMAC verification + three-layer idempotency, explained unprompted
- A decisions section in the README: *why action-upload over log-scraping, why pg-boss, why no AI*
- Scoring golden tests with hand-computed expected numbers
- Honest limitations (fork PRs, renames) written down
- Dogfooded CI on the repo itself
- A dashboard where every column drives a decision

### What makes them say "just another student project"?

- No tests, or tests that only cover happy paths
- Seeded-only data presented as organic usage
- A chatbot bolted on "for AI experience"
- No handling of duplicate/out-of-order events
- Pretty dashboard, no story about what broke and how the tool found it

### Final recommended architecture (one paragraph to remember)

> One pnpm monorepo. A Fastify API process (webhook receiver with HMAC verification + delivery dedupe; ingest endpoint with hashed API keys; REST for the dashboard) and a Worker process sharing one Postgres database that also hosts the pg-boss queue — inserts and enqueues in single transactions, all handlers idempotent via unique constraints and upserts. Pure domain logic (normalize → identify → fingerprint → score) lives in a dependency-free core package under obsessive test coverage. A tiny composite GitHub Action uploads JUnit XML; webhooks handle lifecycle and enrichment. Next.js dashboard on Vercel renders leaderboards and timelines that answer exactly one question: which test do I fix first? No Redis, no Kafka, no AI, no microservices — until scale demands them, and the README says exactly when that would be.

*End of blueprint. Start coding Week 1, Day 1.*

