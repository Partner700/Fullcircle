import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { findFapshiPayment, isFapshiReference, isFapshiWebhook, verifyFapshiPayment } from "../_shared/fapshi.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!await isFapshiWebhook(request.headers.get("x-wh-secret"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    if (typeof body?.externalId !== "string" || !isFapshiReference(body.externalId) ||
        typeof body?.transId !== "string" || !body.transId ||
        body.transType !== "Collection" || !["SUCCESSFUL", "FAILED", "EXPIRED"].includes(body.status)) {
      return Response.json({ received: true });
    }
    const payment = await findFapshiPayment(body.externalId);
    if (payment) await verifyFapshiPayment(payment, body.transId);
    return Response.json({ received: true });
  } catch {
    return Response.json({ error: "Could not reconcile the payment" }, { status: 502 });
  }
});
