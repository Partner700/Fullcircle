import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { StatCard, SectionHeader, EmptyState } from '../../components/AppShell';
import { LaurelWreath, MeanderBorder } from '../../components/AncientMotifs';
import { supabase } from '../../lib/supabase';
import { fetchDailyRecords, fetchStrictStreak } from '../../lib/queries';
import { getRemovalState, getDayType, formatShortDate, cn, isWeekdayValid } from '../../lib/utils';
import type { DailyRecord, RemovalState, StreakInfo } from '../../lib/types';
import {
  Flame, Calendar, TrendingUp, AlertTriangle, ShieldCheck, XCircle,
  CheckCircle2, MinusCircle, Award, Info, Snowflake, Loader2, Coins,
} from 'lucide-react';
import { fetchStreakFreezers, purchaseDailyFreezer } from '../../lib/queries';
import { FREEZER_DAILY_COST } from '../../lib/constants';
import type { StreakFreezer } from '../../lib/types';

const REMOVAL_STATE_INFO: Record<
  RemovalState,
  {
    label: string;
    badgeClass: string;
    icon: typeof Flame;
    desc: string;
    tint: string;
    border: string;
    iconColor: string;
  }
> = {
  active: {
    label: 'Active',
    badgeClass: 'badge badge-moss',
    icon: ShieldCheck,
    desc: 'You are in good standing. Keep up the daily rhythm.',
    tint: 'rgba(107,142,90,0.08)',
    border: 'rgba(107,142,90,0.30)',
    iconColor: '#6B8E5A',
  },
  at_risk: {
    label: 'At Risk',
    badgeClass: 'badge badge-brass',
    icon: AlertTriangle,
    desc: 'Early warning: you have missed 3 consecutive days. Resume today to return to Active.',
    tint: 'rgba(201,162,39,0.08)',
    border: 'rgba(201,162,39,0.30)',
    iconColor: '#C9A227',
  },
  flagged: {
    label: 'Flagged for Removal',
    badgeClass: 'badge badge-roman',
    icon: AlertTriangle,
    desc: 'You have crossed a removal threshold (5 consecutive or 10 cumulative misses). Contact your sentry.',
    tint: 'rgba(184,85,62,0.10)',
    border: 'rgba(184,85,62,0.35)',
    iconColor: '#B8553E',
  },
  removed: {
    label: 'Removed',
    badgeClass: 'badge badge-neutral',
    icon: XCircle,
    desc: 'You have been removed from the program. Contact an instructor to appeal.',
    tint: 'rgba(154,139,114,0.08)',
    border: 'rgba(154,139,114,0.30)',
    iconColor: '#9A8B72',
  },
};

export function CadetStreak({ refreshKey = 0 }: { refreshKey?: number }) {
  const { profile, role } = useAuth();
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [freezers, setFreezers] = useState<StreakFreezer[]>([]);
  const [denariiBalance, setDenariiBalance] = useState(0);
  const [streakData, setStreakData] = useState<{ current_streak: number; longest_streak: number; consecutive_inactive: number; cumulative_inactive: number } | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const [recs, frz, bal, strict] = await Promise.allSettled([
        fetchDailyRecords(profile.id),
        fetchStreakFreezers(profile.id),
        supabase.rpc('get_user_denarii_total', { p_user_id: profile.id }),
        fetchStrictStreak(profile.id),
      ]);
      setRecords(recs.status === 'fulfilled' ? recs.value : []);
      setFreezers(frz.status === 'fulfilled' ? frz.value : []);
      setDenariiBalance((bal.status === 'fulfilled' && bal.value.data) ? Number(bal.value.data) : 0);
      setStreakData(strict.status === 'fulfilled' ? strict.value : null);
    } catch (e) { console.error('Streak load error:', e); }
    setLoading(false);
  }, [profile, refreshKey]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 animate-fade-in">
        <div className="text-center space-y-3">
          <LaurelWreath size={32} className="text-brass mx-auto opacity-60" />
          <p className="text-stone eyebrow">Loading your streak…</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const volumeThisMonth = records.filter((r) => {
    const d = new Date(r.record_date);
    return d >= monthStart && r.streak_valid === true;
  }).length;
  const streak: StreakInfo = {
    current_streak: streakData?.current_streak ?? 0,
    longest_streak: streakData?.longest_streak ?? 0,
    consecutive_inactive: streakData?.consecutive_inactive ?? 0,
    cumulative_inactive: streakData?.cumulative_inactive ?? 0,
    removal_state: getRemovalState(streakData?.consecutive_inactive ?? 0, streakData?.cumulative_inactive ?? 0),
    volume_this_month: volumeThisMonth,
  };
  const stateInfo = REMOVAL_STATE_INFO[streak.removal_state as RemovalState];
  const StateIcon = stateInfo.icon;
  const stateDescription = role === 'sentry' && streak.removal_state === 'flagged'
    ? 'You have crossed a removal threshold (5 consecutive or 10 cumulative misses). Contact an instructor.'
    : stateInfo.desc;

  // Build last 14 days view
  const last14: {
    date: Date;
    record?: DailyRecord;
    dayType: string;
    valid: boolean | null;
  }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dt = getDayType(d);
    const rec = records.find(
      (r) => r.record_date === d.toISOString().split('T')[0],
    );
    let valid: boolean | null = null;
    if (dt === 'sunday') valid = null;
    else if (rec) valid = isWeekdayValid(rec);
    last14.push({ date: d, record: rec, dayType: dt, valid });
  }

  // Determine if a day is in the future (for cell styling)
  const todayISO = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Removal state banner ── */}
      <div
        className="card p-4 flex items-start gap-4"
        style={{
          background: stateInfo.tint,
          borderColor: stateInfo.border,
        }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: stateInfo.tint }}
        >
          <StateIcon size={24} style={{ color: stateInfo.iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="eyebrow">Standing</span>
            <span className={stateInfo.badgeClass}>{stateInfo.label}</span>
          </div>
          <p className="text-sm text-stone">{stateDescription}</p>
        </div>
      </div>

      {/* ── Streak stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4 card-hover">
          <div className="flex items-start justify-between">
            <div>
              <p className="eyebrow">Current Streak</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className="font-display text-2xl font-semibold text-ink">
                  {streak.current_streak}
                </p>
                <span className="text-xs text-stone">days</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <LaurelWreath
                size={18}
                className="text-brass opacity-70"
              />
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(184,85,62,0.15)' }}
              >
                <Flame size={18} color="#B8553E" />
              </div>
            </div>
          </div>
        </div>

        <StatCard
          icon={TrendingUp}
          label="Longest Streak"
          value={streak.longest_streak}
          sublabel="personal best"
          color="#C9A227"
        />
        <StatCard
          icon={Calendar}
          label="Valid Days"
          value={streak.volume_this_month}
          sublabel="this month"
          color="#6B8E5A"
        />
        <StatCard
          icon={AlertTriangle}
          label="Cumulative Misses"
          value={streak.cumulative_inactive}
          sublabel="of 10 threshold"
          color="#B8553E"
        />
      </div>

      {/* ── Meander divider ── */}
      <MeanderBorder className="text-brass" />

      {/* ── Last 14 days calendar ── */}
      <div className="card p-5">
	        <SectionHeader
	          title="Last 14 Days"
	          subtitle="Brass = complete, roman = missed, stone = Sunday (frozen)"
	        />
        <div className="grid grid-cols-7 gap-2">
          {last14.map((day, i) => {
            const isFuture = day.date.toISOString().split('T')[0] > todayISO;
            return (
              <div key={i} className="text-center">
                <div
                  className={cn(
                    'aspect-square rounded-lg flex flex-col items-center justify-center text-xs font-medium transition-all border',
                    // Sunday frozen
                    day.valid === null &&
                      !isFuture &&
                      'bg-surface-2 text-stone/50 border-border',
                    // Valid day — brass
                    day.valid === true &&
                      'bg-brass/15 text-brass border-brass/30',
                    // Missed day — roman
                    day.valid === false &&
                      day.record &&
                      'bg-roman/10 text-roman border-roman/20',
                    // Missed & no record (unmarked) — faint roman
                    day.valid === false &&
                      !day.record &&
                      'bg-roman/5 text-roman/70 border-roman/10',
                    // Future day — surface-3
                    isFuture && 'bg-surface-3 text-stone/40 border-border',
                  )}
                >
                  <span className="text-[10px] uppercase opacity-70">
                    {formatShortDate(day.date).split(' ')[0]}
                  </span>
                  <span className="font-display font-semibold">
                    {day.date.getDate()}
                  </span>
                </div>
                <span className="text-[10px] text-stone mt-0.5 block">
                  {day.dayType === 'sunday' ? (
                    'Sun'
                  ) : day.valid === true ? (
                    <CheckCircle2
                      size={12}
                      className="inline text-brass"
                    />
                  ) : day.valid === false ? (
                    <XCircle size={12} className="inline text-roman" />
                  ) : (
                    <MinusCircle
                      size={12}
                      className="inline text-stone/40"
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Streak Freezers ── */}
      <div className="card p-5">
        <SectionHeader
          title="Streak Freezers"
          subtitle="Protect your streak after an absent day"
        />
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          {/* Daily freezer — denarii */}
          <div className="p-4 rounded-lg border border-border bg-surface-2">
            <div className="flex items-center gap-2 mb-2">
              <Snowflake size={20} className="text-brass" />
              <h4 className="font-display font-semibold text-ink text-sm">Daily Freezer</h4>
            </div>
            <p className="text-xs text-stone mb-3">
              Costs {FREEZER_DAILY_COST} denarii. Protects your streak for one missed day.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-stone flex items-center gap-1">
                <Coins size={12} className="text-gold" /> {denariiBalance} available
              </span>
              <button
                onClick={async () => {
                  if (denariiBalance < FREEZER_DAILY_COST) return;
                  setPurchasing(true);
                  try {
                    await purchaseDailyFreezer(profile!.id);
                    await load();
                  } catch (e: any) {
                    alert(e.message || 'Failed to purchase freezer');
                  }
                  setPurchasing(false);
                }}
                disabled={denariiBalance < FREEZER_DAILY_COST || purchasing}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {purchasing ? <Loader2 size={12} className="animate-spin" /> : <Snowflake size={12} />} Buy ({FREEZER_DAILY_COST}Ø)
              </button>
            </div>
          </div>

          {/* Weekly freezer — real money */}
          <div className="p-4 rounded-lg border border-border bg-surface-2">
            <div className="flex items-center gap-2 mb-2">
              <Snowflake size={20} className="text-royal" />
              <h4 className="font-display font-semibold text-ink text-sm">Weekly Freezer</h4>
            </div>
            <p className="text-xs text-stone mb-3">
              Real-money purchase. Protects your streak for an entire week of absences.
            </p>
            <button
              onClick={() => alert('Weekly freezer purchases require an active subscription. Visit the Subscribe tab to set up payment.')}
              className="btn-secondary text-xs w-full"
            >
              <Snowflake size={12} /> Coming with Subscription
            </button>
          </div>
        </div>

        {freezers.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-stone mb-2">Your freezers:</p>
            <div className="flex flex-wrap gap-2">
              {freezers.map((f) => (
                <span
                  key={f.id}
                  className={`badge text-[10px] ${f.used_at ? 'badge-neutral' : 'badge-brass'}`}
                >
                  <Snowflake size={10} className="mr-1" />
                  {f.freezer_type === 'daily' ? 'Daily' : 'Weekly'} · {f.used_at ? 'Used' : 'Available'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── How streaks work ── */}
      <div className="card p-5">
        <SectionHeader title="How Streaks Work" />
        <div className="space-y-3 text-sm text-stone">
          <div className="flex gap-3">
            <CheckCircle2
              size={16}
              className="text-moss flex-shrink-0 mt-0.5"
	            />
	            <p>
	              <strong className="text-ink">Weekday Rhythm:</strong> A weekday
	              counts only when your sentry marks you present for the morning
	              call and you submit your daily devotion.
	            </p>
	          </div>
	          <div className="flex gap-3">
	            <Coins
	              size={16}
	              className="text-gold flex-shrink-0 mt-0.5"
	            />
	            <p>
	              <strong className="text-ink">Morning Call Reward:</strong> When
	              your sentry marks you present, you receive 200 denarii for that
	              day. The reward is only given once per day.
	            </p>
	          </div>
          <div className="flex gap-3">
            <MinusCircle
              size={16}
              className="text-stone flex-shrink-0 mt-0.5"
            />
            <p>
              <strong className="text-ink">Sundays:</strong> Frozen — no
              requirement, no streak change. The day is excluded entirely.
            </p>
          </div>
          <div className="flex gap-3">
            <Snowflake
              size={16}
              className="text-brass flex-shrink-0 mt-0.5"
            />
            <p>
              <strong className="text-ink">Freezers:</strong> A daily freezer
              (500 denarii) or weekly freezer (real money) protects your streak
              after an absent day. Simon's Purse relic (from the store) protects
              your streak for 5 days of absence and supersedes freezers.
            </p>
          </div>
          <div className="flex gap-3">
            <Calendar
              size={16}
              className="text-royal flex-shrink-0 mt-0.5"
            />
            <p>
              <strong className="text-ink">Saturday Quiz:</strong> The Saturday
              quiz (9:00–9:30 AM) is the sole streak validation for that day.
              Simon's Purse and freezers do <strong>not</strong> protect against
              a missed Saturday quiz.
            </p>
          </div>
          <div className="flex gap-3">
            <XCircle
              size={16}
              className="text-roman flex-shrink-0 mt-0.5"
            />
            <p>
              <strong className="text-ink">
                One miss = streak resets to zero.
              </strong>{' '}
              But you are only removed after 5 consecutive or 10 cumulative
              misses.
            </p>
          </div>
        </div>
      </div>

      {/* ── Full record history ── */}
      {records.length > 0 ? (
        <div className="card p-5">
          <SectionHeader
            title="Full History"
            subtitle={`${records.length} records`}
          />
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {[...records].reverse().map((rec) => {
              const dt = getDayType(new Date(rec.record_date));
	              const valid = isWeekdayValid(rec);
              return (
                <div
                  key={rec.id}
                  className="flex items-center justify-between text-sm py-2 px-2 rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <span className="text-ink">
                    {formatShortDate(rec.record_date)}
                  </span>
                  <span className="text-xs text-stone uppercase">{dt}</span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      valid === null
                        ? 'text-stone/50'
                        : valid
                          ? 'text-moss'
                          : 'text-roman',
                    )}
                  >
                    {valid === null ? 'Frozen' : valid ? 'Valid' : 'Missed'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Award}
          title="No Records Yet"
          message={role === 'sentry'
            ? 'Your personal streak records will appear here once you submit meditations or complete streak-valid activities.'
            : 'Your daily streak records will appear here once your sentry begins marking attendance.'}
        />
      )}
    </div>
  );
}
