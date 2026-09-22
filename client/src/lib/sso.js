// Central sign-on helpers. Disabled when VITE_AUTH_URL is not set.
const AUTH_URL = (import.meta.env.VITE_AUTH_URL || '').replace(/\/+$/, '');

export const SSO_APP_KEY = 'mickys-crm';

export function ssoEnabled() {
  return Boolean(AUTH_URL);
}

// Asks the auth service for a hand-off token for this app. Null when the
// visitor is not signed in to the portal or has no CRM account linked.
export async function resolveSsoToken() {
  if (!AUTH_URL) return null;
  try {
    const response = await fetch(`${AUTH_URL}/auth/resolve?app=${SSO_APP_KEY}`, { credentials: 'include' });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.ok && data.token ? data.token : null;
  } catch {
    return null;
  }
}

// Ends the portal session too, otherwise the next page load would sign in again.
export async function ssoLogout() {
  if (!AUTH_URL) return;
  try {
    await fetch(`${AUTH_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    /* auth service unreachable; local logout still proceeds */
  }
}
