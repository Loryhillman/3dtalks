-- Idempotent conversion: preserve world poses, then stop inheriting object scale.
ALTER TABLE room_seats ALTER COLUMN object_id DROP NOT NULL;
ALTER TABLE room_seats ADD COLUMN IF NOT EXISTS coordinate_space text NOT NULL DEFAULT 'legacy'
  CHECK (coordinate_space IN ('legacy', 'rigid'));
UPDATE room_seats s SET local_position = jsonb_build_object(
  'x', (s.local_position->>'x')::double precision * COALESCE(o.scale_x,1),
  'y', (s.local_position->>'y')::double precision * COALESCE(o.scale_y,1),
  'z', (s.local_position->>'z')::double precision * COALESCE(o.scale_z,1)),
  coordinate_space='rigid'
FROM world_objects o WHERE s.room_id=o.room_id AND s.object_id=o.id AND s.coordinate_space='legacy';
UPDATE room_seats SET coordinate_space='rigid' WHERE object_id IS NULL AND coordinate_space='legacy';
ALTER TABLE room_seats ALTER COLUMN coordinate_space SET DEFAULT 'rigid';
