import assert from 'node:assert/strict';
import {
  normalizeCampayPhone,
  verifyCampayCallbackSignature,
} from '../supabase/functions/_shared/campay.ts';

assert.equal(normalizeCampayPhone('+237 675 123 456'), '237675123456');
assert.equal(normalizeCampayPhone('6 75 123 456'), '237675123456');
assert.equal(normalizeCampayPhone('0675123456'), '237675123456');
assert.equal(normalizeCampayPhone('00237675123456'), '237675123456');
assert.equal(normalizeCampayPhone('+234 801 234 5678'), null);
assert.equal(normalizeCampayPhone('not a phone'), null);

const webhookKey = 'full-circle-campay-test-key';
const encoder = new TextEncoder();
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ reference: 'campay-test-reference' })).toString('base64url');
const signingInput = `${header}.${payload}`;
const signingKey = await crypto.subtle.importKey(
  'raw',
  encoder.encode(webhookKey),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const signedBytes = await crypto.subtle.sign('HMAC', signingKey, encoder.encode(signingInput));
const signature = Buffer.from(signedBytes).toString('base64url');
const signedCallback = `${signingInput}.${signature}`;

assert.equal(await verifyCampayCallbackSignature(signedCallback, webhookKey), true);
assert.equal(await verifyCampayCallbackSignature(signedCallback, 'wrong-key'), false);
assert.equal(await verifyCampayCallbackSignature(`${signingInput}.invalid`, webhookKey), false);

const unsignedHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
assert.equal(
  await verifyCampayCallbackSignature(`${unsignedHeader}.${payload}.`, webhookKey),
  false,
);

console.log('CamPay phone normalization and callback verification checks passed.');

