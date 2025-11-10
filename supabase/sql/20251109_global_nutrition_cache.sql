-- Create global nutrition cache table
CREATE TABLE IF NOT EXISTS public.global_nutrition_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name text NOT NULL,
  brand text,
  serving_label text,
  size_label text,
  grams_per_serving numeric,
  calories numeric NOT NULL,
  protein_g numeric NOT NULL,
  carbs_g numeric NOT NULL,
  fat_g numeric NOT NULL,
  fiber_g numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'brand_resolver',
  confidence numeric DEFAULT 0.9,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_global_nutrition_cache_normalized_name ON public.global_nutrition_cache(normalized_name);
CREATE INDEX IF NOT EXISTS idx_global_nutrition_cache_brand ON public.global_nutrition_cache(brand) WHERE brand IS NOT NULL;

-- Enable RLS
ALTER TABLE public.global_nutrition_cache ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read (for lookups)
CREATE POLICY "global_nutrition_cache_read" ON public.global_nutrition_cache
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow service role to insert/update (for Brand Resolver)
CREATE POLICY "global_nutrition_cache_insert" ON public.global_nutrition_cache
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "global_nutrition_cache_update" ON public.global_nutrition_cache
  FOR UPDATE USING (auth.role() = 'service_role');
