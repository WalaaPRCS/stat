CREATE TABLE `phc_clinics` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text NOT NULL,
	`code` text,
	`start` text
);
--> statement-breakpoint
CREATE TABLE `phc_records` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`date` text NOT NULL,
	`period_end` text NOT NULL,
	`kind` text NOT NULL,
	`total` integer,
	`source_id` text,
	`source_sheet` text,
	`source_row` integer,
	`source_column` integer,
	`deleted` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`updated_at` text,
	FOREIGN KEY (`clinic_id`) REFERENCES `phc_clinics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phc_clinic_date_kind` ON `phc_records` (`clinic_id`,`date`,`kind`);