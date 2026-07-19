-- referrals.e_signature stores a canvas-captured PNG data URL (base64). A TEXT
-- column caps at ~64 KB, which a real signature image can exceed — causing an
-- insert failure under strict SQL mode or SILENT TRUNCATION otherwise (a corrupt
-- half-signature). Widen it to MEDIUMTEXT (up to ~16 MB).
--
-- The application also rejects e_signature payloads over ~2 MB in createReferral,
-- so this column width is a safety ceiling, not the expected size.
ALTER TABLE referrals
    MODIFY COLUMN e_signature MEDIUMTEXT DEFAULT NULL;
