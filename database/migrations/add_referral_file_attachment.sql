-- Add the optional referral form document to referrals.
-- referrals.controller createReferral INSERTs this column (multer filename in
-- backend/uploads/) — the column existed only in the dev database and was
-- missing from schema.sql and migrations, so fresh installs broke on referral
-- creation. Nullable — referrals may be submitted without an attachment.
ALTER TABLE referrals
    ADD COLUMN IF NOT EXISTS file_attachment VARCHAR(255) DEFAULT NULL
        COMMENT 'filename saved in backend/uploads/'
        AFTER e_signature;
