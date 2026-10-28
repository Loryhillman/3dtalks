-- Preserve existing assets; support 1080p in either orientation.
ALTER TABLE room_media_assets DROP CONSTRAINT IF EXISTS room_media_assets_v2_metadata_check;
ALTER TABLE room_media_assets
  ADD CONSTRAINT room_media_assets_v2_metadata_check CHECK(
    (video_duration_ms IS NULL AND video_width IS NULL AND video_height IS NULL AND video_fps IS NULL AND video_codec IS NULL AND video_pixel_format IS NULL AND video_audio_codec IS NULL)
    OR (kind='video' AND video_duration_ms IS NOT NULL AND video_width IS NOT NULL AND video_height IS NOT NULL AND video_fps IS NOT NULL
      AND video_codec IS NOT NULL AND video_pixel_format IS NOT NULL
      AND video_duration_ms BETWEEN 1 AND 600000 AND video_width BETWEEN 1 AND 1920 AND video_height BETWEEN 1 AND 1920 AND LEAST(video_width,video_height)<=1080
      AND video_fps>0 AND video_fps<=30 AND video_codec='h264' AND video_pixel_format='yuv420p'
      AND (video_audio_codec IS NULL OR video_audio_codec='aac')));
