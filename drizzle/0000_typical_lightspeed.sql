CREATE TABLE `hospitals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text NOT NULL,
	`location` text,
	`status` text,
	`start` text
);
--> statement-breakpoint
CREATE TABLE `import_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`source_id` text NOT NULL,
	`date` text,
	`message` text NOT NULL,
	`details` text
);
--> statement-breakpoint
CREATE TABLE `metrics` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`group_name` text NOT NULL,
	`derived` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`done` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`source_id` text NOT NULL,
	`sheet` text NOT NULL,
	`row` integer NOT NULL,
	`date` text NOT NULL,
	`values_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hospital_records` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`date` text NOT NULL,
	`period_end` text NOT NULL,
	`kind` text NOT NULL,
	`values_json` text NOT NULL,
	`source_id` text,
	`source_sheet` text,
	`source_row` integer,
	`needs_review` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `records_hospital_date_kind` ON `hospital_records` (`hospital_id`,`date`,`kind`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`values_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sheets_json` text NOT NULL
);
