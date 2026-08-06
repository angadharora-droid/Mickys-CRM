import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { setAccessToken, refreshSession } from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on first load. The access token lives only in memory, so a
  // fresh page load starts with none — exchange the httpOnly refresh cookie for
  // a new token + user. A 401 here just means "not logged in".
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const { user: restoredUser } = await refreshSession();
        if (!cancelled) setUser(restoredUser);
      } catch {
        setAccessToken(null);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Global logout signal fired by the api layer when refresh fails
  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('mickys:logout', onLogout);
    return () => window.removeEventListener('mickys:logout', onLogout);
  }, []);

  const login = useCallback(async (identifier, password) => {
    const { data } = await api.post('/auth/login', { identifier, password });
    setAccessToken(data.data.accessToken);
    setUser(data.data.user);
    return data.data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* logout should never block */
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
