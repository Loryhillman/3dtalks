-- A closed room may still host a meeting. Ending it disables all returns.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS allow_rejoin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS room_rejoin_grants (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (room_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_room_rejoin_grants_expires_at
  ON room_rejoin_grants (expires_at);
