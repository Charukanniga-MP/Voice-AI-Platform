import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LanguageProvider } from './context/LanguageContext.js';
import { Navbar } from './components/Navbar.js';
import { LoginPage } from './pages/Login.js';
import { ResetPasswordPage } from './pages/ResetPassword.js';

// Lazy-loaded role dashboards for optimal initial bundle loading speed and memory efficiency
const CustomerDashboard = lazy(() =>
  import('./pages/CustomerDashboard.js').then(module => ({ default: module.CustomerDashboard }))
);
const AgentDashboard = lazy(() =>
  import('./pages/AgentDashboard.js').then(module => ({ default: module.AgentDashboard }))
);
const AdminDashboard = lazy(() =>
  import('./pages/AdminDashboard.js').then(module => ({ default: module.AdminDashboard }))
);

const RoleLoader: React.FC<{ roleName: string }> = ({ roleName }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-12 min-h-[400px]">
    <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg animate-bounce mb-3">
      <span className="font-extrabold text-base">K</span>
    </div>
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider animate-pulse">
      Preparing {roleName} workspace...
    </p>
  </div>
);

const checkIsResetRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const search = new URLSearchParams(window.location.search);
  return (
    path === '/reset-password' ||
    path.startsWith('/reset-password') ||
    search.get('view') === 'reset-password' ||
    search.get('mode') === 'reset' ||
    (search.has('token') && !search.has('user'))
  );
};

const MainApp: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [currentRoleView, setCurrentRoleView] = useState<string | null>(null);
  const [isResetView, setIsResetView] = useState<boolean>(checkIsResetRoute);

  useEffect(() => {
    const handleUrlChange = () => {
      setIsResetView(checkIsResetRoute());
    };
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

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

  // Password Reset View: ALWAYS rendered whenever the route or query is reset-password
  if (isResetView) {
    return (
      <ResetPasswordPage
        onBackToLogin={() => {
          window.history.pushState({}, document.title, '/');
          setIsResetView(false);
        }}
      />
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
        <Suspense fallback={<RoleLoader roleName={role} />}>
          {role === 'customer' && <CustomerDashboard />}
          {role === 'agent' && <AgentDashboard />}
          {role === 'admin' && <AdminDashboard />}
        </Suspense>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <MainApp />
      </LanguageProvider>
    </AuthProvider>
  );
}
