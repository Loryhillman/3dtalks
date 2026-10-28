-- Additive v2 preparation. Application upload/playback gates stay disabled.
-- Replacing named checks widens supported formats; existing rows are preserved.
ALTER TABLE room_media_assets
  ADD COLUMN IF NOT EXISTS source_format text,
  ADD COLUMN IF NOT EXISTS video_duration_ms integer,
  ADD COLUMN IF NOT EXISTS video_width integer,
  ADD COLUMN IF NOT EXISTS video_height integer,
  ADD COLUMN IF NOT EXISTS video_fps numeric(8,3),
  ADD COLUMN IF NOT EXISTS video_codec text,
  ADD COLUMN IF NOT EXISTS video_pixel_format text,
  ADD COLUMN IF NOT EXISTS video_audio_codec text;
ALTER TABLE room_media_assets
  DROP CONSTRAINT IF EXISTS room_media_assets_kind_check,
  DROP CONSTRAINT IF EXISTS room_media_assets_declared_bytes_check,
  DROP CONSTRAINT IF EXISTS room_media_assets_reserved_bytes_check,
  DROP CONSTRAINT IF EXISTS room_media_assets_mime_check,
  DROP CONSTRAINT IF EXISTS room_media_assets_check,
  DROP CONSTRAINT IF EXISTS room_media_assets_v2_source_check,
  DROP CONSTRAINT IF EXISTS room_media_assets_v2_metadata_check,
  DROP CONSTRAINT IF EXISTS room_media_assets_v2_ready_check;
ALTER TABLE room_media_assets
  ADD CONSTRAINT room_media_assets_kind_check CHECK(kind IN ('pdf','image','video')),
  ADD CONSTRAINT room_media_assets_declared_bytes_check CHECK(declared_bytes>0 AND declared_bytes<=CASE WHEN kind='video' THEN 41943040 ELSE 20971520 END),
  ADD CONSTRAINT room_media_assets_reserved_bytes_check CHECK(reserved_bytes BETWEEN 0 AND 83886080),
  ADD CONSTRAINT room_media_assets_mime_check CHECK(mime IS NULL OR
    kind='pdf' AND mime='application/pdf' OR kind='image' AND mime='image/webp' OR kind='video' AND mime='video/mp4'),
  ADD CONSTRAINT room_media_assets_v2_source_check CHECK(source_format IS NULL OR source_format='pptx' AND kind='pdf'),
  ADD CONSTRAINT room_media_assets_v2_metadata_check CHECK(
    (video_duration_ms IS NULL AND video_width IS NULL AND video_height IS NULL AND video_fps IS NULL AND video_codec IS NULL AND video_pixel_format IS NULL AND video_audio_codec IS NULL)
    OR (kind='video' AND video_duration_ms IS NOT NULL AND video_width IS NOT NULL AND video_height IS NOT NULL AND video_fps IS NOT NULL
      AND video_codec IS NOT NULL AND video_pixel_format IS NOT NULL
      AND video_duration_ms BETWEEN 1 AND 600000 AND video_width BETWEEN 1 AND 1920 AND video_height BETWEEN 1 AND 1920 AND LEAST(video_width,video_height)<=1080
      AND video_fps>0 AND video_fps<=30 AND video_codec='h264' AND video_pixel_format='yuv420p'
      AND (video_audio_codec IS NULL OR video_audio_codec='aac'))),
  ADD CONSTRAINT room_media_assets_v2_ready_check CHECK(state<>'ready' OR
    (byte_size IS NOT NULL AND byte_size>0 AND byte_size<=CASE WHEN kind='video' THEN 41943040 ELSE 20971520 END
      AND checksum IS NOT NULL AND mime IS NOT NULL AND reserved_bytes=byte_size
      AND ((kind IN ('pdf','image') AND page_count IS NOT NULL)
        OR (kind='video' AND page_count IS NULL AND video_duration_ms IS NOT NULL))));

ALTER TABLE room_presentation_state
  ADD COLUMN IF NOT EXISTS playback_status text NOT NULL DEFAULT 'paused',
  ADD COLUMN IF NOT EXISTS playback_position_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS playback_anchor_at timestamptz;
ALTER TABLE room_presentation_state
  DROP CONSTRAINT IF EXISTS room_presentation_v2_playback_check;
ALTER TABLE room_presentation_state ADD CONSTRAINT room_presentation_v2_playback_check CHECK(
  playback_position_ms BETWEEN 0 AND 600000
  AND ((playback_status='paused' AND playback_anchor_at IS NULL)
    OR (playback_status='playing' AND playback_anchor_at IS NOT NULL AND isfinite(playback_anchor_at) AND asset_id IS NOT NULL))
  AND (asset_id IS NOT NULL OR playback_status='paused' AND playback_position_ms=0)
);
