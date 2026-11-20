CREATE TABLE `callLogs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`caseId` bigint unsigned,
	`collectorName` varchar(255) NOT NULL,
	`phoneNumber` varchar(40),
	`calledAt` varchar(25) NOT NULL,
	`direction` enum('incoming','outgoing') NOT NULL DEFAULT 'incoming',
	`summary` text NOT NULL,
	`notes` text,
	`consentAcknowledged` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `callLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clientProfiles` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`phone` varchar(40),
	`state` varchar(2),
	`county` varchar(80),
	`serviceInterest` varchar(80),
	`contactPreference` varchar(30),
	`intakeNotes` text,
	`intakeCompleted` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clientProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `clientProfiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `courtCases` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`title` varchar(255) NOT NULL,
	`plaintiff` varchar(255) NOT NULL,
	`defendant` varchar(255) NOT NULL,
	`court` varchar(255),
	`state` varchar(2) NOT NULL,
	`county` varchar(80) NOT NULL,
	`caseNumber` varchar(120),
	`caseType` varchar(80) NOT NULL DEFAULT 'Debt collection',
	`status` enum('needs_review','active','closed') NOT NULL DEFAULT 'needs_review',
	`filedOn` varchar(10),
	`servedOn` varchar(10),
	`nextDeadline` varchar(10),
	`deadlineLabel` varchar(120),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `courtCases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`caseId` bigint unsigned,
	`fileKey` varchar(700) NOT NULL,
	`fileName` varchar(512) NOT NULL,
	`contentType` varchar(180),
	`size` int NOT NULL,
	`category` varchar(80) NOT NULL,
	`folder` varchar(120) NOT NULL,
	`reviewStatus` enum('pending','reviewed') NOT NULL DEFAULT 'pending',
	`staffSummary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `documents_fileKey_unique` UNIQUE(`fileKey`)
);
--> statement-breakpoint
CREATE TABLE `fcbaDisputes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`creditorName` varchar(255) NOT NULL,
	`accountLast4` varchar(20) NOT NULL,
	`noticeType` enum('billing_error','noncompliance_notice','arbitration_demand') NOT NULL,
	`summary` text NOT NULL,
	`status` enum('open','acknowledged','escalated','resolved','arbitration') NOT NULL DEFAULT 'open',
	`creditorReceivedDate` varchar(25),
	`sentVia` varchar(60),
	`trackingNumbers` varchar(300),
	`ackDeadline` varchar(30),
	`resolveDeadline` varchar(30),
	`letterDraft` text,
	`letterSource` enum('ai','template','edited'),
	`lastResponseClass` varchar(20),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fcbaDisputes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fcbaEvents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`statementId` bigint unsigned,
	`disputeId` bigint unsigned,
	`type` varchar(40) NOT NULL,
	`message` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fcbaEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fcbaStatements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`fileKey` varchar(700) NOT NULL,
	`fileName` varchar(512) NOT NULL,
	`exhibitLabel` varchar(20) NOT NULL,
	`category` varchar(40) NOT NULL,
	`folder` varchar(120) NOT NULL,
	`cycle` varchar(40),
	`isFirstStatement` boolean NOT NULL DEFAULT false,
	`contentType` varchar(180),
	`size` int NOT NULL DEFAULT 0,
	`analysisStatus` enum('pending','analyzing','complete','failed') NOT NULL DEFAULT 'pending',
	`analysisError` varchar(500),
	`extractedFacts` text,
	`factsSource` enum('ai','manual','ai_reviewed'),
	`annotatedFileKey` varchar(700),
	`complianceScore` int,
	`analyzedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fcbaStatements_id` PRIMARY KEY(`id`),
	CONSTRAINT `fcbaStatements_fileKey_unique` UNIQUE(`fileKey`)
);
--> statement-breakpoint
CREATE TABLE `fcbaViolations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`statementId` bigint unsigned NOT NULL,
	`ruleId` varchar(20) NOT NULL,
	`title` varchar(255) NOT NULL,
	`statute` varchar(255) NOT NULL,
	`severity` enum('critical','major','minor') NOT NULL,
	`excerpt` text NOT NULL,
	`annotation` text NOT NULL,
	`mark` varchar(20) NOT NULL,
	`markTarget` varchar(40),
	`page` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fcbaViolations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repoCases` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`creditorName` varchar(255) NOT NULL,
	`repoAgencyName` varchar(255),
	`vehicle` varchar(255) NOT NULL,
	`vin` varchar(30),
	`state` enum('FL','CA') NOT NULL,
	`repossessionDate` varchar(25),
	`saleDate` varchar(25),
	`rcSignDate` varchar(25),
	`status` enum('intake','demand_sent','analyzed','drafted','arbitration','resolved') NOT NULL DEFAULT 'intake',
	`facts` text,
	`riskScore` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repoCases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repoDocuments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`caseId` bigint unsigned,
	`fileKey` varchar(700) NOT NULL,
	`fileName` varchar(512) NOT NULL,
	`exhibitLabel` varchar(20) NOT NULL,
	`docType` enum('contract','notice_611','notice_613','notice_616','default_notice','notice_of_sale','ucc1','prospectus_424b5','report_10k','report_8k','sales_servicing_agreement','pacer_case','dmv_title','repo_work_order','other') NOT NULL,
	`contentType` varchar(180),
	`size` int NOT NULL DEFAULT 0,
	`analysisStatus` enum('pending','analyzing','complete','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repoDocuments_id` PRIMARY KEY(`id`),
	CONSTRAINT `repoDocuments_fileKey_unique` UNIQUE(`fileKey`)
);
--> statement-breakpoint
CREATE TABLE `repoDrafts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`caseId` bigint unsigned NOT NULL,
	`draftType` enum('document_demand','notice_of_demand','federal_complaint','special_report','sec_due_diligence') NOT NULL,
	`body` text NOT NULL,
	`source` enum('ai','template','edited') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repoDrafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repoEvents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`caseId` bigint unsigned,
	`documentId` bigint unsigned,
	`type` varchar(40) NOT NULL,
	`message` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repoEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repoViolations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`caseId` bigint unsigned NOT NULL,
	`ruleId` varchar(20) NOT NULL,
	`title` varchar(255) NOT NULL,
	`statute` varchar(255) NOT NULL,
	`severity` enum('critical','major','minor') NOT NULL,
	`excerpt` text NOT NULL,
	`annotation` text NOT NULL,
	`basis` enum('rule','ai') NOT NULL DEFAULT 'rule',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repoViolations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unionId` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`avatar` text,
	`passwordHash` varchar(255),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`)
);
--> statement-breakpoint
CREATE TABLE `videoLessons` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`videoUrl` varchar(1000) NOT NULL,
	`category` varchar(80) NOT NULL,
	`duration` varchar(30),
	`published` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `videoLessons_id` PRIMARY KEY(`id`)
);
