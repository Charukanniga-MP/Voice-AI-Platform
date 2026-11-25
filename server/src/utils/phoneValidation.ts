/**
 * Indian Mobile Phone Number Validation & Normalization Utility
 *
 * Requirements:
 * - Country Code: +91 (India)
 * - Valid Indian Mobile Numbers: 10 digits starting with 6, 7, 8, or 9
 * - Normalize spaces, dashes, parentheses, dots
 * - Prevent duplicate country codes (e.g. +91+91..., +910..., 919876543210)
 * - Safe masking for application logs and UI (never expose full numbers in logs)
 * - Controlled test allowlist management
 */

// Authorized demonstration test numbers provided for this evaluation
export const AUTHORIZED_TEST_NUMBERS = [
  '+916382472844',
  '+919486742400',
  '+917603917808',
  '+916369791130',
  '+916374613641',
  '+919361864634'
] as const;

export interface PhoneValidationResult {
  isValid: boolean;
  normalizedNumber?: string; // E.164 format: +91XXXXXXXXXX
  maskedNumber?: string;     // e.g. +91 63824 ****4
  rawInput: string;
  error?: string;
  isTestNumber?: boolean;
}

/**
 * Normalizes and validates an Indian mobile phone number
 */
export function validateAndNormalizeIndianPhone(input: string): PhoneValidationResult {
  const rawInput = (input || '').trim();

  if (!rawInput) {
    return {
      isValid: false,
      rawInput,
      error: 'Phone number cannot be empty.'
    };
  }

  // Remove common formatting characters: spaces, dashes, parentheses, dots, tabs
  let cleaned = rawInput.replace(/[\s\-\(\)\.\t]/g, '');

  // Check for invalid non-digit characters (allowing leading '+')
  if (!/^\+?[0-9]+$/.test(cleaned)) {
    return {
      isValid: false,
      rawInput,
      error: `Phone number contains invalid characters: "${rawInput}". Only numbers and optional leading + are allowed.`
    };
  }

  // Handle leading '+'
  const hasPlus = cleaned.startsWith('+');
  if (hasPlus) {
    cleaned = cleaned.substring(1);
  }

  // Detect duplicate 91 prefixes (e.g., 91919876543210 or +91919876543210)
  while (cleaned.startsWith('9191') && cleaned.length > 12) {
    cleaned = cleaned.substring(2);
  }

  // Strip leading national trunk prefix '0' (e.g. 09876543210 -> 9876543210)
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }

  let nationalNumber = '';

  if (cleaned.startsWith('91')) {
    // Has 91 country prefix
    nationalNumber = cleaned.substring(2);
    // Handle leading 0 after 91: e.g. +9109876543210
    if (nationalNumber.startsWith('0')) {
      nationalNumber = nationalNumber.substring(1);
    }
  } else {
    // 10-digit number without country code
    nationalNumber = cleaned;
  }

  // Validate Indian mobile 10-digit format
  if (nationalNumber.length !== 10) {
    return {
      isValid: false,
      rawInput,
      error: `Invalid length (${nationalNumber.length} digits). Indian mobile numbers must be exactly 10 digits.`
    };
  }

  // TRAI / Indian National Numbering Plan: mobile numbers must start with 6, 7, 8, or 9
  const firstDigit = nationalNumber.charAt(0);
  if (!['6', '7', '8', '9'].includes(firstDigit)) {
    return {
      isValid: false,
      rawInput,
      error: `Invalid Indian mobile number: Starts with "${firstDigit}". Indian mobile numbers must start with 6, 7, 8, or 9.`
    };
  }

  const normalizedNumber = `+91${nationalNumber}`;
  const isTestNumber = AUTHORIZED_TEST_NUMBERS.includes(normalizedNumber as any);
  const maskedNumber = maskPhoneNumber(normalizedNumber);

  return {
    isValid: true,
    normalizedNumber,
    maskedNumber,
    rawInput,
    isTestNumber
  };
}

/**
 * Masks a phone number to protect customer privacy in logs and UI
 * Example: +916382472844 -> +91 63824 ****4
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return '***';
  const clean = phone.replace(/[^\d+]/g, '');
  if (clean.length < 8) return '****';

  if (clean.startsWith('+91') && clean.length === 13) {
    // +91 63824 ****4
    const first5 = clean.slice(3, 8);
    const last1 = clean.slice(-1);
    return `+91 ${first5} ****${last1}`;
  }

  // Generic masking
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-2);
  return `${prefix}****${suffix}`;
}

/**
 * Checks if a normalized number is in the authorized test allowlist
 */
export function isNumberInTestAllowlist(normalizedNumber: string): boolean {
  return AUTHORIZED_TEST_NUMBERS.includes(normalizedNumber as any);
}
