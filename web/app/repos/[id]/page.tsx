import Link from "next/link";
import { api, type RepoDetail } from "@/lib/api";
import { CategoryBadge, Ribbon } from "@/lib/components";
import { pct, relativeTime } from "@/lib/ui";

export const dynamic = "force-dynamic";

function Delta({ score, previous }: { score: number; previous: number | null }) {
  if (previous === null || previous === undefined || previous === score) {
    return null;
  }
  const diff = score - previous;
  const up = diff > 0;
  return (
    <span
      className={`ml-1 text-xs font-medium ${up ? "text-red-500" : "text-emerald-600"}`}
      title={`previous score ${previous}`}
    >
      {up ? "↑" : "↓"}
      {Math.abs(diff)}
    </span>
  );
}

export default async function RepoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: RepoDetail;
  try {
    detail = await api<RepoDetail>(`/api/repos/${id}/tests`);
  } catch {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-red-600">
          Could not load repo {id}. Is the API running?
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline">
          ← back
        </Link>
      </main>
    );
  }

  const { repo, data } = detail;
  const count = (c: string) => data.filter((t) => t.category === c).length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
        ← repositories
      </Link>

      <header className="mb-6 mt-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {repo.full_name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{data.length} tests tracked</p>
      </header>

      {data.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
          <p className="font-medium">Not enough data yet</p>
          <p className="mt-1 max-w-md text-sm text-zinc-500">
            FlakyGuard needs at least 8 runs per test before it can score.
            Push a few more PRs with the flakyguard action uploading JUnit
            reports.
          </p>
        </div>
      )}

      {data.length > 0 && (
        <>
          {/* Triage funnel */}
          <div className="mb-6 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span><b className="text-fuchsia-600">{count("broken")}</b> broken</span>
            <span><b className="text-red-600">{count("critical")}</b> critical</span>
            <span><b className="text-orange-500">{count("flaky")}</b> flaky</span>
            <span><b className="text-amber-500">{count("watch")}</b> watch</span>
            <span><b>{count("stable")}</b> stable</span>
            <span><b className="text-zinc-400">{count("insufficient")}</b> no data</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Last 20 runs</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Test</th>
                  <th className="px-4 py-3 font-medium">Fail rate</th>
                  <th className="px-4 py-3 font-medium">Last failed</th>
                  <th className="px-4 py-3 font-medium">Top failure</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3">
                      <Ribbon outcomes={t.recent_outcomes} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">
                      {t.score ?? "–"}
                      {t.score !== null && (
                        <Delta score={t.score} previous={t.previous_score} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <CategoryBadge category={t.category} />
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <Link
                        href={`/tests/${t.id}`}
                        className="font-medium hover:underline"
                      >
                        {t.name || "(unnamed)"}
                      </Link>
                      <div className="truncate text-xs text-zinc-400">
                        {t.file_path}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {pct(t.failure_rate)}
                      {t.window_size !== null && (
                        <span className="text-xs text-zinc-400">
                          {" "}
                          ({t.failure_count}/{t.window_size})
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                      {relativeTime(t.last_failed_at)}
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      {t.top_sample_message ? (
                        <>
                          <span className="text-xs font-medium text-zinc-600">
                            {t.top_error_class}
                          </span>
                          <div className="truncate text-xs text-zinc-400" title={t.top_sample_message}>
                            {t.top_sample_message}
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-300">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
