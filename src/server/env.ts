import "server-only";
import { z } from "zod";

/**
 * Server env, validated on first use (not at import), so `next build`
 * doesn't need secrets and a missing variable fails with a clear message.
 */
const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded (openssl rand -base64 32)");

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  CREDENTIALS_ENCRYPTION_KEY: base64Key32,
  APP_PASSCODE: z.string().min(8, "must be at least 8 characters"),
  RESEND_API_KEY: z.string().min(1).optional(), // approval emails are off without it
  NOTIFY_FROM: z.string().min(3).default("BYOMCP <onboarding@resend.dev>"),
  // "Connect with Zendesk" (OAuth). A client registered in one Zendesk works only for that account.
  ZENDESK_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  ZENDESK_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  ZENDESK_OAUTH_SUBDOMAIN: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/i).optional(),
  LLM_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
  LLM_MODEL: z.string().min(1).optional(), // AI import is off without it
  LLM_FALLBACK_MODEL: z.string().min(1).optional(), // comma-separated, tried in order when the model before is overloaded or out of quota
  GEMINI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});
export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  // `KEY=` in a .env file means "not set", not "set to an empty string".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${problems}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
