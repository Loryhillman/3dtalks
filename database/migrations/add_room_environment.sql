-- Additive: old objects stay unchanged, imported rooms retain their own metadata snapshot.
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS room_environment jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'world_objects_room_environment_shape'
    AND conrelid = 'world_objects'::regclass) THEN
    ALTER TABLE world_objects ADD CONSTRAINT world_objects_room_environment_shape
      CHECK (room_environment IS NULL OR
        (jsonb_typeof(room_environment) = 'object'
         AND room_environment->'version' IS NOT DISTINCT FROM '1'::jsonb
         AND jsonb_typeof(room_environment->'bounds') IS NOT DISTINCT FROM 'object'
         AND type IS NOT DISTINCT FROM 'uploaded_model' AND room_id IS NOT NULL AND has_collision IS FALSE));
  END IF;
END $$;
