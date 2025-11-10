export type Pref = { id: string; preference_text: string };

export type RankedPref = Pref & { score: number };

function cosine(a: number[], b: number[]) {
  let dot=0, na=0, nb=0;
  for (let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot/(Math.sqrt(na)*Math.sqrt(nb));
}

import { getEmbeddings } from '@/core/router/embed';

export async function rankTopPreferences(userId: string, query: string, supabase: any, k=3): Promise<RankedPref[]> {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preference_text')
      .eq('user_id', userId)
      .limit(10);

    if (error) {
      console.error('[preferences] Query error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      // Return empty array on error instead of crashing
      return [];
    }

    if (!data?.length) return [];

    // Embed the query ONCE
    let qVec: number[] = [];
    try {
      const vectors = await getEmbeddings([query]);
      qVec = vectors[0] || [];
    } catch (embedError) {
      console.warn('[preferences] Failed to embed query, skipping ranking:', embedError);
      return [];
    }
    if (!qVec.length) return [];

    // Embed preferences separately
    const prefTexts = data.map(d => d.preference_text);
    let prefVecs: number[][] = [];
    try {
      prefVecs = prefTexts.length ? await getEmbeddings(prefTexts) : [];
    } catch (embedError) {
      console.warn('[preferences] Failed to embed preferences, skipping ranking:', embedError);
      return [];
    }

    if (!prefVecs.length || prefVecs.length !== prefTexts.length) return [];

    const ranked = data
      .map((p, i) => ({
        id: '',
        preference_text: p.preference_text,
        score: cosine(qVec, prefVecs[i])
      }))
      .filter(item => Number.isFinite(item.score));

    ranked.sort((a,b)=>b.score-a.score);

    return ranked.slice(0,k);
  } catch (err) {
    console.error('[preferences] Exception in rankTopPreferences:', err);
    return [];
  }
}

export function prefsToSystemLine(prefs: RankedPref[]): string {
  if (!prefs.length) return "";

  const list = prefs.map(p => p.preference_text).join("; ");

  return `User preferences to honor: [${list}]`;
}
