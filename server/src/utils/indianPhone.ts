/**
 * Utility for Indian Mobile Number Validation and Formatting
 * National Numbering Plan (DoT / TRAI):
 * - Country Code: +91
 * - Mobile Length: 10 Digits
 * - Valid Initial Digits: 6, 7, 8, 9
 */

export interface IndianPhoneValidationResult {
  isValid: boolean;
  normalized: string; // E.164 e.g. +919876543210
  nationalNumber: string; // 10 digits e.g. 9876543210
  formatted: string; // Display format e.g. +91 98765 43210
  masked: string; // Masked e.g. +91 98••• ••210
  error?: string;
}

export function validateIndianMobile(rawInput: string | null | undefined): IndianPhoneValidationResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      isValid: false,
      normalized: '',
      nationalNumber: '',
      formatted: '',
      masked: '',
      error: 'Please enter your Indian mobile number.'
    };
  }

  // Remove common separators (spaces, dashes, dots, parentheses)
  let cleaned = rawInput.trim().replace(/[\s\-\.\(\)]/g, '');

  // Detect and strip country code / leading zeros
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('0091')) {
    cleaned = cleaned.substring(4);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }

  // Check if contains non-digits
  if (!/^\d+$/.test(cleaned)) {
    return {
      isValid: false,
      normalized: '',
      nationalNumber: '',
      formatted: '',
      masked: '',
      error: 'Mobile number must contain digits only.'
    };
  }

  // Indian mobile numbers must be exactly 10 digits
  if (cleaned.length !== 10) {
    return {
      isValid: false,
      normalized: '',
      nationalNumber: '',
      formatted: '',
      masked: '',
      error: `Indian mobile number must be exactly 10 digits (entered ${cleaned.length}).`
    };
  }

  // Indian mobile numbers must begin with 6, 7, 8, or 9
  const firstDigit = cleaned.charAt(0);
  if (!['6', '7', '8', '9'].includes(firstDigit)) {
    return {
      isValid: false,
      normalized: '',
      nationalNumber: '',
      formatted: '',
      masked: '',
      error: 'Invalid Indian mobile number. Valid numbers start with 6, 7, 8, or 9.'
    };
  }

  const normalized = `+91${cleaned}`;
  const formatted = `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
  const masked = `+91 ${cleaned.slice(0, 2)}••• ••${cleaned.slice(8)}`;

  return {
    isValid: true,
    normalized,
    nationalNumber: cleaned,
    formatted,
    masked
  };
}
