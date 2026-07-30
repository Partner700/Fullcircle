import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { EmptyState } from '../../components/AppShell';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { Dove } from '../../components/Dove';
import { fetchNarrative, fetchGameAttempts, insertGameAttempt, insertLedgerEntry, fetchLedgerTotal, useRelic, fetchPanelImageSetting } from '../../lib/queries';
import { HINT_COST, ANSWER_REVEAL_COST, RELIC_SLUGS } from '../../lib/constants';
import { generateLevelQuestionsWithCustom, getLevelTimer, getLevelGameType, GAME_TYPE_LABELS, resetUsedQuestions } from '../../lib/gameEngines';
import { isGamePausedNow, getTodayISODate, cn, formatDenarii } from '../../lib/utils';
import { playRoundWarningBeep, playSoundEffect } from '../../lib/soundscape';
import { DAILY_GAME_LEVELS, DAILY_GAME_CAP, GAME_PASS_THRESHOLD, GAME_QUESTIONS_PER_ROUND } from '../../lib/constants';
import type { DailyNarrative, GameAttempt, GameSeedData, QuestionPayload, PanelImageSetting } from '../../lib/types';
import {
  Gamepad2, Lock, CheckCircle2, XCircle, Trophy, Coins, RotateCcw,
  Pause, Loader2, Star, Clock, ChevronRight, Lightbulb, Eye, Sparkles, Swords, TimerOff,
  SkipForward, BookOpen, Volume2, Wand2,
} from 'lucide-react';

const PASS_THRESHOLD = GAME_PASS_THRESHOLD; // 0.6 = 60%
const DEFAULT_PASSAGE_DISPLAY_SECONDS = 30;

function calcGameReward(level: number, score: number, maxScore: number): number {
  if (maxScore === 0) return 0;
  const ratio = score / maxScore;
  if (ratio < PASS_THRESHOLD) return 0;
  const levelMax = level <= 3 ? 50 : level <= 6 ? 100 : 200;
  return Math.round(levelMax * ratio);
}

function levelMaxReward(level: number): number {
  return level <= 3 ? 50 : level <= 6 ? 100 : 200;
}

function getQuestionRound(question: QuestionPayload | undefined, index: number): number {
  return Number(question?.game_round) || Math.floor(index / GAME_QUESTIONS_PER_ROUND) + 1;
}

function getRoundTimer(questions: QuestionPayload[], level: number, index: number): number {
  const round = getQuestionRound(questions[index], index);
  const timedQuestion = questions.find((question, questionIndex) =>
    getQuestionRound(question, questionIndex) === round && Number(question.round_timer_seconds),
  );
  return Number(timedQuestion?.round_timer_seconds) || getLevelTimer(level);
}

function getRoundPassageQuestion(questions: QuestionPayload[], round: number): QuestionPayload | undefined {
  return questions.find((question, questionIndex) =>
    getQuestionRound(question, questionIndex) === round && !!question.passage?.trim(),
  );
}

function getPassageDisplaySeconds(question: QuestionPayload | undefined): number {
  const seconds = Number(question?.passage_display_seconds) || DEFAULT_PASSAGE_DISPLAY_SECONDS;
  return Math.min(Math.max(seconds, 5), 600);
}

interface GameOverResult {
  passed: boolean;
  score: number;
  maxScore: number;
  reward: number;
  level: number;
  mode: string;
  nextLevel: number | null;
}

type RoundTimeout = {
  round: number;
  correct: number;
  total: number;
  nextIndex: number | null;
};

export function CadetGame({ onRewardEarned }: { onRewardEarned: () => void }) {
  const { profile } = useAuth();
  const [narrative, setNarrative] = useState<DailyNarrative | null>(null);
  const [attempts, setAttempts] = useState<GameAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLevel, setActiveLevel] = useState<number | null>(null);
  const [gameOver, setGameOver] = useState<GameOverResult | null>(null);
  const [denariiBalance, setDenariiBalance] = useState(0);
  const [gameImage, setGameImage] = useState<PanelImageSetting | null>(null);

  const today = getTodayISODate();
  const paused = isGamePausedNow();

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const [narr, atts, balance, image] = await Promise.all([
      fetchNarrative(today),
      fetchGameAttempts(profile.id, today),
      fetchLedgerTotal(profile.id),
      fetchPanelImageSetting('game').catch(() => null),
    ]);
    setNarrative(narr);
    setAttempts(atts);
    setDenariiBalance(balance);
    setGameImage(image);
    setLoading(false);
  }, [profile, today]);

  useEffect(() => { load(); }, [load]);

  const hasEarnedFromLevel = (level: number) =>
    attempts.some((a) => a.level === level && a.reward > 0);

  const levelPassed = (level: number) =>
    attempts.some((a) => a.level === level && a.status === 'passed');

  const isUnlocked = (level: number) => {
    if (level === 1) return true;
    return levelPassed(level - 1);
  };

  const totalEarned = attempts.reduce((sum, a) => sum + a.reward, 0);
  const inPracticeMode = totalEarned >= DAILY_GAME_CAP;
  const remainingToCap = Math.max(0, DAILY_GAME_CAP - totalEarned);
  const passedCount = Array.from({ length: DAILY_GAME_LEVELS }, (_, i) => i + 1).filter(levelPassed).length;

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading game…</div>;

  if (paused) {
    return (
      <EmptyState
        icon={Pause}
        title="Games Paused"
        message="The Daily Game is paused from Saturday 5 PM to Monday 7 AM. Games resume Monday at 7 AM."
      />
    );
  }

  if (!narrative) {
    return <EmptyState icon={Gamepad2} title="No game today" message="Today's narrative hasn't been published yet." />;
  }

  if (activeLevel !== null) {
    const earned = hasEarnedFromLevel(activeLevel);
    const mode = inPracticeMode || earned ? 'practice' : 'normal';
    return (
      <GamePlay
        level={activeLevel}
        mode={mode}
        narrative={narrative}
        userId={profile!.id}
        remainingToCap={remainingToCap}
        denariiBalance={denariiBalance}
        hasEarnedFromLevel={earned}
        onExit={() => setActiveLevel(null)}
        onComplete={async (result) => {
          const nextLevel = result.passed && activeLevel < DAILY_GAME_LEVELS ? activeLevel + 1 : null;
          setActiveLevel(null);
          setGameOver({ ...result, level: activeLevel, mode, nextLevel });
          await load();
          onRewardEarned();
        }}
      />
    );
  }

  if (gameOver) {
    return (
      <GameOverScreen
        result={gameOver}
        onContinue={() => {
          if (gameOver.nextLevel) {
            setActiveLevel(gameOver.nextLevel);
            setGameOver(null);
          } else {
            setGameOver(null);
            load();
            onRewardEarned();
          }
        }}
        onBackToLevels={() => { setGameOver(null); load(); onRewardEarned(); }}
      />
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="card p-5 relative overflow-hidden animate-slide-up">
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">Daily Campaign</p>
            <h2 className="font-display text-xl font-semibold text-ink">
              {passedCount} of {DAILY_GAME_LEVELS} levels cleared
            </h2>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl font-semibold text-gold">{formatDenarii(totalEarned)} Ð</div>
            <div className="text-xs text-stone">of {formatDenarii(DAILY_GAME_CAP)} max</div>
          </div>
        </div>
        <div className="relative z-10 mt-3 h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500 bg-gold"
            style={{ width: `${Math.min((totalEarned / DAILY_GAME_CAP) * 100, 100)}%` }} />
        </div>
        {inPracticeMode && (
          <p className="relative z-10 text-xs text-sage mt-2 flex items-center gap-1">
            <Star size={12} /> Daily cap reached — further play is practice mode
          </p>
        )}
      </div>

      <div className="space-y-2">
        {Array.from({ length: DAILY_GAME_LEVELS }, (_, i) => {
          const level = i + 1;
          const unlocked = isUnlocked(level);
          const passed = levelPassed(level);
          const earned = hasEarnedFromLevel(level);
          const gameType = getLevelGameType(level);
          const gameLabel = GAME_TYPE_LABELS[gameType] || gameType;
          const timer = getLevelTimer(level);
          const maxReward = levelMaxReward(level);

          return (
            <div
              key={level}
              className={cn(
                'card p-4 flex items-center gap-4 transition-all relative overflow-hidden',
                !unlocked && 'opacity-50',
                unlocked && !passed && 'card-hover cursor-pointer',
                level === DAILY_GAME_LEVELS && passed && 'border-gold',
              )}
              onClick={() => { if (unlocked) { resetUsedQuestions(); setActiveLevel(level); } }}
            >
              {(unlocked || passed) && (
                <PanelImageBackdrop
                  image={gameImage}
                  opacityFallback={passed ? 24 : 18}
                  imageClassName={passed ? 'grayscale' : undefined}
                  veilClassName={passed ? 'bg-navy-2/74' : 'bg-navy-2/82'}
                />
              )}
              <div className={cn(
                'relative z-10 w-12 h-12 rounded-xl flex items-center justify-center font-display font-bold text-lg flex-shrink-0',
                passed ? 'bg-gold-soft text-gold' : unlocked ? 'bg-surface-2 text-ink' : 'bg-surface-2 text-stone',
              )}>
                {passed ? <CheckCircle2 size={20} /> : unlocked ? level : <Lock size={18} />}
              </div>
              <div className="relative z-10 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-ink">Level {level}</span>
                  <span className="badge badge-neutral text-[10px]">{gameLabel}</span>
                  {passed && <span className="badge badge-gold"><Star size={10} /> Cleared</span>}
                  {earned && <span className="badge badge-sage text-[10px]">Earned</span>}
                </div>
                <p className="text-xs text-stone mt-0.5">
                  {timer}s per round · 3 rounds of 5 · up to {formatDenarii(maxReward)} Ð
                  {!unlocked && ' · Clear previous level to unlock'}
                  {level === DAILY_GAME_LEVELS && ' · BOSS: One of each game type, shortest timers'}
                </p>
              </div>
              <div className="relative z-10 flex-shrink-0">
                {unlocked ? (
                  passed ? (
                    <button className="btn-secondary text-sm" onClick={(e) => { e.stopPropagation(); resetUsedQuestions(); setActiveLevel(level); }}>
                      <RotateCcw size={14} /> Replay
                    </button>
                  ) : (
                    <button className="btn-primary text-sm" onClick={(e) => { e.stopPropagation(); resetUsedQuestions(); setActiveLevel(level); }}>
                      Begin
                    </button>
                  )
                ) : (
                  <Lock size={18} className="text-stone" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GamePlay({ level, mode, narrative, userId, remainingToCap, denariiBalance, hasEarnedFromLevel, onExit, onComplete }: {
  level: number;
  mode: string;
  narrative: DailyNarrative;
  userId: string;
  remainingToCap: number;
  denariiBalance: number;
  hasEarnedFromLevel: boolean;
  onExit: () => void;
  onComplete: (result: GameOverResult) => void;
}) {
  const [questions, setQuestions] = useState<QuestionPayload[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [relicInventory, setRelicInventory] = useState<Record<string, number>>({});
  const [localDenarii, setLocalDenarii] = useState(denariiBalance);
  const [hintShown, setHintShown] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [hintText, setHintText] = useState<string | null>(null);
  const [relicNotice, setRelicNotice] = useState<string | null>(null);
  const [eliminatedOptions, setEliminatedOptions] = useState<string[]>([]);
  const [donkeyActive, setDonkeyActive] = useState(false);
  const [usingQuestionRelic, setUsingQuestionRelic] = useState<string | null>(null);
  const [relicBurst, setRelicBurst] = useState<string | null>(null);
  const [usingGoliath, setUsingGoliath] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(getLevelTimer(level));
  const [roundCorrect, setRoundCorrect] = useState(0);
  const [roundTimeout, setRoundTimeout] = useState<RoundTimeout | null>(null);
  const [passageIntroRound, setPassageIntroRound] = useState<number | null>(null);
  const [passageTimeLeft, setPassageTimeLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failedQuestions, setFailedQuestions] = useState<QuestionPayload[]>([]);
  const [hasRepeatedFailed, setHasRepeatedFailed] = useState(false);
  const [repeatQueue, setRepeatQueue] = useState<QuestionPayload[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const passageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPractice = mode === 'practice';

  useEffect(() => {
    let cancelled = false;
    resetUsedQuestions();
    setQuestionsLoading(true);
    setCurrentQ(0);
    setSelectedAnswer(null);
    setShowFeedback(false);
    setScore(0);
    setFailedQuestions([]);
    setHasRepeatedFailed(false);
    setRepeatQueue([]);
    setPassageIntroRound(null);
    setPassageTimeLeft(0);
    setRoundCorrect(0);
    setRoundTimeout(null);
    generateLevelQuestionsWithCustom(narrative.game_seed_data as GameSeedData, level, narrative.narrative_date)
      .then((qs) => {
        if (!cancelled) {
          setQuestions(qs);
          setTimeLeft(getRoundTimer(qs, level, 0));
          const firstRound = getQuestionRound(qs[0], 0);
          const firstPassage = getRoundPassageQuestion(qs, firstRound);
          if (firstPassage) {
            setPassageIntroRound(firstRound);
            setPassageTimeLeft(getPassageDisplaySeconds(firstPassage));
          }
          setQuestionsLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setQuestionsLoading(false); });
    // Fetch relic inventory
    supabase
      .from('relic_inventory')
      .select('quantity, relic_types(slug)')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, number> = {};
        data.forEach((r: any) => {
          const relic = Array.isArray(r.relic_types) ? r.relic_types[0] : r.relic_types;
          if (relic?.slug) map[relic.slug] = r.quantity;
        });
        setRelicInventory(map);
    });
    return () => { cancelled = true; };
  }, [narrative, level, userId]);

  const handleAnswer = useCallback((answer: string | null) => {
    if (showFeedback) return;
    const q = questions[currentQ];
    if (donkeyActive && answer !== q.correct_answer) {
      setDonkeyActive(false);
      setRelicNotice('The Talking Donkey warns that this answer is not right. Try another answer.');
      return;
    }
    const correct = answer === q.correct_answer;
    setSelectedAnswer(answer);
    setShowFeedback(true);
    if (correct) {
      setScore((s) => s + 1);
      setRoundCorrect((value) => value + 1);
    } else {
      setFailedQuestions((prev) => [...prev, q]);
    }
  }, [showFeedback, questions, currentQ, donkeyActive]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (roundTimeout || passageIntroRound !== null) return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          const round = getQuestionRound(questions[currentQ], currentQ);
          const nextIndex = questions.findIndex((question, index) => index > currentQ && getQuestionRound(question, index) !== round);
          const total = questions.filter((question, index) => getQuestionRound(question, index) === round).length;
          setRoundTimeout({ round, correct: roundCorrect, total, nextIndex: nextIndex === -1 ? null : nextIndex });
          void playSoundEffect('sound_round_timeout');
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [currentQ, passageIntroRound, questions, roundCorrect, roundTimeout]);

  useEffect(() => {
    if (timeLeft > 0 && timeLeft <= 10 && !roundTimeout && passageIntroRound === null) {
      playRoundWarningBeep();
    }
  }, [timeLeft, roundTimeout, passageIntroRound]);

  useEffect(() => {
    if (passageTimerRef.current) clearInterval(passageTimerRef.current);
    if (passageIntroRound === null) return;
    passageTimerRef.current = setInterval(() => {
      setPassageTimeLeft((t) => {
        if (t <= 1) {
          if (passageTimerRef.current) clearInterval(passageTimerRef.current);
          setPassageIntroRound(null);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (passageTimerRef.current) clearInterval(passageTimerRef.current); };
  }, [passageIntroRound]);

  const useHint = async () => {
    if (hintShown || showFeedback || localDenarii < HINT_COST) return;
    setHintShown(true);
    setLocalDenarii((d) => d - HINT_COST);
    await insertLedgerEntry({
      user_id: userId, amount: -HINT_COST, source_type: 'hint',
      description: `Hint used on Level ${level}`,
    } as any);
    const q = questions[currentQ];
    if (q.options && q.options.length > 0) {
      const wrong = q.options.filter((o) => o !== q.correct_answer);
      const removed = wrong.slice(0, Math.max(1, Math.floor(wrong.length / 2)));
      setHintText(`Eliminated: ${removed.join(', ')}`);
    } else {
      setHintText(q.explanation || 'Look carefully at the passage for clues.');
    }
  };

  const useAnswerReveal = async () => {
    if (answerRevealed || showFeedback || localDenarii < ANSWER_REVEAL_COST) return;
    setAnswerRevealed(true);
    setLocalDenarii((d) => d - ANSWER_REVEAL_COST);
    await insertLedgerEntry({
      user_id: userId, amount: -ANSWER_REVEAL_COST, source_type: 'answer_reveal',
      description: `Answer revealed on Level ${level}`,
    } as any);
    handleAnswer(questions[currentQ].correct_answer as string);
  };

  const consumeQuestionRelic = async (slug: string, action: () => void) => {
    if (showFeedback || usingQuestionRelic || (relicInventory[slug] || 0) <= 0) return;
    setUsingQuestionRelic(slug);
    try {
      await useRelic(userId, slug);
      setRelicInventory((previous) => ({
        ...previous,
        [slug]: Math.max(0, (previous[slug] || 0) - 1),
      }));
      setRelicBurst(slug);
      void playSoundEffect(
        slug === RELIC_SLUGS.WITCH_BALL || slug === RELIC_SLUGS.REVEAL_REFERENCE
          ? 'sound_relic_reveal'
          : 'sound_relic_deploy',
      );
      action();
      window.setTimeout(() => setRelicBurst(null), 650);
    } catch (error: any) {
      setRelicNotice(error.message || 'This relic could not be used.');
    } finally {
      setUsingQuestionRelic(null);
    }
  };

  const useRelicHint = () => consumeQuestionRelic(RELIC_SLUGS.HINT, () => {
    setHintShown(true);
    const question = questions[currentQ];
    setHintText(question.explanation || 'Read the question and passage again for the detail that changes the answer.');
  });

  const useEliminate = () => consumeQuestionRelic(RELIC_SLUGS.ELIMINATE, () => {
    const question = questions[currentQ];
    const wrongAnswers = (question.options || []).filter((option) => option !== question.correct_answer);
    setEliminatedOptions(wrongAnswers.slice(0, Math.max(1, Math.floor(wrongAnswers.length / 2))));
    setRelicNotice('Two wrong options have been removed.');
  });

  const useFreezeTimer = () => consumeQuestionRelic(RELIC_SLUGS.FREEZE_TIMER, () => {
    setTimeLeft((seconds) => seconds + 60);
    setRelicNotice('Your current round received 60 extra seconds.');
  });

  const useSkip = () => consumeQuestionRelic(RELIC_SLUGS.SKIP, () => {
    setRelicNotice('Question skipped. It will not add to your score.');
    handleAnswer(null);
  });

  const useReference = () => consumeQuestionRelic(RELIC_SLUGS.REVEAL_REFERENCE, () => {
    setRelicNotice(questions[currentQ].reference ? `Reference: ${questions[currentQ].reference}` : 'This question has no additional reference.');
  });

  const useWitchBall = () => consumeQuestionRelic(RELIC_SLUGS.WITCH_BALL, () => {
    setAnswerRevealed(true);
    handleAnswer(questions[currentQ].correct_answer as string);
  });

  const useTalkingDonkey = () => consumeQuestionRelic(RELIC_SLUGS.TALKING_DONKEY, () => {
    setDonkeyActive(true);
    setRelicNotice('The Talking Donkey is listening. A wrong answer will be stopped before it is submitted.');
  });

  const finishLevel = async (forcePerfect = false) => {
    setSubmitting(true);
    const maxScore = questions.length;
    const finalScore = forcePerfect ? maxScore : score;
    const passed = forcePerfect || finalScore >= Math.ceil(maxScore * PASS_THRESHOLD);
    const reward = calcGameReward(level, finalScore, maxScore);
    const actualReward = passed && !hasEarnedFromLevel ? Math.min(reward, remainingToCap) : 0;

    if (!forcePerfect && !passed && failedQuestions.length > 0 && !hasRepeatedFailed) {
      setHasRepeatedFailed(true);
      setRepeatQueue(failedQuestions);
      setSubmitting(false);
      return;
    }

    const attempt = await insertGameAttempt({
      user_id: userId,
      narrative_date: narrative.narrative_date,
      level, mode: mode as any, score: finalScore,
      max_score: maxScore,
      reward: actualReward,
      status: passed ? 'passed' : 'failed',
      completed_at: new Date().toISOString(),
    } as any);

    if (passed && actualReward > 0) {
      await insertLedgerEntry({
        user_id: userId,
        amount: actualReward,
        source_type: 'game_level',
        source_reference: attempt.id,
        description: forcePerfect
          ? `Level ${level} — perfect score by Sword of Goliath`
          : `Level ${level} — ${finalScore}/${maxScore} correct`,
      });
    }

    setSubmitting(false);
    onComplete({ passed, score: finalScore, maxScore, reward: actualReward, level, mode, nextLevel: passed ? level + 1 : null });
  };

  const useGoliathSword = async () => {
    if (submitting || usingGoliath || (relicInventory[RELIC_SLUGS.SWORD_GOLIATH] || 0) <= 0) return;
    setUsingGoliath(true);
    try {
      await useRelic(userId, RELIC_SLUGS.SWORD_GOLIATH);
      setRelicInventory((prev) => ({
        ...prev,
        [RELIC_SLUGS.SWORD_GOLIATH]: Math.max(0, (prev[RELIC_SLUGS.SWORD_GOLIATH] || 0) - 1),
      }));
      setRelicBurst(RELIC_SLUGS.SWORD_GOLIATH);
      void playSoundEffect('sound_relic_reveal');
      await finishLevel(true);
    } catch (e: any) {
      alert(e.message || 'Failed to use Sword of Goliath');
      setSubmitting(false);
    }
    setUsingGoliath(false);
    window.setTimeout(() => setRelicBurst(null), 650);
  };

  const showRoundPassage = (questionList: QuestionPayload[], round: number) => {
    const passageQuestion = getRoundPassageQuestion(questionList, round);
    if (!passageQuestion) return;
    setPassageIntroRound(round);
    setPassageTimeLeft(getPassageDisplaySeconds(passageQuestion));
  };

  const handleNext = async () => {
    // If we have a repeat queue (failed questions), process those first
    if (repeatQueue.length > 0 && currentQ + 1 >= questions.length) {
      // Replace questions with the repeat queue
      setQuestions(repeatQueue);
      setRepeatQueue([]);
      setCurrentQ(0);
      setSelectedAnswer(null);
      setShowFeedback(false);
      setTimeLeft(getRoundTimer(repeatQueue, level, 0));
      showRoundPassage(repeatQueue, getQuestionRound(repeatQueue[0], 0));
      return;
    }

    if (currentQ + 1 < questions.length) {
      const nextIndex = currentQ + 1;
      const currentRound = getQuestionRound(questions[currentQ], currentQ);
      const nextRound = getQuestionRound(questions[nextIndex], nextIndex);
      setCurrentQ((c) => c + 1);
      setSelectedAnswer(null);
      setShowFeedback(false);
      setHintShown(false);
      setAnswerRevealed(false);
      setHintText(null);
      setRelicNotice(null);
      setEliminatedOptions([]);
      setDonkeyActive(false);
      if (nextRound !== currentRound) {
        setRoundCorrect(0);
        setTimeLeft(getRoundTimer(questions, level, nextIndex));
        showRoundPassage(questions, nextRound);
      }
    } else {
      await finishLevel(false);
    }
  };

  const continueAfterRoundTimeout = async () => {
    if (!roundTimeout) return;
    const nextIndex = roundTimeout.nextIndex;
    setRoundTimeout(null);
    if (nextIndex === null) {
      await finishLevel(false);
      return;
    }
    const nextRound = getQuestionRound(questions[nextIndex], nextIndex);
    setCurrentQ(nextIndex);
    setSelectedAnswer(null);
    setShowFeedback(false);
    setHintShown(false);
    setAnswerRevealed(false);
    setHintText(null);
    setRelicNotice(null);
    setEliminatedOptions([]);
    setDonkeyActive(false);
    setRoundCorrect(0);
    setTimeLeft(getRoundTimer(questions, level, nextIndex));
    showRoundPassage(questions, nextRound);
  };

  if (questionsLoading || questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
        <Loader2 size={24} className="animate-spin text-brass mb-3" />
        <p className="text-stone text-sm">Preparing level {level}…</p>
      </div>
    );
  }

  const q = questions[currentQ];
  const correct = selectedAnswer === q.correct_answer;
  const gameType = getLevelGameType(level);
  const showInlinePassage = gameType !== 'comprehension';
  const goliathCount = relicInventory[RELIC_SLUGS.SWORD_GOLIATH] || 0;
  const currentRound = getQuestionRound(q, currentQ);
  const totalRounds = Math.max(...questions.map((question, index) => getQuestionRound(question, index)), 1);
  const activePassageQuestion = passageIntroRound !== null
    ? getRoundPassageQuestion(questions, passageIntroRound)
    : undefined;

  if (roundTimeout) {
    const qualified = roundTimeout.correct >= Math.ceil(roundTimeout.total * PASS_THRESHOLD);
    return (
      <div className="mx-auto max-w-md space-y-4 animate-fade-in">
        <div className="card overflow-hidden p-6 text-center">
          <Dove size={112} className="mx-auto mb-3 animate-pulse grayscale opacity-70" />
          <p className="eyebrow mb-1">Round {roundTimeout.round} complete</p>
          <h3 className="font-display text-2xl font-semibold text-ink">Time has elapsed</h3>
          <p className="mt-2 text-sm text-stone">{roundTimeout.correct} of {roundTimeout.total} answers correct this round.</p>
          <p className={cn('mt-2 text-xs font-semibold', qualified ? 'text-sage' : 'text-coral')}>
            {qualified ? 'You qualified to move forward.' : 'The remaining questions are closed. Keep going.'}
          </p>
          <button onClick={continueAfterRoundTimeout} className="btn-primary mt-5 w-full">
            {roundTimeout.nextIndex === null ? 'Finish Level' : `Start Round ${roundTimeout.round + 1}`}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (activePassageQuestion && passageIntroRound !== null) {
    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <button onClick={onExit} className="btn-ghost text-sm">← Exit</button>
          <span className={cn('badge', isPractice ? 'badge-neutral' : 'badge-gold')}>
            {isPractice ? <><Star size={10} /> Practice</> : 'Normal'} · Level {level}
          </span>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="eyebrow mb-1">Round {passageIntroRound} Passage</p>
              <h3 className="font-display text-xl font-semibold text-ink">Read before the questions begin</h3>
            </div>
            <div className={cn(
              'px-3 py-1.5 rounded-lg font-display font-semibold text-sm flex items-center gap-1.5',
              passageTimeLeft <= 10 ? 'bg-coral-soft text-coral' : 'bg-gold-soft text-gold',
            )}>
              <Clock size={14} /> {passageTimeLeft}s
            </div>
          </div>

          <div className="p-4 rounded-lg bg-surface-2 font-serif text-ink text-sm leading-relaxed border border-border max-h-80 overflow-y-auto whitespace-pre-wrap">
            {activePassageQuestion.passage}
          </div>

          <button
            onClick={() => setPassageIntroRound(null)}
            disabled={passageTimeLeft > 0}
            className="btn-primary mt-4 w-full disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {passageTimeLeft > 0 ? `Questions unlock in ${passageTimeLeft}s` : 'Start Round Questions'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:flex sm:justify-between">
        <button onClick={onExit} className="btn-ghost px-3 py-2 text-xs sm:text-sm">← <span className="hidden sm:inline">Exit</span></button>
        <div className="flex min-w-0 flex-wrap justify-center gap-1.5">
          <span className={cn('badge max-w-full text-[10px] sm:text-xs', isPractice ? 'badge-neutral' : 'badge-gold')}>
            {isPractice ? <><Star size={10} /> Practice</> : 'Normal'} · L{level}
          </span>
          <span className="badge badge-neutral max-w-[8.5rem] truncate text-[9px] sm:max-w-none sm:text-[10px]" title={GAME_TYPE_LABELS[gameType]}>{GAME_TYPE_LABELS[gameType]}</span>
        </div>
        <div className={cn(
          'justify-self-end px-2 py-1.5 rounded-lg font-display font-semibold text-xs flex items-center gap-1 sm:px-3 sm:text-sm',
          timeLeft <= 10 ? 'bg-coral-soft text-coral' : 'bg-gold-soft text-gold',
        )}>
          <Clock size={13} /> <span className="hidden sm:inline">Round </span>{currentRound} · {timeLeft}s
        </div>
      </div>

      <div className="flex gap-1.5">
        {questions.map((_, i) => (
          <div key={i} className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            i < currentQ ? 'bg-sage' : i === currentQ ? 'bg-gold' : 'bg-surface-2',
          )} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-stone">
        <span>Score: <span className="text-ink font-semibold">{score}</span> / {questions.length}</span>
        <span>Round {currentRound} of {totalRounds} · need {Math.ceil(questions.length * PASS_THRESHOLD)} to pass</span>
      </div>

      <div className={cn('card p-4 sm:p-5', relicBurst && 'animate-pulse')}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow mb-0">R{currentRound} · Q{currentQ + 1}/{questions.length}</p>
          {!showFeedback && !answerRevealed && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {goliathCount > 0 && (
                <button
                  onClick={useGoliathSword}
                  disabled={submitting || usingGoliath}
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border border-coral/30 bg-coral-soft text-coral hover:bg-coral/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Use Sword of Goliath for a perfect score on this level"
                >
                  {usingGoliath ? <Loader2 size={12} className="animate-spin" /> : <Swords size={12} />} <span className="hidden sm:inline">Perfect</span> ({goliathCount})
                </button>
              )}
              <button
                onClick={useHint}
                disabled={hintShown || localDenarii < HINT_COST}
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border border-gold/30 bg-gold-soft text-gold hover:bg-gold/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={`Use hint (${HINT_COST} Ð)`}
              >
                  <Lightbulb size={12} /> <span className="hidden sm:inline">Hint </span>{HINT_COST}Ð
              </button>
              <button
                onClick={useAnswerReveal}
                disabled={localDenarii < ANSWER_REVEAL_COST}
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border border-royal/30 bg-royal-soft text-royal hover:bg-royal/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={`Reveal answer (${ANSWER_REVEAL_COST} Ð)`}
              >
                  <Eye size={12} /> <span className="hidden sm:inline">Reveal </span>{ANSWER_REVEAL_COST}Ð
              </button>
            </div>
          )}
        </div>
        {!showFeedback && (
          <div className="mb-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {[
              [RELIC_SLUGS.HINT, 'Hint', Lightbulb, useRelicHint, true],
              [RELIC_SLUGS.ELIMINATE, 'Eliminate', Wand2, useEliminate, !!q.options?.length],
              [RELIC_SLUGS.FREEZE_TIMER, '+60s', TimerOff, useFreezeTimer, true],
              [RELIC_SLUGS.SKIP, 'Skip', SkipForward, useSkip, true],
              [RELIC_SLUGS.REVEAL_REFERENCE, 'Reference', BookOpen, useReference, true],
              [RELIC_SLUGS.TALKING_DONKEY, 'Donkey', Volume2, useTalkingDonkey, true],
              [RELIC_SLUGS.WITCH_BALL, 'Answer', Eye, useWitchBall, true],
            ].map(([slug, label, Icon, onClick, applicable]) => {
              const amount = relicInventory[slug as string] || 0;
              if (!amount || !applicable) return null;
              const isUsing = usingQuestionRelic === slug;
              return (
                <button
                  key={slug as string}
                  type="button"
                  onClick={onClick as () => void}
                  disabled={!!usingQuestionRelic}
                  className="flex items-center gap-1 rounded-full border border-royal/25 bg-royal-soft px-2 py-1 text-[10px] font-medium text-royal transition-colors hover:bg-royal/10 disabled:opacity-45"
                  title={`Use ${label} relic`}
                >
                  {isUsing ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                  <span>{label}</span> ({amount})
                </button>
              );
            })}
          </div>
        )}
        {hintText && (
          <div className="mb-3 p-2.5 rounded-lg bg-gold-soft border border-gold/20 text-xs text-gold flex items-center gap-1.5 animate-fade-in">
            <Sparkles size={14} /> {hintText}
          </div>
        )}
        {relicNotice && (
          <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-royal/20 bg-royal-soft p-2.5 text-xs text-royal animate-fade-in">
            <Sparkles size={14} className="mt-0.5 flex-shrink-0" /> {relicNotice}
          </div>
        )}
        <h3 className="font-display font-medium text-ink text-lg mb-4">{q.question}</h3>

        {/* Scriptorium / First Letter */}
        {q.type === 'scriptorium' && q.blanked_text && (
          <div className="mb-4">
            <div className="p-4 rounded-lg bg-surface-2 font-serif text-ink text-center text-lg tracking-wider mb-3 border border-border">
              {q.blanked_text}
            </div>
            {!showFeedback ? (
              <div>
                <input
                  className="input-field font-serif"
                  placeholder="Type the full verse…"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val) handleAnswer(val);
                    }
                  }}
                />
                <button className="btn-primary mt-2 w-full" onClick={() => {
                  const el = document.querySelector('input[type="text"]') as HTMLInputElement;
                  const val = el?.value?.trim();
                  if (val) handleAnswer(val);
                }}>Submit Answer</button>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-surface-2 font-serif text-ink text-center border border-border">
                {q.correct_answer}
              </div>
            )}
          </div>
        )}

        {/* Standard written answer — exact/case-sensitive */}
        {q.type === 'standard_text' && (
          <div className="mb-4">
            {showInlinePassage && q.passage && (
              <div className="p-4 rounded-lg bg-surface-2 font-serif text-ink text-sm leading-relaxed border border-border mb-3 max-h-40 overflow-y-auto">
                {q.passage}
              </div>
            )}
            {!showFeedback ? (
              <div>
                <input
                  className="input-field font-serif"
                  placeholder="Type the exact answer..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val) handleAnswer(val);
                    }
                  }}
                />
                <button className="btn-primary mt-2 w-full" onClick={() => {
                  const el = document.querySelector('input[type="text"]') as HTMLInputElement;
                  const val = el?.value?.trim();
                  if (val) handleAnswer(val);
                }}>Submit Answer</button>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-surface-2 font-serif text-ink text-center border border-border">
                {q.correct_answer}
              </div>
            )}
          </div>
        )}

        {/* Cloze / Fill Blank — drag-and-drop word bank */}
        {q.type === 'cloze' && (
          <FillBlankDragDrop
            blankedText={q.blanked_text || ''}
            blanks={q.blanks || []}
            wordBank={q.items || []}
            showFeedback={showFeedback}
            onAnswer={handleAnswer}
          />
        )}

        {/* True/False — ONE statement, two buttons */}
        {q.type === 'true_false' && (
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-surface-2 border border-border text-ink text-center text-lg font-medium mb-3">
              {q.question}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => !showFeedback && handleAnswer('True')}
                disabled={showFeedback}
                className={cn(
                  'py-4 rounded-lg border-2 font-display font-bold text-lg transition-all',
                  !showFeedback && 'border-sage hover:bg-sage-soft text-sage',
                  showFeedback && q.correct_answer === 'True' && 'border-sage bg-sage-soft text-sage',
                  showFeedback && selectedAnswer === 'True' && q.correct_answer !== 'True' && 'border-coral bg-coral-soft text-coral',
                  showFeedback && q.correct_answer !== 'True' && selectedAnswer !== 'True' && 'border-border opacity-50',
                )}
              >
                <CheckCircle2 size={24} className="mx-auto mb-1" />
                True
              </button>
              <button
                onClick={() => !showFeedback && handleAnswer('False')}
                disabled={showFeedback}
                className={cn(
                  'py-4 rounded-lg border-2 font-display font-bold text-lg transition-all',
                  !showFeedback && 'border-coral hover:bg-coral-soft text-coral',
                  showFeedback && q.correct_answer === 'False' && 'border-sage bg-sage-soft text-sage',
                  showFeedback && selectedAnswer === 'False' && q.correct_answer !== 'False' && 'border-coral bg-coral-soft text-coral',
                  showFeedback && q.correct_answer !== 'False' && selectedAnswer !== 'False' && 'border-border opacity-50',
                )}
              >
                <XCircle size={24} className="mx-auto mb-1" />
                False
              </button>
            </div>
          </div>
        )}

        {/* Multiple choice */}
        {q.type === 'multiple_choice' && q.options && (
          <div className="space-y-2">
            {q.options.filter((opt) => !eliminatedOptions.includes(opt)).map((opt, i) => {
              const isCorrect = opt === q.correct_answer;
              const isSelected = selectedAnswer === opt;
              return (
                <button key={i} onClick={() => !showFeedback && handleAnswer(opt)} disabled={showFeedback}
                  className={cn(
                    'w-full text-left p-3.5 rounded-lg border transition-all text-sm font-medium',
                    !showFeedback && 'border-border hover:border-gold text-ink',
                    showFeedback && isCorrect && 'border-sage bg-sage-soft text-sage',
                    showFeedback && isSelected && !isCorrect && 'border-coral bg-coral-soft text-coral',
                    showFeedback && !isCorrect && !isSelected && 'border-border opacity-50',
                  )}>
                  {opt}
                  {showFeedback && isCorrect && <CheckCircle2 size={16} className="inline ml-2" />}
                  {showFeedback && isSelected && !isCorrect && <XCircle size={16} className="inline ml-2" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Order sequence / Build Verse */}
        {q.type === 'order_sequence' && q.items && (
          <OrderSequenceQuestion
            items={q.items}
            correctOrder={String(q.correct_answer).split('|')}
            showFeedback={showFeedback}
            onAnswer={handleAnswer}
          />
        )}

        {/* Matching / Word to Meaning */}
        {q.type === 'matching' && q.pairs && (
          <MatchingQuestion
            pairs={q.pairs}
            shuffledOptions={q.options || []}
            showFeedback={showFeedback}
            onAnswer={handleAnswer}
          />
        )}

        {/* Category Sort */}
        {q.type === 'category_sort' && q.sort_items && q.buckets && (
          <CategorySortQuestion
            items={q.sort_items}
            buckets={q.buckets}
            showFeedback={showFeedback}
            onAnswer={handleAnswer}
          />
        )}

        {/* Comprehension — passage-based multiple choice */}
        {q.type === 'comprehension' && q.options && (
          <div className="space-y-3">
            {showInlinePassage && q.passage && (
              <div className="p-4 rounded-lg bg-surface-2 font-serif text-ink text-sm leading-relaxed border border-border max-h-40 overflow-y-auto">
                <p className="text-xs text-stone mb-2 font-sans not-italic">Passage:</p>
                {q.passage}
              </div>
            )}
            <div className="space-y-2">
              {q.options.filter((opt) => !eliminatedOptions.includes(opt)).map((opt, i) => {
                const isCorrect = opt === q.correct_answer;
                const isSelected = selectedAnswer === opt;
                return (
                  <button key={i} onClick={() => !showFeedback && handleAnswer(opt)} disabled={showFeedback}
                    className={cn(
                      'w-full text-left p-3.5 rounded-lg border transition-all text-sm font-medium',
                      !showFeedback && 'border-border hover:border-gold text-ink',
                      showFeedback && isCorrect && 'border-sage bg-sage-soft text-sage',
                      showFeedback && isSelected && !isCorrect && 'border-coral bg-coral-soft text-coral',
                      showFeedback && !isCorrect && !isSelected && 'border-border opacity-50',
                    )}>
                    {opt}
                    {showFeedback && isCorrect && <CheckCircle2 size={16} className="inline ml-2" />}
                    {showFeedback && isSelected && !isCorrect && <XCircle size={16} className="inline ml-2" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Feedback */}
        {showFeedback && (
          <div className="mt-4 animate-slide-up">
            <div className={cn('p-3 rounded-lg flex items-center gap-2',
              correct ? 'bg-sage-soft text-sage' : 'bg-coral-soft text-coral')}>
              {correct ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              <span className="text-sm font-medium">{correct ? 'Correct!' : 'Not quite.'}</span>
            </div>
            {q.reference && <p className="text-xs text-gold mt-2">Reference: {q.reference}</p>}
            <button onClick={handleNext} disabled={submitting} className="btn-primary mt-3 w-full">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
              {currentQ + 1 < questions.length ? 'Next Question' : 'Finish Level'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Fill-Blank with drag-and-drop (take-and-put) ──
function FillBlankDragDrop({ blankedText, blanks, wordBank, showFeedback, onAnswer }: {
  blankedText: string;
  blanks: string[];
  wordBank: string[];
  showFeedback: boolean;
  onAnswer: (a: string) => void;
}) {
  const [placed, setPlaced] = useState<Record<number, string>>({});
  const [usedWords, setUsedWords] = useState<Set<string>>(new Set());

  const blankSlots = blanks.map((_, i) => i);

  const placeWord = (word: string, slot: number) => {
    if (showFeedback) return;
    if (usedWords.has(word)) return;
    // Remove any word already in this slot
    const existing = placed[slot];
    if (existing) setUsedWords((prev) => { const n = new Set(prev); n.delete(existing); return n; });
    setPlaced({ ...placed, [slot]: word });
    setUsedWords((prev) => new Set(prev).add(word));
  };

  const removeWord = (slot: number) => {
    if (showFeedback) return;
    const word = placed[slot];
    if (word) {
      setUsedWords((prev) => { const n = new Set(prev); n.delete(word); return n; });
      setPlaced((prev) => { const n = { ...prev }; delete n[slot]; return n; });
    }
  };

  const allFilled = blankSlots.every((s) => placed[s]);

  const renderBlankedText = () => {
    const parts = blankedText.split(/(___\d+___)/);
    return parts.map((part, i) => {
      const match = part.match(/___(\d+)___/);
      if (match) {
        const slot = parseInt(match[1]) - 1;
        const word = placed[slot];
        const isCorrect = showFeedback && word === blanks[slot];
        const isWrong = showFeedback && word && word !== blanks[slot];
        return (
          <button
            key={i}
            onClick={() => word && removeWord(slot)}
            disabled={showFeedback}
            className={cn(
              'inline-block min-w-[80px] px-2 py-1 mx-0.5 rounded border-2 text-center text-sm font-medium transition-all',
              !word && 'border-dashed border-gold/40 bg-gold-soft/30',
              word && !showFeedback && 'border-gold bg-gold-soft text-ink',
              isCorrect && 'border-sage bg-sage-soft text-sage',
              isWrong && 'border-coral bg-coral-soft text-coral',
            )}
          >
            {word || `___${slot + 1}___`}
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone">Tap a word from the bank, then tap a blank to place it. Tap a placed word to remove it.</p>

      {/* Verse with blanks */}
      <div className="p-4 rounded-lg bg-surface-2 font-serif text-ink text-lg leading-relaxed border border-border">
        {renderBlankedText()}
      </div>

      {/* Word bank */}
      <div className="flex flex-wrap gap-2">
        {wordBank.map((word, i) => {
          const isUsed = usedWords.has(word);
          return (
            <button
              key={i}
              onClick={() => {
                if (isUsed || showFeedback) return;
                // Place in first empty slot
                const emptySlot = blankSlots.find((s) => !placed[s]);
                if (emptySlot !== undefined) placeWord(word, emptySlot);
              }}
              disabled={isUsed || showFeedback}
              className={cn(
                'px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                isUsed ? 'border-border opacity-30' : 'border-gold bg-gold-soft text-ink hover:scale-105',
              )}
            >
              {word}
            </button>
          );
        })}
      </div>

      {/* Submit */}
      {!showFeedback && (
        <button
          className="btn-primary w-full"
          disabled={!allFilled}
          onClick={() => onAnswer(blankSlots.map((s) => placed[s]).join('|'))}
        >
          Submit Answers
        </button>
      )}

      {/* Show correct answers */}
      {showFeedback && (
        <div className="text-xs text-stone">
          Correct answers: {blanks.map((b, i) => `Blank ${i + 1}: ${b}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function OrderSequenceQuestion({ items, correctOrder, showFeedback, onAnswer }: {
  items: string[]; correctOrder: string[]; showFeedback: boolean; onAnswer: (a: string) => void;
}) {
  const [order, setOrder] = useState<string[]>([]);

  const toggle = (item: string) => {
    if (showFeedback) return;
    if (order.includes(item)) setOrder(order.filter((x) => x !== item));
    else setOrder([...order, item]);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-stone">Click words in the correct order to build the verse:</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((item) => {
          const idx = order.indexOf(item);
          const correctIdx = correctOrder.indexOf(item);
          return (
            <button key={item} onClick={() => toggle(item)} disabled={showFeedback}
              className={cn(
                'px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                !showFeedback && order.includes(item) && 'border-gold bg-gold-soft text-ink',
                !showFeedback && !order.includes(item) && 'border-border hover:border-gold text-ink',
                showFeedback && idx === correctIdx && 'border-sage bg-sage-soft text-sage',
                showFeedback && idx !== correctIdx && order.includes(item) && 'border-coral bg-coral-soft text-coral',
                showFeedback && !order.includes(item) && 'border-border opacity-50',
              )}>
              <span>{item}</span>
              {order.includes(item) && <span className="ml-1.5 font-bold text-gold">{idx + 1}</span>}
            </button>
          );
        })}
      </div>
      {!showFeedback && (
        <button className="btn-primary w-full" disabled={order.length !== items.length}
          onClick={() => onAnswer(order.join('|'))}>
          Submit Verse
        </button>
      )}
    </div>
  );
}

function MatchingQuestion({ pairs, shuffledOptions, showFeedback, onAnswer }: {
  pairs: { left: string; right: string }[];
  shuffledOptions: string[];
  showFeedback: boolean;
  onAnswer: (a: string) => void;
}) {
  const [matches, setMatches] = useState<Record<string, string>>({});
  const allMatched = pairs.every((p) => matches[p.left]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone">Match each term with its meaning:</p>
      {pairs.map((pair) => (
        <div key={pair.left} className="flex items-center gap-2">
          <div className="flex-1 p-3 rounded-lg bg-surface-2 text-sm font-medium text-ink border border-border">
            {pair.left}
          </div>
          <span className="text-stone">→</span>
          <select
            className="input-field flex-1 text-sm"
            value={matches[pair.left] || ''}
            onChange={(e) => !showFeedback && setMatches({ ...matches, [pair.left]: e.target.value })}
            disabled={showFeedback}
          >
            <option value="">Select…</option>
            {shuffledOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      ))}
      {!showFeedback && (
        <button className="btn-primary w-full" disabled={!allMatched}
          onClick={() => onAnswer(pairs.map((p) => matches[p.left]).join('|'))}>
          Submit Matches
        </button>
      )}
      {showFeedback && (
        <div className="text-xs text-stone mt-2">
          Correct: {pairs.map((p) => `${p.left} → ${p.right}`).join(', ')}
        </div>
      )}
    </div>
  );
}

function CategorySortQuestion({ items, buckets, showFeedback, onAnswer }: {
  items: { text: string; bucket: string }[];
  buckets: string[];
  showFeedback: boolean;
  onAnswer: (a: string) => void;
}) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const allAssigned = items.every((item) => assignments[item.text]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone">Choose the right bucket for each item:</p>
      {items.map((item) => {
        const selected = assignments[item.text] || '';
        const isCorrect = showFeedback && selected === item.bucket;
        const isWrong = showFeedback && selected && selected !== item.bucket;
        return (
          <div key={item.text} className="flex items-center gap-2">
            <div className="flex-1 p-3 rounded-lg bg-surface-2 text-sm font-medium text-ink border border-border">
              {item.text}
            </div>
            <select
              className={cn(
                'input-field flex-1 text-sm',
                isCorrect && 'border-sage text-sage',
                isWrong && 'border-coral text-coral',
              )}
              value={selected}
              onChange={(e) => !showFeedback && setAssignments({ ...assignments, [item.text]: e.target.value })}
              disabled={showFeedback}
            >
              <option value="">Select…</option>
              {buckets.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
            </select>
          </div>
        );
      })}
      {!showFeedback && (
        <button className="btn-primary w-full" disabled={!allAssigned}
          onClick={() => onAnswer(items.map((item) => `${item.text}:${assignments[item.text]}`).join('|'))}>
          Submit Sort
        </button>
      )}
      {showFeedback && (
        <div className="text-xs text-stone mt-2">
          Correct: {items.map((item) => `${item.text} → ${item.bucket}`).join(', ')}
        </div>
      )}
    </div>
  );
}

function GameOverScreen({ result, onContinue, onBackToLevels }: {
  result: GameOverResult; onContinue: () => void; onBackToLevels: () => void;
}) {
  const isPractice = result.mode === 'practice';
  const hasNext = result.nextLevel !== null;

  return (
    <div className="max-w-md mx-auto animate-scale-in">
      <div className={cn('card p-8 text-center', result.passed ? 'border-sage' : 'border-coral')}>
        <div className={cn('w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4',
          result.passed ? 'bg-sage-soft' : 'bg-coral-soft')}>
          {result.passed ? <Trophy size={32} className="text-sage" /> : <XCircle size={32} className="text-coral" />}
        </div>
        <h2 className="font-display text-2xl font-semibold text-ink mb-1">
          {result.passed ? 'Level Cleared!' : 'Level Failed'}
        </h2>
        <p className="text-stone text-sm mb-4">
          {result.score} of {result.maxScore} correct
          {result.reward === 0 && result.passed && isPractice && ' · Practice mode (no denarii)'}
          {!result.passed && ' · Need 60% to pass'}
        </p>
        {result.reward > 0 && (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-soft mb-4">
            <Coins size={20} className="text-gold" />
            <span className="font-display font-semibold text-gold text-lg">+{formatDenarii(result.reward)} Ð</span>
          </div>
        )}
        <div className="space-y-2">
          {result.passed && hasNext && (
            <button onClick={onContinue} className="btn-primary w-full">
              <ChevronRight size={16} className="inline mr-1" /> Continue to Level {result.nextLevel}
            </button>
          )}
          <button onClick={onBackToLevels} className={cn('w-full', result.passed && hasNext ? 'btn-ghost' : 'btn-primary')}>
            Back to Level Select
          </button>
        </div>
      </div>
    </div>
  );
}
