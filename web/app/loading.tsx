export default function Loading() {
  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div className="h-12 animate-pulse rounded-lg border border-zinc-200 bg-white" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-zinc-200 bg-white"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg border border-zinc-200 bg-white" />
      </div>
    </main>
  );
}
