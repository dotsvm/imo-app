CREATE TABLE "category_map" (
	"venue_id" text NOT NULL,
	"venue_category" text NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "category_map_venue_id_venue_category_pk" PRIMARY KEY("venue_id","venue_category")
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"health" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"account_model" text DEFAULT 'none' NOT NULL,
	"fee" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routes_mode" CHECK (mode in ('paper', 'live'))
);
--> statement-breakpoint
CREATE TABLE "route_venues" (
	"route_id" text NOT NULL,
	"venue_id" text NOT NULL,
	CONSTRAINT "route_venues_route_id_venue_id_pk" PRIMARY KEY("route_id","venue_id")
);
--> statement-breakpoint
CREATE TABLE "venue_status" (
	"venue_id" text PRIMARY KEY NOT NULL,
	"exchange_active" boolean DEFAULT true NOT NULL,
	"trading_active" boolean DEFAULT true NOT NULL,
	"resumes_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"stage" text DEFAULT 'planned' NOT NULL,
	"display_allowed" boolean DEFAULT false NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_stage" CHECK (stage in ('planned', 'coming-soon', 'data-only', 'paper', 'live'))
);
--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_subject_pk" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by" uuid,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_prefs_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"email" text,
	"theme" text DEFAULT 'Midnight' NOT NULL,
	"price_in_cents" boolean DEFAULT true NOT NULL,
	"show_positions_on_posts" boolean DEFAULT true NOT NULL,
	"appear_on_leaderboard" boolean DEFAULT true NOT NULL,
	"private_open_positions" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"focus" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"initials" text NOT NULL,
	"color" text DEFAULT '#252832' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_role" CHECK (role in ('user', 'admin')),
	CONSTRAINT "users_status" CHECK (status in ('active', 'suspended')),
	CONSTRAINT "users_handle_shape" CHECK ("users"."handle" ~ '^[A-Za-z0-9_]{2,24}$')
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"email" text PRIMARY KEY NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"custody" text NOT NULL,
	"provider" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_chain" CHECK (chain in ('solana', 'ethereum')),
	CONSTRAINT "wallets_custody" CHECK (custody in ('embedded', 'external'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_holders" (
	"market_id" uuid PRIMARY KEY NOT NULL,
	"yes" integer DEFAULT 0 NOT NULL,
	"no" integer DEFAULT 0 NOT NULL,
	"yes_share" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_quotes" (
	"market_id" uuid PRIMARY KEY NOT NULL,
	"yes_bid" bigint,
	"yes_ask" bigint,
	"last" bigint,
	"change24h" bigint DEFAULT 0 NOT NULL,
	"series" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_trending" (
	"market_id" uuid PRIMARY KEY NOT NULL,
	"score" double precision NOT NULL,
	"rank" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"venue_id" text NOT NULL,
	"external_id" text NOT NULL,
	"event_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"short_title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rules" text NOT NULL,
	"resolution_source" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"category_hints" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"tick" bigint NOT NULL,
	"quantity_scale" integer DEFAULT 0 NOT NULL,
	"quantity_step" bigint DEFAULT 1 NOT NULL,
	"venue_fee" jsonb NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone NOT NULL,
	"expected_resolution_at" timestamp with time zone,
	"resolution" jsonb,
	"volume" bigint DEFAULT 0 NOT NULL,
	"open_interest" bigint DEFAULT 0 NOT NULL,
	"liquidity" bigint DEFAULT 0 NOT NULL,
	"traders" integer DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_status" CHECK (status in ('upcoming', 'open', 'paused', 'closed', 'determined', 'disputed', 'resolved', 'voided', 'delisted', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"market_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"index" integer NOT NULL,
	"external_id" text,
	CONSTRAINT "outcomes_market_id_key_pk" PRIMARY KEY("market_id","key")
);
--> statement-breakpoint
CREATE TABLE "account_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"equity_before" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"quantity" bigint NOT NULL,
	"payout" bigint NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "claims_status" CHECK (status in ('claimable', 'claimed'))
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"side" text NOT NULL,
	"price" bigint NOT NULL,
	"quantity" bigint NOT NULL,
	"notional" bigint NOT NULL,
	"fees" jsonb NOT NULL,
	"fee_total" bigint NOT NULL,
	"liquidity" text NOT NULL,
	"book" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fills_positive" CHECK ("fills"."quantity" > 0 and "fills"."price" >= 0 and "fills"."fee_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_kind" CHECK (kind in ('deposit', 'reset', 'buy', 'sell', 'venue_fee', 'app_fee', 'rounding_fee', 'reserve', 'release', 'settlement'))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"time_in_force" text NOT NULL,
	"limit_price" bigint,
	"quantity" bigint,
	"budget" bigint,
	"filled_quantity" bigint DEFAULT 0 NOT NULL,
	"average_price" bigint,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"quote" jsonb,
	"post_id" uuid,
	"client_order_id" text NOT NULL,
	"venue_order_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status" CHECK (status in ('pending', 'open', 'partial', 'filled', 'cancelled', 'rejected', 'failed', 'expired')),
	CONSTRAINT "orders_side" CHECK (side in ('buy', 'sell')),
	CONSTRAINT "orders_type" CHECK (type in ('market', 'limit')),
	CONSTRAINT "orders_amount" CHECK ("orders"."quantity" is not null or "orders"."budget" is not null)
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"account_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"quantity" bigint NOT NULL,
	"cost" bigint NOT NULL,
	"fees" bigint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_account_id_market_id_outcome_pk" PRIMARY KEY("account_id","market_id","outcome"),
	CONSTRAINT "positions_nonnegative" CHECK ("positions"."quantity" >= 0 and "positions"."cost" >= 0 and "positions"."fees" >= 0)
);
--> statement-breakpoint
CREATE TABLE "realized_pnl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" bigint NOT NULL,
	"proceeds" bigint NOT NULL,
	"cost" bigint NOT NULL,
	"entry_fees" bigint NOT NULL,
	"exit_fees" bigint NOT NULL,
	"pnl" bigint NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"market_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"currency" text NOT NULL,
	"cash" bigint NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"starting_balance" bigint NOT NULL,
	"season" integer DEFAULT 1 NOT NULL,
	"last_reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_accounts_cash" CHECK ("trading_accounts"."cash" >= 0 and "trading_accounts"."reserved" >= 0 and "trading_accounts"."reserved" <= "trading_accounts"."cash")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"text" text NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "comments_length" CHECK (char_length("comments"."text") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"notify" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follows_not_self" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "post_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"alt" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "post_images_alt" CHECK (char_length("post_images"."alt") > 0)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"entry_price" bigint NOT NULL,
	"text" text NOT NULL,
	"invalidation" text,
	"confidence" text NOT NULL,
	"disclose_position" boolean DEFAULT false NOT NULL,
	"position_snapshot" jsonb,
	"room_id" uuid,
	"editable_until" timestamp with time zone NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"reposts" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"backed" integer DEFAULT 0 NOT NULL,
	"faded" integer DEFAULT 0 NOT NULL,
	"evidence_shares" integer DEFAULT 0 NOT NULL,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "posts_text_length" CHECK (char_length("posts"."text") between 40 and 600),
	CONSTRAINT "posts_confidence" CHECK (confidence in ('Low', 'Medium', 'High'))
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"user_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_user_id_subject_type_subject_id_kind_pk" PRIMARY KEY("user_id","subject_type","subject_id","kind")
);
--> statement-breakpoint
CREATE TABLE "channel_reads" (
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "channel_reads_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"topic" text NOT NULL,
	"market_id" uuid,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_markets" (
	"room_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"added_by" uuid,
	"rank" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_markets_room_id_market_id_pk" PRIMARY KEY("room_id","market_id")
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"notify" text DEFAULT 'mentions' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id"),
	CONSTRAINT "room_members_role" CHECK (role in ('owner', 'moderator', 'member'))
);
--> statement-breakpoint
CREATE TABLE "room_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"text" text DEFAULT '' NOT NULL,
	"market_id" uuid,
	"kind" text DEFAULT 'message' NOT NULL,
	"with_ids" text[],
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "room_messages_length" CHECK (char_length("room_messages"."text") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "room_requests" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_requests_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"owner_id" uuid NOT NULL,
	"privacy" text NOT NULL,
	"disclosure" boolean DEFAULT false NOT NULL,
	"rules" text DEFAULT '' NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_privacy" CHECK (privacy in ('public', 'invite'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_daily" (
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"equity" bigint NOT NULL,
	"cash" bigint NOT NULL,
	"positions_value" bigint NOT NULL,
	CONSTRAINT "equity_daily_account_id_day_pk" PRIMARY KEY("account_id","day")
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"status" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_status" CHECK (status in ('pending', 'running', 'done', 'dead'))
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"period" text NOT NULL,
	"category" text NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"icon" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text NOT NULL,
	"cta" jsonb,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "notifications_kind" CHECK (kind in ('Order', 'Resolution', 'Reply', 'Follow', 'Room', 'Price'))
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"threshold" bigint NOT NULL,
	"direction" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_alerts_direction" CHECK (direction in ('above', 'below'))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolver_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trader_stats" (
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"category" text NOT NULL,
	"return_pct" double precision NOT NULL,
	"correct" integer NOT NULL,
	"resolved" integer NOT NULL,
	"trades" integer NOT NULL,
	"pnl" bigint NOT NULL,
	"starting_capital" bigint NOT NULL,
	"record" jsonb,
	"curve" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_stats_user_id_period_category_pk" PRIMARY KEY("user_id","period","category")
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"watchlist_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"rank" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_items_watchlist_id_market_id_pk" PRIMARY KEY("watchlist_id","market_id")
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_map" ADD CONSTRAINT "category_map_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_venues" ADD CONSTRAINT "route_venues_route_id_execution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."execution_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_venues" ADD CONSTRAINT "route_venues_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_status" ADD CONSTRAINT "venue_status_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_holders" ADD CONSTRAINT "market_holders_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_quotes" ADD CONSTRAINT "market_quotes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trending" ADD CONSTRAINT "market_trending_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_resets" ADD CONSTRAINT "account_resets_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_route_id_execution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."execution_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_pnl" ADD CONSTRAINT "realized_pnl_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_pnl" ADD CONSTRAINT "realized_pnl_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_route_id_execution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."execution_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_markets" ADD CONSTRAINT "room_markets_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_markets" ADD CONSTRAINT "room_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_markets" ADD CONSTRAINT "room_markets_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_requests" ADD CONSTRAINT "room_requests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_requests" ADD CONSTRAINT "room_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_daily" ADD CONSTRAINT "equity_daily_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_stats" ADD CONSTRAINT "trader_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_identities_user" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle" ON "users" USING btree (lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_address" ON "wallets" USING btree ("chain","address");--> statement-breakpoint
CREATE INDEX "wallets_user" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_external" ON "events" USING btree ("venue_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_slug" ON "markets" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_external" ON "markets" USING btree ("venue_id","external_id");--> statement-breakpoint
CREATE INDEX "markets_status_closes" ON "markets" USING btree ("status","closes_at");--> statement-breakpoint
CREATE INDEX "markets_category" ON "markets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "markets_title_trgm" ON "markets" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "claims_position" ON "claims" USING btree ("account_id","market_id","outcome");--> statement-breakpoint
CREATE INDEX "fills_account_time" ON "fills" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "fills_order" ON "fills" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_account_time" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_ref" ON "ledger_entries" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_client" ON "orders" USING btree ("user_id","client_order_id");--> statement-breakpoint
CREATE INDEX "orders_account_status" ON "orders" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "orders_resting" ON "orders" USING btree ("market_id","outcome") WHERE status in ('open', 'partial');--> statement-breakpoint
CREATE INDEX "positions_market" ON "positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "realized_account_time" ON "realized_pnl" USING btree ("account_id","closed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_accounts_user_route" ON "trading_accounts" USING btree ("user_id","route_id");--> statement-breakpoint
CREATE INDEX "comments_post_time" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_client" ON "comments" USING btree ("author_id","client_id");--> statement-breakpoint
CREATE INDEX "follows_followee" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "posts_author_time" ON "posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_market_time" ON "posts" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_time" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "posts_room_time" ON "posts" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_client" ON "posts" USING btree ("author_id","client_id");--> statement-breakpoint
CREATE INDEX "reactions_subject" ON "reactions" USING btree ("subject_type","subject_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_room_slug" ON "channels" USING btree ("room_id","slug");--> statement-breakpoint
CREATE INDEX "room_members_user" ON "room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "room_messages_channel_time" ON "room_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "room_messages_thread" ON "room_messages" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_messages_client" ON "room_messages" USING btree ("author_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_slug" ON "rooms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "audit_subject" ON "audit_log" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "jobs_due" ON "jobs" USING btree ("run_at") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_key" ON "jobs" USING btree ("key") WHERE key is not null and status in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_snapshot_key" ON "leaderboard_snapshots" USING btree ("day","period","category");--> statement-breakpoint
CREATE INDEX "notifications_user_time" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread" ON "notifications" USING btree ("user_id") WHERE read_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_pending" ON "outbox" USING btree ("id") WHERE processed_at is null;--> statement-breakpoint
CREATE INDEX "price_alerts_market" ON "price_alerts" USING btree ("market_id") WHERE active;--> statement-breakpoint
CREATE INDEX "watchlists_owner" ON "watchlists" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_one_default" ON "watchlists" USING btree ("owner_id") WHERE is_default;