import { getSupabase } from '../supabase';
import type { UnDietStatus } from '../../types/undiet';
import { BeverageCategory, BEVERAGE_TYPES, calculateEffectiveHydration } from './beverageTypes';

export async function startUnDiet(userId: string): Promise<{ success: boolean; error?: string; alreadyActive?: boolean }> {
  try {
    const supabase = getSupabase();
    
    const { data: existing, error: fetchError } = await supabase
      .from('user_metrics')
      .select('undiet_start_date, undiet_day_14_completed')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (fetchError) throw fetchError;
    
    if (existing && existing.undiet_start_date && !existing.undiet_day_14_completed) {
      const startDate = new Date(existing.undiet_start_date);
      const now = new Date();
      const daysPassed = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentDay = Math.min(daysPassed + 1, 14);
      
      return { 
        success: false, 
        alreadyActive: true,
        error: `You're already on Day ${currentDay} of your UnDiet! Keep logging everything you eat and drink. ${14 - currentDay} days to go! 🎯` 
      };
    }
    
    if (!existing) {
      return { 
        success: false, 
        error: "Please complete your TDEE calculation first before starting the UnDiet program." 
      };
    }
    
    const { error: updateError } = await supabase
      .from('user_metrics')
      .update({
        undiet_start_date: new Date().toISOString(),
        undiet_day_14_completed: false
      })
      .eq('user_id', userId);
    
    if (updateError) throw updateError;
    
    return { success: true };
  } catch (error: any) {
    console.error('[startUnDiet] Error:', error);
    return { success: false, error: error.message };
  }
}

export async function getUnDietStatus(userId: string): Promise<UnDietStatus | null> {
  try {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('user_metrics')
      .select('undiet_start_date, undiet_day_14_completed')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) throw error;
    if (!data || !data.undiet_start_date) {
      return null;
    }
    
    const startDate = new Date(data.undiet_start_date);
    const now = new Date();
    const daysPassed = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentDay = Math.min(daysPassed + 1, 14);
    const daysRemaining = Math.max(14 - currentDay, 0);
    
    return {
      isActive: !data.undiet_day_14_completed,
      startDate: data.undiet_start_date,
      currentDay,
      daysRemaining,
      isComplete: data.undiet_day_14_completed || false
    };
  } catch (error: any) {
    console.error('[getUnDietStatus] Error:', error);
    return null;
  }
}

export async function logWaterIntake(
  userId: string,
  amountMl: number,
  note?: string,
  beverageCategory: BeverageCategory = 'water',
  beverageName?: string
): Promise<{ success: boolean; error?: string; effectiveHydration?: number }> {
  try {
    const supabase = getSupabase();
    
    const effectiveHydration = calculateEffectiveHydration(amountMl, beverageCategory);
    const bevType = BEVERAGE_TYPES[beverageCategory];
    
    const { error } = await supabase
      .from('water_logs')
      .insert({
        user_id: userId,
        amount_ml: amountMl,
        effective_hydration_ml: effectiveHydration,
        beverage_type: beverageCategory,
        beverage_name: beverageName || bevType.displayName,
        note,
        logged_at: new Date().toISOString()
      });
    
    if (error) throw error;
    
    console.log(`[logWaterIntake] Logged ${amountMl}ml of ${beverageCategory} (${effectiveHydration}ml effective hydration)`);
    
    return { success: true, effectiveHydration };
  } catch (error: any) {
    console.error('[logWaterIntake] Error:', error);
    return { success: false, error: error.message };
  }
}

export async function logBathroomVisit(
  userId: string,
  logType: 'urination' | 'bowel_movement',
  metadata?: {
    color?: string;
    consistency?: string;
    healthScore?: number;
    analysisNotes?: string;
    note?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();
    
    const { error } = await supabase
      .from('bathroom_logs')
      .insert({
        user_id: userId,
        log_type: logType,
        logged_at: new Date().toISOString(),
        bm_color: metadata?.color,
        bm_consistency: metadata?.consistency,
        bm_health_score: metadata?.healthScore,
        bm_analysis_notes: metadata?.analysisNotes,
        note: metadata?.note
      });
    
    if (error) throw error;
    
    return { success: true };
  } catch (error: any) {
    console.error('[logBathroomVisit] Error:', error);
    return { success: false, error: error.message };
  }
}

export async function getTodaysWaterIntake(userId: string): Promise<number> {
  try {
    const supabase = getSupabase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { data, error } = await supabase
      .from('water_logs')
      .select('amount_ml')
      .eq('user_id', userId)
      .gte('logged_at', today.toISOString());
    
    if (error) throw error;
    if (!data) return 0;
    
    return data.reduce((sum, log) => sum + (log.amount_ml || 0), 0);
  } catch (error: any) {
    console.error('[getTodaysWaterIntake] Error:', error);
    return 0;
  }
}

export async function shouldTriggerDay14Analysis(userId: string): Promise<boolean> {
  const status = await getUnDietStatus(userId);
  if (!status) return false;
  
  return status.currentDay >= 14 && !status.isComplete;
}

export async function completeDay14Analysis(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();
    
    const { error } = await supabase
      .from('user_metrics')
      .update({ undiet_day_14_completed: true })
      .eq('user_id', userId);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error: any) {
    console.error('[completeDay14Analysis] Error:', error);
    return { success: false, error: error.message };
  }
}

