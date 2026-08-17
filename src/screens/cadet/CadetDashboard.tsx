import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { StatCard, SectionHeader, EmptyState } from '../../components/AppShell';
import { TentHouseBadge, TentHouseSymbol } from '../../components/TentHouseSymbol';
import { SealBullet, ScrollEdge } from '../../components/AncientMotifs';
import { QuoteReactions, type QuoteReactionState } from '../../components/QuoteReactions';
import { QuoteAuthorStats } from '../../components/QuoteAuthorStats';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { RecentAwardsPanel } from '../../components/RecentAwardsPanel';
import { useAutoAdvance } from '../../hooks/useAutoAdvance';
import { fetchNarrative, fetchDailyRecords, fetchLedgerEntries, fetchGameAttempts, fetchChallengeSubmission, fetchStrictStreak, fetchDailyQuoteFeed, fetchAnnouncements, fetchPanelImageSettings, fetchDailyQuoteReactions, reactToDailyQuote, fetchDailyQuoteComments, commentOnDailyQuote, fetchDailyVerseReactions, reactToDailyVerse, fetchDailyVerseComments, commentOnDailyVerse } from '../../lib/queries';
import { getRemovalState, formatDenarii, getDayType, getTodayISODate, cn } from '../../lib/utils';
import type { DailyNarrative, DailyRecord, DenariiLedgerEntry, GameAttempt, ChallengeSubmission, Tent, TentMember, Profile, StreakInfo, DailyQuoteFeedItem, ScheduledAnnouncement, PanelImageSetting } from '../../lib/types';
import {
  Flame, Coins, BookOpen, Gamepad2, CheckCircle2, Circle, Calendar,
  TrendingUp, FileQuestion, Target, Sunrise, Moon, Trophy,
  Quote, Megaphone, Tent as TentIcon, ShoppingBag, Award,
} from 'lucide-react';

type Tab = 'dashboard' | 'narrative' | 'streak' | 'game' | 'arena' | 'quiz' | 'tent' | 'leaderboard' | 'awards' | 'store';

type DashboardHeroSlide =
  | { id: string; kind: 'welcome' }
  | { id: string; kind: 'verse'; narrative: DailyNarrative }
  | { id: string; kind: 'announcement'; announcement: ScheduledAnnouncement }
  | { id: string; kind: 'quote'; quote: DailyQuoteFeedItem };

interface Props {
  denariiTotal: number;
  currentStreak: number;
  tentInfo: { tent: (Tent & { tent_houses?: any }) | null; members: (TentMember & { profiles: Profile })[] };
  onNavigate: (tab: Tab) => void;
  onRefreshDenarii: () => void;
  refreshKey?: number;
  notificationBadges?: Record<string, number>;
}

export function CadetDashboard({ denariiTotal, currentStreak, tentInfo, onNavigate, refreshKey = 0, notificationBadges = {} }: Props) {
  const { profile } = useAuth();
  const [narrative, setNarrative] = useState<DailyNarrative | null>(null);
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [ledger, setLedger] = useState<DenariiLedgerEntry[]>([]);
  const [games, setGames] = useState<GameAttempt[]>([]);
  const [challenge, setChallenge] = useState<ChallengeSubmission | null>(null);
  const [streakData, setStreakData] = useState<{ current_streak: number; longest_streak: number; consecutive_inactive: number; cumulative_inactive: number } | null>(null);
  const [quotes, setQuotes] = useState<DailyQuoteFeedItem[]>([]);
  const [announcements, setAnnouncements] = useState<ScheduledAnnouncement[]>([]);
  const [panelImages, setPanelImages] = useState<Record<string, PanelImageSetting>>({});
  const [quoteReactions, setQuoteReactions] = useState<Record<string, QuoteReactionState>>({});
  const [verseReactions, setVerseReactions] = useState<Record<string, QuoteReactionState>>({});
  const [reactingQuote, setReactingQuote] = useState<string | null>(null);
  const [reactingVerse, setReactingVerse] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const today = getTodayISODate();
  const todayDate = new Date();
  const dayType = getDayType(todayDate);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const [narr, recs, led, gms, chal, strict, quoteFeed, activeAnnouncements, activePanelImages] = await Promise.allSettled([
        fetchNarrative(today),
        fetchDailyRecords(profile.id),
        fetchLedgerEntries(profile.id, 100),
        fetchGameAttempts(profile.id, today),
        fetchChallengeSubmission(profile.id, today),
        fetchStrictStreak(profile.id),
        fetchDailyQuoteFeed(12),
        fetchAnnouncements(),
        fetchPanelImageSettings([
          'welcome', 'verse', 'announcement', 'quote', 'progress', 'reading', 'recent_denarii', 'quick_links',
          'morning_call', 'midday_reminder', 'evening_reminder', 'quote_of_day', 'streakboard_release', 'birthday',
        ]),
      ]);
      setNarrative(narr.status === 'fulfilled' ? narr.value : null);
      const activeNarrative = narr.status === 'fulfilled' ? narr.value : null;
      setRecords(recs.status === 'fulfilled' ? recs.value : []);
      setLedger(led.status === 'fulfilled' ? led.value : []);
      setGames(gms.status === 'fulfilled' ? gms.value : []);
      setChallenge(chal.status === 'fulfilled' ? chal.value : null);
      setStreakData(strict.status === 'fulfilled' ? strict.value : null);
      setQuotes(quoteFeed.status === 'fulfilled' ? quoteFeed.value : []);
      const quoteItems = quoteFeed.status === 'fulfilled' ? quoteFeed.value : [];
      setAnnouncements(activeAnnouncements.status === 'fulfilled' ? activeAnnouncements.value : []);
      setPanelImages(activePanelImages.status === 'fulfilled' ? activePanelImages.value : {});
      // Reactions enrich the slideshow, but they should never hold the entire
      // dashboard behind a loading screen on a slow mobile connection.
      setLoading(false);
      hasLoadedRef.current = true;
      const [quoteReactionResult, verseReactionResult] = await Promise.allSettled([
        quoteItems.length > 0
          ? fetchDailyQuoteReactions(quoteItems, profile.id)
          : Promise.resolve({}),
        activeNarrative?.verse_of_day
          ? fetchDailyVerseReactions([activeNarrative.narrative_date], profile.id)
          : Promise.resolve({}),
      ]);
      setQuoteReactions(
        quoteReactionResult.status === 'fulfilled'
          ? quoteReactionResult.value as Record<string, QuoteReactionState>
          : {},
      );
      setVerseReactions(
        verseReactionResult.status === 'fulfilled'
          ? verseReactionResult.value as Record<string, QuoteReactionState>
          : {},
      );
    } catch (e) { console.error('Dashboard load error:', e); }
    setLoading(false);
  }, [profile, today]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const heroSlides: DashboardHeroSlide[] = [
    { id: 'welcome', kind: 'welcome' },
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
  const heroSlideCount = heroSlides.length;
  useAutoAdvance(heroSlideCount > 1 && !heroPaused, () => {
    setHeroIndex((index) => index + 1);
  });

  const monthPrefix = today.slice(0, 7);
  const volumeThisMonth = records.filter((r) => {
    return r.record_date.startsWith(monthPrefix) && r.streak_valid === true;
  }).length;
  const streak: StreakInfo = {
    current_streak: Math.max(currentStreak, streakData?.current_streak ?? 0),
    longest_streak: streakData?.longest_streak ?? 0,
    consecutive_inactive: streakData?.consecutive_inactive ?? 0,
    cumulative_inactive: streakData?.cumulative_inactive ?? 0,
    removal_state: getRemovalState(streakData?.consecutive_inactive ?? 0, streakData?.cumulative_inactive ?? 0),
    volume_this_month: volumeThisMonth,
  };
  const todayRecord = records.find((r) => r.record_date === today);
  const attendanceDone = todayRecord?.attendance_status === 'present';
  const attendanceNote = dayType === 'saturday'
    ? 'No attendance on Saturdays'
    : dayType === 'sunday'
      ? 'No attendance on Sundays'
      : todayRecord?.attendance_status === 'present'
        ? `${todayRecord.attendance_late ? 'Marked late · ' : ''}+200D awarded`
        : todayRecord?.attendance_status === 'absent'
          ? 'Absent from morning call'
          : 'Waiting for sentry mark';
  const completedLevels = games.filter((g) => g.status === 'passed').length;
  const todayDenarii = ledger.filter((l) => l.created_at.startsWith(today)).reduce((s, l) => s + l.amount, 0);
  const recentLedger = ledger.slice(0, 5);
  if (loading) {
    return <div className="text-center py-12 text-stone">Loading your dashboard…</div>;
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <DashboardHeroSlideshow
        slides={heroSlides}
        profileName={profile?.display_name || 'Cadet'}
        dayType={dayType}
        todayDate={todayDate}
        tentHouseId={tentInfo.tent?.tent_house_id || null}
        currentUserId={profile?.id || null}
        count={heroSlideCount}
        index={heroIndex}
        panelImages={panelImages}
        quoteReactions={quoteReactions}
        verseReactions={verseReactions}
        reactingQuote={reactingQuote}
        reactingVerse={reactingVerse}
        onReactQuote={async (quote, reactionType) => {
          if (!profile) return;
          const key = `${quote.user_id}:${quote.record_date}`;
          setReactingQuote(`${key}:${reactionType}`);
          try {
            await reactToDailyQuote(quote.user_id, quote.record_date, profile.id, reactionType);
            const reactions = await fetchDailyQuoteReactions(quotes, profile.id).catch(() => quoteReactions);
            setQuoteReactions(reactions as Record<string, QuoteReactionState>);
          } catch (e: any) {
            alert(e.message || 'Could not react to quote.');
          }
          setReactingQuote(null);
        }}
        onReactVerse={async (narrativeDate, reactionType) => {
          if (!profile) return;
          setReactingVerse(`${narrativeDate}:${reactionType}`);
          try {
            await reactToDailyVerse(narrativeDate, profile.id, reactionType);
            const reactions = await fetchDailyVerseReactions([narrativeDate], profile.id).catch(() => verseReactions);
            setVerseReactions(reactions as Record<string, QuoteReactionState>);
          } catch (e: any) {
            alert(e.message || 'Could not react to verse.');
          }
          setReactingVerse(null);
        }}
        onPrev={() => setHeroIndex((idx) => idx - 1)}
        onNext={() => setHeroIndex((idx) => idx + 1)}
        onCommentOpenChange={setHeroPaused}
      />

      <RecentAwardsPanel onOpen={() => onNavigate('awards')} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Flame} label="Current Streak" value={`${streak.current_streak}`} sublabel={`Best: ${streak.longest_streak}`} color="#B8553E" />
        <StatCard icon={Coins} label="Denarii" value={formatDenarii(denariiTotal)} sublabel={`+${todayDenarii} today`} color="#C9A227" />
        <StatCard icon={Calendar} label="Valid Days" value={streak.volume_this_month} sublabel="This month" color="#6B8E5A" />
        <StatCard icon={Gamepad2} label="Levels Done" value={`${completedLevels}/10`} sublabel="Today" color="#C9A227" />
      </div>

      {/* Today's status bar */}
      <div className="card relative overflow-hidden p-4">
        <PanelImageBackdrop image={panelImages.progress} />
        <div className="relative">
          <SectionHeader title="Today's Progress" subtitle="Complete each item to keep your streak alive" />
          <div className="space-y-2">
            <TodayCheckItem
              icon={Sunrise}
              label="Morning call attendance (+200D)"
              done={attendanceDone}
              n_a={dayType !== 'weekday'}
              note={attendanceNote}
            />
            <TodayCheckItem
              icon={Moon}
              label="Meditation submitted (before 9:00 PM)"
              done={todayRecord?.meditation_submitted === true}
              n_a={dayType !== 'weekday'}
              note={dayType !== 'weekday' ? 'Meditation is only required on weekdays' : undefined}
              onClick={() => onNavigate('narrative')}
            />
            <TodayCheckItem
              icon={FileQuestion}
              label="Saturday quiz submitted"
              done={todayRecord?.quiz_attempt_id !== null && !!todayRecord?.quiz_attempt_id}
              n_a={dayType !== 'saturday'}
              note={dayType !== 'saturday' ? 'Quiz is only on Saturdays' : undefined}
              onClick={() => onNavigate('quiz')}
            />
            <TodayCheckItem
              icon={Gamepad2}
              label="Daily game progress"
              done={completedLevels > 0}
              n_a={false}
              note={`${completedLevels} of 10 levels cleared`}
              onClick={() => onNavigate('game')}
            />
            <TodayCheckItem
              icon={Target}
              label="Challenge proof submitted"
              done={!!challenge}
              n_a={!narrative?.challenge_active}
              note={!narrative?.challenge_active ? 'No active challenge today' : undefined}
              onClick={() => onNavigate('narrative')}
            />
          </div>
        </div>
      </div>

      {/* Two-column: narrative preview + recent activity */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card relative overflow-hidden p-4 card-hover">
          <PanelImageBackdrop image={panelImages.reading} />
          <div className="relative">
            <SectionHeader title="Today's Reading" />
            {dayType === 'saturday' ? (
              <button onClick={() => onNavigate('quiz')} className="text-left w-full">
                <h4 className="font-display font-medium text-ink">Saturday Quiz Day</h4>
                <p className="text-sm text-stone mt-1">No daily reading or meditation is required today.</p>
                <span className="text-xs text-brass mt-2 inline-block font-medium">Go to quiz →</span>
              </button>
            ) : narrative ? (
              <button onClick={() => onNavigate('narrative')} className="text-left w-full">
                <h4 className="font-display font-medium text-ink">{narrative.title}</h4>
                <p className="text-sm text-stone mt-1">{narrative.scripture_reference} · {narrative.theme}</p>
                <p className="preserve-paragraphs text-sm text-ink mt-2 line-clamp-3 opacity-80">{narrative.main_text.slice(0, 200)}…</p>
                <span className="text-xs text-brass mt-2 inline-block font-medium">Read & meditate →</span>
              </button>
            ) : (
              <EmptyState icon={BookOpen} title="No reading yet" message="Today's narrative hasn't been published. Check back soon." />
            )}
          </div>
        </div>

        <div className="card relative overflow-hidden p-4">
          <PanelImageBackdrop image={panelImages.recent_denarii} />
          <div className="relative">
          <SectionHeader title="Recent Denarii" subtitle={`${formatDenarii(denariiTotal)} total`} />
          {recentLedger.length > 0 ? (
            <div className="space-y-2">
              {recentLedger.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <SealBullet className="text-brass flex-shrink-0" />
                    <span className="text-ink truncate">{entry.description || entry.source_type.replace(/_/g, ' ')}</span>
                  </div>
                  <span className={cn('font-medium flex-shrink-0', entry.amount > 0 ? 'text-moss' : 'text-roman')}>
                    {entry.amount > 0 ? '+' : ''}{entry.amount}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={TrendingUp} title="No denarii yet" message="Play the daily game or take the Saturday quiz to start earning." />
          )}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="relative overflow-hidden rounded-2xl">
        <PanelImageBackdrop image={panelImages.quick_links} />
        <div className="relative grid grid-cols-2 gap-3 md:grid-cols-4">
          <QuickLink icon={dayType === 'saturday' ? FileQuestion : BookOpen} label={dayType === 'saturday' ? 'Take Quiz' : 'Read Today'} badge={notificationBadges[dayType === 'saturday' ? 'quiz' : 'narrative'] || 0} onClick={() => onNavigate(dayType === 'saturday' ? 'quiz' : 'narrative')} />
          <QuickLink icon={Gamepad2} label="Play Game" badge={notificationBadges.game || 0} onClick={() => onNavigate('game')} />
          <QuickLink icon={TentIcon} label="My Tent" badge={notificationBadges.tent || 0} onClick={() => onNavigate('tent')} />
          <QuickLink icon={Award} label="Awards Hub" badge={notificationBadges.awards || 0} onClick={() => onNavigate('awards')} />
          <QuickLink icon={Flame} label="My Streak" badge={notificationBadges.streak || 0} onClick={() => onNavigate('streak')} />
          <QuickLink icon={ShoppingBag} label="Market" badge={notificationBadges.store || 0} onClick={() => onNavigate('store')} />
          <QuickLink icon={FileQuestion} label="Quiz" badge={notificationBadges.quiz || 0} onClick={() => onNavigate('quiz')} />
          <QuickLink icon={Trophy} label="Leaderboard" badge={notificationBadges.leaderboard || 0} onClick={() => onNavigate('leaderboard')} />
        </div>
      </div>
    </div>
  );
}

function DashboardHeroSlideshow({ slides, profileName, dayType, todayDate, tentHouseId, currentUserId, count, index, panelImages, quoteReactions, verseReactions, reactingQuote, reactingVerse, onReactQuote, onReactVerse, onPrev, onNext, onCommentOpenChange }: {
  slides: DashboardHeroSlide[];
  profileName: string;
  dayType: string;
  todayDate: Date;
  tentHouseId: string | null;
  currentUserId: string | null;
  count: number;
  index: number;
  panelImages: Record<string, PanelImageSetting>;
  quoteReactions: Record<string, QuoteReactionState>;
  verseReactions: Record<string, QuoteReactionState>;
  reactingQuote: string | null;
  reactingVerse: string | null;
  onReactQuote: (quote: DailyQuoteFeedItem, reactionType: string) => void;
  onReactVerse: (narrativeDate: string, reactionType: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onCommentOpenChange: (open: boolean) => void;
}) {
  const dateLabel = todayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const dayLabel = dayType === 'saturday' ? 'Quiz Day' : dayType === 'sunday' ? 'Day of Rest' : 'Reading Day';
  const visibleSlides = count > 1 ? [...slides, slides[0]] : slides;
  const [displayIndex, setDisplayIndex] = useState(index % Math.max(count, 1));
  const [withTransition, setWithTransition] = useState(true);
  const counterIndex = count > 0 ? ((displayIndex % count) + count) % count : 0;

  useEffect(() => {
    if (count <= 0) return;
    setWithTransition(true);
    const wrapped = ((index % count) + count) % count;
    setDisplayIndex(count > 1 && index > 0 && wrapped === 0 ? count : wrapped);
  }, [count, index]);

  return (
    <div className="card relative overflow-hidden animate-slide-up">
      <div
        className={cn('flex min-h-[220px] sm:min-h-[190px]', withTransition && 'transition-transform duration-700 ease-out')}
        style={{ transform: `translateX(-${displayIndex * 100}%)` }}
        onTransitionEnd={() => {
          if (count > 1 && displayIndex === count) {
            setWithTransition(false);
            setDisplayIndex(0);
            window.setTimeout(() => setWithTransition(true), 30);
          }
        }}
      >
        {visibleSlides.map((slide, slideIndex) => {
          const announcementTitle = slide.kind === 'announcement' && slide.announcement.announcement_type
            ? slide.announcement.announcement_type.replace(/_/g, ' ')
            : 'Announcement';
          const slideImage = slide.kind === 'announcement'
            ? panelImages[slide.announcement.announcement_type] || panelImages.announcement
            : panelImages[slide.kind];

          return (
            <div key={`${slide.id}-${slideIndex}`} className="relative min-h-[220px] min-w-full overflow-hidden p-4 pb-16 sm:min-h-[190px] sm:p-5 sm:pb-16">
              {slideImage && (
                <PanelImageBackdrop
                  image={slideImage}
                  opacityOverride={100}
                  veilClassName={slide.kind === 'quote' ? '' : 'welcome-slide-veil'}
                  modeFilter={false}
                  textGradient={false}
                  simple={slide.kind === 'quote'}
                />
              )}
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {slide.kind === 'welcome' && (
                    <>
                      <p className="eyebrow mb-1">{dayLabel}</p>
                      <h2 className="font-display text-2xl font-semibold text-ink">
                        Welcome, <span className="text-brass">{profileName}</span>
                      </h2>
                      <p className="text-sm text-stone mt-1">{dateLabel}</p>
                    </>
                  )}

                  {slide.kind === 'verse' && (
                    <div className="max-w-2xl rounded-2xl border border-white/18 bg-surface/62 p-4 shadow-[0_18px_50px_rgba(7,24,43,0.16)] backdrop-blur-2xl ring-1 ring-black/5">
                      <p className="eyebrow mb-1 flex items-center gap-1.5"><BookOpen size={14} /> Verse of the Day</p>
                      <p className="font-display text-2xl text-ink leading-snug">"{slide.narrative.verse_of_day}"</p>
                      <p className="text-sm text-stone mt-3">{slide.narrative.scripture_reference || slide.narrative.title}</p>
                      <QuoteReactions
                        state={verseReactions[slide.narrative.narrative_date]}
                        disabled={!!reactingVerse?.startsWith(`${slide.narrative.narrative_date}:`)}
                        onReact={(reactionType) => onReactVerse(slide.narrative.narrative_date, reactionType)}
                        quoteUserId={currentUserId || undefined}
                        quoteRecordDate={slide.narrative.narrative_date}
                        currentUserId={currentUserId || undefined}
                        fetchComments={(_quoteUserId, quoteRecordDate) => fetchDailyVerseComments(quoteRecordDate)}
                        onComment={async (body) => {
                          if (!currentUserId) throw new Error('Sign in to comment.');
                          await commentOnDailyVerse(slide.narrative.narrative_date, currentUserId, body);
                        }}
                        onCommentOpenChange={onCommentOpenChange}
                      />
                    </div>
                  )}

                  {slide.kind === 'announcement' && (
                    <>
                      <p className="eyebrow mb-1 flex items-center gap-1.5"><Megaphone size={14} /> {announcementTitle}</p>
                      {slide.announcement.announcement_type === 'birthday' && (
                        <div className="mb-3 flex items-center gap-3">
                          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-brass/45 bg-brass/15 text-lg font-bold text-brass shadow-sm">
                            {slide.announcement.metadata?.avatar_url ? (
                              <img
                                src={slide.announcement.metadata.avatar_url}
                                alt={slide.announcement.metadata.display_name || 'Birthday celebrant'}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              String(slide.announcement.metadata?.display_name || 'B').charAt(0)
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-ink">{slide.announcement.metadata?.display_name || 'Birthday celebrant'}</p>
                            <p className="text-xs text-stone">Birthday celebration</p>
                          </div>
                        </div>
                      )}
                      <h2 className="font-display text-2xl font-semibold text-ink leading-snug">Hey Everyone</h2>
                      <p className="text-sm text-stone mt-2 leading-relaxed max-w-2xl whitespace-pre-wrap">{slide.announcement.content}</p>
                      <p className="text-[10px] text-stone-dim mt-2">
                        Posted {new Date(slide.announcement.publish_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </>
                  )}

                  {slide.kind === 'quote' && (
                    <div className="quote-glass-panel max-w-2xl rounded-2xl p-4 ring-1 ring-black/5">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="eyebrow flex items-center gap-1.5"><Quote size={14} /> Quotes From Daily Meditations</p>
                        {slide.quote.tent_house_id && (
                          <TentHouseSymbol houseId={slide.quote.tent_house_id} size={34} className="-mt-1" />
                        )}
                      </div>
                      <p className="mt-3 font-display text-xl font-medium italic text-ink leading-snug">"{slide.quote.daily_quote}"</p>
                      <QuoteAuthorStats quote={slide.quote} />
                      <QuoteReactions
                        state={quoteReactions[`${slide.quote.user_id}:${slide.quote.record_date}`]}
                        disabled={!!reactingQuote?.startsWith(`${slide.quote.user_id}:${slide.quote.record_date}:`)}
                        onReact={(reactionType) => onReactQuote(slide.quote, reactionType)}
                        quoteUserId={slide.quote.user_id}
                        quoteRecordDate={slide.quote.record_date}
                        currentUserId={currentUserId || undefined}
                        fetchComments={fetchDailyQuoteComments}
                        onComment={(body) => currentUserId
                          ? commentOnDailyQuote(slide.quote.user_id, slide.quote.record_date, currentUserId, body)
                          : Promise.reject(new Error('Sign in to comment.'))}
                        onCommentOpenChange={onCommentOpenChange}
                      />
                    </div>
                  )}
                </div>

                {slide.kind === 'welcome' && tentHouseId && (
                  <TentHouseBadge houseId={tentHouseId} size="md" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute left-5 right-5 bottom-4 flex items-center justify-between gap-3">
        <ScrollEdge position="bottom" className="text-brass flex-1" />
        {count > 1 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={onPrev} className="btn-ghost text-xs px-2 py-1">Prev</button>
            <span className="text-[10px] text-stone">{counterIndex + 1}/{count}</span>
            <button onClick={onNext} className="btn-ghost text-xs px-2 py-1">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

function TodayCheckItem({ icon: Icon, label, done, n_a, note, onClick }: {
  icon: typeof Flame; label: string; done: boolean; n_a?: boolean; note?: string; onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-2.5 rounded-lg transition-colors',
        onClick && !n_a && 'cursor-pointer hover:bg-surface-2',
        n_a && 'opacity-40',
      )}
      onClick={onClick && !n_a ? onClick : undefined}
    >
      {n_a ? (
        <Circle size={18} className="text-stone-dim flex-shrink-0" />
      ) : done ? (
        <CheckCircle2 size={18} className="text-moss flex-shrink-0" />
      ) : (
        <Circle size={18} className="text-stone-dim flex-shrink-0" />
      )}
      <Icon size={16} className={cn('flex-shrink-0', done ? 'text-moss' : 'text-stone')} />
      <span className={cn('text-sm flex-1', done ? 'text-ink' : 'text-stone')}>{label}</span>
      {note && <span className="text-xs text-stone-dim">{note}</span>}
    </div>
  );
}

function QuickLink({ icon: Icon, label, badge = 0, onClick }: { icon: typeof Flame; label: string; badge?: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card p-4 card-hover flex flex-col items-center gap-2 text-center relative">
      {badge > 0 && (
        <span className="notification-badge-ring absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-coral p-0 text-[9px] font-bold leading-none text-white shadow-sm">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
      <Icon size={24} className="text-brass" />
      <span className="text-sm font-medium text-ink">{label}</span>
    </button>
  );
}
