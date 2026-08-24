"use client";

import { useState } from "react";
import type { AiInvestigation, InvestigateResponse, LatestInvestigation } from "@/lib/api";

const CLASS_STYLE: Record<string, string> = {
  CONFIRMED: "border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]",
  LIKELY: "border-[color-mix(in_srgb,var(--ai)_40%,var(--border))] bg-[color-mix(in_srgb,var(--ai)_12%,transparent)] text-[var(--ai)]",
  POSSIBLE: "border-[color-mix(in_srgb,var(--warning)_40%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]",
  UNKNOWN: "border-[var(--border)] bg-[var(--card-elevated)] text-[var(--muted)]",
};

function isInsufficient(inv: AiInvestigation) {
  return inv.classification === "UNKNOWN" && inv.summary === "Insufficient evidence to determine the root cause.";
}

export default function AiPanel({ testId, initial }: { testId: number; initial: LatestInvestigation["investigation"] }) {
  const [inv, setInv] = useState<AiInvestigation | null>(initial?.result ?? null);
  const [meta, setMeta] = useState(initial ? { provider: initial.provider, model: initial.model, cached: true } : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function investigate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tests/${testId}/investigate`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as (InvestigateResponse & { error?: string; detail?: string }) | null;
      if (!res.ok || !body || body.error) {
        setError(res.status === 503 ? "AI investigation is temporarily unavailable. Deterministic analysis is still available." : body?.detail ?? body?.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }
      setInv(body.investigation);
      setMeta({ provider: body.provider, model: body.model, cached: body.cached });
    } catch {
      setError("The investigation request failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const insufficient = inv !== null && isInsufficient(inv);

  return (
    <section className="panel-ai overflow-hidden" id="ai-investigation">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div><p className="eyebrow text-[var(--info)]">Investigator layer</p><h2 className="mt-1 text-base font-semibold">AI failure investigation</h2></div>
        {meta && <span className="technical text-[10px] text-[var(--muted-foreground)]">{meta.provider} · {meta.model}{meta.cached ? " · cached" : ""}</span>}
      </div>
      <div className="p-5">
        {!inv && !loading && !error && <div className="flex flex-wrap items-center justify-between gap-4"><p className="max-w-[60ch] text-sm leading-6 text-[var(--muted-foreground)]">Ask the investigator to interpret the bounded failure evidence. It does not change the deterministic score.</p><button onClick={investigate} className="rounded-sm bg-[var(--info)] px-3 py-2 text-xs font-semibold text-[var(--background)] hover:brightness-110">Investigate</button></div>}
        {loading && <p className="animate-pulse text-sm text-[var(--info)]">Reading failure evidence… free models can take 30–60 seconds.</p>}
        {error && <div className="mt-3 border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-3 text-sm text-[var(--danger)]">{error}</div>}
        {insufficient && inv && <div className="space-y-4"><p className="text-sm font-medium">{inv.summary}</p><div><p className="eyebrow">Available evidence</p><ul className="mt-2 grid gap-1 text-sm text-[var(--muted-foreground)]">{inv.evidence.map((item, i) => <li key={i}>• {item}</li>)}</ul></div><p className="text-xs text-[var(--muted-foreground)]">Additional logs or a full stack trace are required.</p><a href="#failure-evidence" className="inline-block text-xs text-[var(--info)] hover:underline">View raw failure evidence ↓</a><button onClick={investigate} className="ml-4 text-xs text-[var(--info)] hover:underline">Investigate again</button></div>}
        {inv && !insufficient && <div className="grid gap-6"><div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr]"><div><p className="eyebrow">Likely cause</p><p className="mt-2 text-lg font-semibold text-[var(--foreground)]">{inv.likely_cause || "No likely cause returned"}</p><p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--muted)]">{inv.summary}</p></div><div className="md:border-l md:border-[var(--border)] md:pl-5"><p className="eyebrow">Classification / confidence</p><div className="mt-3 flex items-center gap-3"><span className={`rounded-sm border px-2 py-1 text-[10px] font-bold tracking-wide ${CLASS_STYLE[inv.classification] ?? CLASS_STYLE.UNKNOWN}`}>{inv.classification}</span><span className="technical text-2xl font-bold">{Math.round(inv.confidence * 100)}%</span></div><p className="mt-2 text-xs text-[var(--muted)]">Inference, not a deterministic verdict.</p></div></div><div className="grid gap-6 md:grid-cols-3"><List title="Evidence" items={inv.evidence} marker="✓" tone="text-[var(--success)]" /><List title="Possible causes" items={inv.possible_causes} marker="" tone="text-[var(--muted)]" ordered /><List title="Recommended actions" items={inv.recommended_actions} marker="→" tone="text-[var(--info)]" /></div><button onClick={investigate} disabled={loading} className="justify-self-start rounded-sm border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted)] hover:bg-[var(--card-elevated)] hover:text-[var(--foreground)] disabled:opacity-50">Investigate again</button></div>}
      </div>
    </section>
  );
}

function List({ title, items, marker, tone, ordered = false }: { title: string; items: string[]; marker: string; tone: string; ordered?: boolean }) {
  return <div><p className="eyebrow">{title}</p>{items.length === 0 ? <p className="mt-2 text-xs text-[var(--muted-foreground)]">None returned.</p> : <ul className={`mt-2 grid gap-2 text-sm leading-5 ${tone}`}>{items.map((item, i) => <li key={i} className="flex gap-2"><span className="technical shrink-0 text-xs">{ordered ? `${i + 1}.` : marker}</span><span>{item}</span></li>)}</ul>}</div>;
}
