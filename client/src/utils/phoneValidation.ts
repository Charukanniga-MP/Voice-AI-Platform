/**
 * Indian Mobile Phone Number Validation & Normalization Utility (Client-side)
 */

export const AUTHORIZED_TEST_NUMBERS = [
  { raw: '6382472844', formatted: '+91 63824 72844', label: 'Test Line 1' },
  { raw: '9486742400', formatted: '+91 94867 42400', label: 'Test Line 2' },
  { raw: '7603917808', formatted: '+91 76039 17808', label: 'Test Line 3' },
  { raw: '6369791130', formatted: '+91 63697 91130', label: 'Test Line 4' },
  { raw: '6374613641', formatted: '+91 63746 13641', label: 'Test Line 5' },
  { raw: '9361864634', formatted: '+91 93618 64634', label: 'Test Line 6' }
];

export interface ClientPhoneValidation {
  isValid: boolean;
  normalizedNumber?: string;
  maskedNumber?: string;
  displayFormatted?: string;
  error?: string;
}

export function validateIndianMobile(input: string): ClientPhoneValidation {
  const raw = (input || '').trim();
  if (!raw) {
    return { isValid: false, error: 'Enter a 10-digit Indian mobile number.' };
  }

  let cleaned = raw.replace(/[\s\-().\t]/g, '');

  if (!/^\+?[0-9]+$/.test(cleaned)) {
    return { isValid: false, error: 'Only digits and optional leading +91 allowed.' };
  }

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  while (cleaned.startsWith('9191') && cleaned.length > 12) {
    cleaned = cleaned.substring(2);
  }

  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }

  let nationalNumber = '';
  if (cleaned.startsWith('91')) {
    nationalNumber = cleaned.substring(2);
    if (nationalNumber.startsWith('0')) {
      nationalNumber = nationalNumber.substring(1);
    }
  } else {
    nationalNumber = cleaned;
  }

  if (nationalNumber.length !== 10) {
    return {
      isValid: false,
      error: `Requires 10 digits (currently ${nationalNumber.length}).`
    };
  }

  const firstDigit = nationalNumber.charAt(0);
  if (!['6', '7', '8', '9'].includes(firstDigit)) {
    return {
      isValid: false,
      error: `Indian mobile must start with 6, 7, 8, or 9 (got ${firstDigit}).`
    };
  }

  const normalizedNumber = `+91${nationalNumber}`;
  const maskedNumber = `+91 ${nationalNumber.slice(0, 5)} ****${nationalNumber.slice(-1)}`;
  const displayFormatted = `+91 ${nationalNumber.slice(0, 5)} ${nationalNumber.slice(5)}`;

  return {
    isValid: true,
    normalizedNumber,
    maskedNumber,
    displayFormatted
  };
}

export function maskPhoneDisplay(phone?: string | null): string {
  if (!phone) return '—';
  const clean = phone.replace(/[^\d+]/g, '');
  if (clean.startsWith('+91') && clean.length === 13) {
    return `+91 ${clean.slice(3, 8)} ****${clean.slice(-1)}`;
  }
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ****${clean.slice(-1)}`;
  }
  return clean.length > 4 ? `${clean.slice(0, 4)}****` : clean;
}
