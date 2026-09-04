-- Expression index on the geography cast of road geometry.
-- Our existing GIST index is on geometry (degrees). Distance in METERS requires
-- geography, and an index on the cast lets ST_DWithin use it at scale.
CREATE INDEX IF NOT EXISTS idx_road_segments_geography
  ON road_segments USING GIST ((geometry::geography));

-- Given a GPS point, return the closest road segment within p_max_distance_m metres.
-- Returns zero rows if nothing is within range (caller must handle that).
CREATE OR REPLACE FUNCTION find_nearest_road_segment(
  p_lat            DOUBLE PRECISION,
  p_lng            DOUBLE PRECISION,
  p_max_distance_m DOUBLE PRECISION DEFAULT 5000
)
RETURNS TABLE (
  road_segment_id UUID,
  road_name       TEXT,
  road_status     TEXT,
  district_id     UUID,
  district_name   TEXT,
  distance_m      DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    rs.id,
    rs.name,
    rs.current_status,
    rs.district_id,
    d.name,
    ST_Distance(
      rs.geometry::geography,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS distance_m
  FROM road_segments rs
  JOIN districts d ON d.id = rs.district_id
  WHERE ST_DWithin(
    rs.geometry::geography,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    p_max_distance_m
  )
  ORDER BY distance_m ASC
  LIMIT 1;
$$;

-- Private bucket: files are NOT publicly URL-accessible. The app issues
-- short-lived signed URLs to authorised viewers instead.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'incident-media',
  'incident-media',
  false,
  5242880,                                          -- 5 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp']    -- images only
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "incident_media_upload_own_folder" ON storage.objects;
CREATE POLICY "incident_media_upload_own_folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'incident-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "incident_media_read_authenticated" ON storage.objects;
CREATE POLICY "incident_media_read_authenticated"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'incident-media');

DROP POLICY IF EXISTS "incident_media_delete_own" ON storage.objects;
CREATE POLICY "incident_media_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'incident-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

