export default function PlantDetailLoading() {
  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-36 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-10 w-32 animate-pulse rounded bg-muted" />
      <section className="space-y-3">
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        {[1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-lg border p-3"
          >
            <div className="size-16 shrink-0 animate-pulse rounded-md bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

