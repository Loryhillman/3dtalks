ALTER TABLE rooms ADD COLUMN IF NOT EXISTS presentation_initialized boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS room_presentation_state (
  room_id uuid PRIMARY KEY REFERENCES rooms(id),
  epoch uuid NOT NULL DEFAULT gen_random_uuid(),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  asset_id uuid REFERENCES room_media_assets(id),page_index integer NOT NULL DEFAULT 0 CHECK(page_index BETWEEN 0 AND 99),
  updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(asset_id IS NOT NULL OR page_index=0)
);
CREATE TABLE IF NOT EXISTS room_presentation_requests (
  room_id uuid NOT NULL REFERENCES rooms(id),epoch uuid NOT NULL,request_id uuid NOT NULL,
  signature text NOT NULL CHECK(length(signature)<=1000),result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(room_id,epoch,request_id)
);
CREATE INDEX IF NOT EXISTS room_presentation_receipt_expiry ON room_presentation_requests(created_at);
-- Existing snapshots only acquire presentation state; their geometry/files do not change.
INSERT INTO room_presentation_state(room_id)
  SELECT DISTINCT room_id FROM world_objects WHERE type='presentation_screen'
  ON CONFLICT DO NOTHING;
UPDATE rooms SET presentation_initialized=true WHERE id IN(SELECT room_id FROM room_presentation_state);
