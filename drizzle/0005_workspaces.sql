CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"passcode_hash" text,
	"last_sign_in_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_passcode_hash_unique" UNIQUE("passcode_hash"),
	CONSTRAINT "workspaces_guest_has_passcode" CHECK ("workspaces"."is_owner" or "workspaces"."passcode_hash" is not null)
);
--> statement-breakpoint
-- Existing apps move into the owner workspace (the APP_PASSCODE one).
INSERT INTO "workspaces" ("label", "is_owner") VALUES ('Your workspace', true);--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
UPDATE "connectors" SET "workspace_id" = (SELECT "id" FROM "workspaces" WHERE "is_owner");--> statement-breakpoint
ALTER TABLE "connectors" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_one_owner_uq" ON "workspaces" USING btree ("is_owner") WHERE "workspaces"."is_owner";--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connectors_workspace_idx" ON "connectors" USING btree ("workspace_id");