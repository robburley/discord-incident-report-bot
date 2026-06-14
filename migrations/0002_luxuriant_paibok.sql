CREATE TABLE `penalties` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_session_id` text NOT NULL,
	`incident_report_id` text NOT NULL,
	`affected_user_id` text NOT NULL,
	`penalty_preset_id` text NOT NULL,
	`outcome` text NOT NULL,
	`delta` integer,
	`note` text,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `penalties_session_lookup_idx` ON `penalties` (`incident_session_id`);--> statement-breakpoint
CREATE INDEX `penalties_incident_lookup_idx` ON `penalties` (`incident_session_id`,`incident_report_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `penalties_session_report_affected_user_unique` ON `penalties` (`incident_session_id`,`incident_report_id`,`affected_user_id`);--> statement-breakpoint
CREATE TABLE `penalty_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`outcome` text NOT NULL,
	`delta` integer,
	`is_active` integer NOT NULL,
	`created_by_user_id` text NOT NULL,
	`deactivated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deactivated_at` integer
);
--> statement-breakpoint
CREATE INDEX `penalty_presets_active_lookup_idx` ON `penalty_presets` (`guild_id`,`is_active`,`name`);--> statement-breakpoint
DROP INDEX IF EXISTS `incident_sessions_active_lookup_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `incident_sessions_latest_closed_lookup_idx`;--> statement-breakpoint
ALTER TABLE `incident_sessions` ADD `stewarding_started_by_user_id` text;--> statement-breakpoint
ALTER TABLE `incident_sessions` ADD `stewarding_completed_by_user_id` text;--> statement-breakpoint
ALTER TABLE `incident_sessions` ADD `last_reopened_by_user_id` text;--> statement-breakpoint
ALTER TABLE `incident_sessions` ADD `stewarding_started_at` integer;--> statement-breakpoint
ALTER TABLE `incident_sessions` ADD `stewarding_completed_at` integer;--> statement-breakpoint
ALTER TABLE `incident_sessions` ADD `last_reopened_at` integer;--> statement-breakpoint
UPDATE `incident_sessions` SET `status` = 'reporting' WHERE `status` = 'active';--> statement-breakpoint
UPDATE `incident_sessions` SET `status` = 'awaiting_stewards' WHERE `status` = 'closed';--> statement-breakpoint
CREATE INDEX `incident_sessions_reporting_lookup_idx` ON `incident_sessions` (`guild_id`,`status`);--> statement-breakpoint
CREATE INDEX `incident_sessions_stewarding_lookup_idx` ON `incident_sessions` (`guild_id`,`channel_id`,`status`);--> statement-breakpoint
CREATE INDEX `incident_sessions_latest_awaiting_stewards_lookup_idx` ON `incident_sessions` (`guild_id`,`status`,`ended_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `incident_sessions_one_open_session_per_guild_unique` ON `incident_sessions` (`guild_id`) WHERE "incident_sessions"."status" <> 'decided';--> statement-breakpoint
CREATE UNIQUE INDEX `penalty_presets_active_name_unique` ON `penalty_presets` (`guild_id`,`name`) WHERE "penalty_presets"."is_active" = 1;
