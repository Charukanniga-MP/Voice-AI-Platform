/**
 * Client navigation utilities for single-page routing without external router dependencies.
 */

export const navigateToResetPassword = (token?: string) => {
  const url = token ? `/reset-password?token=${encodeURIComponent(token)}` : '/reset-password';
  window.history.pushState({}, document.title, url);
  window.location.hash = '#reset-password';
  window.dispatchEvent(new CustomEvent('kaira:navigate', { detail: 'reset-password' }));
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export const navigateToHome = () => {
  if (window.location.hash) {
    history.replaceState(null, document.title, ' ');
  }
  window.history.pushState({}, document.title, '/');
  window.dispatchEvent(new CustomEvent('kaira:navigate', { detail: 'home' }));
  window.dispatchEvent(new PopStateEvent('popstate'));
};

