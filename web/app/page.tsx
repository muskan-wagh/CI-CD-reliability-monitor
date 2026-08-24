import Link from "next/link";
import { cookies } from "next/headers";
import {
  api,
  type ActivityItem,
  type CiWaste,
  type Dashboard,
  type FlakyTestRow,
  type Health,
  type RepoSummary,
  type Reliability,
  type RecentRun,
  type TrendItem,
} from "@/lib/api";
import { CategoryBadge, ConclusionBadge, Ribbon } from "@/lib/components";
import CreateIssueButton from "@/components/CreateIssueButton";
import MuteButton from "@/components/MuteButton";
import AppShell from "@/components/AppShell";
import { formatDuration, formatMs, healthTone, pct, relativeTime } from "@/lib/ui";

export const dynamic = "force-dynamic";

const INSTALL_URL = process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL ?? "";
const AUTH_ENABLED = Boolean(process.env.SESSION_SECRET);

function SectionHeading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--foreground)]">
          {title}
        </h2>
      </div>
      {detail && <span className="technical text-[10px] text-[var(--muted-foreground)]">{detail}</span>}
    </div>
  );
}

function Stat({ label, value, tone = "text-[var(--foreground)]" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="border-l border-[var(--border)] pl-3 first:border-0 first:pl-0">
      <div className={`technical text-xl font-bold ${tone}`}>{value}</div>
      <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{label}</div>
    </div>
  );
}

function HealthStrip({ health }: { health: Health | null }) {
  const checks = health
    ? [
        ["GitHub App", health.checks.githubApp.status],
        ["Database", health.checks.database.status],
        ["Webhook", health.checks.webhook.status],
        ["Ingestion", health.checks.ingestion.status],
        ["Scoring", health.checks.scoring.status],
      ]
    : [["GitHub App", "unknown"], ["Database", "down"], ["Webhook", "unknown"], ["Ingestion", "unknown"], ["Scoring", "unknown"]];

  return (
    <div className="panel flex flex-wrap gap-x-5 gap-y-3 px-4 py-3">
      {checks.map(([label, status]) => {
        const tone = healthTone(status);
        return (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            <span className="text-[var(--muted-foreground)]">{label}</span>
            <span className={`technical text-[10px] uppercase ${tone.text}`}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReliabilityHero({ reliability }: { reliability: Reliability }) {
  const delta = reliability.score !== null && reliability.previous !== null ? reliability.score - reliability.previous : null;
  const scoreTone = "text-[var(--foreground)]";
  const scoreIndicator = reliability.score === null ? "bg-[var(--subtle)]" : reliability.score < 60 ? "bg-[var(--danger)]" : reliability.score < 85 ? "bg-[var(--warning)]" : "bg-[var(--success)]";
  return (
    <div className="panel-strong p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${scoreIndicator}`} />CI reliability</p>
          <p className="mt-2 max-w-[28ch] text-sm leading-6 text-[var(--muted-foreground)]">
            A single signal for how trustworthy the last analyzed test history is.
          </p>
        </div>
        <span className="technical text-[10px] text-[var(--muted-foreground)]">LIVE MODEL</span>
      </div>
      <div className="mt-7 flex items-end gap-2">
        <span className={`technical text-6xl font-bold leading-none tracking-[-0.08em] ${scoreTone}`}>
          {reliability.score ?? "–"}
        </span>
        <span className="technical mb-1 text-sm text-[var(--muted-foreground)]">/ 100</span>
        <div className="signal-bars ml-auto flex h-10 items-end gap-1" aria-label="Reliability trend">
          {[13, 23, 9, 18, 12, 27, 21, 32].map((height, index) => <span key={index} style={{ height: `${height}px` }} />)}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <span className="text-[var(--muted-foreground)]">{reliability.analyzed} analyzed tests</span>
        {delta !== null && delta !== 0 && (
          <span className={delta > 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)} since last scan
          </span>
        )}
      </div>
    </div>
  );
}

function ActionCard({ test, rank }: { test: FlakyTestRow; rank: number }) {
  const ai = test.ai_result;
  const isProblem = test.category === "critical" || test.category === "broken";
  return (
    <article className="panel overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 border-b border-[var(--border)] px-4 py-4 md:px-5">
        <div className={`technical flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-xs font-bold ${isProblem ? "bg-[var(--danger)] text-[var(--background)]" : "bg-[var(--primary)] text-[var(--background)]"}`}>
          {String(rank).padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/tests/${test.id}`} className="truncate text-base font-semibold text-[var(--foreground)] hover:text-[var(--primary)]">
              {test.name || "Unnamed test"}
            </Link>
            <CategoryBadge category={test.category} />
          </div>
          <p className="technical mt-1 truncate text-[11px] text-[var(--muted-foreground)]">
            {test.repository} / {test.file_path}
          </p>
        </div>
        <div className="text-right">
          <div className="technical text-2xl font-bold text-[var(--foreground)]">{test.score}</div>
          <div className="technical text-[10px] uppercase text-[var(--muted-foreground)]">flake score</div>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_1fr] md:px-5">
        <div>
          <p className="eyebrow">Deterministic signal</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <p className="technical text-lg font-bold text-[var(--danger)]">{pct(test.failure_rate)}</p>
              <p className="text-[10px] text-[var(--muted-foreground)]">failure rate</p>
            </div>
            <div>
              <p className="technical text-lg font-bold text-[var(--foreground)]">{test.failure_count}/{test.window_size}</p>
              <p className="text-[10px] text-[var(--muted-foreground)]">runs failed</p>
            </div>
            <div>
              <p className="technical text-lg font-bold text-[var(--foreground)]">{pct(test.transition_rate)}</p>
              <p className="text-[10px] text-[var(--muted-foreground)]">flip rate</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Ribbon outcomes={test.recent_status} />
            <span className="text-[10px] text-[var(--muted-foreground)]">oldest → newest</span>
          </div>
        </div>

        <div className="border-t border-[var(--border)] pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
          <p className="eyebrow">Why</p>
          <p className="mt-2 text-sm font-medium text-[var(--foreground)]">
            {test.top_error_class ?? "No failure signature recorded"}
          </p>
          <p className="mt-1 line-clamp-2 font-mono text-xs leading-5 text-[var(--muted-foreground)]">
            {test.top_sample_message ?? "Open the investigation to inspect the available evidence."}
          </p>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Became unreliable: <span className="text-[var(--foreground)]">{relativeTime(test.first_unreliable_at ?? null)}</span>
          </p>
        </div>
      </div>

      <div className="grid gap-3 border-t border-[var(--border)] px-4 py-4 md:grid-cols-2 md:px-5">
        <div className="rounded-sm bg-[var(--card-elevated)] p-3">
          <p className="eyebrow">AI investigation</p>
          {ai ? (
            <>
              <p className="mt-2 text-sm text-[var(--foreground)]">{ai.likely_cause || ai.summary}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                {ai.classification ?? "UNKNOWN"} · {Math.round((test.ai_confidence ?? 0) * 100)}% confidence
              </p>
              {ai.recommended_actions[0] && <p className="mt-2 text-xs text-[var(--info)]">Next: {ai.recommended_actions[0]}</p>}
            </>
          ) : (
            <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
              Not investigated yet. The deterministic signal is still valid.
            </p>
          )}
        </div>
        <div className="rounded-sm bg-[var(--card-elevated)] p-3">
          <p className="eyebrow">What changed</p>
          {test.first_failure_pr_number ? (
            <p className="mt-2 text-xs leading-5 text-[var(--foreground)]">
              Reliability degradation was first observed after PR #{test.first_failure_pr_number}{test.first_failure_pr_title ? ` — ${test.first_failure_pr_title}` : ""}.
            </p>
          ) : test.first_failure_sha ? (
            <p className="mt-2 text-xs leading-5 text-[var(--foreground)]">
              First failure recorded at commit <span className="technical">{test.first_failure_sha.slice(0, 7)}</span>.
            </p>
          ) : (
            <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">No commit or PR correlation available.</p>
          )}
          {test.first_failure_changed_files && test.first_failure_changed_files.length > 0 && <p className="mt-2 truncate font-mono text-[10px] text-[var(--muted-foreground)]">Changed: {test.first_failure_changed_files.slice(0, 2).join(", ")}{test.first_failure_changed_files.length > 2 ? ` +${test.first_failure_changed_files.length - 2}` : ""}</p>}
          <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">Correlation is evidence, not causation.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3 md:px-5">
        <Link href={`/tests/${test.id}`} className="rounded-sm bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--background)] hover:brightness-110">
          Investigate
        </Link>
        <CreateIssueButton testId={test.id} />
        <MuteButton testId={test.id} initial={null} />
        {test.first_failure_pr_number && (
          <a href={`https://github.com/${test.repository}/pull/${test.first_failure_pr_number}`} target="_blank" rel="noreferrer" className="rounded-sm px-2 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            View PR ↗
          </a>
        )}
        {test.first_failure_sha && (
          <a href={`https://github.com/${test.repository}/commit/${test.first_failure_sha}`} target="_blank" rel="noreferrer" className="rounded-sm px-2 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            View commit ↗
          </a>
        )}
      </div>
    </article>
  );
}

function TrendList({ title, items, kind }: { title: string; items: TrendItem[]; kind: "new" | "worse" | "better" }) {
  const accent = kind === "better" ? "text-[var(--success)]" : kind === "new" ? "text-[var(--danger)]" : "text-[var(--warning)]";
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
        <span className={`technical text-[10px] ${accent}`}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-6 text-xs text-[var(--muted-foreground)]">Nothing to report.</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {items.slice(0, 5).map((item) => (
            <li key={item.id} className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <Link href={`/tests/${item.id}`} className="truncate text-sm font-medium text-[var(--foreground)] hover:text-[var(--primary)]">{item.name}</Link>
                <span className={`technical shrink-0 text-xs font-semibold ${accent}`}>
                  {kind === "new" ? item.score : `${kind === "better" ? "−" : "+"}${item.delta}`}
                </span>
              </div>
              <p className="technical mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{item.repository}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Repositories({ repos }: { repos: RepoSummary[] }) {
  return (
    <section id="repositories">
      <SectionHeading eyebrow="Repositories" title="Connected codebases" detail={`${repos.length} connected`} />
      <div className="grid gap-2 md:grid-cols-2">
        {repos.map((repo) => (
          <Link key={repo.id} href={`/repos/${repo.id}`} className="panel flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:border-[var(--primary)]">
            <div className="min-w-0">
              <p className="technical truncate text-xs font-semibold text-[var(--foreground)]">{repo.full_name}</p>
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">last run {relativeTime(repo.last_run_at)}</p>
            </div>
            <div className="flex shrink-0 gap-3 text-right">
              <div><p className="technical text-sm font-bold text-[var(--danger)]">{repo.critical_tests + repo.broken_tests}</p><p className="text-[9px] text-[var(--muted-foreground)]">urgent</p></div>
              <div><p className="technical text-sm font-bold text-[var(--foreground)]">{repo.total_tests}</p><p className="text-[9px] text-[var(--muted-foreground)]">tests</p></div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Runs({ runs }: { runs: RecentRun[] }) {
  return (
    <section>
      <SectionHeading eyebrow="Workflow signal" title="Recent runs" detail="latest 12" />
      <div className="grid gap-2 md:hidden">
        {runs.map((run) => (
          <div key={run.id} className="panel grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
            <div className="min-w-0"><p className="truncate text-sm text-[var(--foreground)]">{run.repository}</p><p className="technical mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{run.workflow_name ?? "unknown"} · #{run.github_run_id}</p></div>
            <div className="text-right"><ConclusionBadge conclusion={run.conclusion} /><p className="mt-1 text-[10px] text-[var(--muted-foreground)]">{run.test_count} tests · {formatDuration(run.started_at, run.completed_at)}</p></div>
          </div>
        ))}
      </div>
      <div className="panel hidden overflow-x-auto md:block">
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]"><tr><th className="px-4 py-3 font-medium">Repository</th><th className="px-4 py-3 font-medium">Workflow</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Tests</th><th className="px-4 py-3 font-medium">Duration</th><th className="px-4 py-3 font-medium">Completed</th></tr></thead>
          <tbody>{runs.map((run) => <tr key={run.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--card-elevated)]"><td className="px-4 py-3 text-[var(--muted-foreground)]">{run.repository}</td><td className="technical px-4 py-3 text-[var(--foreground)]">{run.workflow_name ?? "unknown"} <span className="text-[var(--muted-foreground)]">#{run.github_run_id}</span></td><td className="px-4 py-3"><ConclusionBadge conclusion={run.conclusion} /></td><td className="technical px-4 py-3 text-[var(--foreground)]">{run.test_count}</td><td className="technical px-4 py-3 text-[var(--muted-foreground)]">{formatDuration(run.started_at, run.completed_at)}</td><td className="px-4 py-3 text-[var(--muted-foreground)]">{relativeTime(run.completed_at)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function Activity({ items }: { items: ActivityItem[] }) {
  return (
    <section id="activity">
      <SectionHeading eyebrow="Change log" title="Recent reliability changes" />
      <div className="panel px-4 py-3">
        {items.length === 0 ? <p className="py-4 text-xs text-[var(--muted-foreground)]">No reliability changes recorded yet.</p> : <ul className="divide-y divide-[var(--border)]">{items.slice(0, 10).map((item) => <li key={item.key} className="flex gap-3 py-3 first:pt-1 last:pb-1"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${item.type === "flaky" ? "bg-[var(--danger)]" : "bg-[var(--info)]"}`} /><div className="min-w-0 flex-1"><p className="text-sm text-[var(--foreground)]">{item.message}</p><p className="technical mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{item.repository}</p></div><span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{relativeTime(item.at)}</span></li>)}</ul>}
      </div>
    </section>
  );
}

function Waste({ waste }: { waste: CiWaste }) {
  const share = waste.totalDurationMs > 0 ? Math.round((waste.flakyDurationMs / waste.totalDurationMs) * 100) : 0;
  return (
    <section>
      <SectionHeading eyebrow="Measured impact" title="CI waste" detail={`last ${waste.windowDays} days`} />
      <div className="panel grid gap-5 p-4 sm:grid-cols-4">
        <div><p className="technical text-2xl font-bold text-[var(--warning)]">{formatMs(waste.flakyDurationMs)}</p><p className="mt-1 text-[11px] text-[var(--muted-foreground)]">test time on unreliable tests</p></div>
        <div><p className="technical text-2xl font-bold text-[var(--foreground)]">{waste.affectedRuns}</p><p className="mt-1 text-[11px] text-[var(--muted-foreground)]">affected pipeline runs</p></div>
        <div><p className="technical text-2xl font-bold text-[var(--foreground)]">{waste.recoveredFailures}</p><p className="mt-1 text-[11px] text-[var(--muted-foreground)]">fail → pass recoveries</p></div>
        <div><p className="technical text-2xl font-bold text-[var(--foreground)]">{share}%</p><p className="mt-1 text-[11px] text-[var(--muted-foreground)]">of measured test time</p></div>
      </div>
      <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">Measured from recorded durations. No monetary cost is estimated.</p>
    </section>
  );
}

function EmptyState() {
  return <div className="panel-strong px-6 py-16 text-center"><p className="eyebrow">No signal yet</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">Connect a repository to start monitoring CI reliability.</h2><p className="mx-auto mt-3 max-w-[52ch] text-sm leading-6 text-[var(--muted-foreground)]">FlakyGuard needs a GitHub App installation and a workflow upload step before it can show evidence.</p>{INSTALL_URL && <a href={INSTALL_URL} target="_blank" rel="noreferrer" className="mt-7 inline-block rounded-sm bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--background)]">Install FlakyGuard</a>}</div>;
}

function SignIn() {
  return <main className="flex min-h-screen items-center justify-center px-6"><div className="max-w-sm text-center"><span className="mx-auto block h-3 w-3 bg-[var(--primary)]" /><p className="technical mt-5 text-sm font-bold tracking-[0.16em]">FLAKYGUARD</p><h1 className="mt-4 text-2xl font-semibold">Your CI evidence, in one place.</h1><a href="/api/auth/login" className="mt-7 inline-block rounded-sm bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--background)]">Sign in with GitHub</a></div></main>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = [7, 30, 90].includes(Number(raw)) ? Number(raw) : 30;
  let dashboard: Dashboard | null = null;
  let health: Health | null = null;
  let repos: RepoSummary[] = [];
  let error: string | null = null;
  let signedOut = false;

  if (AUTH_ENABLED && !(await cookies()).get("flakyguard_session")?.value) signedOut = true;
  if (!signedOut) {
    try {
      const [d, h, r] = await Promise.all([
        api<Dashboard>(`/api/dashboard?days=${days}`),
        api<Health>("/api/health").catch(() => null),
        api<{ data: RepoSummary[] }>("/api/repos"),
      ]);
      dashboard = d;
      health = h;
      repos = r.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      signedOut = AUTH_ENABLED && message.includes("401");
      if (!signedOut) error = message;
    }
  }
  if (signedOut) return <SignIn />;
  const hasData = dashboard !== null && (dashboard.stats.total_tests > 0 || dashboard.recentRuns.length > 0);

  return <AppShell active="overview"><main className="mx-auto max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-10">
     <header className="mb-7 flex flex-wrap items-end justify-between gap-5">
       <div><p className="eyebrow">Overview</p><h1 className="mt-2 max-w-[18ch] text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">Fix the test, not the build.</h1><p className="mt-3 max-w-[55ch] text-sm leading-6 text-[var(--muted-foreground)]">Find the unreliable test, understand the evidence, and take the next action without hunting through CI logs.</p></div>
       {dashboard && <div className="panel open-signals w-full px-5 py-4 sm:w-[286px]"><div className="flex items-center justify-between gap-4"><p className="text-sm font-semibold text-[var(--foreground)]">Open signals</p><span className="text-xs text-[var(--muted-foreground)]">View all ↗</span></div><p className="technical mt-2 text-3xl font-bold text-[var(--danger)]">{dashboard.stats.flaky_tests + dashboard.stats.critical_tests + dashboard.stats.broken_tests}</p></div>}
     </header>
    <HealthStrip health={health} />
    {error ? <div className="panel mt-6 border-[var(--danger)] p-5"><p className="font-semibold text-[var(--danger)]">Unable to load reliability data.</p><p className="technical mt-2 text-xs text-[var(--muted-foreground)]">{error}</p></div> : !hasData ? <div className="mt-6"><EmptyState /></div> : <div className="mt-8 grid gap-10">
      <section id="action-center" className="grid gap-4 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]"><ReliabilityHero reliability={dashboard!.reliability} /><div className="panel grid grid-cols-2 gap-5 p-5 sm:grid-cols-5 sm:items-center"><Stat label="Total tests" value={dashboard!.stats.total_tests} /><Stat label="Flaky" value={dashboard!.stats.flaky_tests} tone="text-[var(--primary)]" /><Stat label="Critical" value={dashboard!.stats.critical_tests} tone="text-[var(--danger)]" /><Stat label="Broken" value={dashboard!.stats.broken_tests} tone="text-[var(--danger)]" /><Stat label="Analyzed" value={dashboard!.stats.tests_analyzed} /></div></section>
      <section id="fix-first"><SectionHeading eyebrow="Action center" title="Fix first" detail={`${dashboard!.mostFlakyTests.length} prioritized signals`} />{dashboard!.mostFlakyTests.length === 0 ? <div className="panel-strong p-8"><p className="text-base font-semibold text-[var(--success)]">Your CI looks healthy.</p><p className="mt-2 text-sm text-[var(--muted-foreground)]">No unreliable tests detected in the analyzed history.</p></div> : <div className="grid gap-4 xl:grid-cols-2">{dashboard!.mostFlakyTests.slice(0, 6).map((test, i) => <ActionCard key={test.id} test={test} rank={i + 1} />)}</div>}</section>
      {dashboard!.mutedTests.length > 0 && <div className="panel border-[var(--warning)] p-4"><p className="eyebrow text-[var(--warning)]">Acknowledged signals</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">{dashboard!.mutedTests.length} muted or quarantined tests are still analyzed but hidden from Fix first.</p></div>}
      <section id="investigations"><SectionHeading eyebrow="Movement" title="Reliability changes" detail="score snapshots" /><div className="grid gap-4 lg:grid-cols-3"><TrendList title="Newly flaky" kind="new" items={dashboard!.newlyFlaky} /><TrendList title="Getting worse" kind="worse" items={dashboard!.trendingWorse} /><TrendList title="Getting better" kind="better" items={dashboard!.trendingBetter} /></div></section>
      <Waste waste={dashboard!.ciWaste} />
      <Repositories repos={repos} />
      <Runs runs={dashboard!.recentRuns} />
      <Activity items={dashboard!.recentActivity} />
    </div>}
  </main></AppShell>;
}
