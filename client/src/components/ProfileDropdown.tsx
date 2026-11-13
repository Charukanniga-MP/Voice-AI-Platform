import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useLanguage } from '../context/LanguageContext.js';
import {
  LogOut,
  Shield,
  Headset,
  User as UserIcon,
  KeyRound,
  Phone,
  Globe,
  ChevronDown,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, LanguageCode } from '../types.js';

interface ProfileDropdownProps {
  className?: string;
}

export const ProfileDropdown: React.FC<ProfileDropdownProps> = ({ className = '' }) => {
  const { user, logout } = useAuth();
  const { t, language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on click outside or escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!user) return null;

  // Extract initials from user name (e.g., "Alex Morgan" -> "AM")
  const getInitials = (name?: string): string => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const initials = getInitials(user.name);

  // Role metadata styling and icon
  const getRoleConfig = (role: string) => {
    switch (role) {
      case 'admin':
        return {
          title: t('nav.admin_badge') || 'Administrator',
          badgeBg: 'bg-purple-100 text-purple-800 border-purple-200',
          avatarGradient: 'from-purple-600 via-purple-700 to-indigo-700',
          ringColor: 'ring-purple-200 hover:ring-purple-400 focus:ring-purple-400',
          icon: <Shield className="w-3.5 h-3.5 text-purple-600" />
        };
      case 'agent':
        return {
          title: t('nav.agent_badge') || 'Support Specialist',
          badgeBg: 'bg-blue-100 text-blue-800 border-blue-200',
          avatarGradient: 'from-blue-600 via-blue-700 to-cyan-600',
          ringColor: 'ring-blue-200 hover:ring-blue-400 focus:ring-blue-400',
          icon: <Headset className="w-3.5 h-3.5 text-blue-600" />
        };
      default:
        return {
          title: t('nav.customer_badge') || 'Customer',
          badgeBg: 'bg-emerald-100 text-emerald-800 border-emerald-200',
          avatarGradient: 'from-indigo-600 via-teal-600 to-emerald-600',
          ringColor: 'ring-emerald-200 hover:ring-emerald-400 focus:ring-emerald-400',
          icon: <UserIcon className="w-3.5 h-3.5 text-emerald-600" />
        };
    }
  };

  const roleConfig = getRoleConfig(user.role);

  const handleOpenResetPassword = () => {
    setIsOpen(false);
    window.location.hash = '#reset-password';
    window.history.pushState({}, document.title, '/reset-password');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleLogout = () => {
    setIsOpen(false);
    logout();
  };

  // Language display
  const userLangCode = (user.preferredLanguage || language || 'en') as LanguageCode;
  const langMeta = SUPPORTED_LANGUAGES[userLangCode] || SUPPORTED_LANGUAGES.en;

  return (
    <div className={`relative inline-block text-left ${className}`}>
      {/* Circular Profile Icon Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="User Profile Menu"
        className={`relative flex items-center gap-2 p-0.5 rounded-full ring-2 transition-all duration-200 cursor-pointer active:scale-95 focus:outline-hidden ${roleConfig.ringColor} ${isOpen ? 'ring-2 ring-indigo-500 shadow-md' : 'shadow-2xs'
          }`}
        title={`${user.name} (${roleConfig.title})`}
      >
        {/* Circular Avatar */}
        <div
          className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white font-extrabold text-sm sm:text-base bg-gradient-to-tr ${roleConfig.avatarGradient} shadow-inner select-none overflow-hidden`}
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              className="w-full h-full rounded-full object-cover"
              onError={e => {
                // Fallback to initials if avatar fails to load
                (e.currentTarget as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <span>{initials}</span>
          )}
        </div>

        {/* Active Online Status Indicator Dot */}
        <span
          className={`absolute bottom-0 right-0 sm:right-5 w-3 h-3 rounded-full border-2 border-white ${user.role === 'agent' && user.agentStatus === 'busy'
              ? 'bg-amber-500'
              : 'bg-emerald-500'
            }`}
          title={user.role === 'agent' ? `Status: ${user.agentStatus || 'available'}` : 'Active Session'}
        />

        {/* Subtle Chevron indicator for desktop */}
        <div className="hidden sm:flex items-center pr-1 text-slate-400 hover:text-slate-600">
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Floating Profile Dropdown Card */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full mt-2.5 w-76 sm:w-84 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-200/90 py-2.5 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right divide-y divide-slate-100"
          role="menu"
          aria-orientation="vertical"
        >
          {/* 1. User Identity Header */}
          <div className="px-4 py-3 bg-gradient-to-b from-slate-50/80 to-white">
            <div className="flex items-center gap-3.5">
              <div
                className={`w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-white font-black text-base bg-gradient-to-tr ${roleConfig.avatarGradient} shadow-md overflow-hidden select-none`}
              >
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-sm font-extrabold text-slate-900 truncate" title={user.name}>
                    {user.name}
                  </h4>
                  <span title="Verified Account">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate" title={user.email}>
                  {user.email}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border tracking-wide uppercase ${roleConfig.badgeBg}`}
                  >
                    {roleConfig.icon}
                    {roleConfig.title}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. User Profile Information Details */}
          <div className="px-4 py-2.5 space-y-2 text-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Profile Information
            </div>

            {/* Contact / Phone */}
            <div className="flex items-center justify-between text-slate-600 py-1">
              <span className="flex items-center gap-2 text-slate-500">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                Phone:
              </span>
              <span className="font-semibold text-slate-800 truncate max-w-[170px]">
                {user.phone || '+1 (555) 018-9921'}
              </span>
            </div>

            {/* Language */}
            <div className="flex items-center justify-between text-slate-600 py-1">
              <span className="flex items-center gap-2 text-slate-500">
                <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                Language:
              </span>
              <span className="font-semibold text-slate-800">
                {langMeta.name} ({langMeta.nativeName})
              </span>
            </div>

            {/* Role-specific status summary */}
            {user.role === 'agent' && (
              <div className="flex items-center justify-between text-slate-600 py-1">
                <span className="flex items-center gap-2 text-slate-500">
                  <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  Agent Status:
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] ${user.agentStatus === 'available'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${user.agentStatus === 'available' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                  />
                  {user.agentStatus === 'available' ? 'Available' : 'Busy'}
                </span>
              </div>
            )}

            {user.role === 'admin' && (
              <div className="flex items-center justify-between text-slate-600 py-1">
                <span className="flex items-center gap-2 text-slate-500">
                  <Shield className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                  Access Level:
                </span>
                <span className="font-bold text-purple-700 text-[11px] bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                  Full Administrator
                </span>
              </div>
            )}
          </div>

          {/* 3. Account Actions */}
          <div className="px-2 py-1.5 space-y-0.5">
            <button
              type="button"
              onClick={handleOpenResetPassword}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer text-left"
            >
              <KeyRound className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>Change / Reset Password</span>
            </button>
          </div>

          {/* 4. Logout Action */}
          <div className="p-1.5">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full min-h-[42px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-rose-600 hover:text-white hover:bg-rose-600 transition-all active:scale-[0.98] cursor-pointer shadow-2xs border border-rose-200 hover:border-transparent"
              title={t('nav.sign_out') || 'Sign Out'}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>{t('nav.sign_out') || 'Sign Out'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
