import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AppShell } from '../../components/AppShell';
import { CadetDashboard } from './CadetDashboard';
import { supabase } from '../../lib/supabase';
import {
  getSubscriptionStatus,
  fetchStrictStreak,
  fetchUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  fetchUnreadTentMessagesForUser,
  markTentMessageRead,
  fetchLedgerEntries,
  fetchArenaRooms,
} from '../../lib/queries';
import { formatDenarii, getDayType, getTodayISODate } from '../../lib/utils';
import type { Tent, TentMember, Profile, UserNotification } from '../../lib/types';
import {
  Home, BookOpen, Gamepad2, FileQuestion, Trophy, Award, Coins, Tent as TentIcon,
  Lock, CreditCard, Settings as SettingsIcon, ShoppingBag, Swords,
  Flame, Bell, CheckCircle2, AlertTriangle, MessageCircle, CheckCheck,
} from 'lucide-react';

// Keep the first dashboard paint light. Each sizeable workspace is downloaded
// only when the cadet actually opens it.
const CadetNarrative = lazy(() => import('./CadetNarrative').then((module) => ({ default: module.CadetNarrative })));
const CadetGame = lazy(() => import('./CadetGame').then((module) => ({ default: module.CadetGame })));
const CadetQuiz = lazy(() => import('./CadetQuiz').then((module) => ({ default: module.CadetQuiz })));
const CadetLeaderboard = lazy(() => import('./CadetLeaderboard').then((module) => ({ default: module.CadetLeaderboard })));
const CadetAwards = lazy(() => import('./CadetAwards').then((module) => ({ default: module.CadetAwards })));
const CadetTent = lazy(() => import('./CadetTent').then((module) => ({ default: module.CadetTent })));
const CadetSettings = lazy(() => import('./CadetSettings').then((module) => ({ default: module.CadetSettings })));
const CadetStore = lazy(() => import('./CadetStore').then((module) => ({ default: module.CadetStore })));
const CadetArena = lazy(() => import('./CadetArena').then((module) => ({ default: module.CadetArena })));
const CadetStreak = lazy(() => import('./CadetStreak').then((module) => ({ default: module.CadetStreak })));

type Tab = 'dashboard' | 'narrative' | 'streak' | 'game' | 'arena' | 'quiz' | 'tent' | 'leaderboard' | 'awards' | 'store' | 'settings' | 'subscribe';

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
};

const DEVICE_NOTIFICATIONS_KEY = 'full-circle-browser-notifications-enabled';

async function showDeviceNotification(notification: UserNotification) {
  if (typeof window === 'undefined' || Notification.permission !== 'granted') return;
  if (window.localStorage.getItem(DEVICE_NOTIFICATIONS_KEY) !== 'true') return;
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (!registration) return;
    await registration.showNotification(notification.title || 'Full Circle', {
      body: notification.body || 'You have a new update.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: `full-circle-${notification.id}`,
      data: { url: '/' },
    });
  } catch {
    // The in-app bell and destination badges still update when the device blocks a foreground toast.
  }
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: Home },
  { key: 'narrative', label: 'Today\'s Reading', icon: BookOpen },
  { key: 'streak', label: 'My Streak', icon: Flame },
  { key: 'game', label: 'Daily Game', icon: Gamepad2 },
  { key: 'arena', label: 'The Arena', icon: Swords },
  { key: 'quiz', label: 'Weekly Quiz', icon: FileQuestion },
  { key: 'tent', label: 'My Tent', icon: TentIcon },
  { key: 'leaderboard', label: 'Challenge Boards', icon: Trophy },
  { key: 'awards', label: 'Awards Hub', icon: Award },
  { key: 'store', label: 'The Market', icon: ShoppingBag },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

function actionKeyToTab(actionKey: string | null | undefined): Tab | undefined {
  if (!actionKey) return undefined;
  return NAV_ITEMS.some((item) => item.key === actionKey) || actionKey === 'subscribe'
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
    game: 'Open Game',
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

function daysAgoISO(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
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
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [tentInfo, setTentInfo] = useState<{ tent: Tent & { tent_houses?: any } | null; members: (TentMember & { profiles: Profile })[] }>({ tent: null, members: [] });
  const [denariiTotal, setDenariiTotal] = useState(0);
  const [streakCount, setStreakCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<CadetNotification[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  const [openedDestinationNotificationIds, setOpenedDestinationNotificationIds] = useState<Set<string>>(new Set());
  const [walletRefreshKey, setWalletRefreshKey] = useState(0);
  const [cadetRefreshKey, setCadetRefreshKey] = useState(0);
  const [subStatus, setSubStatus] = useState<{ status: string; trial_ends_at: string | null; current_period_end: string | null; is_paid: boolean } | null>(null);

  const isExpired = subStatus?.status === 'expired';
  const trialCountdown = getCountdownParts(subStatus?.trial_ends_at);
  const trialDaysLeft = trialCountdown.days;

  const loadTentInfo = useCallback(async () => {
    if (!profile) return;
    const { data: member } = await supabase
      .from('tent_members')
      .select('tent_id')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (member) {
      const { data: tent } = await supabase
        .from('tents')
        .select('*, tent_houses(*)')
        .eq('id', member.tent_id)
        .maybeSingle();
      const { data: members } = await supabase
        .from('tent_members')
        .select('*, profiles(*)')
        .eq('tent_id', member.tent_id)
        .order('joined_at');
      setTentInfo({ tent: tent as any, members: (members || []) as any });
    }
  }, [profile]);

  const loadDenarii = useCallback(async () => {
    if (!profile) return;
    try {
      const { data } = await supabase.rpc('get_user_denarii_total', { p_user_id: profile.id });
      setDenariiTotal(Number(data) || 0);
    } catch { setDenariiTotal(0); }
  }, [profile]);

  const refreshWallet = useCallback(async () => {
    await loadDenarii();
    setWalletRefreshKey((key) => key + 1);
  }, [loadDenarii]);

  const loadStreak = useCallback(async () => {
    if (!profile) return;
    try {
      const s = await fetchStrictStreak(profile.id);
      setStreakCount(s.current_streak || 0);
    } catch { setStreakCount(0); }
  }, [profile]);

  const loadNotifications = useCallback(async () => {
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
      }
      if (rec?.meditation_submitted) {
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
      const ledgerEntries = await fetchLedgerEntries(profile.id);
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
          .gte('record_date', daysAgoISO(2))
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

  const refreshCadetState = useCallback(async () => {
    await Promise.allSettled([
      refreshWallet(),
      loadStreak(),
      loadNotifications(),
    ]);
    setCadetRefreshKey((key) => key + 1);
  }, [refreshWallet, loadStreak, loadNotifications]);

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
    refreshWallet();
    loadStreak();
    loadSubStatus();
  }, [loadTentInfo, refreshWallet, loadStreak, loadSubStatus]);

  useEffect(() => {
    if (!profile) {
      setReadNotificationIds(new Set());
      return;
    }
    setReadNotificationIds(loadStoredReadNotificationIds(profile.id));
  }, [profile?.id]);

  useEffect(() => {
    const refreshVisibleState = () => {
      if (document.visibilityState === 'visible') void refreshCadetState();
    };

    window.addEventListener('focus', refreshCadetState);
    document.addEventListener('visibilitychange', refreshVisibleState);

    return () => {
      window.removeEventListener('focus', refreshCadetState);
      document.removeEventListener('visibilitychange', refreshVisibleState);
    };
  }, [refreshCadetState]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`user_notifications_${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') void showDeviceNotification(payload.new as UserNotification);
          void loadNotifications();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, loadNotifications]);

  useEffect(() => {
    if (!profile) return;
    const refreshCadetWallet = () => { void refreshCadetState(); };
    const channel = supabase
      .channel(`cadet_wallet_${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'denarii_ledger_entries', filter: `user_id=eq.${profile.id}` },
        refreshCadetWallet,
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
        refreshCadetWallet,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, refreshCadetState]);

  const houseName = tentInfo.tent?.tent_houses?.name;
  const tentName = tentInfo.tent?.name;

  // Trial expired = can read/meditate but can't play, earn, leaderboard, or purchase

  const tabLabels: Record<Tab, string> = {
    dashboard: 'Cadet Dashboard',
    narrative: 'Today\'s Reading',
    streak: 'My Streak',
    game: 'Daily Game',
    arena: 'The Arena',
    quiz: 'Weekly Quiz',
    tent: 'My Tent',
    leaderboard: 'Challenge Boards',
    awards: 'Awards Hub',
    store: 'The Market',
    settings: 'Settings',
    subscribe: 'Subscribe',
  };

  const handleNavigate = (k: string) => {
    // Gate premium tabs when trial is expired
    if (isExpired && (k === 'game' || k === 'quiz' || k === 'leaderboard' || k === 'awards')) {
      setTab('subscribe');
      return;
    }
    if (k === 'narrative' && getDayType(new Date()) === 'saturday') {
      setTab('quiz');
      return;
    }
    const nextTab = k as Tab;
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
  };

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
    if (!notification.read) {
      await markLinkedNotificationRead(notification);
      markLocalNotificationsRead([notification.id]);
    }
    if (notification.actionTab) {
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
    <AppShell
      navItems={NAV_ITEMS}
      activeKey={tab}
      onNavigate={handleNavigate}
      headerTitle={tabLabels[tab]}
      headerSubtitle={houseName ? `${tentName} · ${houseName}` : 'Cadet'}
      showTopSignOut
      rightHeader={
        <div className="flex items-center gap-2">
          {isExpired && (
            <button onClick={() => setTab('subscribe')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-coral-soft text-coral border border-coral/30 hover:bg-coral/10 transition-colors">
              <Lock size={14} /> Subscribe
            </button>
          )}
          {/* Streak icon */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-coral-soft border border-coral/30" title={`${streakCount} day streak`}>
            <Flame size={16} className="text-coral" />
            <span className="font-display font-bold text-coral text-sm">{streakCount}</span>
          </div>
          {/* Notification bell */}
          <div className="relative z-[70]" ref={notificationsRef}>
            <button onClick={() => setShowNotifications(s => !s)} className="relative flex items-center justify-center w-9 h-9 rounded-full bg-surface-2 border border-border hover:border-border-bright transition-colors">
              <Bell size={16} className="text-ink" />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-coral text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>
            {showNotifications && (
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
            )}
          </div>
          {/* Denarii */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-peri-soft border border-border-bright">
            <Coins size={18} className="text-gold" />
            <span className="font-display font-bold text-gold text-sm">
              {denariiTotal >= 1000 ? `${(denariiTotal / 1000).toFixed(1)}K` : denariiTotal}
            </span>
          </div>
        </div>
      }
      navBadges={notificationBadges}
    >
      <Suspense fallback={<TabLoading />}>
        {tab === 'dashboard' && <CadetDashboard denariiTotal={denariiTotal} tentInfo={tentInfo} onNavigate={handleNavigate} onRefreshDenarii={refreshCadetState} refreshKey={cadetRefreshKey} notificationBadges={notificationBadges} />}
        {tab === 'narrative' && <CadetNarrative onMeditationSaved={refreshCadetState} streakCount={streakCount} />}
        {tab === 'streak' && <CadetStreak refreshKey={cadetRefreshKey} />}
        {tab === 'game' && (isExpired ? <SubscribeGate onSubscribe={() => setTab('subscribe')} /> : <CadetGame onRewardEarned={refreshCadetState} />)}
        {tab === 'arena' && (isExpired ? <SubscribeGate onSubscribe={() => setTab('subscribe')} /> : <CadetArena onBalanceChanged={refreshCadetState} />)}
        {tab === 'quiz' && (isExpired ? <SubscribeGate onSubscribe={() => setTab('subscribe')} /> : <CadetQuiz onQuizSubmitted={refreshCadetState} />)}
        {tab === 'tent' && <CadetTent />}
        {tab === 'leaderboard' && (isExpired ? <SubscribeGate onSubscribe={() => setTab('subscribe')} /> : <CadetLeaderboard />)}
        {tab === 'awards' && (isExpired ? <SubscribeGate onSubscribe={() => setTab('subscribe')} /> : <CadetAwards />)}
        {tab === 'store' && <CadetStore onBalanceChanged={refreshCadetState} refreshKey={walletRefreshKey} />}
        {tab === 'settings' && <CadetSettings refreshKey={cadetRefreshKey} currentStreak={streakCount} />}
      {tab === 'subscribe' && <SubscribeScreen subStatus={subStatus} />}
      </Suspense>
    </AppShell>
  );
}

function TabLoading() {
  return <div className="py-16 text-center text-sm text-stone animate-fade-in">Loading this space...</div>;
}

function SubscribeGate({ onSubscribe }: { onSubscribe: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-coral-soft flex items-center justify-center mb-4">
        <Lock size={32} className="text-coral" />
      </div>
      <h2 className="font-display text-xl font-semibold text-ink mb-2">Your free trial has ended</h2>
      <p className="text-sm text-stone max-w-md mb-6">
        You can still read the daily narrative and submit meditations. But games, quizzes, denarii, leaderboards, and purchases require an active subscription.
      </p>
      <button onClick={onSubscribe} className="btn-primary">
        <CreditCard size={16} /> Subscribe Now
      </button>
    </div>
  );
}

function SubscribeScreen({ subStatus }: { subStatus: { status: string; trial_ends_at: string | null; current_period_end: string | null; is_paid: boolean } | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string>('mobile_money');

  const paymentMethods = [
    { id: 'mobile_money', label: 'Mobile Money', desc: 'MTN, Airtel, Orange, Moov' },
    { id: 'bank_transfer', label: 'Bank Transfer', desc: 'Direct bank payment' },
    { id: 'card', label: 'Card Payment', desc: 'Visa / Mastercard' },
    { id: 'ussd', label: 'USSD Code', desc: 'Dial a code to pay' },
  ];

  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);
    try {
      // In production, this would call a payment edge function
      // For now, we simulate a successful payment
      setError('Payment processing is being set up. Your instructor will contact you to complete payment via ' + paymentMethods.find(m => m.id === selectedMethod)?.label);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const trialEndsAt = subStatus?.trial_ends_at ? new Date(subStatus.trial_ends_at).getTime() : NaN;
  const trialDaysLeft = Number.isFinite(trialEndsAt) ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86400000)) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="card p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-gold-soft flex items-center justify-center mx-auto mb-4">
          <CreditCard size={28} className="text-gold" />
        </div>
        <h2 className="font-display text-2xl font-semibold text-ink mb-2">Subscription</h2>
        <p className="text-sm text-stone mb-4">
          {subStatus?.status === 'trial' && `You're on a free trial — ${trialDaysLeft} days remaining.`}
          {subStatus?.status === 'active' && 'Your subscription is active.'}
          {subStatus?.status === 'expired' && 'Your free trial has ended. Subscribe to unlock games, denarii, leaderboards, and more.'}
        </p>
      </div>

      <div className="card p-6">
        <h3 className="font-display font-semibold text-ink mb-4">Choose Payment Method</h3>
        <div className="space-y-2">
          {paymentMethods.map((method) => (
            <button
              key={method.id}
              onClick={() => setSelectedMethod(method.id)}
              className={`w-full flex items-center justify-between p-4 rounded-lg border transition-all text-left ${selectedMethod === method.id ? 'border-gold bg-gold-soft' : 'border-border hover:border-border-bright'}`}
            >
              <div>
                <p className="text-sm font-medium text-ink">{method.label}</p>
                <p className="text-xs text-stone">{method.desc}</p>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 ${selectedMethod === method.id ? 'border-gold bg-gold' : 'border-border'}`} />
            </button>
          ))}
        </div>
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-gold-soft border border-gold/30 text-sm text-gold">
            {error}
          </div>
        )}
        <button onClick={handleSubscribe} disabled={loading} className="btn-primary w-full mt-4 disabled:opacity-50">
          {loading ? 'Processing…' : 'Continue to Payment'}
        </button>
        <p className="text-xs text-stone text-center mt-3">
          You can still read daily narratives and submit meditations for free.
        </p>
      </div>
    </div>
  );
}
