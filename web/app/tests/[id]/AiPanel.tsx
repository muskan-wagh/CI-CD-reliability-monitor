"use client";

import { useState } from "react";
import type { AiInvestigation, InvestigateResponse, LatestInvestigation } from "@/lib/api";

const CLASS_STYLE: Record<string, string> = {
  CONFIRMED: "bg-red-100 text-red-700 ring-red-200",
  LIKELY: "bg-orange-100 text-orange-700 ring-orange-200",
  POSSIBLE: "bg-amber-100 text-amber-700 ring-amber-200",
  UNKNOWN: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

function isInsufficient(inv: AiInvestigation): boolean {
  return (
    inv.classification === "UNKNOWN" &&
    inv.summary === "Insufficient evidence to determine the root cause."
  );
}

export default function AiPanel({
  testId,
  initial,
}: {
  testId: number;
  initial: LatestInvestigation["investigation"];
}) {
  const [inv, setInv] = useState<AiInvestigation | null>(
    initial ? initial.result : null,
  );
  const [meta, setMeta] = useState<{
    provider: string;
    model: string;
    cached?: boolean;
    at?: string;
  } | null>(
    initial
      ? { provider: initial.provider, model: initial.model, at: initial.created_at }
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function investigate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tests/${testId}/investigate`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | (InvestigateResponse & { error?: string; detail?: string })
        | null;
      if (!res.ok || !body || body.error) {
        if (res.status === 503) {
          setError(
            "AI is not configured on the server. Set AI_PROVIDER / AI_MODEL / AI_API_KEY.",
          );
        } else {
          setError(body?.detail ?? body?.error ?? `Request failed (HTTP ${res.status}).`);
        }
        return;
      }
      setInv(body.investigation);
      setMeta({ provider: body.provider, model: body.model, cached: body.cached });
    } catch {
      setError("The investigation request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const insufficient = inv !== null && isInsufficient(inv);

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-indigo-200 bg-white">
      <div className="flex items-center justify-between border-b border-indigo-100 bg-indigo-50/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-indigo-900">
          AI failure investigation
        </h2>
        {meta && !loading && (
          <span className="text-[11px] text-zinc-400">
            {meta.provider}/{meta.model}
            {meta.cached ? " · cached" : ""}
          </span>
        )}
      </div>

      <div className="p-4">
        {!inv && !loading && !error && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              Run an investigation to get a likely root cause from the recorded
              evidence.
            </p>
            <button
              onClick={investigate}
              className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Investigate
            </button>
          </div>
        )}

        {loading && (
          <p className="animate-pulse text-sm text-indigo-700">
            Investigating… reading the failure evidence. This can take 30–60s on
            free models.
          </p>
        )}

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {insufficient && inv && (
          <div className="text-sm">
            <p className="font-medium text-zinc-800">{inv.summary}</p>
            {inv.evidence.length > 0 && (
              <>
                <p className="mt-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Available evidence
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-zinc-600">
                  {inv.evidence.map((e, i) => (
                    <li key={i}>– {e}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-2 text-xs text-zinc-400">Additional logs are required.</p>
            <a
              href="#outcomes"
              className="mt-3 inline-block rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              View raw failures
            </a>
            <div className="mt-3">
              <button
                onClick={investigate}
                className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
              >
                Investigate again
              </button>
            </div>
          </div>
        )}

        {inv && !insufficient && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Likely cause
                </p>
                <p className="mt-1 font-medium text-zinc-800">
                  {inv.likely_cause || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Confidence
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CLASS_STYLE[inv.classification] ?? CLASS_STYLE.UNKNOWN}`}
                  >
                    {inv.classification}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {Math.round(inv.confidence * 100)}%
                  </span>
                </div>
              </div>
            </div>

            <p className="text-zinc-700">{inv.summary}</p>

            {inv.evidence.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Evidence
                </p>
                <ul className="mt-1 space-y-0.5">
                  {inv.evidence.map((e, i) => (
                    <li key={i} className="flex gap-2 text-zinc-700">
                      <span className="text-emerald-500">✓</span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {inv.possible_causes.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Possible causes
                </p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-zinc-700">
                  {inv.possible_causes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ol>
              </div>
            )}

            {inv.recommended_actions.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Recommended actions
                </p>
                <ul className="mt-1 space-y-0.5">
                  {inv.recommended_actions.map((a, i) => (
                    <li key={i} className="flex gap-2 text-zinc-700">
                      <span className="text-indigo-500">→</span>
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={investigate}
              disabled={loading}
              className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              Investigate again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
