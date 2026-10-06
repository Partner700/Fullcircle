import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { BoardRow, BoardList } from '../../components/BoardRow';
import { TentHouseSymbol } from '../../components/TentHouseSymbol';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { LaurelWreath, MeanderBorder, SealBullet } from '../../components/AncientMotifs';
import { supabase } from '../../lib/supabase';
import { fetchBoardAvatars, fetchQuizScoreboard, fetchStreakboardSnapshots, fetchLeaderboardSnapshots, fetchRhudeBoard, fetchMarksBoard, fetchPanelImageSetting, fetchFullCircleEconomyRules } from '../../lib/queries';
import { formatDenarii, cn, formatShortDate, getTodayISODate } from '../../lib/utils';
import { resolveBoardMovement } from '../../lib/boardMovement';
import type { StreakboardSnapshot, LeaderboardWeeklySnapshot, QuizScoreboardRow, RhudeBoardRow, MarksBoardRow, FullCircleEconomyRules } from '../../lib/types';
import { Trophy, Clock, Crown, Tent as TentIcon, Flame, Shield, Coins, BadgeCheck, ArrowDown, ArrowUp, Sparkles, Info, BookOpen, Users } from 'lucide-react';
import { ChiRhoMark, GrandVallumMark, VallumText } from '../../components/ChiRhoMark';

type InstructorBoardTab = 'instructor_narratives' | 'instructor_residents' | 'instructor_marks' | 'instructor_denarii' | 'instructor_figs';
type BoardTab = 'leader' | 'streak' | 'quiz' | 'rhude' | 'marks' | 'tent_house' | InstructorBoardTab;
type BoardAudience = 'cadet' | 'sentry' | 'instructor';

type InstructorBoardRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  narratives: number;
  residents: number;
  marks: number;
  total_denarii: number;
  total_figs: number;
  rank: number;
};

type InstructorBoardKey = InstructorBoardTab;
type InstructorBoardRows = Record<InstructorBoardKey, (InstructorBoardRow & CompetitiveRow)[]>;

const INSTRUCTOR_BOARD_KEYS: InstructorBoardKey[] = [
  'instructor_narratives',
  'instructor_residents',
  'instructor_marks',
  'instructor_denarii',
  'instructor_figs',
];

const emptyInstructorBoards = (): InstructorBoardRows => ({
  instructor_narratives: [],
  instructor_residents: [],
  instructor_marks: [],
  instructor_denarii: [],
  instructor_figs: [],
});

const INSTRUCTOR_BOARD_CACHE_PREFIX = 'full-circle-instructor-camp-boards';

type TentLeaderboardRow = {
  tent_id: string;
  tent_name: string;
  tent_house_id: string | null;
  tent_profile_image_url: string | null;
  sentry_names: string[] | null;
  cadet_count: number;
  total_denarii: number;
  total_streak: number;
  total_figs?: number;
  combined_score: number;
  rank: number;
};

type StreakLeaderboardRow = StreakboardSnapshot & {
  profiles: { display_name: string; avatar_url: string | null };
};

type LiveLeaderboardRow = {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  tent_house_id: string | null;
  total_denarii: number;
  rank: number;
};

const RANK_HONOR_TINT: Record<number, { text: string; bg: string; border: string; label: string }> = {
  1: { text: 'text-brass', bg: 'bg-brass-soft', border: 'border-brass', label: 'Aureus' },
  2: { text: 'text-stone', bg: 'bg-surface-2', border: 'border-border', label: 'Argent' },
  3: { text: 'text-roman', bg: 'bg-roman/10', border: 'border-roman/40', label: 'Aes' },
};

function withBoardTimeout<T>(promise: PromiseLike<T>, label: string, milliseconds = 9_000): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} took too long to load.`)), milliseconds);
    }),
  ]);
}

function sentryLine(names: string[] | null | undefined): string | undefined {
  if (!names || names.length === 0) return undefined;
  return `Sentr${names.length === 1 ? 'y' : 'ies'}: ${names.join(', ')}`;
}

function formatMarks(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Math.max(0, Number(value) || 0));
}

type CompetitiveRow = {
  rank?: number | null;
  previous_rank?: number | null;
  rank_yesterday?: number | null;
  movement?: number | null;
  is_new_record?: boolean | null;
  new_record?: boolean | null;
  record_value?: number | null;
  personal_best?: number | null;
  previous_value?: number | null;
  value_yesterday?: number | null;
  previous_total?: number | null;
  total_yesterday?: number | null;
  previous_total_denarii?: number | null;
  previous_current_streak?: number | null;
  previous_total_score?: number | null;
  previous_rhudes?: number | null;
  previous_marks?: number | null;
  previous_combined_score?: number | null;
};

type BoardMovementRow = {
  board_key: string;
  subject_id: string;
  row_data: Record<string, unknown> | null;
  current_value: number | string;
  current_rank: number;
  previous_value: number | string;
  previous_rank: number | null;
  movement: number;
  is_new_record: boolean;
};

function previousBoardValue(row: CompetitiveRow): number | null {
  const candidates = [
    row.previous_value,
    row.value_yesterday,
    row.previous_total,
    row.total_yesterday,
    row.previous_total_denarii,
    row.previous_current_streak,
    row.previous_total_score,
    row.previous_rhudes,
    row.previous_marks,
    row.previous_combined_score,
  ];
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function rankMovement(row: CompetitiveRow, currentValue?: number): number | null {
  const previousValue = previousBoardValue(row);
  return resolveBoardMovement({
    currentValue,
    previousValue,
    currentRank: row.rank,
    previousRank: row.previous_rank ?? row.rank_yesterday,
    reportedMovement: row.movement,
  });
}

function isNewRecord(row: CompetitiveRow, value?: number) {
  if (row.is_new_record || row.new_record) return true;
  const record = Number(row.record_value ?? row.personal_best);
  return Boolean(record && typeof value === 'number' && value >= record);
}

function hydrateBoardHistory<T extends { rank?: number | null }>(
  rows: T[],
  storageKey: string,
  identityForRow: (row: T) => string,
  valueForRow: (row: T) => number,
): (T & CompetitiveRow)[] {
  if (typeof window === 'undefined') return rows as (T & CompetitiveRow)[];
  type HistoryEntry = {
    value?: number;
    max?: number;
    rank?: number | null;
    snapshot_date?: string;
    baseline_value?: number;
    baseline_rank?: number | null;
    last_value?: number;
    last_rank?: number | null;
  };
  let history: Record<string, HistoryEntry> = {};
  try { history = JSON.parse(window.localStorage.getItem(storageKey) || '{}'); } catch { history = {}; }
  const today = getTodayISODate();

  const dailyBaseline = (entry: HistoryEntry | undefined, currentValue: number, currentRank: number | null) => {
    if (!entry) return { value: currentValue, rank: currentRank };
    const observedValue = entry.last_value ?? entry.value ?? currentValue;
    const observedRank = entry.last_rank ?? entry.rank ?? currentRank;
    const sameDay = !entry.snapshot_date || entry.snapshot_date === today;
    return {
      value: sameDay ? (entry.baseline_value ?? entry.value ?? observedValue) : observedValue,
      rank: sameDay ? (entry.baseline_rank ?? entry.rank ?? observedRank) : observedRank,
    };
  };

  const enriched = rows.map((row) => {
    const key = identityForRow(row);
    const previous = history[key];
    const current = valueForRow(row);
    const currentRank = row.rank ?? null;
    const baseline = dailyBaseline(previous, current, currentRank);
    return {
      ...row,
      previous_value: (row as any).previous_value ?? baseline.value,
      previous_rank: (row as any).previous_rank ?? (row as any).rank_yesterday ?? baseline.rank,
      is_new_record: (row as any).is_new_record ?? (row as any).new_record ?? Boolean(previous && current > (previous.max ?? current)),
    } as T & CompetitiveRow;
  });
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(
      rows.map((row) => {
        const key = identityForRow(row);
        const value = valueForRow(row);
        const rank = row.rank ?? null;
        const previous = history[key];
        const baseline = dailyBaseline(previous, value, rank);
        return [key, {
          snapshot_date: today,
          baseline_value: baseline.value,
          baseline_rank: baseline.rank,
          last_value: value,
          last_rank: rank,
          value,
          rank,
          max: Math.max(value, previous?.max ?? value),
        }];
      }),
    )));
  } catch { /* private browsing can disable local storage */ }
  return enriched;
}

function rowsFromBoardPayload<T>(movements: BoardMovementRow[], boardKey: string): (T & CompetitiveRow)[] {
  return movements
    .filter((movement) => movement.board_key === boardKey)
    .map((movement) => ({
      ...(movement.row_data || {}),
      rank: Number(movement.current_rank),
      previous_value: Number(movement.previous_value),
      previous_rank: movement.previous_rank,
      movement: resolveBoardMovement({
        currentValue: movement.current_value,
        previousValue: movement.previous_value,
        currentRank: movement.current_rank,
        previousRank: movement.previous_rank,
        reportedMovement: movement.movement,
      }),
      is_new_record: Boolean(movement.is_new_record),
    })) as (T & CompetitiveRow)[];
}

function rankInstructorRows(
  rows: InstructorBoardRow[],
  boardKey: InstructorBoardKey,
  valueForRow: (row: InstructorBoardRow) => number,
) {
  let previousValue: number | null = null;
  let previousRank = 0;
  const ranked = [...rows]
    .sort((left, right) => valueForRow(right) - valueForRow(left) || left.display_name.localeCompare(right.display_name))
    .map((row, index) => {
      const value = valueForRow(row);
      const rank = previousValue !== null && value === previousValue ? previousRank : index + 1;
      previousValue = value;
      previousRank = rank;
      return { ...row, rank };
    });

  return hydrateBoardHistory(
    ranked,
    `full-circle-board-history-${boardKey.replace('instructor_', 'instructor-')}`,
    (row) => row.user_id,
    valueForRow,
  );
}

function buildInstructorBoards(rows: InstructorBoardRow[]): InstructorBoardRows {
  return {
    instructor_narratives: rankInstructorRows(rows, 'instructor_narratives', (row) => row.narratives),
    instructor_residents: rankInstructorRows(rows, 'instructor_residents', (row) => row.residents),
    instructor_marks: rankInstructorRows(rows, 'instructor_marks', (row) => row.marks),
    instructor_denarii: rankInstructorRows(rows, 'instructor_denarii', (row) => row.total_denarii),
    instructor_figs: rankInstructorRows(rows, 'instructor_figs', (row) => row.total_figs),
  };
}

function hasCompleteInstructorBoards(boards: InstructorBoardRows): boolean {
  return INSTRUCTOR_BOARD_KEYS.every((boardKey) => boards[boardKey].length > 0);
}

function readCachedInstructorBoards(userId: string | undefined): InstructorBoardRows | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(`${INSTRUCTOR_BOARD_CACHE_PREFIX}-${userId}`) || 'null');
    if (!value || typeof value !== 'object') return null;
    const boards = value as InstructorBoardRows;
    return hasCompleteInstructorBoards(boards) ? boards : null;
  } catch {
    return null;
  }
}

function writeCachedInstructorBoards(userId: string | undefined, boards: InstructorBoardRows) {
  if (!userId || typeof window === 'undefined' || !hasCompleteInstructorBoards(boards)) return;
  try {
    window.localStorage.setItem(`${INSTRUCTOR_BOARD_CACHE_PREFIX}-${userId}`, JSON.stringify(boards));
  } catch {
    // Private browsing can deny storage; the live board remains available.
  }
}

function buildInstructorFallbackBoards(
  fallbackRows: InstructorBoardRow[],
  memberRows: MarksBoardRow[],
  currentInstructor?: { id: string; display_name?: string | null; avatar_url?: string | null } | null,
): InstructorBoardRows {
  const memberTotals = memberRows.reduce((totals, row) => ({
    marks: totals.marks + Number(row.marks || 0),
    denarii: totals.denarii + Number(row.total_denarii || 0),
    figs: totals.figs + Number(row.total_figs || 0),
  }), { marks: 0, denarii: 0, figs: 0 });

  const sourceRows = fallbackRows.length > 0
    ? fallbackRows
    : currentInstructor?.id
      ? [{
        user_id: currentInstructor.id,
        display_name: currentInstructor.display_name || 'Instructor',
        avatar_url: currentInstructor.avatar_url || null,
        narratives: 0,
        residents: memberRows.length,
        marks: 0,
        total_denarii: 0,
        total_figs: 0,
        rank: 1,
      }]
      : [];

  const completeRows = sourceRows.map((row) => ({
    ...row,
    narratives: Number(row.narratives || 0),
    residents: Number(row.residents || 0),
    marks: memberTotals.marks + Number(row.narratives || 0) + Number(row.residents || 0) * 5,
    total_denarii: memberTotals.denarii,
    total_figs: memberTotals.figs,
  }));

  return buildInstructorBoards(completeRows);
}

function BoardMovementSummary({ rows, valueForRow }: { rows: CompetitiveRow[]; valueForRow?: (row: CompetitiveRow) => number }) {
  const up = rows.filter((row) => Number(rankMovement(row, valueForRow?.(row))) > 0).length;
  const down = rows.filter((row) => Number(rankMovement(row, valueForRow?.(row))) < 0).length;
  const records = rows.filter((row) => isNewRecord(row, valueForRow?.(row))).length;
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-lg border border-sage/25 bg-sage/10 px-3 py-2">
        <p className="flex items-center gap-1 text-[10px] font-black uppercase text-sage"><ArrowUp size={12} /> Rising</p>
        <p className="mt-1 font-display text-xl font-black text-ink">{up}</p>
      </div>
      <div className="rounded-lg border border-coral/25 bg-coral/10 px-3 py-2">
        <p className="flex items-center gap-1 text-[10px] font-black uppercase text-coral"><ArrowDown size={12} /> Falling</p>
        <p className="mt-1 font-display text-xl font-black text-ink">{down}</p>
      </div>
      <div className="rounded-lg border border-gold/25 bg-gold/10 px-3 py-2">
        <p className="flex items-center gap-1 text-[10px] font-black uppercase text-gold"><Sparkles size={12} /> Records</p>
        <p className="mt-1 font-display text-xl font-black text-ink">{records}</p>
      </div>
    </div>
  );
}

export function CadetLeaderboard({ instructorMode = false, allowAudienceSwitch = false }: { instructorMode?: boolean; allowAudienceSwitch?: boolean } = {}) {
  const { profile } = useAuth();
  const [tab, setTab] = useState<BoardTab>(() => instructorMode ? 'instructor_narratives' : 'streak');
  const [audience, setAudience] = useState<BoardAudience>(() => instructorMode ? 'instructor' : 'cadet');
  const [streakRows, setStreakRows] = useState<StreakLeaderboardRow[]>([]);
  const [leaderRows, setLeaderRows] = useState<(LeaderboardWeeklySnapshot & { profiles: { display_name: string; avatar_url?: string | null } })[]>([]);
  const [liveRows, setLiveRows] = useState<LiveLeaderboardRow[]>([]);
  const [tentRows, setTentRows] = useState<TentLeaderboardRow[]>([]);
  const [quizRows, setQuizRows] = useState<QuizScoreboardRow[]>([]);
  const [rhudeRows, setRhudeRows] = useState<RhudeBoardRow[]>([]);
  const [marksRows, setMarksRows] = useState<MarksBoardRow[]>([]);
  const [economyRules, setEconomyRules] = useState<FullCircleEconomyRules | null>(null);
  const [marksInfoOpen, setMarksInfoOpen] = useState(false);
  const [instructorBoards, setInstructorBoards] = useState<InstructorBoardRows>(emptyInstructorBoards);
  const [boardImage, setBoardImage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const loadsInFlightRef = useRef<Set<BoardAudience>>(new Set());
  const lastInstructorBoardsRef = useRef<InstructorBoardRows | null>(null);
  const lastStreakRowsRef = useRef<StreakLeaderboardRow[]>([]);

  const load = useCallback(async (silent = false) => {
    if (silent && typeof document !== 'undefined' && document.body.dataset.fullCircleMessengerOpen === 'true') return;
    const requestedAudience = audience;
    if (loadsInFlightRef.current.has(requestedAudience)) return;
    loadsInFlightRef.current.add(requestedAudience);
    if (!silent) setLoading(true);
    try {
      if (requestedAudience === 'instructor') {
        const applyInstructorBoards = (boards: InstructorBoardRows) => {
          if (!hasCompleteInstructorBoards(boards)) return false;
          lastInstructorBoardsRef.current = boards;
          setInstructorBoards(boards);
          writeCachedInstructorBoards(profile?.id, boards);
          setLastUpdatedAt(new Date());
          setLoading(false);
          return true;
        };

        // The current camp total is the small, authoritative request. Show it
        // first; movement history must never hold the board UI hostage.
        const currentTotalsResult = await withBoardTimeout(
          supabase.rpc('get_current_instructor_camp_totals'),
          'Current instructor camp totals',
          7_000,
        ).catch(() => null);
        const currentTotals = currentTotalsResult && !currentTotalsResult.error
          ? (currentTotalsResult.data || []) as InstructorBoardRow[]
          : [];
        let hasDisplayedTotals = currentTotals.length > 0
          ? applyInstructorBoards(buildInstructorBoards(currentTotals))
          : false;

        if (!hasDisplayedTotals) {
          const retainedBoards = lastInstructorBoardsRef.current || readCachedInstructorBoards(profile?.id);
          if (retainedBoards) hasDisplayedTotals = applyInstructorBoards(retainedBoards);
        }

        const movementRequest = withBoardTimeout(
          supabase.rpc('get_instructor_competitive_boards'),
          'Instructor board movement history',
          12_000,
        ).catch(() => null);
        const movementResult = await movementRequest;
        const movements = movementResult && !movementResult.error
          ? (movementResult.data || []) as BoardMovementRow[]
          : [];
        const movementBoards: InstructorBoardRows = {
          instructor_narratives: rowsFromBoardPayload<InstructorBoardRow>(movements, 'instructor_narratives'),
          instructor_residents: rowsFromBoardPayload<InstructorBoardRow>(movements, 'instructor_residents'),
          instructor_marks: rowsFromBoardPayload<InstructorBoardRow>(movements, 'instructor_marks'),
          instructor_denarii: rowsFromBoardPayload<InstructorBoardRow>(movements, 'instructor_denarii'),
          instructor_figs: rowsFromBoardPayload<InstructorBoardRow>(movements, 'instructor_figs'),
        };
        if (applyInstructorBoards(movementBoards)) {
          hasDisplayedTotals = true;
        } else if (!hasDisplayedTotals) {
          const [challengeResult, marksResult] = await Promise.allSettled([
            withBoardTimeout(supabase.rpc('get_instructor_challenge_board_live'), 'Instructor board fallback'),
            withBoardTimeout(fetchMarksBoard(), 'Instructor camp totals fallback'),
          ]);
          const challengeResponse = challengeResult.status === 'fulfilled' ? challengeResult.value : null;
          const fallbackRows = challengeResponse && !challengeResponse.error
            ? (challengeResponse.data || []) as InstructorBoardRow[]
            : [];
          const memberRows = marksResult.status === 'fulfilled' ? marksResult.value : [];
          applyInstructorBoards(buildInstructorFallbackBoards(fallbackRows, memberRows, profile));
        }
        setStreakRows([]); setLeaderRows([]); setLiveRows([]); setQuizRows([]); setRhudeRows([]); setMarksRows([]);
        setLastUpdatedAt(new Date());
        return;
      }

      const memberAudience: Exclude<BoardAudience, 'instructor'> = requestedAudience;

      const [leaders, boardMovements, independentStreaks] = await Promise.allSettled([
        withBoardTimeout(fetchLeaderboardSnapshots(), 'Weekly board'),
        withBoardTimeout(supabase.rpc('get_competitive_board_movements', { p_audience: memberAudience }), 'Challenge boards'),
        // The streak board has its own quick, published feed so a slow
        // movement query can never hide it from sentries.
        withBoardTimeout(fetchStreakboardSnapshots(memberAudience), 'Streak board', 5_500),
      ]);
      const leaderRowsRaw = leaders.status === 'fulfilled' ? leaders.value : [];
      setLeaderRows(leaderRowsRaw as any);

      const movementResult = boardMovements.status === 'fulfilled' ? boardMovements.value : null;
      const authoritativeMovements = movementResult && !movementResult.error
        ? ((movementResult.data || []) as BoardMovementRow[])
        : [];
      const independentStreakRows = independentStreaks.status === 'fulfilled'
        ? independentStreaks.value
        : [];

      let streakRowsWithHistory: (StreakLeaderboardRow & CompetitiveRow)[];
      let liveRowsWithHistory: (LiveLeaderboardRow & CompetitiveRow)[];
      let tentRowsWithHistory: (TentLeaderboardRow & CompetitiveRow)[];
      let quizRowsWithHistory: (QuizScoreboardRow & CompetitiveRow)[];
      let rhudeRowsWithHistory: (RhudeBoardRow & CompetitiveRow)[];
      let marksRowsWithHistory: (MarksBoardRow & CompetitiveRow)[];
      const historyPrefix = `full-circle-board-history-${memberAudience}`;

      if (authoritativeMovements.length > 0) {
        streakRowsWithHistory = rowsFromBoardPayload<StreakLeaderboardRow>(authoritativeMovements, 'streak');
        liveRowsWithHistory = rowsFromBoardPayload<LiveLeaderboardRow>(authoritativeMovements, 'denarii');
        tentRowsWithHistory = rowsFromBoardPayload<TentLeaderboardRow>(authoritativeMovements, 'tent');
        quizRowsWithHistory = rowsFromBoardPayload<QuizScoreboardRow>(authoritativeMovements, 'figs');
        rhudeRowsWithHistory = rowsFromBoardPayload<RhudeBoardRow>(authoritativeMovements, 'rhude');
        marksRowsWithHistory = rowsFromBoardPayload<MarksBoardRow>(authoritativeMovements, 'marks');

        // A partial movement payload must never make the primary board vanish.
        // Recover the live streak rows independently while retaining the other
        // authoritative boards that did arrive.
        if (independentStreakRows.length > 0) {
          streakRowsWithHistory = hydrateBoardHistory(
            independentStreakRows,
            `${historyPrefix}-streak`,
            (row) => row.user_id,
            (row) => Number(row.current_streak ?? row.consistency ?? 0),
          );
        } else if (
          streakRowsWithHistory.length === 0
          || streakRowsWithHistory.some((row) => !row.user_id || !row.profiles?.display_name)
        ) {
          const streakFallback = await Promise.allSettled([
            withBoardTimeout(fetchStreakboardSnapshots(memberAudience), 'Streak board recovery'),
          ]);
          const streakRowsRaw = streakFallback[0].status === 'fulfilled' ? streakFallback[0].value : [];
          if (streakRowsRaw.length > 0) {
            streakRowsWithHistory = hydrateBoardHistory(
              streakRowsRaw,
              `${historyPrefix}-streak`,
              (row) => row.user_id,
              (row) => Number(row.current_streak ?? row.consistency ?? 0),
            );
          }
        }
      } else {
        // Keep the existing board RPCs as a rollout fallback until the new
        // migration reaches production. Once deployed, phones use one payload.
        const [live, tents, quizBoard, rhudes, marks] = await Promise.allSettled([
          withBoardTimeout(supabase.rpc('get_leaderboard_live_for_role', { p_role: memberAudience }), 'Denarii board fallback'),
          withBoardTimeout(supabase.rpc('get_tent_leaderboard'), 'Tent board fallback'),
          withBoardTimeout(fetchQuizScoreboard(memberAudience), 'Fig board fallback'),
          withBoardTimeout(fetchRhudeBoard(), 'Valley board fallback'),
          withBoardTimeout(fetchMarksBoard(), 'Marks board fallback'),
        ]);
        const liveResult = live.status === 'fulfilled' ? live.value as { data?: unknown } : null;
        const tentResult = tents.status === 'fulfilled' ? tents.value as { data?: unknown } : null;
        const liveRowsRaw = ((liveResult?.data || []) as typeof liveRows);
        const tentRowsRaw = (tentResult?.data || []) as TentLeaderboardRow[];
        const quizRowsRaw = (quizBoard.status === 'fulfilled' ? quizBoard.value : []).filter((row: any) => !row.role || row.role === memberAudience);
        const rhudeRowsRaw = (rhudes.status === 'fulfilled' ? rhudes.value : []).filter((row: any) => row.role === memberAudience);
        const marksRowsRaw = (marks.status === 'fulfilled' ? marks.value : []).filter((row: any) => row.role === memberAudience);
        streakRowsWithHistory = hydrateBoardHistory(independentStreakRows, `${historyPrefix}-streak`, (row) => row.user_id, (row) => Number(row.current_streak ?? row.consistency ?? 0));
        liveRowsWithHistory = hydrateBoardHistory(liveRowsRaw, `${historyPrefix}-denarii`, (row) => row.user_id, (row) => Number(row.total_denarii ?? 0));
        tentRowsWithHistory = hydrateBoardHistory(tentRowsRaw, 'full-circle-board-history-tent', (row) => row.tent_id, (row) => Number(row.combined_score ?? 0));
        quizRowsWithHistory = hydrateBoardHistory(quizRowsRaw, `${historyPrefix}-figs`, (row) => row.user_id, (row) => Number(row.total_score ?? 0));
        rhudeRowsWithHistory = hydrateBoardHistory(rhudeRowsRaw, `${historyPrefix}-rhude`, (row) => row.user_id, (row) => Number(row.rhudes ?? 0));
        marksRowsWithHistory = hydrateBoardHistory(marksRowsRaw, `${historyPrefix}-marks`, (row) => row.user_id, (row) => Number(row.marks ?? 0));
      }

      if (streakRowsWithHistory.length > 0) {
        lastStreakRowsRef.current = streakRowsWithHistory;
        setStreakRows(streakRowsWithHistory);
      } else if (lastStreakRowsRef.current.length > 0) {
        // Preserve the last usable board through a brief network hiccup.
        setStreakRows(lastStreakRowsRef.current);
      }
	      setLiveRows(liveRowsWithHistory);
	      setTentRows(tentRowsWithHistory);
	      setQuizRows(quizRowsWithHistory);
        setRhudeRows(rhudeRowsWithHistory);
        setMarksRows(marksRowsWithHistory);
        setLastUpdatedAt(new Date());

        // Render board rows immediately, then fill in only the missing public
        // avatars. This avoids blocking the board on a full profile download.
        const boardUserIds = [
          ...streakRowsWithHistory.map((row) => row.user_id),
          ...leaderRowsRaw.map((row) => row.user_id),
          ...liveRowsWithHistory.map((row) => row.user_id),
          ...quizRowsWithHistory.map((row) => row.user_id),
          ...rhudeRowsWithHistory.map((row) => row.user_id),
          ...marksRowsWithHistory.map((row) => row.user_id),
        ];
        void withBoardTimeout(fetchBoardAvatars(boardUserIds), 'Board pictures', 5_000)
          .then((avatars) => {
            setStreakRows((rows) => rows.map((row) => ({
              ...row,
              profiles: { ...row.profiles, avatar_url: row.profiles?.avatar_url || avatars[row.user_id] || null },
            })));
            setLeaderRows((rows) => rows.map((row: any) => ({
              ...row,
              profiles: { ...row.profiles, avatar_url: row.profiles?.avatar_url || avatars[row.user_id] || null },
            })) as any);
            setLiveRows((rows) => rows.map((row) => ({ ...row, avatar_url: row.avatar_url || avatars[row.user_id] || null })));
            setQuizRows((rows) => rows.map((row: any) => ({ ...row, avatar_url: row.avatar_url || avatars[row.user_id] || null })));
            setRhudeRows((rows) => rows.map((row) => ({ ...row, avatar_url: row.avatar_url || avatars[row.user_id] || null })));
            setMarksRows((rows) => rows.map((row) => ({ ...row, avatar_url: row.avatar_url || avatars[row.user_id] || null })));
          })
          .catch(() => undefined);
    } catch (e) { console.error('Leaderboard load error:', e); }
    finally {
      loadsInFlightRef.current.delete(requestedAudience);
      setLoading(false);
    }
      }, [audience, profile]);

  useEffect(() => {
    if (!instructorMode || audience !== 'instructor') return;
    const cached = readCachedInstructorBoards(profile?.id);
    if (!cached) return;
    lastInstructorBoardsRef.current = cached;
    setInstructorBoards((current) => hasCompleteInstructorBoards(current) ? current : cached);
    setLoading(false);
  }, [audience, instructorMode, profile?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    fetchPanelImageSetting('leaderboard')
      .then((image) => { if (!cancelled) setBoardImage(image); })
      .catch(() => { if (!cancelled) setBoardImage(null); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!instructorMode) return;
    let cancelled = false;
    fetchFullCircleEconomyRules()
      .then((rules) => { if (!cancelled) setEconomyRules(rules); })
      .catch(() => { if (!cancelled) setEconomyRules(null); });
    return () => { cancelled = true; };
  }, [instructorMode]);
  useEffect(() => {
    const refreshWhenAvailable = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void load(true);
    };
    const interval = window.setInterval(() => {
      refreshWhenAvailable();
    }, 60_000);
    window.addEventListener('online', refreshWhenAvailable);
    document.addEventListener('visibilitychange', refreshWhenAvailable);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', refreshWhenAvailable);
      document.removeEventListener('visibilitychange', refreshWhenAvailable);
    };
  }, [load]);

  const instructorTabs: Array<{
    key: InstructorBoardTab;
    label: string;
    title: string;
    description: string;
    valueKey: 'narratives' | 'residents' | 'marks' | 'total_denarii' | 'total_figs';
    valueLabel: string;
    icon: React.ReactNode;
  }> = [
    { key: 'instructor_narratives', label: 'Narrative', title: 'Narrative Board', description: 'Every published camp narrative adds 1 instructor-board Mark.', valueKey: 'narratives', valueLabel: 'Narratives', icon: <BookOpen size={16} /> },
    { key: 'instructor_residents', label: 'Residents', title: 'Resident Board', description: 'Every active Resident adds 5 instructor-board Marks.', valueKey: 'residents', valueLabel: 'Residents', icon: <Users size={16} /> },
    { key: 'instructor_marks', label: 'Marks', title: 'Overall Camp Marks', description: 'All member Marks, plus Narrative and Resident Marks for the camp.', valueKey: 'marks', valueLabel: 'Camp Marks', icon: <ChiRhoMark size={16} /> },
    { key: 'instructor_denarii', label: 'Denarii', title: 'Camp Denarii Board', description: 'The overall Denarii held across the instructor\'s camp.', valueKey: 'total_denarii', valueLabel: 'Camp Denarii', icon: <Coins size={16} /> },
    { key: 'instructor_figs', label: 'Figs', title: 'Camp Fig Board', description: 'The overall lifetime Figs earned across the instructor\'s camp.', valueKey: 'total_figs', valueLabel: 'Camp Figs', icon: <BadgeCheck size={16} /> },
  ];
  const activeInstructorBoard = instructorTabs.find((item) => item.key === tab) || instructorTabs[0];
  const activeInstructorRows = instructorBoards[activeInstructorBoard.key];

  const tabs: Array<{ key: BoardTab; label: string; icon: React.ReactNode }> = audience === 'instructor'
    ? instructorTabs
    : [
      { key: 'streak', label: 'Streak Board', icon: <Flame size={16} /> },
      { key: 'leader', label: 'Denarii Board', icon: <Coins size={16} /> },
      { key: 'quiz', label: 'Fig Board', icon: <BadgeCheck size={16} /> },
      { key: 'rhude', label: 'Valley Board', icon: <Shield size={16} /> },
      ...(instructorMode ? [{ key: 'marks' as BoardTab, label: 'Leaderboard', icon: <ChiRhoMark size={16} /> }] : []),
      { key: 'tent_house', label: 'Tent Board', icon: <TentIcon size={16} /> },
    ];

  const BoardPanel = ({ children, className = 'p-4' }: { children: ReactNode; className?: string }) => (
    <div data-artwork-theme={(boardImage)?.url ? 'night' : undefined} className={cn('card relative overflow-hidden', className)}>
      <PanelImageBackdrop image={boardImage} opacityFallback={100} veilClassName="welcome-slide-veil" modeFilter={false} textGradient={false} />
      <div className="relative z-10">{children}</div>
    </div>
  );

  const boardNavigation = (
    <div data-artwork-theme={(boardImage)?.url ? 'night' : undefined} className="card relative overflow-hidden p-3">
      <PanelImageBackdrop image={boardImage} opacityFallback={100} veilClassName="welcome-slide-veil" modeFilter={false} textGradient={false} />
      <div className="relative z-10 mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Challenge Boards</p>
          <h2 className="font-display text-xl font-black text-ink">Competitive tables</h2>
        </div>
        <div className="flex items-center gap-2">
          {(allowAudienceSwitch || instructorMode) && (
            <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="group" aria-label="Board audience">
              <button type="button" onClick={() => { setAudience('cadet'); setTab('streak'); }} className={cn('rounded-md px-2.5 py-1.5 text-[10px] font-bold transition-colors', audience === 'cadet' ? 'bg-brass-soft text-brass' : 'text-stone hover:text-ink')}>Cadet Boards</button>
              <button type="button" onClick={() => { setAudience('sentry'); setTab('streak'); }} className={cn('rounded-md px-2.5 py-1.5 text-[10px] font-bold transition-colors', audience === 'sentry' ? 'bg-brass-soft text-brass' : 'text-stone hover:text-ink')}>Sentry Boards</button>
              {instructorMode && <button type="button" onClick={() => { setAudience('instructor'); setTab('instructor_narratives'); }} className={cn('rounded-md px-2.5 py-1.5 text-[10px] font-bold transition-colors', audience === 'instructor' ? 'bg-brass-soft text-brass' : 'text-stone hover:text-ink')}>Instructor Boards</button>}
            </div>
          )}
          <span className="badge badge-brass text-[10px]">Camp Stats</span>
        </div>
      </div>
      <div className="relative z-10 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {tabs.map((item) => (
          <BoardTabButton key={item.key} active={tab === item.key} onClick={() => setTab(item.key)} icon={item.icon} label={item.label} />
        ))}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        {boardNavigation}
        <div className="card py-12 text-center text-stone">Loading the Streak Board…</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {boardNavigation}

      {instructorMode && audience === 'instructor' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-royal">{activeInstructorBoard.icon}</span>
              <h3 className="font-display font-semibold text-ink">{activeInstructorBoard.title}</h3>
              <span className="badge badge-brass text-[10px]">Camp-wide</span>
            </div>
            <p className="text-xs text-stone">{activeInstructorBoard.description}</p>
          </BoardPanel>
          {activeInstructorRows.length > 0 ? (
            <BoardPanel>
              <BoardMovementSummary
                rows={activeInstructorRows}
                valueForRow={(row) => Number((row as InstructorBoardRow)[activeInstructorBoard.valueKey] || 0)}
              />
              <div className="mt-4" />
              <BoardList>
                {activeInstructorRows.map((row) => {
                  const value = Number(row[activeInstructorBoard.valueKey] || 0);
                  const formattedValue = activeInstructorBoard.valueKey === 'total_denarii'
                    ? formatDenarii(value)
                    : `${formatMarks(value)} ${activeInstructorBoard.valueLabel}`;
                  return (
                    <BoardRow
                      key={row.user_id}
                      rank={row.rank}
                      name={row.display_name}
                      value={formattedValue}
                      userId={row.user_id}
                      avatarUrl={row.avatar_url}
                      currentUserId={profile?.id}
                      isCurrentUser={row.user_id === profile?.id}
                      movement={rankMovement(row, value)}
                      isRecord={isNewRecord(row, value)}
                      valueLabel={activeInstructorBoard.valueLabel}
                    />
                  );
                })}
              </BoardList>
            </BoardPanel>
          ) : <EmptyState icon={(props) => <ChiRhoMark size={props.size} className={props.className || ''} />} title="No instructor data yet" message="Camp activity will appear here as Narrative, Resident, Mark, Denarii, and Fig totals are recorded." />}
        </div>
      )}

      {/* Denarii Leaderboard (live) */}
      {audience !== 'instructor' && tab === 'leader' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <Coins size={20} className="text-gold" />
              <h3 className="font-display font-semibold text-ink">Denarii Challenge Board</h3>
              <span className="badge badge-brass text-[10px]">Live</span>
            </div>
            <p className="text-xs text-stone">
              Updates in real time as cadets play and submit quizzes. Tent symbols appear beside each name.
            </p>
          </BoardPanel>

          {liveRows.length > 0 ? (
            <BoardPanel>
              <BoardMovementSummary rows={liveRows as CompetitiveRow[]} valueForRow={(row) => Number((row as any).total_denarii)} />
              <div className="mt-4" />
              <BoardList>
                {liveRows.map((row, i) => {
                  const rank = row.rank || i + 1;
                  const isPodium = false;
                  const tint = RANK_HONOR_TINT[rank];

                  if (isPodium && tint) {
                    return (
                      <div
                        key={row.user_id}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
                          row.user_id === profile?.id
                            ? 'border-brass bg-brass-soft'
                            : cn(tint.border, 'bg-surface hover:border-border-bright'),
                        )}
                      >
                        <div className={cn('flex items-center gap-2 flex-shrink-0', tint.text)}>
                          <LaurelWreath size={28} />
                          <span className="font-display font-semibold text-sm w-5 text-center">{rank}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn('text-sm font-medium truncate', row.user_id === profile?.id ? 'text-brass' : 'text-ink')}>
                              {row.display_name}
                            </p>
                            {row.tent_house_id && <TentHouseSymbol houseId={row.tent_house_id} size={18} className="flex-shrink-0" />}
                          </div>
                          <span className="text-xs text-stone">{tint.label} honor</span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-sm font-medium text-ink">{formatDenarii(row.total_denarii)}</span>
                          <p className="text-[10px] text-stone">denarii</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <BoardRow
                      key={row.user_id}
                      rank={rank}
                      name={row.display_name}
                      value={formatDenarii(row.total_denarii)}
                      houseId={row.tent_house_id || undefined}
                      isCurrentUser={row.user_id === profile?.id}
                      userId={row.user_id}
                      avatarUrl={(row as any).avatar_url}
                      currentUserId={profile?.id}
                      movement={rankMovement(row as CompetitiveRow, Number(row.total_denarii))}
                      isRecord={isNewRecord(row as CompetitiveRow, Number(row.total_denarii))}
                      valueLabel="Denarii"
                    />
                  );
                })}
              </BoardList>
            </BoardPanel>
          ) : (
            <EmptyState icon={(props) => <Trophy {...props} />} title="No data yet" message="Play Daily Trivia or take the Saturday quiz to appear on the board." />
          )}

          {leaderRows.length > 0 && (
            <>
              <div className="text-stone"><MeanderBorder /></div>
              <BoardPanel>
                <SectionHeader
                  title="Last Week's Result"
                  subtitle={`Frozen at Saturday 6 PM · Week ending ${formatShortDate(leaderRows[0].week_ending)}`}
                />
                <BoardList>
                  {leaderRows.map((row) => (
                    <BoardRow
                      key={row.id}
                      rank={row.rank}
                      name={row.profiles.display_name}
                      value={formatDenarii(Number(row.total_denarii))}
                      houseId={row.tent_house_id || undefined}
                      isCurrentUser={row.user_id === profile?.id}
                      userId={row.user_id}
                      avatarUrl={row.profiles.avatar_url}
                      currentUserId={profile?.id}
                    />
                  ))}
                </BoardList>
              </BoardPanel>
            </>
          )}
        </div>
      )}

      {/* Streak Board */}
      {audience !== 'instructor' && tab === 'streak' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <Flame size={20} className="text-roman" />
              <h3 className="font-display font-semibold text-ink">Streak Challenge Board</h3>
              <span className="badge badge-moss text-[10px] inline-flex items-center gap-1">
                <Clock size={10} /> Live
              </span>
            </div>
            <p className="text-xs text-stone">
              Always on. Ranks by current streak, longest streak, then total valid days. Tent symbols appear beside each name.
            </p>
          </BoardPanel>

          {streakRows.length > 0 ? (
            <BoardPanel>
              <BoardMovementSummary rows={streakRows as unknown as CompetitiveRow[]} valueForRow={(row) => Number((row as any).current_streak ?? (row as any).consistency ?? 0)} />
              <p className="text-xs text-stone mb-3">
                Live as of {(lastUpdatedAt || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {formatShortDate(streakRows[0].snapshot_date)}
              </p>
              <BoardList>
                {streakRows.map((row) => {
                  const isPodium = false;
                  const tint = RANK_HONOR_TINT[row.rank];
                  const currentStreak = Number(row.current_streak ?? row.consistency ?? 0);
                  const longestStreak = Number(row.longest_streak ?? row.consistency ?? currentStreak);
                  const validDays = Number(row.volume ?? 0);
                  const consecutiveInactive = Number(row.consecutive_inactive ?? 0);
                  const cumulativeInactive = Number(row.cumulative_inactive ?? 0);
                  const streakSubtext = `Best ${longestStreak} · Valid ${validDays} · Missed ${cumulativeInactive}`;

                  if (isPodium && tint) {
                    return (
                      <div
                        key={row.id || row.user_id}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
                          row.user_id === profile?.id
                            ? 'border-brass bg-brass-soft'
                            : cn(tint.border, 'bg-surface hover:border-border-bright'),
                        )}
                      >
                        <div className={cn('flex items-center gap-2 flex-shrink-0', tint.text)}>
                          <LaurelWreath size={28} />
                          <span className="font-display font-semibold text-sm w-5 text-center">{row.rank}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn('text-sm font-medium truncate', row.user_id === profile?.id ? 'text-brass' : 'text-ink')}>
                              {row.profiles?.display_name || 'Camp member'}
                            </p>
                            {row.tent_house_id && <TentHouseSymbol houseId={row.tent_house_id} size={18} className="flex-shrink-0" />}
                          </div>
                          <span className="text-xs text-stone">{streakSubtext}</span>
                          {consecutiveInactive > 0 && (
                            <p className="text-[11px] text-roman mt-0.5">{consecutiveInactive} consecutive missed day{consecutiveInactive === 1 ? '' : 's'}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-sm font-medium text-ink">{currentStreak}</span>
                          <p className="text-[10px] text-stone">current streak</p>
                          <p className="text-[10px] text-stone">best {longestStreak}</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <BoardRow
                      key={row.id || row.user_id}
                      rank={row.rank}
                      name={row.profiles?.display_name || 'Camp member'}
                      value={`${currentStreak}`}
                      houseId={row.tent_house_id || undefined}
                      isCurrentUser={row.user_id === profile?.id}
                      userId={row.user_id}
                      avatarUrl={row.profiles?.avatar_url || null}
                      currentUserId={profile?.id}
                      movement={rankMovement(row as unknown as CompetitiveRow, currentStreak)}
                      isRecord={isNewRecord(row as unknown as CompetitiveRow, currentStreak)}
                      valueLabel="Streak"
                    />
                  );
                })}
              </BoardList>

              <div className="text-stone mt-4"><MeanderBorder /></div>
              <ul className="mt-3 space-y-1.5 text-xs text-stone">
                <li className="flex items-start gap-2">
                  <SealBullet className="text-brass mt-1 flex-shrink-0" />
                  <span><span className="text-ink font-medium">Volume</span> — total valid days this cycle.</span>
                </li>
                <li className="flex items-start gap-2">
                  <SealBullet className="text-brass mt-1 flex-shrink-0" />
                  <span><span className="text-ink font-medium">Consistency</span> — longest unbroken streak.</span>
                </li>
                <li className="flex items-start gap-2">
                  <SealBullet className="text-brass mt-1 flex-shrink-0" />
                  <span><span className="text-ink font-medium">Improvement</span> — trend versus prior window.</span>
                </li>
              </ul>
            </BoardPanel>
          ) : (
            <EmptyState icon={(props) => <Crown {...props} />} title="No streak data yet" message="The live streak board is on. Complete today's streak actions to appear here." />
          )}
        </div>
      )}

      {/* Fig Board */}
      {audience !== 'instructor' && tab === 'quiz' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <BadgeCheck size={20} className="text-royal" />
              <h3 className="font-display font-semibold text-ink">Fig Board</h3>
              <span className="badge badge-neutral text-[10px] inline-flex items-center gap-1">
                <Clock size={10} /> Saturday 4 PM
              </span>
            </div>
            <p className="text-xs text-stone">
              Daily game figs, arena figs, and fortune quiz figs update live. Saturday quiz figs join the board at 4:00 PM.
            </p>
          </BoardPanel>

          {quizRows.length > 0 ? (
            <BoardPanel>
              <BoardMovementSummary rows={quizRows as unknown as CompetitiveRow[]} valueForRow={(row) => Number((row as any).total_score ?? 0)} />
              <div className="mt-4" />
              <BoardList>
                {quizRows.map((row) => {
                  const isPodium = false;
                  const tint = RANK_HONOR_TINT[row.rank];
                  const subtext = `Figs total`;

                  if (isPodium && tint) {
                    return (
                      <div
                        key={row.user_id}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
                          row.user_id === profile?.id
                            ? 'border-brass bg-brass-soft'
                            : cn(tint.border, 'bg-surface hover:border-border-bright'),
                        )}
                      >
                        <div className={cn('flex items-center gap-2 flex-shrink-0', tint.text)}>
                          <LaurelWreath size={28} />
                          <span className="font-display font-semibold text-sm w-5 text-center">{row.rank}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn('text-sm font-medium truncate', row.user_id === profile?.id ? 'text-brass' : 'text-ink')}>
                              {row.display_name}
                            </p>
                            {row.tent_house_id && <TentHouseSymbol houseId={row.tent_house_id} size={18} className="flex-shrink-0" />}
                          </div>
                          <span className="text-xs text-stone">{subtext}</span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-sm font-medium text-ink">{row.total_score}</span>
                          <p className="text-[10px] text-stone">figs</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <BoardRow
                      key={row.user_id}
                      rank={row.rank}
                      name={row.display_name}
                      value={`${row.total_score}`}
                      houseId={row.tent_house_id || undefined}
                      isCurrentUser={row.user_id === profile?.id}
                      userId={row.user_id}
                      avatarUrl={(row as any).avatar_url}
                      currentUserId={profile?.id}
                      movement={rankMovement(row as unknown as CompetitiveRow, Number(row.total_score))}
                      isRecord={isNewRecord(row as unknown as CompetitiveRow, Number(row.total_score))}
                      valueLabel="Figs"
                    />
                  );
                })}
              </BoardList>
            </BoardPanel>
          ) : (
            <EmptyState
              icon={(props) => <BadgeCheck {...props} />}
              title="Fig Board ready"
              message="Cadets appear here once assigned. Daily game, arena, and fortune quiz figs update live; Saturday quiz figs join at 4:00 PM."
            />
          )}
        </div>
      )}

      {/* Valley Board */}
      {audience !== 'instructor' && tab === 'rhude' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <Shield size={20} className="text-sage" />
              <h3 className="font-display font-semibold text-ink">Valley Board</h3>
              <span className="badge badge-moss text-[10px]">Arena Victories</span>
            </div>
            <p className="text-xs text-stone">
              Rhudes measure Arena victories. Cadets and sentries both appear here.
            </p>
          </BoardPanel>

          {rhudeRows.length > 0 ? (
            <BoardPanel>
              <BoardMovementSummary rows={rhudeRows as unknown as CompetitiveRow[]} valueForRow={(row) => Number((row as any).rhudes ?? 0)} />
              <div className="mt-4" />
              <BoardList>
                {rhudeRows.map((row) => (
                  <BoardRow
                    key={row.user_id}
                    rank={row.rank}
                    name={row.display_name}
                    value={`${row.rhudes} ${Number(row.rhudes) === 1 ? 'Rhude' : 'Rhudes'}`}
                    houseId={row.tent_house_id || undefined}
                    isCurrentUser={row.user_id === profile?.id}
                    userId={row.user_id}
                    avatarUrl={(row as any).avatar_url}
                    currentUserId={profile?.id}
                    movement={rankMovement(row as unknown as CompetitiveRow, Number(row.rhudes))}
                    isRecord={isNewRecord(row as unknown as CompetitiveRow, Number(row.rhudes))}
                    valueLabel="Rhudes"
                  />
                ))}
              </BoardList>
            </BoardPanel>
          ) : (
            <EmptyState icon={(props) => <Shield {...props} />} title="No Rhudes yet" message="One Rhude is added for every Arena victory. Victors appear here as soon as a match is settled." />
          )}
        </div>
      )}

      {/* Instructor Leaderboard */}
      {instructorMode && audience !== 'instructor' && tab === 'marks' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <GrandVallumMark size={23} className="text-brass" />
              <h3 className="font-display font-semibold text-ink">Leaderboard</h3>
              <span className="badge badge-brass text-[10px]">Grand Total</span>
              <button
                type="button"
                onClick={() => setMarksInfoOpen((open) => !open)}
                className="btn-ghost ml-auto h-8 w-8 p-0"
                aria-label="Explain Marks"
                aria-expanded={marksInfoOpen}
                title="Explain Marks"
              >
                <Info size={16} />
              </button>
            </div>
            <p className="text-xs text-stone">
              <VallumText text="Marks normalize earned achievements without consuming them. This powers Rumor, Vallum, and Grand Vallum tracking." size={11} />
            </p>
            {marksInfoOpen && economyRules && (
              <div className="mt-3 rounded-lg border border-border bg-surface/80 px-3 py-2 text-xs leading-relaxed text-stone">
                <p className="font-bold text-ink">1 Mark equals</p>
                <p>{formatMarks(economyRules.streaks_per_mark)} qualifying Streak day · {formatMarks(economyRules.talents_per_mark)} Talent · {formatMarks(economyRules.rhudes_per_mark)} Rhudes · {formatMarks(economyRules.figs_per_mark)} Figs</p>
                <p className="mt-1">1 Talent = {formatDenarii(economyRules.denarii_per_talent)} Denarii earned.</p>
              </div>
            )}
          </BoardPanel>

          {marksRows.length > 0 ? (
            <BoardPanel>
              <BoardMovementSummary rows={marksRows as unknown as CompetitiveRow[]} valueForRow={(row) => Number((row as any).marks ?? 0)} />
              <div className="mt-4" />
              <BoardList>
                {marksRows.map((row) => (
                  <BoardRow
                    key={row.user_id}
                    rank={row.rank}
                    name={row.display_name}
                    value={formatMarks(Number(row.marks || 0))}
                    houseId={row.tent_house_id || undefined}
                    isCurrentUser={row.user_id === profile?.id}
                    userId={row.user_id}
                    avatarUrl={(row as any).avatar_url}
                    currentUserId={profile?.id}
                    movement={rankMovement(row as unknown as CompetitiveRow, Number(row.marks))}
                    isRecord={isNewRecord(row as unknown as CompetitiveRow, Number(row.marks))}
                    valueLabel="Marks"
                  />
                ))}
              </BoardList>
            </BoardPanel>
          ) : (
            <EmptyState icon={(props) => <ChiRhoMark size={props.size} className={props.className || ''} />} title="No Marks yet" message="Marks appear once users begin earning qualifying Denarii, Figs, Streaks, or Rhudes." />
          )}
        </div>
      )}

      {/* Tent Leaderboard */}
      {tab === 'tent_house' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <TentIcon size={20} className="text-brass" />
              <h3 className="font-display font-semibold text-ink">Tent Challenge Board</h3>
              <span className="badge badge-brass text-[10px]">Live</span>
            </div>
            <p className="text-xs text-stone">
              Actual tents ranked by aggregate Marks from their cadets. Sentry names and tent pictures appear here.
            </p>
          </BoardPanel>

	          {tentRows.length > 0 ? (
	            <BoardPanel>
                <BoardMovementSummary rows={tentRows as unknown as CompetitiveRow[]} valueForRow={(row) => Number((row as any).combined_score ?? 0)} />
                <div className="mt-4" />
	              <BoardList>
	                {tentRows.map((row) => {
	                  const isPodium = false;
	                  const tint = RANK_HONOR_TINT[row.rank];
	                  const sentries = sentryLine(row.sentry_names);

                  if (isPodium && tint) {
                    return (
                      <div
                        key={row.tent_house_id}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
                          cn(tint.border, 'bg-surface hover:border-border-bright'),
                        )}
                      >
                        <div className={cn('flex items-center gap-2 flex-shrink-0', tint.text)}>
                          <LaurelWreath size={28} />
                          <span className="font-display font-semibold text-sm w-5 text-center">{row.rank}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <TentBoardImage src={row.tent_profile_image_url} />
                            <p className="text-sm font-medium truncate text-ink">{row.tent_name}</p>
                            {row.tent_house_id && <TentHouseSymbol houseId={row.tent_house_id} size={18} className="flex-shrink-0" />}
                          </div>
		                          <span className="text-xs text-stone">{row.cadet_count} cadets · {formatMarks(Number(row.combined_score || 0))} Marks · {tint.label} honor</span>
                              <p className="text-[11px] text-stone truncate mt-0.5">{Number(row.total_figs || 0)} figs · {formatDenarii(row.total_denarii)}D</p>
		                          {sentries && <p className="text-[11px] text-stone truncate mt-0.5">{sentries}</p>}
		                        </div>
                        <div className="text-right flex-shrink-0">
	                          <span className="text-sm font-medium text-ink">{formatMarks(Number(row.combined_score || 0))}</span>
	                          <p className="text-[10px] text-stone">Marks</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <BoardRow
	                        key={row.tent_id}
	                      rank={row.rank}
	                      name={row.tent_name}
	                      value={formatMarks(Number(row.combined_score || 0))}
		                      houseId={row.tent_house_id || undefined}
		                      isCurrentUser={false}
                          avatarUrl={row.tent_profile_image_url}
		                      subtext={[`${row.cadet_count} cadets`, sentries].filter(Boolean).join(' · ')}
                          showSubtext
                          movement={rankMovement(row as unknown as CompetitiveRow, Number(row.combined_score))}
                          isRecord={isNewRecord(row as unknown as CompetitiveRow, Number(row.combined_score))}
                          valueLabel="Marks"
		                    />
                  );
                })}
              </BoardList>
            </BoardPanel>
          ) : (
            <EmptyState icon={(props) => <TentIcon {...props} />} title="No tent data yet" message="Assign cadets to tents to see aggregate rankings here." />
          )}
        </div>
      )}
    </div>
  );
}

function TentBoardImage({ src }: { src?: string | null }) {
  return (
    <span className="h-8 w-8 rounded-lg border border-border bg-surface-2 overflow-hidden flex items-center justify-center flex-shrink-0">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <TentIcon size={16} className="text-brass" />}
    </span>
  );
}

function BoardTabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex min-w-max items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-all whitespace-nowrap sm:justify-start sm:gap-2 sm:px-4 sm:text-sm',
        active ? 'border-brass bg-brass-soft text-brass shadow-sm' : 'border-border bg-surface/70 text-stone hover:border-border-bright hover:text-ink',
      )}
    >
      {icon} {label}
    </button>
  );
}
