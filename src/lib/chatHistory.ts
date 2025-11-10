import { supabase } from './supabase';

export interface ChatSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at?: string | null;
  active: boolean;
  session_type: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export async function createChatSession(userId: string, title?: string): Promise<ChatSession> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      user_id: userId,
      session_type: 'general',
      active: true,
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create chat session: ${error.message}`);
  }

  return data;
}

export async function getChatSessions(userId: string, limit = 20): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[chatHistory] Error fetching sessions:', error);
    return [];
  }

  return data || [];
}

export async function addChatMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: any
): Promise<ChatMessage> {
  // Generate client-side UUID to prevent conflicts
  const messageId = crypto.randomUUID();

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      id: messageId,
      session_id: sessionId,
      role,
      content,
      metadata: metadata || {},
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    // Enhanced error logging for debugging 409s
    console.error('[chatHistory] Failed to add message:', {
      error: error.message,
      code: error.code,
      details: error.details,
      sessionId,
      role,
      messageId
    });
    throw new Error(`Failed to add message: ${error.message}`);
  }

  return data;
}

export async function getChatMessages(sessionId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[chatHistory] Error fetching messages:', error);
    return [];
  }

  // Restore roleData from metadata if present
  return (data || []).map(msg => ({
    ...msg,
    roleData: msg.metadata?.roleData || msg.roleData
  }));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    throw new Error(`Failed to delete session: ${error.message}`);
  }
}

export async function getOrCreateTodaySession(userId: string): Promise<ChatSession> {
  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .gte('started_at', `${today}T00:00:00Z`)
    .lt('started_at', `${today}T23:59:59Z`)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  return createChatSession(userId);
}

export interface ChatHistoryItem {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
}

/**
 * Get user's chat history with previews (excluding deleted)
 */
export async function getChatHistory(userId: string, limit = 20): Promise<ChatHistoryItem[]> {
  const { data: sessions, error } = await supabase
    .from('chat_sessions')
    .select('id, title, created_at, last_activity_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('last_activity_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  // Enrich with last message preview AND check for real conversation
  const enriched = await Promise.all(
    (sessions ?? []).map(async (s) => {
      // Get all messages to check if there's a real conversation
      const { data: messages } = await supabase
        .from('chat_messages')
        .select('role, content, created_at')
        .eq('session_id', s.id)
        .order('created_at', { ascending: true });

      // Check if there's at least one user message AND one assistant response
      const hasUserMessage = messages?.some(m => m.role === 'user') ?? false;
      const hasAssistantResponse = messages?.some(m => m.role === 'assistant') ?? false;
      
      // Skip sessions without both question and response
      if (!hasUserMessage || !hasAssistantResponse) {
        return null;
      }

      // Get last message for preview
      const last = messages?.[messages.length - 1];
      const preview =
        typeof last?.content === 'string'
          ? last.content
          : (last?.content?.text ?? last?.content?.content ?? '');

      return {
        id: s.id,
        title: s.title || 'Untitled',
        preview: preview.slice(0, 50),
        updated_at: s.last_activity_at ?? last?.created_at ?? s.created_at,
      };
    })
  );

  // Filter out nulls (sessions without real conversations) and sort by activity time
  return enriched
    .filter((item): item is ChatHistoryItem => item !== null)
    .sort(
      (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
    );
}

export interface ChatHistoryGroup {
  date: string; // YYYY-MM-DD
  displayDate: string; // "Sunday, Nov 9, 2025"
  chats: ChatHistoryItem[];
}

/**
 * Get user's chat history grouped by calendar day in their timezone
 */
export async function getChatHistoryGrouped(userId: string, limit = 30): Promise<ChatHistoryGroup[]> {
  // Get user timezone
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle();
  
  const timezone = prefs?.timezone || 'America/New_York';

  // Fetch all sessions
  const sessions = await getChatHistory(userId, limit);

  // Group by calendar day using Intl.DateTimeFormat for safe parsing
  const grouped = new Map<string, ChatHistoryItem[]>();
  
  sessions.forEach(chat => {
    const date = new Date(chat.updated_at);
    
    // Use formatToParts to get YYYY-MM-DD safely
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    const dateKey = `${year}-${month}-${day}`;
    
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey)!.push(chat);
  });

  // Convert to array and sort by date (newest first)
  return Array.from(grouped.entries())
    .map(([date, chats]) => ({
      date,
      displayDate: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      }),
      chats: chats.sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Soft delete a chat session
 */
export async function deleteChatSession(sessionId: string, userId: string): Promise<void> {
  const { error} = await supabase
    .from('chat_sessions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Restore a deleted chat session
 */
export async function restoreChatSession(sessionId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ deleted_at: null })
    .eq('id', sessionId)
    .eq('user_id', userId);
  if (error) throw error;
}