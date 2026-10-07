ALTER TABLE "fills" ADD COLUMN "venue_fill_id" text;--> statement-breakpoint
ALTER TABLE "fills" ADD COLUMN "tx_signature" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "venue_position_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tx_signature" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "fills_venue_fill" ON "fills" USING btree ("venue_fill_id");--> statement-breakpoint
CREATE INDEX "orders_in_flight" ON "orders" USING btree ("submitted_at") WHERE status = 'pending' and venue_order_id is not null;