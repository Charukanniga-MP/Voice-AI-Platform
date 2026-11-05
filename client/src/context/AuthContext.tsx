import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types.js';
import { registerSocketUser } from '../services/socket.js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { name: string; email: string; phone?: string; password: string; confirmPassword: string }) => Promise<User>;
  googleAuth: (googleData: { email: string; name: string; googleId?: string; avatar?: string }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load session on startup
  useEffect(() => {
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

  const login = async (email: string, password: string): Promise<User> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
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

  const googleAuth = async (googleData: { email: string; name: string; googleId?: string; avatar?: string }): Promise<User> => {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(googleData)
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

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('kaira_token');
    localStorage.removeItem('kaira_user');
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, googleAuth, logout }}>
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
