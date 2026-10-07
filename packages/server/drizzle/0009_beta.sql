CREATE TABLE "invite_redemptions" (
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_redemptions_code_user_id_pk" PRIMARY KEY("code","user_id")
);
--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_granted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_code_invites_code_fk" FOREIGN KEY ("code") REFERENCES "public"."invites"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Everyone already here was let in before the gate existed.
UPDATE "users" SET "access_granted_at" = now() WHERE "access_granted_at" IS NULL;
--> statement-breakpoint
SELECT hunch_lock_down();
