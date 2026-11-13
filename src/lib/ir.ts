/**
 * Action IR: the contract between extraction, review and the MCP runtime.
 * See docs/SPEC.md section 7.2. Every action that reaches the database
 * (from the OpenAPI parser or the LLM extractor) must pass ActionIRSchema.
 */
import { z } from "zod";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const RISK_TIERS = ["read", "write", "destructive"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const EVIDENCE_STATES = ["tested", "sourced", "needs_review"] as const;
export type Evidence = (typeof EVIDENCE_STATES)[number];

export const PAGINATION_STYLES = ["page", "cursor", "offset", "none"] as const;

export const ACTION_KEY_MAX = 64;
const ACTION_KEY_RE = /^[a-z][a-z0-9_]*$/;

export const ActionKeySchema = z
  .string()
  .min(1)
  .max(ACTION_KEY_MAX)
  .regex(ACTION_KEY_RE, "Use lowercase letters, digits and underscores, starting with a letter");

/**
 * A JSON Schema object node (type: "object"). Kept loose on purpose: we
 * validate the shape we depend on (properties + required) and pass the rest
 * through, so valid JSON Schema keywords from OpenAPI aren't stripped.
 */
export const JsonSchemaObjectSchema = z.looseObject({
  type: z.literal("object"),
  properties: z.record(z.string(), z.unknown()).default({}),
  required: z.array(z.string()).optional(),
});
export type JsonSchemaObject = z.infer<typeof JsonSchemaObjectSchema>;

export const emptyObjectSchema = (): JsonSchemaObject => ({ type: "object", properties: {} });

export const ActionIRSchema = z
  .object({
    key: ActionKeySchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000),
    resource: z.string().trim().min(1).max(60),
    method: z.enum(HTTP_METHODS),
    path: z
      .string()
      .min(1)
      .max(500)
      .startsWith("/", "Path must start with /"),
    params: z.object({
      path: JsonSchemaObjectSchema,
      query: JsonSchemaObjectSchema,
      headers: JsonSchemaObjectSchema,
      body: JsonSchemaObjectSchema.optional(),
    }),
    successCheck: z.object({ field: z.string().min(1).max(200) }).optional(),
    pagination: z
      .object({ style: z.enum(PAGINATION_STYLES), hint: z.string().max(300).optional() })
      .optional(),
    risk: z.enum(RISK_TIERS),
    evidence: z.enum(EVIDENCE_STATES),
    citation: z
      .object({ url: z.url().optional(), quote: z.string().trim().min(1).max(500) })
      .optional(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((action, ctx) => {
    // Every {placeholder} in the path must have a matching path parameter.
    const placeholders = pathPlaceholders(action.path);
    const declared = Object.keys(action.params.path.properties);
    for (const name of placeholders) {
      if (!declared.includes(name)) {
        ctx.addIssue({
          code: "custom",
          path: ["params", "path"],
          message: `Path uses {${name}} but no path parameter "${name}" is defined`,
        });
      }
    }
    // A method can't make an action safer than its HTTP verb implies.
    if (riskRank(action.risk) < riskRank(riskFromMethod(action.method))) {
      ctx.addIssue({
        code: "custom",
        path: ["risk"],
        message: `${action.method} actions can't be marked "${action.risk}"`,
      });
    }
  });
export type ActionIR = z.infer<typeof ActionIRSchema>;

export function pathPlaceholders(path: string): string[] {
  return [...path.matchAll(/\{([^}/]+)\}/g)].map((m) => m[1]);
}

/* ------------------------------------------------------------------ */
/* Risk rules (SPEC 7.2)                                               */
/* ------------------------------------------------------------------ */

// Whole words only. Irreversible or hard-to-undo operations, even when sent as POST/PUT.
const DESTRUCTIVE_WORDS = [
  "delete", "remove", "destroy", "cancel", "refund", "void", "archive", "purge", "revoke",
  "redact", "redaction", "redactions", "merge", "erase", "anonymize", "anonymise", "wipe", "terminate", "permanently", "truncate",
];

export function riskFromMethod(method: HttpMethod): RiskTier {
  if (method === "GET") return "read";
  if (method === "DELETE") return "destructive";
  return "write";
}

/** Destructive if the verb is DELETE or any of key/title/path names a destructive operation. */
export function classifyRisk(input: { method: HttpMethod; key?: string; title?: string; path?: string }): RiskTier {
  const base = riskFromMethod(input.method);
  if (base === "destructive") return base;
  const words = [input.key, input.title, input.path]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/[^a-z]+/);
  // A GET named "list archived tickets" stays a read; only writes escalate.
  if (base === "write" && words.some((w) => DESTRUCTIVE_WORDS.includes(w))) return "destructive";
  return base;
}

export function riskRank(risk: RiskTier): number {
  return RISK_TIERS.indexOf(risk);
}

/** Safe defaults (SPEC 8): reads on, writes and destructive off. */
export function defaultEnabled(risk: RiskTier): boolean {
  return risk === "read";
}

/**
 * Above this many actions, nothing starts on: the person picks what the AI
 * employee needs. Hundreds of tools make models choose badly (and some MCP
 * clients cap the count), so a big API is a menu, not a default.
 */
export const LARGE_SPEC_THRESHOLD = 30;
/** Tool count past which we warn that models will choose tools less reliably. */
export const MANY_TOOLS_WARNING = 40;

export function initialEnabled(risk: RiskTier, totalActions: number): boolean {
  return totalActions > LARGE_SPEC_THRESHOLD ? false : defaultEnabled(risk);
}

/** Writes can require approval; destructive always does. Default: every non-read needs approval. */
export function defaultRequiresApproval(risk: RiskTier): boolean {
  return risk !== "read";
}

/** MCP tool annotations derived from risk. */
export function toolAnnotations(risk: RiskTier): { readOnlyHint: boolean; destructiveHint: boolean } {
  return { readOnlyHint: risk === "read", destructiveHint: risk === "destructive" };
}

/* ------------------------------------------------------------------ */
/* Key helpers                                                         */
/* ------------------------------------------------------------------ */

/** Turn any label ("Create a Ticket", "tickets.create") into a valid action key. */
export function toActionKey(raw: string): string {
  let key = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) key = "action";
  if (!/^[a-z]/.test(key)) key = `a_${key}`;
  return key.slice(0, ACTION_KEY_MAX).replace(/_+$/, "");
}

/** Make keys unique within a connector by suffixing _2, _3 … (still <= 64 chars). */
export function dedupeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  return keys.map((k) => {
    let candidate = k;
    for (let n = 2; seen.has(candidate); n++) {
      const suffix = `_${n}`;
      candidate = `${k.slice(0, ACTION_KEY_MAX - suffix.length)}${suffix}`;
    }
    seen.add(candidate);
    return candidate;
  });
}
