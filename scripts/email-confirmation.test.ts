import assert from 'node:assert/strict';
import { clearEmailConfirmationLink, emailConfirmationRedirectUrl, readEmailConfirmationError, readEmailConfirmationLink } from '../src/lib/emailConfirmation.ts';

assert.equal(
  emailConfirmationRedirectUrl({ origin: 'https://tnsorganization.github.io', pathname: '/Full-Circle/' }),
  'https://tnsorganization.github.io/Full-Circle/',
);
assert.equal(
  emailConfirmationRedirectUrl({ origin: 'https://fullcircle.partnertai.com', pathname: '/' }),
  'https://fullcircle.partnertai.com/',
);
assert.deepEqual(readEmailConfirmationLink('?token_hash=abc123&type=signup'), { token_hash: 'abc123', type: 'signup' });
assert.deepEqual(readEmailConfirmationLink('?token_hash=abc123&type=email'), { token_hash: 'abc123', type: 'email' });
assert.equal(readEmailConfirmationLink('?token_hash=abc123&type=recovery'), null);
assert.equal(readEmailConfirmationLink('?type=signup'), null);
assert.match(readEmailConfirmationError('https://fullcircle.partnertai.com/#error=access_denied&error_code=otp_expired') || '', /expired/);
assert.equal(readEmailConfirmationError('https://fullcircle.partnertai.com/?reset-password=1#error_code=otp_expired'), null);
assert.equal(readEmailConfirmationError('https://fullcircle.partnertai.com/'), null);

const originalWindow = globalThis.window;
let replaced = '';
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    location: { href: 'https://tnsorganization.github.io/Full-Circle/?share=reading&token_hash=secret&type=email#section' },
    history: { state: { previous: true }, replaceState: (_state: unknown, _title: string, url: string) => { replaced = url; } },
  },
});
try {
  clearEmailConfirmationLink();
  assert.equal(replaced, '/Full-Circle/?share=reading#section');
} finally {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
}

console.log('Email confirmation redirect and callback URL checks passed.');
