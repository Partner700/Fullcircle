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

async function getAuthenticatedUser(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: authorization,
    },
  });
  if (!res.ok) throw new Error("You need to be signed in to update your password.");
  const user = await res.json();
  if (!user?.id || !user?.email) throw new Error("Could not read your account email.");
  return { id: String(user.id), email: String(user.email).toLowerCase() };
}

async function verifyOldPassword(email: string, oldPassword: string) {
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_ANON_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: oldPassword }),
  });
  if (!res.ok) throw new Error("That old password was not correct.");
}

async function updatePassword(userId: string, newPassword: string) {
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Password update failed: ${body}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    const body = await req.json();
    const oldPassword = String(body.oldPassword || "");
    const newPassword = String(body.newPassword || "");
    const verifyOnly = Boolean(body.verifyOnly);

    if (!oldPassword) return json({ error: "Old password is required." }, 400);
    await verifyOldPassword(user.email, oldPassword);

    if (verifyOnly) return json({ ok: true });
    if (newPassword.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

    await updatePassword(user.id, newPassword);
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 400);
  }
});
