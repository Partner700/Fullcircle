import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey",
};

type Relic = {
  id: string;
  slug: string;
  name: string;
  description: string;
  money_price_xaf: string | number | null;
  money_price_usd: string | number | null;
};

type CampayCollectResponse = {
  reference?: string;
  external_reference?: string;
  status?: string;
  message?: string;
  ussd_code?: string;
  operator?: string;
  code?: string;
  operator_reference?: string;
};

type MobileMoneySettings = {
  payout_enabled?: boolean;
  payout_phone_number?: string | null;
  payout_max_amount_xaf?: string | number | null;
};

type SupabaseAuthUserResponse = {
  id?: string;
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
const checkoutCurrency = "XAF";
const defaultXafPerUsd = 575;
const configuredXafPerUsd = Number(optionalEnv("XAF_PER_USD") || defaultXafPerUsd);

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

async function getAuthenticatedUserId(req: Request): Promise<string> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing authenticated user token.");
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: authorization,
    },
  });
  if (!res.ok) {
    throw new Error("Invalid authenticated user token.");
  }

  const user: SupabaseAuthUserResponse = await res.json();
  if (!user.id) throw new Error("Authenticated user not found.");
  return user.id;
}

function providerFor(method?: string, otherProvider?: string): string {
  if (method === "mtn_momo") return "MTN MoMo";
  if (method === "orange_money") return "Orange Money";
  if (method === "mobile_money") return "CamPay Mobile Money";
  if (method === "other") return `Other${otherProvider ? `: ${otherProvider}` : ""}`;
  if (method === "card") return "Card";
  return "Other";
}

function isMobileMoneyCollect(method?: string): boolean {
  return method === "mtn_momo" || method === "orange_money" || method === "mobile_money";
}

function normalizeStatus(status?: string): string {
  const value = (status || "").toLowerCase();
  if (["successful", "success", "completed"].includes(value)) return "confirmed";
  if (["failed", "cancelled", "canceled", "expired"].includes(value)) return "rejected";
  return "pending";
}

function isSuccessful(status?: string): boolean {
  return normalizeStatus(status) === "confirmed";
}

async function grantRelic(userId: string, relicSlug: string, currency: string): Promise<void> {
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/purchase_relic`, {
    method: "POST",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_relic_slug: relicSlug,
      p_currency: currency,
    }),
  });
  if (!rpcRes.ok) {
    const body = await rpcRes.text();
    throw new Error(`purchase_relic failed: ${rpcRes.status} ${body}`);
  }
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

async function updatePaymentPayout(
  paymentId: string,
  patch: Record<string, unknown>,
): Promise<void> {
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

async function attemptCampayPayout(
  paymentId: string,
  amountXaf: number,
  externalReference: string,
  token: string,
): Promise<void> {
  const settings = await fetchMobileMoneySettings();
  if (!settings?.payout_enabled || !settings.payout_phone_number) return;

  const configuredMax = Number(settings.payout_max_amount_xaf);
  const payoutAmount = Number.isFinite(configuredMax) && configuredMax > 0
    ? Math.min(amountXaf, Math.round(configuredMax))
    : amountXaf;
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
      currency: checkoutCurrency,
      to: settings.payout_phone_number,
      description: `Full Circle payout for payment ${externalReference}`,
      external_reference: `${externalReference}_payout`,
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

function formatXaf(amountXaf: number): string {
  return `${amountXaf.toLocaleString("en-US")} FCFA`;
}

function moneyPriceXafForRelic(relic: Relic): number {
  const explicitXaf = Number(relic.money_price_xaf);
  if (Number.isFinite(explicitXaf) && explicitXaf > 0) return Math.round(explicitXaf);

  const legacyUsd = Number(relic.money_price_usd);
  if (Number.isFinite(legacyUsd) && legacyUsd > 0) return Math.round(legacyUsd * xafPerUsdForLegacy());

  throw new Error("Relic has no real-money price");
}

function xafPerUsdForLegacy(): number {
  if (Number.isFinite(configuredXafPerUsd) && configuredXafPerUsd > 0) return configuredXafPerUsd;
  return defaultXafPerUsd;
}

function legacyUsdForRecord(relic: Relic, amountXaf: number): number {
  const legacyUsd = Number(relic.money_price_usd);
  if (Number.isFinite(legacyUsd) && legacyUsd > 0) return legacyUsd;
  return Number((amountXaf / xafPerUsdForLegacy()).toFixed(2));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const {
      relic_slug, user_id, payment_method, customer_phone, other_provider, payment_note,
      displayed_amount_xaf,
    } = await req.json();

    if (!relic_slug || !user_id) {
      return new Response(JSON.stringify({ error: "relic_slug and user_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (authenticatedUserId !== user_id) {
      return new Response(JSON.stringify({ error: "Checkout user mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const relicRes = await fetch(
      `${supabaseUrl}/rest/v1/relic_types?slug=eq.${encodeURIComponent(relic_slug)}&select=id,slug,name,description,money_price_xaf,money_price_usd`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!relicRes.ok) throw new Error(`Failed to fetch relic: ${relicRes.status}`);
    const relics: Relic[] = await relicRes.json();
    const relic = relics[0];
    if (!relic) throw new Error("Relic not found");

    const amountXaf = moneyPriceXafForRelic(relic);
    const amountUsd = legacyUsdForRecord(relic, amountXaf);
    const displayedAmountXaf = Number(displayed_amount_xaf);
    if (
      Number.isFinite(displayedAmountXaf) &&
      Math.round(displayedAmountXaf) !== amountXaf
    ) {
      return new Response(JSON.stringify({
        error: `Price changed. Please reopen checkout and confirm ${formatXaf(amountXaf)}.`,
        amount_local: amountXaf,
        currency_code: checkoutCurrency,
        amount_display: formatXaf(amountXaf),
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const externalReference = `fc_${crypto.randomUUID()}`;
    const provider = providerFor(payment_method, other_provider);
    const localAmount = amountXaf.toString();

    if (payment_method === "other") {
      if (!other_provider?.trim()) {
        return new Response(JSON.stringify({ error: "Specify the other payment method." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!payment_note?.trim()) {
        return new Response(JSON.stringify({ error: "Verification details are required for other payment methods." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const insertRes = await fetch(`${supabaseUrl}/rest/v1/mobile_money_payments`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          user_id,
          relic_slug: relic.slug,
          relic_name: relic.name,
          amount_usd: amountUsd,
          amount_local: amountXaf,
          currency_code: checkoutCurrency,
          provider,
          sender_phone: customer_phone || "not_provided",
          status: "pending",
          reference: externalReference,
          external_reference: externalReference,
          payment_method,
          payment_details: payment_note || null,
        }),
      });
      if (!insertRes.ok) {
        const body = await insertRes.text();
        throw new Error(`Failed to record payment: ${insertRes.status} ${body}`);
      }

      return new Response(JSON.stringify({
        status: "manual_pending",
        reference: externalReference,
        amount_local: amountXaf,
        currency_code: checkoutCurrency,
        amount_display: formatXaf(amountXaf),
        provider,
        message: "Payment request submitted for instructor review.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getCampayToken();

    if (isMobileMoneyCollect(payment_method)) {
      if (!customer_phone?.trim()) {
        return new Response(JSON.stringify({ error: "Phone number is required for mobile money." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const collectData: Record<string, unknown> = {
        amount: localAmount,
        currency: checkoutCurrency,
        from: customer_phone,
        description: relic.description || relic.name,
        external_reference: externalReference,
      };

      const collectRes = await fetch(`${campayBaseUrl}/api/collect/`, {
        method: "POST",
        headers: {
          "Authorization": `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(collectData),
      });

      const collectBody = await collectRes.text();
      let collectJson: CampayCollectResponse = {};
      try {
        collectJson = collectBody ? JSON.parse(collectBody) : {};
      } catch {
        collectJson = { message: collectBody };
      }

      if (!collectRes.ok) {
        throw new Error(`Campay collect error: ${collectRes.status} ${collectBody}`);
      }

      const providerReference = collectJson.reference || null;
      const collectPaymentStatus = normalizeStatus(collectJson.status);

      const insertRes = await fetch(`${supabaseUrl}/rest/v1/mobile_money_payments`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          user_id,
          relic_slug: relic.slug,
          relic_name: relic.name,
          amount_usd: amountUsd,
          amount_local: amountXaf,
          currency_code: checkoutCurrency,
          provider,
          sender_phone: customer_phone,
          status: collectPaymentStatus,
          reference: externalReference,
          external_reference: externalReference,
          provider_reference: providerReference,
          payment_method,
          payment_details: payment_note || null,
          operator: collectJson.operator || null,
          ussd_code: collectJson.ussd_code || null,
        }),
      });
      if (!insertRes.ok) {
        const body = await insertRes.text();
        throw new Error(`Failed to record payment: ${insertRes.status} ${body}`);
      }
      const insertedPayments: Array<{ id: string }> = await insertRes.json();
      const paymentId = insertedPayments[0]?.id;

      if (isSuccessful(collectJson.status)) {
        await grantRelic(user_id, relic.slug, "campay");
      }
      if (isSuccessful(collectJson.status) && paymentId) {
        await attemptCampayPayout(paymentId, amountXaf, externalReference, token);
      }

      return new Response(JSON.stringify({
        status: collectJson.status || collectPaymentStatus || "pending",
        reference: externalReference,
        amount_local: amountXaf,
        currency_code: checkoutCurrency,
        amount_display: formatXaf(amountXaf),
        provider_reference: providerReference,
        provider,
        operator: collectJson.operator || null,
        ussd_code: collectJson.ussd_code || null,
        message: isSuccessful(collectJson.status)
          ? "Payment confirmed. Your relic has been added to your inventory."
          : collectJson.message || "Payment request sent. Approve the prompt on your phone. The relic will be added after confirmation.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/mobile_money_payments`, {
      method: "POST",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id,
        relic_slug: relic.slug,
        relic_name: relic.name,
        amount_usd: amountUsd,
        amount_local: amountXaf,
        currency_code: checkoutCurrency,
        provider,
        sender_phone: customer_phone || "not_provided",
        status: "pending",
        reference: externalReference,
        external_reference: externalReference,
        provider_reference: null,
        payment_method,
        payment_details: payment_note || `Payment method: ${payment_method || "other"}`,
      }),
    });
    if (!insertRes.ok) {
      const body = await insertRes.text();
      throw new Error(`Failed to record payment: ${insertRes.status} ${body}`);
    }

    return new Response(JSON.stringify({
      status: "manual_pending",
      reference: externalReference,
      amount_local: amountXaf,
      currency_code: checkoutCurrency,
      amount_display: formatXaf(amountXaf),
      provider,
      message: "Payment request submitted for instructor review.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: errorMessage(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
