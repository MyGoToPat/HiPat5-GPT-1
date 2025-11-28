import { BeverageCategory, detectBeverageType, BEVERAGE_TYPES } from '../../lib/undiet/beverageTypes';

export interface UnDietIntent {
  isWaterLog: boolean;
  isBeverageLog: boolean;
  isBathroomLog: boolean;
  isUnDietStart: boolean;
  
  waterAmount?: number;
  waterUnit?: 'ml' | 'oz' | 'cups' | 'liters';
  containerType?: string;  // NEW: bottle, can, glass, cup, etc.
  beverageCategory?: BeverageCategory;
  beverageName?: string;
  
  bathroomType?: 'urination' | 'bowel_movement';
  
  confidence: number;
  debugInfo?: string;  // NEW: For debugging
}

// ============================================
// CONTAINER SIZE MAPPINGS (Smart Defaults)
// ============================================
const CONTAINER_SIZES_ML: Record<string, number> = {
  // Bottles
  'bottle': 500,
  'water bottle': 500,
  'small bottle': 355,
  'large bottle': 750,
  'big bottle': 750,
  'liter bottle': 1000,
  '2 liter': 2000,
  
  // Cans
  'can': 355,
  'soda can': 355,
  'tall can': 473,
  'tallboy': 473,
  
  // Glasses/Cups
  'glass': 240,
  'cup': 240,
  'mug': 350,
  'tall glass': 350,
  'small glass': 180,
  'pint': 473,
  
  // Sports/Special
  'shaker': 500,
  'tumbler': 590,
  'thermos': 500,
  'jug': 1000,
  'pitcher': 1500,
  
  // Shots (for alcohol)
  'shot': 45,
  'double shot': 90,
};

// Pattern to detect container words in message
const CONTAINER_PATTERN = /\b(bottle|can|glass|cup|mug|pint|shot|shaker|tumbler|thermos|jug|pitcher|tallboy|tall\s*boy)\b/i;

// Pattern to detect size modifiers
const SIZE_MODIFIER_PATTERN = /\b(small|large|big|tall|little|huge|giant|2\s*liter|liter)\b/i;

// ============================================
// BEVERAGE DETECTION PATTERNS
// ============================================

// Patterns with explicit numeric amounts
const BEVERAGE_AMOUNT_PATTERNS = [
  /(?:drank|had|consumed|drinking|finished)\s+(?:a\s+)?(?:about\s+)?(\d+(?:\.\d+)?)\s*(ml|oz|ounce|ounces|cup|cups|liter|liters|l)\s+(?:of\s+)?(.+)/i,
  /(?:drank|had|consumed|drinking|finished)\s+(?:a\s+)?(.+?)\s+(\d+(?:\.\d+)?)\s*(ml|oz|ounce|ounces|cup|cups|liter|liters|l)/i,
  /(\d+(?:\.\d+)?)\s*(ml|oz|ounce|ounces|cup|cups|liter|liters|l)\s+(?:of\s+)?(.+)/i,
];

// NEW: Patterns with container words (no numeric amount)
const CONTAINER_BEVERAGE_PATTERNS = [
  // "drank a bottle of water", "had a can of coke"
  /(?:drank|had|consumed|drinking|finished)\s+(?:a\s+)?(small|large|big|tall)?\s*(bottle|can|glass|cup|mug|pint)\s+(?:of\s+)?(.+)/i,
  // "bottle of water", "glass of juice"
  /(?:a\s+)?(small|large|big|tall)?\s*(bottle|can|glass|cup|mug|pint)\s+(?:of\s+)?(.+)/i,
];

// Legacy water patterns with numeric amounts
const WATER_PATTERNS = [
  /(?:drank|had|consumed|drinking)\s+(?:about\s+)?(\d+(?:\.\d+)?)\s*(ml|oz|ounce|ounces|cup|cups|liter|liters|l)/i,
  /(\d+(?:\.\d+)?)\s*(ml|oz|ounce|ounces|cup|cups|liter|liters|l)\s+(?:of\s+)?water/i,
  /water\s+(\d+(?:\.\d+)?)\s*(ml|oz|ounce|ounces|cup|cups|liter|liters|l)/i,
  /hydrat(?:ed|ing)\s+(?:with\s+)?(\d+(?:\.\d+)?)\s*(ml|oz|ounce|ounces|cup|cups|liter|liters|l)/i
];

// Simple keyword triggers (fallback)
const WATER_KEYWORDS = [
  'drank water',
  'had water',
  'drinking water',
  'hydrating',
  'water intake',
  'glass of water',
  'bottle of water',  // NEW
  'cup of water',     // NEW
];

// All beverage keywords from BEVERAGE_TYPES
const ALL_BEVERAGE_KEYWORDS = Object.values(BEVERAGE_TYPES).flatMap(b => b.keywords);

// Drinking verb pattern - indicates beverage intent
const DRINKING_VERB_PATTERN = /\b(drank|had|consumed|drinking|finished|sipped|chugged|gulped)\b/i;

// ============================================
// BATHROOM PATTERNS
// ============================================
const BATHROOM_PATTERNS = {
  urination: [
    /(?:went|going)\s+(?:to\s+)?(?:pee|urinate|bathroom|restroom|toilet)/i,
    /(?:took|taking)\s+a\s+(?:piss|pee|leak)/i,
    /\b(?:peed|urinated)\b/i,
    /number\s+1/i
  ],
  bowel_movement: [
    /(?:went|going)\s+(?:to\s+)?(?:poop|shit|bathroom|restroom|toilet|number\s+2)/i,
    /(?:took|taking)\s+a\s+(?:dump|shit|poop|crap)/i,
    /\b(?:pooped|defecated)\b/i,
    /bowel\s+movement/i,
    /had\s+a\s+bm/i
  ]
};

const UNDIET_START_PATTERNS = [
  /start(?:ing)?\s+(?:the\s+)?undiet/i,
  /begin(?:ning)?\s+(?:the\s+)?undiet/i,
  /yes.*undiet/i,
  /ready\s+(?:to\s+)?(?:start|begin)/i
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function getContainerSize(message: string): { containerType: string; sizeMl: number } | null {
  const lowerMessage = message.toLowerCase();
  
  // Check for size modifier + container
  const sizeMatch = lowerMessage.match(SIZE_MODIFIER_PATTERN);
  const containerMatch = lowerMessage.match(CONTAINER_PATTERN);
  
  if (containerMatch) {
    const container = containerMatch[1].toLowerCase();
    const sizeModifier = sizeMatch ? sizeMatch[1].toLowerCase() : '';
    
    // Build lookup key
    const lookupKey = sizeModifier ? `${sizeModifier} ${container}` : container;
    
    // Try exact match first, then fallback to container only
    const sizeMl = CONTAINER_SIZES_ML[lookupKey] || CONTAINER_SIZES_ML[container] || 250;
    
    console.log(`[undietDetector] Container detected: "${lookupKey}" → ${sizeMl}ml`);
    
    return { containerType: lookupKey, sizeMl };
  }
  
  return null;
}

function normalizeWaterUnit(unit: string): 'ml' | 'oz' | 'cups' | 'liters' {
  const lower = unit.toLowerCase();
  if (lower.includes('oz') || lower.includes('ounce')) return 'oz';
  if (lower.includes('cup')) return 'cups';
  if (lower.includes('liter') || lower === 'l') return 'liters';
  return 'ml';
}

// ============================================
// MAIN DETECTION FUNCTION
// ============================================

export function detectUnDietIntent(message: string): UnDietIntent {
  const lowerMessage = message.toLowerCase();
  const debugSteps: string[] = [];
  
  debugSteps.push(`[undietDetector] Input: "${message}"`);
  
  let isWaterLog = false;
  let isBeverageLog = false;
  let waterAmount: number | undefined;
  let waterUnit: 'ml' | 'oz' | 'cups' | 'liters' | undefined;
  let containerType: string | undefined;
  let beverageCategory: BeverageCategory | undefined;
  let beverageName: string | undefined;
  
  // ============================================
  // STEP 1: Check for drinking verb (strong signal)
  // ============================================
  const hasDrinkingVerb = DRINKING_VERB_PATTERN.test(message);
  debugSteps.push(`[undietDetector] Has drinking verb: ${hasDrinkingVerb}`);
  
  // ============================================
  // STEP 2: Check for container words (bottle, can, glass)
  // ============================================
  const containerInfo = getContainerSize(message);
  if (containerInfo) {
    containerType = containerInfo.containerType;
    waterAmount = containerInfo.sizeMl;
    waterUnit = 'ml';
    debugSteps.push(`[undietDetector] Container found: ${containerType} = ${waterAmount}ml`);
  }
  
  // ============================================
  // STEP 3: Check for beverage keywords
  // ============================================
  for (const keyword of ALL_BEVERAGE_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      const bevType = detectBeverageType(keyword);
      beverageCategory = bevType.category;
      beverageName = keyword;
      isBeverageLog = true;
      
      // Use container size if found, otherwise use default
      if (!waterAmount) {
        waterAmount = bevType.defaultServingMl;
        waterUnit = 'ml';
      }
      
      debugSteps.push(`[undietDetector] Beverage keyword matched: "${keyword}" → category=${beverageCategory}`);
      break;
    }
  }
  
  // ============================================
  // STEP 4: Check for explicit numeric amounts (override container default)
  // ============================================
  for (const pattern of BEVERAGE_AMOUNT_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const numStr = match[1]?.match(/^\d/) ? match[1] : match[2];
      const unitStr = match[1]?.match(/^\d/) ? match[2] : match[3];
      if (numStr && unitStr) {
        waterAmount = parseFloat(numStr);
        waterUnit = normalizeWaterUnit(unitStr);
        debugSteps.push(`[undietDetector] Explicit amount found: ${waterAmount} ${waterUnit}`);
      }
      break;
    }
  }
  
  // ============================================
  // STEP 5: Check for "water" specifically (if no beverage matched yet)
  // ============================================
  if (!isBeverageLog) {
    // Check if "water" is mentioned with a drinking verb or container
    const hasWaterWord = /\bwater\b/i.test(message);
    
    if (hasWaterWord && (hasDrinkingVerb || containerInfo)) {
      isWaterLog = true;
      isBeverageLog = true;
      beverageCategory = 'water';
      beverageName = 'water';
      
      // Use container size if found, otherwise default
      if (!waterAmount) {
        waterAmount = 250;
        waterUnit = 'ml';
      }
      
      debugSteps.push(`[undietDetector] Water detected with context: amount=${waterAmount}ml`);
    }
    
    // Legacy water patterns with numeric amounts
    if (!isBeverageLog) {
      for (const pattern of WATER_PATTERNS) {
        const match = message.match(pattern);
        if (match) {
          isWaterLog = true;
          isBeverageLog = true;
          waterAmount = parseFloat(match[1]);
          waterUnit = normalizeWaterUnit(match[2]);
          beverageCategory = 'water';
          beverageName = 'water';
          debugSteps.push(`[undietDetector] Water pattern matched: ${waterAmount} ${waterUnit}`);
          break;
        }
      }
    }
    
    // Simple keyword fallback
    if (!isBeverageLog) {
      for (const keyword of WATER_KEYWORDS) {
        if (lowerMessage.includes(keyword)) {
          isWaterLog = true;
          isBeverageLog = true;
          beverageCategory = 'water';
          beverageName = 'water';
          
          // Use container size if available, otherwise default
          if (!waterAmount) {
            waterAmount = containerInfo?.sizeMl || 250;
            waterUnit = 'ml';
          }
          
          debugSteps.push(`[undietDetector] Water keyword matched: "${keyword}" → ${waterAmount}ml`);
          break;
        }
      }
    }
  }
  
  // ============================================
  // STEP 6: If we have a container but no beverage yet, check for drinking verb
  // ============================================
  if (!isBeverageLog && containerInfo && hasDrinkingVerb) {
    // User said something like "drank a bottle" without specifying what
    // Default to water
    isWaterLog = true;
    isBeverageLog = true;
    beverageCategory = 'water';
    beverageName = 'water';
    waterAmount = containerInfo.sizeMl;
    waterUnit = 'ml';
    debugSteps.push(`[undietDetector] Container + drinking verb → defaulting to water: ${waterAmount}ml`);
  }
  
  // Set isWaterLog if category is water
  if (beverageCategory === 'water') {
    isWaterLog = true;
  }
  
  // Ensure unit is set
  if (isBeverageLog && !waterUnit && waterAmount) {
    waterUnit = 'ml';
  }
  
  // ============================================
  // STEP 7: Bathroom detection
  // ============================================
  let isBathroomLog = false;
  let bathroomType: 'urination' | 'bowel_movement' | undefined;
  
  for (const pattern of BATHROOM_PATTERNS.urination) {
    if (pattern.test(message)) {
      isBathroomLog = true;
      bathroomType = 'urination';
      debugSteps.push(`[undietDetector] Bathroom (urination) detected`);
      break;
    }
  }
  
  if (!isBathroomLog) {
    for (const pattern of BATHROOM_PATTERNS.bowel_movement) {
      if (pattern.test(message)) {
        isBathroomLog = true;
        bathroomType = 'bowel_movement';
        debugSteps.push(`[undietDetector] Bathroom (bowel movement) detected`);
        break;
      }
    }
  }
  
  // ============================================
  // STEP 8: UnDiet start detection
  // ============================================
  let isUnDietStart = false;
  for (const pattern of UNDIET_START_PATTERNS) {
    if (pattern.test(message)) {
      isUnDietStart = true;
      debugSteps.push(`[undietDetector] UnDiet start intent detected`);
      break;
    }
  }
  
  // ============================================
  // FINAL: Calculate confidence and log results
  // ============================================
  const confidence = (isWaterLog || isBeverageLog || isBathroomLog || isUnDietStart) ? 0.9 : 0.0;
  
  const result: UnDietIntent = {
    isWaterLog,
    isBeverageLog,
    isBathroomLog,
    isUnDietStart,
    waterAmount,
    waterUnit,
    containerType,
    beverageCategory,
    beverageName,
    bathroomType,
    confidence,
    debugInfo: debugSteps.join('\n')
  };
  
  // Always log the full debug info
  console.log('='.repeat(60));
  console.log('[undietDetector] FULL DEBUG:');
  debugSteps.forEach(step => console.log(step));
  console.log('[undietDetector] RESULT:', JSON.stringify({
    isBeverageLog,
    beverageCategory,
    beverageName,
    waterAmount,
    waterUnit,
    containerType,
    confidence
  }, null, 2));
  console.log('='.repeat(60));
  
  return result;
}

export function convertWaterToMl(amount: number, unit: 'ml' | 'oz' | 'cups' | 'liters'): number {
  const conversions = {
    ml: 1,
    oz: 29.5735,
    cups: 240,
    liters: 1000
  };
  
  return Math.round(amount * conversions[unit]);
}

// Export container sizes for UI use
export { CONTAINER_SIZES_ML };
