-- Add the doctor's electronic signature (E_Sign) to referrals.
-- Stores a base64 PNG data URL captured from the signature canvas in ReferralForm.
-- Nullable — referrals may still be submitted without a signature.
ALTER TABLE referrals
    ADD COLUMN e_signature TEXT DEFAULT NULL AFTER status;
