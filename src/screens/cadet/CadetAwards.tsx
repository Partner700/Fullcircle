import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { LaurelWreath, MeanderBorder, SealBullet } from '../../components/AncientMotifs';
import { fetchAwardReactions, fetchAwards, reactToAward, type AwardReactionState } from '../../lib/queries';
import { formatShortDate, getTodayISODate, cn } from '../../lib/utils';
import type { AwardWithRecipient } from '../../lib/types';
import { Award as AwardIcon, Trophy, Crown, BookOpen, MessageCircle, Shield, PenTool, Sprout, Users, Cross, BadgeCheck } from 'lucide-react';
import { AwardReactions } from '../../components/AwardReactions';

const AWARD_ICON_MAP: Record<string, typeof Trophy> = {
  rhetoric: MessageCircle,
  nuncio: BookOpen,
  rumor: Crown,
  scribe: PenTool,
  sprout: Sprout,
  reputation: Shield,
  tutorix: BadgeCheck,
  valley_champion: Shield,
  lords_secret: Users,
  vallum: Cross,
  monthly_scribe: PenTool,
  monthly_valley_champion: Shield,
  portion_of_priests: Users,
  grand_vallum: Crown,
  grand_scribe: PenTool,
  grand_valley_champion: Shield,
  grand_orator: MessageCircle,
  bethel_stone: Trophy,
};

// Warm-palette award colors (brass / roman / moss / etc.)
const AWARD_COLOR_MAP: Record<string, string> = {
  rhetoric: '#C9A227',
  nuncio: '#6B8E5A',
  rumor: '#B8553E',
  scribe: '#7C8CFF',
  sprout: '#5BAD7F',
  reputation: '#D4A03C',
  tutorix: '#7C8CFF',
  valley_champion: '#5BAD7F',
  lords_secret: '#C9A227',
  vallum: '#DDE3FF',
  monthly_scribe: '#7C8CFF',
  monthly_valley_champion: '#5BAD7F',
  portion_of_priests: '#D4A03C',
  grand_vallum: '#C9A227',
  grand_scribe: '#7C8CFF',
  grand_valley_champion: '#5BAD7F',
  grand_orator: '#C9A227',
  bethel_stone: '#B8553E',
};

const AWARD_BADGE_MAP: Record<string, string> = {
  rhetoric: 'badge badge-brass',
  nuncio: 'badge badge-moss',
  rumor: 'badge badge-roman',
  scribe: 'badge badge-neutral',
  sprout: 'badge badge-moss',
  reputation: 'badge badge-brass',
  tutorix: 'badge badge-neutral',
  valley_champion: 'badge badge-moss',
  lords_secret: 'badge badge-brass',
  vallum: 'badge badge-neutral',
  monthly_scribe: 'badge badge-neutral',
  monthly_valley_champion: 'badge badge-moss',
  portion_of_priests: 'badge badge-brass',
  grand_vallum: 'badge badge-brass',
  grand_scribe: 'badge badge-neutral',
  grand_valley_champion: 'badge badge-moss',
  grand_orator: 'badge badge-brass',
  bethel_stone: 'badge badge-roman',
};

const AWARD_LABEL_MAP: Record<string, string> = {
  rhetoric: 'Rhetoric Award (Orator)',
  nuncio: 'Messenger Award (Nuncio)',
  rumor: 'Rumor Award',
  scribe: 'Scribe Award',
  sprout: 'The Sprout',
  reputation: 'Reputation Award',
  tutorix: 'Tutorix',
  valley_champion: 'Valley Champion',
  lords_secret: "The Lord's Secret",
  vallum: 'Vallum',
  monthly_scribe: 'Monthly Scribe',
  monthly_valley_champion: 'Monthly Valley Champion',
  portion_of_priests: 'Portion of the Priests',
  grand_vallum: 'Grand Vallum',
  grand_scribe: 'Grand Scribe',
  grand_valley_champion: 'Grand Valley Champion',
  grand_orator: 'Grand Orator',
  bethel_stone: 'Bethel Stone',
};

export function CadetAwards() {
  const { profile } = useAuth();
  const [awards, setAwards] = useState<AwardWithRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [reactions, setReactions] = useState<Record<string, AwardReactionState>>({});
  const [reacting, setReacting] = useState<string | null>(null);
  const [awardMonth, setAwardMonth] = useState(getTodayISODate().slice(0, 7));
  const [awardType, setAwardType] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchAwards();
    setAwards(data);
    if (profile) setReactions(await fetchAwardReactions(data.map((award) => award.id), profile.id).catch(() => ({})));
    setLoading(false);
  }, [profile]);

  const handleReaction = async (awardId: string, reactionType: string) => {
    if (!profile || reacting) return;
    setReacting(`${awardId}:${reactionType}`);
    try {
      await reactToAward(awardId, profile.id, reactionType);
      setReactions(await fetchAwardReactions(awards.map((award) => award.id), profile.id));
    } finally {
      setReacting(null);
    }
  };

  useEffect(() => { load(); }, [load]);

  const awardTypeOptions = Array.from(new Set(awards.map((award) => award.award_type).filter(Boolean))).sort((a, b) => (
    (AWARD_LABEL_MAP[a] || a).localeCompare(AWARD_LABEL_MAP[b] || b)
  ));
  const monthlyAwards = awards.filter((award) => String(award.award_month || '').startsWith(awardMonth));
  const visibleAwards = monthlyAwards.filter((award) => awardType === 'all' || award.award_type === awardType);
  const myAwards = visibleAwards.filter((a) => a.award_target_type !== 'tent' && a.user_id === profile?.id);

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading awards…</div>;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* My awards */}
      <div className="card p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-2">
            <LaurelWreath size={22} className="text-brass" />
            <SectionHeader title="My Awards" subtitle={`${myAwards.length} earned this month`} />
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(9rem,auto)_minmax(12rem,auto)]">
            <label className="block text-xs font-bold text-stone">
              <span className="mb-1 block">Month</span>
              <input type="month" className="input-field text-xs" value={awardMonth} onChange={(event) => setAwardMonth(event.target.value)} />
            </label>
            <label className="block text-xs font-bold text-stone">
              <span className="mb-1 block">Award</span>
              <select className="input-field text-xs" value={awardType} onChange={(event) => setAwardType(event.target.value)}>
                <option value="all">All awards</option>
                {awardTypeOptions.map((type) => (
                  <option key={type} value={type}>{AWARD_LABEL_MAP[type] || type.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>
          </div>
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
                    <p className="text-xs text-stone mt-2 line-clamp-2">{award.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={(props) => <AwardIcon {...props} />} title="No awards yet" message="Awards are computed monthly from your streak, quiz, game, and challenge performance. Keep going!" />
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
          <SectionHeader title="All Awards" subtitle="This month's visible honors across cadets, sentries, and tents" />
        </div>
        {visibleAwards.length > 0 ? (
          <div className="space-y-2">
            {visibleAwards.map((award) => {
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
                    <span className="text-sm font-medium text-ink">{award.target_tent?.name || award.profiles?.display_name || 'Full Circle member'}</span>
                    <span className="text-stone text-sm"> · {award.title}</span>
                    {award.target_tent && (
                      <p className="text-xs text-stone">Sentry: {award.target_tent.sentry?.display_name || 'Not assigned'}</p>
                    )}
                    <AwardReactions state={reactions[award.id]} disabled={!!reacting?.startsWith(`${award.id}:`)} onReact={(type) => void handleReaction(award.id, type)} />
                  </div>
                  <span className="text-xs text-stone flex-shrink-0">{formatShortDate(award.award_month)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={(props) => <Trophy {...props} />} title="No awards announced" message="No awards match this month and award filter yet." />
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
          <SectionHeader title="Award Categories" subtitle="Current weekly, monthly, and annual honors" />
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
          <p className="eyebrow mb-2">Current Score Language</p>
          <ul className="space-y-1.5 text-xs text-stone">
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Marks</span> — grand total for Rumor, Vallum, and Grand Vallum.</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Figs</span> — correct answers from games, quizzes, and Arena play.</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Rhudes</span> — Arena victories on the Valley Board.</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Denarii</span> — earned currency on the Denarii Board.</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Streaks</span> — faithfulness on the Streak Board.</span>
            </li>
            <li className="flex items-center gap-2">
              <SealBullet className="text-brass flex-shrink-0" />
              <span><span className="text-ink font-medium">Tent Awards</span> — belong to tents, not tent houses.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
