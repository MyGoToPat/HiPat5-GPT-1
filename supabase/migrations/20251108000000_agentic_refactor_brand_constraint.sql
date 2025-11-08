-- Purpose: allow caching items where fiber is unknown/not listed.
-- Run as a single migration.

ALTER TABLE public.brand_nutrition
DROP CONSTRAINT IF EXISTS brand_verified_fields_complete;

ALTER TABLE public.brand_nutrition
ADD CONSTRAINT brand_verified_fields_complete
CHECK (
  is_verified = false
  OR (
    calories IS NOT NULL
    AND protein_g IS NOT NULL
    AND carb_g IS NOT NULL
    AND fat_g IS NOT NULL
    -- fiber_g may be NULL; do not check it
    AND source_url IS NOT NULL
    AND source_title IS NOT NULL
  )
);
