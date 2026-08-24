import Link from "next/link";
import { cookies } from "next/headers";
import {
  api,
  type ActivityItem,
  type CiWaste,
  type Dashboard,
  type FlakyTestRow,
  type Health,
  type RecentRun,
  type Reliability,
  type TrendItem,
} from "@/lib/api";
import { CategoryBadge, ConclusionBadge, Ribbon } from "@/lib/components";
import CreateIssueButton from "@/components/CreateIssueButton";
import {
  formatDuration,
  formatMs,
  healthTone,
  pct,
  relativeTime,
} from "@/lib/ui";

export const dynamic = "force-dynamic";

const INSTALL_URL = process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL ?? "";
const AUTH_ENABLED = Boolean(process.env.SESSION_SECRET);

function StatCard({
  label,
  value,
  tone = "text-zinc-900",
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function HealthStrip({ health }: { health: Health | null }) {
  const items: { key: string; label: string; status: string }[] = health
    ? [
        { key: "github", label: "GitHub App", status: health.checks.githubApp.status },
        { key: "db", label: "Database", status: health.checks.database.status },
        { key: "webhook", label: "Webhook", status: health.checks.webhook.status },
        { key: "ingest", label: "Test ingestion", status: health.checks.ingestion.status },
        { key: "score", label: "Scoring", status: health.checks.scoring.status },
      ]
    : [
        { key: "db", label: "Database", status: "down" },
        { key: "webhook", label: "Webhook", status: "down" },
        { key: "ingest", label: "Test ingestion", status: "down" },
        { key: "score", label: "Scoring", status: "down" },
        { key: "github", label: "GitHub App", status: "down" },
      ];

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-zinc-200 bg-white px-4 py-3">
      {items.map((it) => {
        const tone = healthTone(it.status);
        return (
          <div key={it.key} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
            <span className="text-sm text-zinc-700">{it.label}</span>
            <span className={`text-xs capitalize ${tone.text}`}>{it.status}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReliabilityHero({ reliability }: { reliability: Reliability }) {
  const delta =
    reliability.score !== null && reliability.previous !== null
      ? reliability.score - reliability.previous
      : null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        CI reliability
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tabular-nums">
          {reliability.score ?? "–"}
        </span>
        <span className="text-sm text-zinc-400">/ 100</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
        <span>across {reliability.analyzed} analyzed tests</span>
        {delta !== null && delta !== 0 && (
          <span className={delta > 0 ? "text-emerald-600" : "text-red-600"}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)} since last scan
          </span>
        )}
      </div>
    </div>
  );
}

function ActionCenter({ tests }: { tests: FlakyTestRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-700">
          Needs attention
        </h2>
      </div>
      {tests.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-zinc-500">
          No flaky tests detected yet. Run a few workflows to build history.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {tests.map((t, i) => (
            <li
              key={t.id}
              className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50"
            >
              {i === 0 && (
                <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Fix first
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/tests/${t.id}`}
                    className="font-medium hover:underline"
                  >
                    {t.name || "(unnamed)"}
                  </Link>
                  <CategoryBadge category={t.category} />
                </div>
                <div className="mt-0.5 truncate text-xs text-zinc-400">
                  {t.repository} · {t.file_path}
                </div>
                {t.top_error_class ? (
                  <div
                    className="mt-0.5 truncate font-mono text-xs text-zinc-500"
                    title={`${t.top_error_class}: ${t.top_sample_message ?? ""}`}
                  >
                    {t.top_error_class}: {t.top_sample_message}
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs text-zinc-400">
                    {t.failure_count} fails · {pct(t.transition_rate)} flip rate
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-lg font-semibold tabular-nums">{t.score}</div>
                <div className="text-xs text-zinc-400">{pct(t.failure_rate)}</div>
              </div>
              <div className="hidden shrink-0 sm:block">
                <Ribbon outcomes={t.recent_status} />
              </div>
              <Link
                href={`/tests/${t.id}`}
                className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Investigate
              </Link>
              <CreateIssueButton testId={t.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrendColumn({
  title,
  kind,
  items,
}: {
  title: string;
  kind: "new" | "worse" | "better";
  items: TrendItem[];
}) {
  const tone =
    kind === "new" ? "text-red-600" : kind === "worse" ? "text-orange-500" : "text-emerald-600";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-400">None</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((it) => (
            <li key={it.id} className="text-sm">
              <Link
                href={`/tests/${it.id}`}
                className="font-medium hover:underline"
              >
                {it.name}
              </Link>
              <span className="text-zinc-400"> · {it.repository}</span>
              <div className="mt-0.5 text-xs text-zinc-400">
                {kind === "new" && (
                  <span className={tone}>
                    <CategoryBadge category={it.category} /> score {it.score}
                  </span>
                )}
                {kind === "worse" && (
                  <span className={tone}>
                    ↑ {it.delta} → {it.score}
                  </span>
                )}
                {kind === "better" && (
                  <span className={tone}>
                    ↓ {it.delta} → {it.score}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CiWasteCard({ waste }: { waste: CiWaste }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-700">CI waste</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-lg font-semibold tabular-nums">
            {formatMs(waste.flaky_duration_ms)}
          </div>
          <div className="text-xs text-zinc-400">time on flaky tests</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums">
            {waste.failed_results}
          </div>
          <div className="text-xs text-zinc-400">failed results</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        Estimated test time spent on failures (time only — no cost is estimated).
      </p>
    </div>
  );
}

function RunsTable({ runs }: { runs: RecentRun[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-4 py-3 font-medium">Repository</th>
            <th className="px-4 py-3 font-medium">Workflow</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Tests</th>
            <th className="px-4 py-3 font-medium">Flaky</th>
            <th className="px-4 py-3 font-medium">Duration</th>
            <th className="px-4 py-3 font-medium">Completed</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
            >
              <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">
                {r.repository}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                <span className="font-mono text-xs">{r.workflow_name ?? "–"}</span>
                <span className="text-xs text-zinc-400"> #{r.github_run_id}</span>
              </td>
              <td className="px-4 py-2.5">
                <ConclusionBadge conclusion={r.conclusion} />
              </td>
              <td className="px-4 py-2.5 tabular-nums">{r.test_count}</td>
              <td className="px-4 py-2.5 tabular-nums">
                {r.flaky_count > 0 ? (
                  <span className="font-medium text-red-600">{r.flaky_count}</span>
                ) : (
                  <span className="text-zinc-400">0</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-zinc-500">
                {formatDuration(r.started_at, r.completed_at)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-zinc-500">
                {relativeTime(r.completed_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityFeed({ activity }: { activity: ActivityItem[] }) {
  const toneFor = (type: string) =>
    type === "flaky" ? "bg-red-500" : "bg-zinc-400";
  return (
    <ul className="space-y-1">
      {activity.map((a) => (
        <li key={a.key} className="flex items-start gap-3 text-sm">
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${toneFor(a.type)}`}
          />
          <div className="min-w-0">
            <span className="text-zinc-700">{a.message}</span>
            <span className="text-zinc-400"> · {a.repository}</span>
          </div>
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-zinc-400">
            {relativeTime(a.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
      <p className="text-base font-semibold text-zinc-900">
        No workflow data yet.
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
        Install FlakyGuard on a GitHub repository and run a GitHub Actions
        workflow — its test results will appear here. Or seed a local demo with{" "}
        <code className="font-mono text-xs">npm run demo</code>.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {INSTALL_URL ? (
          <a
            href={INSTALL_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Install GitHub App
          </a>
        ) : (
          <span
            className="cursor-not-allowed rounded-md bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-400"
            title="Set NEXT_PUBLIC_GITHUB_APP_INSTALL_URL to enable this button"
          >
            Install GitHub App
          </span>
        )}
        <a
          href="#connect"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Connect Repository
        </a>
      </div>
      <div id="connect" className="mx-auto mt-8 max-w-md text-left text-xs text-zinc-500">
        <p className="font-medium text-zinc-700">To connect a repository:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Install the FlakyGuard GitHub App on the repo.</li>
          <li>Add the upload step to a workflow (see{" "}
            <code className="font-mono">demo/.github/workflows/flakyguard-demo.yml</code>).</li>
          <li>Push a commit or run the workflow — results show up here.</li>
        </ol>
      </div>
    </div>
  );
}

function SignIn() {
  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <span className="h-3 w-3 rounded-full bg-red-500" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">FlakyGuard</h1>
        <p className="mt-2 text-sm text-zinc-500">Finds unreliable tests in CI.</p>
        <a
          href="/api/auth/login"
          className="mt-6 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Sign in with GitHub
        </a>
        <p className="mt-4 max-w-xs text-xs text-zinc-400">
          Sign in to see the repositories where you&apos;ve installed FlakyGuard.
        </p>
      </div>
    </main>
  );
}

export default async function DashboardPage() {
  let dashboard: Dashboard | null = null;
  let health: Health | null = null;
  let error: string | null = null;
  let signedOut = false;

  if (AUTH_ENABLED) {
    const cookieStore = await cookies();
    if (!cookieStore.get("flakyguard_session")?.value) {
      signedOut = true;
    }
  }

  if (!signedOut) {
    try {
      const [d, h] = await Promise.all([
        api<Dashboard>("/api/dashboard"),
        api<Health>("/api/health").catch(() => null),
      ]);
      dashboard = d;
      health = h;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (AUTH_ENABLED && message.includes("401")) {
        signedOut = true;
      } else {
        error = message;
      }
    }
  }

  if (signedOut) {
    return <SignIn />;
  }

  const hasData =
    dashboard !== null &&
    (dashboard.stats.total_tests > 0 || dashboard.recentRuns.length > 0);

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <h1 className="text-lg font-semibold tracking-tight">
                FlakyGuard
              </h1>
            </div>
            <p className="mt-0.5 text-sm text-zinc-500">
              Finds unreliable tests in CI.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-zinc-500 sm:block">
              {dashboard ? `${dashboard.stats.flaky_tests + dashboard.stats.critical_tests} flaky` : "–"}
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-200">
              {dashboard
                ? `${dashboard.stats.total_tests} tests`
                : "no data"}
            </span>
            {AUTH_ENABLED && (
              <a
                href="/api/auth/logout"
                className="text-sm text-zinc-500 hover:text-zinc-800"
              >
                Sign out
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <HealthStrip health={health} />

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <p className="font-semibold text-red-700">
              Unable to load workflow data.
            </p>
            <p className="mt-1 text-sm text-red-600">
              {error}
            </p>
            <p className="mt-2 text-xs text-red-500">
              Start the backend with <code className="font-mono">npm run dev</code>{" "}
              and ensure it listens on port 3000.
            </p>
          </div>
        ) : !hasData ? (
          <EmptyState />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <ReliabilityHero reliability={dashboard!.reliability} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 lg:col-span-2">
                <StatCard label="Total tests" value={dashboard!.stats.total_tests} />
                <StatCard
                  label="Flaky tests"
                  value={dashboard!.stats.flaky_tests}
                  tone="text-orange-500"
                />
                <StatCard
                  label="Critical tests"
                  value={dashboard!.stats.critical_tests}
                  tone="text-red-600"
                />
                <StatCard
                  label="Broken tests"
                  value={dashboard!.stats.broken_tests}
                  tone="text-fuchsia-600"
                />
                <StatCard
                  label="Tests analyzed"
                  value={dashboard!.stats.tests_analyzed}
                />
              </div>
            </div>

            <ActionCenter tests={dashboard!.mostFlakyTests} />

            <div className="grid gap-4 md:grid-cols-3">
              <TrendColumn
                title="Newly flaky"
                kind="new"
                items={dashboard!.newlyFlaky}
              />
              <TrendColumn
                title="Getting worse"
                kind="worse"
                items={dashboard!.trendingWorse}
              />
              <TrendColumn
                title="Getting better"
                kind="better"
                items={dashboard!.trendingBetter}
              />
            </div>

            <CiWasteCard waste={dashboard!.ciWaste} />

            <section>
              <h2 className="mb-3 text-sm font-semibold text-zinc-700">
                Recent workflow runs
              </h2>
              {dashboard!.recentRuns.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500">
                  No workflow runs recorded yet.
                </div>
              ) : (
                <RunsTable runs={dashboard!.recentRuns} />
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-zinc-700">
                Recent activity
              </h2>
              {dashboard!.recentActivity.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500">
                  No activity yet.
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
                  <ActivityFeed activity={dashboard!.recentActivity} />
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
