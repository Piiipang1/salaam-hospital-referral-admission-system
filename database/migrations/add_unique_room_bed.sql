-- Enforce one bed per (room_type, bed_number) so a room can never be duplicated.
-- Matches the createRoom / updateRoom 409 "A room with this type and bed number
-- already exists." guard.
--
-- NOTE ON THE KEY NAME: schema.sql (and any DB created from it) already declares
-- this constraint as `uq_room_bed`. To keep a single canonical unique index and
-- never end up with two identical ones, this migration reuses that name rather
-- than adding a second differently-named key. IF NOT EXISTS makes it a no-op on
-- databases that already have it, and adds it to older databases that predate it.
ALTER TABLE rooms
    ADD UNIQUE KEY IF NOT EXISTS uq_room_bed (room_type, bed_number);
