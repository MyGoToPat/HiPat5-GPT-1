-- Fix Personality Swarm Config (Critical Fix)
-- 1. Lowercase Phases ('pre'/'main'/'post') for TS Loader compatibility
-- 2. Restore missing promptRef links so instructions actually load

UPDATE agent_configs
SET config = jsonb_set(
  config,
  '{agents}',
  '[
    {"id":"PERSONALITY_VOICE","enabled":true,"phase":"pre","order":10,"promptRef":"PERSONALITY_VOICE"},
    {"id":"PERSONALITY_CORE_RESPONDER","enabled":true,"phase":"main","order":10,"promptRef":"PERSONALITY_CORE_RESPONDER"},
    
    {"id":"PERSONALITY_STRUCTURE","enabled":true,"phase":"post","order":20,"promptRef":"PERSONALITY_STRUCTURE"},
    {"id":"PERSONALITY_NUMBERS","enabled":true,"phase":"post","order":30,"promptRef":"PERSONALITY_NUMBERS"},
    {"id":"PERSONALITY_SAFETY","enabled":true,"phase":"post","order":40,"promptRef":"PERSONALITY_SAFETY"},
    {"id":"PERSONALITY_MEMORY","enabled":true,"phase":"post","order":50,"promptRef":"PERSONALITY_MEMORY"},
    {"id":"PERSONALITY_RECOVERY","enabled":true,"phase":"post","order":60,"promptRef":"PERSONALITY_RECOVERY"},
    {"id":"PERSONALITY_TOOL_GOV","enabled":true,"phase":"post","order":95,"promptRef":"PERSONALITY_TOOL_GOV"},

    {"id":"PERSONALITY_AUDIENCE","enabled":false,"phase":"pre","order":900,"promptRef":"PERSONALITY_AUDIENCE"},
    {"id":"PERSONALITY_AMBIGUITY","enabled":false,"phase":"pre","order":901,"promptRef":"PERSONALITY_AMBIGUITY"},
    {"id":"PERSONALITY_ROUTER","enabled":false,"phase":"pre","order":902,"promptRef":"PERSONALITY_ROUTER"}
  ]'::jsonb
)
WHERE agent_key = 'personality';
