export function categoryStyles(category: string): string {
  switch (category) {
    case "critical":
      return "bg-red-100 text-red-700 ring-red-200";
    case "flaky":
      return "bg-orange-100 text-orange-700 ring-orange-200";
    case "watch":
      return "bg-amber-100 text-amber-700 ring-amber-200";
    case "broken":
      return "bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200";
    case "stable":
      return "bg-emerald-100 text-emerald-700 ring-emerald-200";
    default:
      return "bg-zinc-100 text-zinc-600 ring-zinc-200";
  }
}

export const CATEGORY_LABEL: Record<string, string> = {
  critical: "Critical",
  flaky: "Flaky",
  watch: "Watch",
  broken: "Broken",
  stable: "Stable",
  insufficient: "No data",
};

export function outcomeColor(status: string): string {
  if (status === "failed") return "bg-red-500";
  if (status === "skipped") return "bg-zinc-300";
  return "bg-emerald-500";
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "–";
  return `${(value * 100).toFixed(digits)}%`;
}
