import React from 'react';
import { useAuth } from '../context/AuthContext.js';
import { LanguageSelector } from './LanguageSelector.js';
import { ProfileDropdown } from './ProfileDropdown.js';
import { NotificationDropdown } from './NotificationDropdown.js';

export const Navbar: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
        {/* Official KAIRA Logo Only - Sized Responsively & Cleanly Visible */}
        <div className="flex items-center">
          <a
            href="/"
            onClick={(e) => {
              if (window.location.pathname === '/') {
                e.preventDefault();
              }
            }}
            className="flex items-center group transition-transform active:scale-95"
            title="KAIRA"
            aria-label="KAIRA Home"
          >
            <img
              src="/kaira-logo.png"
              alt="KAIRA"
              className="h-12 w-12 sm:h-14 sm:w-14 object-contain drop-shadow-xs group-hover:opacity-95 transition-all"
            />
          </a>
        </div>

        {/* Top-Right Controls: Notifications + Read-only Session Language Indicator + Circular Profile Icon Dropdown */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Centralized Real-time Notifications */}
          <NotificationDropdown />

          {/* Active Session Language Badge (Language is selected at login and fixed for session) */}
          <LanguageSelector variant="badge" readOnly={true} />

          {/* Vertical Divider */}
          <div className="h-6 sm:h-7 w-px bg-slate-200/80" />

          {/* Circular Profile Icon with User Details & Logout Dropdown */}
          <ProfileDropdown />
        </div>
      </div>
    </header>
  );
};
