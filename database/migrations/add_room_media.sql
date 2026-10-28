ALTER TABLE rooms ADD COLUMN IF NOT EXISTS media_initialized boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS room_media_budget (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO room_media_budget(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS room_media_assets (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('pdf','image')),
  display_name varchar(120) NOT NULL,
  declared_bytes bigint NOT NULL CHECK(declared_bytes>0 AND declared_bytes<=20971520),
  reserved_bytes bigint NOT NULL CHECK(reserved_bytes>=0 AND reserved_bytes<=29360128),
  storage_key uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('reserved','uploading','checking','ready','failed','cancelled','deleting')),
  byte_size bigint CHECK(byte_size>0),
  page_count integer CHECK(page_count BETWEEN 1 AND 100),
  mime text CHECK(mime IN ('application/pdf','image/webp')),
  checksum char(64),error_code varchar(40),
  lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id,request_id),
  CHECK(state<>'ready' OR (byte_size IS NOT NULL AND page_count IS NOT NULL AND checksum IS NOT NULL AND mime IS NOT NULL AND reserved_bytes=byte_size))
);
CREATE INDEX IF NOT EXISTS room_media_owner ON room_media_assets(owner_user_id,created_at);
CREATE INDEX IF NOT EXISTS room_media_room ON room_media_assets(room_id,created_at);
CREATE INDEX IF NOT EXISTS room_media_cleanup ON room_media_assets(lease_until) WHERE state<>'ready';
