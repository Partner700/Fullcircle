import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Coins,
  Eye,
  Gift,
  Lightbulb,
  Loader2,
  LockKeyhole,
  ListFilter,
  BookOpen,
  Bomb,
  Send,
  Shield,
  ShieldCheck,
  SkipForward,
  Snowflake,
  Swords,
  TimerReset,
  Users,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  fetchHiddenChallengeParticipants,
  fetchHiddenChallengeRelics,
  fetchHiddenChallengeResult,
  findHiddenChallengeClaim,
  forfeitHiddenChallenge,
  HIDDEN_CHALLENGE_EVENT,
  openHiddenChallenge,
  submitHiddenChallengeAnswer,
  deployHiddenChallengeRelic,
  type HiddenChallengeEventDetail,
} from '../lib/hiddenChallenges';
import { supabase } from '../lib/supabase';
import type {
  HiddenChallengeParticipant,
  HiddenChallengeRelic,
  HiddenChallengeResult,
  OpenHiddenChallenge,
} from '../lib/types';
import { cn, formatDenarii } from '../lib/utils';
import { Dove } from './Dove';

const HIDDEN_CHALLENGE_SECONDS = 40;

function ChallengeCountdown({ seconds }: { seconds: number }) {
  const ratio = Math.max(0, Math.min(1, seconds / HIDDEN_CHALLENGE_SECONDS));
  const color = ratio > 0.5
    ? 'text-sage'
    : ratio > 0.25
      ? 'text-gold'
      : ratio > 0.1
        ? 'text-orange-500'
        : 'text-coral';

  return (
    <div className={cn('relative h-12 w-12 flex-shrink-0', color)} role="timer" aria-label={`${seconds} seconds remaining`}>
      <svg viewBox="0 0 44 44" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          pathLength="100"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="100"
          strokeDashoffset={100 - ratio * 100}
          className="transition-[stroke-dashoffset,color] duration-200"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-black tabular-nums text-ink">{seconds}</span>
    </div>
  );
}

function ParticipantStack({ participants }: { participants: HiddenChallengeParticipant[] }) {
  const shown = participants.slice(-10);
  if (!shown.length) return null;
  return (
    <div className="flex items-center gap-2">
      <div className="flex min-h-7 items-center">
        {shown.map((participant, index) => (
          <span
            key={`${participant.user_id}-${participant.answered_at}`}
            title={`${participant.display_name} answered`}
            className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-surface-2 text-[9px] font-black text-peri shadow-sm"
            style={{ marginLeft: index === 0 ? 0 : -7, zIndex: shown.length - index }}
          >
            {participant.avatar_url ? (
              <img src={participant.avatar_url} alt={participant.display_name} className="h-full w-full object-cover" />
            ) : participant.display_name.trim().charAt(0).toUpperCase()}
          </span>
        ))}
      </div>
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-stone">
        <Users size={12} /> {participants.length} answered
      </span>
    </div>
  );
}

function ResultSummary({ result }: { result: HiddenChallengeResult }) {
  if (result.item_type === 'mine') {
    if (result.mine_blocked) {
      return <p className="text-sm leading-relaxed text-sage">Your {result.protection_relic_name || 'Shield of Faith'} blocked the Mine. No Denarii were taken.</p>;
    }
    return result.is_correct ? (
      <p className="text-sm leading-relaxed text-sage">You answered correctly and escaped the Mine. No Denarii were taken.</p>
    ) : (
      <p className="text-sm leading-relaxed text-coral">
        The Mine collected {formatDenarii(Number(result.denarii_paid || 0))} Denarii.
      </p>
    );
  }

  if (!result.is_correct) {
    return (
      <p className="text-sm leading-relaxed text-coral">
        The box stayed locked{result.transferred ? ' and has passed anonymously to another camp member.' : '.'}
      </p>
    );
  }
  if (result.empty_box) return <p className="text-sm leading-relaxed text-ink">You opened the box. It was empty.</p>;

  const rewards = [
    Number(result.reward_denarii || 0) > 0 ? `${formatDenarii(Number(result.reward_denarii))} Denarii` : null,
    Number(result.reward_relic_quantity || 0) > 0
      ? `${result.reward_relic_quantity} x ${result.reward_relic_name || 'relic'}`
      : null,
    Number(result.reward_freezer_quantity || 0) > 0
      ? `${result.reward_freezer_quantity} ${result.reward_freezer_type} freezer${Number(result.reward_freezer_quantity) === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean);

  return <p className="text-sm leading-relaxed text-sage">The box opened. You received {rewards.join(', ')}.</p>;
}

export function HiddenChallengeOverlay() {
  const { profile } = useAuth();
  const [challenge, setChallenge] = useState<OpenHiddenChallenge | null>(null);
  const [participants, setParticipants] = useState<HiddenChallengeParticipant[]>([]);
  const [relics, setRelics] = useState<HiddenChallengeRelic[]>([]);
  const [answer, setAnswer] = useState('');
  const [eliminatedOptions, setEliminatedOptions] = useState<string[]>([]);
  const [relicNotice, setRelicNotice] = useState<string | null>(null);
  const [usingRelic, setUsingRelic] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(HIDDEN_CHALLENGE_SECONDS);
  const [result, setResult] = useState<HiddenChallengeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<Promise<boolean> | null>(null);
  const challengeRef = useRef<OpenHiddenChallenge | null>(null);
  const resultRef = useRef<HiddenChallengeResult | null>(null);
  const settlingRef = useRef(false);
  const abandonedRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => { challengeRef.current = challenge; }, [challenge]);
  useEffect(() => { resultRef.current = result; }, [result]);

  const loadParticipants = useCallback(async (challengeId: string) => {
    try {
      setParticipants(await fetchHiddenChallengeParticipants(challengeId));
    } catch {
      setParticipants([]);
    }
  }, []);

  const loadClaim = useCallback((claimId: string) => {
    if (!profile || settlingRef.current || resultRef.current || challengeRef.current) return Promise.resolve(false);
    if (requestRef.current) return requestRef.current;
    const request = (async () => {
      try {
        const opened = await openHiddenChallenge(claimId);
        if (!opened) return false;
        setError(null);
        setAnswer('');
        setEliminatedOptions([]);
        setRelicNotice(null);
        setResult(null);
        abandonedRef.current = false;
        setChallenge(opened);
        setSecondsLeft(Math.max(0, Math.ceil((new Date(opened.attempt_deadline).getTime() - Date.now()) / 1000)));
        const [loadedParticipants, loadedRelics] = await Promise.all([
          fetchHiddenChallengeParticipants(opened.challenge_id).catch(() => []),
          opened.item_type === 'mine' ? fetchHiddenChallengeRelics(opened.claim_id).catch(() => []) : Promise.resolve([]),
        ]);
        setParticipants(loadedParticipants);
        setRelics(loadedRelics);
        return true;
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'The hidden question could not be opened.';
        setError(message);
        if (!/network|fetch|offline/i.test(message)) window.alert(message);
        return false;
      }
    })();
    const tracked = request.finally(() => {
      if (requestRef.current === tracked) requestRef.current = null;
    });
    requestRef.current = tracked;
    return tracked;
  }, [profile]);

  const loadContext = useCallback(async (detail: HiddenChallengeEventDetail) => {
    if (detail.claimIds?.length) {
      for (const claimId of detail.claimIds) {
        if (await loadClaim(claimId)) return;
      }
      return;
    }
    if (detail.claimId) {
      await loadClaim(detail.claimId);
      return;
    }
    if (!detail.placement) return;
    try {
      const claimId = await findHiddenChallengeClaim(detail.placement, detail.referenceKey);
      if (claimId) await loadClaim(claimId);
    } catch {
      // Context discovery is retried the next time the user opens that surface.
    }
  }, [loadClaim]);

  useEffect(() => {
    if (!profile) {
      setChallenge(null);
      setParticipants([]);
      setResult(null);
      return;
    }
    const checkAppOpen = () => {
      if (document.visibilityState === 'visible') void loadContext({ placement: 'app_open' });
    };
    const initial = window.setTimeout(checkAppOpen, 500);
    const interval = window.setInterval(checkAppOpen, 30_000);
    const onReveal = (event: Event) => {
      void loadContext((event as CustomEvent<HiddenChallengeEventDetail>).detail || {});
    };
    window.addEventListener(HIDDEN_CHALLENGE_EVENT, onReveal);
    window.addEventListener('focus', checkAppOpen);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener(HIDDEN_CHALLENGE_EVENT, onReveal);
      window.removeEventListener('focus', checkAppOpen);
    };
  }, [loadContext, profile]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`hidden_challenge_notifications_${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
        (payload) => {
          const notification = payload.new as { notification_type?: string; metadata?: Record<string, unknown> };
          if (notification.notification_type !== 'treasure') return;
          const claimId = String(notification.metadata?.hidden_challenge_claim_id || '');
          const placement = String(notification.metadata?.placement || '') as HiddenChallengeEventDetail['placement'];
          if (placement === 'app_open' && claimId) void loadClaim(claimId);
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadClaim, profile]);

  useEffect(() => {
    if (!challenge || result) return;
    const interval = window.setInterval(() => {
      void loadParticipants(challenge.challenge_id);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [challenge, loadParticipants, result]);

  const settleForfeit = useCallback(async (showResult: boolean) => {
    const current = challengeRef.current;
    if (!current || resultRef.current || settlingRef.current) return;
    settlingRef.current = true;
    setForfeiting(true);
    try {
      const forfeited = await forfeitHiddenChallenge(current.claim_id);
      abandonedRef.current = false;
      if (showResult && forfeited) {
        resultRef.current = forfeited;
        setResult(forfeited);
        await loadParticipants(current.challenge_id);
      } else {
        setChallenge(null);
        setParticipants([]);
      }
    } catch (forfeitError) {
      if (showResult) {
        const recovered = await fetchHiddenChallengeResult(current.claim_id).catch(() => null);
        if (recovered) {
          abandonedRef.current = false;
          resultRef.current = recovered;
          setResult(recovered);
          await loadParticipants(current.challenge_id);
        } else {
          setError(forfeitError instanceof Error ? forfeitError.message : 'The question could not be closed.');
        }
      }
    } finally {
      settlingRef.current = false;
      setForfeiting(false);
    }
  }, [loadParticipants]);

  useEffect(() => {
    if (!challenge || result) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(challenge.attempt_deadline).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) void settleForfeit(true);
    };
    tick();
    const interval = window.setInterval(tick, 200);
    return () => window.clearInterval(interval);
  }, [challenge, result, settleForfeit]);

  useEffect(() => {
    if (!challenge || result) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        abandonedRef.current = true;
        void settleForfeit(false);
        return;
      }
      retryAbandonedForfeit();
    };
    const retryAbandonedForfeit = () => {
      if (!abandonedRef.current || !challengeRef.current || resultRef.current) return;
      if (settlingRef.current) {
        window.setTimeout(retryAbandonedForfeit, 250);
        return;
      }
      void settleForfeit(false);
    };
    const onPageHide = () => {
      abandonedRef.current = true;
      void settleForfeit(false);
    };
    const onPageShow = () => retryAbandonedForfeit();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [challenge, result, settleForfeit]);

  useEffect(() => {
    if (!challenge) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.hasAttribute('inert') || false;
    document.body.style.overflow = 'hidden';
    appRoot?.setAttribute('inert', '');
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) appRoot?.removeAttribute('inert');
    };
  }, [challenge]);

  const submit = async () => {
    if (!challenge || !answer.trim() || submitting || settlingRef.current) return;
    settlingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const settled = await submitHiddenChallengeAnswer(challenge.claim_id, answer.trim());
      abandonedRef.current = false;
      resultRef.current = settled;
      setResult(settled);
      await loadParticipants(challenge.challenge_id);
    } catch (submitError) {
      const recovered = await fetchHiddenChallengeResult(challenge.claim_id).catch(() => null);
      if (recovered) {
        abandonedRef.current = false;
        resultRef.current = recovered;
        setResult(recovered);
        await loadParticipants(challenge.challenge_id);
      } else {
        setError(submitError instanceof Error ? submitError.message : 'Your answer could not be submitted.');
      }
    } finally {
      settlingRef.current = false;
      setSubmitting(false);
    }
  };

  const deployRelic = async (relic: HiddenChallengeRelic) => {
    if (!challenge || result || usingRelic || relic.automatic) return;
    setUsingRelic(relic.slug);
    setError(null);
    try {
      const deployed = await deployHiddenChallengeRelic(challenge.claim_id, relic.slug, answer);
      setRelics((current) => current
        .map((item) => item.slug === relic.slug ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item)
        .filter((item) => item.quantity > 0));
      setRelicNotice(
        relic.slug === 'freeze-timer'
          ? `The timer has been reset to ${HIDDEN_CHALLENGE_SECONDS} seconds.`
          : deployed.relic_notice || null,
      );
      if (deployed.eliminated_options?.length) {
        const newlyEliminated = deployed.eliminated_options;
        setEliminatedOptions((current) => Array.from(new Set([...current, ...newlyEliminated])));
        if (answer && newlyEliminated.includes(answer)) setAnswer('');
      }
      if (deployed.attempt_deadline) {
        setChallenge((current) => current ? { ...current, attempt_deadline: deployed.attempt_deadline! } : current);
      }
      if (deployed.claim_id && typeof deployed.is_correct === 'boolean') {
        const settled = deployed as HiddenChallengeResult;
        abandonedRef.current = false;
        resultRef.current = settled;
        setResult(settled);
        await loadParticipants(challenge.challenge_id);
      }
    } catch (deployError) {
      const recovered = await fetchHiddenChallengeResult(challenge.claim_id).catch(() => null);
      if (recovered) {
        resultRef.current = recovered;
        setResult(recovered);
      } else {
        setError(deployError instanceof Error ? deployError.message : 'This relic could not be used.');
      }
    } finally {
      setUsingRelic(null);
    }
  };

  const finish = () => {
    setChallenge(null);
    setParticipants([]);
    setRelics([]);
    setAnswer('');
    setEliminatedOptions([]);
    setRelicNotice(null);
    setResult(null);
    setError(null);
    abandonedRef.current = false;
    resultRef.current = null;
    window.setTimeout(() => { void loadContext({ placement: 'app_open' }); }, 250);
  };

  if (!profile || !challenge) return null;

  const treasure = challenge.item_type === 'treasure';
  const modal = (
    <div
      className="fixed inset-0 z-[2147483640] flex items-center justify-center overflow-y-auto bg-navy/88 px-3 py-4 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hidden-challenge-heading"
      onClick={() => { if (!result) void settleForfeit(true); }}
    >
      <section
        ref={dialogRef}
        className="relative my-auto w-full max-w-lg overflow-hidden rounded-lg border border-peri/35 bg-surface/95 shadow-2xl backdrop-blur-xl animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="relative border-b border-border bg-surface-2/88 px-5 pb-4 pt-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center">
                <Dove size={62} className="animate-float" />
                <span className={cn(
                  'absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface shadow-md',
                  treasure ? 'bg-gold text-navy' : 'bg-coral text-white',
                )}>
                  {treasure ? <Gift size={15} /> : <Bomb size={15} />}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase text-peri">Delivered by the Dove</p>
                <h2 id="hidden-challenge-heading" className="font-display text-xl font-bold text-ink">
                  {treasure ? 'A Treasure Box' : 'You stepped on a Mine'}
                </h2>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="badge badge-neutral text-[9px] capitalize">{challenge.difficulty}</span>
                  <span className="badge badge-neutral text-[9px]"><LockKeyhole size={10} /> One attempt</span>
                </div>
              </div>
            </div>
            {!result && <div className="flex flex-shrink-0 items-center gap-2">
              <ChallengeCountdown seconds={secondsLeft} />
              <button
                  type="button"
                  className="icon-btn flex-shrink-0"
                  onClick={() => void settleForfeit(true)}
                  disabled={forfeiting || submitting}
                  aria-label="Forfeit and close"
                  title="Forfeit and close"
                >
                  {forfeiting ? <Loader2 size={16} className="animate-spin" /> : <X size={17} />}
                </button>
              </div>}
          </div>
        </header>

        <div className="max-h-[calc(100dvh-8rem)] space-y-4 overflow-y-auto p-5">
          {challenge.transfer_count > 0 ? (
            <div className="rounded-md border border-peri/25 bg-peri/10 px-3 py-2 text-xs text-ink">
              This box was first meant for <strong>{challenge.original_target_name}</strong>. Its sender is now hidden because it passed on after a {challenge.last_outcome === 'forfeited' ? 'forfeit' : 'wrong answer'}.
            </div>
          ) : challenge.sender_name ? (
            <div className="flex items-center gap-2 text-xs text-stone">
              <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2 font-bold text-peri">
                {challenge.sender_avatar_url ? <img src={challenge.sender_avatar_url} alt="" className="h-full w-full object-cover" /> : challenge.sender_name.charAt(0)}
              </span>
              Hidden by <strong className="text-ink">{challenge.sender_name}</strong>
            </div>
          ) : null}

          {challenge.message_body && (
            <p className="whitespace-pre-wrap rounded-md border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-stone">{challenge.message_body}</p>
          )}

          {!treasure && (
            <div className="flex items-start gap-2 rounded-md border border-coral/35 bg-coral/10 px-3 py-2 text-xs leading-relaxed text-coral">
              <Coins size={15} className="mt-0.5 flex-shrink-0" />
              <span><strong>Do not leave this page.</strong> {formatDenarii(challenge.mine_penalty_denarii)} Denarii at risk.</span>
            </div>
          )}
          {treasure && !result && (
            <p className="text-xs leading-relaxed text-stone">Answer correctly to unlock what was placed inside. Leaving this panel forfeits your attempt and sends the locked box to someone else.</p>
          )}

          <ParticipantStack participants={participants} />

          {result ? (
            <div className="space-y-4 text-center">
              <div className={cn(
                'mx-auto flex h-16 w-16 items-center justify-center rounded-full border',
                result.is_correct || result.mine_blocked ? 'border-sage/40 bg-sage/10 text-sage' : 'border-coral/40 bg-coral/10 text-coral',
              )}>
                {result.mine_blocked ? <ShieldCheck size={34} /> : result.is_correct ? <CheckCircle2 size={34} /> : <XCircle size={34} />}
              </div>
              <ResultSummary result={result} />
              {!result.is_correct && result.correct_answer && (
                <p className="text-xs text-stone">Correct answer: <strong className="text-ink">{result.correct_answer}</strong></p>
              )}
              <button type="button" className="btn-primary w-full justify-center" onClick={finish}>Continue</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="font-display text-lg font-bold leading-snug text-ink">{challenge.question_text}</p>
                {challenge.reference && <p className="mt-1 text-[10px] font-bold uppercase text-brass">{challenge.reference}</p>}
              </div>

              {!treasure && relics.length > 0 && (
                <div className="rounded-md border border-border bg-surface-2 p-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {relics.map((relic) => {
                      const Icon = relic.slug === 'shield-of-faith' ? Shield
                        : relic.slug === 'hint' ? Lightbulb
                          : relic.slug === 'eliminate' ? ListFilter
                            : relic.slug === 'skip' ? SkipForward
                              : relic.slug === 'freeze-timer' ? TimerReset
                                : relic.slug === 'reveal-reference' ? BookOpen
                                  : relic.slug === 'talking-donkey' ? Volume2
                                    : relic.slug === 'sword-goliath' ? Swords
                                      : Eye;
                      return relic.automatic ? (
                        <span key={relic.slug} className="inline-flex items-center gap-1 rounded-full border border-sage/35 bg-sage/10 px-2 py-1 text-[10px] font-bold text-sage" title="Used automatically if this Mine would charge you">
                          <Icon size={12} /> Protected ({relic.quantity})
                        </span>
                      ) : (
                        <button
                          key={relic.slug}
                          type="button"
                          onClick={() => void deployRelic(relic)}
                          disabled={Boolean(usingRelic) || secondsLeft === 0 || (relic.slug === 'talking-donkey' && !answer)}
                          className="inline-flex items-center gap-1 rounded-full border border-peri/30 bg-peri/10 px-2 py-1 text-[10px] font-bold text-peri disabled:opacity-40"
                          title={`Use ${relic.name}`}
                        >
                          {usingRelic === relic.slug ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                          {relic.name} ({relic.quantity})
                        </button>
                      );
                    })}
                  </div>
                  {relicNotice && <p className="mt-2 text-[10px] font-semibold text-sage">{relicNotice}</p>}
                </div>
              )}

              {challenge.options.length >= 2 ? (
                <div className="grid gap-2">
                  {challenge.options.filter((option) => !eliminatedOptions.includes(option)).map((option, index) => (
                    <button
                      key={`${option}-${index}`}
                      type="button"
                      onClick={() => setAnswer(option)}
                      className={cn(
                        'min-h-11 rounded-md border px-3 py-2 text-left text-sm font-semibold transition-colors',
                        answer === option
                          ? 'border-peri bg-peri/15 text-ink ring-2 ring-peri/20'
                          : 'border-border bg-surface-2 text-ink hover:border-peri/45',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
                  className="input-field w-full text-sm"
                  placeholder="Type your answer"
                  autoComplete="off"
                />
              )}

              {error && <p role="alert" className="text-xs text-coral">{error}</p>}
              <button
                type="button"
                className="btn-primary w-full justify-center"
                disabled={!answer.trim() || submitting || forfeiting || secondsLeft === 0}
                onClick={() => void submit()}
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Submit answer
              </button>
              <p className="flex items-center justify-center gap-1 text-center text-[10px] text-stone">
                {treasure ? <Gift size={11} /> : <Snowflake size={11} />} Stay on this screen until your answer settles.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}
