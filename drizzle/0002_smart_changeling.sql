ALTER TABLE `ems_records` ADD `deleted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ems_records` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `ems_records` ADD `updated_at` text;