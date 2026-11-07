import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';
import { translate, TranslationKey, translations } from '../i18n/index.js';
import { voiceService } from '../services/voice.js';
import { useAuth } from './AuthContext.js';

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  languages: typeof SUPPORTED_LANGUAGES;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'kaira_language';

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();

  const [language, setLanguageState] = useState<LanguageCode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY) as LanguageCode;
      if (saved && translations[saved]) {
        return saved;
      }
    }
    return 'en';
  });

  // Automatically sync with user.preferredLanguage when user logs in
  useEffect(() => {
    if (user?.preferredLanguage && translations[user.preferredLanguage as LanguageCode]) {
      const pref = user.preferredLanguage as LanguageCode;
      setLanguageState(pref);
      voiceService.setLanguage(pref);
      try {
        localStorage.setItem(STORAGE_KEY, pref);
      } catch {}
    }
  }, [user?.preferredLanguage]);

  // Sync language with voice service immediately and whenever language changes
  useEffect(() => {
    voiceService.setLanguage(language);
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {}
  }, [language]);

  const setLanguage = useCallback((newLang: LanguageCode) => {
    if (!translations[newLang]) return;
    setLanguageState(newLang);
    voiceService.setLanguage(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {}

    // Also attempt saving to backend if auth token exists
    const currentToken = token || localStorage.getItem('kaira_token');
    if (currentToken) {
      fetch('/api/auth/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify({ preferredLanguage: newLang })
      }).catch((err) => {
        console.warn('[LanguageContext] Could not sync language to backend:', err);
      });
    }
  }, [token]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      return translate(language, key, params);
    },
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, languages: SUPPORTED_LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
