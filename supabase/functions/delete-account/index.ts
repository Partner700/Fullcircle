import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey",
};

function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAuthenticatedUserId(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: authorization,
    },
  });

  if (!response.ok) throw new Error("You need to be signed in to delete your account.");
  const user = await response.json();
  if (!user?.id) throw new Error("Could not identify the signed-in account.");
  return String(user.id);
}

async function prepareInheritance(accountId: string, heirId: string) {
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/prepare_account_inheritance`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_account_id: accountId,
      p_heir_id: heirId,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    let message = body;
    try {
      message = JSON.parse(body)?.message || body;
    } catch {
      // Keep the response text.
    }
    throw new Error(message || "Could not prepare the account inheritance.");
  }

  return body ? JSON.parse(body) : {};
}

async function deleteAuthUser(userId: string) {
  const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resources were secured, but account deletion must be retried: ${body}`);
  }
}

async function markCompleted(inheritanceId: string) {
  if (!inheritanceId) return;
  await fetch(
    `${env("SUPABASE_URL")}/rest/v1/account_inheritances?id=eq.${encodeURIComponent(inheritanceId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status: "completed",
        completed_at: new Date().toISOString(),
      }),
    },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const accountId = await getAuthenticatedUserId(req);
    const body = await req.json();
    const heirId = String(body?.heirId || "");

    if (!heirId) return json({ error: "Choose an heir before deleting your account." }, 400);
    if (heirId === accountId) return json({ error: "You cannot nominate yourself as heir." }, 400);

    const inheritance = await prepareInheritance(accountId, heirId);
    await deleteAuthUser(accountId);
    await markCompleted(String(inheritance?.inheritance_id || ""));

    return json({ ok: true, heirId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected account deletion error";
    return json({ error: message }, 400);
  }
});

