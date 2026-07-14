export default function AssessLoading() {
  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-4">
        <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </main>
  );
}
