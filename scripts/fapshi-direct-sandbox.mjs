import assert from 'node:assert/strict';

const apiuser = process.env.FAPSHI_SANDBOX_API_USER;
const apikey = process.env.FAPSHI_SANDBOX_API_KEY;
if (!apiuser || !apikey) {
  console.error('Set FAPSHI_SANDBOX_API_USER and FAPSHI_SANDBOX_API_KEY in your local environment.');
  process.exit(1);
}

globalThis.Deno = { env: { get: name => ({ FAPSHI_API_USER: apiuser, FAPSHI_API_KEY: apikey })[name] } };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input);
  if (url.origin !== 'https://live.fapshi.com' || url.pathname !== '/direct-pay') {
    throw new Error('Sandbox test only permits Fapshi Direct Pay.');
  }
  return nativeFetch('https://sandbox.fapshi.com/direct-pay', init);
};
const { startFapshiPayment } = await import('../supabase/functions/_shared/fapshi.ts');

for (const { phone, medium, status } of [
  { phone: '670000000', medium: 'mobile money', status: 'SUCCESSFUL' },
  { phone: '690000000', medium: 'orange money', status: 'SUCCESSFUL' },
  { phone: '670000001', medium: 'mobile money', status: 'FAILED' },
]) {
  const reference = `fc_sandbox_${crypto.randomUUID()}`;
  const start = await startFapshiPayment({
    amount: 300, reference, name: 'Direct Pay sandbox test', mobileMoney: { phone, medium },
  });
  assert.ok(start.transId, 'Fapshi Sandbox did not accept the payment request. Check the sandbox service credentials.');
  let actual;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 12_000));
    const response = await nativeFetch(`https://sandbox.fapshi.com/payment-status/${encodeURIComponent(start.transId)}`, {
      headers: { apiuser, apikey }, redirect: 'error', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Sandbox status check failed with HTTP ${response.status}.`);
    const data = await response.json();
    assert.equal(data.externalId, reference);
    assert.equal(data.amount, 300);
    assert.equal(data.transType, 'Collection');
    actual = data.status;
    if (actual === 'SUCCESSFUL' || actual === 'FAILED') break;
  }
  assert.equal(actual, status);
  console.log(`${medium} sandbox payment verified as ${actual}.`);
}
