/**
 * Gemini Provider
 * Fallback for branded items not in brand map
 */

import { getCachedGemini } from '../geminiCache';
import type { MacroProvider, MacroResult, NormalizedItem } from './types';

export const geminiProvider: MacroProvider = {
  id: 'gemini',
  priority: 2, // After brandMap, before generic

  supports(item: NormalizedItem): boolean {
    // Use Gemini for branded items or items without explicit weight
    return item.is_branded === true || !item.unit;
  },

  async fetch(item: NormalizedItem, userId?: string): Promise<MacroResult | null> {
    // Build canonical name for Gemini
    const canonicalName = [
      item.brand,
      item.name,
      item.serving_label,
      item.size_label
    ].filter(Boolean).join(' ');

    return await getCachedGemini({
      name: item.name,
      brand: item.brand,
      serving_label: item.serving_label,
      size_label: item.size_label,
      country: 'us' // Default to US, cache handles user prefs
    }, userId); // Pass userId for caching to user_custom_foods
  }
};

export async function lookup(normalized: any, userId?: string) {
  return await geminiProvider.fetch?.(normalized, userId);
}

