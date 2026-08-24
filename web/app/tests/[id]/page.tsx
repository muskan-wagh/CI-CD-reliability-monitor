import Link from "next/link";
import {
  api,
  type LatestInvestigation,
  type TestHistory,
  type TimelineEvent,
} from "@/lib/api";
import { CategoryBadge, Ribbon } from "@/lib/components";
import { confidence, pct, relativeTime } from "@/lib/ui";
import AiPanel from "./AiPanel";

export const dynamic = "force-dynamic";

function recommendations(
  category: string | undefined,
  topErrorClass: string | undefined,
): string[] {
  const out: string[] = [];
  if (category === "broken") {
    out.push(
      "This test has failed consistently — treat it as a regression, not flakiness. Investigate immediately.",
    );
  } else if (category === "flaky" || category === "critical") {
    out.push(
      "This test flips between pass and fail on identical code — the classic flaky-test signature.",
    );
  }
  switch (topErrorClass) {
    case "TimeoutError":
      out.push(
        "TimeoutError suggests slow operations: check for missing awaits, connection-pool exhaustion, or a slow external service.",
      );
      break;
    case "AssertionError":
      out.push(
        "AssertionError suggests a state/ordering bug: check test isolation and shared mutable state.",
      );
      break;
    case "TypeError":
      out.push(
        "TypeError suggests a null/undefined access: check the stack trace and recent data changes.",
      );
      break;
    case "ConnectionError":
      out.push(
        "ConnectionError suggests infrastructure issues: check service/database availability and network config.",
      );
      break;
    default:
      if (topErrorClass) {
        out.push(
          `Review the "${topErrorClass}" failure message and the commits around when reliability changed (below).`,
        );
      }
  }
  out.push("Cross-check the recent commits in the timeline below.");
  return out;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const dot: Record<string, string> = {
    first_seen: "bg-zinc-400",
    first_failure: "bg-red-500",
    became_flaky: "bg-orange-500",
    signature: "bg-amber-500",
  };
  if (events.length === 0) {
    return <p className="text-sm text-zinc-500">No timeline events yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((e, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[e.type] ?? "bg-zinc-400"}`}
          />
          <span className="text-zinc-700">{e.message}</span>
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-zinc-400">
            {relativeTime(e.at)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default async function TestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let history: TestHistory;
  let latest: LatestInvestigation["investigation"] = null;
  try {
    history = await api<TestHistory>(`/api/tests/${id}/history`);
    // Additive: a missing/failed investigation must not break the page.
    latest = (
      await api<LatestInvestigation>(`/api/tests/${id}/investigation`).catch(
        () => null,
      )
    )?.investigation ?? null;
  } catch {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-red-600">Could not load test {id}.</p>
        <Link href="/" className="mt-4 inline-block text-sm underline">
          ← back
        </Link>
      </main>
    );
  }

  const { test, score, transitions, timeline, prsBySha, outcomes, signatures } = history;
  const newestFirst = [...outcomes];
  const oldestFirst = [...outcomes].reverse();
  const isBroken = score?.category === "broken";
  const conf = confidence(score?.window_size);
  const topSignature = signatures[0];
  const recs = recommendations(score?.category, topSignature?.error_class);

  // Phase G — correlate failed runs' commits with cached PRs. Wording is
  // strictly "observed after", never "caused by".
  const correlated = Object.entries(prsBySha ?? {}).map(([sha, pr]) => ({ sha, ...pr }));
  const firstFailureEvent = timeline.find((e) => e.type === "first_failure");

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <Link
          href={`/repos/${test.repository_id}`}
          className="text-sm text-zinc-500 hover:text-zinc-800"
        >
          ← {test.repository_full_name}
        </Link>

        <header className="mb-6 mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {test.name || "(unnamed)"}
            </h1>
            <CategoryBadge category={score?.category ?? null} />
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-500">{test.file_path}</p>
          <p className="mt-1 text-xs text-zinc-400">
            first seen {relativeTime(test.first_seen_at)} · last seen{" "}
            {relativeTime(test.last_seen_at)}
          </p>
        </header>

        {isBroken && (
          <div className="mb-6 rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-4 text-sm text-fuchsia-800">
            <b>Consistent failure.</b> This test has failed its last runs in a
            row — this is breakage, not flakiness.
          </div>
        )}

        {/* Flake score — explainable */}
        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                Flake score
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tabular-nums">
                  {score?.score ?? "–"}
                </span>
                <span className="text-sm text-zinc-400">/ 100</span>
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs text-zinc-500">Confidence</div>
              <div className="text-sm font-medium">{conf}</div>
              {score?.wilson_lower !== null &&
                score?.wilson_lower !== undefined && (
                  <div className="text-[11px] text-zinc-400">
                    Wilson lower bound {pct(score.wilson_lower, 1)}
                  </div>
                )}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-500">Failure rate</dt>
              <dd className="mt-0.5 text-lg font-medium tabular-nums">
                {pct(score?.failure_rate)}
                {score ? (
                  <span className="ml-1 text-xs font-normal text-zinc-400">
                    ({score.failure_count}/{score.window_size})
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Pass → Fail transitions</dt>
              <dd className="mt-0.5 text-lg font-medium tabular-nums">
                {transitions.passToFail}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Fail → Pass transitions</dt>
              <dd className="mt-0.5 text-lg font-medium tabular-nums">
                {transitions.failToPass}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Analyzed runs</dt>
              <dd className="mt-0.5 text-lg font-medium tabular-nums">
                {score?.window_size ?? 0}
              </dd>
            </div>
          </dl>
        </section>

        {/* AI FAILURE INVESTIGATION */}
        <AiPanel testId={Number(id)} initial={latest} />

        {/* WHY */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">
            Why is it failing?
          </h2>
          {signatures.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4 text-sm text-zinc-500">
              No failure signatures — this test hasn&apos;t failed.
            </div>
          ) : (
            <>
              {(() => {
                const total = signatures.reduce((a, s) => a + s.times_seen_on_test, 0);
                const dominant = Math.max(...signatures.map((s) => s.times_seen_on_test));
                return total > 1 ? (
                  <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <b>{dominant}</b> of <b>{total}</b> recorded failures share the
                    same failure signature ({pct(dominant / total)}).
                  </p>
                ) : null;
              })()}
              <ul className="space-y-2">
              {signatures.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-zinc-200 bg-white px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-700">
                      {s.error_class}
                    </span>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600 ring-1 ring-inset ring-red-100">
                      {s.times_seen_on_test} failure{s.times_seen_on_test === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 break-words font-mono text-xs text-zinc-500">
                    {s.sample_message}
                  </p>
                </li>
              ))}
              </ul>
            </>
          )}
        </section>

        {/* WHAT CHANGED */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">
            When did it become unreliable?
          </h2>

          {/* PR correlation — timing evidence only */}
          {firstFailureEvent && (
            <div className="mb-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm">
              {firstFailureEvent.pr ? (
                <>
                  <span className="text-zinc-700">
                    Reliability degradation was first observed after{" "}
                    <b>PR #{firstFailureEvent.pr.number}</b>
                    {firstFailureEvent.pr.title
                      ? ` — ${firstFailureEvent.pr.title}`
                      : ""}
                    .
                  </span>
                  <span className="ml-1 text-xs text-zinc-400">
                    (timing correlation, not causation)
                  </span>
                </>
              ) : (
                <span className="text-zinc-700">{firstFailureEvent.message}</span>
              )}
            </div>
          )}

          {correlated.length > 0 && (
            <div className="mb-3 rounded-lg border border-zinc-200 bg-white px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Correlated pull requests
              </p>
              <ul className="mt-2 space-y-2">
                {correlated.map((c) => (
                  <li key={c.sha} className="text-sm">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-mono text-xs text-zinc-400">
                        {c.sha.slice(0, 7)}
                      </span>
                      <a
                        href={`https://github.com/${test.repository_full_name}/pull/${c.prNumber}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-indigo-700 hover:underline"
                      >
                        PR #{c.prNumber}
                      </a>
                      {c.title && (
                        <span className="truncate text-zinc-600">{c.title}</span>
                      )}
                      {c.authorLogin && (
                        <span className="text-xs text-zinc-400">@{c.authorLogin}</span>
                      )}
                    </div>
                    {c.changedFiles && c.changedFiles.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.changedFiles.slice(0, 8).map((f) => (
                          <span
                            key={f}
                            className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600"
                          >
                            {f}
                          </span>
                        ))}
                        {c.changedFiles.length > 8 && (
                          <span className="text-[10px] text-zinc-400">
                            +{c.changedFiles.length - 8} more
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
            <Timeline events={timeline} />
          </div>

          {outcomes.length > 0 && (
            <div id="outcomes">
              <div className="mb-3 rounded-lg border border-zinc-200 bg-white p-3">
                <Ribbon outcomes={oldestFirst.map((o) => o.status)} size="lg" />
              </div>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500">
                      <th className="px-3 py-2 font-medium">Run</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">Branch</th>
                      <th className="px-3 py-2 font-medium">Commit</th>
                      <th className="px-3 py-2 font-medium">Failure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newestFirst.map((o, i) => (
                      <tr key={i} className="border-b border-zinc-100 last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-500">
                          #{o.github_run_id}
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
                          <span className="font-medium">{o.status}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                          {new Date(o.executed_at).toLocaleString()}
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
                          {o.error_class
                            ? `${o.error_class}: ${o.sample_message}`
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                 </table>
               </div>
             </div>
           )}
         </section>

        {/* WHAT TO DO */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">
            What should you do?
          </h2>
          <ul className="space-y-2">
            {recs.map((r, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700"
              >
                <span className="mt-0.5 font-semibold text-zinc-400">
                  {i + 1}.
                </span>
                {r}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
