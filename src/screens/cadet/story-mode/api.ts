import { supabase } from '../../../lib/supabase';
import { isStoryTimerSeconds, storyQuestionOptions } from './content';
import type {
  StoryAnswerResult,
  StoryAttempt,
  StoryBuildComponentKey,
  StoryBuildState,
  StoryDeadline,
  StoryProgress,
  StoryQuestionPayload,
} from './types';

function rpcRow(data: unknown) {
  return Array.isArray(data) ? data[0] : data;
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} was unavailable.`);
  return value as Record<string, unknown>;
}

function parseQuestion(value: unknown): StoryQuestionPayload | null {
  if (value === null || value === undefined) return null;
  const row = requiredObject(value, 'Story question');
  const timerSeconds = Number(row.timer_seconds);
  if (!isStoryTimerSeconds(timerSeconds)) throw new Error('Story question timer is invalid.');
  const type = row.type === 'true_false' ? 'true_false' : 'multiple_choice';
  const options = Array.isArray(row.options) ? row.options.map(String) : [];
  return {
    id: String(row.id || ''),
    levelSlug: String(row.level_slug || ''),
    checkpointId: String(row.checkpoint_id || ''),
    poolId: String(row.pool_id || ''),
    sceneId: String(row.scene_id || ''),
    type,
    prompt: String(row.prompt || ''),
    options: storyQuestionOptions(type, options),
    timerSeconds,
    difficulty: row.difficulty === 'hard' ? 'hard' : row.difficulty === 'easy' ? 'easy' : 'moderate',
    scriptureReference: String(row.scripture_reference || ''),
    isReadFollowUp: Boolean(row.is_read_follow_up),
  };
}

function parseCheckpointState(value: unknown): StoryAttempt['checkpointState'] {
  if (value === 'question_approach' || value === 'canonical_event' || value === 'level_complete' || value === 'chapter_complete') return value;
  return 'intro';
}

const BUILD_COMPONENTS = new Set<StoryBuildComponentKey>([
  'foundation', 'frame', 'hull', 'opening', 'decks', 'household', 'animals', 'provisions', 'complete',
]);

function parseBuildState(value: unknown): StoryBuildState | null {
  if (value === null || value === undefined) return null;
  const row = requiredObject(value, 'Story construction state');
  const completedComponents = Array.isArray(row.completed_components)
    ? row.completed_components.map(String).filter((item): item is StoryBuildComponentKey => BUILD_COMPONENTS.has(item as StoryBuildComponentKey))
    : [];
  return {
    constructionId: String(row.construction_id || ''),
    label: String(row.label || 'Construction'),
    stageOrder: Math.max(0, Number(row.stage_order) || 0),
    stageSlug: String(row.stage_slug || 'site'),
    totalStages: Math.max(0, Number(row.total_stages) || 0),
    completed: Boolean(row.completed),
    completedComponents,
    checkpointId: String(row.checkpoint_id || ''),
  };
}

export async function fetchStoryModeProgress(): Promise<StoryProgress> {
  const { data, error } = await supabase.rpc('get_my_story_mode_progress');
  if (error) throw error;
  const row = requiredObject(rpcRow(data), 'Story progress');
  const levels = Array.isArray(row.levels) ? row.levels : [];
  const chapters = Array.isArray(row.chapters) ? row.chapters : [];
  return {
    currentBookSlug: String(row.current_book_slug || ''),
    currentChapterSlug: String(row.current_chapter_slug || ''),
    currentLevelSlug: String(row.current_level_slug || ''),
    checkpointId: String(row.checkpoint_id || ''),
    completedLevelCount: Number(row.completed_level_count) || 0,
    totalLevelCount: Number(row.total_level_count) || 1,
    activeAttemptId: row.active_attempt_id ? String(row.active_attempt_id) : null,
    chapterCompleted: Boolean(row.chapter_completed),
    chapterFigsEarned: Number(row.chapter_figs_earned) || 0,
    chapterDenariiEarned: Number(row.chapter_denarii_earned) || 0,
    chapters: chapters.map((item) => {
      const chapter = requiredObject(item, 'Story chapter progress');
      return {
        bookSlug: String(chapter.book_slug || ''),
        chapterSlug: String(chapter.chapter_slug || ''),
        completed: Boolean(chapter.completed),
        timesCompleted: Number(chapter.times_completed) || 0,
        firstCompletedAt: chapter.first_completed_at ? String(chapter.first_completed_at) : null,
        figsEarned: Number(chapter.figs_earned) || 0,
        denariiEarned: Number(chapter.denarii_earned) || 0,
      };
    }),
    levels: levels.map((item) => {
      const level = requiredObject(item, 'Story level progress');
      return {
        levelSlug: String(level.level_slug || ''),
        completed: Boolean(level.completed),
        unlocked: Boolean(level.unlocked),
        timesCompleted: Number(level.times_completed) || 0,
        firstCompletedAt: level.first_completed_at ? String(level.first_completed_at) : null,
        figsEarned: Number(level.figs_earned) || 0,
        denariiEarned: Number(level.denarii_earned) || 0,
      };
    }),
  };
}

export async function startStoryModeLevel(levelSlug: string): Promise<StoryAttempt> {
  const { data, error } = await supabase.rpc('start_story_mode_level', { p_level_slug: levelSlug });
  if (error) throw error;
  const row = requiredObject(rpcRow(data), 'Story attempt');
  return {
    attemptId: String(row.attempt_id || ''),
    levelSlug: String(row.level_slug || ''),
    checkpointId: String(row.checkpoint_id || ''),
    checkpointState: parseCheckpointState(row.checkpoint_state),
    isReplay: Boolean(row.is_replay),
    restored: Boolean(row.restored),
    paused: Boolean(row.paused),
    questionStartedAt: row.question_started_at ? String(row.question_started_at) : null,
    questionDeadline: row.question_deadline ? String(row.question_deadline) : null,
    serverNow: String(row.server_now || new Date().toISOString()),
    question: parseQuestion(row.question),
    pendingEventId: row.pending_event_id ? String(row.pending_event_id) : null,
    buildState: parseBuildState(row.build_state),
  };
}

export async function saveStoryCheckpoint(attemptId: string, checkpointId: string) {
  const { error } = await supabase.rpc('save_story_mode_checkpoint', {
    p_attempt_id: attemptId,
    p_checkpoint_id: checkpointId,
  });
  if (error) throw error;
}

function parseDeadline(data: unknown): StoryDeadline {
  const row = requiredObject(rpcRow(data), 'Story timer');
  return {
    deadline: row.deadline ? String(row.deadline) : null,
    serverNow: String(row.server_now || new Date().toISOString()),
    paused: Boolean(row.paused),
  };
}

export async function activateStoryQuestion(attemptId: string, questionId: string) {
  const { data, error } = await supabase.rpc('activate_story_mode_question', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
  });
  if (error) throw error;
  return parseDeadline(data);
}

export async function pauseStoryAttempt(attemptId: string) {
  const { data, error } = await supabase.rpc('pause_story_mode_attempt', { p_attempt_id: attemptId });
  if (error) throw error;
  return parseDeadline(data);
}

export async function resumeStoryAttempt(attemptId: string) {
  const { data, error } = await supabase.rpc('resume_story_mode_attempt', { p_attempt_id: attemptId });
  if (error) throw error;
  return parseDeadline(data);
}

export async function submitStoryAnswer(input: {
  attemptId: string;
  questionId: string;
  selectedAnswer: string | null;
  timedOut: boolean;
  submissionId: string;
}): Promise<StoryAnswerResult> {
  const { data, error } = await supabase.rpc('submit_story_mode_answer', {
    p_attempt_id: input.attemptId,
    p_question_id: input.questionId,
    p_selected_answer: input.selectedAnswer,
    p_timed_out: input.timedOut,
    p_submission_id: input.submissionId,
  });
  if (error) throw error;
  return parseStoryResult(data, 'Story answer');
}

function parseStoryResult(data: unknown, label: string): StoryAnswerResult {
  const row = requiredObject(rpcRow(data), label);
  return {
    correct: Boolean(row.correct),
    timedOut: Boolean(row.timed_out),
    figsEarned: Number(row.figs_earned) || 0,
    denariiEarned: Number(row.denarii_earned) || 0,
    totalFigs: Number(row.total_figs) || 0,
    correctCount: Number(row.correct_count) || 0,
    questionCount: Number(row.question_count) || 0,
    completionPercentage: Number(row.completion_percentage) || 0,
    levelComplete: Boolean(row.level_complete),
    chapterComplete: Boolean(row.chapter_complete),
    canonicalEventPending: Boolean(row.canonical_event_pending),
    canonicalEventId: row.canonical_event_id ? String(row.canonical_event_id) : null,
    checkpointId: String(row.checkpoint_id || ''),
    actionId: String(row.action_id || ''),
    explanation: String(row.explanation || ''),
    replay: Boolean(row.replay),
    nextQuestion: parseQuestion(row.next_question),
    levelsCompleted: Number(row.levels_completed) || 0,
    buildState: parseBuildState(row.build_state),
  };
}

export async function settleStoryCanonicalEvent(input: {
  attemptId: string;
  eventId: string;
  submissionId: string;
}): Promise<StoryAnswerResult> {
  const { data, error } = await supabase.rpc('settle_story_mode_canonical_event', {
    p_attempt_id: input.attemptId,
    p_event_id: input.eventId,
    p_submission_id: input.submissionId,
  });
  if (error) throw error;
  return parseStoryResult(data, 'Story canonical event');
}

export async function reachStoryCanonicalEvent(attemptId: string, eventId: string) {
  const { data, error } = await supabase.rpc('reach_story_mode_canonical_event', {
    p_attempt_id: attemptId,
    p_event_id: eventId,
  });
  if (error) throw error;
  const row = requiredObject(rpcRow(data), 'Story canonical checkpoint');
  return {
    checkpointId: String(row.checkpoint_id || ''),
    eventId: String(row.event_id || ''),
  };
}
