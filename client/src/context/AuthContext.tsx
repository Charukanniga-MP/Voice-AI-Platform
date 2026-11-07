import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types.js';
import { registerSocketUser } from '../services/socket.js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string, role?: 'admin' | 'agent' | 'customer') => Promise<User>;
  loginAdmin: (email: string, password: string) => Promise<User>;
  loginAgent: (email: string, password: string) => Promise<User>;
  register: (data: { name: string; email: string; phone?: string; password: string; confirmPassword: string }) => Promise<User>;
  initiateGoogleLogin: () => Promise<void>;
  loginWithGoogleIdToken: (idToken: string) => Promise<User>;
  loginWithGoogleCode: (code: string, redirectUri?: string) => Promise<User>;
  getGoogleConfig: () => Promise<{ configured: boolean; clientId: string | null }>;
  setSession: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load session or handle OAuth callback on startup
  useEffect(() => {
    // Check if URL has OAuth callback params
    const params = new URLSearchParams(window.location.search);
    const callbackToken = params.get('token');
    const callbackUser = params.get('user');
    const callbackError = params.get('error');

    if (callbackToken && callbackUser) {
      try {
        const parsedUser = JSON.parse(decodeURIComponent(callbackUser));
        setToken(callbackToken);
        setUser(parsedUser);
        localStorage.setItem('kaira_token', callbackToken);
        localStorage.setItem('kaira_user', JSON.stringify(parsedUser));
        registerSocketUser(parsedUser.id, parsedUser.role, parsedUser.name);

        // Clean up URL without reloading to root dashboard
        window.history.replaceState({}, document.title, '/');
        setIsLoading(false);
        return;
      } catch (err) {
        console.error('Failed to parse OAuth user payload:', err);
      }
    }

    // Otherwise load from localStorage
    const savedToken = localStorage.getItem('kaira_token');
    const savedUser = localStorage.getItem('kaira_user');

    if (savedToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(parsedUser);
        registerSocketUser(parsedUser.id, parsedUser.role, parsedUser.name);
      } catch (err) {
        localStorage.removeItem('kaira_token');
        localStorage.removeItem('kaira_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string, role?: 'admin' | 'agent' | 'customer'): Promise<User> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed.');
    }

    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('kaira_token', data.token);
    localStorage.setItem('kaira_user', JSON.stringify(data.user));

    registerSocketUser(data.user.id, data.user.role, data.user.name);
    return data.user;
  };

  const loginAdmin = async (email: string, password: string): Promise<User> => {
    return login(email, password, 'admin');
  };

  const loginAgent = async (email: string, password: string): Promise<User> => {
    return login(email, password, 'agent');
  };

  const register = async (formData: { name: string; email: string; phone?: string; password: string; confirmPassword: string }): Promise<User> => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed.');
    }

    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('kaira_token', data.token);
    localStorage.setItem('kaira_user', JSON.stringify(data.user));

    registerSocketUser(data.user.id, data.user.role, data.user.name);
    return data.user;
  };

  const getGoogleConfig = async (): Promise<{ configured: boolean; clientId: string | null }> => {
    try {
      const res = await fetch('/api/auth/google/config');
      if (!res.ok) return { configured: false, clientId: null };
      return await res.json();
    } catch {
      return { configured: false, clientId: null };
    }
  };

  const loginWithGoogleIdToken = async (idToken: string): Promise<User> => {
    const res = await fetch('/api/auth/google/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Google authentication failed.');
    }

    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('kaira_token', data.token);
    localStorage.setItem('kaira_user', JSON.stringify(data.user));

    registerSocketUser(data.user.id, data.user.role, data.user.name);
    return data.user;
  };

  const loginWithGoogleCode = async (code: string, redirectUri?: string): Promise<User> => {
    const res = await fetch('/api/auth/google/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Google code exchange failed.');
    }

    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('kaira_token', data.token);
    localStorage.setItem('kaira_user', JSON.stringify(data.user));

    registerSocketUser(data.user.id, data.user.role, data.user.name);
    return data.user;
  };

  const initiateGoogleLogin = async (): Promise<void> => {
    const res = await fetch('/api/auth/google/url');
    const data = await res.json();

    if (data.configured && data.authUrl) {
      // Standard official Google OAuth 2.0 full-page redirect to Google's real account chooser
      window.location.href = data.authUrl;
    } else {
      throw new Error(
        'Google OAuth 2.0 is not yet configured with your Google Cloud Client ID. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to server/.env with the application name set to "KAIRA Technologies".'
      );
    }
  };

  const setSession = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('kaira_token', newToken);
    localStorage.setItem('kaira_user', JSON.stringify(newUser));
    registerSocketUser(newUser.id, newUser.role, newUser.name);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('kaira_token');
    localStorage.removeItem('kaira_user');
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, loginAdmin, loginAgent, register, initiateGoogleLogin, loginWithGoogleIdToken, loginWithGoogleCode, getGoogleConfig, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
