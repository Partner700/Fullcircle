import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Campay-Webhook-Key, X-Webhook-Key, Webhook-Key",
};

type CampayWebhookPayload = {
  reference?: string;
  external_reference?: string;
  tx_ref?: string;
  status?: string;
  state?: string;
  webhook_key?: string;
  amount?: string | number;
  currency?: string;
};

type MobileMoneySettings = {
  payout_enabled?: boolean;
  payout_phone_number?: string | null;
  payout_max_amount_xaf?: string | number | null;
};

function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unexpected error";
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const supabaseServiceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const campayEnvironment = (optionalEnv("CAMPAY_ENVIRONMENT") || "PROD").toUpperCase();
const campayBaseUrl =
  optionalEnv("CAMPAY_BASE_URL") ||
  (campayEnvironment === "DEV" ? "https://demo.campay.net" : "https://www.campay.net");
const campayAccessToken = optionalEnv("CAMPAY_ACCESS_TOKEN");
const campayAppUsername = optionalEnv("CAMPAY_APP_USERNAME") || optionalEnv("CAMPAY_APP_ID");
const campayAppPassword = optionalEnv("CAMPAY_APP_PASSWORD") || optionalEnv("CAMPAY_APP_SECRET");
const campayWebhookKey = optionalEnv("CAMPAY_WEBHOOK_KEY");

async function getCampayToken(): Promise<string> {
  if (campayAppUsername && campayAppPassword) {
    const res = await fetch(`${campayBaseUrl}/api/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: campayAppUsername, password: campayAppPassword }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (!campayAccessToken) throw new Error(`Campay auth failed: ${res.status} ${body}`);
    } else {
      const data = await res.json();
      const token = data.token || data.access || data.access_token;
      if (token) return token;
      if (!campayAccessToken) throw new Error("Campay auth failed: token response did not include a token.");
    }
  }

  if (campayAccessToken) return campayAccessToken;
  throw new Error("Missing CamPay credentials. Set CAMPAY_APP_USERNAME/CAMPAY_APP_PASSWORD or CAMPAY_ACCESS_TOKEN.");
}

function getIncomingWebhookKey(req: Request, payload: CampayWebhookPayload): string | null {
  return (
    req.headers.get("x-campay-webhook-key") ||
    req.headers.get("x-webhook-key") ||
    req.headers.get("webhook-key") ||
    payload.webhook_key ||
    null
  );
}

function isSuccessful(status: string): boolean {
  return ["successful", "success", "completed"].includes(status.toLowerCase());
}

function isFailed(status: string): boolean {
  return ["failed", "cancelled", "canceled", "expired"].includes(status.toLowerCase());
}

type StoredPayment = {
  id: string;
  user_id: string;
  relic_slug: string;
  status: string;
  amount_local: number;
  currency_code: string;
  created_at: string;
};

type PaymentFinalization = {
  payment_id: string;
  status: string;
  newly_granted?: boolean;
};

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: authorization,
    },
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string };
  return user.id || null;
}

async function callPaymentRpc(name: string, args: Record<string, unknown>): Promise<PaymentFinalization> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`${name} failed: ${response.status} ${responseBody}`);
  }
  return await response.json();
}

async function fetchPaymentByReference(reference: string): Promise<StoredPayment | null> {
  const columns = ["reference", "provider_reference", "external_reference"];

  for (const column of columns) {
    const payRes = await fetch(
      `${supabaseUrl}/rest/v1/mobile_money_payments?${column}=eq.${encodeURIComponent(reference)}&select=id,user_id,relic_slug,relic_name,status,amount_local,currency_code,created_at`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!payRes.ok) throw new Error(`Failed to fetch payment: ${payRes.status}`);
    const payments: StoredPayment[] = await payRes.json();
    if (payments[0]) return payments[0];
  }

  return null;
}

async function fetchPaymentFromVerification(
  webhookReference: string,
  payload: CampayWebhookPayload,
  verification: Record<string, unknown>,
  details: Record<string, unknown>,
): Promise<StoredPayment | null> {
  const candidates = Array.from(new Set([
    webhookReference,
    payload.external_reference,
    payload.tx_ref,
    verification.external_reference,
    verification.tx_ref,
    details.external_reference,
    details.tx_ref,
  ].map((value) => String(value || "").trim()).filter(Boolean)));

  for (const candidate of candidates) {
    const payment = await fetchPaymentByReference(candidate);
    if (payment) return payment;
  }
  return null;
}

async function fetchMobileMoneySettings(): Promise<MobileMoneySettings | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/mobile_money_settings?id=eq.1&select=payout_enabled,payout_phone_number,payout_max_amount_xaf`,
    {
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!res.ok) return null;
  const rows: MobileMoneySettings[] = await res.json();
  return rows[0] || null;
}

async function updatePaymentPayout(paymentId: string, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${supabaseUrl}/rest/v1/mobile_money_payments?id=eq.${paymentId}`, {
    method: "PATCH",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ ...patch, payout_attempted_at: new Date().toISOString() }),
  });
}

async function attemptCampayPayout(paymentId: string, amountXaf: number, reference: string, token: string): Promise<void> {
  const settings = await fetchMobileMoneySettings();
  if (!settings?.payout_enabled || !settings.payout_phone_number) return;

  const configuredMax = Number(settings.payout_max_amount_xaf);
  const payoutAmount = Number.isFinite(configuredMax) && configuredMax > 0
    ? Math.min(Math.round(amountXaf), Math.round(configuredMax))
    : Math.round(amountXaf);
  if (payoutAmount <= 0) return;

  await updatePaymentPayout(paymentId, {
    payout_status: "pending",
    payout_amount_xaf: payoutAmount,
    payout_error: null,
  });

  const payoutRes = await fetch(`${campayBaseUrl}/api/withdraw/`, {
    method: "POST",
    headers: {
      "Authorization": `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: payoutAmount.toString(),
      currency: "XAF",
      to: settings.payout_phone_number,
      description: `Full Circle payout for payment ${reference}`,
      external_reference: `${reference}_payout`,
    }),
  });

  const payoutBody = await payoutRes.text();
  let payoutJson: Record<string, unknown> = {};
  try {
    payoutJson = payoutBody ? JSON.parse(payoutBody) : {};
  } catch {
    payoutJson = { message: payoutBody };
  }

  if (!payoutRes.ok) {
    await updatePaymentPayout(paymentId, {
      payout_status: "failed",
      payout_error: `Campay withdraw error: ${payoutRes.status} ${payoutBody}`,
    });
    return;
  }

  const payoutStatus = String(payoutJson.status || "").toLowerCase();
  await updatePaymentPayout(paymentId, {
    payout_status: payoutStatus === "successful" || payoutStatus === "success" ? "successful" : "pending",
    payout_reference: payoutJson.reference || null,
    payout_amount_xaf: payoutAmount,
    payout_error: null,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const payload: CampayWebhookPayload = body ? JSON.parse(body) : {};

    const incomingWebhookKey = getIncomingWebhookKey(req, payload);
    if (!campayWebhookKey) {
      throw new Error("Missing required environment variable: CAMPAY_WEBHOOK_KEY");
    }

    const isTrustedWebhook = incomingWebhookKey === campayWebhookKey;
    const authenticatedUserId = isTrustedWebhook ? null : await getAuthenticatedUserId(req);
    if (!isTrustedWebhook && !authenticatedUserId) {
      return new Response(JSON.stringify({ error: "A valid webhook key or signed-in user is required." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reference = payload.reference || payload.tx_ref || payload.external_reference || "";
    const status = payload.status || payload.state || "";

    if (!reference) {
      return new Response(JSON.stringify({ error: "No reference provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Browser polling is deliberately limited to the signed-in user's own
    // checkout. CamPay webhooks are authenticated separately by their key.
    const requestedPayment = await fetchPaymentByReference(reference);
    if (authenticatedUserId && (!requestedPayment || requestedPayment.user_id !== authenticatedUserId)) {
      return new Response(JSON.stringify({ error: "Payment not found for this account." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getCampayToken();
    const verifyRes = await fetch(`${campayBaseUrl}/api/transaction/${encodeURIComponent(reference)}/`, {
      headers: { "Authorization": `Token ${token}` },
    });

    if (!verifyRes.ok) {
      const body = await verifyRes.text();
      throw new Error(`Campay verification failed: ${verifyRes.status} ${body}`);
    }

    const verifyData: Record<string, unknown> = await verifyRes.json();
    const verifyDetails = verifyData.data && typeof verifyData.data === "object"
      ? verifyData.data as Record<string, unknown>
      : {};
    const paymentStatus = String(verifyData.status || verifyData.state || status || "").toLowerCase();

    if (isSuccessful(paymentStatus)) {
      const payment = requestedPayment
        || await fetchPaymentFromVerification(reference, payload, verifyData, verifyDetails);
      if (!payment) throw new Error("Payment not found for reference: " + reference);
      if (authenticatedUserId && payment.user_id !== authenticatedUserId) {
        throw new Error("Payment does not belong to the signed-in account.");
      }

      const verifiedAmount = firstPositiveNumber(
        verifyData.amount,
        verifyData.amount_received,
        verifyData.amount_local,
        verifyDetails.amount,
        payload.amount,
      );
      const verifiedCurrency = String(
        verifyData.currency || verifyData.currency_code || verifyDetails.currency || payload.currency || "",
      ).toUpperCase();
      const providerReference = String(verifyData.reference || verifyDetails.reference || reference);

      const finalization = await callPaymentRpc("finalize_campay_payment", {
        p_payment_id: payment.id,
        p_provider_reference: providerReference,
        p_verified_amount: verifiedAmount,
        p_verified_currency: verifiedCurrency,
        p_verification: verifyData,
      });

      if (finalization.newly_granted) {
        await attemptCampayPayout(payment.id, Number(payment.amount_local), reference, token);
      }

      return new Response(JSON.stringify({
        received: true,
        reference,
        status: finalization.newly_granted ? "granted" : "already_confirmed",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isFailed(paymentStatus)) {
      const payment = requestedPayment
        || await fetchPaymentFromVerification(reference, payload, verifyData, verifyDetails);
      if (payment) {
        if (authenticatedUserId && payment.user_id !== authenticatedUserId) {
          throw new Error("Payment does not belong to the signed-in account.");
        }
        await callPaymentRpc("reject_campay_payment", {
          p_payment_id: payment.id,
          p_provider_reference: String(verifyData.reference || verifyDetails.reference || reference),
          p_reason: paymentStatus,
          p_verification: verifyData,
        });
      }
    }

    const pendingPayment = requestedPayment
      || await fetchPaymentFromVerification(reference, payload, verifyData, verifyDetails);
    if (pendingPayment && authenticatedUserId && pendingPayment.user_id !== authenticatedUserId) {
      throw new Error("Payment does not belong to the signed-in account.");
    }

    // A mobile-money approval can settle after the initial checkout window.
    // Keep an unconfirmed transaction pending so a delayed provider callback or
    // a later status check can still deliver the purchased relic.

    return new Response(JSON.stringify({ received: true, reference, status: paymentStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: errorMessage(err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
