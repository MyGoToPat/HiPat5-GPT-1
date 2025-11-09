export type Pref = { id: string; preference_text: string };

export type RankedPref = Pref & { score: number };

function cosine(a: number[], b: number[]) {
  let dot=0, na=0, nb=0;
  for (let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot/(Math.sqrt(na)*Math.sqrt(nb));
}

async function embedText(text: string): Promise<number[]> {
  try {
    const r = await fetch("/functions/v1/embed", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ text })
    });
    if (!r.ok) {
      console.warn('[preferences] Embed function failed:', r.status);
      return [];
    }
    const j = await r.json();
    return j.embedding || [];
  } catch (err) {
    console.error('[preferences] Embed exception:', err);
    return [];
  }
}

export async function rankTopPreferences(userId: string, query: string, supabase: any, k=3): Promise<RankedPref[]> {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preference_text')
      .eq('user_id', userId);

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

    const qVec = await embedText(query);
    if (!qVec.length) return []; // Embedding failed

    const prefVecs = await Promise.all(data.map(d => embedText(d.preference_text)));
    if (prefVecs.some(v => !v.length)) return []; // Some embeddings failed

    const ranked = data.map((p, i) => ({ id: '', preference_text: p.preference_text, score: cosine(qVec, prefVecs[i]) }));

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
