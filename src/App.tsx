// src/App.tsx — normalized route tree (fixes unterminated JSX + ensures admin-only agents)

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import ProtectedRoute from './components/auth/ProtectedRoute';
import RootLayout from './layouts/RootLayout';

// Auth/public pages
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import Health from './pages/Health';
import BetaPendingPage from './pages/auth/BetaPendingPage';

// App pages
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import UsagePage from './pages/profile/UsagePage';
import VoicePage from './pages/VoicePage';
import ChatPage from './pages/ChatPage';
import { ChatHistoryPage } from './pages/ChatHistoryPage';
import CameraPage from './pages/CameraPage';
import TDEEOnboardingWizard from './pages/TDEEOnboardingWizard';
import TrainerDashboardPage from './pages/TrainerDashboardPage';
import AdminPage from './pages/AdminPage';

// Admin/agents
import AdminUsersPage from './pages/admin/AdminUsersPage';
import SwarmsPage from './pages/admin/SwarmsPage';
import AdminGuard from './components/guards/AdminGuard';
import RoleAccessPage from './pages/admin/RoleAccessPage';
import DiagnosticsPage from './pages/admin/DiagnosticsPage';
import ShopLensPage from './pages/agents/ShopLensPage';
import AgentConfigsPage from './pages/admin/AgentConfigsPage';
import { PersonalityEditorPage } from './pages/admin/PersonalityEditorPage';
import WelcomeBetaPage from './pages/WelcomeBetaPage';
import { TMWYATestPage } from './pages/TMWYATestPage';


function App() {

  return (
    <ErrorBoundary>
      <Toaster position="top-right" />
      <Routes>
        {/* PUBLIC ROUTES */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage onNavigate={() => {}} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage onNavigate={() => {}} />} />
        <Route path="/health" element={<Health />} />
        <Route path="/welcome-beta" element={<WelcomeBetaPage />} />
        <Route path="/beta-pending" element={<BetaPendingPage />} />

        {/* PROTECTED APP LAYOUT */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RootLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="profile/usage" element={<UsagePage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat-history" element={<ChatHistoryPage />} />
          <Route path="camera" element={<CameraPage />} />
          <Route path="voice" element={<VoicePage />} />
          <Route path="tmwya" element={<TMWYATestPage />} />
          <Route
            path="tdee"
            element={<TDEEOnboardingWizard onComplete={() => window.location.href = '/dashboard'} />}
          />
          <Route path="trainer-dashboard" element={<TrainerDashboardPage userProfile={null} />} />

          {/* ADMIN-ONLY NESTED ROUTES */}
          <Route path="admin">
            <Route index element={<AdminPage />} />
            <Route path="roles" element={<AdminGuard><RoleAccessPage /></AdminGuard>} />
            <Route path="diagnostics" element={<AdminGuard><DiagnosticsPage /></AdminGuard>} />
            <Route path="shoplens" element={<AdminGuard><ShopLensPage /></AdminGuard>} />
            <Route path="users" element={<AdminGuard><AdminUsersPage /></AdminGuard>} />
            <Route path="swarms" element={<AdminGuard><SwarmsPage /></AdminGuard>} />
            <Route path="agent-configs" element={<AdminGuard><AgentConfigsPage /></AdminGuard>} />
            {/* RETIRED: PersonalityEditorPage now shows retirement notice, not removed from routes for bookmark compatibility */}
            <Route path="personality" element={<AdminGuard><PersonalityEditorPage /></AdminGuard>} />
          </Route>
        </Route>

        {/* FALLBACK */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;