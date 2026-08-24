export default function Loading() {
  return (
    <main className="app-shell min-h-screen">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div className="h-12 animate-pulse rounded-sm border border-[var(--border)] bg-[var(--card)]" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-sm border border-[var(--border)] bg-[var(--card)]"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-sm border border-[var(--border)] bg-[var(--card)]" />
      </div>
    </main>
  );
}
