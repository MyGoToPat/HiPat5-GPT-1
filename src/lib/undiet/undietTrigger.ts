import { getSupabase } from '../supabase';
import { getUnDietStatus } from './tracking';

export interface UnDietTriggerResult {
  shouldSuggest: boolean;
  message?: string;
  currentStatus?: {
    isActive: boolean;
    currentDay: number;
    daysRemaining: number;
  };
}

export async function checkUnDietTrigger(userId: string): Promise<UnDietTriggerResult> {
  try {
    const supabase = getSupabase();
    
    const { data: metrics, error } = await supabase
      .from('user_metrics')
      .select('tdee, undiet_start_date, undiet_day_14_completed')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) throw error;
    
    if (!metrics || !metrics.tdee || metrics.tdee === 0) {
      return { shouldSuggest: false };
    }
    
    if (metrics.undiet_start_date) {
      const status = await getUnDietStatus(userId);
      if (status) {
        return {
          shouldSuggest: false,
          currentStatus: {
            isActive: status.isActive,
            currentDay: status.currentDay,
            daysRemaining: status.daysRemaining
          }
        };
      }
    }
    
    const { data: foodLogs, error: foodError } = await supabase
      .from('foodlog')
      .select('id')
      .eq('user_id', userId)
      .limit(3);
    
    if (foodError) throw foodError;
    
    const hasLoggedFood = foodLogs && foodLogs.length > 0;
    
    if (!hasLoggedFood) {
      return {
        shouldSuggest: true,
        message: getUnDietSuggestionMessage('first_time')
      };
    }
    
    return { shouldSuggest: false };
    
  } catch (error: any) {
    console.error('[checkUnDietTrigger] Error:', error);
    return { shouldSuggest: false };
  }
}

function getUnDietSuggestionMessage(context: 'first_time' | 'reminder'): string {
  const messages = {
    first_time: `I see you've just completed your TDEE calculation! Before we start making any dietary changes, I'd like to suggest something my mentor Dwayne calls the "UnDiet."

The UnDiet is a 14-day observation period where you simply track everything you eat and drink - no changes, no restrictions. Just honest tracking. Most people struggling with weight have no idea how many calories they're actually consuming.

During these 14 days, I'll learn your actual habits:

• What foods you naturally prefer
• When you typically eat
• Your hydration patterns
• How your body responds

On Day 14, I'll give you personalized feedback based on YOUR actual patterns - not generic advice. This way, when we do make changes, they'll be tailored specifically to you.

Want to start your UnDiet today? Just keep telling me what you eat, when you drink water, and I'll track it all for you.`,
    
    reminder: `Hey! Just a friendly reminder about the UnDiet - a 14-day observation period where we track your natural eating habits before making any changes. This helps me give you truly personalized advice based on YOUR patterns, not generic recommendations.

Ready to start?`
  };
  
  return messages[context];
}

export function shouldShowUnDietProgress(status: UnDietTriggerResult['currentStatus']): boolean {
  if (!status) return false;
  return status.isActive && status.currentDay > 0;
}

export function getUnDietProgressMessage(day: number, daysRemaining: number): string {
  const encouragements = [
    `You're doing great! Day ${day} of your UnDiet.`,
    `Nice work! ${daysRemaining} days left in your observation period.`,
    `Keep it up! Day ${day}/14 - I'm learning so much about your patterns.`,
    `Excellent tracking! ${daysRemaining} more days until your personalized analysis.`
  ];
  
  if (day === 14) {
    return "🎉 You've completed your 14-day UnDiet! Let me analyze your patterns and give you personalized feedback.";
  }
  
  if (day >= 10) {
    return `Almost there! Day ${day}/14 - just ${daysRemaining} more days of tracking before I can give you detailed insights.`;
  }
  
  return encouragements[Math.floor(Math.random() * encouragements.length)];
}

