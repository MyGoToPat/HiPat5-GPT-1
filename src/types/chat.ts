export interface ChatMessage {
  id: string;
  text: string;
  timestamp: Date;
  isUser: boolean;
  meta?: {
    macros?: MacroPayload;
    route?: string;
    type?: 'tmwya.verify' | 'ama.meal_estimate_only';
    view?: any;
    items?: any[];
    totals?: any;
    tef?: any;
    tdee?: any;
    showDashboardButton?: boolean;
    sessionId?: string;
    cite?: string;
    citeTitle?: string;
    webVerified?: boolean;
    ama_nutrition_estimate?: boolean;
  };
  roleData?: {
    type?: 'tmwya.verify' | 'ama.meal_estimate_only';
    view?: any;
    items?: any[];
    totals?: any;
    tef?: any;
    tdee?: any;
  };
}

export interface MacroPayload {
  items: MacroItem[];
  totals: MacroTotals;
}

export interface MacroItem {
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface MacroTotals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ChatHistory {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  lastMessageAt: Date;
}

export interface ChatState {
  currentMessages: ChatMessage[];
  chatHistories: ChatHistory[];
  activeChatId: string | null;
}