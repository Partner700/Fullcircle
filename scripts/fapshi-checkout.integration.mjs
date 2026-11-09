import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'jsr:@supabase/functions-js/edge-runtime.d.ts') {
      return { url: 'data:text/javascript,export{}', shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
  PAYMENT_PROVIDER: 'fapshi',
  FAPSHI_API_USER: 'test-user',
  FAPSHI_API_KEY: 'test-key',
  FAPSHI_WEBHOOK_SECRET: 'test-hook',
  CAMPAY_ENVIRONMENT: 'DEV',
};
let handler;
globalThis.Deno = { env: { get: key => env[key] }, serve: callback => { handler = callback; } };
await import('../supabase/functions/create-checkout-session/index.ts');
const checkout = handler;
await import('../supabase/functions/campay-webhook/index.ts');
const status = handler;
await import('../supabase/functions/fapshi-webhook/index.ts');
const webhook = handler;

let payment;
let providerPayment;
let createCount = 0;
let statusCount = 0;
let lostResponse = false;
const deliveries = [];
const json = (data, status = 200) => Response.json(data, { status });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const body = init.body ? JSON.parse(init.body) : null;
  const auth = new Headers(init.headers).get('Authorization');
  if (url.pathname === '/auth/v1/user') {
    return auth === 'Bearer cadet' ? json({ id: 'cadet' })
      : auth === 'Bearer other' ? json({ id: 'other' }) : json({}, 401);
  }
  if (url.pathname.endsWith('/subscription_plans')) {
    return json([{ id: 'monthly', name: 'Full Circle Monthly', amount_xaf: 2000, demo_amount_xaf: 25, duration_days: 31 }]);
  }
  if (url.pathname.endsWith('/relic_types')) {
    assert.equal(url.searchParams.get('is_active'), 'eq.true');
    return json([{ slug: 'skip', name: 'Skip', money_price_xaf: 300 }]);
  }
  if (url.pathname === '/initiate-pay') {
    assert.equal(url.origin, 'https://live.fapshi.com');
    assert.equal(body.amount, payment.amount_local);
    assert.equal(body.externalId, payment.reference);
    assert.equal(body.userId, payment.reference);
    assert.equal(body.phone, undefined);
    createCount++;
    providerPayment = { transId: 'test_id', transType: 'Collection', externalId: body.externalId, amount: body.amount, status: 'PENDING' };
    if (lostResponse) throw new Error('Connection lost');
    return json({ transId: providerPayment.transId, link: 'https://pay.fapshi.com/test_id' });
  }
  if (url.pathname === '/payment-status/test_id') {
    statusCount++;
    return json(providerPayment);
  }
  if (url.pathname === '/transaction/' + payment?.reference) return json([providerPayment]);
  if (url.pathname.endsWith('/mobile_money_payments')) {
    if (init.method === 'POST') {
      if (payment?.status === 'pending') return json({}, 409);
      payment = { ...body, id: crypto.randomUUID() };
      return json([payment], 201);
    }
    if (init.method === 'PATCH') {
      if (body.fapshi_checked_at && payment.fapshi_checked_at) return json([]);
      Object.assign(payment, body);
      return json([payment]);
    }
    return json(payment ? [payment] : []);
  }
  if (url.pathname.includes('/rpc/finalize_')) {
    assert.equal(body.p_verified_currency, 'XAF');
    assert.equal(body.p_verified_amount, payment.amount_local);
    assert.equal(body.p_payment_id, payment.id);
    deliveries.push(url.pathname.split('/').at(-1));
    payment.status = 'confirmed';
    return json({ status: 'confirmed' });
  }
  throw new Error('Unexpected fetch: ' + url.pathname);
};

const req = (data, headers = {}) => new Request('https://edge.test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(data),
});
const cadet = { Authorization: 'Bearer cadet' };
const hook = { 'x-wh-secret': 'test-hook' };
const order = { user_id: 'cadet', relic_slug: 'skip', payment_method: 'fapshi_hosted', displayed_amount_xaf: 300 };
assert.equal((await checkout(req({ ...order, displayed_amount_xaf: 25 }, cadet))).status, 409);
assert.equal((await checkout(req({ ...order, user_id: 'other' }, cadet))).status, 403);
assert.equal(createCount, 0);

const initiated = await (await checkout(req(order, cadet))).json();
assert.equal(initiated.status, 'pending');
assert.equal(initiated.checkout_url, 'https://pay.fapshi.com/test_id');
assert.equal((await (await checkout(req(order, cadet))).json()).reference, initiated.reference);
assert.equal(createCount, 1);
assert.equal((await status(req({ reference: initiated.reference }, { Authorization: 'Bearer other' }))).status, 404);
assert.equal((await webhook(req({ ...providerPayment, status: 'SUCCESSFUL' }))).status, 401);
assert.equal(statusCount, 0);
assert.equal((await webhook(req({ ...providerPayment, status: 'SUCCESSFUL' }, hook))).status, 200);
assert.deepEqual(deliveries, []);
providerPayment.status = 'SUCCESSFUL';
providerPayment.amount = 301;
assert.equal((await webhook(req(providerPayment, hook))).status, 502);
assert.deepEqual(deliveries, []);
providerPayment.amount = 300;
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.deepEqual(deliveries, ['finalize_campay_payment']);

const plan = { ...order, purchase_kind: 'subscription', subscription_plan_id: 'monthly', displayed_amount_xaf: 2000 };
const quote = await (await checkout(req({ ...plan, quote_only: true }, cadet))).json();
assert.equal(quote.amount_local, 2000);
assert.equal(quote.payment_provider, 'fapshi');
lostResponse = true;
const delayed = await (await checkout(req(plan, cadet))).json();
assert.equal(delayed.status, 'pending');
assert.equal(payment.provider_reference, undefined);
providerPayment.status = 'SUCCESSFUL';
assert.equal((await (await status(req({ reference: delayed.reference }, cadet))).json()).status, 'confirmed');
assert.deepEqual(deliveries, ['finalize_campay_payment', 'finalize_subscription_payment']);
assert.equal(createCount, 2);
console.log('Fapshi checkout and payment verification passed.');
