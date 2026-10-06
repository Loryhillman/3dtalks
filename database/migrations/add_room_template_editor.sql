-- Drafts are editable documents, never joinable rooms. Published layouts remain snapshots.
CREATE TABLE IF NOT EXISTS room_template_drafts (
  template_key varchar(80) PRIMARY KEY,
  name varchar(120) NOT NULL,
  layout jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'array'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  base_version integer NOT NULL,
  published_revision integer,
  updated_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS room_template_model_refs (
  template_id bigint NOT NULL REFERENCES room_templates(id) ON DELETE CASCADE,
  model_id integer NOT NULL REFERENCES uploaded_models(id) ON DELETE RESTRICT,
  PRIMARY KEY (template_id, model_id)
);
CREATE TABLE IF NOT EXISTS room_template_draft_model_refs (
  template_key varchar(80) NOT NULL REFERENCES room_template_drafts(template_key) ON DELETE CASCADE,
  model_id integer NOT NULL REFERENCES uploaded_models(id) ON DELETE RESTRICT,
  PRIMARY KEY (template_key, model_id)
);
