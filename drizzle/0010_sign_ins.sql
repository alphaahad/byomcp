CREATE TABLE "sign_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sign_ins" ADD CONSTRAINT "sign_ins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sign_ins_workspace_created_idx" ON "sign_ins" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "sign_ins_created_idx" ON "sign_ins" USING btree ("created_at");--> statement-breakpoint
-- Backfill: the latest known sign-in per workspace, so history starts from what we have.
INSERT INTO "sign_ins" ("workspace_id", "created_at") SELECT "id", "last_sign_in_at" FROM "workspaces" WHERE "last_sign_in_at" IS NOT NULL;
