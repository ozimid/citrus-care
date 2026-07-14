export default function PlantsLoading() {
  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded bg-muted" />
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {[1, 2, 3].map((i) => (
          <li key={i}>
            <div className="h-24 animate-pulse rounded-lg border bg-muted/30" />
          </li>
        ))}
      </ul>
    </main>
  );
}

