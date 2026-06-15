import axios from 'axios';

/**
 * Axios instance with JWT access-token header + automatic refresh on 401.
 * The refresh token lives in an httpOnly cookie scoped to /api/auth.
 */
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

let accessToken = localStorage.getItem('mickys_access_token') || null;

export function setAccessToken(token) {
  accessToken = token;
  if (token) localStorage.setItem('mickys_access_token', token);
  else localStorage.removeItem('mickys_access_token');
}

export function getAccessToken() {
  return accessToken;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshPromise = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // Try a single token refresh per failed request, never for auth endpoints
    if (status === 401 && !original._retry && !original.url.startsWith('/auth/')) {
      original._retry = true;
      try {
        refreshPromise =
          refreshPromise || axios.post('/api/auth/refresh', {}, { withCredentials: true });
        const { data } = await refreshPromise;
        refreshPromise = null;
        setAccessToken(data.data.accessToken);
        original.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        refreshPromise = null;
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
