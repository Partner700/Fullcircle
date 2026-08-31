import { supabase } from '../../../lib/supabase';
import { isStoryTimerSeconds, storyQuestionOptions } from './content';
import type { StoryAnswerResult, StoryAttempt, StoryDeadline, StoryProgress, StoryQuestionPayload } from './types';

function rpcRow(data: unknown) {
  return Array.isArray(data) ? data[0] : data;
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} was unavailable.`);
  return value as Record<string, unknown>;
}

function parseQuestion(value: unknown): StoryQuestionPayload {
  const row = requiredObject(value, 'Story question');
  const timerSeconds = Number(row.timer_seconds);
  if (!isStoryTimerSeconds(timerSeconds)) throw new Error('Story question timer is invalid.');
  const type = row.type === 'true_false' ? 'true_false' : 'multiple_choice';
  const options = Array.isArray(row.options) ? row.options.map(String) : [];
  return {
    id: String(row.id || ''),
    levelSlug: String(row.level_slug || ''),
    type,
    prompt: String(row.prompt || ''),
    options: storyQuestionOptions(type, options),
    timerSeconds,
    difficulty: row.difficulty === 'hard' ? 'hard' : row.difficulty === 'easy' ? 'easy' : 'moderate',
    scriptureReference: String(row.scripture_reference || ''),
  };
}

function parseCheckpointState(value: unknown): StoryAttempt['checkpointState'] {
  if (value === 'question_approach' || value === 'level_complete') return value;
  return 'intro';
}

export async function fetchStoryModeProgress(): Promise<StoryProgress> {
  const { data, error } = await supabase.rpc('get_my_story_mode_progress');
  if (error) throw error;
  const row = requiredObject(rpcRow(data), 'Story progress');
  const levels = Array.isArray(row.levels) ? row.levels : [];
  return {
    currentBookSlug: String(row.current_book_slug || ''),
    currentChapterSlug: String(row.current_chapter_slug || ''),
    currentLevelSlug: String(row.current_level_slug || ''),
    checkpointId: String(row.checkpoint_id || ''),
    completedLevelCount: Number(row.completed_level_count) || 0,
    totalLevelCount: Number(row.total_level_count) || 1,
    activeAttemptId: row.active_attempt_id ? String(row.active_attempt_id) : null,
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
  const row = requiredObject(rpcRow(data), 'Story answer');
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
    checkpointId: String(row.checkpoint_id || ''),
    actionId: String(row.action_id || ''),
    explanation: String(row.explanation || ''),
    replay: Boolean(row.replay),
  };
}
