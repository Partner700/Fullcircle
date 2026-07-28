import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { LaurelWreath, MeanderBorder, SealBullet } from '../../components/AncientMotifs';
import { fetchAwards } from '../../lib/queries';
import { formatShortDate, cn } from '../../lib/utils';
import type { Award } from '../../lib/types';
import { Award as AwardIcon, Trophy, Crown, Star, Flame, Coins, Target, Zap, BookOpen, Medal, TrendingUp } from 'lucide-react';

const AWARD_ICON_MAP: Record<string, typeof Trophy> = {
  cadet_of_month: Crown,
  streak_champion: Flame,
  quiz_champion: Zap,
  top_reader: BookOpen,
  challenge_master: Target,
  relic_keeper: Coins,
  most_improved: TrendingUp,
};

// Warm-palette award colors (brass / roman / moss / etc.)
const AWARD_COLOR_MAP: Record<string, string> = {
  cadet_of_month: '#C9A227',   // brass
  streak_champion: '#B8553E',  // roman
  quiz_champion: '#B8553E',    // roman
  top_reader: '#6B8E5A',        // moss
  challenge_master: '#6B8E5A', // moss
  relic_keeper: '#C9A227',      // brass
  most_improved: '#C9A227',    // brass
};

const AWARD_BADGE_MAP: Record<string, string> = {
  cadet_of_month: 'badge badge-brass',
  streak_champion: 'badge badge-roman',
  quiz_champion: 'badge badge-roman',
  top_reader: 'badge badge-moss',
  challenge_master: 'badge badge-moss',
  relic_keeper: 'badge badge-brass',
  most_improved: 'badge badge-neutral',
};

const AWARD_LABEL_MAP: Record<string, string> = {
  cadet_of_month: 'Cadet of the Month',
  streak_champion: 'Streak Champion',
  quiz_champion: 'Quiz Champion',
  top_reader: 'Top Reader',
  challenge_master: 'Challenge Master',
  relic_keeper: 'Relic Keeper',
  most_improved: 'Most Improved',
};

export function CadetAwards() {
  const { profile } = useAuth();
  const [awards, setAwards] = useState<(Award & { profiles: { display_name: string } })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchAwards();
    setAwards(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const myAwards = awards.filter((a) => a.user_id === profile?.id);

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading awards…</div>;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* My awards */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <LaurelWreath size={22} className="text-brass" />
          <SectionHeader title="My Awards" subtitle={`${myAwards.length} earned`} />
        </div>
        {myAwards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myAwards.map((award) => {
              const Icon = AWARD_ICON_MAP[award.award_type] || Trophy;
              const color = AWARD_COLOR_MAP[award.award_type] || '#C9A227';
              const badgeClass = AWARD_BADGE_MAP[award.award_type] || 'badge badge-neutral';
              return (
                <div
                  key={award.id}
                  className="p-4 rounded-xl border border-border bg-surface-2 transition-all card-hover"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${color}20` }}
                    >
                      <Icon size={24} color={color} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <LaurelWreath size={14} className="flex-shrink-0" />
                        <h4 className="font-display font-semibold text-ink truncate">{award.title}</h4>
                      </div>
                      <p className="text-xs text-stone mt-0.5">{formatShortDate(award.award_month)}</p>
                    </div>
                    <span className={cn(badgeClass, 'text-[10px] flex-shrink-0')}>
                      {(AWARD_LABEL_MAP[award.award_type] || award.award_type).replace(/ of.*/, '')}
                    </span>
                  </div>
                  {award.description && (
                    <p className="preserve-paragraphs text-xs text-stone mt-2 line-clamp-3">{award.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={AwardIcon} title="No awards yet" message="Awards are computed monthly from your streak, quiz, game, and challenge performance. Keep going!" />
        )}
      </div>

      {/* Meander divider between sections */}
      <div className="text-stone">
        <MeanderBorder />
      </div>

      {/* All awards this period */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <LaurelWreath size={22} className="text-brass" />
          <SectionHeader title="All Awards" subtitle="Recent honors across all cadets" />
        </div>
        {awards.length > 0 ? (
          <div className="space-y-2">
            {awards.slice(0, 20).map((award) => {
              const Icon = AWARD_ICON_MAP[award.award_type] || Trophy;
              const color = AWARD_COLOR_MAP[award.award_type] || '#C9A227';
              return (
                <div
                  key={award.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${color}20` }}
                  >
                    <Icon size={18} color={color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-ink">{award.profiles.display_name}</span>
                    <span className="text-stone text-sm"> · {award.title}</span>
                  </div>
                  <span className="text-xs text-stone flex-shrink-0">{formatShortDate(award.award_month)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Trophy} title="No awards announced" message="Awards are computed at month-end from a frozen snapshot of the month's data." />
        )}
      </div>

      {/* Meander divider between sections */}
      <div className="text-stone">
        <MeanderBorder />
      </div>

      {/* Award types explanation */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <LaurelWreath size={22} className="text-brass" />
          <SectionHeader title="Award Categories" subtitle="Seven honors awarded each cycle" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(AWARD_ICON_MAP).map(([type, Icon]) => {
            const color = AWARD_COLOR_MAP[type] || '#C9A227';
            const badgeClass = AWARD_BADGE_MAP[type] || 'badge badge-neutral';
            return (
              <div key={type} className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-2 border border-border">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}20` }}
                >
                  <Icon size={16} color={color} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-ink font-medium">{AWARD_LABEL_MAP[type] || type.replace(/_/g, ' ')}</span>
                </div>
                <span className={cn(badgeClass, 'text-[10px] flex-shrink-0')}>{type.replace(/_/g, ' ')}</span>
              </div>
            );
          })}
        </div>

        {/* Meander divider before weights */}
        <div className="text-stone mt-4">
          <MeanderBorder />
        </div>

        <div className="mt-4">
          <p className="eyebrow mb-2">Monthly Ranking Weights</p>
          <ul className="space-y-1.5 text-xs text-stone">
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Volume</span> — 40%</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Consistency</span> — 20%</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Improvement</span> — 15%</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Quiz</span> — 15%</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Challenge</span> — 5%</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Game</span> — 5%</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
