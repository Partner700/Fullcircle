export function emailConfirmationRedirectUrl(location: Pick<Location, 'origin' | 'pathname'> = window.location) {
  return new URL(location.pathname, location.origin).toString();
}

export function readEmailConfirmationLink(search: string = window.location.search) {
  const params = new URLSearchParams(search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (!tokenHash || (type !== 'signup' && type !== 'email')) return null;
  return { token_hash: tokenHash, type } as const;
}

export function readEmailConfirmationError(href: string = window.location.href) {
  const url = new URL(href);
  if (url.searchParams.get('reset-password') === '1') return null;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const code = hash.get('error_code') || url.searchParams.get('error_code') || '';
  const description = hash.get('error_description') || url.searchParams.get('error_description') || '';
  if (code === 'otp_expired' || /confirm|email|token|link/i.test(description)) {
    return 'The confirmation link did not work or has expired. Enter your email and request a new one.';
  }
  return null;
}

export const initialEmailConfirmationError = typeof window === 'undefined' ? null : readEmailConfirmationError();

export function clearEmailConfirmationLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete('token_hash');
  url.searchParams.delete('type');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
