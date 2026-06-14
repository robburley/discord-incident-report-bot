CREATE TABLE `interaction_rate_limits` (
	`rate_limit_key` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `interaction_rate_limits_stale_lookup_idx` ON `interaction_rate_limits` (`updated_at`);--> statement-breakpoint
CREATE INDEX `interaction_rate_limits_guild_lookup_idx` ON `interaction_rate_limits` (`guild_id`,`action`,`window_start`);