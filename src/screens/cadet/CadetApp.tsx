import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SubscriptionAccessProvider, subscriptionIsExpired } from '../../context/SubscriptionAccessContext';
import { AppShell } from '../../components/AppShell';
import { StreakStatusIcon } from '../../components/StreakStatusIcon';
import { ChiRhoMark } from '../../components/ChiRhoMark';
import { StreakCelebration } from '../../components/StreakCelebration';
import { SubscriptionGate, SubscriptionScreen } from '../../components/SubscriptionScreen';
import { DoveMark } from '../../components/Dove';
import { DoveNotificationArrival } from '../../components/DoveNotificationArrival';
import { CadetDashboard } from './CadetDashboard';
import { CadetNarrative } from './CadetNarrative';
import { CadetGame } from './CadetGame';
import { DailyGamesHub } from './DailyGamesHub';
import { StoryModeShell } from './story-mode/StoryModeShell';
import { CadetQuiz } from './CadetQuiz';
import { CadetLeaderboard } from './CadetLeaderboard';
import { CadetAwards } from './CadetAwards';
import { CadetTent } from './CadetTent';
import { CadetSettings } from './CadetSettings';
import { CadetStore } from './CadetStore';
import { CadetArena } from './CadetArena';
import { CadetStreak } from './CadetStreak';
import { supabase } from '../../lib/supabase';
import {
  getSubscriptionStatus,
  fetchReliableToolbarStats,
  fetchUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  fetchUnreadTentMessagesForUser,
  markTentMessageRead,
  fetchLedgerEntries,
  fetchArenaRooms,
  fetchStreakProtectionState,
} from '../../lib/queries';
import { formatDenarii, getDayType, getTodayISODate, getDateDaysAgoISO } from '../../lib/utils';
import { playNotificationSound, playSoundEffect } from '../../lib/soundscape';
import type { Tent, TentMember, Profile, StreakProtectionState, UserNotification } from '../../lib/types';
import { scriptureTargetFromMetadata, scriptureTargetUrl, storeScriptureTarget } from '../../lib/scriptureNavigation';
import { publicAsset } from '../../lib/publicAsset';
import { announceDenariiGain } from '../../lib/denariiAnimation';
import { dailyGamesNavigationKey } from '../../lib/dailyGames';
import { APP_NAVIGATION_EVENT, type AppNavigationDetail } from '../../lib/appNavigation';
import { isDoveArrival } from '../../lib/notificationArrival';
import {
  Home, BookOpen, Gamepad2, FileQuestion, Trophy, Award, Coins, Tent as TentIcon,
  Lock, Settings as SettingsIcon, ShoppingBag,
  Flame, Bell, CheckCircle2, AlertTriangle, MessageCircle, CheckCheck,
} from 'lucide-react';

type Tab = 'dashboard' | 'narrative' | 'streak' | 'games' | 'game' | 'arena' | 'story' | 'quiz' | 'tent' | 'leaderboard' | 'awards' | 'store' | 'settings' | 'subscribe';

const CADET_TABS: Tab[] = ['dashboard', 'narrative', 'streak', 'games', 'game', 'arena', 'story', 'quiz', 'tent', 'leaderboard', 'awards', 'store', 'settings', 'subscribe'];
const PREMIUM_TABS = new Set<Tab>(['games', 'game', 'arena', 'story', 'quiz', 'leaderboard', 'awards', 'store']);

type CadetNotificationType = 'info' | 'warning' | 'success';

type CadetNotification = {
  id: string;
  title: string;
  text: string;
  type: CadetNotificationType;
  actionTab?: Tab;
  actionLabel?: string;
  persistedId?: string;
  read?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  sourceType?: string;
};

const DEVICE_NOTIFICATIONS_KEY = 'full-circle-browser-notifications-enabled';
const TOPBAR_STATS_CACHE_PREFIX = 'full-circle-topbar-stats';

function notificationSymbolForType(type: string) {
  const key = String(type || '').toLowerCase();
  if (['message', 'direct_message', 'message_mention'].includes(key)) return publicAsset('notification-symbols/message.svg');
  if (key === 'arena' || key.startsWith('arena_')) return publicAsset('notification-symbols/arena.svg');
  if (key === 'award') return publicAsset('notification-symbols/award.svg');
  if (key === 'streak') return publicAsset('notification-symbols/streak.svg');
  if (['relic', 'reward', 'treasure'].includes(key)) return publicAsset('notification-symbols/relic.svg');
  if (['payment', 'purchase', 'economy'].includes(key)) return publicAsset('notification-symbols/payment.svg');
  if (['challenge', 'mine', 'quiz', 'quiz_release', 'weekly_quiz_reminder'].includes(key)) return publicAsset('notification-symbols/challenge.svg');
  return publicAsset('notification-symbols/reading.svg');
}

function topbarStatsCacheKey(userId: string) {
  return `${TOPBAR_STATS_CACHE_PREFIX}-${userId}`;
}

function readCachedTopbarStats(userId: string) {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(topbarStatsCacheKey(userId)) || 'null');
    return {
      denarii: Number(parsed?.denarii) || 0,
      streak: Number(parsed?.streak) || 0,
      marks: Number(parsed?.marks) || 0,
    };
  } catch {
    return null;
  }
}

function writeCachedTopbarStats(userId: string, patch: Partial<{ denarii: number; streak: number; marks: number }>) {
  if (typeof window === 'undefined') return;
  const current = readCachedTopbarStats(userId) || { denarii: 0, streak: 0, marks: 0 };
  const next = {
    denarii: Number(patch.denarii) > 0 ? Number(patch.denarii) : current.denarii,
    streak: Number(patch.streak) > 0 ? Number(patch.streak) : current.streak,
    marks: Number(patch.marks) > 0 ? Number(patch.marks) : current.marks,
  };
  try {
    window.localStorage.setItem(topbarStatsCacheKey(userId), JSON.stringify(next));
  } catch {}
}

async function showDeviceNotification(notification: UserNotification) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (window.localStorage.getItem(DEVICE_NOTIFICATIONS_KEY) !== 'true') return;
  } catch {
    return;
  }
  try {
    const registration = await navigator.serviceWorker?.ready;
    const options = {
      body: notification.body || 'You have a new update.',
      icon: publicAsset('icons/icon-192.png'),
      badge: publicAsset('icons/icon-96.png'),
      image: notificationSymbolForType(notification.notification_type),
      tag: `full-circle-${notification.id}`,
      data: { url: scriptureTargetUrl(notification.action_key, notification.metadata) },
    };
    if (registration) {
      await registration.showNotification(notification.title || 'Full Circle', options);
    } else {
      // Vite development and some embedded browsers have no active service worker.
      // Permission still allows a foreground device notification while the app is open.
      new Notification(notification.title || 'Full Circle', options);
    }
  } catch {
    // The in-app bell and destination badges still update when the device blocks a foreground toast.
  }
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: Home },
  { key: 'narrative', label: 'Today\'s Reading', icon: BookOpen },
  { key: 'streak', label: 'My Streak', icon: Flame },
  { key: 'games', label: 'Daily Games', icon: Gamepad2 },
  { key: 'quiz', label: 'Weekly Quiz', icon: FileQuestion },
  { key: 'tent', label: 'My Tent', icon: TentIcon },
  { key: 'leaderboard', label: 'Challenge Boards', icon: Trophy },
  { key: 'awards', label: 'Awards Hub', icon: Award },
  { key: 'store', label: 'The Market', icon: ShoppingBag },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

function getInitialCadetTab(): Tab {
  if (typeof window === 'undefined') return 'dashboard';
  const key = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('fc-tab');
  return CADET_TABS.includes(key as Tab) ? key as Tab : 'dashboard';
}

function actionKeyToTab(actionKey: string | null | undefined): Tab | undefined {
  if (!actionKey) return undefined;
  return CADET_TABS.includes(actionKey as Tab)
    ? actionKey as Tab
    : undefined;
}

function actionLabelForTab(tab?: Tab): string | undefined {
  if (!tab) return undefined;
  const labels: Partial<Record<Tab, string>> = {
    arena: 'Open Arena',
    store: 'Open Market',
    tent: 'Open Tent',
    narrative: 'Open Reading',
    games: 'Open Daily Games',
    game: 'Open Daily Trivia',
    story: 'Open Story Mode',
    quiz: 'Open Quiz',
    dashboard: 'Open Dashboard',
    streak: 'Open Streak',
    subscribe: 'Subscribe',
  };
  return labels[tab] || 'Open';
}

function persistedNotificationTone(notification: UserNotification): CadetNotificationType {
  const kind = notification.notification_type;
  const status = String(notification.metadata?.status || '').toLowerCase();
  if (notification.read_at) return 'info';
  if (kind === 'payment' && ['rejected', 'failed', 'cancelled'].includes(status)) return 'warning';
  if (kind === 'challenge' && status === 'rejected') return 'warning';
  if (kind === 'payment' || kind === 'purchase' || kind === 'relic' || kind === 'economy') return 'success';
  if (kind === 'arena_invite' || kind === 'message' || kind === 'social') return 'info';
  return 'info';
}

const READ_NOTIFICATION_STORAGE_LIMIT = 300;

function readNotificationStorageKey(userId: string) {
  return `full-circle-read-notifications-${userId}`;
}

function loadStoredReadNotificationIds(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(readNotificationStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveStoredReadNotificationIds(userId: string, ids: Set<string>) {
  try {
    const trimmed = Array.from(ids).slice(-READ_NOTIFICATION_STORAGE_LIMIT);
    window.localStorage.setItem(readNotificationStorageKey(userId), JSON.stringify(trimmed));
  } catch {}
}

function formatReactionTarget(targetType: string | null | undefined) {
  const label = String(targetType || '').replace(/_/g, ' ').trim();
  return label || 'tent activity';
}

function getCountdownParts(target?: string | null) {
  const targetMs = target ? new Date(target).getTime() : NaN;
  const remainingMs = Number.isFinite(targetMs) ? Math.max(0, targetMs - Date.now()) : 0;
  const days = Math.floor(remainingMs / 86_400_000);
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  return { days, hours, minutes, label: `${days}d ${hours}h ${minutes}m` };
}

export function CadetApp() {
  const { profile, session } = useAuth();
  const toolbarUserId = session?.user.id || profile?.id || '';
  const [tab, setTab] = useState<Tab>(getInitialCadetTab);
  const [tentInfo, setTentInfo] = useState<{ tent: Tent & { tent_houses?: any } | null; members: (TentMember & { profiles: Profile })[] }>({ tent: null, members: [] });
  const [denariiTotal, setDenariiTotal] = useState(0);
  const [streakCount, setStreakCount] = useState(0);
  const [marksTotal, setMarksTotal] = useState(0);
  const [streakProtection, setStreakProtection] = useState<StreakProtectionState | null>(null);
  const [streakCelebration, setStreakCelebration] = useState<number | null>(null);
  const [toolbarReady, setToolbarReady] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<CadetNotification[]>([]);
  const [toastNotification, setToastNotification] = useState<UserNotification | null>(null);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  const [openedDestinationNotificationIds, setOpenedDestinationNotificationIds] = useState<Set<string>>(new Set());
  const [walletRefreshKey, setWalletRefreshKey] = useState(0);
  const [cadetRefreshKey, setCadetRefreshKey] = useState(0);
  const [subStatus, setSubStatus] = useState<{ status: string; trial_ends_at: string | null; current_period_end: string | null; is_paid: boolean } | null>(null);
  const [subscriptionClock, setSubscriptionClock] = useState(() => Date.now());
  const streakLoadedRef = useRef(false);
  const toolbarStatsRef = useRef({ userId: '', denarii: 0, streak: 0, marks: 0 });
  const toolbarRequestRef = useRef<Promise<void> | null>(null);
  const notificationRequestRef = useRef<Promise<void> | null>(null);
  const notificationRefreshQueuedRef = useRef(false);
  const notificationLoaderRef = useRef<(() => Promise<void>) | null>(null);
  const lastForegroundRefreshRef = useRef(0);

  const isExpired = subscriptionIsExpired(subStatus, subscriptionClock);
  const trialCountdown = getCountdownParts(subStatus?.trial_ends_at);
  const trialDaysLeft = trialCountdown.days;

  useEffect(() => {
    const interval = window.setInterval(() => setSubscriptionClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const userId = toolbarUserId;
    if (!userId) return;
    streakLoadedRef.current = false;
    const cached = readCachedTopbarStats(userId);
    toolbarStatsRef.current = {
      userId,
      denarii: cached?.denarii || 0,
      streak: cached?.streak || 0,
      marks: cached?.marks || 0,
    };
    setStreakCount(cached?.streak || 0);
    setDenariiTotal(cached?.denarii || 0);
    setMarksTotal(cached?.marks || 0);
    setToolbarReady(!!cached && (cached.streak > 0 || cached.denarii > 0 || cached.marks > 0));
    setTentInfo({ tent: null, members: [] });
  }, [toolbarUserId]);

  useEffect(() => {
    if (!toastNotification) return;
    const timer = window.setTimeout(() => setToastNotification(null), 6500);
    return () => window.clearTimeout(timer);
  }, [toastNotification]);

  useEffect(() => {
    if (profile?.id) void supabase.rpc('process_automatic_sentry_promotion', { p_user_id: profile.id });
  }, [profile?.id]);

  const loadTentInfo = useCallback(async () => {
    if (!profile) {
      setTentInfo({ tent: null, members: [] });
      return;
    }
    const { data: member, error: memberError } = await supabase
      .from('tent_members')
      .select('tent_id')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (memberError) return;
    if (member) {
      const [tentResult, membersResult] = await Promise.all([
        supabase
          .from('tents')
          .select('*, tent_houses(*)')
          .eq('id', member.tent_id)
          .maybeSingle(),
        supabase
          .from('tent_members')
          .select('*, profiles(id,display_name,avatar_url,created_at)')
          .eq('tent_id', member.tent_id)
          .order('joined_at'),
      ]);
      setTentInfo((previous) => ({
        tent: tentResult.error ? previous.tent : tentResult.data as any,
        members: membersResult.error ? previous.members : (membersResult.data || []) as any,
      }));
    } else {
      setTentInfo({ tent: null, members: [] });
    }
  }, [profile]);

  const loadToolbarStats = useCallback(() => {
    if (!toolbarUserId) return Promise.resolve();
    if (toolbarRequestRef.current) return toolbarRequestRef.current;

    const request = (async () => {
      const [protectionResult, reliableResult] = await Promise.allSettled([
        fetchStreakProtectionState(),
        fetchReliableToolbarStats(toolbarUserId),
      ]);
      if (protectionResult.status === 'fulfilled') setStreakProtection(protectionResult.value);
      if (reliableResult.status !== 'fulfilled') return;

      const reliable = reliableResult.value;
      const stableDenarii = Number(reliable.total_denarii) || 0;
      const stableStreak = Number(reliable.current_streak) || 0;
      const stableMarks = Number(reliable.marks) || 0;
      toolbarStatsRef.current = {
        userId: toolbarUserId,
        denarii: stableDenarii,
        streak: stableStreak,
        marks: stableMarks,
      };

      setToolbarReady(true);
      setDenariiTotal(stableDenarii);
      setMarksTotal(stableMarks);
      setStreakCount((previous) => {
        if (streakLoadedRef.current && stableStreak > previous) {
          void playSoundEffect('sound_streak', 0.66);
          setStreakCelebration(stableStreak);
        }
        streakLoadedRef.current = true;
        return stableStreak;
      });
      writeCachedTopbarStats(toolbarUserId, { denarii: stableDenarii, streak: stableStreak, marks: stableMarks });
    })();

    const shared = request.finally(() => {
      if (toolbarRequestRef.current === shared) toolbarRequestRef.current = null;
    });
    toolbarRequestRef.current = shared;
    return shared;
  }, [toolbarUserId]);

  useEffect(() => {
    if (!toolbarUserId) return;

    const acceptConfirmedStats = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; denarii?: number; streak?: number; marks?: number }>).detail;
      if (!detail || detail.userId !== toolbarUserId) return;
      const confirmedDenarii = Number(detail.denarii) || 0;
      const confirmedStreak = Number(detail.streak) || 0;
      const confirmedMarks = Number(detail.marks) || 0;
      const retained = toolbarStatsRef.current.userId === toolbarUserId
        ? toolbarStatsRef.current
        : { userId: toolbarUserId, denarii: 0, streak: 0, marks: 0 };
      const next = {
        userId: toolbarUserId,
        denarii: detail.denarii === undefined ? retained.denarii : confirmedDenarii,
        streak: detail.streak === undefined ? retained.streak : confirmedStreak,
        marks: detail.marks === undefined ? retained.marks : confirmedMarks,
      };
      toolbarStatsRef.current = next;
      setDenariiTotal(next.denarii);
      setMarksTotal(next.marks);
      setStreakCount((previous) => {
        if (next.streak > previous) setStreakCelebration(next.streak);
        return next.streak;
      });
      setToolbarReady(true);
      writeCachedTopbarStats(toolbarUserId, next);
    };

    window.addEventListener('full-circle-toolbar-stats', acceptConfirmedStats);
    return () => window.removeEventListener('full-circle-toolbar-stats', acceptConfirmedStats);
  }, [toolbarUserId]);

  useEffect(() => {
    if (!toolbarUserId) return;
    const retryTimers = [0, 4_000].map((delay) => window.setTimeout(() => {
      void loadToolbarStats();
    }, delay));
    const resolveTimer = window.setTimeout(() => setToolbarReady(true), 6_000);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadToolbarStats();
    }, 45_000);
    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(resolveTimer);
      window.clearInterval(interval);
    };
  }, [loadToolbarStats, toolbarUserId]);

  const refreshWallet = useCallback(async () => {
    await loadToolbarStats();
    setWalletRefreshKey((key) => key + 1);
  }, [loadToolbarStats]);

  const loadNotificationsNow = useCallback(async () => {
    if (!profile) return;
    const notifs: CadetNotification[] = [];
    const persistedLedgerIds = new Set<string>();
    const persistedMessageIds = new Set<string>();
    const persistedReactionIds = new Set<string>();
    const storedReadIds = loadStoredReadNotificationIds(profile.id);
    const activeReadIds = new Set([...Array.from(storedReadIds), ...Array.from(readNotificationIds)]);

    try {
      const persisted = await fetchUserNotifications(profile.id, 24);
      persisted.forEach((notification) => {
        const actionTab = actionKeyToTab(notification.action_key);
        const ledgerId = notification.metadata?.ledger_id;
        if (ledgerId) persistedLedgerIds.add(String(ledgerId));
        const messageId = notification.metadata?.message_id;
        if (messageId) persistedMessageIds.add(String(messageId));
        const reactionId = notification.metadata?.reaction_id;
        if (reactionId) persistedReactionIds.add(String(reactionId));
        notifs.push({
          id: `persisted-${notification.id}`,
          persistedId: notification.id,
          title: notification.title,
          text: notification.body,
          type: persistedNotificationTone(notification),
          actionTab,
          actionLabel: actionLabelForTab(actionTab),
          read: !!notification.read_at,
          createdAt: notification.created_at,
          metadata: notification.metadata,
          sourceType: notification.notification_type,
        });
      });
    } catch {}

    try {
      const today = getTodayISODate();
      const { data: rec } = await supabase
        .from('daily_records')
        .select('meditation_submitted, attendance_status, attendance_late, streak_valid')
        .eq('user_id', profile.id)
        .eq('record_date', today)
        .maybeSingle();

      if (getDayType(new Date()) === 'weekday') {
        const attendanceStatus = rec?.attendance_status || 'unmarked';
        if (attendanceStatus === 'present') {
          notifs.push({
            id: `attendance-${today}`,
            title: rec?.attendance_late ? 'Morning call marked late' : 'Morning call confirmed',
            text: `Your sentry marked you present for morning call. +${formatDenarii(200)} Ð awarded.`,
            type: 'success',
            actionTab: 'dashboard',
            actionLabel: 'Open Dashboard',
          });
        } else if (attendanceStatus === 'absent') {
          notifs.push({
            id: `attendance-absent-${today}`,
            title: 'Morning call marked absent',
            text: 'Your sentry marked you absent for today\'s morning call.',
            type: 'warning',
            actionTab: 'tent',
            actionLabel: 'Open Tent',
          });
        } else {
          notifs.push({
            id: `attendance-unmarked-${today}`,
            title: 'Morning call not marked yet',
            text: 'Your sentry has not marked your morning call attendance yet.',
            type: 'warning',
            actionTab: 'tent',
            actionLabel: 'Open Tent',
          });
        }

        if (!rec?.meditation_submitted) {
          notifs.push({
            id: `devotion-${today}`,
            title: 'Devotion pending',
            text: 'Submit today\'s devotion to complete the second part of your streak.',
            type: 'warning',
            actionTab: 'narrative',
            actionLabel: 'Open Reading',
          });
        } else {
          notifs.push({
            id: `devotion-done-${today}`,
            title: 'Devotion submitted',
            text: 'Today\'s devotion is in.',
            type: 'success',
            actionTab: 'dashboard',
          });
        }
        if (attendanceStatus === 'present' && rec?.meditation_submitted) {
          notifs.push({
            id: `streak-complete-${today}`,
            title: 'Streak day complete',
            text: 'Morning call and devotion are both complete for today.',
            type: 'success',
            actionTab: 'dashboard',
            actionLabel: 'Open Dashboard',
          });
        }
      }
    } catch {}

    try {
      const unreadMessages = await fetchUnreadTentMessagesForUser(profile.id);
      unreadMessages
        .filter((message: any) => !persistedMessageIds.has(String(message.id)))
        .slice(0, 3)
        .forEach((message: any) => {
          notifs.push({
            id: `unread-message-${message.id}`,
            title: 'Unread tent message',
            text: `${message.sender?.display_name || 'Someone in your tent'}: ${message.body}`,
            type: 'info',
            actionTab: 'tent',
            actionLabel: 'Open Tent',
            createdAt: message.created_at,
            sourceType: 'message',
          });
        });
    } catch {}

    try {
      const { data: reactions } = await supabase
        .from('tent_reactions')
        .select('id,tent_id,reactor_user_id,reaction_type,target_type,target_reference,created_at')
        .eq('target_user_id', profile.id)
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('created_at', { ascending: false })
        .limit(8);
      const visibleReactions = (reactions || []).filter((reaction: any) => !persistedReactionIds.has(String(reaction.id)));
      const reactorIds = Array.from(new Set(visibleReactions.map((reaction: any) => reaction.reactor_user_id).filter(Boolean)));
      let reactorNames = new Map<string, string>();
      if (reactorIds.length > 0) {
        const { data: reactors } = await supabase
          .from('profiles')
          .select('id,display_name')
          .in('id', reactorIds);
        reactorNames = new Map((reactors || []).map((reactor: any) => [reactor.id, reactor.display_name]));
      }
      visibleReactions.slice(0, 4).forEach((reaction: any) => {
        notifs.push({
          id: `reaction-${reaction.id}`,
          title: 'Tent reaction',
          text: `${reactorNames.get(reaction.reactor_user_id) || 'A tent mate'} reacted to your ${formatReactionTarget(reaction.target_type)}.`,
          type: 'info',
          actionTab: 'tent',
          actionLabel: 'Open Tent',
          createdAt: reaction.created_at,
        });
      });
    } catch {}

    try {
      const ledgerEntries = await fetchLedgerEntries(profile.id, 60);
      ledgerEntries
        .filter((entry) => !persistedLedgerIds.has(entry.id))
        .filter((entry) => new Date(entry.created_at).getTime() >= Date.now() - 3 * 86400000)
        .filter((entry) => ['relic_purchase', 'relic_reward', 'mobile_money', 'campay_payment', 'freezer_daily', 'freezer_weekly', 'arena_stake', 'arena_fee', 'arena_reward', 'quiz_reward', 'fortune_quiz_reward', 'game_level', 'game_blitz', 'attendance'].includes(entry.source_type))
        .slice(0, 5)
        .forEach((entry) => {
          const gained = entry.amount > 0;
          const actionTab = entry.source_type.startsWith('arena') ? 'arena'
            : entry.source_type.includes('quiz') ? 'quiz'
              : entry.source_type.includes('game') ? 'game'
                : ['relic_purchase', 'relic_reward', 'freezer_daily', 'freezer_weekly', 'mobile_money', 'campay_payment'].includes(entry.source_type) ? 'store'
                  : 'dashboard';
          notifs.push({
            id: `ledger-${entry.id}`,
            title: gained ? 'Denarii added' : 'Denarii spent',
            text: `${gained ? '+' : '-'}${formatDenarii(Math.abs(entry.amount))} Ð${entry.description ? ` · ${entry.description}` : ''}`,
            type: gained ? 'success' : 'info',
            actionTab,
            actionLabel: actionLabelForTab(actionTab),
            createdAt: entry.created_at,
          });
        });
    } catch {}

    try {
      const { data: challengeUpdates } = await supabase
        .from('challenge_submissions')
        .select('id,narrative_date,status,rejection_reason,reviewed_at,submitted_at')
        .eq('user_id', profile.id)
        .in('status', ['approved', 'rejected'])
        .order('reviewed_at', { ascending: false, nullsFirst: false })
        .limit(3);
      (challengeUpdates || [])
        .filter((challenge: any) => challenge.reviewed_at && new Date(challenge.reviewed_at).getTime() >= Date.now() - 7 * 86400000)
        .forEach((challenge: any) => {
          notifs.push({
            id: `challenge-${challenge.id}`,
            title: challenge.status === 'approved' ? 'Challenge approved' : 'Challenge needs work',
            text: challenge.status === 'approved'
              ? `Your ${challenge.narrative_date} challenge was approved.`
              : `Your ${challenge.narrative_date} challenge was rejected${challenge.rejection_reason ? `: ${challenge.rejection_reason}` : '.'}`,
            type: challenge.status === 'approved' ? 'success' : 'warning',
            actionTab: 'narrative',
            actionLabel: 'Open Reading',
            createdAt: challenge.reviewed_at,
          });
        });
    } catch {}

    try {
      const rooms = await fetchArenaRooms();
      const waitingRooms = rooms.filter((room: any) => room.status === 'waiting');
      const invitedRooms = waitingRooms.filter((room: any) => {
        const isParticipant = (room.arena_participants || []).some((participant: any) => participant.user_id === profile.id);
        return !isParticipant && Array.isArray(room.tagged_user_ids) && room.tagged_user_ids.includes(profile.id);
      });
      if (invitedRooms.length > 0) {
        notifs.push({
          id: 'arena-invites',
          title: 'Arena invite waiting',
          text: `${invitedRooms.length} arena room${invitedRooms.length === 1 ? '' : 's'} invited you to join.`,
          type: 'info',
          actionTab: 'arena',
          actionLabel: 'Open Arena',
          createdAt: invitedRooms[0].created_at,
        });
      }

      const openRooms = waitingRooms.filter((room: any) => room.creator_id !== profile.id);
      if (openRooms.length > 0) {
        notifs.push({
          id: 'arena-open-rooms',
          title: 'Open arena rooms',
          text: `${openRooms.length} open room${openRooms.length === 1 ? '' : 's'} can be joined now.`,
          type: 'info',
          actionTab: 'arena',
          actionLabel: 'Open Arena',
          createdAt: openRooms[0].created_at,
        });
      }
    } catch {}

    try {
      const memberIds = tentInfo.members
        .filter((member) => member.user_id !== profile.id && member.role === 'cadet')
        .map((member) => member.user_id);
      if (memberIds.length > 0) {
        const { data: records } = await supabase
          .from('daily_records')
          .select('user_id,record_date,meditation_submitted')
          .in('user_id', memberIds)
          .gte('record_date', getDateDaysAgoISO(2))
          .order('record_date', { ascending: false });

        const latestByUser = new Map<string, any>();
        (records || []).forEach((record: any) => {
          if (!latestByUser.has(record.user_id)) latestByUser.set(record.user_id, record);
        });

        tentInfo.members
          .filter((member) => member.user_id !== profile.id && member.role === 'cadet')
          .filter((member) => {
            const latest = latestByUser.get(member.user_id);
            return !latest || latest.meditation_submitted !== true;
          })
          .slice(0, 2)
          .forEach((member) => {
            notifs.push({
              id: `inactive-${member.user_id}`,
              title: 'Reach out',
              text: `${member.profiles?.display_name || 'A tent mate'} has been quiet. A quick check-in may help them stay active.`,
              type: 'warning',
              actionTab: 'tent',
              actionLabel: 'Open Tent',
            });
          });
      }
    } catch {}

    if (subStatus?.status === 'trial' && trialDaysLeft <= 7) {
      notifs.push({
        id: 'trial',
        title: 'Trial ending soon',
        text: `Your free trial ends in ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''}.`,
        type: 'warning',
        actionTab: 'subscribe',
        actionLabel: 'Subscribe',
      });
    }
    if (subStatus?.status === 'expired') {
      notifs.push({
        id: 'expired',
        title: 'Trial expired',
        text: 'Your free trial has ended. Subscribe to keep playing and earning.',
        type: 'warning',
        actionTab: 'subscribe',
        actionLabel: 'Subscribe',
      });
    }

    const deduped = Array.from(new Map(notifs.map((notification) => [notification.id, notification])).values())
      .map((notification) =>
        activeReadIds.has(notification.id)
          ? { ...notification, read: true, type: 'info' as CadetNotificationType }
          : notification,
      );
    deduped.sort((a, b) => {
      const priority = (n: CadetNotification) => n.read ? 0 : n.type === 'warning' ? 3 : n.type === 'success' ? 2 : 1;
      const priorityDiff = priority(b) - priority(a);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    setNotifications(deduped.slice(0, 40));
  }, [profile, subStatus, trialDaysLeft, tentInfo.members, readNotificationIds]);
  notificationLoaderRef.current = loadNotificationsNow;

  const loadNotifications = useCallback(() => {
    if (notificationRequestRef.current) {
      notificationRefreshQueuedRef.current = true;
      return notificationRequestRef.current;
    }
    const request = (async () => {
      do {
        notificationRefreshQueuedRef.current = false;
        await notificationLoaderRef.current?.();
      } while (notificationRefreshQueuedRef.current);
    })();
    const shared = request.finally(() => {
      if (notificationRequestRef.current === shared) notificationRequestRef.current = null;
    });
    notificationRequestRef.current = shared;
    return shared;
  }, [loadNotificationsNow]);

  const refreshCadetState = useCallback(async () => {
    const walletRequest = refreshWallet();
    void loadNotifications();
    await walletRequest.catch(() => undefined);
    setCadetRefreshKey((key) => key + 1);
    // Realtime can announce a committed daily-record change before every
    // derived streak RPC observes it. Confirm once more after propagation.
    window.setTimeout(() => {
      void loadToolbarStats();
    }, 900);
  }, [refreshWallet, loadNotifications, loadToolbarStats]);

  const loadSubStatus = useCallback(async () => {
    if (!profile) return;
    try {
      const status = await getSubscriptionStatus(profile.id);
      setSubStatus(status);
    } catch {
      setSubStatus({ status: 'trial', trial_ends_at: new Date(Date.now() + 31 * 86400000).toISOString(), current_period_end: null, is_paid: false });
    }
  }, [profile]);

  useEffect(() => {
    loadTentInfo();
    loadSubStatus();
  }, [loadTentInfo, loadSubStatus]);

  useEffect(() => {
    if (isExpired && PREMIUM_TABS.has(tab)) setTab('subscribe');
  }, [isExpired, tab]);

  useEffect(() => {
    if (!profile) {
      setReadNotificationIds(new Set());
      return;
    }
    setReadNotificationIds(loadStoredReadNotificationIds(profile.id));
  }, [profile]);

  useEffect(() => {
    const refreshVisibleState = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastForegroundRefreshRef.current < 10_000) return;
      lastForegroundRefreshRef.current = now;
      void refreshCadetState();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadNotifications();
    }, 90_000);

    window.addEventListener('focus', refreshVisibleState);
    window.addEventListener('online', refreshVisibleState);
    document.addEventListener('visibilitychange', refreshVisibleState);
    window.addEventListener('full-circle-wallet-refresh', refreshVisibleState);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisibleState);
      window.removeEventListener('online', refreshVisibleState);
      document.removeEventListener('visibilitychange', refreshVisibleState);
      window.removeEventListener('full-circle-wallet-refresh', refreshVisibleState);
    };
  }, [loadNotifications, refreshCadetState]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadNotifications(); }, 650);
    return () => window.clearTimeout(timer);
  }, [loadNotifications]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`user_notifications_${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
        (payload) => {
        if (payload.eventType === 'INSERT') {
          const notification = payload.new as UserNotification;
          if (!isDoveArrival(notification)) setToastNotification(notification);
          void showDeviceNotification(notification);
            void playNotificationSound(notification.notification_type, String(notification.metadata?.status || ''));
          }
          void loadNotifications();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, loadNotifications]);

  useEffect(() => {
    if (!profile) return;
    const refreshCadetWallet = () => { void refreshWallet(); };
    const refreshCadetProgress = () => { void refreshCadetState(); };
    const channel = supabase
      .channel(`cadet_wallet_${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'denarii_ledger_entries', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            announceDenariiGain(Number((payload.new as { amount?: number }).amount) || 0);
          }
          refreshCadetWallet();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'relic_inventory', filter: `user_id=eq.${profile.id}` },
        refreshCadetWallet,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mobile_money_payments', filter: `user_id=eq.${profile.id}` },
        refreshCadetWallet,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_records', filter: `user_id=eq.${profile.id}` },
        refreshCadetProgress,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'streak_freezers', filter: `user_id=eq.${profile.id}` },
        refreshCadetProgress,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, refreshCadetState, refreshWallet]);

  const houseName = tentInfo.tent?.tent_houses?.name;
  const tentName = tentInfo.tent?.name;

  // Trial expired = can read/meditate but can't play, earn, leaderboard, or purchase

  const tabLabels: Record<Tab, string> = {
    dashboard: 'Cadet Dashboard',
    narrative: 'Today\'s Reading',
    streak: 'My Streak',
    games: 'Daily Games',
    game: 'Daily Trivia',
    arena: 'Arena',
    story: 'Story Mode',
    quiz: 'Weekly Quiz',
    tent: 'My Tent',
    leaderboard: 'Challenge Boards',
    awards: 'Awards Hub',
    store: 'The Market',
    settings: 'Settings',
    subscribe: 'Subscribe',
  };

  const handleNavigate = useCallback((k: string) => {
    const requestedTab = k as Tab;
    if (isExpired && PREMIUM_TABS.has(requestedTab)) {
      setTab('subscribe');
      return;
    }
    const nextTab = requestedTab;
    const destinationIds = notifications
      .filter((notification) => !notification.read && notification.actionTab === nextTab)
      .map((notification) => notification.id);
    if (destinationIds.length > 0) {
      setOpenedDestinationNotificationIds((prev) => {
        const next = new Set(prev);
        destinationIds.forEach((id) => next.add(id));
        return next;
      });
    }
    setTab(nextTab);
  }, [isExpired, notifications]);

  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<AppNavigationDetail>).detail;
      if (detail?.actionKey) handleNavigate(detail.actionKey);
    };
    window.addEventListener(APP_NAVIGATION_EVENT, navigate);
    return () => window.removeEventListener(APP_NAVIGATION_EVENT, navigate);
  }, [handleNavigate]);

  const markLocalNotificationsRead = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const uniqueIds = Array.from(new Set(ids));
    setReadNotificationIds((prev) => {
      const next = new Set(prev);
      uniqueIds.forEach((id) => next.add(id));
      if (profile) saveStoredReadNotificationIds(profile.id, next);
      return next;
    });
    setNotifications((prev) =>
      prev.map((item) =>
        uniqueIds.includes(item.id)
          ? { ...item, read: true, type: 'info' }
          : item,
      ),
    );
  }, [profile]);

  const markLinkedNotificationRead = async (notification: CadetNotification) => {
    if (notification.persistedId && !notification.read) {
      await markNotificationRead(notification.persistedId).catch(() => null);
    }
    if (notification.id.startsWith('unread-message-')) {
      const messageId = notification.id.replace('unread-message-', '');
      await markTentMessageRead(messageId).catch(() => null);
    }
  };

  const handleNotificationOpen = async (notification: CadetNotification) => {
    if (isExpired && ['message', 'direct_message', 'message_mention'].includes(String(notification.sourceType || '').toLowerCase())) {
      setTab('subscribe');
      setShowNotifications(false);
      return;
    }
    if (!notification.read) {
      await markLinkedNotificationRead(notification);
      markLocalNotificationsRead([notification.id]);
    }
    if (notification.actionTab) {
      storeScriptureTarget(scriptureTargetFromMetadata(notification.metadata));
      handleNavigate(notification.actionTab);
      setShowNotifications(false);
    }
  };

  const handleMarkNotificationRead = async (notification: CadetNotification) => {
    if (notification.read) return;
    await markLinkedNotificationRead(notification);
    markLocalNotificationsRead([notification.id]);
  };

  const handleMarkAllRead = async () => {
    if (!profile || unreadNotificationCount === 0) return;
    const unreadIds = notifications.filter((notification) => !notification.read).map((notification) => notification.id);
    await markAllNotificationsRead(profile.id).catch(() => null);
    await supabase
      .from('tent_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', profile.id)
      .is('read_at', null)
      .then(() => null);
    markLocalNotificationsRead(unreadIds);
  };

  const unreadNotificationCount = notifications.filter((notification) => !notification.read).length;
  const notificationBadges = useMemo(() => {
    const counts: Partial<Record<Tab, number>> = {};
    notifications.forEach((notification) => {
      if (!notification.read && notification.actionTab && !openedDestinationNotificationIds.has(notification.id)) {
        counts[notification.actionTab] = (counts[notification.actionTab] || 0) + 1;
      }
    });
    return counts as Record<string, number>;
  }, [notifications, openedDestinationNotificationIds]);

  useEffect(() => {
    if (!showNotifications) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [showNotifications]);

  return (
    <SubscriptionAccessProvider isExpired={isExpired} onSubscriptionRequired={() => setTab('subscribe')}>
    <>
    <AppShell
      navItems={NAV_ITEMS}
      activeKey={tab}
      navActiveKey={dailyGamesNavigationKey(tab)}
      onNavigate={handleNavigate}
      headerTitle={tabLabels[tab]}
      headerSubtitle={houseName ? `${tentName} · ${houseName}` : 'Cadet'}
      showTopSignOut
      rightHeader={
        <div className="flex items-center gap-1.5">
          {isExpired && (
            <button onClick={() => setTab('subscribe')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-coral-soft text-coral border border-coral/30 hover:bg-coral/10 transition-colors">
              <Lock size={14} /> Subscribe
            </button>
          )}
          {/* Streak icon */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-coral-soft border border-coral/30" title={`${streakCount} day streak`}>
            <StreakStatusIcon protection={streakProtection} />
            <span className="font-display font-bold text-coral text-[13px]">{toolbarReady ? streakCount : '…'}</span>
          </div>
          {/* Marks */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-border-bright bg-surface-2" title={`${marksTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} Marks`}>
            <ChiRhoMark size={14} className="text-peri-2" />
            <span className="font-display text-[13px] font-bold text-peri-2">
              {toolbarReady ? marksTotal.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '…'}
            </span>
          </div>
          {/* Notification bell */}
          <div className="relative z-[70]" ref={notificationsRef}>
            <button onClick={() => setShowNotifications(s => !s)} className="relative z-[90] flex h-8 w-8 items-center justify-center overflow-visible rounded-full border border-border bg-surface-2 transition-colors hover:border-border-bright">
              <Bell size={15} className="text-ink" />
              {unreadNotificationCount > 0 && (
                <span className="notification-badge-ring absolute right-0 top-0 z-[100] flex h-5 w-5 shrink-0 -translate-y-1/3 translate-x-1/3 items-center justify-center rounded-full border-2 bg-coral p-0 text-[9px] font-bold leading-none text-white shadow-sm">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <>
                <button type="button" aria-label="Close notifications" onClick={() => setShowNotifications(false)} className="fixed inset-0 z-[80] cursor-default bg-ink/45" />
                <div className="fixed right-3 top-[7.1rem] z-[100] w-[calc(100vw-1.5rem)] max-w-sm rounded-xl border border-border bg-surface shadow-2xl overflow-hidden animate-fade-in md:absolute md:right-0 md:top-full md:mt-2 md:w-[22rem]">
                <div className="px-4 py-2.5 border-b border-border bg-surface-2 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-display font-semibold text-ink">Notifications</span>
                    <p className="text-[10px] text-stone mt-0.5">
                      {unreadNotificationCount > 0 ? `${unreadNotificationCount} unread` : 'All read'}
                    </p>
                  </div>
                  <button
                    onClick={handleMarkAllRead}
                    disabled={unreadNotificationCount === 0}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border-bright bg-surface px-2.5 py-1 text-[10px] font-bold text-ink hover:border-sage/40 hover:text-sage disabled:cursor-not-allowed disabled:opacity-45 transition-colors"
                  >
                    <CheckCheck size={12} /> Mark all as read
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-stone">You're all caught up</div>
                  ) : notifications.map(n => (
                    <div key={n.id} className={`flex gap-2.5 px-4 py-3 border-b border-border last:border-0 ${n.read ? 'opacity-70' : ''}`}>
                      {n.type === 'success' && <CheckCircle2 size={16} className="text-sage flex-shrink-0 mt-0.5" />}
                      {n.type === 'warning' && <AlertTriangle size={16} className="text-coral flex-shrink-0 mt-0.5" />}
                      {n.type === 'info' && (n.title.toLowerCase().includes('message') ? <MessageCircle size={16} className="text-royal flex-shrink-0 mt-0.5" /> : <Bell size={16} className="text-royal flex-shrink-0 mt-0.5" />)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-coral flex-shrink-0 mt-1.5" />}
                          <p className="text-xs font-semibold text-ink leading-snug">{n.title}</p>
                        </div>
                        <p className="text-xs text-stone leading-relaxed mt-0.5">{n.text}</p>
                        {(n.actionTab || !n.read) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {n.actionTab && (
                              <button
                                onClick={() => handleNotificationOpen(n)}
                                className="inline-flex items-center rounded-full border border-royal/25 bg-royal-soft px-2.5 py-1 text-[10px] font-bold text-royal hover:border-royal/40 transition-colors"
                              >
                                {n.actionLabel || 'Open'}
                              </button>
                            )}
                            {!n.read && (
                              <button
                                onClick={() => handleMarkNotificationRead(n)}
                                className="inline-flex items-center gap-1 rounded-full border border-border-bright bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-ink hover:border-sage/40 hover:text-sage transition-colors"
                                title="Mark as read"
                              >
                                <CheckCheck size={11} /> Mark as read
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                </div>
              </>
            )}
          </div>
          {/* Denarii */}
          <div data-denarii-target className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-peri-soft border border-border-bright" title={`${denariiTotal.toLocaleString()} Denarii`}>
            <Coins size={16} className="text-gold" />
            <span className="font-display font-bold text-gold text-[13px]">
              {toolbarReady ? (denariiTotal >= 1000 ? `${(denariiTotal / 1000).toFixed(1)}K` : denariiTotal) : '…'}
            </span>
          </div>
        </div>
      }
      navBadges={{
        ...notificationBadges,
        games: (notificationBadges.game || 0) + (notificationBadges.arena || 0),
      }}
    >
      {tab === 'dashboard' && <CadetDashboard denariiTotal={denariiTotal} currentStreak={streakCount} tentInfo={tentInfo} onNavigate={handleNavigate} onRefreshDenarii={refreshCadetState} refreshKey={cadetRefreshKey} notificationBadges={notificationBadges} />}
        {tab === 'narrative' && <CadetNarrative onMeditationSaved={refreshCadetState} streakCount={streakCount} />}
        {tab === 'streak' && <CadetStreak refreshKey={cadetRefreshKey} />}
        {tab === 'games' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : (
          <DailyGamesHub
            onOpenTrivia={() => handleNavigate('game')}
            onOpenArena={() => handleNavigate('arena')}
            onOpenStory={() => handleNavigate('story')}
          />
        ))}
        {tab === 'game' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <CadetGame onRewardEarned={refreshCadetState} onBackToDailyGames={() => handleNavigate('games')} />)}
        {tab === 'arena' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <CadetArena onBalanceChanged={refreshCadetState} onBackToDailyGames={() => handleNavigate('games')} />)}
        {tab === 'story' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <StoryModeShell onBackToDailyGames={() => handleNavigate('games')} />)}
        {tab === 'quiz' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <CadetQuiz onQuizSubmitted={refreshCadetState} />)}
        {tab === 'tent' && <CadetTent />}
        {tab === 'leaderboard' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <CadetLeaderboard />)}
        {tab === 'awards' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <CadetAwards />)}
        {tab === 'store' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <CadetStore onBalanceChanged={refreshCadetState} refreshKey={walletRefreshKey} />)}
        {tab === 'settings' && <CadetSettings refreshKey={cadetRefreshKey} currentStreak={streakCount} />}
        {tab === 'subscribe' && (
          <SubscriptionScreen
            subStatus={subStatus}
            onActivated={async (status) => {
              setSubStatus(status);
              await refreshCadetState();
              setTab('dashboard');
            }}
          />
        )}
    </AppShell>
    <DoveNotificationArrival onNavigate={handleNavigate} />
    {toastNotification && (
      <button type="button" onClick={() => { const linked = notifications.find((item) => item.persistedId === toastNotification.id); if (linked) void handleNotificationOpen(linked); else setShowNotifications(true); setToastNotification(null); }} className="fixed bottom-5 left-1/2 z-[160] flex w-[min(92vw,25rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-border-bright bg-surface/95 px-3.5 py-3 text-left shadow-2xl backdrop-blur-md animate-slide-up">
        <DoveMark size={28} className="shrink-0" />
        <span className="min-w-0 flex-1"><strong className="block truncate text-xs font-bold text-ink">{toastNotification.title}</strong><span className="mt-0.5 block truncate text-[11px] text-stone">{toastNotification.body}</span></span>
        <img src={notificationSymbolForType(toastNotification.notification_type)} alt="" className="h-7 w-7 shrink-0 rounded-full border border-border bg-surface-2 p-1.5" />
      </button>
    )}
    <StreakCelebration streak={streakCelebration} onDone={() => setStreakCelebration(null)} />
    </>
    </SubscriptionAccessProvider>
  );
}
