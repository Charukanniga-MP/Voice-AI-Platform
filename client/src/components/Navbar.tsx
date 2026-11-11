import React from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useLanguage } from '../context/LanguageContext.js';
import { LanguageSelector } from './LanguageSelector.js';
import { LogOut, Shield, Headset, User as UserIcon, KeyRound } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { t } = useLanguage();

  if (!user) return null;

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            <Shield className="w-3.5 h-3.5 text-purple-600" />
            {t('nav.admin_badge')}
          </span>
        );
      case 'agent':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            <Headset className="w-3.5 h-3.5 text-blue-600" />
            {t('nav.agent_badge')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <UserIcon className="w-3.5 h-3.5 text-emerald-600" />
            {t('nav.customer_badge')}
          </span>
        );
    }
  };

  const handleOpenResetPassword = () => {
    window.history.pushState({}, document.title, '/reset-password');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Official KAIRA Technologies Branding */}
        <div className="flex items-center gap-3">
          <img
            src="/kaira-logo.png"
            alt="KAIRA Technologies Logo"
            className="h-10 w-10 object-contain drop-shadow-2xs"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-slate-900">KAIRA</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                {t('nav.branding_tag')}
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden sm:block">{t('nav.branding_sub')}</p>
          </div>
        </div>

        {/* User Info & Actions */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Global Language Selector Dropdown */}
          <LanguageSelector variant="dropdown" />

          <div className="hidden sm:block h-6 w-px bg-slate-200" />

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-slate-800">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
            {getRoleBadge(user.role)}
          </div>

          <div className="h-6 w-px bg-slate-200" />

          {/* Direct Password Reset / Change Action */}
          <button
            type="button"
            onClick={handleOpenResetPassword}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors cursor-pointer border border-indigo-200"
            title="Reset or Change Password"
          >
            <KeyRound className="w-4 h-4 text-indigo-600" />
            <span className="hidden sm:inline">Reset Password</span>
          </button>

          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-red-200"
            title={t('nav.sign_out')}
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">{t('nav.sign_out')}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
