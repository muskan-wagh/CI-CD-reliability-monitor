import Link from "next/link";
import { api, type TestHistory } from "@/lib/api";
import { CategoryBadge, Ribbon } from "@/lib/components";
import { pct } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function TestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let history: TestHistory;
  try {
    history = await api<TestHistory>(`/api/tests/${id}/history`);
  } catch {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-red-600">Could not load test {id}.</p>
      </main>
    );
  }

  const { test, score, outcomes, signatures } = history;
  // newest-first from the API -> oldest-first for the timeline ribbon
  const timeline = [...outcomes].reverse();
  const isBroken = score?.category === "broken";

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href={`/repos/${test.repository_id}`}
        className="text-sm text-zinc-500 hover:text-zinc-800"
      >
        ← {test.repository_full_name}
      </Link>

      <header className="mb-6 mt-3">
        <h1 className="text-xl font-semibold tracking-tight">
          {test.name || "(unnamed)"}
        </h1>
        <p className="mt-1 font-mono text-xs text-zinc-500">{test.file_path}</p>
      </header>

      {isBroken && (
        <div className="mb-6 rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-4 text-sm text-fuchsia-800">
          <b>Consistent failure.</b> This test has failed its last runs in a
          row — this is not flakiness, it&apos;s breakage.
        </div>
      )}

      {/* Current score */}
      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Score" value={score?.score ?? "–"} big />
        <Card label="Category">
          <CategoryBadge category={score?.category ?? null} />
        </Card>
        <Card
          label="Failure rate"
          value={pct(score?.failure_rate)}
          sub={
            score ? `${score.failure_count}/${score.window_size} runs` : undefined
          }
        />
        <Card
          label="Transition rate"
          value={pct(score?.transition_rate)}
          sub="PASS↔FAIL flips"
        />
      </section>

      {/* Timeline */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          Outcome timeline ({timeline.length})
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-zinc-500">No runs recorded yet.</p>
        ) : (
          <>
            <Ribbon outcomes={timeline.map((o) => o.status)} size="lg" />
            <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-zinc-500">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Duration</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium">Commit</th>
                    <th className="px-3 py-2 font-medium">Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.map((o, i) => (
                    <tr key={i} className="border-b border-zinc-100 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                        {new Date(o.executed_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${
                            o.status === "failed"
                              ? "bg-red-500"
                              : o.status === "skipped"
                                ? "bg-zinc-300"
                                : "bg-emerald-500"
                          }`}
                        />
                        {o.status}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-zinc-500">
                        {o.duration_ms !== null ? `${o.duration_ms}ms` : "–"}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">
                        {o.head_branch ?? "–"}
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-400">
                        {o.head_sha ? o.head_sha.slice(0, 7) : "–"}
                      </td>
                      <td
                        className="max-w-[240px] truncate px-3 py-2 text-red-600"
                        title={`${o.error_class ?? ""}: ${o.sample_message ?? ""}`}
                      >
                        {o.error_class ? `${o.error_class}: ${o.sample_message}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Failure patterns grouped by signature */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          Failure patterns ({signatures.length})
        </h2>
        {signatures.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No failure signatures — this test hasn&apos;t failed.
          </p>
        ) : (
          <ul className="space-y-2">
            {signatures.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600">
                    {s.error_class}
                  </span>
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600 ring-1 ring-inset ring-red-100">
                    ×{s.times_seen_on_test} on this test · ×{s.occurrence_count}{" "}
                    total
                  </span>
                </div>
                <p className="mt-1 break-words font-mono text-xs text-zinc-500">
                  {s.sample_message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Card({
  label,
  value,
  children,
  sub,
  big,
}: {
  label: string;
  value?: string | number;
  children?: React.ReactNode;
  sub?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div
        className={`font-semibold tabular-nums ${big ? "text-2xl" : "text-lg"}`}
      >
        {children ?? value}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
      {sub && <div className="text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}
