import Link from "next/link";
import { api, type RepoSummary } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { relativeTime } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function RepositoriesPage() {
  let repos: RepoSummary[] = [];
  let error: string | null = null;
  try {
    repos = (await api<{ data: RepoSummary[] }>("/api/repos")).data;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unable to load repositories.";
  }

  return <AppShell active="repositories"><main className="mx-auto max-w-[1100px] px-4 pb-16 pt-7 sm:px-6 lg:px-10"><header className="border-b border-[var(--border)] pb-6"><p className="eyebrow text-[var(--primary)]">Repositories</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Connected codebases.</h1><p className="mt-3 text-sm text-[var(--muted-foreground)]">A repository-level view of CI reliability and the tests demanding attention.</p></header>{error ? <div className="panel mt-6 p-5 text-sm text-[var(--danger)]">{error}</div> : repos.length === 0 ? <div className="panel-strong mt-6 p-10 text-center"><p className="text-lg font-semibold">Connect a GitHub repository to start monitoring CI reliability.</p></div> : <div className="mt-8 grid gap-3 md:grid-cols-2">{repos.map((repo) => <Link key={repo.id} href={`/repos/${repo.id}`} className="panel p-5 transition-colors hover:border-[var(--primary)]"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="technical truncate text-sm font-semibold">{repo.full_name}</p><p className="mt-2 text-xs text-[var(--muted-foreground)]">last workflow {relativeTime(repo.last_run_at)}</p></div><span className="technical text-xs text-[var(--info)]">open →</span></div><div className="mt-6 grid grid-cols-4 gap-3 border-t border-[var(--border)] pt-4"><Metric label="tests" value={repo.total_tests} /><Metric label="flaky" value={repo.flaky_tests} tone="text-[var(--primary)]" /><Metric label="critical" value={repo.critical_tests} tone="text-[var(--danger)]" /><Metric label="broken" value={repo.broken_tests} tone="text-[var(--danger)]" /></div></Link>)}</div>}</main></AppShell>;
}

function Metric({ label, value, tone = "text-[var(--foreground)]" }: { label: string; value: number; tone?: string }) {
  return <div><p className={`technical text-lg font-bold ${tone}`}>{value}</p><p className="mt-1 text-[10px] text-[var(--muted-foreground)]">{label}</p></div>;
}
