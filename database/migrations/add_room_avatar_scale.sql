-- Additive snapshot setting: existing rooms and versions remain at 1.
ALTER TABLE room_templates ADD COLUMN IF NOT EXISTS avatar_scale double precision NOT NULL DEFAULT 1 CHECK (avatar_scale BETWEEN 0.5 AND 2);
ALTER TABLE room_template_drafts ADD COLUMN IF NOT EXISTS avatar_scale double precision NOT NULL DEFAULT 1 CHECK (avatar_scale BETWEEN 0.5 AND 2);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS avatar_scale double precision NOT NULL DEFAULT 1 CHECK (avatar_scale BETWEEN 0.5 AND 2);
