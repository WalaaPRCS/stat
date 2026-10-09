ALTER TABLE `phc_clinics` ADD `address` text;--> statement-breakpoint
ALTER TABLE `phc_clinics` ADD `services_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `phc_clinics` ADD `updated_at` text;