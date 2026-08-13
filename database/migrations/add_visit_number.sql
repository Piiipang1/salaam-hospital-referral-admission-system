-- Migration: Add visit_number to triages table
-- Description: Adds a visit_number column to differentiate between multiple patient visits/episodes.
USE salaam_hospital;

ALTER TABLE triages 
  ADD COLUMN visit_number INT UNSIGNED NOT NULL DEFAULT 1 AFTER visit_room_id;
