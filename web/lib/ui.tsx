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

export function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "–";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** Humanize a millisecond duration (e.g. CI-waste totals). */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${rem}m`;
}

/** Confidence label derived from how many runs the score is based on. */
export function confidence(windowSize: number | null | undefined): string {
  if (!windowSize) return "Low";
  if (windowSize < 8) return "Low";
  if (windowSize < 15) return "Medium";
  return "High";
}

export function healthTone(status: string): { dot: string; text: string } {
  switch (status) {
    case "connected":
    case "receiving":
    case "working":
    case "ok":
      return { dot: "bg-emerald-500", text: "text-emerald-700" };
    case "degraded":
    case "idle":
    case "not_configured":
      return { dot: "bg-amber-500", text: "text-amber-700" };
    case "down":
    case "not_installed":
      return { dot: "bg-red-500", text: "text-red-700" };
    default:
      return { dot: "bg-zinc-300", text: "text-zinc-500" };
  }
}
