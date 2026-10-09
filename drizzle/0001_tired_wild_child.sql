CREATE TABLE `ems_records` (
	`id` text PRIMARY KEY NOT NULL,
	`region` text NOT NULL,
	`date` text NOT NULL,
	`period_end` text NOT NULL,
	`kind` text NOT NULL,
	`values_json` text NOT NULL,
	`source_id` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_row` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ems_region_date_kind` ON `ems_records` (`region`,`date`,`kind`);