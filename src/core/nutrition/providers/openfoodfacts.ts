/**
 * OpenFoodFacts Internet Resolver
 * Fallback nutrition lookup using public OpenFoodFacts API
 * No API key required, free tier sufficient for our use case
 */

export interface OpenFoodFactsResult {
  name: string;
  brand?: string;
  serving_size_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g?: number;
  source_url: string;
  confidence: number;
}

export async function lookupOpenFoodFacts(
  foodName: string,
  brand?: string
): Promise<OpenFoodFactsResult | null> {
  try {
    const searchTerm = brand 
      ? `${brand} ${foodName}` 
      : foodName;
    
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(searchTerm)}&search_simple=1&action=process&json=1&page_size=5`;
    
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('[openfoodfacts] API returned', response.status);
      return null;
    }
    
    const data = await response.json();
    const products = data?.products || [];
    
    if (products.length === 0) {
      console.log('[openfoodfacts] No products found for:', searchTerm);
      return null;
    }
    
    // Take best match (first result)
    const product = products[0];
    const nutriments = product.nutriments || {};
    
    // Validate we have core nutrition data
    if (!nutriments.energy_value && !nutriments['energy-kcal_100g']) {
      console.warn('[openfoodfacts] Product missing calorie data');
      return null;
    }
    
    // Helper to get value (prefer serving, fallback to 100g)
    const getNutrient = (name: string): number => {
      return nutriments[`${name}_serving`] || nutriments[`${name}_100g`] || nutriments[name] || 0;
    };

    return {
      name: product.product_name || foodName,
      brand: product.brands || brand,
      serving_size_g: product.serving_quantity || nutriments.serving_size || 100,
      calories: nutriments['energy-kcal_serving'] || nutriments['energy-kcal_100g'] || 0,
      protein_g: getNutrient('proteins'),
      carbs_g: getNutrient('carbohydrates'),
      fat_g: getNutrient('fat'),
      fiber_g: getNutrient('fiber'),
      sugar_g: getNutrient('sugars'),
      source_url: product.url || `https://world.openfoodfacts.org/product/${product.code}`,
      confidence: products.length > 1 ? 0.7 : 0.85  // Lower if multiple matches
    };
  } catch (error) {
    console.error('[openfoodfacts] Exception:', error);
    return null;
  }
}

