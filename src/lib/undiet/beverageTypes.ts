export type BeverageCategory = 
  | 'water'
  | 'sports_drink'
  | 'tea'
  | 'coffee'
  | 'juice'
  | 'soda'
  | 'milk'
  | 'alcohol_beer'
  | 'alcohol_wine'
  | 'alcohol_spirits'
  | 'other';

export interface BeverageType {
  category: BeverageCategory;
  hydrationCoefficient: number;
  displayName: string;
  keywords: string[];
  defaultServingMl: number;
}

export const BEVERAGE_TYPES: Record<BeverageCategory, BeverageType> = {
  water: {
    category: 'water',
    hydrationCoefficient: 1.0,
    displayName: 'Water',
    keywords: ['water', 'h2o', 'aqua', 'sparkling water', 'mineral water', 'spring water', 'tap water'],
    defaultServingMl: 250
  },
  sports_drink: {
    category: 'sports_drink',
    hydrationCoefficient: 1.0,
    displayName: 'Sports Drink',
    keywords: ['gatorade', 'powerade', 'propel', 'bodyarmor', 'prime', 'electrolyte', 'sports drink', 'pedialyte', 'nuun', 'liquid iv', 'drip drop'],
    defaultServingMl: 500
  },
  tea: {
    category: 'tea',
    hydrationCoefficient: 0.9,
    displayName: 'Tea',
    keywords: ['tea', 'green tea', 'black tea', 'herbal tea', 'iced tea', 'chai', 'matcha', 'oolong', 'earl grey', 'chamomile'],
    defaultServingMl: 240
  },
  coffee: {
    category: 'coffee',
    hydrationCoefficient: 0.85,
    displayName: 'Coffee',
    keywords: ['coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'cold brew', 'iced coffee', 'mocha', 'macchiato', 'starbucks', 'dunkin'],
    defaultServingMl: 240
  },
  juice: {
    category: 'juice',
    hydrationCoefficient: 0.85,
    displayName: 'Juice',
    keywords: ['juice', 'orange juice', 'apple juice', 'grape juice', 'cranberry', 'smoothie', 'lemonade', 'fruit punch'],
    defaultServingMl: 240
  },
  soda: {
    category: 'soda',
    hydrationCoefficient: 0.8,
    displayName: 'Soda/Pop',
    keywords: ['soda', 'pop', 'coke', 'coca-cola', 'pepsi', 'sprite', 'fanta', 'dr pepper', 'mountain dew', '7up', 'ginger ale', 'root beer', 'diet coke', 'coke zero', 'diet pepsi', 'la croix', 'seltzer'],
    defaultServingMl: 355
  },
  milk: {
    category: 'milk',
    hydrationCoefficient: 0.9,
    displayName: 'Milk',
    keywords: ['milk', 'chocolate milk', 'almond milk', 'oat milk', 'soy milk', 'coconut milk', 'whole milk', 'skim milk', '2% milk'],
    defaultServingMl: 240
  },
  alcohol_beer: {
    category: 'alcohol_beer',
    hydrationCoefficient: 0.6,
    displayName: 'Beer',
    keywords: ['beer', 'lager', 'ale', 'ipa', 'stout', 'pilsner', 'craft beer', 'light beer', 'bud light', 'budweiser', 'corona', 'heineken', 'michelob'],
    defaultServingMl: 355
  },
  alcohol_wine: {
    category: 'alcohol_wine',
    hydrationCoefficient: 0.5,
    displayName: 'Wine',
    keywords: ['wine', 'red wine', 'white wine', 'rose', 'rosé', 'champagne', 'prosecco', 'pinot', 'chardonnay', 'merlot', 'cabernet'],
    defaultServingMl: 150
  },
  alcohol_spirits: {
    category: 'alcohol_spirits',
    hydrationCoefficient: 0.3,
    displayName: 'Spirits/Liquor',
    keywords: ['vodka', 'whiskey', 'rum', 'tequila', 'gin', 'bourbon', 'scotch', 'brandy', 'cocktail', 'martini', 'margarita', 'shot', 'liquor', 'mixed drink'],
    defaultServingMl: 45
  },
  other: {
    category: 'other',
    hydrationCoefficient: 0.7,
    displayName: 'Other Beverage',
    keywords: [],
    defaultServingMl: 250
  }
};

export function detectBeverageType(beverageName: string): BeverageType {
  const lowerName = beverageName.toLowerCase();
  
  for (const [, bevType] of Object.entries(BEVERAGE_TYPES)) {
    for (const keyword of bevType.keywords) {
      if (lowerName.includes(keyword)) {
        return bevType;
      }
    }
  }
  
  return BEVERAGE_TYPES.other;
}

export function calculateEffectiveHydration(amountMl: number, beverageCategory: BeverageCategory): number {
  const bevType = BEVERAGE_TYPES[beverageCategory];
  return Math.round(amountMl * bevType.hydrationCoefficient);
}

export function getBeverageDisplayInfo(category: BeverageCategory): { icon: string; color: string } {
  const displayInfo: Record<BeverageCategory, { icon: string; color: string }> = {
    water: { icon: '💧', color: '#3b82f6' },
    sports_drink: { icon: '⚡', color: '#22c55e' },
    tea: { icon: '🍵', color: '#84cc16' },
    coffee: { icon: '☕', color: '#92400e' },
    juice: { icon: '🧃', color: '#f97316' },
    soda: { icon: '🥤', color: '#ef4444' },
    milk: { icon: '🥛', color: '#f5f5f4' },
    alcohol_beer: { icon: '🍺', color: '#fbbf24' },
    alcohol_wine: { icon: '🍷', color: '#be123c' },
    alcohol_spirits: { icon: '🍸', color: '#6366f1' },
    other: { icon: '🧊', color: '#6b7280' }
  };
  
  return displayInfo[category];
}

