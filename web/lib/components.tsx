import { categoryStyles, CATEGORY_ICON, CATEGORY_LABEL, outcomeColor } from "./ui";

interface RibbonProps {
  outcomes: string[];
  size?: "sm" | "lg";
}

/** Outcome ribbon: one colored square per recent run, oldest -> newest. */
export function Ribbon({ outcomes, size = "sm" }: RibbonProps) {
  const box = size === "lg" ? "h-5 w-5" : "h-3 w-3";
  if (outcomes.length === 0) {
    return <span className="text-xs text-[var(--subtle)]">no runs</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-[3px]" aria-label="recent outcomes">
      {outcomes.map((status, i) => (
        <span
          key={i}
          title={status}
          className={`${box} rounded-[2px] ${outcomeColor(status)}`}
        />
      ))}
    </div>
  );
}

export function CategoryBadge({ category }: { category: string | null }) {
  const label = category ?? "insufficient";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${categoryStyles(label)}`}
    >
      <span aria-hidden>{CATEGORY_ICON[label] ?? "?"}</span>
      {CATEGORY_LABEL[label] ?? label}
    </span>
  );
}

/** Workflow-run conclusion badge. */
export function ConclusionBadge({ conclusion }: { conclusion: string | null }) {
  if (!conclusion) {
    return <span className="text-xs text-[var(--subtle)]">–</span>;
  }
  const tone = conclusion === "success"
    ? "border-[color-mix(in_oklab,var(--success)_34%,var(--border))] bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]"
    : conclusion === "failure"
      ? "border-[color-mix(in_oklab,var(--danger)_34%,var(--border))] bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]"
      : "border-[var(--border)] bg-[var(--card-elevated)] text-[var(--muted)]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      <span aria-hidden>{conclusion === "success" ? "✓" : conclusion === "failure" ? "×" : "•"}</span>
      {conclusion}
    </span>
  );
}
