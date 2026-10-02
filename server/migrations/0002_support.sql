CREATE TABLE IF NOT EXISTS `basira_support_tickets` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `user_id` varchar(36),
  `contact_name` varchar(120) NOT NULL,
  `email` varchar(254) NOT NULL,
  `subject` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `transcript` text,
  `status` varchar(24) NOT NULL DEFAULT 'open',
  `delivery_status` varchar(24) NOT NULL DEFAULT 'pending',
  `delivery_attempts` int unsigned NOT NULL DEFAULT 0,
  `request_key` char(64) DEFAULT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `support_user_idx` (`user_id`),
  INDEX `support_delivery_idx` (`delivery_status`, `created_at`),
  UNIQUE INDEX `support_request_key_idx` (`request_key`)
);
