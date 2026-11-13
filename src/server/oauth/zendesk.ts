import "server-only";
/**
 * "Connect with Zendesk": OAuth authorization code grant with PKCE and a
 * confidential client (checked against Zendesk's docs, 13 Nov 2026):
 *   authorize  https://{subdomain}.zendesk.com/oauth/authorizations/new
 *   tokens     POST https://{subdomain}.zendesk.com/oauth/tokens (JSON)
 * Access tokens last 30 minutes by default; refresh tokens up to 90 days, and
 * every refresh returns a NEW refresh token and invalidates the old pair.
 * A client registered in one Zendesk account works only for that account.
 */
import { z } from "zod";
import type { Secret } from "@/server/crypto/credentials";
import { env } from "@/server/env";
import { safeFetch } from "@/server/net/safe-fetch";
import { appOrigin } from "@/server/origin";

export const ZENDESK_SCOPES = "read write";
/** Ask for the longest refresh lifetime Zendesk allows (90 days). */
const REFRESH_TOKEN_TTL_S = 7_776_000;

export type ZendeskOAuthConfig = { clientId: string; clientSecret: string; subdomain: string };

export function zendeskOAuthConfig(): ZendeskOAuthConfig | null {
  const e = env();
  if (!e.ZENDESK_OAUTH_CLIENT_ID || !e.ZENDESK_OAUTH_CLIENT_SECRET || !e.ZENDESK_OAUTH_SUBDOMAIN) return null;
  return { clientId: e.ZENDESK_OAUTH_CLIENT_ID, clientSecret: e.ZENDESK_OAUTH_CLIENT_SECRET, subdomain: e.ZENDESK_OAUTH_SUBDOMAIN.toLowerCase() };
}

export const zendeskRedirectUri = () => `${appOrigin()}/api/oauth/zendesk/callback`;

export function zendeskAuthorizeUrl(cfg: ZendeskOAuthConfig, state: string, codeChallenge: string): string {
  const u = new URL(`https://${cfg.subdomain}.zendesk.com/oauth/authorizations/new`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", zendeskRedirectUri());
  u.searchParams.set("scope", ZENDESK_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().nullable().optional(),
  refresh_token_expires_in: z.number().nullable().optional(),
});

export class OAuthError extends Error {
  constructor(
    readonly code: "invalid_grant" | "failed",
    message: string,
  ) {
    super(message);
  }
}

async function tokenRequest(cfg: ZendeskOAuthConfig, body: Record<string, unknown>): Promise<Extract<Secret, { kind: "oauth" }>> {
  const res = await safeFetch(`https://${cfg.subdomain}.zendesk.com/oauth/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: ZENDESK_SCOPES, refresh_token_expires_in: REFRESH_TOKEN_TTL_S, ...body }),
    maxBytes: 64 * 1024,
    timeoutMs: 10_000,
    maxRedirects: 0,
  });
  let json: unknown = null;
  try {
    json = JSON.parse(res.text());
  } catch {
    /* handled below */
  }
  if (res.status >= 400) {
    const err = (json as { error?: string } | null)?.error;
    // Never log the response body: on success it holds tokens. Errors carry only a code.
    throw new OAuthError(err === "invalid_grant" ? "invalid_grant" : "failed", `Zendesk refused the sign-in (HTTP ${res.status}${err ? `, ${err}` : ""}).`);
  }
  const t = TokenResponse.safeParse(json);
  if (!t.success) throw new OAuthError("failed", "Zendesk's answer didn't include a token.");
  if (!t.data.refresh_token) throw new OAuthError("failed", "Zendesk didn't return a refresh token, so the connection couldn't stay signed in.");
  const now = Date.now();
  return {
    kind: "oauth",
    provider: "zendesk",
    subdomain: cfg.subdomain,
    accessToken: t.data.access_token,
    refreshToken: t.data.refresh_token,
    expiresAt: t.data.expires_in ? now + t.data.expires_in * 1000 : null,
    refreshExpiresAt: t.data.refresh_token_expires_in ? now + t.data.refresh_token_expires_in * 1000 : null,
  };
}

export function exchangeZendeskCode(cfg: ZendeskOAuthConfig, code: string, codeVerifier: string) {
  return tokenRequest(cfg, { grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: zendeskRedirectUri() });
}

export function refreshZendeskToken(cfg: ZendeskOAuthConfig, refreshToken: string) {
  return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });
}
