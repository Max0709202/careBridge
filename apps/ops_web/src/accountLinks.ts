/**
 * Accounts are shared across CareBridge: somebody signs up, verifies their
 * address and resets a forgotten password in the family app, and this app
 * signs in with the same credentials. Where that app lives is a deployment
 * fact, supplied at build time; without it the links are simply not shown.
 */
const base = (import.meta.env.VITE_ACCOUNT_APP_URL as string | undefined)?.replace(/\/+$/, '');

export const accountLinks = base
  ? { register: `${base}/register`, forgotPassword: `${base}/forgot-password` }
  : null;
