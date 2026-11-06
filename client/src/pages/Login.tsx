import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Settings,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  X,
  Loader2,
  Sparkles,
  User,
  Headset,
  Shield
} from 'lucide-react';

export const LoginPage: React.FC<{ onAuthSuccess: (role: string) => void }> = ({ onAuthSuccess }) => {
  const { login, loginAdmin, loginAgent, initiateGoogleLogin, loginWithGoogleIdToken, loginWithGoogleCode, getGoogleConfig } = useAuth();

  // Active Portal: 'customer' | 'agent' | 'admin'
  const [portal, setPortal] = useState<'customer' | 'agent' | 'admin'>('customer');

  // Mode: 'login' | 'forgot'
  const [mode, setMode] = useState<'login' | 'forgot'>('login');

  // Admin & Agent form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Loading & error state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google Identity Services (GIS) states (for Customer only)
  const envClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || null;
  const [isGoogleConfigured, setIsGoogleConfigured] = useState<boolean>(Boolean(envClientId));
  const [googleClientId, setGoogleClientId] = useState<string | null>(envClientId);
  const [isVerifyingGoogle, setIsVerifyingGoogle] = useState<boolean>(false);
  const [showGoogleSetup, setShowGoogleSetup] = useState<boolean>(false);

  // Setup modal state
  const [setupClientId, setSetupClientId] = useState<string>('');
  const [setupClientSecret, setSetupClientSecret] = useState<string>('');
  const [setupSaving, setSetupSaving] = useState<boolean>(false);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Fetch Google OAuth configuration status on mount
  const refreshGoogleConfig = async () => {
    try {
      const config = await getGoogleConfig();
      setIsGoogleConfigured(config.configured);
      setGoogleClientId(config.clientId);
      if (config.clientId) {
        setSetupClientId(config.clientId);
      }
    } catch {
      setIsGoogleConfigured(false);
      setGoogleClientId(null);
    }
  };

  useEffect(() => {
    refreshGoogleConfig();
  }, []);

  // Read URL error param on load (e.g. from Google redirect cancellation or failure)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlErr = params.get('error');
    if (urlErr) {
      setError(decodeURIComponent(urlErr));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Switch Portal helper
  const handlePortalSwitch = (newPortal: 'customer' | 'agent' | 'admin') => {
    setPortal(newPortal);
    setMode('login');
    setError(null);
    setEmail('');
    setPassword('');
  };

  // Pre-fill demo credentials helper
  const fillCredentials = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  };

  // Initialize official Google Identity Services (GIS) ONLY for Customer Portal
  useEffect(() => {
    if (portal !== 'customer' || !googleClientId || !isGoogleConfigured) return;

    let timer: any = null;

    const setupGsi = () => {
      if (!window.google?.accounts?.id) {
        return false;
      }

      try {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: { credential: string }) => {
            if (!response.credential) {
              setError('No credentials returned by Google.');
              return;
            }
            setIsVerifyingGoogle(true);
            setError(null);
            try {
              const user = await loginWithGoogleIdToken(response.credential);
              onAuthSuccess(user.role);
            } catch (err: any) {
              setError(err.message || 'Google account verification failed.');
            } finally {
              setIsVerifyingGoogle(false);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // Render official GIS button inside Customer Google container
        if (googleBtnRef.current) {
          googleBtnRef.current.innerHTML = '';
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: 340,
          });
        }

        // Display One Tap account chooser if available
        try {
          window.google.accounts.id.prompt();
        } catch {}

        return true;
      } catch (e) {
        console.error('Google Identity Services setup error:', e);
        return false;
      }
    };

    if (!setupGsi()) {
      timer = setInterval(() => {
        if (setupGsi()) {
          clearInterval(timer);
        }
      }, 400);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [googleClientId, isGoogleConfigured, portal]);

  // Handle Customer Google Sign-In click (Amazon-style official Google Account Selection)
  const handleGoogleClick = async (loginMode: 'popup' | 'redirect' = 'popup') => {
    setError(null);

    if (!isGoogleConfigured || !googleClientId) {
      setShowGoogleSetup(true);
      return;
    }

    // Direct Full-Page Redirect Flow
    if (loginMode === 'redirect') {
      setLoading(true);
      try {
        await initiateGoogleLogin();
      } catch (err: any) {
        setError(err.message || 'Unable to initiate Google Sign-In redirect.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Official GIS Popup Flow
    if (window.google?.accounts?.oauth2?.initCodeClient) {
      try {
        const client = window.google.accounts.oauth2.initCodeClient({
          client_id: googleClientId,
          scope: 'openid email profile',
          ux_mode: 'popup',
          select_account: true,
          callback: async (response) => {
            if (response.error) {
              if (response.error === 'popup_closed_by_user') {
                setError(
                  'Google popup closed. If Google displayed "Access blocked: Authorisation error / no registered origin (Error 401: invalid_client)", please add http://localhost:5173 to Authorized JavaScript origins in Google Cloud Console.'
                );
              } else {
                setError(`Google sign-in error: ${response.error_description || response.error}`);
              }
              return;
            }
            if (!response.code) {
              setError('No authorization code returned from Google.');
              return;
            }
            setIsVerifyingGoogle(true);
            setError(null);
            try {
              const user = await loginWithGoogleCode(response.code);
              onAuthSuccess(user.role);
            } catch (err: any) {
              setError(err.message || 'Google account verification failed.');
            } finally {
              setIsVerifyingGoogle(false);
            }
          },
          error_callback: (err) => {
            console.warn('[Google OAuth] Popup closed or error:', err);
            setError(
              'Google sign-in window encountered an issue. If Google showed "no registered origin (Error 401)", please ensure http://localhost:5173 is added to Authorized JavaScript origins in Google Cloud Console.'
            );
          }
        });

        client.requestCode();
        return;
      } catch (clientErr) {
        console.warn('initCodeClient error, falling back to redirect:', clientErr);
      }
    }

    // 2. Full-page redirect fallback (Universal for mobile devices, Safari, or blocked popups)
    setLoading(true);
    try {
      await initiateGoogleLogin();
    } catch (err: any) {
      setError(err.message || 'Unable to initiate Google Sign-In.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Admin / Agent Password Login
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let user;
      if (portal === 'admin') {
        user = await loginAdmin(email, password);
      } else if (portal === 'agent') {
        user = await loginAgent(email, password);
      } else {
        throw new Error('Customer login must be completed through Google Sign-In.');
      }
      onAuthSuccess(user.role);
    } catch (err: any) {
      setError(err.message || 'Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Save Google OAuth Credentials
  const handleSaveGoogleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);
    setSetupSuccess(null);
    setSetupSaving(true);

    try {
      const res = await fetch('/api/auth/google/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: setupClientId,
          clientSecret: setupClientSecret
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update Google credentials.');
      }

      setSetupSuccess('Google OAuth credentials saved and activated successfully!');
      setIsGoogleConfigured(true);
      setGoogleClientId(setupClientId.trim());
      setError(null);

      setTimeout(() => {
        setShowGoogleSetup(false);
        setSetupSuccess(null);
      }, 1500);
    } catch (err: any) {
      setSetupError(err.message || 'Failed to save Google credentials.');
    } finally {
      setSetupSaving(false);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Handle Forgot Password
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 sm:px-6 lg:px-8">
      {/* Official KAIRA Technologies Header Branding */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="flex justify-center mb-3">
          <img
            src="/kaira-logo.png"
            alt="KAIRA Technologies"
            className="h-16 w-auto object-contain drop-shadow-xs"
          />
        </div>

        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          KAIRA Voice AI
        </h1>
        <p className="text-xs font-medium text-slate-500 mt-0.5">
          AI Customer Communication Platform
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        {/* Role Portal Selector Tabs */}
        <div className="bg-slate-200/80 p-1 rounded-xl mb-4 grid grid-cols-3 gap-1 shadow-inner text-xs font-semibold">
          <button
            type="button"
            onClick={() => handlePortalSwitch('customer')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-all cursor-pointer ${
              portal === 'customer'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Customer</span>
          </button>

          <button
            type="button"
            onClick={() => handlePortalSwitch('agent')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-all cursor-pointer ${
              portal === 'agent'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Headset className="w-3.5 h-3.5" />
            <span>Support Agent</span>
          </button>

          <button
            type="button"
            onClick={() => handlePortalSwitch('admin')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-all cursor-pointer ${
              portal === 'admin'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Admin</span>
          </button>
        </div>

        <div className="bg-white py-8 px-6 shadow-xl shadow-slate-200/50 rounded-2xl border border-slate-200/80 sm:px-10">

          {/* Error Banner */}
          {error && (
            <div className="mb-5 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div className="flex-1">
                <p className="font-medium">{error}</p>
                {portal === 'customer' && !isGoogleConfigured && error.includes('Google') && (
                  <button
                    type="button"
                    onClick={() => { setShowGoogleSetup(true); setError(null); }}
                    className="mt-2 text-xs font-semibold text-blue-700 underline hover:text-blue-900 flex items-center gap-1 cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Open Google OAuth Setup Guide
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* 1. CUSTOMER PORTAL (GOOGLE AUTHENTICATION ONLY)              */}
          {/* ============================================================ */}
          {portal === 'customer' && (
            <div>
              <div className="text-center mb-6">
                <div className="inline-flex p-2.5 bg-blue-50 text-blue-600 rounded-2xl mb-2">
                  <Sparkles className="w-6 h-6" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Customer Portal</h2>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  Instant, secure sign-in with your Google account. No passwords required.
                </p>
              </div>

              {/* Customer Google Authentication Flow */}
              <div className="py-2">
                {isVerifyingGoogle ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-6 px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold animate-pulse">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                    <span>Verifying Google account & signing in...</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Primary Official Google Account Selection (Popup Window) */}
                    <button
                      type="button"
                      onClick={() => handleGoogleClick('popup')}
                      disabled={loading || isVerifyingGoogle}
                      className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-slate-300 rounded-xl bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 hover:border-slate-400 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-60 shadow-xs"
                    >
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.14z" />
                        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
                        <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                      </svg>
                      <span>Continue with Google</span>
                    </button>

                    {/* Secondary Full-Page Redirect Mode */}
                    <button
                      type="button"
                      onClick={() => handleGoogleClick('redirect')}
                      disabled={loading || isVerifyingGoogle}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 border border-slate-200 rounded-lg bg-slate-50 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                      <span>Or Sign In via Google Redirect Page</span>
                    </button>

                    {/* Google Cloud Console Authorized Origin Notice & Direct Link */}
                    <div className="mt-3 p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl text-left space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Google Cloud Origin Requirement</span>
                        </span>
                        <a
                          href="https://console.cloud.google.com/apis/credentials/oauthclient/1018334787224-nkk8l415st631mr3isgm0kjidlhp68h0.apps.googleusercontent.com?project=ai-voice-513817"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-blue-700 hover:underline flex items-center gap-1"
                        >
                          Open Console <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        If Google displays <strong>"no registered origin (Error 401: invalid_client)"</strong>, add this exact URL to <em>Authorized JavaScript origins</em> in your Google Cloud Console:
                      </p>

                      <div className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-amber-200 font-mono text-[11px] text-slate-800">
                        <span>{window.location.origin}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(window.location.origin)}
                          className="text-slate-400 hover:text-blue-600 cursor-pointer flex items-center gap-1"
                          title="Copy Origin"
                        >
                          {copiedText === window.location.origin ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Hidden GIS anchor container for fallback rendering / one-tap */}
                    <div ref={googleBtnRef} className="hidden" />
                  </div>
                )}
              </div>

              {/* Customer Guarantee Details */}
              <div className="mt-6 pt-5 border-t border-slate-100 text-center">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-left space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <ShieldCheck className="w-4 h-4 text-blue-600" />
                    <span>Customer Privacy & Security</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Customer authentication is exclusively handled by Google. Your Google password is never requested, collected, or stored by KAIRA.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* 2. SUPPORT AGENT PORTAL (USERNAME & PASSWORD ONLY)           */}
          {/* ============================================================ */}
          {portal === 'agent' && mode === 'login' && (
            <div>
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Headset className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">Support Agent Login</h2>
                </div>
                <p className="text-xs text-slate-500">
                  Enter your assigned support credentials to access calls & transfers.
                </p>
              </div>

              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Agent Username / Email
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="agent@kaira"
                      className="block w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-colors text-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Agent Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setMode('forgot'); setError(null); }}
                      className="text-xs text-emerald-600 hover:text-emerald-800 font-medium hover:underline cursor-pointer"
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
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter agent password"
                      className="block w-full pl-9 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-colors text-slate-900"
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
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                >
                  {loading ? 'Authenticating Agent...' : 'Sign In as Support Agent'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Default Agent Account Shortcut */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>Default Agent: <code className="font-mono text-emerald-700 font-semibold">agent@kaira</code></span>
                <button
                  type="button"
                  onClick={() => fillCredentials('agent@kaira', 'kaira@123')}
                  className="text-emerald-600 hover:underline font-semibold cursor-pointer"
                >
                  Auto-fill
                </button>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* 3. ADMINISTRATOR PORTAL (USERNAME & PASSWORD ONLY)           */}
          {/* ============================================================ */}
          {portal === 'admin' && mode === 'login' && (
            <div>
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Shield className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">Administrator Portal</h2>
                </div>
                <p className="text-xs text-slate-500">
                  Restricted system management access. Authenticate with admin credentials.
                </p>
              </div>

              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Admin Username / Email
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@kaira"
                      className="block w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-colors text-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Admin Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setMode('forgot'); setError(null); }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium hover:underline cursor-pointer"
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
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter administrator password"
                      className="block w-full pl-9 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-colors text-slate-900"
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
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                >
                  {loading ? 'Authenticating Admin...' : 'Sign In as Administrator'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Default Admin Account Shortcut */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>Default Admin: <code className="font-mono text-indigo-700 font-semibold">admin@kaira</code></span>
                <button
                  type="button"
                  onClick={() => fillCredentials('admin@kaira', 'kaira@123')}
                  className="text-indigo-600 hover:underline font-semibold cursor-pointer"
                >
                  Auto-fill
                </button>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* 4. FORGOT PASSWORD MODE (ADMIN & AGENT ONLY)                 */}
          {/* ============================================================ */}
          {mode === 'forgot' && (
            <div>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-slate-900">Reset Password</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Enter your registered staff email address to receive password reset instructions.
                </p>
              </div>

              {forgotSent ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Instructions Dispatched
                  </div>
                  <p>
                    If a staff account exists for {forgotEmail}, password recovery instructions have been sent.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setForgotSent(false); }}
                      className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Return to Sign In
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Staff Email Address</label>
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="staff@kaira"
                      className="block w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {loading ? 'Sending...' : 'Send Recovery Instructions'}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setError(null); }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Cancel & Return to Sign In
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Google OAuth Setup & Configuration Modal */}
      {showGoogleSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Google OAuth 2.0 Setup Guide</h3>
                  <p className="text-xs text-slate-500">Google Identity Services (GIS) for Customer Login</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGoogleSetup(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {setupSuccess && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{setupSuccess}</span>
              </div>
            )}

            {setupError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{setupError}</span>
              </div>
            )}

            <div className="mt-4 space-y-4 text-xs text-slate-600 max-h-[60vh] overflow-y-auto pr-1">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800">
                <p className="font-semibold mb-1">Customer Sign-in with Google Configuration:</p>
                <p>
                  Customers sign in with their Google accounts. Configure your <strong>OAuth 2.0 Client ID</strong> in the Google Cloud Console.
                </p>
              </div>

              {/* Step 1 */}
              <div className="p-3 border border-slate-200 rounded-xl bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Step 1: Open Google Cloud Console</span>
                  <a
                    href="https://console.cloud.google.com/apis/credentials/oauthclient/1018334787224-nkk8l415st631mr3isgm0kjidlhp68h0.apps.googleusercontent.com?project=ai-voice-513817"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                  >
                    Direct Client Link <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-slate-600">
                  Select your project (e.g. <em>KAIRA Technologies</em>). Ensure the <strong>OAuth Consent Screen</strong> is configured (User Type: External).
                </p>
              </div>

              {/* Step 2 */}
              <div className="p-3 border border-slate-200 rounded-xl bg-slate-50 space-y-3">
                <span className="font-bold text-slate-800 block">Step 2: Add Authorized URIs</span>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Authorized JavaScript Origins:</label>
                  <div className="space-y-1">
                    {['http://localhost:5173', 'http://localhost:5000'].map((origin) => (
                      <div key={origin} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono text-[11px]">
                        <span>{origin}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(origin)}
                          className="text-slate-400 hover:text-blue-600 cursor-pointer flex items-center gap-1"
                        >
                          {copiedText === origin ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Authorized Redirect URIs:</label>
                  <div className="space-y-1">
                    {['http://localhost:5000/api/auth/google/callback', 'http://localhost:5173/auth/callback'].map((uri) => (
                      <div key={uri} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono text-[11px]">
                        <span>{uri}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(uri)}
                          className="text-slate-400 hover:text-blue-600 cursor-pointer flex items-center gap-1"
                        >
                          {copiedText === uri ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="p-3 border border-slate-200 rounded-xl bg-slate-50 space-y-3">
                <span className="font-bold text-slate-800 block">Step 3: Save Your Credentials</span>
                <p className="text-slate-600">
                  Paste your Client ID below to activate Customer Google sign-in immediately, or paste it into <code className="bg-slate-200 px-1 py-0.5 rounded text-[11px]">server/.env</code>.
                </p>

                <form onSubmit={handleSaveGoogleCredentials} className="space-y-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Google OAuth Client ID</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 123456789-abcdefg.apps.googleusercontent.com"
                      value={setupClientId}
                      onChange={(e) => setSetupClientId(e.target.value)}
                      className="block w-full px-3 py-2 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 font-mono text-xs text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Google OAuth Client Secret (Optional for GIS ID Tokens)</label>
                    <input
                      type="password"
                      placeholder="e.g. GOCSPX-xxxxxxxxxxxxxxxx"
                      value={setupClientSecret}
                      onChange={(e) => setSetupClientSecret(e.target.value)}
                      className="block w-full px-3 py-2 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 font-mono text-xs text-slate-900"
                    />
                  </div>

                  <div className="pt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowGoogleSetup(false)}
                      className="px-4 py-2 border border-slate-300 rounded-xl font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      Close
                    </button>
                    <button
                      type="submit"
                      disabled={setupSaving}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      {setupSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      <span>Save & Activate</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
