import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { Eye, EyeOff, Lock, Mail, CheckCircle2, AlertCircle, ArrowRight, Info, ExternalLink } from 'lucide-react';

export const LoginPage: React.FC<{ onAuthSuccess: (role: string) => void }> = ({ onAuthSuccess }) => {
  const { login, register, initiateGoogleLogin } = useAuth();

  // Mode: 'login' | 'register' | 'forgot'
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Registration form state (Customer only)
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Loading, error, & Google config help state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleConfigHelp, setGoogleConfigHelp] = useState<string | null>(null);

  // Read URL error param on load (e.g. from Google redirect cancellation)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlErr = params.get('error');
    if (urlErr) {
      setError(decodeURIComponent(urlErr));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Handle Unified Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const user = await login(email, password);
      onAuthSuccess(user.role);
    } catch (err: any) {
      setError(err.message || 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Customer Registration
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const user = await register({
        name: regName,
        email: regEmail,
        phone: regPhone,
        password: regPassword,
        confirmPassword: regConfirmPassword
      });
      onAuthSuccess(user.role);
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Official Google OAuth 2.0 (Direct redirect to Google's real account chooser)
  const handleGoogleClick = async () => {
    setError(null);
    setGoogleConfigHelp(null);
    setLoading(true);

    try {
      // Calls Google OAuth 2.0 URL generator and redirects to accounts.google.com
      await initiateGoogleLogin();
    } catch (err: any) {
      setGoogleConfigHelp(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle Forgot Password
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      setForgotSent(true);
    } catch {
      setForgotSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50/25 to-blue-50/40 flex flex-col justify-center py-10 sm:px-6 lg:px-8">
      {/* Official KAIRA Technologies Header Branding */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        {/* Official Company Logo */}
        <div className="flex justify-center mb-3">
          <img
            src="/kaira-logo.png"
            alt="KAIRA Technologies Logo"
            className="h-24 w-24 sm:h-28 sm:w-28 object-contain transition-transform hover:scale-105 duration-200"
          />
        </div>

        <div className="flex items-center justify-center gap-2 mb-1.5">
          <span className="text-[11px] font-extrabold tracking-wider uppercase px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80">
            Voice AI Platform
          </span>
        </div>

        <p className="text-xs font-medium text-slate-500">
          Autonomous Voice Agent & Enterprise Communication Platform
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-8 px-6 shadow-xl shadow-slate-200/60 rounded-3xl border border-slate-100 sm:px-10">

          {/* Error Banner */}
          {error && (
            <div className="mb-5 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Google OAuth Configuration Guide Banner (Displayed only if Cloud credentials are missing) */}
          {googleConfigHelp && (
            <div className="mb-5 p-4 bg-blue-50 border border-blue-200 text-blue-900 rounded-2xl text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-blue-800">
                <Info className="w-4 h-4 text-blue-600 shrink-0" />
                Google Cloud OAuth Setup
              </div>
              <p className="text-blue-700 leading-relaxed">
                To redirect directly to Google's official account chooser, add your Google Cloud credentials to <code className="bg-blue-100/80 px-1 py-0.5 rounded text-[11px] font-mono text-blue-900">server/.env</code>:
              </p>
              <div className="bg-white/90 p-2.5 rounded-xl border border-blue-200 font-mono text-[10px] space-y-0.5 text-slate-800">
                <p>GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com</p>
                <p>GOOGLE_CLIENT_SECRET=your-google-client-secret</p>
                <p>GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback</p>
              </div>
              <p className="text-[11px] text-blue-600">
                <strong>Important:</strong> On your Google Cloud OAuth Consent Screen, set the Application Name to <strong>KAIRA Technologies</strong> and upload the logo from <code className="font-mono">client/public/kaira-logo.png</code> so that Google's account chooser identifies your app as KAIRA Technologies.
              </p>
            </div>
          )}

          {/* 1. LOGIN MODE */}
          {mode === 'login' && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">Sign in to your account</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Automatic role-based authentication for Customers, Agents, and Admins.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Email / Username
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. admin@kaira or alex.morgan@example.com"
                      className="block w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all text-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setMode('forgot'); setError(null); }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="block w-full pl-9 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all text-slate-900"
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

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-md shadow-blue-100 transition-all cursor-pointer disabled:opacity-60"
                >
                  {loading ? 'Authenticating...' : 'Sign In'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Demo Accounts Preset Bar */}
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-center mb-2">
                  Demo Accounts
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setEmail('admin@kaira'); setPassword('kaira@123'); }}
                    className="px-2 py-1.5 text-[11px] font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors cursor-pointer text-center"
                  >
                    Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEmail('agent@kaira'); setPassword('kaira@123'); }}
                    className="px-2 py-1.5 text-[11px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors cursor-pointer text-center"
                  >
                    Agent
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEmail('alex.morgan@example.com'); setPassword('customer@123'); }}
                    className="px-2 py-1.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors cursor-pointer text-center"
                  >
                    Customer
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white text-slate-400 uppercase font-semibold">Or</span>
                </div>
              </div>

              {/* Official Continue with Google (Standard OAuth 2.0 Flow) */}
              <button
                type="button"
                onClick={handleGoogleClick}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-slate-300 rounded-xl shadow-xs bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all cursor-pointer disabled:opacity-60"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.14z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                </svg>
                <span>Continue with Google</span>
              </button>

              {/* Customer Registration Link */}
              <div className="mt-6 text-center">
                <p className="text-xs text-slate-500">
                  New customer?{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError(null); }}
                    className="font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                  >
                    Create New Account
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* 2. CUSTOMER REGISTRATION MODE */}
          {mode === 'register' && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">Customer Registration</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Create a customer account to communicate with our AI voice agents.
                </p>
              </div>

              <form onSubmit={handleRegister} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Jane Doe"
                    className="block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="jane@example.com"
                    className="block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    required
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-100 transition-all cursor-pointer disabled:opacity-60"
                  >
                    {loading ? 'Creating Account...' : 'Register as Customer'}
                  </button>
                </div>
              </form>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); }}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                >
                  Already have an account? Sign in
                </button>
              </div>
            </div>
          )}

          {/* 3. FORGOT PASSWORD MODE */}
          {mode === 'forgot' && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">Reset Password</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Enter your registered email address to receive password reset instructions.
                </p>
              </div>

              {forgotSent ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Instructions Dispatched
                  </div>
                  <p>
                    If an account exists for {forgotEmail}, password recovery instructions have been sent.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setForgotSent(false); }}
                      className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-100 transition-all cursor-pointer disabled:opacity-60"
                  >
                    {loading ? 'Sending...' : 'Send Recovery Link'}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setError(null); }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Cancel & Return to Login
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
