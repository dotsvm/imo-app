ALTER TABLE "realized_pnl" ADD COLUMN "order_id" uuid;--> statement-breakpoint
CREATE INDEX "realized_order" ON "realized_pnl" USING btree ("order_id");--> statement-breakpoint
SELECT hunch_lock_down();
