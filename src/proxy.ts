/**
 * Passcode gate for the whole app. Each passcode opens its own workspace; the
 * cookie names it. Revoked workspaces are refused server-side (guard.ts), since
 * the proxy doesn't read the database.
 * - Pages without a valid session redirect to /login.
 * - API routes without a session get 401 JSON.
 * - /api/mcp/* is NOT gated here: MCP clients authenticate with per-connector
 *   endpoint tokens, checked in the route itself.
 * Server actions and route handlers re-check the session themselves
 * (requireSession), so a matcher mistake can't silently open them.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/server/auth/session";

export function proxy(request: NextRequest) {
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const passcode = process.env.APP_PASSCODE;
  const ok =
    !!encryptionKey &&
    !!passcode &&
    verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value, { encryptionKey, passcode }) !== null;
  if (ok) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in with the workspace passcode first." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Everything except: login page, MCP endpoint, public trimmed specs, Next internals and static files.
    "/((?!login|api/mcp|specs/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff2?)$).*)",
  ],
};
