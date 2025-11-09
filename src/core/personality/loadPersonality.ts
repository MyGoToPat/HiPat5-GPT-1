/**
 * PERSONALITY SYSTEM BOOTSTRAP - DB ONLY
 * Loads and initializes Pat's personality system from database
 *
 * This is the canonical entry point for personality loading.
 * DB is the single source of truth - no file fallbacks.
 */

import { supabase } from '../../lib/supabase';
import { loadPersonalityFromDB } from './promptLoader';

/**
 * Load personality prompts from DB
 * @returns Promise<PromptBlock[]> - Loaded and sorted personality prompts
 */
export async function loadPersonality() {
  try {
    // Always use DB path now, but warn if flag is off
    if (import.meta.env.VITE_NEW_PERSONALITY !== 'true') {
      console.warn('[personality-loader] WARN: VITE_NEW_PERSONALITY=false; using DB anyway');
    }

    const prompts = await loadPersonalityFromDB(supabase);
    return prompts;
  } catch (error) {
    console.error('[personality-bootstrap] Failed to load from DB:', error);
    throw new Error(`Personality system unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if personality system is available
 * @returns Promise<boolean>
 */
export async function isPersonalityAvailable(): Promise<boolean> {
  try {
    await loadPersonality();
    return true;
  } catch {
    return false;
  }
}
