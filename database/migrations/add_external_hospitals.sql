-- =============================================================================
-- External hospitals — an admin-managed directory of the facilities this
-- hospital diverts patients to, replacing the free-text destination fields
-- introduced by add_external_referrals.sql.
--
-- Why a table instead of free text:
--   * Free text produced a different spelling of the same hospital on every
--     referral, so "where do we send patients" could never be reported on.
--   * The contact number and address had to be re-typed from memory each time,
--     at exactly the moment (a full ER) when nobody has time to look them up.
--
-- The referrals.external_hospital_* columns are KEPT, not dropped: they are the
-- snapshot of what was recorded at the time of transfer. If an admin later
-- corrects a hospital's phone number, historical referrals must still show the
-- number that was actually used. external_hospital_id is the live link for
-- reporting; the snapshot columns are the clinical record.
--
-- Run AFTER add_external_referrals.sql.
-- If your database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

-- 1. The directory ------------------------------------------------------------
-- is_active is a soft-retire flag: a hospital that closes or stops accepting
-- transfers disappears from the referral form's dropdown, but its name stays
-- resolvable for every referral that already points at it.
CREATE TABLE IF NOT EXISTS external_hospitals (
    hospital_id    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    name           VARCHAR(200)    NOT NULL,
    contact_number VARCHAR(50)     DEFAULT NULL,
    address        VARCHAR(255)    DEFAULT NULL,
    is_active      TINYINT(1)      NOT NULL DEFAULT 1
                                   COMMENT '0 = retired; hidden from the referral form, kept for history',
    created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (hospital_id),
    -- One row per facility: the whole point of the table is that the same
    -- hospital is not entered twice under two spellings.
    UNIQUE KEY uq_external_hospital_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Link column on referrals -------------------------------------------------
-- ON DELETE SET NULL, not CASCADE: removing a hospital from the directory must
-- never delete the referrals that were sent there. The snapshot columns keep
-- the destination readable even after the link is severed.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS external_hospital_id INT UNSIGNED NULL
    COMMENT 'external_hospitals.hospital_id chosen at referral time; external_hospital_name is the snapshot'
    AFTER is_external;

ALTER TABLE referrals
  ADD CONSTRAINT fk_referrals_external_hospital
    FOREIGN KEY IF NOT EXISTS (external_hospital_id) REFERENCES external_hospitals (hospital_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_external_hospital
  ON referrals (external_hospital_id);

-- 3. Adopt whatever was already typed as free text ----------------------------
-- Every distinct destination already recorded becomes a directory entry, so no
-- existing referral is left pointing at a hospital the admin cannot see. The
-- contact/address come from the most recent referral naming that hospital that
-- actually filled the field in (both were optional, so the newest row may have
-- left them blank — `x IS NULL` sorts non-null values first).
INSERT IGNORE INTO external_hospitals (name, contact_number, address)
SELECT DISTINCT r.external_hospital_name,
       (SELECT c.external_hospital_contact FROM referrals c
         WHERE c.is_external = 1 AND c.external_hospital_name = r.external_hospital_name
         ORDER BY c.external_hospital_contact IS NULL, c.referral_id DESC LIMIT 1),
       (SELECT a.external_hospital_address FROM referrals a
         WHERE a.is_external = 1 AND a.external_hospital_name = r.external_hospital_name
         ORDER BY a.external_hospital_address IS NULL, a.referral_id DESC LIMIT 1)
FROM referrals r
WHERE r.is_external = 1
  AND r.external_hospital_name IS NOT NULL
  AND TRIM(r.external_hospital_name) <> '';

-- 4. Starter directory --------------------------------------------------------
-- Sample regional facilities so the dropdown is not empty on a fresh install.
-- INSERT IGNORE leaves step 3's adopted rows alone. Admins are expected to
-- correct these under Administration → External Hospitals.
INSERT IGNORE INTO external_hospitals (name, contact_number, address) VALUES
('Zamboanga City Medical Center',        '(062) 991-2934', 'Dr. Evangelista St, Sta. Catalina, Zamboanga City'),
('Ciudad Medical Zamboanga',             '(062) 992-2222', 'Mayor Jaldon St, Canelar, Zamboanga City'),
('Western Mindanao Medical Center',      '(062) 991-1112', 'Veterans Ave, Zamboanga City'),
('Zamboanga Doctors Hospital',           '(062) 991-0573', 'Nunez Extension, Zamboanga City'),
('Basilan General Hospital',             '(062) 200-3011', 'Isabela City, Basilan'),
('Sulu Provincial Hospital',             '(068) 341-2020', 'Jolo, Sulu');

-- 5. Point existing referrals at their directory entry -------------------------
UPDATE referrals r
  JOIN external_hospitals h ON h.name = r.external_hospital_name
  SET r.external_hospital_id = h.hospital_id
  WHERE r.is_external = 1 AND r.external_hospital_id IS NULL;
