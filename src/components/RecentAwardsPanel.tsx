import { useCallback, useEffect, useState } from 'react';
import { Award as AwardIcon, ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { fetchAwards, fetchPanelImageSetting } from '../lib/queries';
import type { AwardWithRecipient, PanelImageSetting } from '../lib/types';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { AwardReactions } from './AwardReactions';
import { useAuth } from '../context/AuthContext';
import { fetchAwardReactions, reactToAward, type AwardReactionState } from '../lib/queries';
import { TentHouseSymbol } from './TentHouseSymbol';
import { useAutoAdvance } from '../hooks/useAutoAdvance';
import { MessageAvatar } from './TentMessenger';
import { VallumText } from './ChiRhoMark';
import { updateReactionOptimistically } from '../lib/reactionState';

type RecentAward = AwardWithRecipient;

function weeklyPublishedAwards(awards: RecentAward[]) {
  const now = new Date();
  // Cameroon is UTC+1 year-round. Calculate its Saturday boundary without
  // depending on the viewer's device timezone.
  const doualaClock = new Date(now.getTime() + 60 * 60 * 1000);
  const saturdayDoualaClock = Date.UTC(
    doualaClock.getUTCFullYear(),
    doualaClock.getUTCMonth(),
    doualaClock.getUTCDate() - ((doualaClock.getUTCDay() + 1) % 7),
  );
  const saturdayUtc = saturdayDoualaClock - 60 * 60 * 1000;
  return awards.filter((award) => new Date(award.created_at).getTime() >= saturdayUtc);
}

export function RecentAwardsPanel({ onOpen }: { onOpen?: () => void }) {
  const { profile } = useAuth();
  const [awards, setAwards] = useState<RecentAward[]>([]);
  const [image, setImage] = useState<PanelImageSetting | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reactions, setReactions] = useState<Record<string, AwardReactionState>>({});
  const [reacting, setReacting] = useState<string | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [held, setHeld] = useState(false);

  const load = useCallback(async () => {
    const [awardResult, imageResult] = await Promise.allSettled([
      fetchAwards(),
      fetchPanelImageSetting('recent_awards'),
    ]);
    const allAwards = weeklyPublishedAwards(awardResult.status === 'fulfilled' ? awardResult.value as RecentAward[] : []);
    setAwards(allAwards);
    setImage(imageResult.status === 'fulfilled' ? imageResult.value : null);
    if (profile && allAwards.length > 0) {
      setReactions(await fetchAwardReactions(allAwards.map((award) => award.id), profile.id).catch(() => ({})));
    }
  }, [profile]);

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

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useAutoAdvance(awards.length > 1 && !messageOpen && !held, () => {
    setActiveIndex((index) => (index + 1) % awards.length);
  });

  useEffect(() => {
    if (awards.length === 0) setActiveIndex(0);
  }, [awards.length]);

  const logicalAwardIndex = awards.length ? ((activeIndex % awards.length) + awards.length) % awards.length : 0;
  const activeAward = awards[logicalAwardIndex];
  const activeHouseId = activeAward?.target_tent?.tent_house_id || activeAward?.recipient_tent?.tent_house_id || null;
  const move = (direction: number) => {
    if (!awards.length) return;
    setActiveIndex((index) => index + direction);
  };

  return (
    <section className="card relative isolate overflow-hidden border-gold/30 bg-surface-2">
      <PanelImageBackdrop
        image={image}
        opacityFallback={100}
        veilClassName=""
        modeFilter={false}
        textGradient={false}
      />
      <div className="panel-veil-layer award-panel-veil pointer-events-none absolute" aria-hidden="true" />
      <div className="relative z-10 flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2"><Trophy size={17} className="text-gold" /><div><h3 className="font-display text-sm font-semibold text-ink">Recent Awards</h3><p className="text-[11px] text-stone">Honors across Full Circle</p></div></div>
        {onOpen && <button type="button" onClick={onOpen} className="btn-ghost px-2 py-1 text-xs">View all</button>}
      </div>
      {activeAward ? (
        <div className="relative z-10 min-h-[148px] overflow-hidden" onTouchStart={() => setHeld(true)} onTouchEnd={() => setHeld(false)} onTouchCancel={() => setHeld(false)}>
          <div key={activeAward.id} className="recent-award-change flex min-h-[148px] items-center gap-4 px-5 pb-10 pt-5">
            {activeAward.target_tent ? (
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full border-2 border-gold/50 bg-gold-soft text-gold shadow-sm">
                {activeAward.target_tent.profile_image_url
                  ? <img src={activeAward.target_tent.profile_image_url} alt={activeAward.target_tent.name} className="h-full w-full object-cover" />
                  : <Trophy size={24} className="mx-auto mt-3.5" />}
              </div>
            ) : activeAward.profiles ? (
              <MessageAvatar
                profile={{
                  id: activeAward.user_id,
                  display_name: activeAward.profiles.display_name,
                  email: null,
                  avatar_url: activeAward.profiles.avatar_url,
                  whatsapp_number: null,
                  country_code: null,
                  language_code: null,
                  created_at: activeAward.created_at,
                }}
                currentUserId={profile?.id}
                size="lg"
                className="flex-shrink-0"
                onOpenChange={setMessageOpen}
              />
            ) : (
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full border-2 border-gold/50 bg-gold-soft text-gold shadow-sm">
                <Trophy size={24} className="mx-auto mt-3.5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-ink"><VallumText text={activeAward.title} size={15} /></p>
              <p className="flex items-center gap-1.5 text-sm font-medium text-stone">
                <span className="truncate">{activeAward.target_tent?.name || activeAward.profiles?.display_name || 'Full Circle member'}</span>
                {activeHouseId && <TentHouseSymbol houseId={activeHouseId} size={20} />}
              </p>
              {activeAward.target_tent && <p className="text-xs text-stone">Family trophy · Sentry: {activeAward.target_tent.sentry?.display_name || 'Not assigned'}</p>}
              {activeAward.description && <p className="mt-1 line-clamp-2 text-xs text-stone"><VallumText text={activeAward.description} size={11} /></p>}
              <AwardReactions state={reactions[activeAward.id]} disabled={!!reacting?.startsWith(`${activeAward.id}:`)} currentUserId={profile?.id} onMessageOpenChange={setMessageOpen} onReact={(type) => void handleReaction(activeAward.id, type)} />
            </div>
            <AwardIcon size={22} className="flex-shrink-0 text-gold" aria-hidden="true" />
          </div>
          {awards.length > 1 && (
            <div className="absolute bottom-2 right-3 flex items-center gap-1">
              <button type="button" onClick={() => move(-1)} className="icon-btn h-7 w-7" aria-label="Previous award"><ChevronLeft size={14} /></button>
              <span className="min-w-8 text-center text-[10px] text-stone">{logicalAwardIndex + 1}/{awards.length}</span>
              <button type="button" onClick={() => move(1)} className="icon-btn h-7 w-7" aria-label="Next award"><ChevronRight size={14} /></button>
            </div>
          )}
        </div>
      ) : <p className="relative z-10 px-4 py-5 text-sm text-stone">New honors will appear here as they are awarded.</p>}
    </section>
  );
}
