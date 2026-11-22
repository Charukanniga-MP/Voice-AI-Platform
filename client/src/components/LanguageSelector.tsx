import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Globe, Check, ChevronDown, Search, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.js';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';

interface LanguageSelectorProps {
  variant?: string;
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  onLanguageChange?: (lang: LanguageCode) => void;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  variant = 'dropdown',
  className = '',
  disabled = false,
  readOnly = false,
  onLanguageChange
}) => {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollListRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);

  const currentMeta = SUPPORTED_LANGUAGES[language] || SUPPORTED_LANGUAGES.en;

  // Filtered languages based on search query
  const languageList = useMemo(() => {
    const entries = Object.entries(SUPPORTED_LANGUAGES) as [
      LanguageCode,
      (typeof SUPPORTED_LANGUAGES)[LanguageCode]
    ][];

    if (!searchQuery.trim()) return entries;

    const q = searchQuery.toLowerCase().trim();
    return entries.filter(([code, meta]) => {
      return (
        code.toLowerCase().includes(q) ||
        meta.name.toLowerCase().includes(q) ||
        meta.nativeName.toLowerCase().includes(q)
      );
    });
  }, [searchQuery]);

  // Keep highlighted index in bounds
  useEffect(() => {
    setHighlightedIndex(0);
  }, [languageList.length]);

  // Handle open / close, viewport collision detection & auto-scroll
  useEffect(() => {
    if (isOpen) {
      // Check if near bottom of viewport to decide dropdown orientation
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        if (spaceBelow < 340 && spaceAbove > spaceBelow) {
          setOpenUpward(true);
        } else {
          setOpenUpward(false);
        }
      }

      // Auto-scroll to selected language when opened
      const timer = setTimeout(() => {
        if (selectedItemRef.current) {
          selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 50);

      return () => clearTimeout(timer);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1 < languageList.length ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : languageList.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (languageList[highlightedIndex]) {
          const [selectedCode] = languageList[highlightedIndex];
          handleSelectLanguage(selectedCode);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  const handleSelectLanguage = (code: LanguageCode) => {
    setLanguage(code);
    onLanguageChange?.(code);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  // Helper for label formatting as requested:
  // English -> "English"
  // Other -> "Name – NativeName" (e.g. "Tamil – தமிழ்")
  const formatLanguageLabel = (name: string, nativeName: string) => {
    if (name === nativeName) {
      return name;
    }
    return `${name} – ${nativeName}`;
  };

  // Render Dropdown Menu Content
  const renderDropdownMenu = () => (
    <div
      role="listbox"
      aria-label="Supported Languages"
      className={`absolute z-50 w-full sm:w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-white shadow-2xl border border-slate-200/90 py-2 transition-all duration-200 ease-out transform ${openUpward ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'
        } ${variant === 'dropdown' ? 'right-0' : 'left-0'}`}
      onKeyDown={handleKeyDown}
    >
      {/* Header & Title */}
      <div className="px-3.5 pt-1.5 pb-2 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
          <Globe className="w-3.5 h-3.5 text-blue-600" />
          <span>Select Your Preferred Language</span>
        </div>
        <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
          {languageList.length} Available
        </span>
      </div>

      {/* Search Input for Quick Filter */}
      <div className="p-2 border-b border-slate-100">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search language..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Language List */}
      <div
        ref={scrollListRef}
        tabIndex={-1}
        className="max-h-64 sm:max-h-72 overflow-y-auto overscroll-contain py-1 focus:outline-none kaira-dropdown-scroll"
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y'
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        {languageList.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">
            No language matching "{searchQuery}"
          </div>
        ) : (
          languageList.map(([code, meta], index) => {
            const isSelected = language === code;
            const isHighlighted = highlightedIndex === index;
            const formattedLabel = formatLanguageLabel(meta.name, meta.nativeName);

            return (
              <button
                key={code}
                ref={isSelected ? selectedItemRef : undefined}
                role="option"
                aria-selected={isSelected}
                type="button"
                onClick={() => handleSelectLanguage(code)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors cursor-pointer text-xs ${isSelected
                    ? 'bg-blue-50/90 text-blue-900 font-bold border-l-4 border-blue-600'
                    : isHighlighted
                      ? 'bg-slate-50 text-slate-900 font-medium'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-medium'
                  }`}
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="text-xs sm:text-sm font-bold tracking-tight truncate text-slate-900">
                    {formattedLabel}
                  </span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    {meta.name === meta.nativeName ? 'Default Language' : meta.name} • {meta.bcp47}
                  </span>
                </div>
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="px-3.5 pt-2 pb-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
        <span>Press <kbd className="px-1 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">↑</kbd> <kbd className="px-1 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">↓</kbd> to navigate</span>
        <span><kbd className="px-1 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">Esc</kbd> to close</span>
      </div>
    </div>
  );

  // Read-only Session Badge View (Used in Authenticated Views / Navbar to restrict changes after login)
  if (readOnly || variant === 'badge') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold select-none border border-slate-200/80 shadow-2xs ${className}`}
        title={`Session language: ${currentMeta.name} (${currentMeta.nativeName}). Fixed for current session. To change, please log out and select on the login page.`}
      >
        <Globe className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        <span className="font-bold text-slate-800">{currentMeta.nativeName}</span>
        <span className="text-slate-400 font-normal hidden sm:inline">({currentMeta.name})</span>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Language Dropdown (Top Navbar & Header)
  // --------------------------------------------------------------------------
  return (
    <div className={`relative inline-block text-left ${className}`} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 min-h-[38px] ${isOpen ? 'ring-2 ring-blue-500/20 border-blue-400' : ''
          }`}
      >
        <Globe className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <span className="font-bold text-slate-900">{currentMeta.nativeName}</span>
        <span className="text-slate-400 font-normal hidden sm:inline">({currentMeta.name})</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-600' : ''
            }`}
        />
      </button>

      {isOpen && renderDropdownMenu()}
    </div>
  );
};
