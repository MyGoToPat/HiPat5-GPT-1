export interface WaterLog {
  id: string;
  user_id: string;
  amount_ml: number;
  logged_at: string;
  note?: string | null;
  created_at: string;
}

export interface BathroomLog {
  id: string;
  user_id: string;
  log_type: 'urination' | 'bowel_movement';
  logged_at: string;
  bm_color?: string | null;
  bm_consistency?: string | null;
  bm_health_score?: number | null;
  bm_analysis_notes?: string | null;
  note?: string | null;
  created_at: string;
}

export interface PhotoAnalysisLog {
  id: string;
  user_id: string;
  analysis_type: 'food_photo' | 'bowel_movement' | 'supplement_label';
  analyzed_at: string;
  food_items?: Record<string, any> | null;
  estimated_macros?: Record<string, any> | null;
  bm_health_indicators?: Record<string, any> | null;
  supplement_info?: Record<string, any> | null;
  photo_deleted: boolean;
  photo_deleted_at?: string | null;
  ai_model_used?: string | null;
  confidence_score?: number | null;
  created_at: string;
}

export interface UnDietStatus {
  isActive: boolean;
  startDate: string | null;
  currentDay: number;
  daysRemaining: number;
  isComplete: boolean;
}

export interface Day14Analysis {
  analysisDate: string;
  totalDays: number;
  
  nutrition: {
    avgDailyCalories: number;
    avgProtein: number;
    avgCarbs: number;
    avgFat: number;
    proteinStatus: 'too_low' | 'optimal' | 'too_high';
    carbStatus: 'too_low' | 'optimal' | 'too_high';
    fatStatus: 'too_low' | 'optimal' | 'too_high';
  };
  
  hydration: {
    avgDailyWaterMl: number;
    hydrationStatus: 'dehydrated' | 'adequate' | 'optimal' | 'excellent';
    daysTracked: number;
  };
  
  digestive: {
    avgBowelMovementsPerDay: number;
    digestiveHealthStatus: 'poor' | 'fair' | 'good' | 'excellent';
    daysTracked: number;
  };
  
  patterns: {
    mostFrequentFoods: Array<{ name: string; count: number }>;
    mealTimingPattern: string;
    consistencyScore: number;
  };
  
  recommendations: string[];
  personalizedFeedback: string;
}

