import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { LaurelWreath, MeanderBorder, SealBullet } from '../../components/AncientMotifs';
import { fetchAwardReactions, fetchAwards, fetchPersonalAwards, reactToAward, type AwardReactionState } from '../../lib/queries';
import { formatShortDate, getTodayISODate, cn } from '../../lib/utils';
import type { Award, AwardWithRecipient } from '../../lib/types';
import { Award as AwardIcon, Trophy, Crown, BookOpen, MessageCircle, Shield, PenTool, Sprout, BadgeCheck, Send, Gem, Landmark, Medal, KeyRound, Star, ChevronDown, ChevronRight } from 'lucide-react';
import { AwardReactions } from '../../components/AwardReactions';
import { AppSelect } from '../../components/AppSelect';
import { TentHouseSymbol } from '../../components/TentHouseSymbol';
import { MessageAvatar } from '../../components/TentMessenger';
import { ChiRhoMark, GrandVallumMark, VallumText } from '../../components/ChiRhoMark';
import { updateReactionOptimistically } from '../../lib/reactionState';
import { awardCategoryKey, buildAwardCategories } from '../../lib/awardCollection';

const AWARD_ICON_MAP: Record<string, typeof AwardIcon> = {
  rhetoric: MessageCircle,
  nuncio: BookOpen,
  angel: Send,
  rumor: Crown,
  scribe: PenTool,
  sprout: Sprout,
  reputation: Star,
  tutorix: BadgeCheck,
  valley_champion: Shield,
  lords_secret: KeyRound,
  vallum: Trophy,
  monthly_scribe: PenTool,
  monthly_valley_champion: Shield,
  grand_vallum: Crown,
  grand_scribe: PenTool,
  grand_valley_champion: Shield,
  grand_orator: MessageCircle,
  muralis: Medal,
  centurion: Shield,
  bethel_stone: Gem,
  temple_mount: Landmark,
};

// Warm-palette award colors (brass / roman / moss / etc.)
const AWARD_COLOR_MAP: Record<string, string> = {
  rhetoric: '#C9A227',
  nuncio: '#6B8E5A',
  angel: '#F4C84A',
  rumor: '#B8553E',
  scribe: '#7C8CFF',
  sprout: '#5BAD7F',
  reputation: '#D4A03C',
  tutorix: '#7C8CFF',
  valley_champion: '#5BAD7F',
  lords_secret: '#C9A227',
  vallum: '#7285D0',
  monthly_scribe: '#7C8CFF',
  monthly_valley_champion: '#5BAD7F',
  grand_vallum: '#C9A227',
  grand_scribe: '#7C8CFF',
  grand_valley_champion: '#5BAD7F',
  grand_orator: '#C9A227',
  muralis: '#C9A227',
  centurion: '#7C8CFF',
  bethel_stone: '#B8553E',
  temple_mount: '#C9A227',
};

const AWARD_LABEL_MAP: Record<string, string> = {
  rhetoric: 'Rhetoric Award (Orator)',
  nuncio: 'Messenger Award (Nuncio)',
  angel: 'Angel Award (Angelos)',
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
  grand_vallum: 'Grand Vallum',
  grand_scribe: 'Grand Scribe',
  grand_valley_champion: 'Grand Valley Champion',
  grand_orator: 'Grand Orator',
  muralis: 'Muralis',
  centurion: 'Centurion',
  bethel_stone: 'Bethel Stone',
  temple_mount: 'Temple Mount',
};

const WEEKLY_AWARD_CYCLE = /^week-(\d{4}-\d{2}-\d{2})$/;

function awardMatchesMonth(award: AwardWithRecipient, month: string) {
  const cycle = String(award.award_month || '');
  const weeklyDate = cycle.match(WEEKLY_AWARD_CYCLE)?.[1];
  const cycleMonth = weeklyDate?.slice(0, 7) || cycle.slice(0, 7);
  const publishedMonth = String(award.created_at || '').slice(0, 7);
  return cycleMonth === month || (Boolean(weeklyDate) && publishedMonth === month);
}

function formatAwardCycle(cycle: string) {
  const weeklyDate = String(cycle || '').match(WEEKLY_AWARD_CYCLE)?.[1];
  if (weeklyDate) return `Week of ${formatShortDate(weeklyDate)}, ${weeklyDate.slice(0, 4)}`;
  if (/^\d{4}-\d{2}$/.test(cycle)) return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${cycle}-01T00:00:00Z`));
  if (/^\d{4}$/.test(cycle)) return cycle;
  return cycle ? formatShortDate(cycle) : 'Special honor';
}

export function CadetAwards() {
  const { profile } = useAuth();
  const [awards, setAwards] = useState<AwardWithRecipient[]>([]);
  const [personalAwards, setPersonalAwards] = useState<Award[]>([]);
  const [loading, setLoading] = useState(true);
  const [personalError, setPersonalError] = useState(false);
  const [communityError, setCommunityError] = useState(false);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, AwardReactionState>>({});
  const [reacting, setReacting] = useState<string | null>(null);
  const [awardMonth, setAwardMonth] = useState(getTodayISODate().slice(0, 7));
  const [awardType, setAwardType] = useState('all');
  const personalRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++personalRequest.current;
    setLoading(true);
    setPersonalError(false);
    setPersonalAwards([]);
    try {
      const data = profile?.id ? await fetchPersonalAwards(profile.id) : [];
      if (request === personalRequest.current) setPersonalAwards(data);
    } catch { if (request === personalRequest.current) setPersonalError(true); }
    finally { if (request === personalRequest.current) setLoading(false); }
  }, [profile?.id]);

  const loadCommunity = useCallback(async () => {
    setCommunityError(false);
    setCommunityLoading(true);
    try {
      const data = await fetchAwards();
      setAwards(data);
      if (profile?.id) setReactions(await fetchAwardReactions(data.map((award) => award.id), profile.id).catch(() => ({})));
    } catch { setCommunityError(true); } finally { setCommunityLoading(false); }
  }, [profile?.id]);

  const handleReaction = async (awardId: string, reactionType: string) => {
    if (!profile || reacting) return;
    const previousReactions = reactions;
    const nextReacted = !reactions[awardId]?.[reactionType]?.reacted;
    setReacting(`${awardId}:${reactionType}`);
    setReactions((current) => updateReactionOptimistically(current, awardId, reactionType, nextReacted, {
      user_id: profile.id,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url || null,
    }));
    try {
      await reactToAward(awardId, profile.id, reactionType);
      const refreshed = await fetchAwardReactions(awards.map((award) => award.id), profile.id).catch(() => null);
      if (refreshed) setReactions(refreshed);
    } catch (error: any) {
      setReactions(previousReactions);
      alert(error.message || 'Could not save your reaction.');
    } finally {
      setReacting(null);
    }
  };

  useEffect(() => { void load(); return () => { personalRequest.current++; }; }, [load]);
  useEffect(() => { if (communityOpen) void loadCommunity(); }, [communityOpen, loadCommunity]);

  const awardTypeOptions = Array.from(new Set(awards.map(awardCategoryKey))).sort((a, b) => (
    (AWARD_LABEL_MAP[a] || a).localeCompare(AWARD_LABEL_MAP[b] || b)
  ));
  const monthlyAwards = awards.filter((award) => awardMatchesMonth(award, awardMonth));
  const visibleAwards = monthlyAwards.filter((award) => awardType === 'all' || awardCategoryKey(award) === awardType);
  const myAwards = personalAwards;
  const categories = buildAwardCategories(myAwards);
  const earnedCategories = categories.filter(category => category.count > 0).length;

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading awards…</div>;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* My awards */}
      <div className="card overflow-hidden p-5">
        <div className="relative mb-5 overflow-hidden rounded-2xl border border-brass/30 bg-gradient-to-br from-[#172a42] to-[#0f2037] p-5 text-white">
          <div className="pointer-events-none absolute -right-8 -top-8 opacity-10"><LaurelWreath size={180} /></div>
          <div className="relative flex items-center gap-3">
            <div className="rounded-2xl border border-[#d1b36a]/40 bg-white/10 p-3 text-[#e7ca79]"><Trophy size={30} /></div>
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest text-[#e7ca79]">Hall of honors</p><h2 className="font-display text-2xl font-black">My Awards</h2><p className="text-xs text-white/70">Every honor you've earned since joining Full Circle.</p></div>
          </div>
          <div className="relative mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/10 bg-white/10 p-3"><p className="font-display text-3xl font-black text-[#e7ca79]">{personalError ? '—' : myAwards.length}</p><p className="text-xs text-white/80">Lifetime awards</p></div>
            <div className="rounded-xl border border-white/10 bg-white/10 p-3"><p className="font-display text-3xl font-black text-[#e7ca79]">{personalError ? '—' : earnedCategories}</p><p className="text-xs text-white/80">Categories earned</p></div>
          </div>
        </div>
        {personalError ? <div className="card p-4 text-sm text-coral" role="alert">Could not load your collection. <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => void load()}>Try again</button></div> : null}
        {!personalError && (myAwards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myAwards.map((award) => {
              const key = awardCategoryKey(award);
              const Icon = AWARD_ICON_MAP[key] || AwardIcon;
              const color = AWARD_COLOR_MAP[key] || '#C9A227';
              const category = categories.find(item => item.key === key);
              return (
                <div
                  key={award.id}
                  className="relative overflow-hidden rounded-2xl border border-border bg-surface-2 p-4 shadow-sm transition-all card-hover"
                  style={{ borderTop: `3px solid ${color}` }}
                >
                  <div className="pointer-events-none absolute -bottom-6 -right-5 opacity-[0.06]" style={{ color }}><LaurelWreath size={108} /></div>
                  <div className="relative flex items-center gap-3">
                    <div
                      className="w-16 h-16 rounded-2xl border border-current/20 flex items-center justify-center flex-shrink-0"
                      style={{ background: `${color}20`, color }}
                    >
                      {key === 'vallum'
                        ? <ChiRhoMark size={34} className="text-current" />
                        : key === 'grand_vallum'
                          ? <GrandVallumMark size={35} className="text-current" />
                          : <Icon size={32} color={color} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] uppercase font-black tracking-wider" style={{ color }}>{category?.cadence || 'Special honor'}</span>
                      <h4 className="font-display font-bold text-ink leading-tight"><VallumText text={award.title} size={16} /></h4>
                      <p className="text-xs text-stone mt-1">{formatAwardCycle(award.award_month)}</p>
                    </div>
                  </div>
                  {(award.description || category?.meaning) && (
                    <p className="relative text-xs text-stone mt-3"><VallumText text={award.description || category!.meaning} size={11} /></p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={(props) => <AwardIcon {...props} />} title="Your story is just beginning" message="Your first award will appear here when it is earned. Explore the categories below to discover what you can achieve." />
        ))}
      </div>

      {/* Meander divider between sections */}
      <div className="text-stone">
        <MeanderBorder />
      </div>

      {/* All awards this period */}
      <div className="card p-5">
        <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={communityOpen} onClick={() => setCommunityOpen(open => !open)}>
          <LaurelWreath size={22} className="text-brass" />
          <div className="flex-1"><SectionHeader title="Community Awards" subtitle="Celebrate honors across Full Circle" /></div>
          {communityOpen ? <ChevronDown size={18} className="text-stone" /> : <ChevronRight size={18} className="text-stone" />}
        </button>
        {communityOpen && <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-bold text-stone"><span className="mb-1 block">Month</span><input type="month" className="input-field text-xs" value={awardMonth} onChange={event => setAwardMonth(event.target.value)} /></label>
            <label className="block text-xs font-bold text-stone"><span className="mb-1 block">Award</span><AppSelect value={awardType} onChange={setAwardType} options={[{value:'all',label:'All awards'},...awardTypeOptions.map(type=>({value:type,label:AWARD_LABEL_MAP[type] || awards.find(award=>awardCategoryKey(award)===type)?.title || type}))]} buttonClassName="text-xs" /></label>
          </div>
        {communityError && <button className="btn-secondary text-xs" onClick={() => void loadCommunity()}>Retry community awards</button>}
        {communityLoading ? <p className="py-3 text-xs text-stone">Loading community awards…</p> : visibleAwards.length > 0 ? (
          <div className="space-y-2">
            {visibleAwards.map((award) => {
              const key = awardCategoryKey(award);
              const Icon = AWARD_ICON_MAP[key] || AwardIcon;
              const color = AWARD_COLOR_MAP[key] || '#C9A227';
              const houseId = award.target_tent?.tent_house_id || award.recipient_tent?.tent_house_id || null;
              return (
                <div
                  key={award.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${color}20`, color }}
                  >
                    {key === 'vallum'
                      ? <ChiRhoMark size={18} className="text-current" />
                      : key === 'grand_vallum'
                        ? <GrandVallumMark size={19} className="text-current" />
                        : <Icon size={18} color={color} />}
                  </div>
                  {award.profiles && award.award_target_type !== 'tent' && (
                    <MessageAvatar
                      profile={{
                        id: award.user_id,
                        display_name: award.profiles.display_name,
                        email: null,
                        avatar_url: award.profiles.avatar_url,
                        whatsapp_number: null,
                        country_code: null,
                        language_code: null,
                        created_at: award.created_at,
                      }}
                      currentUserId={profile?.id}
                      size="sm"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="inline-flex max-w-full items-center gap-1.5 align-middle text-sm font-medium text-ink">
                      <span className="truncate">{award.target_tent?.name || award.profiles?.display_name || 'Full Circle member'}</span>
                      {houseId && <TentHouseSymbol houseId={houseId} size={19} />}
                    </span>
                    <span className="text-stone text-sm"> · <VallumText text={award.title} size={13} /></span>
                    {award.target_tent && (
                      <p className="text-xs text-stone">Sentry: {award.target_tent.sentry?.display_name || 'Not assigned'}</p>
                    )}
                    <AwardReactions state={reactions[award.id]} disabled={!!reacting?.startsWith(`${award.id}:`)} currentUserId={profile?.id} onReact={(type) => void handleReaction(award.id, type)} />
                  </div>
                  <span className="text-xs text-stone flex-shrink-0">{formatAwardCycle(award.award_month)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={(props) => <Trophy {...props} />} title="No awards announced" message="No awards match this month and award filter yet." />
        )}</div>}
      </div>

      {/* Meander divider between sections */}
      <div className="text-stone">
        <MeanderBorder />
      </div>

      {/* Award types explanation */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <LaurelWreath size={22} className="text-brass" />
          <SectionHeader title="Award Categories" subtitle="Tap any award to see what it means and how many you've won." />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
          {categories.map((category) => {
            const type = category.key;
            const Icon = AWARD_ICON_MAP[type] || AwardIcon;
            const color = AWARD_COLOR_MAP[type] || '#C9A227';
            const isOpen = expandedCategory === type;
            const isTent = category.cadence.includes('Tent award');
            return (
              <div key={type} className={cn('rounded-xl bg-surface-2 border overflow-hidden', isOpen ? 'border-brass' : 'border-border')}>
              <button type="button" aria-expanded={isOpen} aria-controls={`award-category-${type}`} onClick={() => setExpandedCategory(isOpen ? null : type)} className="w-full flex items-center gap-2.5 p-3 text-left hover:bg-surface transition-colors">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}20`, color }}
                >
                  {type === 'vallum'
                    ? <ChiRhoMark size={16} className="text-current" />
                    : type === 'grand_vallum'
                      ? <GrandVallumMark size={17} className="text-current" />
                      : <Icon size={16} color={color} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink font-semibold leading-tight"><VallumText text={category.label} size={13} /></p>
                  <p className="text-[10px] text-stone mt-0.5">{category.cadence}</p>
                </div>
                <span className={cn('min-w-8 rounded-lg px-2 py-1 text-center font-display font-bold text-sm', category.count > 0 ? 'bg-brass/15 text-brass' : 'bg-surface text-stone')}>{personalError ? '—' : category.count}</span>
                {isOpen ? <ChevronDown size={16} className="shrink-0 text-stone" /> : <ChevronRight size={16} className="shrink-0 text-stone" />}
              </button>
              {isOpen && <div id={`award-category-${type}`} className="border-t border-border px-3 py-3 space-y-1">
                <p className="text-xs font-bold text-ink">{isTent ? 'Collective award · not individually earned' : personalError ? 'Count unavailable' : `You've earned ${category.count} ${category.count === 1 ? 'award' : 'awards'}`}</p>
                <p className="text-sm leading-relaxed text-stone">{category.meaning}</p>
                {isTent && <p className="text-xs text-stone">Collective honors are not counted as personal awards.</p>}
              </div>}
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
              <span><span className="text-ink font-medium">Marks</span> — the grand total used alongside monthly app activity when watching <VallumText text="Vallum" size={11} />.</span>
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
              <span><span className="text-ink font-medium">Tent Awards</span> — The Lord's Secret weekly, Bethel Stone monthly, and Temple Mount annually.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
