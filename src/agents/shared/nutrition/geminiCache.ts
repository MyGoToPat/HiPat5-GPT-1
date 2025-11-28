/**
 * Gemini Cache - Browser-safe, standalone
 * Calls nutrition-gemini Edge Function directly
 * Includes in-memory cache + DB persistence
 */

import type { MacroResult } from './providers/types';
import { getSupabase } from '../../../lib/supabase';

const cache = new Map<string, { result: MacroResult; expires: number }>();

/**
 * Build canonical key for DB lookup (normalized, deterministic)
 */
function canonicalKeyFrom(q: {
  name: string;
  brand?: string;
  serving_label?: string;
  size_label?: string;
  country?: string;
}): string {
  const parts = [q.brand, q.name, q.serving_label, q.size_label]
    .filter(Boolean)
    .map(s => s!.toLowerCase().trim())
    .join(' ');
  
  return parts
    .replace(/[^a-z0-9\s]+/g, ' ')  // Remove special chars
    .replace(/\s+/g, ' ')           // Normalize spaces
    .trim() || q.name.toLowerCase();
}

/**
 * Known zero/low-calorie beverages - bypass food_cache to avoid false matches
 * (e.g., "water" matching "beef noodle with water added")
 */
const ZERO_CAL_BEVERAGES: Record<string, MacroResult> = {
  'water': {
    name: 'Water',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'tap water': {
    name: 'Tap Water',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'sparkling water': {
    name: 'Sparkling Water',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'mineral water': {
    name: 'Mineral Water',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'soda water': {
    name: 'Soda Water',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'black coffee': {
    name: 'Black Coffee',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 2, protein_g: 0.1, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'coffee': {
    name: 'Coffee (black)',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 2, protein_g: 0.1, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 0.9,
    source: 'known_beverage'
  },
  'tea': {
    name: 'Tea (unsweetened)',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 1, protein_g: 0, carbs_g: 0.3, fat_g: 0, fiber_g: 0 },
    confidence: 0.9,
    source: 'known_beverage'
  },
  'green tea': {
    name: 'Green Tea',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 1, protein_g: 0, carbs_g: 0.2, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'black tea': {
    name: 'Black Tea',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 1, protein_g: 0, carbs_g: 0.3, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'herbal tea': {
    name: 'Herbal Tea',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'diet coke': {
    name: 'Diet Coke',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'diet soda': {
    name: 'Diet Soda',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  },
  'coke zero': {
    name: 'Coke Zero',
    serving_label: '100ml',
    grams_per_serving: 100,
    macros: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    confidence: 1.0,
    source: 'known_beverage'
  }
};

/**
 * Get cached Gemini results via Edge Function
 * @param q - Query parameters for food lookup
 * @param userId - Optional user ID for caching new results to user_custom_foods
 */
export async function getCachedGemini(q: {
  name: string;
  brand?: string;
  serving_label?: string;
  size_label?: string;
  country?: string;
}, userId?: string): Promise<MacroResult | null> {
  const supabase = getSupabase();
  
  // Guard against empty names
  const foodName = q.name?.trim();
  if (!foodName) {
    console.warn('[geminiCache] Empty food name provided');
    return null;
  }

  // ✅ Step 0: Check if this is a known beverage (to avoid false matches like "beef noodle with water")
  const normalizedName = foodName.toLowerCase().trim();
  const knownBeverage = ZERO_CAL_BEVERAGES[normalizedName];
  if (knownBeverage) {
    console.log(`[geminiCache] Known beverage match: "${normalizedName}" → 0 kcal`);
    return { ...knownBeverage };
  }

  // ✅ Step 1: Check in-memory cache first
  const key = JSON.stringify(q);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    console.log(`[macroLookup.trace] cache=hit key=${key}`);
    return hit.result;
  }

  // ✅ Step 2: Check user_custom_foods (permanent shared cache)
  // Query by name (and optionally brand) since table doesn't have normalized_key column
  const searchName = q.name?.trim().toLowerCase() || foodName.toLowerCase();
  try {
    let query = supabase
      .from('user_custom_foods')
      .select('*')
      .ilike('name', searchName);
    
    // If brand is specified, also filter by brand
    if (q.brand) {
      query = query.ilike('brand', q.brand.trim());
    }
    
    const { data: customFoodHit, error: customError } = await query.maybeSingle();

    if (!customError && customFoodHit) {
      // Parse numeric fields (Supabase returns NUMERIC as strings)
      const result: MacroResult = {
        name: customFoodHit.name || foodName,
        serving_label: customFoodHit.serving_label || '100g',
        grams_per_serving: Number(customFoodHit.serving_size_g) || 100,
        macros: {
          kcal: Number(customFoodHit.calories) || 0,
          protein_g: Number(customFoodHit.protein_g) || 0,
          carbs_g: Number(customFoodHit.carbs_g) || 0,
          fat_g: Number(customFoodHit.fat_g) || 0,
          fiber_g: Number(customFoodHit.fiber_g) || 0
        },
        confidence: Number(customFoodHit.confidence) || 0.8,
        source: customFoodHit.source || 'user_custom_foods'
      };

      // Populate in-memory cache
      cache.set(key, {
        result,
        expires: Date.now() + 24 * 60 * 60 * 1000
      });

      // Update updated_at timestamp on cache hit
      await supabase
        .from('user_custom_foods')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', customFoodHit.id);

      console.log(`[geminiCache] cache=custom-foods-hit name=${result.name}`);
      return result;
    }
  } catch (customErr) {
    console.warn('[geminiCache] user_custom_foods lookup failed:', customErr);
    // Continue to next lookup
  }

  // ✅ Step 3: Check food_cache (USDA/temporary cache)
  // Search by name similarity with deterministic scoring
  try {
    // Core search terms from foodName (ignore brand/qualifiers for better cache hits)
    const coreName = foodName.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').trim();
    const allTerms = coreName.split(/\s+/).filter(t => t.length > 2);
    
    // Brand names and qualifiers to deprioritize
    const stopWords = new Set([
      'costco', 'trader', 'joes', 'kirkland', 'kroger', 'walmart', 'target', 'whole', 'foods',
      'organic', 'fresh', 'premium', 'select', 'choice', 'prime', 'grass', 'fed', 'wild', 'free', 'range',
      'certified', 'natural', 'smoked', 'cured', 'aged'
    ]);
    
    // Descriptors to deprioritize (search LAST)
    const descriptors = new Set([
      'raw', 'cooked', 'frozen', 'grilled', 'broiled', 'baked', 'fried', 'roasted',
      'boneless', 'skinless', 'lean', 'fat', 'trimmed', 'whole', 'sliced', 'diced', 'chopped'
    ]);
    
    // Prioritize food nouns over descriptors
    const foodNouns = allTerms.filter(t => !stopWords.has(t) && !descriptors.has(t));
    const descriptorTerms = allTerms.filter(t => descriptors.has(t));
    const coreTerms = allTerms.filter(t => !stopWords.has(t));
    
    // Search order: food nouns first, then descriptors, then all terms
    const searchOrder = [...foodNouns, ...descriptorTerms, ...allTerms];
    
    if (searchOrder.length > 0) {
      let dbHits: any[] = [];
      let searchTerm = '';
      
      // Try each term in priority order until we get hits
      for (const term of searchOrder) {
        const { data, error } = await supabase
          .from('food_cache')
          .select('*')
          .ilike('name', `%${term}%`)
          .limit(20);
        
        if (!error && data && data.length > 0) {
          dbHits = data;
          searchTerm = term;
          break; // Found hits, stop searching
        }
      }

      if (dbHits.length > 0) {
        // Score each match for relevance
        const scored = dbHits.map(hit => {
          const hitName = hit.name.toLowerCase();
          let score = 0;
          
          // +100: Exact match on all core terms
          if (coreTerms.every(term => hitName.includes(term))) score += 100;
          
          // +50: USDA source (trusted)
          if (hit.source_db === 'USDA') score += 50;
          
          // +30: Beef (prefer over bison/game for common queries)
          if (hitName.includes('beef')) score += 30;
          
          // +25: Cooked state matches query context
          const hasCooked = coreName.includes('cooked') || coreName.includes('grilled') || coreName.includes('broiled');
          if (hasCooked && (hitName.includes('cooked') || hitName.includes('broiled'))) score += 25;
          if (!hasCooked && hitName.includes('raw')) score += 15; // Slight preference for raw if not specified
          
          // +20 per matched term
          const matchedTerms = coreTerms.filter(term => hitName.includes(term)).length;
          score += matchedTerms * 20;
          
          // +15: Lean cuts (healthier default)
          if (hitName.includes('lean') && !hitName.includes('extra lean')) score += 15;
          if (hitName.includes('skinless') || hitName.includes('boneless')) score += 10;
          
          // -10: Overly specific cuts (prefer general)
          if (hitName.match(/trimmed to \d+/)) score -= 10;
          
          // +5: Shorter name (more generic/common), capped
          score += Math.max(0, Math.min(50, 150 - hitName.length));
          
          return { hit, score };
        });
        
        // Sort by score descending, then by name for determinism
        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.hit.name.localeCompare(b.hit.name); // Alphabetical tie-break
        });

        const bestMatch = scored[0].hit;
        
        const result: MacroResult = {
          name: bestMatch.name,
          serving_label: bestMatch.serving_size || '100g',
          grams_per_serving: bestMatch.grams_per_serving || 100,
          macros: bestMatch.macros as any,
          confidence: bestMatch.confidence || 0.7,
          source: bestMatch.source_db || 'food_cache'
        };

        // Populate in-memory cache
        cache.set(key, {
          result,
          expires: Date.now() + 24 * 60 * 60 * 1000
        });

        console.log(`[geminiCache] cache=food-cache-hit search="${searchTerm}" found="${bestMatch.name}" (score=${scored[0].score})`);
        return result;
      }
    }
  } catch (dbErr) {
    console.warn('[geminiCache] food_cache lookup failed:', dbErr);
    // Continue to Edge Function call
  }

  // ✅ Step 4: Call deployed gemini-chat Edge Function (fallback)
  try {
    // Build canonicalName for better Gemini results
    const canonicalName = [
      q.brand,
      q.name,
      q.serving_label,
      q.size_label
    ].filter(Boolean).join(' ').trim() || foodName;

    // Build prompt with examples for better results
    const prompt = `You are a nutrition database expert. Find verifiable nutritional information for: "${canonicalName}".

Return ONLY valid JSON in this exact format (no markdown, no code blocks, no explanation):

Examples of CORRECT responses:
{"name": "Ribeye steak, cooked", "serving_label": "100g", "grams_per_serving": 100, "calories": 234, "protein_g": 28, "carbs_g": 0, "fat_g": 13, "fiber_g": 0}
{"name": "Big Mac", "serving_label": "1 sandwich", "grams_per_serving": 219, "calories": 563, "protein_g": 26, "carbs_g": 46, "fat_g": 33, "fiber_g": 3}
{"name": "Tuna, canned in water", "serving_label": "1 can (142g)", "grams_per_serving": 142, "calories": 128, "protein_g": 24, "carbs_g": 0, "fat_g": 3, "fiber_g": 0}

CRITICAL RULES:
1. Search USDA database, nutrition labels, or verified sources
2. Return REAL data - never make up numbers
3. All numbers must be positive integers or decimals
4. If you cannot find reliable data, return: {"error": "not_found"}
5. NO markdown formatting, NO code blocks, ONLY the JSON object

Food to look up: "${canonicalName}"

Your response:`;

    // Call deployed gemini-chat function
    const { data, error } = await supabase.functions.invoke("gemini-chat", {
      body: { prompt }
    });

    // Enhanced error logging
    if (error) {
      console.error('[geminiCache] gemini-chat error:', {
        error,
        status: (error as any)?.status,
        message: error.message,
        foodName,
        timestamp: new Date().toISOString()
      });
      return null;
    }

    if (!data || !data.ok || !data.text) {
      console.error('[geminiCache] Invalid response from gemini-chat:', {
        data,
        foodName,
        timestamp: new Date().toISOString()
      });
      return null;
    }

    // Parse JSON from response text
    let parsed: any;
    try {
      parsed = JSON.parse(data.text);
    } catch (parseErr) {
      console.error('[geminiCache] Failed to parse gemini-chat response:', {
        text: data.text,
        error: parseErr,
        foodName
      });
      return null;
    }

    // Check for error response
    if (parsed.error === "not_found") {
      console.log('[geminiCache] Gemini could not find nutrition data for:', foodName);
      return null;
    }

    // Convert to MacroResult format
    const result: MacroResult = {
      name: parsed.name || foodName,
      serving_label: parsed.serving_label || 'serving',
      grams_per_serving: parsed.grams_per_serving || 100,
      macros: {
        kcal: parsed.calories || 0,
        protein_g: parsed.protein_g || 0,
        carbs_g: parsed.carbs_g || 0,
        fat_g: parsed.fat_g || 0,
        fiber_g: parsed.fiber_g || 0
      },
      confidence: 0.8,
      source: 'gemini'
    };

    // ✅ Step 4: Persist to user_custom_foods (permanent shared cache)
    // Only persist if userId is available (security: prevents anonymous overwrites)
    if (result.macros.kcal > 0 && userId) {
      // Check if entry already exists for THIS USER by name (and brand if present)
      let existingQuery = supabase
        .from('user_custom_foods')
        .select('id, user_id')
        .eq('user_id', userId) // SECURITY: Only check user's own entries
        .ilike('name', result.name);
      
      if (q.brand) {
        existingQuery = existingQuery.ilike('brand', q.brand.trim());
      }
      
      const { data: existingEntry } = await existingQuery.maybeSingle();

      if (existingEntry) {
        // Entry exists for this user - update macros
        const { error: updateError } = await supabase
          .from('user_custom_foods')
          .update({
            name: result.name,
            brand: q.brand || null,
            serving_label: result.serving_label,
            serving_size_g: result.grams_per_serving,
            calories: result.macros.kcal,
            protein_g: result.macros.protein_g,
            carbs_g: result.macros.carbs_g,
            fat_g: result.macros.fat_g,
            fiber_g: result.macros.fiber_g || 0,
            source: 'gemini',
            updated_at: new Date().toISOString()
          })
          .eq('id', existingEntry.id)
          .eq('user_id', userId); // SECURITY: Double-check user ownership

        if (updateError) {
          console.warn('[geminiCache] user_custom_foods update failed:', updateError);
        } else {
          console.log(`[geminiCache] ✅ Updated user_custom_foods: ${result.name}`);
        }
      } else {
        // New entry for this user - insert
        const { error: insertError } = await supabase
          .from('user_custom_foods')
          .insert({
            user_id: userId,
            name: result.name,
            brand: q.brand || null,
            serving_label: result.serving_label,
            serving_size_g: result.grams_per_serving,
            calories: result.macros.kcal,
            protein_g: result.macros.protein_g,
            carbs_g: result.macros.carbs_g,
            fat_g: result.macros.fat_g,
            fiber_g: result.macros.fiber_g || 0,
            source: 'gemini'
          });

        if (insertError) {
          console.warn('[geminiCache] user_custom_foods insert failed:', insertError);
        } else {
          console.log(`[geminiCache] ✅ Inserted to user_custom_foods: ${result.name}`);
        }
      }
    } else if (result.macros.kcal > 0) {
      console.log(`[geminiCache] Skipping user_custom_foods persist (no userId)`);
    }

    // ✅ Step 5: Populate in-memory cache
    cache.set(key, {
      result,
      expires: Date.now() + 24 * 60 * 60 * 1000
    });

    console.log(`[macroLookup.trace] cache=miss key=${key} (will cache to DB)`);
    return result;

  } catch (err) {
    console.error('[geminiCache] Exception:', err);
    console.error('[geminiCache] Exception details:', {
      error: err,
      query: q,
      stack: err instanceof Error ? err.stack : undefined,
      timestamp: new Date().toISOString()
    });
    return null;
  }
}
