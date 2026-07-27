import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { BoardRow, BoardList } from '../../components/BoardRow';
import { TentHouseSymbol } from '../../components/TentHouseSymbol';
import { LaurelWreath, MeanderBorder, SealBullet } from '../../components/AncientMotifs';
import { CoinIcon } from '../../components/BrandIcons';
import { supabase } from '../../lib/supabase';
import { fetchQuizScoreboard, fetchStreakboardSnapshots, fetchLeaderboardSnapshots } from '../../lib/queries';
import { formatDenarii, cn, formatShortDate } from '../../lib/utils';
import type { StreakboardSnapshot, LeaderboardWeeklySnapshot, QuizScoreboardRow } from '../../lib/types';
import { Trophy, Clock, Crown, Tent as TentIcon, FileQuestion, Flame } from 'lucide-react';

type BoardTab = 'leader' | 'streak' | 'quiz' | 'tent_house';

type TentLeaderboardRow = {
  tent_id: string;
  tent_name: string;
  tent_house_id: string | null;
  tent_profile_image_url: string | null;
  sentry_names: string[] | null;
  cadet_count: number;
  total_denarii: number;
  total_streak: number;
  combined_score: number;
  rank: number;
};

const RANK_HONOR_TINT: Record<number, { text: string; bg: string; border: string; label: string }> = {
  1: { text: 'text-brass', bg: 'bg-brass-soft', border: 'border-brass', label: 'Aureus' },
  2: { text: 'text-stone', bg: 'bg-surface-2', border: 'border-border', label: 'Argent' },
  3: { text: 'text-roman', bg: 'bg-roman/10', border: 'border-roman/40', label: 'Aes' },
};

function sentryLine(names: string[] | null | undefined): string | undefined {
  if (!names || names.length === 0) return undefined;
  return `Sentr${names.length === 1 ? 'y' : 'ies'}: ${names.join(', ')}`;
}

export function CadetLeaderboard() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<BoardTab>('leader');
  const [streakRows, setStreakRows] = useState<(StreakboardSnapshot & { profiles: { display_name: string; avatar_url: string | null } })[]>([]);
  const [leaderRows, setLeaderRows] = useState<(LeaderboardWeeklySnapshot & { profiles: { display_name: string; avatar_url: string | null } })[]>([]);
  const [liveRows, setLiveRows] = useState<{ user_id: string; display_name: string; tent_house_id: string | null; total_denarii: number; rank: number }[]>([]);
  const [tentRows, setTentRows] = useState<TentLeaderboardRow[]>([]);
  const [quizRows, setQuizRows] = useState<QuizScoreboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [streaks, leaders] = await Promise.allSettled([
        fetchStreakboardSnapshots(),
        fetchLeaderboardSnapshots(),
      ]);
      setStreakRows(streaks.status === 'fulfilled' ? streaks.value : []);
      setLeaderRows(leaders.status === 'fulfilled' ? leaders.value : []);

	      const [live, tents, quizBoard] = await Promise.allSettled([
	        supabase.rpc('get_leaderboard_live'),
	        supabase.rpc('get_tent_leaderboard'),
	        fetchQuizScoreboard(),
	      ]);
	      setLiveRows((live.status === 'fulfilled' && live.value.data ? live.value.data : []) as any);
	      setTentRows((tents.status === 'fulfilled' && tents.value.data ? tents.value.data : []) as TentLeaderboardRow[]);
	      setQuizRows(quizBoard.status === 'fulfilled' ? quizBoard.value : []);
    } catch (e) { console.error('Leaderboard load error:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const channel = supabase
      .channel('cadet_quiz_scoreboard_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_attempts' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_attempts' }, () => load())
      .subscribe();
    const interval = window.setInterval(() => load(), 60_000);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, [load]);

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading challenge boards…</div>;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Board tabs */}
      <div className="grid w-full grid-cols-2 gap-1 rounded-lg border border-border bg-surface-2 p-1 sm:flex sm:w-fit">
        <BoardTabButton active={tab === 'leader'} onClick={() => setTab('leader')} icon={<CoinIcon size={16} />} label="Denarii Board" />
        <BoardTabButton active={tab === 'streak'} onClick={() => setTab('streak')} icon={<Flame size={16} />} label="Streak Board" />
        <BoardTabButton active={tab === 'quiz'} onClick={() => setTab('quiz')} icon={<FileQuestion size={16} />} label="Quiz Board" />
        <BoardTabButton active={tab === 'tent_house'} onClick={() => setTab('tent_house')} icon={<TentIcon size={16} />} label="Tent Board" />
      </div>

      {/* Denarii Leaderboard (live) */}
      {tab === 'leader' && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <CoinIcon size={20} className="text-gold" />
              <h3 className="font-display font-semibold text-ink">Denarii Challenge Board</h3>
              <span className="badge badge-brass text-[10px]">Live</span>
            </div>
            <p className="text-xs text-stone">
              Updates in real time as cadets play and submit quizzes. Tent symbols appear beside each name.
            </p>
          </div>

          {liveRows.length > 0 ? (
            <div className="card p-4">
              <BoardList>
                {liveRows.map((row, i) => {
                  const rank = row.rank || i + 1;
                  const isPodium = rank >= 1 && rank <= 3;
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
                            {row.tent_house_id && <TentHouseSymbol houseId={row.tent_house_id} size={26} className="flex-shrink-0" />}
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
                    />
                  );
                })}
              </BoardList>
            </div>
          ) : (
            <EmptyState icon={Trophy} title="No data yet" message="Play the daily game or take the Saturday quiz to appear on the board." />
          )}

          {leaderRows.length > 0 && (
            <>
              <div className="text-stone"><MeanderBorder /></div>
              <div className="card p-4">
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
                    />
                  ))}
                </BoardList>
              </div>
            </>
          )}
        </div>
      )}

      {/* Streak Board */}
      {tab === 'streak' && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Flame size={20} className="text-roman" />
              <h3 className="font-display font-semibold text-ink">Streak Challenge Board</h3>
              <span className="badge badge-neutral text-[10px] inline-flex items-center gap-1">
                <Clock size={10} /> Daily 9 PM
              </span>
            </div>
            <p className="text-xs text-stone">
              Ranks by Volume → Consistency → Improvement. Tent symbols appear beside each name. Updates daily at 9 PM.
            </p>
          </div>

          {streakRows.length > 0 ? (
            <div className="card p-4">
              <p className="text-xs text-stone mb-3">Last updated: {formatShortDate(streakRows[0].snapshot_date)} at 9:00 PM</p>
              <BoardList>
                {streakRows.map((row) => {
                  const isPodium = row.rank >= 1 && row.rank <= 3;
                  const tint = RANK_HONOR_TINT[row.rank];

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
                            {row.tent_house_id && <TentHouseSymbol houseId={row.tent_house_id} size={26} className="flex-shrink-0" />}
                          </div>
                          <span className="text-xs text-stone">Longest: {row.consistency} days</span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-sm font-medium text-ink">{row.volume}</span>
                          <p className="text-[10px] text-stone">valid days · streak {row.current_streak}</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <BoardRow
                      key={row.id}
                      rank={row.rank}
                      name={row.profiles.display_name}
                      value={`${row.volume}`}
                      houseId={row.tent_house_id || undefined}
                      isCurrentUser={row.user_id === profile?.id}
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
            </div>
          ) : (
            <EmptyState icon={Crown} title="No streak data yet" message="The streak board updates nightly at 9 PM. Complete a few days to see rankings." />
          )}
        </div>
      )}

      {/* Fig Board */}
      {tab === 'quiz' && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileQuestion size={20} className="text-royal" />
              <h3 className="font-display font-semibold text-ink">Fig Board</h3>
              <span className="badge badge-neutral text-[10px] inline-flex items-center gap-1">
                <Clock size={10} /> Saturday 3 PM
              </span>
            </div>
            <p className="text-xs text-stone">
              Daily game figs, arena figs, and fortune quiz figs update live. Saturday quiz figs join the board at 3:00 PM.
            </p>
          </div>

          {quizRows.length > 0 ? (
            <div className="card p-4">
              <BoardList>
                {quizRows.map((row) => {
                  const isPodium = row.rank >= 1 && row.rank <= 3;
                  const tint = RANK_HONOR_TINT[row.rank];
                  const subtext = `Game ${row.daily_game_score} figs · Arena ${row.arena_figs || 0} figs · Fortune ${row.random_quiz_score} figs · Saturday ${row.saturday_quiz_score} figs`;

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
                            {row.tent_house_id && <TentHouseSymbol houseId={row.tent_house_id} size={26} className="flex-shrink-0" />}
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
                      subtext={subtext}
                    />
                  );
                })}
              </BoardList>
            </div>
          ) : (
            <EmptyState
              icon={FileQuestion}
              title="Quiz board ready"
              message="Cadets appear here once assigned. Daily game, arena, and fortune quiz figs update live; Saturday quiz figs join at 3:00 PM."
            />
          )}
        </div>
      )}

      {/* Tent Leaderboard */}
      {tab === 'tent_house' && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TentIcon size={20} className="text-brass" />
              <h3 className="font-display font-semibold text-ink">Tent Challenge Board</h3>
              <span className="badge badge-brass text-[10px]">Live</span>
            </div>
            <p className="text-xs text-stone">
              Actual tents ranked by aggregate denarii and streak days from their cadets. Sentry names and tent pictures appear here.
            </p>
          </div>

	          {tentRows.length > 0 ? (
	            <div className="card p-4">
	              <BoardList>
	                {tentRows.map((row) => {
	                  const isPodium = row.rank >= 1 && row.rank <= 3;
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
                            {row.tent_house_id && <TentHouseSymbol houseId={row.tent_house_id} size={26} className="flex-shrink-0" />}
                          </div>
		                          <span className="text-xs text-stone">{row.cadet_count} cadets · streak {row.total_streak} · {tint.label} honor</span>
		                          {sentries && <p className="text-[11px] text-stone truncate mt-0.5">{sentries}</p>}
		                        </div>
                        <div className="text-right flex-shrink-0">
	                          <span className="text-sm font-medium text-ink">{formatDenarii(row.combined_score)}</span>
	                          <p className="text-[10px] text-stone">{formatDenarii(row.total_denarii)}D · {row.total_streak} streak</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <BoardRow
	                        key={row.tent_id}
	                      rank={row.rank}
	                      name={row.tent_name}
		                      value={formatDenarii(row.combined_score)}
		                      houseId={row.tent_house_id || undefined}
		                      isCurrentUser={false}
		                      subtext={[`${formatDenarii(row.total_denarii)}D`, `${row.total_streak} streak days`, sentries].filter(Boolean).join(' · ')}
		                    />
                  );
                })}
              </BoardList>
            </div>
          ) : (
            <EmptyState icon={TentIcon} title="No tent data yet" message="Assign cadets to tents to see aggregate rankings here." />
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
        'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap',
        active ? 'bg-surface text-ink shadow-sm border border-border' : 'text-stone hover:text-ink',
      )}
    >
      {icon} {label}
    </button>
  );
}
