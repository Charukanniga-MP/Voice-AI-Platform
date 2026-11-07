import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Navbar } from './components/Navbar.js';
import { LoginPage } from './pages/Login.js';
import { CustomerDashboard } from './pages/CustomerDashboard.js';
import { AgentDashboard } from './pages/AgentDashboard.js';
import { AdminDashboard } from './pages/AdminDashboard.js';
import { DevSyncMonitor } from './components/DevSyncMonitor.js';

const MainApp: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [currentRoleView, setCurrentRoleView] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-xl animate-bounce mb-3">
          <span className="font-extrabold text-xl">K</span>
        </div>
        <p className="text-xs font-semibold text-slate-500 tracking-wider uppercase animate-pulse">
          Loading KAIRA Voice Core...
        </p>
      </div>
    );
  }

  // Not logged in -> Show ONE Unified Login page
  if (!user) {
    return <LoginPage onAuthSuccess={(role) => setCurrentRoleView(role)} />;
  }

  // Determine view based on user's authorized role
  const role = user.role;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <Navbar />

      <div className="flex-1">
        {role === 'customer' && <CustomerDashboard />}
        {role === 'agent' && <AgentDashboard />}
        {role === 'admin' && <AdminDashboard />}
      </div>

      <DevSyncMonitor />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
