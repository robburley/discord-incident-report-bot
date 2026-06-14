CREATE TABLE `processed_discord_interactions` (
	`interaction_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`command_name` text NOT NULL,
	`subcommand_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `processed_discord_interactions_guild_lookup_idx` ON `processed_discord_interactions` (`guild_id`,`created_at`);