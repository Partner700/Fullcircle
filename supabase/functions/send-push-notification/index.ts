import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

type NotificationRow = {
  id: string;
  recipient_id: string;
  title: string;
  body: string | null;
  notification_type: string;
  action_key: string | null;
  metadata: Record<string, unknown> | null;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function serviceHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const suppliedSecret = request.headers.get("x-full-circle-push-secret") || "";

    const verifyResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/verify_push_webhook_secret`, {
      method: "POST",
      headers: serviceHeaders(serviceKey),
      body: JSON.stringify({ p_secret: suppliedSecret }),
    });
    if (!verifyResponse.ok || await verifyResponse.json() !== true) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { notification_id: notificationId } = await request.json();
    if (!notificationId) return new Response("Missing notification_id", { status: 400 });

    const notificationResponse = await fetch(
      `${supabaseUrl}/rest/v1/user_notifications?id=eq.${encodeURIComponent(notificationId)}&select=id,recipient_id,title,body,notification_type,action_key,metadata&limit=1`,
      { headers: serviceHeaders(serviceKey) },
    );
    if (!notificationResponse.ok) throw new Error("Unable to load notification");
    const notification = (await notificationResponse.json())?.[0] as NotificationRow | undefined;
    if (!notification) return new Response("Notification not found", { status: 404 });

    const subscriptionsResponse = await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${notification.recipient_id}&select=id,endpoint,p256dh,auth`,
      { headers: serviceHeaders(serviceKey) },
    );
    if (!subscriptionsResponse.ok) throw new Error("Unable to load subscriptions");
    const subscriptions = await subscriptionsResponse.json() as SubscriptionRow[];
    if (subscriptions.length === 0) return Response.json({ delivered: 0 });

    webpush.setVapidDetails(
      "mailto:notifications@fullcircle.partnertai.com",
      env("VAPID_PUBLIC_KEY"),
      env("VAPID_PRIVATE_KEY"),
    );

    const destination = notification.action_key
      ? `/#fc-tab=${encodeURIComponent(notification.action_key)}`
      : "/";
    const payload = JSON.stringify({
      title: notification.title || "Full Circle",
      body: notification.body || "You have a new update.",
      url: destination,
      tag: `full-circle-${notification.id}`,
      type: notification.notification_type,
      metadata: notification.metadata || {},
    });

    let delivered = 0;
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 3600, urgency: "normal" });
        delivered += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${subscription.id}`, {
            method: "DELETE",
            headers: serviceHeaders(serviceKey),
          });
          return;
        }
        console.error("Push send failed", statusCode, error);
      }
    }));

    return Response.json({ delivered });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error instanceof Error ? error.message : "Push delivery failed" }, { status: 500 });
  }
});

