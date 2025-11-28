import { hasFoodContext, hasSpecificFoodContext } from './foodContextLexicon';

export type FoodDetect = {
  isFoodEvent: boolean;
  wantsMacros: boolean;
  wantsLog: boolean;
  why: string;
};

// DETERMINISTIC INTENT DETECTION
// Flags are mutually exclusive based on confidence:
// - wantsLog: Clear past-tense logging intent ("I ate X")
// - wantsMacros: Explicit macro query ("what are the macros of X")
// - isFoodEvent: Ambiguous food mention (triggers clarifier only as last resort)

// Food-specific verbs (always imply food consumption)
const FOOD_VERBS = /\b(i\s+|we\s+|just\s+)?(ate|drank|consumed)\s+/i;

// Generic verbs (need food context validation)
const GENERIC_VERBS = /\b(i\s+|we\s+|just\s+)?(had|finished)\s+/i;

const EXPLICIT_LOG_COMMAND = /\b(please\s+|can\s+you\s+|could\s+you\s+|hey\s+)?(log|add|save|record)\s+/i;

const EXPLICIT_MACRO_QUERY = /\b(what\s+(are|is)\s+the\s+)?(macros?|calories?|nutrition|nutritional\s+info)\s+(of|for|in)\s+/i;

const MACRO_KEYWORDS = /\b(show\s+me\s+)?(macros?|calories?|protein|carbs?|fat|fiber|nutrition)\b/i;

// Educational question patterns - these should NOT trigger TMWYA
const EDUCATIONAL_PATTERNS = /\b(how\s+(does|do|is|can|to)|what\s+(is|are|does)|explain|tell\s+me\s+about|why\s+(does|do|is)|benefits?\s+of|effects?\s+of|help\s+with|role\s+of|importance\s+of|guide\s+to|learn\s+about|understand|difference\s+between|impact\s+of|science\s+(of|behind))\b/i;

// Food present in query - must have actual food to look up macros
const HAS_ACTUAL_FOOD = /\b(egg|eggs|bacon|oatmeal|oats|chicken|beef|steak|salmon|rice|bread|pasta|pizza|burger|hot\s*dog|sandwich|salad|apple|banana|orange|yogurt|milk|cheese|avocado|broccoli|potato|fries|nuggets?|mcnuggets?|big\s*mac|whopper|burrito|taco|sushi|ramen|soup|smoothie|coffee|juice)\b/i;

const PRESENT_EATING = /\b(eating|drinking|having)\s+/i;

// Correction/challenge intent - user questioning accuracy, expressing disbelief, or correcting
// These should ALWAYS route to AMA, ignoring any food/macro keywords
const CORRECTION_INTENT = /\b(are you (telling|saying)|that('?s| is) ?(not|n't)? (right|correct|true)|doesn'?t seem right|does that seem right|why did you|why is that|how (can|is) .* (be|have) (the same|so high|so low)|is that (right|correct|true)|no,? i meant|wait,? that('?s| is) not|you (said|gave|told) ?(me)?|that can'?t be|this can'?t be|are you sure|that makes no sense|this makes no sense)\b/i;

// Helper: Check for past-tense logging intent
function matchesPastTenseLog(text: string): boolean {
  // Food-specific verbs always qualify
  if (FOOD_VERBS.test(text)) {
    return true;
  }
  
  // Generic verbs only qualify if food context is present
  if (GENERIC_VERBS.test(text)) {
    return hasFoodContext(text);
  }
  
  return false;
}

export function detectFoodEvent(input: string): FoodDetect {
  const text = (input || "").trim().toLowerCase();
  
  // PRIORITY 0: Correction / challenge intent → always AMA (highest priority)
  // Catches: "are you telling me...", "that doesn't seem right", "is that correct?"
  // These override ALL food/macro keywords
  if (CORRECTION_INTENT.test(text)) {
    console.info('[foodDetector] Correction intent detected, routing to AMA');
    return {
      isFoodEvent: false,
      wantsMacros: false,
      wantsLog: false,
      why: 'Correction/challenge intent → AMA',
    };
  }
  
  // PRIORITY 1: Explicit macro queries (highest confidence)
  // "what are the macros of hot dog", "macros for pizza", "show me nutrition for chicken"
  if (EXPLICIT_MACRO_QUERY.test(text)) {
    return {
      isFoodEvent: false,
      wantsMacros: true,
      wantsLog: false,
      why: "Explicit macro query detected"
    };
  }
  
  // PRIORITY 2: Past-tense logging statements (high confidence)
  // "I ate a hot dog", "I had pizza", "I just finished dinner"
  // NOTE: Uses helper to avoid false positives like "I just finished my workout"
  if (matchesPastTenseLog(text)) {
    // Check if they ALSO want macros: "I ate X, show me macros"
    if (MACRO_KEYWORDS.test(text)) {
      return {
        isFoodEvent: false,
        wantsMacros: true,
        wantsLog: false,
        why: "Logging statement with macro request"
      };
    }
    
    return {
      isFoodEvent: false,
      wantsMacros: false,
      wantsLog: true,
      why: "Past-tense logging intent detected"
    };
  }
  
  // PRIORITY 3: Explicit log commands
  // "log this meal", "add this food", "record my dinner"
  if (EXPLICIT_LOG_COMMAND.test(text)) {
    return {
      isFoodEvent: false,
      wantsMacros: false,
      wantsLog: true,
      why: "Explicit log command detected"
    };
  }
  
  // PRIORITY 4: Present-tense eating (check for food context AND explicit intent!)
  // "I'm eating a hot dog", "eating pizza", "drinking smoothie"
  if (PRESENT_EATING.test(text)) {
    // First check if they explicitly want macros or to log
    if (MACRO_KEYWORDS.test(text)) {
      return {
        isFoodEvent: false,
        wantsMacros: true,
        wantsLog: false,
        why: "Present-tense with explicit macro intent"
      };
    }
    
    if (/\b(log|save|add|record)\b/i.test(text)) {
      return {
        isFoodEvent: false,
        wantsMacros: false,
        wantsLog: true,
        why: "Present-tense with explicit log intent"
      };
    }
    
    // ONLY trigger clarifier if SPECIFIC food context is present
    // Prevents "I'm having a headache/fun/trouble/food poisoning" from triggering clarifier
    if (hasSpecificFoodContext(text)) {
      return {
        isFoodEvent: true,
        wantsMacros: false,
        wantsLog: false,
        why: "Present-tense eating - ambiguous intent, needs clarification"
      };
    }
  }
  
  // PRIORITY 5: Generic macro mention (assume macro query)
  // "hot dog macros", "pizza nutrition"
  // BUT: Skip if this looks like an educational question
  if (MACRO_KEYWORDS.test(text)) {
    // Educational questions about nutrition should go to AMA, not TMWYA
    // e.g., "explain how protein helps muscle recovery" → AMA
    // e.g., "what are the macros in a hot dog" → TMWYA (has actual food)
    if (EDUCATIONAL_PATTERNS.test(text) && !HAS_ACTUAL_FOOD.test(text)) {
      console.info('[foodDetector] Educational question detected, skipping TMWYA');
      return {
        isFoodEvent: false,
        wantsMacros: false,
        wantsLog: false,
        why: "Educational question about nutrition → AMA"
      };
    }
    
    return {
      isFoodEvent: false,
      wantsMacros: true,
      wantsLog: false,
      why: "Generic macro keywords detected"
    };
  }
  
  // DEFAULT: No clear food intent
  return {
    isFoodEvent: false,
    wantsMacros: false,
    wantsLog: false,
    why: "No clear food intent detected"
  };
}

