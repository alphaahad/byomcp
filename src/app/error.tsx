"use client";

import Link from "next/link";

/** Plain-language error page with a way forward (no stack traces). */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-alarm">Something went wrong</p>
      <h1 className="text-[1.5rem] font-semibold">This page didn&apos;t load</h1>
      <p className="text-ink-soft">Nothing was sent to your apps. Try again; if it keeps happening, go back to Home and retry from there.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="btn">
          Go to Home
        </Link>
      </div>
    </main>
  );
}
