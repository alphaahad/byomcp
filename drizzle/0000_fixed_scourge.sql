CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."auth_type" AS ENUM('none', 'api_key', 'bearer', 'basic');--> statement-breakpoint
CREATE TYPE "public"."call_source" AS ENUM('mcp', 'try_it', 'approval');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('success', 'empty_or_invalid', 'auth_failed', 'transient_failed', 'request_error', 'validation_error', 'pending_approval', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."connector_status" AS ENUM('draft', 'published', 'paused');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('active', 'needs_reconnect');--> statement-breakpoint
CREATE TYPE "public"."evidence" AS ENUM('tested', 'sourced', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."http_method" AS ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."risk_tier" AS ENUM('read', 'write', 'destructive');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('openapi_url', 'openapi_file', 'docs_url', 'text', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"resource" text NOT NULL,
	"method" "http_method" NOT NULL,
	"path" text NOT NULL,
	"params_json" jsonb NOT NULL,
	"success_check" jsonb,
	"pagination_json" jsonb,
	"risk" "risk_tier" NOT NULL,
	"evidence" "evidence" NOT NULL,
	"citation_json" jsonb,
	"confidence" real NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_destructive_needs_approval" CHECK ("actions"."risk" <> 'destructive' OR "actions"."requires_approval"),
	CONSTRAINT "actions_key_format" CHECK ("actions"."key" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_call_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"action_id" uuid,
	"input_json" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"result_tool_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_tool_call_id_unique" UNIQUE("tool_call_id")
);
--> statement-breakpoint
CREATE TABLE "connector_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_ref" text,
	"llm_provider" text,
	"llm_model" text,
	"import_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_url" text,
	"auth_type" "auth_type",
	"auth_config_json" jsonb,
	"status" "connector_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connectors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"type" "auth_type" NOT NULL,
	"encrypted_blob" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"hint" text,
	"status" "credential_status" DEFAULT 'active' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoint_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "endpoint_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"version_id" uuid,
	"status" "import_status" DEFAULT 'queued' NOT NULL,
	"pages_read" integer DEFAULT 0 NOT NULL,
	"actions_found" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"version_id" uuid,
	"action_id" uuid,
	"action_key" text NOT NULL,
	"source" "call_source" NOT NULL,
	"input_json" jsonb,
	"status" "call_status" NOT NULL,
	"http_status" integer,
	"failure_reason" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer,
	"response_preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_version_id_connector_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."connector_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_result_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("result_tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_versions" ADD CONSTRAINT "connector_versions_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_current_version_id_connector_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."connector_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_tokens" ADD CONSTRAINT "endpoint_tokens_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_version_id_connector_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."connector_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_version_id_connector_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."connector_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actions_version_key_uq" ON "actions" USING btree ("version_id","key");--> statement-breakpoint
CREATE INDEX "actions_version_idx" ON "actions" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "approvals_pending_idx" ON "approvals" USING btree ("created_at") WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "connector_versions_connector_version_uq" ON "connector_versions" USING btree ("connector_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_connector_uq" ON "credentials" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "endpoint_tokens_connector_idx" ON "endpoint_tokens" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "tool_calls_connector_created_idx" ON "tool_calls" USING btree ("connector_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_calls_action_idx" ON "tool_calls" USING btree ("action_id");