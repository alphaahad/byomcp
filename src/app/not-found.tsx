import Link from "next/link";

export const metadata = { title: "Not found · BYOMCP" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-signal">404</p>
      <h1 className="text-[1.5rem] font-semibold">We couldn&apos;t find that page</h1>
      <p className="text-ink-soft">The app may have been deleted, or the link is mistyped.</p>
      <Link href="/" className="btn btn-primary mt-2">
        Go to Home
      </Link>
    </main>
  );
}
