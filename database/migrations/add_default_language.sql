-- Preserve a language explicitly selected by an administrator.
INSERT INTO system_config (config_key, config_value, description)
VALUES ('default_language', 'en-US', 'Default language for new visitors')
ON CONFLICT (config_key) DO NOTHING;
