export type Role = 'cadet' | 'sentry' | 'instructor';
export type RoleStatus = 'pending' | 'approved' | 'active' | 'removed' | 'promoted';
export type DayType = 'weekday' | 'saturday' | 'sunday';
export type AttendanceStatus = 'present' | 'absent' | 'unmarked';
export type RemovalState = 'active' | 'at_risk' | 'flagged' | 'removed';

export type QuizSessionStatus = 'scheduled' | 'countdown' | 'live' | 'closed';
export type QuizAttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'forfeited' | 'timed_out';
export type GameMode = 'normal' | 'blitz' | 'practice';
export type GameStatus = 'in_progress' | 'passed' | 'failed';

export type LedgerSourceType = 'game_level' | 'game_blitz' | 'quiz_reward' | 'fortune_quiz_reward' | 'relic_purchase' | 'relic_reward' | 'admin_adjustment' | 'hint_purchase' | 'answer_reveal' | 'freezer_daily' | 'freezer_weekly' | 'attendance' | 'arena_stake' | 'arena_fee' | 'arena_reward' | 'mobile_money' | 'campay_payment' | 'notification_opt_in' | 'challenge_submission' | 'dove_question_cost' | 'dove_question_reward';

export type ChallengeProofFormat = 'text' | 'png' | 'pdf' | 'link' | 'image';
export type ChallengeSubmissionStatus = 'pending' | 'approved' | 'rejected';
export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'grace';
export type FreezerType = 'daily' | 'weekly';
export type DoveQuestionType = 'multiple_choice' | 'true_false' | 'fill_blank' | 'standard_text';
export type DoveQuestionDeliveryMode = 'optional' | 'required';
export type DoveQuestionStatus = 'active' | 'closed';

export interface DoveQuestion {
  id: string;
  instructor_id: string;
  question_text: string;
  question_type: DoveQuestionType;
  options: string[];
  correct_answer: string;
  accepted_answers: string[];
  explanation: string | null;
  entry_cost_denarii: number;
  reward_denarii: number;
  delivery_mode: DoveQuestionDeliveryMode;
  sound_url: string | null;
  status: DoveQuestionStatus;
  published_at: string;
  expires_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingDoveQuestion {
  id: string;
  question_text: string;
  question_type: DoveQuestionType;
  options: string[];
  entry_cost_denarii: number;
  reward_denarii: number;
  delivery_mode: DoveQuestionDeliveryMode;
  sound_url: string | null;
  published_at: string;
  expires_at: string | null;
  participant_count: number;
  wallet_denarii: number;
}

export interface DoveQuestionParticipant {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  answered_at: string;
}

export interface DoveQuestionAnswerResult {
  question_id: string;
  submitted_answer: string;
  is_correct: boolean;
  correct_answer: string;
  explanation: string | null;
  cost_paid: number;
  cost_waived: boolean;
  reward_paid: number;
  wallet_denarii: number;
  already_answered: boolean;
}

export interface PublishDoveQuestionInput {
  questionText: string;
  questionType: DoveQuestionType;
  options: string[];
  correctAnswer: string;
  acceptedAnswers: string[];
  explanation?: string | null;
  entryCostDenarii: number;
  rewardDenarii: number;
  deliveryMode: DoveQuestionDeliveryMode;
  soundUrl?: string | null;
  expiresAt?: string | null;
}

export interface Profile {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  whatsapp_number: string | null;
  country_code?: string | null;
  language_code?: string | null;
  timezone?: string | null;
  birth_month?: number | null;
  birth_day?: number | null;
  onboarding_completed?: boolean;
  created_at: string;
}

export interface RoleAssignment {
  id: string;
  user_id: string;
  role: Role;
  status: RoleStatus;
  start_date: string | null;
  end_date?: string | null;
  approver_id: string | null;
  created_at: string;
}

export interface TentHouse {
  id: string;
  name: string;
  symbol_icon: string;
  symbol_motif: string;
  color: string;
  motto: string;
}

export interface Tent {
  id: string;
  name: string;
  tent_house_id: string;
  sentry_id: string | null;
  cycle_label: string;
  profile_image_url: string | null;
  created_at: string;
  tent_houses?: TentHouse;
}

export interface TentMember {
  id: string;
  tent_id: string;
  user_id: string;
  role: 'cadet' | 'sentry';
  joined_at: string;
  profiles?: Profile;
  tents?: Tent;
}

export interface TentMessage {
  id: string;
  tent_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  edited_at?: string | null;
}

export interface TentGroupMessage {
  id: string;
  tent_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at?: string | null;
  sender?: {
    display_name: string;
    avatar_url: string | null;
  } | null;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  edited_at?: string | null;
}

export interface DailyRecord {
  id: string;
  user_id: string;
  record_date: string;
  day_type: DayType;
  attendance_status: AttendanceStatus;
  attendance_marked_at: string | null;
  attendance_marked_by: string | null;
  attendance_late: boolean | null;
  meditation_submitted: boolean;
  meditation_submitted_at: string | null;
  meditation_text: string | null;
  best_verse: string | null;
  daily_quote: string | null;
  quiz_attempt_id: string | null;
  streak_valid: boolean | null;
  sunday_reading_opened_at?: string | null;
  created_at: string;
}

export interface GameSeedData {
  key_verse?: { reference: string; text: string };
  characters?: string[];
  objects?: string[];
  actions?: string[];
  plot_points?: string[];
  map_or_tree_reference?: string;
  error_paragraph_source?: string;
  cross_reference_anchors?: string[];
  milestone_verse?: { reference: string; text: string };
  // Content packet fields (game design doc) — genre-neutral
  ordered_units?: string[];
  key_terms?: string[];
  term_facts?: { term: string; fact: string }[];
  true_false_bank?: { statement: string; is_true: boolean }[];
  comprehension_questions?: { question: string; answer: string; options: string[]; explanation?: string; reference?: string }[];
  cause_effect_pairs?: { cause: string; effect: string }[];
  memory_clues?: { prompt: string; answer: string }[];
  application_prompts?: string[];
  distractor_pool?: string[];
  category_schema?: { buckets: string[]; items: { text: string; bucket: string }[] };
  passage?: string;
}

export interface DailyNarrative {
  id: string;
  narrative_date: string;
  title: string;
  theme: string;
  scripture_reference: string;
  translation: string;
  main_text: string;
  highlighted_verses: Array<{
    reference: string;
    text: string;
    meditation: string;
    source_narrative_id?: string;
    source_narrative_date?: string;
  }>;
  /** Additional passages published with the main daily reading. */
  scripture_passages?: Array<{
    reference: string;
    translation?: string;
    main_text: string;
    highlighted_verses: Array<{
      reference: string;
      text: string;
      meditation: string;
      source_narrative_id?: string;
      source_narrative_date?: string;
    }>;
    source_narrative_id?: string;
    source_narrative_date?: string;
  }>;
  reflection_prompts: string[];
  challenge_title: string | null;
  challenge_instructions: string | null;
  challenge_proof_type: string;
  challenge_proof_format: ChallengeProofFormat;
  challenge_active: boolean;
  game_seed_data: GameSeedData;
  // VOD / MOD / QOD — broken-down Insight of the Day
  verse_of_day: string | null;
  meditation_of_day: string | null;
  quote_of_day: string | null;
  created_at: string;
}

export interface QuizSession {
  id: string;
  session_date: string;
  title: string;
  scheduled_start_time: string;
  countdown_opens_at: string;
  live_opens_at: string;
  live_closes_at: string;
  status: QuizSessionStatus;
  quiz_type: 'saturday' | 'fortune';
  reward_perfect: number;
  reward_partial: number;
  relaunch_of_id?: string | null;
  relaunch_ready?: boolean;
}

export interface GeneratedQuestion {
  id: string;
  quiz_session_id: string;
  question_index: number;
  source_narrative_date: string | null;
  difficulty_tag: 'easy' | 'moderate' | 'hard';
  mechanic_type: string;
  recycled_from_game: boolean;
  question_payload: QuestionPayload;
}

export interface QuestionPayload {
  id?: string;
  type: 'multiple_choice' | 'true_false' | 'fill_blank' | 'order_sequence' | 'spot_error' | 'scriptorium' | 'standard_text'
    | 'matching' | 'elimination' | 'spot_it' | 'category_sort' | 'cloze' | 'comprehension';
  question: string;
  options?: string[];
  correct_answer: string | number;
  accepted_answers?: Array<string | number>;
  explanation?: string;
  reference?: string;
  blanked_text?: string;
  blanks?: string[];
  items?: string[];
  passage?: string;
  passage_display_seconds?: number;
  game_round?: number | null;
  round_timer_seconds?: number | null;
  difficulty_tag?: 'easy' | 'moderate' | 'hard';
  is_bonus?: boolean | null;
  // Matching game
  pairs?: { left: string; right: string }[];
  // Category sort
  buckets?: string[];
  sort_items?: { text: string; bucket: string }[];
  // Spot-it / elimination grid
  grid_items?: { text: string; belongs: boolean }[];
  // Stage info
  stage?: number;
  engine?: string;
}

export interface QuizAttempt {
  id: string;
  user_id: string;
  quiz_session_id: string;
  status: QuizAttemptStatus;
  talents_scored: number;
  highest_question_reached: number;
  relics_used: any[];
  forfeited_at: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface QuizResponder {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  answered_at: string;
}

export interface MonthlyVallumWatchRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  marks: number;
  punctual_actions: number;
  insights_written: number;
  comments_written: number;
  reactions_given: number;
  monthly_figs: number;
  monthly_rhudes: number;
  activity_points: number;
  rank: number;
}

export interface WeeklyQuizReleasedResult {
  released: boolean;
  release_at: string;
  released_at?: string | null;
  correct_count?: number;
  question_count?: number;
  figs_earned?: number;
  perfect?: boolean;
  denarii_awarded?: number;
}

export interface QuestionResponse {
  id: string;
  quiz_attempt_id: string;
  question_id: string;
  answer: any;
  submitted_at: string;
  last_edited_at: string;
}

export interface TentMessage {
  id: string;
  tent_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface DenariiLedgerEntry {
  id: string;
  user_id: string;
  amount: number;
  source_type: LedgerSourceType;
  source_reference: string | null;
  description: string | null;
  created_at: string;
}

export interface GameAttempt {
  id: string;
  user_id: string;
  narrative_date: string;
  level: number;
  mode: GameMode;
  score: number;
  max_score: number;
  reward: number;
  status: GameStatus;
  completed_at: string | null;
  created_at: string;
  hint_used?: boolean;
  answer_revealed?: boolean;
}

export interface RelicType {
  id: string;
  slug: string | null;
  name: string;
  description: string;
  effect: string;
  effect_type: string | null;
  rarity: string;
  denarii_cost: number | null;
  money_price_usd: number | null;
  money_price_xaf: number | null;
  effect_scope: string;
  icon: string;
}

export interface RelicInventory {
  id: string;
  user_id: string;
  relic_type_id: string;
  quantity: number;
  source_description: string | null;
  relic_types?: RelicType;
}

export interface StreakboardSnapshot {
  id: string;
  snapshot_date: string;
  user_id: string;
  tent_id: string | null;
  tent_house_id: string | null;
  volume: number;
  consistency: number;
  improvement: number;
  current_streak: number;
  longest_streak: number;
  consecutive_inactive?: number;
  cumulative_inactive?: number;
  role?: Role;
  rank: number;
}

export interface LeaderboardWeeklySnapshot {
  id: string;
  week_ending: string;
  user_id: string;
  tent_id: string | null;
  tent_house_id: string | null;
  total_denarii: number;
  rank: number;
}

export interface Award {
  id: string;
  award_month: string;
  user_id: string;
  award_type: string;
  title: string;
  description: string | null;
  metric_value: number | null;
  award_target_type: string | null;
  award_target_id: string | null;
  created_at: string;
}

export type AwardWithRecipient = Award & {
  profiles: { display_name: string; avatar_url: string | null } | null;
  target_tent?: {
    id: string;
    name: string;
    tent_house_id: string | null;
    profile_image_url: string | null;
    sentry_id: string | null;
    sentry: { id: string; display_name: string; avatar_url: string | null } | null;
  } | null;
  recipient_tent?: {
    id: string;
    name: string;
    tent_house_id: string | null;
  } | null;
};

export interface ScheduledAnnouncement {
  id: string;
  announcement_type: string;
  publish_at: string;
  audience: string;
  content: string;
  is_active: boolean;
  expires_at?: string | null;
  reminder_date?: string | null;
  metadata?: Record<string, any> | null;
  image_position_x?: number;
  image_position_y?: number;
  audio_start_seconds?: number;
  audio_end_seconds?: number | null;
}

export interface PanelImageSetting {
  url: string;
  positionX: number;
  positionY: number;
  adjustments?: PanelImageAdjustments;
}

export interface FcxRegistration {
  id: string;
  event_id: string;
  user_id: string | null;
  guest_name: string | null;
  payment_source: 'app' | 'external';
  created_at: string;
  display_name: string;
  avatar_url: string | null;
  is_app_member: boolean;
}

export interface FcxExperience {
  id: string;
  title: string;
  event_month: string;
  event_date: string | null;
  capacity: number;
  ticket_price_xaf: number | null;
  is_active: boolean;
  registrations: FcxRegistration[];
}

export interface PanelImageAdjustments {
  brightness: number;
  contrast: number;
  blackPoint: number;
  whitePoint: number;
  black: number;
  saturation: number;
  vibrance: number;
  hue: number;
  temperature: number;
  blur: number;
  sharpness: number;
  definition: number;
  noise: number;
  roughness: number;
  depth: number;
  vignette: number;
  grain: number;
  age: number;
  opacity: number;
}

export interface UserNotification {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  notification_type: string;
  title: string;
  body: string;
  action_key: string | null;
  metadata: Record<string, any>;
  read_at: string | null;
  created_at: string;
}

export interface ChallengeSubmission {
  id: string;
  user_id: string;
  narrative_date: string;
  proof_text: string | null;
  proof_type: string;
  status: ChallengeSubmissionStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  submitted_at: string;
}

export interface StreakFreezer {
  id: string;
  user_id: string;
  freezer_type: FreezerType;
  source: 'denarii' | 'payment' | 'relic' | 'redemption' | 'simons_purse' | 'thiefs_request' | 'game_reward' | 'arena_reward';
  purchased_at: string;
  used_at: string | null;
  applied_to_date: string | null;
  expires_at?: string | null;
  activated_at?: string | null;
  protection_ends_at?: string | null;
  protected_through_date?: string | null;
}

export interface StreakProtectionState {
  active: boolean;
  protection_kind: 'freezer' | 'simons_purse' | null;
  freezer_type: FreezerType | null;
  activated_at: string | null;
  protection_ends_at: string | null;
  applied_to_date: string | null;
}

export interface Subscription {
  id: string;
  user_id: string;
  status: SubscriptionStatus;
  trial_started_at: string;
  trial_ends_at: string;
  current_period_end: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface CustomQuestion {
  id: string;
  instructor_id: string;
  quiz_session_id: string | null;
  question_text: string;
  question_type: string;
  options: string[] | null;
  correct_answer: string;
  accepted_answers?: string[] | null;
  explanation: string | null;
  scripture_reference?: string | null;
  passage: string | null;
  difficulty_tag: string;
  question_index: number;
  created_at: string;
  game_level?: number | null;
  narrative_date?: string | null;
  narrative_title?: string | null;
  narrative_theme?: string | null;
  game_round?: number | null;
  round_timer_seconds?: number | null;
  passage_display_seconds?: number | null;
  is_bonus?: boolean | null;
  use_for_quiz?: boolean | null;
  generated_from_packet?: boolean | null;
  packet_section?: string | null;
  is_approved?: boolean | null;
}

export interface DailyQuoteFeedItem {
  record_date: string;
  daily_quote: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  current_streak?: number;
  total_figs?: number;
  rhudes?: number;
  role?: string | null;
  tent_house_id?: string | null;
  tent_name?: string | null;
}

export interface DailyQuoteComment {
  id: string;
  body: string;
  created_at: string;
  commenter_user_id: string;
  parent_comment_id?: string | null;
  mentioned_user_ids?: string[] | null;
  display_name: string;
  avatar_url: string | null;
  rank_label: string;
  edited_at?: string | null;
}

export interface CurrencyInfo {
  currency_code: string;
  symbol: string;
  rate_to_usd: number;
}

export interface MobileMoneyPayment {
  id: string;
  user_id: string;
  relic_slug: string;
  relic_name: string;
  purchase_kind?: 'relic' | 'subscription';
  purchase_metadata?: Record<string, unknown>;
  amount_usd: number;
  amount_local: number;
  currency_code: string;
  provider: string;
  sender_phone: string;
  status: 'pending' | 'confirmed' | 'rejected';
  reference: string | null;
  payment_method: string | null;
  payment_details: string | null;
  provider_reference: string | null;
  external_reference: string | null;
  operator: string | null;
  ussd_code: string | null;
  payout_status?: 'not_attempted' | 'pending' | 'successful' | 'failed' | null;
  payout_reference?: string | null;
  payout_amount_xaf?: number | null;
  payout_error?: string | null;
  payout_attempted_at?: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface MobileMoneySettings {
  id: number;
  provider_name: string;
  phone_number: string;
  account_name: string;
  instructions: string | null;
  payout_enabled?: boolean;
  payout_provider_name?: string | null;
  payout_phone_number?: string | null;
  payout_account_name?: string | null;
  payout_max_amount_xaf?: number | null;
  updated_at?: string;
}

export interface DenariiPurchase {
  id: string;
  user_id: string;
  purchase_type: 'hint' | 'answer_reveal' | 'freezer_daily';
  amount: number;
  reference_id: string | null;
  created_at: string;
}

export interface StreakInfo {
  current_streak: number;
  longest_streak: number;
  consecutive_inactive: number;
  cumulative_inactive: number;
  removal_state: RemovalState;
  volume_this_month: number;
}

export interface CadetWithTent extends Profile {
  tent_id?: string;
  tent_name?: string;
  tent_house_id?: string;
  role_status?: RoleStatus;
}

export interface TentHouseLeaderboardRow {
  tent_house_id: string;
  tent_house_name: string;
  total_denarii: number;
  total_streak: number;
  combined_score: number;
  cadet_count: number;
  sentry_names: string[] | null;
  rank: number;
}

export interface QuizScoreboardRow {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  role?: Role;
  tent_house_id: string | null;
  daily_game_score: number;
  arena_figs?: number;
  random_quiz_score: number;
  saturday_quiz_score: number;
  total_score: number;
  rank: number;
}

export interface RhudeBoardRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: Role;
  tent_id: string | null;
  tent_name: string | null;
  tent_house_id: string | null;
  rhudes: number;
  latest_victory_at: string | null;
  rank: number;
}

export interface MarksBoardRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: Role;
  tent_id: string | null;
  tent_name: string | null;
  tent_house_id: string | null;
  total_denarii: number;
  qualifying_denarii?: number;
  talents?: number;
  total_figs: number;
  current_streak: number;
  rhudes: number;
  marks: number;
  rank: number;
}

export interface FullCircleEconomyRules {
  streaks_per_mark: number;
  denarii_per_talent: number;
  talents_per_mark: number;
  rhudes_per_mark: number;
  figs_per_mark: number;
}
