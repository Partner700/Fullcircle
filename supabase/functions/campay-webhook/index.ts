import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type CampayWebhookPayload = {
  reference?: string;
  external_reference?: string;
  tx_ref?: string;
  status?: string;
  state?: string;
  webhook_key?: string;
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

async function fetchPaymentByReference(reference: string): Promise<{ id: string; user_id: string; relic_slug: string; status: string; amount_local: number } | null> {
  const columns = ["reference", "provider_reference", "external_reference"];

  for (const column of columns) {
    const payRes = await fetch(
      `${supabaseUrl}/rest/v1/mobile_money_payments?${column}=eq.${encodeURIComponent(reference)}&select=id,user_id,relic_slug,relic_name,status,amount_local`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!payRes.ok) throw new Error(`Failed to fetch payment: ${payRes.status}`);
    const payments: Array<{ id: string; user_id: string; relic_slug: string; status: string; amount_local: number }> = await payRes.json();
    if (payments[0]) return payments[0];
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
    if (campayWebhookKey && incomingWebhookKey && incomingWebhookKey !== campayWebhookKey) {
      return new Response(JSON.stringify({ error: "Invalid webhook key" }), {
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

    const token = await getCampayToken();
    const verifyRes = await fetch(`${campayBaseUrl}/api/transaction/${encodeURIComponent(reference)}/`, {
      headers: { "Authorization": `Token ${token}` },
    });

    if (!verifyRes.ok) {
      const body = await verifyRes.text();
      throw new Error(`Campay verification failed: ${verifyRes.status} ${body}`);
    }

    const verifyData = await verifyRes.json();
    const paymentStatus = (verifyData.status || verifyData.state || status || "").toLowerCase();

    if (isSuccessful(paymentStatus)) {
      const payment = await fetchPaymentByReference(reference);
      if (!payment) throw new Error("Payment not found for reference: " + reference);

      if (payment.status === "confirmed") {
        return new Response(JSON.stringify({ received: true, reference, status: "already_confirmed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await fetch(`${supabaseUrl}/rest/v1/mobile_money_payments?id=eq.${payment.id}`, {
        method: "PATCH",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ status: "confirmed" }),
      });

      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/purchase_relic`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_user_id: payment.user_id,
          p_relic_slug: payment.relic_slug,
          p_currency: "campay",
        }),
      });
      if (!rpcRes.ok) {
        const errBody = await rpcRes.text();
        throw new Error(`purchase_relic failed: ${rpcRes.status} ${errBody}`);
      }

      await attemptCampayPayout(payment.id, Number(payment.amount_local), reference, token);

      return new Response(JSON.stringify({ received: true, reference, status: "granted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isFailed(paymentStatus)) {
      const payment = await fetchPaymentByReference(reference);
      if (payment) {
        await fetch(`${supabaseUrl}/rest/v1/mobile_money_payments?id=eq.${payment.id}`, {
          method: "PATCH",
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ status: "rejected", rejection_reason: paymentStatus }),
        });
      }
    }

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
