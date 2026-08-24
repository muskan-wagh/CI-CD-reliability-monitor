import Link from "next/link";
import { api, type Dashboard, type RepoClusters, type RepoDetail } from "@/lib/api";
import { CategoryBadge, ConclusionBadge, Ribbon } from "@/lib/components";
import AppShell from "@/components/AppShell";
import { formatDuration, pct, relativeTime } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function RepoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail: RepoDetail;
  let clusters: RepoClusters | null = null;
  let overview: Dashboard | null = null;
  try {
    detail = await api<RepoDetail>(`/api/repos/${id}/tests`);
    [clusters, overview] = await Promise.all([
      api<RepoClusters>(`/api/repos/${id}/clusters`).catch(() => null),
      api<Dashboard>("/api/dashboard?days=30").catch(() => null),
    ]);
  } catch {
    return <AppShell active="repositories"><main className="mx-auto max-w-5xl px-5 py-12"><div className="panel p-6"><p className="font-semibold text-[var(--danger)]">Unable to load this repository.</p><Link href="/repos" className="mt-4 inline-block text-sm text-[var(--info)]">Return to repositories</Link></div></main></AppShell>;
  }

  const { repo, data } = detail;
  const analyzed = data.filter((test) => test.score !== null);
  const reliability = analyzed.length ? Math.round(analyzed.reduce((sum, test) => sum + (100 - (test.score ?? 0)), 0) / analyzed.length) : null;
  const count = (category: string) => data.filter((test) => test.category === category).length;
  const runs = overview?.recentRuns.filter((run) => run.repository === repo.full_name).slice(0, 8) ?? [];

  return <AppShell active="repositories"><main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-6 lg:px-10">
    <Link href="/repos" className="technical text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] hover:text-[var(--foreground)]">← repositories</Link>
    <header className="mt-5 flex flex-wrap items-end justify-between gap-5 border-b border-[var(--border)] pb-6"><div><p className="eyebrow text-[var(--primary)]">Repository investigation</p><h1 className="mt-2 break-all text-2xl font-semibold tracking-[-0.03em]">{repo.full_name}</h1><p className="mt-2 text-sm text-[var(--muted-foreground)]">Which tests are making this repository unreliable?</p></div><div className="text-right"><p className="eyebrow flex items-center justify-end gap-2"><span className={`h-1.5 w-1.5 rounded-full ${reliability === null ? "bg-[var(--subtle)]" : reliability < 60 ? "bg-[var(--danger)]" : reliability < 85 ? "bg-[var(--warning)]" : "bg-[var(--success)]"}`} />Reliability</p><p className="technical mt-1 text-4xl font-bold text-[var(--foreground)]">{reliability ?? "–"}<span className="ml-1 text-sm font-normal text-[var(--muted)]">/100</span></p><p className="mt-1 text-[10px] text-[var(--muted)]">{analyzed.length} analyzed tests</p></div></header>

    <section className="grid gap-3 py-6 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Total tests" value={data.length} /><Metric label="Flaky" value={count("flaky")} tone="text-[var(--primary)]" /><Metric label="Critical" value={count("critical")} tone="text-[var(--danger)]" /><Metric label="Broken" value={count("broken")} tone="text-[var(--danger)]" /><Metric label="No evidence" value={count("insufficient")} tone="text-[var(--muted-foreground)]" /></section>

    {clusters && clusters.totalFailures > 0 && <section className="mb-8"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Root-cause view</p><h2 className="mt-1 text-xl font-semibold">Failure clusters</h2></div><span className="text-xs text-[var(--muted-foreground)]">{clusters.totalFailures} recorded failures</span></div><div className="grid gap-2 md:grid-cols-3">{clusters.clusters.map((cluster) => <div key={cluster.error_class} className="panel p-4"><p className="technical text-sm font-semibold text-[var(--danger)]">{cluster.error_class}</p><p className="mt-3 technical text-2xl font-bold">{cluster.share_pct}%</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{cluster.failures} failures in this repository</p></div>)}</div></section>}

    <section className="mb-8"><div className="mb-3 flex items-end justify-between gap-3"><div><p className="eyebrow">Triage queue</p><h2 className="mt-1 text-xl font-semibold">Worst tests</h2></div><span className="technical text-[10px] text-[var(--muted-foreground)]">sorted by score</span></div>{data.length === 0 ? <div className="panel p-8 text-sm text-[var(--muted-foreground)]">No test results recorded yet.</div> : <div className="grid gap-3 lg:grid-cols-2">{data.slice(0, 10).map((test) => <Link key={test.id} href={`/tests/${test.id}`} className="panel grid grid-cols-[1fr_auto] gap-4 p-4 transition-colors hover:border-[var(--primary)]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold">{test.name || "Unnamed test"}</span><CategoryBadge category={test.category} />{test.mute && <span className="technical text-[10px] text-[var(--warning)]">{test.mute.kind}</span>}</div><p className="technical mt-2 truncate text-[10px] text-[var(--muted-foreground)]">{test.file_path}</p><p className="mt-2 truncate text-xs text-[var(--muted-foreground)]">{test.top_error_class ?? "No failure signature"}: {test.top_sample_message ?? "No failure message recorded"}</p><div className="mt-3"><Ribbon outcomes={test.recent_outcomes} /></div></div><div className="text-right"><p className="technical text-2xl font-bold">{test.score ?? "–"}</p><p className="mt-1 technical text-[10px] text-[var(--muted-foreground)]">{pct(test.failure_rate)} fail</p></div></Link>)}</div>}</section>

    <section><div className="mb-3"><p className="eyebrow">Workflow signal</p><h2 className="mt-1 text-xl font-semibold">Recent runs</h2></div>{runs.length === 0 ? <div className="panel p-6 text-sm text-[var(--muted-foreground)]">No recent workflow runs for this repository.</div> : <div className="grid gap-2">{runs.map((run) => <div key={run.id} className="panel grid grid-cols-[1fr_auto] gap-3 px-4 py-3"><div><p className="technical text-xs">{run.workflow_name ?? "unknown workflow"} <span className="text-[var(--muted-foreground)]">#{run.github_run_id}</span></p><p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{run.test_count} tests · {run.failed_count} failed · {formatDuration(run.started_at, run.completed_at)}</p></div><div className="text-right"><ConclusionBadge conclusion={run.conclusion} /><p className="mt-1 text-[10px] text-[var(--muted-foreground)]">{relativeTime(run.completed_at)}</p></div></div>)}</div>}</section>
  </main></AppShell>;
}

function Metric({ label, value, tone = "text-[var(--foreground)]" }: { label: string; value: number | string; tone?: string }) {
  return <div className="panel p-4"><p className={`technical text-2xl font-bold ${tone}`}>{value}</p><p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{label}</p></div>;
}
