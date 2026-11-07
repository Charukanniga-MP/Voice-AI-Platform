import React, { useState, useRef, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.js';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';

interface LanguageSelectorProps {
  variant?: 'dropdown' | 'pills';
  className?: string;
  disabled?: boolean;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  variant = 'dropdown',
  className = '',
  disabled = false
}) => {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentMeta = SUPPORTED_LANGUAGES[language] || SUPPORTED_LANGUAGES.en;

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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

  if (variant === 'pills') {
    return (
      <div className={`grid grid-cols-2 sm:grid-cols-5 gap-2.5 ${className}`}>
        {(Object.entries(SUPPORTED_LANGUAGES) as [LanguageCode, (typeof SUPPORTED_LANGUAGES)[LanguageCode]][]).map(
          ([code, meta]) => {
            const isSelected = language === code;
            return (
              <button
                key={code}
                type="button"
                disabled={disabled}
                onClick={() => setLanguage(code)}
                className={`px-3 py-2.5 rounded-2xl text-left border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white text-indigo-900 border-white shadow-md font-bold scale-[1.02]'
                    : 'bg-white/10 text-white border-white/20 hover:bg-white/20 hover:border-white/40'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div className="text-sm font-extrabold leading-tight">{meta.nativeName}</div>
                <div
                  className={`text-[11px] ${
                    isSelected ? 'text-indigo-600 font-semibold' : 'text-blue-200'
                  }`}
                >
                  {meta.name}
                </div>
              </button>
            );
          }
        )}
      </div>
    );
  }

  // Default: Dropdown Variant
  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
      >
        <Globe className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <span className="font-bold text-slate-900">{currentMeta.nativeName}</span>
        <span className="text-slate-400 font-normal">({currentMeta.name})</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-52 rounded-2xl bg-white shadow-xl border border-slate-200/90 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
            Select Language
          </div>
          {(Object.entries(SUPPORTED_LANGUAGES) as [LanguageCode, (typeof SUPPORTED_LANGUAGES)[LanguageCode]][]).map(
            ([code, meta]) => {
              const isSelected = language === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    setLanguage(code);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors cursor-pointer text-left ${
                    isSelected
                      ? 'bg-blue-50 text-blue-700 font-bold'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-medium'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{meta.nativeName}</span>
                    <span className="text-[10px] text-slate-400">{meta.name}</span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                </button>
              );
            }
          )}
        </div>
      )}
    </div>
  );
};

