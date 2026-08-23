import { categoryStyles, CATEGORY_LABEL } from "./ui";

interface RibbonProps {
  outcomes: string[];
  size?: "sm" | "lg";
}

/** Outcome ribbon: one colored square per recent run, oldest -> newest. */
export function Ribbon({ outcomes, size = "sm" }: RibbonProps) {
  const box = size === "lg" ? "h-5 w-5" : "h-3 w-3";
  if (outcomes.length === 0) {
    return <span className="text-xs text-zinc-400">no runs</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-[3px]" aria-label="recent outcomes">
      {outcomes.map((status, i) => (
        <span
          key={i}
          title={status}
          className={`${box} rounded-[2px] ${
            status === "failed"
              ? "bg-red-500"
              : status === "skipped"
                ? "bg-zinc-300"
                : "bg-emerald-500"
          }`}
        />
      ))}
    </div>
  );
}

export function CategoryBadge({ category }: { category: string | null }) {
  const label = category ?? "insufficient";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${categoryStyles(label)}`}
    >
      {CATEGORY_LABEL[label] ?? label}
    </span>
  );
}

/** Small colored status dot + label, used in the system-health strip. */
export function StatusDot({ tone, label }: { tone: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />
      <span className="text-sm text-zinc-700">{label}</span>
    </div>
  );
}

/** Workflow-run conclusion badge. */
export function ConclusionBadge({ conclusion }: { conclusion: string | null }) {
  if (!conclusion) {
    return <span className="text-xs text-zinc-400">–</span>;
  }
  const tone =
    conclusion === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : conclusion === "failure"
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-zinc-100 text-zinc-600 ring-zinc-200";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${tone}`}>
      {conclusion}
    </span>
  );
}
