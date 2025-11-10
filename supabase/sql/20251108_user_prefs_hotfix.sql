--
-- Hotfix: add the column used by preferences loader

ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS preference_text text;


-- Optional index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id
  ON public.user_preferences(user_id);


-- RLS already exists. No change here.
