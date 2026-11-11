import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useLanguage } from '../context/LanguageContext.js';
import { LanguageSelector } from '../components/LanguageSelector.js';
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
  UserPlus,
  Phone,
  Headset,
  Shield
} from 'lucide-react';
import { navigateToResetPassword } from '../utils/navigation.js';

export const LoginPage: React.FC<{ onAuthSuccess: (role: string) => void }> = ({ onAuthSuccess }) => {
  const {
    login,
    register,
    loginAdmin,
    loginAgent,
    initiateGoogleLogin,
    loginWithGoogleIdToken,
    loginWithGoogleCode,
    getGoogleConfig,
    sessionExpiredMessage,
    clearSessionExpiredMessage
  } = useAuth();
  const { t } = useLanguage();

  // Active Portal: 'customer' | 'agent' | 'admin'
  const [portal, setPortal] = useState<'customer' | 'agent' | 'admin'>('customer');

  // Mode: 'login' | 'register' | 'forgot'
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');

  // Customer Sign In / Staff state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Customer Sign Up form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Loading & error state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google Identity Services (GIS) configuration
  const envClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';

  const isClientIdValid = (cid: string | null | undefined): boolean => {
    if (!cid) return false;
    const clean = cid.trim();
    return clean.length > 20 && clean.endsWith('.apps.googleusercontent.com') && !clean.includes('your-google-client-id');
  };

  const [isGoogleConfigured, setIsGoogleConfigured] = useState<boolean>(isClientIdValid(envClientId));
  const [googleClientId, setGoogleClientId] = useState<string | null>(isClientIdValid(envClientId) ? envClientId : null);
  const [isVerifyingGoogle, setIsVerifyingGoogle] = useState<boolean>(false);
  const [showGoogleSetup, setShowGoogleSetup] = useState<boolean>(false);

  // Setup modal state
  const [setupClientId, setSetupClientId] = useState<string>(envClientId || '');
  const [setupClientSecret, setSetupClientSecret] = useState<string>('');
  const [setupSaving, setSetupSaving] = useState<boolean>(false);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Fetch Google OAuth configuration status & saved rememberMe on mount
  const refreshGoogleConfig = async () => {
    try {
      const config = await getGoogleConfig();
      if (config.configured && config.clientId && isClientIdValid(config.clientId)) {
        setIsGoogleConfigured(true);
        setGoogleClientId(config.clientId);
        setSetupClientId(config.clientId);
      } else if (envClientId && isClientIdValid(envClientId)) {
        setIsGoogleConfigured(true);
        setGoogleClientId(envClientId);
        setSetupClientId(envClientId);
      } else {
        setIsGoogleConfigured(false);
        setGoogleClientId(null);
      }
    } catch {
      if (envClientId) {
        setIsGoogleConfigured(true);
        setGoogleClientId(envClientId);
      } else {
        setIsGoogleConfigured(false);
        setGoogleClientId(null);
      }
    }
  };

  useEffect(() => {
    refreshGoogleConfig();
    const savedEmail = localStorage.getItem('kaira_remember_email');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
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

    if (!isGoogleConfigured || !googleClientId || !isClientIdValid(googleClientId)) {
      setError('Google Sign-In requires a valid Google Cloud Web Client ID (ending in .apps.googleusercontent.com). Please enter your credentials in the setup guide or sign in using Email & Password.');
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
          callback: async (response: any) => {
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
          error_callback: (err: any) => {
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

  // Handle Customer Sign In (Email & Password)
  const handleCustomerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (rememberMe) {
        localStorage.setItem('kaira_remember_email', email.trim());
      } else {
        localStorage.removeItem('kaira_remember_email');
      }

      const user = await login(email, password, 'customer');
      onAuthSuccess(user.role);
    } catch (err: any) {
      setError(err.message || t('error.invalid_credentials'));
    } finally {
      setLoading(false);
    }
  };

  // Handle Customer Sign Up (New Account Registration)
  const handleCustomerRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!regName.trim() || !regEmail.trim() || !regPassword) {
      setError(t('error.fill_all_fields'));
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setError(t('error.passwords_not_match'));
      return;
    }

    if (regPassword.length < 6) {
      setError(t('error.password_min_length'));
      return;
    }

    setLoading(true);

    try {
      if (rememberMe) {
        localStorage.setItem('kaira_remember_email', regEmail.trim());
      }

      const user = await register({
        name: regName.trim(),
        email: regEmail.trim(),
        phone: regPhone ? regPhone.trim() : undefined,
        password: regPassword,
        confirmPassword: regConfirmPassword
      });
      onAuthSuccess(user.role);
    } catch (err: any) {
      setError(err.message || t('error.registration_failed'));
    } finally {
      setLoading(false);
    }
  };

  // Handle Admin / Agent Password Login
  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let user;
      if (portal === 'admin') {
        user = await loginAdmin(email, password);
      } else {
        user = await loginAgent(email, password);
      }
      onAuthSuccess(user.role);
    } catch (err: any) {
      setError(err.message || t('error.invalid_credentials'));
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

    if (!setupClientId || !isClientIdValid(setupClientId)) {
      setSetupError('Invalid Client ID format. Your Google OAuth Client ID must end with ".apps.googleusercontent.com" (e.g. 1234567890-abcdef.apps.googleusercontent.com). Note: A numeric project ID or phone number is not an OAuth Client ID.');
      setSetupSaving(false);
      return;
    }

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
      {/* Top Language Selector on Login Screen */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0 flex justify-end mb-2">
        <LanguageSelector variant="dropdown" />
      </div>

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
          KAIRA {t('nav.branding_tag')}
        </h1>
        <p className="text-xs font-medium text-slate-500 mt-0.5">
          {t('nav.branding_sub')}
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
            <span>{t('auth.portal_customer')}</span>
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
            <span>{t('auth.portal_agent')}</span>
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
            <span>{t('auth.portal_admin')}</span>
          </button>
        </div>

        <div className="bg-white py-8 px-6 shadow-xl shadow-slate-200/50 rounded-2xl border border-slate-200/80 sm:px-10">

          {/* Session Expiration Banner */}
          {sessionExpiredMessage && (
            <div className="mb-5 p-3.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs flex items-center justify-between gap-2.5 shadow-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                <span className="font-semibold">{sessionExpiredMessage}</span>
              </div>
              <button
                type="button"
                onClick={clearSessionExpiredMessage}
                className="text-amber-500 hover:text-amber-700 p-0.5 rounded cursor-pointer"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Error Banner with Dismiss Button */}
          {error && (
            <div className="mb-5 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-start justify-between gap-2.5">
              <div className="flex items-start gap-2.5 flex-1">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <div className="flex-1">
                  <p className="font-medium">{error}</p>
                  {error.toLowerCase().includes('origin') && (
                    <div className="mt-2.5 p-2.5 bg-white rounded-lg border border-red-200 text-[11px] text-slate-700 space-y-1.5">
                      <p className="font-bold text-slate-900 flex items-center gap-1">
                        <Settings className="w-3.5 h-3.5 text-blue-600" />
                        Quick Fix: 1-Click to Google Cloud Console
                      </p>
                      <p>Google requires your local browser URL to be registered before allowing sign-in:</p>
                      <div className="pt-0.5">
                        <a
                          href={googleClientId ? `https://console.cloud.google.com/apis/credentials/oauthclient/${googleClientId}` : 'https://console.cloud.google.com/apis/credentials'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 shadow-xs"
                        >
                          Open Google Cloud Console <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="pt-1 text-[11px] text-slate-600 space-y-1">
                        <p>1. Under <strong>Authorized JavaScript origins</strong>, click <strong>+ ADD URI</strong> and paste: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono font-bold text-blue-700 select-all">http://localhost:5173</code></p>
                        <p>2. Under <strong>Authorized redirect URIs</strong>, add: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono font-bold text-blue-700 select-all">http://localhost:5000/api/auth/google/callback</code></p>
                        <p>3. Click <strong>SAVE</strong> at the bottom of the page!</p>
                      </div>
                    </div>
                  )}
                  {error.includes('Google') && !error.toLowerCase().includes('origin') && (
                    <button
                      type="button"
                      onClick={() => setShowGoogleSetup(true)}
                      className="mt-2 text-xs font-semibold text-blue-700 underline hover:text-blue-900 flex items-center gap-1 cursor-pointer"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      {t('error.google_setup_guide')}
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-700 p-0.5 rounded cursor-pointer"
                title="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ============================================================ */}
          {/* 1. CUSTOMER PORTAL (SIGN IN, SIGN UP & GOOGLE OAUTH)         */}
          {/* ============================================================ */}
          {portal === 'customer' && (
            <div>
              {/* Header */}
              <div className="text-center mb-5">
                <div className="inline-flex p-2.5 bg-blue-50 text-blue-600 rounded-2xl mb-2">
                  <Sparkles className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  {mode === 'login' ? t('auth.sign_in_title') : mode === 'register' ? t('auth.create_account_title') : t('auth.reset_password_title')}
                </h2>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  {mode === 'login'
                    ? t('auth.sign_in_desc')
                    : mode === 'register'
                    ? t('auth.create_account_desc')
                    : t('auth.reset_password_desc')}
                </p>
              </div>

              {/* Mode Toggle Switch: Sign In vs Sign Up */}
              {mode !== 'forgot' && (
                <div className="flex bg-slate-100 p-1 rounded-xl mb-5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(null); }}
                    className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                      mode === 'login' ? 'bg-white text-blue-600 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t('auth.tab_sign_in')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError(null); }}
                    className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                      mode === 'register' ? 'bg-white text-blue-600 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t('auth.tab_sign_up')}
                  </button>
                </div>
              )}

              {/* A. CUSTOMER SIGN IN FORM */}
              {mode === 'login' && (
                <form onSubmit={handleCustomerLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      {t('auth.email_label')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('auth.email_placeholder')}
                        className="block w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-colors text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-700">
                        {t('auth.password_label')}
                      </label>
                      <button
                        type="button"
                        onClick={() => navigateToResetPassword()}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline cursor-pointer"
                      >
                        {t('auth.forgot_password')}
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
                        placeholder={t('auth.password_placeholder')}
                        className="block w-full pl-9 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-colors text-slate-900"
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

                  {/* Remember Me Checkbox */}
                  <div className="flex items-center justify-between text-xs pt-0.5">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500/20"
                      />
                      <span>{t('auth.remember_me')}</span>
                    </label>
                  </div>

                  {/* Standard Sign In Button */}
                  <button
                    type="submit"
                    disabled={loading || isVerifyingGoogle}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>{t('auth.sign_in_btn')}</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  {/* OR Divider */}
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                      <span className="bg-white px-3 text-slate-400 font-bold">{t('auth.or_divider')}</span>
                    </div>
                  </div>

                  {/* Continue with Google Button (Directly below Sign In) */}
                  {isVerifyingGoogle ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-4 px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold animate-pulse">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                      <span>{t('auth.verifying_google')}</span>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {/* Official Google Identity Services Iframe Button (Auto-rendered when available) */}
                      <div ref={googleBtnRef} className="w-full flex justify-center empty:hidden" />

                      {/* Official Full-Width Continue with Google Button */}
                      <button
                        type="button"
                        onClick={() => handleGoogleClick('popup')}
                        disabled={loading || isVerifyingGoogle}
                        className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-slate-300 rounded-xl bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-60 shadow-xs"
                      >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.14z" />
                          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
                          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                        </svg>
                        <span>{t('auth.continue_with_google')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleGoogleClick('redirect')}
                        disabled={loading || isVerifyingGoogle}
                        className="w-full text-center text-[11px] text-slate-500 hover:text-slate-700 hover:underline cursor-pointer flex items-center justify-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                        <span>{t('auth.google_redirect_option')}</span>
                      </button>
                    </div>
                  )}

                  <div className="text-center pt-3 border-t border-slate-100">
                    <span className="text-xs text-slate-500">{t('auth.no_account')} </span>
                    <button
                      type="button"
                      onClick={() => { setMode('register'); setError(null); }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    >
                      {t('auth.create_new_account')}
                    </button>
                  </div>

                  {/* Default Customer Account Shortcuts */}
                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-500">
                    <div className="flex items-center justify-between">
                      <span>Customer Google Email: <code className="font-mono text-blue-700 font-semibold">raviarun2004@gmail.com</code></span>
                      <button
                        type="button"
                        onClick={() => fillCredentials('raviarun2004@gmail.com', 'kaira@123')}
                        className="text-blue-600 hover:underline font-semibold cursor-pointer"
                      >
                        {t('auth.auto_fill')}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Demo Customer: <code className="font-mono text-blue-700 font-semibold">customer@kaira</code></span>
                      <button
                        type="button"
                        onClick={() => fillCredentials('customer@kaira', 'kaira@123')}
                        className="text-blue-600 hover:underline font-semibold cursor-pointer"
                      >
                        {t('auth.auto_fill')}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* B. CUSTOMER SIGN UP FORM */}
              {mode === 'register' && (
                <form onSubmit={handleCustomerRegister} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {t('auth.full_name_label')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <User className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder={t('auth.full_name_placeholder')}
                        className="block w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-colors text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {t('auth.email_label')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder={t('auth.email_placeholder')}
                        className="block w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-colors text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {t('auth.phone_label')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Phone className="w-4 h-4" />
                      </div>
                      <input
                        type="tel"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        placeholder={t('auth.phone_placeholder')}
                        className="block w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-colors text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {t('auth.password_label')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder={t('auth.password_placeholder')}
                        className="block w-full pl-9 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-colors text-slate-900"
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

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {t('auth.confirm_password_label')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        placeholder={t('auth.confirm_password_placeholder')}
                        className="block w-full pl-9 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-colors text-slate-900"
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

                  {/* Remember Me */}
                  <div className="flex items-center text-xs pt-0.5">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500/20"
                      />
                      <span>{t('auth.remember_me_device')}</span>
                    </label>
                  </div>

                  {/* Sign Up Button */}
                  <button
                    type="submit"
                    disabled={loading || isVerifyingGoogle}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>{t('auth.sign_up_btn')}</span>
                      </>
                    )}
                  </button>

                  {/* OR Divider */}
                  <div className="relative my-3">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                      <span className="bg-white px-3 text-slate-400 font-bold">{t('auth.or_divider')}</span>
                    </div>
                  </div>

                  {/* Continue with Google */}
                  <button
                    type="button"
                    onClick={() => handleGoogleClick('popup')}
                    disabled={loading || isVerifyingGoogle}
                    className="w-full flex items-center justify-center gap-3 py-2 px-4 border border-slate-300 rounded-xl bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-60 shadow-xs"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.14z" />
                      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
                      <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                    </svg>
                    <span>{t('auth.sign_up_with_google')}</span>
                  </button>

                  <div className="text-center pt-2 border-t border-slate-100">
                    <span className="text-xs text-slate-500">{t('auth.already_have_account')} </span>
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setError(null); }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    >
                      {t('auth.tab_sign_in')}
                    </button>
                  </div>
                </form>
              )}


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
                  <h2 className="text-lg font-bold text-slate-900">{t('auth.agent_login_title')}</h2>
                </div>
                <p className="text-xs text-slate-500">
                  {t('auth.agent_login_desc')}
                </p>
              </div>

              <form onSubmit={handleStaffLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t('auth.agent_username_label')}
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
                      {t('auth.agent_password_label')}
                    </label>
                    <button
                      type="button"
                      onClick={() => navigateToResetPassword()}
                      className="text-xs text-emerald-600 hover:text-emerald-800 font-medium hover:underline cursor-pointer"
                    >
                      {t('auth.forgot_password')}
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
                      placeholder={t('auth.password_placeholder')}
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
                  {loading ? 'Authenticating...' : t('auth.agent_sign_in_btn')}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Default Agent Account Shortcut */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>{t('auth.default_agent')} <code className="font-mono text-emerald-700 font-semibold">agent@kaira</code></span>
                <button
                  type="button"
                  onClick={() => fillCredentials('agent@kaira', 'kaira@123')}
                  className="text-emerald-600 hover:underline font-semibold cursor-pointer"
                >
                  {t('auth.auto_fill')}
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
                  <h2 className="text-lg font-bold text-slate-900">{t('auth.admin_login_title')}</h2>
                </div>
                <p className="text-xs text-slate-500">
                  {t('auth.admin_login_desc')}
                </p>
              </div>

              <form onSubmit={handleStaffLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t('auth.admin_username_label')}
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
                      {t('auth.admin_password_label')}
                    </label>
                    <button
                      type="button"
                      onClick={() => navigateToResetPassword()}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium hover:underline cursor-pointer"
                    >
                      {t('auth.forgot_password')}
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
                      placeholder={t('auth.password_placeholder')}
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
                  {loading ? 'Authenticating...' : t('auth.admin_sign_in_btn')}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Default Admin Account Shortcut */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>{t('auth.default_admin')} <code className="font-mono text-indigo-700 font-semibold">admin@kaira</code></span>
                <button
                  type="button"
                  onClick={() => fillCredentials('admin@kaira', 'kaira@123')}
                  className="text-indigo-600 hover:underline font-semibold cursor-pointer"
                >
                  {t('auth.auto_fill')}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* 4. FORGOT PASSWORD MODE                                      */}
          {/* ============================================================ */}
          {mode === 'forgot' && (
            <div>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-slate-900">{t('auth.reset_password_title')}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {t('auth.reset_password_desc')}
                </p>
              </div>

              {forgotSent ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs space-y-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    {t('auth.instructions_dispatched')}
                  </div>
                  <p>
                    {t('auth.recovery_sent_notice', { email: forgotEmail })}
                  </p>
                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-emerald-200/60">
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setForgotSent(false); }}
                      className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                    >
                      {t('auth.return_to_sign_in')}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateToResetPassword()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
                    >
                      <span>Set New Password</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">{t('auth.email_label')}</label>
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder={t('auth.email_placeholder')}
                      className="block w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {loading ? 'Sending...' : t('auth.send_recovery')}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setError(null); }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      {t('auth.cancel_return')}
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
                    href={googleClientId ? `https://console.cloud.google.com/apis/credentials/oauthclient/${googleClientId}` : 'https://console.cloud.google.com/apis/credentials'}
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
                      placeholder="Enter Client Secret from Google Cloud Console"
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
