/**
 * MAIN USER MESSAGE HANDLER
 * Coordinates intent detection, model selection, role execution, and LLM response
 */

import { detectIntent, shouldTriggerRole, decideAmaChannel } from '../router/intentRouter';
import { selectModel, estimateCost, getModelDisplayName, type ModelSelection } from '../router/modelRouter';
import { type UserContext } from '../personality/patSystem';
import { ensureChatSession } from './sessions';
import { storeMessage, loadRecentMessages } from './store';
import { buildHistoryContext } from '../../lib/chatHistoryContext';
import { runTMWYAPipeline } from '../../lib/tmwya/pipeline';
import { loadRoutesOnce, getCachedRoutes } from '../router/routesCache';
import { decideRoute } from '../router/semanticRouter';
import { rankTopPreferences, prefsToSystemLine } from '../memory/preferences';
import { TMWYA_TOOL } from '../nutrition/tools';
import { detectFoodEvent } from '../intent/foodDetector';
import { detectUnDietIntent, convertWaterToMl } from '../intent/undietDetector';
import { startUnDiet, logWaterIntake, logBathroomVisit, getTodaysWaterIntake } from '../../lib/undiet/tracking';
import { checkUnDietTrigger, getUnDietProgressMessage } from '../../lib/undiet/undietTrigger';

const TRIGGER_WORDS = /\b(source|link|links|cite|verify|latest|current|news|today|this week|20\d{2}|19\d{2})\b/i;

/**
 * Strip leading style JSON from assistant responses
 * The post-executor sometimes emits style config blocks that should never be shown to users
 */
function stripLeadingStyleJSON(raw: string): string {
  if (!raw) return raw;
  const s = raw.trim();
  // quick detect: starts with "{" and contains style keys
  if (!s.startsWith('{')) return raw;

  // first try to parse the whole thing
  try {
    const obj = JSON.parse(s);
    const keys = obj && typeof obj === 'object' ? Object.keys(obj) : [];
    const looksLikeStyle =
      keys.length > 0 &&
      keys.every(k => ['tone', 'formality', 'jargon', 'greet_by_name_once'].includes(k));
    if (looksLikeStyle) return ''; // pure style block, drop it
  } catch {
    // fall through
  }

  // fallback: strip a leading {...} block if it mentions tone/formality
  const m = s.match(/^\s*\{[\s\S]*?\}\s*/);
  if (m && /"tone"|"formality"/.test(m[0])) {
    return s.slice(m[0].length).trim();
  }
  return raw;
}

export interface MessageContext {
  userId: string;
  userContext?: UserContext;
  messageHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  mode?: 'text' | 'voice';
  sessionId?: string; // Optional: provide existing session ID
}

export interface MessageResponse {
  response: string;
  intent: string;
  intentConfidence: number;
  modelUsed: string;
  estimatedCost: number;
  roleData?: any;
  toolCalls?: any;
  rawData?: any;
  blocked?: boolean;
}

/**
 * Main entry point for handling user messages
 */
export async function handleUserMessage(
  message: string,
  context: MessageContext
): Promise<MessageResponse> {
  // Step 0: Ensure chat session exists and load history
  const sessionId = context.sessionId || await ensureChatSession(context.userId);
  console.log('[handleUserMessage] Session ID:', sessionId);

  // Load recent message history if not provided (increased to 20 for better context)
  const messageHistory = context.messageHistory || await loadRecentMessages(sessionId, 20);
  console.log('[handleUserMessage] Message history loaded:', messageHistory.length, 'messages');

  // Step 1: Store user message
  await storeMessage(sessionId, 'user', message);

  // Initialize supabase client
  const { getSupabase } = await import('../../lib/supabase');
  const supabase = getSupabase();

  // Load routes once at app init
  await loadRoutesOnce(supabase);

  // Get user preferences for injection
  const prefs = await rankTopPreferences(context.userId, message, supabase, 3);
  const sysPrefs = prefsToSystemLine(prefs);

  // Check for memory queries and inject context from structured data
  const { detectMemoryQuery, searchMealHistory, buildMemoryContext } = await import('../memory/chatContext');
  const memoryQuery = detectMemoryQuery(message);
  let memoryContext = '';
  
  if (memoryQuery.isMemoryQuery && memoryQuery.type === 'meal' && memoryQuery.searchTerm) {
    const results = await searchMealHistory(context.userId, memoryQuery.searchTerm);
    memoryContext = buildMemoryContext(results);
    if (memoryContext) {
      console.info('[memory] Injected context:', memoryContext);
    }
  }

  // STEP 1.0: UnDiet intent detection (HIGHEST PRIORITY - before food detection)
  // Handles water logging, bathroom tracking, and UnDiet program start
  console.log('='.repeat(60));
  console.log('[handleUserMessage] STEP 1.0: UnDiet Intent Detection');
  console.log('[handleUserMessage] Input message:', message);
  
  const undietIntent = detectUnDietIntent(message);
  
  // DETAILED DEBUG: Log the full intent result
  console.log('[handleUserMessage] UnDiet Intent Result:', JSON.stringify({
    isBeverageLog: undietIntent.isBeverageLog,
    isWaterLog: undietIntent.isWaterLog,
    beverageCategory: undietIntent.beverageCategory,
    beverageName: undietIntent.beverageName,
    waterAmount: undietIntent.waterAmount,
    waterUnit: undietIntent.waterUnit,
    containerType: undietIntent.containerType,
    confidence: undietIntent.confidence,
    isBathroomLog: undietIntent.isBathroomLog,
    isUnDietStart: undietIntent.isUnDietStart
  }, null, 2));
  
  // Track water logging message for combining with food responses
  let waterLoggedMessage: string | null = null;
  
  // Check if beverage was detected
  if (undietIntent.isBeverageLog) {
    console.log('[handleUserMessage] ✅ BEVERAGE DETECTED - Will handle as hydration, NOT food');
  } else {
    console.log('[handleUserMessage] ❌ No beverage detected - will continue to food detection');
  }
  console.log('='.repeat(60));
  
  if (undietIntent.confidence > 0.8) {
    // Handle UnDiet program start
    if (undietIntent.isUnDietStart) {
      console.info('[undiet] User wants to start UnDiet program');
      const result = await startUnDiet(context.userId);
      
      if (result.success) {
        const responseText = "Perfect! Your 14-day UnDiet observation period starts today. Just keep telling me everything you eat and drink - no restrictions, no changes. I'll track it all and on Day 14, I'll give you personalized feedback based on YOUR actual patterns. Let's do this! 🎯";
        await storeMessage(sessionId, 'assistant', responseText);
        
        return {
          response: responseText,
          intent: 'undiet_start',
          intentConfidence: 1.0,
          modelUsed: 'undiet-tracker',
          estimatedCost: 0,
          roleData: null,
          toolCalls: null,
          rawData: null
        };
      } else {
        const responseText = result.error || "I couldn't start your UnDiet program right now. Please try again.";
        await storeMessage(sessionId, 'assistant', responseText);
        
        return {
          response: responseText,
          intent: 'undiet_start_error',
          intentConfidence: 1.0,
          modelUsed: 'undiet-tracker',
          estimatedCost: 0,
          roleData: null,
          toolCalls: null,
          rawData: null
        };
      }
    }
    
    // Handle beverage/water intake logging
    // Check if message ALSO contains food items - if so, log beverage but continue to food processing
    if (undietIntent.isBeverageLog && undietIntent.waterAmount && undietIntent.waterUnit) {
      console.log('='.repeat(60));
      console.log('[handleUserMessage] 🥤 BEVERAGE LOGGING PATH ENTERED');
      console.log('[handleUserMessage] Beverage details:', {
        category: undietIntent.beverageCategory,
        name: undietIntent.beverageName,
        amount: undietIntent.waterAmount,
        unit: undietIntent.waterUnit,
        container: undietIntent.containerType
      });
      
      const beverageType = undietIntent.beverageCategory || 'water';
      const beverageName = undietIntent.beverageName || 'water';
      console.info('[undiet] Beverage logging detected:', beverageName, undietIntent.waterAmount, undietIntent.waterUnit);
      const amountMl = convertWaterToMl(undietIntent.waterAmount, undietIntent.waterUnit);
      console.log('[handleUserMessage] Converted to ML:', amountMl);
      const result = await logWaterIntake(context.userId, amountMl, undefined, beverageType, beverageName);
      
      // Check if message also contains food (peek ahead)
      const foodDetectPeek = detectFoodEvent(message);
      const alsoHasFood = foodDetectPeek.wantsLog || foodDetectPeek.wantsMacros || foodDetectPeek.isFoodEvent;
      
      if (result.success) {
        const totalToday = await getTodaysWaterIntake(context.userId);
        const totalLiters = (totalToday / 1000).toFixed(1);
        const effectiveHydration = result.effectiveHydration || amountMl;
        const isWater = beverageType === 'water';
        
        // Format display name
        const displayName = beverageName.charAt(0).toUpperCase() + beverageName.slice(1);
        
        if (alsoHasFood) {
          // Log beverage message for later, continue to food processing
          const hydrationNote = isWater ? '' : ` (${effectiveHydration}ml effective hydration)`;
          waterLoggedMessage = `Logged ${amountMl}ml of ${displayName}${hydrationNote} (${totalLiters}L total today). 💧`;
          console.info('[undiet] Beverage logged, continuing to food processing');
        } else {
          // Only beverage, return immediately
          const hydrationNote = isWater ? '' : `\nThat counts as ${effectiveHydration}ml toward your hydration goal.`;
          const responseText = `Logged ${amountMl}ml of ${displayName}! You've had ${totalLiters}L today.${hydrationNote} 💧`;
          await storeMessage(sessionId, 'assistant', responseText);
          
          return {
            response: responseText,
            intent: 'beverage_log',
            intentConfidence: 1.0,
            modelUsed: 'undiet-tracker',
            estimatedCost: 0,
            roleData: null,
            toolCalls: null,
            rawData: null
          };
        }
      } else {
        const responseText = `I couldn't log your ${beverageName} intake right now. ${result.error || 'Please try again.'}`;
        await storeMessage(sessionId, 'assistant', responseText);
        
        return {
          response: responseText,
          intent: 'beverage_log_error',
          intentConfidence: 1.0,
          modelUsed: 'undiet-tracker',
          estimatedCost: 0,
          roleData: null,
          toolCalls: null,
          rawData: null
        };
      }
    }
    
    // Handle bathroom logging
    if (undietIntent.isBathroomLog && undietIntent.bathroomType) {
      console.info('[undiet] Bathroom logging detected:', undietIntent.bathroomType);
      const result = await logBathroomVisit(context.userId, undietIntent.bathroomType);
      
      if (result.success) {
        const responseText = undietIntent.bathroomType === 'bowel_movement'
          ? "Logged! Your digestive health tracking is part of understanding your body's patterns. 📊"
          : "Logged! Tracking all aspects helps build a complete picture. ✅";
        await storeMessage(sessionId, 'assistant', responseText);
        
        return {
          response: responseText,
          intent: 'bathroom_log',
          intentConfidence: 1.0,
          modelUsed: 'undiet-tracker',
          estimatedCost: 0,
          roleData: null,
          toolCalls: null,
          rawData: null
        };
      } else {
        const responseText = `I couldn't log that right now. ${result.error || 'Please try again.'}`;
        await storeMessage(sessionId, 'assistant', responseText);
        
        return {
          response: responseText,
          intent: 'bathroom_log_error',
          intentConfidence: 1.0,
          modelUsed: 'undiet-tracker',
          estimatedCost: 0,
          roleData: null,
          toolCalls: null,
          rawData: null
        };
      }
    }
  }

  // STEP 1.1: Deterministic food event detection (BEFORE embeddings/semantic routing)
  console.log('='.repeat(60));
  console.log('[handleUserMessage] STEP 1.1: Food Event Detection');
  console.log('[handleUserMessage] ⚠️ If we reach here, beverage detection did NOT handle the message');
  
  const foodDetect = detectFoodEvent(message);
  console.log('[handleUserMessage] Food detection result:', JSON.stringify(foodDetect, null, 2));
  console.info('[router-final]', { 
    route: foodDetect.wantsLog ? 'TMWYA' : foodDetect.wantsMacros ? 'TMWYA' : 'AMA', 
    reason: foodDetect.why,
    wantsLog: foodDetect.wantsLog,
    wantsMacros: foodDetect.wantsMacros,
    isFoodEvent: foodDetect.isFoodEvent
  });
  
  // Import processNutrition for TMWYA pipeline (used for both food events and macro queries)
  const { processNutrition } = await import('../nutrition/unifiedPipeline');
  
  // ⚠️ PRIORITY ORDER: wantsLog > isFoodEvent > wantsMacros
  // This ensures "log this and macros" routes to logging flow (not macros-only)
  
  // PRIORITY 1: Handle logging intent (highest priority)
  if (foodDetect.wantsLog) {
    console.info('[router] hard-route=TMWYA reason=log intent (highest priority)');
    const pipelineResult = await processNutrition({
      message,
      userId: context.userId,
      sessionId,
      showLogButton: true // Show log button for logging flow
    });
    
    if (pipelineResult.success && pipelineResult.roleData) {
      // Include water logging message if water was also logged
      const baseText = "I've prepared your meal. Please verify and log.";
      const responseText = waterLoggedMessage 
        ? `${waterLoggedMessage}\n\n${baseText}`
        : baseText;
      const responseRoleData = { 
        ...pipelineResult.roleData, 
        routerWhy: waterLoggedMessage ? "User logged water and food together" : "User asked to log" 
      };
      
      // Persist assistant message with roleData
      await storeMessage(sessionId, 'assistant', responseText, responseRoleData);
      
      return {
        response: responseText,
        intent: waterLoggedMessage ? 'water_and_meal_logging' : 'meal_logging',
        intentConfidence: 1.0,
        modelUsed: 'tmwya-pipeline',
        estimatedCost: 0,
        roleData: responseRoleData,
        toolCalls: null,
        rawData: null
      };
    }
  }
  
  // PRIORITY 2: Handle food events with context-aware clarifier
  if (foodDetect.isFoodEvent) {
    console.info('[router] food event detected: %s', foodDetect.why);
    
    // Include water logging message if water was also logged
    const baseText = "Do you want the macros, or should I log this meal?";
    const responseText = waterLoggedMessage 
      ? `${waterLoggedMessage}\n\n${baseText}`
      : baseText;
    const responseRoleData = {
      type: 'clarifier',
      options: [
        { id: 'macros', label: 'Show Macros' },
        { id: 'log-it', label: 'Log It' }
      ],
      originalMessage: message,
      routerWhy: "Food event detected without clear preference"
    };
    
    // Persist assistant clarifier message with roleData for follow-up context
    await storeMessage(sessionId, 'assistant', responseText, responseRoleData);
    
    // Show clarifier chips for ambiguous food events
    return {
      response: responseText,
      intent: 'clarification_needed',
      intentConfidence: 1.0,
      modelUsed: 'food-detector',
      estimatedCost: 0,
      roleData: responseRoleData,
      toolCalls: null,
      rawData: null
    };
  }
  
  // CONTEXT DETECTION: Handle follow-up responses to clarifier
  // E.g., "yes give me macros" after "I ate a hot dog" or "I had 2 Ben & Jerry's last night"
  // Uses STRUCTURED DATA from previous meal parsing (not fragile regex)
  const isFollowUp = /^(yes|sure|okay|ok|yeah|yep|yup|macros?|log it|show me)/i.test(message.trim());
  if (isFollowUp && messageHistory.length > 0) {
    // Look back for structured meal data from previous processNutrition calls
    let foodContext = '';
    let parsedMealData: any = null;
    
    // Search recent history for assistant messages with meal_card roleData
    const recentMessages = messageHistory.slice(-5).reverse();
    for (const msg of recentMessages) {
      if (msg.role === 'assistant' && msg.roleData) {
        // Check for clarifier with originalMessage
        if (msg.roleData.type === 'clarifier' && msg.roleData.originalMessage) {
          foodContext = msg.roleData.originalMessage;
          console.log('[context-detect] Extracted from clarifier:', foodContext);
          break;
        }
        // Check for meal_card with parsed items
        if (msg.roleData.type === 'meal_card' && msg.roleData.items) {
          parsedMealData = msg.roleData;
          // Reconstruct food description from parsed items
          foodContext = parsedMealData.items.map((item: any) => 
            `${item.qty || ''} ${item.name}`.trim()
          ).join(', ');
          console.log('[context-detect] Extracted from parsed meal:', foodContext);
          break;
        }
      }
    }
    
    // Fallback to user's original food message if no structured data found
    // Extract only the meal phrase, not the entire conversation
    if (!foodContext) {
      for (const msg of recentMessages) {
        if (msg.role === 'user' && /(?:ate|had|drank|eating|drinking)/i.test(msg.content)) {
          // Extract just the food part, not the whole sentence
          const match = msg.content.match(/(?:ate|had|drank|eating|drinking)\s+(.+?)(?:\.|!|\?|$)/i);
          if (match) {
            foodContext = match[1].trim();
            console.log('[context-detect] Fallback extracted food phrase:', foodContext);
            break;
          }
        }
      }
    }
    
    if (foodContext) {
      // Re-process with food context
      const enrichedMessage = message.toLowerCase().includes('macro') 
        ? `what are the macros of ${foodContext}`
        : `log this meal: ${foodContext}`;
      
      console.log('[context-detect] Enriched message:', enrichedMessage);
      // Re-detect with enriched message
      const enrichedDetect = detectFoodEvent(enrichedMessage);
      
      if (enrichedDetect.wantsMacros) {
        const pipelineResult = await processNutrition({
          message: enrichedMessage,
          userId: context.userId,
          sessionId,
          showLogButton: false
        });
        
        if (pipelineResult.success && pipelineResult.roleData) {
          const responseText = `Here are the macros.`;
          const responseRoleData = { ...pipelineResult.roleData, routerWhy: "Context-aware follow-up: macros" };
          
          // Persist assistant message with roleData
          await storeMessage(sessionId, 'assistant', responseText, responseRoleData);
          
          return {
            response: responseText,
            intent: 'nutrition_info',
            intentConfidence: 1.0,
            modelUsed: 'tmwya-pipeline',
            estimatedCost: 0,
            roleData: responseRoleData,
            toolCalls: null,
            rawData: null
          };
        }
      } else if (enrichedDetect.wantsLog) {
        const pipelineResult = await processNutrition({
          message: enrichedMessage,
          userId: context.userId,
          sessionId,
          showLogButton: true
        });
        
        if (pipelineResult.success && pipelineResult.roleData) {
          const responseText = `I've prepared your meal for logging.`;
          const responseRoleData = { ...pipelineResult.roleData, routerWhy: "Context-aware follow-up: logging" };
          
          // Persist assistant message with roleData
          await storeMessage(sessionId, 'assistant', responseText, responseRoleData);
          
          return {
            response: responseText,
            intent: 'meal_logging',
            intentConfidence: 1.0,
            modelUsed: 'tmwya-pipeline',
            estimatedCost: 0,
            roleData: responseRoleData,
            toolCalls: null,
            rawData: null
          };
        }
      }
    }
  }
  
  // PRIORITY 3: Handle macros-only queries (lowest priority, only when no log/food intent)
  if (foodDetect.wantsMacros) {
    console.info('[router] hard-route=TMWYA reason=macros query');
    const pipelineResult = await processNutrition({
      message,
      userId: context.userId,
      sessionId,
      showLogButton: false // Macros only, no log button
    });
    
    if (pipelineResult.success && pipelineResult.roleData) {
      const responseText = "Here are the macros for your food.";
      const responseRoleData = { ...pipelineResult.roleData, routerWhy: "User asked for macros" };
      
      // Persist assistant message with roleData
      await storeMessage(sessionId, 'assistant', responseText, responseRoleData);
      
      return {
        response: responseText,
        intent: 'nutrition_info',
        intentConfidence: 1.0,
        modelUsed: 'tmwya-pipeline',
        estimatedCost: 0,
        roleData: responseRoleData,
        toolCalls: null,
        rawData: null
      };
    }
  }

  // Step 1.5: Semantic routing with fast path (fallback when no food event detected)
  let routeDecision: any = null;
  let used_web = false;

  // Fast path for trivial non-factual chat
  if (message.split(/\s+/).length < 12 && !TRIGGER_WORDS.test(message)) {
    routeDecision = { route: 'AMA', confidence: 'low', sim: 0, hi: 0.85, mid: 0.60, why: 'Fast path: trivial query', intent: 'ama' };
    // Use decideAmaChannel to determine web vs local for AMA
    const channel = decideAmaChannel(message);
    used_web = channel === 'ama-web';
  } else {
    // Full semantic routing
    routeDecision = await decideRoute(message, getCachedRoutes());
    // Map route to intent
    routeDecision.intent = routeDecision.route === 'TMWYA' ? 'meal_logging' : 'ama';
    // For AMA routes, use decideAmaChannel to determine web-first behavior
    if (routeDecision.route === 'AMA') {
      const channel = decideAmaChannel(message);
      used_web = channel === 'ama-web';
    } else {
      used_web = false;
    }
  }

  console.info('[router]', { route: routeDecision.route, sim: routeDecision.sim, hi: routeDecision.hi, mid: routeDecision.mid, why: routeDecision.why, used_web });

  // Early branch: Route to TMWYA pipeline for meal logging
  if (routeDecision.route === 'TMWYA') {
    try {
      // Use processNutrition for TMWYA to get proper MealVerifyCard format
      const { processNutrition } = await import('../nutrition/unifiedPipeline');
      
      const pipelineResult = await processNutrition({
        message,
        userId: context.userId,
        sessionId,
        showLogButton: true // TMWYA always shows log button
      });
      
      if (pipelineResult.success && pipelineResult.roleData) {
        console.info('[tmwya] resolved → MealVerifyCard ready', pipelineResult.roleData.view?.totals);

        // Return message with full roleData for MealVerifyCard
        const response = {
          response: "I've prepared your meal. Please verify.",
          intent: routeDecision.intent,
          intentConfidence: routeDecision.confidence || 0.8,
          modelUsed: 'tmwya-pipeline',
          estimatedCost: 0,
          roleData: pipelineResult.roleData, // Full structure: view, items, totals, tef, tdee
          toolCalls: null,
          rawData: null
        };
        
        console.info("[roledata]", {
          type: response.roleData?.type,
          items: Array.isArray(response.roleData?.items) ? response.roleData.items.length : null
        });
        
        return response;
      }
    } catch (error) {
      console.error('[handleUserMessage] TMWYA pipeline failed:', error);
    }
  }

  // AMA path continues as before...
  // Guard against any unexpected normalizer/router issues
  try {
    // no-op; kept to ensure we never throw before AMA execution
  } catch (e) {
    console.warn('[handleUserMessage] normalization guard tripped', e);
  }

  // AMA nutrition for macro queries (when route is AMA but query is about nutrition)
  const mentionsMacros = /\b(macros?|macro|calories|protein|carbs?|fat|nutrition|kcals?)\b/i.test(message);
  const mealLoggingCue = /\b(i\s+(ate|had|logged)|log\s+(this|my)\s+meal|ate|had)\b/i.test(message);
  const foodIndicator = /\b(eggs?|egg|steak|ribeye|chicken|oatmeal|salad|burger|fries|sandwich|pizza|rice|smoothie|meal|breakfast|lunch|dinner)\b/i.test(message);
  const isMealLoggingMessage = mealLoggingCue && foodIndicator;
  const isNutritionQuery = mentionsMacros || isMealLoggingMessage;

  if (routeDecision.route === 'AMA' && isNutritionQuery) {
    try {
      const { processNutrition } = await import('../nutrition/unifiedPipeline');

      // Determine if we should show the log button
      // food_question → info-only (show Edit/Cancel, but still allow logging)
      // meal_logging → full logging mode (show Log/Edit/Cancel)
      const showLogButton = routeDecision.intent === 'meal_logging' || isMealLoggingMessage;

      console.log(`[nutrition] Intent: ${routeDecision.intent}, showLogButton: ${showLogButton}`);

      const pipelineResult = await processNutrition({
        message,
        userId: context.userId,
        sessionId,
        showLogButton
      });

      if (pipelineResult.success && pipelineResult.roleData) {
        // Return full roleData for MealVerifyCard rendering (same as TMWYA path)
        const response = {
          response: "I've prepared the nutrition data. Please verify.",
          intent: routeDecision.intent,
          intentConfidence: routeDecision.confidence || 0.8,
          modelUsed: 'nutrition-unified',
          estimatedCost: 0,
          roleData: pipelineResult.roleData, // Full structure: view, items, totals, tef, tdee
          toolCalls: null,
          rawData: null
        };

        console.info("[roledata]", {
          type: response.roleData?.type,
          items: Array.isArray(response.roleData?.items) ? response.roleData.items.length : null
        });

        console.log('[nutrition] AMA nutrition response prepared with MealVerifyCard');
        return response;
      } else {
        console.warn('[nutrition] Pipeline failed, falling back to general chat:', pipelineResult.error);
        // Fall through to general chat/AMA fallback below
      }
    } catch (e) {
      console.warn('[nutrition] Processing failed, falling back to general chat:', e);
      // Fall through to general chat fallback below
    }
  }

  // Step 3: Select model based on new routing
  let modelSelection: ModelSelection;
  let provider = "openai";
  let grounded = false;
  let has_google_search = false;

  if (routeDecision.route === 'TMWYA') {
    // TMWYA uses OpenAI with function calling
    provider = "openai";
    grounded = false;
    has_google_search = false;
    modelSelection = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 1000,
      functions: [TMWYA_TOOL]
    } as any;
  } else if (routeDecision.route === 'AMA') {
    // AMA: web-first by default, unless user opts out
    const channel = decideAmaChannel(message);
    if (channel === 'ama-web') {
      // Web-connected path: Gemini + search
      provider = "gemini";
      grounded = true;
      has_google_search = true;
      modelSelection = {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: 0.2,
        maxTokens: 2000,
        tools: [{ google_search: {} }]
      } as any;
    } else {
      // Local path: OpenAI, no search
      provider = "openai";
      grounded = false;
      has_google_search = false;
      modelSelection = {
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 1000
      } as any;
    }
  } else {
    // Fallback: OpenAI
    provider = "openai";
    grounded = false;
    has_google_search = false;
    modelSelection = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 1000
    } as any;
  }

  const cost = estimateCost(modelSelection);
  console.log('[handleUserMessage] Model selected:', getModelDisplayName(modelSelection), `(~$${cost.toFixed(4)})`);
  console.info('[handleUserMessage] Router decision used: yes, grounded:', grounded, 'provider:', provider);

  // Orchestrator tool separation logging
  const has_functionDecls = !!(modelSelection as any).functions?.length;
  console.info('[orchestrator]', {
    route: routeDecision.route,
    used_web: grounded,
    provider,
    grounded,
    has_functionDecls,
    has_google_search
  });

  // Step 4: Check if we should trigger a role
  let roleData: any = null;

  if (shouldTriggerRole(routeDecision.intent)) {
    // TODO: Load role manifest and execute role handler
    console.log('[handleUserMessage] Role trigger needed:', routeDecision.intent);
    // roleData = await executeRole(routeDecision.intent, message, context);
  }

  // Step 5: Build system prompt with user context and preferences
  let systemPrompt: string;
  let swarm: any = null;

  try {
    const { getSwarmForIntent, buildSwarmPrompt } = await import('../swarm/loader');

    // Use AMA intent for all routes (TMWYA uses function calling, not swarm)
    const intentForSwarm = routeDecision.route === 'AMA' ? 'general' : 'general';

    swarm = await getSwarmForIntent(intentForSwarm);

    if (!swarm) {
      // No swarm matched; force-load personality swarm as fallback
      console.warn('[routing] No swarm matched; falling back to personality swarm');
      swarm = await getSwarmForIntent('general');
    }

    if (swarm) {
      console.log(`[handleUserMessage] Using swarm: ${swarm.swarm_name}`);
      systemPrompt = await buildSwarmPrompt(swarm, context.userContext);
      // Inject user preferences
      if (sysPrefs) {
        systemPrompt += '\n\n' + sysPrefs;
      }
      // Inject memory context if available
      if (memoryContext) {
        systemPrompt += '\n\n' + memoryContext;
      }
    } else {
      throw new Error('Personality swarm not configured');
    }
  } catch (err) {
    console.error('[handleUserMessage] Swarm load failed, using minimal emergency prompt:', err);
    systemPrompt = 'You are Pat. Speak clearly and concisely.';
  }

  // Inject lightweight history context (recent conversation snippet)
  const historyCtx = await buildHistoryContext(context.userId, sessionId);
  if (historyCtx) {
    systemPrompt += `\n\n${historyCtx}`;
    console.log('[handleUserMessage] Added history context, length:', historyCtx.length);
  }

  // Step 5.5: AMA fallback for meal logging when TMWYA not available
  if (routeDecision.intent === 'meal_logging' && routeDecision.confidence >= 0.5) {
    try {
      const { portionResolver } = await import('../../agents/shared/nutrition/portionResolver');
      const { macroLookup } = await import('../../agents/shared/nutrition/macroLookup');
      const { computeTEF } = await import('../../agents/tmwya/tef');
      const { computeTDEE } = await import('../../agents/tmwya/tdee');
      
      const naiveItems = message.split(/,| and | with | plus /i)
        .map(s => ({ name: s.trim(), amount: null as number | null, unit: null as string | null }))
        .filter(x => x.name.length > 0);
      
      const portioned = portionResolver(naiveItems);
      const estimate = await macroLookup(portioned);
      const tef = computeTEF(estimate.totals);
      const tdee = await computeTDEE(context.userId, estimate.totals, tef, new Date().toISOString());
      
      // Add macro info to system prompt for Personality to use
      systemPrompt += `\n\nUser just logged a meal. Here are the macros including fiber:
Total calories: ${estimate.totals.calories} kcal
Protein: ${estimate.totals.protein_g}g, Carbs: ${estimate.totals.carbs_g}g, Fat: ${estimate.totals.fat_g}g, Fiber: ${estimate.totals.fiber_g}g
TEF: ${tef.kcal} kcal
Remaining for today: ${tdee.remaining_kcal} kcal (${tdee.remaining_percentage.toFixed(1)}%)
Please acknowledge this meal logging and provide a brief summary.`;
      
      console.log('[AMA Fallback] Added meal data to prompt:', estimate.totals);
    } catch (e) {
      console.warn('[AMA Fallback] Failed to add meal data:', e);
    }
  }

  // Step 6: Call LLM (placeholder - will be implemented with actual API calls)
  const llmResult = await callLLM({
    system: systemPrompt,
    userMessage: message,
    messageHistory,
    roleData,
    modelSelection,
    userId: context.userId,
  });

  let llmResponse = typeof llmResult === 'string' ? llmResult : llmResult.message;
  const toolCalls = typeof llmResult === 'object' && llmResult.tool_calls ? { count: llmResult.tool_calls.length } : null; // Sanitized: just count
  const rawData = typeof llmResult === 'object' ? llmResult.raw_data : null;

  // Step 6.5: Execute post-agents if swarm has them (personality polish)
  // CRITICAL: Skip post-polish for structured data (Verification Sheets)
  const postMode = (import.meta?.env?.VITE_PERSONALITY_POST_EXECUTOR ?? 'combined') as 'combined' | 'sequential' | 'off';
  if (swarm?.agents?.some((a: any) => a.phase === 'post' && a.enabled)) {
    try {
      const { executePostAgents } = await import('../swarm/executor');
      // Pass roleData.type to skip polishing structured nutrition data
      const roleDataType = roleData?.type;
      const refined = await executePostAgents(llmResponse, swarm, context.userContext, postMode, roleDataType);
      console.log(`[personality-post] mode=${postMode}, roleDataType=${roleDataType ?? 'none'}, original=${llmResponse.length}, refined=${refined.length}`);
      llmResponse = refined;
    } catch (postError) {
      console.error('[personality-post] Post-agent execution failed, using original response:', postError);
      // Continue with original response
    }
  }

  // Strip any style JSON blocks that leaked through
  let assistantText = llmResponse ?? '';
  assistantText = stripLeadingStyleJSON(assistantText);

  // Graceful fallback: if the reply was ONLY style JSON, avoid showing nonsense
  if (!assistantText) {
    assistantText = "Okay — how can I help?";
  }

  // Step 7: Store assistant response with roleData for context retention
  await storeMessage(sessionId, 'assistant', assistantText, roleData || undefined);

  return {
    response: assistantText,
    intent: routeDecision.intent,
    intentConfidence: routeDecision.confidence || 0.8,
    modelUsed: getModelDisplayName(modelSelection),
    estimatedCost: cost,
    roleData,
    toolCalls,
    rawData,
  };
}

interface LLMCallParams {
  system: string;
  userMessage: string;
  messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  roleData: any;
  modelSelection: ModelSelection;
  userId: string;
}

/**
 * Helper function for OpenAI fallback calls
 */
async function callOpenAI(messages: any[], userId: string | undefined, temperature: number): Promise<{ message: string } | null> {
  const { getSupabase } = await import('../../lib/supabase');
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase.functions.invoke('openai-chat', {
      body: {
        messages,
        stream: false,
        userId,
        temperature,
        model: 'gpt-4o-mini',
        provider: 'openai'
      }
    });

    if (error || !data?.message) {
      console.error('[callOpenAI] Fallback failed:', error);
      return null;
    }

    return { message: data.message };
  } catch (e) {
    console.error('[callOpenAI] Exception:', e);
    return null;
  }
}

/**
 * Call LLM with prepared context via OpenAI edge function
 */
async function callLLM(params: LLMCallParams): Promise<{ message: string; tool_calls?: any; raw_data?: any }> {
  const { system, userMessage, messageHistory, roleData, modelSelection, userId } = params;

  console.log('[callLLM] Calling', getModelDisplayName(modelSelection));
  console.log('[callLLM] System prompt length:', system.length);
  console.log('[callLLM] Message history:', messageHistory.length, 'messages');
  console.log('[callLLM] Last 3 messages:', messageHistory.slice(-3).map(m => `${m.role}: ${m.content.substring(0, 50)}...`));
  console.log('[callLLM] Role data:', roleData ? 'present' : 'none');

  // Build messages array for OpenAI
  const messages = [
    { role: 'system' as const, content: system },
    ...messageHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    { role: 'user' as const, content: userMessage }
  ];

  // ✅ Route to correct edge function based on provider
  const { getSupabase } = await import('../../lib/supabase');
  const supabase = getSupabase();

  // ✅ Special handling for Gemini web research
  if (modelSelection.provider === 'gemini') {
    console.info('[callLLM] Using Gemini for web research');

    // Call gemini-chat with the user message as prompt
    const { data, error } = await supabase.functions.invoke('gemini-chat', {
      body: { prompt: userMessage }
    });

    if (error) {
      console.warn('[callLLM] Gemini failed, falling back to OpenAI:', error);
      // Fallback to OpenAI with a notice to the user
      const fallbackMessage = "Web search failed, answering from model knowledge.\n\n";
      const openaiResponse = await callOpenAI(messages, userId, modelSelection.temperature ?? 0.3);
      return {
        message: fallbackMessage + (openaiResponse?.message || "I apologize, but I'm having trouble responding right now."),
        tool_calls: null,
        raw_data: { fallback: true, original_error: error }
      };
    }

    if (data?.ok !== true) {
      console.warn('[callLLM] Gemini returned error:', data);
      // Fallback to OpenAI with a notice to the user
      const fallbackMessage = "Web search failed, answering from model knowledge.\n\n";
      const openaiResponse = await callOpenAI(messages, userId, modelSelection.temperature ?? 0.3);
      return {
        message: fallbackMessage + (openaiResponse?.message || "I apologize, but I'm having trouble responding right now."),
        tool_calls: null,
        raw_data: { fallback: true, gemini_error: data }
      };
    }

    // Gemini succeeded - format response with source
    const text = data.text || "No response content";
    const cite = data.cite || "";
    const citeTitle = data.citeTitle || "";

    let formattedMessage = text;
    if (cite) {
      formattedMessage += `\n\nSource: ${cite}`;
    }

    console.log('[callLLM] Gemini web research response, length:', formattedMessage.length);
    return {
      message: formattedMessage,
      tool_calls: null,
      raw_data: { gemini: true, cite, citeTitle }
    };
  }

  // ✅ OpenAI path
  const edgeFunction = 'openai-chat';
  console.info('[callLLM] Invoking edge function:', edgeFunction, 'provider:', modelSelection.provider);

  const { data, error } = await supabase.functions.invoke(edgeFunction, {
    body: {
      messages,
      stream: false,
      userId,
      temperature: modelSelection.temperature ?? 0.3,
      model: modelSelection.model,
      provider: modelSelection.provider
    }
  });

  if (error) {
    console.error('[callLLM] Edge function error:', error);
    throw new Error('Failed to get response from AI assistant');
  }

  if (!data?.message) {
    console.error('[callLLM] No message in response:', data);
    throw new Error('No response from AI assistant');
  }

  console.log('[callLLM] Response received, length:', data.message.length);
  if (data.tool_calls) {
    console.log('[callLLM] Tools executed:', data.tool_calls);
  }
  return { message: data.message, tool_calls: data.tool_calls, raw_data: data };
}
