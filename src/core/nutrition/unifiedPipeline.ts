/**
 * UNIFIED NUTRITION PIPELINE
 * Handles both "tell me macros" (info-only) and "I ate" (with logging) flows
 * Replaces separate TMWYA and MACRO swarms with one consistent experience
 */

import { portionResolver } from '../../agents/shared/nutrition/portionResolver';
import { computeTEF } from '../../agents/tmwya/tef';
import { computeTDEE } from '../../agents/tmwya/tdee';
import { getSupabase } from '../../lib/supabase';
import { getLatestPromptOrFallback } from '../../lib/admin/prompts';
import { sanitizeNormalizedItems } from './sanitizeNormalizedItems';
import { PROVIDERS, type ProviderKey } from '../../agents/shared/nutrition/providers';

// Emergency Gemini kill-switch - temporarily disabled due to 502 errors
const GEMINI_ENABLED = false; // import.meta.env.VITE_GEMINI_NUTRITION !== 'false';

export interface NutritionPipelineOptions {
  message: string;
  userId: string;
  sessionId: string;
  /**
   * Controls UX behavior:
   * - true: Show Log/Edit/Cancel buttons (for "I ate..." flows)
   * - false: Info-only, no log button (for "what are macros of..." queries)
   */
  showLogButton?: boolean;
}

export interface NutritionPipelineResult {
  success: boolean;
  roleData?: {
    type: 'tmwya.verify';
    view: any;
    items: any[];
    totals: any;
    tef: any;
    tdee: any;
    skills_fired?: string[];
  };
  error?: string;
}

/**
 * Strip markdown code fences and preambles from JSON responses
 */
function stripMarkdownJSON(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();

  // ✅ Remove "Action completed" or similar prefixes
  s = s.replace(/^Action completed\s*[:\-]?\s*/i, '');
  s = s.replace(/^Here.*?JSON:\s*/i, '');
  s = s.replace(/^The.*?result:\s*/i, '');
  s = s.replace(/^Output:\s*/i, '');

  // ✅ Remove markdown code fences
  s = s.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  s = s.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

  // ✅ Extract JSON object if wrapped in text
  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    s = jsonMatch[0];
  }

  return s.trim();
}

/**
 * Safe JSON parsing with repair attempts
 */
function safeJsonParse(text: string) {
  if (!text || typeof text !== 'string') {
    console.warn('[safeJsonParse] Invalid input:', typeof text);
    return null;
  }

  const stripFences = (s: string) => s.replace(/```json|```/gi, '').trim();
  let t = stripFences(text).trim();

  // Handle empty or whitespace-only strings
  if (!t) {
    console.warn('[safeJsonParse] Empty input after stripping');
    return null;
  }

  try {
    return JSON.parse(t);
  } catch (e) {
    console.warn('[safeJsonParse] Initial parse failed:', e.message, 'input:', t.substring(0, 100));
  }

  // More aggressive repair attempts
  const repairs = [
    // Remove trailing commas
    t.replace(/,(\s*[}\]])/g, '$1'),
    // Quote unquoted keys
    t.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":'),
    // Handle incomplete JSON by adding closing braces/brackets
    t + (t.startsWith('{') && !t.endsWith('}') ? '}' : ''),
    t + (t.startsWith('[') && !t.endsWith(']') ? ']' : ''),
    // Extract JSON from text that might contain extra content
    t.match(/\{[\s\S]*\}/)?.[0] || t,
    // Last resort: try to construct minimal valid JSON
    '{"items":[]}'
  ];

  for (const repaired of repairs) {
    try {
      const result = JSON.parse(repaired);
      console.log('[safeJsonParse] Repaired successfully');
      return result;
    } catch {}
  }

  console.error('[safeJsonParse] All repair attempts failed for input:', t.substring(0, 200));
  return null;
}

/**
 * Infer meal_slot from current time
 */
function inferMealSlotFromTime(): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 22) return 'dinner';
  return 'snack';
}

/**
 * Global nutrition cache lookup
 */
async function lookupGlobalCache(normalized: any): Promise<any> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('global_nutrition_cache')
      .select('*')
      .eq('normalized_name', normalized.name.toLowerCase().trim())
      .eq('brand', normalized.brand || null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.warn('[global-cache] Query error:', error);
      return null;
    }

    if (data) {
      console.log(`[global-cache] Found cached data for "${normalized.name}"`);
      return {
        name: data.normalized_name,
        serving_label: data.serving_label,
        grams_per_serving: data.grams_per_serving,
        macros: {
          kcal: data.calories,
          protein_g: data.protein_g,
          carbs_g: data.carbs_g,
          fat_g: data.fat_g,
          fiber_g: data.fiber_g
        },
        confidence: data.confidence,
        source: data.source,
        notes: 'Data from global nutrition cache'
      };
    }
    return null;
  } catch (e) {
    console.warn('[global-cache] Exception:', e);
    return null;
  }
}

/**
 * Brand Resolver using Gemini - final fallback for unknown foods
 */
async function lookupBrandResolver(normalized: any): Promise<any> {
  try {
    const supabase = getSupabase();

    // Create a specific prompt for brand resolution
    const prompt = `You are a nutrition database expert. Find the verifiable nutritional information for this food item.

Food: ${normalized.name}${normalized.brand ? ` (${normalized.brand})` : ''}${normalized.serving_label ? ` - ${normalized.serving_label}` : ''}${normalized.size_label ? ` ${normalized.size_label}` : ''}

IMPORTANT: Search for official sources like USDA, FDA, or brand websites. Return ONLY valid JSON in this exact format:
{"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number}

If you cannot find reliable data, return: {"error": "not_found"}
Do not make up numbers. Only return verified nutritional data.`;

    const { data, error } = await supabase.functions.invoke('gemini-chat', {
      body: {
        prompt,
        temperature: 0.1, // Low temperature for accuracy
        max_tokens: 500
      }
    });

    if (error || !data?.ok) {
      console.warn('[brand-resolver] Gemini call failed:', error);
      return null;
    }

    const responseText = data.text || '';
    console.log('[brand-resolver] Gemini response:', responseText);

    // Try to parse JSON
    const parsed = safeJsonParse(responseText);
    if (!parsed || parsed.error === 'not_found') {
      console.log('[brand-resolver] No reliable data found for:', normalized.name);
      return null;
    }

    // Validate we have required fields
    if (typeof parsed.calories !== 'number' || typeof parsed.protein_g !== 'number' ||
        typeof parsed.carbs_g !== 'number' || typeof parsed.fat_g !== 'number') {
      console.warn('[brand-resolver] Invalid response format:', parsed);
      return null;
    }

    const result = {
      name: normalized.name,
      serving_label: normalized.serving_label || 'serving',
      grams_per_serving: 100, // Standard assumption
      macros: {
        kcal: parsed.calories,
        protein_g: parsed.protein_g,
        carbs_g: parsed.carbs_g,
        fat_g: parsed.fat_g,
        fiber_g: parsed.fiber_g || 0
      },
      confidence: 0.8, // Brand resolver confidence
      source: 'brand_resolver',
      notes: 'Data resolved by AI brand resolver'
    };

    // Cache the result for future use
    try {
      const cacheData = {
        normalized_name: normalized.name.toLowerCase().trim(),
        brand: normalized.brand || null,
        serving_label: result.serving_label,
        size_label: normalized.size_label || null,
        grams_per_serving: result.grams_per_serving,
        calories: result.macros.kcal,
        protein_g: result.macros.protein_g,
        carbs_g: result.macros.carbs_g,
        fat_g: result.macros.fat_g,
        fiber_g: result.macros.fiber_g,
        source: 'brand_resolver',
        confidence: result.confidence
      };

      const { error: cacheError } = await supabase
        .from('global_nutrition_cache')
        .insert(cacheData);

      if (cacheError) {
        console.warn('[brand-resolver] Failed to cache result:', cacheError);
      } else {
        console.log('[brand-resolver] Cached result for future lookups');
      }
    } catch (cacheErr) {
      console.warn('[brand-resolver] Cache exception:', cacheErr);
    }

    console.log(`[brand-resolver] Successfully resolved "${normalized.name}"`);
    return result;

  } catch (e) {
    console.warn('[brand-resolver] Exception:', e);
    return null;
  }
}

/**
 * OpenAI nutrition provider - fallback when Gemini is disabled
 */
async function lookupOpenAI(normalized: any, userId?: string) {
  try {
    const supabase = getSupabase();
    const prompt = `You are a nutrition expert. Given this food item, return exact nutritional data in this JSON format only:
{"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number}

Food: ${normalized.name}${normalized.brand ? ` (${normalized.brand})` : ''}${normalized.serving_label ? ` - ${normalized.serving_label}` : ''}${normalized.size_label ? ` ${normalized.size_label}` : ''}

Return only the JSON object, no other text.`;

    const { data, error } = await supabase.functions.invoke('openai-chat', {
      body: {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: normalized.name }
        ],
        temperature: 0.1,
        model: 'gpt-4o-mini'
      }
    });

    if (error || !data?.message) {
      console.warn('[openai-nutrition] OpenAI call failed:', error);
      return null;
    }

    // Try multiple response shape possibilities
    let responseText = data.choices?.[0]?.message?.content || data.message || '';
    if (!responseText) return null;

    // Use safe JSON parsing
    const parsed = safeJsonParse(responseText);
    if (!parsed) return null;

    return {
      name: normalized.name,
      serving_label: normalized.serving_label || 'serving',
      grams_per_serving: 100,
      macros: {
        kcal: parsed.calories || 0,
        protein_g: parsed.protein_g || 0,
        carbs_g: parsed.carbs_g || 0,
        fat_g: parsed.fat_g || 0,
        fiber_g: parsed.fiber_g || 0
      },
      confidence: 0.8,
      source: 'openai-fallback',
      notes: 'Data provided by AI assistant'
    };
  } catch (e) {
    console.warn('[openai-nutrition] Exception:', e);
    return null;
  }
}

/**
 * Lookup macros in provider cascade: brand → gemini/openai → generic
 */
async function lookupMacrosInCascade(items: any[], userId?: string): Promise<any> {
  const results = [];
  const skillsFired: string[] = [];

  for (const item of items) {
    // Convert to normalized item format
    const normalized = {
      name: item.name,
      amount: item.quantity || 1,
      unit: item.unit,
      brand: item.brand,
      serving_label: item.serving_label,
      size_label: item.size_label,
      is_branded: !!item.brand
    };

    // ✅ Check global cache FIRST (fastest lookup)
    let macroResult = await lookupGlobalCache(normalized);
    let providerUsed = 'global_cache';

    if (macroResult) {
      skillsFired.push('macro_lookup_global_cache');
      console.log(`[nutrition] Global cache found macros for "${item.name}"`);
    } else {
      // ✅ Choose provider order based on brand status and Gemini availability
      // Branded: brand map → gemini/openai → generic
      // Whole foods: generic (USDA) → gemini/openai → brand resolver
      const ORDER: (ProviderKey | 'openai' | 'brand_resolver')[] = normalized.is_branded
        ? GEMINI_ENABLED ? ["brand", "gemini", "generic", "brand_resolver"] : ["brand", "openai", "generic", "brand_resolver"]  // Branded: brand map first
        : GEMINI_ENABLED ? ["generic", "gemini", "brand_resolver"] : ["generic", "openai", "brand_resolver"];                   // Whole foods: USDA first, then fallback

      // Always add brand_resolver as final fallback if not already included
      if (!ORDER.includes('brand_resolver')) {
        ORDER.push('brand_resolver');
      }

      // ✅ Try each provider in order
      for (const key of ORDER) {
        let providerFn = null;

        if (key === 'openai') {
          providerFn = lookupOpenAI;
          console.log(`[nutrition] trying openai provider for "${item.name}"`);
        } else if (key === 'brand_resolver') {
          providerFn = lookupBrandResolver;
          console.log(`[nutrition] trying brand_resolver for "${item.name}"`);
        } else {
          providerFn = PROVIDERS[key];
        }

        if (providerFn) {
          try {
            macroResult = await providerFn(normalized, userId);
            if (macroResult && macroResult.macros && macroResult.macros.kcal > 0) {
              providerUsed = key;
              skillsFired.push(`macro_lookup_${key}`); // Track skill usage
              console.log(`[nutrition] Provider ${key} found macros for "${item.name}"`);
              break;
            }
          } catch (err) {
            console.error(`[nutrition] Provider ${key} error for "${item.name}":`, err);
            continue;  // Try next provider
          }
        }
      }

      // ✅ If still no result, try Brand Resolver as final fallback
      if (!macroResult || !macroResult.macros || macroResult.macros.kcal === 0) {
        console.log(`[nutrition] Trying Brand Resolver for "${item.name}"`);
        macroResult = await lookupBrandResolver(normalized);
        if (macroResult) {
          providerUsed = 'brand_resolver';
          skillsFired.push('macro_lookup_brand_resolver');
          console.log(`[nutrition] Brand Resolver found macros for "${item.name}"`);
        }
      }

      // ✅ Only use stub if ALL providers including Brand Resolver failed
      if (!macroResult || !macroResult.macros || macroResult.macros.kcal === 0) {
        console.warn(`[nutrition] All providers including Brand Resolver failed for "${item.name}", using stub`);
        macroResult = {
          name: item.name,
          serving_label: item.unit || 'serving',
          grams_per_serving: 100,
          macros: {
            kcal: 0,  // ✅ Show 0, not fake data
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
            fiber_g: 0
          },
          confidence: 0.1,
          source: 'stub',
          notes: 'Unable to retrieve macro data. Please verify manually.'
        };
        providerUsed = 'stub';
      }
    }

    // Add to results
    results.push({
      ...item,
      calories: macroResult.macros.kcal || 0,
      protein_g: macroResult.macros.protein_g || 0,
      carbs_g: macroResult.macros.carbs_g || 0,
      fat_g: macroResult.macros.fat_g || 0,
      fiber_g: macroResult.macros.fiber_g || 0,
      confidence: macroResult.confidence || 0.1,
      source: macroResult.source || 'unknown',
      provider: providerUsed
    });
  }

  // Calculate totals (ensure zeros are handled correctly)
  const totals = results.reduce((acc, item) => ({
    calories: acc.calories + (item.calories || 0),
    protein_g: acc.protein_g + (item.protein_g || 0),
    carbs_g: acc.carbs_g + (item.carbs_g || 0),
    fat_g: acc.fat_g + (item.fat_g || 0),
    fiber_g: acc.fiber_g + (item.fiber_g || 0)
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });

  return { 
    items: results, 
    totals,
    skills_fired: [...new Set(skillsFired)] // Unique skills
  };
}

/**
 * Fallback NLU parser when normalizer LLM fails or returns non-JSON
 */
function fallbackNLU(message: string): Array<{ name: string; amount: number | null; unit: string | null }> {
  // Simple deterministic parser
  // Extract food items by splitting on common separators
  const cleanMsg = message.replace(/^(i ate|i had|ate|had)\s+/i, '').trim();
  const items = cleanMsg.split(/,\s+| and | with | plus /i).map(item => {
    const trimmed = item.trim();
    // Extract quantity: "3 eggs" → amount: 3, name: "eggs"
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
    if (match) {
      return { name: match[2], amount: parseFloat(match[1]), unit: null };
    }
    return { name: trimmed, amount: null, unit: null };
  }).filter(x => x.name.length > 0 && x.name !== 'a');
  
  console.log('[fallbackNLU] Parsed items:', items);
  return items;
}

/**
 * Main unified nutrition pipeline
 * Used by both "food_question" (info) and "meal_logging" (log) intents
 */
export async function processNutrition(options: NutritionPipelineOptions): Promise<NutritionPipelineResult> {
  const { message, userId, showLogButton = true } = options;
  const skillsFired: string[] = [];

  try {
    console.log('[nutrition] Processing:', { message, userId, showLogButton });

    // Dev override: return static test data
    if (message.startsWith("dev:force verify")) {
      return {
        success: true,
        roleData: {
          type: 'tmwya.verify',
          view: {
            rows: [
              { name: "big mac", quantity: 1, unit: "piece", calories: 219, protein_g: 9.1, carbs_g: 21, fat_g: 12, fiber_g: 0.3, editable: true },
              { name: "large fries", quantity: 1, unit: "piece", calories: 323, protein_g: 3.8, carbs_g: 41, fat_g: 16, fiber_g: 3.5, editable: true }
            ],
            totals: { calories: 542, protein_g: 12.9, carbs_g: 62, fat_g: 28, fiber_g: 3.8 },
            tef: { kcal: 54 },
            tdee: { target_kcal: 2000, remaining_kcal: 1404, remaining_percentage: 70.2 },
            meal_slot: "lunch",
            eaten_at: new Date().toISOString(),
            actions: ['CONFIRM_LOG', 'EDIT_ITEMS', 'CANCEL']
          },
          items: [
            { name: "big mac", quantity: 1, unit: "piece", calories: 219, protein_g: 9.1, carbs_g: 21, fat_g: 12, fiber_g: 0.3 },
            { name: "large fries", quantity: 1, unit: "piece", calories: 323, protein_g: 3.8, carbs_g: 41, fat_g: 16, fiber_g: 3.5 }
          ],
          totals: { calories: 542, protein_g: 12.9, carbs_g: 62, fat_g: 28, fiber_g: 3.8 },
          tef: { kcal: 54 },
          tdee: { target_kcal: 2000, remaining_kcal: 1404, remaining_percentage: 70.2 }
        }
      };
    }

    // Step 1: Call normalizer LLM to parse meal text
    const supabase = getSupabase();
    const NORMALIZER_AGENT_KEY = 'tmwya-normalizer';
    const NORMALIZER_FALLBACK = `Normalize messy meal text into structured food items. Output JSON only.
Return: {"items":[{"name":"food","amount":number|null,"unit":"piece|cup|g|oz|etc"|null}]}
Rules:
- Split multiple foods by commas or "and"
- PRESERVE the user's exact food names verbatim (e.g., "skim milk" NOT "milk", "sourdough bread" NOT "bread")
- Infer common units when missing (eggs→piece, oatmeal→cup, milk→cup, bread→slice)
- Extract quantities when present
- Output valid JSON only, no markdown, no explanations`;

    const normalizerPrompt = await getLatestPromptOrFallback(NORMALIZER_AGENT_KEY, NORMALIZER_FALLBACK);
    console.info('[nutrition] normalizer prompt source:', normalizerPrompt.startsWith('Normalize messy') ? 'fallback' : 'db');

    const { data: normalizerResponse, error: normalizerError } = await supabase.functions.invoke('openai-chat', {
      body: {
        messages: [
          { role: 'system', content: normalizerPrompt + '\n\nIMPORTANT: You MUST output ONLY valid JSON. No prose, no markdown, no explanations. Only JSON.' },
          { role: 'user', content: message }
        ],
        stream: false,
        userId,
        temperature: 0.05, // Lower temp for stricter JSON
        model: 'gpt-4o-mini',
        provider: 'openai',
        response_format: { type: 'json_object' }  // ✅ FORCE JSON MODE
      }
    });

    let parsedItems: Array<{ name: string; amount: number | null; unit: string | null }> = [];

    if (!normalizerError && normalizerResponse?.message) {
      // Try multiple response shape possibilities
      let responseText = normalizerResponse.choices?.[0]?.message?.content || normalizerResponse.message || '';
      
      // CRITICAL: If response is plain text (not JSON), use fallback NLU
      if (!responseText.trim().startsWith('{') && !responseText.trim().startsWith('[')) {
        console.warn('[nutrition] Normalizer returned non-JSON, using fallback NLU:', responseText);
        parsedItems = fallbackNLU(message);
      } else {
        const parsed = safeJsonParse(responseText);

        if (parsed && Array.isArray(parsed.items)) {
          parsedItems = parsed.items;
          console.log('[nutrition] Normalizer parsed items:', parsedItems);

          // Food search skill fired (meal parsing)
          if (parsedItems.length > 0) {
            skillsFired.push('food_search');
          }
        } else {
          console.warn('[nutrition] Normalizer returned invalid JSON, using fallback NLU');
          parsedItems = fallbackNLU(message);
        }
      }
    } else {
      // Normalizer failed entirely, use fallback
      console.warn('[nutrition] Normalizer error, using fallback NLU');
      parsedItems = fallbackNLU(message);
    }

    // Step 1.5: Sanitize normalized items (fix quantity/serving_label issues)
    // This handles "10-piece" → qty=1 serving="10-piece", "two 10-piece" → qty=2 serving="10-piece", etc.
    const sanitizedItems = sanitizeNormalizedItems(parsedItems, new Map());
    console.log('[nutrition] Sanitized items:', sanitizedItems);

    // Step 2: Convert sanitized items back to PortionedItem format for portionResolver
    const portionedItems = sanitizedItems.map(item => ({
      name: item.name,
      amount: item.amount,
      unit: item.unit,
      brand: item.brand,
      serving_label: item.serving_label,
      size_label: item.size_label,
      is_branded: item.is_branded
    }));

    // Step 3: Resolve portions and lookup macros
    const portioned = portionResolver(portionedItems);
    const macroResults = await lookupMacrosInCascade(portioned, userId);

    // Extract skills_fired from macro lookup
    const macroSkills = macroResults.skills_fired || [];
    skillsFired.push(...macroSkills);

    // Step 3: Compute TEF and TDEE
    const tef = computeTEF(macroResults.totals);
    const tdee = await computeTDEE(userId, macroResults.totals, tef, new Date().toISOString());

    console.log('[nutrition] Pipeline complete:', {
      items: macroResults.items.length,
      totals: macroResults.totals,
      tef: tef.kcal,
      tdee_remaining: tdee.remaining_kcal
    });

    // Step 4: Generate warnings for low-confidence or unknown items
    const warnings: Array<{ type: 'low_confidence' | 'missing_portion'; item?: string; message: string }> = [];

    macroResults.items.forEach((item: any) => {
      if (item.confidence < 0.7) {
        warnings.push({
          type: 'low_confidence',
          item: item.name,
          message: `Low confidence on "${item.name}" - please verify macros`
        });
      }
      // Flag items with zero macros (unknown foods)
      if (item.calories === 0 && item.protein_g === 0 && item.carbs_g === 0 && item.fat_g === 0) {
        warnings.push({
          type: 'missing_portion',
          item: item.name,
          message: `Unknown food "${item.name}" - please add quantity and unit`
        });
      }
    });

    // Step 5: Build verification view (ALWAYS use existing Verification Sheet schema)
    const verify = {
      rows: macroResults.items.map((i: any) => ({
        name: i.name,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
        calories: Math.round(i.calories ?? 0),
        protein_g: Math.round(i.protein_g ?? 0),
        carbs_g: Math.round(i.carbs_g ?? 0),
        fat_g: Math.round(i.fat_g ?? 0),
        fiber_g: Math.round(i.fiber_g ?? 0), // ALWAYS include fiber, even if 0
        editable: true
      })),
      totals: {
        calories: Math.round(macroResults.totals.calories ?? 0),
        protein_g: Math.round(macroResults.totals.protein_g ?? 0),
        carbs_g: Math.round(macroResults.totals.carbs_g ?? 0),
        fat_g: Math.round(macroResults.totals.fat_g ?? 0),
        fiber_g: Math.round(macroResults.totals.fiber_g ?? 0) // Ensure fiber in totals
      },
      tef: { kcal: Math.round(tef.kcal) },
      tdee: {
        target_kcal: Math.round(tdee.target_kcal),
        remaining_kcal: Math.round(tdee.remaining_kcal),
        remaining_percentage: Math.round(tdee.remaining_percentage * 10) / 10
      },
      meal_slot: inferMealSlotFromTime(), // Time-based inference
      eaten_at: new Date().toISOString(),
      // ALWAYS show CONFIRM_LOG button for both "I ate" and "what are the macros" queries
      actions: ['CONFIRM_LOG', 'EDIT_ITEMS', 'CANCEL'],
      warnings
    };

    // Step 6: Return roleData in the shape ChatPat expects
    return {
      success: true,
      roleData: {
        type: 'tmwya.verify',
        view: verify,
        items: macroResults.items,
        totals: verify.totals,
        tef: verify.tef,
        tdee: verify.tdee,
        skills_fired: skillsFired  // ✅ Include skills_fired
      }
    };

  } catch (error: any) {
    console.error('[nutrition] Pipeline failed:', error);
    return {
      success: false,
      error: error?.message ?? 'Nutrition pipeline failed'
    };
  }
}

