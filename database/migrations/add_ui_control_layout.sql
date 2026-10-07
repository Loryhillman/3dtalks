-- Add fields required by the UI controller, without changing saved layouts.
ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS landscape_position_x varchar(20);
ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS landscape_position_y varchar(20);
ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS landscape_width varchar(20);
ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS landscape_height varchar(20);
