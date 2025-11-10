/**
 * Pat's Contextual Memory from Structured Data
 * Use structured tables as source of truth, not raw chat history
 */

import { getSupabase } from '../../lib/supabase';

export interface MemoryResult {
  type: 'meal' | 'workout' | 'sleep' | 'metric';
  timestamp: string;
  summary: string;
  details: any;
}

/**
 * Search for "when was the last time I ate sushi?"
 * Query meal_items/meal_logs for food matches
 */
export async function searchMealHistory(
  userId: string,
  foodQuery: string
): Promise<MemoryResult[]> {
  const supabase = getSupabase();
  
  try {
    const { data, error } = await supabase
      .from('meal_items')
      .select(`
        name,
        quantity,
        unit,
        energy_kcal,
        protein_g,
        carbs_g,
        fat_g,
        meal_logs!inner(ts, user_id, meal_slot)
      `)
      .eq('meal_logs.user_id', userId)
      .ilike('name', `%${foodQuery}%`)
      .order('meal_logs.ts', { ascending: false })
      .limit(5);

    if (error) {
      console.error('[chatContext] Meal search error:', error);
      return [];
    }

    return (data || []).map(item => ({
      type: 'meal' as const,
      timestamp: (item.meal_logs as any).ts,
      summary: `${item.name} (${item.quantity} ${item.unit}) - ${item.energy_kcal} cal`,
      details: {
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        calories: item.energy_kcal,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        meal_slot: (item.meal_logs as any).meal_slot
      }
    }));
  } catch (error) {
    console.error('[chatContext] Exception in searchMealHistory:', error);
    return [];
  }
}

/**
 * Detect memory keywords and route to appropriate search
 */
export function detectMemoryQuery(text: string): {
  isMemoryQuery: boolean;
  type?: 'meal' | 'workout' | 'sleep' | 'metric';
  searchTerm?: string;
} {
  const lowerText = text.toLowerCase();
  
  // Meal memory patterns
  const mealPatterns = [
    /when (was the )?(last time|did) i (ate?|had|logged?) (\w+)/i,
    /have i (ever )?eaten (\w+)/i,
    /did i (eat|have|log) (\w+)/i,
    /last time i (ate|had) (\w+)/i
  ];

  for (const pattern of mealPatterns) {
    const match = text.match(pattern);
    if (match) {
      // Extract food term from last capture group
      const searchTerm = match[match.length - 1];
      return {
        isMemoryQuery: true,
        type: 'meal',
        searchTerm
      };
    }
  }

  // Workout memory patterns
  if (/when (was the )?(last time|did) i (workout|train|lift)/i.test(lowerText)) {
    return {
      isMemoryQuery: true,
      type: 'workout'
    };
  }

  return { isMemoryQuery: false };
}

/**
 * Build context snippet for system prompt injection
 */
export function buildMemoryContext(results: MemoryResult[]): string {
  if (!results.length) return '';

  const latest = results[0];
  const date = new Date(latest.timestamp);
  const relativeTime = formatRelativeTime(date);

  return `[Memory] User's last ${latest.type}: ${latest.summary} (${relativeTime})`;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

