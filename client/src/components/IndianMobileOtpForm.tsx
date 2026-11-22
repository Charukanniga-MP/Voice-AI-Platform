import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  User,
  ShieldCheck,
  Check
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { useLanguage } from '../context/LanguageContext.js';

interface IndianMobileOtpFormProps {
  onSuccess: (role: string) => void;
  onError: (msg: string | null) => void;
  onSuccessMsg: (msg: string | null) => void;
}

export const IndianMobileOtpForm: React.FC<IndianMobileOtpFormProps> = ({
  onSuccess,
  onError,
  onSuccessMsg
}) => {
  const { sendOtp, verifyOtp } = useAuth();
  const { t } = useLanguage();

  // Step: 'phone' | 'verify'
  const [step, setStep] = useState<'phone' | 'verify'>('phone');

  // Input states
  const [phoneNumber, setPhoneNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);

  // Timers & Status
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [expiresInSeconds, setExpiresInSeconds] = useState(300);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [formattedPhone, setFormattedPhone] = useState('');

  // Refs for OTP 6-box input
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // OTP expiration countdown timer
  useEffect(() => {
    if (step !== 'verify' || expiresInSeconds <= 0) return;
    const timer = setInterval(() => {
      setExpiresInSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, expiresInSeconds]);

  // Clean and format Indian phone number input (e.g. "98765 43210")
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onError(null);
    onSuccessMsg(null);
    let val = e.target.value.replace(/\D/g, '');

    // Strip leading 91 or 0 if user pastes 12 or 11 digits
    if (val.startsWith('91') && val.length === 12) {
      val = val.substring(2);
    } else if (val.startsWith('0') && val.length === 11) {
      val = val.substring(1);
    }

    // Limit to max 10 digits
    if (val.length > 10) {
      val = val.substring(0, 10);
    }

    setPhoneNumber(val);
  };

  // Check if Indian mobile number is valid (10 digits starting with 6, 7, 8, or 9)
  const isIndianMobileValid = phoneNumber.length === 10 && ['6', '7', '8', '9'].includes(phoneNumber.charAt(0));

  // Format 10 digits as "98765 43210" for display
  const displayFormattedNumber = phoneNumber.length > 5
    ? `${phoneNumber.slice(0, 5)} ${phoneNumber.slice(5)}`
    : phoneNumber;

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 1. Submit Request to Send Real-Time OTP via SMS
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onSuccessMsg(null);

    if (!phoneNumber) {
      onError('Please enter your 10-digit Indian mobile number.');
      return;
    }

    if (phoneNumber.length !== 10) {
      onError(`Indian mobile numbers must be 10 digits long (currently entered ${phoneNumber.length}).`);
      return;
    }

    if (!['6', '7', '8', '9'].includes(phoneNumber.charAt(0))) {
      onError('Invalid Indian mobile number. Valid numbers start with 6, 7, 8, or 9.');
      return;
    }

    setLoading(true);
    try {
      const normalized = `+91${phoneNumber}`;
      const res = await sendOtp(normalized);

      setMaskedPhone(res.masked || `+91 ${phoneNumber.slice(0, 2)}••• ••${phoneNumber.slice(8)}`);
      setFormattedPhone(res.formatted || `+91 ${phoneNumber.slice(0, 5)} ${phoneNumber.slice(5)}`);
      setResendCooldown(res.retryAfterSeconds || 30);
      setExpiresInSeconds(res.expiresInSeconds || 300);
      setOtpDigits(['', '', '', '', '', '']);
      setStep('verify');

      onSuccessMsg(`Verification code dispatched via SMS to ${res.formatted || normalized}.`);

      // Auto-focus first OTP digit box after state transition
      setTimeout(() => {
        digitInputRefs.current[0]?.focus();
      }, 100);
    } catch (err: any) {
      onError(err.message || 'Failed to dispatch verification code. Please check your number.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || loading) return;
    onError(null);
    onSuccessMsg(null);

    setLoading(true);
    try {
      const normalized = `+91${phoneNumber}`;
      const res = await sendOtp(normalized);
      setResendCooldown(res.retryAfterSeconds || 30);
      setExpiresInSeconds(res.expiresInSeconds || 300);
      setOtpDigits(['', '', '', '', '', '']);
      onSuccessMsg(`A fresh verification code has been dispatched to ${formattedPhone || normalized}.`);
      digitInputRefs.current[0]?.focus();
    } catch (err: any) {
      onError(err.message || 'Failed to resend verification code.');
    } finally {
      setLoading(false);
    }
  };

  // Handle single digit input in the 6-box OTP interface
  const handleDigitChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '');
    const newDigits = [...otpDigits];

    if (!val) {
      newDigits[index] = '';
      setOtpDigits(newDigits);
      return;
    }

    // Handle single digit entry
    newDigits[index] = val.slice(-1);
    setOtpDigits(newDigits);

    // Auto-advance to next input
    if (index < 5 && val) {
      digitInputRefs.current[index + 1]?.focus();
    }
  };

  // Handle backspace navigation across OTP boxes
  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!otpDigits[index] && index > 0) {
        digitInputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }
  };

  // Handle pasting full 6-digit code
  const handleDigitPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || '';
    }
    setOtpDigits(newDigits);

    const focusIdx = Math.min(pasted.length, 5);
    digitInputRefs.current[focusIdx]?.focus();
  };

  // 3. Submit OTP for Verification & Sign In
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onSuccessMsg(null);

    const fullOtp = otpDigits.join('');
    if (fullOtp.length !== 6) {
      onError('Please enter all 6 digits of your verification code.');
      return;
    }

    if (expiresInSeconds <= 0) {
      onError('Verification code has expired. Please click "Resend Code" to receive a fresh OTP.');
      return;
    }

    setLoading(true);
    try {
      const normalized = `+91${phoneNumber}`;
      const authenticatedUser = await verifyOtp(normalized, fullOtp, customerName.trim());
      onSuccessMsg(`Welcome, ${authenticatedUser.name}! Authentication verified.`);
      onSuccess(authenticatedUser.role);
    } catch (err: any) {
      onError(err.message || 'Invalid verification code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------- */}
      {/* STEP 1: ENTER INDIAN MOBILE NUMBER                            */}
      {/* ------------------------------------------------------------- */}
      {step === 'phone' && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                {t('auth.mobile_number_label')}
              </label>
              {isIndianMobileValid && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <Check className="w-3 h-3" /> Valid Indian Number
                </span>
              )}
            </div>

            {/* Indian Mobile Input Group with Country Code Selector & Flag */}
            <div className="relative flex rounded-xl shadow-2xs border border-slate-200 bg-slate-50 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:bg-white transition-all overflow-hidden">
              {/* Indian Country Code Badge (+91 with Flag) */}
              <div
                className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-100/90 border-r border-slate-200 text-slate-700 font-bold text-xs select-none shrink-0"
                title="India (+91)"
              >
                {/* Official Indian Flag Graphic */}
                <span className="text-base leading-none select-none" role="img" aria-label="India Flag">
                  🇮🇳
                </span>
                <span className="font-extrabold text-slate-900 tracking-tight">+91</span>
              </div>

              {/* 10-Digit Mobile Input */}
              <div className="relative flex-1">
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  autoComplete="tel-national"
                  placeholder={t('auth.mobile_placeholder') || '98765 43210'}
                  value={displayFormattedNumber}
                  onChange={handlePhoneChange}
                  className="w-full pl-3 pr-9 py-2.5 text-xs bg-transparent text-slate-900 font-semibold focus:outline-none tracking-wider placeholder:text-slate-400 placeholder:font-normal"
                />
                <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Real-time Indian Number Validation Hint */}
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">
                {phoneNumber.length > 0 && phoneNumber.length < 10
                  ? `${10 - phoneNumber.length} more digit(s) needed`
                  : phoneNumber.length === 10 && !isIndianMobileValid
                  ? 'Must start with 6, 7, 8, or 9'
                  : 'Valid: 10 digits starting with 6-9'}
              </span>
              <span className="text-slate-400 font-mono text-[10px]">
                {phoneNumber.length}/10
              </span>
            </div>
          </div>

          {/* Optional Name for First-time Customer Registration */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              {t('auth.optional_name_label')}
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                autoComplete="name"
                placeholder={t('auth.optional_name_placeholder') || 'Enter your name (optional)'}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
              />
            </div>
          </div>

          {/* Send OTP Button */}
          <button
            type="submit"
            disabled={loading || !isIndianMobileValid}
            className="w-full min-h-[48px] py-3.5 px-4 rounded-2xl text-white font-bold text-sm bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Sending SMS OTP...</span>
              </>
            ) : (
              <>
                <span>{t('auth.send_otp_btn')}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      )}

      {/* ------------------------------------------------------------- */}
      {/* STEP 2: VERIFY 6-DIGIT OTP                                    */}
      {/* ------------------------------------------------------------- */}
      {step === 'verify' && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          {/* Header Info & Change Number Option */}
          <div className="p-3.5 rounded-2xl bg-indigo-50/70 border border-indigo-100 flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span>{t('auth.enter_otp_title')}</span>
              </div>
              <p className="text-[11px] text-indigo-700/90 leading-snug">
                {t('auth.otp_sent_to')} <span className="font-extrabold text-indigo-950">{formattedPhone}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                onError(null);
                onSuccessMsg(null);
              }}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline shrink-0 cursor-pointer flex items-center gap-1 pt-0.5"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>{t('auth.change_number')}</span>
            </button>
          </div>

          {/* 6 Individual Digit Input Boxes with Auto-Advance & Paste Handling */}
          <div>
            <label className="block text-center text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">
              Enter 6-Digit Code
            </label>
            <div className="flex items-center justify-center gap-2 sm:gap-2.5">
              {otpDigits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    digitInputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(index, e)}
                  onKeyDown={(e) => handleDigitKeyDown(index, e)}
                  onPaste={index === 0 ? handleDigitPaste : undefined}
                  className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-black rounded-xl border bg-slate-50 text-slate-900 transition-all select-all focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:bg-white ${
                    digit
                      ? 'border-indigo-500 bg-indigo-50/20 text-indigo-950 font-mono shadow-xs'
                      : 'border-slate-200'
                  }`}
                  aria-label={`Digit ${index + 1}`}
                />
              ))}
            </div>
          </div>

          {/* Countdown Timer & Resend Controls */}
          <div className="flex items-center justify-between text-xs px-1">
            {/* Expiry Countdown */}
            <span className={`text-[11px] font-semibold ${expiresInSeconds <= 60 ? 'text-red-500 animate-pulse' : 'text-slate-500'}`}>
              Expires in {formatTime(expiresInSeconds)}
            </span>

            {/* Resend OTP */}
            {resendCooldown > 0 ? (
              <span className="text-[11px] font-bold text-slate-400 select-none">
                {t('auth.resend_otp_in', { seconds: resendCooldown })}
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={loading}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                <span>{t('auth.resend_otp')}</span>
              </button>
            )}
          </div>

          {/* Verify & Sign In Button */}
          <button
            type="submit"
            disabled={loading || otpDigits.join('').length !== 6 || expiresInSeconds <= 0}
            className="w-full min-h-[48px] py-3.5 px-4 rounded-2xl text-white font-bold text-sm bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying Code...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>{t('auth.verify_and_login')}</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
};
