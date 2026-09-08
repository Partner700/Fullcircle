import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BellRing,
  CheckCircle2,
  Loader2,
  Send,
  Vibrate,
  Volume2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchPendingScriptureAlarm, submitScriptureAlarmAnswer } from '../lib/scriptureAlarms';
import { supabase } from '../lib/supabase';
import type { PendingScriptureAlarm } from '../lib/types';
import { cn } from '../lib/utils';
import { Dove } from './Dove';
import { AlarmVolumeControl } from './AlarmVolumeControl';
import { getAlarmVolume } from '../lib/alarmPreferences';

const SLOT_LABELS: Record<PendingScriptureAlarm['alarm_slot'], string> = {
  morning: '5:59 AM Scripture alarm',
  midday: 'Midday meditation alarm',
  evening: '6:00 PM meditation alarm',
  final: '8:30 PM meditation alarm',
};

type WebkitAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

async function clearDeliveredAlarmNotification() {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const notifications = await registration?.getNotifications({ tag: 'full-circle-scripture-alarm' });
    notifications?.forEach((notification) => notification.close());
  } catch {
    // Some embedded browsers expose push without notification enumeration.
  }
}

function startAlarmEffects(volume: number) {
  let audioContext: AudioContext | null = null;
  let sirenOscillator: OscillatorNode | null = null;
  let warningOscillator: OscillatorNode | null = null;
  let sirenGain: GainNode | null = null;
  let warningGain: GainNode | null = null;
  let masterGain: GainNode | null = null;
  let compressor: DynamicsCompressorNode | null = null;
  let sirenTimer: number | null = null;
  let vibrationTimer: number | null = null;
  let rising = true;
  const volumeRatio = Math.min(1, Math.max(0, volume / 200));

  const scheduleSirenSweep = () => {
    if (!audioContext || !sirenOscillator || !warningOscillator || !masterGain) return;
    const now = audioContext.currentTime;
    const sweepEnd = now + 0.68;
    const lowFrequency = rising ? 620 : 1_280;
    const highFrequency = rising ? 1_280 : 620;

    sirenOscillator.frequency.cancelScheduledValues(now);
    sirenOscillator.frequency.setValueAtTime(lowFrequency, now);
    sirenOscillator.frequency.exponentialRampToValueAtTime(highFrequency, sweepEnd);
    warningOscillator.frequency.cancelScheduledValues(now);
    warningOscillator.frequency.setValueAtTime(lowFrequency / 2, now);
    warningOscillator.frequency.exponentialRampToValueAtTime(highFrequency / 2, sweepEnd);
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(0.58 * volumeRatio, now);
    masterGain.gain.linearRampToValueAtTime(0.92 * volumeRatio, now + 0.12);
    masterGain.gain.setValueAtTime(0.92 * volumeRatio, now + 0.48);
    masterGain.gain.linearRampToValueAtTime(0.62 * volumeRatio, sweepEnd);
    rising = !rising;
  };

  const sound = async () => {
    const AudioContextConstructor = window.AudioContext
      || (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContextConstructor || volumeRatio <= 0) return;

    if (!audioContext) {
      audioContext = new AudioContextConstructor();
      sirenOscillator = audioContext.createOscillator();
      warningOscillator = audioContext.createOscillator();
      sirenGain = audioContext.createGain();
      warningGain = audioContext.createGain();
      masterGain = audioContext.createGain();
      compressor = audioContext.createDynamicsCompressor();

      sirenOscillator.type = 'sawtooth';
      warningOscillator.type = 'square';
      sirenGain.gain.value = 0.78;
      warningGain.gain.value = 0.34;
      masterGain.gain.value = 0.72 * volumeRatio;
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;

      sirenOscillator.connect(sirenGain);
      warningOscillator.connect(warningGain);
      sirenGain.connect(masterGain);
      warningGain.connect(masterGain);
      masterGain.connect(compressor);
      compressor.connect(audioContext.destination);
      sirenOscillator.start();
      warningOscillator.start();
      scheduleSirenSweep();
      sirenTimer = window.setInterval(scheduleSirenSweep, 680);
    }
    if (audioContext.state === 'suspended') await audioContext.resume();
  };

  const vibrate = () => {
    if ('vibrate' in navigator) navigator.vibrate([1_200, 120, 1_200, 120, 1_600]);
  };

  const unlock = () => { void sound().catch(() => undefined); };
  void sound().catch(() => undefined);
  vibrate();
  vibrationTimer = window.setInterval(vibrate, 4_360);
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    if (sirenTimer !== null) window.clearInterval(sirenTimer);
    if (vibrationTimer !== null) window.clearInterval(vibrationTimer);
    if ('vibrate' in navigator) navigator.vibrate(0);
    try { sirenOscillator?.stop(); } catch { /* The oscillator may already be stopped. */ }
    try { warningOscillator?.stop(); } catch { /* The oscillator may already be stopped. */ }
    sirenOscillator?.disconnect();
    warningOscillator?.disconnect();
    sirenGain?.disconnect();
    warningGain?.disconnect();
    masterGain?.disconnect();
    compressor?.disconnect();
    if (audioContext) void audioContext.close().catch(() => undefined);
  };
}

export function ScriptureAlarmOverlay() {
  const { profile } = useAuth();
  const [alarm, setAlarm] = useState<PendingScriptureAlarm | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<'wrong' | 'correct' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alarmVolume, setAlarmVolume] = useState(getAlarmVolume);
  const loadRef = useRef<Promise<void> | null>(null);
  const submittingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const alarmId = alarm?.id || null;

  const loadPending = useCallback(() => {
    if (!profile || submittingRef.current) return Promise.resolve();
    if (loadRef.current) return loadRef.current;
    const request = (async () => {
      try {
        const pending = await fetchPendingScriptureAlarm();
        if (!pending) void clearDeliveredAlarmNotification();
        setError(null);
        setAlarm((current) => {
          if (current?.id !== pending?.id) {
            setAnswer('');
            setFeedback(null);
          }
          return pending;
        });
      } catch {
        // Foreground polling retries missed realtime events and brief outages.
      }
    })();
    const tracked = request.finally(() => {
      if (loadRef.current === tracked) loadRef.current = null;
    });
    loadRef.current = tracked;
    return tracked;
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setAlarm(null);
      setAnswer('');
      return;
    }
    void loadPending();
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadPending();
    };
    const interval = window.setInterval(refresh, 12_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadPending, profile]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`scripture_alarm_delivery_${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
        (payload) => {
          if ((payload.new as { notification_type?: string }).notification_type === 'scripture_alarm') {
            void loadPending();
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadPending, profile]);

  useEffect(() => {
    if (!alarmId) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.hasAttribute('inert') || false;
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden') ?? null;
    document.body.style.overflow = 'hidden';
    appRoot?.setAttribute('inert', '');
    appRoot?.setAttribute('aria-hidden', 'true');
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) appRoot?.removeAttribute('inert');
      if (previousAriaHidden === null) appRoot?.removeAttribute('aria-hidden');
      else appRoot?.setAttribute('aria-hidden', previousAriaHidden);
    };
  }, [alarmId]);

  useEffect(() => {
    if (!alarmId || feedback === 'correct') return;
    return startAlarmEffects(alarmVolume);
  }, [alarmId, alarmVolume, feedback]);

  useEffect(() => {
    if (!alarm?.expires_at) return;
    const remaining = new Date(alarm.expires_at).getTime() - Date.now();
    if (remaining <= 0) {
      void loadPending();
      return;
    }
    const timer = window.setTimeout(() => void loadPending(), remaining + 50);
    return () => window.clearTimeout(timer);
  }, [alarm?.expires_at, loadPending]);

  const submit = async () => {
    if (!alarm || !answer.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitScriptureAlarmAnswer(alarm.id, answer.trim());
      if (result.missed) {
        void clearDeliveredAlarmNotification();
        setAlarm(null);
        setAnswer('');
        setFeedback(null);
        return;
      }
      if (result.is_correct && result.cleared) {
        void clearDeliveredAlarmNotification();
        setFeedback('correct');
        setAnswer('');
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        setAlarm(null);
        setFeedback(null);
        submittingRef.current = false;
        await loadPending();
        return;
      }

      setFeedback('wrong');
      setAnswer('');
      if (result.alarm) setAlarm(result.alarm);
      else {
        submittingRef.current = false;
        await loadPending();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Your answer could not be checked.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!profile || !alarm) return null;

  const hasOptions = (alarm.question_type === 'multiple_choice' || alarm.question_type === 'true_false')
    && alarm.options.length > 1;
  const alarmInstruction = alarm.alarm_slot === 'morning'
    ? 'Answer correctly to silence the morning alarm.'
    : 'Finish and send your daily meditation. Answer correctly to silence this alarm.';
  const modal = (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center overflow-y-auto bg-navy/90 px-3 py-4 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scripture-alarm-heading"
    >
      <section
        ref={dialogRef}
        className="relative my-auto w-full max-w-lg overflow-hidden rounded-lg border-2 border-coral/60 bg-surface/95 shadow-2xl backdrop-blur-xl animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-coral/25 bg-coral/10 px-5 pb-4 pt-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-20 w-20 flex-shrink-0 items-center justify-center">
              <Dove size={74} className="animate-float" />
              <span className="absolute right-0 top-1 flex h-7 w-7 items-center justify-center rounded-full border border-coral/50 bg-coral text-white shadow-lg">
                <BellRing size={15} className="animate-pulse" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase text-coral">{SLOT_LABELS[alarm.alarm_slot]}</p>
              <h2 id="scripture-alarm-heading" className="font-display text-xl font-bold text-ink">Scripture alarm</h2>
              <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-bold text-stone">
                <span className="inline-flex items-center gap-1"><Volume2 size={12} /> Sounding</span>
                <span className="inline-flex items-center gap-1"><Vibrate size={12} /> Vibrating</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5">
          <p className="text-center text-xs font-bold uppercase leading-relaxed text-coral">{alarmInstruction}</p>
          {alarm.reference && <p className="mt-3 text-[10px] font-bold uppercase text-peri">{alarm.reference}</p>}
          <p className="mt-2 whitespace-pre-wrap text-base font-semibold leading-relaxed text-ink">{alarm.question_text}</p>

          {hasOptions ? (
            <div className="mt-4 grid gap-2">
              {alarm.options.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  onClick={() => {
                    setAnswer(option);
                    setFeedback(null);
                  }}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm font-semibold transition-colors',
                    answer === option
                      ? 'border-peri bg-peri/15 text-ink shadow-sm'
                      : 'border-border-bright bg-surface-2 text-ink hover:border-peri/45',
                  )}
                >
                  <span className={cn(
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                    answer === option ? 'border-peri bg-peri text-navy' : 'border-border-bright text-stone',
                  )}>
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="min-w-0 break-words">{option}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <label htmlFor="scripture-alarm-answer" className="mb-1 block text-xs font-semibold text-stone">Your answer</label>
              <input
                id="scripture-alarm-answer"
                value={answer}
                onChange={(event) => {
                  setAnswer(event.target.value);
                  setFeedback(null);
                }}
                className="input-field w-full text-sm"
                autoComplete="off"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit();
                }}
              />
            </div>
          )}

          {feedback === 'wrong' && (
            <div role="alert" className="mt-3 flex items-center gap-2 rounded-md border border-coral/35 bg-coral/10 px-3 py-2 text-xs font-semibold text-coral">
              <XCircle size={16} /> Not correct. A new question is ready.
            </div>
          )}
          {feedback === 'correct' && (
            <div role="status" className="mt-3 flex items-center gap-2 rounded-md border border-sage/35 bg-sage/10 px-3 py-2 text-xs font-semibold text-sage">
              <CheckCircle2 size={16} /> Correct. Alarm silenced.
            </div>
          )}
          {error && <div role="alert" className="mt-3 rounded-md border border-coral/35 bg-coral/10 px-3 py-2 text-xs text-coral">{error}</div>}

          <AlarmVolumeControl compact onVolumeChange={setAlarmVolume} />

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!answer.trim() || submitting || feedback === 'correct'}
            className="btn-primary mt-4 w-full justify-center py-3"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {submitting ? 'Checking...' : 'Submit answer'}
          </button>
        </div>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}
