-- A durable receipt prevents startup from republishing a bundled template.
CREATE TABLE IF NOT EXISTS room_builtin_bundles (
  bundle_key varchar(80) PRIMARY KEY,
  manifest_sha256 varchar(64) NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  template_id bigint NOT NULL REFERENCES room_templates(id) ON DELETE RESTRICT,
  installed_at timestamptz NOT NULL DEFAULT now()
);
