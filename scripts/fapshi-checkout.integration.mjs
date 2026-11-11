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
  FAPSHI_CHECKOUT_MODE: 'hosted',
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
    return auth === 'Bearer cadet' ? json({ id: 'cadet', email: 'buyer@example.test' })
      : auth === 'Bearer other' ? json({ id: 'other' }) : json({}, 401);
  }
  if (url.pathname.endsWith('/profiles')) {
    assert.equal(url.searchParams.get('id'), 'eq.cadet');
    return json([{ display_name: 'Test Cadet' }]);
  }
  if (url.pathname.endsWith('/subscription_plans')) {
    return json([{ id: 'monthly', name: 'Full Circle Monthly', amount_xaf: 2000, demo_amount_xaf: 25, duration_days: 31 }]);
  }
  if (url.pathname.endsWith('/relic_types')) {
    assert.equal(url.searchParams.get('is_active'), 'eq.true');
    return json([{ slug: 'skip', name: 'Skip', money_price_xaf: 300 }]);
  }
  if (['/initiate-pay', '/direct-pay'].includes(url.pathname)) {
    assert.equal(url.origin, 'https://live.fapshi.com');
    assert.equal(body.amount, payment.amount_local);
    assert.equal(body.externalId, payment.reference);
    assert.equal(body.userId, payment.reference);
    if (url.pathname === '/direct-pay') {
      assert.equal(body.phone, '675123456');
      assert.equal(body.medium, payment.payment_method === 'mtn_momo' ? 'mobile money' : 'orange money');
      assert.equal(body.name, 'Test Cadet');
      assert.equal(body.email, 'buyer@example.test');
      assert.equal(body.pin, undefined);
    } else {
      assert.equal(body.phone, undefined);
    }
    createCount++;
    providerPayment = { transId: 'test_id', transType: 'Collection', externalId: body.externalId, amount: body.amount, status: 'PENDING' };
    if (lostResponse) throw new Error('Connection lost');
    return json({ transId: providerPayment.transId, link: url.pathname === '/initiate-pay' ? 'https://pay.fapshi.com/test_id' : undefined });
  }
  if (url.pathname === '/payment-status/test_id') {
    statusCount++;
    return json(providerPayment);
  }
  if (url.pathname === '/transaction/' + payment?.reference) return json([providerPayment]);
  if (url.pathname.endsWith('/rpc/reserve_fcx_fapshi_checkout')) {
    assert.equal(body.p_user_id, 'cadet');
    assert.equal(body.p_event_id, '11111111-1111-4111-8111-111111111111');
    if (body.p_displayed_amount !== 3000) return json({ code: 'P0001', message: 'The FCX price has changed.' }, 400);
    const created = payment?.purchase_kind !== 'fcx_ticket' || payment.status !== 'pending';
    if (created) payment = {
      id: crypto.randomUUID(), user_id: body.p_user_id, reference: body.p_reference,
      purchase_kind: 'fcx_ticket', currency_code: 'XAF', amount_local: 3000, status: 'pending',
    };
    return json({
      id: payment.id, reference: payment.reference, amount: payment.amount_local, title: 'FCX',
      checkout_url: payment.fapshi_checkout_url, created,
    });
  }
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
  if (url.pathname.endsWith('/rpc/reject_campay_payment')) {
    assert.equal(body.p_payment_id, payment.id);
    payment.status = 'rejected';
    payment.rejection_reason = body.p_reason;
    return json({ status: 'rejected' });
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
lostResponse = false;
const fcx = {
  user_id: 'cadet', purchase_kind: 'fcx_ticket', fcx_event_id: '11111111-1111-4111-8111-111111111111',
  displayed_amount_xaf: 3000, payment_method: 'fapshi_hosted',
};
assert.equal((await checkout(req({ ...fcx, displayed_amount_xaf: 300 }, cadet))).status, 409);
assert.equal((await checkout(req(fcx, { Authorization: 'Bearer other' }))).status, 403);
const ticket = await (await checkout(req(fcx, cadet))).json();
assert.equal(ticket.checkout_url, 'https://pay.fapshi.com/test_id');
assert.equal((await (await checkout(req(fcx, cadet))).json()).reference, ticket.reference);
assert.equal(createCount, 3);
providerPayment.status = 'SUCCESSFUL';
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.deepEqual(deliveries, ['finalize_campay_payment', 'finalize_subscription_payment', 'finalize_fcx_fapshi_payment']);
console.log('Fapshi relic, subscription and FCX checkout verification passed.');

delete env.FAPSHI_CHECKOUT_MODE;
await import('../supabase/functions/create-checkout-session/index.ts?mode=direct');
const direct = handler;
const methodQuote = await (await direct(req({ user_id: 'cadet', provider_only: true }, cadet))).json();
assert.equal(methodQuote.payment_provider, 'fapshi_direct');
assert.equal((await direct(req(order, cadet))).status, 409, 'a stale hosted client must not create an order');
const mobileOrder = {
  ...order,
  payment_method: 'mtn_momo',
  customer_phone: '+237 675 123 456',
  customer_name: 'Ignore client name',
  customer_email: 'ignore@example.test',
};
assert.equal((await direct(req({ ...mobileOrder, customer_phone: '+1 888 123 4567' }, cadet))).status, 400);
assert.equal(createCount, 3);

lostResponse = false;
const mobile = await (await direct(req(mobileOrder, cadet))).json();
assert.equal(mobile.status, 'pending');
assert.equal(mobile.checkout_url, undefined);
assert.match(mobile.message, /prompt on your phone/);
assert.equal(payment.sender_phone, '237675123456');
assert.equal((await (await direct(req(mobileOrder, cadet))).json()).reference, mobile.reference);
assert.equal(createCount, 4, 'retries must not send two prompts');
providerPayment.status = 'FAILED';
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.equal(payment.status, 'rejected', 'Direct Pay failure permits a new request');

const orange = await (await direct(req({ ...plan, ...mobileOrder, displayed_amount_xaf: 2000,
  payment_method: 'orange_money' }, cadet))).json();
assert.equal(orange.status, 'pending');
assert.equal(orange.checkout_url, undefined);
providerPayment.status = 'SUCCESSFUL';
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.deepEqual(deliveries, ['finalize_campay_payment', 'finalize_subscription_payment', 'finalize_fcx_fapshi_payment', 'finalize_subscription_payment']);
assert.equal(createCount, 5);

const directFcx = { ...fcx, payment_method: 'mtn_momo', customer_phone: '+237 675 123 456' };
assert.equal((await direct(req(fcx, cadet))).status, 409, 'a stale FCX client must not reserve a place');
assert.equal((await direct(req({ ...directFcx, customer_phone: '555' }, cadet))).status, 400);
const directTicket = await (await direct(req(directFcx, cadet))).json();
assert.equal(directTicket.status, 'pending');
assert.equal(directTicket.checkout_url, null);
assert.equal(payment.sender_phone, '237675123456');
assert.equal(payment.payment_method, 'mtn_momo');
assert.equal((await (await direct(req(directFcx, cadet))).json()).reference, directTicket.reference);
assert.equal(createCount, 6, 'an FCX retry must not send a second prompt');
providerPayment.status = 'SUCCESSFUL';
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.equal((await webhook(req(providerPayment, hook))).status, 200);
assert.equal(deliveries.filter(name => name === 'finalize_fcx_fapshi_payment').length, 2);
for (const [providerResult, expected] of [
  [{ status: 'EXPIRED' }, 'Payment approval expired.'],
  [{ status: 'FAILED', failureCode: 'USSD_TIMEOUT' }, 'Payment approval expired.'],
  [{ status: 'FAILED', failureReason: 'Insufficient funds' }, 'Insufficient funds.'],
  [{ status: 'FAILED', message: 'Insufficient funds' }, 'Fapshi payment was not completed.'],
]) {
  const attempt = await (await direct(req(mobileOrder, cadet))).json();
  assert.equal(attempt.status, 'pending');
  Object.assign(providerPayment, providerResult);
  const outcome = await (await status(req({ reference: attempt.reference }, cadet))).json();
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.rejection_reason, expected);
  const reloaded = await (await status(req({ reference: attempt.reference }, cadet))).json();
  assert.equal(reloaded.rejection_reason, expected, 'retain the verified reason after reload');
}

console.log('Hosted and Direct Pay checkout and payment verification passed.');

await import('../supabase/functions/fapshi-service-balance/index.ts');
const readBalance = handler;
let balanceCalls = 0;
let fapshiBalance = { service: 'Full Circle', balance: 0, currency: 'XAF' };
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.pathname === '/auth/v1/user') {
    const auth = new Headers(init.headers).get('authorization');
    return auth === 'Bearer instructor' || auth === 'Bearer cadet'
      ? json({ id: auth.slice(7) }) : json({}, 401);
  }
  if (url.pathname === '/rest/v1/role_assignments') {
    assert.equal(url.searchParams.get('role'), 'eq.instructor');
    assert.equal(url.searchParams.get('status'), 'in.(active,approved)');
    return json(url.searchParams.get('user_id') === 'eq.instructor' ? [{ id: 'role' }] : []);
  }
  assert.equal(url.href, 'https://live.fapshi.com/balance');
  assert.equal(init.method, 'GET');
  assert.equal(new Headers(init.headers).get('apikey'), 'test-key');
  balanceCalls++;
  return json(fapshiBalance);
};
assert.equal((await readBalance(req({}))).status, 401);
assert.equal((await readBalance(req({}, cadet))).status, 403);
assert.equal(balanceCalls, 0);
const instructor = { Authorization: 'Bearer instructor' };
assert.deepEqual(await (await readBalance(req({}, instructor))).json(), fapshiBalance);
fapshiBalance = { service: 'Full Circle', balance: null, currency: 'XAF' };
assert.equal((await readBalance(req({}, instructor))).status, 502);
console.log('Fapshi balance checks passed for role access, genuine zero, and unavailable data.');
