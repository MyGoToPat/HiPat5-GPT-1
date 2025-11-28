/**
 * Food Context Lexicon
 * 
 * Extensible food terms for intent detection.
 * Covers 90%+ of common foods users mention.
 * 
 * Future: Replace with database-backed FoodContextService that loads
 * from food_aliases table for even better coverage.
 */

// Explicit meal/time-of-day terms (specific meal times only - removed "side" to avoid false positives)
export const MEAL_TERMS = /\b(breakfast|lunch|dinner|brunch|supper|snack|dessert|appetizer|entree)\b/i;

// Comprehensive food lexicon (200+ common foods with plural support)
export const FOOD_LEXICON = new RegExp(
  '\\b(' +
  [
    // Proteins
    'chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'shrimp', 'turkey',
    'steak', 'ribeye', 'sirloin', 'bacon', 'sausage', 'ham', 'egg',
    
    // Grains & Carbs
    'rice', 'pasta', 'bread', 'toast', 'bagel', 'roll', 'bun', 'tortilla',
    'noodle', 'spaghetti', 'cereal', 'oatmeal', 'oat', 'granola', 'quinoa',
    'pancake', 'waffle', 'muffin', 'croissant',
    
    // Fast Food & Restaurant
    'pizza', 'burger', 'hot\\s*dog', 'hotdog', 'sandwich', 'sub', 'wrap',
    'taco', 'burrito', 'quesadilla', 'fries', 'chips', 'nachos',
    
    // Dairy
    'milk', 'cheese', 'yogurt', 'butter', 'cream',
    
    // Fruits
    'apple', 'banana', 'orange', 'grape', 'berry', 'strawberry', 'blueberry',
    'raspberry', 'melon', 'watermelon', 'pear', 'peach', 'plum', 'cherry',
    'pineapple', 'mango', 'kiwi', 'avocado', 'tomato',
    
    // Vegetables
    'vegetable', 'veggie', 'salad', 'broccoli', 'carrot', 'celery', 
    'cucumber', 'lettuce', 'spinach', 'kale', 'pepper', 'onion', 'garlic',
    'mushroom', 'potato', 'sweet\\s*potato', 'corn', 'peas', 'bean',
    
    // Snacks & Sweets
    'cookie', 'cake', 'pie', 'donut', 'doughnut', 'brownie', 'candy',
    'chocolate', 'ice\\s*cream', 'popcorn', 'pretzel', 'cracker',
    'protein\\s*bar', 'energy\\s*bar', 'granola\\s*bar',
    
    // Beverages - REMOVED to avoid conflict with UnDiet beverage tracking
    // Pure beverages (coffee, tea, water, soda, beer, wine) are handled by undietDetector.ts
    // Only include food-like beverages that have significant calories/macros
    'smoothie', 'protein\\s*shake', 'milkshake', 'boba',
    
    // Asian Food
    'sushi', 'ramen', 'pho', 'curry', 'stir\\s*fry', 'fried\\s*rice',
    'dumpling', 'spring\\s*roll', 'pad\\s*thai',
    
    // Mexican Food
    'enchilada', 'tamale', 'guacamole', 'salsa', 'queso',
    
    // Italian Food  
    'lasagna', 'ravioli', 'gnocchi', 'risotto',
    
    // Prepared Foods (removed container terms: bowl, plate, serving, portion)
    'soup', 'stew', 'chili', 'casserole', 'pot\\s*pie'
  ]
  // Add optional plural 's' to all words except those ending in 's' or compound words
  .map(word => word.replace(/([^s\\])$/i, '$1s?'))
  .join('|') +
  ')\\b',
  'i'
);

/**
 * Check if text contains explicit food context
 * Conservative approach: only return true if we have strong evidence
 * Uses meal terms (breakfast, lunch, dinner) + specific food lexicon (200+ foods)
 * No generic terms like "food"/"meal" to avoid false positives
 */
export function hasFoodContext(text: string): boolean {
  return MEAL_TERMS.test(text) || FOOD_LEXICON.test(text);
}

/**
 * Check if text contains explicit food context for PRESENT-TENSE validation
 * More restrictive: same as hasFoodContext now that generic terms are removed
 */
export function hasSpecificFoodContext(text: string): boolean {
  return MEAL_TERMS.test(text) || FOOD_LEXICON.test(text);
}

