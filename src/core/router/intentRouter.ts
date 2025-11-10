import { runPersonalityRouter, normalizeIntent } from '../personality/routerAgent';
import { normalizeNutritionIntent } from './nutritionIntent';

export type AmaChannel = "ama-web" | "ama-local";

export function decideAmaChannel(input: string): AmaChannel {
  const noWeb = /\b(no web|offline|from memory|without internet)\b/i.test(input);
  if (noWeb) return "ama-local";
  return "ama-web";
}

export async function detectIntent(inputText: string): Promise<import('../personality/routerAgent').RouterDecision> {
  // Dev override for testing
  if (inputText.startsWith("dev:force verify")) {
    return {
      intent: 'meal_logging',
      route_to: 'tmwya',
      use_gemini: false,
      reason: 'meal_logging' as const,
      needs_clarification: false,
      clarifier: null,
      confidence: 1.0,
      ama_nutrition_estimate: false,
    };
  }
  
  // --- existing upstream detectors (leave as-is) ---
  // const webIntent = detectWebIntent(inputText)  // if you have one already
  const webIntent: any = (globalThis as any).__hipat_web_intent || {}; // guard if absent

  // --- nutrition normalization (authoritative) ---
  const n = normalizeNutritionIntent(inputText);

  let finalIntent: 'ama' | 'meal_logging' | 'general' = n.finalIntent;
  let route_to: 'ama' | 'tmwya' = finalIntent === 'meal_logging' ? 'tmwya' : 'ama';
  let use_gemini = false;
  let reason: "database_can_answer" | "requires_web_search" | "requires_visual" | "conversational" | "role_task" | "meal_logging" | "nutrition_estimate" | "general" | "ama_needs_web" = 'general';

  if (finalIntent === 'meal_logging') {
    reason = 'meal_logging';
  } else if (finalIntent === 'ama' && n.ama_nutrition_estimate) {
    reason = 'nutrition_estimate';
  } else {
    reason = 'general';
  }

  // If your web-intent detector says we need search, flip use_gemini
  if (finalIntent === 'ama' && webIntent.needs_web) {
    use_gemini = true;
    reason = 'ama_needs_web';
  }

  const decision: import('../personality/routerAgent').RouterDecision = {
    intent: finalIntent,
    route_to,
    use_gemini,
    reason,
    needs_clarification: false,
    clarifier: null,
    confidence: 0.8,
    ama_nutrition_estimate: !!n.ama_nutrition_estimate,
  };
  console.info('[router]', decision);
  return decision;
}

/**
 * Check if intent should trigger a role
 */
export function shouldTriggerRole(intent: string): boolean {
  const roleIntents = [
    'food_question',
    'food_log',
    'food_undo',
    'kpi_today',
    'kpi_remaining',
  ];

  return roleIntents.includes(intent);
}