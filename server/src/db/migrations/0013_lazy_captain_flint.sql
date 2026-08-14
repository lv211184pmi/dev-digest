CREATE TABLE "convention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"dropped_count" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" double precision,
	"skill_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "run_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_start_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_end_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "convention_runs" ADD CONSTRAINT "convention_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_runs" ADD CONSTRAINT "convention_runs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_runs" ADD CONSTRAINT "convention_runs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convention_runs_repo_idx" ON "convention_runs" USING btree ("repo_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "convention_runs_active_uniq" ON "convention_runs" USING btree ("repo_id") WHERE "convention_runs"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_run_id_convention_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."convention_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conventions_run_idx" ON "conventions" USING btree ("run_id");