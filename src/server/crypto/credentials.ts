import "server-only";
/**
 * Credentials at rest: AES-256-GCM, key from CREDENTIALS_ENCRYPTION_KEY,
 * a fresh 96-bit IV per write, and the connector id bound in as additional
 * authenticated data, so a ciphertext copied onto another connector won't
 * decrypt. Plaintext exists only in memory, only on the server, only while a
 * request is being sent. It is never logged, returned to the browser, or sent to the LLM.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

export const SecretSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("api_key"), value: z.string().min(1).max(4096) }),
  z.object({ kind: z.literal("bearer"), token: z.string().min(1).max(8192) }),
  z.object({ kind: z.literal("basic"), username: z.string().min(1).max(512), password: z.string().max(4096) }),
  // "Connect with Zendesk": OAuth tokens, refreshed by the runtime. Sent as a Bearer token.
  z.object({
    kind: z.literal("oauth"),
    provider: z.literal("zendesk"),
    subdomain: z.string().min(1).max(63),
    accessToken: z.string().min(1).max(8192),
    refreshToken: z.string().min(1).max(8192),
    /** Epoch ms; null = no expiry given. */
    expiresAt: z.number().nullable(),
    refreshExpiresAt: z.number().nullable(),
  }),
]);
export type Secret = z.infer<typeof SecretSchema>;

export type Sealed = { encryptedBlob: string; iv: string; authTag: string };

const aad = (connectorId: string) => Buffer.from(`byomcp:credential:v1:${connectorId}`, "utf8");

function keyFrom(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (base64)");
  return key;
}

export function sealSecret(secret: Secret, connectorId: string, keyB64: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  cipher.setAAD(aad(connectorId));
  const data = Buffer.concat([cipher.update(JSON.stringify(SecretSchema.parse(secret)), "utf8"), cipher.final()]);
  return { encryptedBlob: data.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

/** Throws if the key, IV, tag, ciphertext or connector binding don't match. */
export function openSecret(sealed: Sealed, connectorId: string, keyB64: string): Secret {
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyB64), Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(aad(connectorId));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(sealed.encryptedBlob, "base64")), decipher.final()]).toString("utf8");
  return SecretSchema.parse(JSON.parse(plain));
}

/** Safe-to-show description: never more than the last 4 characters of a secret. */
export function secretHint(secret: Secret): string {
  const tail = (s: string) => (s.length >= 8 ? `ending ${s.slice(-4)}` : "saved");
  switch (secret.kind) {
    case "api_key":
      return `API key ${tail(secret.value)}`;
    case "bearer":
      return `Token ${tail(secret.token)}`;
    case "oauth":
      return `Signed in with Zendesk (${secret.subdomain}.zendesk.com)`;
    case "basic":
      return `Username ${secret.username.length > 24 ? `${secret.username.slice(0, 3)}…${secret.username.slice(-4)}` : secret.username.length >= 16 ? `ending ${secret.username.slice(-4)}` : secret.username}, password ${secret.password ? "saved" : "empty"}`;
  }
}

/** Every secret string, for scrubbing them out of logs and response previews. */
export function secretValues(secret: Secret): string[] {
  const vals =
    secret.kind === "api_key"
      ? [secret.value]
      : secret.kind === "bearer"
        ? [secret.token]
        : secret.kind === "oauth"
          ? [secret.accessToken, secret.refreshToken]
          : [secret.password, Buffer.from(`${secret.username}:${secret.password}`).toString("base64")];
  return vals.filter((v) => v.length >= 4);
}
