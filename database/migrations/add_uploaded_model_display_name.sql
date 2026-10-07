-- Required by model upload and the room editor library; preserve existing names.
ALTER TABLE uploaded_models ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
