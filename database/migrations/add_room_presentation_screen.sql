-- Additive and repeatable; existing snapshots and template versions stay unchanged.
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS presentation_screen JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='world_objects'::regclass AND conname='world_objects_screen') THEN
    ALTER TABLE world_objects ADD CONSTRAINT world_objects_screen CHECK (
      (type = 'presentation_screen') = (presentation_screen IS NOT NULL)
      AND (presentation_screen IS NULL OR (
        room_id IS NOT NULL AND model_path IS NULL AND model_type IS NULL AND room_environment IS NULL AND has_collision IS FALSE
        AND scale_x IS NOT DISTINCT FROM 1 AND scale_y IS NOT DISTINCT FROM 1 AND scale_z IS NOT DISTINCT FROM 1
        AND rotation_x IS NOT DISTINCT FROM 0 AND rotation_z IS NOT DISTINCT FROM 0
        AND CASE WHEN jsonb_typeof(presentation_screen)='object'
          AND jsonb_typeof(presentation_screen->'width')='number'
          AND jsonb_typeof(presentation_screen->'height')='number'
          THEN presentation_screen->'version'='1'::jsonb
            AND (presentation_screen->>'width')::numeric BETWEEN 0.5 AND 8
            AND (presentation_screen->>'height')::numeric BETWEEN 0.3 AND 4.5
            AND presentation_screen - ARRAY['version','width','height'] = '{}'::jsonb
          ELSE FALSE END IS TRUE
      ))
    );
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS world_objects_one_screen_per_room
  ON world_objects(room_id) WHERE type='presentation_screen';

CREATE OR REPLACE FUNCTION reject_screen_seat_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM world_objects WHERE id=NEW.object_id AND type='presentation_screen') THEN
    RAISE EXCEPTION 'A screen cannot own seats' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS room_seats_no_screen_parent ON room_seats;
CREATE TRIGGER room_seats_no_screen_parent BEFORE INSERT OR UPDATE OF object_id ON room_seats
  FOR EACH ROW EXECUTE FUNCTION reject_screen_seat_parent();
