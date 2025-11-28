// src/core/router/nutritionIntent.ts
export type NutritionNormalization = {
  finalIntent: 'meal_logging' | 'ama' | 'general';
  ama_nutrition_estimate?: boolean;
};

// --- simple detectors (fast + deterministic) ---

const hasFoodTerms = (text: string) =>
  /\b(egg|eggs|oatmeal|oats|ribeye|steak|big\s*mac|fries|milk|mcnuggets?|nuggets?)\b/i.test(text);

const hasQuantities = (text: string) =>
  /\b(\d+(\.\d+)?)\s*(oz|g|grams?|cups?|cup|ml|tbsp|tsp)\b/i.test(text);

export const looksLikeLog = (text: string) =>
  /^\s*(i\s*ate|i\s*had|log\s+(this|my\s+meal|that)|add\s+(this|my\s+meal)|for\s+(breakfast|lunch|dinner)\s+i\s+ate)\b/i.test(text);

const looksLikeAskMacros = (text: string) =>
  /\b(macros?|macro|calories|protein|carbs?|fat|breakdown)\b/i.test(text);

/**
 * Normalize any nutrition-ish ask into router-friendly intents.
 * Never return "get_macros". Only 'meal_logging' | 'ama' | 'general'.
 */
export function normalizeNutritionIntent(userText: string): NutritionNormalization {
  const t = userText.trim().toLowerCase();

  if (looksLikeLog(t)) {
    return { finalIntent: 'meal_logging' };
  }

  if (hasFoodTerms(t) && looksLikeAskMacros(t)) {
    // question form → AMA with Verify CTA
    return { finalIntent: 'ama', ama_nutrition_estimate: true };
  }

  return { finalIntent: 'general' };
}
