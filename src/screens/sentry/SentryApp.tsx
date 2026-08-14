import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AppShell, StatCard, SectionHeader, EmptyState } from '../../components/AppShell';
import { TentHouseBadge } from '../../components/TentHouseSymbol';
import { SettingsScreen } from '../../components/SettingsScreen';
import { NotificationCenter } from '../../components/NotificationCenter';
import { MeditationHistoryPanel } from '../../components/MeditationHistoryPanel';
import { ScrollEdge, SealBullet } from '../../components/AncientMotifs';
import { QuoteReactions, type QuoteReactionState } from '../../components/QuoteReactions';
import { QuoteAuthorStats } from '../../components/QuoteAuthorStats';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { RecentAwardsPanel } from '../../components/RecentAwardsPanel';
import {
  DashboardIcon, CadetIcon, CalendarIcon, SettingsIcon,
} from '../../components/BrandIcons';
import { supabase } from '../../lib/supabase';
import {
  fetchPanelImageSettings, fetchDailyQuoteFeed, fetchStrictStreak, fetchLedgerTotal, fetchLedgerEntries, uploadTentProfileImage,
  fetchDailyQuoteReactions, reactToDailyQuote, fetchDailyQuoteComments, commentOnDailyQuote, fetchAnnouncements,
  fetchAllChallengeSubmissions, reviewChallengeSubmission, fetchUnassignedUsers, sentryAddCadetToTent,
} from '../../lib/queries';
import { computeStreak, getDayType, getTodayISODate, getAppClock, cn, formatShortDate, getRemovalState, isAttendanceOnTime, whatsappUrl, formatDenarii } from '../../lib/utils';
import { ATTENDANCE_CUTOFF_HOUR } from '../../lib/constants';
import type { Tent, TentMember, Profile, DailyRecord, DailyQuoteFeedItem, StreakInfo, PanelImageSetting, ScheduledAnnouncement, DenariiLedgerEntry } from '../../lib/types';
import { TentAvatar } from '../../components/TentMessenger';
import { CadetGame } from '../cadet/CadetGame';
import { CadetStreak } from '../cadet/CadetStreak';
import { CadetNarrative } from '../cadet/CadetNarrative';
import { CadetStore } from '../cadet/CadetStore';
import { CadetLeaderboard } from '../cadet/CadetLeaderboard';
import {
  AlertTriangle, CheckCircle2, XCircle, Clock, ClipboardCheck,
  UserCheck, Loader2, Sunrise, Tent as TentIcon, MessageCircle, Users, Shield, GamepadIcon,
  Camera, ImagePlus, Quote, ShoppingBag, FileQuestion, Award, Megaphone, Trophy,
  Swords, Flame, Coins, Target, UserPlus, X,
} from 'lucide-react';

const CadetArena = lazy(() => import('../cadet/CadetArena').then((module) => ({ default: module.CadetArena })));
const CadetQuiz = lazy(() => import('../cadet/CadetQuiz').then((module) => ({ default: module.CadetQuiz })));
const CadetAwards = lazy(() => import('../cadet/CadetAwards').then((module) => ({ default: module.CadetAwards })));

type Tab = 'overview' | 'attendance' | 'cadets' | 'challenges' | 'game' | 'arena' | 'reading' | 'streak' | 'quiz' | 'leaderboard' | 'awards' | 'store' | 'settings';

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
  { key: 'game', label: 'Daily Game', icon: GamepadIcon },
  { key: 'arena', label: 'The Arena', icon: Swords },
  { key: 'streak', label: 'My Streak', icon: Shield },
  { key: 'quiz', label: 'Weekly Quiz', icon: FileQuestion },
  { key: 'leaderboard', label: 'Challenge Boards', icon: Trophy },
  { key: 'awards', label: 'Awards Hub', icon: Award },
  { key: 'store', label: 'Market', icon: ShoppingBag },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

function getInitialSentryTab(): Tab {
  if (typeof window === 'undefined') return 'overview';
  const key = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('fc-tab');
  const tabs: Tab[] = ['overview', 'attendance', 'cadets', 'challenges', 'reading', 'game', 'arena', 'streak', 'quiz', 'leaderboard', 'awards', 'store', 'settings'];
  return tabs.includes(key as Tab) ? key as Tab : 'overview';
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
  const [quoteReactions, setQuoteReactions] = useState<Record<string, QuoteReactionState>>({});
  const [reactingQuote, setReactingQuote] = useState<string | null>(null);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [quotePaused, setQuotePaused] = useState(false);
  const [panelImages, setPanelImages] = useState<Record<string, PanelImageSetting>>({});
  const [announcements, setAnnouncements] = useState<ScheduledAnnouncement[]>([]);
  const [sentryStreak, setSentryStreak] = useState(0);
  const [sentryDenarii, setSentryDenarii] = useState(0);
  const [sentryLedger, setSentryLedger] = useState<DenariiLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingTentPhoto, setUploadingTentPhoto] = useState(false);

  const today = getTodayISODate();
  const dayType = getDayType(new Date());

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const [ownStreak, ownDenarii, ownLedger] = await Promise.all([
        fetchStrictStreak(profile.id).catch(() => null),
        fetchLedgerTotal(profile.id).catch(() => 0),
        fetchLedgerEntries(profile.id, 80).catch(() => []),
      ]);
      setSentryStreak(ownStreak?.current_streak || 0);
      setSentryDenarii(ownDenarii);
      setSentryLedger(ownLedger);

      const { data: member } = await supabase
        .from('tent_members')
        .select('tent_id')
        .eq('user_id', profile.id)
        .maybeSingle();

      let sentryTent: (Tent & { tent_houses?: any }) | null = null;

      if (member) {
        const { data: t } = await supabase
          .from('tents')
          .select('*, tent_houses(*)')
          .eq('id', member.tent_id)
          .maybeSingle();
        sentryTent = t as any;
      } else {
        const { data: t } = await supabase
          .from('tents')
          .select('*, tent_houses(*)')
          .eq('sentry_id', profile.id)
          .maybeSingle();
        sentryTent = t as any;
      }

      setTent(sentryTent);

      if (sentryTent) {
        const { data: mems } = await supabase
          .from('tent_members')
          .select('*, profiles(id,display_name,avatar_url,created_at)')
          .eq('tent_id', sentryTent.id)
          .eq('role', 'cadet')
          .order('joined_at');
        setMembers((mems || []) as any);

        const memberIds = (mems || []).map((m) => m.user_id);
        const recordsMap: Record<string, DailyRecord[]> = Object.fromEntries(memberIds.map((id) => [id, []]));
        const streakMap: Record<string, StrictStreakData> = {};
        const [recordsResult, streakResults] = await Promise.all([
          memberIds.length
            ? supabase.from('daily_records').select('*').in('user_id', memberIds).order('record_date', { ascending: true })
            : Promise.resolve({ data: [] as DailyRecord[] }),
          Promise.all(memberIds.map(async (id) => ({ id, data: await fetchStrictStreak(id).catch(() => null) }))),
        ]);
        for (const record of (recordsResult.data || []) as DailyRecord[]) recordsMap[record.user_id]?.push(record);
        for (const result of streakResults) if (result.data) streakMap[result.id] = result.data;
        setAllRecords(recordsMap);
        setStrictStreaks(streakMap);
      } else {
        setMembers([]);
        setAllRecords({});
        setStrictStreaks({});
      }
      const quoteFeed = await fetchDailyQuoteFeed(12).catch(() => []);
      setAnnouncements(await fetchAnnouncements(['all', 'cadets', 'sentries']).catch(() => []));
      setQuotes(quoteFeed);
      const sentryPanelImages = await fetchPanelImageSettings(['quote', 'sentry_overview', 'recent_denarii'], ['all', 'sentries']).catch(() => ({}));
      setPanelImages(sentryPanelImages);
      if (quoteFeed.length > 0) {
        setQuoteReactions(await fetchDailyQuoteReactions(quoteFeed, profile.id).catch(() => ({})) as Record<string, QuoteReactionState>);
      } else {
        setQuoteReactions({});
      }
      setQuoteIndex(0);
    } catch (e) { console.error('Sentry load error:', e); }
    setLoading(false);
  }, [profile]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (quotes.length <= 1 || quotePaused) return;
    const interval = window.setInterval(() => {
      setQuoteIndex((index) => (index + 1) % quotes.length);
    }, 6000);
    return () => window.clearInterval(interval);
  }, [quotePaused, quotes.length]);

  const markAttendance = async (cadetId: string, status: 'present' | 'absent') => {
    if (!profile) return;
    const { data, error } = await supabase.rpc('mark_cadet_attendance', {
      p_sentry_id: profile.id,
      p_cadet_id: cadetId,
      p_record_date: today,
      p_status: status,
    });
    if (error) throw error;
    await load();
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
    game: 'Daily Game',
    arena: 'The Arena',
    streak: 'My Streak',
    quiz: 'Weekly Quiz',
    leaderboard: 'Challenge Boards',
    awards: 'Awards Hub',
    store: 'The Market',
    settings: 'Settings',
  };

  return (
    <AppShell
      navItems={NAV_ITEMS}
      activeKey={tab}
      onNavigate={(k) => setTab(k as Tab)}
      headerTitle={tabLabels[tab]}
      headerSubtitle={tent ? `${tent.name} · ${tent.tent_houses?.name || ''}` : 'No tent assigned yet'}
      rightHeader={
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-coral-soft border border-coral/30" title={`${sentryStreak} day streak`}>
            <Flame size={15} className="text-coral" />
            <span className="font-display font-bold text-coral text-[13px]">{sentryStreak}</span>
          </div>
          <NotificationCenter onNavigate={(key) => {
            const destination: Record<string, Tab> = { dashboard: 'overview', narrative: 'reading', game: 'game', arena: 'arena', quiz: 'quiz', streak: 'streak', leaderboard: 'leaderboard', awards: 'awards', store: 'store', tent: 'cadets', challenges: 'challenges' };
            if (destination[key]) setTab(destination[key]);
          }} />
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-peri-soft border border-border-bright" title={`${sentryDenarii.toLocaleString()} Denarii`}>
            <Coins size={16} className="text-gold" />
            <span className="font-display font-bold text-gold text-[13px]">
              {sentryDenarii >= 1000 ? `${(sentryDenarii / 1000).toFixed(1)}K` : sentryDenarii}
            </span>
          </div>
          {tent?.tent_house_id ? <TentHouseBadge houseId={tent.tent_house_id} size="sm" /> : null}
        </div>
      }
    >
      {!tent && TENT_REQUIRED_TABS.has(tab) && <UnassignedSentryState activeTab={tab} onNavigate={setTab} />}
      {tent && tab === 'overview' && (
        <SentryOverview
          tent={tent}
          members={members}
          allRecords={allRecords}
          strictStreaks={strictStreaks}
          atRiskCount={atRiskCount}
          todayMarked={todayMarked}
          quote={quotes[quoteIndex]}
          quoteCount={quotes.length}
          quoteIndex={quoteIndex}
          quoteReactions={quoteReactions}
          reactingQuote={reactingQuote}
          currentUserId={profile?.id || null}
          panelImages={panelImages}
          announcements={announcements}
          ledger={sentryLedger}
          denariiTotal={sentryDenarii}
          onReactQuote={async (quote, reactionType) => {
            if (!profile) return;
            const key = `${quote.user_id}:${quote.record_date}`;
            setReactingQuote(`${key}:${reactionType}`);
            try {
              await reactToDailyQuote(quote.user_id, quote.record_date, profile.id, reactionType);
              setQuoteReactions(await fetchDailyQuoteReactions(quotes, profile.id).catch(() => quoteReactions) as Record<string, QuoteReactionState>);
            } catch (e: any) {
              alert(e.message || 'Could not react to quote.');
            }
            setReactingQuote(null);
          }}
          onQuotePrev={() => setQuoteIndex((idx) => (idx - 1 + quotes.length) % quotes.length)}
          onQuoteNext={() => setQuoteIndex((idx) => (idx + 1) % quotes.length)}
          onCommentOpenChange={setQuotePaused}
          onNavigate={setTab}
          onUploadTentPhoto={uploadTentPhoto}
          uploadingTentPhoto={uploadingTentPhoto}
        />
      )}
      {tent && tab === 'attendance' && <SentryAttendance members={members} allRecords={allRecords} strictStreaks={strictStreaks} today={today} dayType={dayType} onMark={markAttendance} currentUserId={profile!.id} tentId={tent.id} />}
      {tent && tab === 'cadets' && <SentryCadets members={members} allRecords={allRecords} strictStreaks={strictStreaks} currentUserId={profile!.id} tentId={tent.id} onChanged={load} />}
      {tent && tab === 'challenges' && <SentryChallengeReview sentryId={profile!.id} onRefresh={load} />}
      {tab === 'reading' && <CadetNarrative onMeditationSaved={load} />}
      {tab === 'game' && <CadetGame onRewardEarned={load} />}
      {tab === 'arena' && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-brass" /></div>}>
          <CadetArena onBalanceChanged={load} />
        </Suspense>
      )}
      {tab === 'streak' && <CadetStreak />}
      {tab === 'quiz' && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-brass" /></div>}>
          <CadetQuiz onQuizSubmitted={load} />
        </Suspense>
      )}
      {tab === 'leaderboard' && <CadetLeaderboard />}
      {tab === 'awards' && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-brass" /></div>}>
          <CadetAwards />
        </Suspense>
      )}
      {tab === 'store' && (
        <CadetStore
          onBalanceChanged={load}
          giftRecipients={members.map((member) => ({
            id: member.user_id,
            name: member.profiles?.display_name || 'Cadet',
          }))}
        />
      )}
      {tab === 'settings' && <SettingsScreen onSignOut={signOut} />}
    </AppShell>
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
        <button onClick={() => onNavigate('game')} className="btn-secondary">
          <GamepadIcon size={18} /> Game
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

function SentryOverview({ tent, members, allRecords, strictStreaks, atRiskCount, todayMarked, quote, quoteCount, quoteIndex, quoteReactions, reactingQuote, currentUserId, panelImages, announcements, ledger, denariiTotal, onReactQuote, onQuotePrev, onQuoteNext, onCommentOpenChange, onNavigate, onUploadTentPhoto, uploadingTentPhoto }: {
  tent: Tent & { tent_houses?: any };
  members: (TentMember & { profiles: Profile })[];
  allRecords: Record<string, DailyRecord[]>;
  strictStreaks: Record<string, StrictStreakData>;
  atRiskCount: number;
  todayMarked: number;
  quote?: DailyQuoteFeedItem;
  quoteCount: number;
  quoteIndex: number;
  quoteReactions: Record<string, QuoteReactionState>;
  reactingQuote: string | null;
  currentUserId: string | null;
  panelImages: Record<string, PanelImageSetting>;
  announcements: ScheduledAnnouncement[];
  ledger: DenariiLedgerEntry[];
  denariiTotal: number;
  onReactQuote: (quote: DailyQuoteFeedItem, reactionType: string) => void;
  onQuotePrev: () => void;
  onQuoteNext: () => void;
  onCommentOpenChange: (open: boolean) => void;
  onNavigate: (tab: Tab) => void;
  onUploadTentPhoto: (file: File) => Promise<void>;
  uploadingTentPhoto: boolean;
}) {
  const dayType = getDayType(new Date());
  const today = getTodayISODate();
  const todayDenarii = ledger
    .filter((entry) => entry.created_at.startsWith(today))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const recentLedger = ledger.slice(0, 5);
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="card p-5 bg-surface-2">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-xl overflow-hidden border border-border bg-surface flex items-center justify-center">
                {tent.profile_image_url ? (
                  <img src={tent.profile_image_url} alt={`${tent.name} profile`} className="w-full h-full object-cover" />
                ) : (
                  <TentIcon size={28} className="text-brass" />
                )}
              </div>
              <button
                onClick={() => document.getElementById(`tent-profile-upload-${tent.id}`)?.click()}
                disabled={uploadingTentPhoto}
                className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-brass text-ink border border-brass/30 flex items-center justify-center shadow-sm disabled:opacity-60"
                title="Upload tent profile picture"
              >
                {uploadingTentPhoto ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
              <input
                id={`tent-profile-upload-${tent.id}`}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) await onUploadTentPhoto(file);
                }}
              />
            </div>
            <div className="min-w-0">
              <p className="eyebrow text-stone">Your Charge</p>
              <h2 className="font-display text-xl font-semibold text-ink mt-1">{tent.name}</h2>
              <p className="text-sm text-stone mt-0.5">{tent.tent_houses?.name} · {tent.cycle_label} · {members.length} cadets</p>
              <button
                onClick={() => document.getElementById(`tent-profile-upload-${tent.id}`)?.click()}
                disabled={uploadingTentPhoto}
                className="mt-3 btn-secondary text-xs"
              >
                {uploadingTentPhoto ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                {tent.profile_image_url ? 'Change Tent Picture' : 'Add Tent Picture'}
              </button>
            </div>
          </div>
          {tent.tent_house_id && <TentHouseBadge houseId={tent.tent_house_id} size="md" />}
        </div>
        <ScrollEdge position="bottom" className="text-stone mt-3" />
      </div>

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

      {announcements.length > 0 && (
        <section className="card overflow-hidden border-brass/25 bg-surface-2">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Megaphone size={17} className="text-brass" />
            <div><h3 className="font-display text-sm font-semibold text-ink">Weekly Announcements</h3><p className="text-[11px] text-stone">Shared updates for the whole community</p></div>
          </div>
          <div className="divide-y divide-border">
            {announcements.slice(0, 4).map((announcement) => (
              <article key={announcement.id} className="px-4 py-3">
                <p className="text-xs font-semibold capitalize text-ink">{announcement.announcement_type?.replace(/_/g, ' ') || 'Announcement'}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone">{announcement.content}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <RecentAwardsPanel onOpen={() => onNavigate('awards')} />

      {quote && (
        <SentryQuoteSlideshow
          quote={quote}
          count={quoteCount}
          index={quoteIndex}
          quoteReactions={quoteReactions}
          reactingQuote={reactingQuote}
          currentUserId={currentUserId}
          image={panelImages.quote || null}
          onReactQuote={onReactQuote}
          onPrev={onQuotePrev}
          onNext={onQuoteNext}
          onCommentOpenChange={onCommentOpenChange}
        />
      )}

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => onNavigate('attendance')} className="btn-primary">
          <ClipboardCheck size={18} /> Mark Attendance
        </button>
        <button onClick={() => onNavigate('game')} className="btn-secondary">
          <GamepadIcon size={18} /> Play Daily Game
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

function SentryQuoteSlideshow({ quote, count, index, quoteReactions, reactingQuote, currentUserId, image, onReactQuote, onPrev, onNext, onCommentOpenChange }: {
  quote: DailyQuoteFeedItem;
  count: number;
  index: number;
  quoteReactions: Record<string, QuoteReactionState>;
  reactingQuote: string | null;
  currentUserId: string | null;
  image: PanelImageSetting | null;
  onReactQuote: (quote: DailyQuoteFeedItem, reactionType: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onCommentOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="card p-4 sm:p-5 bg-surface-2 border-brass/20 animate-slide-up relative overflow-hidden">
      <PanelImageBackdrop image={image} opacityFallback={22} veilClassName="bg-navy-2/76" />
      <div className="relative flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Quote size={18} className="text-brass" />
          <span className="eyebrow text-stone">Quotes From Daily Meditations</span>
        </div>
        {count > 1 && (
          <div className="flex items-center gap-1.5">
            <button onClick={onPrev} className="btn-ghost text-xs px-2 py-1">Prev</button>
            <span className="text-[10px] text-stone">{index + 1}/{count}</span>
            <button onClick={onNext} className="btn-ghost text-xs px-2 py-1">Next</button>
          </div>
        )}
      </div>
      <p className="relative font-display text-xl text-ink leading-snug italic">"{quote.daily_quote}"</p>
      <div className="relative">
        <QuoteAuthorStats quote={quote} />
      </div>
      <div className="relative">
        <QuoteReactions
          state={quoteReactions[`${quote.user_id}:${quote.record_date}`]}
          disabled={!!reactingQuote?.startsWith(`${quote.user_id}:${quote.record_date}:`)}
          onReact={(reactionType) => onReactQuote(quote, reactionType)}
          quoteUserId={quote.user_id}
          quoteRecordDate={quote.record_date}
          currentUserId={currentUserId || undefined}
          fetchComments={fetchDailyQuoteComments}
          onComment={(body) => currentUserId
            ? commentOnDailyQuote(quote.user_id, quote.record_date, currentUserId, body)
            : Promise.reject(new Error('Sign in to comment.'))}
          onCommentOpenChange={onCommentOpenChange}
        />
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
  const [adding, setAdding] = useState(false);

  const loadUnassigned = useCallback(async () => {
    const users = await fetchUnassignedUsers().catch(() => []);
    setUnassigned(users);
    setSelectedCadet(users[0]?.user_id || '');
  }, []);

  useEffect(() => {
    if (showAdd) void loadUnassigned();
  }, [loadUnassigned, showAdd]);

  const addCadet = async () => {
    if (!selectedCadet) return;
    setAdding(true);
    try {
      await sentryAddCadetToTent(currentUserId, selectedCadet);
      setShowAdd(false);
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
          <button onClick={() => setShowAdd((value) => !value)} className="btn-secondary text-xs">
            {showAdd ? <X size={14} /> : <UserPlus size={14} />}
            {showAdd ? 'Close' : 'Add Cadet'}
          </button>
        </div>
        {showAdd && (
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <select className="input-field" value={selectedCadet} onChange={(event) => setSelectedCadet(event.target.value)}>
              {unassigned.length === 0 ? (
                <option value="">No unassigned cadets available</option>
              ) : unassigned.map((cadet) => (
                <option key={cadet.user_id} value={cadet.user_id}>{cadet.display_name}</option>
              ))}
            </select>
            <button onClick={addCadet} disabled={!selectedCadet || adding} className="btn-primary text-xs disabled:opacity-50">
              {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Add
            </button>
          </div>
        )}
      </div>
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
      {submission.proof_text && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-stone">{submission.proof_text}</p>}
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
