import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        That branch never grew here.
      </p>
      <Link href="/" className="text-amber-700 underline-offset-4 hover:underline">
        Back to home
      </Link>
    </main>
  );
}
