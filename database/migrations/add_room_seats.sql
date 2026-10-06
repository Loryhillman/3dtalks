-- Existing rooms retain their current behavior until seats are configured.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS seating_mode varchar(16) NOT NULL
  DEFAULT 'free' CHECK (seating_mode IN ('free', 'seated'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_objects_room_id_id ON world_objects(room_id, id);

CREATE TABLE IF NOT EXISTS room_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  object_id integer NOT NULL,
  label varchar(40) NOT NULL CHECK (length(trim(label)) > 0),
  sort_order integer NOT NULL DEFAULT 0,
  local_position jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
  local_rotation jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
  map_x double precision NOT NULL DEFAULT 0 CHECK (map_x BETWEEN -10000 AND 10000),
  map_y double precision NOT NULL DEFAULT 0 CHECK (map_y BETWEEN -10000 AND 10000),
  enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (room_id, id),
  UNIQUE (room_id, label),
  FOREIGN KEY (room_id, object_id) REFERENCES world_objects(room_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(local_position) = 'object'),
  CHECK (jsonb_typeof(local_rotation) = 'object')
);

CREATE TABLE IF NOT EXISTS room_seat_claims (
  seat_id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  character_id uuid NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  session_id varchar(128) NOT NULL CHECK (length(session_id) > 0),
  state varchar(16) NOT NULL CHECK (state IN ('active', 'held')),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (room_id, seat_id) REFERENCES room_seats(room_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_room_seat_claims_expiry ON room_seat_claims(expires_at);
CREATE INDEX IF NOT EXISTS idx_room_seats_order ON room_seats(room_id, sort_order, id);
