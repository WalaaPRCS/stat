ALTER TABLE `phc_records` ADD `details_json` text;
--> statement-breakpoint
CREATE TABLE `phc_metrics` (
	`key` text PRIMARY KEY NOT NULL,
	`group_key` text NOT NULL,
	`label` text NOT NULL,
	`order_no` integer NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`derived` integer DEFAULT 0 NOT NULL
);
