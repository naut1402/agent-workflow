CREATE TABLE `knowledge_collections` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_key` text NOT NULL,
	`scope` text NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`entry_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_collections` ON `knowledge_collections` (`store_key`,`collection_id`);--> statement-breakpoint
CREATE TABLE `knowledge_tag_aliases` (
	`store_key` text NOT NULL,
	`from_tag` text NOT NULL,
	`to_tag` text NOT NULL,
	PRIMARY KEY(`store_key`, `from_tag`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_tags` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_key` text NOT NULL,
	`tag` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_tags` ON `knowledge_tags` (`store_key`,`tag`);