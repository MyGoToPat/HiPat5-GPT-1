export type Pref = { id: string; preference_text: string };

export type RankedPref = Pref & { score: number };

function cosine(a: number[], b: number[]) {
  let dot=0, na=0, nb=0;
  for (let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot/(Math.sqrt(na)*Math.sqrt(nb));
}

async function embedText(text: string): Promise<number[]> {
  const r = await fetch("/functions/v1/embed", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ text })
  });
  const j = await r.json();
  return j.embedding;
}

export async function rankTopPreferences(userId: string, query: string, supabase: any, k=3): Promise<RankedPref[]> {
  const { data } = await supabase
    .from("user_preferences")
    .select("id,preference_text")
    .eq("user_id", userId);

  if (!data?.length) return [];

  const qVec = await embedText(query);

  const prefVecs = await Promise.all(data.map(d => embedText(d.preference_text)));

  const ranked = data.map((p, i) => ({ ...p, score: cosine(qVec, prefVecs[i]) }));

  ranked.sort((a,b)=>b.score-a.score);

  return ranked.slice(0,k);
}

export function prefsToSystemLine(prefs: RankedPref[]): string {
  if (!prefs.length) return "";

  const list = prefs.map(p => p.preference_text).join("; ");

  return `User preferences to honor: [${list}]`;
}
