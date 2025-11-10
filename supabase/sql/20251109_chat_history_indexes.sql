-- Chat history performance indexes
-- Updated to use last_activity_at for recency sorting (not started_at)

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_activity 
  ON chat_sessions(user_id, last_activity_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created 
  ON chat_messages(session_id, created_at ASC);

-- Preference text column (from earlier hotfix)
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS preference_text text;

-- Optional index for faster preference lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id
  ON public.user_preferences(user_id);

