"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

type Props = { href: string; match?: string; children: ReactNode };

/**
 * Sidebar item that knows if it's the current page. Reading the URL is
 * request-time data, so it streams in behind Suspense; until then the link
 * renders without the active highlight.
 */
export function NavLink(props: Props) {
  return (
    <Suspense
      fallback={
        <Link href={props.href} className="navitem">
          {props.children}
        </Link>
      }
    >
      <ActiveLink {...props} />
    </Suspense>
  );
}

function ActiveLink({ href, match, children }: Props) {
  const pathname = usePathname();
  const active = match ? pathname.startsWith(match) : pathname === href;
  return (
    <Link href={href} className="navitem" aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
