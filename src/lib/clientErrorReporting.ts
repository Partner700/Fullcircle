import { supabase } from './supabase';

const CLIENT_RELEASE = '2026-09-25-v151';
let lastSignature = '';
let lastReportAt = 0;

type NetworkInformation = {
  effectiveType?: string;
  type?: string;
  downlink?: number;
  saveData?: boolean;
};

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Unknown application error',
      stack: error.stack || null,
    };
  }
  return { message: String(error || 'Unknown application error'), stack: null };
}

export function reportClientError(error: unknown, componentStack?: string | null, source = 'application') {
  if (typeof window === 'undefined') return;
  const details = errorDetails(error);
  const signature = `${source}:${details.message}:${componentStack || ''}`.slice(0, 2_000);
  const now = Date.now();
  if (signature === lastSignature && now - lastReportAt < 60_000) return;
  lastSignature = signature;
  lastReportAt = now;

  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  void (async () => {
    try {
      const { error: reportError } = await supabase.rpc('report_client_error', {
        p_message: details.message.slice(0, 2_000),
        p_stack: details.stack?.slice(0, 12_000) || null,
        p_component_stack: componentStack?.slice(0, 12_000) || null,
        p_release: CLIENT_RELEASE,
        p_path: window.location.pathname.slice(0, 1_000),
        p_user_agent: navigator.userAgent.slice(0, 1_000),
        p_online: navigator.onLine,
        p_connection_type: String(connection?.effectiveType || connection?.type || '').slice(0, 80) || null,
        p_metadata: {
          source,
          display_mode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
          visibility: document.visibilityState,
          save_data: connection?.saveData === true,
          downlink: Number.isFinite(connection?.downlink) ? connection?.downlink : null,
        },
      });
      if (reportError && import.meta.env.DEV) console.warn('Client error report was not accepted:', reportError);
    } catch {
      // Diagnostics must never become another reason the application cannot open.
    }
  })();
}

export { CLIENT_RELEASE };
