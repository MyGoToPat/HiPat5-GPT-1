/**
 * POST-AGENT EXECUTOR
 * Executes post-phase agents to refine LLM responses
 * Supports combined (single LLM pass) and sequential (multiple passes) modes
 */

import type { SwarmConfig } from './loader';
import { resolvePromptRef } from './prompts';

export type ExecutionMode = 'combined' | 'sequential' | 'off';

export interface UserContext {
  audienceLevel?: string;
  firstName?: string;
  learningStyle?: string;
  [key: string]: any;
}

/**
 * Execute post-phase agents on a draft response
 * @param draft - Initial LLM response to refine
 * @param swarm - Swarm configuration with agents
 * @param context - User context for personalization
 * @param mode - Execution mode (combined, sequential, off)
 * @param roleDataType - Optional roleData.type to skip post-processing for structured data
 * @returns Refined response text
 */
export async function executePostAgents(
  draft: string,
  swarm: SwarmConfig,
  context?: UserContext,
  mode: ExecutionMode = 'combined',
  roleDataType?: string
): Promise<string> {
  // CRITICAL BYPASS: Do NOT polish structured nutrition data (Verification Sheets)
  if (roleDataType === 'tmwya.verify') {
    console.log('[post-executor] Skipping post-polish for structured nutrition data (roleData.type=tmwya.verify)');
    return draft;
  }

  if (mode === 'off') {
    console.log('[post-executor] Mode is OFF, returning draft unchanged');
    return draft;
  }

  const postAgents = (swarm.agents || [])
    .filter(a => a.enabled && (a.phase || '').toLowerCase() === 'post')
    .sort((a, b) => a.order - b.order);

  if (postAgents.length === 0) {
    console.log('[post-executor] No post agents found, returning draft unchanged');
    return draft;
  }

  console.log(`[post-executor] Executing ${postAgents.length} post agents in ${mode} mode`);

  if (mode === 'combined') {
    return await executeCombinedPass(draft, postAgents, context);
  } else {
    return await executeSequentialPass(draft, postAgents, context);
  }
}

/**
 * Combined mode: Single LLM call with all post agents as one meta-prompt
 */
async function executeCombinedPass(
  draft: string,
  postAgents: any[],
  context?: UserContext
): Promise<string> {
  // Build role cards for each post agent
  const roleCards = await Promise.all(
    postAgents.map(async agent => {
      const prompt = await resolvePromptRef(agent.promptRef);
      return `### ${agent.name}\n${prompt || 'No prompt found'}\n`;
    })
  );

  const combinedPostPrompt = [
    `You are the Personality Swarm post-governor.`,
    `Apply the following post agents to the DRAFT, in order, without adding new facts.`,
    ``,
    ...roleCards,
    ``,
    `Return ONLY the final, revised message.`,
    ``,
    `DRAFT:`,
    `"""`,
    draft,
    `"""`,
    ``,
    `Final message:`
  ].join('\n');

  try {
    const refined = await callLLMForPost(combinedPostPrompt, context);
    console.log(`[post-executor] Combined pass complete, length: ${refined.length}`);
    return refined;
  } catch (error) {
    console.error('[post-executor] Combined pass failed:', error);
    return draft; // Fallback to original draft
  }
}

/**
 * Sequential mode: Multiple LLM calls, one per agent
 */
async function executeSequentialPass(
  draft: string,
  postAgents: any[],
  context?: UserContext
): Promise<string> {
  let refined = draft;

  for (const agent of postAgents) {
    const prompt = await resolvePromptRef(agent.promptRef);
    if (!prompt) {
      console.warn(`[post-executor] Skipping ${agent.name}, no prompt found`);
      continue;
    }

    const agentPrompt = [
      `Agent: ${agent.name}`,
      ``,
      `Apply the following post rule-set to the DRAFT. No new facts.`,
      ``,
      prompt,
      ``,
      `DRAFT:`,
      `"""`,
      refined,
      `"""`,
      ``,
      `Final message only:`
    ].join('\n');

    try {
      refined = await callLLMForPost(agentPrompt, context);
      console.log(`[post-executor] ${agent.name} complete, length: ${refined.length}`);
    } catch (error) {
      console.error(`[post-executor] ${agent.name} failed:`, error);
      // Continue with previous version on error
    }
  }

  return refined;
}

/**
 * Call LLM for post-processing
 * Uses the same edge function with minimal configuration
 */
async function callLLMForPost(systemPrompt: string, context?: UserContext): Promise<string> {
  const { getSupabase } = await import('../../lib/supabase');
  const supabase = getSupabase();

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: 'Please apply the post-processing rules.' }
  ];

  const { data, error } = await supabase.functions.invoke('openai-chat', {
    body: {
      messages,
      stream: false,
      temperature: 0.4, // Lower temperature for faithful post-processing
      userId: context?.userId || null
    }
  });

  if (error) {
    throw new Error(`Post-processing LLM call failed: ${error.message}`);
  }

  if (!data?.message) {
    throw new Error('No message in post-processing response');
  }

  return data.message;
}
