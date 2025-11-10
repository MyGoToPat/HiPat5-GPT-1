import React, { useState, useEffect } from 'react';
import { X, Edit, Mic, BarChart3, User, Users, Settings, Zap, AlertCircle, Network } from 'lucide-react';
import { NAV_ITEMS } from '../config/navItems';
import { useRole } from '../hooks/useRole';
import { supabase } from '../lib/supabase';
import { getFeatureFlags, type FeatureFlags } from '../lib/featureFlags';

type ChatSummary = { id: string; title: string; preview: string; updated_at: string; };
type UserProfile = { role?: 'admin' | 'trainer' | 'user' | string } | null;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  recentChats: ChatSummary[];
  groupedChats?: import('../lib/chatHistory').ChatHistoryGroup[];
  userProfile?: UserProfile;
  onDeleteChat?: (id: string) => void;
};

export default function NavigationSidebar({ isOpen, onClose, onNavigate, recentChats, groupedChats, userProfile, onDeleteChat }: Props) {
  const { can } = useRole();
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [isLowBalance, setIsLowBalance] = useState(false);
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);

  // Format relative time for chat history
  const formatRelativeTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  useEffect(() => {
    if (isOpen) {
      loadCreditBalance();
      loadFeatureFlags();
    }
  }, [isOpen]);

  async function loadCreditBalance() {
    try {
      const { data, error } = await supabase
        .from('v_user_credits')
        .select('balance_usd, is_unlimited, plan')
        .maybeSingle();

      if (error) throw error;

      const unlimited = data?.is_unlimited || false;
      setIsUnlimited(unlimited);

      if (unlimited) {
        setCreditBalance(null);
        setIsLowBalance(false);
      } else {
        const balance = data?.balance_usd || 0;
        setCreditBalance(balance);
        setIsLowBalance(balance < 0.20);
      }
    } catch (err) {
      console.error('Failed to load credit balance:', err);
      setCreditBalance(null);
    }
  }

  async function loadFeatureFlags() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const flags = await getFeatureFlags(user.id);
      setFeatureFlags(flags);
    } catch (err) {
      console.error('Failed to load feature flags:', err);
    }
  }

  if (!isOpen) return null;

  const role = (userProfile?.role ?? 'user') as 'admin' | 'trainer' | 'user';

  // Filter function that checks roles, privileges, AND feature flags
  const filterNavItems = (section: 'primary' | 'admin' | 'utilities') => {
    return NAV_ITEMS.filter(i => {
      // Section filter
      if (i.section !== section) return false;

      // Role filter
      if (i.roles && !i.roles.includes(role)) return false;

      // Privilege filter
      if (i.requirePrivilege && !can(i.requirePrivilege)) return false;

      // Feature flag filter (only if item has a flag AND flags are loaded)
      if (i.featureFlag && featureFlags) {
        return featureFlags[i.featureFlag] === true;
      }

      return true;
    });
  };

  const primary   = filterNavItems('primary');
  const admin     = filterNavItems('admin');
  const utilities = filterNavItems('utilities');

  const iconFor = (label: string) => {
    switch (label) {
      case 'New chat': return Edit;
      case 'Talk With Pat': return Mic;
      case 'Dashboard': return BarChart3;
      case 'Profile': return User;
      case 'Client Management': return Users;
      case 'Role Access': return Settings;
      case 'User Management': return Settings;
      case 'Agent Config (Legacy)': return Network;
      case 'Swarm Versions (Enhanced)': return Network;
      case 'ShopLens': return Settings;
      case 'TDEE Calculator': return Zap;
      default: return undefined;
    }
  };

  const Row = ({ label, to }: { label: string; to: string }) => {
    const Icon = iconFor(label);
    return (
      <button
        onClick={() => { onNavigate(to); onClose(); }}
        className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm flex items-center gap-3"
      >
        {Icon ? <Icon size={16} className="text-gray-600" /> : null}
        <span className="font-medium text-gray-800">{label}</span>
      </button>
    );
  };

  const Section = ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div className="mb-3">
      {title ? <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">{title}</div> : null}
      <div className="space-y-1">{children}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute left-0 top-0 h-full w-[320px] max-w-[85vw] bg-white text-gray-900 shadow-xl flex flex-col">
        {/* Header - fixed */}
        <div className="flex items-center justify-between h-12 px-4 border-b flex-shrink-0">
          <div className="text-sm font-semibold">Menu</div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {/* Credit Balance Display */}
          {(creditBalance !== null || isUnlimited) && (
            <div className="mx-2 mb-4 p-3 rounded-lg border bg-gray-50">
              <div className="text-xs text-gray-600 mb-1">Credit Balance</div>
              <div className="flex items-center justify-between">
                {isUnlimited ? (
                  <div className="text-lg font-bold text-green-600">
                    ∞ Unlimited
                  </div>
                ) : (
                  <>
                    <div className={`text-lg font-bold ${
                      isLowBalance ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      ${creditBalance!.toFixed(2)}
                    </div>
                    {isLowBalance && (
                      <div className="flex items-center gap-1 text-xs text-red-600">
                        <AlertCircle size={14} />
                        Low
                      </div>
                    )}
                  </>
                )}
              </div>
              {!isUnlimited && (
                <button
                  onClick={() => { onNavigate('/profile/usage'); onClose(); }}
                  className="mt-2 w-full text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Top Up
                </button>
              )}
            </div>
          )}

          <Section>
            {primary.map(i => <Row key={i.key} label={i.label} to={i.path} />)}
          </Section>

          {admin.length > 0 && (
            <Section title="Admin">
              {admin.map(i => <Row key={i.key} label={i.label} to={i.path} />)}
            </Section>
          )}

          <Section title="Utilities">
            {utilities.map(i => <Row key={i.key} label={i.label} to={i.path} />)}
          </Section>

          <Section title="Recent Chats">
            {(groupedChats && groupedChats.length > 0) ? (
              <>
                {groupedChats.map(group => (
                  <details key={group.date} open={group === groupedChats[0]} className="mb-2">
                    <summary className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded text-sm font-medium text-gray-700 list-none">
                      <span className="flex items-center justify-between">
                        <span>{group.displayDate}</span>
                        <span className="text-xs text-gray-500">({group.chats.length})</span>
                      </span>
                    </summary>
                    <div className="pl-2 mt-1">
                      {group.chats.map(chat => (
                        <div 
                          key={chat.id} 
                          className="group flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50"
                        >
                          <button
                            className="flex-1 text-left min-w-0"
                            onClick={() => onNavigate(`/chat?t=${encodeURIComponent(chat.id)}`)}
                          >
                            <div className="text-sm text-gray-700 truncate">
                              {chat.title}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {chat.preview}
                            </div>
                          </button>
                          {onDeleteChat && (
                            <button
                              className="ml-2 p-1 text-red-600 rounded hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteChat(chat.id);
                              }}
                              aria-label="Delete chat"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
                <button
                  onClick={() => onNavigate('/chat-history')}
                  className="w-full px-3 py-2 mt-2 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                >
                  View all history →
                </button>
              </>
            ) : (
              <div className="px-2 py-1 text-xs text-gray-500">No chat history yet</div>
            )}
          </Section>
        </nav>

        {/* Footer - fixed at bottom */}
        <div className="border-t px-2 py-3 flex-shrink-0">
          <button
            className="w-full text-left px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm transition-colors"
            onClick={() => { onNavigate('/login?signout=1'); onClose(); }}
          >
            Sign Out
          </button>
        </div>
      </aside>
    </div>
  );
}