ALTER TABLE "approvals" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "notify_email" text;