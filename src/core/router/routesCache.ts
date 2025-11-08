import { createClient } from "@supabase/supabase-js";

let cached: { id:string; name:string; examples:string; embedding:number[]; hi_threshold:number; mid_threshold:number }[] | null = null;

export async function loadRoutesOnce(supabase: any) {
  if (cached) return cached;

  const { data, error } = await supabase.from("intent_routes")
    .select("id,name,examples,embedding,hi_threshold,mid_threshold");

  if (error) throw error;

  cached = data || [];

  return cached!;
}

export function getCachedRoutes() {
  return cached || [];
}
