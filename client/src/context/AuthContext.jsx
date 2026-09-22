import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { setAccessToken, refreshSession } from '@/lib/api';
import { resolveSsoToken, ssoLogout } from '@/lib/sso';

const AuthContext = createContext(null);

/**
 * Central sign-on: with no local session, the portal cookie may still identify
 * this visitor. Exchanges the portal's hand-off token for a normal session —
 * the backend issues the same access token and refresh cookie as /auth/login.
 * Resolves to the user, or null when SSO is off, the visitor is not signed in
 * to the portal, or no CRM account is linked.
 */
async function restoreFromSso() {
  const token = await resolveSsoToken();
  if (!token) return null;
  try {
    const { data } = await api.post('/auth/sso', { token });
    setAccessToken(data.data.accessToken);
    return data.data.user;
  } catch {
    return null;
  }
}

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
        // No refresh cookie: try the portal before falling through to /login.
        const ssoUser = await restoreFromSso();
        if (!cancelled) setUser(ssoUser);
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
    ssoLogout(); // end the portal session too, or the next load signs back in
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
