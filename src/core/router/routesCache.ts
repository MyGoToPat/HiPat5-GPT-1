
let cached: { id:string; name:string; examples:string; embedding:number[]; hi_threshold:number; mid_threshold:number }[] | null = null;

export async function loadRoutesOnce(supabase: any) {
  if (cached) return cached;

  try {
    const { data, error } = await supabase.from("intent_routes")
      .select("id,name,examples,embedding,hi_threshold,mid_threshold");

    if (error) {
      console.error('[router] Failed to load intent_routes:', error);
      // Return empty array if table doesn't exist or query fails
      cached = [];
      return cached;
    }

    cached = data || [];
    console.info('[router] Loaded', cached.length, 'intent routes from DB');

    return cached!;
  } catch (err) {
    console.error('[router] Exception loading routes:', err);
    cached = [];
    return cached;
  }
}

export function getCachedRoutes() {
  return cached || [];
}
