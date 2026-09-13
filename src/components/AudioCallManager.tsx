import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2,
  Mic,
  PhoneCall,
  PhoneOff,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AUDIO_CALL_OPEN_EVENT,
  AUDIO_CALL_REQUEST_EVENT,
  answerAudioCall,
  audioCallIdFromLocation,
  clearAudioCallLocation,
  endAudioCall,
  fetchMyActiveAudioCalls,
  startAudioCall,
  type AudioCallRequestDetail,
} from '../lib/audioCalls';
import { getAlarmVolume } from '../lib/alarmPreferences';
import { supabase } from '../lib/supabase';
import type { AudioCall } from '../lib/types';
import { Dove } from './Dove';
import { UserAvatar } from './UserAvatar';

type JitsiApi = {
  addEventListener: (name: string, listener: (payload?: unknown) => void) => void;
  dispose: () => void;
};

type JitsiConstructor = new (domain: string, options: Record<string, unknown>) => JitsiApi;
type JitsiWindow = Window & typeof globalThis & { JitsiMeetExternalAPI?: JitsiConstructor };

let jitsiApiPromise: Promise<JitsiConstructor> | null = null;

function loadJitsiApi(domain: string) {
  const existing = (window as JitsiWindow).JitsiMeetExternalAPI;
  if (existing) return Promise.resolve(existing);
  if (jitsiApiPromise) return jitsiApiPromise;
  jitsiApiPromise = new Promise<JitsiConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.dataset.fullCircleAudioCalls = 'true';
    script.onload = () => {
      const loaded = (window as JitsiWindow).JitsiMeetExternalAPI;
      if (loaded) resolve(loaded);
      else reject(new Error('The audio room did not finish loading.'));
    };
    script.onerror = () => {
      jitsiApiPromise = null;
      reject(new Error('The audio service could not be reached.'));
    };
    document.head.appendChild(script);
  });
  return jitsiApiPromise;
}

function startRingingEffects() {
  let context: AudioContext | null = null;
  let first: OscillatorNode | null = null;
  let second: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let pulseTimer: number | null = null;
  let vibrationTimer: number | null = null;
  const volume = Math.min(1, Math.max(0, getAlarmVolume() / 200));

  const sound = async () => {
    if (volume <= 0) return;
    const Constructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    if (!context) {
      context = new Constructor();
      first = context.createOscillator();
      second = context.createOscillator();
      gain = context.createGain();
      first.type = 'sine';
      second.type = 'sine';
      first.frequency.value = 440;
      second.frequency.value = 480;
      gain.gain.value = 0;
      first.connect(gain);
      second.connect(gain);
      gain.connect(context.destination);
      first.start();
      second.start();
      const pulse = () => {
        if (!context || !gain) return;
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.42 * volume, now + 0.04);
        gain.gain.setValueAtTime(0.42 * volume, now + 0.55);
        gain.gain.linearRampToValueAtTime(0, now + 0.68);
      };
      pulse();
      pulseTimer = window.setInterval(pulse, 1_450);
    }
    if (context.state === 'suspended') await context.resume();
  };

  const vibrate = () => {
    if ('vibrate' in navigator) navigator.vibrate([700, 180, 700, 1_000]);
  };
  const unlock = () => { void sound().catch(() => undefined); };
  void sound().catch(() => undefined);
  vibrate();
  vibrationTimer = window.setInterval(vibrate, 3_000);
  window.addEventListener('pointerdown', unlock, { passive: true });

  return () => {
    window.removeEventListener('pointerdown', unlock);
    if (pulseTimer !== null) window.clearInterval(pulseTimer);
    if (vibrationTimer !== null) window.clearInterval(vibrationTimer);
    if ('vibrate' in navigator) navigator.vibrate(0);
    try { first?.stop(); } catch { /* Already stopped. */ }
    try { second?.stop(); } catch { /* Already stopped. */ }
    first?.disconnect();
    second?.disconnect();
    gain?.disconnect();
    if (context) void context.close().catch(() => undefined);
  };
}

async function clearCallNotification(callId: string) {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const notifications = await registration?.getNotifications({ tag: `full-circle-audio-call-${callId}` });
    notifications?.forEach((notification) => notification.close());
  } catch {
    // Notification enumeration is optional in some embedded browsers.
  }
}

function AudioRoom({ call, displayName, onLeave }: {
  call: AudioCall;
  displayName: string;
  onLeave: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const leaveRef = useRef(onLeave);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const domain = (import.meta.env.VITE_AUDIO_CALL_DOMAIN || 'meet.jit.si').trim();

  useEffect(() => { leaveRef.current = onLeave; }, [onLeave]);
  useEffect(() => {
    let disposed = false;
    let api: JitsiApi | null = null;
    void loadJitsiApi(domain).then((Constructor) => {
      if (disposed || !mountRef.current) return;
      api = new Constructor(domain, {
        roomName: call.provider_room_name,
        parentNode: mountRef.current,
        width: '100%',
        height: '100%',
        lang: 'en',
        userInfo: { displayName },
        configOverwrite: {
          startAudioOnly: true,
          startWithAudioMuted: false,
          startWithVideoMuted: true,
          disableDeepLinking: true,
          prejoinConfig: { enabled: false },
          toolbarButtons: ['microphone', 'hangup', 'participants-pane', 'chat', 'raisehand', 'settings'],
        },
        interfaceConfigOverwrite: {
          MOBILE_APP_PROMO: false,
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          TILE_VIEW_MAX_COLUMNS: 3,
        },
      });
      api.addEventListener('videoConferenceJoined', () => setLoading(false));
      api.addEventListener('readyToClose', () => leaveRef.current());
      api.addEventListener('videoConferenceLeft', () => leaveRef.current());
      window.setTimeout(() => { if (!disposed) setLoading(false); }, 8_000);
    }).catch((loadError) => {
      if (!disposed) {
        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : 'The audio room could not load.');
      }
    });
    return () => {
      disposed = true;
      api?.dispose();
    };
  }, [call.provider_room_name, displayName, domain]);

  const fallbackUrl = `https://${domain}/${encodeURIComponent(call.provider_room_name)}#config.startAudioOnly=true&config.startWithVideoMuted=true&config.disableDeepLinking=true`;
  return (
    <div className="relative h-full min-h-0 bg-navy">
      <div ref={mountRef} className="absolute inset-0" />
      {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-navy"><Loader2 size={28} className="animate-spin text-peri" /></div>}
      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-navy px-5 text-center">
          <div>
            <PhoneOff size={34} className="mx-auto text-coral" />
            <p className="mt-3 text-sm font-semibold text-peri">{error}</p>
            <a href={fallbackUrl} target="_blank" rel="noreferrer" className="btn-primary mt-4 inline-flex text-sm">Open audio room</a>
          </div>
        </div>
      )}
    </div>
  );
}

export function AudioCallManager() {
  const { profile } = useAuth();
  const initialTargetRef = useRef(typeof window === 'undefined' ? null : audioCallIdFromLocation());
  const [incoming, setIncoming] = useState<AudioCall | null>(null);
  const [active, setActive] = useState<AudioCall | null>(null);
  const [request, setRequest] = useState<AudioCallRequestDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadRef = useRef<Promise<void> | null>(null);
  const activeRef = useRef<AudioCall | null>(null);

  useEffect(() => { activeRef.current = active; }, [active]);

  const load = useCallback(() => {
    if (!profile?.id) return Promise.resolve();
    if (loadRef.current) return loadRef.current;
    const operation = (async () => {
      try {
        const calls = await fetchMyActiveAudioCalls();
        const targetId = initialTargetRef.current;
        const currentCall = activeRef.current;
        const current = currentCall && calls.find((call) => call.id === currentCall.id);
        const targeted = targetId ? calls.find((call) => call.id === targetId) : null;
        const joined = current
          || (targeted?.recipient_status === 'joined' ? targeted : null)
          || calls.find((call) => call.recipient_status === 'joined')
          || null;
        const ringing = targeted?.recipient_status === 'ringing' ? targeted : calls.find((call) => call.recipient_status === 'ringing') || null;
        if (targetId) {
          initialTargetRef.current = null;
          clearAudioCallLocation();
        }
        setActive(joined);
        setIncoming(joined ? null : ringing);
      } catch {
        // Realtime and the next foreground poll retry temporary network errors.
      }
    })();
    const tracked = operation.finally(() => {
      if (loadRef.current === tracked) loadRef.current = null;
    });
    loadRef.current = tracked;
    return tracked;
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) {
      setIncoming(null);
      setActive(null);
      return;
    }
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`audio_calls_${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audio_call_recipients', filter: `user_id=eq.${profile.id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audio_call_rooms' }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` }, (payload) => {
        if ((payload.new as { notification_type?: string }).notification_type === 'audio_call') void load();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, profile?.id]);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      setError('');
      setRequest((event as CustomEvent<AudioCallRequestDetail>).detail);
    };
    const handleOpen = (event: Event) => {
      initialTargetRef.current = (event as CustomEvent<{ callId?: string }>).detail?.callId || null;
      void load();
    };
    window.addEventListener(AUDIO_CALL_REQUEST_EVENT, handleRequest);
    window.addEventListener(AUDIO_CALL_OPEN_EVENT, handleOpen);
    return () => {
      window.removeEventListener(AUDIO_CALL_REQUEST_EVENT, handleRequest);
      window.removeEventListener(AUDIO_CALL_OPEN_EVENT, handleOpen);
    };
  }, [load]);

  useEffect(() => {
    if (!incoming || active) return;
    return startRingingEffects();
  }, [active, incoming]);

  const start = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError('');
    try {
      const call = await startAudioCall(request.scope, request.tentId);
      setRequest(null);
      setIncoming(null);
      setActive(call);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'The call could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!incoming || busy) return;
    setBusy(true);
    setError('');
    try {
      const call = await answerAudioCall(incoming.id, 'join');
      await clearCallNotification(incoming.id);
      setIncoming(null);
      setActive(call);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'The call could not be joined.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!incoming || busy) return;
    const callId = incoming.id;
    setBusy(true);
    try { await answerAudioCall(callId, 'decline'); } catch { /* The call may already have ended. */ }
    await clearCallNotification(callId);
    setIncoming(null);
    setError('');
    setBusy(false);
  };

  const leave = useCallback(async () => {
    if (!active) return;
    const callId = active.id;
    setActive(null);
    await clearCallNotification(callId);
    await answerAudioCall(callId, 'leave').catch(() => undefined);
    void load();
  }, [active, load]);

  const end = async () => {
    if (!active || busy) return;
    setBusy(true);
    try {
      await endAudioCall(active.id);
      await clearCallNotification(active.id);
      setActive(null);
      setIncoming(null);
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : 'The call could not be ended.');
    } finally {
      setBusy(false);
    }
  };

  if (!profile || typeof document === 'undefined') return null;

  const confirmation = request ? (
    <div className="fixed inset-0 z-[2147483500] flex items-center justify-center bg-ink/70 px-4 backdrop-blur-sm" onClick={() => !busy && setRequest(null)}>
      <section className="w-full max-w-sm rounded-lg border border-border-bright bg-surface p-5 text-center shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="start-call-title">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sage/15 text-sage"><PhoneCall size={26} /></span>
        <h2 id="start-call-title" className="mt-3 font-display text-xl font-bold text-ink">{request.scope === 'all' ? 'Ring everyone?' : 'Ring your tent?'}</h2>
        <p className="mt-2 text-sm text-stone">Their phones will receive an incoming Full Circle call.</p>
        {error && <p className="mt-3 text-xs font-semibold text-coral">{error}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRequest(null)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void start()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <PhoneCall size={16} />} Ring</button>
        </div>
      </section>
    </div>
  ) : null;

  const incomingView = incoming ? (
    <div className="fixed inset-0 z-[2147483500] flex items-center justify-center overflow-y-auto bg-navy/95 px-4 py-6 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="incoming-call-title">
      <section className="w-full max-w-md text-center">
        <div className="relative mx-auto flex h-36 w-36 items-center justify-center">
          <span className="absolute inset-2 animate-ping rounded-full border border-sage/50" />
          <Dove size={124} className="relative animate-float" />
          <span className="absolute bottom-1 right-1 flex h-12 w-12 items-center justify-center rounded-full border-4 border-navy bg-sage text-white shadow-xl"><PhoneCall size={22} /></span>
        </div>
        <p className="mt-5 text-xs font-black uppercase text-sage">Incoming audio call</p>
        <h2 id="incoming-call-title" className="mt-1 font-display text-3xl font-bold text-peri">{incoming.title}</h2>
        <div className="mt-3 flex items-center justify-center gap-2 text-sm text-peri-dim">
          <UserAvatar userId={incoming.host_id} name={incoming.host_name} avatarUrl={incoming.host_avatar_url} className="h-8 w-8" />
          <span>{incoming.host_name}</span>
        </div>
        <div className="mt-2 flex items-center justify-center gap-4 text-xs text-peri-dim"><span className="inline-flex items-center gap-1"><Users size={13} /> {incoming.scope === 'all' ? 'Full Circle' : 'Your tent'}</span><span className="inline-flex items-center gap-1"><Volume2 size={13} /> Ringing</span></div>
        {error && <p className="mt-4 text-sm font-semibold text-coral">{error}</p>}
        <div className="mt-8 flex items-center justify-center gap-10">
          <button type="button" disabled={busy} onClick={() => void decline()} className="flex flex-col items-center gap-2 text-xs font-bold text-peri-dim"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-coral text-white shadow-xl"><PhoneOff size={26} /></span>Decline</button>
          <button type="button" disabled={busy} onClick={() => void join()} className="flex flex-col items-center gap-2 text-xs font-bold text-peri"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-sage text-white shadow-xl">{busy ? <Loader2 size={26} className="animate-spin" /> : <PhoneCall size={26} />}</span>Join</button>
        </div>
      </section>
    </div>
  ) : null;

  const room = active ? (
    <div className="fixed inset-0 z-[2147483400] flex flex-col bg-navy" role="dialog" aria-modal="true" aria-label={active.title}>
      <header className="safe-area-top flex min-h-16 items-center gap-3 border-b border-border bg-navy-2 px-3 py-2 text-peri shadow-lg">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage/15 text-sage"><Mic size={19} /></span>
        <div className="min-w-0 flex-1"><h2 className="truncate font-display text-base font-bold">{active.title}</h2><p className="text-[11px] text-peri-dim">{active.scope === 'all' ? 'Full Circle audio room' : 'Tent audio room'} · {active.participant_count} joined</p></div>
        {active.can_end && <button type="button" onClick={() => void end()} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-coral/40 bg-coral/15 px-3 text-xs font-bold text-coral"><PhoneOff size={15} /> End</button>}
        <button type="button" onClick={() => void leave()} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-navy-3 text-peri" aria-label="Leave audio call"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1"><AudioRoom call={active} displayName={profile.display_name || 'Full Circle member'} onLeave={() => void leave()} /></div>
    </div>
  ) : null;

  return createPortal(<>{confirmation}{incomingView}{room}</>, document.body);
}
