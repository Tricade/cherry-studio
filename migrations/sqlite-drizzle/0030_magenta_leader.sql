CREATE TABLE `agent_project_knowledge_base` (
	`project_id` text NOT NULL,
	`knowledge_base_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `knowledge_base_id`),
	FOREIGN KEY (`project_id`) REFERENCES `agent_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_project_member` (
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `agent_id`),
	FOREIGN KEY (`project_id`) REFERENCES `agent_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_project` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `agent_workspace`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_project_workspaceId_unique` ON `agent_project` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `agent_session` ADD `project_id` text REFERENCES agent_project(id);--> statement-breakpoint
CREATE INDEX `agent_session_project_id_idx` ON `agent_session` (`project_id`);