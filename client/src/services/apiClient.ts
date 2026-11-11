/**
 * KAIRA Centralized API Client & Fetch Interceptor
 * 
 * Intercepts all outgoing and incoming fetch calls to:
 * 1. Automatically attach Bearer Authorization headers from localStorage.
 * 2. Globally intercept HTTP 401 Unauthorized / SESSION_EXPIRED responses.
 * 3. Clear expired credentials and emit a 'kaira:session_expired' event.
 * 4. Prevent repetitive redirect loops.
 */

let isHandlingExpiredSession = false;

export function setupFetchInterceptor(onSessionExpired: (message: string) => void) {
  if (typeof window === 'undefined') return;

  const originalFetch = window.fetch;

  window.fetch = async (...args) => {
    let [resource, config] = args;

    // Attach Bearer token if not explicitly provided
    const token = localStorage.getItem('kaira_token');
    if (token) {
      config = config || {};
      const headers = new Headers(config.headers || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      config.headers = headers;
    }

    try {
      const response = await originalFetch(resource, config);

      if (response.status === 401) {
        // Clone response to inspect body without consuming the original stream
        try {
          const clone = response.clone();
          const data = await clone.json();

          if (data?.code === 'SESSION_EXPIRED' || data?.error?.toLowerCase().includes('expired')) {
            if (!isHandlingExpiredSession) {
              isHandlingExpiredSession = true;
              localStorage.removeItem('kaira_token');
              localStorage.removeItem('kaira_user');

              const message = data.error || 'Your session has expired. Please log in again.';
              onSessionExpired(message);

              // Allow future expirations after delay
              setTimeout(() => {
                isHandlingExpiredSession = false;
              }, 3000);
            }
          }
        } catch {
          // Response body was not JSON or already consumed
        }
      }

      return response;
    } catch (error) {
      throw error;
    }
  };
}

/**
 * Decode JWT expiration time in seconds (exp claim)
 */
export function getJwtExpiration(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}
