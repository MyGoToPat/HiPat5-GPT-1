import type { MacroItem, MealTotals, TefBreakdown, TdeeResult } from "../shared/nutrition/types";

type VerifyView = {
  rows: Array<{ name:string; quantity:number|null; unit:string|null; calories:number; protein_g:number; carbs_g:number; fat_g:number; fiber_g:number; editable:boolean }>;
  meal_slot: 'breakfast'|'lunch'|'dinner'|'snack'|null;
  eaten_at: string|null;
};

export type LogResult = { ok: boolean; log_id: string | null; error: string | null };

export async function logMeal(
  userId: string,
  view: VerifyView,
  items: MacroItem[],
  totals: MealTotals,
  tef: TefBreakdown,
  tdee: TdeeResult
): Promise<LogResult> {
  // Use getSupabase() from lib to avoid process.env in browser
  const { getSupabase } = await import('../../../lib/supabase');
  const supabase = getSupabase();

  const eaten_at = view.eaten_at || new Date().toISOString();
  const meal_slot = view.meal_slot ?? null;

  // Try RPC (atomic) if available
  try {
    const { data, error } = await supabase.rpc("log_meal_atomic", {
      p_user_id: userId,
      p_eaten_at: eaten_at,
      p_meal_slot: meal_slot,
      p_totals: totals,
      p_tef_kcal: tef.kcal,
      p_items: items
    });
    if (!error && data?.log_id) return { ok: true, log_id: String(data.log_id), error: null };
  } catch (_) { /* fall through */ }

  // Fallback sequential with best-effort rollback
  let logId: string | null = null;
  try {
    const { data: head, error: e1 } = await supabase
      .from("nutrition_logs")
      .insert({
        user_id: userId,
        eaten_at,
        meal_slot,
        calories: totals.calories,
        protein_g: totals.protein_g,
        carbs_g: totals.carbs_g,
        fat_g: totals.fat_g,
        fiber_g: totals.fiber_g,
        tef_kcal: tef.kcal,
        source: "tmwya-v3"
      })
      .select("id")
      .single();

    if (e1) throw e1;
    logId = head.id;

    const { error: e2 } = await supabase
      .from("nutrition_log_items")
      .insert(items.map(i => ({
        nutrition_log_id: logId,
        food_name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        calories: i.calories,
        protein_g: i.protein_g,
        carbs_g: i.carbs_g,
        fat_g: i.fat_g,
        fiber_g: i.fiber_g,
        source: i.source,
        confidence: i.confidence
      })));
    if (e2) throw e2;

    // Try daily totals RPC, fallback skip (tiles can compute on read)
    try {
      await supabase.rpc("upsert_daily_totals", { p_user_id: userId, p_day_iso: eaten_at.slice(0,10) });
    } catch (_) {}

    return { ok: true, log_id: logId, error: null };
  } catch (err: any) {
    if (logId) {
      await supabase.from("nutrition_log_items").delete().eq("nutrition_log_id", logId);
      await supabase.from("nutrition_logs").delete().eq("id", logId);
    }
    return { ok: false, log_id: null, error: String(err?.message || err) };
  }
}

