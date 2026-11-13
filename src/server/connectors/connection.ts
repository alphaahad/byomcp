import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { openSecret, sealSecret, secretHint, type Secret } from "@/server/crypto/credentials";
import { db } from "@/server/db";
import { connectors, credentials } from "@/server/db/schema";
import { env } from "@/server/env";
import { needsRefresh } from "@/server/oauth/state";
import { OAuthError, refreshZendeskToken, zendeskOAuthConfig } from "@/server/oauth/zendesk";

export const AuthTypeSchema = z.enum(["none", "api_key", "bearer", "basic"]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

/** What the browser may see about a connection: never the secret. */
export type ConnectionSummary = {
  baseUrl: string | null;
  authType: AuthType | null;
  apiKey?: { in: "header" | "query" | "path"; name: string };
  credential: { hint: string; status: "active" | "needs_reconnect"; lastVerifiedAt: Date | null } | null;
};

export async function getConnectionSummary(connectorId: string): Promise<ConnectionSummary | null> {
  const d = db();
  const [c] = await d.select().from(connectors).where(eq(connectors.id, connectorId)).limit(1);
  if (!c) return null;
  const [cred] = await d.select().from(credentials).where(eq(credentials.connectorId, connectorId)).limit(1);
  return {
    baseUrl: c.baseUrl,
    authType: c.authType,
    apiKey: c.authType === "api_key" && c.authConfig ? c.authConfig : undefined,
    credential: cred ? { hint: cred.hint ?? "Saved", status: cred.status, lastVerifiedAt: cred.lastVerifiedAt } : null,
  };
}

/**
 * Save the server address, sign-in type and (optionally) a new secret.
 * If `secret` is omitted and a credential of the same type exists, it's kept.
 */
export async function saveConnection(input: {
  connectorId: string;
  baseUrl: string;
  authType: AuthType;
  apiKey?: { in: "header" | "query" | "path"; name: string };
  secret?: Secret;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const d = db();
  const [existing] = await d.select().from(credentials).where(eq(credentials.connectorId, input.connectorId)).limit(1);

  if (input.authType !== "none" && !input.secret && (!existing || existing.type !== input.authType)) {
    return { ok: false, error: "Enter the key or password for this sign-in type." };
  }
  // A saved key is only ever sent to the address it was saved for. Moving the
  // app to another host means entering the key again.
  if (existing && !input.secret && input.authType !== "none") {
    const [current] = await d.select({ baseUrl: connectors.baseUrl }).from(connectors).where(eq(connectors.id, input.connectorId)).limit(1);
    const origin = (u: string | null | undefined) => {
      try {
        return u ? new URL(u).origin : null;
      } catch {
        return null;
      }
    };
    if (origin(current?.baseUrl) !== origin(input.baseUrl)) {
      return { ok: false, error: "You changed the server address, so enter the key again. A saved key is never sent to a new address." };
    }
  }

  const ops = [];
  ops.push(
    d
      .update(connectors)
      .set({
        baseUrl: input.baseUrl,
        authType: input.authType,
        authConfig: input.authType === "api_key" ? input.apiKey ?? null : null,
      })
      .where(eq(connectors.id, input.connectorId)),
  );
  if (input.authType === "none") {
    ops.push(d.delete(credentials).where(eq(credentials.connectorId, input.connectorId)));
  } else if (input.secret) {
    const sealed = sealSecret(input.secret, input.connectorId, env().CREDENTIALS_ENCRYPTION_KEY);
    const row = { ...sealed, type: input.authType, hint: secretHint(input.secret), status: "active" as const, lastVerifiedAt: null };
    ops.push(
      d
        .insert(credentials)
        .values({ connectorId: input.connectorId, ...row })
        .onConflictDoUpdate({ target: credentials.connectorId, set: row }),
    );
  }
  await d.batch(ops as [(typeof ops)[number], ...(typeof ops)[number][]]);
  return { ok: true };
}

/** Server-only: decrypt the connector's secret for one outgoing request. */
export async function loadSecret(connectorId: string): Promise<Secret | null> {
  const [cred] = await db().select().from(credentials).where(eq(credentials.connectorId, connectorId)).limit(1);
  if (!cred) return null;
  return openSecret(cred, connectorId, env().CREDENTIALS_ENCRYPTION_KEY);
}

export async function markCredential(connectorId: string, status: "active" | "needs_reconnect") {
  await db()
    .update(credentials)
    .set({ status, ...(status === "active" ? { lastVerifiedAt: new Date() } : {}) })
    .where(eq(credentials.connectorId, connectorId));
}

/**
 * The secret to send on one request, ready to use. For "Connect with Zendesk"
 * that means a current access token: refreshed (and the rotated pair saved)
 * shortly before it expires, or when `force` is set after a 401. Returns null
 * if the connection can't be used (the caller says "reconnect").
 */
export async function loadUsableSecret(connectorId: string, opts: { force?: boolean } = {}): Promise<Secret | null> {
  const secret = await loadSecret(connectorId);
  if (!secret || secret.kind !== "oauth") return secret;
  if (!opts.force && !needsRefresh(secret.expiresAt)) return { kind: "bearer", token: secret.accessToken };

  const cfg = zendeskOAuthConfig();
  if (!cfg || cfg.subdomain !== secret.subdomain) return null;
  try {
    const next = await refreshZendeskToken(cfg, secret.refreshToken);
    await storeOAuthSecret(connectorId, next);
    return { kind: "bearer", token: next.accessToken };
  } catch (err) {
    // Refresh tokens rotate: if another request refreshed first, ours is now invalid.
    // Use the pair it saved instead of failing.
    if (err instanceof OAuthError && err.code === "invalid_grant") {
      const latest = await loadSecret(connectorId);
      if (latest?.kind === "oauth" && latest.refreshToken !== secret.refreshToken && !needsRefresh(latest.expiresAt)) {
        return { kind: "bearer", token: latest.accessToken };
      }
    }
    return null;
  }
}

/** Save rotated OAuth tokens without touching the rest of the connection. */
async function storeOAuthSecret(connectorId: string, secret: Secret) {
  const sealed = sealSecret(secret, connectorId, env().CREDENTIALS_ENCRYPTION_KEY);
  await db()
    .update(credentials)
    .set({ ...sealed, hint: secretHint(secret), status: "active", lastVerifiedAt: new Date() })
    .where(eq(credentials.connectorId, connectorId));
}

/** True if this app is connected with "Connect with Zendesk" (OAuth). */
export async function isOAuthConnection(connectorId: string): Promise<boolean> {
  const [cred] = await db().select({ hint: credentials.hint }).from(credentials).where(eq(credentials.connectorId, connectorId)).limit(1);
  return !!cred?.hint?.startsWith("Signed in with ");
}
