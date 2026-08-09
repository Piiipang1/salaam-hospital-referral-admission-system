-- =============================================================================
-- Multi-channel alerts: contact details, alert priority, delivery audit
--
-- In-app notifications only reach someone already looking at the screen. A
-- Critical triage or an emergency arrival has to reach whoever is NOT looking,
-- which means email and SMS — and that needs three things this schema lacked:
--
--   1. Somewhere to keep a user's email and phone. Contact details existed only
--      on `doctors`/`employees` as a single free-text `contact_details` column,
--      and admin accounts have no linked person record at all, so an admin was
--      unreachable by construction.
--   2. A priority on the notification, so ordinary chatter stays in-app and
--      only genuine alerts spend an SMS.
--   3. A record of what was actually sent. For a clinical alert, "we tried to
--      text the on-call doctor" is not good enough — it has to be answerable
--      whether it left the building, and why not if it didn't.
--
-- Safe on populated tables: added columns are nullable or defaulted, and the
-- phone backfill only copies what is already on the linked person record.
-- If your database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

-- 1. Contact details on the account ------------------------------------------
-- Kept on `users`, not on doctors/employees: the account is what receives an
-- alert, and an admin has no person record to hang a phone number off.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email VARCHAR(191) DEFAULT NULL
    COMMENT 'Alert destination for the email channel'
    AFTER username,
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20) DEFAULT NULL
    COMMENT 'E.164 or local mobile; alert destination for the SMS channel'
    AFTER email,
  ADD COLUMN IF NOT EXISTS alerts_opt_out TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = never send out-of-band alerts to this account (in-app still applies)'
    AFTER phone;

-- NULLs do not collide in a UNIQUE index, so this stops two accounts sharing an
-- address without forcing every existing account to have one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (email);

-- Backfill the phone from whichever person record the account is linked to.
-- Admin accounts (linked_id NULL) are deliberately left blank — there is
-- nothing to copy, and inventing a number would be worse than an empty field.
UPDATE users u
  JOIN doctors d ON d.doctor_id = u.linked_id AND u.role = 'doctor'
  SET u.phone = d.contact_details
  WHERE u.phone IS NULL AND d.contact_details IS NOT NULL AND d.contact_details <> '';

UPDATE users u
  JOIN employees e ON e.employee_id = u.linked_id AND u.role = 'nurse'
  SET u.phone = e.contact_details
  WHERE u.phone IS NULL AND e.contact_details IS NOT NULL AND e.contact_details <> '';

-- 2. Alert priority -----------------------------------------------------------
-- Normal    — in-app only (the existing behaviour for every current row)
-- High      — in-app + email
-- Emergency — in-app + email + SMS
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS priority ENUM('Normal','High','Emergency')
    NOT NULL DEFAULT 'Normal'
    COMMENT 'Drives which channels fire; see backend/utils/notifier.js'
    AFTER message;

CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications (priority, created_at);

-- 3. Delivery audit -----------------------------------------------------------
-- One row per attempted out-of-band send. `Skipped` covers the honest cases —
-- no address on file, the user opted out, or the channel has no credentials
-- configured — so a silent non-delivery is always distinguishable from a
-- delivery that was never attempted.
CREATE TABLE IF NOT EXISTS notification_deliveries (
    delivery_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
    notification_id INT UNSIGNED NULL COMMENT 'the in-app notification this mirrors',
    user_id         INT UNSIGNED NULL COMMENT 'recipient account',
    channel         ENUM('email','sms') NOT NULL,
    destination     VARCHAR(191) NULL COMMENT 'address or number actually used',
    status          ENUM('Sent','Failed','Skipped') NOT NULL,
    provider_ref    VARCHAR(191) NULL COMMENT 'provider message id, for support tickets',
    detail          VARCHAR(255) NULL COMMENT 'failure reason, or why it was skipped',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (delivery_id),
    KEY idx_delivery_notification (notification_id),
    KEY idx_delivery_user (user_id, created_at),
    KEY idx_delivery_status (status, created_at),
    -- CASCADE from notifications (the delivery is meaningless without it);
    -- SET NULL from users so deleting an account never erases the send record.
    CONSTRAINT fk_delivery_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (notification_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_delivery_user
        FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Report -------------------------------------------------------------------
SELECT role,
       COUNT(*)                                        AS accounts,
       SUM(phone IS NOT NULL AND phone <> '')          AS with_phone,
       SUM(email IS NOT NULL AND email <> '')          AS with_email
FROM users GROUP BY role;
