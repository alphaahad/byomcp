/**
 * Postgres registry (Drizzle). See docs/SPEC.md section 7.3 and
 * docs/ARCHITECTURE.md for how the tables relate.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { EVIDENCE_STATES, HTTP_METHODS, RISK_TIERS } from "@/lib/ir";
import type { ActionIR, JsonSchemaObject } from "@/lib/ir";
import type { DetectedConfig, SkippedOperation } from "@/lib/import-types";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* Enums ------------------------------------------------------------- */

export const authTypeEnum = pgEnum("auth_type", ["none", "api_key", "bearer", "basic"]);
export const connectorStatusEnum = pgEnum("connector_status", ["draft", "published", "paused"]);
export const versionStatusEnum = pgEnum("version_status", ["draft", "published", "superseded"]);
export const sourceTypeEnum = pgEnum("source_type", ["openapi_url", "openapi_file", "docs_url", "text", "pdf"]);
export const methodEnum = pgEnum("http_method", HTTP_METHODS);
export const riskEnum = pgEnum("risk_tier", RISK_TIERS);
export const evidenceEnum = pgEnum("evidence", EVIDENCE_STATES);
export const credentialStatusEnum = pgEnum("credential_status", ["active", "needs_reconnect"]);
export const callSourceEnum = pgEnum("call_source", ["mcp", "try_it", "approval"]);
export const callStatusEnum = pgEnum("call_status", [
  "success",
  "empty_or_invalid",
  "auth_failed",
  "transient_failed",
  "request_error",
  "validation_error",
  "pending_approval",
  "rejected",
]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected", "expired"]);
export const importStatusEnum = pgEnum("import_status", ["queued", "running", "done", "failed"]);

/* Tables ------------------------------------------------------------ */

/**
 * One workspace per passcode. The owner workspace signs in with APP_PASSCODE
 * (env, no hash stored); guests sign in with their own passcode, stored only as
 * a SHA-256 hash (passcodes are ~100-bit random, like endpoint tokens).
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    label: text("label").notNull(),
    isOwner: boolean("is_owner").notNull().default(false),
    passcodeHash: text("passcode_hash").unique(),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    /** Where to email "a request is waiting for your approval". Optional. */
    notifyEmail: text("notify_email"),
    /** Last confirmation email sent (throttle). The address only becomes notifyEmail once its link is clicked. */
    notifyConfirmSentAt: timestamp("notify_confirm_sent_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // Exactly one owner; every guest has a passcode.
    uniqueIndex("workspaces_one_owner_uq").on(t.isOwner).where(sql`${t.isOwner}`),
    check("workspaces_guest_has_passcode", sql`${t.isOwner} or ${t.passcodeHash} is not null`),
  ],
);

/** Where an API key goes when auth_type = api_key. */
export type ApiKeyPlacement = { in: "header" | "query" | "path"; name: string };

export const connectors = pgTable("connectors", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  baseUrl: text("base_url"), // confirmed public https host; null until the user confirms it
  authType: authTypeEnum("auth_type"),
  authConfig: jsonb("auth_config_json").$type<ApiKeyPlacement>(),
  status: connectorStatusEnum("status").notNull().default("draft"),
  // Opt-in, less secure: also accept the endpoint token in the URL path (for MCP clients that can't send headers).
  allowUrlToken: boolean("allow_url_token").notNull().default(false),
  currentVersionId: uuid("current_version_id").references((): AnyPgColumn => connectorVersions.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [index("connectors_workspace_idx").on(t.workspaceId)]);

export const connectorVersions = pgTable(
  "connector_versions",
  {
    id: id(),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: versionStatusEnum("status").notNull().default("draft"),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceRef: text("source_ref"), // URL or file name; pasted text is not stored here
    // What the importer detected (base URL candidates, auth, warnings). Suggestions only:
    // connectors.base_url / auth_type are set when the user confirms them.
    detected: jsonb("detected_json").$type<DetectedConfig>(),
    skipped: jsonb("skipped_json").$type<SkippedOperation[]>(),
    llmProvider: text("llm_provider"),
    llmModel: text("llm_model"),
    importCostUsd: numeric("import_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    createdAt: createdAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("connector_versions_connector_version_uq").on(t.connectorId, t.version)],
);

export const actions = pgTable(
  "actions",
  {
    id: id(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => connectorVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    resource: text("resource").notNull(),
    method: methodEnum("method").notNull(),
    path: text("path").notNull(),
    params: jsonb("params_json")
      .$type<{
        path: JsonSchemaObject;
        query: JsonSchemaObject;
        headers: JsonSchemaObject;
        body?: JsonSchemaObject;
      }>()
      .notNull(),
    successCheck: jsonb("success_check").$type<ActionIR["successCheck"]>(),
    pagination: jsonb("pagination_json").$type<ActionIR["pagination"]>(),
    risk: riskEnum("risk").notNull(),
    evidence: evidenceEnum("evidence").notNull(),
    citation: jsonb("citation_json").$type<ActionIR["citation"]>(),
    confidence: real("confidence").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    // True once a person changed what the importer drafted (for the "accepted without edits" metric).
    edited: boolean("edited").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("actions_version_key_uq").on(t.versionId, t.key),
    index("actions_version_idx").on(t.versionId),
    // Destructive actions can never skip approval, whatever the UI sends.
    // The executor checks this too; the constraint is the last line of defence.
    check("actions_destructive_needs_approval", sql`${t.risk} <> 'destructive' OR ${t.requiresApproval}`),
    check("actions_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,63}$'`),
  ],
);

export const credentials = pgTable(
  "credentials",
  {
    id: id(),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    type: authTypeEnum("type").notNull(),
    // AES-256-GCM, key from CREDENTIALS_ENCRYPTION_KEY. All base64.
    encryptedBlob: text("encrypted_blob").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    hint: text("hint"), // e.g. last 4 chars, so the UI can say "key ending 3f9a" without decrypting
    status: credentialStatusEnum("status").notNull().default("active"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("credentials_connector_uq").on(t.connectorId)],
);

export const endpointTokens = pgTable(
  "endpoint_tokens",
  {
    id: id(),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(), // sha256 hex; the token itself is shown once
    tokenPrefix: text("token_prefix").notNull(), // first chars, for display only
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("endpoint_tokens_connector_idx").on(t.connectorId)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: id(),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => connectorVersions.id, { onDelete: "set null" }),
    actionId: uuid("action_id").references(() => actions.id, { onDelete: "set null" }),
    actionKey: text("action_key").notNull(), // kept even if the action is later deleted
    source: callSourceEnum("source").notNull(),
    input: jsonb("input_json").$type<Record<string, unknown>>(), // redacted
    status: callStatusEnum("status").notNull(),
    httpStatus: integer("http_status"),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").notNull().default(1),
    durationMs: integer("duration_ms"),
    responsePreview: text("response_preview"), // truncated, redacted
    createdAt: createdAt(),
  },
  (t) => [
    index("tool_calls_connector_created_idx").on(t.connectorId, t.createdAt.desc()),
    index("tool_calls_action_idx").on(t.actionId),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    toolCallId: uuid("tool_call_id")
      .notNull()
      .unique()
      .references(() => toolCalls.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    actionId: uuid("action_id").references(() => actions.id, { onDelete: "set null" }),
    // The exact input to run on approval. Holds no credentials: those are injected at execution.
    input: jsonb("input_json").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(), // plain language: "Create a ticket in Freshdesk with subject …"
    status: approvalStatusEnum("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    resultToolCallId: uuid("result_tool_call_id").references(() => toolCalls.id, { onDelete: "set null" }),
    /** Set when the "waiting for approval" email was sent (at most once per request). */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("approvals_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const importStageEnum = pgEnum("import_stage", ["fetching", "extracting", "merging", "done", "failed"]);

/**
 * An import's progress. AI imports advance in short steps (each well under any
 * function time limit), driven by the progress page; `lease_until` stops two
 * tabs from running the same step at once.
 */
export const importJobs = pgTable("import_jobs", {
  id: id(),
  connectorId: uuid("connector_id")
    .notNull()
    .references(() => connectors.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").references(() => connectorVersions.id, { onDelete: "set null" }),
  status: importStatusEnum("status").notNull().default("queued"),
  stage: importStageEnum("stage").notNull().default("done"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  startUrl: text("start_url"),
  maxPages: integer("max_pages").notNull().default(1),
  pendingUrls: jsonb("pending_urls").$type<string[]>().notNull().default([]),
  // Fetched page text, held only until it's chunked; cleared afterwards.
  pages: jsonb("pages_json").$type<{ url: string | null; text: string }[]>().notNull().default([]),
  openApiLinks: jsonb("openapi_links").$type<string[]>().notNull().default([]),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  pagesRead: integer("pages_read").notNull().default(0),
  chunksTotal: integer("chunks_total").notNull().default(0),
  chunksDone: integer("chunks_done").notNull().default(0),
  actionsFound: integer("actions_found").notNull().default(0),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  costKnown: boolean("cost_known").notNull().default(true),
  error: text("error"),
  createdAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const chunkStatusEnum = pgEnum("chunk_status", ["pending", "done", "failed"]);

/** One AI extraction unit. Text is cleared once the import finishes; results and cost stay. */
export const importChunks = pgTable(
  "import_chunks",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    segments: jsonb("segments").$type<{ url: string | null; text: string }[]>(),
    status: chunkStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result_json").$type<unknown>(),
    error: text("error"),
    model: text("model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("import_chunks_job_seq_uq").on(t.jobId, t.seq)],
);

/** "Don't see your app? Tell us": which apps people want in the catalog. */
export const appRequests = pgTable(
  "app_requests",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    appName: text("app_name").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("app_requests_created_idx").on(t.createdAt)],
);

/** One "Talk to it" message: for the guest daily cap and the estimated AI cost. */
export const chatUsage = pgTable(
  "chat_usage",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").references(() => connectors.id, { onDelete: "set null" }),
    model: text("model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: createdAt(),
  },
  (t) => [index("chat_usage_workspace_created_idx").on(t.workspaceId, t.createdAt)],
);

/** Failed sign-ins per client (IP stored only as a keyed hash), for brute-force limits. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    ipHash: text("ip_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_ip_created_idx").on(t.ipHash, t.createdAt), index("login_attempts_created_idx").on(t.createdAt)],
);
