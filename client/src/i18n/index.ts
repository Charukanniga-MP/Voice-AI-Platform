import { en, TranslationKey } from './locales/en.js';
import { ta } from './locales/ta.js';
import { te } from './locales/te.js';
import { ml } from './locales/ml.js';
import { kn } from './locales/kn.js';
import { hi } from './locales/hi.js';
import { LanguageCode } from '../types.js';

export { en, ta, te, ml, kn, hi };
export type { TranslationKey };

export const translations: Record<LanguageCode, Record<TranslationKey, string>> = {
  en,
  ta,
  te,
  ml,
  kn,
  hi
};

export const translate = (
  lang: LanguageCode,
  key: TranslationKey,
  params?: Record<string, string | number>
): string => {
  const dict = translations[lang] || translations.en;
  let text = dict[key] || translations.en[key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
};

