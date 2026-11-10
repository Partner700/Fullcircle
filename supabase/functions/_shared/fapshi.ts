const apiUrl = "https://live.fapshi.com";
const checkIntervalMs = 15_000;

type Json = Record<string, unknown>;

export type FapshiPayment = {
  id: string;
  user_id: string;
  reference: string;
  provider_reference: string | null;
  purchase_kind: "relic" | "subscription" | "fcx_ticket";
  amount_local: number;
  currency_code: string;
  status: string;
  created_at: string;
  fapshi_checkout_url: string | null;
};

export function isFapshiReference(value: string): boolean {
  return /^fp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function credentials() {
  const apiuser = Deno.env.get("FAPSHI_API_USER")?.trim();
  const apikey = Deno.env.get("FAPSHI_API_KEY")?.trim();
  if (!apiuser || !apikey) throw new Error("Fapshi checkout is not configured.");
  return { apiuser, apikey };
}

export function assertFapshiConfigured(): void {
  credentials();
  if (!Deno.env.get("FAPSHI_WEBHOOK_SECRET")?.trim()) {
    throw new Error("Fapshi checkout is not configured.");
  }
}

async function api(path: string, body?: Json): Promise<Response> {
  return fetch(apiUrl + path, {
    method: body ? "POST" : "GET",
    headers: { ...credentials(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
}

function transactionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

export function fapshiCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
        (url.hostname === "fapshi.com" || url.hostname.endsWith(".fapshi.com"))
      ? url.href : null;
  } catch {
    return null;
  }
}

export async function startFapshiPayment(input: {
  amount: number;
  reference: string;
  name: string;
}): Promise<{ transId?: string; checkoutUrl?: string; declined?: true }> {
  try {
    const response = await api("/initiate-pay", {
      amount: input.amount,
      // An order-scoped lookup ID recovers a lost response without sharing the
      // member's internal user ID or creating a second checkout.
      userId: input.reference,
      externalId: input.reference,
      message: `Full Circle: ${input.name}`,
    });
    if ([400, 401, 403, 404, 422].includes(response.status)) return { declined: true };
    if (!response.ok) return {};
    const data = await response.json() as Json;
    const checkoutUrl = fapshiCheckoutUrl(data.link);
    return transactionId(data.transId) && checkoutUrl ? { transId: data.transId, checkoutUrl } : {};
  } catch {
    // The link could have been created before the connection failed.
    return {};
  }
}

async function database(path: string, init: RequestInit = {}): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Payment database is not configured.");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Could not update payment records.");
  return response;
}

const paymentColumns = "id,user_id,reference,provider_reference,purchase_kind,amount_local,currency_code,status,created_at,fapshi_checkout_url";

export async function findFapshiPayment(reference: string): Promise<FapshiPayment | null> {
  if (!isFapshiReference(reference)) return null;
  const response = await database(
    `mobile_money_payments?reference=eq.${reference}&select=${paymentColumns}&limit=1`,
  );
  const rows = await response.json() as FapshiPayment[];
  return rows[0] ?? null;
}

export async function findPendingFapshiPayment(userId: string, slug: string): Promise<FapshiPayment | null> {
  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    relic_slug: `eq.${slug}`,
    status: "eq.pending",
    reference: "like.fp_*",
    select: paymentColumns,
    limit: "1",
  });
  const response = await database(`mobile_money_payments?${query}`);
  const rows = await response.json() as FapshiPayment[];
  return rows[0] ?? null;
}

export async function isFapshiWebhook(header: string | null): Promise<boolean> {
  const secret = Deno.env.get("FAPSHI_WEBHOOK_SECRET")?.trim();
  if (!header || !secret || header.length > 512) return false;
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all([secret, header].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))
  ));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  return difference === 0;
}

export async function verifyFapshiPayment(payment: FapshiPayment, callbackId?: string): Promise<string> {
  if (payment.status !== "pending") return payment.status;
  if (callbackId && (!transactionId(callbackId) ||
      (payment.provider_reference && payment.provider_reference !== callbackId))) {
    throw new Error("Payment reference does not match.");
  }

  if (!callbackId) {
    // Serialize browser polling across tabs/devices below Fapshi's 6/minute cap.
    // Authenticated callbacks can verify immediately during this interval.
    const now = new Date();
    const cutoff = new Date(now.getTime() - checkIntervalMs).toISOString();
    const claim = await database(
      `mobile_money_payments?id=eq.${payment.id}&status=eq.pending&or=(fapshi_checked_at.is.null,fapshi_checked_at.lt.${encodeURIComponent(cutoff)})&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ fapshi_checked_at: now.toISOString() }),
      },
    );
    if (!(await claim.json() as { id: string }[]).length) return "pending";
  }

  let id = payment.provider_reference || callbackId;
  if (!id) {
    const lookup = await api(`/transaction/${encodeURIComponent(payment.reference)}`);
    if (!lookup.ok) return "pending";
    const data: unknown = await lookup.json();
    if (!Array.isArray(data)) return "pending";
    const matches = data.filter((item) => item?.externalId === payment.reference && item?.transType === "Collection");
    if (matches.length === 0 && Date.now() - Date.parse(payment.created_at) >= 120_000) {
      const rejected = await database("rpc/reject_campay_payment", {
        method: "POST",
        body: JSON.stringify({
          p_payment_id: payment.id,
          p_provider_reference: null,
          p_reason: "Fapshi did not create a payment request. You can try again.",
          p_verification: { provider: "fapshi", status: "not_created" },
        }),
      });
      return (await rejected.json() as { status: string }).status;
    }
    if (matches.length !== 1 || !transactionId(matches[0].transId)) return "pending";
    id = matches[0].transId;
  }
  if (!transactionId(id)) throw new Error("Invalid payment reference.");

  const response = await api(`/payment-status/${encodeURIComponent(id)}`);
  if (response.status === 429) return "pending";
  if (!response.ok) throw new Error("Could not check Fapshi payment.");
  const verified = await response.json() as Json;
  if (verified.transId !== id || verified.externalId !== payment.reference ||
      verified.transType !== "Collection" || verified.amount !== Number(payment.amount_local) ||
      payment.currency_code !== "XAF" || (verified.currency != null && verified.currency !== "XAF")) {
    throw new Error("Fapshi payment does not match the order.");
  }

  const common = {
    p_payment_id: payment.id,
    p_provider_reference: id,
    // Store only the fields needed for reconciliation, without payer details.
    p_verification: {
      provider: "fapshi",
      transId: id,
      externalId: payment.reference,
      amount: verified.amount,
      status: verified.status,
    },
  };
  if (verified.status === "SUCCESSFUL") {
    const rpc = {
      subscription: "finalize_subscription_payment",
      relic: "finalize_campay_payment",
      fcx_ticket: "finalize_fcx_fapshi_payment",
    }[payment.purchase_kind];
    await database(`rpc/${rpc}`, {
      method: "POST",
      body: JSON.stringify({ ...common, p_verified_amount: verified.amount, p_verified_currency: "XAF" }),
    });
    return "confirmed";
  }
  // Hosted checkout can be retried after a failed attempt, until the link expires.
  if (verified.status === "EXPIRED") {
    const rejected = await database("rpc/reject_campay_payment", {
      method: "POST",
      body: JSON.stringify({ ...common, p_reason: "Fapshi payment was not completed." }),
    });
    return (await rejected.json() as { status: string }).status;
  }
  return "pending";
}
