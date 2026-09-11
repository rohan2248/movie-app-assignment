CREATE TABLE `devices` (
	`device_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`platform` text
);
--> statement-breakpoint
CREATE TABLE `genres` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `http_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`value_json` text NOT NULL,
	`stored_at` integer NOT NULL,
	`fresh_until` integer NOT NULL,
	`stale_until` integer NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_http_cache_stale_until` ON `http_cache` (`stale_until`);--> statement-breakpoint
CREATE INDEX `idx_http_cache_namespace` ON `http_cache` (`namespace`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`release_year` integer,
	`release_date` text,
	`poster_url` text,
	`backdrop_url` text,
	`rating` real,
	`vote_count` integer DEFAULT 0 NOT NULL,
	`overview` text,
	`runtime_minutes` integer,
	`genre_ids` text DEFAULT '[]' NOT NULL,
	`popularity` real,
	`payload_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_movies_updated_at` ON `movies` (`updated_at`);--> statement-breakpoint
CREATE TABLE `wishlist` (
	`device_id` text NOT NULL,
	`movie_id` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `movie_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`device_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_device_added` ON `wishlist` (`device_id`,"added_at" DESC);