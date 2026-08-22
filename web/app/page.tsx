import Link from "next/link";
import { api, type RepoSummary } from "@/lib/api";
import { relativeTime } from "@/lib/ui";

export const dynamic = "force-dynamic";

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
      <div className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

export default async function ReposPage() {
  let repos: RepoSummary[] = [];
  let error: string | null = null;

  try {
    const res = await api<{ data: RepoSummary[] }>("/api/repos");
    repos = res.data;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">FlakyGuard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Which test do I fix first?
          </p>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-200">
          {repos.length} repo{repos.length === 1 ? "" : "s"}
        </span>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not reach the FlakyGuard API. Is the backend running on port
          3000? <code className="font-mono text-xs">npm run dev</code>
          <div className="mt-1 font-mono text-xs opacity-70">{error}</div>
        </div>
      )}

      {!error && repos.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
          <p className="font-medium">No repositories yet</p>
          <p className="mt-1 text-sm text-zinc-500">
            Install the GitHub App and push a commit — repos appear here after
            the first workflow run.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {repos.map((repo) => {
          const problem = repo.critical_tests + repo.flaky_tests;
          return (
            <Link
              key={repo.id}
              href={`/repos/${repo.id}`}
              className="group rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-medium group-hover:underline">
                  {repo.full_name}
                </h2>
                {problem > 0 && (
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
                    {problem} flaky+
                  </span>
                )}
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                <StatCard label="tests" value={repo.total_tests} />
                <StatCard
                  label="critical"
                  value={repo.critical_tests}
                  tone="text-red-600"
                />
                <StatCard
                  label="flaky"
                  value={repo.flaky_tests}
                  tone="text-orange-500"
                />
                <StatCard
                  label="watch"
                  value={repo.watch_tests}
                  tone="text-amber-500"
                />
              </div>

              <p className="mt-3 text-xs text-zinc-400">
                last run {relativeTime(repo.last_run_at)}
              </p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
