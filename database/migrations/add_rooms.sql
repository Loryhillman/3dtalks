-- Rooms are local spaces within one installation. This migration is additive
-- and safe to apply to a database that already contains the original world.
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creation_key uuid UNIQUE,
  slug varchar(80) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  created_by_admin_id integer REFERENCES admin_users(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  admission_policy varchar(32) NOT NULL DEFAULT 'authenticated_link',
  capacity integer NOT NULL DEFAULT 6 CHECK (capacity BETWEEN 1 AND 100),
  template_key varchar(80),
  template_version integer,
  spawn_position jsonb NOT NULL DEFAULT '{"x":0,"y":0,"z":4}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rooms_admission_policy_check
    CHECK (admission_policy IN ('authenticated_link'))
);

-- Fixed ID keeps the old URLs and rows mapped to one stable default space.
INSERT INTO rooms (id, slug, name, status, capacity)
VALUES ('00000000-0000-0000-0000-000000000001', 'main', 'Основной мир', 'open', 100)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS room_templates (
  id bigserial PRIMARY KEY,
  template_key varchar(80) NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name varchar(120) NOT NULL,
  layout jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, version),
  CHECK (jsonb_typeof(layout) = 'array')
);

ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS room_id uuid;
UPDATE world_objects SET room_id = '00000000-0000-0000-0000-000000000001'
WHERE room_id IS NULL;
ALTER TABLE world_objects
  ALTER COLUMN room_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE world_objects ALTER COLUMN room_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'world_objects_room_id_fkey'
    AND conrelid = 'world_objects'::regclass) THEN
    ALTER TABLE world_objects ADD CONSTRAINT world_objects_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_world_objects_room_pos
  ON world_objects (room_id, position_x, position_z);
CREATE INDEX IF NOT EXISTS idx_world_objects_room_created
  ON world_objects (room_id, created_at DESC, id DESC);

ALTER TABLE characters ADD COLUMN IF NOT EXISTS last_room_id uuid;
UPDATE characters SET last_room_id = '00000000-0000-0000-0000-000000000001'
WHERE last_room_id IS NULL;
ALTER TABLE characters ALTER COLUMN last_room_id
  SET DEFAULT '00000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'characters_last_room_id_fkey'
    AND conrelid = 'characters'::regclass) THEN
    ALTER TABLE characters ADD CONSTRAINT characters_last_room_id_fkey
      FOREIGN KEY (last_room_id) REFERENCES rooms(id) ON DELETE RESTRICT;
  END IF;
END $$;
