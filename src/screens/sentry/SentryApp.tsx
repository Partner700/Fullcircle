import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SubscriptionAccessProvider, subscriptionIsExpired } from '../../context/SubscriptionAccessContext';
import { AppShell, StatCard, SectionHeader, EmptyState } from '../../components/AppShell';
import { TentHouseBadge } from '../../components/TentHouseSymbol';
import { SettingsScreen } from '../../components/SettingsScreen';
import { NotificationCenter } from '../../components/NotificationCenter';
import { DoveNotificationArrival } from '../../components/DoveNotificationArrival';
import { MeditationHistoryPanel } from '../../components/MeditationHistoryPanel';
import { SealBullet } from '../../components/AncientMotifs';
import type { QuoteReactionState } from '../../components/QuoteReactions';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { RecentAwardsPanel } from '../../components/RecentAwardsPanel';
import { AppSelect } from '../../components/AppSelect';
import { StreakStatusIcon } from '../../components/StreakStatusIcon';
import { StreakCelebration } from '../../components/StreakCelebration';
import { VallumAvatarBadge } from '../../components/VallumAvatarBadge';
import { ChiRhoMark } from '../../components/ChiRhoMark';
import { SubscriptionGate, SubscriptionScreen, type SubscriptionStatusView } from '../../components/SubscriptionScreen';
import {
  DashboardIcon, CadetIcon, CalendarIcon, SettingsIcon,
} from '../../components/BrandIcons';
import { supabase } from '../../lib/supabase';
import {
  fetchPanelImageSettings, fetchDailyQuoteFeed, fetchLedgerEntries, fetchReliableToolbarStats, fetchPublicStreakDetails, uploadTentProfileImage,
  fetchDailyQuoteReactions, reactToDailyQuote, fetchAnnouncements,
  fetchAllChallengeSubmissions, reviewChallengeSubmission, fetchSentryAddableCadets, sentryAddCadetToTent,
  fetchStreakProtectionState, fetchNarrative, fetchActiveFcxExperience, fetchDailyVerseReactions,
  reactToDailyVerse, getSubscriptionStatus, fetchAwards, fetchLatestWeeklyQuizRankings,
} from '../../lib/queries';
import { computeStreak, getDayType, getTodayISODate, getAppClock, cn, formatShortDate, getRemovalState, isAttendanceOnTime, whatsappUrl, formatDenarii } from '../../lib/utils';
import { ATTENDANCE_CUTOFF_HOUR } from '../../lib/constants';
import type { Tent, TentMember, Profile, DailyRecord, DailyQuoteFeedItem, StreakInfo, PanelImageSetting, ScheduledAnnouncement, DenariiLedgerEntry, StreakProtectionState, DailyNarrative, FcxExperience, AwardWithRecipient, WeeklyQuizRanking } from '../../lib/types';
import { TentAvatar, TentGroupMessenger } from '../../components/TentMessenger';
import { useAutoAdvance } from '../../hooks/useAutoAdvance';
import { announceDenariiGain } from '../../lib/denariiAnimation';
import { dailyGamesNavigationKey } from '../../lib/dailyGames';
import { updateReactionOptimistically } from '../../lib/reactionState';
import { APP_NAVIGATION_EVENT, type AppNavigationDetail } from '../../lib/appNavigation';
import { CadetGame } from '../cadet/CadetGame';
import { DailyGamesHub } from '../cadet/DailyGamesHub';
import { StoryModeShell } from '../cadet/story-mode/StoryModeShell';
import { CadetStreak } from '../cadet/CadetStreak';
import { CadetNarrative } from '../cadet/CadetNarrative';
import { CadetStore } from '../cadet/CadetStore';
import { CadetLeaderboard } from '../cadet/CadetLeaderboard';
import { CadetArena } from '../cadet/CadetArena';
import { CadetQuiz } from '../cadet/CadetQuiz';
import { CadetAwards } from '../cadet/CadetAwards';
import { DashboardHeroSlideshow, type DashboardHeroSlide } from '../cadet/CadetDashboard';
import {
  AlertTriangle, CheckCircle2, XCircle, Clock, ClipboardCheck,
  UserCheck, Loader2, Sunrise, Tent as TentIcon, MessageCircle, Users, Shield, GamepadIcon,
  Camera, ShoppingBag, FileQuestion, Award, Trophy,
  Swords, Coins, Target, UserPlus, X, Eye, CreditCard, Lock, Snowflake,
} from 'lucide-react';

type Tab = 'overview' | 'attendance' | 'cadets' | 'challenges' | 'games' | 'game' | 'arena' | 'story' | 'reading' | 'streak' | 'quiz' | 'leaderboard' | 'awards' | 'store' | 'settings' | 'subscribe';

const SENTRY_TABS: Tab[] = ['overview', 'attendance', 'cadets', 'challenges', 'reading', 'games', 'game', 'arena', 'story', 'streak', 'quiz', 'leaderboard', 'awards', 'store', 'settings', 'subscribe'];
const PREMIUM_TABS = new Set<Tab>(['games', 'game', 'arena', 'story', 'quiz', 'leaderboard', 'awards', 'store']);

type StrictStreakData = {
  current_streak: number;
  longest_streak: number;
  consecutive_inactive: number;
  cumulative_inactive: number;
};

const NAV_ITEMS = [
  { key: 'overview', label: 'Overview', icon: DashboardIcon },
  { key: 'attendance', label: 'Mark Attendance', icon: CalendarIcon },
  { key: 'cadets', label: 'My Cadets', icon: CadetIcon },
  { key: 'challenges', label: 'Challenges', icon: Target },
  { key: 'reading', label: "Today's Reading", icon: CadetIcon },
  { key: 'games', label: 'Daily Games', icon: GamepadIcon },
  { key: 'streak', label: 'My Streak', icon: Shield },
  { key: 'quiz', label: 'Weekly Quiz', icon: FileQuestion },
  { key: 'leaderboard', label: 'Challenge Boards', icon: Trophy },
  { key: 'awards', label: 'Awards Hub', icon: Award },
  { key: 'store', label: 'Market', icon: ShoppingBag },
  { key: 'subscribe', label: 'Subscription', icon: CreditCard },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

function getInitialSentryTab(): Tab {
  if (typeof window === 'undefined') return 'overview';
  const key = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('fc-tab');
  if (key === 'narrative') return 'reading';
  return SENTRY_TABS.includes(key as Tab) ? key as Tab : 'overview';
}

const TENT_REQUIRED_TABS = new Set<Tab>(['overview', 'attendance', 'cadets', 'challenges']);
function streakForMember(
  userId: string,
  allRecords: Record<string, DailyRecord[]>,
  strictStreaks: Record<string, StrictStreakData>,
): StreakInfo {
  const local = computeStreak(allRecords[userId] || []);
  const strict = strictStreaks[userId];
  if (!strict) return local;
  return {
    ...local,
    current_streak: strict.current_streak,
    longest_streak: strict.longest_streak,
    consecutive_inactive: strict.consecutive_inactive,
    cumulative_inactive: strict.cumulative_inactive,
    removal_state: getRemovalState(strict.consecutive_inactive, strict.cumulative_inactive),
  };
}

export function SentryApp() {
  const { profile, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>(getInitialSentryTab);
  const [tent, setTent] = useState<(Tent & { tent_houses?: any }) | null>(null);
  const [members, setMembers] = useState<(TentMember & { profiles: Profile })[]>([]);
  const [allRecords, setAllRecords] = useState<Record<string, DailyRecord[]>>({});
  const [strictStreaks, setStrictStreaks] = useState<Record<string, StrictStreakData>>({});
  const [quotes, setQuotes] = useState<DailyQuoteFeedItem[]>([]);
  const [narrative, setNarrative] = useState<DailyNarrative | null>(null);
  const [fcxExperience, setFcxExperience] = useState<FcxExperience | null>(null);
  const [quoteReactions, setQuoteReactions] = useState<Record<string, QuoteReactionState>>({});
  const [verseReactions, setVerseReactions] = useState<Record<string, QuoteReactionState>>({});
  const [reactingQuote, setReactingQuote] = useState<string | null>(null);
  const [reactingVerse, setReactingVerse] = useState<string | null>(null);
  const [panelImages, setPanelImages] = useState<Record<string, PanelImageSetting>>({});
  const [announcements, setAnnouncements] = useState<ScheduledAnnouncement[]>([]);
  const [sentryStreak, setSentryStreak] = useState(0);
  const [streakProtection, setStreakProtection] = useState<StreakProtectionState | null>(null);
  const [streakCelebration, setStreakCelebration] = useState<number | null>(null);
  const [sentryDenarii, setSentryDenarii] = useState(0);
  const [sentryMarks, setSentryMarks] = useState(0);
  const [sentryLedger, setSentryLedger] = useState<DenariiLedgerEntry[]>([]);
  const [subStatus, setSubStatus] = useState<SubscriptionStatusView | null>(null);
  const [subscriptionClock, setSubscriptionClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [uploadingTentPhoto, setUploadingTentPhoto] = useState(false);
  const hasLoadedRef = useRef(false);
  const lastForegroundRefreshRef = useRef(0);
  const loadRequestRef = useRef<Promise<void> | null>(null);
  const statsRequestRef = useRef<Promise<void> | null>(null);
  const memberRequestRef = useRef<Promise<void> | null>(null);
  const socialRequestRef = useRef<Promise<void> | null>(null);
  const tentRef = useRef<(Tent & { tent_houses?: any }) | null>(null);
  const recordsRef = useRef<Record<string, DailyRecord[]>>({});
  const strictStreaksRef = useRef<Record<string, StrictStreakData>>({});
  const quotesRef = useRef<DailyQuoteFeedItem[]>([]);
  const narrativeRef = useRef<DailyNarrative | null>(null);

  const today = getTodayISODate();
  const dayType = getDayType(new Date());

  const loadOwnStats = useCallback(() => {
    if (!profile) return Promise.resolve();
    if (statsRequestRef.current) return statsRequestRef.current;
    const request = (async () => {
      const [protection, toolbarStats, ownLedger] = await Promise.allSettled([
        fetchStreakProtectionState(),
        fetchReliableToolbarStats(profile.id),
        fetchLedgerEntries(profile.id, 80),
      ]);
      if (protection.status === 'fulfilled') setStreakProtection(protection.value);
      if (toolbarStats.status === 'fulfilled') {
        const resolvedStreak = Number(toolbarStats.value.current_streak) || 0;
        setSentryStreak((previous) => {
          if (hasLoadedRef.current && resolvedStreak > previous) setStreakCelebration(resolvedStreak);
          return resolvedStreak;
        });
        setSentryDenarii(Number(toolbarStats.value.total_denarii) || 0);
        setSentryMarks(Number(toolbarStats.value.marks) || 0);
      }
      if (ownLedger.status === 'fulfilled') setSentryLedger(ownLedger.value);
    })();
    const shared = request.finally(() => {
      if (statsRequestRef.current === shared) statsRequestRef.current = null;
    });
    statsRequestRef.current = shared;
    return shared;
  }, [profile]);

  const loadMemberData = useCallback((targetTent: (Tent & { tent_houses?: any }) | null = tentRef.current) => {
    if (!targetTent) return Promise.resolve();
    if (memberRequestRef.current) return memberRequestRef.current;
    const request = (async () => {
      const memberResponse = await supabase
        .from('tent_members')
        .select('*, profiles(id,display_name,avatar_url,created_at)')
        .eq('tent_id', targetTent.id)
        .eq('role', 'cadet')
        .order('joined_at');
      if (memberResponse.error) throw memberResponse.error;
      const nextMembers = (memberResponse.data || []) as (TentMember & { profiles: Profile })[];
      setMembers(nextMembers);

      const memberIds = nextMembers.map((member) => member.user_id);
      if (memberIds.length === 0) {
        recordsRef.current = {};
        strictStreaksRef.current = {};
        setAllRecords({});
        setStrictStreaks({});
        return;
      }

      const [recordsResult, streakResult] = await Promise.allSettled([
        supabase.from('daily_records').select('*').in('user_id', memberIds).order('record_date', { ascending: true }),
        fetchPublicStreakDetails(memberIds),
      ]);
      let recordsMap: Record<string, DailyRecord[]> = Object.fromEntries(
        memberIds.map((id) => [id, recordsRef.current[id] || []]),
      );
      if (recordsResult.status === 'fulfilled' && !recordsResult.value.error) {
        recordsMap = Object.fromEntries(memberIds.map((id) => [id, []]));
        for (const record of (recordsResult.value.data || []) as DailyRecord[]) recordsMap[record.user_id]?.push(record);
        recordsRef.current = recordsMap;
        setAllRecords(recordsMap);
      }

      const visibleStreaks = streakResult.status === 'fulfilled' ? streakResult.value : {};
      const streakMap: Record<string, StrictStreakData> = {};
      for (const userId of memberIds) {
        const local = computeStreak(recordsMap[userId] || []);
        const previous = strictStreaksRef.current[userId];
        const authoritative = visibleStreaks[userId];
        streakMap[userId] = authoritative || previous || {
          current_streak: local.current_streak,
          longest_streak: local.longest_streak,
          consecutive_inactive: local.consecutive_inactive,
          cumulative_inactive: local.cumulative_inactive,
        };
      }
      strictStreaksRef.current = streakMap;
      setStrictStreaks(streakMap);
    })().catch((error) => console.warn('Sentry member history could not load:', error));
    const shared = request.finally(() => {
      if (memberRequestRef.current === shared) memberRequestRef.current = null;
    });
    memberRequestRef.current = shared;
    return shared;
  }, []);

  const refreshSocialStats = useCallback((quoteFeed = quotesRef.current, activeNarrative = narrativeRef.current) => {
    if (!profile) return Promise.resolve();
    if (socialRequestRef.current) return socialRequestRef.current;
    const request = (async () => {
      const [quoteResult, verseResult] = await Promise.allSettled([
        quoteFeed.length ? fetchDailyQuoteReactions(quoteFeed, profile.id) : Promise.resolve({}),
        activeNarrative?.verse_of_day
          ? fetchDailyVerseReactions([activeNarrative.narrative_date], profile.id)
          : Promise.resolve({}),
      ]);
      if (quoteResult.status === 'fulfilled') setQuoteReactions(quoteResult.value as Record<string, QuoteReactionState>);
      if (verseResult.status === 'fulfilled') setVerseReactions(verseResult.value as Record<string, QuoteReactionState>);
    })();
    const shared = request.finally(() => {
      if (socialRequestRef.current === shared) socialRequestRef.current = null;
    });
    socialRequestRef.current = shared;
    return shared;
  }, [profile]);

  const loadOverview = useCallback(async () => {
    if (!profile) return;
    const coreRequest = Promise.allSettled([
      supabase.from('tent_members').select('tent_id').eq('user_id', profile.id).maybeSingle(),
      supabase.from('tents').select('*, tent_houses(*)').eq('sentry_id', profile.id).maybeSingle(),
      fetchDailyQuoteFeed(12),
      fetchNarrative(today),
    ]);
    const secondaryRequest = Promise.allSettled([
      fetchActiveFcxExperience(),
      getSubscriptionStatus(profile.id),
      fetchAnnouncements(['all', 'cadets', 'sentries']),
      fetchPanelImageSettings([
        'welcome', 'fcx', 'honors', 'verse', 'quiz', 'quote', 'sentry_overview', 'recent_denarii', 'announcement',
        'morning_call', 'midday_reminder', 'evening_reminder', 'daily_game_reminder', 'weekly_quiz_reminder',
      ], ['all', 'cadets', 'sentries']),
    ]);

    const [memberPointer, ownedTent, quoteFeed, sentryNarrative] = await coreRequest;
    let sentryTent = tentRef.current;
    let tentWasConfirmed = false;
    const ownedTentLookupSucceeded = ownedTent.status === 'fulfilled' && !ownedTent.value.error;
    if (ownedTentLookupSucceeded && ownedTent.value.data) {
      sentryTent = ownedTent.value.data as (Tent & { tent_houses?: any });
      tentWasConfirmed = true;
    }
    if (memberPointer.status === 'fulfilled' && !memberPointer.value.error) {
      if (memberPointer.value.data?.tent_id) {
        const pointedTent = await supabase
          .from('tents')
          .select('*, tent_houses(*)')
          .eq('id', memberPointer.value.data.tent_id)
          .maybeSingle();
        if (!pointedTent.error) {
          sentryTent = pointedTent.data as (Tent & { tent_houses?: any }) | null;
          tentWasConfirmed = true;
        }
      } else if (ownedTentLookupSucceeded) {
        sentryTent = null;
        tentWasConfirmed = true;
      }
    }
    if (tentWasConfirmed) {
      tentRef.current = sentryTent;
      setTent(sentryTent);
      if (sentryTent) void loadMemberData(sentryTent);
      else {
        recordsRef.current = {};
        strictStreaksRef.current = {};
        setMembers([]);
        setAllRecords({});
        setStrictStreaks({});
      }
    }

    const activeQuotes = quoteFeed.status === 'fulfilled' ? quoteFeed.value : quotesRef.current;
    if (quoteFeed.status === 'fulfilled') {
      quotesRef.current = activeQuotes;
      setQuotes(activeQuotes);
    }
    const activeNarrative = sentryNarrative.status === 'fulfilled' ? sentryNarrative.value : narrativeRef.current;
    if (sentryNarrative.status === 'fulfilled') {
      narrativeRef.current = activeNarrative;
      setNarrative(activeNarrative);
    }
    void refreshSocialStats(activeQuotes, activeNarrative);

    void secondaryRequest.then(([activeFcx, subscription, sentryAnnouncements, sentryPanelImages]) => {
      if (activeFcx.status === 'fulfilled') setFcxExperience(activeFcx.value);
      if (subscription.status === 'fulfilled') setSubStatus(subscription.value);
      if (sentryAnnouncements.status === 'fulfilled') setAnnouncements(sentryAnnouncements.value);
      if (sentryPanelImages.status === 'fulfilled') setPanelImages(sentryPanelImages.value);
    });
  }, [loadMemberData, profile, refreshSocialStats, today]);

  const load = useCallback(() => {
    if (!profile) { setLoading(false); return Promise.resolve(); }
    if (loadRequestRef.current) return loadRequestRef.current;
    if (!hasLoadedRef.current) setLoading(true);
    const request = (async () => {
      const statsRequest = loadOwnStats();
      await loadOverview();
      hasLoadedRef.current = true;
      setLoading(false);
      void statsRequest;
    })().catch((error) => {
      console.error('Sentry load error:', error);
      hasLoadedRef.current = true;
      setLoading(false);
    });
    const shared = request.finally(() => {
      if (loadRequestRef.current === shared) loadRequestRef.current = null;
    });
    loadRequestRef.current = shared;
    return shared;
  }, [loadOverview, loadOwnStats, profile]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (profile?.id) void supabase.rpc('process_automatic_sentry_promotion', { p_user_id: profile.id });
  }, [profile?.id]);
  const isExpired = subscriptionIsExpired(subStatus, subscriptionClock);
  useEffect(() => {
    const interval = window.setInterval(() => setSubscriptionClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const handleNavigate = useCallback((next: Tab) => {
    setTab(isExpired && PREMIUM_TABS.has(next) ? 'subscribe' : next);
  }, [isExpired]);
  const navigateFromAction = useCallback((key: string) => {
    const destination: Record<string, Tab> = { dashboard: 'overview', narrative: 'reading', game: 'game', arena: 'arena', quiz: 'quiz', streak: 'streak', leaderboard: 'leaderboard', awards: 'awards', store: 'store', tent: 'cadets', challenges: 'challenges', subscribe: 'subscribe' };
    if (destination[key]) handleNavigate(destination[key]);
  }, [handleNavigate]);
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<AppNavigationDetail>).detail;
      if (detail?.actionKey) navigateFromAction(detail.actionKey);
    };
    window.addEventListener(APP_NAVIGATION_EVENT, navigate);
    return () => window.removeEventListener(APP_NAVIGATION_EVENT, navigate);
  }, [navigateFromAction]);
  useEffect(() => {
    if (isExpired && PREMIUM_TABS.has(tab)) setTab('subscribe');
  }, [isExpired, tab]);
  useEffect(() => {
    if (!profile) return;
    const refreshVisibleStats = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastForegroundRefreshRef.current < 15_000) return;
      lastForegroundRefreshRef.current = now;
      void load();
    };
    let memberRefreshTimer: number | null = null;
    let socialRefreshTimer: number | null = null;
    const scheduleMemberRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (memberRefreshTimer !== null) window.clearTimeout(memberRefreshTimer);
      memberRefreshTimer = window.setTimeout(() => {
        void Promise.allSettled([loadOwnStats(), loadMemberData()]);
      }, 180);
    };
    const scheduleSocialRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (socialRefreshTimer !== null) window.clearTimeout(socialRefreshTimer);
      socialRefreshTimer = window.setTimeout(() => { void refreshSocialStats(); }, 120);
    };
    const statsInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void Promise.allSettled([loadOwnStats(), loadMemberData()]);
      }
    }, 60_000);
    const contentInterval = window.setInterval(refreshVisibleStats, 2 * 60_000);
    document.addEventListener('visibilitychange', refreshVisibleStats);
    window.addEventListener('focus', refreshVisibleStats);
    window.addEventListener('online', refreshVisibleStats);
    window.addEventListener('full-circle-wallet-refresh', loadOwnStats);
    const channel = supabase
      .channel(`sentry_topbar_${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'denarii_ledger_entries', filter: `user_id=eq.${profile.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          announceDenariiGain(Number((payload.new as { amount?: number }).amount) || 0);
        }
        void loadOwnStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_records' }, scheduleMemberRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'streak_freezers', filter: `user_id=eq.${profile.id}` }, () => { void loadOwnStats(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_quote_reactions' }, scheduleSocialRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_quote_comments' }, scheduleSocialRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_verse_reactions' }, scheduleSocialRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_verse_comments' }, scheduleSocialRefresh)
      .subscribe();
    return () => {
      document.removeEventListener('visibilitychange', refreshVisibleStats);
      window.removeEventListener('focus', refreshVisibleStats);
      window.removeEventListener('online', refreshVisibleStats);
      window.removeEventListener('full-circle-wallet-refresh', loadOwnStats);
      if (memberRefreshTimer !== null) window.clearTimeout(memberRefreshTimer);
      if (socialRefreshTimer !== null) window.clearTimeout(socialRefreshTimer);
      window.clearInterval(statsInterval);
      window.clearInterval(contentInterval);
      supabase.removeChannel(channel);
    };
  }, [load, loadMemberData, loadOwnStats, profile, refreshSocialStats]);

  const markAttendance = async (cadetId: string, status: 'present' | 'absent') => {
    if (!profile) return;
    const { data, error } = await supabase.rpc('mark_cadet_attendance', {
      p_sentry_id: profile.id,
      p_cadet_id: cadetId,
      p_record_date: today,
      p_status: status,
    });
    if (error) throw error;
    await Promise.allSettled([loadOwnStats(), loadMemberData()]);
    return data;
  };

  const uploadTentPhoto = async (file: File) => {
    if (!profile || !tent) return;
    setUploadingTentPhoto(true);
    try {
      await uploadTentProfileImage(profile.id, tent.id, file);
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to upload tent picture.');
    }
    setUploadingTentPhoto(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <Loader2 size={28} className="animate-spin text-brass" />
    </div>
  );

  const atRiskCount = members.filter((m) => {
    const streak = streakForMember(m.user_id, allRecords, strictStreaks);
    return streak.removal_state === 'at_risk' || streak.removal_state === 'flagged';
  }).length;

  const todayMarked = members.filter((m) => {
    const recs = allRecords[m.user_id] || [];
    const todayRec = recs.find((r) => r.record_date === today);
    return todayRec?.attendance_status === 'present' || todayRec?.attendance_status === 'absent';
  }).length;
  const tabLabels: Record<Tab, string> = {
    overview: 'Sentry Overview',
    attendance: 'Mark Attendance',
    cadets: 'My Cadets',
    challenges: 'Challenge Review',
    reading: "Today's Reading",
    games: 'Daily Games',
    game: 'Daily Trivia',
    arena: 'Arena',
    story: 'Story Mode',
    streak: 'My Streak',
    quiz: 'Weekly Quiz',
    leaderboard: 'Challenge Boards',
    awards: 'Awards Hub',
    store: 'The Market',
    subscribe: 'Subscription',
    settings: 'Settings',
  };

  return (
    <SubscriptionAccessProvider isExpired={isExpired} onSubscriptionRequired={() => setTab('subscribe')}>
    <>
    <AppShell
      navItems={NAV_ITEMS}
      activeKey={tab}
      navActiveKey={dailyGamesNavigationKey(tab)}
      onNavigate={(k) => handleNavigate(k as Tab)}
      headerTitle={tabLabels[tab]}
      headerSubtitle={tent ? undefined : 'No tent assigned yet'}
      rightHeader={
        <div className="flex items-center gap-1.5">
          {isExpired && (
            <button onClick={() => setTab('subscribe')} className="flex items-center gap-1.5 rounded-full border border-coral/30 bg-coral-soft px-3 py-1.5 text-xs font-medium text-coral transition-colors hover:bg-coral/10">
              <Lock size={14} /> Subscribe
            </button>
          )}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-coral-soft border border-coral/30" title={`${sentryStreak} day streak`}>
            <StreakStatusIcon protection={streakProtection} />
            <span className="font-display font-bold text-coral text-[13px]">{sentryStreak}</span>
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-border-bright bg-surface-2" title={`${sentryMarks.toLocaleString(undefined, { maximumFractionDigits: 2 })} Marks`}>
            <ChiRhoMark size={14} className="text-peri-2" />
            <span className="font-display text-[13px] font-bold text-peri-2">
              {sentryMarks.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          <NotificationCenter onNavigate={navigateFromAction} />
          <div data-denarii-target className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-peri-soft border border-border-bright" title={`${sentryDenarii.toLocaleString()} Denarii`}>
            <Coins size={16} className="text-gold" />
            <span className="font-display font-bold text-gold text-[13px]">
              {sentryDenarii >= 1000 ? `${(sentryDenarii / 1000).toFixed(1)}K` : sentryDenarii}
            </span>
          </div>
          {tent?.tent_house_id ? <TentHouseBadge houseId={tent.tent_house_id} size="sm" /> : null}
        </div>
      }
    >
      {!tent && TENT_REQUIRED_TABS.has(tab) && <UnassignedSentryState activeTab={tab} onNavigate={handleNavigate} />}
      {tent && tab === 'overview' && (
        <SentryOverview
          tent={tent}
          members={members}
          allRecords={allRecords}
          strictStreaks={strictStreaks}
          atRiskCount={atRiskCount}
          todayMarked={todayMarked}
          quotes={quotes}
          narrative={narrative}
          fcxExperience={fcxExperience}
          quoteReactions={quoteReactions}
          verseReactions={verseReactions}
          reactingQuote={reactingQuote}
          reactingVerse={reactingVerse}
          currentUserId={profile?.id || null}
          panelImages={panelImages}
          announcements={announcements}
          ledger={sentryLedger}
          denariiTotal={sentryDenarii}
          onReactQuote={async (quote, reactionType) => {
            if (!profile) return;
            const key = `${quote.user_id}:${quote.record_date}`;
            const previousReactions = quoteReactions;
            setReactingQuote(`${key}:${reactionType}`);
            setQuoteReactions((current) => updateReactionOptimistically(current, key, reactionType, true, {
              user_id: profile.id,
              display_name: profile.display_name,
              avatar_url: profile.avatar_url || null,
            }));
            try {
              await reactToDailyQuote(quote.user_id, quote.record_date, profile.id, reactionType);
              const reactions = await fetchDailyQuoteReactions(quotes, profile.id).catch(() => null);
              if (reactions) setQuoteReactions(reactions as Record<string, QuoteReactionState>);
            } catch (e: any) {
              setQuoteReactions(previousReactions);
              alert(e.message || 'Could not react to quote.');
            }
            setReactingQuote(null);
          }}
          onReactVerse={async (narrativeDate, reactionType) => {
            if (!profile) return;
            const previousReactions = verseReactions;
            setReactingVerse(`${narrativeDate}:${reactionType}`);
            setVerseReactions((current) => updateReactionOptimistically(current, narrativeDate, reactionType, true, {
              user_id: profile.id,
              display_name: profile.display_name,
              avatar_url: profile.avatar_url || null,
            }));
            try {
              await reactToDailyVerse(narrativeDate, profile.id, reactionType);
              const reactions = await fetchDailyVerseReactions([narrativeDate], profile.id).catch(() => null);
              if (reactions) setVerseReactions(reactions as Record<string, QuoteReactionState>);
            } catch (e: any) {
              setVerseReactions(previousReactions);
              alert(e.message || 'Could not react to verse.');
            }
            setReactingVerse(null);
          }}
          onNavigate={handleNavigate}
          onUploadTentPhoto={uploadTentPhoto}
          uploadingTentPhoto={uploadingTentPhoto}
        />
      )}
      {tent && tab === 'attendance' && <SentryAttendance members={members} allRecords={allRecords} strictStreaks={strictStreaks} today={today} dayType={dayType} onMark={markAttendance} currentUserId={profile!.id} tentId={tent.id} />}
      {tent && tab === 'cadets' && <SentryCadets members={members} allRecords={allRecords} strictStreaks={strictStreaks} currentUserId={profile!.id} tentId={tent.id} onChanged={load} />}
      {tent && tab === 'challenges' && <SentryChallengeReview sentryId={profile!.id} onRefresh={load} />}
      {tab === 'reading' && <CadetNarrative onMeditationSaved={load} />}
      {tab === 'games' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : (
        <DailyGamesHub
          onOpenTrivia={() => handleNavigate('game')}
          onOpenArena={() => handleNavigate('arena')}
          onOpenStory={() => handleNavigate('story')}
        />
      ))}
      {tab === 'game' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <CadetGame onRewardEarned={load} onBackToDailyGames={() => handleNavigate('games')} />)}
      {tab === 'arena' && (
        isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : (
          <CadetArena onBalanceChanged={load} onBackToDailyGames={() => handleNavigate('games')} />
        )
      )}
      {tab === 'story' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <StoryModeShell onBackToDailyGames={() => handleNavigate('games')} />)}
      {tab === 'streak' && <CadetStreak />}
      {tab === 'quiz' && (
        isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : (
          <CadetQuiz onQuizSubmitted={load} />
        )
      )}
      {tab === 'leaderboard' && (isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : <CadetLeaderboard allowAudienceSwitch />)}
      {tab === 'awards' && (
        isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : (
          <CadetAwards />
        )
      )}
      {tab === 'store' && (
        isExpired ? <SubscriptionGate onSubscribe={() => setTab('subscribe')} /> : (
          <CadetStore
            onBalanceChanged={load}
            giftRecipients={members.map((member) => ({
              id: member.user_id,
              name: member.profiles?.display_name || 'Cadet',
            }))}
          />
        )
      )}
      {tab === 'subscribe' && (
        <SubscriptionScreen
          subStatus={subStatus}
          onActivated={async (status) => {
            setSubStatus(status);
            await load();
            setTab('overview');
          }}
        />
      )}
      {tab === 'settings' && <SettingsScreen onSignOut={signOut} />}
    </AppShell>
    <DoveNotificationArrival onNavigate={navigateFromAction} />
    <StreakCelebration streak={streakCelebration} onDone={() => setStreakCelebration(null)} />
    </>
    </SubscriptionAccessProvider>
  );
}

function UnassignedSentryState({ activeTab, onNavigate }: {
  activeTab: Tab;
  onNavigate: (tab: Tab) => void;
}) {
  const title = activeTab === 'overview' ? 'Sentry portal ready' : 'No tent assigned';
  const message = activeTab === 'overview'
    ? 'Your personal tools are available now. Attendance and cadet management will unlock once an instructor assigns you to a tent.'
    : 'This section needs an assigned tent. You can still use your personal reading, game, streak, and settings.';

  return (
    <div className="space-y-5 animate-fade-in">
      <EmptyState icon={TentIcon} title={title} message={message} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <button onClick={() => onNavigate('reading')} className="btn-secondary">
          <CadetIcon size={18} /> Reading
        </button>
        <button onClick={() => onNavigate('games')} className="btn-secondary">
          <GamepadIcon size={18} /> Daily Games
        </button>
        <button onClick={() => onNavigate('arena')} className="btn-secondary">
          <Swords size={18} /> Arena
        </button>
        <button onClick={() => onNavigate('streak')} className="btn-secondary">
          <Shield size={18} /> Streak
        </button>
        <button onClick={() => onNavigate('quiz')} className="btn-secondary">
          <FileQuestion size={18} /> Weekly Quiz
        </button>
        <button onClick={() => onNavigate('settings')} className="btn-secondary">
          <SettingsIcon size={18} /> Settings
        </button>
      </div>
    </div>
  );
}

function SentryOverview({ tent, members, allRecords, strictStreaks, atRiskCount, todayMarked, quotes, narrative, fcxExperience, quoteReactions, verseReactions, reactingQuote, reactingVerse, currentUserId, panelImages, announcements, ledger, denariiTotal, onReactQuote, onReactVerse, onNavigate, onUploadTentPhoto, uploadingTentPhoto }: {
  tent: Tent & { tent_houses?: any };
  members: (TentMember & { profiles: Profile })[];
  allRecords: Record<string, DailyRecord[]>;
  strictStreaks: Record<string, StrictStreakData>;
  atRiskCount: number;
  todayMarked: number;
  quotes: DailyQuoteFeedItem[];
  narrative: DailyNarrative | null;
  fcxExperience: FcxExperience | null;
  quoteReactions: Record<string, QuoteReactionState>;
  verseReactions: Record<string, QuoteReactionState>;
  reactingQuote: string | null;
  reactingVerse: string | null;
  currentUserId: string | null;
  panelImages: Record<string, PanelImageSetting>;
  announcements: ScheduledAnnouncement[];
  ledger: DenariiLedgerEntry[];
  denariiTotal: number;
  onReactQuote: (quote: DailyQuoteFeedItem, reactionType: string) => void;
  onReactVerse: (narrativeDate: string, reactionType: string) => void;
  onNavigate: (tab: Tab) => void;
  onUploadTentPhoto: (file: File) => Promise<void>;
  uploadingTentPhoto: boolean;
}) {
  const [showTentChat, setShowTentChat] = useState(false);
  const [tentUnreadCount, setTentUnreadCount] = useState(0);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [heroHeld, setHeroHeld] = useState(false);
  const [monthlyHonors, setMonthlyHonors] = useState<AwardWithRecipient[]>([]);
  const [cadetQuizPodium, setCadetQuizPodium] = useState<WeeklyQuizRanking[]>([]);
  const [sentryQuizPodium, setSentryQuizPodium] = useState<WeeklyQuizRanking[]>([]);
  const tentPhotoInputRef = useRef<HTMLInputElement>(null);
  const dayType = getDayType(new Date());
  const todayDate = new Date();
  const today = getTodayISODate();
  const todayDenarii = ledger
    .filter((entry) => entry.created_at.startsWith(today))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const recentLedger = ledger.slice(0, 5);

  useEffect(() => {
    if (!currentUserId || !tent.id) return;
    let cancelled = false;
    const loadTentUnread = async () => {
      const { data } = await supabase
        .from('user_notifications')
        .select('id,metadata')
        .eq('recipient_id', currentUserId)
        .eq('action_key', 'tent')
        .is('read_at', null);
      if (cancelled) return;
      setTentUnreadCount((data || []).filter((item: any) => item.metadata?.tent_id === tent.id).length);
    };
    void loadTentUnread();
    const channel = supabase
      .channel(`sentry_tent_unread_${currentUserId}_${tent.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${currentUserId}` }, () => void loadTentUnread())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [currentUserId, tent.id]);

  useEffect(() => {
    let cancelled = false;
    void fetchAwards()
      .then((awards) => {
        if (!cancelled) setMonthlyHonors(awards.filter((award) => award.award_month.slice(0, 7) === today.slice(0, 7)).slice(0, 10));
      })
      .catch(() => { if (!cancelled) setMonthlyHonors([]); });
    return () => { cancelled = true; };
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    const loadPodium = () => {
      void Promise.all([
        fetchLatestWeeklyQuizRankings(undefined, 'cadet'),
        fetchLatestWeeklyQuizRankings(undefined, 'sentry'),
      ])
        .then(([cadetRankings, sentryRankings]) => {
          if (cancelled) return;
          setCadetQuizPodium(cadetRankings);
          setSentryQuizPodium(sentryRankings);
        })
        .catch(() => undefined);
    };
    loadPodium();
    const interval = window.setInterval(loadPodium, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const chargeContent = (
    <div className="flex min-h-[150px] w-full flex-col justify-between gap-5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3.5 sm:gap-4">
        <div className="relative shrink-0">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-white/35 bg-navy-2/60 shadow-lg backdrop-blur-md sm:h-20 sm:w-20">
            {tent.profile_image_url ? (
              <img src={tent.profile_image_url} alt={`${tent.name} profile`} className="h-full w-full object-cover" />
            ) : (
              <Shield size={30} className="text-gold" />
            )}
          </div>
          <button
            onClick={() => tentPhotoInputRef.current?.click()}
            disabled={uploadingTentPhoto}
            className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border border-brass/30 bg-brass text-ink shadow-sm disabled:opacity-60"
            title="Upload tent profile picture"
          >
            {uploadingTentPhoto ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          </button>
        </div>
        <div className="min-w-0 text-shadow-sm">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-gold/35 bg-navy-2/55 px-2 py-1 text-[9px] font-black uppercase text-gold backdrop-blur-md">
              <Shield size={11} /> Sentry
            </span>
            <span className="text-[10px] font-bold uppercase text-stone">Your Charge</span>
          </div>
          <h2 className="truncate font-display text-xl font-black text-ink sm:text-2xl">{tent.name}</h2>
          <p className="mt-1 truncate text-xs font-semibold text-stone sm:text-sm">{tent.tent_houses?.name} · {members.length} cadets</p>
          <p className="mt-2 text-xs font-medium text-ink/85">Lead with vigilance, truth, and care.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:max-w-[230px] sm:justify-end">
        <span className="overview-glass-button pointer-events-none text-[10px] font-bold text-ink">
          <Snowflake size={13} className="text-peri-2" /> 3 Freezers weekly
        </span>
        <span className="overview-glass-button pointer-events-none text-[10px] font-bold text-ink">
          <Trophy size={13} className="text-gold" /> 3 Master&apos;s Rewards
        </span>
        {currentUserId && (
          <button
            type="button"
            onClick={() => setShowTentChat(true)}
            className="overview-glass-button btn-secondary relative text-xs"
          >
            <Users size={12} /> Tent Chat
            {tentUnreadCount > 0 && (
              <span className="notification-badge-ring absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 bg-coral px-1 text-[9px] font-bold leading-none text-white shadow-sm">
                {tentUnreadCount > 9 ? '9+' : tentUnreadCount}
              </span>
            )}
          </button>
        )}
        {tent.tent_house_id && <TentHouseBadge houseId={tent.tent_house_id} size="md" />}
      </div>
    </div>
  );

  const heroSlides: DashboardHeroSlide[] = [
    {
      id: 'sentry-charge',
      kind: 'custom',
      content: chargeContent,
      image: panelImages.sentry_overview || null,
      veilClassName: 'welcome-first-slide-veil',
    },
    ...(cadetQuizPodium.length ? [{ id: `quiz-podium-cadets-${cadetQuizPodium[0].quiz_session_id}`, kind: 'quiz_podium' as const, rankings: cadetQuizPodium.slice(0, 3), division: 'Cadets' as const }] : []),
    ...(sentryQuizPodium.length ? [{ id: `quiz-podium-sentries-${sentryQuizPodium[0].quiz_session_id}`, kind: 'quiz_podium' as const, rankings: sentryQuizPodium.slice(0, 3), division: 'Sentries' as const }] : []),
    ...(fcxExperience ? [{ id: `fcx-${fcxExperience.id}`, kind: 'fcx' as const, experience: fcxExperience }] : []),
    ...(monthlyHonors.length ? [{ id: `honors-${today.slice(0, 7)}`, kind: 'honors' as const, awards: monthlyHonors }] : []),
    ...(narrative?.verse_of_day ? [{ id: `verse-${narrative.narrative_date}`, kind: 'verse' as const, narrative }] : []),
    ...announcements.filter((announcement) =>
      !announcement.announcement_type?.startsWith('panel_image_')
      && !announcement.announcement_type?.startsWith('sound_')
      && announcement.announcement_type !== 'weekly_background',
    ).map((announcement) => ({
      id: `announcement-${announcement.id}`,
      kind: 'announcement' as const,
      announcement,
    })),
    ...quotes.map((quote) => ({
      id: `quote-${quote.user_id}-${quote.record_date}`,
      kind: 'quote' as const,
      quote,
    })),
  ];

  useAutoAdvance(heroSlides.length > 1 && !heroPaused && !heroHeld, () => {
    setHeroIndex((index) => index + 1);
  });

  return (
    <div className="space-y-5 animate-fade-in">
      <DashboardHeroSlideshow
        slides={heroSlides}
        profileName="Sentry"
        dayType={dayType}
        todayDate={todayDate}
        tentHouseId={tent.tent_house_id || null}
        currentUserId={currentUserId}
        count={heroSlides.length}
        index={heroIndex}
        panelImages={panelImages}
        quoteReactions={quoteReactions}
        verseReactions={verseReactions}
        reactingQuote={reactingQuote}
        reactingVerse={reactingVerse}
        onReactQuote={onReactQuote}
        onReactVerse={onReactVerse}
        onPrev={() => setHeroIndex((index) => index - 1)}
        onNext={() => setHeroIndex((index) => index + 1)}
        onCommentOpenChange={setHeroPaused}
        onHoldChange={setHeroHeld}
      />
      <input
        ref={tentPhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) await onUploadTentPhoto(file);
        }}
      />
      {showTentChat && currentUserId && (
        <TentGroupMessenger
          tentId={tent.id}
          senderId={currentUserId}
          tentName={tent.name}
          onClose={() => setShowTentChat(false)}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Cadets" value={members.length} color="#C9A227" />
        <StatCard icon={UserCheck} label="Marked Today" value={todayMarked} sublabel={`of ${members.length}`} color="#6B8E5A" />
        <StatCard icon={AlertTriangle} label="At Risk" value={atRiskCount} sublabel="need attention" color="#B8553E" />
        <StatCard icon={Sunrise} label="Day Type" value={dayType === 'saturday' ? 'Quiz' : dayType === 'sunday' ? 'Rest' : 'Weekday'} color="#9A8B72" />
      </div>

      <div className="card relative overflow-hidden p-4">
        <PanelImageBackdrop image={panelImages.recent_denarii} />
        <div className="relative">
          <SectionHeader title="Recent Denarii" subtitle={`${formatDenarii(denariiTotal)} total · ${todayDenarii >= 0 ? '+' : ''}${formatDenarii(todayDenarii)} today`} />
          {recentLedger.length > 0 ? (
            <div className="space-y-2">
              {recentLedger.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <SealBullet className="text-brass flex-shrink-0" />
                    <span className="truncate text-ink">{entry.description || entry.source_type.replace(/_/g, ' ')}</span>
                  </div>
                  <span className={cn('font-medium flex-shrink-0', entry.amount > 0 ? 'text-moss' : 'text-roman')}>
                    {entry.amount > 0 ? '+' : ''}{formatDenarii(entry.amount)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Coins} title="No Denarii yet" message="Arena wins, quiz rewards, and approved duties will appear here." />
          )}
        </div>
      </div>

      <RecentAwardsPanel onOpen={() => onNavigate('awards')} />

      {atRiskCount > 0 && (
        <div className="card p-4 border-roman/30 bg-surface-2">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-roman" />
            <h3 className="font-display font-semibold text-roman">At-Risk Cadets</h3>
          </div>
          <p className="text-sm text-stone mb-3">These cadets have missed 3+ consecutive days. Intervene before they cross the removal threshold.</p>
          <div className="space-y-2">
            {members.filter((m) => {
              const streak = streakForMember(m.user_id, allRecords, strictStreaks);
              return streak.removal_state === 'at_risk' || streak.removal_state === 'flagged';
            }).map((m) => {
              const streak = streakForMember(m.user_id, allRecords, strictStreaks);
              return (
                <div key={m.user_id} className="flex items-center justify-between p-2.5 rounded-lg bg-bg/60">
                  <span className="text-sm font-medium text-ink flex items-center gap-2">
                    <SealBullet className="text-roman" />
                    {m.profiles.display_name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-medium', streak.removal_state === 'flagged' ? 'text-roman' : 'text-brass')}>
                      {streak.consecutive_inactive} consecutive misses
                    </span>
                    {whatsappUrl(m.profiles.whatsapp_number) && (
                      <a
                        href={whatsappUrl(m.profiles.whatsapp_number)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                        style={{ background: 'rgba(37, 211, 102, 0.12)', color: '#25D366' }}
                        title={`WhatsApp ${m.profiles.display_name}`}
                      >
                        <MessageCircle size={14} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="sentry-overview-actions grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => onNavigate('attendance')} className="btn-primary">
          <ClipboardCheck size={18} /> Mark Attendance
        </button>
        <button onClick={() => onNavigate('games')} className="btn-secondary">
          <GamepadIcon size={18} /> Daily Games
        </button>
        <button onClick={() => onNavigate('quiz')} className={dayType === 'saturday' ? 'btn-primary' : 'btn-secondary'}>
          <FileQuestion size={18} /> {dayType === 'saturday' ? 'Take Weekly Quiz' : 'Weekly Quiz'}
        </button>
        <button onClick={() => onNavigate('awards')} className="btn-secondary">
          <Award size={18} /> Awards Hub
        </button>
      </div>
    </div>
  );
}

function SentryAttendance({ members, allRecords, strictStreaks, today, dayType, onMark, currentUserId, tentId }: {
  members: (TentMember & { profiles: Profile })[];
  allRecords: Record<string, DailyRecord[]>;
  strictStreaks: Record<string, StrictStreakData>;
  today: string;
  dayType: string;
  onMark: (cadetId: string, status: 'present' | 'absent') => Promise<any>;
  currentUserId: string;
  tentId: string;
}) {
  const [markingCadet, setMarkingCadet] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (dayType !== 'weekday') {
    return (
      <EmptyState
        icon={Clock}
        title="No attendance today"
        message={dayType === 'saturday' ? 'Attendance is only marked on weekdays. Saturdays require the quiz instead.' : 'Sunday is the day of rest — no attendance is needed.'}
      />
    );
  }

  const pastCutoff = getAppClock().hour >= ATTENDANCE_CUTOFF_HOUR;
  const attendance = members.map((member) => {
    const records = allRecords[member.user_id] || [];
    const todayRecord = records.find((record) => record.record_date === today);
    return { member, todayRecord, status: todayRecord?.attendance_status || 'unmarked' };
  });
  const awaiting = attendance.filter(({ status }) => status === 'unmarked');
  const marked = attendance.filter(({ status }) => status !== 'unmarked');

  const handleMark = async (member: TentMember & { profiles: Profile }, status: 'present' | 'absent') => {
    setMarkingCadet(member.user_id);
    setFeedback(null);
    try {
      const result = await onMark(member.user_id, status);
      if (status === 'present') {
        setFeedback(`${member.profiles.display_name}: morning call confirmed, +200 Denarii awarded${result?.devotion_submitted ? ', devotion also submitted.' : '. Devotion still needed.'}`);
      } else {
        setFeedback(`${member.profiles.display_name}: marked absent from the morning call.`);
      }
    } catch (e: any) {
      alert(e.message || 'Failed to mark attendance.');
    }
    setMarkingCadet(null);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {pastCutoff && (
        <div className="card p-3 flex items-center gap-2 border-brass/30 bg-surface-2">
          <Clock size={16} className="text-brass" />
          <p className="text-sm text-brass">The 12:00 PM cutoff has passed. Marks recorded now will show as late.</p>
        </div>
      )}

      <div className="card p-4 bg-surface">
        <SectionHeader title="Mark Attendance" subtitle={`${formatShortDate(today)} · Present cadets receive 200 Denarii`} />
        <div className="mb-4 rounded-lg bg-surface-2 border border-border px-3 py-2.5">
          <div className="flex items-center justify-between text-xs text-stone mb-2">
            <span>{marked.length === members.length ? 'Attendance complete' : `${awaiting.length} cadet${awaiting.length === 1 ? '' : 's'} still to mark`}</span>
            <span className="font-semibold text-ink">{marked.length}/{members.length}</span>
          </div>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div className="h-full rounded-full bg-moss transition-all duration-300" style={{ width: `${members.length ? (marked.length / members.length) * 100 : 0}%` }} />
          </div>
        </div>
        {feedback && (
          <div className="mb-3 rounded-lg border border-moss/30 bg-moss/10 px-3 py-2 text-sm text-moss flex items-center gap-2">
            <CheckCircle2 size={15} className="flex-shrink-0" />
            {feedback}
          </div>
        )}
        {awaiting.length > 0 && (
          <div className="space-y-2">
            {awaiting.map(({ member: m }) => {
              const isBusy = markingCadet === m.user_id;
              return (
                <div key={m.user_id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-border bg-surface-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <TentAvatar member={m} currentUserId={currentUserId} tentId={tentId} size="md" />
                    <div className="min-w-0"><p className="text-sm font-medium text-ink truncate">{m.profiles.display_name}</p><p className="text-xs text-stone">Morning call not marked</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:w-48 flex-shrink-0">
                    <button onClick={() => handleMark(m, 'present')} disabled={isBusy} className="btn-primary justify-center text-xs py-2">
                      {isBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Present
                    </button>
                    <button onClick={() => handleMark(m, 'absent')} disabled={isBusy} className="btn-secondary justify-center text-xs py-2 text-roman border-roman/30">
                      <XCircle size={14} /> Absent
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {marked.length > 0 && (
          <div className={cn(awaiting.length > 0 && 'mt-5')}>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone mb-2">Marked today</p>
            <div className="divide-y divide-border rounded-lg border border-border bg-surface-2">
              {marked.map(({ member: m, todayRecord, status }) => {
                const onTime = todayRecord?.attendance_marked_at ? isAttendanceOnTime(new Date(todayRecord.attendance_marked_at)) : true;
                const devotionDone = todayRecord?.meditation_submitted === true;
                const dayComplete = status === 'present' && devotionDone;
                const streak = streakForMember(m.user_id, allRecords, strictStreaks);
                const isBusy = markingCadet === m.user_id;
                return (
                  <div key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                    <TentAvatar member={m} currentUserId={currentUserId} tentId={tentId} size="sm" />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-ink truncate">{m.profiles.display_name}</p><p className="text-xs text-stone truncate">{status === 'present' ? `Present${!onTime ? ' (late)' : ''}${devotionDone ? ' · devotion submitted' : ' · devotion pending'}` : 'Absent'} · Streak {streak.current_streak}{dayComplete ? ' · complete' : ''}</p></div>
                    <button onClick={() => handleMark(m, status === 'present' ? 'absent' : 'present')} disabled={isBusy} className="btn-ghost text-xs px-2 py-1.5 flex-shrink-0">
                      {isBusy ? <Loader2 size={13} className="animate-spin" /> : 'Change'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SentryCadets({ members, allRecords, strictStreaks, currentUserId, tentId, onChanged }: {
  members: (TentMember & { profiles: Profile })[];
  allRecords: Record<string, DailyRecord[]>;
  strictStreaks: Record<string, StrictStreakData>;
  currentUserId: string;
  tentId: string;
  onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [unassigned, setUnassigned] = useState<{ user_id: string; display_name: string; avatar_url: string | null }[]>([]);
  const [selectedCadet, setSelectedCadet] = useState('');
  const [confirmCadet, setConfirmCadet] = useState<{ user_id: string; display_name: string; avatar_url: string | null } | null>(null);
  const [adding, setAdding] = useState(false);

  const loadUnassigned = useCallback(async () => {
    const users = await fetchSentryAddableCadets(currentUserId).catch(() => []);
    setUnassigned(users);
    setSelectedCadet('');
    setConfirmCadet(null);
  }, [currentUserId]);

  useEffect(() => {
    if (showAdd) void loadUnassigned();
  }, [loadUnassigned, showAdd]);

  const addCadet = async () => {
    if (!confirmCadet) return;
    setAdding(true);
    try {
      await sentryAddCadetToTent(currentUserId, confirmCadet.user_id);
      setShowAdd(false);
      setSelectedCadet('');
      setConfirmCadet(null);
      await onChanged();
    } catch (error: any) {
      alert(error.message || 'Could not add cadet to your tent.');
    }
    setAdding(false);
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="card p-4 bg-surface-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display font-semibold text-ink">Tent Cadets</p>
            <p className="text-xs text-stone">Sentries can add unassigned cadets. Only the instructor can remove or move cadets.</p>
          </div>
          <button onClick={() => {
            setShowAdd((value) => !value);
            setSelectedCadet('');
            setConfirmCadet(null);
          }} className="btn-secondary text-xs">
            {showAdd ? <X size={14} /> : <UserPlus size={14} />}
            {showAdd ? 'Close' : 'Add Cadet'}
          </button>
        </div>
        {showAdd && (
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <AppSelect
              value={selectedCadet}
              onChange={setSelectedCadet}
              placeholder={unassigned.length === 0 ? 'No unassigned cadets available' : 'Choose cadet'}
              disabled={unassigned.length === 0}
              buttonClassName="bg-surface text-xs shadow-sm"
              options={unassigned.map((cadet) => ({ value: cadet.user_id, label: cadet.display_name }))}
            />
            <button
              onClick={() => setConfirmCadet(unassigned.find((cadet) => cadet.user_id === selectedCadet) || null)}
              disabled={!selectedCadet || adding}
              className="btn-primary text-xs disabled:opacity-50"
            >
              <UserPlus size={14} />
              Add
            </button>
          </div>
        )}
      </div>
      {confirmCadet && (
        <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/50 px-4 animate-fade-in" onClick={() => !adding && setConfirmCadet(null)}>
          <div className="relative z-[2147483001] w-full max-w-sm rounded-2xl border border-border bg-bg p-5 shadow-2xl animate-scale-in" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center text-sm font-bold text-brass">
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-brass/30 bg-brass-soft">{confirmCadet.avatar_url ? <img src={confirmCadet.avatar_url} alt="" className="h-full w-full object-cover" /> : confirmCadet.display_name.charAt(0)}</span>
                <VallumAvatarBadge userId={confirmCadet.user_id} size="sm" />
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-base font-semibold text-ink">Add {confirmCadet.display_name}?</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone">This will add the cadet to your tent. Only the instructor can undo this or move them later.</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary justify-center text-xs" disabled={adding} onClick={() => setConfirmCadet(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary justify-center text-xs" disabled={adding} onClick={addCadet}>
                {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {members.map((m) => {
        const streak = streakForMember(m.user_id, allRecords, strictStreaks);
        const stateColor = streak.removal_state === 'active' ? '#6B8E5A' : streak.removal_state === 'at_risk' ? '#C9A227' : '#B8553E';
        const StateIcon = streak.removal_state === 'active' ? Shield : AlertTriangle;

        return (
          <div key={m.user_id} className="card p-4 card-hover bg-surface">
            <div className="flex items-center gap-3 mb-3">
              <TentAvatar member={m} currentUserId={currentUserId} tentId={tentId} size="md" />
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-ink flex items-center gap-2">
                  <SealBullet className="text-stone flex-shrink-0" />
                  {m.profiles.display_name}
                </h4>
              </div>
              <span className={cn('badge text-xs', streak.removal_state === 'flagged' ? 'badge-roman' : streak.removal_state === 'at_risk' ? 'badge-brass' : 'badge-moss')}>
                <StateIcon size={12} /> {streak.removal_state.replace('_', ' ')}
              </span>
            </div>
            {whatsappUrl(m.profiles.whatsapp_number) && (
              <a
                href={whatsappUrl(m.profiles.whatsapp_number)!}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary w-full text-sm flex items-center justify-center gap-1.5 mb-3"
                style={{ background: 'rgba(37, 211, 102, 0.10)', borderColor: 'rgba(37, 211, 102, 0.3)', color: '#25D366' }}
              >
                <MessageCircle size={14} /> WhatsApp {m.profiles.display_name.split(' ')[0]}
              </a>
            )}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <p className="font-display text-lg font-semibold text-ink">{streak.current_streak}</p>
                <p className="text-xs text-stone">Current</p>
              </div>
              <div>
                <p className="font-display text-lg font-semibold text-ink">{streak.longest_streak}</p>
                <p className="text-xs text-stone">Longest</p>
              </div>
              <div>
                <p className="font-display text-lg font-semibold text-ink">{streak.volume_this_month}</p>
                <p className="text-xs text-stone">Valid Days</p>
              </div>
              <div>
                <p className="font-display text-lg font-semibold" style={{ color: stateColor }}>{streak.consecutive_inactive}</p>
                <p className="text-xs text-stone">Misses</p>
              </div>
            </div>
          </div>
        );
      })}
      <MeditationHistoryPanel
        userIds={members.map((member) => member.user_id)}
        title="My Cadets’ Meditation History"
        currentUserId={currentUserId}
      />
    </div>
  );
}

function SentryChallengeReview({ sentryId, onRefresh }: { sentryId: string; onRefresh: () => void }) {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSubmissions(await fetchAllChallengeSubmissions(sentryId) || []);
    } catch (error) {
      console.error('Challenge review load error:', error);
      setSubmissions([]);
    }
    setLoading(false);
  }, [sentryId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const channel = supabase
      .channel(`sentry_challenge_review_${sentryId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenge_submissions' }, () => { void load(); })
      .subscribe();
    const interval = window.setInterval(() => { void load(); }, 20_000);
    return () => {
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [load, sentryId]);

  const review = async (id: string, status: 'approved' | 'rejected') => {
    if (status === 'rejected' && !rejectionReason.trim()) return;
    setReviewingId(id);
    try {
      await reviewChallengeSubmission(id, status, status === 'rejected' ? rejectionReason.trim() : null, sentryId);
      setRejectingId(null);
      setRejectionReason('');
      await load();
      onRefresh();
    } catch (error: any) {
      alert(error.message || 'Could not review challenge.');
    }
    setReviewingId(null);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  const pending = submissions.filter((submission) => submission.status === 'pending');
  const reviewed = submissions.filter((submission) => submission.status !== 'pending').slice(0, 8);
  const renderEvidence = (submission: any) => {
    const proofText = String(submission.proof_text || '').trim();
    let parsed: any = null;
    if (proofText.startsWith('{') || proofText.startsWith('[')) {
      try {
        parsed = JSON.parse(proofText);
      } catch {
        parsed = null;
      }
    }
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed?.evidence)
          ? parsed.evidence
          : [];
    const links = (proofText.match(/https?:\/\/\S+/g) || []).map((link) => link.replace(/[),.;\]]+$/, ''));
    const legacyFileOnly = /^\[File:/i.test(proofText) && items.length === 0 && links.length === 0;

    return (
      <div className="mt-3 rounded-2xl border border-border bg-surface/70 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-ink">
          <Eye size={13} /> Verify Evidence
        </p>
        {items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item: any, index: number) => {
              const label = item?.name || item?.title || item?.type || `Evidence ${index + 1}`;
              const url = item?.url || item?.href || item?.link;
              const text = item?.text || item?.body || item?.description;
              return (
                <div key={`${submission.id}_${index}`} className="rounded-xl bg-surface-2/80 p-2 text-sm text-stone">
                  <p className="font-semibold text-ink">{label}</p>
                  {text && <p className="mt-1 whitespace-pre-line">{text}</p>}
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer" download className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-brass/30 bg-brass-soft px-3 py-1.5 text-xs font-bold text-brass hover:border-brass/60 transition-colors">
                      <Eye size={12} /> Open file
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : legacyFileOnly ? (
          <div className="rounded-xl border border-coral/25 bg-coral-soft p-3 text-sm text-coral">
            This file was recorded before secure upload links were saved. Ask the cadet to resubmit the file so you can open it here.
          </div>
        ) : proofText ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-stone">{proofText}</p>
        ) : (
          <p className="text-sm text-stone">No readable evidence text was attached.</p>
        )}
        {links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {links.map((link) => (
              <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="badge badge-royal text-[10px]">
                Open link
              </a>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSubmission = (submission: any, active = false) => (
    <div key={submission.id} className={cn('card p-4', active ? 'border-gold/35' : 'bg-surface-2')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink text-sm truncate">{submission.profiles?.display_name || 'Cadet'}</p>
          <p className="text-xs text-stone">{formatShortDate(submission.narrative_date)} · {submission.proof_type || 'proof'}</p>
        </div>
        <span className={cn('badge text-[10px]', submission.status === 'approved' ? 'badge-moss' : submission.status === 'rejected' ? 'badge-roman' : 'badge-brass')}>
          {submission.status}
        </span>
      </div>
      {renderEvidence(submission)}
      {active && (
        <div className="mt-4 space-y-2">
          {rejectingId === submission.id && (
            <textarea className="input-field min-h-[5rem]" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Reason for rejection" />
          )}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => review(submission.id, 'approved')} disabled={reviewingId === submission.id} className="btn-primary text-xs">
              {reviewingId === submission.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approve
            </button>
            {rejectingId === submission.id ? (
              <button onClick={() => review(submission.id, 'rejected')} disabled={reviewingId === submission.id || !rejectionReason.trim()} className="btn-secondary text-xs text-coral disabled:opacity-50">
                Reject
              </button>
            ) : (
              <button onClick={() => setRejectingId(submission.id)} className="btn-secondary text-xs text-coral">
                <XCircle size={13} /> Reject
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Challenge Review" subtitle="Review evidence submitted by cadets in your tent" />
      {pending.length === 0 && reviewed.length === 0 ? (
        <EmptyState icon={Target} title="No challenge submissions" message="Your cadets’ submitted challenge evidence will appear here as soon as they send it." />
      ) : (
        <>
          <div className="space-y-3">
            <h3 className="font-display font-semibold text-ink text-sm">Pending ({pending.length})</h3>
            {pending.length ? pending.map((submission) => renderSubmission(submission, true)) : <p className="text-xs text-stone">No pending challenges.</p>}
          </div>
          {reviewed.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display font-semibold text-ink text-sm">Recent Reviews</h3>
              {reviewed.map((submission) => renderSubmission(submission))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
