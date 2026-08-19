import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { TentHouseBadge, TentHouseSymbol } from '../../components/TentHouseSymbol';
import { supabase } from '../../lib/supabase';
import { cn, whatsappUrl, formatDenarii } from '../../lib/utils';
import type { AwardWithRecipient, Tent, TentMember, Profile } from '../../lib/types';
import { TentAvatar, TentGroupMessenger } from '../../components/TentMessenger';
import { fetchAwards, fetchPanelImageSetting } from '../../lib/queries';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { AppSelect } from '../../components/AppSelect';
import type { PanelImageSetting } from '../../lib/types';
import { Award, MessageCircle, Users, Trophy, Flame, Coins, Heart, Zap, Star, ThumbsUp, Tent as TentIcon, Loader2, UserPlus } from 'lucide-react';

const REACTIONS = [
  { type: 'fire', icon: Zap, color: '#E8B958', label: 'Fire' },
  { type: 'trophy', icon: Trophy, color: '#E8B958', label: 'Champion' },
  { type: 'heart', icon: Heart, color: '#DC6A6A', label: 'Love it' },
  { type: 'star', icon: Star, color: '#6FBF92', label: 'Shining' },
  { type: 'clap', icon: ThumbsUp, color: '#7B8ED4', label: 'Well done' },
];

function weeklyPublishedAwards(awards: AwardWithRecipient[]) {
  const now = new Date();
  const doualaClock = new Date(now.getTime() + 60 * 60 * 1000);
  const saturdayDoualaClock = Date.UTC(
    doualaClock.getUTCFullYear(),
    doualaClock.getUTCMonth(),
    doualaClock.getUTCDate() - ((doualaClock.getUTCDay() + 1) % 7),
  );
  const saturdayUtc = saturdayDoualaClock - 60 * 60 * 1000;
  return awards.filter((award) => new Date(award.created_at).getTime() >= saturdayUtc);
}

type ReactionRow = {
  id: string;
  reactor_user_id: string;
  target_user_id: string;
  reaction_type: string;
  target_type: string;
  target_reference: string | null;
  created_at: string;
};

export function CadetTent() {
  const { profile } = useAuth();
  const [tent, setTent] = useState<(Tent & { tent_houses?: any }) | null>(null);
  const [members, setMembers] = useState<(TentMember & { profiles: Profile })[]>([]);
  const [reactions, setReactions] = useState<ReactionRow[]>([]);
  const [denariiMap, setDenariiMap] = useState<Record<string, number>>({});
  const [streakMap, setStreakMap] = useState<Record<string, number>>({});
  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({});
  const [tentAwards, setTentAwards] = useState<AwardWithRecipient[]>([]);
  const [awardsImage, setAwardsImage] = useState<PanelImageSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [availableTents, setAvailableTents] = useState<any[]>([]);
  const [pendingTentId, setPendingTentId] = useState<string | null>(null);
  const [requestingTentId, setRequestingTentId] = useState<string | null>(null);
  const [awardView, setAwardView] = useState('week');
  const [showTentChat, setShowTentChat] = useState(false);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: member } = await supabase.from('tent_members').select('tent_id').eq('user_id', profile.id).maybeSingle();
      if (!member) {
        setTent(null);
        setMembers([]);
        const [{ data: tentRows }, { data: requestRow }] = await Promise.all([
          supabase.from('tents').select('id,name,max_cadets,profile_image_url,tent_houses(name)').order('name'),
          supabase.from('tent_join_requests').select('tent_id').eq('user_id', profile.id).eq('status', 'pending').maybeSingle(),
        ]);
        const tentsWithCounts = await Promise.all((tentRows || []).map(async (row: any) => {
          const { count } = await supabase.from('tent_members').select('id', { count: 'exact', head: true }).eq('tent_id', row.id).eq('role', 'cadet');
          return { ...row, cadet_count: count || 0 };
        }));
        setAvailableTents(tentsWithCounts);
        setPendingTentId(requestRow?.tent_id || null);
        return;
      }

      const [tentResult, membersResult, reactionsResult, unreadResult, awardsResult, awardsImageResult] = await Promise.all([
        supabase.from('tents').select('*, tent_houses(*)').eq('id', member.tent_id).maybeSingle(),
        supabase.from('tent_members').select('*, profiles(id,display_name,avatar_url,created_at)').eq('tent_id', member.tent_id).order('joined_at'),
        supabase.from('tent_reactions').select('*').eq('tent_id', member.tent_id).order('created_at', { ascending: false }).limit(50),
        supabase.from('user_notifications').select('actor_id').eq('recipient_id', profile.id).is('read_at', null).eq('action_key', 'tent'),
        fetchAwards(),
        fetchPanelImageSetting('recent_awards'),
      ]);
      setTent(tentResult.data as any);
      setMembers((membersResult.data || []) as any);
      setReactions((reactionsResult.data || []) as any);
      const tentMemberIds = new Set((membersResult.data || []).map((m: any) => m.user_id));
      if (tentResult.data?.sentry_id) tentMemberIds.add(tentResult.data.sentry_id);
      setTentAwards(awardsResult.filter((award) => (
        award.award_target_type === 'tent'
          ? award.award_target_id === member.tent_id
          : tentMemberIds.has(award.user_id) || (!!award.award_target_id && tentMemberIds.has(award.award_target_id))
      )));
      setAwardsImage(awardsImageResult);

      const memberIds = (membersResult.data || []).map((m: any) => m.user_id);
      const [denariiResults, streakResults] = await Promise.all([
        Promise.all(memberIds.map(async (uid: string) => ({ uid, data: (await supabase.rpc('get_user_denarii_total', { p_user_id: uid })).data }))),
        Promise.all(memberIds.map(async (uid: string) => ({ uid, data: (await supabase.rpc('compute_strict_streak', { p_user_id: uid })).data }))),
      ]);
      setDenariiMap(Object.fromEntries(denariiResults.map(({ uid, data }) => [uid, Number(data) || 0])));
      setStreakMap(Object.fromEntries(streakResults.flatMap(({ uid, data }: any) => data?.[0] ? [[uid, data[0].current_streak]] : [])));

      const unreadMap: Record<string, number> = {};
      (unreadResult.data || []).forEach((n: any) => {
        if (n.actor_id) unreadMap[n.actor_id] = (unreadMap[n.actor_id] || 0) + 1;
      });
      setUnreadBySender(unreadMap);
    } catch (error) {
      console.error('Tent load error:', error);
      setTent(null);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  const requestTent = async (tentId: string) => {
    setRequestingTentId(tentId);
    const { error } = await supabase.rpc('request_to_join_tent', { p_tent_id: tentId });
    setRequestingTentId(null);
    if (error) return alert(error.message);
    setPendingTentId(tentId);
  };

  const sendReaction = async (targetUserId: string, reactionType: string, targetType: string, ref?: string) => {
    if (!profile || !tent) return;
    setReactingTo(targetUserId);
    await supabase.from('tent_reactions').insert({
      tent_id: tent.id,
      reactor_user_id: profile.id,
      target_user_id: targetUserId,
      reaction_type: reactionType,
      target_type: targetType,
      target_reference: ref || null,
    });
    await load();
    setReactingTo(null);
  };

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading your tent…</div>;

  if (!tent) {
    return (
      <div className="space-y-5 animate-fade-in">
        <EmptyState icon={Users} title="You're not in a tent yet" message="Choose a tent below and request to join its family." />
        <div className="grid gap-3 sm:grid-cols-2">
          {availableTents.map((item) => {
            const full = item.cadet_count >= (item.max_cadets || 10);
            const pending = pendingTentId === item.id;
            return <article key={item.id} className="card flex items-center gap-3 p-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                {item.profile_image_url ? <img src={item.profile_image_url} alt="" className="h-full w-full object-cover" /> : <TentIcon size={22} className="text-gold" />}
              </div>
              <div className="min-w-0 flex-1"><p className="font-bold text-ink">{item.name}</p><p className="text-xs text-stone">{item.tent_houses?.name} · {item.cadet_count}/{item.max_cadets || 10} cadets</p></div>
              <button type="button" disabled={full || pending || !!requestingTentId} onClick={() => void requestTent(item.id)} className="btn-secondary px-3 text-xs">
                {requestingTentId === item.id ? <Loader2 size={14} className="animate-spin" /> : pending ? 'Pending' : full ? 'Full' : <><UserPlus size={14} /> Join</>}
              </button>
            </article>;
          })}
        </div>
      </div>
    );
  }

  const sentry = members.find((m) => m.role === 'sentry');
  const cadets = members.filter((m) => m.role === 'cadet');
  const visibleMembers = [...(sentry ? [sentry] : []), ...cadets];
  const memberById = new Map(visibleMembers.map((m) => [m.user_id, m]));
  const visibleTentAwards = awardView === 'week' ? weeklyPublishedAwards(tentAwards) : tentAwards;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Tent header */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-16 h-16 rounded-xl overflow-hidden border border-border bg-surface-2 flex items-center justify-center flex-shrink-0">
            {tent.profile_image_url ? (
              <img src={tent.profile_image_url} alt={`${tent.name} profile`} className="w-full h-full object-cover" />
            ) : (
              <TentIcon size={24} className="text-brass" />
            )}
          </div>
          <div className="flex-1">
          {tent.tent_houses && <TentHouseBadge houseId={tent.tent_houses.id} size="sm" />}
            <h2 className="font-display font-bold text-lg text-ink">{tent.name}</h2>
            <p className="text-xs text-stone">{cadets.length} cadet{cadets.length === 1 ? '' : 's'} · {sentry ? '1 sentry' : 'no sentry assigned'}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowTentChat(true)}
          className="btn-secondary mb-3 w-full justify-center text-sm"
        >
          <Users size={16} /> Tent Chat
        </button>

        {/* Reach out to sentry */}
        {sentry && whatsappUrl(sentry.profiles.whatsapp_number) && (
          <a
            href={whatsappUrl(sentry.profiles.whatsapp_number)!}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary w-full text-sm flex items-center justify-center gap-2"
            style={{ background: 'rgba(37, 211, 102, 0.10)', borderColor: 'rgba(37, 211, 102, 0.3)', color: '#25D366' }}
          >
            <MessageCircle size={16} /> Reach out to {sentry.profiles.display_name.split(' ')[0]} (Sentry)
          </a>
        )}
        {sentry && !whatsappUrl(sentry.profiles.whatsapp_number) && (
          <p className="text-xs text-stone text-center py-2">Your sentry hasn't added a WhatsApp number yet.</p>
        )}
      </div>
      {showTentChat && profile && (
        <TentGroupMessenger
          tentId={tent.id}
          senderId={profile.id}
          tentName={tent.name}
          onClose={() => setShowTentChat(false)}
        />
      )}

      {/* Awards belong to the tent as a family. */}
      <section className="card relative isolate overflow-visible border-gold/35">
        <div className="absolute inset-0 isolate overflow-hidden rounded-[inherit]">
          <PanelImageBackdrop image={awardsImage} opacityFallback={100} veilClassName="" modeFilter={false} textGradient={false} />
          <div className="panel-veil-layer tent-award-panel-veil pointer-events-none absolute" aria-hidden="true" />
        </div>
        <div className="relative z-10 flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={18} className="text-gold" />
            <div>
              <h3 className="font-display text-base font-semibold text-ink">Our Family Trophies</h3>
              <p className="text-xs text-stone">Awards won together by {tent.name}</p>
            </div>
          </div>
          <AppSelect
            value={awardView}
            onChange={setAwardView}
            className="w-full sm:w-44"
            buttonClassName="min-h-10 py-1.5 text-xs"
            options={[
              { value: 'week', label: 'This Week' },
              { value: 'all', label: 'All Awards' },
            ]}
          />
        </div>
        {visibleTentAwards.length > 0 ? (
          <div className="relative z-10 grid gap-3 p-4 sm:grid-cols-2">
            {visibleTentAwards.map((award) => {
              const isTentAward = award.award_target_type === 'tent';
              const recipient = !isTentAward
                ? memberById.get(award.user_id) || memberById.get(award.award_target_id || '')
                : null;
              return (
                <article key={award.id} className="flex items-center gap-3 rounded-lg border border-gold/30 bg-surface/80 p-3 backdrop-blur-sm">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gold-soft text-gold">
                    {recipient?.profiles.avatar_url ? (
                      <img src={recipient.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Trophy size={21} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{award.title}</p>
                    <p className="text-xs text-stone">
                      {isTentAward
                        ? `${tent.name}${sentry ? ` · Sentry: ${sentry.profiles.display_name}` : ''}`
                        : `${recipient?.profiles.display_name || award.profiles?.display_name || 'Tent member'} · ${recipient?.role || 'member'}`}
                    </p>
                    <p className="text-[10px] text-stone/80">{award.award_month}</p>
                    {award.description && <p className="mt-1 line-clamp-2 text-xs text-stone">{award.description}</p>}
                  </div>
                  <Award size={17} className="flex-shrink-0 text-gold" />
                </article>
              );
            })}
          </div>
        ) : (
          <p className="relative z-10 px-4 py-5 text-sm text-stone">
            {awardView === 'week' ? 'No family trophies have been published this week yet.' : 'The trophies your tent wins will remain here as part of its family history.'}
          </p>
        )}
      </section>

      {/* Tent members */}
      <SectionHeader title="Your Tent" subtitle="React to your sentry and tent mates" />

      <div className="space-y-3">
        {visibleMembers.map((m) => {
          const isMe = m.user_id === profile?.id;
          const isSentry = m.role === 'sentry';
          const den = denariiMap[m.user_id] || 0;
          const streak = streakMap[m.user_id] || 0;
          const myReactions = reactions.filter((r) => r.target_user_id === m.user_id);

          return (
            <div key={m.user_id} className={cn('card p-4', isMe && 'border-brass', isSentry && 'border-royal/35 bg-royal-soft/30')}>
              <div className="flex items-start gap-3">
                <div className="relative flex-shrink-0">
                  <TentAvatar member={m} currentUserId={profile!.id} tentId={tent.id} size="md" />
                  {(unreadBySender[m.user_id] || 0) > 0 && (
                    <span className="notification-badge-ring absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-coral p-0 text-[9px] font-bold leading-none text-white shadow-sm">
                      {unreadBySender[m.user_id]}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-ink truncate">
                      {m.profiles.display_name}
                      {isMe && <span className="text-stone text-xs ml-1">(you)</span>}
                    </p>
                    {isSentry && <span className="badge badge-royal text-[9px]">Sentry</span>}
                    {tent.tent_houses && <TentHouseSymbol houseId={tent.tent_houses.id} size={16} />}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-stone">
                    <span className="flex items-center gap-1">
                      <Coins size={12} className="text-gold" /> {formatDenarii(den)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Flame size={12} className="text-roman" /> {streak} day streak
                    </span>
                  </div>
                </div>
              </div>

              {/* Reactions received */}
              {myReactions.length > 0 && (
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {myReactions.slice(0, 8).map((r) => {
                    const reaction = REACTIONS.find((re) => re.type === r.reaction_type);
                    if (!reaction) return null;
                    const Icon = reaction.icon;
                    return (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{ background: `${reaction.color}15`, color: reaction.color }}
                      >
                        <Icon size={10} />
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Reaction buttons — don't react to yourself */}
              {!isMe && (
                <div className="flex items-center gap-1.5 mt-3">
                  <span className="text-[10px] text-stone mr-1">React:</span>
                  {REACTIONS.map((r) => {
                    const Icon = r.icon;
                    return (
                      <button
                        key={r.type}
                        onClick={() => sendReaction(m.user_id, r.type, 'high_score', String(den))}
                        disabled={reactingTo === m.user_id}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:scale-110 active:scale-95 disabled:opacity-40"
                        style={{ background: `${r.color}12` }}
                        title={r.label}
                      >
                        <Icon size={14} style={{ color: r.color }} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent activity feed */}
      {reactions.length > 0 && (
        <>
          <SectionHeader title="Recent Reactions" subtitle="What your tent mates are celebrating" />
          <div className="card p-4 space-y-2">
            {reactions.slice(0, 10).map((r) => {
              const reactor = members.find((m) => m.user_id === r.reactor_user_id);
              const target = members.find((m) => m.user_id === r.target_user_id);
              const reaction = REACTIONS.find((re) => re.type === r.reaction_type);
              if (!reactor || !target || !reaction) return null;
              const Icon = reaction.icon;
              return (
                <div key={r.id} className="flex items-center gap-2 text-xs text-stone">
                  <Icon size={12} style={{ color: reaction.color }} />
                  <span className="text-ink font-medium">{reactor.profiles.display_name.split(' ')[0]}</span>
                  <span>reacted to</span>
                  <span className="text-ink font-medium">{target.profiles.display_name.split(' ')[0]}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
