ALTER TABLE "posts" DROP CONSTRAINT "posts_text_length";--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_text_length" CHECK (char_length("posts"."text") between 1 and 600);