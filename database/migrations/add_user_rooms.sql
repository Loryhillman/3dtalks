-- Preserve administrative authorship; ordinary user IDs are UUIDs.
ALTER TABLE geometry_buildings ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE geometry_buildings ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS owner_request_key uuid;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS creation_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS rooms_owner_request_key
  ON rooms(owner_user_id, owner_request_key) WHERE owner_request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS rooms_live_owner ON rooms(owner_user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS room_user_actions (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(32) NOT NULL,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_user_actions_room ON room_user_actions(room_id, created_at);

CREATE INDEX IF NOT EXISTS rooms_owner_created ON rooms(owner_user_id, created_at);

ALTER TABLE room_user_actions ADD COLUMN IF NOT EXISTS admin_user_id integer REFERENCES admin_users(id) ON DELETE SET NULL;
