import { supabase } from '../lib/supabase';
import type {
  Profile, RoleAssignment, Tent, TentMember, DailyRecord, DailyNarrative,
  QuizSession, GeneratedQuestion, QuizAttempt, QuestionResponse,
  DenariiLedgerEntry, GameAttempt, RelicType, RelicInventory,
  StreakboardSnapshot, LeaderboardWeeklySnapshot, Award,
  ScheduledAnnouncement, ChallengeSubmission, StreakFreezer,
  MobileMoneySettings, MobileMoneyPayment, UserNotification,
  QuizScoreboardRow, QuestionPayload,
} from '../lib/types';

export async function fetchTentHouses() {
  const { data, error } = await supabase.from('tent_houses').select('*');
  if (error) throw error;
  return data;
}

export async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
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
  const { data, error } = await supabase.from('profiles').select('*').order('display_name');
  if (error) throw error;
  return data as Profile[];
}

export async function fetchAllRoleAssignments() {
  const { data, error } = await supabase.from('role_assignments').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data as RoleAssignment[];
}

export async function fetchActiveCadets() {
  const { data, error } = await supabase
    .from('role_assignments')
    .select('*, profiles!role_assignments_user_id_fkey(*)')
    .eq('role', 'cadet')
    .in('status', ['active', 'approved'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as (RoleAssignment & { profiles: Profile })[];
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
    .select('*, profiles(*)')
    .order('joined_at');
  if (error) throw error;
  return data as (TentMember & { profiles: Profile })[];
}

export async function fetchTentMembersForTent(tentId: string) {
  const { data, error } = await supabase
    .from('tent_members')
    .select('*, profiles(*)')
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

export async function fetchDailyRecords(userId: string) {
  const { data, error } = await supabase
    .from('daily_records')
    .select('*')
    .eq('user_id', userId)
    .order('record_date', { ascending: true });
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
    .select('*, profiles(display_name)')
    .eq('record_date', date)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function fetchNarrative(date: string) {
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
    query = query.lte('narrative_date', new Date().toISOString().split('T')[0]);
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
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('*')
    .order('session_date', { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw error;
  return data as QuizSession | null;
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

export async function fetchQuestionsForSession(sessionId: string) {
  const { data, error } = await supabase
    .from('generated_questions')
    .select('*')
    .eq('quiz_session_id', sessionId)
    .order('question_index');
  if (error) throw error;
  return data as GeneratedQuestion[];
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

export async function fetchQuizAttempt(userId: string, sessionId: string) {
  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('*')
    .eq('user_id', userId)
    .eq('quiz_session_id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data as QuizAttempt | null;
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
    .select('*, profiles!quiz_attempts_user_id_fkey(display_name,email,avatar_url), question_responses(*)')
    .eq('quiz_session_id', sessionId)
    .order('submitted_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data as (QuizAttempt & {
    profiles: { display_name: string; email: string; avatar_url: string | null } | null;
    question_responses: QuestionResponse[];
  })[];
}

export async function fetchLedgerEntries(userId: string) {
  const { data, error } = await supabase
    .from('denarii_ledger_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as DenariiLedgerEntry[];
}

export async function fetchLedgerTotal(userId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .rpc('get_user_denarii_total', { p_user_id: userId });
    if (error) throw error;
    return Number(data) || 0;
  } catch {
    try {
      const entries = await fetchLedgerEntries(userId);
      return entries.reduce((sum, e) => sum + e.amount, 0);
    } catch {
      return 0;
    }
  }
}

export async function insertLedgerEntry(entry: Partial<DenariiLedgerEntry>) {
  const { error } = await supabase.from('denarii_ledger_entries').insert(entry);
  if (error) throw error;
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

export async function insertGameAttempt(attempt: Partial<GameAttempt>) {
  const { data, error } = await supabase
    .from('game_attempts')
    .insert(attempt)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as GameAttempt;
}

export async function updateGameAttempt(id: string, updates: Partial<GameAttempt>) {
  const { error } = await supabase.from('game_attempts').update(updates).eq('id', id);
  if (error) throw error;
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

export async function fetchStreakboardSnapshots() {
  const { data, error } = await supabase
    .from('streakboard_snapshots')
    .select('*, profiles(display_name)')
    .order('snapshot_date', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return [];
  const latestDate = data[0].snapshot_date;
  const { data: rows, error: err2 } = await supabase
    .from('streakboard_snapshots')
    .select('*, profiles(display_name)')
    .eq('snapshot_date', latestDate)
    .order('rank');
  if (err2) throw err2;
  return rows as (StreakboardSnapshot & { profiles: { display_name: string } })[];
}

export async function fetchLeaderboardSnapshots() {
  const { data, error } = await supabase
    .from('leaderboard_weekly_snapshots')
    .select('*, profiles(display_name)')
    .order('week_ending', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return [];
  const latestWeek = data[0].week_ending;
  const { data: rows, error: err2 } = await supabase
    .from('leaderboard_weekly_snapshots')
    .select('*, profiles(display_name)')
    .eq('week_ending', latestWeek)
    .order('rank');
  if (err2) throw err2;
  return rows as (LeaderboardWeeklySnapshot & { profiles: { display_name: string } })[];
}

export async function fetchAwards() {
  const { data, error } = await supabase
    .from('awards')
    .select('*, profiles(display_name)')
    .order('award_month', { ascending: false });
  if (error) throw error;
  return data as (Award & { profiles: { display_name: string } })[];
}

export async function insertAward(award: Partial<Award>) {
  const { error } = await supabase.from('awards').insert(award);
  if (error) throw error;
}

export async function fetchAnnouncements(audiences: string[] = ['all', 'cadets']) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('scheduled_announcements')
    .select('*')
    .lte('publish_at', now)
    .eq('is_active', true)
    .in('audience', audiences)
    .order('publish_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  return data as ScheduledAnnouncement[];
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

export async function createAnnouncement(announcement: Omit<ScheduledAnnouncement, 'id'>) {
  const { error } = await supabase.from('scheduled_announcements').insert(announcement);
  if (error) throw error;
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
  const { error } = await supabase.from('challenge_submissions').upsert(sub);
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
  const { error: ledgerError } = await supabase.from('denarii_ledger_entries').insert({
    user_id: userId,
    amount: -500,
    source_type: 'freezer_daily' as any,
    description: 'Daily streak freezer purchased',
  });
  if (ledgerError) throw ledgerError;

  const { error: freezerError } = await supabase.from('streak_freezers').insert({
    user_id: userId,
    freezer_type: 'daily',
    source: 'denarii',
  });
  if (freezerError) throw freezerError;

  const { error: purchaseError } = await supabase.from('denarii_purchases').insert({
    user_id: userId,
    purchase_type: 'freezer_daily',
    amount: 500,
  });
  if (purchaseError) throw purchaseError;
}

export async function fetchAllChallengeSubmissions() {
  const { data, error } = await supabase
    .from('challenge_submissions')
    .select('*, profiles(display_name)')
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
  const { data, error } = await supabase.rpc('use_relic', {
    p_user_id: userId, p_relic_slug: slug,
  });
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

export async function updateCustomQuestion(id: string, patch: Partial<import('./types').CustomQuestion>) {
  const { error } = await supabase.from('custom_questions').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCustomQuestion(id: string) {
  const { error } = await supabase.from('custom_questions').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchCustomGameQuestions(level: number, narrativeDate?: string) {
  let query = supabase
    .from('custom_questions')
    .select('*')
    .not('game_level', 'is', null)
    .eq('game_level', level)
    .order('question_index');
  if (narrativeDate) query = query.eq('narrative_date', narrativeDate);
  const { data, error } = await query;
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
  const { data, error } = await supabase.rpc('get_daily_quote_feed', { p_limit: limit });
  if (error) throw error;
  return data as import('./types').DailyQuoteFeedItem[];
}

export async function fetchDailyQuoteReactions(quotes: { user_id: string; record_date: string }[], reactorId?: string) {
  if (quotes.length === 0) return {};
  const userIds = Array.from(new Set(quotes.map((q) => q.user_id)));
  const dates = Array.from(new Set(quotes.map((q) => q.record_date)));
  const { data, error } = await supabase
    .from('daily_quote_reactions')
    .select('quote_user_id, quote_record_date, reactor_user_id, reaction_type')
    .in('quote_user_id', userIds)
    .in('quote_record_date', dates);
  if (error) throw error;

  const wanted = new Set(quotes.map((q) => `${q.user_id}:${q.record_date}`));
  const map: Record<string, Record<string, { count: number; reacted: boolean }>> = {};
  (data || []).forEach((row: any) => {
    const key = `${row.quote_user_id}:${row.quote_record_date}`;
    if (!wanted.has(key)) return;
    if (!map[key]) map[key] = {};
    if (!map[key][row.reaction_type]) map[key][row.reaction_type] = { count: 0, reacted: false };
    map[key][row.reaction_type].count += 1;
    if (reactorId && row.reactor_user_id === reactorId) map[key][row.reaction_type].reacted = true;
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

export async function commentOnDailyQuote(quoteUserId: string, quoteRecordDate: string, commenterUserId: string, body: string) {
  const { data, error } = await supabase.rpc('comment_on_daily_quote', {
    p_quote_user_id: quoteUserId,
    p_quote_record_date: quoteRecordDate,
    p_commenter_user_id: commenterUserId,
    p_body: body,
  });
  if (error) throw error;
  return data;
}

export async function fetchDailyVerseReactions(narrativeDates: string[], reactorId?: string) {
  if (narrativeDates.length === 0) return {};
  const { data, error } = await supabase
    .from('daily_verse_reactions')
    .select('narrative_date, reactor_user_id, reaction_type')
    .in('narrative_date', narrativeDates);
  if (error) throw error;

  const map: Record<string, Record<string, { count: number; reacted: boolean }>> = {};
  (data || []).forEach((row: any) => {
    const key = row.narrative_date;
    if (!map[key]) map[key] = {};
    if (!map[key][row.reaction_type]) map[key][row.reaction_type] = { count: 0, reacted: false };
    map[key][row.reaction_type].count += 1;
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
    .select('id,body,created_at,commenter_user_id,profiles!daily_verse_comments_commenter_user_id_fkey(display_name,avatar_url)')
    .eq('narrative_date', narrativeDate)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    body: row.body,
    created_at: row.created_at,
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

export async function createMobileMoneyPayment(
  userId: string,
  relicSlug: string,
  relicName: string,
  amountUsd: number,
  amountLocal: number,
  currencyCode: string,
  provider: string,
  senderPhone: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('mobile_money_payments')
    .insert({
      user_id: userId,
      relic_slug: relicSlug,
      relic_name: relicName,
      amount_usd: amountUsd,
      amount_local: amountLocal,
      currency_code: currencyCode,
      provider,
      sender_phone: senderPhone,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
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
    .select('*, profiles!mobile_money_payments_user_id_fkey(display_name, email)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as any;
}

export async function fetchInstructorMobileMoneyPayments(limit = 100): Promise<(MobileMoneyPayment & { profiles: { display_name: string; email: string } | null })[]> {
  const { data, error } = await supabase
    .from('mobile_money_payments')
    .select('*, profiles!mobile_money_payments_user_id_fkey(display_name, email)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as any;
}

export async function confirmMobileMoneyPayment(paymentId: string) {
  const { error } = await supabase.rpc('confirm_mobile_money_payment', { p_payment_id: paymentId });
  if (error) throw error;
}

export async function rejectMobileMoneyPayment(paymentId: string, reason?: string) {
  const { error } = await supabase.rpc('reject_mobile_money_payment', { p_payment_id: paymentId, p_reason: reason || null });
  if (error) throw error;
}

export type CampayPaymentResult = {
  status: string;
  reference: string;
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
    body: JSON.stringify({
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
    }),
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

export async function markTentMessageRead(messageId: string) {
  const { error } = await supabase
    .from('tent_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId);
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

export async function sendDirectMessage(senderId: string, recipientId: string, body: string) {
  const { error } = await supabase
    .from('direct_messages')
    .insert({ sender_id: senderId, recipient_id: recipientId, body });
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
  const ext = file.name.split('.').pop() || 'jpg';
  const version = Date.now();
  const path = `${userId}/avatar-${version}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const publicUrl = `${data.publicUrl}?v=${version}`;
  await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
  return publicUrl;
}

export async function uploadTentProfileImage(userId: string, tentId: string, file: File) {
  const ext = file.name.split('.').pop() || 'jpg';
  const version = Date.now();
  const path = `${userId}/tents/${tentId}/profile-${version}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
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

export async function finishArenaGame(roomId: string, userId: string, score: number, correctCount: number) {
  const { error } = await supabase.rpc('finish_arena_game', {
    p_room_id: roomId, p_user_id: userId, p_score: score, p_correct_count: correctCount,
  });
  if (error) throw error;
}

export async function generateArenaQuestionsWithAI(payload: {
  roomId: string;
  roomName: string;
  topicType?: string | null;
  topic?: string | null;
  narrative?: DailyNarrative | null;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !supabaseAnonKey) throw new Error('AI arena generation is not configured.');

  const res = await fetch(`${supabaseUrl}/functions/v1/generate-arena-questions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  if (!Array.isArray(data.questions)) throw new Error('AI arena generation returned no questions.');
  return data.questions as QuestionPayload[];
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
      .select('id,display_name,avatar_url,email')
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

export async function fetchStrictStreak(userId: string) {
  try {
    const { data, error } = await supabase.rpc('compute_strict_streak', { p_user_id: userId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      current_streak: Number(row?.current_streak) || 0,
      longest_streak: Number(row?.longest_streak) || 0,
      consecutive_inactive: Number(row?.consecutive_inactive) || 0,
      cumulative_inactive: Number(row?.cumulative_inactive) || 0,
    };
  } catch {
    return {
      current_streak: 0,
      longest_streak: 0,
      consecutive_inactive: 0,
      cumulative_inactive: 0,
    };
  }
}

export async function fetchQuizScoreboard() {
  const { data, error } = await supabase.rpc('get_quiz_scoreboard');
  if (error) throw error;
  return (data || []) as QuizScoreboardRow[];
}
