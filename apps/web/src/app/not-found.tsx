import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-fg-muted">The page you are looking for does not exist or has moved.</p>
      <Link href="/" className="underline underline-offset-4">
        Go home
      </Link>
    </main>
  );
}
