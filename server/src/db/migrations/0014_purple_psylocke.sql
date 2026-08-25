CREATE TABLE "pr_blast" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"head_sha" text,
	"facts_hash" text,
	"provider" text,
	"model" text,
	"cost_usd" double precision,
	"tokens_in" integer,
	"tokens_out" integer,
	"derived_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "scope" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "risk_areas" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "confidence" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "sources_hash" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "provider" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN IF NOT EXISTS "derived_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "pr_blast" ADD CONSTRAINT "pr_blast_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;