import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import {
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Loader2,
  Check,
  X,
  Mail,
  KeyRound,
  Sparkles
} from 'lucide-react';

interface ResetPasswordProps {
  onBackToLogin: () => void;
}

export const ResetPasswordPage: React.FC<ResetPasswordProps> = ({ onBackToLogin }) => {
  const { user } = useAuth();

  // Mode: 'enter_email' (if no token) | 'verify' (token in progress) | 'set_password' (token verified)
  const [token, setToken] = useState<string>('');
  const [email, setEmail] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [tokenValid, setTokenValid] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Request link form state
  const [requestEmail, setRequestEmail] = useState<string>(user?.email || '');
  const [requestLoading, setRequestLoading] = useState<boolean>(false);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const [devDirectLink, setDevDirectLink] = useState<string | null>(null);
  const [devDirectToken, setDevDirectToken] = useState<string | null>(null);

  // Manual token input state
  const [manualToken, setManualToken] = useState<string>('');
  const [showManualToken, setShowManualToken] = useState<boolean>(false);

  // Password fields state
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // Verify a token against backend API
  const verifyToken = async (targetToken: string) => {
    setVerifying(true);
    setTokenError(null);

    try {
      const res = await fetch('/api/auth/verify-reset-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: targetToken })
      });

      const data = await res.json();
      if (res.ok && data.valid) {
        setToken(targetToken);
        setTokenValid(true);
        setEmail(data.email || null);
      } else {
        setTokenValid(false);
        setTokenError(data.error || 'This reset link is invalid, expired, or has already been used.');
      }
    } catch {
      setTokenValid(false);
      setTokenError('Network error while validating reset token. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  // Inspect URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');

    if (urlToken && urlToken.trim()) {
      verifyToken(urlToken.trim());
    }
  }, []);

  // Handle requesting a reset link
  const handleRequestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestEmail) return;

    setRequestLoading(true);
    setRequestSuccess(null);
    setDevDirectLink(null);
    setDevDirectToken(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: requestEmail.trim().toLowerCase() })
      });

      const data = await res.json();
      setRequestSuccess(data.message || 'If an account exists with this email address, password reset instructions have been dispatched.');

      if (data.devToken) {
        setDevDirectToken(data.devToken);
      }
      if (data.devResetLink) {
        setDevDirectLink(data.devResetLink);
      }
    } catch {
      setRequestSuccess('If an account exists with this email address, password reset instructions have been dispatched.');
    } finally {
      setRequestLoading(false);
    }
  };

  // Password criteria indicators
  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const hasSpecial = /[@$!%*?&#^()_\-+=\[\]{}|:;<>,./~`]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isFormValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecial && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !token) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password.');
      }

      setSuccess(true);
    } catch (err: any) {
      setSubmitError(err.message || 'An error occurred while resetting your password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white text-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-slate-100">
        {/* Header Branding */}
        <div className="bg-indigo-600 px-6 py-6 text-center text-white relative">
          <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mx-auto mb-3 shadow-inner">
            <span className="font-extrabold text-xl">K</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">KAIRA Voice AI Platform</h1>
          <p className="text-xs text-indigo-100 mt-1 font-medium">Identity & Password Security Recovery</p>
        </div>

        <div className="p-6 sm:p-8">
          {verifying ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
              <p className="text-sm font-semibold text-slate-700">Validating security token...</p>
              <p className="text-xs text-slate-400 mt-1">Verifying expiration and cryptographic signature</p>
            </div>
          ) : success ? (
            /* Success Screen */
            <div className="py-4 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Password Changed Successfully!</h2>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Your new password is now active. All security tokens have been consumed and previous sessions invalidated.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  Sign In With New Password
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : tokenValid ? (
            /* Set New Password Form (Token Verified) */
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">Choose a Strong New Password</h2>
                </div>
                {email && (
                  <p className="text-xs text-slate-500">
                    Resetting password for: <strong className="text-slate-800">{email}</strong>
                  </p>
                )}
              </div>

              {submitError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* New Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">New Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new strong password"
                    className="block w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm New Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="block w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Password Requirements Checklist */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] space-y-1.5">
                <p className="font-semibold text-slate-700 mb-1">Password Strength Requirements:</p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-600">
                  <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-600 font-medium' : ''}`}>
                    {hasMinLength ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                    <span>8+ characters</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasUppercase ? 'text-emerald-600 font-medium' : ''}`}>
                    {hasUppercase ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                    <span>1 uppercase letter</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasLowercase ? 'text-emerald-600 font-medium' : ''}`}>
                    {hasLowercase ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                    <span>1 lowercase letter</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-600 font-medium' : ''}`}>
                    {hasNumber ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                    <span>1 number</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasSpecial ? 'text-emerald-600 font-medium' : ''}`}>
                    {hasSpecial ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                    <span>1 special symbol</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-600 font-medium' : ''}`}>
                    {passwordsMatch ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                    <span>Passwords match</span>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!isFormValid || submitting}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Updating Password...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Set New Password
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="text-xs text-slate-500 hover:text-slate-800 font-medium transition cursor-pointer"
                >
                  Return to Dashboard / Login
                </button>
              </div>
            </form>
          ) : (
            /* No Token Yet OR Token Error: Provide Request Link & Token Input */
            <div className="space-y-4">
              {tokenError && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-semibold">{tokenError}</p>
                    <p className="text-[11px] mt-0.5 text-amber-700">Enter your email below to receive a fresh single-use link.</p>
                  </div>
                </div>
              )}

              {/* Request Link Form */}
              <form onSubmit={handleRequestLink} className="space-y-3.5">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-indigo-600" />
                    Request Password Reset Link
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Enter your registered email address to receive secure 15-minute reset instructions.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Registered Email Address</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      required
                      value={requestEmail}
                      onChange={(e) => setRequestEmail(e.target.value)}
                      placeholder="e.g. customer@kaira or alex.morgan@example.com"
                      className="block w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 text-slate-900"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={requestLoading || !requestEmail}
                  className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  {requestLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating Secure Token...
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      Send Reset Instructions
                    </>
                  )}
                </button>
              </form>

              {/* Confirmation Alert */}
              {requestSuccess && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Instructions Dispatched</span>
                  </div>
                  <p className="text-[11px] text-emerald-700 leading-relaxed">
                    {requestSuccess}
                  </p>

                  {/* Dev Direct Access Button (Instant 1-Click to Test without SMTP) */}
                  {devDirectToken && (
                    <div className="mt-2 pt-2 border-t border-emerald-200">
                      <button
                        type="button"
                        onClick={() => verifyToken(devDirectToken)}
                        className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Click here to set new password now
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Manual Token Paste Section */}
              <div className="pt-2 border-t border-slate-100">
                {!showManualToken ? (
                  <button
                    type="button"
                    onClick={() => setShowManualToken(true)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer flex items-center gap-1"
                  >
                    <KeyRound className="w-3 h-3" />
                    Already have a token? Paste it here
                  </button>
                ) : (
                  <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <label className="block text-[11px] font-semibold text-slate-700">Enter Reset Token</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualToken}
                        onChange={(e) => setManualToken(e.target.value)}
                        placeholder="Paste 64-char token here"
                        className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => manualToken.trim() && verifyToken(manualToken.trim())}
                        disabled={!manualToken.trim()}
                        className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 cursor-pointer disabled:bg-slate-300"
                      >
                        Verify
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="text-xs text-slate-500 hover:text-slate-800 font-medium transition cursor-pointer"
                >
                  Return to Dashboard / Login
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
