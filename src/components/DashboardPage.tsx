import React, { useState, useEffect } from 'react';
import { PatAvatar } from './PatAvatar';
import { MessageSquare, Mic, Check, X, ArrowLeft } from 'lucide-react';
import { FrequencySection } from './dashboard/FrequencySection';
import { RestSection } from './dashboard/RestSection';
import { EnergySection } from './dashboard/EnergySection';
import { EffortSection } from './dashboard/EffortSection';
import { DailySummary } from './dashboard/DailySummary';
import { TimePeriodSelector, TimePeriod } from './dashboard/TimePeriodSelector';
import { WeeklyDashboard } from './dashboard/WeeklyDashboard';
import { MonthlyDashboard } from './dashboard/MonthlyDashboard';
import { MealHistoryList } from './dashboard/MealHistoryList';
import { MetricAlert, CrossMetricInsight } from '../types/metrics';
import { PatMoodCalculator, UserMetrics } from '../utils/patMoodCalculator';
import { getSupabase, getDashboardMetrics, updateDailyActivitySummary, getUserDayBoundaries } from '../lib/supabase';
import type { FoodEntry } from '../types/food';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface UserMetricsData {
  tdee?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  bmr?: number;
}

interface WorkoutLogData {
  workout_date: string;
  duration_minutes: number;
  workout_type: string;
  volume_lbs?: number;
  avg_rpe?: number;
}

interface SleepLogData {
  sleep_date: string;
  duration_minutes: number;
  quality_score?: number;
  deep_sleep_minutes: number;
  rem_sleep_minutes: number;
  light_sleep_minutes: number;
}
export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(true);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('daily');
  const [userId, setUserId] = useState<string | null>(null);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [successData, setSuccessData] = useState<{ kcal: number; items: number } | null>(null);
  const [dashboardData, setDashboardData] = useState<{
    userMetrics: UserMetricsData | null;
    todaysFoodLogs: FoodEntry[];
    totalCalories: number;
    totalMacros: { protein: number; carbs: number; fat: number; fiber: number };
    workoutLogs: WorkoutLogData[];
    sleepLogs: SleepLogData[];
    weeklyStats?: {
      totalCalories: number;
      totalDeficit: number;
      projectedFatLoss: number;
    };
  } | null>(null);

  useEffect(() => {
    setTimePeriod('daily');
  }, [location.key]);

  // Check if meal was just logged (must be before early returns)
  useEffect(() => {
    if (location.state?.mealJustLogged) {
      setShowSuccessBanner(true);
      setSuccessData({
        kcal: location.state.mealCalories || 0,
        items: location.state.mealItems || 1
      });

      const timer = setTimeout(() => setShowSuccessBanner(false), 5000);

      // Clear state without causing re-render loop
      window.history.replaceState({}, document.title);

      return () => clearTimeout(timer);
    }
  }, [location.state]);
  
  const [alerts, setAlerts] = useState<MetricAlert[]>([
    // Alerts will be loaded from backend in future
  ]);

  // Cross-metric insights will be loaded from backend in future
  const insights: CrossMetricInsight[] = [
    // Cross-metric insights to be loaded from backend
  ];

  // Extracted load function to be reused
  const loadDashboardData = async () => {
    try {
      const supabase = getSupabase();
      const user = await supabase.auth.getUser();
      if (!user.data.user) return;

      // Store user ID for meal history component
      setUserId(user.data.user.id);

      // CRITICAL: Clear any cached dashboard data
      sessionStorage.removeItem('dashboard_cache');

      // Force cache bust by adding timestamp to prevent stale Supabase responses
      const cacheBuster = `_cb=${Date.now()}`;
      console.log('[dashboard-load] Cache buster:', cacheBuster);

      // Log current date for debugging
      console.log('[dashboard-load] Loading data for:', new Date().toLocaleString());

      // Update daily activity summary first (idempotent)
      await updateDailyActivitySummary(user.data.user.id);

      // Get timezone-aware day boundaries (12:01 AM - 11:59:59 PM user local time)
      let dayBoundaries;
      try {
        dayBoundaries = await getUserDayBoundaries(user.data.user.id);
        console.log('[dashboard-load] Day boundaries:', dayBoundaries);

        // CRITICAL: Validate boundaries are valid and not empty objects
        if (!dayBoundaries || !dayBoundaries.day_start || !dayBoundaries.day_end) {
          console.error('[dashboard-load] INVALID BOUNDARIES:', dayBoundaries);
          throw new Error('Invalid day boundaries returned');
        }
        
        // Additional validation: ensure they're actual dates
        const startDate = new Date(dayBoundaries.day_start);
        const endDate = new Date(dayBoundaries.day_end);
        
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          console.error('[dashboard-load] MALFORMED DATES:', { start: dayBoundaries.day_start, end: dayBoundaries.day_end });
          throw new Error('Malformed day boundaries');
        }
        
        if (endDate <= startDate) {
          console.error('[dashboard-load] END BEFORE START:', { start: dayBoundaries.day_start, end: dayBoundaries.day_end });
          throw new Error('day_end must be after day_start');
        }
        
        console.log('[dashboard-load] ✅ Valid boundaries confirmed:', {
          start: startDate.toLocaleString(),
          end: endDate.toLocaleString(),
          durationHours: (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
        });
      } catch (error) {
        console.error('[dashboard-load] Failed to get day boundaries:', error);
        toast.error('⚠️ Using fallback date boundaries (EST). Please refresh if data looks wrong.', { duration: 5000 });
        
        // EMERGENCY FALLBACK: Calculate boundaries client-side in EST
        const now = new Date();
        
        // Get today's date in EST (UTC-5)
        const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const year = estDate.getFullYear();
        const month = String(estDate.getMonth() + 1).padStart(2, '0');
        const day = String(estDate.getDate()).padStart(2, '0');
        const todayEST = `${year}-${month}-${day}`;
        
        // Create boundaries: 12:01 AM - 11:59:59.999 PM EST
        const startEST = new Date(`${todayEST}T00:01:00-05:00`);
        const endEST = new Date(`${todayEST}T23:59:59.999-05:00`);
        
        dayBoundaries = {
          day_start: startEST.toISOString(),
          day_end: endEST.toISOString()
        };
        
        console.warn('[dashboard-load] 🔶 Using CLIENT-SIDE EST fallback boundaries:', {
          todayEST,
          start: startEST.toISOString(),
          end: endEST.toISOString(),
          startLocal: startEST.toLocaleString(),
          endLocal: endEST.toLocaleString()
        });
      }

        // Prepare date ranges for other queries
        const workoutStartDate = new Date();
        workoutStartDate.setDate(workoutStartDate.getDate() - 48); // Last 49 days for heatmap
        const sleepStartDate = new Date();
        sleepStartDate.setDate(sleepStartDate.getDate() - 13); // Last 14 days for sleep

        // Calculate week boundaries (last 7 days up to today)
        const weekStart = new Date(dayBoundaries.day_start);
        weekStart.setDate(weekStart.getDate() - 6); // 7 days total including today
        
        // Fetch all data in parallel
        const [
          metricsResult,
          mealLogsResult,
          weeklyMealLogsResult,
          workoutLogsResult,
          sleepLogsResult
        ] = await Promise.all([
          // User metrics
          supabase
            .from('user_metrics')
            .select('*')
            .eq('user_id', user.data.user.id)
            .maybeSingle(),

          // Today's meals using timezone-aware boundaries + items for accurate macros
          // CRITICAL: Query meal_logs FIRST to ensure date filter works correctly
          supabase
            .from('meal_logs')
            .select(`
              id,
              ts,
              user_id,
              meal_slot,
              source,
              totals,
              micros_totals,
              meal_items!inner(*)
            `)
            .eq('user_id', user.data.user.id)
            .gte('ts', dayBoundaries.day_start)
            .lte('ts', dayBoundaries.day_end)
            .order('ts', { ascending: false }),

          // Weekly meals for summary calculations
          supabase
            .from('meal_items')
            .select(`
              energy_kcal,
              meal_logs!meal_items_meal_log_id_fkey(id, user_id, ts)
            `)
            .eq('meal_logs.user_id', user.data.user.id)
            .gte('meal_logs.ts', weekStart.toISOString())
            .lte('meal_logs.ts', dayBoundaries.day_end),

          // Workout logs for dashboard
          supabase
            .from('workout_logs')
            .select('workout_date, duration_minutes, workout_type, volume_lbs, avg_rpe')
            .eq('user_id', user.data.user.id)
            .gte('workout_date', workoutStartDate.toISOString().slice(0, 10))
            .order('workout_date', { ascending: true }),

          // Sleep logs for dashboard
          supabase
            .from('sleep_logs')
            .select('sleep_date, duration_minutes, quality_score, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes')
            .eq('user_id', user.data.user.id)
            .gte('sleep_date', sleepStartDate.toISOString().slice(0, 10))
            .order('sleep_date', { ascending: true })
        ]);

        // Calculate totals from meal_items (accurate, canonical source)
        // IMPORTANT: Round all values to integers (no decimals)
        // NEW STRUCTURE: mealLogsResult.data contains meal_logs with nested meal_items
        const mealLogs = mealLogsResult.data || [];
        
        // Flatten nested meal_items from all meal_logs
        const mealItems = mealLogs.flatMap(log => 
          (log.meal_items || []).map((item: any) => ({
            ...item,
            meal_log_ts: log.ts,
            meal_slot: log.meal_slot
          }))
        );
        
        const totalCalories = Math.round(mealItems.reduce((sum, item) => sum + (item.energy_kcal || 0), 0));
        const totalMacros = {
          protein: Math.round(mealItems.reduce((sum, item) => sum + (item.protein_g || 0), 0)),
          carbs: Math.round(mealItems.reduce((sum, item) => sum + (item.carbs_g || 0), 0)),
          fat: Math.round(mealItems.reduce((sum, item) => sum + (item.fat_g || 0), 0)),
          fiber: Math.round(mealItems.reduce((sum, item) => sum + (item.fiber_g || 0), 0))
        };

        console.log('[dashboard-load] Meal items loaded:', {
          mealLogsCount: mealLogs.length,
          itemsCount: mealItems.length,
          totalCalories,
          totalMacros,
          dayBoundaries,
          sampleLogs: mealLogs.slice(0, 3).map(log => ({
            ts: log.ts,
            itemCount: log.meal_items?.length || 0,
            within_boundaries: log.ts >= dayBoundaries.day_start && log.ts <= dayBoundaries.day_end
          })),
          sampleItems: mealItems.slice(0, 3).map(i => ({
            name: i.name,
            kcal: Math.round(i.energy_kcal || 0),
            meal_ts: i.meal_log_ts
          }))
        });

        // Calculate weekly totals
        const weeklyMealItems = weeklyMealLogsResult.data || [];
        const weeklyTotalCalories = Math.round(
          weeklyMealItems.reduce((sum: number, item: any) => sum + (item.energy_kcal || 0), 0)
        );
        
        // Calculate weekly deficit (assuming same target every day)
        const targetCalories = metricsResult.data ? 
          Math.round(
            (metricsResult.data.protein_g * 4) + 
            (metricsResult.data.carbs_g * 4) + 
            (metricsResult.data.fat_g * 9)
          ) : 0;
        const weeklyTargetCalories = targetCalories * 7;
        const weeklyDeficit = weeklyTargetCalories - weeklyTotalCalories;
        
        // Calculate projected fat loss (1 lb = 3500 cal deficit)
        const projectedFatLoss = weeklyDeficit > 0 ? Math.round((weeklyDeficit / 3500) * 10) / 10 : 0;

        // For meal history - convert mealLogs to FoodEntry format
        // Note: mealLogs now contains meal_logs with nested meal_items from the query above
        const groupedMeals: FoodEntry[] = mealLogs.map(log => ({
          id: log.id,
          timestamp: log.ts,
          meal_slot: log.meal_slot || 'snack',
          items: (log.meal_items || []).map((item: any) => ({
            name: item.name,
            quantity: item.quantity || 1,
            unit: item.unit || 'serving',
            calories: item.energy_kcal || 0,
            protein: item.protein_g || 0,
            carbs: item.carbs_g || 0,
            fat: item.fat_g || 0
          }))
        }));

        setDashboardData({
          userMetrics: metricsResult.data,
          todaysFoodLogs: groupedMeals,
          totalCalories,
          totalMacros,
          workoutLogs: workoutLogsResult.data || [],
          sleepLogs: sleepLogsResult.data || [],
          weeklyStats: {
            totalCalories: weeklyTotalCalories,
            totalDeficit: weeklyDeficit,
            projectedFatLoss
          }
        });

      console.log('Dashboard data loaded:', { workouts: workoutLogsResult.data?.length, sleep: sleepLogsResult.data?.length });

    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Load dashboard data on mount
  useEffect(() => {
    loadDashboardData();
  }, []);

  // Midnight refresh detection: Force reload dashboard at 12:01 AM user local time
  useEffect(() => {
    const checkMidnight = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();

      // If it's 12:01 AM (0:01), force refresh
      if (hours === 0 && minutes === 1) {
        console.log('[midnight-refresh] Detected 12:01 AM, forcing dashboard reload');
        loadDashboardData();
      }
    };

    // Check every minute
    const interval = setInterval(checkMidnight, 60000);

    return () => clearInterval(interval);
  }, []);

  // Mock user metrics for mood calculation
  const userMetrics: UserMetrics = {
    workoutStreak: 0,
    sleepQuality: 0,
    proteinTarget: 0,
    lastWorkout: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago (no recent workouts)
    missedWorkouts: 0,
    recentPRs: 0,
    consistencyScore: 0
  };

  // Calculate Pat's current mood
  const patMood = PatMoodCalculator.calculateMood(userMetrics, alerts);
  const moodMessage = PatMoodCalculator.getMoodMessage(patMood);

  const handleDismissAlert = (alertId: string) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === alertId ? { ...alert, dismissed: true } : alert
    ));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (timePeriod === 'weekly') {
    return <WeeklyDashboard onBackToDashboard={() => setTimePeriod('daily')} />;
  }

  if (timePeriod === 'monthly') {
    return <MonthlyDashboard onBackToDashboard={() => setTimePeriod('daily')} />;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 relative pt-[44px]">
      {/* Success Banner */}
      <AnimatePresence>
        {showSuccessBanner && successData && (
          <motion.div
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -100 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4"
          >
            <div className="bg-gradient-to-r from-green-600 to-green-500 rounded-2xl shadow-2xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                <Check size={24} className="text-white" strokeWidth={3} />
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold">Meal Successfully Logged</p>
                <p className="text-white/90 text-sm">{successData.kcal} kcal • {successData.items} item{successData.items > 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setShowSuccessBanner(false)} className="text-white/80 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative">
        <div className="flex justify-center pt-4 pb-2">
          <TimePeriodSelector selected={timePeriod} onChange={setTimePeriod} />
        </div>
        {/* Animated Pat Avatar in corner */}
        <div className="absolute top-4 right-4 z-10">
          <button 
            onClick={() => navigate('/chat')}
            className="hover:scale-110 transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950 rounded-full group relative min-h-[44px] min-w-[44px]"
          >
            <PatAvatar size={48} mood={patMood} interactionType="chat" />
            
            
            {/* Mood tooltip */}
            <div className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20 max-w-xs sm:max-w-none">
              {moodMessage}
              <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
            </div>
          </button>
        </div>
        
        {/* Main Content */}
        <div className="py-4 pb-20">
          <div className="px-4 sm:px-6">
            {/* Daily Summary */}
            <DailySummary
              totalCalories={dashboardData?.totalCalories || 0}
              targetCalories={
                // Use TARGET FROM MACROS (user's macro goal), NOT Net after TEF
                (() => {
                  const protein = dashboardData?.userMetrics?.protein_g || 0;
                  const carbs = dashboardData?.userMetrics?.carbs_g || 0;
                  const fat = dashboardData?.userMetrics?.fat_g || 0;
                  return Math.round((protein * 4) + (carbs * 4) + (fat * 9));
                })()
              }
              tdee={dashboardData?.userMetrics?.tdee || 0}
              proteinTarget={dashboardData?.userMetrics?.protein_g || 150}
              currentProtein={dashboardData?.totalMacros?.protein || 0}
              currentFiber={dashboardData?.totalMacros?.fiber || 0}
              fiberTarget={20}
              weeklyStats={dashboardData?.weeklyStats}
            />
          </div>
          
          <div className="px-4 sm:px-6">
            {/* Minimalist Dashboard Grid - Mobile-First Responsive Layout */}
            <div className="grid gap-4 mb-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <FrequencySection workouts={dashboardData?.workoutLogs || []} />
              <RestSection sleepLogs={dashboardData?.sleepLogs || []} />
              <EnergySection
                energyData={dashboardData && dashboardData.totalMacros ? {
                  date: new Date().toISOString().split('T')[0],
                  calories: dashboardData.totalCalories || 0,
                  protein_g: dashboardData.totalMacros?.protein || 0,
                  carb_g: dashboardData.totalMacros?.carbs || 0,
                  fat_g: dashboardData.totalMacros?.fat || 0,
                  fiber_g: dashboardData.totalMacros?.fiber || 0,
                  salt_g: 2.3, // Mock for now
                  water_l: 3.2, // Mock for now
                  first_meal_time: '08:30', // Mock for now
                  last_meal_time: '20:15', // Mock for now
                  tdee: dashboardData.userMetrics?.tdee || 2200,
                  bmr: dashboardData.userMetrics?.bmr || 1800
                } : undefined}
                targetProtein={dashboardData?.userMetrics?.protein_g}
                targetCarbs={dashboardData?.userMetrics?.carbs_g}
                targetFat={dashboardData?.userMetrics?.fat_g}
                targetCalories={
                  // Use TARGET FROM MACROS (user's macro goal)
                  (() => {
                    const protein = dashboardData?.userMetrics?.protein_g || 0;
                    const carbs = dashboardData?.userMetrics?.carbs_g || 0;
                    const fat = dashboardData?.userMetrics?.fat_g || 0;
                    return Math.round((protein * 4) + (carbs * 4) + (fat * 9));
                  })()
                }
              />
              <EffortSection workouts={dashboardData?.workoutLogs || []} />
            </div>

            {/* Meal History */}
            {userId && (
              <div className="mt-6">
                <MealHistoryList
                  userId={userId}
                  onMealDeleted={loadDashboardData}
                />
              </div>
            )}

            {/* Essential Actions - Restored CTAs */}
            <div className="mt-6 bg-gray-900/50 backdrop-blur-sm rounded-2xl p-4 border border-gray-800">
              <div className="flex items-center justify-center gap-3 flex-wrap">
                {/* Return to Last Chat button - conditional */}
                {(() => {
                  const returnChatId = location.state?.returnToChatId || sessionStorage.getItem('returnToChatId');
                  if (returnChatId) {
                    // Clear sessionStorage after reading
                    sessionStorage.removeItem('returnToChatId');
                    return (
                      <button
                        onClick={() => navigate(`/chat?t=${encodeURIComponent(returnChatId)}`)}
                        className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-xl text-white font-medium transition-all duration-200 min-h-[44px] flex-1 max-w-[220px] justify-center"
                      >
                        <ArrowLeft size={20} />
                        <span className="text-sm">Return to Chat</span>
                      </button>
                    );
                  }
                  return null;
                })()}
                
                <button
                  onClick={() => navigate('/chat')}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-medium transition-all duration-200 min-h-[44px] flex-1 max-w-[200px] justify-center"
                >
                  <MessageSquare size={20} />
                  <span className="text-sm">Chat with Pat</span>
                </button>
                <button
                  onClick={() => navigate('/voice')}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-xl text-white font-medium transition-all duration-200 min-h-[44px] flex-1 max-w-[200px] justify-center"
                >
                  <Mic size={20} />
                  <span className="text-sm">Talk with Pat</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      
      {/* Fixed Footer - 40px height */}
      <div className="fixed bottom-0 left-0 right-0 h-[40px] bg-gray-900 border-t border-gray-800 flex items-center justify-center z-30">
        <p className="text-xs text-gray-500">© 2024 Pat AI Assistant</p>
      </div>
      </div>
    </div>
  );
};