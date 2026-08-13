import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AppShell, SectionHeader, EmptyState } from '../../components/AppShell';
import { PasswordUpdateFlow } from '../../components/PasswordUpdateFlow';
import { NotificationCenter } from '../../components/NotificationCenter';
import { RecentAwardsPanel } from '../../components/RecentAwardsPanel';
import { BrowserNotificationSettings } from '../../components/BrowserNotificationSettings';
import { MeditationHistoryPanel } from '../../components/MeditationHistoryPanel';
import { CadetLeaderboard } from '../cadet/CadetLeaderboard';
import { invalidateSoundAsset } from '../../lib/soundscape';
import { PROFILE_COUNTRIES, PROFILE_LANGUAGES } from '../../lib/profileOptions';
import { formatBirthdayInput, parseBirthdayInput, saveOwnProfilePreferences } from '../../lib/profilePreferences';
import { TentHouseBadge } from '../../components/TentHouseSymbol';
import { QuoteReactions, type QuoteReactionState } from '../../components/QuoteReactions';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { supabase } from '../../lib/supabase';
import {
  fetchTents, fetchTentMembers, fetchAllProfiles, fetchAllRoleAssignments,
  fetchAllNarratives, fetchAwards,
  fetchQuizSessions, createQuizSession, fetchQuestionsForSession, insertQuestions, fetchNarratives,
  fetchUnassignedUsers, isSaturdayQuizScheduled, assignCadetToTent, generateInstructorQuestionsWithAI,
} from '../../lib/queries';
import { cn, whatsappUrl, formatShortDate, getDayType, getTodayISODate, getAppClock, getAppDateTimeMs, shiftISODate, formatXaf } from '../../lib/utils';
import { DEFAULT_PANEL_IMAGE_ADJUSTMENTS, isPanelImageContent, normaliseAdjustments, panelImageFromAnnouncement, serializePanelImageSetting } from '../../lib/panelImages';
import { prepareImageUpload } from '../../lib/uploads';
import type { Tent, TentMember, Profile, RoleAssignment, DailyNarrative, AwardWithRecipient, QuizSession, GeneratedQuestion, CustomQuestion, QuestionPayload, MobileMoneySettings, MobileMoneyPayment, ScheduledAnnouncement, DailyQuoteFeedItem, PanelImageAdjustments } from '../../lib/types';
import { NarrativeEditor } from '../../components/NarrativeEditor';
import {
  Home, Users, BookOpen, FileQuestion, Tent as TentIcon, Trophy, Award as AwardIcon,
  Shield, Plus, Save, Loader2, Crown, Coins, Trash2, UserMinus, MessageCircle,
  Flame, ArrowUpCircle, KeyRound, Target, CheckCircle2, XCircle, Gamepad2, Smartphone, Rocket, UserPlus, UserCheck,
  RotateCcw, ChevronDown, Check, CreditCard, LogOut, Megaphone, Eye,
  Globe2, Image as ImageIcon, Upload, X, Move, Volume2, Music2, Clock, Languages,
  Cake,
} from 'lucide-react';
import { APP_TIME_ZONE, DAILY_GAME_LEVELS, LEVEL_GAME_TYPES, GAME_QUESTIONS_PER_ROUND, GAME_ROUNDS_PER_LEVEL, LEVEL_TIMERS } from '../../lib/constants';
import { customQuestionToPayload, GAME_TYPE_LABELS } from '../../lib/gameEngines';
import {
  fetchAllChallengeSubmissions, reviewChallengeSubmission, promoteCadetToSentry, promoteSentryToInstructor,
  giveAwardRPC, awardTent, fetchCustomQuestions, insertCustomQuestion, updateCustomQuestion, deleteCustomQuestion,
  fetchCustomGameQuestions, fetchQuizTaggedGameQuestions,
  fetchMobileMoneySettings, saveMobileMoneySettings, fetchInstructorMobileMoneyPayments,
  fetchAllAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  deleteQuestionsForSession, updateGeneratedQuestion,
  fetchQuizAnswerSheets, fetchDailyQuoteFeed, fetchDailyQuoteReactions, reactToDailyQuote,
  fetchDailyQuoteComments, commentOnDailyQuote, fetchStrictStreak, fetchDailyQuoteInteractionSummary, savePanelImageSetting,
  fetchStreakboardSnapshots,
} from '../../lib/queries';

type Tab = 'dashboard' | 'narratives' | 'announcements' | 'quiz' | 'game_questions' | 'tents' | 'cadets' | 'sentries' | 'unassigned' | 'leaderboard' | 'matricules' | 'awards' | 'challenges' | 'mobile_money' | 'settings';

type AwardCatalogTarget = 'cadet' | 'sentry' | 'tent';
type NarrativeSelection = DailyNarrative | null | 'new' | { mode: 'republish'; narrative: DailyNarrative };

const DEFAULT_PASSAGE_DISPLAY_SECONDS = 30;

function isRepublishSelection(selection: NarrativeSelection): selection is { mode: 'republish'; narrative: DailyNarrative } {
  return typeof selection === 'object' && selection !== null && 'mode' in selection && selection.mode === 'republish';
}

function isSentryAward(a: { title: string; forSentry?: boolean }) {
  return !!a.forSentry || a.title === 'Reputation Award' || a.title === 'Valley Champion';
}

function awardVisibleForTarget(a: { title: string; forTent?: boolean; forSentry?: boolean }, target: AwardCatalogTarget) {
  if (target === 'tent') return !!a.forTent;
  if (a.title === 'Valley Champion') return target === 'cadet' || target === 'sentry';
  if (target === 'sentry') return isSentryAward(a);
  return !a.forTent && !isSentryAward(a);
}

function AwardCheckboxList({ selected, onToggle, target = 'cadet' }: { selected: Set<string>; onToggle: (title: string) => void; target?: AwardCatalogTarget }) {
  const visible = AWARD_CATALOG.map((g) => ({
    ...g,
    awards: g.awards.filter((a) => awardVisibleForTarget(a, target)),
  })).filter((g) => g.awards.length > 0);
  const cadenceColors: Record<string, string> = {
    weekly: 'bg-moss/10 text-moss border-moss/20',
    monthly: 'bg-gold/10 text-gold border-gold/20',
    annual: 'bg-coral/10 text-coral border-coral/20',
  };
  return (
    <div className="space-y-3">
      {visible.map((group) => (
        <div key={group.group}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', cadenceColors[group.cadence])}>
              {group.group}
            </span>
          </div>
          <div className="space-y-1">
            {group.awards.map((award) => {
              const checked = selected.has(award.title);
              return (
                <label key={award.title}
                  className={cn('flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all',
                    checked ? 'border-peri bg-peri/5' : 'border-border-bright bg-surface-2 hover:border-stone/30')}>
                  <input type="checkbox" checked={checked} onChange={() => onToggle(award.title)}
                    className="mt-0.5 accent-peri flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-ink leading-tight">{award.title}</p>
                    <p className="text-[11px] text-stone mt-0.5">{award.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MultiSelectDropdown({ options, selected, onToggle, placeholder, label }: {
  options: { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  placeholder: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <label className="text-xs text-stone block mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field text-sm flex items-center justify-between w-full"
      >
        <span className={selected.size === 0 ? 'text-stone' : 'text-ink'}>
          {selected.size === 0 ? placeholder : `${selected.size} selected`}
        </span>
        <ChevronDown size={16} className="text-stone flex-shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
            {options.map((opt) => {
              const checked = selected.has(opt.id);
              return (
                <label key={opt.id}
                  className={cn('flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors hover:bg-surface-2',
                    checked && 'bg-peri/5')}
                  onClick={(e) => { e.preventDefault(); onToggle(opt.id); }}
                >
                  <div className={cn('w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                    checked ? 'bg-peri border-peri' : 'border-border-bright')}>
                    {checked && <Check size={12} className="text-navy" />}
                  </div>
                  <span className="text-sm text-ink">{opt.label}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: Home },
  { key: 'narratives', label: 'Narratives', icon: BookOpen },
  { key: 'announcements', label: 'Announcements', icon: Megaphone },
  { key: 'quiz', label: 'Quiz Builder', icon: FileQuestion },
  { key: 'game_questions', label: 'Game Questions', icon: Gamepad2 },
  { key: 'tents', label: 'Tents', icon: TentIcon },
  { key: 'cadets', label: 'Cadets', icon: Users },
  { key: 'sentries', label: 'Sentries', icon: Shield },
  { key: 'unassigned', label: 'Unassigned', icon: UserPlus },
  { key: 'challenges', label: 'Challenges', icon: Target },
  { key: 'mobile_money', label: 'Mobile Money', icon: Smartphone },
  { key: 'leaderboard', label: 'Challenge Boards', icon: Trophy },
  { key: 'awards', label: 'Awards', icon: AwardIcon },
  { key: 'settings', label: 'Settings', icon: Shield },
];

export function InstructorApp() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [tents, setTents] = useState<(Tent & { tent_houses: any })[]>([]);
  const [members, setMembers] = useState<(TentMember & { profiles: Profile })[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<RoleAssignment[]>([]);
  const [narratives, setNarratives] = useState<DailyNarrative[]>([]);
  const [awards, setAwards] = useState<AwardWithRecipient[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    const [t, m, r, n] = await Promise.allSettled([
      fetchTents(), fetchTentMembers(), fetchAllRoleAssignments(), fetchAllNarratives(),
    ]);
    setTents(t.status === 'fulfilled' ? t.value : []);
    setMembers(m.status === 'fulfilled' ? m.value : []);
    setRoles(r.status === 'fulfilled' ? r.value : []);
    setNarratives(n.status === 'fulfilled' ? n.value : []);
    setLoading(false);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [t, m, p, r, n, a] = await Promise.allSettled([
      fetchTents(), fetchTentMembers(), fetchAllProfiles(),
      fetchAllRoleAssignments(), fetchAllNarratives(), fetchAwards(),
    ]);
    setTents(t.status === 'fulfilled' ? t.value : []);
    setMembers(m.status === 'fulfilled' ? m.value : []);
    setProfiles(p.status === 'fulfilled' ? p.value : []);
    setRoles(r.status === 'fulfilled' ? r.value : []);
    setNarratives(n.status === 'fulfilled' ? n.value : []);
    setAwards(a.status === 'fulfilled' ? a.value : []);
    setLoading(false);
  }, []);

  // The landing dashboard does not need every profile or historical award.
  // Defer those larger management datasets until a management screen is opened.
  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  const tabLabels: Record<Tab, string> = {
    dashboard: 'Instructor Dashboard', narratives: 'Narrative Editor', announcements: 'Announcements', quiz: 'Quiz Builder',
    game_questions: 'Game Questions', tents: 'Tent Management', cadets: 'Cadet Management', sentries: 'Sentry Management',
    leaderboard: 'Challenge Boards', matricules: 'Sentry Matricules', awards: 'Awards Hub',
    challenges: 'Challenges', mobile_money: 'Mobile Money', settings: 'Settings',
    unassigned: 'Unassigned Users',
  };

  const [editingNarrative, setEditingNarrative] = useState<NarrativeSelection>('new');

  return (
    <AppShell
      navItems={NAV_ITEMS}
      activeKey={tab}
      onNavigate={(k) => {
        setTab(k as Tab);
        if (k === 'narratives') setEditingNarrative('new');
        if (['tents', 'cadets', 'sentries', 'awards'].includes(k) && profiles.length === 0) void loadAll();
      }}
      headerTitle={tabLabels[tab]}
      headerSubtitle="Instructor"
      rightHeader={<NotificationCenter onNavigate={(key) => {
        if (NAV_ITEMS.some((item) => item.key === key)) setTab(key as Tab);
      }} />}
    >
      {tab === 'dashboard' && <InstructorDashboard tents={tents} members={members} roles={roles} narratives={narratives} instructorId={profile?.id || null} onNavigate={setTab as (k: string) => void} />}
      {tab === 'narratives' && (
        <NarrativesTab
          narratives={narratives}
          editingNarrative={editingNarrative}
          onSelectNarrative={setEditingNarrative}
          onDone={() => { loadAll(); setEditingNarrative(null); }}
        />
      )}
      {tab === 'announcements' && <AnnouncementManager />}
      {tab === 'tents' && <><TentJoinRequests onRefresh={loadAll} /><TentManagement tents={tents} members={members} profiles={profiles} roles={roles} onRefresh={loadAll} loading={loading} /></>}
      {tab === 'cadets' && <CadetManagement profiles={profiles} roles={roles} members={members} tents={tents} awards={awards} onRefresh={loadAll} instructorId={profile?.id || ''} />}
      {tab === 'sentries' && <SentryManagement profiles={profiles} roles={roles} members={members} tents={tents} awards={awards} onRefresh={loadAll} instructorId={profile?.id || ''} />}
      {tab === 'unassigned' && <UnassignedUsers onRefresh={loadAll} />}
      {tab === 'leaderboard' && <CadetLeaderboard instructorMode />}
      {tab === 'matricules' && <MatriculesManagement />}
      {tab === 'awards' && <AwardsManagement awards={awards} profiles={profiles} roles={roles} tents={tents} members={members} onRefresh={loadAll} />}
      {tab === 'quiz' && <QuizBuilder />}
      {tab === 'game_questions' && profile && <GameQuestionsEditor profile={profile} />}
      {tab === 'challenges' && <ChallengeReview instructorId={profile?.id || ''} onRefresh={loadAll} />}
      {tab === 'mobile_money' && <MobileMoneyManager />}
      {tab === 'settings' && <InstructorSettings profile={profile} tents={tents} members={members} />}
    </AppShell>
  );
}

function toDateTimeLocal(value: string) {
  const date = value ? new Date(value) : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function appDateTimeLocalToISOString(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Choose a valid publication date and time.');
  return new Date(getAppDateTimeMs(match[1], Number(match[2]), Number(match[3]))).toISOString();
}

function looksLikeGeneratorLeak(option: string) {
  const value = option.trim();
  if (!value) return true;
  if (value.length > 220) return true;
  return /(\"?(question|options|correct_answer|accepted_answers|explanation|reference|focus_key)\"?\s*:|distractor|plausible option|generate|reasoning|i should|we need|the answer is|think carefully|json)/i.test(value);
}

function cleanQuestionPayload(payload: QuestionPayload): QuestionPayload {
  if (!Array.isArray(payload.options)) return payload;
  const correct = String(payload.correct_answer || '').trim();
  const options = Array.from(new Set(payload.options.map((option) => String(option || '').trim())))
    .filter((option) => !looksLikeGeneratorLeak(option));
  if (correct && !looksLikeGeneratorLeak(correct) && !options.some((option) => option.toLowerCase() === correct.toLowerCase())) {
    options.push(correct);
  }
  return {
    ...payload,
    options: options.slice(0, 4),
  };
}

const PANEL_IMAGE_SLOTS = [
  { type: 'weekly_background', label: 'Weekly App Background', audience: 'all' },
  { type: 'panel_image_welcome', label: 'Welcome Panel', audience: 'all' },
  { type: 'panel_image_verse', label: 'Verse Panel', audience: 'all' },
  { type: 'panel_image_announcement', label: 'General / Announcement Panel', audience: 'all' },
  { type: 'panel_image_birthday', label: 'Birthday Announcement Panel', audience: 'all' },
  { type: 'panel_image_morning_call', label: 'Morning Call', audience: 'all' },
  { type: 'panel_image_midday_reminder', label: 'Midday Reminder', audience: 'all' },
  { type: 'panel_image_evening_reminder', label: 'Evening Reminder', audience: 'all' },
  { type: 'panel_image_quote_of_day', label: 'Quote of the Day Notice', audience: 'all' },
  { type: 'panel_image_streakboard_release', label: 'Streakboard Release', audience: 'all' },
  { type: 'panel_image_quote', label: 'Quote Panel', audience: 'all' },
  { type: 'panel_image_market', label: 'Market Panel', audience: 'all' },
  { type: 'panel_image_reading', label: "Today's Reading", audience: 'all' },
  { type: 'panel_image_quiz', label: 'Quiz Panel', audience: 'all' },
  { type: 'panel_image_progress', label: "Today's Progress", audience: 'all' },
  { type: 'panel_image_recent_denarii', label: 'Recent Denarii', audience: 'all' },
  { type: 'panel_image_quick_links', label: 'Quick Links', audience: 'all' },
  { type: 'panel_image_game', label: 'Daily Game', audience: 'all' },
  { type: 'panel_image_arena', label: 'Arena', audience: 'all' },
  { type: 'panel_image_tent', label: 'Tent Panel', audience: 'all' },
  { type: 'panel_image_leaderboard', label: 'Boards', audience: 'all' },
  { type: 'panel_image_awards', label: 'Awards Hub', audience: 'all' },
  { type: 'panel_image_recent_awards', label: 'Recent Awards Dashboard Panel', audience: 'all' },
  { type: 'panel_image_settings', label: 'Settings', audience: 'all' },
  { type: 'panel_image_password_update', label: 'Password Update', audience: 'all' },
  { type: 'panel_image_subscription', label: 'Subscription', audience: 'all' },
  { type: 'panel_image_sentry_overview', label: 'Sentry Overview', audience: 'sentries' },
  { type: 'panel_image_sentry_attendance', label: 'Sentry Attendance', audience: 'sentries' },
  { type: 'panel_image_sentry_cadets', label: 'Sentry Cadets', audience: 'sentries' },
  { type: 'panel_image_instructor_dashboard', label: 'Instructor Dashboard', audience: 'instructors' },
  { type: 'panel_image_instructor_stats', label: 'Instructor Stats', audience: 'instructors' },
  { type: 'panel_image_instructor_narrative', label: 'Narrative Builder', audience: 'instructors' },
  { type: 'panel_image_instructor_quote_feed', label: 'Quote Feed', audience: 'instructors' },
  { type: 'panel_image_instructor_tents', label: 'Tent Management', audience: 'instructors' },
  { type: 'panel_image_instructor_quiz_builder', label: 'Quiz Builder', audience: 'instructors' },
  { type: 'panel_image_instructor_game_questions', label: 'Game Questions', audience: 'instructors' },
  { type: 'panel_image_instructor_awards', label: 'Instructor Awards', audience: 'instructors' },
  { type: 'panel_image_instructor_challenges', label: 'Challenges', audience: 'instructors' },
  { type: 'panel_image_instructor_mobile_money', label: 'Mobile Money', audience: 'instructors' },
];

const SOUND_SLOTS = [
  { type: 'sound_dashboard', label: 'Dashboard Atmosphere', description: 'A low-volume looping track for the Home dashboard only.', audience: 'all' },
  { type: 'sound_instructor_overview', label: 'Instructor Overview Atmosphere', description: 'A low-volume looping track for the Instructor Dashboard only.', audience: 'instructors' },
  { type: 'sound_sentry_overview', label: 'Sentry Overview Atmosphere', description: 'A low-volume looping track for the Sentry Overview dashboard.', audience: 'sentries' },
  { type: 'sound_button', label: 'Button Feedback', description: 'A short sound played when someone presses an app button.', audience: 'all' },
  { type: 'sound_welcome', label: 'Welcome / Sign-in', description: 'Plays during the welcome and sign-in experience.', audience: 'all' },
  { type: 'sound_reading', label: "Today's Reading", description: 'Loops in scripture and meditation spaces.', audience: 'all' },
  { type: 'sound_tent', label: 'Tent Space', description: 'Loops during tent conversations and activity.', audience: 'all' },
  { type: 'sound_game_lobby', label: 'Daily Game Lobby', description: 'Loops on the daily-game landing space.', audience: 'all' },
  { type: 'sound_game_start', label: 'Daily Game Start', description: 'Plays when a daily game begins.', audience: 'all' },
  { type: 'sound_game_correct', label: 'Correct Answer', description: 'Plays after a correct daily-game answer.', audience: 'all' },
  { type: 'sound_game_incorrect', label: 'Incorrect Answer', description: 'Plays after a missed daily-game answer.', audience: 'all' },
  { type: 'sound_game_finish', label: 'Daily Game Finish', description: 'Plays when a daily game is completed.', audience: 'all' },
  ...Array.from({ length: DAILY_GAME_LEVELS }, (_, index) => ({
    type: `sound_game_level_${index + 1}`,
    label: `Daily Game Level ${index + 1}`,
    description: `Looping soundtrack for Level ${index + 1} only.`,
    audience: 'all',
  })),
  { type: 'sound_round_timeout', label: 'Round Time Elapsed', description: 'Plays when a daily-game round closes.', audience: 'all' },
  { type: 'sound_relic_deploy', label: 'Relic Deployed', description: 'Plays when a player uses a game or quiz relic.', audience: 'all' },
  { type: 'sound_relic_reveal', label: 'Relic Reveal', description: 'Plays when a relic reveals an answer or reference.', audience: 'all' },
  { type: 'sound_arena_lobby', label: 'Arena Lobby', description: 'Loops in the Arena room space.', audience: 'all' },
  { type: 'sound_arena_start', label: 'Arena Start', description: 'Plays when an Arena battle starts.', audience: 'all' },
  { type: 'sound_arena_round', label: 'Arena Round', description: 'Plays as a new Arena round begins.', audience: 'all' },
  { type: 'sound_arena_finish', label: 'Arena Finish', description: 'Plays when an Arena result is ready.', audience: 'all' },
  { type: 'sound_quiz_waiting', label: 'Quiz Waiting Room', description: 'Loops while waiting for a quiz.', audience: 'all' },
  { type: 'sound_quiz_start', label: 'Quiz Start', description: 'Plays when a quiz begins.', audience: 'all' },
  { type: 'sound_quiz_finish', label: 'Quiz Finish', description: 'Plays after quiz submission or completion.', audience: 'all' },
  { type: 'sound_streak', label: 'Streak Update', description: 'Plays when a streak increases or is protected.', audience: 'all' },
  { type: 'sound_challenge', label: 'Challenge Update', description: 'Plays for challenge approval and progress notifications.', audience: 'all' },
  { type: 'sound_board', label: 'Challenge Boards', description: 'Loops during board visits and rank viewing.', audience: 'all' },
  { type: 'sound_award', label: 'Award Received', description: 'Plays for awards and achievements.', audience: 'all' },
  { type: 'sound_market', label: 'Market', description: 'Loops while browsing the market.', audience: 'all' },
  { type: 'sound_purchase_success', label: 'Purchase Confirmed', description: 'Plays after a confirmed purchase.', audience: 'all' },
  { type: 'sound_purchase_failed', label: 'Purchase Needs Retry', description: 'Plays when a purchase is rejected or fails.', audience: 'all' },
  { type: 'sound_notification', label: 'Notification', description: 'Plays for a new general notification.', audience: 'all' },
  { type: 'sound_message', label: 'Tent Message', description: 'Plays for a new direct or tent message.', audience: 'all' },
];

const IMAGE_ADJUSTMENT_CONTROLS: {
  key: keyof PanelImageAdjustments;
  label: string;
  min: number;
  max: number;
  suffix?: string;
}[] = [
  { key: 'opacity', label: 'Transparency', min: 0, max: 100, suffix: '%' },
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, suffix: '%' },
  { key: 'contrast', label: 'Contrast', min: 0, max: 200, suffix: '%' },
  { key: 'blackPoint', label: 'Black Point', min: 0, max: 100, suffix: '%' },
  { key: 'whitePoint', label: 'White Point', min: 0, max: 100, suffix: '%' },
  { key: 'black', label: 'Black', min: 0, max: 100, suffix: '%' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 200, suffix: '%' },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'hue', label: 'Hue', min: -180, max: 180, suffix: 'deg' },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100, suffix: '%' },
  { key: 'definition', label: 'Definition', min: 0, max: 100, suffix: '%' },
  { key: 'noise', label: 'Noise', min: 0, max: 100, suffix: '%' },
  { key: 'depth', label: 'Depth', min: 0, max: 100, suffix: '%' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, suffix: '%' },
  { key: 'grain', label: 'Graininess', min: 0, max: 100, suffix: '%' },
  { key: 'age', label: 'Age Feel', min: 0, max: 100, suffix: '%' },
];

function ImageAdjustmentSlider({
  control,
  value,
  onChange,
}: {
  control: (typeof IMAGE_ADJUSTMENT_CONTROLS)[number];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="flex items-center justify-between text-xs font-semibold text-ink">
        {control.label}
        <span className="text-stone">{value}{control.suffix || ''}</span>
      </span>
      <input
        type="range"
        min={control.min}
        max={control.max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-brass"
      />
    </label>
  );
}

function AnnouncementManager() {
  const [announcements, setAnnouncements] = useState<ScheduledAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [announcementType, setAnnouncementType] = useState('general');
  const [audience, setAudience] = useState('all');
  const [publishAt, setPublishAt] = useState(toDateTimeLocal(new Date().toISOString()));
  const [content, setContent] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [editingImageType, setEditingImageType] = useState<string | null>(null);
  const [imagePositionX, setImagePositionX] = useState(50);
  const [imagePositionY, setImagePositionY] = useState(50);
  const [uploadingImageType, setUploadingImageType] = useState<string | null>(null);
  const [uploadingSoundType, setUploadingSoundType] = useState<string | null>(null);
  const [savingImagePosition, setSavingImagePosition] = useState(false);
  const [imageAdjustments, setImageAdjustments] = useState<PanelImageAdjustments>(DEFAULT_PANEL_IMAGE_ADJUSTMENTS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAnnouncements(await fetchAllAnnouncements());
    } catch (e) {
      console.error('Announcement load error:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setAnnouncementType('general');
    setAudience('all');
    setPublishAt(toDateTimeLocal(new Date().toISOString()));
    setContent('');
    setIsActive(true);
  };

  const edit = (announcement: ScheduledAnnouncement) => {
    setEditingId(announcement.id);
    setAnnouncementType(announcement.announcement_type || 'general');
    setAudience(announcement.audience || 'all');
    setPublishAt(toDateTimeLocal(announcement.publish_at));
    setContent(announcement.content || '');
    setIsActive(announcement.is_active !== false);
  };

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    const payload = {
      announcement_type: announcementType,
      audience,
      publish_at: appDateTimeLocalToISOString(publishAt),
      content: content.trim(),
      is_active: isActive,
    };
    try {
      if (editingId) await updateAnnouncement(editingId, payload);
      else await createAnnouncement(payload);
      resetForm();
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to save announcement');
    }
    setSaving(false);
  };

  const publishImageSetting = async (
    type: string,
    imageUrl: string,
    targetAudience = 'all',
    positionX = 50,
    positionY = 50,
    adjustments: PanelImageAdjustments = DEFAULT_PANEL_IMAGE_ADJUSTMENTS,
  ) => {
    const payload = {
      announcement_type: type,
      audience: targetAudience,
      publish_at: new Date().toISOString(),
      content: serializePanelImageSetting(imageUrl, adjustments),
      is_active: true,
      image_position_x: positionX,
      image_position_y: positionY,
    };
    await savePanelImageSetting({
      announcementType: type,
      audience: targetAudience,
      content: payload.content,
      publishAt: payload.publish_at,
      positionX,
      positionY,
    });
    setAnnouncementType(type);
    setAudience(targetAudience);
    setPublishAt(toDateTimeLocal(payload.publish_at));
    setContent(imageUrl);
    setIsActive(true);
    await load();
  };

  const deleteImageSetting = async (type: string, targetAudience = 'all') => {
    const matches = announcements.filter((announcement) =>
      announcement.announcement_type === type && announcement.audience === targetAudience
    );
    if (matches.length === 0) return;
    if (!window.confirm('Delete this saved image from the app?')) return;
    try {
      await Promise.all(matches.map((announcement) => deleteAnnouncement(announcement.id)));
      if (announcementType === type && audience === targetAudience) resetForm();
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to delete image setting');
    }
  };

  const activeImageSettings = PANEL_IMAGE_SLOTS.map((slot) => ({
    ...slot,
    item: announcements.find((announcement) =>
      announcement.announcement_type === slot.type
      && announcement.audience === slot.audience
      && announcement.is_active !== false
      && isPanelImageContent(announcement.content)
    ),
  })).map((setting) => ({
    ...setting,
    image: setting.item ? panelImageFromAnnouncement(setting.item) : null,
  }));

  const editingImageSetting = activeImageSettings.find((setting) => setting.type === editingImageType) || null;
  const standardAnnouncements = announcements.filter((announcement) =>
    announcement.announcement_type !== 'weekly_background'
    && !announcement.announcement_type?.startsWith('panel_image_')
    && !announcement.announcement_type?.startsWith('sound_')
  );

  const activeSoundSettings = SOUND_SLOTS.map((slot) => ({
    ...slot,
    item: announcements.find((announcement) =>
      announcement.announcement_type === slot.type
      && announcement.audience === slot.audience
      && announcement.is_active !== false
      && !!announcement.content
    ),
  }));

  const openImageEditor = (type: string) => {
    const setting = activeImageSettings.find((candidate) => candidate.type === type);
    setEditingImageType(type);
    setImagePositionX(Number(setting?.item?.image_position_x ?? 50));
    setImagePositionY(Number(setting?.item?.image_position_y ?? 50));
    setImageAdjustments(normaliseAdjustments(setting?.image?.adjustments));
  };

  const uploadImage = async (file: File, type: string, targetAudience = 'all') => {
    setUploadingImageType(type);
    try {
      const prepared = await prepareImageUpload(file, { maxDimension: 2400, maxBytes: 12 * 1024 * 1024 });
      const version = Date.now();
      const safeType = type.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw authError || new Error('Please sign in again before uploading an image.');
      const folder = type === 'weekly_background' ? 'weekly-backgrounds' : 'panel-images';
      // Shared panel assets use a dedicated top-level folder. Storage RLS
      // deliberately distinguishes these instructor-managed files from the
      // user's personal avatar folder.
      const path = `${folder}/${authData.user.id}/${safeType}-${version}.${prepared.extension}`;
      const { error } = await supabase.storage.from('avatars').upload(path, prepared.file, { upsert: true, contentType: prepared.file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await publishImageSetting(type, `${data.publicUrl}?v=${version}`, targetAudience, imagePositionX, imagePositionY, imageAdjustments);
    } catch (e: any) {
      alert(e.message || 'Failed to upload panel image');
    }
    setUploadingImageType(null);
  };

  const uploadSound = async (file: File, type: string, targetAudience = 'all') => {
    setUploadingSoundType(type);
    try {
      if (!file.type.startsWith('audio/')) throw new Error('Please choose an audio file.');
      if (file.size > 15 * 1024 * 1024) throw new Error('Sound files must be 15 MB or smaller.');
      const ext = file.name.split('.').pop() || 'mp3';
      const version = Date.now();
      const path = `sound-assets/${type.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}-${version}.${ext}`;
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const payload = {
        announcement_type: type,
        audience: targetAudience,
        publish_at: new Date().toISOString(),
        content: `${data.publicUrl}?v=${version}`,
        is_active: true,
      };
      const existing = announcements.find((announcement) => announcement.announcement_type === type && announcement.audience === targetAudience);
      if (existing) await updateAnnouncement(existing.id, payload);
      else await createAnnouncement(payload);
      if (type.startsWith('sound_')) invalidateSoundAsset(type);
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to upload sound');
    }
    setUploadingSoundType(null);
  };

  const deleteSound = async (type: string, targetAudience = 'all') => {
    const rows = announcements.filter((announcement) => announcement.announcement_type === type && announcement.audience === targetAudience);
    if (rows.length === 0 || !window.confirm('Remove this sound from the app?')) return;
    try {
      await Promise.all(rows.map((row) => deleteAnnouncement(row.id)));
      if (type.startsWith('sound_')) invalidateSoundAsset(type);
      await load();
    }
    catch (e: any) { alert(e.message || 'Failed to remove sound'); }
  };

  const cropSound = async (setting: { type: string; audience: string; item?: ScheduledAnnouncement }) => {
    if (!setting.item) return;
    const startInput = window.prompt('Start at which second?', String(setting.item.audio_start_seconds || 0));
    if (startInput === null) return;
    const endInput = window.prompt('End at which second? Leave blank to play to the end.', setting.item.audio_end_seconds == null ? '' : String(setting.item.audio_end_seconds));
    if (endInput === null) return;
    const start = Math.max(0, Number(startInput) || 0);
    const end = endInput.trim() ? Number(endInput) : null;
    if (end !== null && (!Number.isFinite(end) || end <= start)) {
      alert('The end must be a number greater than the start.');
      return;
    }
    try {
      await updateAnnouncement(setting.item.id, {
        audio_start_seconds: start,
        audio_end_seconds: end,
      } as Partial<ScheduledAnnouncement>);
      invalidateSoundAsset(setting.type);
      await load();
    } catch (error: any) {
      alert(error.message || 'Could not save the sound crop.');
    }
  };

  const saveImageFraming = async () => {
    if (!editingImageSetting?.item) return;
    setSavingImagePosition(true);
    try {
      await updateAnnouncement(editingImageSetting.item.id, {
        content: serializePanelImageSetting(editingImageSetting.image?.url || '', imageAdjustments),
        image_position_x: imagePositionX,
        image_position_y: imagePositionY,
      });
      await load();
      setEditingImageType(null);
    } catch (e: any) {
      alert(e.message || 'Failed to save image framing');
    }
    setSavingImagePosition(false);
  };

  const toggleActive = async (announcement: ScheduledAnnouncement) => {
    try {
      await updateAnnouncement(announcement.id, { is_active: !announcement.is_active });
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to update announcement');
    }
  };

  const remove = async (announcement: ScheduledAnnouncement) => {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await deleteAnnouncement(announcement.id);
      await load();
      if (editingId === announcement.id) resetForm();
    } catch (e: any) {
      alert(e.message || 'Failed to delete announcement');
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Announcements" subtitle="Schedule dashboard slideshow notices for cadets, sentries, or everyone." />

      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brass/15 text-brass">
              <Cake size={22} />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-ink">Hey Everyone Birthday Panel</h3>
              <p className="text-sm text-stone">
                The app automatically posts birthday slides for the day. Add or replace the birthday image here, or write a special Hey Everyone birthday notice.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openImageEditor('panel_image_birthday')} className="btn-secondary text-xs">
              <ImageIcon size={14} />
              Birthday Image
            </button>
            <button type="button" onClick={() => {
              setEditingId(null);
              setAnnouncementType('birthday');
              setAudience('all');
              setPublishAt(toDateTimeLocal(new Date().toISOString()));
              setContent('');
              setIsActive(true);
            }} className="btn-primary text-xs">
              <Megaphone size={14} />
              Birthday Post
            </button>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-stone block mb-1">Type</label>
            <select className="input-field" value={announcementType} onChange={(e) => setAnnouncementType(e.target.value)}>
              <option value="general">General</option>
              <option value="morning_call">Morning Call</option>
              <option value="midday_reminder">Midday Reminder</option>
              <option value="evening_reminder">Evening Reminder</option>
              <option value="quote_of_day">Quote of the Day</option>
              <option value="birthday">Birthday</option>
              <option value="streakboard_release">Streakboard Release</option>
              <option value="weekly_background">Weekly Background Image</option>
              <option value="panel_image_welcome">Panel Image: Welcome</option>
              <option value="panel_image_verse">Panel Image: Verse</option>
              <option value="panel_image_announcement">Panel Image: Announcement</option>
              <option value="panel_image_birthday">Panel Image: Birthday</option>
              <option value="panel_image_quote">Panel Image: Quote</option>
              <option value="panel_image_market">Panel Image: Market</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-stone block mb-1">Audience</label>
            <select className="input-field" value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="all">Everyone</option>
              <option value="cadets">Cadets</option>
              <option value="sentries">Sentries</option>
              <option value="instructors">Instructors</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-stone block mb-1">Publish time</label>
            <input type="datetime-local" className="input-field" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="text-xs text-stone block mb-1">Announcement text</label>
          <textarea
            className="input-field min-h-[110px]"
            placeholder={announcementType === 'weekly_background' ? 'Upload an image below; the image URL will appear here.' : 'Write the notice that should appear in the dashboard slideshow...'}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <label className="text-xs font-semibold text-ink">Panel Images</label>
              <p className="text-[10px] text-stone">Click any panel to add, replace, crop, or tune its image.</p>
            </div>
            <span className="badge badge-neutral text-[10px]">{activeImageSettings.length} panels</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {activeImageSettings.map((setting) => (
              <div key={`${setting.type}:${setting.audience}`} className="relative overflow-hidden rounded-lg border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => openImageEditor(setting.type)}
                  className="group block w-full text-left"
                  title={`Edit ${setting.label}`}
                >
                  <div className="relative h-28 overflow-hidden bg-surface-2">
                    {setting.image ? (
                      <PanelImageBackdrop
                        image={setting.image}
                        className="transition-transform duration-200 group-hover:scale-[1.02]"
                        opacityFallback={100}
                        veilClassName=""
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center border-b border-dashed border-border text-stone">
                        <ImageIcon size={26} strokeWidth={1.5} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-ink/0 transition-colors group-hover:bg-ink/10" />
                  </div>
                  <div className="flex items-center justify-between gap-2 p-3">
                    <span className="text-xs font-semibold text-ink">{setting.label}</span>
                    <span className="text-[10px] font-semibold text-brass">
                      {setting.item ? 'Edit image' : 'Add image'}
                    </span>
                  </div>
                </button>
                {setting.item && (
                  <button
                    type="button"
                    onClick={() => deleteImageSetting(setting.type, setting.audience)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border border-white/30 bg-black/55 text-white transition-colors hover:bg-coral"
                    title={`Delete ${setting.label}`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-stone mt-2">
            Images appear almost translucent behind text. Uploading a new image creates an editable active image setting you can update any time.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <label className="text-xs font-semibold text-ink">Sound Assignments</label>
              <p className="text-[10px] text-stone">Instructor-only audio library. Each sound is connected to its matching screen or event. Upload MP3, M4A, WAV, or OGG.</p>
            </div>
            <Music2 size={17} className="text-brass" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {activeSoundSettings.map((setting) => (
              <div key={setting.type} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start gap-2">
                  <Volume2 size={17} className="mt-0.5 flex-shrink-0 text-peri" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><p className="text-xs font-semibold text-ink">{setting.label}</p><span className="badge badge-moss text-[9px]">Live</span></div>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-stone">{setting.description}</p>
                    {setting.item && <audio className="mt-2 h-8 w-full" controls src={setting.item.content} />}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <label className={cn('btn-secondary cursor-pointer px-2 py-1 text-[11px]', uploadingSoundType === setting.type && 'pointer-events-none opacity-60')}>
                        {uploadingSoundType === setting.type ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        {setting.item ? 'Replace' : 'Upload'}
                        <input type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/*" className="hidden" onChange={(event) => {
                          const file = event.target.files?.[0]; event.target.value = '';
                          if (file) void uploadSound(file, setting.type, setting.audience);
                        }} />
                      </label>
                      {setting.item && <button type="button" onClick={() => cropSound(setting)} className="btn-ghost px-2 py-1 text-[11px]"><Clock size={13} /> Trim</button>}
                      {setting.item && <button type="button" onClick={() => deleteSound(setting.type, setting.audience)} className="btn-ghost px-2 py-1 text-[11px] text-coral"><Trash2 size={13} /> Remove</button>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-stone">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-peri" />
            Active
          </label>
          <div className="flex gap-2">
            {editingId && <button onClick={resetForm} className="btn-secondary text-sm">Cancel Edit</button>}
            <button onClick={save} disabled={saving || !content.trim()} className="btn-primary text-sm">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editingId ? 'Save Changes' : 'Schedule Announcement'}
            </button>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h4 className="font-display font-semibold text-ink mb-3">Scheduled & Published</h4>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-brass" /></div>
        ) : standardAnnouncements.length === 0 ? (
          <EmptyState icon={Megaphone} title="No announcements yet" message="Create one above to place it in the dashboard slideshow." />
        ) : (
          <div className="space-y-2">
            {standardAnnouncements.map((announcement) => {
              const published = new Date(announcement.publish_at).getTime() <= Date.now();
              const associatedImage = activeImageSettings.find((setting) =>
                setting.type === `panel_image_${announcement.announcement_type}` && setting.audience === announcement.audience
              )?.image || activeImageSettings.find((setting) =>
                setting.type === `panel_image_${announcement.announcement_type}` && setting.audience === 'all'
              )?.image || activeImageSettings.find((setting) =>
                setting.type === 'panel_image_announcement' && setting.audience === 'all'
              )?.image || null;
              return (
                <div key={announcement.id} className="rounded-lg border border-border-bright bg-surface-2 p-3 flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Megaphone size={18} className={cn('mt-0.5 flex-shrink-0', announcement.is_active ? 'text-brass' : 'text-stone')} />
                    {associatedImage && (
                      <div className="relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-md border border-border bg-surface">
                        <PanelImageBackdrop image={associatedImage} opacityFallback={100} veilClassName="" />
                      </div>
                    )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      <span className="badge badge-neutral text-[10px]">{announcement.announcement_type.replace(/_/g, ' ')}</span>
                      <span className="badge badge-peri text-[10px]">{announcement.audience}</span>
                      <span className={cn('badge text-[10px]', announcement.is_active ? 'badge-moss' : 'badge-neutral')}>
                        {announcement.is_active ? 'Active' : 'Paused'}
                      </span>
                      <span className={cn('badge text-[10px]', published ? 'badge-gold' : 'badge-neutral')}>
                        {published ? 'Published' : 'Scheduled'}
                      </span>
                    </div>
                    <p className="text-sm text-ink whitespace-pre-wrap">{announcement.content}</p>
                    <p className="text-xs text-stone mt-1">{new Date(announcement.publish_at).toLocaleString()}</p>
                  </div>
                  </div>
                  <div className="flex flex-row sm:flex-col gap-1.5 flex-shrink-0">
                    <button onClick={() => edit(announcement)} className="btn-ghost text-[10px] px-2 py-1">Edit</button>
                    <button onClick={() => toggleActive(announcement)} className="btn-ghost text-[10px] px-2 py-1">
                      {announcement.is_active ? 'Pause' : 'Activate'}
                    </button>
                    <button onClick={() => remove(announcement)} className="text-stone hover:text-coral transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editingImageSetting && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-3 sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingImageType(null);
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="eyebrow text-stone">Panel Image</p>
                <h3 className="font-display text-lg font-semibold text-ink">{editingImageSetting.label}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingImageType(null)}
                className="btn-ghost flex h-9 w-9 items-center justify-center p-0"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[calc(92vh-68px)] space-y-4 overflow-y-auto p-4 sm:p-5">
              <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-border bg-surface-2">
                {editingImageSetting.image ? (
                  <>
                    <PanelImageBackdrop
                      image={{
                        ...editingImageSetting.image,
                        positionX: imagePositionX,
                        positionY: imagePositionY,
                        adjustments: imageAdjustments,
                      }}
                      opacityFallback={100}
                      veilClassName=""
                    />
                    <div
                      className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/35 shadow"
                      style={{ left: `${imagePositionX}%`, top: `${imagePositionY}%` }}
                    />
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-stone">
                    <ImageIcon size={36} strokeWidth={1.4} />
                    <span className="text-sm">No image saved</span>
                  </div>
                )}
                {uploadingImageType === editingImageSetting.type && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
                    <Loader2 size={28} className="animate-spin" />
                  </div>
                )}
              </div>

              {editingImageSetting.item && (
                <div className="space-y-4 rounded-lg border border-border bg-surface-2 p-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="flex items-center justify-between text-xs font-semibold text-ink">
                        Horizontal position <span className="text-stone">{imagePositionX}%</span>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={imagePositionX}
                        onChange={(event) => setImagePositionX(Number(event.target.value))}
                        className="w-full accent-brass"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="flex items-center justify-between text-xs font-semibold text-ink">
                        Vertical position <span className="text-stone">{imagePositionY}%</span>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={imagePositionY}
                        onChange={(event) => setImagePositionY(Number(event.target.value))}
                        className="w-full accent-brass"
                      />
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-ink">Image Adjustments</p>
                    <button
                      type="button"
                      onClick={() => setImageAdjustments(DEFAULT_PANEL_IMAGE_ADJUSTMENTS)}
                      className="btn-ghost px-2 py-1 text-[11px]"
                    >
                      <RotateCcw size={12} /> Reset
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {IMAGE_ADJUSTMENT_CONTROLS.map((control) => (
                      <ImageAdjustmentSlider
                        key={control.key}
                        control={control}
                        value={imageAdjustments[control.key]}
                        onChange={(value) => setImageAdjustments((prev) => normaliseAdjustments({ ...prev, [control.key]: value }))}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  <label
                    className={cn(
                      'btn-secondary cursor-pointer text-sm',
                      uploadingImageType === editingImageSetting.type && 'pointer-events-none opacity-60',
                    )}
                  >
                    {uploadingImageType === editingImageSetting.type ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    {editingImageSetting.item ? 'Replace image' : 'Add image'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingImageType === editingImageSetting.type}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void uploadImage(file, editingImageSetting.type, editingImageSetting.audience);
                      }}
                    />
                  </label>
                  {editingImageSetting.item && (
                    <button
                      type="button"
                      onClick={() => deleteImageSetting(editingImageSetting.type, editingImageSetting.audience)}
                      className="btn-secondary text-sm text-coral"
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  )}
                </div>
                {editingImageSetting.item && (
                  <button
                    type="button"
                    onClick={saveImageFraming}
                    disabled={savingImagePosition}
                    className="btn-primary text-sm"
                  >
                    {savingImagePosition ? <Loader2 size={15} className="animate-spin" /> : <Move size={15} />}
                    Save image
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NarrativesTab({ narratives, editingNarrative, onSelectNarrative, onDone }: {
  narratives: DailyNarrative[];
  editingNarrative: NarrativeSelection;
  onSelectNarrative: (n: NarrativeSelection) => void;
  onDone: () => void;
}) {
  if (editingNarrative !== null) {
    const republish = isRepublishSelection(editingNarrative);
    return (
      <NarrativeEditor
        narrative={editingNarrative === 'new' ? null : republish ? editingNarrative.narrative : editingNarrative}
        republishMode={republish}
        onDone={onDone}
      />
    );
  }
  const today = getTodayISODate();
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <SectionHeader title="Narratives" subtitle="Daily scripture readings and game content" />
        <button onClick={() => onSelectNarrative('new')} className="btn-primary text-sm">
          <Plus size={16} /> New Narrative
        </button>
      </div>
      {narratives.length === 0 ? (
        <EmptyState icon={BookOpen} title="No narratives yet" message="Create the first daily narrative to unlock games and readings for cadets." />
      ) : (
        <div className="space-y-2">
          {narratives.map((n) => {
            const isScheduled = n.narrative_date > today;
            const isToday = n.narrative_date === today;
            return (
              <div key={n.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-ink truncate">{n.title}</p>
                    <span className={cn('badge text-[10px]', isScheduled ? 'badge-gold' : 'badge-moss')}>
                      {isScheduled ? 'Scheduled' : isToday ? 'Today' : 'Published'}
                    </span>
                  </div>
                  <p className="text-xs text-stone">{n.narrative_date} · {n.scripture_reference} · {n.translation}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!isToday && (
                    <button onClick={() => onSelectNarrative({ mode: 'republish', narrative: n })} className="btn-primary text-xs">
                      <RotateCcw size={12} /> Republish Today
                    </button>
                  )}
                  <button onClick={() => onSelectNarrative(n)} className="btn-secondary text-xs">
                    {isScheduled ? 'Edit Schedule' : 'Edit'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function InstructorDashboard({ tents, members, roles, narratives, instructorId, onNavigate }: {
  tents: any[]; members: any[]; roles: RoleAssignment[]; narratives: DailyNarrative[];
  instructorId: string | null;
  onNavigate: (k: string) => void;
}) {
  const cadetCount = roles.filter((r) => r.role === 'cadet' && r.status === 'active').length;
  const sentryCount = roles.filter((r) => r.role === 'sentry' && r.status === 'active').length;
  const todayNarrative = narratives.find((n) => n.narrative_date === getTodayISODate());
  const [quotes, setQuotes] = useState<DailyQuoteFeedItem[]>([]);
  const [quoteReactions, setQuoteReactions] = useState<Record<string, QuoteReactionState>>({});
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [quotePaused, setQuotePaused] = useState(false);
  const [endOfDayStats, setEndOfDayStats] = useState<{ records: number; attendance: number; meditations: number; streaks: number; challenges: number } | null>(null);
  const [morningCall, setMorningCall] = useState<{ userId: string; name: string; avatarUrl: string | null; tentName: string; status: 'present' | 'absent' | 'unmarked'; late: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchDailyQuoteFeed(6)
      .then(async (items) => {
        if (cancelled) return;
        setQuotes(items);
        setQuoteIndex(0);
        if (instructorId) {
          const reactions = await fetchDailyQuoteReactions(items, instructorId).catch(() => ({}));
          if (!cancelled) setQuoteReactions(reactions as Record<string, QuoteReactionState>);
        }
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [instructorId]);

  useEffect(() => {
    if (quotes.length <= 1 || quotePaused) return;
    const interval = window.setInterval(() => {
      setQuoteIndex((index) => (index + 1) % quotes.length);
    }, 6000);
    return () => window.clearInterval(interval);
  }, [quotePaused, quotes.length]);

  useEffect(() => {
    const cadetIds = roles.filter((role) => role.role === 'cadet' && role.status === 'active').map((role) => role.user_id);
    if (cadetIds.length === 0) { setMorningCall([]); return; }
    let cancelled = false;
    const loadMorningCall = async () => {
      const today = getTodayISODate();
      const { data } = await supabase
        .from('daily_records')
        .select('user_id,attendance_status,attendance_late')
        .eq('record_date', today)
        .in('user_id', cadetIds);
      if (cancelled) return;
      const records = new Map((data || []).map((record: any) => [record.user_id, record]));
      setMorningCall(cadetIds.map((userId) => {
        const member = members.find((item) => item.user_id === userId && item.role === 'cadet');
        const record = records.get(userId);
        return {
          userId,
          name: member?.profiles?.display_name || 'Cadet',
          avatarUrl: member?.profiles?.avatar_url || null,
          tentName: tents.find((tent) => tent.id === member?.tent_id)?.name || 'Unassigned tent',
          status: record?.attendance_status === 'present' || record?.attendance_status === 'absent' ? record.attendance_status : 'unmarked',
          late: Boolean(record?.attendance_late),
        };
      }));
    };
    void loadMorningCall();
    const interval = window.setInterval(loadMorningCall, 30_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [members, roles, tents]);

  useEffect(() => {
    const loadEndOfDayStats = async () => {
      if (getAppClock().hour < 20) {
        setEndOfDayStats(null);
        return;
      }
      const today = getTodayISODate();
      const [{ data: records }, { data: challenges }] = await Promise.all([
        supabase.from('daily_records').select('attendance_status, meditation_submitted, streak_valid').eq('record_date', today),
        supabase.from('challenge_submissions').select('id').eq('narrative_date', today),
      ]);
      const dailyRecords = records || [];
      setEndOfDayStats({
        records: dailyRecords.length,
        attendance: dailyRecords.filter((record) => record.attendance_status === 'present').length,
        meditations: dailyRecords.filter((record) => record.meditation_submitted).length,
        streaks: dailyRecords.filter((record) => record.streak_valid).length,
        challenges: (challenges || []).length,
      });
    };
    void loadEndOfDayStats().catch(() => setEndOfDayStats(null));
    const interval = window.setInterval(() => {
      void loadEndOfDayStats().catch(() => setEndOfDayStats(null));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const featuredQuote = quotes[quoteIndex % Math.max(quotes.length, 1)];
  const markedMorningCall = morningCall.filter((item) => item.status !== 'unmarked');
  const presentMorningCall = markedMorningCall.filter((item) => item.status === 'present');
  const absentMorningCall = markedMorningCall.filter((item) => item.status === 'absent');
  const isWeekday = getDayType(new Date()) === 'weekday';

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox icon={Users} label="Cadets" value={cadetCount} tint="text-peri-2" />
        <StatBox icon={Shield} label="Sentries" value={sentryCount} tint="text-sage" />
        <StatBox icon={TentIcon} label="Tents" value={tents.length} tint="text-gold" />
        <StatBox icon={BookOpen} label="Narratives" value={narratives.length} tint="text-roman" />
      </div>

      <RecentAwardsPanel onOpen={() => onNavigate('awards')} />

      <MeditationHistoryPanel
        title="Everyone’s Meditation History"
        showWeeklyVerse
      />

      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="eyebrow">End-of-Day Summary</p>
            <p className="text-xs text-stone mt-1">Available from 8:00 PM</p>
          </div>
          <CheckCircle2 size={20} className="text-moss" />
        </div>
        {endOfDayStats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <SummaryMetric label="Records" value={endOfDayStats.records} />
            <SummaryMetric label="Present" value={endOfDayStats.attendance} />
            <SummaryMetric label="Meditations" value={endOfDayStats.meditations} />
            <SummaryMetric label="Streaks" value={endOfDayStats.streaks} />
            <SummaryMetric label="Challenges" value={endOfDayStats.challenges} />
          </div>
        ) : (
          <p className="text-sm text-stone">Today’s summary will appear here at 8:00 PM.</p>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-ink">Morning Call</h3>
            <p className="mt-1 text-xs text-stone">Live attendance for {formatShortDate(getTodayISODate())}</p>
          </div>
          <UserCheck size={20} className="text-moss" />
        </div>
        {!isWeekday ? (
          <p className="text-sm text-stone">Morning call attendance is not required today.</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <SummaryMetric label="Present" value={presentMorningCall.length} />
              <SummaryMetric label="Absent" value={absentMorningCall.length} />
              <SummaryMetric label="Unmarked" value={morningCall.length - markedMorningCall.length} />
            </div>
            {markedMorningCall.length === 0 ? <p className="text-sm text-stone">No cadets have been marked yet.</p> : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-2">
                {markedMorningCall.map((item) => (
                  <div key={item.userId} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-peri-soft text-xs font-bold text-peri">
                      {item.avatarUrl ? <img src={item.avatarUrl} alt="" className="h-full w-full object-cover" /> : item.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{item.name}</p><p className="truncate text-xs text-stone">{item.tentName}</p></div>
                    <span className={cn('badge text-[10px]', item.status === 'present' ? 'badge-moss' : 'badge-roman')}>
                      {item.status === 'present' ? `Present${item.late ? ' · late' : ''}` : 'Absent'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card p-4">
        <h3 className="font-display font-semibold text-ink mb-3">Today's Narrative</h3>
        {todayNarrative ? (
          <div className="space-y-1">
            <p className="text-sm text-ink">{todayNarrative.title}</p>
            <p className="text-xs text-stone">{todayNarrative.scripture_reference}</p>
          </div>
        ) : (
          <p className="text-sm text-stone">No narrative set for today.</p>
        )}
        <button onClick={() => onNavigate('narratives')} className="btn-ghost text-xs mt-3">
          <BookOpen size={14} /> Manage narratives
        </button>
      </div>

      {featuredQuote && (
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-full overflow-hidden bg-surface-2 border border-border flex-shrink-0 flex items-center justify-center">
              {featuredQuote.avatar_url ? (
                <img src={featuredQuote.avatar_url} alt={featuredQuote.display_name} className="h-full w-full object-cover" />
              ) : (
                <span className="font-display font-bold text-brass">{featuredQuote.display_name?.charAt(0) || '?'}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow mb-1">Quote Feed</p>
              <p className="text-base text-ink font-display leading-snug">"{featuredQuote.daily_quote}"</p>
              <p className="text-xs text-stone mt-1">{featuredQuote.display_name}</p>
              {quotes.length > 1 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <button onClick={() => setQuoteIndex((idx) => (idx - 1 + quotes.length) % quotes.length)} className="btn-ghost text-xs px-2 py-1">Prev</button>
                  <span className="text-[10px] text-stone">{quoteIndex + 1}/{quotes.length}</span>
                  <button onClick={() => setQuoteIndex((idx) => (idx + 1) % quotes.length)} className="btn-ghost text-xs px-2 py-1">Next</button>
                </div>
              )}
              <QuoteReactions
                state={quoteReactions[`${featuredQuote.user_id}:${featuredQuote.record_date}`]}
                disabled={!instructorId}
                onReact={async (reactionType) => {
                  if (!instructorId) return;
                  await reactToDailyQuote(featuredQuote.user_id, featuredQuote.record_date, instructorId, reactionType);
                  setQuoteReactions(await fetchDailyQuoteReactions(quotes, instructorId).catch(() => quoteReactions) as Record<string, QuoteReactionState>);
                }}
                quoteUserId={featuredQuote.user_id}
                quoteRecordDate={featuredQuote.record_date}
                currentUserId={instructorId || undefined}
                fetchComments={fetchDailyQuoteComments}
                onComment={(body) => instructorId
                  ? commentOnDailyQuote(featuredQuote.user_id, featuredQuote.record_date, instructorId, body)
                  : Promise.resolve()}
                onCommentOpenChange={setQuotePaused}
              />
            </div>
          </div>
        </div>
      )}

      <SectionHeader title="Tents Overview" subtitle="Quick view of tent membership" />
      <div className="grid sm:grid-cols-2 gap-3">
        {tents.map((t) => {
          const tentMembers = members.filter((m) => m.tent_id === t.id);
          const cadets = tentMembers.filter((m) => m.role === 'cadet');
          return (
            <div key={t.id} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                {t.tent_houses && <TentHouseBadge houseId={t.tent_houses.id} size="sm" />}
                <h4 className="font-display font-semibold text-ink text-sm flex-1">{t.name}</h4>
              </div>
              <p className="text-xs text-stone">{cadets.length}/5 cadets</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <p className="text-lg font-bold text-ink">{value}</p>
      <p className="text-[10px] text-stone">{label}</p>
    </div>
  );
}

function StatBox({ icon: Icon, label, value, tint }: { icon: any; label: string; value: number; tint: string }) {
  return (
    <div className="card p-4">
      <Icon size={20} className={tint} />
      <p className="text-2xl font-display font-bold text-ink mt-2">{value}</p>
      <p className="text-xs text-stone">{label}</p>
    </div>
  );
}

function TentJoinRequests({ onRefresh }: { onRefresh: () => void }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tent_join_requests')
      .select('id,created_at,user_id,tent_id,profiles(display_name,avatar_url),tents(name)')
      .eq('status', 'pending').order('created_at');
    if (!error) setRequests(data || []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const review = async (id: string, approve: boolean) => {
    setReviewing(id);
    const { error } = await supabase.rpc('review_tent_join_request', { p_request_id: id, p_approve: approve });
    setReviewing(null);
    if (error) return alert(error.message);
    await load();
    onRefresh();
  };
  if (requests.length === 0) return null;
  return <section className="card mb-5 p-5">
    <SectionHeader title="Tent Join Requests" subtitle="Approve cadets until each tent reaches ten cadets plus its sentry." />
    <div className="mt-4 space-y-2">{requests.map((request) => <div key={request.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-peri-soft font-bold text-ink">{request.profiles?.avatar_url ? <img src={request.profiles.avatar_url} alt="" className="h-full w-full object-cover" /> : request.profiles?.display_name?.charAt(0)}</div>
      <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{request.profiles?.display_name}</p><p className="text-xs text-stone">requests {request.tents?.name}</p></div>
      <button type="button" onClick={() => void review(request.id, true)} disabled={reviewing === request.id} className="icon-btn text-sage" title="Approve"><Check size={16} /></button>
      <button type="button" onClick={() => void review(request.id, false)} disabled={reviewing === request.id} className="icon-btn text-coral" title="Reject"><X size={16} /></button>
    </div>)}</div>
  </section>;
}

function TentManagement({ tents, members, profiles, roles, onRefresh, loading }: {
  tents: (Tent & { tent_houses: any })[];
  members: (TentMember & { profiles: Profile })[];
  profiles: Profile[];
  roles: RoleAssignment[];
  onRefresh: () => void;
  loading: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newHouse, setNewHouse] = useState('squares');
  const [newSentry, setNewSentry] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const availableSentries = roles
    .filter((r) => r.role === 'sentry' && r.status === 'active')
    .filter((r) => !members.some((m) => m.user_id === r.user_id && m.role === 'sentry'));

  const createTent = async () => {
    if (!newName || !newSentry) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('tents')
      .insert({ name: newName, tent_house_id: newHouse, sentry_id: newSentry })
      .select()
      .maybeSingle();
    if (error) { alert(error.message); setCreating(false); return; }
    await supabase.from('tent_members').insert({ tent_id: data.id, user_id: newSentry, role: 'sentry' });
    setNewName(''); setNewSentry(''); setShowCreate(false); setCreating(false);
    onRefresh();
  };

  const deleteTent = async (tentId: string, tentName: string) => {
    if (!confirm(`Delete "${tentName}"? This will remove all cadet/sentry assignments. This cannot be undone.`)) return;
    setDeletingId(tentId);
    const { error } = await supabase.rpc('delete_tent', { p_tent_id: tentId });
    if (error) { alert(error.message); setDeletingId(null); return; }
    setDeletingId(null);
    onRefresh();
  };

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading tents…</div>;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <SectionHeader title="Tent Management" subtitle="Create tents, assign sentries, add cadets" />
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-sm">
          <Plus size={16} /> New Tent
        </button>
      </div>

      {showCreate && (
        <div className="card p-4 space-y-3 animate-scale-in">
          <h4 className="font-display font-semibold text-ink">Create New Tent</h4>
          <div className="grid sm:grid-cols-3 gap-3">
            <input className="input-field" placeholder="Tent name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <select className="input-field" value={newHouse} onChange={(e) => setNewHouse(e.target.value)}>
              <option value="squares">The Squares</option>
              <option value="spades">The Spades</option>
              <option value="darics">The Darics</option>
              <option value="rudes">The Rudes</option>
              <option value="laureats">The Laureats</option>
            </select>
            <select className="input-field" value={newSentry} onChange={(e) => setNewSentry(e.target.value)}>
              <option value="">Select sentry…</option>
              {availableSentries.map((r) => {
                const p = profiles.find((p) => p.id === r.user_id);
                return <option key={r.user_id} value={r.user_id}>{p?.display_name}</option>;
              })}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={createTent} disabled={creating || !newName || !newSentry} className="btn-primary text-sm">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Create
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      )}

      {tents.length === 0 ? (
        <EmptyState icon={TentIcon} title="No tents yet" message="Create a tent and assign a sentry to get started." />
      ) : (
        <div className="space-y-4">
          {tents.map((t) => {
            const tentMembers = members.filter((m) => m.tent_id === t.id);
            const sentry = tentMembers.find((m) => m.role === 'sentry');
            const cadets = tentMembers.filter((m) => m.role === 'cadet');
            const availableCadets = roles
              .filter((r) => r.role === 'cadet' && r.status === 'active')
              .filter((r) => !members.some((m) => m.user_id === r.user_id && m.role === 'cadet'));

            return (
              <div key={t.id} className="card p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {t.tent_houses && <TentHouseBadge houseId={t.tent_houses.id} size="md" />}
                    <div>
                      <h4 className="font-display font-semibold text-ink">{t.name}</h4>
                      <p className="text-xs text-stone">{cadets.length}/5 cadets · {sentry ? 'sentry assigned' : 'no sentry'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteTent(t.id, t.name)}
                    disabled={deletingId === t.id}
                    className="btn-danger text-xs"
                  >
                    {deletingId === t.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                  </button>
                </div>

                {sentry && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-2 mb-3">
                    <Shield size={14} className="text-sage" />
                    <span className="text-sm text-ink flex-1">{sentry.profiles.display_name} (sentry)</span>
                    {whatsappUrl(sentry.profiles.whatsapp_number) && (
                      <a href={whatsappUrl(sentry.profiles.whatsapp_number)!} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
                         style={{ background: 'rgba(37, 211, 102, 0.12)', color: '#25D366' }}
                         title="WhatsApp sentry">
                        <MessageCircle size={14} />
                      </a>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {cadets.map((m) => (
                    <div key={m.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-2">
                      <span className="text-sm text-ink flex-1">{m.profiles.display_name}</span>
                      {whatsappUrl(m.profiles.whatsapp_number) && (
                        <a href={whatsappUrl(m.profiles.whatsapp_number)!} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
                           style={{ background: 'rgba(37, 211, 102, 0.12)', color: '#25D366' }}
                           title="WhatsApp cadet">
                          <MessageCircle size={14} />
                        </a>
                      )}
                      <button
                        onClick={async () => {
                          await supabase.from('tent_members').delete().eq('user_id', m.user_id).eq('tent_id', t.id);
                          onRefresh();
                        }}
                        className="btn-danger text-xs"
                      >
                        <UserMinus size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                {cadets.length < 5 && availableCadets.length > 0 && (
                  <AddCadetRow tentId={t.id} availableCadets={availableCadets} profiles={profiles} onRefresh={onRefresh} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddCadetRow({ tentId, availableCadets, profiles, onRefresh }: {
  tentId: string; availableCadets: RoleAssignment[]; profiles: Profile[]; onRefresh: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);

  const addCadet = async () => {
    if (!selected) return;
    setAdding(true);
    try {
      await assignCadetToTent(tentId, selected);
      setSelected('');
      onRefresh();
    } catch (e: any) {
      alert(e.message || 'Failed to add cadet');
    }
    setAdding(false);
  };

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
      <select className="input-field text-sm flex-1" value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">Add cadet…</option>
        {availableCadets.map((r) => {
          const p = profiles.find((p) => p.id === r.user_id);
          return <option key={r.user_id} value={r.user_id}>{p?.display_name}</option>;
        })}
      </select>
      <button onClick={addCadet} disabled={adding || !selected} className="btn-primary text-xs">
        {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
      </button>
    </div>
  );
}

function CadetManagement({ profiles, roles, members, tents, awards, onRefresh, instructorId }: {
  profiles: Profile[]; roles: RoleAssignment[]; members: any[]; tents: any[];
  awards: AwardWithRecipient[]; onRefresh: () => void; instructorId: string;
}) {
  const cadets = roles.filter((r) => r.role === 'cadet' && r.status === 'active');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [awardingId, setAwardingId] = useState<string | null>(null);
  const [awardMonth, setAwardMonth] = useState(getTodayISODate().slice(0, 7));
  const [streaks, setStreaks] = useState<Record<string, { current: number; longest: number }>>({});
  const [denarii, setDenarii] = useState<Record<string, number>>({});
  const [selectedAwards, setSelectedAwards] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const sMap: Record<string, { current: number; longest: number }> = {};
      const dMap: Record<string, number> = {};
      await Promise.all(cadets.map(async (c) => {
        try {
          const st = await fetchStrictStreak(c.user_id);
          sMap[c.user_id] = { current: st.current_streak, longest: st.longest_streak };
        } catch { sMap[c.user_id] = { current: 0, longest: 0 }; }
        try {
          const { data: d } = await supabase.rpc('get_user_denarii_total', { p_user_id: c.user_id });
          dMap[c.user_id] = Number(d) || 0;
        } catch { dMap[c.user_id] = 0; }
      }));
      setStreaks(sMap);
      setDenarii(dMap);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, roles.length]);

  const toggleAward = (title: string) => {
    setSelectedAwards((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  };

  const giveAwards = async (userId: string) => {
    if (selectedAwards.size === 0) return;
    try {
      for (const title of selectedAwards) {
        const def = AWARD_CATALOG.flatMap((g) => g.awards).find((a) => a.title === title);
        if (!def || !isSentryAward(def)) continue;
        await giveAwardRPC(userId, title, def.description || null, 'leadership', awardMonth, 'sentry', userId);
      }
    } catch (e: any) {
      alert(e.message || 'Failed to give sentry award');
      return;
    }
    setSelectedAwards(new Set()); setAwardingId(null); onRefresh();
  };

  const filtered = cadets.filter((r) => {
    const p = profiles.find((p) => p.id === r.user_id);
    return p?.display_name.toLowerCase().includes(search.toLowerCase());
  });

  const deleteCadet = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from the system? They will be removed from their tent and deactivated. They can sign up again as a cadet later.`)) return;
    setDeletingId(userId);
    const { error } = await supabase.rpc('delete_cadet', { p_user_id: userId });
    if (error) { alert(error.message); setDeletingId(null); return; }
    setDeletingId(null);
    onRefresh();
  };

  const promoteCadet = async (userId: string, name: string) => {
    if (!confirm(`Promote ${name} to Sentry? They will gain sentry privileges and lose their cadet role.`)) return;
    setPromotingId(userId);
    try {
      await promoteCadetToSentry(userId, instructorId);
    } catch (e: any) {
      alert(e.message || 'Failed to promote');
    }
    setPromotingId(null);
    onRefresh();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Cadet Management" subtitle="View, promote, award, and remove cadets" />
      <input className="input-field" placeholder="Search cadets…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="space-y-2">
        {filtered.map((r) => {
          const p = profiles.find((p) => p.id === r.user_id);
          if (!p) return null;
          const member = members.find((m) => m.user_id === r.user_id);
          const tent = member ? tents.find((t) => t.id === member.tent_id) : null;
          const st = streaks[r.user_id] || { current: 0, longest: 0 };
          const dn = denarii[r.user_id] || 0;
          const cadetAwards = awards.filter((a) => a.user_id === r.user_id);

          return (
            <div key={r.user_id} className="card p-4 card-hover">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-10 h-10 rounded-full bg-navy-3 overflow-hidden flex items-center justify-center font-display font-bold text-peri-dim flex-shrink-0">
                  {p.avatar_url ? <img src={p.avatar_url} alt={p.display_name} className="w-full h-full object-cover" /> : p.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{p.display_name}</p>
                  <p className="text-xs text-stone">
                    {tent ? tent.name : 'No tent'} · {tent?.tent_houses?.name || ''}
                  </p>
                </div>
                {/* Streak + Denarii icons */}
                <div className="flex items-center gap-2 text-xs flex-shrink-0">
                  <span className="inline-flex items-center gap-1 text-brass font-display font-semibold" title="Current streak">
                    <Flame size={14} /> {st.current}
                  </span>
                  <span className="inline-flex items-center gap-1 text-gold font-display font-semibold" title="Denarii">
                    <Coins size={14} /> {dn}
                  </span>
                  {cadetAwards.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-royal font-display font-semibold" title={`${cadetAwards.length} award(s)`}>
                      <Crown size={14} /> {cadetAwards.length}
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {whatsappUrl(p.whatsapp_number) && (
                  <a href={whatsappUrl(p.whatsapp_number)!} target="_blank" rel="noopener noreferrer"
                     className="btn-secondary text-xs" style={{ background: 'rgba(37, 211, 102, 0.10)', borderColor: 'rgba(37, 211, 102, 0.3)', color: '#25D366' }}>
                    <MessageCircle size={12} /> WhatsApp
                  </a>
                )}
                <button
                  onClick={() => setAwardingId(awardingId === r.user_id ? null : r.user_id)}
                  className="btn-secondary text-xs"
                  title="Award cadet"
                >
                  <Crown size={12} /> Award
                </button>
                <button
                  onClick={() => promoteCadet(r.user_id, p.display_name)}
                  disabled={promotingId === r.user_id}
                  className="btn-secondary text-xs"
                  style={{ color: 'var(--color-sage)', borderColor: 'var(--color-sage-soft)' }}
                  title="Promote to sentry"
                >
                  {promotingId === r.user_id ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpCircle size={12} />} Promote
                </button>
                <button
                  onClick={() => deleteCadet(r.user_id, p.display_name)}
                  disabled={deletingId === r.user_id}
                  className="btn-danger text-xs"
                  title="Remove cadet"
                >
                  {deletingId === r.user_id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                </button>
              </div>

              {/* Award panel */}
              {awardingId === r.user_id && (
                <div className="mt-3 pt-3 border-t border-border space-y-3 animate-slide-up">
                  <AwardCheckboxList selected={selectedAwards} onToggle={toggleAward} target="sentry" />
                  <div className="flex gap-2">
                    <input type="month" className="input-field text-sm flex-1" value={awardMonth} onChange={(e) => setAwardMonth(e.target.value)} />
                    <button onClick={() => giveAwards(r.user_id)} disabled={selectedAwards.size === 0} className="btn-primary text-sm">
                      <Save size={14} /> Give {selectedAwards.size > 0 ? `${selectedAwards.size} Award${selectedAwards.size > 1 ? 's' : ''}` : 'Award'}
                    </button>
                  </div>
                  {cadetAwards.length > 0 && (
                    <div className="text-xs text-stone">
                      Current awards: {cadetAwards.map((a) => a.title).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <EmptyState icon={Users} title="No cadets found" message="No active cadets match your search." />
        )}
      </div>
    </div>
  );
}

function SentryManagement({ profiles, roles, members, tents, awards, onRefresh, instructorId }: {
  profiles: Profile[]; roles: RoleAssignment[]; members: any[]; tents: any[];
  awards: AwardWithRecipient[]; onRefresh: () => void; instructorId: string;
}) {
  const sentries = roles.filter((r) => r.role === 'sentry' && r.status === 'active');
  const [search, setSearch] = useState('');
  const [actionSentryId, setActionSentryId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const [busy, setBusy] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [awardingId, setAwardingId] = useState<string | null>(null);
  const [awardMonth, setAwardMonth] = useState(getTodayISODate().slice(0, 7));
  const [streaks, setStreaks] = useState<Record<string, { current: number; longest: number }>>({});
  const [denarii, setDenarii] = useState<Record<string, number>>({});
  const [selectedAwards, setSelectedAwards] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const sMap: Record<string, { current: number; longest: number }> = {};
      const dMap: Record<string, number> = {};
      await Promise.all(sentries.map(async (s) => {
        try {
          const st = await fetchStrictStreak(s.user_id);
          sMap[s.user_id] = { current: st.current_streak, longest: st.longest_streak };
        } catch { sMap[s.user_id] = { current: 0, longest: 0 }; }
        try {
          const { data: d } = await supabase.rpc('get_user_denarii_total', { p_user_id: s.user_id });
          dMap[s.user_id] = Number(d) || 0;
        } catch { dMap[s.user_id] = 0; }
      }));
      setStreaks(sMap);
      setDenarii(dMap);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, roles.length]);

  const toggleAward = (title: string) => {
    setSelectedAwards((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  };

  const giveAwards = async (userId: string) => {
    if (selectedAwards.size === 0) return;
    try {
      for (const title of selectedAwards) {
        const def = AWARD_CATALOG.flatMap((g) => g.awards).find((a) => a.title === title);
        await giveAwardRPC(userId, title, def?.description || null, 'leadership', awardMonth, 'sentry', userId);
      }
    } catch (e: any) {
      alert(e.message || 'Failed to give sentry award');
      return;
    }
    setSelectedAwards(new Set()); setAwardingId(null); onRefresh();
  };

  const filtered = sentries.filter((r) => {
    const p = profiles.find((p) => p.id === r.user_id);
    return p?.display_name.toLowerCase().includes(search.toLowerCase());
  });

  const availableSentries = sentries.filter((r) =>
    !members.some((m) => m.user_id === r.user_id && m.role === 'sentry')
  );

  const confirmReplace = async (sentryUserId: string) => {
    if (!replacementId) return;
    setBusy(true);
    const { error } = await supabase.rpc('delete_sentry', {
      p_sentry_user_id: sentryUserId,
      p_replacement_user_id: replacementId,
    });
    if (error) { alert(error.message); setBusy(false); return; }
    setActionSentryId(null); setReplacementId(''); setBusy(false);
    onRefresh();
  };

  const confirmDeleteTent = async (sentryUserId: string, sentryName: string, tentName: string) => {
    if (!confirm(`Delete "${tentName}" and remove ${sentryName} as sentry? All cadets in this tent will be unassigned.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('delete_sentry', { p_sentry_user_id: sentryUserId, p_replacement_user_id: null });
    if (error) { alert(error.message); setBusy(false); return; }
    setActionSentryId(null); setBusy(false); onRefresh();
  };

  const promoteSentry = async (userId: string, name: string) => {
    if (!confirm(`Promote ${name} to Instructor? You will be demoted and they will become the new instructor. This hands over full administrative access.`)) return;
    setPromotingId(userId);
    try {
      await promoteSentryToInstructor(userId, instructorId);
    } catch (e: any) {
      alert(e.message || 'Failed to promote');
    }
    setPromotingId(null);
    onRefresh();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Sentry Management" subtitle="View, promote, award, replace, or remove sentries" />
      <input className="input-field" placeholder="Search sentries…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="space-y-3">
        {filtered.map((r) => {
          const p = profiles.find((p) => p.id === r.user_id);
          if (!p) return null;
          const member = members.find((m) => m.user_id === r.user_id && m.role === 'sentry');
          const tent = member ? tents.find((t) => t.id === member.tent_id) : null;
          const tentCadets = member ? members.filter((m) => m.tent_id === member.tent_id && m.role === 'cadet') : [];
          const showActions = actionSentryId === r.user_id;
          const st = streaks[r.user_id] || { current: 0, longest: 0 };
          const dn = denarii[r.user_id] || 0;
          const sentryAwards = awards.filter((a) => a.user_id === r.user_id);

          return (
            <div key={r.user_id} className="card p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-10 h-10 rounded-full bg-sage-soft overflow-hidden flex items-center justify-center font-display font-bold text-sage flex-shrink-0">
                  {p.avatar_url ? <img src={p.avatar_url} alt={p.display_name} className="w-full h-full object-cover" /> : p.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{p.display_name}</p>
                  <p className="text-xs text-stone">
                    {tent ? `${tent.name} · ${tentCadets.length} cadets` : 'No tent assigned'}
                    {tent?.tent_houses?.name && ` · ${tent.tent_houses.name}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs flex-shrink-0">
                  <span className="inline-flex items-center gap-1 text-brass font-display font-semibold" title="Current streak">
                    <Flame size={14} /> {st.current}
                  </span>
                  <span className="inline-flex items-center gap-1 text-gold font-display font-semibold" title="Denarii">
                    <Coins size={14} /> {dn}
                  </span>
                  {sentryAwards.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-royal font-display font-semibold" title={`${sentryAwards.length} award(s)`}>
                      <Crown size={14} /> {sentryAwards.length}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {whatsappUrl(p.whatsapp_number) && (
                  <a href={whatsappUrl(p.whatsapp_number)!} target="_blank" rel="noopener noreferrer"
                     className="btn-secondary text-xs" style={{ background: 'rgba(37, 211, 102, 0.10)', borderColor: 'rgba(37, 211, 102, 0.3)', color: '#25D366' }}>
                    <MessageCircle size={12} /> WhatsApp
                  </a>
                )}
                <button onClick={() => setAwardingId(awardingId === r.user_id ? null : r.user_id)} className="btn-secondary text-xs" title="Award sentry">
                  <Crown size={12} /> Award
                </button>
                <button onClick={() => promoteSentry(r.user_id, p.display_name)} disabled={promotingId === r.user_id}
                  className="btn-secondary text-xs" style={{ color: 'var(--color-royal)', borderColor: 'rgba(61, 82, 200, 0.3)' }} title="Promote to instructor">
                  {promotingId === r.user_id ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpCircle size={12} />} Promote
                </button>
                <button onClick={() => setActionSentryId(showActions ? null : r.user_id)} className="btn-danger text-xs" title="Remove or replace sentry">
                  <UserMinus size={12} /> Remove
                </button>
              </div>

              {awardingId === r.user_id && (
                <div className="mt-3 pt-3 border-t border-border space-y-3 animate-slide-up">
                  <AwardCheckboxList selected={selectedAwards} onToggle={toggleAward} />
                  <div className="flex gap-2">
                    <input type="month" className="input-field text-sm flex-1" value={awardMonth} onChange={(e) => setAwardMonth(e.target.value)} />
                    <button onClick={() => giveAwards(r.user_id)} disabled={selectedAwards.size === 0} className="btn-primary text-sm">
                      <Save size={14} /> Give {selectedAwards.size > 0 ? `${selectedAwards.size} Award${selectedAwards.size > 1 ? 's' : ''}` : 'Award'}
                    </button>
                  </div>
                  {sentryAwards.length > 0 && (
                    <div className="text-xs text-stone">Current awards: {sentryAwards.map((a) => a.title).join(', ')}</div>
                  )}
                </div>
              )}

              {showActions && (
                <div className="mt-4 pt-4 border-t border-border space-y-3 animate-slide-up">
                  {tent ? (
                    <>
                      <div>
                        <label className="text-xs font-bold text-peri block mb-1.5">Replace with another sentry</label>
                        <p className="text-[10px] text-stone mb-2">The tent and its cadets stay intact. The new sentry takes over immediately.</p>
                        <div className="flex gap-2">
                          <select className="input-field text-sm flex-1" value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
                            <option value="">Select a replacement…</option>
                            {availableSentries.filter((ar) => ar.user_id !== r.user_id).map((ar) => {
                              const ap = profiles.find((p) => p.id === ar.user_id);
                              return <option key={ar.user_id} value={ar.user_id}>{ap?.display_name}</option>;
                            })}
                          </select>
                          <button onClick={() => confirmReplace(r.user_id)} disabled={busy || !replacementId} className="btn-primary text-sm">
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />} Replace
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-2">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-[10px] text-stone uppercase tracking-wide">or</span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-coral block mb-1.5">Delete tent entirely</label>
                        <p className="text-[10px] text-stone mb-2">Removes the tent and unassigns all {tentCadets.length} cadet(s).</p>
                        <button onClick={() => confirmDeleteTent(r.user_id, p.display_name, tent.name)} disabled={busy} className="btn-danger text-sm">
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete "{tent.name}"
                        </button>
                      </div>
                    </>
                  ) : (
                    <div>
                      <p className="text-xs text-stone mb-2">This sentry has no tent. Deactivating their role only.</p>
                      <button
                        onClick={async () => {
                          setBusy(true);
                          const { error } = await supabase.rpc('delete_sentry', { p_sentry_user_id: r.user_id, p_replacement_user_id: null });
                          if (error) { alert(error.message); setBusy(false); return; }
                          setActionSentryId(null); setBusy(false); onRefresh();
                        }}
                        disabled={busy} className="btn-danger text-sm"
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Deactivate sentry
                      </button>
                    </div>
                  )}
                </div>
              )}

              {tent && tentCadets.length > 0 && !showActions && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-stone mb-2">Cadets in this tent:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tentCadets.map((cm) => {
                      const cp = profiles.find((p) => p.id === cm.user_id);
                      if (!cp) return null;
                      return <span key={cm.user_id} className="badge badge-neutral text-[10px]">{cp.display_name}</span>;
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <EmptyState icon={Shield} title="No sentries found" message="No active sentries match your search." />
        )}
      </div>
    </div>
  );
}

function InstructorLeaderboard() {
  const [boardTab, setBoardTab] = useState<'denarii' | 'streak' | 'houses'>('denarii');
  const [liveData, setLiveData] = useState<any[]>([]);
  const [streakData, setStreakData] = useState<any[]>([]);
  const [houseData, setHouseData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [ld, sd, hd] = await Promise.allSettled([
        supabase.rpc('get_leaderboard_live'),
        fetchStreakboardSnapshots(),
        supabase.rpc('get_house_standings'),
      ]);
      setLiveData(ld.status === 'fulfilled' && ld.value.data ? ld.value.data : []);
      setStreakData(sd.status === 'fulfilled' ? sd.value || [] : []);
      setHouseData(hd.status === 'fulfilled' && hd.value.data ? hd.value.data : []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader title="Challenge Boards" subtitle="Live denarii rankings for active cadets, streak snapshots, and house competition" />

      <div className="flex gap-1 p-1 bg-navy-3 rounded-xl">
        {([['denarii', 'Denarii Board'], ['streak', 'Streak Board'], ['houses', 'House Competition']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setBoardTab(key)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${boardTab === key ? 'bg-peri text-navy' : 'text-peri-dim'}`}>
            {label}
          </button>
        ))}
      </div>

      {boardTab === 'denarii' && (
        <div className="space-y-2">
          {liveData.length === 0 ? (
            <EmptyState icon={Trophy} title="No data yet" message="Denarii rankings will appear here once cadets start earning." />
          ) : (
            liveData.map((row: any, i: number) => (
	              <div key={row.user_id || i} className="card p-3 flex items-center gap-3">
	                <span className="font-display text-lg font-bold text-brass w-8 text-center">{i + 1}</span>
	                <div className="flex-1 min-w-0">
	                  <p className="text-sm font-semibold text-ink truncate">{row.display_name || 'Unknown'}</p>
	                  <p className="text-xs text-stone">{row.tent_name || 'No tent assigned'}</p>
	                </div>
                <span className="text-sm font-display font-bold text-gold flex items-center gap-1">
                  <Coins size={14} /> {row.total_denarii || 0}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {boardTab === 'streak' && (
        <div className="space-y-2">
          {streakData.length === 0 ? (
            <EmptyState icon={Flame} title="No streak data yet" message="Streak rankings will appear here once daily activity is recorded." />
          ) : (
            streakData.map((row: any, i: number) => (
              <div key={row.user_id || i} className="card p-3">
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg font-bold text-coral w-8 text-center">{row.rank || i + 1}</span>
                  <div className="h-10 w-10 overflow-hidden rounded-full bg-coral-soft flex items-center justify-center font-display font-bold text-coral">
                    {row.profiles?.avatar_url ? <img src={row.profiles.avatar_url} alt="" className="h-full w-full object-cover" /> : (row.profiles?.display_name || row.display_name || '?').charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{row.profiles?.display_name || row.display_name || 'Unknown'}</p>
                    <p className="text-xs text-stone">{row.tent_name || 'Streak board'}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-surface-2 px-2 py-1">
                      <p className="font-display font-bold text-coral">{row.current_streak || 0}</p>
                      <p className="text-[9px] uppercase text-stone">Current</p>
                    </div>
                    <div className="rounded-lg bg-surface-2 px-2 py-1">
                      <p className="font-display font-bold text-brass">{row.longest_streak || 0}</p>
                      <p className="text-[9px] uppercase text-stone">Best</p>
                    </div>
                    <div className="rounded-lg bg-surface-2 px-2 py-1">
                      <p className="font-display font-bold text-ink">{row.volume || row.volume_this_month || 0}</p>
                      <p className="text-[9px] uppercase text-stone">Valid</p>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {boardTab === 'houses' && (
        <div className="space-y-3">
          {houseData.length === 0 ? (
            <EmptyState icon={Home} title="No house data yet" message="House competition standings will appear once cadets join tents and start participating." />
          ) : (
	            houseData.map((house: any) => {
	              const sentryNames = Array.isArray(house.sentry_names) ? house.sentry_names : [];
	              return (
	                <div key={house.tent_house_id} className="card p-4 card-hover">
	                  <div className="flex items-center justify-between mb-3">
	                    <div className="flex items-center gap-3 min-w-0">
	                      <TentHouseBadge houseId={house.tent_house_id} size="sm" />
	                      <div className="min-w-0">
	                        <p className="font-display font-bold text-ink truncate">{house.house_name}</p>
	                        <p className="text-xs text-stone">{house.member_count} cadets</p>
	                        {sentryNames.length > 0 && (
	                          <p className="text-[11px] text-stone truncate">
	                            Sentr{sentryNames.length === 1 ? 'y' : 'ies'}: {sentryNames.join(', ')}
	                          </p>
	                        )}
	                      </div>
	                    </div>
	                    <span className="font-display text-2xl font-bold text-brass">#{house.rank}</span>
	                  </div>
	                  <div className="grid grid-cols-2 gap-3">
	                    <div className="text-center p-2 rounded-lg bg-navy-3">
	                      <p className="font-display text-lg font-bold text-brass">{Number(house.avg_streak).toFixed(1)}</p>
	                      <p className="text-xs text-stone">Avg Streak</p>
	                    </div>
	                    <div className="text-center p-2 rounded-lg bg-navy-3">
	                      <p className="font-display text-lg font-bold text-gold">{Number(house.avg_denarii).toFixed(0)}</p>
	                      <p className="text-xs text-stone">Avg Denarii</p>
	                    </div>
	                  </div>
	                </div>
	              );
	            })
	          )}
        </div>
      )}
    </div>
  );
}

function MatriculesManagement() {
  const [matricules, setMatricules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [count, setCount] = useState(5);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('sentry_matricules').select('*').order('created_at', { ascending: false });
    if (!error) setMatricules(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    const { error } = await supabase.rpc('generate_matricules', { p_count: count });
    if (error) { alert(error.message); setGenerating(false); return; }
    setGenerating(false);
    load();
  };

  const deleteMatricule = async (id: string) => {
    if (!confirm('Delete this matricule?')) return;
    await supabase.from('sentry_matricules').delete().eq('id', id);
    load();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader title="Sentry Matricules" subtitle="Generate entry codes for new sentries" />

      <div className="card p-4 space-y-3 bg-surface-2">
        <p className="text-sm text-stone">Generate unique matricule codes that new sentries must enter during signup. Each code can only be used once.</p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-stone">Count:</label>
          <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} className="input-field w-20 text-sm" />
          <button onClick={generate} disabled={generating} className="btn-primary text-sm">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Generate
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-brass" /></div>
      ) : matricules.length === 0 ? (
        <EmptyState icon={KeyRound} title="No matricules yet" message="Generate codes above to enable sentry signup." />
      ) : (
        <div className="space-y-2">
          {matricules.map((m) => (
            <div key={m.id} className="card p-3 flex items-center gap-3">
              <KeyRound size={18} className={m.used ? 'text-stone' : 'text-brass'} />
              <div className="flex-1">
                <p className="font-display font-bold text-ink tracking-wider">{m.matricule}</p>
                <p className="text-xs text-stone">
                  {m.used ? 'Used' : 'Available'} · {formatShortDate(m.created_at?.slice(0, 10) || '')}
                </p>
              </div>
              {!m.used && (
                <button onClick={() => deleteMatricule(m.id)} className="btn-danger text-xs">
                  <Trash2 size={12} /> Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type AwardDef = { title: string; description: string; forTent?: boolean; forSentry?: boolean };

const AWARD_CATALOG: { group: string; cadence: string; awards: AwardDef[] }[] = [
  {
    group: 'Weekly Individual',
    cadence: 'weekly',
    awards: [
      { title: 'Rhetoric Award (Orator)', description: 'Best Quote of the Week' },
      { title: 'Messenger Award (Nuncio)', description: 'Best Meditation of the Week' },
      { title: 'Rumor Award', description: 'Overall Best Cadet of the Week' },
      { title: 'Scribe Award', description: 'Highest Quiz Score of the Week' },
      { title: 'The Sprout', description: 'Most Improved Cadet of the Week' },
      { title: 'Reputation Award', description: 'Best Sentry of the Week', forSentry: true },
      { title: 'Tutorix', description: 'Highest Sentry Quiz Score and Most Quiz Figs of the Week', forSentry: true },
      { title: 'Valley Champion', description: 'Most Arena Victories of the Week', forSentry: true },
    ],
  },
  {
    group: 'Weekly Tent',
    cadence: 'weekly',
    awards: [
      { title: "The Lord's Secret", description: 'Best Performing Tent', forTent: true },
    ],
  },
  {
    group: 'Monthly Individual',
    cadence: 'monthly',
    awards: [
      { title: 'Most Consistent Cadet', description: 'Faithfulness & Consistency' },
      { title: 'Rudis Award (Muralis)', description: 'Best Challenger Cadet – Challenge & Courage' },
      { title: 'The Valediction Crown (Vallum)', description: 'Overall Best Cadet – Overall Excellence' },
    ],
  },
  {
    group: 'Monthly Tent',
    cadence: 'monthly',
    awards: [
      { title: 'Portion of the Priests', description: 'Overall Best Tent', forTent: true },
    ],
  },
  {
    group: 'Annual Individual',
    cadence: 'annual',
    awards: [
      { title: 'Grand Orator', description: 'Most Rhetoric Awards during the year' },
      { title: 'Grand Nuncio', description: 'Most Messenger Awards during the year' },
      { title: 'The Great Muralis Crown', description: 'Grand Muralis / Grand Challenger' },
      { title: 'The Parting Valediction Crown', description: "Heaven's Kiss / Grand Vallum" },
    ],
  },
  {
    group: 'Annual Tent',
    cadence: 'annual',
    awards: [
      { title: 'Bethel Stone', description: 'Overall Best Tent', forTent: true },
    ],
  },
];

const AWARD_MEASUREMENT_START = '2026-07-27';

type AwardRecommendation = {
  title: string;
  candidate: string;
  candidateId?: string;
  detail: string;
  quote?: string;
  runnersUp: { candidate: string; candidateId?: string; detail: string; quote?: string }[];
};

function AwardsManagement({ awards, profiles, roles, tents, members, onRefresh }: {
  awards: AwardWithRecipient[];
  profiles: Profile[];
  roles: RoleAssignment[];
  tents: any[];
  members: any[];
  onRefresh: () => void;
}) {
  const [targetType, setTargetType] = useState<'cadet' | 'sentry' | 'tent'>('cadet');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [selectedTentId, setSelectedTentId] = useState('');
  const [selectedAwards, setSelectedAwards] = useState<Set<string>>(new Set());
  const [awardDescription, setAwardDescription] = useState('');
  const [awardMonth, setAwardMonth] = useState(getTodayISODate().slice(0, 7));
  const [saving, setSaving] = useState(false);
  const [recommendations, setRecommendations] = useState<AwardRecommendation[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  const cadets = useMemo(() => roles.filter((r) => r.role === 'cadet' && (r.status === 'active' || r.status === 'approved')), [roles]);
  const sentries = useMemo(() => roles.filter((r) => r.role === 'sentry' && (r.status === 'active' || r.status === 'approved')), [roles]);
  const cadetIds = useMemo(() => cadets.map((r) => r.user_id), [cadets]);
  const sentryIds = useMemo(() => sentries.map((r) => r.user_id), [sentries]);
  const profileName = useCallback((userId: string) => profiles.find((p) => p.id === userId)?.display_name || 'Unknown cadet', [profiles]);

  useEffect(() => {
    let cancelled = false;
    const loadRecommendations = async () => {
      const trackedUserIds = Array.from(new Set([...cadetIds, ...sentryIds]));
      if (trackedUserIds.length === 0) {
        setRecommendations([]);
        return;
      }
      setLoadingRecommendations(true);
      const next: AwardRecommendation[] = [];
      try {
        const [{ data: dailyRecords }, { data: quizAttempts }, quoteSummaryResult, { data: arenaWins }, { data: gameAttempts }] = await Promise.all([
          supabase
            .from('daily_records')
            .select('user_id,record_date,streak_valid,meditation_submitted,attendance_status')
            .in('user_id', trackedUserIds)
            .gte('record_date', AWARD_MEASUREMENT_START),
          supabase
            .from('quiz_attempts')
            .select('*')
            .in('user_id', trackedUserIds)
            .gte('submitted_at', `${AWARD_MEASUREMENT_START}T00:00:00`),
          fetchDailyQuoteInteractionSummary(25).then((data) => ({ data })).catch(() => ({ data: [] })),
          trackedUserIds.length > 0
            ? supabase
              .from('arena_rooms')
              .select('winner_id,completed_at')
              .eq('status', 'completed')
              .in('winner_id', trackedUserIds)
              .gte('completed_at', `${AWARD_MEASUREMENT_START}T00:00:00`)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from('game_attempts')
            .select('user_id,narrative_date,score')
            .in('user_id', trackedUserIds)
            .gte('narrative_date', AWARD_MEASUREMENT_START),
        ]);

        const consistency = new Map<string, number>();
        (dailyRecords || []).filter((record: any) => cadetIds.includes(record.user_id)).forEach((record: any) => {
          const credit = record.streak_valid || record.meditation_submitted || record.attendance_status === 'present' ? 1 : 0;
          consistency.set(record.user_id, (consistency.get(record.user_id) || 0) + credit);
        });
        const consistentRanking = [...consistency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const topConsistent = consistentRanking[0];
        if (topConsistent) {
          next.push({
            title: 'Most Consistent Cadet',
            candidate: profileName(topConsistent[0]),
            detail: `${topConsistent[1]} qualifying daily action(s) since ${formatShortDate(AWARD_MEASUREMENT_START)}.`,
            runnersUp: consistentRanking.slice(1).map(([userId, score]) => ({ candidate: profileName(userId), detail: `${score} qualifying daily action(s).` })),
          });
        }

        const todayIso = getTodayISODate();
        const todayDay = new Date(`${todayIso}T12:00:00.000Z`).getUTCDay();
        const weeklyStartIso = shiftISODate(todayIso, -((todayDay + 6) % 7));
        const weeklyRecords = (dailyRecords || []).filter((record: any) => record.record_date >= weeklyStartIso);
        const sentryScores = new Map<string, number>();
        weeklyRecords.filter((record: any) => sentryIds.includes(record.user_id)).forEach((record: any) => {
          const credit = record.attendance_status === 'present' ? 1 : 0;
          const meditation = record.meditation_submitted ? 1 : 0;
          sentryScores.set(record.user_id, (sentryScores.get(record.user_id) || 0) + credit + meditation);
        });
        const sentryRanking = [...sentryScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const topSentry = sentryRanking[0];
        if (topSentry) next.push({
          title: 'Reputation Award',
          candidate: profileName(topSentry[0]),
          detail: `${topSentry[1]} leadership action(s) this week: morning attendance and daily meditation.`,
          runnersUp: sentryRanking.slice(1).map(([userId, score]) => ({ candidate: profileName(userId), detail: `${score} leadership action(s).` })),
        });

        const tutorixScores = new Map<string, { bestScore: number; totalFigs: number }>();
        (quizAttempts || []).filter((attempt: any) => (
          sentryIds.includes(attempt.user_id)
          && attempt.submitted_at?.slice(0, 10) >= weeklyStartIso
        )).forEach((attempt: any) => {
          const figs = Number(attempt.figs_scored ?? attempt.talents_scored ?? attempt.score ?? 0);
          const current = tutorixScores.get(attempt.user_id) || { bestScore: 0, totalFigs: 0 };
          tutorixScores.set(attempt.user_id, {
            bestScore: Math.max(current.bestScore, figs),
            totalFigs: current.totalFigs + figs,
          });
        });
        const tutorixRanking = [...tutorixScores.entries()]
          .sort((a, b) => b[1].bestScore - a[1].bestScore || b[1].totalFigs - a[1].totalFigs)
          .slice(0, 4);
        const topTutorix = tutorixRanking[0];
        if (topTutorix) next.push({
          title: 'Tutorix',
          candidate: profileName(topTutorix[0]),
          candidateId: topTutorix[0],
          detail: `${topTutorix[1].bestScore} figs in their highest quiz score and ${topTutorix[1].totalFigs} quiz figs overall this week.`,
          runnersUp: tutorixRanking.slice(1).map(([userId, result]) => ({
            candidate: profileName(userId),
            candidateId: userId,
            detail: `${result.bestScore} figs in their highest quiz score; ${result.totalFigs} quiz figs overall.`,
          })),
        });

        const arenaVictoryScores = new Map<string, number>();
        (arenaWins || []).filter((room: any) => room.completed_at?.slice(0, 10) >= weeklyStartIso).forEach((room: any) => {
          if (room.winner_id) arenaVictoryScores.set(room.winner_id, (arenaVictoryScores.get(room.winner_id) || 0) + 1);
        });
        const valleyRanking = [...arenaVictoryScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        if (valleyRanking[0]) next.push({
          title: 'Valley Champion',
          candidate: profileName(valleyRanking[0][0]),
          detail: `${valleyRanking[0][1]} Arena victor${valleyRanking[0][1] === 1 ? 'y' : 'ies'} this week across cadets and sentries.`,
          runnersUp: valleyRanking.slice(1).map(([userId, wins]) => ({
            candidate: profileName(userId),
            detail: `${wins} Arena victor${wins === 1 ? 'y' : 'ies'} this week.`,
          })),
        });

        const allRoundRanking = (from: string) => {
          const score = new Map<string, number>();
          const add = (userId: string, points: number) => score.set(userId, (score.get(userId) || 0) + points);
          (dailyRecords || []).filter((record: any) => cadetIds.includes(record.user_id) && record.record_date >= from).forEach((record: any) => {
            if (record.streak_valid) add(record.user_id, 5);
            else if (record.meditation_submitted) add(record.user_id, 3);
            else if (record.attendance_status === 'present') add(record.user_id, 1);
          });
          (quizAttempts || []).filter((attempt: any) => cadetIds.includes(attempt.user_id) && attempt.submitted_at?.slice(0, 10) >= from).forEach((attempt: any) => {
            add(attempt.user_id, Number(attempt.figs_scored ?? attempt.talents_scored ?? attempt.score ?? 0));
          });
          (gameAttempts || []).filter((attempt: any) => cadetIds.includes(attempt.user_id) && attempt.narrative_date >= from).forEach((attempt: any) => {
            add(attempt.user_id, Number(attempt.score || 0));
          });
          (arenaWins || []).filter((room: any) => room.completed_at?.slice(0, 10) >= from && cadetIds.includes(room.winner_id)).forEach((room: any) => {
            add(room.winner_id, 10);
          });
          return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        };

        const cadetRanking = allRoundRanking(weeklyStartIso);
        const topCadet = cadetRanking[0];
        if (topCadet) next.push({
          title: 'Rumor Award',
          candidate: profileName(topCadet[0]),
          candidateId: topCadet[0],
          detail: `${topCadet[1]} all-round point(s) this week from faithful daily work, quizzes, daily games, and Arena victories.`,
          runnersUp: cadetRanking.slice(1).map(([userId, score]) => ({ candidate: profileName(userId), candidateId: userId, detail: `${score} all-round point(s) this week.` })),
        });

        const monthStartIso = `${todayIso.slice(0, 7)}-01`;
        const vallumRanking = allRoundRanking(monthStartIso);
        const topVallum = vallumRanking[0];
        if (topVallum) next.push({
          title: 'The Valediction Crown (Vallum)',
          candidate: profileName(topVallum[0]),
          candidateId: topVallum[0],
          detail: `${topVallum[1]} all-round point(s) this month from daily faithfulness, quizzes, daily games, and Arena victories.`,
          runnersUp: vallumRanking.slice(1).map(([userId, score]) => ({ candidate: profileName(userId), candidateId: userId, detail: `${score} all-round point(s) this month.` })),
        });

        const priorWeekIso = shiftISODate(weeklyStartIso, -7);
        const improvement = cadetIds.map((userId) => {
          const scoreForRange = (from: string, to?: string) => (dailyRecords || [])
            .filter((record: any) => record.user_id === userId && record.record_date >= from && (!to || record.record_date < to))
            .reduce((sum: number, record: any) => sum + (record.streak_valid || record.meditation_submitted || record.attendance_status === 'present' ? 1 : 0), 0);
          const current = scoreForRange(weeklyStartIso);
          const previous = scoreForRange(priorWeekIso, weeklyStartIso);
          return [userId, current - previous, current, previous] as const;
        }).filter(([, gain]) => gain > 0).sort((a, b) => b[1] - a[1] || b[2] - a[2]).slice(0, 4);
        if (improvement[0]) next.push({
          title: 'The Sprout',
          candidate: profileName(improvement[0][0]),
          detail: `Improved by ${improvement[0][1]} action(s): ${improvement[0][3]} last week to ${improvement[0][2]} this week.`,
          runnersUp: improvement.slice(1).map(([userId, gain, current, previous]) => ({
            candidate: profileName(userId),
            detail: `+${gain}: ${previous} last week to ${current} this week.`,
          })),
        });

        const scribeScores = new Map<string, number>();
        (quizAttempts || []).filter((attempt: any) => (
          cadetIds.includes(attempt.user_id)
          && attempt.submitted_at?.slice(0, 10) >= weeklyStartIso
        )).forEach((attempt: any) => {
          const score = Number(attempt.figs_scored ?? attempt.talents_scored ?? attempt.score ?? 0);
          scribeScores.set(attempt.user_id, Math.max(scribeScores.get(attempt.user_id) || 0, score));
        });
        const scribeRanking = [...scribeScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const topScribe = scribeRanking[0];
        if (topScribe) next.push({
          title: 'Scribe Award',
          candidate: profileName(topScribe[0]),
          detail: `${topScribe[1]} figs in their best quiz attempt this week.`,
          runnersUp: scribeRanking.slice(1).map(([userId, score]) => ({ candidate: profileName(userId), detail: `${score} figs in their best attempt.` })),
        });

        const quoteRanking = (quoteSummaryResult.data || []).filter((item) => (
          cadetIds.includes(item.quote_user_id) && item.quote_record_date >= weeklyStartIso
        )).slice(0, 4);
        const quoteLeader = quoteRanking[0];
        if (quoteLeader) {
          next.push({
            title: 'Rhetoric Award (Orator)',
            candidate: quoteLeader.display_name,
            detail: `${quoteLeader.interaction_count} quote interaction(s) from reactions and comments.`,
            quote: quoteLeader.daily_quote,
            runnersUp: quoteRanking.slice(1).map((item) => ({
              candidate: item.display_name,
              detail: `${item.interaction_count} interaction(s).`,
              quote: item.daily_quote,
            })),
          });
        }

        const tentScores = new Map<string, number>();
        (dailyRecords || []).forEach((record: any) => {
          const membership = members.find((member) => member.user_id === record.user_id && member.role === 'cadet');
          if (!membership?.tent_id) return;
          const credit = record.streak_valid || record.meditation_submitted || record.attendance_status === 'present' ? 1 : 0;
          tentScores.set(membership.tent_id, (tentScores.get(membership.tent_id) || 0) + credit);
        });
        const tentRanking = [...tentScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const topTent = tentRanking[0];
        if (topTent) {
          next.push({
            title: "The Lord's Secret",
            candidate: tents.find((tent) => tent.id === topTent[0])?.name || 'Leading tent',
            detail: `${topTent[1]} aggregate daily action(s). Tent awards are given to tents, not tent houses.`,
            runnersUp: tentRanking.slice(1).map(([tentId, score]) => ({ candidate: tents.find((tent) => tent.id === tentId)?.name || 'Tent', detail: `${score} aggregate daily action(s).` })),
          });
        }
      } catch (error) {
        console.warn('Award recommendation load failed:', error);
      }
      if (!cancelled) {
        setRecommendations(next);
        setLoadingRecommendations(false);
      }
    };
    void loadRecommendations();
    return () => { cancelled = true; };
  }, [cadetIds, sentryIds, members, profiles, tents, profileName]);

  const visibleCatalog = AWARD_CATALOG.map((group) => ({
    ...group,
    awards: group.awards.filter((a) => awardVisibleForTarget(a, targetType)),
  })).filter((g) => g.awards.length > 0);

  const toggleAward = (title: string) => {
    setSelectedAwards((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const prepareRecommendedAward = (title: string, candidateId: string) => {
    const definition = AWARD_CATALOG.flatMap((group) => group.awards).find((award) => award.title === title);
    const nextTarget: 'cadet' | 'sentry' = definition && isSentryAward(definition) ? 'sentry' : 'cadet';
    setTargetType(nextTarget);
    setSelectedTentId('');
    setSelectedUserIds(new Set([candidateId]));
    setSelectedAwards(new Set([title]));
    window.setTimeout(() => document.getElementById('give-award')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const toggleUserId = (id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const giveAward = async () => {
    if (selectedAwards.size === 0) return;
    setSaving(true);
    try {
      for (const title of selectedAwards) {
        const def = AWARD_CATALOG.flatMap((g) => g.awards).find((a) => a.title === title);
        const desc = awardDescription.trim() || def?.description || null;
        if (targetType === 'tent') {
          if (!selectedTentId) continue;
          await awardTent(selectedTentId, title, desc, awardMonth);
        } else {
          for (const userId of selectedUserIds) {
            await giveAwardRPC(userId, title, desc, targetType === 'sentry' ? 'leadership' : targetType, awardMonth, targetType, userId);
          }
        }
      }
      setSelectedAwards(new Set());
      setAwardDescription('');
      setSelectedUserIds(new Set());
      setSelectedTentId('');
      onRefresh();
    } catch (e: any) { alert(e.message || 'Failed to give award'); }
    setSaving(false);
  };

  const cadenceColors: Record<string, string> = {
    weekly: 'bg-moss/10 text-moss border-moss/20',
    monthly: 'bg-gold/10 text-gold border-gold/20',
    annual: 'bg-coral/10 text-coral border-coral/20',
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Awards Hub" subtitle="Recognize outstanding cadets, sentries, and tents" />

      <div className="rounded-lg border border-gold/25 bg-gold/10 p-4 text-sm text-ink">
        <p className="font-semibold">Award measurement starts today: {formatShortDate(AWARD_MEASUREMENT_START)}.</p>
        <p className="mt-1 text-stone">
          From this point, awards should be judged from fresh app activity. Leadership awards belong to sentries; group awards belong to tents.
        </p>
      </div>

      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="font-display font-semibold text-ink">Suggested Award Watch</h4>
          {loadingRecommendations && <Loader2 size={16} className="animate-spin text-brass" />}
        </div>
        {recommendations.length === 0 ? (
          <p className="text-sm text-stone">No award signals yet. The app starts measuring from today.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {recommendations.map((item) => (
              <div key={`${item.title}:${item.candidate}`} className="rounded-lg border border-border-bright bg-surface-2 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-brass">{item.title}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase text-gold">Recommended winner</p>
                <p className="text-sm font-semibold text-ink">{item.candidate}</p>
                <p className="mt-1 text-xs text-stone">{item.detail}</p>
                {item.candidateId && (
                  <button type="button" onClick={() => prepareRecommendedAward(item.title, item.candidateId!)} className="btn-secondary mt-2 text-xs">
                    Select winner
                  </button>
                )}
                {item.quote && <blockquote className="mt-2 border-l-2 border-brass/50 pl-3 text-sm italic text-ink">“{item.quote}”</blockquote>}
                <div className="mt-3 border-t border-border pt-2">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase text-stone">Runners-up</p>
                  {item.runnersUp.length > 0 ? item.runnersUp.map((runner, index) => (
                    <div key={`${runner.candidate}:${index}`} className="mb-2 last:mb-0">
                      <p className="text-xs font-semibold text-ink">{index + 2}. {runner.candidate}</p>
                      <p className="text-[11px] text-stone">{runner.detail}</p>
                      {runner.candidateId && (
                        <button type="button" onClick={() => prepareRecommendedAward(item.title, runner.candidateId!)} className="mt-1 text-[11px] font-semibold text-brass hover:text-gold">
                          Select this sentry
                        </button>
                      )}
                      {runner.quote && <p className="mt-0.5 line-clamp-2 text-xs italic text-stone">“{runner.quote}”</p>}
                    </div>
                  )) : <p className="text-xs text-stone">No other qualifying candidate yet.</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="give-award" className="card scroll-mt-20 p-5 space-y-5">
        <h4 className="font-display font-semibold text-ink">Give an Award</h4>

        {/* Target type */}
        <div>
          <label className="text-xs text-stone block mb-1.5">Award Target</label>
          <div className="flex gap-2">
            {(['cadet', 'sentry', 'tent'] as const).map((t) => (
              <button key={t} onClick={() => { setTargetType(t); setSelectedUserIds(new Set()); setSelectedTentId(''); setSelectedAwards(new Set()); }}
                className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize',
                  targetType === t ? 'bg-peri text-navy' : 'bg-surface-2 text-stone hover:text-ink')}>
                {t === 'cadet' ? 'Cadet' : t === 'sentry' ? 'Sentry' : 'Tent'}
              </button>
            ))}
          </div>
        </div>

        {/* Recipient */}
        {targetType === 'tent' ? (
          <div>
            <label className="text-xs text-stone block mb-1">Select Tent</label>
            <select className="input-field" value={selectedTentId} onChange={(e) => setSelectedTentId(e.target.value)}>
              <option value="">Choose a tent…</option>
              {tents.map((t) => (
                <option key={t.id} value={t.id}>{t.name} · {t.tent_houses?.name || ''}</option>
              ))}
            </select>
            {selectedTentId && (
              <p className="text-xs text-stone mt-1">
                Awarding all {members.filter((m) => m.tent_id === selectedTentId && m.role === 'cadet').length} cadet(s) in this tent.
              </p>
            )}
          </div>
        ) : (
          <MultiSelectDropdown
            label={`Select ${targetType === 'cadet' ? 'Cadet(s)' : 'Sentry(s)'}`}
            placeholder={`Choose ${targetType}s…`}
            options={(targetType === 'cadet' ? cadets : sentries).map((r) => {
              const p = profiles.find((p) => p.id === r.user_id);
              return { id: r.user_id, label: p?.display_name || 'Unknown' };
            })}
            selected={selectedUserIds}
            onToggle={toggleUserId}
          />
        )}

        {/* Award catalog checkboxes */}
        <div>
          <label className="text-xs text-stone block mb-2">Select Awards <span className="text-stone/60">(choose one or more)</span></label>
          <div className="space-y-4">
            {visibleCatalog.map((group) => (
              <div key={group.group}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', cadenceColors[group.cadence])}>
                    {group.group}
                  </span>
                </div>
                <div className="space-y-1.5 pl-1">
                  {group.awards.map((award) => {
                    const checked = selectedAwards.has(award.title);
                    return (
                      <label key={award.title}
                        className={cn('flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                          checked ? 'border-peri bg-peri/5' : 'border-border-bright bg-surface-2 hover:border-stone/30')}>
                        <input type="checkbox" checked={checked} onChange={() => toggleAward(award.title)}
                          className="mt-0.5 accent-peri flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-ink leading-tight">{award.title}</p>
                          <p className="text-xs text-stone mt-0.5">{award.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-stone block mb-1">Notes (optional)</label>
          <textarea className="input-field" placeholder="Why are they receiving this award?" value={awardDescription} onChange={(e) => setAwardDescription(e.target.value)} rows={2} />
        </div>

        <div>
          <label className="text-xs text-stone block mb-1">Award Month</label>
          <input type="month" className="input-field" value={awardMonth} onChange={(e) => setAwardMonth(e.target.value)} />
        </div>

        <button onClick={giveAward}
          disabled={saving || selectedAwards.size === 0 || (targetType === 'tent' ? !selectedTentId : selectedUserIds.size === 0)}
          className="btn-primary text-sm">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <AwardIcon size={14} />}
          Give {selectedAwards.size > 1 ? `${selectedAwards.size} Awards` : 'Award'}{selectedUserIds.size > 1 ? ` to ${selectedUserIds.size} ${targetType}s` : ''}
        </button>
      </div>

      {/* Recent awards */}
      <div className="space-y-2">
        <h4 className="font-display font-semibold text-ink text-sm">Recent Awards</h4>
        {awards.length === 0 ? (
          <EmptyState icon={AwardIcon} title="No awards yet" message="Recognize your first cadet, sentry, or tent above." />
        ) : (
          awards.slice(0, 20).map((a) => (
            <div key={a.id} className="card p-3 flex items-center gap-3">
              <AwardIcon size={20} className="text-gold flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{a.title}</p>
                <p className="text-xs text-stone">
                  {a.target_tent?.name || a.profiles?.display_name || 'Full Circle member'}
                  {a.award_target_type === 'tent' && ' · Tent Award'}
                  {' · '}{a.award_month}
                </p>
                {a.target_tent && <p className="text-xs text-stone">Sentry: {a.target_tent.sentry?.display_name || 'Not assigned'}</p>}
                {a.description && <p className="text-xs text-stone mt-0.5 line-clamp-1">{a.description}</p>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function isQuizRelaunchDraft(session: QuizSession) {
  return Boolean(session.relaunch_of_id) || /\(Relaunch\)/i.test(session.title);
}

function buildQuizSchedule(date: string, time: string, countdownMinutes: number, durationMinutes: number) {
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Choose a valid quiz date and start time.');
  }
  const startMs = getAppDateTimeMs(date, hour, minute);
  if (!Number.isFinite(startMs)) throw new Error('Choose a valid quiz date and start time.');
  return {
    scheduledStart: new Date(startMs).toISOString(),
    countdownOpens: new Date(startMs - countdownMinutes * 60_000).toISOString(),
    liveOpens: new Date(startMs).toISOString(),
    liveCloses: new Date(startMs + durationMinutes * 60_000).toISOString(),
  };
}

function quizLocalTime(value: string | null | undefined) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '09:00';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function customQuestionsAsPlayableRows(sessionId: string, questions: CustomQuestion[]): Partial<GeneratedQuestion>[] {
  return questions.map((question, index) => ({
    quiz_session_id: sessionId,
    question_index: index + 1,
    source_narrative_date: question.narrative_date || null,
    difficulty_tag: (['easy', 'moderate', 'hard'].includes(question.difficulty_tag) ? question.difficulty_tag : 'moderate') as GeneratedQuestion['difficulty_tag'],
    mechanic_type: `custom_${question.question_type}`,
    recycled_from_game: false,
    question_payload: cleanQuestionPayload(customQuestionToPayload(question)),
  }));
}

function generatedQuestionsAsPlayableRows(sessionId: string, questions: GeneratedQuestion[]): Partial<GeneratedQuestion>[] {
  return questions.map((question, index) => ({
    quiz_session_id: sessionId,
    question_index: index + 1,
    source_narrative_date: question.source_narrative_date,
    difficulty_tag: question.difficulty_tag,
    mechanic_type: question.mechanic_type,
    recycled_from_game: question.recycled_from_game,
    question_payload: question.question_payload,
  }));
}

function QuizBuilder() {
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [narratives, setNarratives] = useState<DailyNarrative[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(getTodayISODate());
  const [newStartTime, setNewStartTime] = useState('09:00');
  const [newQuizType, setNewQuizType] = useState<'saturday' | 'fortune'>('saturday');
  const [waitTime, setWaitTime] = useState(15);
  const [quizDuration, setQuizDuration] = useState(30);
  const [selectedSession, setSelectedSession] = useState<QuizSession | null>(null);
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [satScheduled, setSatScheduled] = useState(false);
  const [editingSessionDetails, setEditingSessionDetails] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionDate, setSessionDate] = useState(getTodayISODate());
  const [sessionStartTime, setSessionStartTime] = useState('09:00');
  const [sessionType, setSessionType] = useState<'saturday' | 'fortune'>('saturday');
  const [savingSessionDetails, setSavingSessionDetails] = useState(false);
  const [launchingSessionId, setLaunchingSessionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, n, satSch] = await Promise.allSettled([
      fetchQuizSessions(),
      fetchNarratives(30),
      isSaturdayQuizScheduled(),
    ]);
    setSessions(s.status === 'fulfilled' ? s.value : []);
    setNarratives(n.status === 'fulfilled' ? n.value : []);
    setSatScheduled(satSch.status === 'fulfilled' ? satSch.value : false);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createSession = async () => {
    if (!newTitle.trim()) return;
    try {
      const schedule = buildQuizSchedule(newDate, newStartTime, waitTime, quizDuration);
      await createQuizSession({
        session_date: newDate,
        title: newTitle,
        scheduled_start_time: schedule.scheduledStart,
        countdown_opens_at: schedule.countdownOpens,
        live_opens_at: schedule.liveOpens,
        live_closes_at: schedule.liveCloses,
        status: 'scheduled',
        quiz_type: newQuizType,
        reward_perfect: newQuizType === 'fortune' ? 6000 : 6000,
        reward_partial: newQuizType === 'fortune' ? 1000 : 1000,
      } as any);
    } catch (e: any) {
      alert(e.message || 'Failed to create quiz session');
      return;
    }
    setNewTitle(''); setShowCreate(false); setNewQuizType('saturday');
    load();
  };

  const copyQuestionsIntoSession = async (sourceSessionId: string, targetSessionId: string) => {
    const existingTargetQuestions = await fetchQuestionsForSession(targetSessionId);
    if (existingTargetQuestions.length > 0) return existingTargetQuestions;

    const sourceGeneratedQuestions = sourceSessionId === targetSessionId
      ? existingTargetQuestions
      : await fetchQuestionsForSession(sourceSessionId);
    const rows = sourceGeneratedQuestions.length > 0
      ? generatedQuestionsAsPlayableRows(targetSessionId, sourceGeneratedQuestions)
      : customQuestionsAsPlayableRows(targetSessionId, await fetchCustomQuestions(sourceSessionId));
    if (rows.length === 0) return [];

    await insertQuestions(rows);
    return fetchQuestionsForSession(targetSessionId);
  };

  const launchQuiz = async (session: QuizSession) => {
    if (launchingSessionId) return;
    setLaunchingSessionId(session.id);
    try {
      const questions = await copyQuestionsIntoSession(session.id, session.id);
      if (selectedSession?.id === session.id) setGeneratedQuestions(questions);
      if (questions.length === 0) {
        alert('This quiz cannot be launched because it has no questions. Add, generate, or sync at least one question first.');
        return;
      }

      const now = Date.now();
      const liveOpensAt = new Date(session.live_opens_at).getTime();
      const liveClosesAt = new Date(session.live_closes_at).getTime();
      if (!Number.isFinite(liveOpensAt) || !Number.isFinite(liveClosesAt)) {
        alert('Save a valid quiz start time and duration before launching.');
        return;
      }
      if (liveClosesAt <= now) {
        alert('This quiz schedule has already ended. Edit the quiz and choose a future start time before launching.');
        return;
      }

      const { error } = await supabase.from('quiz_sessions').update({
        status: now >= liveOpensAt ? 'live' : 'countdown',
      }).eq('id', session.id);
      if (error) throw error;
      await load();
    } catch (error: any) {
      alert(error.message || 'This quiz could not be launched.');
    } finally {
      setLaunchingSessionId(null);
    }
  };

  const prepareQuizRelaunch = async (session: QuizSession) => {
    setGenerating(true);
    try {
      const existingDraft = sessions.find((candidate) => candidate.status === 'scheduled' && candidate.relaunch_of_id === session.id);
      if (existingDraft) {
        await copyQuestionsIntoSession(session.id, existingDraft.id);
        await openSession(existingDraft, true);
        return;
      }
      const now = new Date();
      const freshSession = await createQuizSession({
        session_date: getTodayISODate(),
        title: `${session.title.replace(/\s*\(Relaunch\)$/i, '')} (Relaunch)`,
        scheduled_start_time: now.toISOString(),
        countdown_opens_at: now.toISOString(),
        live_opens_at: now.toISOString(),
        live_closes_at: new Date(now.getTime() + quizDuration * 60 * 1000).toISOString(),
        status: 'scheduled',
        quiz_type: session.quiz_type,
        reward_perfect: session.reward_perfect,
        reward_partial: session.reward_partial,
        relaunch_of_id: session.id,
        relaunch_ready: false,
      } as Partial<QuizSession>);

      await copyQuestionsIntoSession(session.id, freshSession.id);

      await load();
      await openSession(freshSession, true);
    } catch (error: any) {
      alert(error.message || 'Could not prepare this quiz for relaunch.');
    } finally {
      setGenerating(false);
    }
  };

  const generateQuestions = async (session: QuizSession) => {
    setGenerating(true);
    try {
      const day = new Date(`${session.session_date}T12:00:00.000Z`).getUTCDay();
      const saturday = shiftISODate(session.session_date, -((day - 6 + 7) % 7));
      const weekEnd = shiftISODate(saturday, 6);
      const weekNarratives = narratives.filter((narrative) => {
        return narrative.narrative_date >= saturday && narrative.narrative_date <= weekEnd;
      });
      const generated = await generateInstructorQuestionsWithAI({
        mode: 'quiz',
        narrativeDates: weekNarratives.map((narrative) => narrative.narrative_date),
        count: 10,
      });
      if (generated.length === 0) throw new Error('No narrative scripture content found for this quiz week.');
      await deleteQuestionsForSession(session.id);
      const questionsToInsert = generated.slice(0, 10).map((q, i) => ({
        quiz_session_id: session.id,
        question_index: i + 1,
        source_narrative_date: weekNarratives[i % weekNarratives.length]?.narrative_date || null,
        difficulty_tag: q.difficulty_tag || (i < 3 ? 'easy' : i < 7 ? 'moderate' : 'hard'),
        mechanic_type: `ai_${q.type}`,
        recycled_from_game: false,
        question_payload: cleanQuestionPayload(q),
      }));
      await insertQuestions(questionsToInsert);
      const qs = await fetchQuestionsForSession(session.id);
      setGeneratedQuestions(qs);
      await markRelaunchReady(session);
    } catch (e: any) {
      alert(`Failed to generate: ${e.message}`);
    }
    setGenerating(false);
  };

  const syncTaggedQuestions = async (session: QuizSession) => {
    setGenerating(true);
    try {
      const tagged = await fetchQuizTaggedGameQuestions(50);
      const existingKeys = new Set(generatedQuestions.map((q) => `${q.source_narrative_date || ''}:${q.question_payload.question}`));
      const additions = tagged
        .map((q) => ({
          source_date: q.narrative_date || null,
          difficulty: (q.difficulty_tag || 'moderate') as 'easy' | 'moderate' | 'hard',
          mechanic: `tagged_${q.question_type}`,
          payload: cleanQuestionPayload(customQuestionToPayload(q)),
          recycled: true,
        }))
        .filter((q) => !existingKeys.has(`${q.source_date || ''}:${q.payload.question}`));

      if (additions.length === 0) {
        alert('No new tagged questions to sync.');
        setGenerating(false);
        return;
      }

      const current = await fetchQuestionsForSession(session.id);
      const startIndex = Math.max(0, ...current.map((q) => q.question_index)) + 1;
      await insertQuestions(additions.map((q, index) => ({
        quiz_session_id: session.id,
        question_index: startIndex + index,
        source_narrative_date: q.source_date,
        difficulty_tag: q.difficulty,
        mechanic_type: q.mechanic,
        recycled_from_game: q.recycled,
        question_payload: q.payload,
      })));
      const qs = await fetchQuestionsForSession(session.id);
      setGeneratedQuestions(qs);
      await markRelaunchReady(session);
    } catch (e: any) {
      alert(`Failed to sync tagged questions: ${e.message}`);
    }
    setGenerating(false);
  };

  const openSession = async (session: QuizSession, beginEditing = false) => {
    setSelectedSession(session);
    setSessionTitle(session.title);
    setSessionDate(session.session_date);
    setSessionStartTime(quizLocalTime(session.live_opens_at || session.scheduled_start_time));
    setSessionType(session.quiz_type || 'saturday');
    setEditingSessionDetails(beginEditing);
    const countdownMinutes = Math.round((new Date(session.live_opens_at).getTime() - new Date(session.countdown_opens_at).getTime()) / 60_000);
    const durationMinutes = Math.round((new Date(session.live_closes_at).getTime() - new Date(session.live_opens_at).getTime()) / 60_000);
    if (countdownMinutes > 0) setWaitTime(countdownMinutes);
    if (durationMinutes > 0) setQuizDuration(durationMinutes);
    const qs = await fetchQuestionsForSession(session.id);
    setGeneratedQuestions(qs);
  };

  const saveSessionDetails = async () => {
    if (!selectedSession || !sessionTitle.trim()) return;
    setSavingSessionDetails(true);
    try {
      const schedule = buildQuizSchedule(sessionDate, sessionStartTime, waitTime, quizDuration);
      const { data, error } = await supabase.from('quiz_sessions').update({
        title: sessionTitle.trim(),
        session_date: sessionDate,
        quiz_type: sessionType,
        scheduled_start_time: schedule.scheduledStart,
        countdown_opens_at: schedule.countdownOpens,
        live_opens_at: schedule.liveOpens,
        live_closes_at: schedule.liveCloses,
        ...(isQuizRelaunchDraft(selectedSession) ? { relaunch_ready: true } : {}),
      }).eq('id', selectedSession.id).select().maybeSingle();
      if (error) throw error;
      if (data) setSelectedSession(data as QuizSession);
      setEditingSessionDetails(false);
      await load();
    } catch (error: any) {
      alert(error.message || 'Could not save quiz details.');
    } finally {
      setSavingSessionDetails(false);
    }
  };

  const markRelaunchReady = async (session: QuizSession) => {
    if (!isQuizRelaunchDraft(session) || session.relaunch_ready) return;
    const { data, error } = await supabase.from('quiz_sessions')
      .update({ relaunch_ready: true })
      .eq('id', session.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (data) setSelectedSession(data as QuizSession);
    await load();
  };

  const editGeneratedQuestion = async (question: GeneratedQuestion) => {
    const nextQuestion = window.prompt('Question', String(question.question_payload.question || ''));
    if (nextQuestion === null) return;
    const nextAnswer = window.prompt('Correct answer', String(question.question_payload.correct_answer || ''));
    if (nextAnswer === null) return;
    const optionsText = window.prompt('Options, one per line', (question.question_payload.options || []).join('\n'));
    if (optionsText === null) return;
    const options = optionsText.split('\n').map((item) => item.trim()).filter(Boolean);
    await updateGeneratedQuestion(question.id, {
      question_payload: {
        ...question.question_payload,
        question: nextQuestion.trim(),
        correct_answer: nextAnswer.trim(),
        options: options.length > 0 ? options : undefined,
      },
    } as any);
    setGeneratedQuestions(await fetchQuestionsForSession(question.quiz_session_id));
    if (selectedSession?.id === question.quiz_session_id) await markRelaunchReady(selectedSession);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  if (selectedSession) {
    const selectedEditable = selectedSession.status === 'scheduled';
    const selectedIsRelaunch = isQuizRelaunchDraft(selectedSession);
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <SectionHeader title={selectedSession.title} subtitle={`${formatShortDate(selectedSession.session_date)} at ${quizLocalTime(selectedSession.live_opens_at)} · ${selectedSession.status}`} />
          </div>
          <button onClick={() => setSelectedSession(null)} className="btn-secondary text-sm">Back</button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {selectedEditable ? <>
            <button onClick={() => setEditingSessionDetails(!editingSessionDetails)} className="btn-secondary text-sm">
              <FileQuestion size={14} /> Edit Quiz
            </button>
            <button onClick={() => launchQuiz(selectedSession)} disabled={generating || launchingSessionId === selectedSession.id || (selectedIsRelaunch && !selectedSession.relaunch_ready)} className="btn-primary text-sm">
              {launchingSessionId === selectedSession.id ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} {selectedIsRelaunch ? 'Relaunch' : 'Launch'}
            </button>
            <button onClick={() => generateQuestions(selectedSession)} disabled={generating} className="btn-primary text-sm">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {generatedQuestions.length > 0 ? 'Regenerate Questions' : 'Generate Questions'}
            </button>
            <button onClick={() => syncTaggedQuestions(selectedSession)} disabled={generating} className="btn-secondary text-sm">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Sync Tagged Questions
            </button>
          </> : (
            <button onClick={() => prepareQuizRelaunch(selectedSession)} disabled={generating} className="btn-secondary text-sm">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <FileQuestion size={14} />} Edit for Relaunch
            </button>
          )}
          <span className="text-xs text-stone">{generatedQuestions.length} questions</span>
        </div>

        {selectedIsRelaunch && selectedEditable && !selectedSession.relaunch_ready && (
          <p className="rounded-lg border border-gold/35 bg-gold-soft px-3 py-2 text-xs text-stone">Review the quiz and save an edit. Relaunch becomes available immediately after it is saved.</p>
        )}

        {selectedEditable && generatedQuestions.length === 0 && (
          <p className="rounded-lg border border-coral/35 bg-coral-soft px-3 py-2 text-xs text-coral">Add, generate, or sync at least one question before launch. Instructor-written custom questions are converted into the playable set automatically.</p>
        )}

        {editingSessionDetails && (
          <div className="card p-4 space-y-3 bg-surface-2">
            <div>
              <label className="text-xs text-stone block mb-1">Quiz Title</label>
              <input className="input-field" value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-stone block mb-1">Quiz Date</label>
                <input type="date" className="input-field" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} />
              </div>
              <div>
                <label className="text-xs text-stone block mb-1">Quiz Start Time</label>
                <input type="time" className="input-field" value={sessionStartTime} onChange={(event) => setSessionStartTime(event.target.value)} />
              </div>
              <div>
                <label className="text-xs text-stone block mb-1">Quiz Type</label>
                <select className="input-field" value={sessionType} onChange={(event) => setSessionType(event.target.value as 'saturday' | 'fortune')}>
                  <option value="saturday">Saturday Quiz</option>
                  <option value="fortune">Fortune Quiz</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-stone block mb-1">Countdown (minutes)</label>
                <input type="number" min={1} max={180} className="input-field" value={waitTime} onChange={(event) => setWaitTime(Number(event.target.value) || 1)} />
              </div>
              <div>
                <label className="text-xs text-stone block mb-1">Quiz Duration (minutes)</label>
                <input type="number" min={5} max={300} className="input-field" value={quizDuration} onChange={(event) => setQuizDuration(Number(event.target.value) || 5)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={saveSessionDetails} disabled={savingSessionDetails} className="btn-primary text-sm">
                {savingSessionDetails ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Quiz Changes
              </button>
              <button onClick={() => setEditingSessionDetails(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        )}

        {generatedQuestions.length > 0 && (
          <div className="space-y-2">
            {generatedQuestions.map((q, i) => (
              <div key={q.id} className="card p-3 bg-surface-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-bold text-brass font-display flex-shrink-0">Q{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="badge badge-brass text-xs">{q.difficulty_tag}</span>
                      <span className="text-xs text-stone">{q.mechanic_type}</span>
                    </div>
                    <p className="text-sm text-ink font-medium">{q.question_payload.question}</p>
                    {q.question_payload.options && (
                      <div className="mt-1.5 space-y-0.5">
                        {q.question_payload.options.map((opt: string, idx: number) => (
                          <p key={idx} className={`text-xs ${opt === q.question_payload.correct_answer ? 'text-moss font-bold' : 'text-stone'}`}>
                            {String.fromCharCode(65 + idx)}. {opt}
                          </p>
                        ))}
                      </div>
                    )}
                    {!q.question_payload.options && (
                      <p className="text-xs text-moss mt-1">Answer: {q.question_payload.correct_answer}</p>
                    )}
                    {selectedEditable && <button onClick={() => editGeneratedQuestion(q)} className="btn-secondary text-xs mt-3">
                      Edit Question
                    </button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedEditable && <CustomQuestionsEditor sessionId={selectedSession.id} />}
        <QuizAnswerSheets session={selectedSession} questions={generatedQuestions} />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <SectionHeader title="Quiz Builder" subtitle="Create weekly Saturday quizzes from narrative content" />
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-sm">
          <Plus size={16} /> New Quiz
        </button>
      </div>

      {showCreate && (
        <div className="card p-4 space-y-3 bg-surface-2">
          <div>
            <label className="text-xs text-stone block mb-1">Quiz Type</label>
            <select className="input-field text-sm" value={newQuizType} onChange={(e) => setNewQuizType(e.target.value as 'saturday' | 'fortune')}>
              <option value="saturday">Saturday Quiz (scheduled, streak-critical)</option>
              <option value="fortune">Fortune Quiz (random, bonus rewards)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-stone block mb-1">Quiz Title</label>
            <input className="input-field" placeholder="e.g. Week 3 Saturday Quiz" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone block mb-1">Session Date</label>
              <input type="date" className="input-field" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Quiz Start Time</label>
              <input type="time" className="input-field" value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone block mb-1">Wait Time (min before quiz opens)</label>
              <input type="number" min={1} max={180} className="input-field" value={waitTime} onChange={(e) => setWaitTime(Number(e.target.value) || 60)} />
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Quiz Duration (min live)</label>
              <input type="number" min={5} max={300} className="input-field" value={quizDuration} onChange={(e) => setQuizDuration(Number(e.target.value) || 90)} />
            </div>
          </div>
          <p className="text-xs text-stone">
            {newQuizType === 'saturday'
              ? `Saturday quiz begins at ${newStartTime} after a ${waitTime}-minute waiting room and remains open for ${quizDuration} minutes. It is the sole streak validation for that Saturday.`
              : `Fortune quiz: 1 talent (6,000 Ð) for perfect score, 1,000 Ð for anything less. ${!satScheduled ? '⚠ You must schedule a Saturday quiz first!' : 'Ready to launch — Saturday quiz is scheduled.'}`}
          </p>
          <button onClick={createSession} disabled={newQuizType === 'fortune' && !satScheduled} className="btn-primary text-sm">
            <Save size={14} /> Create Session
          </button>
          {newQuizType === 'fortune' && !satScheduled && (
            <p className="text-xs text-roman">You cannot create a Fortune Quiz until a Saturday Quiz is scheduled.</p>
          )}
        </div>
      )}

      {sessions.length === 0 ? (
        <EmptyState icon={FileQuestion} title="No quiz sessions yet" message="Create a new quiz session and generate questions from your narratives." />
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const relaunchDraft = isQuizRelaunchDraft(s);
            const launched = s.status !== 'scheduled';
            return (
            <div key={s.id} className="card p-4 flex items-center justify-between card-hover bg-surface">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{s.title}</p>
                <p className="text-xs text-stone">
                  {formatShortDate(s.session_date)} at {quizLocalTime(s.live_opens_at)} · {s.status} · {s.quiz_type === 'fortune' ? 'Fortune' : 'Saturday'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {s.status === 'scheduled' && !relaunchDraft && (
                  <button onClick={() => launchQuiz(s)} disabled={launchingSessionId === s.id} className="btn-primary text-xs">
                    {launchingSessionId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />} Launch
                  </button>
                )}
                {s.status === 'scheduled' && relaunchDraft && s.relaunch_ready && (
                  <button onClick={() => launchQuiz(s)} disabled={launchingSessionId === s.id} className="btn-primary text-xs">
                    {launchingSessionId === s.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Relaunch
                  </button>
                )}
                {s.status === 'scheduled' && relaunchDraft && !s.relaunch_ready && (
                  <button onClick={() => openSession(s, true)} className="btn-secondary text-xs">
                    <FileQuestion size={12} /> Edit
                  </button>
                )}
                {launched && (
                  <button onClick={() => prepareQuizRelaunch(s)} disabled={generating} className="btn-secondary text-xs">
                    <FileQuestion size={12} /> Edit
                  </button>
                )}
                <button onClick={() => openSession(s)} className="btn-secondary text-xs">Open</button>
              </div>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

function InstructorSettings({ profile, tents, members }: {
  profile: Profile | null; tents: any[]; members: any[];
}) {
  const { signOut, refreshProfile } = useAuth();
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp_number || '');
  const [country, setCountry] = useState(profile?.country_code || 'CM');
  const [language, setLanguage] = useState(profile?.language_code || 'en');
  const [birthday, setBirthday] = useState(formatBirthdayInput(profile?.birth_month, profile?.birth_day));
  const [saving, setSaving] = useState(false);
  const [mmSettings, setMmSettings] = useState<MobileMoneySettings | null>(null);
  const [mmForm, setMmForm] = useState<Partial<MobileMoneySettings>>({
    provider_name: 'MTN MoMo',
    phone_number: '',
    account_name: '',
    instructions: '',
    payout_enabled: true,
    payout_provider_name: 'MTN MoMo',
    payout_phone_number: '',
    payout_account_name: '',
    payout_max_amount_xaf: null,
  });
  const [mmSaving, setMmSaving] = useState(false);
  const [passwordPage, setPasswordPage] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchMobileMoneySettings();
        if (s) {
          setMmSettings(s);
          setMmForm({
            provider_name: s.provider_name,
            phone_number: s.phone_number,
            account_name: s.account_name,
            instructions: s.instructions || '',
            payout_enabled: s.payout_enabled ?? true,
            payout_provider_name: s.payout_provider_name || s.provider_name,
            payout_phone_number: s.payout_phone_number || s.phone_number,
            payout_account_name: s.payout_account_name || s.account_name,
            payout_max_amount_xaf: s.payout_max_amount_xaf ?? null,
          });
        }
      } catch {}
    })();
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const parsedBirthday = parseBirthdayInput(birthday);
      await saveOwnProfilePreferences({
        whatsappNumber: whatsapp,
        countryCode: country,
        languageCode: language,
        birthMonth: parsedBirthday.month,
        birthDay: parsedBirthday.day,
      });
      document.documentElement.lang = language;
      await refreshProfile();
    } catch (error: any) {
      alert(error.message || 'Could not save profile settings.');
    }
    setSaving(false);
  };

  const saveMmSettings = async () => {
    setMmSaving(true);
    try {
      await saveMobileMoneySettings(mmForm);
      const saved = await fetchMobileMoneySettings();
      if (saved) setMmSettings(saved);
      alert('Mobile Money settings saved.');
    } catch (e: any) { alert(e.message); }
    setMmSaving(false);
  };

  return (
    passwordPage && profile?.email ? (
      <PasswordUpdateFlow email={profile?.email || ''} onDone={() => setPasswordPage(false)} />
    ) : (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Settings" subtitle="Manage your account and preferences" />

      <div className="card p-4 space-y-3">
        <h4 className="font-display font-semibold text-ink">Your Profile</h4>
        <p className="text-sm text-stone">{profile?.display_name}</p>
        <p className="text-sm text-stone">{profile?.email}</p>
        <div>
          <label className="text-xs text-stone block mb-1">WhatsApp Number (for cadets/sentries to contact you)</label>
          <input className="input-field" placeholder="+1234567890" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-stone">
            <span className="mb-1 flex items-center gap-1"><Globe2 size={12} /> Country</span>
            <select className="input-field" value={country} onChange={(event) => setCountry(event.target.value)}>
              {PROFILE_COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <label className="block text-xs text-stone">
            <span className="mb-1 flex items-center gap-1"><Languages size={12} /> Language</span>
            <select className="input-field" value={language} onChange={(event) => setLanguage(event.target.value)}>
              {PROFILE_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <label className="block text-xs text-stone">
            <span className="mb-1 flex items-center gap-1"><Cake size={12} /> Birthday</span>
            <input className="input-field" value={birthday} onChange={(event) => setBirthday(event.target.value)} placeholder="MM/DD" inputMode="numeric" />
          </label>
        </div>
        <button onClick={save} disabled={saving} className="btn-primary text-sm">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
      </div>

      <div className="card p-4 space-y-3">
        <h4 className="font-display font-semibold text-ink">Account</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-xs text-stone font-bold uppercase tracking-wide">Tents</p>
            <p className="font-display text-xl text-ink font-bold">{tents.length}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-xs text-stone font-bold uppercase tracking-wide">Members</p>
            <p className="font-display text-xl text-ink font-bold">{members.length}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="w-full btn-danger justify-center"
        >
          <LogOut size={16} /> Sign Out
        </button>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-royal" />
          <h4 className="font-display font-semibold text-ink">Change Password</h4>
        </div>
        <p className="text-xs text-stone">Confirm your old password first, then set the new one.</p>
        <button onClick={() => setPasswordPage(true)} className="btn-primary text-sm">
          <KeyRound size={14} /> Update Password
        </button>
      </div>

      <BrowserNotificationSettings />

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone size={18} className="text-moss" />
          <h4 className="font-display font-semibold text-ink">Mobile Money Settings</h4>
        </div>
        <p className="text-xs text-stone">Cadets can request MTN MoMo or Orange Money payments in the platform. Confirmed funds can be paid out to the number you save here.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-stone block mb-1">Receiving Provider</label>
            <select className="input-field text-sm" value={mmForm.provider_name || 'MTN MoMo'} onChange={(e) => setMmForm({ ...mmForm, provider_name: e.target.value })}>
              <option value="MTN MoMo">MTN MoMo</option>
              <option value="Orange Money">Orange Money</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-stone block mb-1">Receiving Number</label>
            <input className="input-field text-sm" placeholder="2376XXXXXXXX" value={mmForm.phone_number || ''} onChange={(e) => setMmForm({ ...mmForm, phone_number: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="text-xs text-stone block mb-1">Receiving Account Name</label>
          <input className="input-field text-sm" placeholder="John Doe" value={mmForm.account_name || ''} onChange={(e) => setMmForm({ ...mmForm, account_name: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-stone block mb-1">Extra Instructions (optional)</label>
          <textarea className="input-field text-sm" rows={2} placeholder="e.g. Use this account for support follow-up" value={mmForm.instructions || ''} onChange={(e) => setMmForm({ ...mmForm, instructions: e.target.value })} />
        </div>
        <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm text-ink">
            <span className="font-medium">Auto-withdraw confirmed CamPay payments</span>
            <input
              type="checkbox"
              checked={mmForm.payout_enabled ?? true}
              onChange={(e) => setMmForm({ ...mmForm, payout_enabled: e.target.checked })}
              className="accent-peri"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone block mb-1">Payout Provider</label>
              <select className="input-field text-sm" value={mmForm.payout_provider_name || mmForm.provider_name || 'MTN MoMo'} onChange={(e) => setMmForm({ ...mmForm, payout_provider_name: e.target.value })}>
                <option value="MTN MoMo">MTN MoMo</option>
                <option value="Orange Money">Orange Money</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Payout Number</label>
              <input className="input-field text-sm" placeholder="2376XXXXXXXX" value={mmForm.payout_phone_number || ''} onChange={(e) => setMmForm({ ...mmForm, payout_phone_number: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone block mb-1">Payout Account Name</label>
              <input className="input-field text-sm" placeholder="John Doe" value={mmForm.payout_account_name || ''} onChange={(e) => setMmForm({ ...mmForm, payout_account_name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Max Per Withdrawal (FCFA)</label>
              <input
                type="number"
                min={1}
                className="input-field text-sm"
                placeholder="Leave blank for full payment"
                value={mmForm.payout_max_amount_xaf ?? ''}
                onChange={(e) => setMmForm({ ...mmForm, payout_max_amount_xaf: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          </div>
          {mmSettings?.updated_at && <p className="text-[10px] text-stone">Last saved {new Date(mmSettings.updated_at).toLocaleString()}</p>}
        </div>
        <button onClick={saveMmSettings} disabled={mmSaving} className="btn-primary text-sm">
          {mmSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Mobile Money Settings
        </button>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard size={18} className="text-peri" />
          <h4 className="font-display font-semibold text-ink">CamPay Payments</h4>
        </div>
        <p className="text-xs text-stone">
          Real-money relic purchases are processed through CamPay in the backend. Cadets stay in the platform
          while MTN MoMo and Orange Money prompts are initiated.
          Configure your CamPay credentials and webhook key in your project secrets.
        </p>
        <div className="p-3 rounded-lg bg-surface-2 text-xs text-stone space-y-1">
          <p><strong>Required secrets:</strong></p>
          <p>· CAMPAY_APP_USERNAME — your CamPay app username</p>
          <p>· CAMPAY_APP_PASSWORD — your CamPay app password</p>
          <p>· CAMPAY_WEBHOOK_KEY — your CamPay webhook key</p>
          <p><strong>Webhook URL:</strong> https://kckzqsafzemeijxfohuy.supabase.co/functions/v1/campay-webhook</p>
        </div>
      </div>

      <div className="card p-4 space-y-2 border-coral/20">
        <h4 className="font-display font-semibold text-coral">Hand Over Instructor Role</h4>
        <p className="text-xs text-stone">There can only be one instructor at a time. When you promote a sentry to instructor, you are automatically demoted. Use with care.</p>
        <p className="text-xs text-stone">Visit Sentry Management to promote a sentry to instructor.</p>
      </div>
    </div>
    )
  );
}


function ChallengeReview({ instructorId, onRefresh }: { instructorId: string; onRefresh: () => void }) {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllChallengeSubmissions(instructorId);
      setSubmissions(data || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setReviewingId(id);
    try {
      await reviewChallengeSubmission(id, 'approved', null, instructorId);
      await load();
      onRefresh();
    } catch (e: any) { alert(e.message); }
    setReviewingId(null);
  };

  const reject = async (id: string) => {
    if (!rejectionReason.trim()) return;
    setReviewingId(id);
    try {
      await reviewChallengeSubmission(id, 'rejected', rejectionReason.trim(), instructorId);
      setRejectingId(null);
      setRejectionReason('');
      await load();
      onRefresh();
    } catch (e: any) { alert(e.message); }
    setReviewingId(null);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  const pending = submissions.filter((s) => s.status === 'pending');
  const reviewed = submissions.filter((s) => s.status !== 'pending');

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Challenge Review" subtitle="Approve or reject cadet challenge submissions" />

      {pending.length === 0 && reviewed.length === 0 ? (
        <EmptyState icon={Target} title="No submissions yet" message="Cadet challenge submissions will appear here for your review." />
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display font-semibold text-ink text-sm">Pending ({pending.length})</h3>
              {pending.map((s) => (
                <div key={s.id} className="card p-4 border-gold/30">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{s.profiles?.display_name || 'Unknown cadet'}</p>
                      <p className="text-xs text-stone">{s.narrative_date} · {s.proof_type}</p>
                    </div>
                    <span className="badge badge-gold text-[10px]">Pending</span>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-2 text-sm text-ink mb-3">
                    {s.proof_text}
                  </div>
                  {rejectingId === s.id ? (
                    <div className="space-y-2 animate-slide-up">
                      <textarea
                        className="input-field text-sm"
                        placeholder="Why are you rejecting this? (The cadet will see this reason)"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button onClick={() => reject(s.id)} disabled={!rejectionReason.trim() || reviewingId === s.id} className="btn-danger text-xs">
                          {reviewingId === s.id ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Confirm Reject
                        </button>
                        <button onClick={() => { setRejectingId(null); setRejectionReason(''); }} className="btn-ghost text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => approve(s.id)} disabled={reviewingId === s.id} className="btn-primary text-xs" style={{ color: 'var(--color-moss)', borderColor: 'var(--color-moss-soft)' }}>
                        {reviewingId === s.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Approve
                      </button>
                      <button onClick={() => setRejectingId(s.id)} className="btn-danger text-xs">
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {reviewed.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display font-semibold text-ink text-sm">Reviewed ({reviewed.length})</h3>
              {reviewed.slice(0, 10).map((s) => (
                <div key={s.id} className="card p-3 opacity-70">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-ink">{s.profiles?.display_name || 'Unknown'}</p>
                      <p className="text-xs text-stone">{s.narrative_date} · {s.proof_type}</p>
                    </div>
                    <span className={`badge text-[10px] ${s.status === 'approved' ? 'badge-moss' : 'badge-coral'}`}>
                      {s.status === 'approved' ? <CheckCircle2 size={10} className="mr-1" /> : <XCircle size={10} className="mr-1" />}
                      {s.status}
                    </span>
                  </div>
                  {s.rejection_reason && (
                    <p className="text-xs text-coral mt-2 pl-3 border-l-2 border-coral/30">{s.rejection_reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuizAnswerSheets({ session, questions }: { session: QuizSession; questions: GeneratedQuestion[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sheets, setSheets] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      setSheets(await fetchQuizAnswerSheets(session.id));
    } catch (e: any) {
      alert(e.message || 'Could not load quiz answer sheets.');
    }
    setLoading(false);
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && sheets.length === 0) await load();
  };

  const questionById = new Map(questions.map((question) => [question.id, question]));

  return (
    <div className="card p-4 bg-surface">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold text-ink text-sm">Participant Answer Sheets</h3>
          <p className="text-xs text-stone">Instructor-only score and response review.</p>
        </div>
        <button onClick={toggle} className="btn-secondary text-xs">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
          {open ? 'Hide Sheets' : 'View Sheets'}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-xs text-stone flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading...</p>
          ) : sheets.length === 0 ? (
            <p className="text-xs text-stone">No submitted attempts yet.</p>
          ) : (
            sheets.map((attempt) => (
              <div key={attempt.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{attempt.profiles?.display_name || 'Unknown participant'}</p>
                    <p className="text-xs text-stone">{attempt.profiles?.email || ''}</p>
                  </div>
                  <span className="badge badge-gold text-[10px]">{attempt.talents_scored || 0} figs</span>
                </div>
                <div className="space-y-2">
                  {(attempt.question_responses || []).map((response: any, index: number) => {
                    const question = questionById.get(response.question_id);
                    return (
                      <div key={response.id || index} className="rounded-md border border-border bg-surface p-2">
                        <p className="text-xs font-semibold text-ink">{question?.question_payload?.question || `Question ${index + 1}`}</p>
                        <p className="text-xs text-stone mt-1">Answer: <span className="text-ink">{String(response.answer_given ?? 'No answer')}</span></p>
                        <p className={cn('text-[10px] mt-1', response.is_correct ? 'text-sage' : 'text-coral')}>
                          {response.is_correct ? 'Correct' : `Incorrect · Correct answer: ${question?.question_payload?.correct_answer || 'Not available'}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CustomQuestionsEditor({ sessionId }: { sessionId: string }) {
  const { profile } = useAuth();
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [qText, setQText] = useState('');
  const [qType, setQType] = useState('multiple_choice');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [passage, setPassage] = useState('');
  const [difficulty, setDifficulty] = useState('moderate');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCustomQuestions(sessionId);
      setQuestions(data || []);
    } catch {}
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const addQuestion = async () => {
    if (!qText.trim() || !correctAnswer.trim() || !profile) return;
    setSaving(true);
    try {
      const opts = ['multiple_choice', 'comprehension', 'order_sequence'].includes(qType)
        ? options.filter((o) => o.trim())
        : qType === 'true_false'
          ? ['True', 'False']
          : null;
      await insertCustomQuestion({
        instructor_id: profile.id,
        quiz_session_id: sessionId,
        question_text: qText,
        question_type: qType,
        options: opts,
        correct_answer: correctAnswer,
        explanation: explanation || null,
        passage: passage || null,
        difficulty_tag: difficulty,
        question_index: questions.length,
      });
      setQText(''); setOptions(['', '', '', '']); setCorrectAnswer(''); setExplanation(''); setPassage('');
      setShowForm(false);
      await load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  return (
    <div className="space-y-3 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-display font-semibold text-ink text-sm">Custom Questions</h4>
          <p className="text-xs text-stone">Write your own questions instead of auto-generating</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-xs">
          <Plus size={12} /> Add Question
        </button>
      </div>

      {showForm && (
        <div className="card p-4 space-y-3 bg-surface-2 animate-slide-up">
          <div>
            <label className="text-xs text-stone block mb-1">Question Text</label>
            <textarea className="input-field text-sm" placeholder="Enter your question…" value={qText} onChange={(e) => setQText(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-stone block mb-1">Type</label>
            <select className="input-field text-sm" value={qType} onChange={(e) => setQType(e.target.value)}>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="true_false">True / False</option>
              <option value="order_sequence">Order / Sequence</option>
              <option value="scriptorium">Scriptorium (Verse ID)</option>
              <option value="comprehension">Comprehension</option>
            </select>
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Difficulty</label>
              <select className="input-field text-sm" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="easy">Easy</option>
                <option value="moderate">Moderate</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>
          {(qType === 'multiple_choice' || qType === 'comprehension' || qType === 'order_sequence') && (
            <div>
              <label className="text-xs text-stone block mb-1">
                {qType === 'order_sequence' ? 'Items to Order' : 'Options'}
              </label>
              {options.map((opt, i) => (
                <input key={i} className="input-field text-sm mb-1" placeholder={qType === 'order_sequence' ? `Item ${i + 1}` : `Option ${String.fromCharCode(65 + i)}`}
                  value={opt} onChange={(e) => { const o = [...options]; o[i] = e.target.value; setOptions(o); }} />
              ))}
            </div>
          )}
          <div>
            <label className="text-xs text-stone block mb-1">
              {qType === 'order_sequence' ? 'Correct Order' : `Correct Answer ${qType === 'true_false' ? '(True or False)' : ''}`}
            </label>
            <input className="input-field text-sm" placeholder={qType === 'true_false' ? 'True' : qType === 'order_sequence' ? 'Use | between items' : 'Enter correct answer…'}
              value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} />
          </div>
          {(qType === 'comprehension' || qType === 'scriptorium') && (
            <div>
              <label className="text-xs text-stone block mb-1">{qType === 'scriptorium' ? 'First-letter Hint (optional)' : 'Passage (optional)'}</label>
              <textarea className="input-field text-sm" rows={2}
                placeholder={qType === 'scriptorium' ? 'Leave blank to generate from the answer' : 'Passage shown before answering'}
                value={passage} onChange={(e) => setPassage(e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs text-stone block mb-1">Explanation (optional)</label>
            <input className="input-field text-sm" placeholder="Why is this correct?" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </div>
          <button onClick={addQuestion} disabled={saving || !qText.trim() || !correctAnswer.trim()} className="btn-primary text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Question
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-brass" /></div>
      ) : questions.length === 0 ? (
        <p className="text-xs text-stone text-center py-3">No custom questions yet. Click "Add Question" to create your own.</p>
      ) : (
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={q.id} className="card p-3 bg-surface-2">
              <div className="flex items-start gap-2">
                <span className="text-xs font-bold text-peri font-display flex-shrink-0">CQ{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="badge badge-peri text-[10px]">{q.question_type.replace(/_/g, ' ')}</span>
                    <span className="badge badge-neutral text-[10px]">{q.difficulty_tag}</span>
                  </div>
                  <p className="text-sm text-ink font-medium">{q.question_text}</p>
                  <p className="text-xs text-moss mt-1">Answer: {q.correct_answer}</p>
                  {q.options && <p className="text-xs text-stone mt-0.5">Options: {q.options.join(' · ')}</p>}
                </div>
                <button onClick={async () => { await deleteCustomQuestion(q.id); await load(); }}
                  className="text-stone hover:text-coral transition-colors flex-shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Game Questions Editor ──
function GameQuestionsEditor({ profile }: { profile: Profile }) {
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [selectedRound, setSelectedRound] = useState<number | 'all'>(1);
  const [narratives, setNarratives] = useState<DailyNarrative[]>([]);
  const [selectedNarrativeDate, setSelectedNarrativeDate] = useState('');
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [levelQuestionType, setLevelQuestionType] = useState('true_false');
  const [roundQuestionTypes, setRoundQuestionTypes] = useState<Record<number, string>>({ 1: 'comprehension', 2: 'multiple_choice', 3: 'standard_text' });
  const [roundTimers, setRoundTimers] = useState<Record<number, number>>({
    1: LEVEL_TIMERS[0] || 60,
    2: Math.max((LEVEL_TIMERS[0] || 60) - 5, 20),
    3: Math.max((LEVEL_TIMERS[0] || 60) - 10, 20),
  });
  const [roundPassageDurations, setRoundPassageDurations] = useState<Record<number, number>>({
    1: DEFAULT_PASSAGE_DISPLAY_SECONDS,
    2: DEFAULT_PASSAGE_DISPLAY_SECONDS,
    3: DEFAULT_PASSAGE_DISPLAY_SECONDS,
  });
  const [roundPassages, setRoundPassages] = useState<Record<number, string>>({ 1: '', 2: '', 3: '' });
  const [newQ, setNewQ] = useState({
    text: '',
    type: 'true_false',
    answer: '',
    options: '',
    explanation: '',
    passage: '',
    round: 1,
    difficulty: 'easy',
    isBonus: false,
    useForQuiz: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [narrs, data] = await Promise.all([
        fetchNarratives(60, true),
        selectedNarrativeDate ? fetchCustomGameQuestions(selectedLevel, selectedNarrativeDate) : Promise.resolve([]),
      ]);
      setNarratives(narrs || []);
      if (!selectedNarrativeDate && narrs.length > 0) setSelectedNarrativeDate(narrs[0].narrative_date);
      setQuestions(data || []);
    } catch {}
    setLoading(false);
  }, [selectedLevel, selectedNarrativeDate]);

  useEffect(() => { load(); }, [load]);

  const gameType = LEVEL_GAME_TYPES[selectedLevel - 1];
  const selectedNarrative = narratives.find((n) => n.narrative_date === selectedNarrativeDate) || null;
  const isFinalLevel = selectedLevel === DAILY_GAME_LEVELS;
  const questionTypeOptions = [
    { value: 'true_false', label: 'True / False' },
    { value: 'comprehension', label: 'Comprehension' },
    { value: 'standard_text', label: 'Standard Written Answer' },
    { value: 'cloze', label: 'Fill in the Blanks' },
    { value: 'matching', label: 'Word to Meaning' },
    { value: 'scriptorium', label: 'First Letter' },
    { value: 'order_sequence', label: 'Build Verse' },
    { value: 'category_sort', label: 'Category Sort' },
    { value: 'multiple_choice', label: 'Multiple Choice' },
  ];
  const gameTypeToQuestionType = (type: string) => {
    if (type === 'fill_blank') return 'cloze';
    if (type === 'word_to_meaning') return 'matching';
    if (type === 'first_letter') return 'scriptorium';
    if (type === 'build_verse') return 'order_sequence';
    if (type === 'final_mixed') return newQ.type;
    return type || 'true_false';
  };
  const isComprehensionLevel = gameType === 'comprehension';
  const effectiveQuestionType = isComprehensionLevel
    ? roundQuestionTypes[newQ.round] || 'comprehension'
    : isFinalLevel
      ? newQ.type
      : levelQuestionType;

  useEffect(() => {
    const defaultType = gameTypeToQuestionType(LEVEL_GAME_TYPES[selectedLevel - 1]);
    setLevelQuestionType(defaultType);
    setRoundTimers({
      1: LEVEL_TIMERS[selectedLevel - 1] || 60,
      2: Math.max((LEVEL_TIMERS[selectedLevel - 1] || 60) - 5, 20),
      3: Math.max((LEVEL_TIMERS[selectedLevel - 1] || 60) - 10, 20),
    });
    setRoundPassageDurations({
      1: DEFAULT_PASSAGE_DISPLAY_SECONDS,
      2: DEFAULT_PASSAGE_DISPLAY_SECONDS,
      3: DEFAULT_PASSAGE_DISPLAY_SECONDS,
    });
    setNewQ((q) => ({ ...q, type: isFinalLevel ? q.type : defaultType, round: 1, difficulty: 'easy' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLevel, isFinalLevel]);

  useEffect(() => {
    if (selectedNarrative) {
      setRoundPassages({
        1: selectedNarrative.main_text,
        2: selectedNarrative.main_text,
        3: selectedNarrative.main_text,
      });
    }
  }, [selectedNarrative]);

  useEffect(() => {
    if (questions.length === 0) return;

    setRoundTimers((prev) => {
      const next = { ...prev };
      questions.forEach((q) => {
        const round = q.game_round || 1;
        if (q.round_timer_seconds) next[round] = q.round_timer_seconds;
      });
      return next;
    });

    setRoundPassageDurations((prev) => {
      const next = { ...prev };
      questions.forEach((q) => {
        const round = q.game_round || 1;
        if (q.passage_display_seconds) next[round] = q.passage_display_seconds;
      });
      return next;
    });

    setRoundQuestionTypes((prev) => {
      const next = { ...prev };
      questions.forEach((q) => {
        const round = q.game_round || 1;
        if (q.question_type) next[round] = q.question_type;
      });
      return next;
    });

    setRoundPassages((prev) => {
      const next = { ...prev };
      questions.forEach((q) => {
        const round = q.game_round || 1;
        if (q.passage) next[round] = q.passage;
      });
      return next;
    });
  }, [questions]);

  const rows = questions.filter((q) => selectedRound === 'all' || (q.game_round || 1) === selectedRound);

  const syncFromPacket = async () => {
    if (!selectedNarrative || !profile) return;
    setSyncing(true);
    try {
      const generated = await generateInstructorQuestionsWithAI({
        mode: 'game',
        narrativeDates: [selectedNarrative.narrative_date],
        count: GAME_QUESTIONS_PER_ROUND * GAME_ROUNDS_PER_LEVEL,
        level: selectedLevel,
        questionTypes: isComprehensionLevel
          ? roundQuestionTypes
          : { 1: levelQuestionType, 2: levelQuestionType, 3: levelQuestionType },
        passages: roundPassages,
      });
      await Promise.all(
        questions
          .filter((q) => q.generated_from_packet)
          .map((q) => deleteCustomQuestion(q.id)),
      );
      for (const [i, payload] of generated.entries()) {
        const round = payload.game_round || Math.min(Math.floor(i / GAME_QUESTIONS_PER_ROUND) + 1, GAME_ROUNDS_PER_LEVEL);
        const rowOptions = payload.type === 'category_sort' && payload.sort_items
          ? payload.sort_items.map((item) => `${item.text} | ${item.bucket}`)
          : payload.type === 'matching' && payload.pairs
            ? payload.pairs.map((pair) => `${pair.left} | ${pair.right}`)
            : payload.options || payload.items || null;
        const questionType = payload.type;
        await insertCustomQuestion({
          instructor_id: profile.id,
          quiz_session_id: null,
          game_level: selectedLevel,
          narrative_date: selectedNarrative.narrative_date,
          narrative_title: selectedNarrative.title,
          narrative_theme: selectedNarrative.theme,
          game_round: round,
          round_timer_seconds: roundTimers[round] || LEVEL_TIMERS[selectedLevel - 1] || 60,
          passage_display_seconds: roundPassageDurations[round] || DEFAULT_PASSAGE_DISPLAY_SECONDS,
          is_bonus: false,
          use_for_quiz: false,
          generated_from_packet: true,
          packet_section: `AI · ${GAME_TYPE_LABELS[gameType] || payload.type}`,
          question_text: payload.question,
          question_type: questionType,
          options: rowOptions,
          correct_answer: String(payload.correct_answer),
          explanation: payload.explanation || null,
          passage: roundPassages[round] || payload.passage || null,
          difficulty_tag: round === 1 ? 'easy' : round === 2 ? 'moderate' : 'hard',
          question_index: i,
        });
      }
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to sync questions from packet');
    }
    setSyncing(false);
  };

  const addQuestion = async () => {
    if (!newQ.text.trim() || !newQ.answer.trim() || !selectedNarrative) return;
    setSaving(true);
    try {
      const options = newQ.options ? newQ.options.split('\n').map((s) => s.trim()).filter(Boolean) : null;
      await insertCustomQuestion({
        instructor_id: profile.id,
        quiz_session_id: null,
        game_level: selectedLevel,
        narrative_date: selectedNarrative.narrative_date,
        narrative_title: selectedNarrative.title,
        narrative_theme: selectedNarrative.theme,
        game_round: newQ.round,
        round_timer_seconds: roundTimers[newQ.round] || LEVEL_TIMERS[selectedLevel - 1] || 60,
        passage_display_seconds: roundPassageDurations[newQ.round] || DEFAULT_PASSAGE_DISPLAY_SECONDS,
        is_bonus: newQ.isBonus,
        use_for_quiz: newQ.useForQuiz,
        generated_from_packet: false,
        packet_section: 'manual',
        question_text: newQ.text.trim(),
        question_type: effectiveQuestionType,
        options,
        correct_answer: newQ.answer.trim(),
        explanation: newQ.explanation.trim() || null,
        passage: newQ.passage.trim() || roundPassages[newQ.round] || null,
        difficulty_tag: newQ.difficulty,
        question_index: questions.length,
      });
      setNewQ({ text: '', type: isFinalLevel ? newQ.type : effectiveQuestionType, answer: '', options: '', explanation: '', passage: '', round: newQ.round, difficulty: newQ.difficulty, isBonus: false, useForQuiz: false });
      await load();
    } catch (e: any) { alert(e.message || 'Failed to save question'); }
    setSaving(false);
  };

  const editQuestion = async (question: CustomQuestion) => {
    const text = window.prompt('Question text', question.question_text);
    if (text === null) return;
    const answer = window.prompt('Correct answer', question.correct_answer);
    if (answer === null) return;
    const optionText = window.prompt('Options, one per line', (question.options || []).join('\n'));
    if (optionText === null) return;
    try {
      await updateCustomQuestion(question.id, {
        question_text: text.trim(),
        correct_answer: answer.trim(),
        options: optionText.split('\n').map((item) => item.trim()).filter(Boolean),
      });
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to edit question');
    }
  };

  const removeQuestion = async (id: string) => {
    try { await deleteCustomQuestion(id); await load(); } catch (e: any) { alert(e.message || 'Failed to delete'); }
  };

  const toggleQuizTag = async (question: CustomQuestion) => {
    try {
      await updateCustomQuestion(question.id, { use_for_quiz: !question.use_for_quiz });
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to update quiz tag');
    }
  };

  const toggleApproval = async (question: CustomQuestion) => {
    try {
      await updateCustomQuestion(question.id, { is_approved: !question.is_approved });
      await load();
    } catch (error: any) {
      alert(error.message || 'Failed to update publishing approval.');
    }
  };

  const approveVisibleQuestions = async () => {
    try {
      await Promise.all(rows.filter((question) => !question.is_approved).map((question) =>
        updateCustomQuestion(question.id, { is_approved: true }),
      ));
      await load();
    } catch (error: any) {
      alert(error.message || 'Failed to approve these questions.');
    }
  };

  const updateRoundTimer = async (round: number, seconds: number) => {
    setRoundTimers((prev) => ({ ...prev, [round]: seconds }));
    const impacted = questions.filter((q) => (q.game_round || 1) === round);
    await Promise.all(impacted.map((q) => updateCustomQuestion(q.id, { round_timer_seconds: seconds }).catch(() => null)));
    await load();
  };

  const updateRoundPassageDuration = async (round: number, seconds: number) => {
    const normalized = Math.min(Math.max(seconds, 5), 600);
    setRoundPassageDurations((prev) => ({ ...prev, [round]: normalized }));
    const impacted = questions.filter((q) => (q.game_round || 1) === round);
    await Promise.all(impacted.map((q) => updateCustomQuestion(q.id, { passage_display_seconds: normalized }).catch(() => null)));
    await load();
  };

  const applyRoundComprehensionSettings = async (round: number) => {
    const impacted = questions.filter((q) => (q.game_round || 1) === round);
    await Promise.all(impacted.map((q) => updateCustomQuestion(q.id, {
      question_type: roundQuestionTypes[round] || q.question_type,
      passage: roundPassages[round] || null,
      passage_display_seconds: roundPassageDurations[round] || DEFAULT_PASSAGE_DISPLAY_SECONDS,
    }).catch(() => null)));
    await load();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Game Questions" subtitle="Generate editable questions from each narrative's Game Content Packet, then add, edit, delete, or tag them for quiz." />

      <div className="card p-4 grid md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-stone block mb-1">Narrative Day</label>
          <select className="input-field" value={selectedNarrativeDate} onChange={(e) => setSelectedNarrativeDate(e.target.value)}>
            {narratives.map((n) => (
              <option key={n.id} value={n.narrative_date}>{n.narrative_date} · {n.title}</option>
            ))}
          </select>
          {selectedNarrative && <p className="text-[10px] text-stone mt-1">{selectedNarrative.title} · {selectedNarrative.theme}</p>}
        </div>
        <div>
          <label className="text-xs text-stone block mb-1">Level Question Type</label>
          <select className="input-field" value={levelQuestionType} onChange={(e) => setLevelQuestionType(e.target.value)}>
            {questionTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={syncFromPacket} disabled={syncing || !selectedNarrative} className="btn-primary w-full text-sm">
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Generate Editable Packet Questions
          </button>
        </div>
      </div>

      {/* Level selector */}
      <div className="card p-4">
        <label className="text-xs text-stone block mb-2">Select Game Level</label>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: DAILY_GAME_LEVELS }, (_, i) => i + 1).map((lvl) => (
            <button key={lvl} onClick={() => setSelectedLevel(lvl)}
              className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all',
                selectedLevel === lvl ? 'bg-peri text-navy' : 'bg-surface-2 text-stone hover:text-ink')}>
              Level {lvl}
            </button>
          ))}
        </div>
        <p className="text-xs text-stone mt-3 flex items-center gap-1.5">
          <Gamepad2 size={14} /> Question mode: <strong className="text-ink">{GAME_TYPE_LABELS[gameType] || questionTypeOptions.find((opt) => opt.value === effectiveQuestionType)?.label || gameType}</strong>
        </p>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="font-display font-semibold text-ink">Rounds</h4>
            <p className="text-xs text-stone">Each level has 3 rounds of 5 questions. Timers are seconds per round, not per question.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSelectedRound('all')} className={cn('px-3 py-1.5 rounded-lg text-xs font-bold', selectedRound === 'all' ? 'bg-peri text-navy' : 'bg-surface-2 text-stone')}>All</button>
            {[1, 2, 3].map((round) => (
              <button key={round} onClick={() => setSelectedRound(round)} className={cn('px-3 py-1.5 rounded-lg text-xs font-bold', selectedRound === round ? 'bg-peri text-navy' : 'bg-surface-2 text-stone')}>
                Round {round}
              </button>
            ))}
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          {[1, 2, 3].map((round) => (
            <div key={round} className="rounded-lg border border-border-bright bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold text-ink">Round {round}</span>
                <label className="flex items-center gap-1 text-[10px] text-stone">
                  <input
                    type="number"
                    min={10}
                    max={180}
                    value={roundTimers[round] || 60}
                    onChange={(e) => updateRoundTimer(round, Number(e.target.value) || 60)}
                    className="input-field w-20 text-xs py-1"
                  />
                  s/round
                </label>
              </div>
              {isComprehensionLevel && (
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-brass mb-1">Part 1 · Passage</p>
                    <textarea
                      className="input-field text-xs min-h-[96px]"
                      placeholder="Comprehension passage for this round"
                      value={roundPassages[round] || ''}
                      onChange={(e) => setRoundPassages((prev) => ({ ...prev, [round]: e.target.value }))}
                    />
                    <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-stone">
                      <span>Passage display duration</span>
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min={5}
                          max={600}
                          value={roundPassageDurations[round] || DEFAULT_PASSAGE_DISPLAY_SECONDS}
                          onChange={(e) => updateRoundPassageDuration(round, Number(e.target.value) || DEFAULT_PASSAGE_DISPLAY_SECONDS)}
                          className="input-field w-20 text-xs py-1"
                        />
                        s
                      </span>
                    </label>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-brass mb-1">Part 2 · Questions</p>
                    <select className="input-field text-xs" value={roundQuestionTypes[round] || 'comprehension'} onChange={(e) => setRoundQuestionTypes((prev) => ({ ...prev, [round]: e.target.value }))}>
                      {questionTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                  <button
                    onClick={() => applyRoundComprehensionSettings(round)}
                    disabled={questions.filter((q) => (q.game_round || 1) === round).length === 0}
                    className="btn-secondary text-[11px] w-full py-1.5"
                  >
                    Apply to saved round
                  </button>
                </div>
              )}
              {selectedLevel >= 5 && (
                <p className="text-[10px] text-stone mt-2">Bonus-round questions can be added below.</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add new question */}
      <div className="card p-5 space-y-3">
        <h4 className="font-display font-semibold text-ink">Add Question for Level {selectedLevel}</h4>
        <div>
          <label className="text-xs text-stone block mb-1">Question Text</label>
          <textarea className="input-field" rows={2} placeholder="e.g. Who built the ark?" value={newQ.text} onChange={(e) => setNewQ({ ...newQ, text: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-stone block mb-1">{isFinalLevel ? 'Question Type' : 'Level Question Type'}</label>
            <select className="input-field" value={effectiveQuestionType} onChange={(e) => isComprehensionLevel ? setRoundQuestionTypes((prev) => ({ ...prev, [newQ.round]: e.target.value })) : setLevelQuestionType(e.target.value)}>
              {questionTypeOptions
                .map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-stone block mb-1">
              {effectiveQuestionType === 'order_sequence' ? 'Correct Order' : effectiveQuestionType === 'cloze' ? 'Blank Answers' : 'Correct Answer'}
            </label>
            <input className="input-field"
              placeholder={effectiveQuestionType === 'true_false' ? 'True' : effectiveQuestionType === 'order_sequence' || effectiveQuestionType === 'cloze' ? 'Use | between answers' : 'e.g. Noah'}
              value={newQ.answer} onChange={(e) => setNewQ({ ...newQ, answer: e.target.value })} />
          </div>
        </div>
        {(effectiveQuestionType === 'multiple_choice' || effectiveQuestionType === 'cloze' || effectiveQuestionType === 'comprehension' || effectiveQuestionType === 'matching' || effectiveQuestionType === 'category_sort' || effectiveQuestionType === 'order_sequence') && (
          <div>
            <label className="text-xs text-stone block mb-1">
              {effectiveQuestionType === 'cloze' ? 'Word Bank (one per line)'
                : effectiveQuestionType === 'comprehension' ? 'Options (one per line)'
                : effectiveQuestionType === 'matching' ? 'Pairs (term | meaning, one per line)'
                : effectiveQuestionType === 'category_sort' ? 'Sort items & buckets (item | bucket, one per line)'
                : effectiveQuestionType === 'order_sequence' ? 'Items to arrange (one per line)'
                : 'Options (one per line)'}
            </label>
            <textarea className="input-field" rows={3} 
              placeholder={effectiveQuestionType === 'cloze' ? "faith\nhope\nlove"
                : effectiveQuestionType === 'matching' ? "Abraham | Father of many nations\nIsaac | Son of promise"
                : effectiveQuestionType === 'category_sort' ? "Abraham | Things Abraham did\nIsaac | Things Isaac did\nAngel | Things the angel did"
                : effectiveQuestionType === 'order_sequence' ? "In the beginning\nGod created\nthe heavens and the earth"
                : "Option A\nOption B\nOption C\nOption D"}
              value={newQ.options} onChange={(e) => setNewQ({ ...newQ, options: e.target.value })} />
          </div>
        )
        }
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-stone block mb-1">Round</label>
            <select className="input-field" value={newQ.round} onChange={(e) => setNewQ({ ...newQ, round: Number(e.target.value), difficulty: Number(e.target.value) === 1 ? 'easy' : Number(e.target.value) === 2 ? 'moderate' : 'hard' })}>
              <option value={1}>Round 1</option>
              <option value={2}>Round 2</option>
              <option value={3}>Round 3</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-stone block mb-1">Difficulty</label>
            <select className="input-field" value={newQ.difficulty} onChange={(e) => setNewQ({ ...newQ, difficulty: e.target.value })}>
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-stone pt-6">
            <input type="checkbox" checked={newQ.useForQuiz} onChange={(e) => setNewQ({ ...newQ, useForQuiz: e.target.checked })} className="accent-peri" />
            Use for quiz
          </label>
          {selectedLevel >= 5 && (
            <label className="flex items-center gap-2 text-xs text-stone pt-6">
              <input type="checkbox" checked={newQ.isBonus} onChange={(e) => setNewQ({ ...newQ, isBonus: e.target.checked })} className="accent-peri" />
              Bonus round
            </label>
          )}
        </div>
        {(effectiveQuestionType === 'comprehension' || effectiveQuestionType === 'cloze' || effectiveQuestionType === 'scriptorium' || effectiveQuestionType === 'standard_text') && (
          <div>
            <label className="text-xs text-stone block mb-1">
              {effectiveQuestionType === 'scriptorium' ? 'First-letter Hint (optional)' : 'Passage / Verse (optional)'}
            </label>
            <textarea className="input-field" rows={2} placeholder={effectiveQuestionType === 'scriptorium' ? "I_ t__ b________ G__ c______..." : "The scripture passage or verse text..."}
              value={newQ.passage} 
              onChange={(e) => setNewQ({ ...newQ, passage: e.target.value })} />
          </div>
        )}
        <div>
          <label className="text-xs text-stone block mb-1">Explanation (optional)</label>
          <input className="input-field" placeholder="Why is this the answer?" value={newQ.explanation} onChange={(e) => setNewQ({ ...newQ, explanation: e.target.value })} />
        </div>
        <button onClick={addQuestion} disabled={saving || !newQ.text.trim() || !newQ.answer.trim()} className="btn-primary text-sm">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add Question
        </button>
      </div>

      {/* Existing questions */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-display font-semibold text-ink">
              {selectedNarrative ? `${selectedNarrative.narrative_date} · ${selectedNarrative.title}` : 'Questions'} · Level {selectedLevel} ({rows.length})
            </h4>
            <p className="mt-1 text-xs text-stone">Only approved questions are available to cadets in the Daily Game.</p>
          </div>
          <button onClick={approveVisibleQuestions} disabled={!rows.some((question) => !question.is_approved)} className="btn-primary text-xs disabled:opacity-50">
            <CheckCircle2 size={12} /> Approve visible
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-brass" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-stone text-center py-6">No questions yet. Sync from the packet or add questions manually.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((q, i) => (
              <div key={q.id} className="p-3 rounded-lg border border-border-bright bg-surface-2 flex items-start gap-3">
                <span className="badge badge-neutral text-[10px] flex-shrink-0 mt-0.5">R{q.game_round || 1} Q{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    <span className="badge badge-peri text-[10px]">{q.question_type.replace(/_/g, ' ')}</span>
                    <span className="badge badge-neutral text-[10px]">{q.difficulty_tag}</span>
                    {q.round_timer_seconds && <span className="badge badge-gold text-[10px]">{q.round_timer_seconds}s/round</span>}
                    {q.passage_display_seconds && <span className="badge badge-neutral text-[10px]">{q.passage_display_seconds}s passage</span>}
                    {q.is_bonus && <span className="badge badge-roman text-[10px]">Bonus</span>}
                    {q.use_for_quiz && <span className="badge badge-moss text-[10px]">Quiz tagged</span>}
                    <span className={cn('badge text-[10px]', q.is_approved ? 'badge-moss' : 'badge-neutral')}>{q.is_approved ? 'Approved' : 'Draft'}</span>
                  </div>
                  <p className="text-sm text-ink font-medium">{q.question_text}</p>
                  <p className="text-xs text-sage mt-0.5">Answer: {q.correct_answer}</p>
                  {q.options && q.options.length > 0 && <p className="text-xs text-stone mt-0.5">Options: {q.options.join(' · ')}</p>}
                  {q.explanation && <p className="text-xs text-stone mt-0.5">{q.explanation}</p>}
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <button onClick={() => editQuestion(q)} className="btn-ghost text-[10px] px-2 py-1">Edit</button>
                  <button onClick={() => toggleApproval(q)} className={cn('btn-ghost text-[10px] px-2 py-1', q.is_approved && 'text-moss')}>
                    {q.is_approved ? 'Unpublish' : 'Approve'}
                  </button>
                  <button onClick={() => toggleQuizTag(q)} className="btn-ghost text-[10px] px-2 py-1">{q.use_for_quiz ? 'Untag' : 'Use quiz'}</button>
                  <button onClick={() => removeQuestion(q.id)} className="text-stone hover:text-coral transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Unassigned Users Panel ──
function UnassignedUsers({ onRefresh }: { onRefresh: () => void }) {
  const [users, setUsers] = useState<{ user_id: string; display_name: string; email: string; avatar_url: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignRole, setAssignRole] = useState<{ [key: string]: string }>({});
  const [assignTent, setAssignTent] = useState<{ [key: string]: string }>({});
  const [tents, setTents] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, tentData] = await Promise.all([
        fetchUnassignedUsers(),
        supabase.from('tents').select('id, name, tent_house_id').order('name'),
      ]);
      setUsers(data || []);
      setTents(tentData.data || []);
    } catch (e) { console.error('Unassigned load error:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const assign = async (userId: string) => {
    setAssigning(userId);
    try {
      const role = assignRole[userId] || 'cadet';
      const tentId = assignTent[userId];
      const { error: roleError } = await supabase.rpc('promote_user', {
        p_user_id: userId,
        p_new_role: role,
      });
      if (roleError) throw roleError;
      if (tentId) {
        if (role === 'cadet') {
          await assignCadetToTent(tentId, userId);
        } else {
          const { error: memberError } = await supabase.from('tent_members').insert({
            user_id: userId,
            tent_id: tentId,
            role,
          });
          if (memberError) throw memberError;
          await supabase.from('tents').update({ sentry_id: userId }).eq('id', tentId);
        }
      }
      await load();
      onRefresh();
    } catch (e: any) { alert(e.message || 'Failed to assign user'); }
    setAssigning(null);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Unassigned Users" subtitle="New accounts that haven't been assigned a role yet. Assign them as cadet or sentry and optionally place them in a tent." />

      {users.length === 0 ? (
        <EmptyState icon={UserPlus} title="Everyone is assigned" message="All users have active role assignments. New signups will appear here." />
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <div key={u.user_id} className="card p-4 bg-surface">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-surface-2 overflow-hidden flex items-center justify-center font-display font-bold text-brass flex-shrink-0">
                  {u.avatar_url ? <img src={u.avatar_url} alt={u.display_name} className="w-full h-full object-cover" /> : u.display_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink">{u.display_name}</p>
                  <p className="text-xs text-stone">{u.email}</p>
                  <p className="text-xs text-stone/60">Joined {new Date(u.created_at).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label className="text-xs text-stone block mb-1">Role</label>
                  <select className="input-field text-sm" value={assignRole[u.user_id] || 'cadet'} onChange={(e) => setAssignRole({ ...assignRole, [u.user_id]: e.target.value })}>
                    <option value="cadet">Cadet</option>
                    <option value="sentry">Sentry</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-stone block mb-1">Tent (optional)</label>
                  <select className="input-field text-sm" value={assignTent[u.user_id] || ''} onChange={(e) => setAssignTent({ ...assignTent, [u.user_id]: e.target.value })}>
                    <option value="">No tent</option>
                    {tents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <button onClick={() => assign(u.user_id)} disabled={assigning === u.user_id} className="btn-primary text-sm">
                  {assigning === u.user_id ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Assign
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Mobile Money Manager ──
function MobileMoneyManager() {
  const [payments, setPayments] = useState<(MobileMoneyPayment & { profiles: { display_name: string; email: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchInstructorMobileMoneyPayments();
      setPayments((data || []).filter((payment) => ['confirmed', 'rejected'].includes(payment.status)));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Mobile Money Payments" subtitle="Review payments the app has confirmed or rejected. Confirmation is automatic through CamPay." />

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>
      ) : payments.length === 0 ? (
        <EmptyState icon={Smartphone} title="No confirmed or rejected payments yet" message="When the app confirms or rejects a payment through CamPay, it will appear here." />
      ) : (
        <div className="space-y-3">
          {payments.map((pay) => {
            const statusClass = pay.status === 'confirmed'
              ? 'badge-moss'
              : pay.status === 'rejected'
                ? 'badge-coral'
                : 'badge-gold';
            return (
            <div key={pay.id} className="card p-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-gold-soft flex items-center justify-center flex-shrink-0">
                  <Smartphone size={20} className="text-gold" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="font-display font-semibold text-ink">{pay.relic_name}</h4>
                    <span className="badge badge-brass text-[10px]">{pay.provider}</span>
                    <span className={cn('badge text-[10px]', statusClass)}>{pay.status}</span>
                  </div>
                  <p className="text-sm text-stone">
                    From: <strong className="text-ink">{pay.profiles?.display_name || 'Unknown'}</strong>
                    {pay.profiles?.email && <span className="text-stone/60"> ({pay.profiles.email})</span>}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-stone mt-1">
                    <span>Phone: {pay.sender_phone}</span>
                    <span>Amount: {pay.currency_code === 'XAF' ? formatXaf(pay.amount_local) : `${Number(pay.amount_local).toLocaleString('en-US')} ${pay.currency_code}`}</span>
                    <span>{new Date(pay.created_at).toLocaleString()}</span>
                  </div>
                  {(pay.payment_details || pay.provider_reference || pay.ussd_code || pay.operator) && (
                    <div className="mt-2 rounded-lg bg-surface-2 border border-border p-2 text-xs text-stone space-y-1">
                      {pay.payment_details && <p>Details: <span className="text-ink">{pay.payment_details}</span></p>}
                      {pay.provider_reference && <p>Provider ref: <span className="font-mono text-ink">{pay.provider_reference}</span></p>}
                      {pay.operator && <p>Operator: <span className="text-ink">{pay.operator}</span></p>}
                      {pay.ussd_code && <p>USSD: <span className="font-mono text-ink">{pay.ussd_code}</span></p>}
                    </div>
                  )}
                  {(pay.reference || pay.external_reference || pay.payout_status) && (
                    <div className="mt-2 rounded-lg bg-surface-2 border border-border p-2 text-xs text-stone space-y-1">
                      {pay.reference && <p>App ref: <span className="font-mono text-ink">{pay.reference}</span></p>}
                      {pay.external_reference && pay.external_reference !== pay.reference && <p>External ref: <span className="font-mono text-ink">{pay.external_reference}</span></p>}
                      {pay.payout_status && <p>Payout: <span className="text-ink">{pay.payout_status}</span>{pay.payout_amount_xaf ? ` · ${formatXaf(pay.payout_amount_xaf)}` : ''}</p>}
                      {pay.payout_reference && <p>Payout ref: <span className="font-mono text-ink">{pay.payout_reference}</span></p>}
                      {pay.payout_error && <p className="text-coral">Payout error: {pay.payout_error}</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
