CREATE TABLE `log_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`ts` integer NOT NULL,
	`level` text NOT NULL,
	`trace_id` text DEFAULT '' NOT NULL,
	`project_id` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_log_entries_type_ts` ON `log_entries` (`type`,`ts`);--> statement-breakpoint
CREATE INDEX `idx_log_entries_project_ts` ON `log_entries` (`project_id`,`ts`);