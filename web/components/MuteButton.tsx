"use client";

import { useState } from "react";
import type { MuteInfo, MuteKind } from "@/lib/api";

/**
 * Mute / quarantine toggle for one test. Muting acknowledges a known-flaky
 * test without losing history — scoring continues; only Action Center
 * prominence changes. Clicking while muted lifts the mute.
 */
export default function MuteButton({
  testId,
  initial,
}: {
  testId: number;
  initial: MuteInfo | null;
}) {
  const [mute, setMute] = useState<MuteInfo | null>(initial);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<MuteKind>("muted");
  const [reason, setReason] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function apply(action: "mute" | "lift") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tests/${testId}/mute`, {
        method: action === "mute" ? "POST" : "DELETE",
        ...(action === "mute"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind,
                reason: reason || undefined,
                expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
              }),
            }
          : {}),
      });
      const body = (await res.json().catch(() => null)) as
        | { mute?: MuteInfo; error?: string }
        | null;
      if (!res.ok || !body) {
        setError(`Failed (HTTP ${res.status}).`);
        return;
      }
      setMute(action === "mute" ? body.mute ?? null : null);
      setShowForm(false);
      setReason("");
      setExpiresInDays("");
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const tone =
    mute?.kind === "quarantined"
      ? "border-[color-mix(in_oklab,var(--danger)_34%,var(--border))] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] text-[var(--danger)]"
      : "border-[color-mix(in_oklab,var(--warning)_34%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-[var(--warning)]";

  return (
    <span className="shrink-0">
      {!mute && (
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-sm border border-[var(--border)] px-2.5 py-2 text-xs font-medium text-[var(--muted)] hover:bg-[var(--card-elevated)] hover:text-[var(--foreground)]"
        >
          Mute
        </button>
      )}
      {mute && (
        <span
          className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium ${tone}`}
        >
          {mute.kind}
          <button
            onClick={() => apply("lift")}
            disabled={busy}
            className="underline decoration-dotted disabled:opacity-50"
            title="Lift and restore prominence"
          >
            lift
          </button>
        </span>
      )}

      {showForm && (
        <span className="mt-2 flex flex-col gap-1.5 rounded-sm border border-[var(--border)] bg-[var(--card-strong)] p-2 text-left">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MuteKind)}
            className="rounded-sm border border-[var(--border)] bg-[var(--card)] px-1.5 py-1.5 text-xs text-[var(--foreground)]"
          >
            <option value="muted">Mute</option>
            <option value="quarantined">Quarantine</option>
          </select>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason (optional)"
            className="rounded-sm border border-[var(--border)] bg-[var(--card)] px-1.5 py-1.5 text-xs text-[var(--foreground)]"
          />
          <input
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value.replace(/\D/g, ""))}
            placeholder="expires in days (optional)"
            className="rounded-sm border border-[var(--border)] bg-[var(--card)] px-1.5 py-1.5 text-xs text-[var(--foreground)]"
          />
          <span className="flex gap-1.5">
            <button
              onClick={() => apply("mute")}
              disabled={busy}
              className="rounded-sm bg-[var(--warning)] px-2 py-1.5 text-[11px] font-medium text-[var(--background)] hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "…" : "Apply"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-sm border border-[var(--border)] px-2 py-1.5 text-[11px] text-[var(--muted-foreground)]"
            >
              Cancel
            </button>
          </span>
          {error && <span className="text-[10px] text-[var(--danger)]">{error}</span>}
        </span>
      )}
    </span>
  );
}
