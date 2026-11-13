import { Suspense } from "react";
import { IconCheck } from "@/components/icons";
import { safeNextPath } from "@/server/auth/session";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · BYOMCP" };

const POINTS = [
  "Pick the app (or paste a link to its API docs). We list what your AI employee could do with it.",
  "Turn on only what it needs. Anything that changes data waits for your approval.",
  "Publish an MCP server your AI employees can use in UnleashX, Claude or any MCP client.",
];

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="relative grid min-h-dvh lg:grid-cols-2">
      <ThemeToggle className="absolute top-3 right-3 z-10 w-44" />
      <section className="flex flex-col justify-center gap-6 bg-[var(--signal-tint)] px-6 py-10 sm:px-12">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--signal)] font-bold text-[var(--signal-ink)]">
            B
          </span>
          <span className="text-[1.375rem] font-bold tracking-tight">BYOMCP</span>
        </div>
        <h1 className="max-w-lg text-[2rem] leading-tight font-semibold tracking-tight sm:text-[2.25rem]">
          Give your AI employees <span className="text-signal">any app</span>, safely.
        </h1>
        <ul className="flex max-w-lg flex-col gap-3">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--signal)] text-[var(--signal-ink)]">
                <IconCheck size={12} strokeWidth={3} />
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <p className="max-w-lg text-sm text-ink-soft">
          AI reads the docs once (cents, shown to you). Running your apps never calls AI. Your keys are encrypted and never sent to AI.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-10">
        <div className="window w-full max-w-sm p-6">
          <h2 className="text-[1.25rem] font-semibold">Sign in</h2>
          <p className="mt-1 mb-4 text-sm text-ink-soft">This is a demo workspace. Use the passcode you were given.</p>
          <Suspense fallback={<LoginForm next="/" />}>
            <LoginWithNext searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function LoginWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}
