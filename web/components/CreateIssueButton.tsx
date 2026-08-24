"use client";

import { useState } from "react";

/**
 * Action Center button: creates a GitHub issue for this test via the backend
 * (App credentials stay server-side). Success replaces the button with a link
 * to the created issue.
 */
export default function CreateIssueButton({ testId }: { testId: number }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; number: number; url: string | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function create() {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/tests/${testId}/issue`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { number?: number; url?: string | null; error?: string; detail?: string }
        | null;
      if (!res.ok || !body || body.error) {
        const message =
          res.status === 503
            ? "GitHub App is not configured on the server."
            : body?.detail ?? body?.error ?? `Request failed (HTTP ${res.status}).`;
        setState({ kind: "error", message });
        return;
      }
      setState({
        kind: "done",
        number: body.number!,
        url: body.url ?? null,
      });
    } catch {
      setState({ kind: "error", message: "The request failed. Please try again." });
    }
  }

  if (state.kind === "done") {
    return state.url ? (
      <a
        href={state.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-sm border border-[color-mix(in_oklab,var(--success)_34%,var(--border))] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] px-2.5 py-2 text-xs font-medium text-[var(--success)] hover:bg-[color-mix(in_oklab,var(--success)_18%,transparent)]"
      >
        Issue #{state.number} ↗
      </a>
    ) : (
      <span className="shrink-0 text-xs font-medium text-[var(--success)]">
        Issue #{state.number} created
      </span>
    );
  }

  return (
    <span className="shrink-0">
      <button
        onClick={create}
        disabled={state.kind === "loading"}
        className="rounded-sm border border-[var(--border)] px-2.5 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
        title="Create a GitHub issue with the evidence pack"
      >
        {state.kind === "loading" ? "Creating…" : "Create issue"}
      </button>
      {state.kind === "error" && (
        <span
          className="ml-2 max-w-[220px] truncate align-middle text-[10px] text-[var(--danger)]"
          title={state.message}
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
