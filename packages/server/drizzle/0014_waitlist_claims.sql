ALTER TABLE "waitlist" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_user" ON "waitlist" USING btree ("user_id") WHERE "waitlist"."user_id" is not null;--> statement-breakpoint
SELECT hunch_lock_down();
