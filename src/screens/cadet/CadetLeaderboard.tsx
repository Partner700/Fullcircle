import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { BoardRow, BoardList } from '../../components/BoardRow';
import { TentHouseSymbol } from '../../components/TentHouseSymbol';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { LaurelWreath, MeanderBorder, SealBullet } from '../../components/AncientMotifs';
import { supabase } from '../../lib/supabase';
import { fetchBoardAvatars, fetchQuizScoreboard, fetchStreakboardSnapshots, fetchLeaderboardSnapshots, fetchRhudeBoard, fetchMarksBoard, fetchPanelImageSetting } from '../../lib/queries';
import { formatDenarii, cn, formatShortDate } from '../../lib/utils';
import type { StreakboardSnapshot, LeaderboardWeeklySnapshot, QuizScoreboardRow, RhudeBoardRow, MarksBoardRow } from '../../lib/types';
import { Trophy, Clock, Crown, Tent as TentIcon, Flame, Shield, Coins, BadgeCheck, Cross, ArrowDown, ArrowUp, Sparkles } from 'lucide-react';

type BoardTab = 'leader' | 'streak' | 'quiz' | 'rhude' | 'marks' | 'tent_house';

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
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function rankMovement(row: CompetitiveRow, currentValue?: number): number | null {
  const previousValue = previousBoardValue(row);
  if (typeof currentValue === 'number' && previousValue !== null) {
    if (currentValue > previousValue) return 1;
    if (currentValue < previousValue) return -1;
    return 0;
  }
  if (typeof row.movement === 'number') return row.movement;
  const previous = Number(row.previous_rank ?? row.rank_yesterday);
  const current = Number(row.rank);
  if (previous && current && previous !== current) return previous - current;
  if (previous && current) return 0;
  return null;
}

function isNewRecord(row: CompetitiveRow, value?: number) {
  if (row.is_new_record || row.new_record) return true;
  const record = Number(row.record_value ?? row.personal_best);
  return Boolean(record && typeof value === 'number' && value >= record);
}

function BoardMovementSummary({ rows }: { rows: CompetitiveRow[] }) {
  const up = rows.filter((row) => Number(rankMovement(row)) > 0).length;
  const down = rows.filter((row) => Number(rankMovement(row)) < 0).length;
  const records = rows.filter((row) => isNewRecord(row)).length;
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

export function CadetLeaderboard({ instructorMode = false }: { instructorMode?: boolean } = {}) {
  const { profile } = useAuth();
  const [tab, setTab] = useState<BoardTab>('leader');
  const [streakRows, setStreakRows] = useState<(StreakboardSnapshot & { profiles: { display_name: string; avatar_url: string | null } })[]>([]);
  const [leaderRows, setLeaderRows] = useState<(LeaderboardWeeklySnapshot & { profiles: { display_name: string; avatar_url?: string | null } })[]>([]);
  const [liveRows, setLiveRows] = useState<{ user_id: string; display_name: string; avatar_url?: string | null; tent_house_id: string | null; total_denarii: number; rank: number }[]>([]);
  const [tentRows, setTentRows] = useState<TentLeaderboardRow[]>([]);
  const [quizRows, setQuizRows] = useState<QuizScoreboardRow[]>([]);
  const [rhudeRows, setRhudeRows] = useState<RhudeBoardRow[]>([]);
  const [marksRows, setMarksRows] = useState<MarksBoardRow[]>([]);
  const [boardImage, setBoardImage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const loadInFlightRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent && typeof document !== 'undefined' && document.body.dataset.fullCircleMessengerOpen === 'true') return;
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const [streaks, leaders] = await Promise.allSettled([
        withBoardTimeout(fetchStreakboardSnapshots(), 'Streak board'),
        withBoardTimeout(fetchLeaderboardSnapshots(), 'Weekly board'),
      ]);
      const streakRowsRaw = streaks.status === 'fulfilled' ? streaks.value : [];
      const leaderRowsRaw = leaders.status === 'fulfilled' ? leaders.value : [];
      setStreakRows(streakRowsRaw);
      setLeaderRows(leaderRowsRaw as any);

	      const [live, tents, quizBoard, rhudes, marks] = await Promise.allSettled([
	        withBoardTimeout(supabase.rpc('get_leaderboard_live'), 'Denarii board'),
	        withBoardTimeout(supabase.rpc('get_tent_leaderboard'), 'Tent board'),
	        withBoardTimeout(fetchQuizScoreboard(), 'Fig board'),
          withBoardTimeout(fetchRhudeBoard(), 'Valley board'),
          withBoardTimeout(fetchMarksBoard(), 'Marks board'),
	      ]);
        const liveResult = live.status === 'fulfilled' ? live.value as { data?: unknown } : null;
        const tentResult = tents.status === 'fulfilled' ? tents.value as { data?: unknown } : null;
        const liveRowsRaw = (liveResult?.data || []) as typeof liveRows;
        const tentRowsRaw = (tentResult?.data || []) as TentLeaderboardRow[];
        const quizRowsRaw = quizBoard.status === 'fulfilled' ? quizBoard.value : [];
        const rhudeRowsRaw = rhudes.status === 'fulfilled' ? rhudes.value : [];
        const marksRowsRaw = marks.status === 'fulfilled' ? marks.value : [];
	      setLiveRows(liveRowsRaw);
	      setTentRows(tentRowsRaw);
	      setQuizRows(quizRowsRaw);
        setRhudeRows(rhudeRowsRaw);
        setMarksRows(marksRowsRaw);
        setLastUpdatedAt(new Date());

        // Render board rows immediately, then fill in only the missing public
        // avatars. This avoids blocking the board on a full profile download.
        const boardUserIds = [
          ...streakRowsRaw.map((row) => row.user_id),
          ...leaderRowsRaw.map((row) => row.user_id),
          ...liveRowsRaw.map((row) => row.user_id),
          ...quizRowsRaw.map((row) => row.user_id),
          ...rhudeRowsRaw.map((row) => row.user_id),
          ...marksRowsRaw.map((row) => row.user_id),
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
      loadInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const scheduleSilentRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void load(true);
    }, 1200);
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    fetchPanelImageSetting('leaderboard')
      .then((image) => { if (!cancelled) setBoardImage(image); })
      .catch(() => { if (!cancelled) setBoardImage(null); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const channel = supabase
      .channel('cadet_quiz_scoreboard_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_attempts' }, scheduleSilentRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_attempts' }, scheduleSilentRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_records' }, scheduleSilentRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_rooms' }, scheduleSilentRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'denarii_ledger_entries' }, scheduleSilentRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'streak_freezers' }, scheduleSilentRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'relic_inventory' }, scheduleSilentRefresh)
      .subscribe();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 60_000);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    };
  }, [load, scheduleSilentRefresh]);

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading challenge boards…</div>;

  const tabs: Array<{ key: BoardTab; label: string; icon: React.ReactNode }> = [
    { key: 'leader', label: 'Denarii Board', icon: <Coins size={16} /> },
    { key: 'streak', label: 'Streak Board', icon: <Flame size={16} /> },
    { key: 'quiz', label: 'Fig Board', icon: <BadgeCheck size={16} /> },
    { key: 'rhude', label: 'Valley Board', icon: <Shield size={16} /> },
    ...(instructorMode ? [{ key: 'marks' as BoardTab, label: 'Leaderboard', icon: <Cross size={16} /> }] : []),
    { key: 'tent_house', label: 'Tent Board', icon: <TentIcon size={16} /> },
  ];

  const BoardPanel = ({ children, className = 'p-4' }: { children: ReactNode; className?: string }) => (
    <div className={cn('card relative overflow-hidden', className)}>
      <PanelImageBackdrop image={boardImage} opacityFallback={100} veilClassName="welcome-slide-veil" modeFilter={false} textGradient={false} />
      <div className="relative z-10">{children}</div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="card relative overflow-hidden p-3">
        <PanelImageBackdrop image={boardImage} opacityFallback={100} veilClassName="welcome-slide-veil" modeFilter={false} textGradient={false} />
        <div className="relative z-10 mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Challenge Boards</p>
            <h2 className="font-display text-xl font-black text-ink">Competitive tables</h2>
          </div>
          <span className="badge badge-brass text-[10px]">Camp Stats</span>
        </div>
        <div className="relative z-10 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {tabs.map((item) => (
          <BoardTabButton key={item.key} active={tab === item.key} onClick={() => setTab(item.key)} icon={item.icon} label={item.label} />
        ))}
        </div>
      </div>

      {/* Denarii Leaderboard (live) */}
      {tab === 'leader' && (
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
              <BoardMovementSummary rows={liveRows as CompetitiveRow[]} />
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
            <EmptyState icon={(props) => <Trophy {...props} />} title="No data yet" message="Play the daily game or take the Saturday quiz to appear on the board." />
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
      {tab === 'streak' && (
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
              <BoardMovementSummary rows={streakRows as unknown as CompetitiveRow[]} />
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
                        key={row.id}
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
                              {row.profiles.display_name}
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
                      key={row.id}
                      rank={row.rank}
                      name={row.profiles.display_name}
                      value={`${currentStreak}`}
                      houseId={row.tent_house_id || undefined}
                      isCurrentUser={row.user_id === profile?.id}
                      userId={row.user_id}
                      avatarUrl={row.profiles.avatar_url}
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
      {tab === 'quiz' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <BadgeCheck size={20} className="text-royal" />
              <h3 className="font-display font-semibold text-ink">Fig Board</h3>
              <span className="badge badge-neutral text-[10px] inline-flex items-center gap-1">
                <Clock size={10} /> Saturday 3 PM
              </span>
            </div>
            <p className="text-xs text-stone">
              Daily game figs, arena figs, and fortune quiz figs update live. Saturday quiz figs join the board at 3:00 PM.
            </p>
          </BoardPanel>

          {quizRows.length > 0 ? (
            <BoardPanel>
              <BoardMovementSummary rows={quizRows as unknown as CompetitiveRow[]} />
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
              message="Cadets appear here once assigned. Daily game, arena, and fortune quiz figs update live; Saturday quiz figs join at 3:00 PM."
            />
          )}
        </div>
      )}

      {/* Valley Board */}
      {tab === 'rhude' && (
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
              <BoardMovementSummary rows={rhudeRows as unknown as CompetitiveRow[]} />
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
      {instructorMode && tab === 'marks' && (
        <div className="space-y-4">
          <BoardPanel>
            <div className="flex items-center gap-2 mb-1">
              <Cross size={20} className="text-brass" />
              <h3 className="font-display font-semibold text-ink">Leaderboard</h3>
              <span className="badge badge-brass text-[10px]">Grand Total</span>
            </div>
            <p className="text-xs text-stone">
              Marks combine denarii, figs, streaks, and Rhudes. This powers Rumor, Vallum, and Grand Vallum tracking.
            </p>
          </BoardPanel>

          {marksRows.length > 0 ? (
            <BoardPanel>
              <BoardMovementSummary rows={marksRows as unknown as CompetitiveRow[]} />
              <div className="mt-4" />
              <BoardList>
                {marksRows.map((row) => (
                  <BoardRow
                    key={row.user_id}
                    rank={row.rank}
                    name={row.display_name}
                    value={`${Math.round(Number(row.marks || 0))}`}
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
            <EmptyState icon={(props) => <Cross {...props} />} title="No Marks yet" message="Marks appear once users begin earning denarii, figs, streaks, or Rhudes." />
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
                <BoardMovementSummary rows={tentRows as unknown as CompetitiveRow[]} />
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
		                          <span className="text-xs text-stone">{row.cadet_count} cadets · {Math.round(Number(row.combined_score || 0))} Marks · {tint.label} honor</span>
                              <p className="text-[11px] text-stone truncate mt-0.5">{Number(row.total_figs || 0)} figs · {formatDenarii(row.total_denarii)}D</p>
		                          {sentries && <p className="text-[11px] text-stone truncate mt-0.5">{sentries}</p>}
		                        </div>
                        <div className="text-right flex-shrink-0">
	                          <span className="text-sm font-medium text-ink">{Math.round(Number(row.combined_score || 0))}</span>
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
		                      value={`${Math.round(Number(row.combined_score || 0))}`}
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
