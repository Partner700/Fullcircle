import { supabase } from '../lib/supabase';
import type {
  Profile, RoleAssignment, Tent, TentMember, DailyRecord, DailyNarrative,
  QuizSession, GeneratedQuestion, QuizAttempt, QuizRuntimeState, QuizResponder, QuestionResponse, WeeklyQuizReleasedResult,
  DenariiLedgerEntry, GameAttempt, RelicType, RelicInventory,
  StreakboardSnapshot, LeaderboardWeeklySnapshot, Award,
  ScheduledAnnouncement, ChallengeSubmission, StreakFreezer,
  MobileMoneySettings, MobileMoneyPayment, UserNotification,
  QuizScoreboardRow, QuestionPayload, PanelImageSetting, AwardWithRecipient,
  FcxExperience, MonthlyVallumWatchRow,
} from '../lib/types';
import { isPanelImageContent, panelImageFromAnnouncement } from './panelImages';
import type { RoadHomeResponse } from './roadHomeTypes';
import { prepareImageUpload } from './uploads';
import { getTodayISODate } from './utils';
import { fetchOwnProfile } from './profileAccess';
import { generateInstructorFallbackQuestions } from './questionGenerator';

const sharedReadRequests = new Map<string, Promise<unknown>>();
let lastReminderBootstrapAt = 0;

function shareReadRequest<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = sharedReadRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const tracked = factory().finally(() => {
    if (sharedReadRequests.get(key) === tracked) sharedReadRequests.delete(key);
  });
  sharedReadRequests.set(key, tracked);
  return tracked;
}

function bootstrapDailyRemindersInBackground() {
  const now = Date.now();
  if (now - lastReminderBootstrapAt < 5 * 60_000) return;
  lastReminderBootstrapAt = now;
  void shareReadRequest('daily-reminder-bootstrap', async () => {
    const { error } = await supabase.rpc('ensure_daily_reminders');
    if (error) throw error;
  }).catch(() => {
    // Scheduled reminders remain server-driven; this is only a client fallback.
  });
}

export async function fetchTentHouses() {
  const { data, error } = await supabase.from('tent_houses').select('*');
  if (error) throw error;
  return data;
}

export async function fetchProfile(userId: string) {
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user?.id !== userId) throw new Error('You can only load your own private profile.');
  return fetchOwnProfile(userId);
}

export async function fetchRoleAssignment(userId: string) {
  const { data, error } = await supabase
    .from('role_assignments')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw error;
  return data as RoleAssignment | null;
}

export async function fetchAllProfiles() {
  const { data, error } = await supabase.rpc('get_profiles_for_instructor');
  if (error) throw error;
  return data as Profile[];
}

/** Load only the public avatar fields needed by visible board rows. */
export async function fetchBoardAvatars(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return {} as Record<string, string | null>;
  const { data, error } = await supabase
    .from('profiles')
    .select('id,avatar_url')
    .in('id', ids);
  if (error) return {} as Record<string, string | null>;
  return Object.fromEntries((data || []).map((profile) => [profile.id, profile.avatar_url || null]));
}

export async function fetchAllRoleAssignments() {
  const { data, error } = await supabase.from('role_assignments').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data as RoleAssignment[];
}

export async function fetchActiveCadets() {
  const { data, error } = await supabase
    .from('role_assignments')
    .select('*, profiles!role_assignments_user_id_fkey(id,display_name,avatar_url,created_at)')
    .eq('role', 'cadet')
    .in('status', ['active', 'approved'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as (RoleAssignment & { profiles: Profile })[];
}

export async function fetchArenaInvitees() {
  const byUserId = new Map<string, RoleAssignment & { profiles: Profile }>();
  const addInvitee = (invitee: RoleAssignment & { profiles: Profile }) => {
    const existing = byUserId.get(invitee.user_id);
    if (!existing || invitee.role === 'sentry') byUserId.set(invitee.user_id, invitee);
  };

  const { data: rpcData, error: rpcError } = await supabase.rpc('get_arena_invitees');
  if (!rpcError && Array.isArray(rpcData)) {
    rpcData.map((row: any) => ({
      id: row.role_assignment_id,
      user_id: row.user_id,
      role: row.role,
      status: row.status,
      start_date: row.start_date || null,
      end_date: row.end_date || null,
      approver_id: row.approver_id || null,
      created_at: row.created_at,
      profiles: {
        id: row.user_id,
        display_name: row.display_name,
        email: null,
        avatar_url: row.avatar_url || null,
        whatsapp_number: null,
        created_at: row.profile_created_at || row.created_at,
      },
    }) as RoleAssignment & { profiles: Profile }).forEach(addInvitee);
  }

  const { data, error } = await supabase
    .from('role_assignments')
    .select('*, profiles!role_assignments_user_id_fkey(id,display_name,avatar_url,created_at)')
    .in('role', ['cadet', 'sentry'])
    .in('status', ['active', 'approved'])
    .order('created_at', { ascending: false });
  if (!error) (data as (RoleAssignment & { profiles: Profile })[]).forEach(addInvitee);

  const { data: sentryTents } = await supabase
    .from('tents')
    .select('sentry_id, created_at, profiles!tents_sentry_id_fkey(id,display_name,avatar_url,created_at)')
    .not('sentry_id', 'is', null);
  (sentryTents || []).forEach((row: any) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!row.sentry_id || !profile) return;
    addInvitee({
      id: row.sentry_id,
      user_id: row.sentry_id,
      role: 'sentry',
      status: 'active',
      start_date: null,
      end_date: null,
      approver_id: null,
      created_at: row.created_at || profile.created_at,
      profiles: {
        id: profile.id,
        display_name: profile.display_name,
        email: null,
        avatar_url: profile.avatar_url || null,
        whatsapp_number: null,
        created_at: profile.created_at || row.created_at,
      },
    } as RoleAssignment & { profiles: Profile });
  });

  const { data: sentryMembers } = await supabase
    .from('tent_members')
    .select('user_id, joined_at, profiles(id,display_name,avatar_url,created_at)')
    .eq('role', 'sentry');
  (sentryMembers || []).forEach((row: any) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!row.user_id || !profile) return;
    addInvitee({
      id: row.user_id,
      user_id: row.user_id,
      role: 'sentry',
      status: 'active',
      start_date: null,
      end_date: null,
      approver_id: null,
      created_at: row.joined_at || profile.created_at,
      profiles: {
        id: profile.id,
        display_name: profile.display_name,
        email: null,
        avatar_url: profile.avatar_url || null,
        whatsapp_number: null,
        created_at: profile.created_at || row.joined_at,
      },
    } as RoleAssignment & { profiles: Profile });
  });

  if (byUserId.size === 0 && error) throw error;
  return Array.from(byUserId.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role === 'sentry' ? -1 : 1;
    return (a.profiles.display_name || '').localeCompare(b.profiles.display_name || '');
  });
}

export async function fetchTents() {
  const { data, error } = await supabase
    .from('tents')
    .select('*, tent_houses(*)')
    .order('name');
  if (error) throw error;
  return data as (Tent & { tent_houses: any })[];
}

export async function fetchTentMembers() {
  const { data, error } = await supabase
    .from('tent_members')
    .select('*, profiles(id,display_name,avatar_url,created_at)')
    .order('joined_at');
  if (error) throw error;
  return data as (TentMember & { profiles: Profile })[];
}

export async function fetchTentMembersForTent(tentId: string) {
  const { data, error } = await supabase
    .from('tent_members')
    .select('*, profiles(id,display_name,avatar_url,created_at)')
    .eq('tent_id', tentId)
    .order('joined_at');
  if (error) throw error;
  return data as (TentMember & { profiles: Profile })[];
}

export async function assignCadetToTent(tentId: string, userId: string) {
  const { error } = await supabase.rpc('assign_cadet_to_tent', {
    p_tent_id: tentId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function sentryAddCadetToTent(sentryId: string, cadetId: string) {
  const { error } = await supabase.rpc('sentry_add_cadet_to_tent', {
    p_sentry_id: sentryId,
    p_cadet_id: cadetId,
  });
  if (error) throw error;
}

export async function fetchSentryAddableCadets(sentryId: string) {
  const { data, error } = await supabase.rpc('get_sentry_addable_cadets', {
    p_sentry_id: sentryId,
  });
  if (error) throw error;
  return data as { user_id: string; display_name: string; avatar_url: string | null }[];
}

export async function fetchDailyRecords(userId: string, fromDate?: string) {
  let query = supabase
    .from('daily_records')
    .select('*')
    .eq('user_id', userId);
  if (fromDate) query = query.gte('record_date', fromDate);
  const { data, error } = await query.order('record_date', { ascending: true });
  if (error) throw error;
  return data as DailyRecord[];
}

export async function fetchDailyRecordsForTent(tentId: string, date?: string) {
  const memberIds = (await fetchTentMembersForTent(tentId)).map((m) => m.user_id);
  if (memberIds.length === 0) return [];
  let query = supabase.from('daily_records').select('*').in('user_id', memberIds);
  if (date) query = query.eq('record_date', date);
  const { data, error } = await query.order('record_date', { ascending: false });
  if (error) throw error;
  return data as DailyRecord[];
}

export async function fetchDailyRecordsForDate(date: string) {
  const { data, error } = await supabase
    .from('daily_records')
    .select('*, profiles(display_name, avatar_url)')
    .eq('record_date', date)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function fetchNarrative(date: string) {
  const first = await supabase
    .from('daily_narratives')
    .select('*')
    .eq('narrative_date', date)
    .maybeSingle();
  if (first.error) throw first.error;
  if (first.data || new Date(`${date}T12:00:00`).getDay() !== 0) {
    return first.data as DailyNarrative | null;
  }

  // The cron job is authoritative, while this fallback makes the Sunday
  // reading self-healing if the scheduler was unavailable at midnight.
  const { error: publishError } = await supabase.rpc('ensure_sunday_highlight_reading', {
    p_reading_date: date,
  });
  if (publishError) throw publishError;
  const { data, error } = await supabase
    .from('daily_narratives')
    .select('*')
    .eq('narrative_date', date)
    .maybeSingle();
  if (error) throw error;
  return data as DailyNarrative | null;
}

export async function fetchNarratives(days = 7, includeFuture = false) {
  let query = supabase
    .from('daily_narratives')
    .select('*');
  if (!includeFuture) {
    query = query.lte('narrative_date', getTodayISODate());
  }
  const { data, error } = await query
    .order('narrative_date', { ascending: false })
    .limit(days);
  if (error) throw error;
  return data as DailyNarrative[];
}

export async function fetchAllNarratives() {
  const { data, error } = await supabase
    .from('daily_narratives')
    .select('*')
    .order('narrative_date', { ascending: false });
  if (error) throw error;
  return data as DailyNarrative[];
}

export async function upsertNarrative(narrative: Partial<DailyNarrative>) {
  const { id, ...payload } = narrative;

  if (id) {
    const { data, error } = await supabase
      .from('daily_narratives')
      .update(payload)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as DailyNarrative;
  }

  const { data, error } = await supabase
    .from('daily_narratives')
    .upsert(payload, { onConflict: 'narrative_date' })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as DailyNarrative;
}

export async function fetchQuizSessions() {
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('*')
    .order('session_date', { ascending: false });
  if (error) throw error;
  return data as QuizSession[];
}

export async function fetchLatestQuizSession() {
  const rpcResult = await supabase.rpc('get_current_quiz_session');
  if (!rpcResult.error) return rpcResult.data as QuizSession | null;

  // Keep older deployments usable while the lifecycle migration rolls out.
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('*')
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw rpcResult.error;
  return data as QuizSession | null;
}

export type SharedReadingInsight = {
  id: string;
  narrative_id: string;
  verse_reference: string;
  body: string;
  created_at: string;
  user_id: string;
  profiles: { display_name: string; avatar_url: string | null };
  comments: Array<{
    id: string;
    insight_id: string;
    user_id: string;
    parent_comment_id: string | null;
    body: string;
    created_at: string;
    profile: { display_name: string; avatar_url: string | null };
  }>;
  reactions: Record<VerseInsightReactionType, {
    count: number;
    reacted: boolean;
    actors: VerseInsightReactionActor[];
  }>;
};

export type SharedReading = {
    id: string;
    narrative_date: string;
    title: string;
    theme: string;
    scripture_reference: string;
    translation: string;
    main_text: string;
    highlighted_verses: DailyNarrative['highlighted_verses'];
    scripture_passages?: DailyNarrative['scripture_passages'];
    verse_of_day: string | null;
    reflection_prompts: string[];
    weekly_highlights?: WeeklyVerseHighlight[];
    insights: SharedReadingInsight[];
    panel_images?: {
      reading: PanelImageSetting | null;
      scripture: PanelImageSetting | null;
    };
};

function sharedPanelImage(raw: any): PanelImageSetting | null {
  if (!raw?.content) return null;
  return panelImageFromAnnouncement({
    content: raw.content,
    image_position_x: raw.image_position_x,
    image_position_y: raw.image_position_y,
  });
}

export async function fetchSharedReading(date: string, guestKey?: string) {
  const result = await supabase.rpc('get_shared_daily_reading_v2', {
    p_narrative_date: date,
    p_guest_key: guestKey || null,
  });
  if (result.error) {
    const fallback = await supabase.rpc('get_shared_daily_reading', { p_narrative_date: date });
    if (fallback.error) throw result.error;
    return fallback.data as SharedReading | null;
  }
  if (!result.data) return null;
  const reading = result.data as any;
  return {
    ...reading,
    panel_images: {
      reading: sharedPanelImage(reading.panel_images?.reading),
      scripture: sharedPanelImage(reading.panel_images?.scripture),
    },
  } as SharedReading;
}

export async function toggleSharedInsightReaction(
  insightId: string,
  guestKey: string,
  reactionType: VerseInsightReactionType,
) {
  const { data, error } = await supabase.rpc('toggle_public_scripture_insight_reaction', {
    p_insight_id: insightId,
    p_guest_key: guestKey,
    p_reaction_type: reactionType,
  });
  if (error) throw error;
  return data === true;
}

export async function addSharedInsight(narrativeId: string, verseReference: string, body: string, guestKey: string) {
  const { data, error } = await supabase.rpc('add_public_scripture_insight', {
    p_narrative_id: narrativeId,
    p_verse_reference: verseReference,
    p_body: body,
    p_guest_key: guestKey,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchSharedDailyGame(date: string) {
  const { data, error } = await supabase.rpc('get_shared_daily_game', { p_narrative_date: date });
  if (error) throw error;
  return data as { date: string; level: number; title: string; questions: Array<{ id: string; question_text: string; options: string[] }> };
}

export async function fetchSharedQuiz(sessionId: string) {
  const { data, error } = await supabase.rpc('get_shared_quiz', { p_quiz_session_id: sessionId });
  if (error) throw error;
  return data as {
    session: Pick<QuizSession, 'id' | 'title' | 'session_date' | 'live_opens_at' | 'live_closes_at' | 'status'>;
    questions: Array<{ id: string; question_index: number; question_payload: Omit<QuestionPayload, 'correct_answer' | 'accepted_answers' | 'explanation'> }>;
  } | null;
}

export async function saveSharedQuizAnswer(sessionId: string, guestKey: string, questionId: string, answer: string | number) {
  const { error } = await supabase.rpc('save_shared_quiz_answer', {
    p_quiz_session_id: sessionId,
    p_guest_key: guestKey,
    p_question_id: questionId,
    p_answer: answer,
  });
  if (error) throw error;
}

export async function completeSharedQuiz(sessionId: string, guestKey: string) {
  const { error } = await supabase.rpc('complete_shared_quiz', {
    p_quiz_session_id: sessionId,
    p_guest_key: guestKey,
  });
  if (error) throw error;
}

export interface SharedQuizClaimQuestion {
  id: string;
  question_index: number;
  question_text: string;
  options: unknown[];
  selected_answer: unknown;
  correct_answer: unknown;
  is_correct: boolean;
}

export interface SharedQuizClaimResult {
  quiz_session_id: string;
  title: string;
  released: boolean;
  release_at: string;
  correct_count?: number;
  question_count?: number;
  figs?: number;
  questions?: SharedQuizClaimQuestion[];
}

export async function claimSharedQuizResult(sessionId: string, guestKey: string) {
  const { data, error } = await supabase.rpc('claim_shared_quiz_result', {
    p_quiz_session_id: sessionId,
    p_guest_key: guestKey,
  });
  if (error) throw error;
  return data as SharedQuizClaimResult;
}

export async function createQuizSession(session: Partial<QuizSession>) {
  const { data, error } = await supabase
    .from('quiz_sessions')
    .insert(session)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as QuizSession;
}

export async function launchQuizSession(sessionId: string) {
  const { data, error } = await supabase.rpc('launch_quiz_session', {
    p_quiz_session_id: sessionId,
  });
  if (error) throw error;
  return data as QuizSession;
}

export async function deleteQuizSession(sessionId: string) {
  const { data, error } = await supabase.rpc('delete_quiz_session_cascade', {
    p_quiz_session_id: sessionId,
  });
  if (error) throw error;
  return data as {
    deleted: boolean;
    quiz_session_id: string;
    attempts_deleted: number;
    reward_entries_reversed: number;
  };
}

export async function fetchQuestionsForSession(sessionId: string) {
  const { data, error } = await supabase
    .from('generated_questions')
    .select('*')
    .eq('quiz_session_id', sessionId)
    .order('question_index');
  if (error) throw error;
  return data as GeneratedQuestion[];
}

export async function fetchPlayableQuestionsForSession(sessionId: string) {
  const { data, error } = await supabase.rpc('get_quiz_questions_for_play', {
    p_quiz_session_id: sessionId,
  });
  if (error) throw error;
  const seen = new Set<string>();
  return ((data || []) as GeneratedQuestion[]).filter((question) => {
    const prompt = String(question.question_payload?.question || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!prompt || seen.has(prompt)) return false;
    seen.add(prompt);
    return true;
  });
}

export async function startQuizAttempt(sessionId: string) {
  const { data, error } = await supabase.rpc('start_quiz_attempt', {
    p_quiz_session_id: sessionId,
  });
  if (error) throw error;
  return data as QuizAttempt;
}

export async function saveQuizResponse(attemptId: string, questionId: string, answer: unknown) {
  const { data, error } = await supabase.rpc('save_quiz_response', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_answer: answer,
  });
  if (error) throw error;
  return data as { accepted: boolean; warning?: string };
}

export async function consumeQuizQuestionRelic(attemptId: string, questionId: string, relicSlug: string) {
  const { data, error } = await supabase.rpc('use_quiz_question_relic', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_relic_slug: relicSlug,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    notice?: string;
    eliminated_options?: string[];
    skipped?: boolean;
    auto_answered?: boolean;
    donkey_active?: boolean;
  };
}

export async function completeQuizAttempt(
  attemptId: string,
  status: 'submitted' | 'timed_out',
  useGoliath = false,
) {
  const { data, error } = await supabase.rpc('submit_quiz_attempt_secure', {
    p_attempt_id: attemptId,
    p_status: status,
    p_use_goliath: useGoliath,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    attempt: QuizAttempt;
    correct_count?: number;
    question_count?: number;
    figs?: number;
    perfect?: boolean;
    denarii_awarded?: number;
  };
}

export async function insertQuestions(questions: Partial<GeneratedQuestion>[]) {
  const { error } = await supabase.from('generated_questions').insert(questions);
  if (error) throw error;
}

export async function deleteQuestionsForSession(sessionId: string) {
  const { error } = await supabase.from('generated_questions').delete().eq('quiz_session_id', sessionId);
  if (error) throw error;
}

export async function updateGeneratedQuestion(questionId: string, patch: Partial<GeneratedQuestion>) {
  const { error } = await supabase.from('generated_questions').update(patch).eq('id', questionId);
  if (error) throw error;
}

export async function fetchQuizAttempt(_userId: string, sessionId: string) {
  const { data, error } = await supabase.rpc('get_my_quiz_attempt', {
    p_quiz_session_id: sessionId,
  });
  if (error) throw error;
  return data as QuizAttempt | null;
}

export async function fetchMyQuizRuntimeState(sessionId: string) {
  const { data, error } = await supabase.rpc('get_my_quiz_runtime_state', {
    p_quiz_session_id: sessionId,
  });
  if (error) throw error;
  return data as QuizRuntimeState;
}

export async function fetchQuizResponders(sessionId: string) {
  const { data, error } = await supabase.rpc('get_quiz_responders', {
    p_quiz_session_id: sessionId,
  });
  if (error) throw error;
  return (data || []) as QuizResponder[];
}

export async function fetchMonthlyVallumWatch(month: string) {
  const { data, error } = await supabase.rpc('get_monthly_vallum_watch', {
    p_month: `${month}-01`,
  });
  if (error) throw error;
  return (data || []) as MonthlyVallumWatchRow[];
}

export async function fetchMyWeeklyQuizResult(sessionId: string) {
  const { data, error } = await supabase.rpc('get_my_weekly_quiz_result', {
    p_quiz_session_id: sessionId,
  });
  if (error) throw error;
  return data as WeeklyQuizReleasedResult | null;
}

export async function fetchResponsesForAttempt(attemptId: string) {
  const { data, error } = await supabase
    .from('question_responses')
    .select('*')
    .eq('quiz_attempt_id', attemptId);
  if (error) throw error;
  return data as QuestionResponse[];
}

export async function fetchQuizAnswerSheets(sessionId: string) {
  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('*, question_responses(*)')
    .eq('quiz_session_id', sessionId)
    .order('submitted_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  const profiles = await fetchAllProfiles();
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  return (data || []).map((attempt: any) => ({
    ...attempt,
    profiles: profileMap.get(attempt.user_id) || null,
  })) as (QuizAttempt & {
    profiles: { display_name: string; email: string; avatar_url: string | null } | null;
    question_responses: QuestionResponse[];
  })[];
}

export async function fetchLedgerEntries(userId: string, limit?: number) {
  let query = supabase
    .from('denarii_ledger_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (limit && limit > 0) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return data as DenariiLedgerEntry[];
}

export async function fetchLedgerTotal(userId: string): Promise<number> {
  const liveStats = await fetchUserLiveStats(userId).catch(() => null);
  if (liveStats && liveStats.total_denarii !== 0) return liveStats.total_denarii;

  const ledgerFallback = async () => {
    const entries = await fetchLedgerEntries(userId);
    return entries.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  };
  try {
    const { data, error } = await supabase
      .rpc('get_user_denarii_total', { p_user_id: userId });
    if (error) throw error;
    const rpcTotal = Number(data) || 0;
    if (rpcTotal !== 0) return rpcTotal;
    const ledgerTotal = await ledgerFallback().catch(() => 0);
    return ledgerTotal || liveStats?.total_denarii || rpcTotal;
  } catch {
    try {
      return await ledgerFallback() || liveStats?.total_denarii || 0;
    } catch {
      return liveStats?.total_denarii || 0;
    }
  }
}

export type UserLiveStats = {
  user_id: string;
  total_denarii: number;
  current_streak: number;
  longest_streak: number;
  consecutive_inactive: number;
  cumulative_inactive: number;
  total_figs: number;
  rhudes: number;
  marks: number;
};

export type ToolbarStats = Pick<
  UserLiveStats,
  'user_id' | 'total_denarii' | 'current_streak' | 'longest_streak' | 'consecutive_inactive' | 'cumulative_inactive'
>;

export async function fetchOwnToolbarStats(): Promise<ToolbarStats> {
  let { data, error } = await supabase.rpc('get_my_toolbar_stats_v6');
  if (error) {
    const versionFive = await supabase.rpc('get_my_toolbar_stats_v5');
    data = versionFive.data;
    error = versionFive.error;
  }
  if (error) {
    const versionFour = await supabase.rpc('get_my_toolbar_stats_v4');
    data = versionFour.data;
    error = versionFour.error;
  }
  if (error) {
    const versionThree = await supabase.rpc('get_my_toolbar_stats_v3');
    data = versionThree.data;
    error = versionThree.error;
  }
  if (error) {
    const versionTwo = await supabase.rpc('get_my_toolbar_stats_v2');
    data = versionTwo.data;
    error = versionTwo.error;
  }
  if (error) {
    const legacy = await supabase.rpc('get_my_toolbar_stats');
    data = legacy.data;
    error = legacy.error;
  }
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.user_id) throw new Error('Live toolbar stats were unavailable.');
  return {
    user_id: String(row.user_id),
    total_denarii: Number(row.total_denarii) || 0,
    current_streak: Number(row.current_streak) || 0,
    longest_streak: Number(row.longest_streak) || 0,
    consecutive_inactive: Number(row.consecutive_inactive) || 0,
    cumulative_inactive: Number(row.cumulative_inactive) || 0,
  };
}

export async function fetchReliableToolbarStats(userId: string): Promise<ToolbarStats> {
  const toolbarRequest = fetchOwnToolbarStats();
  const liveStatsRequest = fetchUserLiveStats(userId);
  const balanceRequest = (async () => {
    const { data, error } = await supabase.rpc('get_user_denarii_total', { p_user_id: userId });
    if (error) throw error;
    return Number(data) || 0;
  })();
  const streakRequest = (async () => {
    let { data, error } = await supabase.rpc('get_authoritative_streak', { p_user_id: userId });
    if (error) {
      const strict = await supabase.rpc('compute_strict_streak', { p_user_id: userId });
      data = strict.data;
      error = strict.error;
    }
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Authoritative streak data were unavailable.');
    return {
      current_streak: Number(row.current_streak) || 0,
      longest_streak: Number(row.longest_streak) || 0,
      consecutive_inactive: Number(row.consecutive_inactive) || 0,
      cumulative_inactive: Number(row.cumulative_inactive) || 0,
    };
  })();

  const [toolbarResult, balanceResult, streakResult, liveStatsResult] = await Promise.allSettled([
    toolbarRequest,
    balanceRequest,
    streakRequest,
    liveStatsRequest,
  ]);
  const toolbar = toolbarResult.status === 'fulfilled' ? toolbarResult.value : null;
  const liveStats = liveStatsResult.status === 'fulfilled' ? liveStatsResult.value : null;

  let balance = balanceResult.status === 'fulfilled'
    ? balanceResult.value
    : toolbar?.total_denarii ?? liveStats?.total_denarii ?? null;
  if (balance === null) {
    const entries = await fetchLedgerEntries(userId).catch(() => null);
    if (entries) {
      balance = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    }
  }

  const streak = streakResult.status === 'fulfilled'
    ? streakResult.value
    : liveStats
      ? {
          current_streak: liveStats.current_streak,
          longest_streak: liveStats.longest_streak,
          consecutive_inactive: liveStats.consecutive_inactive,
          cumulative_inactive: liveStats.cumulative_inactive,
        }
      : toolbar
        ? {
            current_streak: toolbar.current_streak,
            longest_streak: toolbar.longest_streak,
            consecutive_inactive: toolbar.consecutive_inactive,
            cumulative_inactive: toolbar.cumulative_inactive,
          }
        : null;

  if (balance === null && !toolbar && !liveStats) throw new Error('Live Denarii data were unavailable.');
  if (!streak && !toolbar && !liveStats) throw new Error('Live streak data were unavailable.');

  return {
    user_id: userId,
    total_denarii: balance ?? 0,
    current_streak: streak?.current_streak ?? 0,
    longest_streak: streak?.longest_streak ?? 0,
    consecutive_inactive: streak?.consecutive_inactive ?? toolbar?.consecutive_inactive ?? 0,
    cumulative_inactive: streak?.cumulative_inactive ?? toolbar?.cumulative_inactive ?? 0,
  };
}

export async function fetchUserLiveStats(userId: string): Promise<UserLiveStats> {
  const { data, error } = await supabase.rpc('get_user_live_stats', { p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.user_id) throw new Error('Live user stats were unavailable.');
  return {
    user_id: row?.user_id || userId,
    total_denarii: Number(row?.total_denarii) || 0,
    current_streak: Number(row?.current_streak) || 0,
    longest_streak: Number(row?.longest_streak) || 0,
    consecutive_inactive: Number(row?.consecutive_inactive) || 0,
    cumulative_inactive: Number(row?.cumulative_inactive) || 0,
    total_figs: Number(row?.total_figs) || 0,
    rhudes: Number(row?.rhudes) || 0,
    marks: Number(row?.marks) || 0,
  };
}

export async function fetchGameAttempts(userId: string, narrativeDate?: string) {
  let query = supabase.from('game_attempts').select('*').eq('user_id', userId);
  if (narrativeDate) query = query.eq('narrative_date', narrativeDate);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data as GameAttempt[];
}

export async function fetchGameAttemptsForDate(userId: string, date: string) {
  return fetchGameAttempts(userId, date);
}

export async function recordSundayReadingOpen(userId: string, recordDate: string) {
  const { data, error } = await supabase.rpc('record_sunday_reading_open', {
    p_user_id: userId,
    p_record_date: recordDate,
  });
  if (error) throw error;
  return Boolean(data);
}

export type WeeklyVerseHighlight = {
  narrative_id: string;
  narrative_date: string;
  title: string;
  translation?: string;
  reference: string;
  text: string;
  reaction_count: number;
  comment_count: number;
  insight_count: number;
  engagement_score: number;
};

export async function fetchPreviousMuralis(eventMonth: string) {
  const normalizedMonth = /^\d{4}-\d{2}$/.test(eventMonth)
    ? `${eventMonth}-01`
    : eventMonth.slice(0, 10);
  const { data, error } = await supabase.rpc('get_previous_muralis', {
    p_event_month: normalizedMonth,
  });
  if (error) throw error;
  return data ? data as AwardWithRecipient : null;
}

export async function fetchWeeklyVerseHighlights() {
  const { data, error } = await supabase.rpc('get_current_weekly_verse_highlights');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row?.items || []) as WeeklyVerseHighlight[];
}

export async function fetchRelicTypes() {
  const { data, error } = await supabase.from('relic_types').select('*');
  if (error) throw error;
  return data as RelicType[];
}

export async function fetchRelicInventory(userId: string) {
  const { data, error } = await supabase
    .from('relic_inventory')
    .select('*, relic_types(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return data as (RelicInventory & { relic_types: RelicType })[];
}

async function mergePublicStreakValues<T extends {
  user_id: string;
  current_streak?: number;
  longest_streak?: number;
  volume?: number;
  rank?: number;
  profiles?: { display_name?: string | null } | null;
}>(rows: T[], rerank = false): Promise<T[]> {
  const rankByVisibleStreak = (items: T[]) => [...items]
    .sort((left, right) => (
      (Number(right.current_streak) || 0) - (Number(left.current_streak) || 0)
      || (Number(right.longest_streak) || 0) - (Number(left.longest_streak) || 0)
      || (Number(right.volume) || 0) - (Number(left.volume) || 0)
      || String(left.profiles?.display_name || '').localeCompare(String(right.profiles?.display_name || ''))
    ))
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
  if (userIds.length === 0) return rows;
  const { data, error } = await supabase.rpc('get_public_streaks', { p_user_ids: userIds });
  if (error) return rerank ? rankByVisibleStreak(rows) : rows;
  const values = new Map<string, number>((data || []).map((row: any) => [String(row.user_id), Number(row.current_streak) || 0]));
  const mergedRows = rows.map((row) => {
    const visibleStreak = values.get(row.user_id);
    if (visibleStreak === undefined) return row;
    return {
      ...row,
      current_streak: visibleStreak,
      longest_streak: Math.max(Number(row.longest_streak) || 0, visibleStreak),
    };
  });
  if (!rerank) return mergedRows;

  return rankByVisibleStreak(mergedRows);
}

export async function fetchStreakboardSnapshots(audience: 'cadet' | 'sentry' = 'cadet') {
  // This is intentionally a published-snapshot feed. The older live function
  // recalculates every person's streak on every board refresh, which can make
  // a sentry board time out before it renders.
  const { data: fastData, error: fastError } = await supabase.rpc('get_fast_streakboard_for_role', { p_role: audience });
  if (!fastError && Array.isArray(fastData) && fastData.length > 0) {
    return mergePublicStreakValues(fastData as (StreakboardSnapshot & { role: 'cadet' | 'sentry'; profiles: { display_name: string; avatar_url: string | null } })[], true);
  }

  if (audience === 'sentry') {
    const { data, error } = await supabase.rpc('get_streakboard_live_for_role', { p_role: 'sentry' });
    if (error) throw error;
    return mergePublicStreakValues((data || []) as (StreakboardSnapshot & { role: 'sentry'; profiles: { display_name: string; avatar_url: string | null } })[], true);
  }
  const { data: liveData, error: liveError } = await supabase.rpc('get_streakboard_live');
  if (!liveError && liveData) {
    return mergePublicStreakValues(liveData as (StreakboardSnapshot & { profiles: { display_name: string; avatar_url: string | null } })[], true);
  }

  const { data, error } = await supabase
    .from('streakboard_snapshots')
    .select('*, profiles(display_name,avatar_url)')
    .order('snapshot_date', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return [];
  const latestDate = data[0].snapshot_date;
  const { data: rows, error: err2 } = await supabase
    .from('streakboard_snapshots')
    .select('*, profiles(display_name,avatar_url)')
    .eq('snapshot_date', latestDate)
    .order('rank');
  if (err2) throw err2;
  return mergePublicStreakValues(rows as (StreakboardSnapshot & { profiles: { display_name: string; avatar_url: string | null } })[], true);
}

export async function fetchLeaderboardSnapshots() {
  const { data, error } = await supabase
    .from('leaderboard_weekly_snapshots')
    .select('*, profiles(display_name, avatar_url)')
    .order('week_ending', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return [];
  const latestWeek = data[0].week_ending;
  const { data: rows, error: err2 } = await supabase
    .from('leaderboard_weekly_snapshots')
    .select('*, profiles(display_name, avatar_url)')
    .eq('week_ending', latestWeek)
    .order('rank');
  if (err2) throw err2;
  return rows as (LeaderboardWeeklySnapshot & { profiles: { display_name: string; avatar_url: string | null } })[];
}

export async function fetchAwards(): Promise<AwardWithRecipient[]> {
  const { data, error } = await supabase
    .from('awards')
    .select('*, profiles(display_name, avatar_url)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const awards = data as AwardWithRecipient[];
  const userIds = Array.from(new Set(awards
    .filter((award) => award.award_target_type !== 'tent' && award.user_id)
    .map((award) => award.user_id as string)));
  const tentIds = Array.from(new Set(awards
    .filter((award) => award.award_target_type === 'tent' && award.award_target_id)
    .map((award) => award.award_target_id as string)));
  const { data: memberRows, error: memberError } = userIds.length
    ? await supabase
      .from('tent_members')
      .select('user_id, tents(id, name, tent_house_id)')
      .in('user_id', userIds)
    : { data: [], error: null };
  if (memberError) throw memberError;
  const recipientTents = new Map((memberRows || []).map((row: any) => [row.user_id, row.tents || null]));
  if (tentIds.length === 0) {
    return awards.map((award) => ({
      ...award,
      recipient_tent: award.user_id ? recipientTents.get(award.user_id) || null : null,
    })) as AwardWithRecipient[];
  }

  const { data: tentRows, error: tentError } = await supabase
    .from('tents')
    .select('id, name, tent_house_id, profile_image_url, sentry_id')
    .in('id', tentIds);
  if (tentError) throw tentError;
  const sentryIds = Array.from(new Set((tentRows || []).map((tent) => tent.sentry_id).filter(Boolean))) as string[];
  const { data: sentryRows, error: sentryError } = sentryIds.length
    ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', sentryIds)
    : { data: [], error: null };
  if (sentryError) throw sentryError;
  const sentries = new Map((sentryRows || []).map((profile) => [profile.id, profile]));
  const tents = new Map((tentRows || []).map((tent) => [tent.id, {
    ...tent,
    sentry: tent.sentry_id ? sentries.get(tent.sentry_id) || null : null,
  }]));

  return awards.map((award) => ({
    ...award,
    target_tent: award.award_target_type === 'tent' && award.award_target_id
      ? tents.get(award.award_target_id) || null
      : null,
    recipient_tent: award.user_id ? recipientTents.get(award.user_id) || null : null,
  })) as AwardWithRecipient[];
}

export async function insertAward(award: Partial<Award>) {
  const { error } = await supabase.from('awards').insert(award);
  if (error) throw error;
}

export type AwardReactionActor = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

export type AwardReactionState = Record<string, { count: number; reacted: boolean; actors: AwardReactionActor[] }>;

export async function fetchAwardReactions(awardIds: string[], reactorId?: string) {
  if (awardIds.length === 0) return {} as Record<string, AwardReactionState>;
  const { data, error } = await supabase
    .from('award_reactions')
    .select('award_id, reactor_id, reaction_type')
    .in('award_id', awardIds);
  if (error) throw error;
  const reactorIds = Array.from(new Set((data || []).map((row) => row.reactor_id).filter(Boolean)));
  const { data: reactorProfiles, error: profileError } = reactorIds.length
    ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', reactorIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const profilesById = new Map((reactorProfiles || []).map((actor) => [actor.id, actor]));
  const result: Record<string, AwardReactionState> = {};
  (data || []).forEach((row: any) => {
    result[row.award_id] ||= {};
    result[row.award_id][row.reaction_type] ||= { count: 0, reacted: false, actors: [] };
    result[row.award_id][row.reaction_type].count += 1;
    const actor = profilesById.get(row.reactor_id);
    if (actor && !result[row.award_id][row.reaction_type].actors.some((existing) => existing.user_id === row.reactor_id)) {
      result[row.award_id][row.reaction_type].actors.push({
        user_id: row.reactor_id,
        display_name: actor.display_name || 'Camp member',
        avatar_url: actor.avatar_url || null,
      });
    }
    if (reactorId && row.reactor_id === reactorId) result[row.award_id][row.reaction_type].reacted = true;
  });
  return result;
}

export async function reactToAward(awardId: string, reactorId: string, reactionType: string) {
  const { error } = await supabase.rpc('react_to_award', {
    p_award_id: awardId,
    p_reactor_id: reactorId,
    p_reaction_type: reactionType,
  });
  if (error) throw error;
}

export async function fetchAnnouncements(audiences: string[] = ['all', 'cadets']) {
  bootstrapDailyRemindersInBackground();
  const normalizedAudiences = Array.from(new Set(audiences)).sort();
  return shareReadRequest(`announcements:${normalizedAudiences.join(',')}`, async () => {
    const now = new Date().toISOString();
    const [announcementResult, birthdayResult] = await Promise.allSettled([
      supabase
        .from('scheduled_announcements')
        .select('*')
        .lte('publish_at', now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .eq('is_active', true)
        .in('audience', normalizedAudiences)
        .not('announcement_type', 'like', 'panel_image_%')
        .not('announcement_type', 'like', 'sound_%')
        .neq('announcement_type', 'weekly_background')
        .order('publish_at', { ascending: false })
        .limit(12),
      normalizedAudiences.includes('all') ? supabase.rpc('get_today_birthday_announcements') : Promise.resolve({ data: [], error: null }),
    ]);

    if (announcementResult.status === 'rejected') throw announcementResult.reason;
    if (announcementResult.value.error) throw announcementResult.value.error;
    const announcements = (announcementResult.value.data || []) as ScheduledAnnouncement[];
    const birthdays = birthdayResult.status === 'fulfilled' && !birthdayResult.value.error
      ? (birthdayResult.value.data || []) as ScheduledAnnouncement[]
      : [];
    const byId = new Map<string, ScheduledAnnouncement>();
    [...birthdays, ...announcements].forEach((announcement) => {
      byId.set(`${announcement.announcement_type}-${announcement.id}`, announcement);
    });
    return Array.from(byId.values())
      .sort((left, right) => new Date(right.publish_at).getTime() - new Date(left.publish_at).getTime())
      .slice(0, 14);
  });
}

export async function fetchPanelImage(
  panelType: string,
  audiences: string[] = ['all', 'cadets'],
) {
  const setting = await fetchPanelImageSetting(panelType, audiences);
  return setting?.url || null;
}

export async function fetchPanelImageSetting(
  panelType: string,
  audiences: string[] = ['all', 'cadets'],
): Promise<PanelImageSetting | null> {
  const images = await fetchPanelImageSettings([panelType], audiences);
  const normalizedType = panelType === 'weekly_background' || panelType.startsWith('panel_image_')
    ? panelType.replace('panel_image_', '')
    : panelType;
  return images[normalizedType] || null;
}

export async function fetchPanelImageSettings(
  panelTypes: string[],
  audiences: string[] = ['all', 'cadets'],
): Promise<Record<string, PanelImageSetting>> {
  const announcementTypes = Array.from(new Set(panelTypes.map((panelType) => (
    panelType === 'weekly_background' || panelType.startsWith('panel_image_')
      ? panelType
      : `panel_image_${panelType}`
  ))));
  if (announcementTypes.length === 0) return {};
  const normalizedTypes = [...announcementTypes].sort();
  const normalizedAudiences = Array.from(new Set(audiences)).sort();
  return shareReadRequest(`panel-images:${normalizedTypes.join(',')}:${normalizedAudiences.join(',')}`, async () => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('scheduled_announcements')
      .select('announcement_type, content, image_position_x, image_position_y, audience, publish_at')
      .in('announcement_type', normalizedTypes)
      .lte('publish_at', now)
      .eq('is_active', true)
      .in('audience', normalizedAudiences)
      .order('publish_at', { ascending: false })
      .limit(Math.max(20, normalizedTypes.length * 6));
    if (error) throw error;
    const rows = ((data || []) as (ScheduledAnnouncement & { audience: string })[])
      .filter((row) => row.content && isPanelImageContent(row.content));
    const images: Record<string, PanelImageSetting> = {};

    normalizedTypes.forEach((type) => {
      const candidates = rows.filter((row) => row.announcement_type === type);
      const preferred = candidates.find((row) => row.audience !== 'all') || candidates[0];
      if (preferred) images[type.replace('panel_image_', '')] = panelImageFromAnnouncement(preferred);
    });

    return images;
  });
}

export async function fetchAllAnnouncements() {
  const { data, error } = await supabase
    .from('scheduled_announcements')
    .select('*')
    .order('publish_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data as ScheduledAnnouncement[];
}

export async function fetchActiveFcxExperience() {
  return shareReadRequest('active-fcx-experience', async () => {
    const { data, error } = await supabase.rpc('get_active_fcx_experience');
    if (error) throw error;
    return data ? data as FcxExperience : null;
  });
}

export async function saveFcxExperience(input: {
  eventId?: string | null;
  eventMonth: string;
  eventDate?: string | null;
  title: string;
  capacity?: number;
  ticketPriceXaf?: number | null;
  isActive?: boolean;
}) {
  const { data, error } = await supabase.rpc('save_fcx_experience', {
    p_event_id: input.eventId || null,
    p_event_month: input.eventMonth,
    p_event_date: input.eventDate || null,
    p_title: input.title,
    p_capacity: input.capacity ?? 30,
    p_ticket_price_xaf: input.ticketPriceXaf ?? null,
    p_is_active: input.isActive ?? true,
  });
  if (error) throw error;
  return data as string;
}

export async function addFcxRegistration(input: {
  eventId: string;
  userId?: string | null;
  guestName?: string | null;
  guestAvatarUrl?: string | null;
  paymentSource: 'app' | 'external';
}) {
  const { data, error } = await supabase.rpc('add_fcx_registration', {
    p_event_id: input.eventId,
    p_user_id: input.userId || null,
    p_guest_name: input.guestName?.trim() || null,
    p_payment_source: input.paymentSource,
    p_guest_avatar_url: input.guestAvatarUrl || null,
  });
  if (error) throw error;
  return data as string;
}

export async function removeFcxRegistration(registrationId: string) {
  const { error } = await supabase.rpc('remove_fcx_registration', {
    p_registration_id: registrationId,
  });
  if (error) throw error;
}

export async function createAnnouncement(announcement: Omit<ScheduledAnnouncement, 'id'>) {
  const { error } = await supabase.from('scheduled_announcements').insert(announcement);
  if (error) throw error;
}

export async function savePanelImageSetting(setting: {
  announcementType: string;
  audience: string;
  content: string;
  publishAt: string;
  positionX: number;
  positionY: number;
}) {
  const { data, error } = await supabase.rpc('save_panel_image_setting', {
    p_announcement_type: setting.announcementType,
    p_audience: setting.audience,
    p_content: setting.content,
    p_publish_at: setting.publishAt,
    p_position_x: setting.positionX,
    p_position_y: setting.positionY,
  });
  if (error) throw error;
  return data;
}

export async function updateAnnouncement(id: string, patch: Partial<Omit<ScheduledAnnouncement, 'id'>>) {
  const { error } = await supabase.from('scheduled_announcements').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteAnnouncement(id: string) {
  const { error } = await supabase.from('scheduled_announcements').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchUserNotifications(userId: string, limit = 30) {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as UserNotification[];
}

export async function fetchUnreadFoundersGiftNotification(userId: string) {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('recipient_id', userId)
    .eq('notification_type', 'streak')
    .contains('metadata', { gift_key: 'first_fcx_founders_gift_2026' })
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as UserNotification | null;
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string) {
  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

export async function fetchChallengeSubmission(userId: string, date: string) {
  const { data, error } = await supabase
    .from('challenge_submissions')
    .select('*')
    .eq('user_id', userId)
    .eq('narrative_date', date)
    .maybeSingle();
  if (error) throw error;
  return data as ChallengeSubmission | null;
}

export async function upsertChallengeSubmission(sub: Partial<ChallengeSubmission>) {
  const { data: rpcData, error: rpcError } = await supabase.rpc('submit_challenge_submission_secure', {
    p_user_id: sub.user_id,
    p_narrative_date: sub.narrative_date,
    p_proof_text: sub.proof_text,
    p_proof_type: sub.proof_type,
  });
  if (!rpcError && rpcData) return rpcData as ChallengeSubmission;

  const { error } = await supabase.from('challenge_submissions').upsert(sub);
  if (error) throw error;
}

export async function uploadChallengeEvidence(userId: string, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-90);
  const path = `challenge-evidence/${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return {
    name: file.name,
    type: file.type || 'file',
    size: file.size,
    url: data.publicUrl,
  };
}

export type VerseInsightReactionType = 'heart' | 'lightbulb';

export type VerseInsightReactionActor = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_guest?: boolean;
  is_current_guest?: boolean;
};

export type VerseInsightReactionState = Record<VerseInsightReactionType, {
  count: number;
  reacted: boolean;
  actors: VerseInsightReactionActor[];
}>;

function emptyVerseInsightReactionState(): VerseInsightReactionState {
  return {
    heart: { count: 0, reacted: false, actors: [] },
    lightbulb: { count: 0, reacted: false, actors: [] },
  };
}

export async function fetchVerseInsights(narrativeId: string | string[], reactorUserId?: string) {
  void reactorUserId;
  const narrativeIds = Array.from(new Set((Array.isArray(narrativeId) ? narrativeId : [narrativeId]).filter(Boolean)));
  if (!narrativeIds.length) return [];
  let insightQuery = supabase
    .from('scripture_verse_insights')
    .select('id,narrative_id,verse_reference,body,mentioned_user_ids,created_at,user_id,profiles!scripture_verse_insights_user_id_fkey(display_name,avatar_url)');
  insightQuery = narrativeIds.length === 1
    ? insightQuery.eq('narrative_id', narrativeIds[0])
    : insightQuery.in('narrative_id', narrativeIds);
  const { data, error } = await insightQuery.order('created_at', { ascending: false });
  if (error) {
    console.warn('Verse insights unavailable:', error.message);
    return [];
  }
  const insights = data || [];
  if (!insights.length) return insights;
  const insightIds = insights.map((insight) => insight.id);
  const [commentResult, reactionResult] = await Promise.all([
    supabase
      .from('scripture_insight_comments')
      .select('id,insight_id,user_id,mentioned_user_id,mentioned_user_ids,parent_comment_id,body,created_at')
      .in('insight_id', insightIds)
      .order('created_at', { ascending: true }),
    supabase.rpc('get_scripture_insight_reaction_summaries', {
      p_insight_ids: insightIds,
    }),
  ]);
  if (commentResult.error) console.warn('Scripture insight replies unavailable:', commentResult.error.message);
  if (reactionResult.error) console.warn('Scripture insight reactions unavailable:', reactionResult.error.message);
  const comments = commentResult.data || [];
  const reactionsByInsight = new Map<string, VerseInsightReactionState>();
  (reactionResult.data || []).forEach((reaction: any) => {
    if (reaction.reaction_type !== 'heart' && reaction.reaction_type !== 'lightbulb') return;
    const reactionType = reaction.reaction_type as VerseInsightReactionType;
    const state = reactionsByInsight.get(reaction.insight_id) || emptyVerseInsightReactionState();
    state[reactionType] = {
      count: Number(reaction.reaction_count || 0),
      reacted: Boolean(reaction.reacted),
      actors: Array.isArray(reaction.actors) ? reaction.actors : [],
    };
    reactionsByInsight.set(reaction.insight_id, state);
  });
  const profileIds = Array.from(new Set([
    ...(comments || []).flatMap((comment) => [comment.user_id, comment.mentioned_user_id]),
  ].filter(Boolean))) as string[];
  const { data: commentProfiles } = profileIds.length
    ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', profileIds)
    : { data: [] };
  const profilesById = new Map((commentProfiles || []).map((commentProfile) => [commentProfile.id, commentProfile]));
  return insights.map((insight) => ({
    ...insight,
    reactions: reactionsByInsight.get(insight.id) || emptyVerseInsightReactionState(),
    comments: (comments || [])
      .filter((comment) => comment.insight_id === insight.id)
      .map((comment) => ({
        ...comment,
        profile: profilesById.get(comment.user_id) || null,
        mentioned_profile: comment.mentioned_user_id ? profilesById.get(comment.mentioned_user_id) || null : null,
      })),
  }));
}

export async function toggleVerseInsightReaction(
  insightId: string,
  reactionType: VerseInsightReactionType,
) {
  const { data, error } = await supabase.rpc('toggle_scripture_insight_reaction', {
    p_insight_id: insightId,
    p_reaction_type: reactionType,
  });
  if (error) throw error;
  return data === true;
}

export type CampMentionCandidate = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
};

export async function fetchCampMentionCandidates() {
  const { data, error } = await supabase.rpc('get_camp_mention_candidates');
  if (error) throw error;
  return (data || []) as CampMentionCandidate[];
}

export async function saveVerseInsight(
  narrativeId: string,
  userId: string,
  verseReference: string,
  body: string,
  mentionedUserIds: string[] = [],
) {
  const { error: rpcError } = await supabase.rpc('save_scripture_verse_insight_secure', {
    p_narrative_id: narrativeId,
    p_verse_reference: verseReference,
    p_body: body.trim(),
    p_mentioned_user_ids: mentionedUserIds,
  });
  if (!rpcError) return;
  const { error } = await supabase
    .from('scripture_verse_insights')
    .upsert({
      narrative_id: narrativeId,
      user_id: userId,
      verse_reference: verseReference,
      body: body.trim(),
      mentioned_user_ids: mentionedUserIds,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'narrative_id,user_id,verse_reference' });
  if (error) throw error;
}

export async function editVerseInsight(insightId: string, body: string) {
  const { error } = await supabase.rpc('edit_scripture_verse_insight', { p_insight_id: insightId, p_body: body });
  if (error) throw error;
}

export async function addVerseInsightComment(input: {
  insightId: string;
  userId: string;
  body: string;
  mentionedUserId?: string | null;
  mentionedUserIds?: string[];
  parentCommentId?: string | null;
}) {
  const { error: rpcError } = await supabase.rpc('add_scripture_insight_comment_secure', {
    p_insight_id: input.insightId,
    p_body: input.body.trim(),
    p_mentioned_user_ids: input.mentionedUserIds || (input.mentionedUserId ? [input.mentionedUserId] : []),
    p_parent_comment_id: input.parentCommentId || null,
  });
  if (!rpcError) return;
  const { error } = await supabase.from('scripture_insight_comments').insert({
    insight_id: input.insightId,
    user_id: input.userId,
    body: input.body.trim(),
    mentioned_user_id: input.mentionedUserId || null,
    mentioned_user_ids: input.mentionedUserIds || (input.mentionedUserId ? [input.mentionedUserId] : []),
    parent_comment_id: input.parentCommentId || null,
  });
  if (error) throw error;
}

export async function editVerseInsightComment(commentId: string, body: string) {
  const { error } = await supabase.rpc('edit_scripture_insight_comment', { p_comment_id: commentId, p_body: body });
  if (error) throw error;
}

// ── Subscription queries ──

export async function fetchSubscription(userId: string) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as import('../lib/types').Subscription | null;
}

export async function getSubscriptionStatus(userId: string) {
  const { data, error } = await supabase.rpc('get_subscription_status', { p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { status: string; trial_ends_at: string | null; current_period_end: string | null; is_paid: boolean };
}

export async function fetchStreakFreezers(userId: string) {
  const { data, error } = await supabase
    .from('streak_freezers')
    .select('*')
    .eq('user_id', userId)
    .order('purchased_at', { ascending: false });
  if (error) throw error;
  return data as StreakFreezer[];
}

export async function purchaseDailyFreezer(userId: string) {
  void userId;
  const { error } = await supabase.rpc('purchase_daily_freezer_secure');
  if (error) throw error;
}

export async function purchaseWeeklyFreezer(userId: string) {
  void userId;
  const { error } = await supabase.rpc('purchase_weekly_freezer_secure');
  if (error) throw error;
}

export async function fetchStreakProtectionState() {
  const { data, error } = await supabase.rpc('get_my_streak_protection_state');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row || {
    active: false,
    protection_kind: null,
    freezer_type: null,
    activated_at: null,
    protection_ends_at: null,
    applied_to_date: null,
  }) as import('./types').StreakProtectionState;
}

export type DailyGameAnswerResult = {
  correct: boolean;
  protected?: boolean;
  figs_earned?: number;
  total_figs?: number;
  correct_count?: number;
  answer_payload?: QuestionPayload;
  notice?: string;
};

export async function startDailyGameLevel(narrativeDate: string, level: number, mode: string) {
  const { data, error } = await supabase.rpc('start_daily_game_level', {
    p_narrative_date: narrativeDate,
    p_level: level,
    p_mode: mode,
  });
  if (error) throw error;
  const result = data as { run_id?: string; questions?: QuestionPayload[] } | null;
  if (!result?.run_id || !Array.isArray(result.questions) || result.questions.length === 0) {
    throw new Error('This level does not have an approved question set.');
  }
  return { runId: result.run_id, questions: result.questions };
}

export async function submitDailyGameAnswer(runId: string, questionId: string, answer: string | null) {
  const { data, error } = await supabase.rpc('submit_daily_game_answer', {
    p_run_id: runId,
    p_question_id: questionId,
    p_answer: answer || '',
  });
  if (error) throw error;
  return data as DailyGameAnswerResult;
}

export async function applyDailyGameQuestionAid(runId: string, questionId: string, aidType: string) {
  const { data, error } = await supabase.rpc('use_daily_game_question_aid', {
    p_run_id: runId,
    p_question_id: questionId,
    p_aid_type: aidType,
  });
  if (error) throw error;
  return data as DailyGameAnswerResult & {
    hint?: string;
    eliminated_options?: string[];
    extra_seconds?: number;
    auto_answered?: boolean;
    skipped?: boolean;
    donkey_active?: boolean;
    reference?: string;
    cost?: number;
  };
}

export async function completeDailyGameRun(runId: string, useGoliath = false) {
  const { data, error } = await supabase.rpc('complete_daily_game_run', {
    p_run_id: runId,
    p_use_goliath: useGoliath,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    passed: boolean;
    score: number;
    max_score: number;
    correct_count: number;
    question_count: number;
    reward: number;
  };
}

export async function fetchAllChallengeSubmissions(reviewerId?: string) {
  if (reviewerId) {
    const { data, error } = await supabase.rpc('get_challenge_submissions_for_reviewer', {
      p_reviewer_id: reviewerId,
    });
    if (!error) return data;
  }

  const { data, error } = await supabase
    .from('challenge_submissions')
    .select('*, profiles(display_name,avatar_url)')
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function reviewChallengeSubmission(
  id: string,
  status: 'approved' | 'rejected',
  rejectionReason: string | null,
  reviewerId: string,
) {
  const { error: rpcError } = await supabase.rpc('review_challenge_submission_as_reviewer', {
    p_submission_id: id,
    p_status: status,
    p_rejection_reason: rejectionReason,
    p_reviewer_id: reviewerId,
  });
  if (!rpcError) return;

  const { error } = await supabase
    .from('challenge_submissions')
    .update({
      status,
      rejection_reason: rejectionReason,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function promoteCadetToSentry(userId: string, approverId: string) {
  const { error } = await supabase.rpc('promote_to_sentry', {
    p_user_id: userId,
    p_approver_id: approverId,
  });
  if (error) throw error;
}

export async function promoteSentryToInstructor(newInstructorId: string, currentInstructorId: string) {
  const { error } = await supabase.rpc('promote_to_instructor', {
    p_new_instructor_id: newInstructorId,
    p_current_instructor_id: currentInstructorId,
  });
  if (error) throw error;
}

// ── Store / Relic queries ──

export async function purchaseRelic(userId: string, slug: string, currency: string = 'denarii') {
  const { data, error } = await supabase.rpc('purchase_relic', {
    p_user_id: userId, p_relic_slug: slug, p_currency: currency,
  });
  if (error) throw error;
  return data;
}

export async function purchaseRelicForCadet(sentryId: string, cadetId: string, slug: string) {
  const { data, error } = await supabase.rpc('purchase_relic_for_cadet', {
    p_sentry_id: sentryId,
    p_cadet_id: cadetId,
    p_relic_slug: slug,
  });
  if (error) throw error;
  return data;
}

export async function purchaseDailyFreezerForCadet(sentryId: string, cadetId: string) {
  const { data, error } = await supabase.rpc('purchase_daily_freezer_for_cadet', {
    p_sentry_id: sentryId,
    p_cadet_id: cadetId,
  });
  if (error) throw error;
  return data;
}

export async function useRelic(userId: string, slug: string) {
  const { data, error } = slug === 'simons-coin'
    ? await supabase.rpc('use_simons_coin', { p_user_id: userId })
    : await supabase.rpc('use_relic', { p_user_id: userId, p_relic_slug: slug });
  if (error) throw error;
  return data;
}

export async function resetQuizAttemptWithLazarus(userId: string, quizSessionId: string) {
  const { data, error } = await supabase.rpc('reset_quiz_attempt_with_lazarus', {
    p_user_id: userId,
    p_quiz_session_id: quizSessionId,
  });
  if (error) throw error;
  return data as QuizAttempt;
}

// ── Currency ──

export async function getCurrencyForUser(userId: string) {
  const { data, error } = await supabase.rpc('get_currency_for_user', { p_user_id: userId });
  if (error) throw error;
  return (data as import('./types').CurrencyInfo[] | null)?.[0] || { currency_code: 'USD', symbol: '$', rate_to_usd: 1 };
}

// ── Awards RPC ──

export async function giveAwardRPC(
  userId: string, title: string, description: string | null,
  awardType: string, awardMonth: string, targetType: string, targetId: string | null,
) {
  const { error } = await supabase.rpc('give_award', {
    p_user_id: userId, p_title: title, p_description: description,
    p_award_type: awardType, p_award_month: awardMonth,
    p_target_type: targetType, p_target_id: targetId,
  });
  if (error) throw error;
}

export async function awardTent(tentId: string, title: string, description: string | null, awardMonth: string) {
  const { data, error } = await supabase.rpc('award_tent', {
    p_tent_id: tentId, p_title: title, p_description: description, p_award_month: awardMonth,
  });
  if (error) throw error;
  return data;
}

// ── Custom questions ──

export async function fetchCustomQuestions(sessionId?: string) {
  let q = supabase.from('custom_questions').select('*').order('question_index');
  if (sessionId) q = q.eq('quiz_session_id', sessionId);
  const { data, error } = await q;
  if (error) throw error;
  return data as import('./types').CustomQuestion[];
}

export async function insertCustomQuestion(q: Partial<import('./types').CustomQuestion>) {
  const { error } = await supabase.from('custom_questions').insert(q);
  if (error) throw error;
}

export async function insertCustomQuestions(questions: Partial<import('./types').CustomQuestion>[]) {
  if (questions.length === 0) return;
  const { error } = await supabase.from('custom_questions').insert(questions);
  if (error) throw error;
}

export async function updateCustomQuestion(id: string, patch: Partial<import('./types').CustomQuestion>) {
  const { error } = await supabase.from('custom_questions').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCustomQuestion(id: string) {
  const { error } = await supabase.from('custom_questions').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchCustomGameQuestions(level: number, narrativeDate?: string, approvedOnly = false) {
  let query = supabase
    .from('custom_questions')
    .select('*')
    .not('game_level', 'is', null)
    .eq('game_level', level)
    .order('question_index');
  if (narrativeDate) query = query.eq('narrative_date', narrativeDate);
  if (approvedOnly) query = query.eq('is_approved', true);
  const { data, error } = await query;
  if (error) throw error;
  return data as import('./types').CustomQuestion[];
}

export async function fetchCustomGameQuestionsForNarrative(narrativeDate: string) {
  const { data, error } = await supabase
    .from('custom_questions')
    .select('*')
    .not('game_level', 'is', null)
    .eq('narrative_date', narrativeDate)
    .order('game_level')
    .order('game_round')
    .order('question_index');
  if (error) throw error;
  return data as import('./types').CustomQuestion[];
}

export async function fetchQuizTaggedGameQuestions(limit = 50) {
  const { data, error } = await supabase
    .from('custom_questions')
    .select('*')
    .eq('use_for_quiz', true)
    .order('narrative_date', { ascending: false, nullsFirst: false })
    .order('game_level')
    .order('game_round')
    .limit(limit);
  if (error) throw error;
  return data as import('./types').CustomQuestion[];
}

export async function fetchDailyQuoteFeed(limit = 12) {
  return shareReadRequest(`daily-quote-feed:${limit}`, async () => {
    const { data, error } = await supabase.rpc('get_daily_quote_feed', { p_limit: limit });
    if (error) throw error;
    return mergePublicStreakValues((data || []) as import('./types').DailyQuoteFeedItem[]);
  });
}

export async function fetchPublicQuoteStreak(userId: string) {
  const { data, error } = await supabase.rpc('get_public_quote_streak', { p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { current_streak: Number(row?.current_streak) || 0 };
}

export async function fetchPublicMeditation(userId: string, recordDate: string) {
  const { data, error } = await supabase.rpc('get_public_meditation', { p_user_id: userId, p_record_date: recordDate });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

export async function fetchPublicMeditationView(userId: string, recordDate: string) {
  const { data, error } = await supabase.rpc('get_public_meditation_view', { p_user_id: userId, p_record_date: recordDate });
  if (error) throw error;
  return data as null | { meditation_text: string; best_verse: string | null; daily_quote: string | null; record_date: string };
}

export async function fetchPublicDailyQuotes(recordDate: string, limit = 12) {
  const { data, error } = await supabase.rpc('get_public_daily_quotes', { p_record_date: recordDate, p_limit: limit });
  if (error) throw error;
  return (data || []) as import('./types').DailyQuoteFeedItem[];
}

export async function fetchDailyQuoteReactions(quotes: { user_id: string; record_date: string }[], reactorId?: string) {
  if (quotes.length === 0) return {};
  const userIds = Array.from(new Set(quotes.map((q) => q.user_id)));
  const dates = Array.from(new Set(quotes.map((q) => q.record_date)));
  const [reactionResult, commentResult] = await Promise.all([
    supabase
      .from('daily_quote_reactions')
      .select('quote_user_id, quote_record_date, reactor_user_id, reaction_type')
      .in('quote_user_id', userIds)
      .in('quote_record_date', dates),
    supabase
      .from('daily_quote_comments')
      .select('quote_user_id, quote_record_date')
      .in('quote_user_id', userIds)
      .in('quote_record_date', dates),
  ]);
  if (reactionResult.error) throw reactionResult.error;
  if (commentResult.error) throw commentResult.error;

  const reactorIds = Array.from(new Set((reactionResult.data || []).map((row: any) => row.reactor_user_id).filter(Boolean)));
  const { data: reactorProfiles } = reactorIds.length
    ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', reactorIds)
    : { data: [] as Array<{ id: string; display_name: string; avatar_url: string | null }> };
  const profileById = new Map((reactorProfiles || []).map((profile: any) => [profile.id, profile]));

  const wanted = new Set(quotes.map((q) => `${q.user_id}:${q.record_date}`));
  const map: Record<string, Record<string, { count: number; reacted: boolean; actors?: { user_id: string; display_name: string; avatar_url: string | null }[] }>> = {};
  (reactionResult.data || []).forEach((row: any) => {
    const key = `${row.quote_user_id}:${row.quote_record_date}`;
    if (!wanted.has(key)) return;
    if (!map[key]) map[key] = {};
    if (!map[key][row.reaction_type]) map[key][row.reaction_type] = { count: 0, reacted: false, actors: [] };
    map[key][row.reaction_type].count += 1;
    const profile = profileById.get(row.reactor_user_id);
    if (profile && !map[key][row.reaction_type].actors?.some((actor) => actor.user_id === row.reactor_user_id)) {
      map[key][row.reaction_type].actors?.push({ user_id: row.reactor_user_id, display_name: profile.display_name, avatar_url: profile.avatar_url || null });
    }
    if (reactorId && row.reactor_user_id === reactorId) map[key][row.reaction_type].reacted = true;
  });
  (commentResult.data || []).forEach((row: any) => {
    const key = `${row.quote_user_id}:${row.quote_record_date}`;
    if (!wanted.has(key)) return;
    if (!map[key]) map[key] = {};
    if (!map[key].comments) map[key].comments = { count: 0, reacted: false };
    map[key].comments.count += 1;
  });
  return map;
}

export async function reactToDailyQuote(quoteUserId: string, quoteRecordDate: string, reactorUserId: string, reactionType: string) {
  const { data, error } = await supabase.rpc('react_to_daily_quote', {
    p_quote_user_id: quoteUserId,
    p_quote_record_date: quoteRecordDate,
    p_reactor_user_id: reactorUserId,
    p_reaction_type: reactionType,
  });
  if (error) throw error;
  return data;
}

export async function fetchDailyQuoteComments(quoteUserId: string, quoteRecordDate: string) {
  const { data, error } = await supabase.rpc('get_daily_quote_comments', {
    p_quote_user_id: quoteUserId,
    p_quote_record_date: quoteRecordDate,
  });
  if (error) throw error;
  return data as import('./types').DailyQuoteComment[];
}

export async function commentOnDailyQuote(
  quoteUserId: string,
  quoteRecordDate: string,
  commenterUserId: string,
  body: string,
  parentCommentId?: string | null,
  mentionedUserIds: string[] = [],
) {
  const { data, error } = await supabase.rpc('comment_on_daily_quote', {
    p_quote_user_id: quoteUserId,
    p_quote_record_date: quoteRecordDate,
    p_commenter_user_id: commenterUserId,
    p_body: body,
    p_parent_comment_id: parentCommentId || null,
    p_mentioned_user_ids: mentionedUserIds,
  });
  if (error) throw error;
  return data;
}

export async function editDailyQuoteComment(commentId: string, body: string) {
  const { error } = await supabase.rpc('edit_daily_quote_comment', { p_comment_id: commentId, p_body: body });
  if (error) throw error;
}

export async function fetchDailyVerseReactions(narrativeDates: string[], reactorId?: string) {
  if (narrativeDates.length === 0) return {};
  const { data, error } = await supabase
    .from('daily_verse_reactions')
    .select('narrative_date, reactor_user_id, reaction_type')
    .in('narrative_date', narrativeDates);
  if (error) throw error;

  const reactorIds = Array.from(new Set((data || []).map((row: any) => row.reactor_user_id).filter(Boolean)));
  const { data: reactorProfiles } = reactorIds.length
    ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', reactorIds)
    : { data: [] as Array<{ id: string; display_name: string; avatar_url: string | null }> };
  const profileById = new Map((reactorProfiles || []).map((profile: any) => [profile.id, profile]));
  const map: Record<string, Record<string, { count: number; reacted: boolean; actors?: { user_id: string; display_name: string; avatar_url: string | null }[] }>> = {};
  (data || []).forEach((row: any) => {
    const key = row.narrative_date;
    if (!map[key]) map[key] = {};
    if (!map[key][row.reaction_type]) map[key][row.reaction_type] = { count: 0, reacted: false, actors: [] };
    map[key][row.reaction_type].count += 1;
    const profile = profileById.get(row.reactor_user_id);
    if (profile && !map[key][row.reaction_type].actors?.some((actor) => actor.user_id === row.reactor_user_id)) {
      map[key][row.reaction_type].actors?.push({ user_id: row.reactor_user_id, display_name: profile.display_name, avatar_url: profile.avatar_url || null });
    }
    if (reactorId && row.reactor_user_id === reactorId) map[key][row.reaction_type].reacted = true;
  });
  return map;
}

export async function reactToDailyVerse(narrativeDate: string, reactorUserId: string, reactionType: string) {
  const { error } = await supabase
    .from('daily_verse_reactions')
    .upsert(
      { narrative_date: narrativeDate, reactor_user_id: reactorUserId, reaction_type: reactionType },
      { onConflict: 'narrative_date,reactor_user_id,reaction_type' },
    );
  if (error) throw error;
}

export async function fetchDailyVerseComments(narrativeDate: string) {
  const { data, error } = await supabase
    .from('daily_verse_comments')
    .select('id,body,created_at,edited_at,commenter_user_id,profiles!daily_verse_comments_commenter_user_id_fkey(display_name,avatar_url)')
    .eq('narrative_date', narrativeDate)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    edited_at: row.edited_at || null,
    commenter_user_id: row.commenter_user_id,
    display_name: row.profiles?.display_name || 'User',
    avatar_url: row.profiles?.avatar_url || null,
    rank_label: 'Verse',
  })) as import('./types').DailyQuoteComment[];
}

export async function commentOnDailyVerse(narrativeDate: string, commenterUserId: string, body: string) {
  const { data, error } = await supabase
    .from('daily_verse_comments')
    .insert({ narrative_date: narrativeDate, commenter_user_id: commenterUserId, body })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function editDailyVerseComment(commentId: string, body: string) {
  const { error } = await supabase.rpc('edit_daily_verse_comment', { p_comment_id: commentId, p_body: body });
  if (error) throw error;
}

export async function fetchDailyQuoteInteractionSummary(limit = 50) {
  const { data, error } = await supabase.rpc('get_daily_quote_interaction_summary', { p_limit: limit });
  if (error) throw error;
  return data as {
    quote_user_id: string;
    quote_record_date: string;
    daily_quote: string;
    display_name: string;
    avatar_url: string | null;
    reaction_count: number;
    comment_count: number;
    interaction_count: number;
  }[];
}

// ── Mobile money ──

export async function fetchMobileMoneySettings(): Promise<MobileMoneySettings | null> {
  const { data, error } = await supabase
    .from('mobile_money_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data as MobileMoneySettings | null;
}

export async function saveMobileMoneySettings(settings: Partial<MobileMoneySettings>) {
  const { error } = await supabase.rpc('save_mobile_money_settings', {
    p_provider_name: settings.provider_name || 'MTN MoMo',
    p_phone_number: settings.phone_number || '',
    p_account_name: settings.account_name || '',
    p_instructions: settings.instructions || null,
    p_payout_enabled: settings.payout_enabled ?? true,
    p_payout_provider_name: settings.payout_provider_name || settings.provider_name || 'MTN MoMo',
    p_payout_phone_number: settings.payout_phone_number || settings.phone_number || '',
    p_payout_account_name: settings.payout_account_name || settings.account_name || '',
    p_payout_max_amount_xaf: settings.payout_max_amount_xaf ?? null,
  });
  if (error) throw error;
}

export async function fetchUserMobileMoneyPayments(userId: string): Promise<MobileMoneyPayment[]> {
  const { data, error } = await supabase
    .from('mobile_money_payments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as MobileMoneyPayment[];
}

export async function fetchPendingMobileMoneyPayments(): Promise<(MobileMoneyPayment & { profiles: { display_name: string; email: string } | null })[]> {
  const { data, error } = await supabase
    .from('mobile_money_payments')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const profiles = await fetchAllProfiles();
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  return (data || []).map((payment) => ({ ...payment, profiles: profileMap.get(payment.user_id) || null })) as any;
}

export async function fetchInstructorMobileMoneyPayments(limit = 100): Promise<(MobileMoneyPayment & { profiles: { display_name: string; email: string } | null })[]> {
  const { data, error } = await supabase
    .from('mobile_money_payments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const profiles = await fetchAllProfiles();
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  return (data || []).map((payment) => ({ ...payment, profiles: profileMap.get(payment.user_id) || null })) as any;
}

export type CampayPaymentResult = {
  status: string;
  reference: string;
  payment_id?: string;
  payment_method?: string;
  amount_local?: number;
  currency_code?: string;
  amount_display?: string;
  provider?: string;
  provider_reference?: string | null;
  operator?: string | null;
  ussd_code?: string | null;
  message?: string;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  amount_xaf: number;
  duration_days: number;
  is_active: boolean;
  checkout_mode: 'demo' | 'live';
};

async function requestCampayCheckout(payload: Record<string, unknown>): Promise<CampayPaymentResult> {
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('You must be signed in to start checkout.');

  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const rawBody = await res.text();
  let data: any = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = { message: rawBody };
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || `Checkout failed (${res.status})`);
  }
  if (!data.reference && !data.tx_ref) throw new Error('No payment reference returned');
  return {
    ...data,
    reference: data.reference || data.tx_ref,
  } as CampayPaymentResult;
}

export async function startCampayCheckout(
  relicSlug: string,
  userId: string,
  paymentMethod: string,
  customerEmail?: string,
  customerName?: string,
  customerPhone?: string,
  otherProvider?: string,
  paymentNote?: string,
  displayedAmountXaf?: number,
): Promise<CampayPaymentResult> {
  return requestCampayCheckout({
    purchase_kind: 'relic',
    relic_slug: relicSlug,
    user_id: userId,
    payment_provider: 'campay',
    payment_method: paymentMethod,
    customer_email: customerEmail,
    customer_name: customerName,
    customer_phone: customerPhone,
    other_provider: otherProvider,
    payment_note: paymentNote,
    displayed_amount_xaf: displayedAmountXaf,
  });
}

export async function fetchActiveSubscriptionPlan(): Promise<SubscriptionPlan> {
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const userId = sessionData.session?.user.id;
  if (!accessToken || !userId) throw new Error('You must be signed in to view subscription checkout.');

  const response = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      purchase_kind: 'subscription',
      subscription_plan_id: 'monthly',
      quote_only: true,
      user_id: userId,
    }),
  });
  const rawBody = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = { message: rawBody };
  }
  if (!response.ok) {
    throw new Error(String(data.error || data.message || `Subscription quote failed (${response.status})`));
  }
  return {
    id: String(data.plan_id || 'monthly'),
    name: String(data.name || 'Full Circle Monthly'),
    amount_xaf: Number(data.amount_local),
    duration_days: Number(data.duration_days),
    is_active: true,
    checkout_mode: data.checkout_mode === 'demo' ? 'demo' : 'live',
  };
}

export async function startSubscriptionCheckout(
  planId: string,
  userId: string,
  paymentMethod: 'mtn_momo' | 'orange_money',
  customerPhone: string,
  displayedAmountXaf: number,
  customerEmail?: string,
  customerName?: string,
): Promise<CampayPaymentResult> {
  return requestCampayCheckout({
    purchase_kind: 'subscription',
    subscription_plan_id: planId,
    user_id: userId,
    payment_provider: 'campay',
    payment_method: paymentMethod,
    customer_email: customerEmail,
    customer_name: customerName,
    customer_phone: customerPhone,
    displayed_amount_xaf: displayedAmountXaf,
  });
}

export async function verifyCampayPayment(reference: string) {
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campay-webhook`;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reference }),
  });
  const rawBody = await res.text();
  let data: any = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = { message: rawBody };
  }
  if (!res.ok) throw new Error(data.error || data.message || `Payment verification failed (${res.status})`);
  return data;
}

// ── Tent messages ──

export async function fetchTentMessages(tentId: string, userId: string) {
  const { data, error } = await supabase
    .from('tent_messages')
    .select('*, sender:profiles!sender_id(display_name,avatar_url)')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .eq('tent_id', tentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchUnreadTentMessagesForUser(userId: string) {
  const { data, error } = await supabase
    .from('tent_messages')
    .select('*')
    .eq('recipient_id', userId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;

  const messages = data || [];
  const senderIds = Array.from(new Set(messages.map((message: any) => message.sender_id).filter(Boolean)));
  if (senderIds.length === 0) return messages;

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id,display_name,avatar_url')
    .in('id', senderIds);
  const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));

  return messages.map((message: any) => ({
    ...message,
    sender: profileMap.get(message.sender_id) || null,
  }));
}

export async function sendTentMessage(tentId: string, senderId: string, recipientId: string, body: string) {
  const { error } = await supabase
    .from('tent_messages')
    .insert({ tent_id: tentId, sender_id: senderId, recipient_id: recipientId, body });
  if (error) throw error;
}

export async function editTentMessage(messageId: string, body: string) {
  const { error } = await supabase.rpc('edit_tent_message', { p_message_id: messageId, p_body: body });
  if (error) throw error;
}

export async function markTentMessageRead(messageId: string) {
  const { error } = await supabase
    .from('tent_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

export async function fetchTentGroupMessages(tentId: string) {
  const { data, error } = await supabase
    .from('tent_group_messages')
    .select('*, sender:profiles!sender_id(display_name,avatar_url)')
    .eq('tent_id', tentId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return data || [];
}

export async function sendTentGroupMessage(tentId: string, senderId: string, body: string) {
  const { error } = await supabase
    .from('tent_group_messages')
    .insert({ tent_id: tentId, sender_id: senderId, body });
  if (error) throw error;
}

export async function editTentGroupMessage(messageId: string, body: string) {
  const { error } = await supabase.rpc('edit_tent_group_message', { p_message_id: messageId, p_body: body });
  if (error) throw error;
}

// ── Direct messages ──

export async function fetchDirectMessages(senderId: string, recipientId: string) {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*, sender:profiles!sender_id(display_name,avatar_url)')
    .or(`and(sender_id.eq.${senderId},recipient_id.eq.${recipientId}),and(sender_id.eq.${recipientId},recipient_id.eq.${senderId})`)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchUnreadDirectMessagesForUser(userId: string) {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('id,sender_id,recipient_id,body,read_at,created_at')
    .eq('recipient_id', userId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

export async function sendDirectMessage(senderId: string, recipientId: string, body: string) {
  const { error } = await supabase
    .from('direct_messages')
    .insert({ sender_id: senderId, recipient_id: recipientId, body });
  if (error) throw error;
}

export async function editDirectMessage(messageId: string, body: string) {
  const { error } = await supabase.rpc('edit_direct_message', { p_message_id: messageId, p_body: body });
  if (error) throw error;
}

export async function markDirectMessageRead(messageId: string) {
  const { error } = await supabase
    .from('direct_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

export async function fetchUnassignedUsers() {
  const { data, error } = await supabase.rpc('get_unassigned_users');
  if (error) throw error;
  return data as { user_id: string; display_name: string; email: string; avatar_url: string | null; created_at: string }[];
}

export async function isSaturdayQuizScheduled() {
  const { data, error } = await supabase.rpc('is_saturday_quiz_scheduled');
  if (error) throw error;
  return data as boolean;
}

export async function fetchFortuneQuizSession() {
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('*')
    .eq('quiz_type', 'fortune')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Avatar upload ──

export async function uploadAvatar(userId: string, file: File) {
  const prepared = await prepareImageUpload(file, { maxDimension: 1024, maxBytes: 8 * 1024 * 1024 });
  const version = Date.now();
  const path = `${userId}/avatar-${version}.${prepared.extension}`;
  const { error } = await supabase.storage.from('avatars').upload(path, prepared.file, { upsert: true, contentType: prepared.file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const publicUrl = `${data.publicUrl}?v=${version}`;
  const { error: profileError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
  if (profileError) throw profileError;
  return publicUrl;
}

export async function uploadFcxGuestAvatar(eventId: string, file: File) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error('Sign in before adding an FCX participant photo.');

  const prepared = await prepareImageUpload(file, { maxDimension: 1024, maxBytes: 8 * 1024 * 1024 });
  const version = Date.now();
  const path = `${authData.user.id}/fcx/${eventId}/guest-${version}.${prepared.extension}`;
  const { error } = await supabase.storage.from('avatars').upload(path, prepared.file, {
    upsert: false,
    contentType: prepared.file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?v=${version}`;
}

export async function uploadTentProfileImage(userId: string, tentId: string, file: File) {
  const prepared = await prepareImageUpload(file, { maxDimension: 1600, maxBytes: 10 * 1024 * 1024 });
  const version = Date.now();
  const path = `${userId}/tents/${tentId}/profile-${version}.${prepared.extension}`;
  const { error } = await supabase.storage.from('avatars').upload(path, prepared.file, { upsert: true, contentType: prepared.file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const publicUrl = `${data.publicUrl}?v=${version}`;
  const { error: updateError } = await supabase.rpc('update_tent_profile_image', {
    p_tent_id: tentId,
    p_sentry_id: userId,
    p_profile_image_url: publicUrl,
  });
  if (updateError) throw updateError;
  return publicUrl;
}

// ── Arena queries ──

export async function createArenaRoom(creatorId: string, roomName: string, stake: number, maxPlayers: number = 4, narrativeDate?: string, taggedIds?: string[]) {
  const { data, error } = await supabase.rpc('create_arena_room', {
    p_creator_id: creatorId, p_room_name: roomName, p_stake_amount: stake,
    p_max_players: maxPlayers, p_narrative_date: narrativeDate || null,
    p_tagged_user_ids: taggedIds || [],
  });
  if (error) throw error;
  return data as string;
}

export async function createMachineArenaRoom(creatorId: string, roomName: string, narrativeDate?: string) {
  const { data, error } = await supabase.rpc('create_machine_arena_room', {
    p_creator_id: creatorId,
    p_room_name: roomName,
    p_narrative_date: narrativeDate || null,
  });
  if (error) throw error;
  return data as string;
}

export async function inviteArenaPlayers(roomId: string, inviterId: string, inviteeIds: string[]) {
  if (inviteeIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('invite_arena_players', {
    p_room_id: roomId,
    p_inviter_id: inviterId,
    p_invitee_ids: inviteeIds,
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function joinArenaRoom(roomId: string, userId: string) {
  const { error } = await supabase.rpc('join_arena_room', { p_room_id: roomId, p_user_id: userId });
  if (error) throw error;
}

export async function startArenaRoom(roomId: string, userId: string) {
  const { error } = await supabase.rpc('start_arena_game', { p_room_id: roomId, p_user_id: userId });
  if (error) throw error;
}

export async function closeArenaRoom(roomId: string, userId: string) {
  const { error } = await supabase.rpc('close_arena_room', { p_room_id: roomId, p_user_id: userId });
  if (error) throw error;
}

export async function heartbeatArenaParticipant(roomId: string, userId: string) {
  const { data, error } = await supabase.rpc('heartbeat_arena_participant', {
    p_room_id: roomId,
    p_user_id: userId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function forfeitArenaGame(roomId: string, userId: string) {
  const { error } = await supabase.rpc('forfeit_arena_game', {
    p_room_id: roomId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function finishArenaGame(roomId: string, userId: string, score: number, correctCount: number) {
  const { error } = await supabase.rpc('finish_arena_game', {
    p_room_id: roomId, p_user_id: userId, p_score: score, p_correct_count: correctCount,
  });
  if (error) throw error;
}

export async function submitArenaTriviaAnswer(roomId: string, userId: string, questionIndex: number, answer: string | null) {
  const { data, error } = await supabase.rpc('submit_arena_trivia_answer', {
    p_room_id: roomId,
    p_user_id: userId,
    p_question_index: questionIndex,
    p_answer: answer || '',
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error('The arena could not verify that answer.');
  return {
    correct: Boolean(result.is_correct),
    figsEarned: Number(result.figs_earned) || 0,
    totalFigs: Number(result.total_figs) || 0,
    correctCount: Number(result.correct_count) || 0,
    machineQuestionIndex: result.machine_question_index == null ? null : Number(result.machine_question_index),
    machineAnswer: result.machine_answer == null ? null : String(result.machine_answer),
    machineCorrect: result.machine_correct == null ? null : Boolean(result.machine_correct),
    machineFigs: Number(result.machine_figs) || 0,
    machineTotalFigs: Number(result.machine_total_figs) || 0,
  };
}

export type ArenaTriviaFeedItem = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  question_index: number;
  submitted_answer: string;
  is_correct: boolean;
  figs_earned: number;
  created_at: string;
};

export async function fetchArenaTriviaFeed(roomId: string) {
  const { data, error } = await supabase.rpc('get_arena_trivia_feed', { p_room_id: roomId });
  if (error) throw error;
  return (data || []) as ArenaTriviaFeedItem[];
}

export async function fetchArenaRoomMessages(roomId: string) {
  const { data, error } = await supabase
    .from('arena_room_messages')
    .select('id,room_id,sender_id,body,created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  const senderIds = Array.from(new Set((data || []).map((message: any) => message.sender_id)));
  const { data: profiles } = senderIds.length
    ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', senderIds)
    : { data: [] as any[] };
  const byId = new Map((profiles || []).map((item: any) => [item.id, item]));
  return (data || []).map((message: any) => ({ ...message, sender: byId.get(message.sender_id) || null }));
}

export async function sendArenaRoomMessage(roomId: string, senderId: string, body: string) {
  const { error } = await supabase.from('arena_room_messages').insert({
    room_id: roomId,
    sender_id: senderId,
    body: body.trim(),
  });
  if (error) throw error;
}

export async function fetchQuizWaitingMessages(sessionId: string) {
  const { data, error } = await supabase.from('quiz_waiting_messages').select('id,quiz_session_id,sender_id,body,created_at').eq('quiz_session_id', sessionId).order('created_at', { ascending: true }).limit(100);
  if (error) throw error;
  const senderIds = Array.from(new Set((data || []).map((message: any) => message.sender_id)));
  const { data: profiles } = senderIds.length ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', senderIds) : { data: [] as any[] };
  const byId = new Map((profiles || []).map((item: any) => [item.id, item]));
  return (data || []).map((message: any) => ({ ...message, sender: byId.get(message.sender_id) || null }));
}

export async function sendQuizWaitingMessage(sessionId: string, senderId: string, body: string) {
  const { error } = await supabase.from('quiz_waiting_messages').insert({ quiz_session_id: sessionId, sender_id: senderId, body: body.trim() });
  if (error) throw error;
}

export async function prepareArenaQuestionDeck(payload: {
  roomId: string;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !supabaseAnonKey) throw new Error('Sign in again before preparing the Arena.');

  const res = await fetch(`${supabaseUrl}/functions/v1/generate-arena-questions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'The Arena could not prepare its quiz archive questions.');
  }
  const data = await res.json();
  if (!Array.isArray(data.questions)) throw new Error('The Arena quiz archive returned no questions.');
  return data.questions as QuestionPayload[];
}

export async function generateInstructorQuestionsWithAI(payload: {
  mode: 'quiz' | 'game';
  narrativeDates: string[];
  count: number;
  level?: number;
  questionTypes?: Record<number, string>;
  passages?: Record<number, string>;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !supabaseAnonKey) throw new Error('Sign in again before generating questions.');
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/generate-instructor-questions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const raw = await response.text();
    let result: { questions?: QuestionPayload[]; error?: string } = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch { /* Use the HTTP fallback below. */ }
    if (!response.ok) throw new Error(result.error || raw || 'AI question generation failed.');
    if (!Array.isArray(result.questions)) throw new Error('The AI generator returned no questions.');
    return result.questions;
  } catch (error: any) {
    const { data, error: narrativeError } = await supabase
      .from('daily_narratives')
      .select('*')
      .in('narrative_date', payload.narrativeDates)
      .order('narrative_date', { ascending: true });
    if (narrativeError) throw error;
    const fallback = generateInstructorFallbackQuestions((data || []) as DailyNarrative[], payload.mode, payload.count);
    if (fallback.length > 0) return fallback;
    throw error;
  }
}

async function callRoadHomeServer(body: Record<string, unknown>): Promise<RoadHomeResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !supabaseAnonKey) throw new Error('Sign in again to continue The Road Home.');
  const response = await fetch(`${supabaseUrl}/functions/v1/road-home-game`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let payload: RoadHomeResponse & { error?: string };
  try { payload = raw ? JSON.parse(raw) : { state: null }; } catch { payload = { state: null, error: raw || 'The Road Home server returned an invalid response.' }; }
  if (!response.ok) {
    const error = new Error(payload.error || 'The Road Home command failed.') as Error & { state?: RoadHomeResponse['state']; version?: number; needsInitialization?: boolean };
    error.state = payload.state;
    error.version = payload.version;
    error.needsInitialization = payload.needsInitialization;
    throw error;
  }
  return payload;
}

export function fetchRoadHomeState(roomId: string) {
  return callRoadHomeServer({ roomId, action: 'GET' });
}

export function initializeRoadHome(roomId: string) {
  return callRoadHomeServer({ roomId, action: 'INIT', commandId: crypto.randomUUID() });
}

export function sendRoadHomeCommand(
  roomId: string,
  action: string,
  payload: Record<string, unknown>,
  expectedVersion: number,
) {
  return callRoadHomeServer({
    roomId,
    action,
    payload,
    expectedVersion,
    commandId: crypto.randomUUID(),
  });
}

async function mergeArenaRoomsWithParticipants(rooms: any[]) {
  if (rooms.length === 0) return [];

  const roomIds = rooms.map((room) => room.id);
  const { data: participants, error: participantError } = await supabase
    .from('arena_participants')
    .select('*')
    .in('room_id', roomIds)
    .order('joined_at', { ascending: true });
  if (participantError) throw participantError;

  const userIds = Array.from(new Set((participants || []).map((participant: any) => participant.user_id).filter(Boolean)));
  const profileMap = new Map<string, any>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id,display_name,avatar_url')
      .in('id', userIds);
    (profiles || []).forEach((profile: any) => profileMap.set(profile.id, profile));
  }

  return rooms.map((room) => ({
    ...room,
    arena_participants: (participants || [])
      .filter((participant: any) => participant.room_id === room.id)
      .map((participant: any) => ({
        ...participant,
        profiles: profileMap.get(participant.user_id) || null,
      })),
  }));
}

export async function fetchArenaRooms() {
  try {
    await supabase.rpc('expire_stale_arena_rooms');
  } catch {}

  const { data, error } = await supabase
    .from('arena_rooms')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return mergeArenaRoomsWithParticipants(data || []);
}

export async function fetchArenaRoom(roomId: string) {
  try {
    await supabase.rpc('expire_stale_arena_rooms');
  } catch {}

  const { data, error } = await supabase
    .from('arena_rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();
  if (error) throw error;
  const [room] = await mergeArenaRoomsWithParticipants(data ? [data] : []);
  return room || null;
}

// ── Strict streak ──

export type PublicStreakDetails = {
  current_streak: number;
  longest_streak: number;
  consecutive_inactive: number;
  cumulative_inactive: number;
};

export async function fetchPublicStreakDetails(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return {} as Record<string, PublicStreakDetails>;
  const { data, error } = await supabase.rpc('get_public_streak_details', { p_user_ids: ids });
  if (error) throw error;
  const rows = (data || []) as Array<{ user_id: string; current_streak: number; longest_streak: number; consecutive_inactive: number; cumulative_inactive: number }>;
  return Object.fromEntries(rows.map((row) => [String(row.user_id), {
    current_streak: Number(row.current_streak) || 0,
    longest_streak: Number(row.longest_streak) || 0,
    consecutive_inactive: Number(row.consecutive_inactive) || 0,
    cumulative_inactive: Number(row.cumulative_inactive) || 0,
  }])) as Record<string, PublicStreakDetails>;
}

export async function fetchStrictStreak(userId: string) {
  try {
    let { data, error } = await supabase.rpc('get_authoritative_streak', { p_user_id: userId });
    if (error) {
      const strict = await supabase.rpc('compute_strict_streak', { p_user_id: userId });
      data = strict.data;
      error = strict.error;
    }
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      current_streak: Number(row?.current_streak) || 0,
      longest_streak: Number(row?.longest_streak) || 0,
      consecutive_inactive: Number(row?.consecutive_inactive) || 0,
      cumulative_inactive: Number(row?.cumulative_inactive) || 0,
    };
  } catch (error) {
    const liveStats = await fetchUserLiveStats(userId).catch(() => null);
    if (!liveStats) throw error;
    return {
      current_streak: liveStats?.current_streak || 0,
      longest_streak: liveStats?.longest_streak || 0,
      consecutive_inactive: liveStats?.consecutive_inactive || 0,
      cumulative_inactive: liveStats?.cumulative_inactive || 0,
    };
  }
}

export async function fetchQuizScoreboard(audience: 'cadet' | 'sentry' = 'cadet') {
  if (audience === 'sentry') {
    const { data, error } = await supabase.rpc('get_quiz_scoreboard_for_role', { p_role: 'sentry' });
    if (error) throw error;
    return (data || []) as QuizScoreboardRow[];
  }
  const { data, error } = await supabase.rpc('get_quiz_scoreboard');
  if (error) throw error;
  return (data || []) as QuizScoreboardRow[];
}

export async function fetchRhudeBoard() {
  const { data, error } = await supabase.rpc('get_rhude_board_live');
  if (error) throw error;
  return (data || []) as import('./types').RhudeBoardRow[];
}

export async function fetchMarksBoard() {
  const { data, error } = await supabase.rpc('get_marks_board_live');
  if (error) throw error;
  return (data || []) as import('./types').MarksBoardRow[];
}

export async function fetchFullCircleEconomyRules() {
  const { data, error } = await supabase.rpc('get_full_circle_economy_rules');
  if (error) throw error;
  const row = (data || [])[0] as import('./types').FullCircleEconomyRules | undefined;
  if (!row) throw new Error('The Full Circle economy rules are unavailable.');
  return {
    streaks_per_mark: Number(row.streaks_per_mark),
    denarii_per_talent: Number(row.denarii_per_talent),
    talents_per_mark: Number(row.talents_per_mark),
    rhudes_per_mark: Number(row.rhudes_per_mark),
    figs_per_mark: Number(row.figs_per_mark),
  } satisfies import('./types').FullCircleEconomyRules;
}
