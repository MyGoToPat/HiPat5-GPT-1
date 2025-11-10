-- Add metadata column to chat_messages to persist roleData
-- This allows MealVerifyCard to persist across page reloads

ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Create GIN index for fast JSON queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_metadata
  ON chat_messages USING GIN(metadata);

COMMENT ON COLUMN chat_messages.metadata IS 'Stores roleData and other message metadata (e.g., MealVerifyCard state) for UI persistence';

