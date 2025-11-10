import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PatAvatar } from './PatAvatar';
import { VoiceWaveform } from './VoiceWaveform';
import { TDEEPromptBubble } from './TDEEPromptBubble';
import ThinkingAvatar from './common/ThinkingAvatar';
import { Plus, Mic, Folder, Camera, Image, ArrowUp, Check } from 'lucide-react';
import { FoodVerificationScreen } from './FoodVerificationScreen';
import { MealSuccessTransition } from './MealSuccessTransition';
import { fetchFoodMacros } from '../lib/food';
import type { AnalysisResult, NormalizedMealData } from '../types/food';
import { PatMoodCalculator, UserMetrics } from '../utils/patMoodCalculator';
import { MetricAlert } from '../types/metrics';
import { FoodEntry } from '../types/food';
import { FoodLogDrawer } from './FoodLogDrawer';
import { ConversationAgentManager } from '../utils/conversationAgents';
import { AgentSession } from '../types/agents';
import { ChatManager } from '../utils/chatManager';
import { ChatHistory, ChatMessage, ChatState } from '../types/chat';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { callChat } from '../lib/chat';
import { callChatStreaming } from '../lib/streamingChat';
import { classifyFoodMessage, type ClassificationResult } from '../lib/personality/foodClassifier';
import { logMealViaRpc as saveMealAction } from '../lib/meals/saveMeal';
import type { SaveMealInput, SaveMealResult } from '../lib/meals/saveMeal';
import { inferMealSlot } from '../lib/meals/inferMealSlot';
import { trackFirstChatMessage } from '../lib/analytics';
import { updateDailyActivitySummary, checkAndAwardAchievements, getUserDayBoundaries, getSupabase } from '../lib/supabase';
import {
  getThread,
  upsertThread,
  makeTitleFrom,
  newThreadId,
  type ChatThread
} from '../lib/history';
import {
  getOrCreateTodaySession,
  addChatMessage,
  getChatMessages,
  createChatSession
} from '../lib/chatHistory';

import { spendCredits, PRICING } from '../lib/credits';
import toast from 'react-hot-toast';
import MealVerifyCard from './tmwya/MealVerifyCard';
import { useRole } from '../hooks/useRole';
import { isPrivileged } from '../utils/rbac';
import { AnimatePresence } from 'framer-motion';

export const ChatPat: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Get current user role for chat access gating
  const { role: currentUserRole, loading: roleLoading } = useRole();
  
  // Thread management
  const [threadId, setThreadId] = useState<string>(() => newThreadId());
  const [isSending, setIsSending] = useState(false);
  
  // Load initial chat state from localStorage
  const [chatState, setChatState] = useState<ChatState>({
    currentMessages: ChatManager.getInitialMessages(),
    chatHistories: [],
    activeChatId: null
  });
  const [messages, setMessages] = useState<ChatMessage[]>(chatState.currentMessages);
  const [isLoadingChat, setIsLoadingChat] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Guards against duplicate hydration and sending
  const hydratedOnceRef = useRef(false);     // ensure DB hydration runs once
  const hydratingRef = useRef(false);        // gate re-entrant loads
  const sendingRef = useRef(false);          // prevent double-send in dev
  const sessionIdRef = useRef<string | null>(null); // keep sessionId ref for async updates

  // Helper to deduplicate messages by ID
  function dedupeById<T extends { id?: string }>(arr: T[]): T[] {
    const seen = new Set<string>();
    return arr.filter((m) => {
      const key = m.id ?? JSON.stringify(m); // fallback if id missing
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Sync sessionId to ref for async operations
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Keep sessionIdRef in sync with URL (?t=) and reset hydration per selection
  useEffect(() => {
    const id = searchParams.get('t');
    if (id) {
      sessionIdRef.current = id;
      setSessionId(id);
    } else {
      sessionIdRef.current = null;
      setSessionId(null);
    }
    // reset hydration when switching threads
    hydratedOnceRef.current = false;
  }, [searchParams]);

  // Dashboard data for MealVerifyCard live calculations
  const [dashboardData, setDashboardData] = useState<{
    targetCalories: number;
    totalCalories: number;
  } | null>(null);

  // Load live dashboard data (target calories and consumed today)
  const loadLiveDashboard = async () => {
    if (!userId) return;
    try {
      const supabase = getSupabase();
      
      // Get user metrics for target calculation
      const { data: metrics } = await supabase
        .from('user_metrics')
        .select('protein_g, carbs_g, fat_g')
        .eq('user_id', userId)
        .maybeSingle();

      // Calculate target calories: (P×4) + (C×4) + (F×9)
      const targetCalories = metrics
        ? Math.round((metrics.protein_g * 4) + (metrics.carbs_g * 4) + (metrics.fat_g * 9))
        : 2000;

      // Get today's consumed calories using timezone-aware boundaries
      const dayBoundaries = await getUserDayBoundaries(userId);
      
      const { data: items } = await supabase
        .from('meal_items')
        .select('energy_kcal, meal_log:meal_logs!inner(ts, user_id)')
        .eq('meal_log.user_id', userId)
        .gte('meal_log.ts', dayBoundaries.day_start)
        .lte('meal_log.ts', dayBoundaries.day_end);

      const totalCalories = (items || []).reduce(
        (sum, item) => sum + Number(item.energy_kcal || 0),
        0
      );

      setDashboardData({ targetCalories, totalCalories });
      console.log('[ChatPat] Live dashboard data loaded:', { targetCalories, totalCalories });
    } catch (error) {
      console.error('[ChatPat] Failed to load dashboard data:', error);
    }
  };

  // Load dashboard data on mount and when userId changes
  useEffect(() => {
    if (userId) {
      loadLiveDashboard();
    }
  }, [userId]);
  const [inputText, setInputText] = useState('');
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoggingActivity, setIsLoggingActivity] = useState(false);
  const [activeAgentSession, setActiveAgentSession] = useState<AgentSession | null>(null);
  const [silentMode, setSilentMode] = useState(false);
  const [statusText, setStatusText] = useState<string>('');
  const [showTDEEBubble, setShowTDEEBubble] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Swarm 2.1: Ephemeral cache for "log" follow-up with TTL
  const [lastQuestionItems, setLastQuestionItems] = useState<any[] | null>(null);
  const lastSetRef = useRef<number>(0);
  const TTL_MS = 10 * 60 * 1000; // 10 minutes

  // Helper to get cached items if still valid
  const getCachedItems = () =>
    lastQuestionItems && Date.now() - lastSetRef.current < TTL_MS
      ? lastQuestionItems
      : null;

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking, isSending, statusText]);

  // Inline confirmation banner for food logging
  const [inlineConfirmation, setInlineConfirmation] = useState<{
    show: boolean;
    message?: string;
  }>({ show: false });

  // Food verification screen state
  const [showFoodVerificationScreen, setShowFoodVerificationScreen] = useState(false);
  const [currentAnalysisResult, setCurrentAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzingFood, setIsAnalyzingFood] = useState(false);

  // Extract food phrases from meal text
  const extractFoodPhrase = (text: string): string[] => {
    // Clean the input
    const cleaned = text.toLowerCase().trim();
    
    // Extract food phrase after common meal indicators
    let foodPhrase = cleaned;
    const mealIndicators = ['i ate', 'i had', 'ate', 'had', 'for breakfast', 'for lunch', 'for dinner'];
    
    for (const indicator of mealIndicators) {
      if (cleaned.includes(indicator)) {
        const parts = cleaned.split(indicator);
        if (parts.length > 1) {
          foodPhrase = parts[1].trim();
          break;
        }
      }
    }
    
    // Split on common separators for multiple items
    const separators = [' with ', ' and ', ', ', ' & '];
    let items = [foodPhrase];
    
    for (const sep of separators) {
      const newItems: string[] = [];
      for (const item of items) {
        if (item.includes(sep)) {
          newItems.push(...item.split(sep).map(s => s.trim()));
        } else {
          newItems.push(item);
        }
      }
      items = newItems;
    }
    
    // Filter out empty items and common non-food words
    return items
      .filter(item => item.length > 0)
      .filter(item => !['a', 'an', 'the', 'some'].includes(item.trim()));
  };

  // Load chat state on mount
  useEffect(() => {
    // Handle URL params for thread loading
    const newParam = searchParams.get('new');
    const threadParam = searchParams.get('t');

    if (newParam === '1') {
      // Local UI reset only; create DB session on first send to avoid empty sessions
      const newId = newThreadId();
      setThreadId(newId);
      setMessages(ChatManager.getInitialMessages());
      setActiveChatId(null);
      setSessionId(null);
      sessionIdRef.current = null;
      setIsLoadingChat(false);
      return;
    }

    if (threadParam) {
      // GUARD: Only hydrate once per session ID
      if (hydratedOnceRef.current || hydratingRef.current) {
        console.log('[ChatPat] Skipping duplicate hydration for session:', threadParam);
        return;
      }
      
      // Reset hydration guard when loading existing session
      hydratedOnceRef.current = false;

      hydratingRef.current = true;
      
      // Load existing session from database (not localStorage)
      (async () => {
        try {
          setIsLoadingChat(true);

          const dbMsgs = await getChatMessages(threadParam);
          
          // Normalize content whether it's string or JSON
          const norm = (c: any) =>
            typeof c === 'string' ? c : (c?.text ?? c?.content ?? JSON.stringify(c));

          const converted: ChatMessage[] = dbMsgs.map(m => ({
            id: m.id ?? `${m.session_id}-${m.created_at}`, // stable id fallback
            text: norm(m.content),
            timestamp: new Date(m.created_at),
            isUser: m.role === 'user',
          }));

          // DE-DUPE before setting (idempotent merge)
          setMessages(prev => dedupeById([...prev, ...converted]));
          setSessionId(threadParam);
          setActiveChatId(threadParam);
          setThreadId(threadParam);
          
          // Set userId if we have it
          const supabase = getSupabase();
          const { data: { user } } = await supabase.auth.getUser();
          if (user) setUserId(user.id);
          
        } catch (e) {
          console.error('[ChatPat] Failed to load session:', e);
          // Only fallback if we truly have nothing:
          if (messages.length === 0) {
            setMessages(ChatManager.getInitialMessages());
          }
        } finally {
          hydratedOnceRef.current = true;
          hydratingRef.current = false;
          setIsLoadingChat(false);
        }
      })();
      
      // IMPORTANT: Skip auto-creating new session when loading specific session
      return;
    }

    // Default: load chat state with session management
    const loadInitialChatState = async () => {
      try {
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          // Store userId in state for chat message persistence
          setUserId(user.id);

          // Initialize or load today's chat session
          const session = await getOrCreateTodaySession(user.id);
          setSessionId(session.id);

          // Load messages from session
          const sessionMessages = await getChatMessages(session.id);
          if (sessionMessages.length > 0) {
            const mappedMessages = sessionMessages.map(msg => {
              const normContent = typeof msg.content === 'string' ? msg.content : '';
              return {
                id: msg.id,
                text: normContent,
                timestamp: new Date(msg.created_at),
                isUser: msg.role === 'user',
              };
            });
            // DE-DUPE before setting (idempotent merge)
            setMessages(prev => dedupeById([...prev, ...mappedMessages]));
          } else {
            setMessages(ChatManager.getInitialMessages());
          }

          // Check TDEE completion status
          const { getUserContextFlags } = await import('../lib/personality/contextChecker');
          const contextFlags = await getUserContextFlags(user.id);
          setShowTDEEBubble(!contextFlags.hasTDEE);

          // Load or create active session (legacy)
          const legacySession = await ChatManager.ensureActiveSession(user.id);
          setActiveChatId(legacySession.id);
          setThreadId(legacySession.id);

          // Load session messages (legacy)
          const chatStateData = await ChatManager.loadChatState(user.id);
          setChatState(chatStateData);
        } else {
          // Not logged in, use default
          setMessages(ChatManager.getInitialMessages());
        }
      } catch (error) {
        console.error('Error loading chat state:', error);
      } finally {
        setIsLoadingChat(false);
      }
    };

    loadInitialChatState();
  }, [searchParams]);

  // Speech recognition hook for dictation
  const speechRecognition = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    onResult: (transcript, isFinal) => {
      setInputText(transcript);
      if (isFinal && transcript.trim()) {
        // Auto-submit after a brief pause
        setTimeout(() => {
          if (isDictating && transcript.trim()) {
            handleSendMessage();
            stopDictation();
          }
        }, 1500);
      }
    },
    onError: (error) => {
      console.error('Dictation error:', error);
      setIsDictating(false);
    }
  });

  // Use ref to track current dictation state for speech recognition callbacks
  const isDictatingRef = useRef(isDictating);

  // Keep ref in sync with state
  useEffect(() => {
    isDictatingRef.current = isDictating;
  }, [isDictating]);

  // Helper function to infer meal slot based on current time
  const inferMealSlot = (): 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unknown' => {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 11) return 'breakfast';
    if (hour >= 11 && hour < 16) return 'lunch';
    if (hour >= 16 && hour < 22) return 'dinner';
    return 'snack';
  };


  // Helper function to detect FOOD LOGGING (not questions about food)
  const isMealText = (input: string): boolean => {
    const lowerInput = input.toLowerCase();

    // CRITICAL: Only trigger food logging for STATEMENTS about eating, NOT QUESTIONS
    const foodLoggingTriggers = [
      'i ate', 'i had', 'just ate', 'just had',
      'ate a', 'ate an', 'had a', 'had an',
      'log meal', 'log food', 'track meal', 'track food'
    ];

    // Exclude questions - these should go to Pat as normal chat
    const questionPhrases = [
      'tell me', 'what are', 'how many', 'macros for', 'calories in',
      'what is', 'can you tell', 'give me', 'show me'
    ];

    const hasLoggingTrigger = foodLoggingTriggers.some(trigger => lowerInput.includes(trigger));
    const hasQuestionPhrase = questionPhrases.some(phrase => lowerInput.includes(phrase));

    // Only log food if it's a logging statement AND NOT a question
    const shouldLogFood = hasLoggingTrigger && !hasQuestionPhrase;

    console.log('[ChatPat] isMealText check:', {
      input: lowerInput.substring(0, 50),
      hasLoggingTrigger,
      hasQuestionPhrase,
      shouldLogFood
    });

    return shouldLogFood;
  };

  // Success transition state
  const [showSuccessTransition, setShowSuccessTransition] = useState(false);
  const [successMealData, setSuccessMealData] = useState<{ kcal: number; items: number } | null>(null);

  // Track when Pat is expecting a food response (after asking "What did you eat?")
  const [expectingFoodResponse, setExpectingFoodResponse] = useState(false);

  // TMWYA Verification Page state
  const [showMealVerification, setShowMealVerification] = useState(false);
  const [pendingMeal, setPendingMeal] = useState<{
    items: Array<{
      description: string;
      brand?: string;
      qty: number;
      unit: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      fiber_g?: number;
      source?: string;
    }>;
    inferredTimestamp?: Date;
    totals: {
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      fiber_g?: number;
    };
  } | null>(null);

  // TMWYA verification handlers
  const handleMealVerificationLog = async (editedMeal?: typeof pendingMeal) => {
    const mealToLog = editedMeal || pendingMeal;
    if (!mealToLog) return;

    try {
      console.log('[tmwya] log → persisting meal');
      setIsLoggingActivity(true);

      // Call the meal logging function (reuse existing logic)
      const mealData = {
        items: mealToLog.items.map(item => ({
          name: item.description,
          quantity: item.qty,
          unit: item.unit,
          calories: item.calories,
          protein_g: item.protein_g,
          carbs_g: item.carbs_g,
          fat_g: item.fat_g,
          fiber_g: item.fiber_g || 0,
        })),
        totals: mealToLog.totals,
        meal_slot: 'lunch', // Default, user can change in verification
        eaten_at: mealToLog.inferredTimestamp || new Date(),
      };

      // Log the meal using existing logic
      const result = await handleMealLogging(mealData);

      // Clear pending meal
      setPendingMeal(null);
      setShowMealVerification(false);

      // Show success message only after successful persistence
      if (result?.success) {
        const successMessage: ChatMessage = {
          id: crypto.randomUUID(),
          text: "Action completed. Your meal has been logged successfully!",
          isUser: false,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, successMessage]);
        console.log('[tmwya] log → persisted', { meal_id: result.id });
      }
    } catch (error) {
      console.error('[tmwya] log failed:', error);
      // Show error message
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        text: "Sorry, there was an error logging your meal. Please try again.",
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoggingActivity(false);
    }
  };

  const handleMealVerificationCancel = () => {
    console.log('[tmwya] cancel → cleared pendingMeal');
    setPendingMeal(null);
    setShowMealVerification(false);

    // Add a message indicating cancellation
    const cancelMessage: ChatMessage = {
      id: crypto.randomUUID(),
      text: "Meal logging cancelled. Let me know if you'd like to try again!",
      isUser: false,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, cancelMessage]);
  };

  const handleMealVerificationEdit = (itemIndex: number) => {
    console.log('[tmwya] edit → item', itemIndex);
    // For now, just show a message that editing is not yet implemented
    // In a full implementation, this would open an item editor
    const editMessage: ChatMessage = {
      id: crypto.randomUUID(),
      text: "Meal item editing is coming soon. For now, please describe your meal again with the corrections.",
      isUser: false,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, editMessage]);
  };

  // Food verification screen handlers
  const handleConfirmVerification = async (normalizedMeal: any) => {
    try {
      setIsLoggingActivity(true);

      // The FoodVerificationScreen returns {mealLog, mealItems}
      // Extract the data regardless of structure
      const mealData = normalizedMeal.mealLog || normalizedMeal.meal || normalizedMeal;
      const items = normalizedMeal.mealItems || normalizedMeal.items || [];

      // Convert to SaveMealInput format
      const saveInput: SaveMealInput = {
        userId: userId!,
        messageId: undefined,
        items: items.map((item: any) => ({
          name: item.name || '',
          quantity: Number(item.qty || item.quantity || 1),
          unit: item.unit || 'serving',
          energy_kcal: Number(item.macros?.kcal || item.energy_kcal || 0),
          protein_g: Number(item.macros?.protein_g || item.protein_g || 0),
          fat_g: Number(item.macros?.fat_g || item.fat_g || 0),
          carbs_g: Number(item.macros?.carbs_g || item.carbs_g || 0),
          fiber_g: Number(item.macros?.fiber_g || item.micros?.fiber_g || item.fiber_g || 0),
          brand: item.brand,
          description: undefined
        })),
        mealSlot: mealData.meal_slot || null,
        timestamp: mealData.ts || mealData.eaten_at || new Date().toISOString(),
        note: mealData.note,
        clientConfidence: mealData.client_confidence,
        source: mealData.source || 'text'
      };

      const result = await saveMealAction(saveInput);

      if (result.ok) {
        const totals = mealData.totals || { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

        // Close verification screen
        setShowFoodVerificationScreen(false);
        setCurrentAnalysisResult(null);

        // Show success transition
        setSuccessMealData({
          kcal: Math.round(totals.kcal || 0),
          items: items.length
        });
        setShowSuccessTransition(true);

        // Haptic feedback on mobile
        if ('vibrate' in navigator) {
          navigator.vibrate(50);
        }

        // Auto-redirect to dashboard after 2 seconds
        setTimeout(() => {
          setShowSuccessTransition(false);
          setSuccessMealData(null);
          navigate('/dashboard', {
            state: {
              mealJustLogged: true,
              mealCalories: totals.kcal || 0,
              mealItems: items.length
            }
          });
        }, 2000);

      } else {
        toast.error(result.error || 'Failed to save meal');
        setIsLoggingActivity(false);
      }
    } catch (error) {
      console.error('Error saving meal:', error);
      toast.error('Failed to save meal');
      setIsLoggingActivity(false);
    }
  };

  const handleCancelVerification = () => {
    setShowFoodVerificationScreen(false);
    setCurrentAnalysisResult(null);
  };

  const handleEditManually = () => {
    setShowFoodVerificationScreen(false);
    setCurrentAnalysisResult(null);
    // Could add manual food entry logic here
  };

  // Mock user metrics and alerts for mood calculation
  const userMetrics: UserMetrics = {
    workoutStreak: 3,
    sleepQuality: 75,
    proteinTarget: 90,
    lastWorkout: new Date(Date.now() - 0.5 * 24 * 60 * 60 * 1000), // 12 hours ago
    missedWorkouts: 1,
    recentPRs: 0,
    consistencyScore: 72
  };

  const mockAlerts: MetricAlert[] = [
    {
      id: '1',
      type: 'consistency_nudge',
      message: 'Keep up the good work!',
      severity: 'info',
      timestamp: new Date(),
      dismissed: false
    }
  ];

  // Calculate Pat's mood based on conversation state and metrics
  const getPatMood = () => {
    return PatMoodCalculator.calculateMood(userMetrics, mockAlerts);
  };

  // Get intelligent conversation starters - only show working features
  const workingAgentIds = ['meal-tracker', 'visual-meal-tracker'];
  const starterChips = ConversationAgentManager.getAgents()
    .filter(agent => workingAgentIds.includes(agent.id))
    .map(agent => agent.title);
  
  // Detect new users (less than 3 messages)
  const isNewUser = messages.length <= 2;

  const plusMenuOptions = [
    { id: 'take', label: 'Take a picture', icon: Camera },
    { id: 'photo', label: 'Photo', icon: Image },
    { id: 'log-food', label: 'Log Food', icon: Folder },
    { id: 'file', label: 'File', icon: Folder },
  ];

  const handleSendMessage = async () => {
    // GUARD: Prevent double send
    if (sendingRef.current) {
      console.log('[ChatPat] Skipping duplicate send');
      return;
    }
    
    sendingRef.current = true;
    
    try {
      if (inputText.trim()) {
        const lowerInput = inputText.toLowerCase().trim();

      // SHORTCUT: If verification screen is active and user types "log" or "save", confirm it
      if (showFoodVerificationScreen && currentAnalysisResult && (lowerInput === 'log' || lowerInput === 'save')) {
        setInputText('');
        // Trigger the same confirmation flow
        // The verification screen will call handleConfirmVerification with the data
        // We need to get the normalized meal data from FoodVerificationScreen
        // For now, just show a message - the user should click the Log button
        toast.success('Click the "Log" button to confirm');
        return;
      }

      // Check for "log" command variations
      // STRATEGY: Let LLM handle it via tools first, this is just a safety fallback
      // for when message.meta.macros exists (legacy/backup path)
      const logPattern = /^(log|save|add)(?:\s+(?:it|that|this))?(?:\s+(?:the\s+)?(.+))?$/i;
      const logMatch = lowerInput.match(logPattern);

      if (logMatch) {
        console.log('[ChatPat] Log command detected:', lowerInput);

        // Check if we have macro data in a recent message (fallback path)
        const lastPatMessage = [...messages].reverse().find(m =>
          !m.isUser &&
          m.meta?.macros?.items &&
          !m.meta?.consumed
        );

        if (lastPatMessage) {
          console.log('[ChatPat] Using client-side fallback - meta.macros found');
          const macroPayload = lastPatMessage.meta.macros;

          // Mark payload as consumed to prevent double-logging
          lastPatMessage.meta.consumed = true;

          // Check if subset logging (e.g., "log the prime rib and eggs")
          const subset = logMatch[2];

          if (subset) {
            // Parse subset request - handle "X and Y", "X, Y", etc.
            const requestedItems = subset
              .toLowerCase()
              .split(/\s+(?:and|,)\s+|\s*,\s*/)
              .map(s => s.replace(/^the\s+/, '').trim())
              .filter(Boolean);

            // Match requested items to canonical names (fuzzy match)
            const matchedItems = macroPayload.items.filter((item: any) => {
              const itemNameLower = item.name.toLowerCase();
              return requestedItems.some(requested =>
                itemNameLower.includes(requested) || requested.includes(itemNameLower)
              );
            });

            if (matchedItems.length > 0) {
              const foodText = matchedItems.map((item: any) => item.name).join(', ');
              // Legacy handler removed - let unified handler process via intent
              setInputText(`I ate ${foodText}`);
              return;
            } else {
              toast.error(`Could not find "${subset}" in the recent macro discussion.`);
              return;
            }
          } else {
            // Log all items
            const foodItems = macroPayload.items.map((item: any) => item.name);
            const foodText = foodItems.join(', ');
            // Legacy handler removed - let unified handler process via intent
            setInputText(`I ate ${foodText}`);
            return;
          }
        }

        // No meta.macros found - let it fall through to LLM with tools
        // The LLM will extract from conversation history and call log_meal tool
        console.log('[ChatPat] No meta.macros - passing to LLM for tool-based logging');
      }

      // Check if Pat is expecting a food response
      if (expectingFoodResponse) {
        console.log('[ChatPat] Pat was expecting food, treating input as meal');
        setExpectingFoodResponse(false);

        // Treat the response as if user said "I ate [food]"
        // Legacy handler removed - let unified handler process via intent
        const mealText = inputText.startsWith('I ate') || inputText.startsWith('i ate') ? inputText : `I ate ${inputText}`;
        setInputText(mealText);
        return;
      }

      // Legacy meal path disabled - unified handler processes meal_logging intent
      // if (isMealText(inputText)) {
      //   handleMealTextInput(inputText);
      //   return;
      // }

      setIsSending(true);
      setIsThinking(true);
      setStatusText('Thinking...');
      
      // Check if input triggers a specific agent
      
      const newMessage: ChatMessage = {
        id: Date.now().toString(),
        text: inputText,
        timestamp: new Date(),
        isUser: true
      };

      // Add thinking indicator immediately below user message
      const thinkingMessage: ChatMessage = {
        id: `thinking-${Date.now()}`,
        text: '✨ Thinking...',
        timestamp: new Date(),
        isUser: false
      };

      setMessages(prev => [...prev, newMessage, thinkingMessage]);
      setInputText('');
      setIsTyping(false);
      
      // Handle agent-specific responses
      setTimeout(async () => {
        setIsThinking(false);
        setIsSpeaking(true);
        setStatusText('Responding...');
        
        // Get AI response
        const getAIResponse = async () => {
          // Ensure session exists before making AI call - create fresh if URL is new=1
          let currentSessionId = sessionIdRef.current;
            if (!currentSessionId && userId) {
              try {
                const supa = getSupabase();
                const { data: { user } } = await supa.auth.getUser();
                const isNew = searchParams.get('new') === '1';
                if (user && isNew) {
                  const newSession = await createChatSession(user.id);
                  setSessionId(newSession.id);
                  sessionIdRef.current = newSession.id;
                  currentSessionId = newSession.id;
                  console.log('[ChatPat] New session created on first send:', newSession.id);
                } else {
                  const { ensureChatSession } = await import('../core/chat/sessions');
                  const newSessionId = await ensureChatSession(userId);
                  setSessionId(newSessionId);
                  sessionIdRef.current = newSessionId;
                  currentSessionId = newSessionId;
                  console.log('[ChatPat] Emergency session created:', newSessionId);
                }
              } catch (sessionError) {
                console.error('[ChatPat] Failed to create session, blocking send:', sessionError);
                toast.error('Unable to start chat session. Please refresh and try again.');
                return;
              }
            }

            // Save user message to database NOW that we have a session
            const saveUserMessage = async () => {
              try {
                // Lazy-fetch userId if missing
                let uid = userId;
                if (!uid) {
                  const { getSupabase } = await import('../lib/supabase');
                  const supa = getSupabase();
                  const { data } = await supa.auth.getUser();
                  uid = data?.user?.id ?? null;
                }

                if (!uid) {
                  console.error('[chat-save] No userId after fallback; aborting save to preserve integrity');
                  return;
                }

                // Use ref to avoid race condition with async session creation
                const currentSessionId = sessionIdRef.current;
                const sId = currentSessionId ?? sessionId;
                
                // Save to new chat_messages table
                if (sId) {
                  await addChatMessage(sId, 'user', newMessage.text);
                }

                // Legacy persistence - FIXED: pass sessionId not threadId, use object syntax
                if (sId) {
                  await ChatManager.saveMessage({
                    userId: uid,
                    sessionId: sId,
                    text: newMessage.text,
                    sender: 'user'
                  });
                } else {
                  console.error('[chat-save] No sessionId available, cannot save to legacy system');
                }
              } catch (error) {
                console.error('Failed to save user message:', error);
              }
            };
            await saveUserMessage();

            // Prepare conversation history for chat API
            const conversationHistory = [...messages, newMessage].map(msg => ({
              role: msg.isUser ? 'user' : 'assistant',
              content: msg.text
            }));
            
            // Check user context for Pat's awareness (TDEE, first-time user, etc.)
            let contextMessage = '';
            try {
              const user = await getSupabase().auth.getUser();
              if (user.data.user) {
                const { getUserContextFlags, buildContextMessage, updateUserChatContext } = await import('../lib/personality/contextChecker');
                const contextFlags = await getUserContextFlags(user.data.user.id);
                contextMessage = buildContextMessage(contextFlags);

                // Update chat count in background (non-blocking)
                updateUserChatContext(user.data.user.id).catch(err =>
                  console.warn('Failed to update chat context:', err)
                );
              }
            } catch (ctxError) {
              console.warn('Context check failed, continuing without context:', ctxError);
            }

            // Check feature flag for Swarm 2.2
            const user = await getSupabase().auth.getUser();
            if (!user.data.user) {
              throw new Error('User not authenticated');
            }

            const { getFeatureFlags } = await import('../lib/featureFlags');
            const flags = await getFeatureFlags(user.data.user.id);

            // Use new unified message handler
            console.log('[ChatPat] Using P3 unified handler');

            let assistantPersist: { content: string; metadata?: Record<string, unknown> } | null = null;

            try {
              let handleUserMessageModule: typeof import('../core/chat/handleUserMessage');
              try {
                handleUserMessageModule = await import('../core/chat/handleUserMessage');
              } catch (importError) {
                console.error('[chat] dynamic import failed:', importError);
                throw new Error('chat_handler_import_failed');
              }

              const { handleUserMessage } = handleUserMessageModule;
              const { loadUserContext } = await import('../core/personality/patSystem');

              // Load full user context for personality injection
              const userContext = await loadUserContext(user.data.user.id);
              console.log('[ChatPat] User context loaded:', userContext);

              // Load personality prompts from DB if enabled
              if (import.meta.env.VITE_NEW_PERSONALITY === 'true') {
                const { loadPersonality } = await import('../core/personality/loadPersonality');
                await loadPersonality();
              }

              const result = await handleUserMessage(newMessage.text, {
                userId: user.data.user.id,
                userContext,
                mode: 'text',
              });

              // Extract macro data from tool calls if present
              let macroMetadata = null;
              if (result.toolCalls && Array.isArray(result.toolCalls)) {
                const getMacrosCalls = result.toolCalls.filter((tc: any) => tc.name === 'get_macros');
                if (getMacrosCalls.length > 0 && result.rawData?.items) {
                  macroMetadata = { macros: result.rawData.items, source: 'get_macros_tool' };
                }
              }

              // Extract citation data from Gemini responses
              let citationMetadata = null;
              if (result.rawData?.gemini === true) {
                citationMetadata = {
                  cite: result.rawData.cite,
                  citeTitle: result.rawData.citeTitle,
                  webVerified: true
                };
              }

              // Extract AMA nutrition estimate data
              let nutritionMetadata = null;
              if (result.rawData?.ama_nutrition_estimate === true) {
                nutritionMetadata = {
                  ama_nutrition_estimate: true,
                  items: result.rawData.items,
                  totals: result.rawData.totals
                };
              }

              if (result.roleData?.type === 'tmwya.verify') {
                const p = result.roleData;
                console.log('[ChatPat] TMWYA verify detected, creating message with roleData:', p);

                const verifyMessage: ChatMessage = {
                  id: crypto.randomUUID(),
                  text: '',
                  isUser: false,
                  timestamp: new Date(),
                  roleData: {
                    type: 'tmwya.verify',
                    view: p.view,
                    items: p.items,
                    totals: p.totals,
                    tef: p.tef,
                    tdee: p.tdee
                  }
                };

                assistantPersist = { content: '', metadata: { roleData: verifyMessage.roleData } };

                setMessages(prev => prev.filter(m => m.id && !m.id.startsWith('thinking-')).concat(verifyMessage));
                setIsSpeaking(false);
                setIsThinking(false);
                setIsSending(false);
                setStatusText('');
                return;
              }

              const combinedMeta = macroMetadata || citationMetadata || nutritionMetadata
                ? { ...macroMetadata, ...citationMetadata, ...nutritionMetadata }
                : undefined;

              const patMessage: ChatMessage = {
                id: crypto.randomUUID(),
                text: result.response,
                isUser: false,
                timestamp: new Date(),
                meta: combinedMeta
              };

              assistantPersist = {
                content: patMessage.text,
                metadata: combinedMeta ?? undefined
              };

              setMessages(prev => prev.filter(m => m.id && !m.id.startsWith('thinking-')).concat(patMessage));
              setIsSpeaking(false);
              setIsThinking(false);
              setIsSending(false);
              setStatusText('');

              const historyEntry = {
                ...chatState,
                messages: [...messages, newMessage, patMessage],
                updatedAt: new Date().toISOString()
              };
              await upsertThread(historyEntry);
            } catch (error) {
              console.error('[ChatPat] Error in message handling:', error);

              setIsSpeaking(false);
              setIsThinking(false);
              setIsSending(false);
              setStatusText('');

              const errorMessage: ChatMessage = {
                id: crypto.randomUUID(),
                text: 'Sorry, I hit a temporary load error. Try again.',
                isUser: false,
                timestamp: new Date()
              };

              const errorCode =
                error instanceof Error && error.message === 'chat_handler_import_failed'
                  ? 'chat_handler_import_failed'
                  : 'chat_handler_unknown_error';

              assistantPersist = {
                content: errorMessage.text,
                metadata: { error: { code: errorCode } }
              };

              setMessages(prev => prev.filter(m => !m.id.startsWith('thinking-')).concat(errorMessage));
            } finally {
              const sessionToUse = sessionIdRef.current ?? sessionId;
              // Always save assistant message, even on failure
              if (!assistantPersist) {
                assistantPersist = {
                  content: 'Sorry, I hit a temporary load error. Try again.',
                  metadata: { error: { code: 'chat_handler_unknown_error' } }
                };
              }
              if (sessionToUse) {
                try {
                  const saved = await addChatMessage(
                    sessionToUse,
                    'assistant',
                    assistantPersist.content,
                    assistantPersist.metadata
                  );
                  console.info('[chat-save] assistant saved', saved.id);
                } catch (saveError) {
                  console.error('[chat-save] Failed to persist assistant message:', saveError);
                }
              }
            }
          };

        getAIResponse();
      }, 1000);
      }
    } catch (err) {
      console.error('[ChatPat] send failed:', err);
      // graceful assistant fallback so the thread is never empty on error
      const sessionToUse = sessionIdRef.current ?? sessionId;
      if (sessionToUse) {
        try {
          await addChatMessage(
            sessionToUse,
            'assistant',
            'Sorry, I hit a temporary load error. Try again.',
            { error: { code: 'send_failed' } }
          );
        } catch {
          // ignore secondary save errors
        }
      }

      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          text: 'Sorry, I hit a temporary load error. Try again.',
          isUser: false,
          timestamp: new Date()
        }
      ]);
    } finally {
      setIsSending(false);
      sendingRef.current = false;
    }
  };

  // Legacy meal logging handlers removed - unified handler processes meal_logging intent

  const handleChipClick = async (chipText: string) => {
    setIsThinking(true);

    // Check if input triggers a specific agent
    const triggeredAgent = ConversationAgentManager.findAgentByTrigger(chipText);

    // Special handling for "Tell me what you ate" - activate TMWYA mode
    if (triggeredAgent?.title === "Tell me what you ate") {
      try {
        const user = await getSupabase().auth.getUser();
        if (!user.data.user) {
          throw new Error('User not authenticated');
        }

        // Get user's first name
        const { getUserProfile } = await import('../lib/supabase');
        const userProfile = await getUserProfile(user.data.user.id);
        const firstName = userProfile?.name?.split(' ')[0] || 'there';

        // Pat asks what they ate (no user message bubble)
        setIsThinking(false);
        setIsSpeaking(true);

        const responseText = `${firstName}, what did you eat?`;
        const patMessage: ChatMessage = {
          id: crypto.randomUUID(),
          text: responseText,
          isUser: false,
          timestamp: new Date()
        };

        setMessages(prev => [...prev, patMessage]);
        setIsSpeaking(false);

        // Set flag so next user input is treated as food
        setExpectingFoodResponse(true);
        console.log('[ChatPat] Set expectingFoodResponse=true');

        return;
      } catch (error) {
        console.error('[ChatPat] Error enabling TMWYA mode:', error);
        toast.error('Error starting food logging');
        setIsThinking(false);
        return;
      }
    }

    // Handle camera-required agents
    if (triggeredAgent?.requiresCamera) {
      const session = ConversationAgentManager.startAgentSession(triggeredAgent.id);
      setActiveAgentSession(session);

      setIsThinking(false);

      const cameraMessage: ChatMessage = {
        id: crypto.randomUUID(),
        text: ConversationAgentManager.generateCameraResponse(triggeredAgent.id),
        timestamp: new Date(),
        isUser: false
      };
      setMessages(prev => [...prev, cameraMessage]);

      // Auto-open camera
      setTimeout(() => {
        const autoStartMode = triggeredAgent.id.includes('meal') || triggeredAgent.id.includes('eating') ? 'takePhoto' : 'videoStream';
        navigate('/camera', { state: { autoStartMode } });
      }, 1500);

      return;
    }

    // For other chips, use the standard message flow
    let userMessage = chipText;
    if (triggeredAgent) {
      const session = ConversationAgentManager.startAgentSession(triggeredAgent.id);
      setActiveAgentSession(session);

      // Customize user message based on agent title
      const title = triggeredAgent.title;
      if (title.startsWith("Show me")) {
        const restOfTitle = title.substring(8).toLowerCase();
        userMessage = `How do I show you ${restOfTitle}?`;
      } else if (title === "Need a meal idea?") {
        userMessage = "Can you suggest a meal idea?";
      } else if (title === "Find nearby restaurants") {
        userMessage = "Can you find nearby restaurants?";
      }
    }

    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      text: userMessage,
      timestamp: new Date(),
      isUser: true
    };

    setMessages(prev => [...prev, newMessage]);

    // Use standard response handling
    setTimeout(() => {
      setIsThinking(false);
      setIsSpeaking(true);

      let responseText = "";
      if (triggeredAgent) {
        if (userMessage.includes("tell you")) {
          responseText = "You can tell me by typing here, pressing the mic button to speak, or clicking on my face at the bottom to start a voice conversation!";
        } else if (userMessage.includes("show you")) {
          responseText = "You can show me by using the camera! Click the camera button or I'll guide you to the camera view.";
        } else if (userMessage.includes("meal idea")) {
          responseText = "I can suggest meals based on your preferences and goals! Just tell me what you're in the mood for or any dietary restrictions.";
        } else if (userMessage.includes("find nearby restaurants")) {
          responseText = "I can help you find restaurants that match your nutritional goals! I'll need your location and any preferences you have.";
        } else {
          responseText = "I'm here to help! You can interact with me through voice, text, or camera depending on what you need.";
        }
      } else {
        const responses = [
          "I understand. Let me help you with that.",
          "Great! I've logged that information for you.",
          "I can see your progress is improving. Keep it up!",
          "Let me check your schedule and get back to you."
        ];
        responseText = responses[Math.floor(Math.random() * responses.length)];
      }
      
      const patResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: responseText,
        timestamp: new Date(),
        isUser: false
      };
      
      setMessages(prev => [...prev, patResponse]);
      
      // Simulate speaking duration
      setTimeout(() => {
        setIsSpeaking(false);
      }, responseText.length * 50);
    }, 1000);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputText(value);
    setIsTyping(value.trim().length > 0);
  };

  const startDictation = () => {
    setIsDictating(true);
    setInputText('');
    setIsTyping(false);
    
    if (speechRecognition.isSupported) {
      speechRecognition.start();
    } else {
      alert('Speech recognition not supported in this browser');
      setIsDictating(false);
    }
  };

  const stopDictation = () => {
    setIsDictating(false);
    speechRecognition.stop();
  };

  const submitDictation = () => {
    if (inputText.trim()) {
      handleSendMessage();
    }
    stopDictation();
  };

  const cancelDictation = () => {
    setInputText('');
    speechRecognition.reset();
    stopDictation();
  };

  const handleNewChat = () => {
    const saveAndStartNewChat = async () => {
      try {
        // Reset thread ID for new chat
        const newId = newThreadId();
        setThreadId(newId);
        
        // Save current chat to history if it has meaningful content
        if (messages.length > 1) {
          const savedChat = await ChatManager.saveNewChat(messages);
          if (savedChat) {
            setChatState(prev => ({
              ...prev,
              chatHistories: [savedChat, ...prev.chatHistories]
            }));
          }
        }
        
        // Reset to new chat
        const initialMessages = ChatManager.getInitialMessages();
        setMessages(initialMessages);
        setActiveChatId(null);
        
      } catch (error) {
        console.error('Error starting new chat:', error);
        // Still reset UI even if save failed
        const newId = newThreadId();
        setThreadId(newId);
        const initialMessages = ChatManager.getInitialMessages();
        setMessages(initialMessages);
        setActiveChatId(null);
      }
    };

    saveAndStartNewChat();
    
    // Reset other states
    setActiveAgentSession(null);
    setSilentMode(false);
    setInputText('');
    setIsTyping(false);
  };

  const handleLoadChat = (chatHistory: ChatHistory) => {
    const loadSelectedChat = async () => {
      try {
        // Update thread ID
        setThreadId(chatHistory.id);
        
        setIsLoadingChat(true);
        
        // Save current chat first if it has content
        if (messages.length > 1) {
          const savedChat = await ChatManager.saveNewChat(messages);
          if (savedChat) {
            setChatState(prev => ({
              ...prev,
              chatHistories: [savedChat, ...prev.chatHistories.filter(h => h.id !== savedChat.id)]
            }));
          }
        }
        
        // Load messages for selected chat
        const chatMessages = await ChatManager.loadChatMessages(chatHistory.id);
        
        // Update state
        setMessages(chatMessages);
        setActiveChatId(chatHistory.id);
        
      } catch (error) {
        console.error('Error loading chat:', error);
        // Fallback to showing the chat history's cached messages if available
        if (chatHistory.messages && chatHistory.messages.length > 0) {
          setMessages(chatHistory.messages);
          setActiveChatId(chatHistory.id);
        }
      } finally {
        setIsLoadingChat(false);
      }
    };

    loadSelectedChat();
    
    // Reset other states
    setActiveAgentSession(null);
    setSilentMode(false);
    setInputText('');
    setIsTyping(false);
  };

  const handleSaveFoodEntry = (entry: FoodEntry) => {
    const saveFoodEntry = async () => {
      try {
        setIsLoggingActivity(true);
        const user = await getSupabase().auth.getUser();
        if (!user.data.user) {
          console.error('No authenticated user');
          return;
        }

        // Step 1: Insert food log
        const { error } = await getSupabase()
          .from('food_logs')
          .insert({
            user_id: user.data.user.id,
            food_name: entry.foodName,
            grams: entry.grams,
            source_db: entry.sourceDb,
            macros: entry.macros
          });

        if (error) {
          console.error('Error saving food entry:', error);
          toast.error('Failed to save food entry');
          return;
        }

        // Step 2: Update daily activity summary
        await getSupabase().rpc('update_daily_activity_summary', {
          p_user_id: user.data.user.id,
          p_activity_date: new Date().toISOString().slice(0, 10)
        });

        // Step 3: Check and award achievements
        const { data: newAchievements } = await getSupabase().rpc('check_and_award_achievements', {
          user_id: user.data.user.id
        });

        if (newAchievements && newAchievements > 0) {
          toast.success(`🏆 ${newAchievements} new achievement${newAchievements > 1 ? 's' : ''} earned!`);
        }

        // Track first food log
        const { data: existingLogs } = await getSupabase()
          .from('food_logs')
          .select('id')
          .eq('user_id', user.data.user.id)
          .limit(1);

        if (!existingLogs || existingLogs.length === 1) {
          trackFirstFoodLog(user.data.user.id, entry.foodName);
        }

        console.log('Food entry saved successfully:', entry);
      } catch (error) {
        console.error('Error in handleSaveFoodEntry:', error);
        toast.error('Failed to process food entry');
      } finally {
        setIsLoggingActivity(false);
      }
    };

    saveFoodEntry();
    
    // Add a message to the chat showing the logged food
    const foodMessage: ChatMessage = {
      id: Date.now().toString(),
      text: `Logged: ${entry.foodName} (${entry.grams}g) - ${entry.macros.kcal} calories, ${entry.macros.protein}g protein`,
      timestamp: new Date(),
      isUser: false
    };
    
    setMessages(prev => [...prev, foodMessage]);
  };

  // Function to handle workout logging
  const handleLogWorkout = async (workoutData: {
    type: string;
    duration: number;
    volume?: number;
    rpe?: number;
    notes?: string;
  }) => {
    try {
      setIsLoggingActivity(true);
      const user = await getSupabase().auth.getUser();
      if (!user.data.user) {
        console.error('No authenticated user');
        return;
      }

      const supabase = getSupabase();
      const userId = user.data.user.id;
      const activityDate = new Date().toISOString().slice(0, 10);

      // Step 1: Insert workout log
      const { error: insertError } = await supabase
        .from('workout_logs')
        .insert({
          user_id: userId,
          workout_date: activityDate,
          duration_minutes: workoutData.duration,
          workout_type: workoutData.type,
          volume_lbs: workoutData.volume,
          avg_rpe: workoutData.rpe,
          notes: workoutData.notes
        });

      if (insertError) {
        console.error('Error saving workout:', insertError);
        toast.error('Failed to save workout');
        return;
      }

      // Step 2: Update daily activity summary
      await updateDailyActivitySummary(userId, activityDate);

      // Step 3: Check and award achievements
      const newAchievements = await checkAndAwardAchievements(userId);

      if (newAchievements > 0) {
        toast.success(`🏆 ${newAchievements} new achievement${newAchievements > 1 ? 's' : ''} earned!`);
      }

      // Step 4: Refresh header metrics would happen here if ProfilePage was mounted
      // For now, just log the successful workflow
      console.log('Workout logged successfully - metrics will refresh on next page load');

      // Add success message to chat
      const workoutMessage: ChatMessage = {
        id: Date.now().toString(),
        text: `Workout logged: ${workoutData.type} for ${workoutData.duration} minutes${workoutData.volume ? `, ${workoutData.volume} lbs volume` : ''}${workoutData.rpe ? `, RPE ${workoutData.rpe}` : ''}`,
        timestamp: new Date(),
        isUser: false
      };
      
      setMessages(prev => [...prev, workoutMessage]);

    } catch (error) {
      console.error('Error logging workout:', error);
      toast.error('Failed to process workout entry');
    } finally {
      setIsLoggingActivity(false);
    }
  };

  // Example usage in handleSendMessage for workout detection
  const detectAndLogWorkout = (message: string) => {
    const workoutKeywords = ['workout', 'exercise', 'gym', 'training', 'lifted', 'ran', 'cardio'];
    const hasWorkoutKeyword = workoutKeywords.some(keyword => 
      message.toLowerCase().includes(keyword)
    );

    if (hasWorkoutKeyword) {
      // Simple pattern matching for demonstration
      // In production, you'd use more sophisticated NLP
      const durationMatch = message.match(/(\d+)\s*(minutes?|mins?|hours?)/i);
      const duration = durationMatch ? parseInt(durationMatch[1]) * (durationMatch[2].toLowerCase().includes('hour') ? 60 : 1) : 30;
      
      const typeMatch = message.match(/(cardio|strength|resistance|running|lifting|weights)/i);
      const type = typeMatch ? typeMatch[1].toLowerCase() : 'resistance';

      handleLogWorkout({
        type,
        duration,
        notes: message
      });
    }
  };
  // Show loading state while determining user role
  if (roleLoading) {
    return (
      <div className="h-screen bg-pat-gradient text-white flex items-center justify-center pt-[44px]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white">Loading chat permissions...</p>
        </div>
      </div>
    );
  }

  // Gate chat access for non-privileged users
  if (!isPrivileged(currentUserRole)) {
    return (
      <div className="h-screen bg-pat-gradient text-white flex items-center justify-center pt-[44px]">
        <div className="max-w-md mx-auto text-center p-6">
          <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
              <span className="text-white text-lg">!</span>
            </div>
          </div>
          <h2 className="text-xl font-semibold text-white mb-4">Chat Access Restricted</h2>
          <p className="text-white/80 leading-relaxed">
            Chat limited to Admins and Beta users during testing.
          </p>
          <div className="mt-6 p-4 bg-white/10 rounded-lg backdrop-blur-sm">
            <p className="text-white/70 text-sm">
              Contact your administrator for access or wait for general availability.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show Success Transition (after meal logged)
  if (showSuccessTransition && successMealData) {
    return (
      <MealSuccessTransition
        kcal={successMealData.kcal}
        items={successMealData.items}
        onSkip={() => {
          setShowSuccessTransition(false);
          setSuccessMealData(null);
          navigate('/dashboard', {
            state: {
              mealJustLogged: true,
              mealCalories: successMealData.kcal,
              mealItems: successMealData.items
            }
          });
        }}
      />
    );
  }

  // Show TMWYA Verification Page if active
  if (showMealVerification && pendingMeal) {
    const VerificationPage = React.lazy(() => import('./tmwya/VerificationPage').then(m => ({ default: m.default })));
    return (
      <div className="h-screen bg-pat-gradient text-white flex items-center justify-center pt-[44px]">
        <React.Suspense fallback={<div className="text-center">Loading verification...</div>}>
          <VerificationPage
            pendingMeal={pendingMeal}
            onEdit={handleMealVerificationEdit}
            onCancel={handleMealVerificationCancel}
            onLog={handleMealVerificationLog}
          />
        </React.Suspense>
      </div>
    );
  }

  // Show Food Verification Screen if active
  if (showFoodVerificationScreen && currentAnalysisResult) {
    return (
      <FoodVerificationScreen
        analysisResult={currentAnalysisResult}
        onConfirm={handleConfirmVerification}
        onCancel={handleCancelVerification}
        onEditManually={handleEditManually}
        isLoading={isAnalyzingFood}
      />
    );
  }

  if (isLoadingChat) {
    return (
      <div className="h-screen bg-pat-gradient text-white flex items-center justify-center pt-[44px]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white">Loading chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-pat-gradient text-white flex flex-col pt-[44px]">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 py-6 pb-32">
          {/* TDEE Prompt Bubble - Always visible at top until completed */}
          <AnimatePresence>
            {showTDEEBubble && (
              <div className="mb-6">
                <TDEEPromptBubble
                  onClick={() => {
                    navigate('/tdee');
                  }}
                />
              </div>
            )}
          </AnimatePresence>

          {/* Conditional conversation starters - horizontal carousel above input */}
          {isNewUser && !isTyping && starterChips.length > 0 && messages.length === 1 && (
            <div className="fixed bottom-[76px] left-0 right-0 px-4 overflow-x-auto">
              <div className="flex gap-2 pb-2">
                {starterChips.map((chip, index) => (
                  <button
                    key={index}
                    onClick={() => handleChipClick(chip)}
                    className="px-4 py-2 bg-white border border-gray-300 rounded-full text-sm text-gray-800 whitespace-nowrap hover:bg-gray-50 transition-colors"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`space-y-6 transition-opacity duration-300 ${isTyping || messages.length > 1 ? 'opacity-100' : 'opacity-0'}`}>
            {(() => {
              function renderVerifyCtaIfNeeded(msg: any) {
                if (msg?.meta?.ama_nutrition_estimate === true && (msg?.meta?.items?.length ?? 0) > 0) {
                  // Convert AMA nutrition data to AnalysisResult format for FoodVerificationScreen
                  const amaItems = msg.meta.items.map((item: any, index: number) => ({
                    name: item.name || item.description || '',
                    brand: item.brand,
                    qty: item.quantity || item.qty || 1,
                    unit: item.unit || 'serving',
                    grams: 100, // Default assumption
                    macros: {
                      kcal: item.calories || 0,
                      protein_g: item.protein_g || 0,
                      carbs_g: item.carbs_g || 0,
                      fat_g: item.fat_g || 0,
                    },
                    confidence: 0.9, // High confidence for AMA estimates
                    candidates: [{
                      name: item.name || item.description || '',
                      brand: item.brand,
                      macros: {
                        kcal: item.calories || 0,
                        protein_g: item.protein_g || 0,
                        carbs_g: item.carbs_g || 0,
                        fat_g: item.fat_g || 0,
                      },
                      confidence: 0.9,
                      source: item.source || 'USDA'
                    }],
                    source_hints: { ama_estimate: true },
                    originalText: item.name || item.description || ''
                  }));

                  const analysisResult = {
                    items: amaItems,
                    meal_slot: 'lunch', // Default assumption
                    source: 'text',
                    originalInput: 'AMA nutrition estimate'
                  };

                  return (
                    <button
                      className="mt-2 px-3 py-1 rounded-xl bg-white/20 hover:bg-white/30 transition"
                      onClick={() => {
                        setCurrentAnalysisResult(analysisResult);
                        setShowFoodVerificationScreen(true);
                        console.info('[ama] verify → opened from AMA CTA', { count: amaItems.length });
                      }}
                    >
                      Verify &amp; Log
                    </button>
                  );
                }
                return null;
              }

              function renderAssistantBubble(msg: any) {
                return (
                  <div className="assistant-bubble">
                    <div>{msg.text}</div>
                    {renderVerifyCtaIfNeeded(msg)}
                  </div>
                );
              }

              return messages.map((message, index) => {
              // Handle TMWYA verify card - render MealVerifyCard inline as chat bubble
              if (message.roleData?.type === 'tmwya.verify') {
                const handleMealConfirm = async () => {
                  try {
                    setIsLoggingActivity(true);
                    
                    // Convert roleData to SaveMealInput format
                    const items = message.roleData.items || [];
                    const view = message.roleData.view || {};
                    
                    const saveInput: SaveMealInput = {
                      userId: userId!,
                      messageId: undefined,
                      items: items.map((item: any) => ({
                        name: item.name || '',
                        quantity: Number(item.quantity ?? item.qty ?? 1),
                        unit: item.unit || 'serving',
                        energy_kcal: Number(item.calories ?? item.energy_kcal ?? 0),
                        protein_g: Number(item.protein_g ?? 0),
                        fat_g: Number(item.fat_g ?? 0),
                        carbs_g: Number(item.carbs_g ?? 0),
                        fiber_g: Number(item.fiber_g ?? 0),
                        brand: item.brand,
                        description: undefined
                      })),
                      mealSlot: view.meal_slot || null,
                      timestamp: view.eaten_at || new Date().toISOString(),
                      note: undefined,
                      clientConfidence: undefined,
                      source: 'text'
                    };

                    const result = await saveMealAction(saveInput);

                    if (result.ok) {
                      // Reload dashboard data
                      await loadLiveDashboard();
                      
                      const calories = view.totals?.calories || 0;
                      
                      // Add confirmation message with View Dashboard button inline
                      const confirmMessage: ChatMessage = {
                        id: crypto.randomUUID(),
                        text: `✅ Meal logged! ${calories} calories added.`,
                        isUser: false,
                        timestamp: new Date(),
                        meta: {
                          showDashboardButton: true,
                          sessionId: sessionId
                        }
                      };
                      setMessages(prev => [...prev, confirmMessage]);
                    } else {
                      toast.error(result.error || 'Failed to log meal');
                    }
                  } catch (error: any) {
                    console.error('[MealVerifyCard] Log failed:', error);
                    toast.error('Failed to log meal');
                  } finally {
                    setIsLoggingActivity(false);
                  }
                };

                const handleMealCancel = () => {
                  const cancelMessage: ChatMessage = {
                    id: crypto.randomUUID(),
                    text: "Meal logging cancelled. Let me know if you'd like to try again!",
                    isUser: false,
                    timestamp: new Date(),
                  };
                  setMessages(prev => [...prev, cancelMessage]);
                };

                // Render MealVerifyCard inline as assistant bubble
                return (
                  <div key={message.id} className="flex justify-start">
                    <div className="max-w-2xl">
                      <MealVerifyCard
                        view={message.roleData.view}
                        items={message.roleData.items || []}
                        totals={message.roleData.totals}
                        tef={message.roleData.tef}
                        tdee={message.roleData.tdee}
                        liveDashboard={dashboardData ? {
                          target_kcal: dashboardData.targetCalories,
                          consumed_today: dashboardData.totalCalories
                        } : undefined}
                        onConfirm={handleMealConfirm}
                        onCancel={handleMealCancel}
                      />
                    </div>
                  </div>
                );
              }
              
              // Regular message bubble
              return (
                <div key={message.id}>
                  <div
                    className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-sm lg:max-w-2xl px-5 py-4 rounded-2xl ${
                        message.isUser
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-100'
                      }`}
                      style={{ maxWidth: message.isUser ? '480px' : '700px' }}
                    >
                      {message.isUser ? (
                        <p className="message-bubble text-base leading-relaxed whitespace-pre-wrap break-words" style={{ lineHeight: '1.6', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{message.text}</p>
                      ) : (
                        renderAssistantBubble(message)
                      )}

                      {/* View Dashboard button for meal logged messages */}
                      {message.meta?.showDashboardButton && (
                        <div className="mt-3 pt-2 border-t border-gray-600">
                          <button
                            onClick={async () => {
                              try {
                                const sessionIdToReturn = message.meta.sessionId || sessionId;
                                if (sessionIdToReturn) {
                                  sessionStorage.setItem('returnToChatId', sessionIdToReturn);
                                }
                                navigate('/dashboard', {
                                  state: {
                                    returnToChatId: sessionIdToReturn,
                                    mealJustLogged: true
                                  }
                                });
                              } catch (navError) {
                                console.error('[nav] Failed to navigate:', navError);
                              }
                            }}
                            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                          >
                            View Dashboard →
                          </button>
                        </div>
                      )}

                      {/* Source display for web-verified content */}
                      {message.meta?.cite && (
                        <div className="mt-3 pt-2 border-t border-gray-600">
                          <div className="flex items-center gap-2 text-xs">
                            {message.meta.webVerified && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-600/20 text-green-400 text-xs font-medium">
                                Web verified
                              </span>
                            )}
                            <span className="text-gray-400">Source:</span>
                            <a
                              href={message.meta.cite}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 underline"
                            >
                              {message.meta.citeTitle || message.meta.cite}
                            </a>
                          </div>
                        </div>
                      )}

                      {/* Verify & Log button for AMA nutrition estimates */}
                      {message.meta?.ama_nutrition_estimate && message.meta?.items && (
                        <div className="mt-3 pt-2 border-t border-gray-600">
                          <button
                            onClick={() => {
                              console.log('[chat] Verify & Log clicked for AMA nutrition');
                              // Set up pending meal from message metadata
                              const pendingMealData = {
                                items: message.meta.items.map((item: any) => ({
                                  description: item.name || item.description || '',
                                  brand: item.brand || undefined,
                                  qty: item.quantity || item.qty || 1,
                                  unit: item.unit || 'serving',
                                  calories: item.calories || 0,
                                  protein_g: item.protein_g || 0,
                                  carbs_g: item.carbs_g || 0,
                                  fat_g: item.fat_g || 0,
                                  fiber_g: item.fiber_g || 0,
                                  source: item.source || undefined,
                                })),
                                inferredTimestamp: new Date(),
                                totals: message.meta.totals || {
                                  calories: 0,
                                  protein_g: 0,
                                  carbs_g: 0,
                                  fat_g: 0,
                                  fiber_g: 0,
                                }
                              };
                              setPendingMeal(pendingMealData);
                              setShowMealVerification(true);
                              console.log('[tmwya] verify → opened from AMA CTA');
                            }}
                            className="inline-flex items-center px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200"
                          >
                            Verify & Log
                          </button>
                        </div>
                      )}
                      <p className="text-xs opacity-70 mt-2">
                        {message.timestamp.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
              </div>
              );
              });
            })()}
            {/* Status Indicator */}
            {(isSending || isAnalyzingFood || statusText || isThinking) && (
              <div className="flex justify-start">
                <div className="max-w-sm lg:max-w-2xl px-5 py-4 rounded-2xl bg-gray-800 text-gray-100" style={{ maxWidth: '700px' }}>
                  <ThinkingAvatar className="" label={statusText || 'Pat is thinking...'} />
                </div>
              </div>
            )})
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </div>
        
        {/* Frozen bottom pane - mobile optimized */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 safe-area-inset-bottom">
          {/* Plus menu popup */}
          {showPlusMenu && (
            <div className="absolute bottom-full left-4 right-4 mb-2 p-4 bg-gray-800 rounded-2xl shadow-xl">
              {/* Camera action - prominent */}
              <button
                onClick={() => {
                  setShowPlusMenu(false);
                  handleChipClick('Show me what you\'re eating');
                }}
                className="w-full mb-3 flex items-center gap-3 px-4 py-4 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all active:scale-95"
              >
                <Camera size={24} className="text-white" />
                <span className="text-white font-semibold">Take a picture</span>
              </button>
              
              {/* Other options - secondary */}
              <div className="grid grid-cols-3 gap-2">
                {plusMenuOptions.filter(o => o.id !== 'take').map((option) => {
                  const IconComponent = option.icon;
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        setShowPlusMenu(false);
                        if (option.id === 'log-food') {
                          // TODO: Implement food logging flow
                          return;
                        }
                      }}
                      className="flex flex-col items-center gap-2 p-3 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <IconComponent size={20} className="text-gray-300" />
                      <span className="text-xs text-gray-300">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Main input row: + [Input] 🎤 👤 */}
          <div className="flex items-center gap-2">
            {/* Plus menu button */}
            <button
              onClick={() => setShowPlusMenu(!showPlusMenu)}
              className={`flex-shrink-0 w-12 h-12 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors ${isDictating ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={isDictating}
            >
              <Plus size={24} className="text-gray-600" />
            </button>
            
            {/* Input field */}
            {isDictating ? (
              <div className="flex-1 flex items-center justify-center py-3 px-4 bg-gray-100 border border-gray-300 rounded-full">
                <VoiceWaveform isActive={true} barCount={7} className="mr-3" />
                <p className="text-sm text-gray-600">{inputText || "Listening..."}</p>
              </div>
            ) : (
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && (handleSendMessage(), e.preventDefault())}
                placeholder="Ask me anything"
                rows={1}
                className="flex-1 bg-white border border-gray-300 text-gray-900 placeholder-gray-400 rounded-full px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none whitespace-pre-wrap break-words"
                style={{ overflowWrap: 'anywhere', wordBreak: 'break-word', minHeight: '48px', maxHeight: '120px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                }}
              />
            )}
            
            {/* Mic button */}
            <button
              onClick={isDictating ? stopDictation : startDictation}
              className={`flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-full transition-colors ${
                isDictating ? 'bg-red-600 hover:bg-red-700' : 'hover:bg-gray-100'
              }`}
            >
              <Mic size={24} className={isDictating ? 'text-white' : 'text-gray-600'} />
            </button>
            
            {/* Pat's animated avatar */}
            {isDictating ? (
              <button
                onClick={submitDictation}
                disabled={isSending}
                className="flex-shrink-0 w-12 h-12 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center transition-all duration-300"
              >
                <Check size={20} className="text-white" />
              </button>
            ) : isTyping ? (
              <button
                onClick={handleSendMessage}
                disabled={isSending}
                className="flex-shrink-0 w-12 h-12 bg-blue-600 hover:bg-blue-700 rounded-full flex items-center justify-center transition-all duration-300"
              >
                <ArrowUp size={20} className="text-white" />
              </button>
            ) : (
              <button
                onClick={() => navigate('/voice')}
                className="flex-shrink-0 hover:opacity-80 transition-all duration-300 relative group"
              >
                <PatAvatar 
                  size={48} 
                  mood={getPatMood()} 
                  isListening={isDictating}
                  isThinking={isThinking}
                  isSpeaking={isSpeaking}
                  animated={true}
                />
                <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  Voice Chat
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};