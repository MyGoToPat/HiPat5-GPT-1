import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2, MessageSquare } from 'lucide-react';
import { getChatHistoryGrouped, deleteChatSession, restoreChatSession, type ChatHistoryGroup } from '../lib/chatHistory';
import { getSupabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export const ChatHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [groupedChats, setGroupedChats] = useState<ChatHistoryGroup[]>([]);
  const [filteredGroups, setFilteredGroups] = useState<ChatHistoryGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Get userId on mount
  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        setUserId(data.user.id);
      }
    })();
  }, []);

  // Load chat history when userId available
  useEffect(() => {
    if (!userId) return;
    loadHistory();
  }, [userId]);

  const loadHistory = async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const groups = await getChatHistoryGrouped(userId, 90); // 90 days for full page
      setGroupedChats(groups);
      setFilteredGroups(groups);
    } catch (error) {
      console.error('[ChatHistory] Failed to load:', error);
      toast.error('Failed to load chat history');
    } finally {
      setIsLoading(false);
    }
  };

  // In-memory search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredGroups(groupedChats);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = groupedChats
      .map(group => ({
        ...group,
        chats: group.chats.filter(chat => 
          chat.title.toLowerCase().includes(query) || 
          chat.preview.toLowerCase().includes(query)
        )
      }))
      .filter(group => group.chats.length > 0);

    setFilteredGroups(filtered);
  }, [searchQuery, groupedChats]);

  const handleDeleteChat = async (chatId: string) => {
    if (!userId) return;

    const deletedChat = groupedChats.flatMap(g => g.chats).find(c => c.id === chatId);
    
    try {
      await deleteChatSession(chatId, userId);
      await loadHistory(); // Reload to update groups
      
      // Show undo toast
      toast.success(
        (t) => (
          <div className="flex items-center gap-2">
            <span>Chat moved to trash</span>
            <button
              onClick={async () => {
                await restoreChatSession(chatId, userId);
                await loadHistory();
                toast.dismiss(t.id);
              }}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Undo
            </button>
          </div>
        ),
        { duration: 10000 }
      );
    } catch (error) {
      console.error('[ChatHistory] Failed to delete:', error);
      toast.error('Failed to delete chat');
    }
  };

  const handleLoadChat = async (chatId: string) => {
    // Navigate to chat with session ID
    navigate(`/chat?t=${encodeURIComponent(chatId)}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading chat history...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Chat History</h1>
        <p className="text-sm text-gray-600">View and manage all your conversations with Pat</p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Grouped Chat List */}
      {filteredGroups.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {searchQuery ? 'No chats match your search' : 'No chat history yet'}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredGroups.map(group => (
            <div key={group.date} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {/* Date Header */}
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700">
                  {group.displayDate}
                  <span className="ml-2 text-xs text-gray-500 font-normal">
                    ({group.chats.length} {group.chats.length === 1 ? 'chat' : 'chats'})
                  </span>
                </h2>
              </div>

              {/* Chats */}
              <div className="divide-y divide-gray-100">
                {group.chats.map(chat => (
                  <div 
                    key={chat.id} 
                    className="group flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => handleLoadChat(chat.id)}
                  >
                    <MessageSquare className="mt-1 text-gray-400 flex-shrink-0" size={18} />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {chat.title}
                      </h3>
                      <p className="text-xs text-gray-600 truncate mt-0.5">
                        {chat.preview}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(chat.updated_at).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit' 
                        })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteChat(chat.id);
                      }}
                      className="p-2 text-red-600 rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Delete chat"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer CTA */}
      <div className="mt-8 text-center">
        <button
          onClick={() => navigate('/chat')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-medium transition-colors"
        >
          <MessageSquare size={20} />
          <span>Start New Chat</span>
        </button>
      </div>
    </div>
  );
};

