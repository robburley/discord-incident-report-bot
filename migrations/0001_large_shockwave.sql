CREATE TABLE `guild_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`manager_role_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `incident_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`submitted_by_user_id` text NOT NULL,
	`discord_interaction_id` text NOT NULL,
	`race_number` integer NOT NULL,
	`lap_number` integer NOT NULL,
	`turn_number` integer NOT NULL,
	`car_number` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_reports_discord_interaction_id_unique` ON `incident_reports` (`discord_interaction_id`);--> statement-breakpoint
CREATE INDEX `incident_reports_ordered_lookup_idx` ON `incident_reports` (`session_id`,`race_number`,`lap_number`,`turn_number`,`created_at`);--> statement-breakpoint
CREATE INDEX `incident_reports_duplicate_lookup_idx` ON `incident_reports` (`session_id`,`submitted_by_user_id`,`race_number`,`lap_number`,`turn_number`,`car_number`);--> statement-breakpoint
CREATE TABLE `incident_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`started_by_user_id` text NOT NULL,
	`ended_by_user_id` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `incident_sessions_active_lookup_idx` ON `incident_sessions` (`guild_id`,`status`);--> statement-breakpoint
CREATE INDEX `incident_sessions_latest_closed_lookup_idx` ON `incident_sessions` (`guild_id`,`status`,`ended_at`);