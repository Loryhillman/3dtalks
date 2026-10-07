ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_config JSONB NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_revision INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS user_avatar_assets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('image','head','body')),
  path TEXT NOT NULL UNIQUE,
  byte_size INT NOT NULL CHECK (byte_size > 0),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS user_avatar_assets_owner ON user_avatar_assets(user_id);
