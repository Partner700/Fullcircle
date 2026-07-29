import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { TentHouseBadge, TentHouseSymbol } from '../../components/TentHouseSymbol';
import { supabase } from '../../lib/supabase';
import { cn, whatsappUrl, formatDenarii } from '../../lib/utils';
import type { Tent, TentMember, Profile } from '../../lib/types';
import { TentAvatar } from '../../components/TentMessenger';
import { MessageCircle, Users, Trophy, Flame, Coins, Heart, Zap, Star, ThumbsUp, Tent as TentIcon } from 'lucide-react';

const REACTIONS = [
  { type: 'fire', icon: Zap, color: '#E8B958', label: 'Fire' },
  { type: 'trophy', icon: Trophy, color: '#E8B958', label: 'Champion' },
  { type: 'heart', icon: Heart, color: '#DC6A6A', label: 'Love it' },
  { type: 'star', icon: Star, color: '#6FBF92', label: 'Shining' },
  { type: 'clap', icon: ThumbsUp, color: '#7B8ED4', label: 'Well done' },
];

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
  const [loading, setLoading] = useState(true);
  const [reactingTo, setReactingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: member } = await supabase.from('tent_members').select('tent_id').eq('user_id', profile.id).maybeSingle();
      if (!member) {
        setTent(null);
        setMembers([]);
        return;
      }

      const [tentResult, membersResult, reactionsResult, unreadResult] = await Promise.all([
        supabase.from('tents').select('*, tent_houses(*)').eq('id', member.tent_id).maybeSingle(),
        supabase.from('tent_members').select('*, profiles(*)').eq('tent_id', member.tent_id).order('joined_at'),
        supabase.from('tent_reactions').select('*').eq('tent_id', member.tent_id).order('created_at', { ascending: false }).limit(50),
        supabase.from('user_notifications').select('actor_id').eq('recipient_id', profile.id).is('read_at', null).eq('action_key', 'tent'),
      ]);
      setTent(tentResult.data as any);
      setMembers((membersResult.data || []) as any);
      setReactions((reactionsResult.data || []) as any);

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
    if (targetUserId !== profile.id) {
      await supabase.rpc('notify_user', {
        p_recipient_id: targetUserId,
        p_actor_id: profile.id,
        p_notification_type: 'info',
        p_title: 'Tent reaction',
        p_body: `${profile.display_name} reacted to you in ${tent.name}.`,
        p_action_key: 'tent',
        p_metadata: { tent_id: tent.id, reaction_type: reactionType, target_type: targetType },
      }).catch(() => null);
    }
    await load();
    setReactingTo(null);
  };

  if (loading) return <div className="text-center py-12 text-stone animate-fade-in">Loading your tent…</div>;

  if (!tent) {
    return (
      <EmptyState
        icon={Users}
        title="You're not in a tent yet"
        message="Your sentry will assign you to a tent soon. Check back later!"
      />
    );
  }

  const sentry = members.find((m) => m.role === 'sentry');
  const cadets = members.filter((m) => m.role === 'cadet');
  const visibleMembers = [...(sentry ? [sentry] : []), ...cadets];

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
                    <span className="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-coral text-white text-[10px] font-bold flex items-center justify-center border-2 border-surface">
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
