import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, BookOpen, Gamepad2, Loader2, MoveUp, Pointer, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  completeNewcomerGuidanceStep,
  directNewcomerGuidanceHero,
  fetchMyNewcomerGuidance,
  NEWCOMER_GUIDANCE_ACTION_EVENT,
  NEWCOMER_GUIDANCE_REFRESH_EVENT,
  OPEN_APP_NAVIGATION_EVENT,
  type NewcomerGuidanceAction,
  type NewcomerGuidanceState,
  type NewcomerGuidanceStep,
} from '../lib/newcomerGuidance';
import { enableWebPush, getCurrentPushSubscription, supportsWebPush } from '../lib/pushNotifications';
import { supabase } from '../lib/supabase';

type Props = {
  activeTab: string;
  onNavigate: (tab: string) => void;
};

type TargetBox = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

const STEP_COPY: Partial<Record<NewcomerGuidanceStep, { title: string; text: string }>> = {
  choose_tent: { title: 'Choose your tent', text: 'Pick one of the four tent families and send your request.' },
  dashboard_after_tent: { title: 'Return to your dashboard', text: 'Your request is with the sentry. Continue your short tour from the Dashboard.' },
  daily_scriptures: { title: "Open Today's Reading", text: 'This is where your daily Scripture journey begins.' },
  scroll_reading: { title: 'Swipe up', text: 'Scroll through the Scripture to continue.' },
  best_verse: { title: 'Choose your Best Verse', text: 'Select the verse that spoke to you most.' },
  meditation: { title: 'Write your meditation', text: 'This is where you reflect on the reading.' },
  daily_quote: { title: 'Finish with a Daily Quote', text: 'Capture your meditation in one short line.' },
  dashboard_games: { title: 'Back to Dashboard', text: 'There are a few community actions to learn before the daily games.' },
  welcome_swipe_to_verse: { title: 'Swipe the Welcome Panel', text: 'Swipe left to find the Daily Verse.' },
  welcome_like_verse: { title: 'React to the Daily Verse', text: 'Choose a reaction that reflects what the verse means to you.' },
  welcome_comment_verse: { title: 'Comment on the Daily Verse', text: 'Open the comments, write your thought, and send it.' },
  welcome_swipe_to_quote: { title: 'Swipe Again', text: 'Swipe left to continue into the community quote feed.' },
  welcome_like_quote: { title: "React to Someone's Quote", text: 'Choose a reaction for another person’s meditation quote.' },
  welcome_comment_quote: { title: "Comment on Someone's Quote", text: 'Open the comments and encourage the person with a short message.' },
  daily_games: { title: 'Open Daily Games', text: 'Your Scripture games live here.' },
  daily_trivia: { title: 'Open Daily Trivia', text: 'Start with Daily Trivia. Your guided tour ends here.' },
};

const WELCOME_SOCIAL_STEPS = new Set<NewcomerGuidanceStep>([
  'welcome_swipe_to_verse',
  'welcome_like_verse',
  'welcome_comment_verse',
  'welcome_swipe_to_quote',
  'welcome_like_quote',
  'welcome_comment_quote',
]);

const WELCOME_SWIPE_STEPS = new Set<NewcomerGuidanceStep>([
  'welcome_swipe_to_verse',
  'welcome_swipe_to_quote',
]);

const ACTION_FOR_STEP: Partial<Record<NewcomerGuidanceStep, NewcomerGuidanceAction>> = {
  welcome_swipe_to_verse: 'welcome_swiped',
  welcome_like_verse: 'welcome_verse_reacted',
  welcome_comment_verse: 'welcome_verse_commented',
  welcome_swipe_to_quote: 'welcome_swiped',
  welcome_like_quote: 'welcome_quote_reacted',
  welcome_comment_quote: 'welcome_quote_commented',
};

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function selectorForStep(step: NewcomerGuidanceStep) {
  if (step === 'dashboard_after_tent' || step === 'dashboard_games') return '[data-guide-nav="dashboard"]';
  if (step === 'daily_scriptures') return '[data-guide-nav="narrative"]';
  if (step === 'best_verse') return '[data-guide="best-verse"]';
  if (step === 'meditation') return '[data-guide="daily-meditation"]';
  if (step === 'daily_quote') return '[data-guide="daily-quote"]';
  if (step === 'daily_games') return '[data-guide-nav="games"]';
  if (step === 'daily_trivia') return '[data-guide="daily-trivia"]';
  if (step === 'choose_tent') return '[data-guide-tent-choice]';
  if (WELCOME_SWIPE_STEPS.has(step)) return '[data-guide="welcome-carousel"]';
  if (step === 'welcome_like_verse') return '[data-guide-slide-active="true"] [data-guide="welcome-daily-verse-reaction"]';
  if (step === 'welcome_like_quote') return '[data-guide-slide-active="true"] [data-guide="welcome-other-quote-reaction"]';
  return '';
}

function commentTargets(scope: 'welcome-daily-verse' | 'welcome-other-quote') {
  const activeSlide = '[data-guide-slide-active="true"]';
  const selectors = [
    `${activeSlide} [data-guide="${scope}-comment-submit"]:not(:disabled)`,
    `${activeSlide} [data-guide="${scope}-comment-input"]`,
    `${activeSlide} [data-guide="${scope}-comment-open"]`,
  ];
  for (const selector of selectors) {
    const target = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isVisible);
    if (target) return [target];
  }
  return [];
}

function targetElementsForStep(step: NewcomerGuidanceStep) {
  if (step === 'welcome_comment_verse') return commentTargets('welcome-daily-verse');
  if (step === 'welcome_comment_quote') return commentTargets('welcome-other-quote');
  const selector = selectorForStep(step);
  if (!selector) return [];
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
  if (step === 'welcome_like_verse' || step === 'welcome_like_quote') {
    return [elements.find((element) => element.getAttribute('aria-pressed') !== 'true') || elements[0]].filter(Boolean) as HTMLElement[];
  }
  return elements;
}

export function NewcomerGuide({ activeTab, onNavigate }: Props) {
  const { profile } = useAuth();
  const [guidance, setGuidance] = useState<NewcomerGuidanceState | null>(null);
  const [targets, setTargets] = useState<TargetBox[]>([]);
  const [pushReady, setPushReady] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const advancingRef = useRef(false);
  const scrollStartRef = useRef(0);
  const step = guidance?.current_step;

  const load = useCallback(async () => {
    if (!profile?.id) {
      setGuidance(null);
      return true;
    }
    try {
      setGuidance(await fetchMyNewcomerGuidance(profile.id));
      return true;
    } catch {
      return false;
    }
  }, [profile?.id]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;
    let attempts = 0;
    let inFlight = false;

    const run = async (resetAttempts = false) => {
      if (inFlight || cancelled) return;
      if (resetAttempts) attempts = 0;
      inFlight = true;
      const loaded = await load();
      inFlight = false;
      if (loaded || cancelled) return;
      const delay = Math.min(8_000, 750 * (2 ** attempts));
      attempts = Math.min(attempts + 1, 5);
      retryTimer = window.setTimeout(() => { void run(); }, delay);
    };

    const retryNow = () => {
      window.clearTimeout(retryTimer);
      void run(true);
    };
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') retryNow();
    };

    void run();
    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', retryWhenVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener('online', retryNow);
      document.removeEventListener('visibilitychange', retryWhenVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!supportsWebPush()) return;
    void getCurrentPushSubscription().then((subscription) => setPushReady(Boolean(subscription))).catch(() => undefined);
  }, []);
  useEffect(() => {
    const refresh = (event: Event) => {
      const next = (event as CustomEvent<NewcomerGuidanceState>).detail;
      if (next?.current_step) setGuidance(next);
      else void load();
    };
    window.addEventListener(NEWCOMER_GUIDANCE_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(NEWCOMER_GUIDANCE_REFRESH_EVENT, refresh);
  }, [load]);

  const completeStep = useCallback(async (completedStep: NewcomerGuidanceStep) => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      setGuidance(await completeNewcomerGuidanceStep(completedStep));
    } catch {
      await load();
    } finally {
      advancingRef.current = false;
    }
  }, [load]);

  useEffect(() => {
    if (!step) return;
    const expectedAction = ACTION_FOR_STEP[step];
    if (!expectedAction) return;
    const receiveAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: NewcomerGuidanceAction }>).detail?.action;
      if (action === expectedAction) void completeStep(step);
    };
    window.addEventListener(NEWCOMER_GUIDANCE_ACTION_EVENT, receiveAction);
    return () => window.removeEventListener(NEWCOMER_GUIDANCE_ACTION_EVENT, receiveAction);
  }, [completeStep, step]);

  const enableAlarmDelivery = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      await enableWebPush();
      try { window.localStorage.setItem('full-circle-browser-notifications-enabled', 'true'); } catch { /* Permission remains active. */ }
      try { await supabase.rpc('enable_browser_notifications'); } catch { /* The Web Push subscription is already enough. */ }
      setPushReady(true);
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : 'Phone alarms could not be enabled.');
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (!step || step === 'complete') return;
    if (step === 'choose_tent' && activeTab !== 'tent') {
      onNavigate('tent');
      return;
    }
    if (WELCOME_SOCIAL_STEPS.has(step) && activeTab !== 'dashboard') {
      onNavigate('dashboard');
      return;
    }
    if (step === 'dashboard_after_tent' && activeTab === 'dashboard') void completeStep(step);
    if (step === 'daily_scriptures' && activeTab === 'narrative') void completeStep(step);
    if (step === 'dashboard_games' && activeTab === 'dashboard') void completeStep(step);
    if (step === 'daily_games' && activeTab === 'games') void completeStep(step);
    if (step === 'daily_trivia' && activeTab === 'game') void completeStep(step);
  }, [activeTab, completeStep, onNavigate, step]);

  useEffect(() => {
    if (!step || !WELCOME_SOCIAL_STEPS.has(step) || activeTab !== 'dashboard') {
      directNewcomerGuidanceHero(null, false);
      return;
    }
    const target = step === 'welcome_swipe_to_verse'
      ? 'welcome'
      : step === 'welcome_like_verse' || step === 'welcome_comment_verse' || step === 'welcome_swipe_to_quote'
        ? 'verse'
        : 'other_quote';
    const direct = () => directNewcomerGuidanceHero(target, true);
    direct();
    const timer = window.setInterval(direct, 750);
    return () => {
      window.clearInterval(timer);
      directNewcomerGuidanceHero(null, false);
    };
  }, [activeTab, step]);

  useEffect(() => {
    if (step !== 'scroll_reading') return;
    scrollStartRef.current = window.scrollY;
    const onScroll = (event: Event) => {
      const elementScroll = event.target instanceof HTMLElement ? event.target.scrollTop : 0;
      if (Math.abs(window.scrollY - scrollStartRef.current) >= 56 || elementScroll >= 56) void completeStep('scroll_reading');
    };
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [completeStep, step]);

  useEffect(() => {
    if (!step || step === 'complete' || step === 'scroll_reading') {
      setTargets([]);
      return;
    }
    const hasTargetStrategy = Boolean(selectorForStep(step))
      || step === 'welcome_comment_verse'
      || step === 'welcome_comment_quote';
    if (!hasTargetStrategy) return;
    let frame = 0;
    let openedNavigation = false;
    let emptyCommunityQuoteChecks = 0;
    const tracked = new Set<HTMLElement>();
    const update = () => {
      const elements = targetElementsForStep(step);
      if (elements.length > 0) {
        emptyCommunityQuoteChecks = 0;
      } else if (
        (step === 'welcome_like_quote' || step === 'welcome_comment_quote')
        && document.querySelector('[data-guide="welcome-carousel"]')
        && !document.querySelector('[data-guide-slide-kind="other_quote"]')
      ) {
        emptyCommunityQuoteChecks += 1;
        if (emptyCommunityQuoteChecks >= 12) void completeStep(step);
      }
      tracked.forEach((element) => {
        if (!elements.includes(element)) element.classList.remove('newcomer-guide-target');
      });
      elements.forEach((element) => {
        tracked.add(element);
        element.classList.add('newcomer-guide-target');
      });
      setTargets(elements.slice(0, step === 'choose_tent' ? 4 : 1).map((element, index) => {
        const rect = element.getBoundingClientRect();
        return { key: `${step}-${index}`, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }));
      if (elements.length === 0 && ['dashboard_after_tent', 'daily_scriptures', 'dashboard_games', 'daily_games'].includes(step) && !openedNavigation) {
        openedNavigation = true;
        window.dispatchEvent(new Event(OPEN_APP_NAVIGATION_EVENT));
      }
    };
    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    update();
    const timer = window.setInterval(update, 450);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
      tracked.forEach((element) => element.classList.remove('newcomer-guide-target'));
    };
  }, [completeStep, step]);

  useEffect(() => {
    if (!step || !['best_verse', 'meditation', 'daily_quote'].includes(step)) return;
    const selector = selectorForStep(step);
    const target = document.querySelector<HTMLElement>(selector);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const completeOnUse = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest(selector)) void completeStep(step);
    };
    const eventName = step === 'best_verse' ? 'pointerdown' : 'focusout';
    document.addEventListener(eventName, completeOnUse, true);
    return () => {
      document.removeEventListener(eventName, completeOnUse, true);
    };
  }, [completeStep, step]);

  if (!guidance || guidance.completed || step === 'complete' || !step || typeof document === 'undefined') return null;
  const copy = STEP_COPY[step];
  const tour = (
    <div className="pointer-events-none fixed inset-0 z-[2147482000]" aria-live="polite">
      <aside className={`newcomer-guide-message fixed left-1/2 top-[max(5.5rem,env(safe-area-inset-top))] w-[min(92vw,27rem)] -translate-x-1/2 rounded-lg border border-gold/55 bg-navy-2/96 px-4 py-3 text-center shadow-2xl backdrop-blur-xl ${step === 'choose_tent' ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <p className="flex items-center justify-center gap-1.5 text-[10px] font-black uppercase text-gold"><Sparkles size={12} /> Full Circle Guide</p>
        <h2 className="mt-1 font-display text-base font-bold text-peri">{copy?.title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-peri-dim">{copy?.text}</p>
        {step === 'choose_tent' && supportsWebPush() && !pushReady && (
          <button type="button" onClick={() => void enableAlarmDelivery()} disabled={pushBusy} className="btn-secondary mx-auto mt-2 px-3 py-1.5 text-[11px]">
            {pushBusy ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
            {pushBusy ? 'Enabling...' : 'Enable phone alarms'}
          </button>
        )}
        {step === 'choose_tent' && pushReady && <p className="mt-1.5 text-[10px] font-bold text-sage">Phone alarm delivery is ready.</p>}
        {pushMessage && <p className="mt-1.5 text-[10px] leading-relaxed text-coral">{pushMessage}</p>}
      </aside>
      {step === 'scroll_reading' ? (
        <div className="fixed bottom-[18%] left-1/2 flex -translate-x-1/2 flex-col items-center text-gold drop-shadow-lg">
          <MoveUp size={42} className="animate-newcomer-swipe" />
          <BookOpen size={24} className="mt-1" />
        </div>
      ) : WELCOME_SWIPE_STEPS.has(step) ? targets.map((target) => (
        <Pointer
          key={target.key}
          size={44}
          strokeWidth={2.4}
          className="fixed animate-newcomer-horizontal-swipe text-gold drop-shadow-lg"
          style={{ left: Math.max(12, target.left + target.width / 2 - 22), top: Math.max(112, target.top + target.height / 2 - 12) }}
        />
      )) : targets.map((target) => (
        <Pointer
          key={target.key}
          size={38}
          strokeWidth={2.4}
          className="fixed animate-newcomer-pointer text-gold drop-shadow-lg"
          style={{ left: Math.min(window.innerWidth - 44, target.left + target.width - 20), top: Math.min(window.innerHeight - 48, target.top + target.height - 8) }}
        />
      ))}
      {step === 'daily_trivia' && <Gamepad2 className="fixed bottom-6 right-6 text-gold/0" aria-hidden="true" />}
    </div>
  );
  return createPortal(tour, document.body);
}
