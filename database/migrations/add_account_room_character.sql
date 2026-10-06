-- Keep the account's meeting-room avatar stable when other characters are added.
ALTER TABLE users ADD COLUMN IF NOT EXISTS room_character_id uuid REFERENCES characters(id) ON DELETE SET NULL;
