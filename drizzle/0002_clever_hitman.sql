CREATE TYPE "public"."chunk_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_stage" AS ENUM('fetching', 'extracting', 'merging', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "import_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"segments" jsonb,
	"status" "chunk_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result_json" jsonb,
	"error" text,
	"model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "stage" "import_stage" DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "start_url" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "max_pages" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "pending_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "pages_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "openapi_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "chunks_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "chunks_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "tokens_in" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "tokens_out" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "cost_usd" numeric(10, 6);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "cost_known" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD CONSTRAINT "import_chunks_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_chunks_job_seq_uq" ON "import_chunks" USING btree ("job_id","seq");