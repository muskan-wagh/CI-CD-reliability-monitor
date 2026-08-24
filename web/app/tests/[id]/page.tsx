import Link from "next/link";
import {
  api,
  type LatestInvestigation,
  type TestHistory,
  type TimelineEvent,
} from "@/lib/api";
import { CategoryBadge, Ribbon } from "@/lib/components";
import { confidence, pct, relativeTime } from "@/lib/ui";
import AppShell from "@/components/AppShell";
import AiPanel from "./AiPanel";
import MuteButton from "@/components/MuteButton";

export const dynamic = "force-dynamic";

function recommendations(category: string | undefined, errorClass: string | undefined): string[] {
  const items: string[] = [];
  if (category === "broken") items.push("Treat this as a regression, not flakiness: inspect the first failing commit and fix the underlying failure.");
  if (category === "flaky" || category === "critical") items.push("The test flips between pass and fail. Prioritize the dominant signature before rerunning CI.");
  if (errorClass === "TimeoutError") items.push("Check timeout configuration, missing awaits, connection-pool usage, and slow external services.");
  else if (errorClass === "AssertionError") items.push("Check test isolation, shared state, and ordering assumptions around the failing assertion.");
  else if (errorClass === "TypeError") items.push("Inspect the failing access and the data setup that can leave it null or undefined.");
  else if (errorClass) items.push(`Review the ${errorClass} message and stack trace against the commits shown below.`);
  if (items.length === 0) items.push("Collect more runs before drawing a root-cause conclusion.");
  return items;
}

function SignalMetric({ label, value, detail, tone = "text-[var(--foreground)]" }: { label: string; value: string | number; detail?: string; tone?: string }) {
  return <div><p className={`technical text-xl font-bold ${tone}`}>{value}</p><p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{label}</p>{detail && <p className="technical mt-1 text-[10px] text-[var(--muted-foreground)]">{detail}</p>}</div>;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const dot: Record<string, string> = { first_seen: "bg-[var(--info)]", first_failure: "bg-[var(--danger)]", became_flaky: "bg-[var(--primary)]", signature: "bg-[var(--warning)]" };
  return events.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">No reliability change events recorded yet.</p> : <ol className="relative grid gap-0">{events.map((event, i) => <li key={`${event.type}-${event.at}-${i}`} className="relative flex gap-4 pb-5 last:pb-0"><span className={`relative z-10 mt-1 h-2 w-2 shrink-0 rounded-full ring-4 ring-[var(--card)] ${dot[event.type] ?? "bg-[var(--muted-foreground)]"}`} /><span className={`absolute left-[3px] top-3 h-full w-px ${i === events.length - 1 ? "hidden" : "bg-[var(--border)]"}`} /><div className="min-w-0 flex-1"><p className="text-sm text-[var(--foreground)]">{event.message}{event.pr && <> · <a href={`https://github.com/${event.pr.number}`} className="text-[var(--info)]">PR #{event.pr.number}</a></>}</p><p className="technical mt-1 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{event.type.replaceAll("_", " ")} · {relativeTime(event.at)}</p></div></li>)}</ol>;
}

function FailureEvidence({ signatures, score }: Pick<TestHistory, "signatures" | "score">) {
  if (signatures.length === 0) return <div className="panel p-5"><p className="text-sm text-[var(--muted-foreground)]">No failure evidence recorded. This test has not produced a failure signature.</p></div>;
  const total = signatures.reduce((sum, item) => sum + item.times_seen_on_test, 0);
  return <div className="grid gap-3">{signatures.map((signature) => <details key={signature.id} className="panel group"><summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-4"><span className="technical text-sm font-semibold text-[var(--danger)]">{signature.error_class}</span><span className="min-w-0 flex-1 truncate text-sm text-[var(--foreground)]">{signature.sample_message}</span><span className="technical text-xs text-[var(--muted-foreground)]">{signature.times_seen_on_test}/{total} failures</span><span className="text-xs text-[var(--muted-foreground)] group-open:rotate-90">›</span></summary><div className="grid gap-4 border-t border-[var(--border)] px-4 py-4 md:grid-cols-2"><div><p className="eyebrow">Normalized error</p><p className="mt-2 font-mono text-xs leading-5 text-[var(--foreground)]">{signature.sample_message}</p></div><div><p className="eyebrow">Observed</p><p className="mt-2 text-sm text-[var(--muted-foreground)]">{signature.times_seen_on_test} occurrences on this test{score ? ` · ${pct(signature.times_seen_on_test / Math.max(1, score.failure_count))} of analyzed failures` : ""}.</p><p className="mt-2 text-xs text-[var(--warning)]">Stack trace is not collected by the current JUnit ingestion format.</p></div></div></details>)}</div>;
}

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let history: TestHistory;
  let latest: LatestInvestigation["investigation"] = null;
  try {
    history = await api<TestHistory>(`/api/tests/${id}/history`);
    latest = (await api<LatestInvestigation>(`/api/tests/${id}/investigation`).catch(() => null))?.investigation ?? null;
  } catch {
    return <AppShell active="tests"><main className="mx-auto max-w-5xl px-5 py-12"><div className="panel p-6"><p className="font-semibold text-[var(--danger)]">Unable to load this investigation.</p><Link href="/" className="mt-4 inline-block text-sm text-[var(--info)]">Return to overview</Link></div></main></AppShell>;
  }

  const { test, score, transitions, mute, timeline, prsBySha, outcomes, signatures } = history;
  const oldestFirst = [...outcomes].reverse();
  const firstFailure = timeline.find((event) => event.type === "first_failure");
  const correlated = Object.entries(prsBySha ?? {}).map(([sha, pr]) => ({ sha, ...pr }));
  const topSignature = signatures[0];
  const reliabilityTone = score?.category === "stable" ? "text-[var(--success)]" : score?.category === "watch" ? "text-[var(--warning)]" : "text-[var(--danger)]";

  return <AppShell active="tests"><main className="mx-auto max-w-[1200px] px-4 pb-16 pt-7 sm:px-6 lg:px-10">
    <Link href={`/repos/${test.repository_id}`} className="technical text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] hover:text-[var(--foreground)]">← {test.repository_full_name}</Link>
    <header className="mt-5 flex flex-wrap items-start justify-between gap-5 border-b border-[var(--border)] pb-6">
      <div className="min-w-0"><p className="eyebrow text-[var(--primary)]">Test investigation</p><div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="break-words text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">{test.name || "Unnamed test"}</h1><CategoryBadge category={score?.category ?? null} /></div><p className="technical mt-2 break-all text-xs text-[var(--muted-foreground)]">{test.file_path}{test.suite_path ? ` / ${test.suite_path}` : ""}</p></div>
      <div className="flex items-center gap-2">{!mute && <MuteButton testId={Number(id)} initial={null} />}{mute && <span className="technical rounded-sm border border-[var(--warning)] px-2 py-1 text-[10px] uppercase text-[var(--warning)]">{mute.kind}</span>}</div>
    </header>

    <section className="grid gap-3 py-6 sm:grid-cols-2 lg:grid-cols-5">
      <div className="panel-strong p-4"><p className="eyebrow">Deterministic signal</p><p className={`technical mt-2 text-4xl font-bold ${reliabilityTone}`}>{score?.score ?? "–"}<span className="ml-1 text-sm font-normal text-[var(--muted-foreground)]">/100</span></p><p className="mt-2 text-[11px] text-[var(--muted-foreground)]">This verdict comes from recorded outcomes, not AI.</p></div>
      <div className="panel p-4"><SignalMetric label="Failure rate" value={pct(score?.failure_rate)} detail={score ? `${score.failure_count}/${score.window_size} runs` : undefined} tone={reliabilityTone} /></div>
      <div className="panel p-4"><SignalMetric label="Transitions" value={`${transitions.passToFail} P→F`} detail={`${transitions.failToPass} F→P recoveries`} /></div>
      <div className="panel p-4"><SignalMetric label="Confidence" value={confidence(score?.window_size)} detail={score?.wilson_lower == null ? "Wilson bound unavailable" : `Wilson lower ${pct(score.wilson_lower, 1)}`} /></div>
      <div className="panel p-4"><SignalMetric label="Observed" value={relativeTime(test.last_seen_at)} detail={`first seen ${relativeTime(test.first_seen_at)}`} /></div>
    </section>

    {mute && <div className="mb-6 flex flex-wrap items-center gap-3 border border-[var(--warning)] bg-[color-mix(in_oklab,var(--warning)_8%,transparent)] px-4 py-3 text-sm text-[var(--warning)]"><span className="font-semibold capitalize">{mute.kind}</span>{mute.reason && <span>“{mute.reason}”</span>}<span className="ml-auto"><MuteButton testId={Number(id)} initial={mute} /></span></div>}

    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <div className="grid gap-8">
        <section><div className="mb-3 flex items-end justify-between gap-3"><div><p className="eyebrow">Why</p><h2 className="mt-1 text-xl font-semibold">Why is this test failing?</h2></div><span className="technical text-[10px] text-[var(--muted-foreground)]">failure evidence</span></div>{signatures.length > 0 && <p className="mb-3 text-sm leading-6 text-[var(--muted-foreground)]"><span className="text-[var(--foreground)]">{signatures[0]!.times_seen_on_test} of {signatures.reduce((sum, item) => sum + item.times_seen_on_test, 0)} recorded failures</span> share the dominant signature. Expand a signature to inspect its normalized error.</p>}<FailureEvidence signatures={signatures} score={score} /></section>

        <section id="what-changed"><div className="mb-3"><p className="eyebrow">What changed</p><h2 className="mt-1 text-xl font-semibold">When did reliability move?</h2></div><div className="panel p-5"><Timeline events={timeline} /></div>{firstFailure?.pr && <p className="mt-3 text-xs text-[var(--muted-foreground)]">Reliability degradation was first observed after <b className="text-[var(--foreground)]">PR #{firstFailure.pr.number}</b>. This is timing correlation, not proof of causation.</p>}{correlated.length > 0 && <div className="mt-3 grid gap-2">{correlated.map((item) => <div key={item.sha} className="panel flex flex-wrap items-center gap-2 px-4 py-3 text-xs"><span className="technical text-[var(--muted-foreground)]">{item.sha.slice(0, 7)}</span><a className="text-[var(--info)] hover:underline" href={`https://github.com/${test.repository_full_name}/pull/${item.prNumber}`} target="_blank" rel="noreferrer">View PR #{item.prNumber} ↗</a>{item.title && <span className="text-[var(--muted-foreground)]">{item.title}</span>}</div>)}</div>}</section>

        <section id="outcomes"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Failure history</p><h2 className="mt-1 text-xl font-semibold">Last {outcomes.length} runs</h2></div><span className="technical text-[10px] text-[var(--muted-foreground)]">oldest → newest</span></div><div className="panel mb-3 p-4"><Ribbon outcomes={oldestFirst.map((item) => item.status)} size="lg" /></div><div className="grid gap-2 md:hidden">{outcomes.map((outcome, i) => <div key={i} className="panel grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3"><span className={`h-2 w-2 rounded-full ${outcome.status === "failed" ? "bg-[var(--danger)]" : outcome.status === "skipped" ? "bg-[var(--muted-foreground)]" : "bg-[var(--success)]"}`} /><div><p className="technical text-xs text-[var(--foreground)]">run #{outcome.github_run_id}</p><p className="text-[10px] text-[var(--muted-foreground)]">{relativeTime(outcome.executed_at)} · {outcome.head_branch ?? "unknown branch"}</p></div><span className="technical text-[10px] uppercase text-[var(--muted-foreground)]">{outcome.status}</span></div>)}</div><div className="panel hidden overflow-x-auto md:block"><table className="w-full min-w-[680px] text-left text-xs"><thead className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]"><tr><th className="px-4 py-3 font-medium">Run</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">When</th><th className="px-4 py-3 font-medium">Commit</th><th className="px-4 py-3 font-medium">Failure</th></tr></thead><tbody>{outcomes.map((outcome, i) => <tr key={i} className="border-b border-[var(--border)] last:border-0"><td className="technical px-4 py-3 text-[var(--foreground)]">#{outcome.github_run_id}</td><td className="px-4 py-3"><span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${outcome.status === "failed" ? "bg-[var(--danger)]" : outcome.status === "skipped" ? "bg-[var(--muted-foreground)]" : "bg-[var(--success)]"}`} />{outcome.status}</td><td className="px-4 py-3 text-[var(--muted-foreground)]">{new Date(outcome.executed_at).toLocaleString()}</td><td className="technical px-4 py-3 text-[var(--muted-foreground)]">{outcome.head_sha ? outcome.head_sha.slice(0, 7) : "—"}</td><td className="max-w-[280px] truncate px-4 py-3 text-[var(--danger)]" title={`${outcome.error_class ?? ""}: ${outcome.sample_message ?? ""}`}>{outcome.error_class ? `${outcome.error_class}: ${outcome.sample_message}` : "—"}</td></tr>)}</tbody></table></div></section>
      </div>

      <aside className="grid content-start gap-5"><AiPanel testId={Number(id)} initial={latest} /><section><p className="eyebrow">Next move</p><h2 className="mt-1 text-xl font-semibold">What should you do?</h2><ul className="mt-3 grid gap-2">{recommendations(score?.category, topSignature?.error_class).map((item, i) => <li key={i} className="panel flex gap-3 px-4 py-3 text-sm leading-5 text-[var(--muted-foreground)]"><span className="technical text-[var(--primary)]">{i + 1}.</span>{item}</li>)}</ul></section><div className="panel p-4"><p className="eyebrow">Evidence boundary</p><p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">Echo has no runner/OS or full stack trace for this record. Those fields are intentionally not inferred.</p></div></aside>
    </div>
  </main></AppShell>;
}
