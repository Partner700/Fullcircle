import assert from 'node:assert/strict';

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--failed-only')) {
  console.error('Usage: node --experimental-strip-types scripts/fapshi-direct-sandbox.mjs [--failed-only]');
  process.exit(1);
}

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

const scenarios = [
  { phone: '670000000', medium: 'mobile money', status: 'SUCCESSFUL' },
  { phone: '690000000', medium: 'orange money', status: 'SUCCESSFUL' },
  { phone: '670000001', medium: 'mobile money', status: 'FAILED' },
];

for (const { phone, medium, status } of scenarios) {
  if (args[0] === '--failed-only' && status !== 'FAILED') continue;
  const reference = `fc_sandbox_${crypto.randomUUID()}`;
  const start = await startFapshiPayment({
    amount: 300, reference, name: 'Direct Pay sandbox test', mobileMoney: { phone, medium },
  });
  assert.ok(start.transId, 'Fapshi Sandbox did not accept the payment request. Check the sandbox service credentials.');
  let actual;
  let lastConnectionError;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 12_000));
    let response;
    try {
      response = await nativeFetch(`https://sandbox.fapshi.com/payment-status/${encodeURIComponent(start.transId)}`, {
        headers: { apiuser, apikey }, redirect: 'error', signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      const code = error.cause?.code;
      const transientCodes = ['ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'];
      if (error.name !== 'TimeoutError' && !transientCodes.includes(code)) throw error;
      lastConnectionError = error;
      if (attempt < 5) console.warn('Fapshi Sandbox status check lost its connection. Retrying the same transaction.');
      continue;
    }
    lastConnectionError = undefined;
    if (!response.ok) throw new Error(`Sandbox status check failed with HTTP ${response.status}.`);
    const data = await response.json();
    assert.equal(data.externalId, reference);
    assert.equal(data.amount, 300);
    assert.equal(data.transType, 'Collection');
    actual = data.status;
    if (actual === 'SUCCESSFUL' || actual === 'FAILED') break;
  }
  if (lastConnectionError) {
    throw new Error(`Could not verify Fapshi Sandbox transaction ${start.transId}.`, { cause: lastConnectionError });
  }
  assert.equal(actual, status);
  console.log(`${medium} sandbox payment verified as ${actual}.`);
}
