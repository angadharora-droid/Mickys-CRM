import axios from 'axios';

/**
 * Axios instance with JWT access-token header + automatic refresh on 401.
 * The refresh token lives in an httpOnly cookie scoped to /api/auth.
 */
// API origin. Empty for same-origin (dev uses Vite's /api proxy). Set
// VITE_API_URL (e.g. https://api.centrepointgroup.in) when the backend is on a
// separate host; trailing slash is trimmed so `${API_ROOT}/api` stays clean.
const API_ROOT = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const api = axios.create({
  baseURL: `${API_ROOT}/api`,
  withCredentials: true,
});

// The access token is kept in memory only — never in localStorage/sessionStorage
// — so an XSS payload can't read a long-lived credential off disk and exfiltrate
// it. The httpOnly refresh cookie re-establishes the session on reload via
// refreshSession(). Trade-off: a full page load needs one /auth/refresh round-trip.
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token || null;
}

export function getAccessToken() {
  return accessToken;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshPromise = null;

/**
 * Exchanges the httpOnly refresh cookie for a fresh access token and returns the
 * { user, accessToken } payload. Concurrent callers in this tab share one
 * in-flight request; across tabs a Web Lock serialises the call so two tabs
 * booting at once can't both spend the same cookie and trip the server's
 * refresh-token reuse detection (which would log everyone out).
 */
export function refreshSession() {
  if (!refreshPromise) {
    const run = async () => {
      const { data } = await axios.post(
        `${API_ROOT}/api/auth/refresh`,
        {},
        { withCredentials: true }
      );
      setAccessToken(data.data.accessToken);
      return data.data;
    };
    refreshPromise = (async () => {
      try {
        return navigator.locks?.request
          ? await navigator.locks.request('mickys-refresh', run)
          : await run();
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // Try a single token refresh per failed request, never for auth endpoints
    if (status === 401 && !original._retry && !original.url.startsWith('/auth/')) {
      original._retry = true;
      try {
        const { accessToken: token } = await refreshSession();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshErr) {
        setAccessToken(null);
        window.dispatchEvent(new Event('mickys:logout'));
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(error);
  }
);

/** Extracts a friendly message from an axios error. */
export function apiError(err) {
  const data = err?.response?.data;
  if (data?.details?.length) return `${data.message}: ${data.details[0]}`;
  return data?.message || err?.message || 'Something went wrong';
}

export default api;
