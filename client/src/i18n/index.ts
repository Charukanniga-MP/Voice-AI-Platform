import { en, TranslationKey } from './locales/en.js';
import { ta } from './locales/ta.js';
import { te } from './locales/te.js';
import { ml } from './locales/ml.js';
import { kn } from './locales/kn.js';
import { hi } from './locales/hi.js';
import { bn } from './locales/bn.js';
import { mr } from './locales/mr.js';
import { gu } from './locales/gu.js';
import { pa } from './locales/pa.js';
import { ur } from './locales/ur.js';
import { ar } from './locales/ar.js';
import { fr } from './locales/fr.js';
import { de } from './locales/de.js';
import { es } from './locales/es.js';
import { zh } from './locales/zh.js';
import { ja } from './locales/ja.js';
import { ko } from './locales/ko.js';
import { it } from './locales/it.js';
import { pt } from './locales/pt.js';
import { ru } from './locales/ru.js';
import { tr } from './locales/tr.js';
import { id } from './locales/id.js';
import { vi } from './locales/vi.js';
import { LanguageCode } from '../types.js';

export {
  en, ta, te, ml, kn, hi,
  bn, mr, gu, pa, ur, ar,
  fr, de, es, zh, ja, ko,
  it, pt, ru, tr, id, vi
};
export type { TranslationKey };

export const translations: Record<string, Partial<Record<TranslationKey, string>>> = {
  en,
  ta,
  te,
  ml,
  kn,
  hi,
  bn,
  mr,
  gu,
  pa,
  ur,
  ar,
  fr,
  de,
  es,
  zh,
  ja,
  ko,
  it,
  pt,
  ru,
  tr,
  id,
  vi
};

export const translate = (
  lang: LanguageCode | string,
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
