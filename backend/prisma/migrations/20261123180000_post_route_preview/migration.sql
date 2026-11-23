-- A card-sized 2D route shape for the feed. The full `segments` stay out of
-- the feed payload; the thumbnail only needs enough points to keep the shape
-- recognisable (up to 60).
--
-- Existing routes are backfilled from their stored segments, sampled by
-- position across the flattened track. New uploads write the same shape from
-- buildRoutePreview().

ALTER TABLE "PostRoute" ADD COLUMN "preview" JSONB;

WITH expanded AS (
  SELECT
    route."id",
    point.value,
    row_number() OVER (
      PARTITION BY route."id"
      ORDER BY segment.ord, point.ord
    ) AS rn,
    count(*) OVER (PARTITION BY route."id") AS total
  FROM "PostRoute" route
  CROSS JOIN LATERAL jsonb_array_elements(route."segments") WITH ORDINALITY
    AS segment(seg, ord)
  CROSS JOIN LATERAL jsonb_array_elements(segment.seg) WITH ORDINALITY
    AS point(value, ord)
),
sampled AS (
  SELECT
    "id",
    jsonb_agg(
      jsonb_build_object(
        'lat', (value->>'lat')::double precision,
        'lon', (value->>'lon')::double precision
      )
      ORDER BY rn
    ) AS preview
  FROM expanded
  WHERE
    rn = 1
    OR rn = total
    OR rn % GREATEST(1, total / 60) = 0
  GROUP BY "id"
)
UPDATE "PostRoute" route
SET "preview" = sampled.preview
FROM sampled
WHERE route."id" = sampled."id";
