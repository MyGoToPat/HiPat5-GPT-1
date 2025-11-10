import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import MainHeader from '../components/layout/MainHeader';
import NavigationSidebar from '../components/NavigationSidebar';
import TDEEGuard from '../components/auth/TDEEGuard';
import { ChatManager } from '../utils/chatManager';
import { getSupabase, getUserProfile } from '../lib/supabase';
import { getChatHistory, deleteChatSession, restoreChatSession, type ChatHistoryItem } from '../lib/chatHistory';
import toast from 'react-hot-toast';

type ChatSummary = {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
};

type UserProfile = { role?: 'admin' | 'trainer' | 'user' | string } | null;
function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/admin/roles')) return 'Role Access';
  if (pathname.startsWith('/admin/users')) return 'Users';
  if (pathname.startsWith('/admin/shoplens')) return 'ShopLens';
  if (pathname.startsWith('/admin/diagnostics')) return 'Diagnostics';
  if (pathname.startsWith('/admin')) return 'Admin';
  if (pathname.startsWith('/chat')) return 'Chat';
  if (pathname.startsWith('/voice')) return 'Voice';
  if (pathname.startsWith('/camera')) return 'Camera';
  if (pathname.startsWith('/profile')) return 'Profile';
  if (pathname.startsWith('/tdee')) return 'TDEE';
  if (pathname.startsWith('/trainer-dashboard')) return 'Trainer Dashboard';
  if (pathname.startsWith('/dashboard')) return 'Dashboard';
  return 'PAT';
}

export default function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [isNavOpen, setIsNavOpen] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [groupedChats, setGroupedChats] = useState<import('../lib/chatHistory').ChatHistoryGroup[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(null);

  // Load chat history helper
  const loadChats = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { 
      setChats([]); 
      return; 
    }
    
    try {
      const { getChatHistoryGrouped } = await import('../lib/chatHistory');
      const groups = await getChatHistoryGrouped(user.id, 30); // Limit 30 for sidebar
      setGroupedChats(groups);
      
      // Also keep flat list for backward compatibility
      const flatList = groups.flatMap(g => g.chats);
      setChats(flatList);
    } catch (err) {
      console.error('[Recent Chats] Failed to load:', err);
      setChats([]);
      setGroupedChats([]);
    }
  };

  // Load chats when nav opens
  useEffect(() => {
    if (isNavOpen) {
      loadChats();
    }
  }, [isNavOpen, location.pathname]);

  // Delete chat handler with undo
  const handleDeleteChat = async (chatId: string) => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const deletedChat = chats.find(c => c.id === chatId);
    
    try {
      await deleteChatSession(chatId, user.id);
      setChats(chats.filter(c => c.id !== chatId));
      
      // Show undo toast
      toast.success(
        (t) => (
          <div className="flex items-center gap-2">
            <span>Chat moved to trash</span>
            <button
              onClick={async () => {
                await restoreChatSession(chatId, user.id);
                await loadChats();
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
      console.error('[Recent Chats] Failed to delete:', error);
      toast.error('Failed to delete chat');
    }
  };

  // Load user profile for role-based navigation
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (!active || !user) return;

        const profile = await getUserProfile(user.id);
        if (!active) return;
        
        setUserProfile(profile);
      } catch (err) {
        console.error('Failed to load user profile', err);
        if (active) setUserProfile(null);
      }
    })();
    return () => { active = false; };
  }, []);
  const pageTitle = getPageTitle(location.pathname);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <MainHeader title={pageTitle} onMenuToggle={() => setIsNavOpen(true)} />

      <NavigationSidebar
        isOpen={isNavOpen}
        onClose={() => setIsNavOpen(false)}
        onNavigate={(path: string) => { setIsNavOpen(false); navigate(path); }}
        recentChats={chats}
        groupedChats={groupedChats}
        userProfile={userProfile}
        onDeleteChat={handleDeleteChat}
      />

      {/* Padding to clear fixed header: 56px (14 * 4) on mobile, 64px (16 * 4) on sm+ */}
      <main className="flex-1 overflow-y-auto pt-14 sm:pt-16">
        <TDEEGuard>
          <Outlet />
        </TDEEGuard>
      </main>
    </div>
  );
}