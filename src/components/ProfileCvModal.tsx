import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenCheck, Coins, Loader2, Shield, Swords, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchPanelImageSetting, fetchProfileCv } from '../lib/queries';
import { OPEN_PROFILE_CV_EVENT } from '../lib/profileCv';
import type { PanelImageSetting, ProfileCvData } from '../lib/types';
import { formatDenarii } from '../lib/utils';
import { ChiRhoMark } from './ChiRhoMark';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { TentHouseBadge } from './TentHouseSymbol';
import { UserAvatar } from './UserAvatar';

function ProfileMeasure({
  icon: Icon,
  value,
  label,
  explanation,
  accent,
}: {
  icon: typeof Coins;
  value: string;
  label: string;
  explanation: string;
  accent: string;
}) {
  return (
    <article className="profile-cv-measure">
      <span className="profile-cv-measure-icon" style={{ color: accent, backgroundColor: `${accent}1f` }}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-black uppercase text-stone">{label}</span>
        <strong className="mt-0.5 block font-display text-xl font-black text-ink">{value}</strong>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-stone">{explanation}</span>
      </span>
    </article>
  );
}

export function ProfileCvHost() {
  const { profile } = useAuth();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [data, setData] = useState<ProfileCvData | null>(null);
  const [artwork, setArtwork] = useState<PanelImageSetting | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const close = useCallback(() => {
    setTargetId(null);
    setData(null);
    setError('');
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<{ userId?: string | null }>).detail?.userId;
      if (!profile?.id) return;
      setTargetId(requested || profile.id);
    };
    window.addEventListener(OPEN_PROFILE_CV_EVENT, open);
    return () => window.removeEventListener(OPEN_PROFILE_CV_EVENT, open);
  }, [profile?.id]);

  useEffect(() => {
    if (!targetId) return;
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    void Promise.allSettled([
      fetchProfileCv(targetId),
      fetchPanelImageSetting('meditation'),
    ]).then(([profileResult, artworkResult]) => {
      if (!active) return;
      if (profileResult.status === 'fulfilled') setData(profileResult.value);
      else setError(profileResult.reason instanceof Error ? profileResult.reason.message : 'This profile could not be opened.');
      if (artworkResult.status === 'fulfilled') setArtwork(artworkResult.value);
      setLoading(false);
    });
    return () => { active = false; };
  }, [targetId]);

  useEffect(() => {
    if (!targetId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, targetId]);

  if (!targetId || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[2147483500] flex items-end justify-center bg-navy/72 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4" onClick={close}>
      <section
        className="profile-cv-panel relative isolate flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-lg border border-border-bright bg-bg shadow-2xl animate-slide-up sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={data ? `${data.display_name}'s profile` : 'Full Circle profile'}
      >
        <PanelImageBackdrop image={artwork} opacityFallback={24} veilClassName="profile-cv-veil" />
        <header className="relative z-10 flex items-center justify-between border-b border-white/15 px-4 py-3">
          <div>
            <p className="eyebrow text-gold">Full Circle Profile</p>
            <p className="mt-0.5 text-[10px] text-stone">A record of faithful participation</p>
          </div>
          <button type="button" onClick={close} className="icon-btn" aria-label="Close profile"><X size={17} /></button>
        </header>

        <div className="relative z-10 min-h-[20rem] overflow-y-auto overscroll-contain px-4 pb-8 pt-5 sm:px-6 sm:pb-10">
          {loading ? (
            <div className="flex min-h-[18rem] flex-col items-center justify-center gap-3 text-stone">
              <Loader2 size={24} className="animate-spin text-gold" />
              <p className="text-xs font-semibold">Opening profile</p>
            </div>
          ) : error ? (
            <div className="flex min-h-[18rem] items-center justify-center text-center text-sm text-coral">{error}</div>
          ) : data ? (
            <>
              <div className="flex items-center gap-4 border-b border-white/15 pb-5">
                <UserAvatar userId={data.user_id} name={data.display_name} avatarUrl={data.avatar_url} className="h-24 w-24 shrink-0 border-2 border-white/40 shadow-xl" loading="eager" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-2xl font-black leading-tight text-ink">{data.display_name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="badge badge-peri capitalize">{data.role}</span>
                    {data.tent_house_id && <TentHouseBadge houseId={data.tent_house_id} size="sm" />}
                    {data.tent_name && <span className="text-[10px] font-bold text-stone">{data.tent_name}</span>}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-peri/30 bg-navy/55 px-3 py-2 backdrop-blur-md">
                    <ChiRhoMark size={18} className="text-peri" />
                    <span><strong className="block font-display text-lg leading-none text-peri">{data.marks.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><span className="text-[9px] font-black uppercase text-peri-dim">Valediction marks</span></span>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <ProfileMeasure icon={BookOpenCheck} label="Streak" value={`${data.current_streak} days`} explanation="Days the Bible has been read consistently" accent="#ef6a4d" />
                <ProfileMeasure icon={Shield} label="Figs" value={data.total_figs.toLocaleString()} explanation="Bible questions answered correctly" accent="#7c8cff" />
                <ProfileMeasure icon={Swords} label="Rhudes" value={data.rhudes.toLocaleString()} explanation="Bible duels won" accent="#5bad7f" />
                <ProfileMeasure icon={Coins} label="Denarii" value={formatDenarii(data.total_denarii)} explanation="Coins earned from daily Bible interactions" accent="#f5b731" />
              </div>

              <p className="mt-6 border-t border-white/15 pt-4 text-[10px] font-semibold text-stone">
                Full Circle resident since {new Date(data.member_since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </p>
            </>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
