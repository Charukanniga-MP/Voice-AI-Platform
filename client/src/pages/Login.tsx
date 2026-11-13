import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  Phone,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Loader2
} from 'lucide-react';

export const LoginPage: React.FC<{ onAuthSuccess: (role: string) => void }> = ({ onAuthSuccess }) => {
  const { login, register } = useAuth();

  // Mode: 'login' | 'register' | 'forgot'
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');

  // Common login form state (Used by Customer, Support Agent, and Admin)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Customer registration form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);

  // Forgot password form state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotResult, setForgotResult] = useState<{ emailConfigured: boolean; message: string } | null>(null);

  // UI status state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Restore remembered email on mount
  useEffect(() => {
    const saved = localStorage.getItem('kaira_remember_email');
    if (saved) {
      setEmail(saved);
      setRememberMe(true);
    }
  }, []);

  // 1. Common Unified Login Submit (All Roles: Customer, Support Agent, Admin)
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      // Backend automatically verifies credentials and retrieves authentic role from DB
      const authenticatedUser = await login(cleanEmail, password);

      // Handle Remember Me preference
      if (rememberMe) {
        localStorage.setItem('kaira_remember_email', cleanEmail);
      } else {
        localStorage.removeItem('kaira_remember_email');
      }

      // Automatically redirect based on user's authorized database role:
      // admin -> Admin Dashboard
      // agent -> Agent Dashboard
      // customer -> Customer Dashboard
      onAuthSuccess(authenticatedUser.role);
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Customer Registration Submit
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cleanName = regName.trim();
    const cleanEmail = regEmail.trim().toLowerCase();
    const cleanPhone = regPhone.trim();

    if (!cleanName) {
      setError('Please enter your full name.');
      return;
    }

    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!regPassword) {
      setError('Please enter a secure password.');
      return;
    }

    if (regPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match. Please verify your confirmation password.');
      return;
    }

    setLoading(true);
    try {
      // Backend strictly assigns role: 'customer'
      const newUser = await register({
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone || undefined,
        password: regPassword,
        confirmPassword: regConfirmPassword
      });

      // Successful registration -> Automatic sign in and redirection to Customer Dashboard
      onAuthSuccess(newUser.role);
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please check your information and try again.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Forgot Password Submit
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = forgotEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your account email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reset instructions.');
      setForgotResult({
        emailConfigured: Boolean(data.emailConfigured),
        message: data.message
      });
      setForgotSent(true);
    } catch (err: any) {
      setError(err.message || 'Error processing forgot password request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background Decorative Ambient Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />

      {/* Main Container */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-3 mb-6">
          <div className="inline-block p-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 shadow-xl shadow-indigo-950/50 mb-1">
            <img
              src="/kaira-logo.png"
              alt="KAIRA Technologies"
              className="h-12 w-auto object-contain mx-auto drop-shadow-md"
            />
          </div>

          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">Welcome to KAIRA</h1>
            <p className="text-xs text-indigo-200 mt-1 font-medium">
              AI Customer Communication Platform
            </p>
          </div>
        </div>

        {/* Clean White Login Card */}
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/40 border border-white/40 space-y-5">
          {/* Error Banner */}
          {error && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          {/* Success Banner */}
          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{successMsg}</div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* VIEW 1: ONE COMMON SIGN IN FORM                                */}
          {/* (Used for Admin, Support Agent, and Customer)                  */}
          {/* ------------------------------------------------------------- */}
          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* Email Address Field */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Remember Me Option */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>Remember Me</span>
                </label>
              </div>

              {/* Blue and Purple Gradient Sign In Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] py-3.5 px-4 rounded-2xl text-white font-bold text-sm bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Customer Registration Option */}
              <div className="pt-3 text-center border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                  >
                    Create New Account
                  </button>
                </p>
              </div>
            </form>
          )}

          {/* ------------------------------------------------------------- */}
          {/* VIEW 2: CUSTOMER REGISTRATION FORM                            */}
          {/* ------------------------------------------------------------- */}
          {mode === 'register' && (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <h2 className="text-base font-black text-slate-900">Create New Account</h2>
                <p className="text-xs text-slate-500">
                  Enter your details to create a verified KAIRA customer account.
                </p>
              </div>

              <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                {/* Full Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Alex Morgan"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
                    />
                  </div>
                </div>

                {/* Email Address */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      placeholder="name@example.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
                    />
                  </div>
                </div>

                {/* Mobile Phone Number (Optional) */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Mobile Number (Optional)
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Password (min. 6 characters)
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••••••"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                      aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                    >
                      {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type={showRegConfirmPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••••••"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegConfirmPassword(!showRegConfirmPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                      aria-label={showRegConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showRegConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Submit Registration Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl text-white font-bold text-xs bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30 cursor-pointer flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating account...</span>
                    </>
                  ) : (
                    <>
                      <span>Create Account</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Back to Sign In */}
                <div className="pt-2 text-center border-t border-slate-100">
                  <p className="text-xs text-slate-500">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setError(null);
                        setSuccessMsg(null);
                      }}
                      className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                    >
                      Sign In
                    </button>
                  </p>
                </div>
              </form>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* VIEW 3: FORGOT PASSWORD FORM                                  */}
          {/* ------------------------------------------------------------- */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              {forgotSent ? (
                <div className="text-center py-4 space-y-3">
                  {forgotResult?.emailConfigured ? (
                    <>
                      <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <h3 className="font-extrabold text-slate-900 text-sm">Instructions Sent</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        If an account is associated with <span className="font-semibold text-slate-700">{forgotEmail}</span>, password reset instructions have been dispatched.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <h3 className="font-extrabold text-slate-900 text-sm">Admin-Assisted Password Reset</h3>
                      <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200 text-left text-xs text-amber-900 space-y-1.5 leading-relaxed">
                        <p className="font-semibold text-amber-950">
                          Automated email delivery is not configured on this server.
                        </p>
                        <p className="text-[11px] text-amber-800">
                          To reset credentials for <span className="font-bold underline">{forgotEmail}</span>, please contact your KAIRA System Administrator directly:
                        </p>
                        <p className="font-mono text-[11px] bg-white px-2 py-1 rounded border border-amber-300 font-bold text-slate-800">
                          admin@kaira
                        </p>
                        <p className="text-[10px] text-amber-700 pt-0.5">
                          The administrator can verify your identity and update your password in the Administrator Console.
                        </p>
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setForgotSent(false);
                      setForgotEmail('');
                      setForgotResult(null);
                      setError(null);
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                  >
                    Return to Sign In
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div className="text-center space-y-1">
                    <h2 className="text-base font-black text-slate-900">Reset Password</h2>
                    <p className="text-xs text-slate-500">
                      Enter your registered email address to receive recovery instructions.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Account Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="email"
                        required
                        placeholder="name@example.com"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 font-medium transition-colors"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 px-4 rounded-xl text-white font-bold text-xs bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all shadow-md shadow-indigo-500/20 cursor-pointer flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Sending reset instructions...</span>
                      </>
                    ) : (
                      <>
                        <span>Send Reset Instructions</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setError(null);
                      }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                    >
                      ← Back to Sign In
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Security Footer Notice */}
        <div className="mt-6 text-center text-[11px] text-slate-400">
          <p>Protected by KAIRA Enterprise Identity • Strict Role-Based Access Control</p>
        </div>
      </div>
    </div>
  );
};
