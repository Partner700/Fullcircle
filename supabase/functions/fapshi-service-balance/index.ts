import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getFapshiCollectionBalance } from "../_shared/fapshi.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
  "Cache-Control": "no-store",
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in to view the balance." }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Missing project configuration.");
    const user = await fetch(url + "/auth/v1/user", {
      headers: { apikey: key, Authorization: authorization },
      signal: AbortSignal.timeout(8_000),
    });
    if (!user.ok) return json({ error: "Sign in to view the balance." }, 401);
    const { id } = await user.json();
    if (typeof id !== "string" || !id) return json({ error: "Sign in to view the balance." }, 401);

    const query = new URLSearchParams({
      user_id: `eq.${id}`,
      role: "eq.instructor",
      status: "in.(active,approved)",
      select: "id",
      limit: "1",
    });
    const roles = await fetch(url + "/rest/v1/role_assignments?" + query, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!roles.ok) throw new Error("Role verification unavailable.");
    if (!(await roles.json()).length) return json({ error: "Instructor access required." }, 403);

    return json(await getFapshiCollectionBalance());
  } catch {
    return json({ error: "Fapshi balance is unavailable. Try refreshing." }, 502);
  }
});
