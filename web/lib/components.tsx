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
