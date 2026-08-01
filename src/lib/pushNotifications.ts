import { supabase } from './supabase';

export const VAPID_PUBLIC_KEY = 'BGLnGLbs_P7BfbAVE1j82lN3SL7xS5pkBmJSjzVieAv9vwV66L6NQwzLufnE9Ti_N-cBo7bNVQR2Tb1IFWI2fdk';

function base64UrlToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function isIOSDevice() {
  const { userAgent, platform, maxTouchPoints } = navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function supportsWebPush() {
  return 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

export async function getCurrentPushSubscription() {
  if (!supportsWebPush()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enableWebPush() {
  if (!supportsWebPush()) throw new Error('Push notifications are not supported by this browser.');
  if (isIOSDevice() && !isInstalledApp()) {
    throw new Error('Install Full Circle from Safari first, then turn on notifications inside the installed app.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked. Allow them in your phone settings and try again.'
      : 'Notification permission was not granted.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();
  const endpoint = json.endpoint || subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error('The phone returned an incomplete notification subscription.');

  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
  return subscription;
}

