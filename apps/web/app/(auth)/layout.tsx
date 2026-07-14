import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <Link
        href="/"
        className="mb-8 text-sm font-medium text-amber-700 dark:text-amber-400"
      >
        Citrus Care
      </Link>
      {children}
    </div>
  );
}
